/* =============================================================================
   Atlas de Arquitecturas — js/content/imitation.js
   Página de modelo: imitation learning — behavior cloning (BC), covariate shift y DAgger, demostraciones
   multimodales, ACT / ALOHA y Diffusion Policy. Canónica act-aloha (ACT tal como se publicó: 4 cámaras de
   480×640, ResNet-18 por cámara, encoder 4 capas + decoder 7, d = 512, 8 cabezas, FFN 3,200, chunk k = 100,
   CVAE con z de 32, 14 articulaciones a 50 Hz). Configs: diffusion-policy-cnn (Chi et al., U-Net 1-D con FiLM,
   T_o = 2, T_p = 16, T_a = 8), bc-mlp (línea base). Plantilla fija de 11 secciones (SPEC §5.3, §27.2).
   Tesis de la fase (SPEC §27): dos formas de conseguir una política de robot — RL optimiza una recompensa por
   prueba y error (#rl-ppo); imitation learning aprende de demostraciones.
   Papers: Pomerleau, ALVINN (NIPS 1988); Ross y Bagnell, AISTATS 2010; Ross, Gordon y Bagnell, DAgger (AISTATS
   2011, arXiv:1011.0686); Zhao et al., ACT / ALOHA (RSS 2023, arXiv:2304.13705; repo tonyzhaozh/act); Chi et al.,
   Diffusion Policy (RSS 2023, versión extendida en IJRR 2024; arXiv:2303.04137 v5; repo real-stanford/diffusion_policy);
   Florence et al., IBC (CoRL 2021, arXiv:2109.00137); Shafiullah et al., BeT (NeurIPS 2022, arXiv:2206.11251);
   Lee et al., VQ-BeT (ICML 2024, arXiv:2403.03181); Fu, Zhao y Finn, Mobile ALOHA (arXiv:2401.02117).
   Los VLAs (π0, OpenVLA, RT-2) y la difusión como técnica (Stable Diffusion, DiT) viven en sus páginas: aquí se
   enlazan, no se repiten.
   Regla: ningún número de la arquitectura se escribe a mano. Formas, parámetros, MACs, Hz ≈ salen del calculador
   (js/arch/robotlearn.js, modelo imitation; cantidades {{config.ruta}}, SPEC §6.6). Resultados citan tabla o sección.
   Ejercicios verificados en el venv del Atlas (scratchpad build15/imit/ex: compounding.py, modes.py,
   temporal_ensemble.py). Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/robotlearn.js, modelo imitation).
  const C = 'act-aloha';
  const DP = 'diffusion-policy-cnn';
  const CT = 'act-aloha-train';      // forward de entrenamiento con el encoder CVAE (vista act-cvae)
  const BCM = 'bc-mlp';

  // Claves de metrics() del calculador. Un solo lugar para adaptarlas al contrato (build15/arch-ids.md).
  const MK = {
    cams: 'cams', chunk: 'chunk', dof: 'actionDim', hz: 'controlHz', latent: 'latentDim', kl: 'klWeight',
    To: 'obsSteps', Tp: 'chunk', Ta: 'executed', steps: 'steps', cond: 'condDim',
    pVis: 'visionParams', pPol: 'policyParams', pCvae: 'cvaeParams', pHead: 'headParams',
    tok: 'tokens', vMacs: 'visionMacs', pMacs: 'policyMacs', inf: 'macsPerInference', step: 'stepMacs', den: 'denoiseMacs',
    encM: 'encoderMacs', decM: 'decoderMacs', dead: 'deadDecoderMacs', used: 'decoderLayersUsed',
    api: 'actionsPerInference', ihz: 'inferenceHz', ihzTE: 'inferenceHz', ihzNoTE: 'inferenceHzNoTE', share: 'visionMacsShare',
    msOrin: 'msOrin', msH100: 'msH100', hzOrin: 'maxHzOrin', fits: 'fitsControlOrin',
  };
  // Tensores: nombre corto de la página → id del calculador (arch-ids.md §2).
  const TN = {
    img: 'img', c5: 'c5', feat: 'feat', imgTok: 'img-tokens', qpos: 'qpos', propTok: 'proprio-tok', z: 'z', latTok: 'latent-tok',
    src: 'src', mem: 'memory', qpos_: 'query-pos', dout: 'd-out', hs: 'hs', act: 'actions', action: 'action', aSeq: 'action-seq',
    kp: 'keypoints', camFeat: 'cam-feat', obsCond: 'obs-cond', noisy: 'noisy-actions', temb: 't-emb', cond: 'cond', eps: 'eps',
    den: 'denoised', exec: 'action-exec',
  };
  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const sh = (id, cfg) => qn('tensor.' + (TN[id] || id) + '.shape', cfg);

  const ALVINN = 'Pomerleau, <i>ALVINN: An Autonomous Land Vehicle in a Neural Network</i>, NIPS 1988';
  const RB10 = 'Ross y Bagnell, <i>Efficient Reductions for Imitation Learning</i>, AISTATS 2010';
  const DAGGER = 'Ross, Gordon y Bagnell, <i>A Reduction of Imitation Learning and Structured Prediction to No-Regret Online Learning</i> (DAgger), AISTATS 2011, arXiv:1011.0686';
  const ACTP = 'Zhao, Kumar, Levine y Finn, <i>Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware</i> (ACT / ALOHA), RSS 2023, arXiv:2304.13705';
  const DPP = 'Chi et al., <i>Diffusion Policy: Visuomotor Policy Learning via Action Diffusion</i>, RSS 2023; versión extendida IJRR 2024, arXiv:2303.04137 (v5)';
  const IBC = 'Florence et al., <i>Implicit Behavioral Cloning</i>, CoRL 2021, arXiv:2109.00137';
  const BET = 'Shafiullah et al., <i>Behavior Transformers: Cloning k modes with one stone</i>, NeurIPS 2022, arXiv:2206.11251';
  const VQBET = 'Lee et al., <i>Behavior Generation with Latent Actions</i> (VQ-BeT), ICML 2024, arXiv:2403.03181';
  const MOBALOHA = 'Fu, Zhao y Finn, <i>Mobile ALOHA: Learning Bimanual Mobile Manipulation with Low-Cost Whole-Body Teleoperation</i>, arXiv:2401.02117 (2024)';
  const ROBOMIMIC = 'Mandlekar et al., <i>What Matters in Learning from Offline Human Demonstrations for Robot Manipulation</i> (robomimic), CoRL 2021, arXiv:2108.03298';
  const HGD = 'Kelly et al., <i>HG-DAgger: Interactive Imitation Learning with Human Experts</i>, ICRA 2019, arXiv:1810.02890';
  const SCALING = 'Lin et al., <i>Data Scaling Laws in Imitation Learning for Robotic Manipulation</i>, arXiv:2410.18647 (2024)';
  const EVALP = 'Kress-Gazit et al., <i>Robot Learning as an Empirical Science: Best Practices for Policy Evaluation</i>, arXiv:2409.09491 (2024)';
  const UNLEASH = 'Zhao et al., <i>ALOHA Unleashed: A Simple Recipe for Robot Dexterity</i>, arXiv:2410.13126 (2024)';
  const CONSIST = 'Prasad et al., <i>Consistency Policy: Accelerated Visuomotor Policies via Consistency Distillation</i>, arXiv:2405.07503 (2024)';
  const DDIM = 'Song, Meng y Ermon, <i>Denoising Diffusion Implicit Models</i>, ICLR 2021, arXiv:2010.02502';
  const FILM = 'Perez et al., <i>FiLM: Visual Reasoning with a General Conditioning Layer</i>, AAAI 2018, arXiv:1709.07871';
  const DIFFUSER = 'Janner et al., <i>Planning with Diffusion for Flexible Behavior Synthesis</i> (Diffuser), ICML 2022, arXiv:2205.09991';
  const LEVINE16 = 'Levine et al., <i>End-to-End Training of Deep Visuomotor Policies</i>, JMLR 2016, arXiv:1504.00702';
  const DPPO = 'Ren et al., <i>Diffusion Policy Policy Optimization</i> (DPPO), arXiv:2409.00588 (2024)';
  const HILSERL = 'Luo et al., <i>Precise and Dexterous Robotic Manipulation via Human-in-the-Loop Reinforcement Learning</i> (HIL-SERL), arXiv:2410.21845 (2024)';
  const KINGMA = 'Kingma y Welling, <i>Auto-Encoding Variational Bayes</i>, ICLR 2014, arXiv:1312.6114';
  const SOHN = 'Sohn, Lee y Yan, <i>Learning Structured Output Representation using Deep Conditional Generative Models</i> (CVAE), NeurIPS 2015';
  const LEROBOT = 'Cadene et al., <i>LeRobot: State-of-the-art Machine Learning for Real-World Robotics in Pytorch</i>, repositorio huggingface/lerobot (2024)';

  ATLAS.register({
    id: 'imitation',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> dado un conjunto de demostraciones (un humano moviendo el robot por teleoperación: imágenes, estado de las articulaciones y la acción que mandó en cada instante), aprender una <b>política</b> observación → acción con aprendizaje supervisado, sin función de recompensa. ACT, la canónica, recibe ${met('cams')} imágenes y las ${met('dof')} posiciones articulares de un robot bimanual y devuelve un <b>chunk</b> de ${met('chunk')} acciones futuras (${sh('act')}), 2 segundos de movimiento a ${met('hz')} Hz.` },
          { t: 'p', html: R`Es la forma más barata de enseñar una tarea de manipulación a un robot real: el paper de ACT aprende 6 tareas finas (abrir un vasito de salsa translúcido, meter una batería) con 80–90 % de éxito a partir de 50 demostraciones por tarea, "only 10 minutes worth of demonstrations" (${ACTP}, abstract). El precio: la política solo sabe lo que vio, se equivoca más cuanto más se aleja de lo visto y, si las demostraciones tienen varias formas válidas de hacer la tarea, una regresión ingenua las promedia. Esta página es sobre esos dos problemas y las arquitecturas que los resuelven.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿Imitation learning?', 'Por qué'], rows: [
            ['Una tarea de manipulación concreta (pick-and-place, insertar, doblar) con 50–200 demos teleoperadas', '<b>Sí: ACT o Diffusion Policy desde cero</b>', 'Entrenan en horas en una GPU, corren a decenas de Hz y usan varias cámaras y el estado del robot desde el diseño.'],
            ['Tareas diestras y bimanuales a 50 Hz (ALOHA)', 'Sí (ACT)', 'Chunks de 100 acciones + temporal ensembling: movimientos suaves y precisos con hardware barato e impreciso.'],
            ['Demostraciones con varias estrategias válidas (empujar desde la izquierda o desde la derecha)', 'Sí, con un modelo generativo', 'Diffusion Policy (o un CVAE, una mezcla de gaussianas, tokens): una regresión MSE devuelve el promedio, que no es ninguna de las dos.'],
            ['Muchas tareas, instrucciones en lenguaje, objetos nuevos', R`Mejor un VLA ajustado (<a href="#pi0">π0</a>, <a href="#openvla">OpenVLA</a>)`, 'El preentrenamiento en datos web y de muchos robots es lo que generaliza; ACT/DP desde cero no sigue instrucciones.'],
            ['Hay una recompensa fácil de medir y un simulador fiel (locomoción)', R`No: <a href="#rl-ppo">RL</a>`, 'Millones de intentos en simulación superan a cualquier demostración humana; para caminar no hay teleoperador.'],
            ['Superar al demostrador o afinar precisión de contacto', 'Solo como inicio', R`BC copia al experto, errores incluidos. Para mejorar: RL encima de la política de BC (residual, fine-tuning con RL; ver <a href="#imitation.entrevista">entrevista</a>).`],
            ['No hay quien demuestre (tareas peligrosas, cinemática imposible de teleoperar)', 'No', 'Sin demostraciones no hay datos; RL en simulación o planificación clásica.'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Imitation learning turns robot control into supervised learning on teleoperated demonstrations. Plain behavior cloning has two failure modes: compounding errors, because the policy visits states the expert never did, and mode averaging, because a regression loss averages multimodal demonstrations. ACT fixes them with action chunking and a CVAE on top of a DETR-style transformer; Diffusion Policy denoises whole action sequences, which represents multimodal distributions and keeps each chunk committed to one mode."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como entrenar un regresor sobre imágenes, pero tus salidas deciden tus próximas entradas.</b> En ImageNet el dataset está fijo: lo que predice el modelo no cambia qué imagen ve después. En un robot, la acción que predices mueve el brazo y la próxima imagen depende de eso. Esa sola diferencia rompe la suposición i.i.d. del aprendizaje supervisado y explica casi todo lo que hay en esta página. Las piezas, en cambio, ya las conoces.` },
          { t: 'table', caption: 'Lo que ya sabes, en imitation learning', head: ['Concepto', 'Dónde lo viste', 'Aquí', '¿Nuevo?'], rows: [
            ['Regresión supervisada con un backbone CNN', 'ResNet / YOLO (cabeza de regresión de cajas)', R`Behavior cloning: ResNet-18 sobre las cámaras → MLP → acción; pérdida L2 o L1 contra la acción del demostrador`, 'Igual'],
            ['Encoder-decoder con queries aprendidas', R`<a href="#detr">DETR</a>: 100 object queries → 100 cajas en paralelo`, R`ACT: ${met('chunk')} queries → ${met('chunk')} acciones futuras en paralelo (el código de ACT es el de DETR)`, 'Equivale'],
            ['VAE y la reparametrización', R`El VAE de <a href="#stable-diffusion">Stable Diffusion</a>`, 'El CVAE de ACT: un z de "estilo" del demostrador; en inferencia z = 0', 'Equivale'],
            ['Difusión con predicción de ε (DDPM, DDIM)', R`<a href="#stable-diffusion.operaciones">Stable Diffusion</a>, <a href="#dit">DiT</a>`, 'Diffusion Policy: el mismo DDPM sobre una secuencia de acciones (T<sub>p</sub> × d) en vez de un latente de imagen', 'Equivale'],
            ['FiLM / adaLN (condicionar con escala y sesgo)', R`<a href="#dit.operaciones">adaLN de DiT</a>`, 'La U-Net 1-D de Diffusion Policy recibe la observación y el paso de difusión por FiLM', 'Equivale'],
            ['Chunks de acciones', R`<a href="#pi0">π0</a> (50 acciones), OpenVLA-OFT`, 'Viene de aquí: ACT lo introdujo como remedio al error compuesto', 'Origen'],
            ['Covariate shift y error compuesto', '—', 'La política visita estados que el experto nunca visitó; el error crece ∝ T² en el peor caso', '<b>Nuevo</b>'],
            ['DAgger (agregar datos en los estados de la política)', '—', 'El remedio teórico: etiquetar con el experto los estados a los que llega la política', '<b>Nuevo</b>'],
          ] },

          { t: 'h3', text: 'Behavior cloning: aprendizaje supervisado sobre pares (o, a)' },
          { t: 'p', html: R`Primero el ejemplo. Un operador teleopera un brazo durante 50 episodios de ≈ 10 s a 50 Hz: ≈ 25,000 pares (observación, acción). Cada observación son las imágenes y las articulaciones; cada acción, las 14 posiciones objetivo que mandó el operador en ese instante. Entrenas una red que, dada la observación, prediga la acción, con la misma receta que una regresión de cajas: batch, pérdida, Adam. Eso es todo behavior cloning (BC), y es lo que hizo ALVINN en 1988 para manejar una camioneta con una red de una capa oculta (${ALVINN}).` },
          { t: 'math', display: true, tex: R`\hat\pi=\arg\min_{\pi}\ \mathbb E_{(o,a^*)\sim\mathcal D_{\text{demo}}}\big[\ell\big(\pi(o),a^*\big)\big],\qquad \ell=\|\pi(o)-a^*\|_2^2\ \ \text{o}\ \ \|\pi(o)-a^*\|_1`, caption: R`Behavior cloning: minimizar la pérdida en la distribución de estados <b>del demostrador</b> (d<sub>π*</sub>). Todo lo demás es elegir qué es o (cuántas cámaras, historia, estado), qué es a (articulaciones o efector, absoluto o delta, una acción o un chunk) y qué familia de π.` },
          { t: 'callout', kind: 'trap', title: '"Si la pérdida de validación es baja, la política funciona"', html: R`<p>La validación de BC se mide en estados del demostrador; la política se ejecuta en <b>sus</b> estados. Un modelo con pérdida de validación excelente puede fallar en el robot y otro peor puede andar mejor. ACT elige el checkpoint por la menor pérdida de validación (${ACTP}, §IV); Diffusion Policy evalúa los checkpoints en el entorno y reporta el máximo y el promedio de los últimos 10 (${DPP}, Tablas 1–2), y señala que con IBC la elección de checkpoint es tan inestable que hay que evaluarlos todos. La única métrica que decide es la tasa de éxito con la política ejecutándose (sección de <a href="#imitation.fallas">fallas y evaluación</a>).</p>` },

          { t: 'h3', text: 'Covariate shift: por qué el error se compone' },
          { t: 'p', html: R`Ejemplo con números. Una tarea de T = 100 pasos. La política se equivoca con probabilidad ε = 1 % por paso en los estados del demostrador. Supón el peor caso: después del primer error queda en un estado que nunca vio, donde ya no sabe qué hacer, y paga costo 1 en cada paso hasta el final. El costo esperado es la suma, paso a paso, de la probabilidad de haberse salido ya: Σ<sub>t</sub> [1 − (1 − ε)<sup>t</sup>] = <b>37.2</b> pasos perdidos. Si en cambio cada error le costara un solo paso y volviera a estados conocidos, el costo sería T·ε = <b>1</b>. Mismo ε, 37 veces más costo, y la brecha crece con T: con T = 200, 114 contra 2. Lo calculas a mano en la <a href="#imitation.practica">práctica</a>.` },
          { t: 'math', display: true, tex: R`J(\hat\pi_{\text{BC}})\ \le\ J(\pi^*)+T^2\varepsilon,\qquad \varepsilon=\mathbb E_{s\sim d_{\pi^*}}\big[\ell(s,\hat\pi)\big]`, caption: R`Teorema 2.1 de ${DAGGER} (resultado de ${RB10}): J es el costo total de T pasos con costos por paso en [0, 1]; ℓ es la pérdida 0-1 respecto del experto (o una cota superior de ella) medida en la distribución de estados del <b>experto</b>. La cota es ajustada: hay problemas donde BC paga Θ(T²ε). En el ejemplo, la cota da 100 y el costo exacto 37.2 (≈ εT²/2 mientras εT ≪ 1).` },
          { t: 'p', html: R`La intuición: el error no es independiente entre pasos. Un error chico te lleva a un estado un poco fuera de la distribución de entrenamiento; ahí el error por paso ya no es ε sino mayor; eso te aleja más. En robótica se ve como un brazo que se desvía unos milímetros al acercarse a un objeto, nunca vio demostraciones "desde ahí", y sigue derecho hasta golpearlo. El supervised learning clásico no tiene esto porque la distribución de entrada no depende de las predicciones.` },
          { t: 'viz', kind: 'covariate-shift', params: { config: C, method: 'bc', T: 200 }, caption: R`Ilustrativo (pista, ruido y política inventados): el desvío lateral de una política de BC que copia bien al experto dentro de lo que vio y extrapola mal fuera. Cambia a DAgger para ver cómo la banda de estados vistos crece, y prueba chunks de k pasos. Las cotas que muestra son las de los papers; el horizonte efectivo con chunks (⌈T/k⌉ decisiones) es el argumento de ACT, no un teorema.` },

          { t: 'h3', text: 'DAgger: entrenar en los estados que visita la política' },
          { t: 'p', html: R`Si el problema es que la política se entrena en d<sub>π*</sub> y se ejecuta en d<sub>π̂</sub>, la solución directa es <b>recolectar etiquetas en d<sub>π̂</sub></b>. DAgger (Dataset Aggregation) lo hace en iteraciones:` },
          { t: 'steps', items: [
            { title: 'Iteración 1', html: R`<p>Entrena π̂<sub>1</sub> con las demostraciones (eso es BC). En el paper, β<sub>1</sub> = 1: la primera vuelta la maneja el experto.</p>` },
            { title: 'Ejecutar una mezcla', html: R`<p>En la iteración i, ejecuta π<sub>i</sub> = β<sub>i</sub>·π* + (1 − β<sub>i</sub>)·π̂<sub>i</sub> durante T pasos (con prob. β<sub>i</sub> actúa el experto). Lo común en la práctica: β<sub>i</sub> = 𝟙(i = 1), es decir, desde la segunda vuelta solo la política, que el paper reporta como "often" la mejor opción.</p>` },
            { title: 'Etiquetar', html: '<p>El experto anota qué acción habría tomado en <b>cada estado visitado</b>, aunque la acción ejecutada haya sido la de la política.</p>' },
            { title: 'Agregar y reentrenar', html: '<p>D ← D ∪ D<sub>i</sub> (se guarda todo, no solo lo último) y π̂<sub>i+1</sub> se entrena con el D agregado. Repetir N veces; quedarse con la mejor política según la validación en el entorno.</p>' },
          ] },
          { t: 'math', display: true, tex: R`J(\hat\pi)\ \le\ J(\pi^*)+u\,T\,\varepsilon_N+O(1)\qquad\text{si } N=\tilde O(uT),\qquad \varepsilon_N=\min_{\pi\in\Pi}\tfrac1N\sum_{i=1}^{N}\mathbb E_{s\sim d_{\pi_i}}\big[\ell(s,\pi)\big]`, caption: R`Teorema 3.2 de DAgger: existe una política entre π̂<sub>1:N</sub> con esa garantía. u acota cuánto aumenta el costo restante del experto si en un estado se toma una acción cualquiera y después se sigue al experto. Dos matices que se anotan: (1) ε<sub>N</sub> no es el ε de BC: es la mejor pérdida alcanzable sobre los estados que visitaron las políticas; (2) es lineal en T <b>solo si u es O(1)</b>, es decir, si los errores son recuperables. Si un error te tira la taza (u ∼ T), DAgger tampoco te salva.` },
          { t: 'callout', kind: 'trap', title: '"DAgger arregla el covariate shift, ¿por qué nadie lo usa en robots?"', html: R`<p>Sí se usa, pero en otra forma. DAgger necesita un experto que <b>etiquete estados que no eligió</b>: un humano mirando un video y diciendo "aquí habría movido la muñeca 3 grados", a 50 Hz y en 14 dimensiones. Con un controlador programado como experto (simulación, un planificador) es trivial; con un teleoperador, casi imposible. La versión práctica es <b>HG-DAgger</b> (${HGD}): la política maneja, el humano interviene y toma el control cuando ve que va mal, y solo los segmentos corregidos se agregan al dataset. Es lo que hacen hoy los equipos de VLAs con intervenciones (ver la pregunta de covariate shift de <a href="#rt2.entrevista">RT-2</a>). La otra respuesta: <b>chunks</b>, que no corrigen la distribución pero reducen cuántas decisiones encadenas.</p>` },

          { t: 'h3', text: 'Demostraciones multimodales: por qué la MSE promedia' },
          { t: 'p', html: R`Ejemplo de una dimensión. Frente a un obstáculo, la mitad de las demos lo rodean por la izquierda (a = −1) y la mitad por la derecha (a = +1), desde la misma observación. ¿Qué número c minimiza la MSE? E[(a − c)²] = ½(c + 1)² + ½(c − 1)² = c² + 1, mínima en <b>c = 0</b>: derecho al obstáculo. Peor: la MSE <b>prefiere</b> el choque. En c = 0 vale 1; en c = −1 (una acción válida) vale ½·0 + ½·4 = 2. La regresión no está "mal entrenada": encuentra exactamente la media condicional E[a | o], y la media de dos modos válidos puede ser inválida. Con 70/30, el óptimo es la media −0.4, todavía en el medio.` },
          { t: 'p', html: R`¿Y L1, que usa ACT? La L1 da la <b>mediana</b>: con 70/30 elige el modo mayoritario (−1) y con 50/50 cualquier punto de [−1, 1] es óptimo (la pérdida es plana: el resultado depende de la inicialización). L1 ayuda con modos desbalanceados, no resuelve el problema; ACT lo resuelve con el CVAE (y Diffusion Policy con difusión). El ejercicio de código lo comprueba: la MSE da ≈ 0 y una mezcla de dos gaussianas encuentra medias ≈ ±1.` },
          { t: 'viz', kind: 'multimodal-actions', params: { config: DP, p: 0.5 }, caption: R`Ilustrativo (sintético): dos demostraciones válidas alrededor de un obstáculo. La regresión MSE las promedia en una trayectoria que choca; una política que muestrea (difusión, mezcla, CVAE) elige un lado por episodio.` },
          { t: 'table', caption: 'Cómo modelar acciones multimodales (de la más simple a la más expresiva)', head: ['Familia', 'Qué predice', 'Ejemplo', 'Costo / problema'], rows: [
            ['Regresión (MSE o L1)', 'Un punto: la media (o la mediana)', 'BC-MLP; OpenVLA-OFT con L1', 'Promedia modos. Funciona cuando las demos son casi unimodales.'],
            ['Mezcla de gaussianas (GMM / MDN)', 'K medias, varianzas y pesos; se muestrea un componente', R`BC-RNN / LSTM-GMM de ${ROBOMIMIC}`, 'Hay que elegir K; la NLL es inestable con varianzas chicas; escala mal a secuencias largas en alta dimensión.'],
            ['Discretización + clasificación', 'Un softmax sobre bins o clusters (más un offset continuo)', R`BeT (k-means + offset; ${BET}), VQ-BeT (VQ jerárquico; ${VQBET}); tokens de <a href="#openvla">OpenVLA</a>`, 'Precisión limitada por los bins; el softmax es multimodal sin problema.'],
            ['Implícito / energía (EBM)', 'Una energía E(o, a); la acción es argmin<sub>a</sub> E', R`IBC (${IBC})`, 'Inferencia por optimización o muestreo en el espacio de acciones; entrenamiento con negativos (InfoNCE) inestable.'],
            ['Variable latente (CVAE)', 'a = f(o, z); z captura el "estilo" de cada demo', 'ACT', 'En inferencia z = 0: determinista, siempre el mismo estilo. Pensado para la variabilidad de estilo humana más que para modos discretos lejanos.'],
            ['Difusión / flow matching', 'Muestras de p(a | o) por denoising iterativo', R`Diffusion Policy; <a href="#pi0">π0</a> (flujo)`, 'K pasos de la red por inferencia; la más expresiva y estable.'],
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Lo que ya sabes y reaparece: el encoder-decoder con queries de <a href="#detr">DETR</a> (ACT), el DDPM y la predicción de ε de <a href="#stable-diffusion">Stable Diffusion</a> (Diffusion Policy), FiLM como pariente de adaLN de <a href="#dit">DiT</a>. Lo que sigue: <a href="#pi0">π0</a> toma el chunk de ACT y el modelo generativo de Diffusion Policy y los pone encima de un VLM; <a href="#rl-ppo">RL</a> es la otra forma de conseguir una política.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`ACT, de izquierda a derecha: ${met('cams')} cámaras de ${sh('img')} pasan por una ResNet-18 cada una (stride 32: un mapa de ${sh('c5')}); una conv 1×1 lleva los 512 canales al ancho del transformer y los mapas de las cámaras se aplanan y concatenan en ${sh('imgTok')}. A esa secuencia se le suman dos tokens: las ${met('dof')} articulaciones proyectadas y el z del CVAE. El <b>encoder</b> del transformer (${cf('Lenc')} capas) mezcla todo; el <b>decoder</b> (${cf('Ldec')} capas) recibe ${met('chunk')} queries, una por acción futura, y les hace cross-attention a la memoria del encoder, exactamente como las object queries de DETR. Una lineal da ${sh('act')}: ${met('chunk')} posiciones articulares objetivo. "Recorrido" sigue una inferencia con números; expande el CVAE para ver qué pasa en entrenamiento.` },
          { t: 'archdiagram', diagram: 'act-overview', walk: 'forward', wide: true, caption: R`ACT (act-aloha): ${met('cams')} cámaras → ResNet-18 → ${met('tok')} tokens → encoder → decoder con ${met('chunk')} queries → ${sh('act')} → temporal ensembling → robot. Formas del calculador.` },
          { t: 'h3', text: 'El CVAE de ACT (solo en entrenamiento)' },
          { t: 'p', html: R`En entrenamiento, un segundo encoder transformer (el "CVAE encoder", ${cf('Lenc')} capas) recibe un token [CLS], las articulaciones actuales y la <b>secuencia de acciones real</b> de la demo (${sh('aSeq', CT)}); de la salida del [CLS] saca μ y log σ² de un z de ${met('latent')} dimensiones. z ~ N(μ, σ²) entra como token al encoder de la política. En inferencia no hay acciones reales: el CVAE encoder se descarta y <b>z = 0</b>, la media del prior. Las imágenes no entran al CVAE encoder "for faster training" (${ACTP}, §IV).` },
          { t: 'archdiagram', diagram: 'act-cvae', walk: 'forward', caption: 'Vista de entrenamiento: el style encoder resume la demo en z; la pérdida es L1 de reconstrucción + β·KL. En inferencia esta rama desaparece y z = 0.' },
          { t: 'h3', text: 'Diffusion Policy: un denoiser sobre la secuencia de acciones' },
          { t: 'p', html: R`La config <code>${DP}</code>: las últimas T<sub>o</sub> = ${met('To', DP)} observaciones (2 cámaras + estado) pasan por una ResNet-18 por cámara (GroupNorm y spatial softmax en vez de BatchNorm y global average pooling) y se concatenan en un vector de condición. Una <b>U-Net 1-D</b> sobre el eje del tiempo recibe una secuencia ruidosa de T<sub>p</sub> = ${met('Tp', DP)} acciones y predice el ruido; la condición y el paso de difusión entran en cada bloque por FiLM. Se repite K = ${met('steps', DP)} veces y de las T<sub>p</sub> acciones se ejecutan T<sub>a</sub> = ${met('Ta', DP)}; después, nueva observación y nueva secuencia (receding horizon).` },
          { t: 'archdiagram', diagram: 'diffusion-policy', walk: 'forward', caption: R`Diffusion Policy (CNN): encoder de observación una vez por inferencia, U-Net 1-D ${met('steps', DP)} veces, T<sub>a</sub> de T<sub>p</sub> acciones ejecutadas. Formas del calculador.` },
          { t: 'h3', text: 'Chunks y temporal ensembling' },
          { t: 'p', html: R`ACT consulta la política en <b>cada</b> paso de control (50 Hz; nodo <a href="#imitation.diagrama~ensemble">ensemble</a> del diagrama) aunque cada consulta devuelva ${met('chunk')} acciones: para el paso t hay hasta ${met('chunk')} predicciones (una de cada chunk que lo cubre) y se promedian con pesos w<sub>i</sub> = exp(−m·i), w<sub>0</sub> la más vieja. Mueve el modo a "ensamble" para verlo; con "todo el chunk" ves los saltos entre chunks que el ensamble suaviza.` },
          { t: 'viz', kind: 'action-chunking', params: { f: 50, H: 50, exec: 'ens' }, caption: 'Ilustrativo (objetivo sintético que salta a mitad de camino): chunk de H acciones, cuántas se ejecutan por consulta y el ensamble temporal de ACT. ACT usa H = 100 (la visualización llega a 50). Lo que no es ilustrativo: consultas por segundo = f / k, y con ensamble, f consultas por segundo.' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el ejemplo de ACT, sin notación. (1) <b>Imágenes</b>: ${met('cams')} cámaras (dos en las muñecas, una frontal, una superior) de 480×640×3. (2) <b>ResNet-18</b> por cámara, con stride total 32: 480/32 = 15, 640/32 = 20, mapa de 15×20×512. (3) Conv 1×1 a d = ${cf('D')} y aplanar: 300 tokens por cámara, ${met('cams')} × 300 = 1,200 tokens de imagen, más un token de articulaciones y uno de z: ${sh('src')} (el paper: "1202×512"). (4) <b>Encoder</b>: ${cf('Lenc')} capas de self-attention sobre esos tokens. (5) <b>Decoder</b>: ${met('chunk')} queries de ${cf('D')} hacen self-attention entre ellas y cross-attention a la memoria. (6) <b>Cabeza</b>: lineal ${cf('D')} → ${met('dof')}: ${sh('act')}. Ahora la notación.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'act-aloha / diffusion-policy-cnn'], rows: [
            ['n', 'cámaras', R`${met('cams')} / ${met('cams', DP)}`],
            ['k (ACT), T<sub>p</sub> (DP)', 'acciones predichas por inferencia (chunk / prediction horizon)', R`${met('chunk')} / ${met('Tp', DP)}`],
            ['T<sub>a</sub>', 'acciones ejecutadas antes de volver a inferir (DP); ACT con ensamble: 1', R`1 / ${met('Ta', DP)}`],
            ['T<sub>o</sub>', 'pasos de observación de entrada (DP); ACT: solo el actual', R`1 / ${met('To', DP)}`],
            ['d<sub>a</sub>', 'dimensión de la acción (articulaciones + pinzas)', R`${met('dof')} / ${met('dof', DP)}`],
            ['d, h', 'ancho y cabezas del transformer de ACT', R`${cf('D')}, ${cf('h')}`],
            ['z, β', 'variable latente del CVAE y peso del KL', R`${met('latent')} dims, β = 10 (Tabla III del paper)`],
            ['K', 'pasos de denoising en inferencia (DP)', met('steps', DP)],
            ['f', 'frecuencia de control', R`${met('hz')} Hz / ${met('hz', DP)} Hz`],
          ] },

          { t: 'h3', text: 'ACT: observación → tokens' },
          { t: 'op', block: 'backbone', model: 'imitation', title: 'ResNet-18 por cámara (pesos compartidos)',
            tex: R`\mathbf I^c\in\mathbb R^{480\times640\times3}\ \xrightarrow{\ \text{ResNet-18 (stride 32)}\ }\ \mathbf C_5^c\in\mathbb R^{15\times20\times512},\qquad c=1,\dots,n`,
            in: [TN.img], out: [TN.c5], params: true, flops: true,
            what: R`La ResNet-18 de torchvision preentrenada en ImageNet, sin la cabeza ni el GAP, con BatchNorm congelada (FrozenBatchNorm de DETR) y learning rate de backbone 1e-5. Los <b>mismos pesos</b> para las ${met('cams')} cámaras (el código llama a <code>backbones[0]</code> para todas). Se suma un embedding posicional seno-coseno 2-D, también de DETR.`,
            why: R`Es la parte que ya conoces: un ResNet como extractor de features, como en DETR o en el backbone de YOLO. Lo que cambia es que cada token conserva su posición en la imagen: la política necesita saber <b>dónde</b> está la pinza, no solo qué hay (por eso no hay GAP). El diagrama muestra los parámetros de una torre y los MACs × ${met('cams')}.` },
          { t: 'op', block: 'input-proj', model: 'imitation', title: 'Proyección 1×1 y concatenación de cámaras',
            tex: R`\mathbf F^c=\mathbf C_5^c\,W_{1\times1}+\mathbf b\in\mathbb R^{15\times20\times d}\ \to\ \mathbb R^{300\times d},\qquad X_{\text{img}}=\big[\mathbf F^1;\dots;\mathbf F^n\big]\in\mathbb R^{300n\times d}`,
            in: [TN.c5], out: [TN.feat], params: true, flops: true,
            what: R`Una conv 1×1 (512 → ${cf('D')}) por cámara, compartida; los ${met('cams')} mapas se aplanan y se concatenan (el código los pega a lo ancho: 15 × 80) en ${sh('imgTok')}, con su embedding seno-coseno 2-D de DETR (${cf('D')}/2 dimensiones por eje).`,
            why: 'El mismo truco que DETR para pasar de un mapa convolucional a una secuencia de tokens: cada píxel del mapa de stride 32 es un token con su posición.' },
          { t: 'op', block: 'tokens', model: 'imitation', title: 'Tokens de articulaciones y de z',
            tex: R`\mathbf x_q=W_q\,\mathbf q_t+\mathbf b_q\in\mathbb R^{d},\qquad \mathbf x_z=W_z\,\mathbf z+\mathbf b_z\in\mathbb R^{d},\qquad \mathbf z\in\mathbb R^{32}`,
            in: [TN.propTok, TN.latTok, TN.imgTok], out: [TN.src],
            what: R`Las ${met('dof')} posiciones articulares (normalizadas con media y desvío del dataset) y z (${met('latent')} dims) se proyectan con una lineal cada uno a d y se anteponen a los tokens de imagen, con un embedding posicional aprendido propio. Resultado: ${sh('src')}.`,
            why: 'El estado le dice a la política dónde está el brazo; z le dice "con qué estilo" ejecutar (en inferencia, el promedio).' },

          { t: 'h3', text: 'ACT: el transformer (DETR con acciones)' },
          { t: 'op', block: 'encoder', model: 'imitation', title: 'Encoder: self-attention sobre imagen + estado + z',
            tex: R`X^{(\ell+1)}=\mathrm{LN}\Big(X'+\mathrm{FFN}(X')\Big),\quad X'=\mathrm{LN}\Big(X^{(\ell)}+\mathrm{MHA}\big(X^{(\ell)}+P,\ X^{(\ell)}+P,\ X^{(\ell)}\big)\Big)`,
            in: [TN.src], out: [TN.mem], params: true, flops: true,
            what: R`${cf('Lenc')} capas post-LN de DETR (d = ${cf('D')}, ${cf('h')} cabezas, FFN ${cf('Dmlp')}, ReLU, dropout 0.1). El embedding posicional P se suma a queries y keys en cada capa (no a los values), como en DETR. La atención es sobre ${met('tok')} tokens: es la parte cuadrática.`,
            why: R`Mezcla las ${met('cams')} vistas entre sí y con el estado: la cámara de muñeca ve el contacto, la superior ve dónde está el objeto, y la política necesita las dos.` },
          { t: 'op', block: 'decoder', model: 'imitation', title: 'Decoder: k queries de acción con cross-attention',
            tex: R`Y^{(0)}=\mathbf 0\in\mathbb R^{k\times d},\qquad Y^{(\ell+1)}=\mathrm{Dec}\big(Y^{(\ell)}+Q_{\text{pos}},\ \mathrm{memoria}\big),\qquad Q_{\text{pos}}\in\mathbb R^{k\times d}`,
            in: [TN.mem], out: [TN.dout], params: true, flops: true,
            what: R`Como DETR: la entrada del decoder son ceros y las ${met('chunk')} "queries" son embeddings de posición que se suman en cada capa. Self-attention entre las ${met('chunk')} acciones (bidireccional: la acción 50 ve a la 99) y cross-attention a los ${met('tok')} tokens de la memoria. El paper dice que las queries son "fixed sinusoidal embeddings"; el código usa un <code>nn.Embedding</code> aprendido.`,
            why: R`Predecir las ${met('chunk')} acciones en paralelo, en una pasada, en vez de autoregresivo: la misma idea que reemplazó la decodificación secuencial de cajas por un set en DETR.` },
          { t: 'callout', kind: 'trap', title: 'El decoder de 7 capas que usa 1', html: R`<p>En el código oficial, el transformer de DETR devuelve las salidas intermedias de todas las capas del decoder (<code>return_intermediate_dec=True</code>, pensado para las pérdidas auxiliares de DETR) y ACT toma el índice <code>[0]</code>: la salida de la <b>primera</b> capa. Las otras 6 se calculan en cada inferencia y no afectan la acción (ni reciben gradiente). LeRobot lo documenta y por eso su ACT usa 1 capa de decoder "to match the original implementation" (${LEROBOT}). Lección de entrevista: un número de una tabla de hiperparámetros no es lo que corre; si mides la latencia o cuentas parámetros "útiles", lee el código. El calculador cuenta las ${cf('Ldec')} capas, porque se ejecutan.</p>` },
          { t: 'op', block: 'action-head', model: 'imitation', title: 'Cabeza de acciones',
            tex: R`\hat{\mathbf A}_t=Y^{(L)}W_a+\mathbf b_a\in\mathbb R^{k\times d_a},\qquad \hat{\mathbf A}_t[i]=\hat{\mathbf a}_{t+i},\ i=0,\dots,k-1`,
            in: [TN.hs], out: [TN.act], params: true, flops: true,
            what: R`Una lineal d → ${met('dof')} por query: las posiciones articulares <b>objetivo</b> absolutas de los dos brazos para los próximos ${met('chunk')} pasos. Hay una segunda cabeza, <code>is_pad_head</code>, que predice si la acción es relleno (fin del episodio); no se usa al ejecutar.`,
            why: R`Objetivos absolutos y no deltas: el paper reporta peor desempeño con deltas de posición articular (§IV). Las sigue el PID de los motores Dynamixel a alta frecuencia; la red no manda torques.` },
          { t: 'callout', kind: 'note', html: R`<p>La acción de ACT es la posición del brazo <b>líder</b> (el que mueve el operador), no la del seguidor: la diferencia entre las dos, a través del PID, es la fuerza que el seguidor aplica. Así la política "manda fuerza" sin sensor de fuerza: si quiere apretar, pide una posición un poco más cerrada que la que el objeto permite (${ACTP}, §IV).</p>` },

          { t: 'h3', text: 'ACT: el CVAE y la pérdida' },
          { t: 'op', block: 'cv-encoder', model: 'imitation', config: CT, diagram: 'act-cvae', title: 'CVAE encoder (solo entrenamiento)',
            tex: R`[\boldsymbol\mu,\log\boldsymbol\sigma^2]=W_\mu\,\mathrm{Enc}_{\text{cvae}}\big([\text{CLS};\ \mathbf q_t;\ \mathbf a_{t:t+k}]\big)_{\text{CLS}},\qquad \mathbf z=\boldsymbol\mu+\boldsymbol\sigma\odot\boldsymbol\epsilon,\ \ \boldsymbol\epsilon\sim\mathcal N(0,I)`,
            in: [TN.aSeq], out: [TN.z], params: true, flops: true,
            what: R`Un encoder transformer de ${cf('Lenc')} capas sobre [CLS, articulaciones, ${met('chunk')} acciones reales] (${met('chunk')} + 2 tokens). La salida del CLS se proyecta a μ y log σ² de ${met('latent')} dims; z por reparametrización (${KINGMA}). No ve imágenes.`,
            why: R`Los humanos no hacen la tarea igual dos veces: más rápido, más alto, con una pausa. Sin z, la política tendría que promediar esos estilos. Con z, la reconstrucción puede ser exacta "dado el estilo", y el KL obliga a que z ~ N(0, I) para poder usar z = 0 al inferir. Es un CVAE (${SOHN}) condicionado en la observación.` },
          { t: 'math', display: true, tex: R`\mathcal L_{\text{ACT}}=\underbrace{\frac{1}{k\,d_a}\sum_{i=0}^{k-1}\big\|\hat{\mathbf a}_{t+i}-\mathbf a_{t+i}\big\|_1}_{\text{reconstrucción (L1)}}\ +\ \beta\,\underbrace{D_{\mathrm{KL}}\big(\mathcal N(\boldsymbol\mu,\boldsymbol\sigma^2)\,\|\,\mathcal N(0,I)\big)}_{=\ -\frac12\sum_j(1+\log\sigma_j^2-\mu_j^2-\sigma_j^2)},\qquad \beta=10`, caption: R`Pérdida de ACT (§IV; <code>policy.py</code> del repo): L1 promediada sobre las acciones que no son relleno + β·KL sumado sobre las ${met('latent')} dimensiones. "We noted that L1 loss leads to more precise modeling of the action sequence." β = 10 (Tabla III).` },
          { t: 'callout', kind: 'trap', title: 'z = 0 en inferencia: ¿entonces para qué el CVAE?', html: R`<p>Para <b>entrenar</b>. Sin z, las demos que difieren en estilo producen gradientes que se contradicen y el decoder aprende el promedio (o la mediana con L1). Con z, cada demo se explica con su propio z y el decoder aprende un mapeo limpio "observación + estilo → trayectoria"; al inferir con z = 0 sale una trayectoria coherente de un estilo "típico", no el promedio de dos. La ablación lo muestra: con datos humanos, sin el CVAE el éxito cae de 35.3 % a 2 %; con datos de un script (sin variabilidad), da igual (§VI-B, Fig. 6c). Si β es muy chico, z memoriza la demo y z = 0 cae fuera de lo visto; si es muy grande, z se ignora (posterior collapse) y vuelves al promedio.</p>` },

          { t: 'h3', text: 'ACT: temporal ensembling' },
          { t: 'math', display: true, tex: R`\mathbf a_t=\frac{\sum_{i}w_i\,\hat{\mathbf A}_{t-j_i}[\,j_i\,]}{\sum_i w_i},\qquad w_i=e^{-m\,i},\quad i=0\ \text{la predicción más vieja},\qquad m=0.01\ (\text{repo})`, caption: R`Algoritmo 2 del paper y <code>imitate_episodes.py</code>: con <code>temporal_agg</code> la política se consulta en cada paso; cada chunk pedido en el paso t − j aporta su predicción j-ésima para el paso t. Con m = 0.01 y 100 predicciones, la más vieja pesa 1.57 % y la más nueva 0.59 %: <b>pesa más lo viejo</b> ("a smaller m means faster incorporation of new observation").` },
          { t: 'op', block: 'ensemble', model: 'imitation', title: 'Temporal ensembling (fuera de la red)',
            tex: R`\mathbf a_t=\sum_{i=0}^{n_t-1}\frac{e^{-m i}}{\sum_{j}e^{-m j}}\,\hat{\mathbf a}^{(i)}_t,\qquad n_t=\min(t+1,\,k)`,
            in: [TN.act], out: [TN.action],
            what: R`Un buffer de T × (T + k) × ${met('dof')} guarda cada chunk en la fila del paso en que se pidió; para el paso t se toma la columna t (las predicciones pobladas, de la más vieja a la más nueva) y se promedia. No tiene parámetros ni MACs que importen: el costo está en hacer una inferencia por paso.`,
            why: 'Suaviza las fronteras entre chunks y le da a cada paso varias "opiniones". El precio es inferir a la frecuencia de control.' },
          { t: 'callout', kind: 'trap', title: 'El ensamble no es gratis ni "mira el futuro"', html: R`<p>(1) <b>Costo</b>: sin ensamble, ACT infiere una vez cada ${met('chunk')} pasos (${met('ihzNoTE')} inferencias por segundo); con ensamble, ${met('ihzTE')} por segundo: ${met('chunk')}× más cómputo. (2) <b>Reacción</b>: si algo cambia, la predicción nueva es solo una de hasta ${met('chunk')} que se promedian y la vieja pesa más: el cambio entra diluido. (3) <b>Multimodalidad</b>: promediar dos chunks que eligieron lados distintos es justo la media que se quería evitar. El paper reporta +3.3 % de éxito con el ensamble en ACT (§VI-A, Fig. 6b); π0 lo probó y empeoraba (<a href="#pi0.puente">π0</a>).</p>` },

          { t: 'h3', text: 'Diffusion Policy: DDPM sobre acciones' },
          { t: 'p', html: R`El ejemplo primero, con la config del calculador (Push-T real: empujar una T a su lugar con la punta de un brazo UR5, acción = posición (x, y) objetivo del efector, ${met('dof', DP)} dims, a ${met('hz', DP)} Hz). Observación: las 2 últimas imágenes de 2 cámaras y la pose del efector. Se sortea una secuencia de T<sub>p</sub> = ${met('Tp', DP)} acciones de puro ruido, A<sup>K</sup> ~ N(0, I) de ${sh('noisy', DP)}. La U-Net mira (A<sup>k</sup>, k, observación) y predice el ruido ε̂; un paso del sampler resta una fracción de ε̂ y (en DDPM) agrega un poco de ruido nuevo. Después de K pasos queda A<sup>0</sup>: una trayectoria limpia. Como cada inferencia empieza de otro ruido, dos inferencias desde la misma observación pueden elegir lados distintos del obstáculo; dentro de una secuencia, en cambio, todos los pasos son coherentes porque se generan juntos.` },
          { t: 'op', block: 'dp-encoder', model: 'imitation', diagram: 'diffusion-policy', title: 'Encoder de observación (ResNet-18 con GroupNorm y spatial softmax)',
            tex: R`\mathbf c_t=\big[\,\phi_1(\mathbf I^1_{t-T_o+1:t});\ \phi_2(\mathbf I^2_{t-T_o+1:t});\ \mathbf q_{t-T_o+1:t}\,\big],\qquad \mathrm{SpatialSoftmax}(F)_c=\Big(\textstyle\sum_{u,v}\mathrm{softmax}(F_c)_{uv}\,x_u,\ \sum_{u,v}\mathrm{softmax}(F_c)_{uv}\,y_v\Big)`,
            in: [TN.img], out: [TN.camFeat], params: true, flops: true, config: DP,
            what: R`Una ResNet-18 por cámara (sin compartir pesos), entrenada de cero junto con la política; BatchNorm reemplazada por GroupNorm (BatchNorm se lleva mal con el EMA de los pesos) y el global average pooling por <b>spatial softmax</b>: una conv 1×1 a 32 mapas y, por cada uno, la posición esperada (x, y) de su activación (${sh('kp', DP)}; ${LEVINE16}), y una lineal a ${sh('camFeat', DP)} por cámara (el <code>VisualCore</code> de robomimic). Las T<sub>o</sub> observaciones de las ${met('cams', DP)} cámaras más la pose del efector se concatenan en ${sh('obsCond', DP)}, y con el embedding del paso k forman la condición de ${sh('cond', DP)}. Se calcula <b>una vez</b> por inferencia, no por paso de difusión.`,
            why: R`Spatial softmax convierte cada canal en un "punto clave": la política trabaja con coordenadas de cosas, no con un vector promedio que borra dónde están. Es el pooling que se usaba en visuomotor desde 2016.` },
          { t: 'op', block: 'dp-unet', model: 'imitation', diagram: 'diffusion-policy', title: 'U-Net 1-D temporal con FiLM',
            tex: R`\mathrm{FiLM}(\mathbf h\mid\mathbf c,k)=\boldsymbol\gamma(\mathbf c,k)\odot\mathbf h+\boldsymbol\beta(\mathbf c,k),\qquad \boldsymbol\epsilon_\theta(\mathbf A^k_t,k,\mathbf c_t)\in\mathbb R^{T_p\times d_a}`,
            in: [TN.noisy, TN.cond], out: [TN.eps], params: true, flops: true, config: DP,
            what: R`La secuencia de acciones es una "señal 1-D" de T<sub>p</sub> pasos con d<sub>a</sub> canales. La U-Net (de ${DIFFUSER}) la baja y la sube en el eje del tiempo con convoluciones 1-D (kernel 5, GroupNorm de 8 grupos, Mish) y skips; en cada bloque residual, un MLP sobre [embedding de k ; c<sub>t</sub>] produce una escala γ y un sesgo β por canal (FiLM, ${FILM}). La observación nunca es parte de la secuencia: solo modula.`,
            why: R`Convoluciones en el tiempo dan trayectorias suaves (sesgo inductivo de baja frecuencia) y funcionan "out of the box" con pocos hiperparámetros: los autores recomiendan empezar por la CNN y pasar al transformer solo si la tarea tiene cambios de acción bruscos (${DPP}, §3.1). FiLM es el mismo truco que adaLN en DiT.` },
          { t: 'math', display: true, tex: R`\mathcal L_{\text{DP}}=\mathbb E_{(\mathbf O_t,\mathbf A^0_t)\sim\mathcal D,\ k,\ \boldsymbol\epsilon}\big\|\boldsymbol\epsilon-\boldsymbol\epsilon_\theta\big(\sqrt{\bar\alpha_k}\,\mathbf A^0_t+\sqrt{1-\bar\alpha_k}\,\boldsymbol\epsilon,\ k,\ \mathbf O_t\big)\big\|^2,\qquad k\sim\mathcal U\{1,\dots,100\}`, caption: R`La pérdida de DDPM con predicción de ε (la de <a href="#stable-diffusion.entrenamiento">Stable Diffusion</a>) con la acción en lugar del latente; el paper la escribe con un α, γ genéricos (Eq. 4–5). 100 pasos de entrenamiento con el schedule "square cosine" de iDDPM, que fue el que mejor anduvo para control (§3.3).` },
          { t: 'math', display: true, tex: R`\mathbf A^{k-1}_t=\alpha\big(\mathbf A^{k}_t-\gamma\,\boldsymbol\epsilon_\theta(\mathbf O_t,\mathbf A^k_t,k)+\mathcal N(0,\sigma^2 I)\big),\qquad k=K,\dots,1`, caption: R`Paso de denoising (Eq. 1/4 del paper). Con DDIM (${DDIM}) se entrena con 100 pasos y se infiere con menos: el paper cita 10 pasos con ≈ 0.1 s de latencia en una RTX 3080 (§3.4) y las tablas de hiperparámetros del robot real usan 16 (Tabla 7; <code>eval_real_robot.py</code>); el YAML del repo para Push-T real dice 8, y es lo que usa el calculador (${met('steps', DP)}).` },
          { t: 'h3', text: 'Receding horizon: T_o, T_p, T_a' },
          { t: 'p', html: R`En el paso t, la política ve las observaciones t − T<sub>o</sub> + 1 … t y predice T<sub>p</sub> acciones que empiezan en t − T<sub>o</sub> + 1 (se solapan con el pasado); ejecuta las T<sub>a</sub> que empiezan en el paso actual (índices T<sub>o</sub> − 1 … T<sub>o</sub> + T<sub>a</sub> − 2 del vector) y vuelve a planificar. Con T<sub>o</sub> = 2, T<sub>p</sub> = 16, T<sub>a</sub> = 8 a 10 Hz: una inferencia cada 0.8 s. Es MPC (model predictive control) sin modelo: planear largo, ejecutar corto, replanificar.` },
          { t: 'table', caption: 'Los tres horizontes y qué pasa si los mueves (paper §2.3, §5.3, App. B.1)', head: ['Horizonte', 'Default', 'Si lo subes', 'Si lo bajas'], rows: [
            ['T<sub>o</sub> (observación)', met('To', DP), 'Con visión, la CNN rinde peor ("performance decrease with increasing observation horizon"); más cómputo del encoder', 'T<sub>o</sub> = 1 pierde la velocidad (dos frames dan la derivada)'],
            ['T<sub>p</sub> (predicción)', met('Tp', DP), 'Más consistencia temporal; más cómputo por paso (secuencia más larga)', 'Se pierde la ventaja de comprometerse con un modo'],
            ['T<sub>a</sub> (ejecución)', met('Ta', DP), 'Menos inferencias por segundo; menos reacción (más lazo abierto)', 'Más reactivo, pero cambia de modo entre inferencias (jitter); 8 fue óptimo en la mayoría de las tareas'],
          ] },
          { t: 'callout', kind: 'senior', title: 'Posición vs velocidad: el hallazgo que se pregunta', html: R`<p>Diffusion Policy con <b>control de posición</b> (acciones = poses objetivo absolutas) rinde consistentemente mejor que con control de velocidad, al revés que la práctica de BC de la época (robomimic usaba velocidad). Dos razones del paper (§4.2): (1) con posición la multimodalidad es más marcada y Diffusion Policy la maneja bien; un modelo unimodal la sufre más; (2) la posición sufre menos error compuesto: un error de velocidad se integra en el tiempo, uno de posición no. Y con latencia, la velocidad empeora más (§5.3). Es el mismo resultado de ACT con posiciones articulares absolutas contra deltas.</p>` },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor de ACT en la config canónica: imágenes, mapas de features, tokens, memoria, queries, chunk de acciones. Toca una fila para resaltarlo en el diagrama. Debajo, el mismo recorrido para Diffusion Policy.` },
          { t: 'trace', model: 'imitation' },
          { t: 'trace', model: 'imitation', config: DP },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`ACT tiene ${qn('params.total')} parámetros en el calculador (el paper: "around 80M"): la <a href="#imitation.diagrama~backbone">ResNet-18</a> ${met('pVis')}, la política (transformer y proyecciones) ${met('pPol')}, el <a href="#imitation.diagrama~act-cvae.cv-encoder">CVAE encoder</a> ${met('pCvae')} (solo entrenamiento) y las cabezas ${met('pHead')}. Por inferencia: ${met('vMacs')} en visión y ${met('pMacs')} en el transformer (encoder ${met('encM')}, decoder ${met('decM')}), ${met('inf')} en total; la visión es ${met('share')} del cómputo. De los MACs del <a href="#imitation.diagrama~decoder">decoder</a>, ${met('dead')} son de las capas 2–7 que el código calcula y descarta (usa ${met('used')}).` },
          { t: 'params', model: 'imitation', group: 'block' },
          { t: 'flops', model: 'imitation' },
          { t: 'p', html: R`Diffusion Policy (CNN, Push-T real) invierte el reparto de parámetros: ${qn('params.total', DP)} (el paper: 67M de difusión + 22M de visión, Tabla 7), con la <a href="#imitation.diagrama~dp-unet">U-Net</a> en ${met('pPol', DP)} y las dos <a href="#imitation.diagrama~dp-encoder">ResNet-18</a> en ${met('pVis', DP)}. Pero en <b>MACs</b> manda la visión: la U-Net trabaja sobre una secuencia de ${met('Tp', DP)} × ${met('dof', DP)}, así que cada pasada cuesta solo ${met('step', DP)}; ${met('steps', DP)} pasos suman ${met('den', DP)}, contra ${met('vMacs', DP)} de las dos ResNet (${met('share', DP)} del total de ${met('inf', DP)}).` },
          { t: 'callout', kind: 'trap', title: '"La U-Net es barata, entonces los pasos no importan"', html: R`<p>En MACs, no importan mucho. En <b>latencia</b> con batch 1, sí: cada paso de denoising vuelve a leer los ${met('pPol', DP)} parámetros de la U-Net de memoria (${est('≈ 133 MB en bf16 por paso; no caben en la caché L2 de un Orin')}) para hacer muy pocos MACs. Es el mismo régimen limitado por memoria del decode de un LLM (<a href="#llm-inferencia">inferencia de LLMs</a>): la latencia escala con pasos × bytes de pesos, no con MACs. ${est('Cuenta a mano en un Orin (204.8 GB/s): 8 pasos × 133 MB ≈ 1.1 GB ≈ 5 ms solo de leer pesos; con 100 pasos de DDPM, ≈ 65 ms')}. Mídelo con CUDA events por paso.</p>` },
          { t: 'params', model: 'imitation', config: DP, group: 'block' },
          { t: 'flops', model: 'imitation', config: DP },
          { t: 'h3', text: 'El explorador: chunk, cámaras, pasos y resolución' },
          { t: 'scaling', model: 'imitation', knobs: [{ key: 'chunk', values: [1, 10, 50, 100, 200] }, { key: 'cams', values: [1, 2, 4] }, { key: 'res', values: [240, 480] }], show: ['tokens', 'macsPerInference', 'actionsPerInference', 'inferenceHz', 'msOrin'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> cada cámara agrega 300 tokens a la memoria de ACT a 480×640 (y una pasada de ResNet-18): las lineales crecen lineal, la atención del encoder cuadrático. Duplicar la resolución en cada lado → ×4 tokens → ×4 en la ResNet y en las lineales, ×16 en QKᵀ del encoder. El chunk k casi no cuesta: k queries en el decoder es poco frente a 1,200 tokens de memoria; lo que cambia con k es <b>cuántas veces</b> hay que inferir (sin ensamble, f/k por segundo). En Diffusion Policy, los MACs de denoising son lineales en los pasos K y en T<sub>p</sub>, pero parten de una base chica: subir K de ${met('steps', DP)} a 100 multiplica los MACs totales por ≈ 3.4, no por 12.5, porque la visión se paga una vez. En latencia, en cambio, K pesa más de lo que dicen los MACs (la trampa de arriba).` },
          { t: 'scaling', model: 'imitation', config: DP, knobs: [{ key: 'steps', values: [1, 8, 16, 100] }, { key: 'chunk', values: [16, 32, 64] }], show: ['stepMacs', 'denoiseMacs', 'macsPerInference', 'msOrin'] },
          { t: 'h3', text: 'ACT vs Diffusion Policy vs BC-MLP' },
          { t: 'compare', models: [BCM, C, DP], rows: ['params', 'macsPerInference', 'actionsPerInference', 'inferenceHz', 'msOrin'], caption: R`Configs canónicas del calculador. Cotas roofline (≈) en un Jetson AGX Orin con batch 1: un piso, no una medida. ACT con ensamble infiere ${met('hz')} veces por segundo; Diffusion Policy, f / T<sub>a</sub>.` },
          { t: 'callout', kind: 'estimate', html: R`<p><b>¿Llega a la frecuencia de control en un Jetson?</b> ACT con ensamble necesita una inferencia cada 20 ms (${met('ihzTE')} por segundo); la cota del calculador es ${met('msOrin')} ms ${est('(la medida real en un Orin será mayor: kernels chicos, batch 1, preprocesado de 4 imágenes de 480×640; mídela con CUDA events y la cadena completa cámara → acción)')}. Si no entra, desactiva el ensamble e infiere cada k pasos: ${met('chunk')}× menos cómputo. Diffusion Policy a ${met('hz', DP)} Hz con T<sub>a</sub> = ${met('Ta', DP)}: ${met('ihz', DP)} inferencias por segundo y ${met('steps', DP)} pasadas de la U-Net cada vez; la cota del calculador es ${met('msOrin', DP)} ms ${est('(cuenta los pesos una vez por inferencia; con la U-Net releída en cada paso la cota sube a varios ms, y el paper mide ≈ 0.1 s con 10 pasos de DDIM en una RTX 3080: con 0.8 s de presupuesto por inferencia, sobra margen)')}. Con la cota, ACT podría inferir hasta ${met('hzOrin')} veces por segundo en el Orin.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Las dos pérdidas, juntas: ACT minimiza L1 de reconstrucción del chunk + β·KL del CVAE; Diffusion Policy, la MSE entre el ruido real y el predicho. Ninguna usa recompensa; las dos se entrenan desde cero por tarea (salvo el backbone de ACT, preentrenado en ImageNet).` },
          { t: 'math', display: true, tex: R`\mathcal L_{\text{ACT}}=\|\hat{\mathbf A}_t-\mathbf A_t\|_1+\beta\,D_{\mathrm{KL}}\big(q_\phi(\mathbf z\mid\mathbf A_t,\mathbf q_t)\,\|\,\mathcal N(0,I)\big),\qquad \mathcal L_{\text{DP}}=\big\|\boldsymbol\epsilon-\boldsymbol\epsilon_\theta(\mathbf A^0_t+\boldsymbol\epsilon^k,\ k,\ \mathbf O_t)\big\|^2`, caption: 'Cada ejemplo es un instante t de una demo: la observación de ese instante y las k (o T_p) acciones siguientes. Al final del episodio el chunk se rellena y se enmascara (is_pad en ACT).' },
          { t: 'h3', text: 'Recetas (lo que se pregunta)' },
          { t: 'kv', items: [
            ['ACT: datos', '50 demos por tarea real (100 en Thread Velcro), episodios de 8–14 s (400–700 pasos a 50 Hz): 10–20 min de datos y 30–60 min de reloj por los resets', '§V-B'],
            ['ACT: hiperparámetros', 'AdamW, lr 1e-5 (backbone 1e-5), batch 8, encoder 4 / decoder 7 capas, FFN 3,200, d 512, 8 cabezas, chunk 100, β = 10, dropout 0.1', 'Tabla III'],
            ['ACT: cómputo', '≈ 80M parámetros, ≈ 5 h de entrenamiento en una RTX 2080 Ti de 11 GB, ≈ 0.01 s por inferencia en la misma GPU', '§IV'],
            ['ACT: selección', 'Checkpoint con la menor pérdida de validación', '§IV'],
            ['DP: datos reales', 'Push-T 136 demos (UR5, SpaceMouse a 10 Hz); Mug Flip 250; Sauce Pour y Spread 90 cada uno (Franka, 10 Hz)', '§6, App.'],
            ['DP: hiperparámetros (CNN)', 'T<sub>o</sub> 2, T<sub>p</sub> 16, T<sub>a</sub> 8 (6 en Push-T real), lr 1e-4, weight decay 1e-6, 100 pasos de difusión de entrenamiento, EMA de los pesos, crop aleatorio (≈ 90 % de la imagen)', 'Tabla 7'],
            ['DP: imágenes', 'Sim 84×84 (crop 76; Push-T 96×96, crop 84; ToolHang 240×240, crop 216); real 2 cámaras de 320×240 (crop 288×216)', 'Tabla 7'],
            ['DP: tamaño', 'Sim: U-Net de ≈ 256M; real: ≈ 67M (la config del calculador sale del código, no de la tabla)', 'Tabla 7'],
          ] },
          { t: 'callout', kind: 'trap', title: 'La augmentación que importa: crop aleatorio, no color', html: R`<p>Diffusion Policy y robomimic entrenan con <b>random crop</b> (≈ 90 % del lado) y en evaluación usan el crop central. Con pocas decenas de demos, sin crop la política memoriza píxeles exactos de la escena. Y no voltees las imágenes horizontalmente: "izquierda" es una acción; un flip sin voltear también la acción enseña lo contrario.</p>` },

          { t: 'h3', text: '¿Cuántas demostraciones hacen falta?' },
          { t: 'p', html: R`Lo que dicen los papers, en orden: (1) para <b>una tarea, una escena</b>, 50 demos (≈ 10 min) le alcanzan a ACT para 84–96 % de éxito final en 4 de 6 tareas reales (Slide Ziploc 88, Slot Battery 96, Open Cup 84, Put On Shoe 92; Tablas I–II); Prep Tape queda en 64 % y Thread Velcro en 20 % aun con 100 demos, porque cada etapa pierde precisión; Diffusion Policy usó 90–250 en sus tareas reales. (2) Para <b>generalizar</b> a escenas y objetos nuevos, la cantidad de demos por escena importa poco: lo que escala es la <b>diversidad</b>. ${SCALING} (más de 40,000 demos y 15,000 rollouts reales) encuentra una ley de potencias en el número de entornos y objetos distintos, y rendimientos decrecientes de agregar demos en el mismo entorno pasado un umbral. (3) La calidad pesa tanto como la cantidad: un operador consistente con 50 demos le gana a tres operadores con estrategias distintas y 150 (cada estrategia es un modo más que modelar).` },
          { t: 'callout', kind: 'interview', html: R`<p>Lo que un entrevistador anota cuando preguntas "¿cuántas demos?": que no des un número sin decir qué varía (posiciones iniciales, objetos, escenas), que separes "aprender la tarea" de "generalizar", y que propongas medir: entrenar con 25, 50 y 100 y graficar éxito contra demos en un set de condiciones de evaluación fijo.</p>` },

          { t: 'h3', text: 'Recolección de datos: teleoperación' },
          { t: 'list', items: [
            R`<b>Leader–follower (ALOHA, GELLO)</b>: el operador mueve un brazo "líder" chico con la misma cinemática y el seguidor copia las posiciones articulares. Graba exactamente el espacio de acción de la política (articulaciones absolutas, 50 Hz), es lo más fluido para tareas finas y bimanuales, y es barato: ALOHA cuesta "$18k ($20k after adding optional add-ons such as cameras)" con dos ViperX como seguidores y dos WidowX como líderes (${ACTP}). La dinámica del operador también importa: el estudio del paper mide que teleoperar a 5 Hz en vez de 50 Hz alarga las tareas un 62 % (§VI-C).`,
            R`<b>SpaceMouse / VR</b>: comandos del efector, genérico, menos fluido en contacto. Diffusion Policy usó SpaceMouse a 10 Hz. Comparación completa y qué grabar: la pregunta de teleoperación de <a href="#openvla.entrevista">OpenVLA</a>.`,
            R`<b>Mobile ALOHA</b> (${MOBALOHA}): ALOHA sobre una base móvil, el operador atado a la base; 50 demos por tarea y co-entrenamiento con los datos de ALOHA estático, que sube el éxito "by up to 90%".`,
            R`<b>Sin robot</b>: pinzas de mano con cámara (UMI) graban demos "en la calle" y se retargetean al robot; más datos baratos, con una brecha de embodiment.`,
          ] },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los detalles de hardware de ALOHA (gravity compensation con gomas, el mango tipo tijera del líder). Lo que se pregunta: leader–follower graba posiciones articulares absolutas y la acción es la del líder.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'ACT, cada paso (20 ms a 50 Hz)', html: R`<p>Leer las ${met('cams')} cámaras y las articulaciones; normalizar; una pasada de ResNet-18 × ${met('cams')} + encoder + decoder con z = 0 → chunk de ${met('chunk')}; guardarlo en el buffer; promediar las predicciones para el paso actual con w<sub>i</sub> = exp(−0.01·i); desnormalizar y mandar los 14 objetivos al PID de los motores.</p>` },
            { title: 'ACT sin ensamble', html: R`<p>Una inferencia cada ${met('chunk')} pasos (2 s), ejecutar el chunk completo a lazo abierto. ${met('chunk')}× menos cómputo, menos reacción y saltos en las fronteras.</p>` },
            { title: 'Diffusion Policy, cada T_a pasos', html: R`<p>Encoder de las T<sub>o</sub> observaciones (una vez), ${met('steps', DP)} pasos de la U-Net desde ruido (DDIM), ejecutar ${met('Ta', DP)} de las ${met('Tp', DP)} acciones a 10 Hz (0.8 s), y repetir.</p>` },
          ] },
          { t: 'h3', text: 'Qué domina la latencia' },
          { t: 'table', caption: 'Inferencia por modelo (calculador, ≈ roofline) y lo medido en los papers', head: ['', 'ACT (act-aloha)', 'Diffusion Policy (CNN)'], rows: [
            ['MACs por inferencia', met('inf'), met('inf', DP)],
            ['De ellos, visión', met('vMacs'), met('vMacs', DP)],
            ['Acciones por inferencia (predichas)', met('api'), met('api', DP)],
            ['Inferencias por segundo necesarias', R`${met('ihzTE')} (con ensamble)`, met('ihz', DP)],
            ['Cota en Jetson AGX Orin', R`${met('msOrin')} ms`, R`${met('msOrin', DP)} ms`],
            ['Cota en H100', R`${met('msH100')} ms`, R`${met('msH100', DP)} ms`],
            ['Medido en el paper', '≈ 0.01 s en una RTX 2080 Ti (§IV)', '≈ 0.1 s con 10 pasos de DDIM en una RTX 3080 (§3.4)'],
          ], note: 'Las cotas roofline (máximo entre bytes ÷ ancho de banda y MACs ÷ pico) son un piso: con batch 1 y redes chicas, la latencia medida la dominan los lanzamientos de kernels, la copia de imágenes y el preprocesado. Para medir: CUDA events alrededor de la cadena completa, con warmup, en el hardware del robot.' },
          { t: 'h3', text: 'Trucos para bajar la latencia' },
          { t: 'table', head: ['Truco', 'Qué hace', 'Costo'], rows: [
            ['Menos pasos de difusión (DDIM, 100 → 10–16)', 'Lineal en la parte de la U-Net', 'Muestras más "promedio" con muy pocos pasos; medir éxito'],
            [R`Consistency Policy (${CONSIST})`, 'Destila Diffusion Policy a 1–3 pasos: "an order of magnitude" más rápido', 'Un entrenamiento extra; algo de calidad'],
            ['Desactivar el ensamble de ACT', 'k× menos inferencias', 'Saltos entre chunks, menos reacción'],
            ['Menos cámaras o menor resolución', 'Menos tokens (ACT) y menos ResNet', 'Información (la muñeca suele ser la cámara clave)'],
            ['Inferencia asíncrona', 'Calcular el siguiente chunk mientras se ejecuta el actual', R`El chunk sale de una observación vieja: alinear con la latencia (real-time chunking, en <a href="#pi0.inferencia">π0</a>)`],
            ['TensorRT / torch.compile + CUDA graphs, FP16', 'Menos overhead por kernel', 'Validar equivalencia numérica contra la referencia'],
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>La cuenta "Hz de control vs Hz de inferencia" es la misma de <a href="#pi0.inferencia">π0</a>: un chunk de k acciones ejecutadas permite inferir f/k veces por segundo. ACT con ensamble es el caso extremo (infiere a la frecuencia de control); π0 ejecuta medio chunk sin ensamble.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Error compuesto fuera de distribución.</b> La política se acerca al objeto desde una pose que no está en las demos y no sabe volver. Síntoma: anda desde las posiciones iniciales de los datos y falla desde otras. Arreglos: demos que cubran las condiciones de evaluación, demos de recuperación (empezar desde un error), intervenciones tipo HG-DAgger, chunks.`,
            R`<b>Cambio de modo entre chunks.</b> Un chunk elige la izquierda, el siguiente la derecha: el robot oscila o duda frente al obstáculo. Arreglos: T<sub>a</sub> más largo, demos más consistentes, o (en ACT) el ensamble, que suaviza pero promedia.`,
            R`<b>Pausas e inactividad.</b> Una política de un paso aprende "en este estado, no moverse" de las pausas del operador y se congela ahí para siempre. Chunks y secuencias lo mitigan (ACT §IV-A, DP §4.3); mejor todavía, recortar las pausas largas de los datos.`,
            R`<b>Atajos causales.</b> Con el estado (o la historia) como entrada, la política aprende "seguir moviéndome como venía" y deja de mirar la imagen (causal confusion; ver la trampa del estado en <a href="#pi0.operaciones">π0</a>).`,
            R`<b>Sobreajuste con pocas demos.</b> La pérdida baja y el éxito en el robot se estanca o cae entre checkpoints; la política repite una demo concreta. Evaluar checkpoints en el robot (o en simulación) y usar crop aleatorio.`,
            R`<b>Cambio de condiciones.</b> Otra luz, otro mantel, la cámara movida 2 cm: una política entrenada desde cero con 50 demos de una escena no tiene por qué generalizar. Es la razón de existir de los VLAs.`,
          ] },
          { t: 'table', caption: 'BC-MLP vs ACT vs Diffusion Policy vs VLA ajustado vs RL (filas = criterios)', head: ['Criterio', 'BC-MLP (MSE)', 'ACT', 'Diffusion Policy', R`VLA ajustado (<a href="#pi0">π0</a>, <a href="#openvla">OpenVLA</a>)`, R`RL (<a href="#rl-ppo">PPO</a>)`], rows: [
            ['Datos', 'Demos', '50 demos por tarea', '90–250 demos por tarea real', 'Decenas a cientos de demos + preentrenamiento masivo', 'Recompensa + millones de pasos (simulación)'],
            ['Multimodalidad', 'No (promedia)', 'Estilo con el CVAE; z = 0 al inferir', 'Sí (muestrea)', 'Sí (flujo) o softmax (tokens)', 'Una política estocástica; no hace falta'],
            ['Error compuesto', 'Sí, de lleno', 'Mitigado (chunks)', 'Mitigado (secuencias, posición)', 'Mitigado (chunks, datos diversos)', 'No: entrena en sus propios estados'],
            ['Inferencias por segundo', 'f', R`f con ensamble; f/k sin`, 'f / T<sub>a</sub> × K pasos', 'f / k (chunks), modelo de 3–7B', 'f (una MLP chica)'],
            ['Lenguaje y generalización', 'No', 'No', 'No', 'Sí', 'No'],
            ['Supera al demostrador', 'No', 'No', 'No', 'No', 'Sí'],
          ] },
          { t: 'h3', text: 'Evaluación: tasa de éxito, ensayos y varianza' },
          { t: 'p', html: R`La métrica es la tasa de éxito en el robot, con la definición de éxito escrita antes de evaluar y, para tareas largas, por subtarea (ACT reporta Grasp → Pinch → Open acumulativo para Slide Ziploc en la Tabla I). Ejemplo con los números del paper: ACT evalúa cada tarea real con <b>25 ensayos y una semilla</b>. Con 22/25 = 88 %, el intervalo de Wilson del 95 % es ≈ [70 %, 96 %]; con 5/25 = 20 %, ≈ [9 %, 39 %]. Diferencias de 5–10 puntos entre métodos con 25 ensayos no significan nada; las de la Tabla I (Slide Ziploc: 88 % de éxito final contra 0 % de los cuatro baselines) sí. Las cuentas de cuántos ensayos hacen falta para separar 70 % de 80 % están en <a href="#pi0.entrevista">π0</a>.` },
          { t: 'list', items: [
            '<b>Condiciones iniciales fijas y compartidas</b> entre métodos (marcas en la mesa, una grilla de posiciones), intercaladas A/B para no sesgar por el desgaste o la luz del día; evaluador ciego si se puede.',
            '<b>Semillas</b>: con políticas de BC la varianza entre semillas de entrenamiento es grande; en simulación, ≥ 3 semillas (ACT: 3 semillas × 50 ensayos en sim; Diffusion Policy reporta el máximo y el promedio de los últimos 10 checkpoints, Tablas 1–2).',
            R`<b>Reportar más que el éxito</b>: tiempo por tarea, intervenciones y fallas inseguras, y una descripción cualitativa de cómo falla (${EVALP}).`,
            '<b>Simulación</b> (robomimic, LIBERO) para iterar; la decisión en el robot real.',
          ] },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Método', 'Qué cambia (una línea)', 'Dónde lo ves'], rows: [
            ['ALVINN (1988)', 'BC con una red de una capa oculta para manejar una camioneta desde una imagen de 30×32 (más un telémetro láser), entrenada con imágenes de ruta simuladas.', ALVINN],
            ['DAgger (2011) / HG-DAgger (2019)', 'Agregar etiquetas del experto en los estados de la política; la versión con humanos que intervienen.', R`${DAGGER}; ${HGD}`],
            ['BC-RNN / LSTM-GMM (2021)', 'BC con historia (LSTM) y una mezcla de gaussianas como cabeza; el baseline fuerte de robomimic.', ROBOMIMIC],
            ['IBC (2021)', 'Política implícita: un EBM E(o, a), acción = argmin; multimodal, pero entrenamiento inestable.', IBC],
            ['BeT (2022) / VQ-BeT (2024)', 'Acciones discretizadas (k-means + offset; VQ jerárquico) y un transformer GPT; VQ-BeT reporta ≈ 5× menos latencia que Diffusion Policy.', R`${BET}; ${VQBET}`],
            ['ACT (2023)', 'Chunks de 100 acciones con un transformer tipo DETR + CVAE; temporal ensembling; ALOHA.', 'Esta página'],
            ['Diffusion Policy (2023)', 'DDPM sobre secuencias de acciones; U-Net 1-D con FiLM o transformer; receding horizon.', 'Esta página'],
            ['Mobile ALOHA (2024)', 'ALOHA móvil + co-entrenamiento con datos estáticos.', MOBALOHA],
            ['Consistency Policy (2024)', 'Diffusion Policy destilada a pocos pasos para hardware chico.', CONSIST],
            ['ALOHA Unleashed (2024)', 'Mucha más data en ALOHA 2 + una política de difusión con transformer: tareas con deformables (atar cordones, colgar remeras).', UNLEASH],
            ['DPPO (2024)', 'Fine-tuning de una Diffusion Policy con policy gradient (PPO sobre la cadena de denoising).', DPPO],
            ['π0, OpenVLA-OFT, Octo (2024–25)', 'Chunks y modelos generativos de acciones encima de un VLM o un transformer generalista.', R`<a href="#pi0">π0</a>, <a href="#openvla">OpenVLA</a>`],
          ] },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: BeT, VQ-BeT e IBC en detalle. Lo que se pregunta: que existen tres familias para la multimodalidad (discretizar, energía, generativos) y por qué la difusión ganó (estable de entrenar, expresiva).</p>` },
          { t: 'h3', text: 'Referencias' },
          { t: 'list', items: [
            ALVINN + '.', RB10 + '.', DAGGER + '.', HGD + '.', ACTP + ' Código: tonyzhaozh/act.', DPP + ' Código: real-stanford/diffusion_policy.',
            IBC + '.', BET + '.', VQBET + '.', ROBOMIMIC + '.', MOBALOHA + '.', UNLEASH + '.', CONSIST + '.', SCALING + '.', EVALP + '.',
            DDIM + '.', FILM + '.', DIFFUSER + '.', LEVINE16 + '.', KINGMA + '.', SOHN + '.', DPPO + '.', HILSERL + '.', LEROBOT + '.',
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Imitation learning sale de tres formas: como fundamento ("¿por qué falla BC?"), como arquitectura ("explícame ACT / Diffusion Policy") y como diseño ("50 demos de pick-and-place en un Jetson"). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual. Las de VLAs (π0, OpenVLA) y la de interfaces de teleoperación están en sus páginas; la de covariate shift corta, en <a href="#rt2.entrevista">RT-2</a>.` },
          { t: 'followups', items: [
            { q: 'Why does behavior cloning suffer from compounding errors? State the bounds and when DAgger actually helps.',
              junior: 'Porque los errores se suman con el tiempo.',
              senior: R`BC minimiza la pérdida en d<sub>π*</sub>, la distribución de estados del experto, pero se ejecuta en d<sub>π̂</sub>. Un error lleva a un estado no visto, donde el error es mayor, y eso se realimenta. Ross y Bagnell (2010): si la pérdida 0-1 en d<sub>π*</sub> es ε y los costos por paso están en [0, 1], J(π̂) ≤ J(π*) + T²ε, y es ajustada. DAgger (2011): agrega etiquetas del experto en los estados que visita la política y entrena con todo lo acumulado; con N = Õ(uT) iteraciones, J(π̂) ≤ J(π*) + uTε<sub>N</sub> + O(1). Matices: ε<sub>N</sub> es la pérdida sobre los estados visitados, no el ε de BC; u acota cuánto empeora el costo restante tras un error, y solo si es O(1) (errores recuperables) la cota es lineal; y necesita un experto <b>consultable</b> en estados arbitrarios, que con humanos teleoperando es caro. Por eso en robots se usa HG-DAgger (intervenciones) y chunks, que reducen el número de decisiones encadenadas.`,
              say: 'Behavior cloning is trained on the expert\'s state distribution but runs on its own, so one mistake leads to unseen states where it makes more mistakes. With per-step error epsilon under the expert distribution the extra cost is bounded by T squared epsilon, and that bound is tight. DAgger queries the expert on the states the learner visits and aggregates the data, which gives u T epsilon, linear in the horizon, but only when mistakes are recoverable, and it needs an expert you can query on arbitrary states, which is why robotics uses human interventions instead.',
              why: 'Trampa: decir "DAgger es O(Tε)" sin el u ni el experto consultable. Se anota la distribución, las dos cotas con sus condiciones y la versión práctica.', trap: true },
            { q: 'Walk me through ACT.',
              junior: 'Es un transformer que predice acciones.',
              senior: R`Entradas: ${met('cams')} cámaras de 480×640 y las ${met('dof')} posiciones articulares. Cada cámara por una ResNet-18 (ImageNet, BN congelada) → 15×20×512 → conv 1×1 a 512 y aplanar: 300 tokens por cámara, 1,200 en total, más un token de estado y uno de z: 1,202 tokens con embeddings seno-coseno 2-D. Encoder de 4 capas, decoder de 7 con ${met('chunk')} queries que hacen cross-attention a la memoria (es DETR con acciones en vez de cajas). Una lineal da ${met('chunk')} × 14 posiciones objetivo absolutas del brazo líder, que sigue el PID de los motores. En entrenamiento, un CVAE encoder (4 capas, sin imágenes) resume la secuencia real en z de 32 dims; pérdida L1 + β·KL con β = 10; en inferencia z = 0. Se consulta a 50 Hz y se promedian las predicciones solapadas con w<sub>i</sub> = exp(−0.01·i). ≈ 80M parámetros, ≈ 5 h de entrenamiento en una 2080 Ti, 50 demos por tarea.`,
              say: 'ACT encodes four camera images with a ResNet-18 into twelve hundred tokens, adds a joint-state token and a latent style token, runs a DETR-style transformer encoder-decoder, and decodes a chunk of one hundred future joint-position targets in parallel from one hundred learned queries. During training a CVAE encoder compresses the ground-truth action sequence into the latent, with an L1 plus KL loss; at test time the latent is zero, and overlapping chunks are averaged with exponential weights.',
              why: 'Se anota: DETR como base, tokens con números, chunk en paralelo, CVAE y z = 0, L1, ensamble, posiciones absolutas.' },
            { q: 'Why does action chunking help, and what does it cost?',
              junior: 'Porque predice más acciones a la vez y es más rápido.',
              senior: R`Tres razones del paper: (1) reduce el <b>horizonte efectivo</b> k veces ("reduces the effective horizon of the task by k-fold", §I): una tarea de 500 pasos son 5 decisiones de 100, menos errores encadenados; (2) maneja <b>confusores temporales</b> como las pausas del operador, que una política de un paso no puede modelar (en este estado a veces se espera y a veces no); (3) un chunk es una trayectoria coherente. Ablación: el éxito promedio pasa de 1 % con k = 1 a 44 % con k = 100 y baja con k = 200–400, cuando ya es casi lazo abierto (Fig. 6a, sin ensamble). Costos: lazo abierto dentro del chunk (reacción), el final del chunk es menos preciso, y si consultas a la frecuencia de control para ensamblar, pagas una inferencia por paso. El argumento de horizonte es heurístico: el error por chunk puede ser mayor que el error por paso.`,
              say: 'It shrinks the effective horizon by a factor of k, so fewer decisions compound; it handles temporally correlated behavior like pauses that a single-step Markovian policy cannot represent; and each chunk is a coherent trajectory. In the ACT ablation success goes from one percent at k equal one to forty-four percent at one hundred, then drops when it becomes nearly open loop. The price is open-loop execution inside the chunk, or inference at the control rate if you ensemble.',
              why: 'Se anota: horizonte efectivo, pausas, la ablación con números y el costo en reacción.' },
            { q: 'Why does ACT need a CVAE if it sets z to zero at test time?',
              junior: 'Para generar acciones aleatorias.',
              senior: R`Para entrenar bien con demos humanas. Sin z, demostraciones que difieren en estilo (velocidad, altura, pausas) son ejemplos contradictorios para la misma observación: L1 aprende la mediana y el decoder queda "borroso". Con z, la reconstrucción puede ser casi exacta condicionada en el estilo, y el KL con β = 10 empuja la posterior hacia N(0, I) para que z = 0 sea un estilo típico y válido. Evidencia: con datos humanos, sin CVAE el éxito cae de 35.3 % a 2 %; con datos de script, deterministas, da igual (Fig. 6c). Riesgos: β chico → z memoriza la demo y z = 0 queda fuera de lo visto; β grande → posterior collapse, z se ignora. Y ojo: con z = 0 la política es determinista; maneja variabilidad de estilo, no dos modos discretos lejanos tan bien como la difusión.`,
              say: 'The CVAE is for training: human demonstrations vary in style, so without a latent the decoder regresses toward an average of inconsistent targets. The encoder explains each demo with its own latent, the KL keeps the latent close to a unit Gaussian, and at test time zero is a typical style. In the paper, removing it on human data drops success from thirty-five to two percent, while on scripted data it makes no difference.',
              why: 'Trampa: "el CVAE genera variedad en inferencia". Se anota: es para el entrenamiento, la ablación, β y posterior collapse.', trap: true },
            { q: 'How does temporal ensembling work in ACT, and when would you turn it off?',
              junior: 'Promedia los chunks, dando más peso a lo más nuevo.',
              senior: R`Se consulta la política en cada paso; para el paso t hay hasta k predicciones (una por chunk que lo cubre) y se promedian con w<sub>i</sub> = exp(−m·i), donde i = 0 es la <b>más vieja</b>; con m = 0.01 del repo los pesos casi son uniformes y lo viejo pesa algo más (≈ 2.7× entre la más vieja y la más nueva con 100). Gana suavidad: +3.3 % en la ablación del paper. Lo apago cuando: (1) no me alcanza el cómputo (ensamble = k× inferencias); (2) la tarea necesita reaccionar rápido (lo nuevo entra diluido); (3) la política es multimodal y dos chunks eligen modos distintos (el promedio es la media que quería evitar). π0 lo probó y empeoraba; con latencia asíncrona, real-time chunking es la alternativa.`,
              say: 'The policy is queried every step, so each timestep has up to k overlapping predictions, averaged with weights exp of minus m times i where i equals zero is the oldest prediction; with the default m of zero point zero one the weights are nearly uniform. It gives smoother motion, about three points in the ablation, but costs one inference per control step, dilutes reactions, and averages modes, so I would drop it for reactive or multimodal tasks or when compute is tight.',
              why: 'Trampa: "pesa más lo nuevo". Se anota: la fórmula con su orden, m = 0.01, el costo en inferencias y por qué π0 lo descartó.', trap: true },
            { q: 'Walk me through Diffusion Policy. What are T_o, T_p and T_a?',
              junior: 'Es Stable Diffusion para robots.',
              senior: R`Es DDPM con predicción de ε donde el "dato" es una secuencia de acciones A ∈ ℝ<sup>T<sub>p</sub>×d<sub>a</sub></sup> y la condición es la observación. Observación: T<sub>o</sub> = 2 pasos de imágenes (ResNet-18 por cámara, entrenada de cero, GroupNorm y spatial softmax) y estado, codificados una vez en un vector. Denoiser: una U-Net 1-D temporal con FiLM (la condición y el paso k modulan cada bloque); alternativa: un transformer con cross-attention a la observación, más sensible a hiperparámetros. Entrenamiento con 100 pasos y schedule square-cosine; inferencia con DDIM en 10–16 pasos. Receding horizon: predice T<sub>p</sub> = 16, ejecuta T<sub>a</sub> = 8 a 10 Hz y replanifica. Por qué funciona: muestrea modos (cada inferencia arranca de otro ruido), la secuencia es temporalmente coherente, el entrenamiento es estable (no hay constante de normalización como en IBC), y controla en posición. Reporta +46.9 % de éxito promedio sobre el estado del arte en 15 tareas de 4 benchmarks (versión extendida).`,
              say: 'Diffusion Policy is a DDPM with epsilon prediction whose sample is a sequence of sixteen future actions, conditioned on two frames of observation encoded by per-camera ResNet-18s with spatial softmax. A temporal 1D U-Net with FiLM conditioning predicts the noise; it trains with one hundred diffusion steps and samples with ten to sixteen DDIM steps, then executes eight actions and replans. It captures multimodality, commits to a mode within a sequence, trains stably, and works best with position control.',
              why: 'Se anota: DDPM sobre secuencias, encoder una vez, FiLM, DDIM, los tres horizontes con valores y las cuatro razones.' },
            { q: 'Why does Diffusion Policy prefer position control over velocity control?',
              junior: 'Porque la posición es más precisa.',
              senior: R`Dos razones del paper: (1) con acciones de posición la distribución es más <b>multimodal</b> (muchas trayectorias de posiciones distintas llevan al objetivo) y un modelo generativo la aprovecha; los baselines unimodales con posición rinden peor, por eso la práctica previa usaba velocidad; (2) la posición sufre menos <b>error compuesto</b>: un error en velocidad se integra y deriva; uno en posición se corrige en el siguiente objetivo. Además, la velocidad es más sensible a la latencia (§5.3). ACT llega a lo mismo por otro camino: deltas de articulaciones rinden peor que posiciones absolutas.`,
              say: 'Position commands make the action distribution more multimodal, which a diffusion model handles and a unimodal regressor does not, and they compound less error, because a velocity error integrates over time while a position error is corrected by the next target; velocity is also more sensitive to latency.',
              why: 'Se anota: multimodalidad, integración del error y latencia; la coincidencia con ACT.' },
            { q: 'Compare GMM heads, discretization, energy-based models and diffusion for multimodal actions.',
              junior: 'La difusión es la mejor.',
              senior: R`<b>GMM</b> (LSTM-GMM de robomimic): una red da K medias, varianzas y pesos; barato, una pasada; hay que elegir K, la NLL es inestable con varianzas chicas y en alta dimensión con secuencias no escala bien. <b>Discretización</b>: bins o clusters con un softmax (BeT con k-means + offset, VQ-BeT con VQ, tokens de RT-2/OpenVLA); el softmax es multimodal, la precisión la limitan los bins (el offset la recupera); rápido. <b>Energía</b> (IBC): E(o, a) y argmin; muy expresivo (discontinuidades), pero entrenar con negativos (InfoNCE) es inestable y la inferencia es una optimización. <b>Difusión / flujo</b>: aprende el score o la velocidad, sin constante de normalización; estable, expresivo en secuencias largas y alta dimensión; el costo es K pasos por inferencia. En Push-T con estado (métrica: cobertura del objetivo, mejor checkpoint), Diffusion Policy 0.95 contra IBC 0.90, BET 0.79 y LSTM-GMM 0.67 (Tabla 1). Elijo difusión por defecto; tokens si quiero un VLM o latencia mínima; GMM como baseline barato.`,
              say: 'Mixture density heads are cheap but need a chosen number of components and get unstable; discretization with a softmax is naturally multimodal and fast but limited by bins unless you add offsets; energy-based models are very expressive but need negative sampling and optimization at inference, which is unstable; diffusion learns the score without a normalizing constant, so it is stable and scales to long action sequences, at the cost of several network evaluations per inference.',
              why: 'Se anota una propiedad y un costo por familia, el número de Push-T con su tabla y un criterio de elección.' },
            { q: 'Design: build a pick-and-place policy from 50 demonstrations on a 6-DoF arm, deployed on a Jetson. Data, model, evaluation, latency.',
              junior: 'Grabo 50 demos y entreno ACT.',
              senior: R`<b>Datos</b>: leader–follower si puedo (posiciones articulares absolutas, la acción que la política va a mandar), a la frecuencia final (p. ej. 20–30 Hz para un 6-DoF), cámara de muñeca + una fija, estado y comando con el mismo reloj; un solo operador o una estrategia acordada; posiciones iniciales del objeto en una grilla que cubra lo que voy a evaluar, más 10–20 % de demos de recuperación; recorto pausas; separo 5–10 demos de validación por episodio. Antes de entrenar, reproduzco 2–3 demos a lazo abierto. <b>Modelo</b>: con una tarea y una instrucción, ACT o Diffusion Policy desde cero (horas de entrenamiento, decenas de Hz); ACT si quiero alta frecuencia y el ensamble me entra en el Jetson; Diffusion Policy si veo multimodalidad (dos formas de agarrar); un VLA ajustado (π0 con LoRA) solo si hay instrucciones variables, distractores u objetos nuevos, y su prefijo de 2B en el Jetson es el problema. Siempre un BC-MLP como piso. <b>Evaluación</b>: éxito binario + subtareas (agarre, transporte, colocación), ≥ 20–25 ensayos por checkpoint desde posiciones fijas y otras retenidas, intercalado entre políticas; intervalos de Wilson; elijo checkpoint por éxito, no por pérdida. <b>Latencia</b>: presupuesto primero: si controlo a 20 Hz con chunks y ejecuto 8, necesito una inferencia cada 0.4 s; con la cota del calculador para el Orin (${met('msOrin')} ms ACT, ${met('msOrin', DP)} ms DP) entra, pero mido p99 con la cadena completa; si no, TensorRT/FP16, menos pasos de DDIM o Consistency Policy, inferencia asíncrona. Seguridad: límites de velocidad y fuerza en el controlador, fuera de la red.`,
              say: 'I would collect with a leader-follower interface at the deployment rate, one consistent strategy, a grid of initial positions plus recovery demos, and replay a few open loop first. With one task I train ACT or Diffusion Policy from scratch, with a behavior-cloning MLP as a floor, and only fine-tune a VLA if instructions or objects vary. I select checkpoints by real success over twenty-plus interleaved trials with Wilson intervals, and size latency against the control budget on the Jetson, measuring p ninety-nine end to end, with TensorRT, fewer DDIM steps or distillation if needed, and safety limits in the low-level controller.',
              why: 'Se anota: interfaz → espacio de acción, cobertura de condiciones iniciales y recuperación, la elección por criterios (no por moda), evaluación con números y presupuesto de latencia antes que el modelo.' },
            { q: 'Your policy works when you replay the training episodes offline (low action error) but fails on the live robot. How do you debug it?',
              junior: 'Entreno más épocas.',
              senior: R`"Anda en replay" solo dice que la red ajusta las acciones en estados del demostrador: es exactamente lo que BC no garantiza en vivo. En orden: (1) <b>pipeline</b>: comparo, en vivo, la observación que entra a la red contra una de entrenamiento (normalización, orden de canales RGB/BGR, resolución y crop, cámaras intercambiadas, unidades de articulaciones, estadísticas de normalización de otro dataset); grabo un episodio en vivo y lo paso por el mismo cargador que el entrenamiento; (2) <b>tiempo</b>: latencia de cámara y de inferencia contra lo que el modelo asume; frecuencia de control distinta de la de grabación (el chunk dura otra cosa); acción mandada en el índice equivocado del chunk; (3) <b>espacio de acción</b>: absoluto vs delta, la pose medida vs el comando del líder, convención de la pinza; (4) <b>distribución</b>: si el pipeline está bien, es covariate shift: miro dónde diverge (la primera desviación) y desde qué estado; agrego demos de recuperación o intervenciones desde ahí; (5) <b>atajos</b>: si ignora la imagen (tapo una cámara y no cambia nada), el estado le da un atajo. Una prueba barata: ejecutar en vivo las acciones del dataset (replay a lazo abierto) para separar problemas del robot o del controlador de problemas de la política.`,
              say: 'Replay only shows the network fits actions on the demonstrator\'s states. I first diff the live observation pipeline against training, normalization, color order, crop, camera order and units, by logging a live episode through the training loader; then timing, latency and control rate versus recording rate and chunk indexing; then action conventions; and only then covariate shift, finding where the rollout first diverges and adding recovery data there. Open-loop replay of dataset actions on the robot separates controller issues from policy issues.',
              why: 'Trampa: "más épocas" o "más datos" antes de revisar el pipeline. Se anota el orden: datos/normalización, tiempo, espacio de acción, distribución, atajos, y la prueba de replay.', trap: true },
            { q: 'When would you add reinforcement learning on top of an imitation policy?',
              junior: 'Cuando la imitación no anda.',
              senior: R`Cuando la política de BC ya hace la tarea a medias y necesito lo que la imitación no da: (1) <b>superar al demostrador</b> en velocidad o precisión (inserciones con tolerancias de décimas de milímetro, donde el humano teleoperando no es consistente); (2) <b>robustez</b> en los estados de la propia política sin un experto que etiquete; (3) una <b>recompensa medible</b> (éxito binario con un detector, distancia a la meta) y un entorno donde ensayar: simulación fiel o el robot real con resets automáticos. Formas: RL residual (una política chica corrige la salida de BC), fine-tuning de la política con policy gradient (DPPO hace PPO sobre la cadena de denoising de una Diffusion Policy, ${DPPO}), o RL en el robot con intervenciones humanas y demos como prior (HIL-SERL reporta éxito casi perfecto en 1–2.5 h de entrenamiento por tarea, ${HILSERL}). La BC da el inicio y la exploración razonable; RL sin ella en manipulación con recompensa escasa casi no encuentra la primera recompensa. Lo que no hago: RL desde cero si tengo demos y no tengo simulador.`,
              say: 'When behavior cloning gets the task partially right and I need to exceed the demonstrator, be robust on the policy\'s own states, and I have a measurable reward plus somewhere to practice. I would use the imitation policy as initialization and exploration prior and add residual RL, policy-gradient fine-tuning of the diffusion chain, or human-in-the-loop RL on the real robot; pure RL from scratch with sparse manipulation rewards rarely finds the first success.',
              why: 'Se anota: cuándo (superar, robustez, recompensa), cómo (residual, fine-tuning, HIL) y por qué BC primero.' },
            { q: 'Diffusion Policy is too slow on your robot computer. What do you do?',
              junior: 'Compro una GPU más grande.',
              senior: R`Primero mido dónde va el tiempo (encoder vs U-Net × pasos vs preprocesado). Después, en orden de costo: (1) <b>DDIM con menos pasos</b> (100 → 10–16, como el paper; probar 8 y medir éxito); (2) <b>inferencia asíncrona</b>: con T<sub>a</sub> = 8 a 10 Hz tengo 0.8 s por inferencia si la calculo mientras ejecuto la anterior (alineando el inicio con la latencia); (3) <b>FP16 + TensorRT / CUDA graphs</b> para la U-Net (shapes fijas); (4) <b>destilación</b>: Consistency Policy a 1–3 pasos; (5) una U-Net más chica (el paper usa ≈ 67M en el robot real y 256M en simulación) o menos resolución; (6) cambiar de familia si la latencia es lo crítico: ACT (una pasada) o VQ-BeT (≈ 5× más rápido que DP en su paper). Lo que no hago: bajar a 1–2 pasos sin destilar (las muestras colapsan hacia la media).`,
              say: 'I profile first, then cut DDIM steps, run inference asynchronously so a whole action-execution window hides the latency, compile the U-Net in half precision with fixed shapes, and if that is not enough distill to a consistency policy or shrink the network, or switch to a single-pass model like ACT. I would not just drop to one or two undistilled steps, because samples collapse toward the mean.',
              why: 'Se anota: medir, DDIM, asíncrono con T_a, compilación, destilación, y la trampa de pocos pasos sin destilar.', trap: true },
            { q: 'CNN U-Net or transformer denoiser for Diffusion Policy?',
              junior: 'Transformer, porque es más moderno.',
              senior: R`El paper recomienda empezar por la <b>CNN</b>: funciona en la mayoría de las tareas con poco tuning, su sesgo de baja frecuencia en el tiempo da trayectorias suaves. El <b>transformer</b> (tokens de acciones ruidosas, cross-attention a la observación, máscara causal) es mejor cuando la acción cambia rápido (control de velocidad, cambios bruscos) porque la CNN suaviza de más, pero es más sensible a hiperparámetros. En Push-T con imágenes, la CNN da 0.91 de cobertura contra 0.78 del transformer (mejor checkpoint, Tabla 2; en esa fila la CNN condiciona por inpainting y no por FiLM, App. A). Con más datos y tareas más complejas (ALOHA Unleashed) se usan transformers.`,
              say: 'Start with the CNN U-Net: it works on most tasks with little tuning and its temporal smoothing gives smooth trajectories. Switch to the transformer when actions change sharply or the task is very complex, accepting more hyperparameter sensitivity.',
              why: 'Se anota: la recomendación del paper, el porqué (sesgo de suavidad) y el número de la tabla.' },
          ] },
          { t: 'qa', items: [
            { q: '¿Cuántos tokens ve el encoder de ACT y de dónde salen?', a: R`${met('tok')}: ${met('cams')} cámaras × (480/32)·(640/32) = 4 × 300 = 1,200 de imagen + 1 de articulaciones + 1 de z.` },
            { q: '¿Qué vale z en inferencia en ACT y por qué?', a: 'Cero, la media del prior: el KL entrenó la posterior hacia N(0, I), así que z = 0 es un estilo típico; la inferencia queda determinista.' },
            { q: '¿Cuál es la pérdida de reconstrucción de ACT?', a: 'L1 (no L2) sobre el chunk, + β·KL con β = 10.' },
            { q: 'T_o, T_p, T_a de Diffusion Policy (CNN)', a: '2, 16, 8: dos pasos de observación, 16 acciones predichas, 8 ejecutadas antes de replanificar.' },
            { q: '¿Cuántos pasos de difusión usa Diffusion Policy?', a: '100 de entrenamiento; en inferencia 100 en simulación (DDPM) y 10–16 con DDIM en el robot real.' },
            { q: '¿Qué cota de error da BC y cuál DAgger?', a: 'BC: T²ε (ajustada). DAgger: uTε_N + O(1), lineal si u = O(1) (errores recuperables).' },
          ] },
          { t: 'callout', kind: 'interview', title: 'Dilo así (en inglés)', html: R`<p><b>One-liner:</b> "Imitation learning is supervised learning on demonstrations; its two classic problems are compounding error from covariate shift and mode averaging on multimodal data."</p><p><b>ACT:</b> "A DETR-style transformer with a CVAE that predicts one-hundred-step action chunks, averaged with temporal ensembling."</p><p><b>Diffusion Policy:</b> "A DDPM over action sequences, conditioned with FiLM on visual features, executed with a receding horizon."</p>` },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero rellena el diagrama sin mirar; después las formas y los "¿qué pasa si…?"; luego tres ejercicios a mano (error compuesto, por qué la MSE elige el medio, los pesos del ensamble de ACT) y su código verificado.` },
          { t: 'h3', text: 'Diagrama en blanco: ACT' },
          { t: 'blankdiagram', diagram: 'act-overview', slots: [
            { node: 'backbone', ask: 'label', hint: 'extrae un mapa 15×20×512 por cámara' },
            { node: 'encoder', ask: 'label', hint: 'self-attention sobre imagen + estado + z' },
            { node: 'decoder', ask: 'label', hint: 'k queries, cross-attention a la memoria' },
            { node: 'ensemble', ask: 'label', hint: 'promedia las predicciones solapadas con pesos exp(−m·i)' },
            { node: 'tokens', tensor: TN.src, ask: 'shape' },
            { node: 'action-head', tensor: TN.act, ask: 'shape' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'imitation', pool: 'all', configs: [C, DP] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: 'ACT: pasas de 4 cámaras a 2. ¿Por qué factor cambian los tokens del encoder?', change: { cams: 2 }, ask: 'tokens',
              explain: 'Cada cámara aporta 300 tokens; los 2 de estado y z quedan: (600 + 2) / (1,200 + 2) ≈ ×0.5.' },
            { q: 'ACT: duplicas el chunk (k = 100 → 200). ¿Por qué factor cambian los MACs por inferencia?', change: { chunk: 200 }, ask: 'macsPerInference',
              explain: 'Casi ×1: las queries del decoder son pocas frente a la ResNet y a los 1,202 tokens del encoder.' },
            { q: 'ACT: duplicas el chunk (k = 100 → 200). ¿Qué pasa con las acciones por inferencia?', change: { chunk: 200 }, ask: 'actionsPerInference',
              explain: '×2: el decoder devuelve una acción por query.' },
            { q: 'ACT: pasas de 480×640 a 240×320. ¿Por qué factor cambian los tokens del encoder?', change: { res: 240 }, ask: 'tokens',
              explain: 'Cada mapa pasa de 15×20 a 8×10 (stride 32, redondeando hacia arriba): ≈ ×¼ en los tokens de imagen; los 2 extra quedan.' },
          ] },
          { t: 'whatif', config: DP, items: [
            { q: R`Diffusion Policy: subes los pasos de denoising de ${met('steps', DP)} a 100. ¿Por qué factor cambian los MACs por inferencia?`, change: { steps: 100 }, ask: 'macsPerInference',
              explain: 'Mucho menos que el cociente de pasos: la U-Net corre 100 veces, pero cada pasada es chica y la visión (≈ 79 % de los MACs con 8 pasos) se paga una vez. En latencia el efecto es mayor: cada paso relee los pesos de la U-Net.' },
            { q: 'Diffusion Policy: duplicas T_p (16 → 32). ¿Por qué factor cambian los MACs de una pasada de la U-Net?', change: { chunk: 32 }, ask: 'stepMacs',
              explain: '≈ ×2: las convoluciones 1-D son lineales en la longitud de la secuencia; el MLP de FiLM no depende de T_p.' },
          ] },

          { t: 'h3', text: 'A mano (1): el error compuesto' },
          { t: 'p', html: R`T = 100 pasos, ε = 0.01 por paso. Modelo de peor caso: tras el primer error, la política queda fuera de distribución y paga 1 por paso hasta el final. (a) Costo esperado exacto. (b) La cota T²ε. (c) Si cada error cuesta un paso y se recupera. (d) Con chunks de k = 10, si cada decisión (un chunk) falla con la misma ε y un fallo te deja perdido el resto del episodio.` },
          { t: 'calc', rows: [
            { label: '(a) BC exacto', expr: R`Σ_{t=1}^{T} [1 − (1 − ε)^t] = T − (1 − ε)(1 − (1 − ε)^T)/ε = 100 − 0.99·(1 − 0.366)/0.01`, value: '≈ 37.2 pasos', note: 'Aproximación εT(T + 1)/2 = 50.5 mientras εT ≪ 1' },
            { label: '(b) cota de Ross y Bagnell', expr: 'T²ε = 100²·0.01', value: '100', note: 'Es una cota superior, ajustada en el peor problema' },
            { label: '(c) errores recuperables', expr: 'T·ε = 100·0.01', value: '1 paso', note: 'Lo que garantiza DAgger con u = 1' },
            { label: '(d) chunks k = 10', expr: R`k·[D − (1 − ε)(1 − (1 − ε)^D)/ε], D = T/k = 10`, value: '≈ 5.3 pasos', note: 'Heurístico: supone el mismo ε por chunk que por paso' },
          ] },
          { t: 'h3', text: 'A mano (2): por qué la MSE elige el medio' },
          { t: 'calc', rows: [
            { label: 'MSE en c, modos ±1 al 50 %', expr: '½(c + 1)² + ½(c − 1)² = c² + 1', value: 'mín. en c = 0', note: 'La media: el obstáculo' },
            { label: 'MSE en el medio vs en un modo', expr: 'c = 0: 1;  c = −1: ½·0 + ½·4', value: '1 vs 2', note: 'La MSE prefiere la acción inválida' },
            { label: 'Con 70 % / 30 %', expr: '0.7·(c + 1)² + 0.3·(c − 1)² → c* = E[a]', value: 'c* = −0.4', note: 'Sigue en el medio' },
            { label: 'L1 con 70 % / 30 %', expr: 'mediana', value: 'c* = −1', note: 'Con 50/50, cualquier c ∈ [−1, 1] es óptimo' },
          ] },
          { t: 'h3', text: 'A mano (3): los pesos del ensamble de ACT' },
          { t: 'calc', rows: [
            { label: 'm = 0.5, tres predicciones para a_t', expr: 'w = e^{0}, e^{−0.5}, e^{−1} = 1, 0.6065, 0.3679; suma 1.9744', value: '0.506, 0.307, 0.186', note: 'Normalizados; la más vieja primero' },
            { label: 'a_t con predicciones 0.30, 0.36, 0.42 rad', expr: '(1·0.30 + 0.6065·0.36 + 0.3679·0.42) / 1.9744', value: '≈ 0.341 rad', note: 'Más cerca de lo viejo (0.30) que de lo nuevo (0.42)' },
            { label: 'm = 0.01, 100 predicciones (repo)', expr: 'Σ e^{−0.01 i} = (1 − e^{−1})/(1 − e^{−0.01}) ≈ 63.5', value: '1.57 % vs 0.59 %', note: 'Más vieja vs más nueva: casi uniforme' },
          ] },

          { t: 'h3', text: 'Escríbelo: los tres ejercicios en código' },
          { t: 'code', title: 'Soluciones de referencia (NumPy / PyTorch)', files: [
            { name: 'compounding.py', lang: 'python', code: [
              'import numpy as np',
              '',
              'def bc_exact(T, eps):          # error absorbente: después del primer error, costo 1 en cada paso restante',
              '    q = 1 - eps',
              '    return T - q * (1 - q ** T) / eps',
              '',
              'def simulate(T, eps, k=1, recover=False, n=200_000, seed=0):',
              '    """Cada decisión (un chunk de k pasos) falla con prob. eps. BC: tras un fallo paga 1 por paso hasta el final.',
              '    recover=True (DAgger con u = O(1)): un fallo cuesta los k pasos de ese chunk y vuelve."""',
              '    rng = np.random.default_rng(seed)',
              '    D = T // k',
              '    fails = rng.random((n, D)) < eps',
              '    if recover:',
              '        return (fails.sum(1) * k).mean()',
              '    first = np.where(fails.any(1), fails.argmax(1), D)   # primera decisión fallida',
              '    return ((D - first) * k).mean()',
              '',
              'T, eps = 100, 0.01',
              'print(round(bc_exact(T, eps), 2), T * T * eps)                     # 37.24  100.0',
              'print(round(simulate(T, eps), 2), round(simulate(T, eps, recover=True), 2))   # ≈ 37.2  ≈ 1.0',
              'print(round(simulate(T, eps, k=10), 2), round(10 * bc_exact(10, eps), 2))     # ≈ 5.3  5.34',
              'for T in (50, 100, 200, 400):',
              '    print(T, round(bc_exact(T, eps), 1), T * eps)                  # 10.9/0.5, 37.2/1, 114.3/2, 302.8/4',
              'assert abs(simulate(100, eps) - bc_exact(100, eps)) < 0.3',
              'print("ok")',
            ].join('\n'), note: 'NumPy, sin descargas, &lt; 5 s. Con T = 400 el costo de BC (302.8) ya se satura hacia T: el régimen εT² vale mientras εT ≪ 1.' },
            { name: 'modes.py', lang: 'python', code: [
              'import math',
              'import torch',
              'import torch.nn as nn',
              '',
              'torch.manual_seed(0)',
              'def data(n):                      # o = 1: obstáculo, a ∈ {−1, +1} al 50 %; o = 0: a = 0',
              '    o = (torch.rand(n) < 0.5).float()',
              '    side = torch.where(torch.rand(n) < 0.5, -1.0, 1.0)',
              '    a = o * side + 0.05 * torch.randn(n)',
              '    return o[:, None], a[:, None]',
              '',
              'mlp = lambda out: nn.Sequential(nn.Linear(1, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, out))',
              'reg_mse, reg_l1, gmm = mlp(1), mlp(1), mlp(3 * 2)    # GMM con K = 2: logits, medias, log-sigmas',
              'opt = torch.optim.Adam([*reg_mse.parameters(), *reg_l1.parameters(), *gmm.parameters()], lr=3e-3)',
              '',
              'def gmm_nll(out, a):              # −log Σ_k π_k N(a; μ_k, σ_k²)',
              '    logit, mu, logs = out.chunk(3, -1)',
              '    logp = -0.5 * ((a - mu) / logs.exp()) ** 2 - logs - 0.5 * math.log(2 * math.pi)',
              '    return -(torch.log_softmax(logit, -1) + logp).logsumexp(-1).mean()',
              '',
              'for it in range(3000):',
              '    o, a = data(512)',
              '    loss = ((reg_mse(o) - a) ** 2).mean() + (reg_l1(o) - a).abs().mean() + gmm_nll(gmm(o), a)',
              '    opt.zero_grad(); loss.backward(); opt.step()',
              '',
              'o1 = torch.ones(4000, 1)',
              'with torch.no_grad():',
              '    print("MSE:", round(reg_mse(o1).mean().item(), 3))          # ≈ 0: la media, el obstáculo',
              '    print("L1:", round(reg_l1(o1).mean().item(), 3))           # cualquier punto de [−1, 1]; aquí ≈ 0',
              '    logit, mu, logs = gmm(o1[:1]).chunk(3, -1)',
              '    print("GMM:", torch.softmax(logit, -1).numpy().round(2), mu.numpy().round(2))   # pesos ≈ 0.5, medias ≈ ±1',
              '    k = torch.distributions.Categorical(logits=gmm(o1)[:, :2]).sample()',
              '    m = gmm(o1)[:, 2:4].gather(1, k[:, None])                     # media del componente sorteado',
              'assert abs(reg_mse(o1).mean()) < 0.1 and (m.abs() > 0.5).float().mean() > 0.99',
              'print("ok")',
            ].join('\n'), note: 'PyTorch en CPU, ≈ 10 s. Salida en nuestra corrida: MSE 0.0; L1 −0.003; GMM pesos [0.49, 0.51], medias [1.01, −1.0], σ ≈ 0.05; 100 % de las muestras con |a| > 0.5, 52.8 % a la izquierda.' },
            { name: 'temporal_ensemble.py', lang: 'python', code: [
              'import numpy as np',
              '',
              '# A mano: m = 0.5, tres predicciones para a_t; w_0 = la más vieja',
              'm, preds = 0.5, np.array([0.30, 0.36, 0.42])',
              'w = np.exp(-m * np.arange(3))',
              'print((w / w.sum()).round(3), ((w * preds).sum() / w.sum()).round(4))   # [0.506 0.307 0.186] 0.3408',
              '',
              '# El buffer de imitate_episodes.py (ACT), transcrito: all_time_actions[t, t:t+k] = chunk pedido en t',
              'T, k, d = 6, 3, 1',
              'rng = np.random.default_rng(0)',
              'buf = np.zeros((T, T + k, d))',
              'for t in range(T):',
              '    chunk = rng.normal(size=(k, d)) + 1.0          # el repo marca "vacío" con 0 exacto',
              '    buf[t, t:t + k] = chunk',
              '    col = buf[:, t]',
              '    col = col[np.all(col != 0, axis=1)]            # predicciones para el paso t, de la más vieja a la más nueva',
              '    ww = np.exp(-0.01 * np.arange(len(col)))',
              '    a_t = (col * (ww / ww.sum())[:, None]).sum(0)',
              '    print(t, len(col), a_t.round(3))               # 1, 2, 3, 3, 3, 3 predicciones',
              '',
              'w = np.exp(-0.01 * np.arange(100)); wn = w / w.sum()',
              'print(w.sum().round(2), wn[0].round(4), wn[-1].round(4))           # 63.53 0.0157 0.0058',
            ].join('\n'), note: 'Sin descargas. Detalle del repo: una acción que valga exactamente 0 se trata como "vacía" (np.all(col != 0)); con datos reales normalizados casi nunca pasa.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: 'Tu ACT se mueve bien pero frena y duda a mitad de la tarea, siempre en el mismo punto. ¿Qué miras?', a: 'Las demos en ese punto: pausas del operador (la política aprende a esperar) o dos estrategias distintas (cambio de modo entre chunks). Recorta pausas, unifica la estrategia, y mira si sin ensamble el problema cambia.' },
            { q: 'Bajaste β de 10 a 0.1 en ACT y la pérdida de entrenamiento bajó mucho, pero en el robot anda peor. ¿Por qué?', a: 'z pasó a codificar la demo entera (casi sin KL): la reconstrucción es fácil con z de la demo real, pero en inferencia z = 0 cae fuera de lo que el decoder vio. La pérdida de entrenamiento con el encoder de la demo no mide eso.' },
            { q: 'Diffusion Policy con 2 pasos de DDIM sin destilar: ¿qué esperas ver?', a: 'Trayectorias "promedio" y borrosas, menos comprometidas con un modo, y peor éxito en tareas multimodales. Para pocos pasos, destilar (Consistency Policy).' },
            { q: 'ACT a 50 Hz con ensamble no entra en tu Jetson (tarda 35 ms). ¿Opciones sin reentrenar?', a: R`Apagar el ensamble y ejecutar el chunk (o la mitad) por inferencia: ${met('chunk')}× menos inferencias; o ensamblar con una consulta cada 2–4 pasos; FP16 + TensorRT; menos cámaras no (el modelo se entrenó con 4).` },
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página. Lo que sigue: <a href="#pi0">π0</a> (chunks con flow matching encima de un VLM) y <a href="#rl-ppo">RL / PPO</a>, la otra forma de conseguir una política.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'imitation-01', kind: 'concepto', q: 'Behavior cloning en una frase.', a: 'Aprendizaje supervisado sobre pares (observación, acción del demostrador), minimizando la pérdida en la distribución de estados del demostrador.' },
      { id: 'imitation-02', kind: 'formula', q: 'Cota de BC de Ross y Bagnell: enunciado y supuestos.', a: 'J(π̂) ≤ J(π*) + T²ε, con ε = pérdida 0-1 (o una cota) en la distribución del experto y costos por paso en [0, 1]. Es ajustada.' },
      { id: 'imitation-03', kind: 'trampa', q: '"DAgger es O(Tε), siempre."', a: 'uTε_N + O(1): lineal solo si u = O(1) (errores recuperables), ε_N se mide en los estados visitados y hace falta un experto consultable en cualquier estado.' },
      { id: 'imitation-04', kind: 'concepto', q: 'Los pasos de DAgger.', a: 'Ejecutar la mezcla β_i·π* + (1 − β_i)·π̂_i, que el experto etiquete los estados visitados, agregar al dataset (D ← D ∪ D_i) y reentrenar. En la práctica β_i = 𝟙(i = 1).' },
      { id: 'imitation-05', kind: 'concepto', q: 'HG-DAgger.', a: 'La versión práctica con humanos: la política maneja, el humano interviene cuando va mal, y solo los segmentos corregidos vuelven al dataset.' },
      { id: 'imitation-06', kind: 'conteo', q: 'Toy: T = 100, ε = 1 %, error absorbente. Costo esperado de BC vs con errores recuperables.', a: '≈ 37.2 pasos contra T·ε = 1. La cota T²ε da 100.' },
      { id: 'imitation-07', kind: 'formula', q: 'Costo esperado exacto del toy de error absorbente.', a: 'Σ_{t=1}^T [1 − (1 − ε)^t] = T − (1 − ε)(1 − (1 − ε)^T)/ε ≈ εT²/2 si εT ≪ 1.' },
      { id: 'imitation-08', kind: 'concepto', q: '¿Por qué la MSE falla con demos multimodales?', a: 'Su óptimo es E[a | o]: con modos ±1 al 50 %, c = 0. Y la MSE en el medio (1) es menor que en un modo válido (2): prefiere la acción inválida.' },
      { id: 'imitation-09', kind: 'trampa', q: '"L1 resuelve la multimodalidad."', a: 'L1 da la mediana: elige el modo mayoritario si está desbalanceado, pero con 50/50 cualquier punto entre los modos es óptimo. ACT usa L1 por precisión; la multimodalidad la maneja el CVAE.' },
      { id: 'imitation-10', kind: 'tradeoff', q: 'Cuatro familias para acciones multimodales y su costo.', a: 'GMM (elegir K, NLL inestable), discretización (bins/clusters, precisión), energía/IBC (negativos, inferencia por optimización), difusión (K pasos por inferencia).' },
      { id: 'imitation-11', kind: 'forma', q: 'Tokens del encoder de ACT a 480×640 con 4 cámaras.', a: '4 × 15 × 20 = 1,200 de imagen (ResNet-18, stride 32) + 1 de articulaciones + 1 de z = 1,202 × 512.' },
      { id: 'imitation-12', kind: 'forma', q: 'Salida de ACT por inferencia.', a: 'k × 14 = 100 × 14 posiciones articulares objetivo absolutas de los dos brazos (2 s a 50 Hz).' },
      { id: 'imitation-13', kind: 'concepto', q: 'ACT vs DETR.', a: 'Mismo encoder-decoder con queries (el código es el de DETR): 100 object queries → 100 cajas; 100 action queries → 100 acciones futuras, en paralelo.' },
      { id: 'imitation-14', kind: 'concepto', q: 'Qué recibe el CVAE encoder de ACT.', a: '[CLS, articulaciones, las k acciones reales]; sin imágenes ("for faster training"). Del CLS sale μ, log σ² de un z de 32 dims.' },
      { id: 'imitation-15', kind: 'formula', q: 'Pérdida de ACT.', a: 'L1 sobre el chunk (sin relleno) + β·KL(N(μ, σ²) ‖ N(0, I)), β = 10.' },
      { id: 'imitation-16', kind: 'trampa', q: '"ACT muestrea z en inferencia para variar."', a: 'No: z = 0, la media del prior; la inferencia es determinista. El CVAE sirve para entrenar con demos de estilos distintos.' },
      { id: 'imitation-17', kind: 'conteo', q: 'Ablación del CVAE en ACT.', a: 'Con datos humanos, sin CVAE el éxito cae de 35.3 % a 2 %; con datos de script, casi no cambia (Fig. 6c).' },
      { id: 'imitation-18', kind: 'conteo', q: 'Ablación del tamaño de chunk en ACT.', a: 'Éxito promedio de 1 % con k = 1 a 44 % con k = 100; baja con k = 200–400 (casi lazo abierto). Sin ensamble (Fig. 6a).' },
      { id: 'imitation-19', kind: 'formula', q: 'Temporal ensembling de ACT.', a: 'a_t = Σ w_i·pred_i / Σ w_i, w_i = exp(−m·i), i = 0 la predicción más vieja; m = 0.01 en el repo.' },
      { id: 'imitation-20', kind: 'trampa', q: '"El ensamble de ACT pesa más las predicciones nuevas."', a: 'Al revés: w_0 = 1 es la más vieja. Con m = 0.01 y 100 predicciones, 1.57 % la más vieja y 0.59 % la más nueva.' },
      { id: 'imitation-21', kind: 'tradeoff', q: 'Costo del temporal ensembling.', a: 'Una inferencia por paso de control (k× más que sin ensamble), reacción diluida y promedio de modos. +3.3 % en ACT; π0 lo descartó.' },
      { id: 'imitation-22', kind: 'trampa', q: 'Decoder de ACT: ¿cuántas capas afectan la salida en el código oficial?', a: 'Una: ACT toma el índice [0] de las salidas intermedias del decoder de 7 capas. Las otras 6 se ejecutan sin efecto; LeRobot usa 1 capa por eso.' },
      { id: 'imitation-23', kind: 'concepto', q: '¿Qué acción graba ALOHA y por qué?', a: 'La posición articular del brazo líder: la diferencia con el seguidor, vía el PID, define la fuerza aplicada. Absoluta, no delta (los deltas rindieron peor).' },
      { id: 'imitation-24', kind: 'conteo', q: 'Receta de ACT (datos y cómputo).', a: '50 demos por tarea (10–20 min), ≈ 80M parámetros, ≈ 5 h en una RTX 2080 Ti, ≈ 0.01 s por inferencia, lr 1e-5, batch 8.' },
      { id: 'imitation-25', kind: 'concepto', q: 'T_o, T_p, T_a de Diffusion Policy.', a: 'Pasos de observación (2), acciones predichas (16) y ejecutadas antes de replanificar (8): receding horizon.' },
      { id: 'imitation-26', kind: 'formula', q: 'Pérdida de Diffusion Policy.', a: 'MSE entre ε y ε_θ(√ᾱ_k·A⁰ + √(1 − ᾱ_k)·ε, k, O_t): DDPM con predicción de ε sobre la secuencia de acciones.' },
      { id: 'imitation-27', kind: 'concepto', q: 'Cómo entra la observación en la U-Net de Diffusion Policy.', a: 'Por FiLM en cada bloque residual: un MLP sobre [embedding de k ; features de observación] da escala y sesgo por canal. La observación se codifica una vez por inferencia.' },
      { id: 'imitation-28', kind: 'concepto', q: 'Encoder de visión de Diffusion Policy: dos cambios a la ResNet-18.', a: 'GroupNorm en vez de BatchNorm (por el EMA) y spatial softmax en vez de global average pooling (coordenadas esperadas por canal). Una por cámara, desde cero.' },
      { id: 'imitation-29', kind: 'concepto', q: 'Posición vs velocidad en Diffusion Policy.', a: 'Posición rinde mejor: más multimodal (y DP lo maneja), menos error compuesto (la velocidad integra el error) y menos sensible a la latencia.' },
      { id: 'imitation-30', kind: 'conteo', q: 'Pasos de difusión de Diffusion Policy.', a: '100 en entrenamiento (square cosine); en inferencia DDIM con 10 (≈ 0.1 s en una RTX 3080, §3.4) o 16 en las tablas del robot real.' },
      { id: 'imitation-31', kind: 'tradeoff', q: 'U-Net CNN vs transformer en Diffusion Policy.', a: 'CNN por defecto: poco tuning, trayectorias suaves. Transformer para cambios bruscos de acción, más sensible a hiperparámetros. Push-T con imágenes: 0.91 vs 0.78 de cobertura (Tabla 2).' },
      { id: 'imitation-32', kind: 'concepto', q: '¿Por qué Diffusion Policy entrena más estable que IBC?', a: 'IBC necesita negativos para estimar una constante de normalización intratable (InfoNCE); la difusión aprende el score, que no depende de ella.' },
      { id: 'imitation-33', kind: 'concepto', q: '¿Qué escala en datos de imitation learning para generalizar?', a: 'La diversidad de entornos y objetos (ley de potencias), no las demos por entorno, que tienen rendimientos decrecientes (Lin et al., 2024).' },
      { id: 'imitation-34', kind: 'conteo', q: 'ACT evaluó cada tarea real con 25 ensayos. Intervalo de Wilson (95 %) para 22/25.', a: '≈ [70 %, 96 %]: diferencias de 5–10 puntos con 25 ensayos no significan nada.' },
      { id: 'imitation-35', kind: 'trampa', q: '"Anda en replay offline, así que la política está bien."', a: 'Replay mide estados del demostrador; en vivo la política visita los suyos. Revisar primero pipeline (normalización, crop, cámaras), tiempo y convenciones de acción.' },
      { id: 'imitation-36', kind: 'tradeoff', q: '¿Cuándo agregar RL sobre una política de BC?', a: 'Para superar al demostrador o ganar robustez en los propios estados, si hay recompensa medible y dónde practicar. BC como inicio y prior de exploración (residual, DPPO, HIL-SERL).' },
      { id: 'imitation-37', kind: 'concepto', q: 'Augmentación estándar en Diffusion Policy / robomimic.', a: 'Crop aleatorio (≈ 90 % del lado) en entrenamiento y crop central en evaluación. Nada de flips sin voltear la acción.' },
      { id: 'imitation-38', kind: 'concepto', q: 'ALVINN.', a: 'Pomerleau (NIPS 1988): BC con una red de una capa oculta para manejar desde una imagen de 30×32; el primer ejemplo de BC con redes.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'covariate shift (compounding error)', es: 'cambio de distribución (error compuesto)', def: 'La política se entrena en los estados del demostrador y se ejecuta en los suyos; cada error la lleva a estados nuevos donde se equivoca más.', say: 'Behavior cloning suffers from covariate shift, so errors compound with the horizon.' },
      { en: 'DAgger (Dataset Aggregation)', es: 'agregación de datos', def: 'Ejecutar la política, que el experto etiquete los estados visitados, agregar y reentrenar; costo lineal en T si los errores son recuperables.', say: 'DAgger labels the states the learner actually visits.' },
      { en: 'conditional VAE (CVAE)', es: 'VAE condicional', def: 'VAE cuyo encoder y decoder están condicionados en la observación; en ACT, z resume el estilo de la demo y en inferencia vale 0.', say: 'ACT trains its decoder as a conditional VAE and sets the latent to zero at test time.' },
      { en: 'receding horizon (T_o, T_p, T_a)', es: 'horizonte deslizante', def: 'Predecir T_p acciones desde T_o observaciones, ejecutar T_a y replanificar.', say: 'Diffusion Policy predicts sixteen steps and executes eight before replanning.' },
      { en: 'spatial softmax', es: 'softmax espacial', def: 'Pooling que convierte cada canal de un mapa de features en la coordenada esperada (x, y) de su activación.', say: 'Spatial softmax turns feature maps into keypoint coordinates.' },
      { en: 'mode averaging', es: 'promedio de modos', def: 'Una regresión MSE sobre demos multimodales devuelve la media de los modos, que puede ser una acción inválida.', say: 'An L2 regressor averages the two ways around the obstacle and drives into it.' },
      { en: 'leader–follower teleoperation', es: 'teleoperación líder–seguidor', def: 'El operador mueve un brazo líder con la misma cinemática y el seguidor copia sus articulaciones (ALOHA, GELLO).', say: 'Leader-follower teleoperation records joint-space actions directly.' },
      { en: 'implicit behavior cloning (IBC)', es: 'behavior cloning implícito', def: 'La política es un modelo de energía E(o, a) y la acción, su argmin; multimodal pero de entrenamiento inestable.', say: 'Implicit BC learns an energy and optimizes over actions at inference.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
