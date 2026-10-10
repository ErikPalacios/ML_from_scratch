/* =============================================================================
   Atlas de Arquitecturas — js/content/rl-ppo.js
   Página de modelo: RL para robótica — policy gradient, actor-critic, GAE, TRPO → PPO, simulación masiva y sim-to-real.
   Canónica ppo-mujoco (PPO en MuJoCo como en el paper: HalfCheetah, obs 17 → acción 6, política y crítico MLP 64-64 tanh
   separados, gaussiana con log-std independiente del estado, horizonte 2048, 10 épocas, minibatch 64, γ 0.99, λ 0.95,
   ε 0.2, Adam 3e-4; Tabla 3 y §6.1 de Schulman et al. 2017). Configs: ppo-atari (Tabla 5: Nature-CNN compartida, 8 actores
   × 128 pasos, 3 épocas, minibatch 32 × 8, ε 0.1·α) y ppo-anymal-isaac (legged_gym / rsl_rl 1.0.2: 4,096 robots × 24 pasos,
   MLP 512-256-128 ELU en actor y crítico, 5 épocas, 4 minibatches, LR adaptativo con KL objetivo 0.01).
   Plantilla fija de 11 secciones (SPEC §5.3, §27.1). Tesis de la fase (SPEC §27): dos maneras de obtener la política de un
   robot; esta es la de la recompensa (ensayo y error); la de las demostraciones vive en #imitation. PPO para LLMs (RLHF) vive
   en #rlhf-dpo: aquí se enlaza, no se repite.
   Papers: Williams, REINFORCE, Machine Learning 8, 1992; Sutton et al., NIPS 1999; Schulman et al., TRPO, ICML 2015
   (arXiv:1502.05477); Schulman et al., GAE, ICLR 2016 (arXiv:1506.02438); Schulman et al., PPO, arXiv:1707.06347 (2017);
   Engstrom et al., ICLR 2020 (arXiv:2005.12729); Huang et al., The 37 Implementation Details of PPO, ICLR Blog Track 2022;
   Andrychowicz et al., ICLR 2021 (arXiv:2006.05990); Rudin et al., CoRL 2021 (arXiv:2109.11978); Makoviychuk et al.,
   Isaac Gym, NeurIPS 2021 Datasets and Benchmarks (arXiv:2108.10470); Tobin et al., IROS 2017 (arXiv:1703.06907);
   Peng et al., ICRA 2018 (arXiv:1710.06537); Hwangbo et al., Science Robotics 2019 (arXiv:1901.08652); Haarnoja et al.,
   SAC, ICML 2018 (arXiv:1801.01290).
   Verificado contra el texto de los papers (PPO Tablas 1, 3, 5 y §3–6; GAE §3 ec. 16–18 y §6; Rudin et al. §2–4 y Tabla 3
   del apéndice; Engstrom et al. §3 y Tabla 2; Andrychowicz et al. §3) y contra el código: CleanRL
   (ppo_continuous_action.py), rsl_rl 1.0.2 (algorithms/ppo.py) y legged_gym (legged_robot_config.py,
   anymal_c_rough_config.py). Los ejercicios a mano se verificaron con NumPy / PyTorch (scratchpad build15/rl/ex: check_ex.py,
   check_ppo_code.py).
   Regla: ningún número de la arquitectura ni del costo (parámetros, MACs, muestras y pasos de gradiente por update, bytes
   del rollout) se escribe a mano: sale del calculador (js/arch/robotlearn.js, modelo rl-ppo; bloques op/trace/params/
   scaling/compare y cantidades {{config.ruta}}, SPEC §6.6). Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/robotlearn.js, SPEC §27.1).
  const C = 'ppo-mujoco';          // canónica: PPO paper, MuJoCo HalfCheetah, MLP 64-64 tanh separados
  const AT = 'ppo-atari';          // PPO paper Tabla 5: Nature-CNN compartida, 8 actores × 128 pasos
  const AN = 'ppo-anymal-isaac';   // legged_gym / rsl_rl: 4,096 robots × 24 pasos, MLP 512-256-128 ELU

  // Claves de metrics() del calculador (arch-ids.md de la fase 15). Un solo lugar para adaptarlas.
  const MK = {
    actorParams: 'actorParams', criticParams: 'criticParams', actorMacs: 'actorMacs', criticMacs: 'criticMacs',
    stepMacs: 'stepMacs', samples: 'samplesPerUpdate', mb: 'minibatchSize', grad: 'gradStepsPerUpdate',
    reuse: 'sampleReuse', updMacs: 'updateMacs', rollMacs: 'rolloutMacs', buf: 'rolloutBufferBytes', updates: 'iterations',
    budget: 'budgetSteps', obs: 'obsDim', act: 'actDim', gamma: 'gamma', lam: 'lambda', eps: 'clipEps', lr: 'lr',
    hz: 'controlHz', sps: 'stepsPerSecondCited', train3: 'trainToForward',
  };
  // Knobs de la config (cfg.*).
  const CF = { nEnvs: 'nEnvs', horizon: 'horizon', epochs: 'epochs', minibatches: 'minibatches', hidden: 'hidden' };
  // Ids de tensores del calculador (arch-ids.md, fase 15).
  const T = { obs: 'obs', mean: 'act-mean', std: 'act-std', act: 'action', logp: 'logp', val: 'value', rew: 'reward',
    roll: 'rollout', adv: 'advantages', ret: 'returns', mbAdv: 'mb-adv', mbRet: 'mb-ret', lclip: 'loss-clip',
    lv: 'loss-value', lent: 'loss-entropy', loss: 'loss' };

  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  // nEnvs, horizon, epochs y minibatches también son métricas (formato con separador de miles: 4,096, 2,048).
  const CF_AS_METRIC = { nEnvs: 1, horizon: 1, epochs: 1, minibatches: 1 };
  const cf = (k, cfg) => qn((CF_AS_METRIC[k] ? 'metrics.' : 'cfg.') + (CF[k] || k), cfg);

  const WIL = 'Williams, <i>Simple Statistical Gradient-Following Algorithms for Connectionist Reinforcement Learning</i> (REINFORCE), Machine Learning 8:229–256, 1992';
  const SUT = 'Sutton, McAllester, Singh y Mansour, <i>Policy Gradient Methods for Reinforcement Learning with Function Approximation</i>, NIPS 1999';
  const SB = 'Sutton y Barto, <i>Reinforcement Learning: An Introduction</i>, 2.ª ed., MIT Press, 2018';
  const KL02 = 'Kakade y Langford, <i>Approximately Optimal Approximate Reinforcement Learning</i> (conservative policy iteration), ICML 2002';
  const TRPO = 'Schulman et al., <i>Trust Region Policy Optimization</i>, ICML 2015, arXiv:1502.05477';
  const GAE = 'Schulman et al., <i>High-Dimensional Continuous Control Using Generalized Advantage Estimation</i>, ICLR 2016, arXiv:1506.02438';
  const PPO = 'Schulman et al., <i>Proximal Policy Optimization Algorithms</i>, arXiv:1707.06347 (2017)';
  const A3C = 'Mnih et al., <i>Asynchronous Methods for Deep Reinforcement Learning</i> (A3C), ICML 2016, arXiv:1602.01783';
  const DQN = 'Mnih et al., <i>Human-level control through deep reinforcement learning</i> (DQN), Nature 518, 2015';
  const ENG = 'Engstrom et al., <i>Implementation Matters in Deep Policy Gradients: A Case Study on PPO and TRPO</i>, ICLR 2020, arXiv:2005.12729';
  const D37 = 'Huang et al., <i>The 37 Implementation Details of Proximal Policy Optimization</i>, ICLR Blog Track 2022';
  const AND = 'Andrychowicz et al., <i>What Matters In On-Policy Reinforcement Learning? A Large-Scale Empirical Study</i>, ICLR 2021, arXiv:2006.05990';
  const HEND = 'Henderson et al., <i>Deep Reinforcement Learning that Matters</i>, AAAI 2018, arXiv:1709.06560';
  const PARDO = 'Pardo et al., <i>Time Limits in Reinforcement Learning</i>, ICML 2018, arXiv:1712.00378';
  const RUDIN = 'Rudin, Hoeller, Reist y Hutter, <i>Learning to Walk in Minutes Using Massively Parallel Deep Reinforcement Learning</i>, CoRL 2021, arXiv:2109.11978';
  const ISAAC = 'Makoviychuk et al., <i>Isaac Gym: High Performance GPU-Based Physics Simulation For Robot Learning</i>, NeurIPS 2021 Datasets and Benchmarks, arXiv:2108.10470';
  const TOBIN = 'Tobin et al., <i>Domain Randomization for Transferring Deep Neural Networks from Simulation to the Real World</i>, IROS 2017, arXiv:1703.06907';
  const PENG = 'Peng, Andrychowicz, Zaremba y Abbeel, <i>Sim-to-Real Transfer of Robotic Control with Dynamics Randomization</i>, ICRA 2018, arXiv:1710.06537';
  const HWANG = 'Hwangbo et al., <i>Learning agile and dynamic motor skills for legged robots</i>, Science Robotics 4(26), 2019, arXiv:1901.08652';
  const LEE20 = 'Lee et al., <i>Learning quadrupedal locomotion over challenging terrain</i>, Science Robotics 5(47), 2020, arXiv:2010.11251';
  const RMA = 'Kumar, Fu, Pathak y Malik, <i>RMA: Rapid Motor Adaptation for Legged Robots</i>, RSS 2021, arXiv:2107.04034';
  const MIKI = 'Miki et al., <i>Learning robust perceptive locomotion for quadrupedal robots in the wild</i>, Science Robotics 7(62), 2022, arXiv:2201.08117';
  const RUBIK = 'OpenAI et al., <i>Solving Rubik\'s Cube with a Robot Hand</i> (automatic domain randomization), arXiv:1910.07113 (2019)';
  const DEXT = 'OpenAI et al. (Andrychowicz et al.), <i>Learning Dexterous In-Hand Manipulation</i>, IJRR 39(1), 2020, arXiv:1808.00177';
  const ASYM = 'Pinto et al., <i>Asymmetric Actor Critic for Image-Based Robot Learning</i>, RSS 2018, arXiv:1710.06542';
  const SAC = 'Haarnoja, Zhou, Abbeel y Levine, <i>Soft Actor-Critic: Off-Policy Maximum Entropy Deep Reinforcement Learning with a Stochastic Actor</i>, ICML 2018, arXiv:1801.01290';
  const TD3 = 'Fujimoto, van Hoof y Meger, <i>Addressing Function Approximation Error in Actor-Critic Methods</i> (TD3), ICML 2018, arXiv:1802.09477';
  const NG99 = 'Ng, Harada y Russell, <i>Policy invariance under reward transformations: Theory and application to reward shaping</i>, ICML 1999';
  const AMODEI = 'Amodei et al., <i>Concrete Problems in AI Safety</i>, arXiv:1606.06565 (2016)';
  const IMPALA = 'Espeholt et al., <i>IMPALA: Scalable Distributed Deep-RL with Importance Weighted Actor-Learner Architectures</i>, ICML 2018, arXiv:1802.01561';

  ATLAS.register({
    id: 'rl-ppo',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> entra lo que el robot mide en este instante (en HalfCheetah, ${met('obs')} números: ángulos y velocidades de las articulaciones y del torso) y sale una <b>distribución</b> sobre la acción (una gaussiana sobre ${met('act')} torques); la red que la produce, la <b>política</b> π<sub>θ</sub>, no se entrena con etiquetas sino con una <b>recompensa</b>: prueba acciones en un simulador, mira cuánta recompensa acumuló y sube la probabilidad de lo que salió mejor de lo esperado. PPO es la forma estable y barata de hacer eso, y es el algoritmo por defecto en locomoción en simulación (y, con otro "entorno", en <a href="#rlhf-dpo">RLHF</a>).` },
          { t: 'p', html: R`Lo sorprendente son los tamaños: en la canónica, la política y el crítico juntos tienen ${qn('params.total')} parámetros (dos MLP de 64-64) y una decisión (un forward del actor) cuesta ${met('actorMacs')}. Lo caro de RL no es la red: son las <b>muestras</b>. Cada update de PPO consume ${met('samples')} pasos de simulación nuevos y los usa en ${met('grad')} pasos de gradiente; después los tira. Por eso la robótica moderna entrena con miles de robots simulados en paralelo en una GPU (${cf('nEnvs', AN)} en <code>ppo-anymal-isaac</code>, ${met('samples', AN)} muestras por update).` },
          { t: 'table', caption: 'Cuándo RL (PPO) y cuándo otra cosa', head: ['Situación', '¿PPO?', 'Por qué'], rows: [
            ['Locomoción (cuadrúpedos, humanoides) con un simulador rápido y una recompensa que sabes escribir', '<b>Sí, el caso de libro</b>', R`Miles de entornos en paralelo en GPU, una política chica que corre a 50 Hz y sim-to-real con domain randomization; ANYmal en terreno irregular en ≈ 20 min de entrenamiento en una GPU (${RUDIN}).`],
            ['Manipulación con contacto rico, recompensa difícil de escribir, y tienes (o puedes juntar) demostraciones', 'No como primer paso', R`Imitation learning (<a href="#imitation">BC, ACT, Diffusion Policy</a>) aprende de ${est('decenas a cientos de')} demostraciones sin diseñar recompensa; RL se usa después para afinar, si hay simulador.`],
            ['Recompensa muy escasa (solo al final, "¿abrió la puerta?")', 'Con ayuda', 'Policy gradient necesita que alguna trayectoria tenga éxito por azar. Reward shaping, curriculum, demostraciones para arrancar o una política inicial por BC.'],
            ['Aprender directamente en el robot real, cada muestra es cara', 'No: off-policy', R`PPO tira los datos después de cada update. SAC (${SAC}) reutiliza un replay buffer: mucho más eficiente en muestras, peor en tiempo de pared cuando la simulación es gratis.`],
            ['Hay una etiqueta correcta por ejemplo (la acción del experto, la clase)', 'No', 'Eso es supervised learning: menos varianza, más simple. RL solo cuando la señal es una recompensa que llega después de decisiones encadenadas.'],
            ['Ajustar un LLM con preferencias o recompensas verificables', 'Sí (PPO o GRPO)', R`El mismo objetivo recortado sobre tokens; lo que cambia (KL a la referencia, cuatro modelos, generación) está en <a href="#rlhf-dpo">SFT, RLHF y DPO</a>.`],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"PPO is an on-policy actor-critic method. The actor is a stochastic policy, a Gaussian over actions for continuous control, and the critic estimates the state value. Each iteration collects a batch of rollouts from many parallel environments, computes advantages with GAE, and then runs several epochs of minibatch updates on a clipped surrogate objective: the probability ratio between the new and old policy is clipped to one plus or minus epsilon, so the update cannot move the policy too far from the one that collected the data. That gives most of TRPO's stability with first-order optimization. In robotics it wins because simulation is cheap and massively parallel, so wall-clock time matters more than sample efficiency."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como entrenar un clasificador con cross-entropy, pero la "etiqueta" la elige el propio modelo y cada ejemplo pesa según cuánto mejor le fue de lo esperado.</b> En ResNet minimizas −log p(y|x) con la y del dataset. En policy gradient minimizas −log π<sub>θ</sub>(a|s)·Â: la acción a la muestreó la política, y Â (la ventaja) dice si esa acción salió mejor (Â &gt; 0: súbele la probabilidad) o peor (Â &lt; 0: bájasela) que lo normal en ese estado. Es una cross-entropy pesada. La diferencia de fondo: el dataset <b>depende de θ</b>. Cambias la política, cambian los estados que visitas y las acciones que pruebas; los datos viejos dejan de representar a la política nueva. Todo lo raro de PPO (el ratio, el clip, tirar los datos después de unas épocas) sale de ahí.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de RL', head: ['Concepto', 'Lo que ya sabes', 'En RL / PPO', '¿Nuevo?'], rows: [
            ['La red', 'Un MLP o una CNN', R`La política π<sub>θ</sub>(a|s): MLP 64-64 (MuJoCo), 512-256-128 (ANYmal), Nature-CNN (Atari). Igual de aburrida`, 'Igual'],
            ['La pérdida', 'Cross-entropy con la etiqueta', R`−log π<sub>θ</sub>(a|s)·Â: log-likelihood de la acción tomada, pesada por la ventaja`, 'Equivale'],
            ['Controlador en lazo cerrado', 'PID / LQR / MPC: u = K(x)', R`La política es un controlador por realimentación aprendido: a = π(s). En legged_gym produce posiciones objetivo para un PD por articulación`, 'Equivale'],
            ['Función de costo', 'J = Σ (xᵀQx + uᵀRu) en LQR/MPC', R`−recompensa; pero aquí el modelo de la dinámica <b>no se conoce</b> (model-free): se aprende por muestreo`, 'Parecido'],
            ['Trust region', 'Limitar el paso en optimización no lineal (Levenberg-Marquardt)', R`No alejar la política nueva de la que juntó los datos: KL en TRPO, clip en PPO`, 'Parecido'],
            ['Asignación de crédito', '—', R`¿Qué acción de las últimas 100 causó la caída? Retorno descontado, crítico V(s), ventaja y GAE`, '<b>Nuevo</b>'],
            ['Datos on-policy', '—', R`Las muestras sirven solo para la política que las generó (o una muy cercana): por eso se tiran después de cada update`, '<b>Nuevo</b>'],
          ] },

          { t: 'h3', text: 'Lo mínimo de un MDP, con números' },
          { t: 'p', html: R`Un robot da tres pasos y recibe recompensas 1, 0 y 2. Con descuento γ = 0.9, el <b>retorno</b> desde el primer paso es G<sub>0</sub> = 1 + 0.9·0 + 0.9²·2 = 2.62: la recompensa de dentro de dos pasos vale el 81 %. Con γ = 0.99 un paso de "dentro de 100 pasos" todavía vale 0.99<sup>100</sup> ≈ 0.37; el horizonte efectivo es ≈ 1/(1 − γ) = 100 pasos. Ojo con la unidad: a 50 Hz (legged_gym) son ≈ 2 s de futuro; en HalfCheetah (dt = 0.05 s) son ≈ 5 s. El mismo γ es otra tarea si cambias la frecuencia de control.` },
          { t: 'math', display: true, tex: R`\begin{aligned}&\text{MDP } (\mathcal S,\mathcal A,P,r,\gamma):\quad s_{t+1}\sim P(\cdot\mid s_t,a_t),\quad a_t\sim\pi_\theta(\cdot\mid s_t),\quad r_t=r(s_t,a_t)\\ &G_t=\sum_{k\ge 0}\gamma^k r_{t+k},\qquad J(\theta)=\mathbb E_{\tau\sim\pi_\theta}\big[G_0\big]\\ &V^\pi(s)=\mathbb E\big[G_t\mid s_t=s\big],\qquad Q^\pi(s,a)=\mathbb E\big[G_t\mid s_t=s,\,a_t=a\big],\qquad A^\pi(s,a)=Q^\pi(s,a)-V^\pi(s)\end{aligned}`, caption: 'Estado, acción, transición (desconocida para el algoritmo), recompensa y descuento. J es lo que se maximiza; V dice cuánto se espera desde un estado, Q desde un estado y una acción, y la ventaja A cuánto mejor es esa acción que la política promedio en ese estado.' },
          { t: 'list', items: [
            R`<b>Markov</b>: el estado resume todo lo que importa del pasado. Un robot con solo posiciones articulares no es Markov (le faltan velocidades); por eso legged_gym mete velocidades y la acción anterior en la observación, y por eso se usan historias o LSTM cuando falta información (POMDP).`,
            R`<b>Por qué γ &lt; 1</b>: hace finita la suma en tareas sin fin, y (lo que importa en la práctica) baja la varianza a cambio de sesgo: el paper de GAE trata γ como un parámetro del estimador, no del problema (${GAE}, §2).`,
            R`<b>Episodio</b>: termina por fracaso (el torso toca el suelo), éxito o tiempo límite. La diferencia entre "terminó" y "se cortó por tiempo" es un detalle de implementación que cambia los resultados (abajo, en <a href="#rl-ppo.entrenamiento">entrenamiento</a>).`,
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>El otro camino a una política de robot: <a href="#imitation">imitation learning</a> (BC, ACT, Diffusion Policy) aprende de demostraciones sin recompensa. Y el mismo PPO sobre tokens, con un reward model en lugar de un simulador, es <a href="#rlhf-dpo">RLHF</a>; GRPO (también ahí) es PPO sin crítico.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`El bucle de PPO. <b>Rollout</b>: ${cf('nEnvs')} entorno(s) en paralelo × ${cf('horizon')} pasos; en cada paso la política (actor) recibe la observación, muestrea una acción de su gaussiana y guarda su log-probabilidad; el crítico guarda V(s); el entorno devuelve la recompensa y el estado siguiente. <b>Ventajas</b>: con las recompensas y los valores, GAE calcula Â y los retornos objetivo. <b>Update</b>: ${cf('epochs')} épocas sobre las ${met('samples')} muestras, barajadas en minibatches de ${met('mb')}: objetivo recortado para el actor, pérdida cuadrática para el crítico, bono de entropía. Después, los datos se tiran y empieza otro rollout con la política nueva.` },
          { t: 'archdiagram', diagram: 'ppo-overview', walk: 'forward', wide: true, caption: R`PPO actor-critic en la canónica (MuJoCo, MLP 64-64 tanh separados): rollout → GAE → K épocas × minibatches → θ, φ nuevos. Formas y conteos del calculador.` },
          { t: 'p', html: R`<b>El recorte, en una figura.</b> Cada muestra aporta min(r·Â, clip(r, 1 − ε, 1 + ε)·Â), con r el cociente entre la probabilidad de la acción en la política nueva y en la que la muestreó. Mueve ε y r: con Â &gt; 0, pasado 1 + ε el término se aplana (gradiente cero: ya subiste bastante esa acción); con Â &lt; 0, el aplanado está debajo de 1 − ε. Del otro lado no hay techo: si un paso empeoró una acción buena (r &lt; 1 con Â &gt; 0), el gradiente sigue entero para corregirlo.` },
          { t: 'viz', kind: 'ppo-clip', params: { config: C, r: 1.3, epoch: 3 }, caption: 'Un término del objetivo recortado (Fig. 1 de Schulman et al. 2017) y un minibatch ilustrativo con su clip fraction. ε, épocas y minibatch salen del calculador.' },
          { t: 'p', html: R`<b>GAE, en una figura.</b> Una cadena de recompensas ruidosas y un crítico que se equivoca a propósito. Con λ = 0 la ventaja es el error de TD de un paso (poca varianza, todo el sesgo del crítico); con λ = 1 es el retorno Monte Carlo menos V(s) (sin sesgo del crítico, toda la varianza). El valor por defecto, λ = ${met('lam')}, queda en el medio.` },
          { t: 'viz', kind: 'gae', params: { config: C, t: 3, end: 'terminal' }, caption: 'Juguete sintético (rotulado): sesgo y varianza de Â en forma cerrada para γ y λ; no son números de un benchmark.' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el camino completo de REINFORCE a PPO, derivado; después cada bloque del diagrama con sus formas. Un ejemplo para tener en la cabeza: una política softmax sobre tres acciones con logits θ = (0, 0, 0), así que π = (⅓, ⅓, ⅓). Muestreas la acción 2 y el episodio sale <b>mejor</b> de lo esperado, con ventaja Â = +2. El gradiente de log π(a = 2) respecto de los logits es e<sub>2</sub> − π = (−⅓, +⅔, −⅓): subir el logit de la acción tomada y bajar los otros. Multiplicado por Â = +2: (−⅔, +4⁄3, −⅔). Con Â = −2, el mismo vector con el signo cambiado. Eso es todo policy gradient; lo demás es reducir la varianza y no dar pasos demasiado grandes.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Canónica'], rows: [
            ['s<sub>t</sub>, a<sub>t</sub>, r<sub>t</sub>', 'observación, acción y recompensa en el paso t', R`obs ${met('obs')}, acción ${met('act')}`],
            ['π<sub>θ</sub>, V<sub>φ</sub>', 'actor (política) y crítico (valor), redes separadas en MuJoCo', 'MLP 64-64 tanh'],
            ['N, T', 'entornos en paralelo y pasos por entorno en cada rollout (horizon)', R`${cf('nEnvs')}, ${cf('horizon')}`],
            ['K, M', 'épocas sobre el mismo batch; minibatches por época', R`${cf('epochs')}, ${cf('minibatches')}`],
            ['γ, λ', 'descuento; parámetro de GAE', R`${met('gamma')}, ${met('lam')}`],
            ['ε', 'rango del clip del ratio', met('eps')],
            ['r<sub>t</sub>(θ)', 'ratio π<sub>θ</sub>(a<sub>t</sub>|s<sub>t</sub>) / π<sub>θ<sub>old</sub></sub>(a<sub>t</sub>|s<sub>t</sub>) (ojo: misma letra que la recompensa en el paper)', '1 al empezar cada update'],
            ['c<sub>1</sub>, c<sub>2</sub>', 'pesos de la pérdida del valor y del bono de entropía', 'c₂ = 0 en MuJoCo; c₁ irrelevante con redes separadas'],
          ] },

          { t: 'h3', text: '1. El gradiente de la política: el truco del log' },
          { t: 'p', html: R`Queremos ∇<sub>θ</sub>J con J(θ) = E<sub>τ∼π<sub>θ</sub></sub>[G(τ)], pero la distribución de las trayectorias depende de θ y la dinámica del entorno es desconocida (no se puede derivar el simulador). El truco: ∇p = p·∇log p, que convierte la derivada de una distribución en una <b>esperanza</b> que se estima con muestras.` },
          { t: 'math', display: true, tex: R`\begin{aligned}\nabla_\theta J &= \nabla_\theta \int p_\theta(\tau)\,G(\tau)\,d\tau=\int p_\theta(\tau)\,\nabla_\theta \log p_\theta(\tau)\,G(\tau)\,d\tau=\mathbb E_{\tau\sim\pi_\theta}\big[\nabla_\theta\log p_\theta(\tau)\,G(\tau)\big]\\ \log p_\theta(\tau)&=\log\rho_0(s_0)+\sum_{t}\Big[\log\pi_\theta(a_t\mid s_t)+\log P(s_{t+1}\mid s_t,a_t)\Big]\ \Rightarrow\ \nabla_\theta\log p_\theta(\tau)=\sum_t\nabla_\theta\log\pi_\theta(a_t\mid s_t)\end{aligned}`, caption: 'El log-derivative trick (score function / likelihood ratio). La dinámica P y la distribución inicial ρ₀ no dependen de θ: desaparecen al derivar. Por eso policy gradient es model-free: solo hace falta poder derivar log π.' },
          { t: 'math', display: true, tex: R`\nabla_\theta J=\mathbb E_{\tau\sim\pi_\theta}\Big[\sum_{t}\nabla_\theta\log\pi_\theta(a_t\mid s_t)\;\hat G_t\Big],\qquad \hat G_t=\sum_{k\ge t}\gamma^{k-t}r_k\quad\text{(reward-to-go)}`, caption: R`REINFORCE (${WIL}). Usar solo las recompensas desde t (no las anteriores) es válido porque una acción no puede cambiar lo que ya pasó: esos términos tienen esperanza cero y solo agregan ruido. El teorema del policy gradient (${SUT}) dice lo mismo con Q^π(s, a) en lugar de Ĝ.` },
          { t: 'p', html: R`<b>Con una gaussiana</b> (acciones continuas), log π = −½‖(a − μ<sub>θ</sub>(s))/σ‖² − Σ log σ − const, así que ∇<sub>μ</sub>log π = (a − μ)/σ². Ejemplo: μ = 0, σ = 0.5, muestreaste a = 0.3: el gradiente respecto de la media es 0.3/0.25 = 1.2. Con Â &gt; 0 la media se mueve hacia 0.3; con Â &lt; 0, se aleja. La red produce μ(s) y el gradiente entra por backprop como en cualquier regresión.` },
          { t: 'callout', kind: 'trap', title: '"El gradiente de la política necesita derivar la recompensa o el simulador"', html: R`<p>No: la recompensa es solo un peso escalar y el simulador nunca se deriva (la dinámica se cancela en ∇log p<sub>θ</sub>(τ)). Por eso funciona con recompensas no diferenciables ("¿se cayó?", "¿pasó el test?") y con simuladores de caja negra. El precio es la <b>varianza</b>: el estimador es correcto en promedio, pero con una trayectoria es puro ruido.</p>` },

          { t: 'h3', text: '2. Varianza, baseline y ventaja' },
          { t: 'p', html: R`Si todas las recompensas son positivas (HalfCheetah: avanzar suma), REINFORCE sube la probabilidad de <b>todas</b> las acciones muestreadas, solo que unas más que otras; el aprendizaje sale de diferencias pequeñas entre números grandes y ruidosos. Restar un <b>baseline</b> b(s) que no depende de la acción no cambia el gradiente esperado y baja mucho la varianza:` },
          { t: 'math', display: true, tex: R`\mathbb E_{a\sim\pi_\theta(\cdot\mid s)}\big[\nabla_\theta\log\pi_\theta(a\mid s)\,b(s)\big]=b(s)\sum_a\pi_\theta(a\mid s)\,\frac{\nabla_\theta\pi_\theta(a\mid s)}{\pi_\theta(a\mid s)}=b(s)\,\nabla_\theta\sum_a\pi_\theta(a\mid s)=b(s)\,\nabla_\theta 1=0`, caption: 'El baseline es insesgado porque la suma de probabilidades siempre vale 1. Con el ejemplo softmax: Σ_a π(a)·(e_a − π) = π − π = 0. El mejor baseline (casi) es V(s): lo que queda, Ĝ_t − V(s_t), es una estimación de la ventaja.' },
          { t: 'p', html: R`Con b(s) = V(s), el peso de cada acción es "cuánto mejor que lo esperado en ese estado". Una acción mediocre en un estado excelente ya no recibe crédito por el estado. Eso es la <b>ventaja</b> A(s, a) = Q(s, a) − V(s), y todos los métodos modernos estiman alguna versión de ella.` },

          { t: 'h3', text: '3. Actor-critic: aprender V para estimar la ventaja' },
          { t: 'p', html: R`El <b>crítico</b> V<sub>φ</sub>(s) es una segunda red que se entrena por regresión a los retornos observados. Con él se puede reemplazar el retorno completo (ruidoso: suma muchas recompensas aleatorias) por una recompensa y la predicción del siguiente estado: el <b>error de TD</b> δ<sub>t</sub> = r<sub>t</sub> + γV(s<sub>t+1</sub>) − V(s<sub>t</sub>). Si V fuera exacto, E[δ<sub>t</sub>] = A(s<sub>t</sub>, a<sub>t</sub>) exactamente (ec. 10 de ${GAE}); como no lo es, δ<sub>t</sub> tiene <b>sesgo</b> pero mucha menos <b>varianza</b> que Ĝ<sub>t</sub> − V(s<sub>t</sub>). Entre los dos extremos hay toda una familia: sumar k recompensas reales y después confiar en V.` },
          { t: 'math', display: true, tex: R`\hat A_t^{(1)}=\delta_t,\qquad \hat A_t^{(2)}=\delta_t+\gamma\delta_{t+1}=r_t+\gamma r_{t+1}+\gamma^2V(s_{t+2})-V(s_t),\qquad \hat A_t^{(k)}=\sum_{l=0}^{k-1}\gamma^l\delta_{t+l}`, caption: 'Los estimadores de k pasos: la suma telescópica de errores de TD deja k recompensas reales y una sola predicción del crítico al final. k = ∞ es Monte Carlo menos V(s_t).' },

          { t: 'h3', text: '4. GAE: un promedio exponencial de todos los k' },
          { t: 'p', html: R`En lugar de elegir un k, GAE promedia todos los Â<sup>(k)</sup> con pesos (1 − λ)λ<sup>k−1</sup>. Al reagrupar, cada δ<sub>t+l</sub> queda multiplicado por (γλ)<sup>l</sup>:` },
          { t: 'math', display: true, tex: R`\hat A_t^{\mathrm{GAE}(\gamma,\lambda)}=(1-\lambda)\big(\hat A_t^{(1)}+\lambda\hat A_t^{(2)}+\lambda^2\hat A_t^{(3)}+\dots\big)=\sum_{l\ge 0}(\gamma\lambda)^l\,\delta_{t+l},\qquad \delta_t=r_t+\gamma V(s_{t+1})-V(s_t)`, caption: 'Ec. 16 del paper de GAE (λ = 0: ec. 17, el error de TD; λ = 1: ec. 18, Monte Carlo menos V). En el código no se suma hacia adelante: se recorre el rollout al revés, Â_t = δ_t + γλ(1 − done_t)·Â_{t+1}, y el objetivo del crítico es R̂_t = Â_t + V(s_t). En el diagrama: <a href="#rl-ppo.diagrama~gae">el bloque GAE</a> (ábrelo).' },
          { t: 'p', html: R`<b>Deriva tú</b> la reagrupación: el coeficiente de δ<sub>t+l</sub> en la suma pesada es (1 − λ)Σ<sub>k&gt;l</sub>λ<sup>k−1</sup>γ<sup>l</sup> = (1 − λ)·γ<sup>l</sup>λ<sup>l</sup>/(1 − λ) = (γλ)<sup>l</sup>. Y los dos parámetros no hacen lo mismo: γ &lt; 1 sesga el gradiente <b>siempre</b> (cambia el problema), mientras que λ &lt; 1 solo sesga cuando el crítico es inexacto; por eso el mejor λ sale bastante más bajo que el mejor γ (${GAE}, §3). En sus experimentos de locomoción, lo mejor quedó en valores intermedios: γ ∈ [0.99, 0.995] y λ ∈ [0.96, 0.99] (§6).` },
          { t: 'callout', kind: 'trap', title: 'done no es lo mismo que truncado', html: R`<p>Si el episodio <b>terminó</b> (se cayó), V(s<sub>t+1</sub>) = 0: no hay futuro. Si se <b>cortó por tiempo</b> o porque el rollout acabó, el robot seguía vivo y hay que <b>bootstrapear</b> con V(s<sub>t+1</sub>). Tratar los cortes por tiempo como terminales enseña al crítico que el mundo se acaba a los 20 s, cosa que no puede predecir porque el tiempo no está en la observación (${PARDO}). Rudin et al. lo corrigen sumando γ·V(s) a la recompensa en los time-outs y reportan ≈ 10–20 % más recompensa total (${RUDIN}, apéndice). CleanRL, en su versión de referencia, trata <code>terminated or truncated</code> como done: un detalle que en MuJoCo (episodios de 1,000 pasos) casi no se nota y en legged_gym (24 pasos por rollout, episodios de 20 s) sí.</p>` },

          { t: 'h3', text: '5. De TRPO a PPO: no alejarse de la política que juntó los datos' },
          { t: 'p', html: R`Con las ventajas listas, se podría hacer un paso de gradiente y tirar los datos (A2C). Desperdicio: un rollout cuesta miles de pasos de simulación. Para hacer <b>varios</b> pasos con el mismo batch hay que corregir que los datos vinieron de π<sub>θ<sub>old</sub></sub>, con importance sampling: el objetivo "sustituto" (surrogate) pesa cada muestra por el ratio r<sub>t</sub>(θ). Su gradiente en θ = θ<sub>old</sub> es exactamente el de policy gradient. Pero maximizarlo sin límite es catastrófico: lejos de θ<sub>old</sub>, Â ya no describe a la política nueva y el sustituto deja de predecir el retorno real. En la Tabla 1 del paper de PPO, varias épocas sin clip ni penalización dan un puntaje normalizado de −0.39 (peor que una política al azar en HalfCheetah).` },
          { t: 'math', display: true, tex: R`\begin{aligned}&\text{TRPO:}\quad \max_\theta\ \hat{\mathbb E}_t\Big[\frac{\pi_\theta(a_t\mid s_t)}{\pi_{\theta_{\text{old}}}(a_t\mid s_t)}\hat A_t\Big]\quad\text{s.a.}\quad \hat{\mathbb E}_t\big[\mathrm{KL}\big(\pi_{\theta_{\text{old}}}(\cdot\mid s_t)\,\|\,\pi_\theta(\cdot\mid s_t)\big)\big]\le\delta\\ &\text{PPO-clip:}\quad L^{\text{CLIP}}(\theta)=\hat{\mathbb E}_t\Big[\min\big(r_t(\theta)\hat A_t,\ \operatorname{clip}(r_t(\theta),1-\epsilon,1+\epsilon)\,\hat A_t\big)\Big],\qquad r_t(\theta)=\frac{\pi_\theta(a_t\mid s_t)}{\pi_{\theta_{\text{old}}}(a_t\mid s_t)}\end{aligned}`, caption: R`Ecuaciones 3–4 y 7 de ${PPO}. TRPO (${TRPO}) resuelve la restricción con gradiente conjugado y productos Fisher-vector más una búsqueda en línea: correcto, pero complejo y difícil de combinar con redes compartidas o dropout. PPO reemplaza la restricción por un recorte que se optimiza con Adam en minibatches.` },
          { t: 'p', html: R`<b>Por qué el min y por qué el clip</b>, caso por caso con ε = 0.2. (a) Â = +2, r = 1.5: min(3.0, 1.2·2 = 2.4) = 2.4 y el gradiente respecto de r es <b>0</b>: ya subiste esa acción más de 20 %, el término no empuja más. (b) Â = +2, r = 0.7: min(1.4, 0.8·2 = 1.6) = 1.4 con gradiente 2: el paso anterior bajó por error una acción buena y el término lo corrige entero. (c) Â = −1, r = 1.5: min(−1.5, −1.2) = −1.5, gradiente −1: una acción mala que subió se castiga entera. (d) Â = −1, r = 0.7: min(−0.7, −0.8) = −0.8, gradiente 0: ya la bajaste bastante. El min hace al objetivo una <b>cota pesimista</b> del sustituto: ignora el cambio de r solo cuando mejoraría el objetivo (${PPO}, §3). En el diagrama, <a href="#rl-ppo.diagrama~clip-loss">el bloque PPO-clip</a> se abre en estos pasos.` },
          { t: 'callout', kind: 'trap', title: '"El clip garantiza que la política nueva queda dentro de 1 ± ε"', html: R`<p>No lo garantiza. El clip solo apaga el gradiente de las muestras que ya salieron de la banda; nada impide que el gradiente de <b>otras</b> muestras (o el de la entropía y el del crítico si comparten red) las siga empujando, y los estados que no están en el batch no tienen ninguna restricción. Engstrom et al. midieron que PPO viola sistemáticamente la banda del ratio en Humanoid (aunque mantiene acotada la KL media) y que buena parte de esa contención viene de detalles de optimización, no del clip (${ENG}, §4, Fig. 2). Por eso se monitorea la KL aproximada y muchas implementaciones cortan las épocas si pasa un umbral (<code>target_kl</code>) o adaptan el LR (rsl_rl).</p>` },
          { t: 'p', html: R`<b>PPO-penalty</b> (la otra variante del paper, §4): maximizar r·Â − β·KL(π<sub>old</sub>, π<sub>θ</sub>) y adaptar β después de cada update: si la KL medida d &lt; d<sub>targ</sub>/1.5, β ← β/2; si d &gt; 1.5·d<sub>targ</sub>, β ← 2β. En MuJoCo rindió algo peor que el clip (0.74 con d<sub>targ</sub> = 0.01 contra 0.82 con ε = 0.2, Tabla 1), pero la idea sobrevive: rsl_rl adapta el <b>learning rate</b> con la misma regla (÷1.5 si KL &gt; 2·0.01, ×1.5 si KL &lt; 0.01/2, entre 10<sup>−5</sup> y 10<sup>−2</sup>; ${RUDIN}, Algoritmo 1), y RLHF pone la KL a la referencia dentro de la recompensa (<a href="#rlhf-dpo.operaciones">ver la página de RLHF</a>).` },

          { t: 'h3', text: '6. El objetivo completo: valor y entropía' },
          { t: 'math', display: true, tex: R`L^{\text{CLIP}+\text{VF}+\text{S}}_t(\theta)=\hat{\mathbb E}_t\Big[L^{\text{CLIP}}_t(\theta)-c_1\big(V_\theta(s_t)-\hat R_t\big)^2+c_2\,\mathcal H\big[\pi_\theta(\cdot\mid s_t)\big]\Big]`, caption: R`Ec. 9 de ${PPO} (se maximiza; el código minimiza el negativo). El término del valor solo acopla actor y crítico si comparten parámetros (Atari); con redes separadas (MuJoCo) c₁ es irrelevante y el paper no usa entropía (c₂ = 0). La entropía de una gaussiana diagonal es Σ_i (log σ_i + ½ log 2πe): con log σ = 0 en 6 dimensiones, ≈ 8.51 nats.` },
          { t: 'list', items: [
            R`<b>Pérdida del valor</b>: regresión de V<sub>φ</sub>(s<sub>t</sub>) a R̂<sub>t</sub> = Â<sub>t</sub> + V<sub>old</sub>(s<sub>t</sub>). La variante "con clip" de las implementaciones (OpenAI baselines, CleanRL, rsl_rl) toma el máximo entre el error normal y el de V recortado a V<sub>old</sub> ± ε. No está en el paper, y en los estudios grandes no ayuda: Andrychowicz et al. recomiendan no usarla (${AND}, §3.4).`,
            R`<b>Bono de entropía</b>: empuja a no colapsar la varianza de la política demasiado pronto (exploración). c<sub>2</sub> = 0.01 en Atari (Tabla 5) y en legged_gym; 0 en MuJoCo. En gaussianas con log σ como parámetro libre, el término es lineal en log σ: un c<sub>2</sub> grande infla σ sin parar.`,
          ] },

          { t: 'h3', text: '7. Los bloques del diagrama, con sus formas' },
          { t: 'op', block: 'actor', model: 'rl-ppo', title: 'Actor: media de la gaussiana (MLP 64-64 tanh)',
            tex: R`\mu_\theta(s)=W_3\tanh\big(W_2\tanh(W_1 s+b_1)+b_2\big)+b_3,\qquad a\sim\mathcal N\big(\mu_\theta(s),\ \operatorname{diag}(e^{2\log\sigma})\big)`,
            in: [T.obs], out: [T.mean],
            what: R`La observación (${met('obs')} números, normalizada) pasa por dos capas de 64 con tanh y una lineal a la media de cada componente de la acción. La desviación estándar no sale de la red: es un vector de ${met('act')} parámetros log σ, igual para todos los estados (state-independent), inicializado en 0 (σ = 1) en CleanRL. Cada componente de la acción es independiente.`,
            why: R`Una gaussiana da log π cerrado y diferenciable (lo que pide el truco del log) y una entropía cerrada. Que σ no dependa del estado es más estable al inicio: la red no puede inflar o colapsar la exploración estado por estado. La última capa se inicializa con escala 0.01 (CleanRL; Andrychowicz et al. recomiendan pesos 100× más chicos) para que la política inicial tenga media ≈ 0 en todos los estados.` },
          { t: 'op', block: 'sample', model: 'rl-ppo', title: 'Muestrear la acción y guardar log π_old',
            tex: R`a_t=\mu_\theta(s_t)+\sigma\odot\xi,\ \ \xi\sim\mathcal N(0,I),\qquad \log\pi_{\theta_{\text{old}}}(a_t\mid s_t)=-\sum_{i}\Big[\frac{(a_{t,i}-\mu_i)^2}{2\sigma_i^2}+\log\sigma_i+\tfrac12\log 2\pi\Big]`,
            in: [T.mean, T.std], out: [T.act, T.logp],
            what: R`Una muestra por paso y por entorno, y su log-probabilidad <b>sin gradiente</b> (se guarda en el buffer como la del denominador del ratio). La acción se manda al entorno (recortada al rango [−1, 1] por el wrapper <code>ClipAction</code>), pero en el buffer queda la muestra sin recortar: su log-prob es la que corresponde a la gaussiana.`,
            why: R`El ruido de la gaussiana <b>es</b> la exploración. Guardar log π<sub>old</sub> evita tener que conservar una copia de la red vieja: el ratio se calcula como exp(log π<sub>θ</sub> − log π<sub>old</sub>).` },
          { t: 'op', block: 'env-step', model: 'rl-ppo', title: 'Paso del simulador (N entornos en paralelo)',
            tex: R`s_{t+1}\sim P(\cdot\mid s_t,a_t),\qquad r_t=r(s_t,a_t),\qquad d_t=\mathbb 1[\text{terminó}]`,
            in: [T.act], out: [T.rew],
            what: R`El entorno aplica la acción (en HalfCheetah, ${met('act')} torques durante dt = 0.05 s, ${met('hz')} Hz) y devuelve la observación siguiente, la recompensa y dos banderas distintas: <code>terminated</code> (cayó, fracasó) y <code>truncated</code> (se acabó el tiempo). Cero parámetros y cero MACs en el calculador: el simulador no es parte de la red.`,
            why: R`Es la caja negra que el policy gradient nunca deriva. Y es lo que de verdad cuesta tiempo: en MuJoCo un paso de física por entorno en CPU; en Isaac Gym ${cf('nEnvs', AN)} robots a la vez en la GPU, a ${met('hz', AN)} Hz de política.` },
          { t: 'op', block: 'critic', model: 'rl-ppo', title: 'Crítico: V_φ(s) (MLP 64-64 tanh separado)',
            tex: R`V_\phi(s)=w_3^\top\tanh\big(W_2\tanh(W_1 s+b_1)+b_2\big)+b_3`,
            in: [T.obs], out: [T.val],
            what: R`Misma forma que el actor pero con una salida escalar. Se evalúa en cada paso del rollout (para GAE) y otra vez en cada minibatch del update (para la pérdida del valor).`,
            why: R`Red separada en MuJoCo: la pérdida del valor no interfiere con la del actor y no hace falta elegir c<sub>1</sub>. En Atari se comparte la CNN (las features visuales sirven a los dos) y entonces sí pesa c<sub>1</sub> (= 1 en la Tabla 5).` },
          { t: 'op', block: 'buffer', model: 'rl-ppo', title: 'Buffer del rollout',
            tex: R`\mathcal D=\{(s_t,a_t,\log\pi_{\theta_{\text{old}}}(a_t\mid s_t),V(s_t),r_t,d_t)\}_{t<T}^{\,N\text{ entornos}}`,
            in: [T.obs, T.act, T.logp, T.val, T.rew], out: [T.roll],
            what: R`T × N = ${cf('horizon')} × ${cf('nEnvs')} transiciones (${met('samples')} muestras), ${met('buf')} en float32 en la canónica. No es un replay buffer: se llena con la política actual y se vacía después de cada update.`,
            why: R`Guardar log π<sub>old</sub> y V<sub>old</sub> al recolectar es lo que permite calcular el ratio y el objetivo del crítico sin conservar una copia de las redes viejas. Con ${cf('nEnvs', AN)} robots el buffer de ANYmal ocupa ${met('buf', AN)}: entra sobrado en la GPU, al lado del simulador.` },
          { t: 'op', block: 'gae', model: 'rl-ppo', title: 'GAE: ventajas y retornos',
            tex: R`\delta_t=r_t+\gamma(1-d_t)V(s_{t+1})-V(s_t),\qquad \hat A_t=\delta_t+\gamma\lambda(1-d_t)\hat A_{t+1},\qquad \hat R_t=\hat A_t+V(s_t)`,
            in: [T.roll], out: [T.adv, T.ret],
            what: R`Un recorrido hacia atrás sobre los ${cf('horizon')} pasos de cada entorno (con V del estado que sigue al último paso para bootstrapear). Sin parámetros; unas pocas operaciones por muestra.`,
            why: R`Es la mitad "crítica" del algoritmo: con λ = ${met('lam')} se cambia un poco de sesgo por mucha menos varianza. Después, en cada minibatch, Â se normaliza a media 0 y desvío 1 (CleanRL <code>norm_adv</code>; rsl_rl lo hace sobre el batch entero): la escala de las recompensas deja de importar para el tamaño del paso.` },
          { t: 'op', block: 'minibatch', model: 'rl-ppo', title: 'Barajar y partir en minibatches (K épocas)',
            tex: R`\text{para } k=1..K:\quad \text{permutar } \{1..NT\}\ \to\ M\text{ minibatches de } NT/M`,
            in: [T.adv, T.ret], out: [T.mbAdv, T.mbRet],
            what: R`Cada época baraja las ${met('samples')} muestras y las parte en ${cf('minibatches')} minibatches de ${met('mb')}; en total ${met('grad')} pasos de gradiente por update. Cada muestra se usa ${met('reuse')} veces (una por época).`,
            why: R`Barajar rompe la correlación temporal de las muestras consecutivas de un mismo entorno. K y M fijan el compromiso: más pasos por batch exprimen más los datos caros, pero alejan a la política de la que los generó (de ahí el clip).` },
          { t: 'op', block: 'clip-loss', model: 'rl-ppo', title: 'Ratio y pérdida recortada (por minibatch)',
            tex: R`r_t=\exp\big(\log\pi_\theta(a_t\mid s_t)-\log\pi_{\theta_{\text{old}}}(a_t\mid s_t)\big),\qquad \mathcal L_\pi=-\frac1{|B|}\sum_{t\in B}\min\big(r_t\hat A_t,\ \operatorname{clip}(r_t,1\pm\epsilon)\hat A_t\big)`,
            in: [T.mbAdv], out: [T.lclip],
            what: R`Un forward del actor sobre las ${met('mb')} muestras del minibatch con las acciones guardadas, el log-prob nuevo, el ratio y el promedio del mínimo. En la primera pasada de la primera época r = 1 exacto (θ = θ<sub>old</sub>).`,
            why: R`El signo menos porque los frameworks minimizan. El clip deja que las ${cf('epochs')} épocas reutilicen las muestras sin que la política se aleje demasiado de la que las generó.` },
          { t: 'op', block: 'value-loss', model: 'rl-ppo', title: 'Pérdida del valor',
            tex: R`\mathcal L_V=\frac12\cdot\frac1{|B|}\sum_{t\in B}\big(V_\phi(s_t)-\hat R_t\big)^2`,
            in: [T.mbRet], out: [T.lv],
            what: R`Un forward del crítico sobre el minibatch y el error cuadrático medio contra los retornos de GAE (CleanRL: ½·MSE con c<sub>1</sub> = 0.5 y la variante recortada activada por defecto; rsl_rl: MSE recortado con c<sub>1</sub> = 1).`,
            why: R`Un crítico malo da ventajas malas. La métrica que lo delata es la <b>explained variance</b> 1 − Var(R̂ − V)/Var(R̂): cerca de 1, el crítico explica los retornos; cerca de 0 o negativa, las ventajas son casi ruido.` },
          { t: 'op', block: 'entropy', model: 'rl-ppo', title: 'Entropía de la gaussiana',
            tex: R`\mathcal H\big[\mathcal N(\mu,\operatorname{diag}\sigma^2)\big]=\sum_{i=1}^{d_a}\Big(\log\sigma_i+\tfrac12\log 2\pi e\Big)`,
            in: [T.std], out: [T.lent],
            what: R`Con σ independiente del estado, la entropía no depende de la observación: es una función de los ${met('act')} log σ. Con log σ = 0 vale ≈ 1.419 por dimensión.`,
            why: R`El bono c<sub>2</sub>·H frena el colapso de σ. Como es lineal en log σ, un c<sub>2</sub> grande infla la exploración sin límite: en MuJoCo el paper usa c<sub>2</sub> = 0.` },
          { t: 'op', block: 'total-loss', model: 'rl-ppo', title: 'Pérdida total y paso de Adam',
            tex: R`\mathcal L=\mathcal L_{\text{clip}}+c_1\mathcal L_V-c_2\,\bar{\mathcal H},\qquad \theta,\phi\leftarrow\operatorname{Adam}\big(\operatorname{clip\_norm}(\nabla\mathcal L)\big)`,
            in: [T.lclip, T.lv, T.lent], out: [T.loss],
            what: R`Un escalar por minibatch; backward por actor y crítico, recorte global de la norma del gradiente (0.5 en CleanRL, 1.0 en rsl_rl) y un paso de Adam. ${met('grad')} pasos así por update en la canónica.`,
            why: R`Sumar las tres pérdidas permite un solo backward. Con redes separadas los términos no se mezclan (cada uno solo tiene gradiente en su red); con un tronco compartido (Atari) c<sub>1</sub> fija cuánto pesa el valor sobre las features comunes.` },
          { t: 'p', html: R`El recorrido completo de un update con las formas del calculador (rollout, GAE y una pasada de minibatch):` },
          { t: 'trace', model: 'rl-ppo' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Las redes son minúsculas comparadas con el resto del atlas: actor ${met('actorParams')} parámetros, crítico ${met('criticParams')}, total ${qn('params.total')}. Incluso la de ANYmal (512-256-128) tiene ${qn('params.total', AN)}: menos que una sola capa de atención de ViT-B. Contar los parámetros a mano es un ejercicio típico (abajo, en <a href="#rl-ppo.practica">práctica</a>).` },
          { t: 'params', model: 'rl-ppo', group: 'block' },
          { t: 'flops', model: 'rl-ppo' },

          { t: 'h3', text: 'Lo que cuesta de verdad: muestras y pasos de gradiente' },
          { t: 'calc', title: R`Un update de PPO en la canónica (calculador)`, rows: [
            { label: 'Muestras por update', expr: R`N × T = ${cf('nEnvs')} × ${cf('horizon')}`, value: met('samples') },
            { label: 'Minibatch', expr: R`N·T / M = ${met('samples')} / ${cf('minibatches')}`, value: met('mb') },
            { label: 'Pasos de gradiente por update', expr: R`K × M = ${cf('epochs')} × ${cf('minibatches')}`, value: met('grad') },
            { label: 'Veces que se usa cada muestra', expr: 'K (una vez por época)', value: met('reuse') },
            { label: 'MACs del rollout', expr: R`N·T × (actor + crítico) por paso`, value: met('rollMacs') },
            { label: 'MACs del update', expr: R`K × N·T × (forward + backward) de actor + crítico; backward ≈ 2× forward, menos la 1.ª capa (no hay gradiente de la entrada): ${met('train3')} × el forward`, value: met('updMacs') },
            { label: 'Buffer del rollout', expr: 'N·T × (obs + acción + log π + V + r + done + Â + R̂) en float32', value: met('buf') },
            { label: 'Updates para el millón de pasos del paper', expr: R`⌊10<sup>6</sup> / (N·T)⌋ (como CleanRL)`, value: met('updates'), note: R`${met('budget')} pasos efectivos` },
          ], result: R`La red hace ${met('updMacs')} por update: nada para cualquier CPU. En MuJoCo el tiempo se va en <b>simular</b> (un paso de física a la vez, en CPU) y en el overhead de Python por paso; en Isaac Gym la física y la red corren en la misma GPU y lo que manda es cuántos robots caben. Por eso, en RL para robots, "más rápido" casi siempre significa "más entornos en paralelo", no "una red más chica". Mídelo con un profiler: tiempo de <code>env.step</code> contra tiempo de update por iteración.` },
          { t: 'compare', models: [C, AT, AN], rows: ['params', 'trunkParams', 'actorParams', 'criticParams', 'nEnvs', 'horizon', 'samplesPerUpdate', 'minibatchSize', 'epochs', 'gradStepsPerUpdate', 'actorMacs', 'updateMacs', 'rolloutBufferBytes'], caption: R`MuJoCo (paper, Tabla 3), Atari (paper, Tabla 5: la CNN compartida es el tronco; actor y crítico son solo las cabezas) y ANYmal en Isaac Gym (legged_gym / rsl_rl). Del calculador.` },
          { t: 'callout', kind: 'estimate', html: R`<p><b>El salto de Rudin et al.</b>: ${met('samples', AN)} muestras por update (${cf('nEnvs', AN)} robots × ${cf('horizon', AN)} pasos) y ${met('updates', AN)} updates: ${met('budget', AN)} pasos de política en total (cuenta propia, updates × muestras por update; el paper no da el total) en menos de 20 minutos con una RTX A6000 (${RUDIN}, §4.2). Eso es ${est('≈ ' + met('sps', AN) + ' pasos de robot por segundo')} (cuenta del calculador sobre los números citados, entrenamiento incluido). El mismo paper sitúa las implementaciones previas en CPU en ≈ 128 robots en paralelo (§4.1) y habla de una aceleración de "varios órdenes de magnitud". Con un solo entorno de MuJoCo en CPU, la canónica junta ${met('samples')} muestras por update; el millón de pasos del paper son ${met('updates')} updates.</p>` },

          { t: 'h3', text: 'Cómo escala' },
          { t: 'scaling', model: 'rl-ppo', knobs: [{ key: 'nEnvs', values: [1, 8, 64, 1024, 4096] }, { key: 'horizon', values: [64, 256, 512, 2048] }, { key: 'epochs', values: [1, 3, 5, 10] }, { key: 'minibatches', values: [1, 4, 32] }, { key: 'hidden', values: [64, 128, 256, 512] }], show: ['samplesPerUpdate', 'gradStepsPerUpdate', 'minibatchSize', 'actorParams', 'updateMacs', 'rolloutBufferBytes'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 entornos → ×2 muestras por update, ×2 buffer y ×2 MACs del update, con los mismos pasos de gradiente (cada minibatch es el doble de grande). ×2 épocas → ×2 pasos de gradiente y ×2 MACs del update, mismas muestras: más reutilización, más riesgo de alejarse de π<sub>old</sub> (vigila la KL). ×2 minibatches → ×2 pasos de gradiente con minibatches de la mitad; los MACs del update no cambian. ×2 ancho de las capas ocultas → hasta ×4 parámetros y MACs por paso (las matrices ocultas son H × H; en la canónica sale ≈ ×3.4 porque las capas de entrada y salida, que crecen solo ×2, todavía pesan), pero en la canónica sigue siendo nada al lado de la simulación. Y la que no aparece en la tabla: con N muy grande y T muy chico, cada robot aporta trayectorias tan cortas que GAE no ve el futuro; Rudin et al. reportan que el entrenamiento sufre por debajo de ≈ 25 pasos consecutivos (0.5 s) por robot (§2.2.1).` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota en "what does PPO training cost": "the networks are tiny, a few thousand to a few hundred thousand parameters, so compute per sample is negligible. The cost is environment interaction: each update consumes N environments times T steps of fresh on-policy data and reuses it for K epochs. Scaling is about simulator throughput, so I would move physics to the GPU with thousands of parallel environments, keep T long enough for GAE to see the consequences of actions, and pick the batch size by the trade-off between gradient noise and wall-clock time."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`La pérdida es la ecuación 9 de PPO; los datos son los que la propia política genera. Lo que se pregunta en una entrevista de robótica no es la fórmula sino tres cosas: <b>los detalles de implementación</b> que deciden si PPO aprende, <b>la recompensa</b> (y cómo la hackea la política) y <b>el salto a la realidad</b>.` },
          { t: 'math', display: true, tex: R`\min_{\theta,\phi}\ \ -\hat{\mathbb E}_t\Big[\min\big(r_t(\theta)\hat A_t,\ \operatorname{clip}(r_t(\theta),1-\epsilon,1+\epsilon)\hat A_t\big)\Big]+c_1\,\hat{\mathbb E}_t\big[(V_\phi(s_t)-\hat R_t)^2\big]-c_2\,\hat{\mathbb E}_t\big[\mathcal H[\pi_\theta(\cdot\mid s_t)]\big]`, caption: 'La forma que se implementa (el negativo de la ec. 9). Â con GAE(γ, λ), normalizada por minibatch; R̂ = Â + V_old.' },

          { t: 'h3', text: 'Las tres recetas que se citan' },
          { t: 'table', caption: 'Hiperparámetros como los publican el paper y el código', head: ['', 'MuJoCo (Tabla 3)', 'Atari (Tabla 5)', 'ANYmal, legged_gym / rsl_rl'], rows: [
            ['Red', 'Actor y crítico separados, MLP 64-64 tanh; σ libre', 'Nature-CNN compartida (A3C), cabezas de política y valor', 'Actor y crítico separados, MLP 512-256-128 ELU; σ inicial 1.0'],
            ['Entornos × pasos', '1 × 2,048', '8 actores × 128', '4,096 × 24'],
            ['Épocas, minibatch', '10, 64', '3, 32 × 8 = 256', R`5, 4 minibatches (${met('mb', AN)})`],
            ['γ, λ', '0.99, 0.95', '0.99, 0.95', '0.99, 0.95'],
            ['ε (clip)', '0.2 (el mejor de la Tabla 1)', '0.1 × α', '0.2'],
            ['LR (Adam)', '3 × 10<sup>−4</sup>', '2.5 × 10<sup>−4</sup> × α', '10<sup>−3</sup> adaptativo con KL objetivo 0.01'],
            ['c<sub>1</sub>, c<sub>2</sub>', '— (redes separadas), 0', '1, 0.01', '1.0, 0.01'],
            ['Presupuesto', '10<sup>6</sup> pasos por entorno', '40 M frames', '1,500 updates (≈ 147 M pasos), &lt; 20 min en una RTX A6000'],
          ], note: R`α decrece linealmente de 1 a 0 durante el entrenamiento (Tabla 5). Fuentes: ${PPO}, Tablas 3 y 5 y §6.1; ${RUDIN}, Tabla 3 del apéndice y §4.2; legged_gym <code>LeggedRobotCfgPPO</code> (rsl_rl 1.0.2). El calculador usa estos mismos valores.` },

          { t: 'h3', text: 'Los detalles de implementación que deciden si aprende' },
          { t: 'p', html: R`${ENG} hizo el experimento incómodo: PPO sin los "detalles de código" de la implementación de OpenAI (PPO-M) rinde como TRPO, y TRPO <b>con</b> esos detalles (TRPO+) rinde como PPO o mejor. En Hopper-v2, los detalles suben la recompensa 17 % (PPO) y 21 % (TRPO); cambiar de algoritmo con los detalles fijos casi no cambia nada (Tabla 2). En el ablation de cuatro detalles en Humanoid y Walker2d, el escalado de recompensas, el annealing del LR de Adam y la inicialización ortogonal fueron los que movieron el resultado; el clip del valor no (Fig. 1). ${D37} catalogan 37 detalles; los que se preguntan:` },
          { t: 'table', head: ['Detalle', 'Qué hace', 'Por qué importa'], rows: [
            ['Normalizar las ventajas', 'Â ← (Â − media)/desvío por minibatch', 'El tamaño del paso deja de depender de la escala de las recompensas.'],
            ['Normalizar observaciones', R`Media y varianza móviles por componente; recorte a ±10 (CleanRL: <code>NormalizeObservation</code>)`, R`Ángulos en radianes y velocidades en rad/s viven en escalas distintas; con tanh, entradas grandes saturan. Andrychowicz et al.: "always use observation normalization" (§3.3). En producción hay que <b>congelar y exportar</b> las estadísticas con la política.`],
            ['Escalar (y recortar) recompensas', 'Dividir por el desvío de una suma descontada móvil de recompensas (sin restar la media); recorte a ±10', 'El crítico regresa números de escala razonable; una recompensa de 1,000 por paso destruye la pérdida del valor.'],
            ['Inicialización ortogonal', R`Capas ocultas con ganancia √2, salida de la política 0.01, salida del valor 1 (CleanRL <code>layer_init</code>)`, 'Política inicial casi uniforme alrededor de 0, varianza de activaciones controlada.'],
            ['Annealing del LR', 'LR lineal hasta 0 (CleanRL); o adaptativo por KL (rsl_rl)', 'Pasos más chicos al final, cuando la política ya es buena y un paso grande la rompe.'],
            ['Recorte global del gradiente', 'Norma ≤ 0.5 (CleanRL) / 1.0 (rsl_rl)', 'Un minibatch con ventajas extremas no destroza la red.'],
            ['Adam con ε = 10<sup>−5</sup>', 'En vez del default 10<sup>−8</sup>', 'Detalle heredado de baselines; aparece en la lista de los 37.'],
            ['Bootstrap en time-outs', R`γ·V(s) en el corte por tiempo; done solo si terminó de verdad`, R`≈ 10–20 % más recompensa en legged_gym (${RUDIN}).`],
            ['Clip del valor', 'max(error, error con V recortado a V_old ± ε)', R`Está en casi todas las implementaciones; los estudios grandes no le encuentran beneficio (${AND}, §3.4).`],
          ] },
          { t: 'callout', kind: 'trap', title: '"Implementé PPO como dice el paper y no aprende"', html: R`<p>El paper describe el algoritmo; el rendimiento publicado sale de la implementación. ${HEND} mostraron que cambiar la semilla o la implementación cambia el resultado tanto como cambiar el algoritmo. Empieza desde una implementación de referencia (CleanRL, rsl_rl, Stable-Baselines3), reproduce su curva en una tarea conocida (HalfCheetah o el ejemplo de legged_gym) y recién después cambia la tarea. Y siempre varias semillas: con 3 no se distingue un 10 %.</p>` },

          { t: 'h3', text: 'Simulación masiva: miles de robots en una GPU' },
          { t: 'p', html: R`Isaac Gym (${ISAAC}) corre la física (PhysX) y la red en la misma GPU, con los tensores de estado sin pasar por la CPU. ${RUDIN} lo usan con ${cf('nEnvs', AN)} ANYmal C en paralelo: política para terreno plano en menos de 4 minutos y para terreno irregular (escaleras, pendientes, obstáculos) en ≈ 20 minutos, transferida al robot real. Lo que cambian respecto de PPO "de libro":` },
          { t: 'list', items: [
            R`<b>Batch grande, horizonte corto</b>: B = N·T; con N enorme, T tiene que ser chico (24) para que B no explote. Por debajo de ≈ 25 pasos el entrenamiento sufre (GAE necesita ver consecuencias) y con demasiados robots baja el rendimiento final; lo mejor para su tarea: 2,048–4,096 robots con B ≈ 100 k–200 k (§4.1, Fig. 4).`,
            R`<b>Minibatches de decenas de miles</b> (${met('mb', AN)}), 5 épocas y LR adaptativo por KL: pocos pasos de gradiente grandes en vez de muchos chicos.`,
            R`<b>Bootstrap en time-outs</b>: los episodios duran 20 s y abarcan muchos rollouts.`,
            R`<b>Curriculum "de videojuego"</b>: cada robot tiene un nivel de terreno; si cruza su parcela sube de nivel, si avanza menos de la mitad de lo pedido baja; los que resuelven el último nivel vuelven a uno al azar para no olvidar (§3.1).`,
            R`<b>Acciones = posiciones articulares objetivo</b> para un PD (no torques directos): el PD a 200 Hz absorbe la dinámica rápida y la política decide a 50 Hz (dt de simulación 0.005 s × 4).`,
          ] },
          { t: 'callout', kind: 'note', html: R`<p>Dimensiones de la config <code>${AN}</code>: observación ${met('obs', AN)} y acción ${met('act', AN)} (12 articulaciones), del repositorio legged_gym (48 propioceptivas + 187 alturas del terreno en una grilla de 17 × 11). El paper (§3.2) dice 108 alturas; el código publicado usa 187. El calculador sigue al código.</p>` },

          { t: 'h3', text: 'La recompensa: lo que pides es lo que obtienes' },
          { t: 'p', html: R`La recompensa de locomoción de legged_gym es una suma pesada de nueve términos (${RUDIN}, §3.2): seguir la velocidad lineal y angular pedida (positivos) y penalizaciones por velocidad vertical, rotaciones del torso, torques, aceleraciones articulares, cambios bruscos de acción, colisiones de rodillas y muslos, más un premio por tiempo de vuelo de los pies (pasos más largos). Los pesos se ajustan a mano hasta que la marcha es aceptable: el paper cuenta que la política siempre converge a trote pero con artefactos (una pata que se arrastra, el torso demasiado alto o bajo) hasta que se afinan los pesos (§4.2).` },
          { t: 'list', items: [
            R`<b>Reward hacking / specification gaming</b>: la política maximiza lo que escribiste, no lo que querías (${AMODEI}). Ejemplos típicos en locomoción: avanzar arrastrando el torso, vibrar las patas para cobrar "tiempo de vuelo", explotar un bug de contactos del simulador para salir disparado. Se detecta <b>mirando videos</b>, no la curva de recompensa.`,
            R`<b>Shaping sin cambiar el óptimo</b>: sumar F = γΦ(s') − Φ(s) (potential-based shaping) acelera el aprendizaje sin cambiar la política óptima (${NG99}). Los términos de legged_gym no son de esa forma: sí cambian lo que es óptimo, a propósito (marchas suaves y seguras).`,
            R`<b>Terminaciones como recompensa implícita</b>: terminar el episodio cuando el torso toca el suelo es castigar con la pérdida de toda la recompensa futura. Si la recompensa por paso puede ser negativa, terminar se vuelve atractivo: la política aprende a "suicidarse". legged_gym recorta la suma por paso a ≥ 0 por defecto (<code>only_positive_rewards = True</code>; el comentario del código: evita los problemas de terminación temprana) y suma la penalización de terminación después del recorte.`,
          ] },

          { t: 'h3', text: 'Sim-to-real: que la política sobreviva al robot real' },
          { t: 'table', head: ['Técnica', 'Qué hace', 'Cita'], rows: [
            ['Domain randomization (visual)', 'Texturas, luces y cámaras al azar en simulación para que la red trate al mundo real como "otra variación"', TOBIN],
            ['Domain randomization (dinámica)', 'Masas, fricción, ganancias, latencias, empujones al azar en cada episodio; la política aprende a ser robusta a todo el rango', R`${PENG}; en legged_gym: fricción ∈ [0.5, 1.25], masa del torso ± 5 kg (ANYmal C), empujones de hasta 1 m/s, ruido de observación medido en el robot`],
            ['System identification', 'Medir los parámetros del robot real (masas, inercias, fricción, latencia) y ajustar el simulador antes de entrenar', 'Práctica estándar; reduce cuánto hay que randomizar'],
            ['Actuator network', R`Una red que aprende, con datos medidos del actuador real, el mapeo (error de posición, velocidad) → torque; reemplaza al modelo ideal del motor dentro del simulador`, R`${HWANG}; legged_gym usa una LSTM del ANYdrive (<code>anydrive_v3_lstm.pt</code>) en ANYmal C`],
            ['Teacher-student / adaptación', 'Un "profesor" entrenado con información privilegiada del simulador (fricción, terreno exacto) y un "alumno" que lo imita solo con sensores reales y una historia; o un módulo que estima los parámetros del entorno en línea', `${LEE20}; ${RMA}; ${MIKI}`],
            ['Automatic domain randomization', 'Ensancha los rangos de randomización a medida que la política los domina', RUBIK],
          ] },
          { t: 'callout', kind: 'senior', html: R`<p>La frase senior sobre sim-to-real: "the gap is mostly in actuators, latency, contact and perception, not in rigid-body dynamics. I identify what I can (masses, PD gains, latency), learn what I cannot model (an actuator network from logged motor data), randomize what remains uncertain over ranges I can justify, add observation noise measured on the robot, and verify transfer with a staged rollout: hanging test, then flat ground, then terrain, with safety limits on torque and joint ranges."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Armar la observación', html: R`<p>Exactamente igual que en simulación: mismas unidades, mismo orden, mismas escalas, la acción anterior, y las <b>estadísticas de normalización congeladas</b> del final del entrenamiento (si sigues actualizando la media móvil en el robot, la política ve otra entrada). En legged_gym las escalas son constantes del config (<code>obs_scales</code>).</p>` },
            { title: 'Forward del actor', html: R`<p>Solo el actor: el crítico no se despliega. ${met('actorMacs')} en la canónica y ${met('actorMacs', AN)} en ANYmal: ${est('microsegundos')} en cualquier CPU embebida. A ${met('hz', AN)} Hz (la frecuencia de la política en legged_gym) son ${est('decenas de MFLOP/s')}: la red no es el cuello de botella; lo son la estimación de estado y, si hay, el mapa de elevación.</p>` },
            { title: 'Acción determinista', html: R`<p>Se usa la <b>media</b> μ(s), sin ruido: el ruido era exploración. La acción se escala (legged_gym: <code>action_scale</code> = 0.5 alrededor de la postura por defecto) y se manda como objetivo al PD de cada articulación.</p>` },
            { title: 'Límites de seguridad', html: R`<p>Recorte de acciones y de torques, límites de velocidad articular, y un watchdog que pasa a un controlador seguro si la observación sale del rango visto en simulación. En el despliegue de Rudin et al. la política va directo a los motores sin filtrado extra, y bajaron la velocidad máxima comandada a 0.6 m/s porque el mapa de elevación real es imperfecto (§4.3).</p>` },
          ] },
          { t: 'callout', kind: 'trap', title: '"Para el robot real exporto la política estocástica, que es más robusta"', html: R`<p>El ruido de la gaussiana era para explorar y su σ al final del entrenamiento no es una medida de robustez. Robustez se entrena con domain randomization y ruido de observación; en el robot se usa la media. Excepción: si la política aprendió a depender del ruido (un σ grande que nunca bajó), es una señal de que el entrenamiento no terminó.</p>` },
          { t: 'callout', kind: 'note', html: R`<p>La latencia que sí importa es la del lazo: medir → estimar estado → política → PD. Si en el robot real hay ${est('10–20 ms')} de latencia y en simulación 0, la política puede oscilar. Se randomiza la latencia en simulación (o se mete en el actuator network) y se mide en el robot con un timestamp por mensaje.</p>` },
          { t: 'p', html: R`Formato: el actor se exporta a TorchScript u ONNX (legged_gym trae <code>export_policy_as_jit</code>) y corre en la computadora del robot, a menudo en CPU. Una política con memoria (LSTM) exporta también su estado oculto, que se reinicia al empezar cada episodio.` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>No aprende (curva plana).</b> Recompensa demasiado escasa, observaciones sin normalizar, acciones fuera de escala, done/truncado mal manejados, un bug de signo en la ventaja. Se diagnostica con las métricas de abajo, no cambiando el algoritmo.`,
            R`<b>Colapso de la política</b>: la recompensa sube y de golpe cae y no vuelve. Un update demasiado grande (LR alto, demasiadas épocas, minibatch chico) saca a la política de la región donde Â era válida. Síntoma: picos en la KL aproximada y en la clip fraction justo antes.`,
            R`<b>Colapso de la exploración</b>: σ (o la entropía) cae a casi cero temprano y la política se queda en un óptimo local (el robot que aprende a quedarse quieto para no caerse).`,
            R`<b>Reward hacking</b>: la recompensa sube y el comportamiento es inútil o peligroso. Solo se ve en video.`,
            R`<b>Sim-to-real gap</b>: perfecta en simulación, se cae en el robot. Actuadores, latencia, fricción, contactos, sensores.`,
            R`<b>Sensibilidad a semillas e hiperparámetros</b>: dos semillas, dos curvas distintas (${HEND}). Siempre ≥ 5 semillas para comparar.`,
          ] },
          { t: 'h3', text: 'Las métricas para depurar un run de PPO' },
          { t: 'table', head: ['Métrica', 'Qué es', 'Sano (orientativo)', 'Si está mal'], rows: [
            ['approx KL', R`E[(r − 1) − log r] (estimador k3, CleanRL <code>approx_kl</code>) entre π<sub>old</sub> y π<sub>θ</sub> al final de las épocas`, est('≈ 0.01–0.02'), 'Muy alta: pasos demasiado grandes (baja LR o épocas, sube minibatch). ≈ 0: la política no se mueve (LR muy bajo, ventajas ≈ 0).'],
            ['clip fraction', 'Fracción de muestras con |r − 1| &gt; ε', est('≈ 0.1–0.3'), 'Cerca de 0: el clip no hace nada (pasos chicos). Muy alta: casi todo recortado, la política quiere ir más lejos de lo que le permites.'],
            ['explained variance', '1 − Var(R̂ − V)/Var(R̂) del crítico', est('subiendo hacia 0.8–1'), 'Cerca de 0 o negativa: el crítico no aprende; ventajas ruidosas. Revisa escala de recompensas, LR del crítico, done/truncado.'],
            ['entropía / σ', 'Entropía media de la política (o log σ)', 'Baja despacio', 'Cae a pique: exploración colapsada (sube c₂ o fija un mínimo de σ). No baja nunca: la política no aprende nada útil.'],
            ['value loss', 'MSE del crítico', 'Baja y se estabiliza', 'Enorme: recompensas sin escalar; picos en los time-outs mal manejados.'],
            ['recompensa por episodio y largo', 'Promedio de los episodios terminados en el rollout', 'Sube', R`Sube pero el video es absurdo: reward hacking. Largo siempre máximo y recompensa baja: la política aprendió a "sobrevivir quieta".`],
          ], note: 'Los rangos son orientativos de la comunidad (no de un paper); dependen de la tarea. Compáralos con un run de referencia que sí funcione.' },

          { t: 'h3', text: 'Trade-offs: algoritmos para obtener una política' },
          { t: 'table', head: ['Criterio', 'PPO', 'TRPO', 'REINFORCE / A2C', 'SAC / TD3 (off-policy)', 'Imitation (BC, ACT, DP)'], rows: [
            ['Datos', 'On-policy, se tiran tras K épocas', 'On-policy, un paso por batch', 'On-policy, un paso por batch', 'Replay buffer: reutiliza todo', 'Demostraciones fijas (+ correcciones en DAgger)'],
            ['Eficiencia en muestras', 'Baja', 'Baja', 'Muy baja', 'Alta', 'No usa interacción (usa demos)'],
            ['Tiempo de pared con simulación masiva en GPU', '<b>Excelente</b>: batch enorme, pocas épocas', 'Bueno pero cada paso es caro (CG + búsqueda en línea)', 'Bueno, pero aprende peor', 'Peor: actualizaciones secuenciales, un paso de gradiente por pocos pasos de entorno', '—'],
            ['Estabilidad / tuning', 'Robusta con los detalles correctos', 'Estable, compleja de implementar', 'Alta varianza', 'Sensible (temperatura, Q sobreestimado)', 'Estable; el problema es el covariate shift'],
            ['Acciones', 'Continuas y discretas', 'Ambas', 'Ambas', 'Continuas (SAC discreto existe)', 'Ambas; DP maneja multimodalidad'],
            ['Necesita', 'Simulador + recompensa', 'Simulador + recompensa', 'Simulador + recompensa', 'Recompensa; sirve en el robot real', 'Teleoperación / demostraciones'],
            ['Dónde se usa', 'Locomoción en Isaac Gym/Lab, RLHF, juegos', 'Histórico; base teórica de PPO', 'Docencia, baselines', 'Aprendizaje en el robot real, manipulación con pocas muestras', R`Manipulación (<a href="#imitation">ACT, Diffusion Policy</a>), VLAs (<a href="#pi0">π0</a>)`],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"I pick by where the data comes from. With a fast, parallel simulator and a reward I can write, PPO: sample inefficiency does not matter when samples are free, and it scales to thousands of environments. When every sample is real robot time, an off-policy method like SAC that reuses a replay buffer. When the reward is hard to specify but demonstrations are cheap, imitation learning, and possibly RL fine-tuning on top."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'list', items: [
            R`<b>REINFORCE</b> (${WIL}): el estimador del truco del log con el retorno de Monte Carlo; el baseline ya está en el paper original.`,
            R`<b>Teorema del policy gradient</b> (${SUT}): el gradiente con Q<sup>π</sup> y aproximación de funciones compatible; la base de actor-critic.`,
            R`<b>A2C / A3C</b> (${A3C}): actor-critic con ventajas de k pasos y muchos actores en paralelo (asíncronos en A3C); el estimador de la ec. 10 de PPO.`,
            R`<b>Conservative policy iteration</b> (${KL02}): el objetivo sustituto con el ratio y la idea de mejorar sin alejarse demasiado; de ahí el superíndice CPI en PPO.`,
            R`<b>TRPO</b> (${TRPO}): restricción de KL media ≤ δ resuelta con gradiente conjugado y búsqueda en línea; garantías de mejora monótona en la versión teórica.`,
            R`<b>GAE</b> (${GAE}): el estimador de ventaja exponencial en λ; en el paper, con TRPO para la política y una región de confianza también para el crítico.`,
            R`<b>PPO-clip y PPO-penalty</b> (${PPO}): el recorte del ratio y la KL con β adaptativo.`,
            R`<b>IMPALA / V-trace</b> (${IMPALA}): actor-critic distribuido con corrección off-policy por importance sampling truncado; cuando los actores van un poco atrás del learner.`,
            R`<b>SAC</b> (${SAC}) y <b>TD3</b> (${TD3}): actor-critic off-policy con replay buffer y críticos Q (dos, tomando el mínimo, contra la sobreestimación); SAC maximiza recompensa + entropía con temperatura (auto-)ajustada. El contraste on-policy / off-policy es la pregunta clásica.`,
            R`<b>DQN</b> (${DQN}): value-based, acciones discretas, replay y red objetivo; no escala bien a acciones continuas.`,
            R`<b>Asymmetric actor-critic</b> (${ASYM}): el crítico ve el estado completo del simulador y el actor solo lo que verá en el robot; el crítico no se despliega, así que puede "hacer trampa". Muy usado en sim-to-real.`,
            R`<b>Teacher-student y RMA</b> (${LEE20}; ${RMA}): profesor con información privilegiada, alumno o módulo de adaptación con historia propioceptiva.`,
            R`<b>Dexterous manipulation con PPO a gran escala</b> (${DEXT}; ${RUBIK}): PPO con LSTM, domain randomization (automática en Rubik) y miles de núcleos de CPU.`,
            R`<b>PPO en LLMs, GRPO</b>: el mismo objetivo recortado con KL a la referencia; GRPO quita el crítico y usa la media de un grupo como baseline. Ver <a href="#rlhf-dpo">SFT, RLHF y DPO</a>.`,
          ] },
          { t: 'h3', text: 'Referencias' },
          { t: 'list', items: [
            WIL + '.', SUT + '.', SB + '.', KL02 + '.', TRPO + '.', GAE + '.', PPO + '.', A3C + '.', ENG + '.', D37 + '.', AND + '.', HEND + '.', PARDO + '.',
            RUDIN + '.', ISAAC + '.', TOBIN + '.', PENG + '.', HWANG + '.', LEE20 + '.', RMA + '.', MIKI + '.', RUBIK + '.', DEXT + '.', ASYM + '.', SAC + '.', TD3 + '.', NG99 + '.', AMODEI + '.',
            'Código: CleanRL (<code>ppo_continuous_action.py</code>, <code>ppo_atari.py</code>), rsl_rl 1.0.2 (<code>algorithms/ppo.py</code>), legged_gym (<code>legged_robot_config.py</code>, <code>anymal_c_rough_config.py</code>); documentación de Gymnasium (HalfCheetah: observación 17, acción 6).',
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`RL aparece de tres formas en una entrevista de robótica o de ML: la derivación ("deriva el policy gradient"), el diseño ("entrena la locomoción de un cuadrúpedo de punta a punta") y la depuración ("tu PPO no aprende"). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Derive the policy gradient. Why can you subtract a baseline, and why does it help?',
              junior: 'El gradiente es la derivada de la recompensa respecto de los pesos; se calcula con backprop.',
              senior: R`J(θ) = E<sub>τ∼π<sub>θ</sub></sub>[G(τ)]. Con ∇p = p∇log p, ∇J = E[∇log p<sub>θ</sub>(τ)·G(τ)], y log p<sub>θ</sub>(τ) = log ρ<sub>0</sub> + Σ<sub>t</sub>[log π<sub>θ</sub>(a<sub>t</sub>|s<sub>t</sub>) + log P(s<sub>t+1</sub>|s<sub>t</sub>, a<sub>t</sub>)]: la dinámica no depende de θ y desaparece. Queda E[Σ<sub>t</sub>∇log π(a<sub>t</sub>|s<sub>t</sub>)·Ĝ<sub>t</sub>] con el reward-to-go (por causalidad). Un baseline b(s) no sesga porque E<sub>a</sub>[∇log π(a|s)]·b(s) = b(s)∇Σ<sub>a</sub>π = 0, y con b = V(s) el peso es la ventaja: baja la varianza porque ya no se premian las acciones por estar en un estado bueno. Nunca derivo la recompensa ni el simulador: por eso funciona con recompensas no diferenciables.`,
              say: 'The objective is the expected return over trajectories. Using the log-derivative trick, the gradient becomes the expectation of the gradient of the log-probability of the trajectory times the return, and since the dynamics do not depend on the parameters, only the log-probabilities of the actions remain. Causality lets me use the reward-to-go. Subtracting a state-dependent baseline is unbiased because the expected score function is zero, and using the value function as the baseline turns the weight into the advantage, which removes the variance due to being in a good or bad state.',
              why: 'Se anota el truco del log, la cancelación de la dinámica, reward-to-go, y la prueba de que el baseline no sesga.' },
            { q: 'Explain PPO\'s clipped objective. What happens when the advantage is negative? Does clipping guarantee a trust region?',
              junior: 'Limita el ratio entre 0.8 y 1.2 para que la política no cambie mucho.',
              senior: R`Cada término es min(r·Â, clip(r, 1 − ε, 1 + ε)·Â), con r = π<sub>θ</sub>/π<sub>old</sub>. Con Â &gt; 0 el término deja de crecer pasado 1 + ε: gradiente cero, no se premia subir más esa acción. Con Â &lt; 0 se aplana debajo de 1 − ε. El min lo hace pesimista: si un paso empeoró el objetivo (r &lt; 1 con Â &gt; 0, o r &gt; 1 con Â &lt; 0) el gradiente vuelve entero. No garantiza una trust region: solo apaga gradientes de muestras ya fuera de la banda; las demás pueden seguir empujando y los estados fuera del batch no tienen restricción. Engstrom et al. midieron ratios fuera de la banda en Humanoid. Por eso monitoreo la KL aproximada y corto épocas con un target_kl o adapto el LR (rsl_rl).`,
              say: 'Each sample contributes the minimum of the ratio times the advantage and the clipped ratio times the advantage. For a positive advantage the objective flattens above one plus epsilon, so there is no incentive to push that action further; for a negative advantage it flattens below one minus epsilon. Taking the minimum makes it a pessimistic bound, so changes that make the objective worse are fully penalized. It is not a hard trust region: clipping only zeroes gradients of samples already outside the band, so in practice I also monitor the approximate KL and stop early or adapt the learning rate.',
              why: 'Trampa: "limita el ratio". Se anota el min pesimista, los cuatro casos y que no es una garantía.', trap: true },
            { q: 'What do gamma and lambda control in GAE? How would you choose them?',
              junior: 'γ es el descuento y λ es otro descuento.',
              senior: R`Ambos cambian sesgo por varianza, pero distinto. γ define qué tan lejos mira la política: γ &lt; 1 sesga siempre (optimizas otro problema) y fija un horizonte ≈ 1/(1 − γ) pasos, que depende de la frecuencia de control (0.99 a 50 Hz son ≈ 2 s). λ interpola el estimador de ventaja entre TD de un paso (λ = 0: baja varianza, todo el sesgo del crítico) y Monte Carlo menos V (λ = 1: sin sesgo del crítico, alta varianza); solo sesga si el crítico es malo, por eso el mejor λ sale menor que el mejor γ. Empiezo con 0.99 y 0.95 (PPO, legged_gym), ajusto γ al horizonte físico de la tarea, y bajo λ si la varianza es el problema (explained variance alta, ventajas ruidosas).`,
              say: 'Gamma sets the effective horizon, about one over one minus gamma steps, and introduces bias regardless of the critic, so I choose it from the physical time horizon of the task and the control frequency. Lambda trades off bias and variance in the advantage estimate: zero is the one-step TD error, low variance but biased by the critic; one is the Monte Carlo return minus the value, unbiased but noisy. Lambda only adds bias when the critic is wrong, so its best value is usually lower than gamma\'s. I start from 0.99 and 0.95.',
              why: 'Se anota γ como horizonte (en segundos), λ como interpolación TD ↔ MC, y que λ solo sesga con un crítico malo.' },
            { q: 'Your PPO run does not learn: reward is flat after a few million steps. How do you debug it?',
              junior: 'Pruebo otro learning rate y más pasos.',
              senior: R`Primero descarto bugs, después miro métricas. (1) <b>Entorno</b>: una política al azar y una hecha a mano dan recompensas distintas (si no, la recompensa no informa); observaciones y acciones en rango; done vs truncado bien separados. (2) <b>Pipeline</b>: reproduce una implementación de referencia en una tarea conocida; ventaja con el signo correcto; log-probs del buffer = los recalculados en la primera pasada (ratio = 1 exacto). (3) <b>Métricas</b>: approx KL ≈ 0 y clip fraction ≈ 0 → la política no se mueve (LR bajo, ventajas ≈ 0 por normalizar un batch constante, σ demasiado chico); KL y clip fraction altísimas → pasos grandes (LR, épocas, minibatch chico). Explained variance ≈ 0 → el crítico no aprende (recompensas sin escalar, valores enormes, time-outs como terminales). Entropía que cae a pique → exploración colapsada. (4) <b>Recompensa</b>: demasiado escasa → shaping o curriculum; miro videos para ver si hay un óptimo local ("quedarse quieto"). (5) Siempre varias semillas antes de concluir.`,
              say: 'First I rule out bugs: I check that a random policy and a scripted policy get different rewards, that observations are normalized and actions are in range, that time-out truncations bootstrap while real terminations do not, and that the ratio is exactly one on the first minibatch. Then I read the diagnostics: approximate KL and clip fraction near zero mean the policy is not moving; very high values mean steps are too large. Explained variance near zero means the critic is not learning, usually a reward scale or termination issue. Collapsing entropy means exploration died. If all of that looks healthy, the reward is too sparse or has a local optimum, which I check by watching videos, and I compare across several seeds.',
              why: 'Se anota el orden (bugs → métricas → recompensa), las cuatro métricas con su lectura y los bugs clásicos (signo, done/truncado, normalización).', trap: true },
            { q: 'Design: train a quadruped locomotion policy end to end, from simulation to the real robot.',
              junior: 'Pongo el robot en un simulador, recompensa por avanzar, PPO hasta que camine, y lo cargo en el robot.',
              senior: R`<b>Tarea</b>: seguir comandos de velocidad (v<sub>x</sub>, v<sub>y</sub>, ω<sub>z</sub>) en terreno variado. <b>Simulador</b>: Isaac Gym/Lab (o MuJoCo en GPU) con miles de robots en paralelo; URDF verificado, masas e inercias identificadas, <b>actuator network</b> entrenado con datos del motor real (o PD identificado con latencia). <b>Observación</b>: propiocepción (velocidad y orientación del torso, gravedad proyectada, posiciones y velocidades articulares, acción anterior, comando) + alturas del terreno si hay percepción; ruido medido en el robot. <b>Acción</b>: posiciones objetivo para un PD a 200 Hz; política a 50 Hz. <b>Recompensa</b>: seguir la velocidad + penalizaciones de torque, aceleración, tasa de cambio de acción, colisiones, orientación; tiempo de vuelo de los pies; terminación si el torso toca el suelo. <b>Entrenamiento</b>: PPO (4,096 entornos × 24 pasos, 5 épocas × 4 minibatches, LR adaptativo por KL, bootstrap en time-outs), curriculum de terreno y de comandos, domain randomization (fricción, masa, empujones, latencia, ganancias). <b>Robustez</b>: teacher-student o un crítico asimétrico con información privilegiada; historia propioceptiva para estimar implícitamente el terreno. <b>Validación</b>: métricas por terreno en simulación, videos, prueba en un simulador distinto (sim-to-sim) antes del robot; en el real, colgado → piso plano → terreno, con límites de torque y una parada de emergencia. <b>Iteración</b>: logs del robot real para ajustar randomización e identificación.`,
              say: 'I would define the task as tracking velocity commands, train in a GPU simulator with thousands of parallel robots, and invest first in the actuator model and system identification, because that is where most of the sim-to-real gap lives. The policy sees proprioception, the previous action and the command, plus terrain heights if I have perception, all with realistic noise, and outputs joint position targets for a PD controller at fifty hertz. The reward tracks the commanded velocity with penalties on torque, joint acceleration, action rate and collisions. I train with PPO using large batches, a terrain curriculum and domain randomization of friction, mass, pushes and latency, possibly with a teacher-student setup. Before hardware I test sim to sim, then deploy in stages with torque limits and an emergency stop, and feed the real logs back into the randomization ranges.',
              why: 'Se anota: actuadores e identificación, observación/acción (PD a 50 Hz), recompensa por términos, PPO en paralelo con curriculum y DR, teacher-student, sim-to-sim y despliegue por etapas.', trap: true },
            { q: 'When would you use RL instead of imitation learning for a robot, and when would you combine them?',
              junior: 'RL siempre es mejor porque no necesita datos.',
              senior: R`<b>RL</b> cuando hay un simulador fiel y rápido y la recompensa se escribe fácil (locomoción, equilibrio, tareas donde la física manda y no hay un humano que sepa demostrarlo bien), y cuando quieres superar al demostrador. <b>Imitation</b> cuando la tarea es fácil de demostrar y difícil de recompensar o de simular (manipulación con objetos deformables, cocina, ensamblaje): ${est('decenas a cientos de')} demos con ACT o Diffusion Policy y listo, sin reward engineering ni sim-to-real. <b>Combinar</b>: BC para inicializar la política (evita explorar desde cero con recompensas escasas) y RL para afinar; o RL en simulación para generar demostraciones que destilan a una política visual. Los VLAs (<a href="#pi0">π0</a>, <a href="#openvla">OpenVLA</a>) son imitation a gran escala; RL los afina cada vez más.`,
              say: 'I use reinforcement learning when I have a fast, faithful simulator and a reward that is easy to write, like locomotion, or when I need to exceed the demonstrator. I use imitation learning when the task is easy to demonstrate but hard to reward or to simulate, like deformable object manipulation, where tens to hundreds of demonstrations with ACT or Diffusion Policy get me there without reward engineering. Often I combine them: behavior cloning to initialize and RL to fine-tune, or RL in simulation to generate data for a visual policy.',
              why: 'Se anota simulador + recompensa vs demostraciones, y las combinaciones (BC → RL, destilación).' },
            { q: 'Why is PPO the default in simulation while SAC is often used on real robots?',
              junior: 'Porque SAC es más nuevo.',
              senior: R`Por dónde está el costo. PPO es on-policy: tira los datos tras unas épocas, así que es ineficiente en muestras, pero escala trivialmente a miles de entornos y hace pocos pasos de gradiente grandes: en simulación en GPU las muestras son gratis y gana en tiempo de pared. SAC es off-policy: un replay buffer reutiliza cada transición muchas veces, con varios pasos de gradiente por paso de entorno; es mucho más eficiente en muestras (lo que importa cuando cada muestra es tiempo de robot real), pero no aprovecha igual el paralelismo masivo y es más sensible (sobreestimación de Q, temperatura). El trade-off es muestras contra tiempo de pared y estabilidad.`,
              say: 'It comes down to whether samples or wall-clock time is the bottleneck. PPO is on-policy and discards data after a few epochs, which is sample inefficient but parallelizes trivially to thousands of simulated environments with large batches, so in a GPU simulator it wins on wall-clock time. SAC is off-policy and reuses a replay buffer with many gradient steps per environment step, which is far more sample efficient, so it is attractive when every sample is real robot time.',
              why: 'Se anota on-policy vs off-policy en términos de costo: muestras vs tiempo de pared.' },
            { q: 'Your locomotion policy gets high reward in simulation but the robot drags a leg. What happened and how do you fix it?',
              junior: 'Entreno más tiempo.',
              senior: R`Es reward hacking o, mejor dicho, una recompensa que no penaliza lo que no quiero: arrastrar una pata sigue la velocidad pedida y quizás ahorra torque. Lo confirmo mirando qué términos de la recompensa paga y cuáles no (log por término) y videos. Arreglo: un término explícito (tiempo de vuelo de los pies, contacto de pies, altura del pie en el swing, simetría de la marcha) o una restricción; reviso que las penalizaciones de torque no sean tan grandes que la marcha "barata" gane. Rudin et al. describen exactamente esos artefactos (pata arrastrada, torso muy alto o bajo) hasta afinar los pesos. Y verifico que no sea un artefacto del simulador (fricción irreal que hace barato deslizar).`,
              say: 'That is the reward being satisfied in a way I did not intend: dragging a leg can track the commanded velocity while saving torque. I log each reward term separately and watch videos to see what is being paid for, then add an explicit term for foot clearance or air time, rebalance the torque penalties, and check that unrealistic friction in the simulator is not making sliding cheap.',
              why: 'Se anota recompensa por términos, videos, un término explícito y el simulador como sospechoso.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuántas muestras y pasos de gradiente hace un update de la canónica? ¿Y uno de ANYmal?',
              a: R`Canónica: ${met('samples')} muestras, ${met('grad')} pasos de gradiente con minibatches de ${met('mb')} (${cf('epochs')} épocas × ${cf('minibatches')}). ANYmal: ${met('samples', AN)} muestras, ${met('grad', AN)} pasos con minibatches de ${met('mb', AN)}. ANYmal junta ≈ 48× más datos por update y hace 16× menos pasos de gradiente: batch enorme, pocos pasos.` },
            { q: '¿Cuántos updates hay en el millón de pasos de MuJoCo del paper?',
              a: R`10<sup>6</sup> / ${met('samples')} ≈ ${met('updates')} (CleanRL redondea hacia abajo: <code>num_iterations = total_timesteps // batch_size</code> = 488).` },
            { q: 'La clip fraction es 0.6 y la KL aproximada 0.15 desde el primer update. ¿Qué cambias?',
              a: 'Los pasos son demasiado grandes: la política se aleja mucho de π_old en cada update. Bajar el LR, bajar las épocas o subir el tamaño del minibatch; agregar target_kl para cortar las épocas, o el LR adaptativo de rsl_rl. Revisar también que las ventajas estén normalizadas.' },
            { q: 'La explained variance queda en ≈ 0 durante todo el run. ¿Qué miras?',
              a: 'El crítico no predice los retornos: escala de recompensas (normaliza o escala), time-outs tratados como terminales (el crítico no puede predecir cuándo corta el reloj), observaciones sin normalizar, LR del crítico, o una recompensa tan ruidosa que no hay nada que predecir.' },
            { q: '¿Por qué la canónica no usa bono de entropía y legged_gym sí (0.01)?',
              a: 'En MuJoCo con redes separadas el paper simplemente no lo usa (§6.1) y la σ libre basta para explorar en 1 M pasos. En legged_gym, con batches enormes y miles de robots, la entropía evita que σ colapse temprano mientras el curriculum todavía no llegó a los terrenos difíciles. Es un hiperparámetro de la tarea, no una regla.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el bucle sin mirar; después las cuentas del calculador ("¿qué pasa si…?") y cuatro ejercicios a mano que se piden en entrevistas: GAE, el objetivo recortado, los parámetros de la red y el gradiente de una softmax. Al final, el update de PPO en PyTorch.` },
          { t: 'h3', text: 'Diagrama en blanco: el bucle de PPO' },
          { t: 'blankdiagram', diagram: 'ppo-overview', slots: [
            { node: 'actor', ask: 'label', hint: 'π_θ(a|s)' },
            { node: 'critic', ask: 'label', hint: 'V_φ(s)' },
            { node: 'gae', ask: 'label', hint: 'Σ (γλ)^l δ' },
            { node: 'clip-loss', ask: 'label', hint: 'min(rÂ, clip(r)Â)' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'rl-ppo', pool: 'all', configs: [C, AN] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`Pasas de ${cf('nEnvs')} a 8 entornos en paralelo (mismo horizonte). ¿Por qué factor cambian las muestras por update?`, change: { nEnvs: 8 }, ask: 'samplesPerUpdate',
              explain: '×8: N·T. Con los mismos minibatches, cada minibatch es 8 veces más grande.' },
            { q: 'Mismo cambio, 8 entornos. ¿Y los pasos de gradiente por update?', change: { nEnvs: 8 }, ask: 'gradStepsPerUpdate',
              explain: 'Nada: K × M no depende de cuántas muestras hay; cambia el tamaño de cada minibatch.' },
            { q: R`Bajas las épocas de ${cf('epochs')} a 3. ¿Qué pasa con los pasos de gradiente por update?`, change: { epochs: 3 }, ask: 'gradStepsPerUpdate',
              explain: '×3/10: K × M. Menos reutilización de cada muestra; menos riesgo de alejarse de π_old.' },
            { q: 'Mismo cambio, 3 épocas. ¿Y los MACs del update?', change: { epochs: 3 }, ask: 'updateMacs',
              explain: '×3/10: cada época recorre todas las muestras una vez (forward + backward).' },
            { q: R`Pasas de ${cf('minibatches')} minibatches a 4. ¿Qué pasa con el tamaño del minibatch?`, change: { minibatches: 4 }, ask: 'minibatchSize',
              explain: '×8: N·T / M. Y los pasos de gradiente bajan 8×; los MACs del update no cambian.' },
            { q: R`Duplicas el ancho de las capas ocultas de 64 a 128. ¿Por qué factor cambian los parámetros del actor?`, change: { hidden: 128 }, ask: 'actorParams',
              explain: '≈ ×3.4: la matriz H × H crece ×4, las de entrada y salida ×2 (17·H y H·6): el término cuadrático todavía no domina con H = 64.' },
            { q: R`Acortas el horizonte de ${cf('horizon')} a 512 pasos. ¿Qué pasa con el buffer del rollout?`, change: { horizon: 512 }, ask: 'rolloutBufferBytes',
              explain: '÷4: el buffer guarda N·T muestras.' },
          ] },

          { t: 'h3', text: 'A mano (1): GAE' },
          { t: 'p', html: R`Un rollout de tres pasos: recompensas r = (1, 0, 2), valores del crítico V(s<sub>0</sub>, s<sub>1</sub>, s<sub>2</sub>) = (0.5, 1.0, 0.8) y V(s<sub>3</sub>) = 0.6 para bootstrapear (el episodio sigue). γ = 0.9, λ = 0.5. (a) Calcula los tres δ<sub>t</sub>. (b) Calcula Â<sub>t</sub> con la recursión hacia atrás y los retornos R̂<sub>t</sub>. (c) ¿Qué da Â<sub>0</sub> con λ = 0 y con λ = 1? Comprueba que λ = 1 es el retorno descontado menos V(s<sub>0</sub>). (d) Repite (b) si el episodio <b>terminó</b> en t = 2 (se cayó).` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con NumPy)',
              a: R`(a) δ<sub>0</sub> = 1 + 0.9·1.0 − 0.5 = 1.4; δ<sub>1</sub> = 0 + 0.9·0.8 − 1.0 = −0.28; δ<sub>2</sub> = 2 + 0.9·0.6 − 0.8 = 1.74. (b) γλ = 0.45: Â<sub>2</sub> = 1.74; Â<sub>1</sub> = −0.28 + 0.45·1.74 = 0.503; Â<sub>0</sub> = 1.4 + 0.45·0.503 = 1.62635. Retornos R̂ = Â + V = (2.12635, 1.503, 2.54). (c) λ = 0: Â<sub>0</sub> = δ<sub>0</sub> = 1.4. λ = 1 (γλ = 0.9): Â<sub>1</sub> = −0.28 + 0.9·1.74 = 1.286, Â<sub>0</sub> = 1.4 + 0.9·1.286 = 2.5574; y el retorno descontado con bootstrap es 1 + 0.9·0 + 0.81·2 + 0.729·0.6 = 3.0574, menos V(s<sub>0</sub>) = 0.5: 2.5574. Iguales. (d) Con done en t = 2 no hay bootstrap: δ<sub>2</sub> = 2 − 0.8 = 1.2; Â<sub>1</sub> = −0.28 + 0.45·1.2 = 0.26; Â<sub>0</sub> = 1.4 + 0.45·0.26 = 1.517. Tratar ese corte como terminal cuando era un time-out cambia todas las ventajas hacia atrás.` },
          ] },
          { t: 'h3', text: 'A mano (2): el objetivo recortado' },
          { t: 'p', html: R`ε = 0.2. Para cada par (Â, r), calcula el término min(r·Â, clip(r, 0.8, 1.2)·Â) y su derivada respecto de r: (Â, r) = (+2, 1.5), (+2, 0.7), (+2, 1.1), (−1, 1.5), (−1, 0.7), (−1, 0.9). ¿En cuáles el gradiente es cero, y por qué tiene sentido?` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con autograd de PyTorch)',
              a: R`(+2, 1.5): min(3.0, 2.4) = 2.4, derivada 0. (+2, 0.7): min(1.4, 1.6) = 1.4, derivada 2. (+2, 1.1): dentro de la banda, 2.2, derivada 2. (−1, 1.5): min(−1.5, −1.2) = −1.5, derivada −1. (−1, 0.7): min(−0.7, −0.8) = −0.8, derivada 0. (−1, 0.9): dentro, −0.9, derivada −1. El gradiente se apaga solo cuando la política ya se movió "a favor" de la ventaja más allá de la banda (subió una acción buena más de 20 % o bajó una mala más de 20 %). Cuando se movió en contra, el gradiente queda entero: por eso es una cota pesimista.` },
          ] },
          { t: 'h3', text: 'A mano (3): parámetros y MACs de la red de MuJoCo' },
          { t: 'p', html: R`Actor: 17 → 64 → 64 → 6 con sesgos, más un vector log σ de 6. Crítico: 17 → 64 → 64 → 1. (a) Cuenta los parámetros de cada uno y el total. (b) ¿Cuántos MACs hace el actor por paso (solo las capas lineales)? (c) Repite (a) para el actor de ANYmal: 235 → 512 → 256 → 128 → 12 más log σ.` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con PyTorch)',
              a: R`(a) Actor: 17·64 + 64 = 1,152; 64·64 + 64 = 4,160; 64·6 + 6 = 390; + 6 de log σ = 5,708. Crítico: 1,152 + 4,160 + (64 + 1) = 5,377. Total ${qn('params.total')} (calculador). (b) 17·64 + 64·64 + 64·6 = 1,088 + 4,096 + 384 = 5,568 MACs (el calculador: ${met('actorMacs')}). (c) 235·512 + 512 = ${qn('op.actor-fc1.params', AN)}; 512·256 + 256 = ${qn('op.actor-fc2.params', AN)}; 256·128 + 128 = ${qn('op.actor-fc3.params', AN)}; 128·12 + 12 = 1,548; + 12 de σ = ${met('actorParams', AN)} (calculador). La primera capa pesa más en ANYmal porque la observación (235) es grande; en MuJoCo domina la capa 64 × 64.` },
          ] },
          { t: 'h3', text: 'A mano (4): el gradiente de una política softmax' },
          { t: 'p', html: R`Tres acciones, logits θ = (0, 0, 0). Se muestrea a = 2 (la segunda) con ventaja Â = +2. (a) Calcula ∇<sub>θ</sub>log π(a = 2). (b) ¿Cómo quedan los logits tras un paso de gradiente ascendente con LR 0.1? (c) Comprueba que E<sub>a∼π</sub>[∇log π(a)] = 0 para π = (0.2, 0.5, 0.3).` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con PyTorch)',
              a: R`(a) ∇<sub>θ</sub>log softmax(θ)<sub>a</sub> = e<sub>a</sub> − π = (−⅓, ⅔, −⅓). (b) θ ← θ + 0.1·Â·∇ = (−0.0667, +0.1333, −0.0667): sube la acción tomada y bajan las otras, y π(a = 2) pasa de 0.333 a ≈ 0.379. (c) Σ<sub>a</sub>π(a)(e<sub>a</sub> − π) = π − π·Σ<sub>a</sub>π(a) = π − π = 0: por eso restar un baseline que no depende de a no sesga el gradiente.` },
          ] },

          { t: 'h3', text: 'Escríbelo: el update de PPO en PyTorch' },
          { t: 'p', html: R`Sin mirar: (1) <code>gae</code> con la recursión hacia atrás y la máscara de done; (2) <code>ppo_loss</code> con el ratio por log-probs, la pérdida recortada, la del valor y la entropía, y las métricas de depuración (approx KL, clip fraction, explained variance); (3) el bucle de K épocas × M minibatches barajados. Verificado: con los números del ejercicio (1) la función da Â = (1.62635, 0.503, 1.74); en la primera pasada el ratio es 1 exacto, la KL 0 y la clip fraction 0; y la expresión recortada de <code>ppo_loss</code>, aplicada a los pares del ejercicio (2) sin normalizar Â, da los mismos valores.` },
          { t: 'code', title: 'Solución de referencia (PyTorch, al estilo CleanRL)', files: [
            { name: 'ppo_update.py', lang: 'python', code: R`import torch
import torch.nn as nn
from torch.distributions import Normal


def mlp(i, o, h=64, out_std=1.0):
    def init(l, std):
        nn.init.orthogonal_(l.weight, std); nn.init.zeros_(l.bias); return l
    return nn.Sequential(init(nn.Linear(i, h), 2 ** 0.5), nn.Tanh(),
                         init(nn.Linear(h, h), 2 ** 0.5), nn.Tanh(),
                         init(nn.Linear(h, o), out_std))


class ActorCritic(nn.Module):
    def __init__(self, obs_dim=17, act_dim=6, h=64):
        super().__init__()
        self.mu = mlp(obs_dim, act_dim, h, out_std=0.01)     # política inicial ≈ 0 en todos los estados
        self.v = mlp(obs_dim, 1, h, out_std=1.0)
        self.log_std = nn.Parameter(torch.zeros(act_dim))     # σ independiente del estado

    def dist(self, s):
        return Normal(self.mu(s), self.log_std.exp())


@torch.no_grad()
def gae(r, v, v_last, done, gamma=0.99, lam=0.95):
    """r, v, done: [T, N]; v_last: [N]. done[t] = 1 si el episodio TERMINÓ en t (no si se truncó)."""
    T = r.shape[0]
    adv = torch.zeros_like(r)
    last = torch.zeros_like(v_last)
    for t in reversed(range(T)):
        nv = v_last if t == T - 1 else v[t + 1]
        nonterm = 1.0 - done[t]
        delta = r[t] + gamma * nv * nonterm - v[t]             # δ_t
        last = delta + gamma * lam * nonterm * last             # Â_t = δ_t + γλ Â_{t+1}
        adv[t] = last
    return adv, adv + v                                         # ventajas y retornos R̂ = Â + V


def ppo_loss(ac, s, a, logp_old, adv, ret, eps=0.2, c1=0.5, c2=0.0):
    d = ac.dist(s)
    logp = d.log_prob(a).sum(-1)
    log_ratio = logp - logp_old
    ratio = log_ratio.exp()
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)               # normalizar por minibatch
    pg = -torch.min(ratio * adv, ratio.clamp(1 - eps, 1 + eps) * adv).mean()
    v = ac.v(s).squeeze(-1)
    v_loss = 0.5 * ((v - ret) ** 2).mean()
    ent = d.entropy().sum(-1).mean()
    with torch.no_grad():
        stats = {'approx_kl': ((ratio - 1) - log_ratio).mean().item(),       # estimador k3
                 'clipfrac': ((ratio - 1).abs() > eps).float().mean().item(),
                 'explained_var': (1 - (ret - v).var() / ret.var()).item()}
    return pg + c1 * v_loss - c2 * ent, stats


def update(ac, opt, batch, epochs=10, minibatches=32, max_grad_norm=0.5):
    s, a, logp_old, adv, ret = batch                            # ya aplanados: [N·T, …]
    n = s.shape[0]
    for _ in range(epochs):                                     # K épocas
        perm = torch.randperm(n)
        for idx in perm.chunk(minibatches):                     # M minibatches barajados
            loss, stats = ppo_loss(ac, s[idx], a[idx], logp_old[idx], adv[idx], ret[idx])
            opt.zero_grad(); loss.backward()
            nn.utils.clip_grad_norm_(ac.parameters(), max_grad_norm)
            opt.step()
    return stats


if __name__ == '__main__':
    r = torch.tensor([[1.0], [0.0], [2.0]]); v = torch.tensor([[0.5], [1.0], [0.8]])
    adv, ret = gae(r, v, torch.tensor([0.6]), torch.zeros(3, 1), gamma=0.9, lam=0.5)
    print(adv.flatten().tolist())                              # [1.62635, 0.503, 1.74]
    ac = ActorCritic()
    print(sum(p.numel() for p in ac.mu.parameters()) + 6, sum(p.numel() for p in ac.v.parameters()))  # 5708 5377
    s = torch.randn(2048, 17)
    with torch.no_grad():
        d = ac.dist(s); a = d.sample(); logp_old = d.log_prob(a).sum(-1)
    _, st = ppo_loss(ac, s, a, logp_old, torch.randn(2048), torch.randn(2048))
    print(st)                                                  # approx_kl 0.0, clipfrac 0.0 en la primera pasada
` },
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. El otro camino a una política: <a href="#imitation">imitation learning</a>. El mismo PPO sobre tokens: <a href="#rlhf-dpo">RLHF</a>.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'rl-ppo-01', kind: 'concepto', q: 'Retorno, V, Q y ventaja.', a: 'G_t = Σ γ^k r_{t+k}; V(s) = E[G | s]; Q(s, a) = E[G | s, a]; A(s, a) = Q(s, a) − V(s): cuánto mejor es esa acción que la política promedio en ese estado.' },
      { id: 'rl-ppo-02', kind: 'conteo', q: 'Horizonte efectivo de γ = 0.99, en pasos y a 50 Hz.', a: '≈ 1/(1 − γ) = 100 pasos ≈ 2 s a 50 Hz. El mismo γ es otra tarea si cambias la frecuencia de control.' },
      { id: 'rl-ppo-03', kind: 'formula', q: 'El log-derivative trick.', a: R`\(\nabla_\theta \mathbb E_{p_\theta}[f] = \mathbb E_{p_\theta}[f\,\nabla_\theta \log p_\theta]\): convierte la derivada de una distribución en una esperanza que se estima con muestras.` },
      { id: 'rl-ppo-04', kind: 'concepto', q: '¿Por qué la dinámica del entorno no aparece en el policy gradient?', a: 'log p_θ(τ) = log ρ₀ + Σ[log π_θ(a_t|s_t) + log P(s_{t+1}|s_t, a_t)]: P y ρ₀ no dependen de θ y desaparecen al derivar. Por eso es model-free y no hace falta derivar el simulador ni la recompensa.' },
      { id: 'rl-ppo-05', kind: 'formula', q: 'Estimador de REINFORCE con reward-to-go.', a: R`\(\nabla J = \mathbb E[\sum_t \nabla\log\pi_\theta(a_t\mid s_t)\,\hat G_t]\), \(\hat G_t=\sum_{k\ge t}\gamma^{k-t}r_k\). Las recompensas anteriores a t se omiten por causalidad (esperanza cero, solo ruido).` },
      { id: 'rl-ppo-06', kind: 'concepto', q: '¿Por qué un baseline b(s) no sesga el gradiente?', a: 'E_a[∇log π(a|s)]·b(s) = b(s)·∇Σ_a π(a|s) = b(s)·∇1 = 0. Solo baja la varianza.' },
      { id: 'rl-ppo-07', kind: 'formula', q: 'Gradiente de log softmax respecto de los logits.', a: '∇_θ log π(a) = e_a − π: sube el logit de la acción tomada y baja los demás en proporción a su probabilidad.' },
      { id: 'rl-ppo-08', kind: 'formula', q: '∇ de log N(a; μ, σ²) respecto de μ.', a: '(a − μ)/σ². Con μ = 0, σ = 0.5 y a = 0.3: 1.2.' },
      { id: 'rl-ppo-09', kind: 'formula', q: 'Error de TD.', a: 'δ_t = r_t + γV(s_{t+1}) − V(s_t). Con V exacto, E[δ_t] = A(s_t, a_t); con V aproximado, tiene sesgo pero mucha menos varianza que el retorno completo.' },
      { id: 'rl-ppo-10', kind: 'formula', q: 'GAE.', a: R`\(\hat A_t=\sum_{l\ge0}(\gamma\lambda)^l\delta_{t+l}\); en código, hacia atrás: Â_t = δ_t + γλ(1 − done_t)Â_{t+1}; R̂_t = Â_t + V(s_t).` },
      { id: 'rl-ppo-11', kind: 'concepto', q: 'GAE con λ = 0 y con λ = 1.', a: 'λ = 0: Â = δ_t (TD de un paso: baja varianza, sesgo del crítico). λ = 1: retorno Monte Carlo menos V(s_t) (sin sesgo del crítico, alta varianza).' },
      { id: 'rl-ppo-12', kind: 'tradeoff', q: 'γ vs λ: ¿cuál sesga siempre?', a: 'γ &lt; 1 sesga siempre (cambia el problema). λ &lt; 1 solo sesga si el crítico es inexacto; por eso el mejor λ sale menor que el mejor γ (paper de GAE).' },
      { id: 'rl-ppo-13', kind: 'trampa', q: '"Un time-out es un done como cualquier otro."', a: 'Si se cortó por tiempo, el robot seguía vivo: hay que bootstrapear con γ·V(s_{t+1}). Tratarlo como terminal enseña al crítico un final que no puede predecir; Rudin et al. reportan ≈ 10–20 % más recompensa al corregirlo.' },
      { id: 'rl-ppo-14', kind: 'concepto', q: 'Restricción de TRPO.', a: 'Maximizar E[r_t·Â_t] sujeto a KL media(π_old ‖ π_θ) ≤ δ, resuelto con gradiente conjugado (productos Fisher-vector) y búsqueda en línea.' },
      { id: 'rl-ppo-15', kind: 'conteo', q: 'PPO-clip con ε = 0.2: valor y derivada del término para Â = +2, r = 1.5, y para Â = +2, r = 0.7.', a: 'r = 1.5: min(3.0, 2.4) = 2.4, derivada 0. r = 0.7: min(1.4, 1.6) = 1.4, derivada 2 (el paso que empeoró se corrige entero).' },
      { id: 'rl-ppo-16', kind: 'trampa', q: '"El clip de PPO garantiza que la política nueva queda dentro de 1 ± ε."', a: 'No: solo apaga el gradiente de las muestras que ya salieron. Otras muestras pueden seguir empujando y los estados fuera del batch no tienen restricción. Engstrom et al. midieron ratios fuera de la banda; se vigila la KL.' },
      { id: 'rl-ppo-17', kind: 'concepto', q: 'PPO-penalty: regla del β adaptativo.', a: 'Tras cada update, con d = KL medida: si d &lt; d_targ/1.5, β ← β/2; si d &gt; 1.5·d_targ, β ← 2β.' },
      { id: 'rl-ppo-18', kind: 'conteo', q: 'Tabla 1 de PPO: puntaje normalizado sin clip ni penalización vs clip ε = 0.2.', a: '−0.39 vs 0.82 (7 entornos de MuJoCo × 3 semillas). Varias épocas sin restricción destruyen la política.' },
      { id: 'rl-ppo-19', kind: 'formula', q: 'Objetivo completo de PPO (ec. 9).', a: 'E[L^CLIP − c₁(V_θ(s) − V^targ)² + c₂·H[π_θ](s)]; c₁ solo importa si actor y crítico comparten parámetros.' },
      { id: 'rl-ppo-20', kind: 'conteo', q: 'Hiperparámetros de PPO en MuJoCo (Tabla 3).', a: 'Horizonte 2048, Adam 3e-4, 10 épocas, minibatch 64, γ 0.99, λ 0.95; ε 0.2; MLP 64-64 tanh separados, sin entropía.' },
      { id: 'rl-ppo-21', kind: 'conteo', q: 'Hiperparámetros de PPO en Atari (Tabla 5).', a: '8 actores × 128 pasos, 3 épocas, minibatch 32 × 8, ε 0.1·α, LR 2.5e-4·α (α de 1 a 0 lineal), c₁ = 1, c₂ = 0.01, CNN compartida.' },
      { id: 'rl-ppo-22', kind: 'conteo', q: 'Parámetros de actor y crítico 64-64 en HalfCheetah (obs 17, acción 6).', a: R`Actor 5,708 (con 6 de log σ), crítico 5,377; total ${qn('params.total')}.` },
      { id: 'rl-ppo-23', kind: 'conteo', q: 'Muestras y pasos de gradiente por update en ANYmal (legged_gym).', a: R`${met('samples', AN)} muestras (4,096 × 24); ${met('grad', AN)} pasos (5 épocas × 4 minibatches de ${met('mb', AN)}).` },
      { id: 'rl-ppo-24', kind: 'concepto', q: 'Rudin et al. (CoRL 2021) en una línea.', a: 'PPO con 4,096 ANYmal en Isaac Gym en una GPU: terreno plano en &lt; 4 min, irregular en ≈ 20 min, transferido al robot real; batch grande, horizonte corto, curriculum de terreno, bootstrap en time-outs.' },
      { id: 'rl-ppo-25', kind: 'trampa', q: '"Con miles de entornos, cuantos menos pasos por entorno mejor (más diversidad)."', a: 'GAE necesita trayectorias coherentes: Rudin et al. ven que el entrenamiento sufre por debajo de ≈ 25 pasos (0.5 s) por robot y que demasiados robots con batch fijo bajan el rendimiento.' },
      { id: 'rl-ppo-26', kind: 'concepto', q: 'LR adaptativo de rsl_rl.', a: 'Si KL &gt; 2·0.01: LR ÷ 1.5; si KL &lt; 0.01/2: LR × 1.5; acotado a [1e-5, 1e-2].' },
      { id: 'rl-ppo-27', kind: 'concepto', q: 'Hallazgo central de Engstrom et al. (ICLR 2020).', a: 'Los detalles de código (escalado de recompensas, init ortogonal, annealing del LR…) explican la mayor parte de la ventaja de PPO sobre TRPO: TRPO con ellos rinde como PPO, PPO sin ellos como TRPO.' },
      { id: 'rl-ppo-28', kind: 'concepto', q: 'Cinco detalles de implementación de PPO que hay que tener.', a: 'Normalizar ventajas por minibatch, normalizar (y recortar) observaciones, escalar recompensas, init ortogonal con salida de política 0.01, annealing o LR adaptativo; más recorte del gradiente y bootstrap en time-outs.' },
      { id: 'rl-ppo-29', kind: 'trampa', q: '"El clip de la pérdida del valor es parte de PPO y ayuda."', a: 'No está en el paper; lo agregó la implementación de baselines. Andrychowicz et al. (ICLR 2021) recomiendan no usarlo.' },
      { id: 'rl-ppo-30', kind: 'concepto', q: 'Las cuatro métricas para depurar PPO.', a: 'approx KL (tamaño del paso), clip fraction (cuánto actúa el clip), explained variance (calidad del crítico), entropía / σ (exploración). Más value loss y la recompensa por episodio con videos.' },
      { id: 'rl-ppo-31', kind: 'formula', q: 'Explained variance del crítico.', a: '1 − Var(R̂ − V)/Var(R̂). ≈ 1: el crítico explica los retornos; ≈ 0 o negativa: ventajas casi ruido.' },
      { id: 'rl-ppo-32', kind: 'formula', q: 'Estimador k3 de la KL que registra CleanRL.', a: 'approx_kl = E[(r − 1) − log r], con r = π_θ/π_old: no negativo y de baja varianza.' },
      { id: 'rl-ppo-33', kind: 'tradeoff', q: 'PPO vs SAC.', a: 'PPO: on-policy, ineficiente en muestras, escala a miles de entornos, gana en tiempo de pared en simulación. SAC: off-policy con replay buffer, eficiente en muestras, preferido cuando cada muestra es tiempo de robot real.' },
      { id: 'rl-ppo-34', kind: 'tradeoff', q: 'RL vs imitation learning para un robot.', a: 'RL: simulador fiel y recompensa fácil de escribir (locomoción), o superar al demostrador. Imitation: tarea fácil de demostrar y difícil de recompensar o simular. Combinar: BC para inicializar, RL para afinar.' },
      { id: 'rl-ppo-35', kind: 'concepto', q: 'Domain randomization.', a: 'Muestrear al azar parámetros del simulador (fricción, masas, latencias, texturas, empujones) en cada episodio para que el mundo real sea "otra variación" (Tobin et al. 2017; Peng et al. 2018).' },
      { id: 'rl-ppo-36', kind: 'concepto', q: 'Actuator network.', a: 'Red entrenada con datos del motor real que predice el torque desde la historia de errores de posición y velocidades; reemplaza al motor ideal en el simulador (Hwangbo et al. 2019; LSTM del ANYdrive en legged_gym).' },
      { id: 'rl-ppo-37', kind: 'concepto', q: 'Teacher-student en locomoción.', a: 'Un profesor entrenado con RL y estado privilegiado del simulador; un alumno que lo imita usando solo sensores reales y una historia (Lee et al. 2020; RMA estima los parámetros del entorno en línea).' },
      { id: 'rl-ppo-38', kind: 'concepto', q: 'Asymmetric actor-critic.', a: 'El crítico ve el estado completo del simulador y el actor solo las observaciones del robot; como el crítico no se despliega, puede usar información privilegiada.' },
      { id: 'rl-ppo-39', kind: 'trampa', q: '"Despliego la política estocástica porque es más robusta."', a: 'El ruido era exploración: en el robot se usa la media. La robustez se entrena con domain randomization y ruido de observación.' },
      { id: 'rl-ppo-40', kind: 'concepto', q: 'Por qué la política de legged_gym da posiciones objetivo y no torques.', a: 'Un PD a 200 Hz absorbe la dinámica rápida y la política decide a 50 Hz; es más fácil de aprender y de transferir.' },
      { id: 'rl-ppo-41', kind: 'concepto', q: 'Potential-based reward shaping.', a: 'Sumar F = γΦ(s′) − Φ(s) acelera el aprendizaje sin cambiar la política óptima (Ng, Harada y Russell 1999).' },
      { id: 'rl-ppo-42', kind: 'trampa', q: '"Si la recompensa por paso es negativa, terminar el episodio es un castigo."', a: 'Al revés: terminar corta una suma de negativos y la política aprende a terminar a propósito. Recompensas por paso ≥ 0 (only_positive_rewards en legged_gym) o un costo explícito de terminar.' },
      { id: 'rl-ppo-43', kind: 'trampa', q: '"Para entrenar más rápido, achico la red de la política."', a: 'En RL para robots la red cuesta casi nada; el tiempo se va en simular. Se acelera con más entornos en paralelo (física en GPU), no con una red más chica.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'Markov decision process (MDP)', es: 'proceso de decisión de Markov', def: 'Estados, acciones, transición, recompensa y descuento; el estado resume todo lo que importa del pasado.', say: 'We model locomotion as an MDP with a fifty hertz control step.' },
      { en: 'discounted return', es: 'retorno descontado', def: 'Suma de recompensas futuras pesadas por γ^k; su esperanza es lo que la política maximiza.', say: 'With gamma 0.99 the effective horizon is about a hundred steps.' },
      { en: 'advantage function', es: 'función de ventaja', def: 'A(s, a) = Q(s, a) − V(s): cuánto mejor es una acción que el promedio de la política en ese estado.', say: 'The policy gradient is weighted by the advantage, not the raw return.' },
      { en: 'policy gradient (REINFORCE)', es: 'gradiente de la política', def: 'Estimador ∇J = E[Σ ∇log π(a|s)·Ĝ] obtenido con el log-derivative trick; no deriva ni la recompensa ni la dinámica.', say: 'REINFORCE is unbiased but has very high variance.' },
      { en: 'baseline', es: 'línea de base', def: 'Función del estado que se resta del retorno en policy gradient; no sesga y reduce la varianza. La habitual es V(s).', say: 'Subtracting the value function as a baseline gives the advantage.' },
      { en: 'actor-critic', es: 'actor-crítico', def: 'Método con una política (actor) y una red de valor (crítico) que estima ventajas para el actor.', say: 'PPO is an on-policy actor-critic method.' },
      { en: 'temporal-difference error (TD error)', es: 'error de diferencia temporal', def: 'δ_t = r_t + γV(s_{t+1}) − V(s_t): la sorpresa de un paso según el crítico.', say: 'GAE is an exponentially weighted sum of TD errors.' },
      { en: 'generalized advantage estimation (GAE)', es: 'estimación generalizada de la ventaja', def: 'Â_t = Σ (γλ)^l δ_{t+l}; λ interpola entre TD de un paso y Monte Carlo.', say: 'We use GAE with lambda 0.95.' },
      { en: 'trust region (TRPO)', es: 'región de confianza', def: 'Limitar cuánto cambia la política en un update (KL media ≤ δ en TRPO) para que el objetivo sustituto siga siendo válido.', say: 'PPO approximates TRPO\'s trust region with a clipped ratio.' },
      { en: 'clipped surrogate objective', es: 'objetivo sustituto recortado', def: 'min(r·Â, clip(r, 1 − ε, 1 + ε)·Â) con r = π_θ/π_old: el objetivo de PPO.', say: 'The clipped surrogate removes the incentive to move the ratio outside one plus or minus epsilon.' },
      { en: 'entropy bonus', es: 'bono de entropía', def: 'Término c₂·H[π] que premia mantener la política estocástica para seguir explorando.', say: 'An entropy coefficient of 0.01 kept exploration alive.' },
      { en: 'explained variance', es: 'varianza explicada', def: '1 − Var(R̂ − V)/Var(R̂): qué tan bien predice el crítico los retornos.', say: 'Explained variance near zero means the critic is not learning.' },
      { en: 'clip fraction', es: 'fracción recortada', def: 'Fracción de muestras del minibatch con |r − 1| > ε; mide cuánto actúa el clip.', say: 'A clip fraction of sixty percent means the updates are too large.' },
      { en: 'time-out bootstrapping', es: 'bootstrap en cortes por tiempo', def: 'En un corte por límite de tiempo, usar γ·V(s) como valor futuro en vez de tratarlo como terminal.', say: 'We bootstrap on time-outs and only zero the value on real terminations.' },
      { en: 'massively parallel simulation', es: 'simulación masivamente paralela', def: 'Miles de entornos simulados a la vez en una GPU (Isaac Gym), con la red en la misma GPU.', say: 'We train with four thousand parallel robots on one GPU.' },
      { en: 'domain randomization', es: 'aleatorización del dominio', def: 'Muestrear parámetros del simulador al azar en cada episodio para que la política transfiera al mundo real.', say: 'We randomize friction, mass, pushes and latency.' },
      { en: 'sim-to-real gap', es: 'brecha simulación-realidad', def: 'Diferencia entre el simulador y el robot real (actuadores, latencia, contactos, sensores) que rompe políticas entrenadas en simulación.', say: 'Most of the sim-to-real gap was in the actuators.' },
      { en: 'actuator network', es: 'red del actuador', def: 'Modelo aprendido del motor real (comando → torque) que reemplaza al actuador ideal dentro del simulador.', say: 'An actuator network trained on logged motor data closed the gap.' },
      { en: 'specification gaming', es: 'juego de la especificación', def: 'La política maximiza la recompensa escrita de una forma no deseada (reward hacking en control).', say: 'The policy found a specification gaming exploit, dragging its body forward.' },
      { en: 'teacher-student training', es: 'entrenamiento profesor-alumno', def: 'Un profesor con información privilegiada del simulador y un alumno que lo imita solo con sensores reales.', say: 'The student policy only sees proprioception history.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
