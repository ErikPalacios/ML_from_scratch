/* =============================================================================
   Atlas de Arquitecturas — js/content/stable-diffusion.js
   Página de modelo: Stable Diffusion 1.5 = latent diffusion (Rombach et al., CVPR 2022, arXiv:2112.10752)
   con una U-Net condicionada por texto (CLIP ViT-L/14). Canónica sd15-unet (512×512 → latente 64×64×4).
   Plantilla fija de 11 secciones (SPEC §5.3). Tesis de la fase (SPEC §20): generar = aprender a deshacer
   ruido con una regresión (predecir ε), aplicada muchas veces al muestrear; el latente del VAE lo hace
   pagable; el texto entra por cross-attention. DiT, adaLN, flow matching y SD3/MMDiT viven en
   js/content/dit.js: aquí solo se enlazan.
   Regla: ningún número de la arquitectura se escribe a mano. Formas, parámetros, MACs y bytes salen del
   calculador (js/arch/diffusion.js; bloques op/trace/params/flops/scaling/compare y cantidades
   {{config.ruta}}, SPEC §6.6). Datos y recetas citan paper (sección/tabla) o model card; estimaciones con
   est() y la fórmula al lado. Los dos ejercicios de código se verificaron en el venv del Atlas
   (PyTorch 2.14, diffusers 0.41) contra DDPMScheduler.add_noise y DDIMScheduler.step con la config de
   SD 1.5 (scratchpad f8-sd/check_train.py y check_ddim.py). Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/diffusion.js).
  const C = 'sd15-unet';
  const XL = 'sdxl-unet';
  const DT = 'dit-xl2-256';

  // Claves de metrics() (SPEC §20.3). Un solo lugar para adaptarlas.
  const MK = {
    pU: 'unetParams', pV: 'vaeParams', pT: 'textEncoderParams',
    mU: 'unetMacs', mT: 'textEncoderMacs', mVd: 'vaeDecoderMacs', mVe: 'vaeEncoderMacs',
    mImg: 'samplingMacs', comp: 'compressionFactor',
  };
  // Tensores: nombre corto de la página → id del calculador.
  const TN = {
    img: 'image', lat: 'z-t', zt: 'z-t', ids: 'prompt-ids', ctx: 'text-emb', temb: 'temb',
    eps: 'eps-hat', out: 'image',
  };
  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const sh = (id, cfg) => qn('tensor.' + (TN[id] || id) + '.shape', cfg);
  const sy = (id, cfg) => qn('tensor.' + (TN[id] || id) + '.sym', cfg);
  const np = (id, cfg) => qn('node.' + id + '.params', cfg);
  const nM = (id, cfg) => qn('node.' + id + '.paramsM', cfg);
  const nG = (id, cfg) => qn('node.' + id + '.macsG', cfg);
  const nPct = (id, cfg) => qn('node.' + id + '.macsPct', cfg);
  // scaling_factor del VAE (vae/config.json de SD 1.5): constante de la config, no un conteo; {{cfg.scaling}} se redondea a entero.
  const SCALE = '0.18215';

  const LDM = 'Rombach, Blattmann, Lorenz, Esser y Ommer, <i>High-Resolution Image Synthesis with Latent Diffusion Models</i>, CVPR 2022, arXiv:2112.10752';
  const DDPM = 'Ho, Jain y Abbeel, <i>Denoising Diffusion Probabilistic Models</i>, NeurIPS 2020, arXiv:2006.11239';
  const DDIM = 'Song, Meng y Ermon, <i>Denoising Diffusion Implicit Models</i>, ICLR 2021, arXiv:2010.02502';
  const CFG = 'Ho y Salimans, <i>Classifier-Free Diffusion Guidance</i>, arXiv:2207.12598 (versión corta en el NeurIPS 2021 Workshop on Deep Generative Models)';
  const CARD = 'model card de Stable Diffusion v1-5 (Hugging Face, <code>stable-diffusion-v1-5/stable-diffusion-v1-5</code>)';
  const LAION = 'Schuhmann et al., <i>LAION-5B: An open large-scale dataset for training next generation image-text models</i>, NeurIPS 2022 (Datasets and Benchmarks), arXiv:2210.08402';
  const ZSNR = 'Lin, Liu, Li y Yang, <i>Common Diffusion Noise Schedules and Sample Steps are Flawed</i>, WACV 2024, arXiv:2305.08891';
  const VPRED = 'Salimans y Ho, <i>Progressive Distillation for Fast Sampling of Diffusion Models</i>, ICLR 2022, arXiv:2202.00512';
  const SDXL = 'Podell et al., <i>SDXL: Improving Latent Diffusion Models for High-Resolution Image Synthesis</i>, ICLR 2024, arXiv:2307.01952';
  const LCM = 'Luo et al., <i>Latent Consistency Models: Synthesizing High-Resolution Images with Few-Step Inference</i>, arXiv:2310.04378 (2023)';
  const ADD = 'Sauer, Lorenz, Blattmann y Rombach, <i>Adversarial Diffusion Distillation</i>, ECCV 2024, arXiv:2311.17042';
  const CNET = 'Zhang, Rao y Agrawala, <i>Adding Conditional Control to Text-to-Image Diffusion Models</i> (ControlNet), ICCV 2023, arXiv:2302.05543';
  const DB = 'Ruiz et al., <i>DreamBooth: Fine Tuning Text-to-Image Diffusion Models for Subject-Driven Generation</i>, CVPR 2023, arXiv:2208.12242';
  const TI = 'Gal et al., <i>An Image is Worth One Word: Personalizing Text-to-Image Generation using Textual Inversion</i>, ICLR 2023, arXiv:2208.01618';
  const LORA = 'Hu et al., <i>LoRA: Low-Rank Adaptation of Large Language Models</i>, ICLR 2022, arXiv:2106.09685';
  const CARLINI = 'Carlini et al., <i>Extracting Training Data from Diffusion Models</i>, USENIX Security 2023, arXiv:2301.13188';
  const DPMS = 'Lu et al., <i>DPM-Solver</i>, NeurIPS 2022, arXiv:2206.00927; <i>DPM-Solver++</i>, arXiv:2211.01095';
  const EDM = 'Karras, Aittala, Aila y Laine, <i>Elucidating the Design Space of Diffusion-Based Generative Models</i> (EDM), NeurIPS 2022, arXiv:2206.00364';
  const PNDM = 'Liu et al., <i>Pseudo Numerical Methods for Diffusion Models on Manifolds</i> (PNDM), ICLR 2022, arXiv:2202.09778';
  const SDEDIT = 'Meng et al., <i>SDEdit: Guided Image Synthesis and Editing with Stochastic Differential Equations</i>, ICLR 2022, arXiv:2108.01073';
  const TOME = 'Bolya y Hoffman, <i>Token Merging for Fast Stable Diffusion</i>, arXiv:2303.17604 (2023)';
  const DEEPC = 'Ma, Fang y Wang, <i>DeepCache: Accelerating Diffusion Models for Free</i>, CVPR 2024, arXiv:2312.00858';
  const FID = 'Heusel et al., <i>GANs Trained by a Two Time-Scale Update Rule Converge to a Local Nash Equilibrium</i> (FID), NeurIPS 2017, arXiv:1706.08500';
  const CLIPS = 'Hessel et al., <i>CLIPScore: A Reference-free Evaluation Metric for Image Captioning</i>, EMNLP 2021, arXiv:2104.08718';
  const CLEANFID = 'Parmar, Zhang y Zhu, <i>On Aliased Resizing and Surprising Subtleties in GAN Evaluation</i> (clean-fid), CVPR 2022, arXiv:2104.11222';
  const GENEVAL = 'Ghosh, Hajishirzi y Schmidt, <i>GenEval: An Object-Focused Framework for Evaluating Text-to-Image Alignment</i>, NeurIPS 2023 (Datasets and Benchmarks), arXiv:2310.11513';
  const IMAGEN = 'Saharia et al., <i>Photorealistic Text-to-Image Diffusion Models with Deep Language Understanding</i> (Imagen), NeurIPS 2022, arXiv:2205.11487';
  const PARTI = 'Yu et al., <i>Scaling Autoregressive Models for Content-Rich Text-to-Image Generation</i> (Parti), TMLR 2022, arXiv:2206.10789';
  const BOW = 'Yuksekgonul et al., <i>When and why vision-language models behave like bags-of-words, and what to do about it?</i>, ICLR 2023, arXiv:2210.01936';
  const MINSNR = 'Hang et al., <i>Efficient Diffusion Training via Min-SNR Weighting Strategy</i>, ICCV 2023, arXiv:2303.09556';
  const ADM = 'Dhariwal y Nichol, <i>Diffusion Models Beat GANs on Image Synthesis</i> (classifier guidance), NeurIPS 2021, arXiv:2105.05233';
  const GINT = 'Kynkäänniemi et al., <i>Applying Guidance in a Limited Interval Improves Sample and Distribution Quality in Diffusion Models</i>, NeurIPS 2024, arXiv:2404.07724';
  const GDIST = 'Meng et al., <i>On Distillation of Guided Diffusion Models</i>, CVPR 2023, arXiv:2210.03142';
  const CM = 'Song, Dhariwal, Chen y Sutskever, <i>Consistency Models</i>, ICML 2023, arXiv:2303.01469';
  const DMD = 'Yin et al., <i>One-step Diffusion with Distribution Matching Distillation</i> (DMD), CVPR 2024, arXiv:2311.18828';
  const REPAINT = 'Lugmayr et al., <i>RePaint: Inpainting using Denoising Diffusion Probabilistic Models</i>, CVPR 2022, arXiv:2201.09865';
  const DPOL = 'Chi et al., <i>Diffusion Policy: Visuomotor Policy Learning via Action Diffusion</i>, RSS 2023, arXiv:2303.04137';
  const IDDPM = 'Nichol y Dhariwal, <i>Improved Denoising Diffusion Probabilistic Models</i>, ICML 2021, arXiv:2102.09672';
  const FDDINO = 'Stein et al., <i>Exposing flaws of generative model evaluation metrics and their unfair treatment of diffusion models</i> (FD-DINOv2), NeurIPS 2023, arXiv:2306.04675';
  const CMMD = 'Jayasumana et al., <i>Rethinking FID: Towards a Better Evaluation Metric for Image Generation</i> (CMMD), CVPR 2024, arXiv:2401.09603';
  const SOMEP = 'Somepalli et al., <i>Diffusion Art or Digital Forgery? Investigating Data Replication in Diffusion Models</i>, CVPR 2023, arXiv:2212.03860';

  ATLAS.register({
    id: 'stable-diffusion',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> Stable Diffusion recibe un prompt de texto y devuelve una imagen de ${sh('out')}. Para hacerlo parte de <b>ruido puro</b> en un espacio comprimido (un latente de ${sh('lat')}) y lo limpia poco a poco: en cada paso una U-Net mira el latente ruidoso, el número de paso y el texto, y estima <b>qué parte es ruido</b>; un scheduler resta una fracción de ese ruido y repite (≈ 20–50 pasos). Al final, el decoder de un VAE lleva el latente limpio a píxeles.` },
          { t: 'p', html: R`Tres redes, y solo una se entrena con difusión: (1) el <b>text encoder</b> de <a href="#clip">CLIP ViT-L/14</a>, congelado (${met('pT')} parámetros); (2) la <b>U-Net</b> que predice el ruido (${met('pU')}), la única que corre en cada paso; (3) el <b>VAE</b> (${met('pV')}), entrenado antes y por separado: su encoder solo se usa para entrenar (imagen → latente) y su decoder para generar (latente → imagen). La idea del paper es esa separación: comprimir primero, difundir después (${LDM}).` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿Stable Diffusion (o un modelo de difusión latente)?', 'Por qué'], rows: [
            ['Generar imágenes desde texto; variaciones; prototipos visuales', 'Sí', 'Es la tarea para la que se entrenó: p(imagen | texto) con miles de millones de pares de LAION.'],
            ['Editar: img2img, inpainting, control por bordes o pose', 'Sí', R`El mismo modelo sirve: arrancas de una imagen con ruido parcial (SDEdit), de un modelo de inpainting o agregas un <a href="#stable-diffusion.variantes">ControlNet</a>.`],
            ['Personalizar con 5–20 fotos de un producto o una persona', 'Sí', 'LoRA, DreamBooth o textual inversion: horas o minutos de GPU, no un reentrenamiento (ver entrevista).'],
            ['Datos sintéticos para entrenar un detector o un segmentador', 'Con cuidado', 'Las etiquetas no salen gratis (hay que generarlas o controlarlas), y el dominio sintético no es tu cámara: mide en datos reales antes de confiar.'],
            ['Texto legible, logos, conteos exactos ("exactamente 7 tornillos")', 'No tal cual', 'La model card lo lista como limitación ("cannot render legible text") y la composición falla (ver fallas).'],
            ['Una respuesta "correcta" por píxel (segmentación, profundidad)', 'No (salvo adaptado)', 'Es un modelo generativo: muestrea, no estima la única respuesta. Hay trabajos que lo adaptan como backbone, pero no es el uso directo.'],
            ['Tiempo real en un robot (≥ 10 Hz)', 'Difícil', R`Una imagen son decenas de evaluaciones de la U-Net; con destilación (LCM, ADD) se baja a 1–4. Para acciones, la idea se reusa en <a href="#dit">flow matching</a> y Diffusion Policy, con redes mucho más pequeñas.`],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Stable Diffusion is a latent diffusion model. A VAE compresses a 512 by 512 image into a 64 by 64 by 4 latent. A U-Net is trained with a simple MSE loss to predict the noise that was added to a latent at a random noise level, conditioned on the timestep and on CLIP text embeddings through cross-attention. At inference you start from pure noise and run the U-Net twenty to fifty times with a scheduler like DDIM, with classifier-free guidance, which doubles the cost per step, and then decode the latent with the VAE decoder."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Ya conoces la pieza central.</b> Una U-Net de segmentación es un encoder que baja la resolución (convs con stride, como los stages de ResNet), un decoder que la sube, y <b>skip connections</b> que llevan el detalle fino de cada nivel del encoder al nivel del decoder de la misma resolución. Entra una imagen, sale un mapa del mismo tamaño: una predicción por píxel. La U-Net de difusión es <b>la misma forma de red</b>; cambian tres cosas: qué predice, qué entradas extra recibe y dónde trabaja.` },
          { t: 'table', caption: 'Qué equivale a lo que ya sabes y qué es nuevo', head: ['Concepto', 'U-Net de segmentación', 'U-Net de Stable Diffusion', '¿Nuevo?'], rows: [
            ['Forma de la red', 'Encoder ↓ / decoder ↑ con skips', R`Igual: 4 niveles (anchos C, 2C, 4C, 4C con C = ${cf('C')}), skips de cada nivel del encoder al decoder`, 'Igual'],
            ['Salida', 'Logits por píxel (K clases)', R`El ruido ε estimado, con la <b>misma forma que la entrada</b>: ${sh('eps')}`, 'Equivale (regresión densa)'],
            ['Pérdida', 'Cross-entropy por píxel', 'MSE entre el ruido real y el predicho', 'Equivale'],
            ['Normalización', 'BatchNorm', 'GroupNorm (32 grupos): no depende del batch, que es pequeño a 512 px', 'Equivale'],
            ['Entrada extra: el paso t', '—', 'Un embedding sinusoidal de t → MLP → se suma a cada bloque residual (un bias por canal)', '<b>Nuevo</b>'],
            ['Entrada extra: el texto', '—', R`Cross-attention: los tokens del latente preguntan (Q), los ${cf('T')} tokens de CLIP responden (K, V)`, '<b>Nuevo</b>'],
            ['Dónde trabaja', 'Sobre la imagen en píxeles', R`Sobre un latente de ${sh('lat')} que da el encoder de un VAE`, '<b>Nuevo</b>'],
            ['Cómo se usa', 'Una pasada por imagen', 'Decenas de pasadas por imagen (una por paso de denoising)', '<b>Nuevo</b>'],
          ] },
          { t: 'h3', text: 'Difusión en dos minutos, sin matemáticas' },
          { t: 'p', html: R`Toma una foto y agrégale un poquito de ruido gaussiano. Agrega otro poquito, y otro, mil veces: al final es ruido puro, sin rastro de la foto. Ese proceso no se aprende, es una receta fija. Ahora entrena una red para el <b>camino de vuelta</b>: le muestras la foto con ruido en un nivel al azar ("paso 731 de 1000") y le pides que diga <b>cuál fue el ruido</b> que le agregaste. Es una regresión con MSE, como estimar un desplazamiento en detección: estable, sin adversario, sin colapso de modos. Para generar, arrancas de ruido puro y repites: la red estima el ruido, le restas una parte, bajas un nivel. Después de unas decenas de pasos queda una imagen que no existía, pero que se parece a las del entrenamiento. Si además le das un texto a la red, el ruido que estima es "el que separa esto de una imagen de <i>un gato con sombrero</i>", y la imagen termina pareciéndose al texto.` },
          { t: 'h3', text: 'Por qué en el latente y no en píxeles' },
          { t: 'p', html: R`DDPM (${DDPM}) difundía directo en píxeles, a 32×32 (CIFAR-10) y 256×256 (LSUN, CelebA-HQ). A 512×512 cada paso tendría que procesar ${qn('tensor.image.elements')} valores con una red grande, decenas de veces por imagen. El paper de Stable Diffusion separa el problema en dos (${LDM}, §3): un autoencoder aprende la <b>compresión perceptual</b> (quitar detalle de alta frecuencia que no se ve) y la difusión aprende la parte <b>semántica</b> (qué hay en la imagen y dónde) en un espacio ${met('comp')}× más chico: ${sh('img')} → ${sh('lat')} (f = ${cf('f')}: cada lado ÷ ${cf('f')}, ${cf('latentC')} canales). La U-Net nunca ve un píxel.` },
          { t: 'list', items: [
            R`<b>Cuánto comprimir.</b> El paper barre el factor f = 1…32 (§4.1): con f = 1–2 entrena lento (está en píxeles); con f = 32 la calidad se estanca (el autoencoder pierde demasiado). "LDM-4 and -8 offer the best conditions"; SD usa f = 8.`,
            R`<b>Por qué el VAE se entrena aparte.</b> Su pérdida es otra: reconstrucción + una pérdida <b>perceptual</b> (LPIPS) + una <b>adversarial por parches</b> (un discriminador que mira parches de la reconstrucción) + un término <b>KL</b> muy chico (peso ≈ 10⁻⁶, Apéndice G) que solo evita un latente de varianza arbitraria. Con MSE sola las reconstrucciones salen borrosas; con el discriminador salen nítidas. Entrenarlo una vez y congelarlo deja a la difusión un espacio fijo, y el mismo autoencoder sirve para muchos modelos de difusión.`,
            R`<b>"VAE" con matices.</b> El KL es tan chico que en la práctica es un autoencoder casi determinista con un poco de ruido: no se muestrea del prior del VAE. Lo que se usa del encoder es la media (o una muestra con varianza mínima) y, antes de la U-Net, se escala por ${SCALE} para que el latente tenga desviación ≈ 1 (el paper estima 1/σ̂ con el primer batch, Apéndice G; el número es el <code>scaling_factor</code> de la config de diffusers). Olvidar ese factor es un bug clásico.`,
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>El texto entra como en <a href="#repaso-atencion">cross-attention</a>: las queries salen de los tokens de la imagen (cada posición del latente es un token) y las keys/values de los ${cf('T')} tokens que da el text encoder de <a href="#clip">CLIP</a>. Ojo: no es el embedding global de CLIP (el vector proyectado que compara imagen y texto), sino la <b>secuencia</b> de la última capa del transformer de texto, ${sh('ctx')}. En <a href="#dit">DiT</a> la condición entra por otro camino (adaLN), y en SD3 texto e imagen comparten la atención (MMDiT).</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Arriba, el <b>prompt</b> pasa una sola vez por el text encoder: ${sh('ids')} → ${sh('ctx')}. Abajo, el <b>bucle</b>: un latente de ruido ${sh('zt')} entra a la U-Net junto con t y el texto; sale el ruido estimado ${sh('eps')}; el scheduler calcula el latente del paso siguiente y lo devuelve a la U-Net (la flecha de control). Después del último paso, el decoder del VAE da ${sh('out')}. Abre la U-Net para ver sus niveles, y dentro, el bloque residual y el bloque transformer. "Recorrido" sigue un prompt hasta la imagen.` },
          { t: 'archdiagram', diagram: 'sd-overview', walk: 'sampling', wide: true, caption: R`Stable Diffusion 1.5 a 512×512: text encoder (una vez) → bucle de ${cf('steps')} pasos de U-Net + scheduler sobre el latente ${sh('lat')} → decoder del VAE. Formas del calculador.` },
          { t: 'p', html: R`<b>El ruido en números.</b> El proceso de forward tiene un schedule fijo: en el paso t, el latente es una mezcla \(\sqrt{\bar\alpha_t}\,x_0 + \sqrt{1-\bar\alpha_t}\,\varepsilon\). Mueve t y mira cuánta señal queda. La curva es la del schedule real de SD (1,000 pasos, β "scaled linear" de 0.00085 a 0.012). Fíjate en el final: ni en t = 1000 llega a ruido puro (\(\sqrt{\bar\alpha_T}\) ≈ 0.068, ${ZSNR}); eso tiene consecuencias (ver <a href="#stable-diffusion.fallas">fallas</a>).` },
          { t: 'viz', kind: 'noise-schedule', params: { config: C, t: 500, sched: 'sd' }, caption: 'Una señal sintética ruidosa a lo largo de t, con ᾱ_t y la SNR del schedule de SD 1.x (1,000 pasos, scaled linear 0.00085 → 0.012). Ilustrativo: no es un latente real.' },
          { t: 'p', html: R`<b>La guía (CFG).</b> En cada paso la U-Net corre dos veces: con el prompt y con el prompt vacío. La predicción final <b>extrapola</b> desde la incondicional en la dirección de la condicional, por un factor w (7.5 por defecto en diffusers). Más w → más fiel al texto y menos variado; demasiado → colores saturados y artefactos. Mueve w en este ejemplo 2-D:` },
          { t: 'viz', kind: 'cfg-guidance', params: { config: C, w: 7.5 }, caption: 'Toy 2-D: predicción incondicional, condicional y la guiada ε_u + w·(ε_c − ε_u). Con w = 1 es la condicional; con w > 1 se sale hacia "más de lo mismo" que distingue a la clase. Sintético.' },
          { t: 'callout', kind: 'note', html: R`<p>Tres detalles del diagrama: (1) el decoder del VAE corre <b>una vez</b> por imagen y el text encoder una vez por texto (dos con CFG: el prompt y el vacío, que se puede cachear), mientras la U-Net corre <b>pasos × 2</b> veces (por CFG); por eso casi todo el costo es la U-Net; (2) el encoder del VAE no aparece al generar: solo se usa para entrenar (vista <b>sd-training</b> en <a href="#stable-diffusion.entrenamiento">entrenamiento</a>) y para img2img/inpainting; (3) el scheduler no tiene parámetros: es una fórmula que mezcla x_t y ε̂ con coeficientes del schedule.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación. El prompt "una foto de un robot regando plantas" se tokeniza en ${cf('T')} posiciones (con relleno) y el text encoder de CLIP lo convierte en ${cf('T')} vectores de ${cf('Dtxt')}. Se sortea un latente de ruido de ${sh('lat')}: ${qn('tensor.z-t.elements')} números N(0, 1). En el paso t = 981 la U-Net recibe ese latente, el número 981 (convertido en un vector de ${qn('tensor.temb.shape')}) y los ${cf('T')} vectores del texto; en el nivel de 64×64 cada una de las ${cf('tokens')} posiciones del latente es un token que atiende a las otras (self-attention) y al texto (cross-attention). Sale un tensor de la misma forma: el ruido estimado. El scheduler resta una parte y pasa a t = 961. Cincuenta pasos después, el decoder del VAE multiplica la resolución por 8 en cada lado y devuelve 512×512×3.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'SD 1.5 @ 512'], rows: [
            [R`\(x_0\) (\(z_0\) en los diagramas)`, 'latente limpio (la imagen codificada por el VAE, ya escalada)', sh('lat')],
            [R`\(x_t\) (\(z_t\))`, 'latente con ruido en el paso t', sh('zt')],
            [R`\(\varepsilon\), \(\hat\varepsilon\)`, 'ruido gaussiano agregado; ruido estimado por la U-Net', sh('eps')],
            ['t, T', 'paso de ruido; número de pasos de entrenamiento', R`T = ${cf('trainSteps')}`],
            [R`\(\beta_t,\ \alpha_t = 1-\beta_t,\ \bar\alpha_t = \prod_{s\le t}\alpha_s\)`, 'varianza agregada en el paso t; señal que sobrevive hasta t', 'scaled linear 0.00085 → 0.012'],
            ['f, c', 'factor de reducción del VAE por lado; canales del latente', R`f = ${cf('f')}, c = ${cf('latentC')}`],
            ['T<sub>txt</sub>, D<sub>t</sub>', 'tokens de texto (T en las formas del calculador); ancho del text encoder (K, V de la cross-attention)', R`${cf('T')}, ${cf('Dtxt')}`],
            ['N<sub>ℓ</sub>', 'tokens del latente en el nivel ℓ de la U-Net (h·w del mapa)', R`${cf('tokens')} en el nivel 1`],
            ['w', 'escala de classifier-free guidance', '7.5 (default de diffusers)'],
          ] },

          { t: 'h3', text: 'El proceso de forward: cómo se agrega el ruido' },
          { t: 'p', html: R`Cada paso agrega un poco de ruido y achica un poco la señal (para que la varianza total no explote):` },
          { t: 'math', display: true, tex: R`q(x_t\mid x_{t-1}) = \mathcal{N}\big(\sqrt{1-\beta_t}\,x_{t-1},\ \beta_t I\big)`, caption: 'Un paso del forward: achica la señal por √(1 − β_t) y suma ruido de varianza β_t.' },
          { t: 'math', display: true, tex: R`q(x_t\mid x_0) = \mathcal{N}\big(\sqrt{\bar\alpha_t}\,x_0,\ (1-\bar\alpha_t)\,I\big),\qquad \bar\alpha_t=\prod_{s=1}^{t}(1-\beta_s)`, caption: 'La forma cerrada (DDPM, Ec. 4): una suma de gaussianas independientes es gaussiana, así que se salta directo de x₀ a cualquier t sin simular los pasos intermedios.' },
          { t: 'math', display: true, tex: R`x_t = \sqrt{\bar\alpha_t}\,x_0 + \sqrt{1-\bar\alpha_t}\,\varepsilon,\qquad \varepsilon\sim\mathcal{N}(0, I),\qquad \mathrm{SNR}(t)=\frac{\bar\alpha_t}{1-\bar\alpha_t}`, caption: 'La reparametrización que usa el entrenamiento: un muestreo y una suma. Esto es lo que hace DDPMScheduler.add_noise.' },
          { t: 'p', html: R`<b>Por qué importa la forma cerrada:</b> el entrenamiento elige un t al azar por ejemplo y fabrica x_t en una línea, sin simular la cadena. Cada batch mezcla todos los niveles de ruido. Con el schedule de SD, \(\bar\alpha_t\) baja de ≈ 0.999 (t = 1) a ≈ 0.0047 (t = 1000); a mitad de camino (t = 500) queda ≈ 0.28 de señal en varianza (valores del schedule calculados en el venv; coinciden con ${ZSNR}, Tabla 1, para el extremo).` },
          { t: 'p', html: R`<b>Otros schedules.</b> El lineal de DDPM (10⁻⁴ → 0.02) destruye la señal demasiado rápido en imágenes pequeñas: buena parte de los t ya son casi ruido puro. El <b>cosine</b> (${IDDPM}) reparte mejor la SNR. A más resolución pasa lo contrario (el mismo t destruye menos: hay más píxeles vecinos redundantes que promedian el ruido), y hay que correr el schedule hacia más ruido: es el shift de SD3 (ver <a href="#dit.entrenamiento">DiT</a>).` },

          { t: 'h3', text: 'La pérdida: predecir el ruido' },
          { t: 'math', display: true, tex: R`\mathcal{L}_\text{simple}(\theta)=\mathbb{E}_{x_0,\ \varepsilon\sim\mathcal{N}(0,I),\ t\sim\mathcal{U}\{1,\dots,T\}}\Big[\big\lVert\,\varepsilon-\varepsilon_\theta\big(\sqrt{\bar\alpha_t}\,x_0+\sqrt{1-\bar\alpha_t}\,\varepsilon,\ t,\ \tau(y)\big)\big\rVert^2\Big]`, caption: 'DDPM, Ec. 14, con la condición de texto τ(y) de LDM (Ec. 3 del paper de LDM). Una MSE por elemento del latente. θ = solo la U-Net: el VAE y el text encoder están congelados.' },
          { t: 'p', html: R`<b>Por qué ε y no la imagen.</b> (1) <b>Escala constante</b>: ε siempre es N(0, I), en cualquier t; la imagen limpia, en cambio, es casi imposible de adivinar en t alto y casi idéntica a la entrada en t bajo, así que la pérdida sobre x₀ pesaría muy distinto según t. (2) <b>Es la variante que funcionó</b>: DDPM compara predecir la media del paso anterior (μ̃) con predecir ε (Tabla 2): con la pérdida variacional completa empatan (FID 13.22 vs 13.51 en CIFAR-10), pero con la MSE simplificada sobre ε llega a FID 3.17, mientras que μ̃ con MSE "fue inestable". (3) <b>Conexión teórica</b>: predecir ε equivale a estimar el score ∇ log p(x_t) a varios niveles de ruido (denoising score matching), y el muestreo se parece a dinámica de Langevin (DDPM §3.2). Las tres parametrizaciones (ε, x₀, v) son intercambiables con álgebra; lo que cambia es cómo pesa la pérdida cada t: \(\lVert\varepsilon-\hat\varepsilon\rVert^2 = \mathrm{SNR}(t)\,\lVert x_0-\hat x_0\rVert^2\), así que la MSE sobre ε es una MSE sobre x₀ pesada por SNR(t) (la derivación está en la <a href="#stable-diffusion.entrevista">entrevista</a>).` },

          { t: 'h3', text: 'Text encoder (una vez por prompt)' },
          { t: 'op', block: 'text-encoder', model: 'stable-diffusion', title: 'Text encoder de CLIP ViT-L/14 (congelado)',
            tex: R`\tau(y) = \mathrm{LN}\big(\mathrm{Transformer}_{12}(\mathbf{E}_\text{tok}[y] + \mathbf{E}_\text{pos})\big)\in\mathbb{R}^{T_\text{txt}\times D_t}`,
            diagram: 'sd-overview', in: [TN.ids], out: [TN.ctx], params: true, flops: true,
            what: R`El transformer de texto de la <a href="#clip.operaciones">página de CLIP</a>, con máscara causal: ${sh('ids')} → ${sh('ctx')}. Se usa la <b>secuencia</b> completa de la última capa (después de la LayerNorm final), no el vector proyectado del token EOT (fin de texto) que CLIP usa para comparar con la imagen. SD 2.x usa la penúltima capa; el "clip skip" de las interfaces hace lo mismo con SD 1.5.`,
            why: R`Ya sabe "de qué habla" un texto en términos visuales: CLIP lo alineó con imágenes. Darle a la U-Net los ${cf('T')} vectores (y no uno solo) deja que cada región del latente atienda a la palabra que le toca ("robot" arriba a la izquierda, "plantas" abajo). Cuesta ${met('mT')}: nada frente a la U-Net.` },

          { t: 'h3', text: 'Embedding del paso t' },
          { t: 'op', block: 'time-embed', model: 'stable-diffusion', diagram: 'sd-unet', title: 'Timestep embedding: sinusoidal → MLP',
            tex: R`\mathbf{e}_t = W_2\,\mathrm{SiLU}\big(W_1\,\mathrm{PE}(t) + b_1\big) + b_2,\qquad \mathrm{PE}(t) = \big[\cos(t\,\omega_i)\ ;\ \sin(t\,\omega_i)\big]_{i=0}^{C/2-1},\ \ \omega_i = 10000^{-2i/C}`,
            in: ['timestep'], out: [TN.temb], params: true, flops: true,
            what: R`t (un entero) → cosenos y senos de C/2 frecuencias, concatenados [cos | sin] (C = ${cf('C')} valores; <code>flip_sin_to_cos</code> en diffusers): el mismo positional encoding del transformer original, pero de un escalar → MLP de dos capas → ${sh('temb')}. Ese vector entra a <b>todos</b> los bloques residuales.`,
            why: R`La misma U-Net tiene que quitar ruido grueso (t alto: decidir la composición) y fino (t bajo: texturas). Sin t, tendría que adivinar el nivel de ruido mirando la imagen. El sinusoidal da una representación suave de un escalar; el MLP la adapta.` },

          { t: 'h3', text: 'Bloque residual con inyección de t' },
          { t: 'p', html: R`Es un bloque de ResNet (dos convs 3×3) con GroupNorm y SiLU, y un detalle: entre las dos convs se suma una proyección lineal de e_t, <b>un número por canal</b> que se difunde a todas las posiciones. Ábrelo en el diagrama (sd-resblock).` },
          { t: 'math', display: true, tex: R`\mathbf{h} = \mathrm{Conv}_{3\times3}\big(\mathrm{SiLU}(\mathrm{GN}(\mathbf{x}))\big) + \big(W_t\,\mathrm{SiLU}(\mathbf{e}_t) + b_t\big)_{[\,1\times1\times C_\text{out}\,]}
\qquad
\mathbf{y} = \mathrm{skip}(\mathbf{x}) + \mathrm{Conv}_{3\times3}\big(\mathrm{SiLU}(\mathrm{GN}(\mathbf{h}))\big)`, caption: 'GN = GroupNorm con 32 grupos. skip = identidad, o conv 1×1 cuando cambia el número de canales. El término de t se suma en broadcast sobre H×W (como un bias que depende del paso). En SD 1.5 hay dropout 0 en inferencia.' },
          { t: 'op', block: 'conv1', model: 'stable-diffusion', diagram: 'sd-resblock', title: 'Conv 3×3 del bloque residual',
            tex: R`\mathbf{h} = \mathrm{Conv}_{3\times3}\big(\mathrm{SiLU}(\mathrm{GN}_{32}(\mathbf{x}))\big)`,
            in: ['d2-res1-h-act1'], out: ['d2-res1-h-conv1'], params: true, flops: true,
            what: 'La primera conv del bloque, después de normalizar y activar (pre-activación, como ResNet v2). La tarjeta muestra el primer bloque residual de Down 2 (de C a 2C canales, con atajo conv 1×1); los demás son iguales con otros canales y otra resolución.',
            why: 'Las convs dan lo que la atención no: sesgo local, equivariancia a traslaciones y costo lineal en el número de posiciones. Por eso la U-Net mezcla bloques residuales (local) con bloques transformer (global y texto).' },
          { t: 'op', block: 'time-proj', model: 'stable-diffusion', diagram: 'sd-resblock', title: 'Proyección del embedding de t (se suma)',
            tex: R`\mathbf{h} \leftarrow \mathbf{h} + \big(W_t\,\mathrm{SiLU}(\mathbf{e}_t) + b_t\big),\qquad W_t\in\mathbb{R}^{4C\times C_\text{out}}`,
            in: [TN.temb], out: ['d2-res1-e-proj'], params: true, flops: true,
            what: R`Una lineal de ${qn('tensor.temb.shape')} al ancho del bloque; el vector resultante se suma igual en todas las posiciones.`,
            why: 'Es la forma más barata de condicionar en t: un sesgo por canal que el bloque aprende a usar como "perilla de nivel de ruido". DiT reemplaza esta suma por adaLN, que además escala (ver <a href="#dit">DiT</a>).' },

          { t: 'h3', text: 'Bloque transformer: self-attention, cross-attention al texto y FF GEGLU' },
          { t: 'p', html: R`En los niveles 1–3, <b>cada</b> bloque residual va seguido de su propio bloque transformer (2 pares por nivel de bajada, 3 por nivel de subida); el medio es residual, transformer, residual. El mapa \(h\times w\times C\) se aplana a \(N_\ell = h\cdot w\) tokens de C canales (con GroupNorm y una proyección de entrada), pasa por tres sub-bloques pre-LN con residual, y se vuelve a armar como mapa. En el nivel 1 son ${cf('tokens')} tokens de ${cf('C')}: ahí está el costo de atención (ver <a href="#stable-diffusion.costo">costo</a>).` },
          { t: 'op', block: 'self-attn', model: 'stable-diffusion', diagram: 'sd-transformer-block', title: 'Self-attention entre posiciones del latente',
            tex: R`\mathrm{SA}(\mathbf{X}) = \mathrm{softmax}\!\Big(\frac{(\mathbf{X}W_Q)(\mathbf{X}W_K)^\top}{\sqrt{d_h}}\Big)\mathbf{X}W_V\;W_O,\qquad \mathbf{X}\in\mathbb{R}^{N_\ell\times C}`,
            in: ['d1-attn1-h-n1'], out: ['d1-attn1-sa-o'], params: true, flops: true,
            what: R`La <a href="#repaso-atencion">MHSA</a> de siempre, con ${cf('h')} cabezas, sin bias en Q, K, V. Cada posición del latente ve a todas las demás: coherencia global (que los dos ojos de una cara coincidan).`,
            why: R`Las convs solo ven un vecindario; para que la imagen sea coherente de punta a punta hace falta mezcla global. El precio: la matriz \(N_\ell\times N_\ell\), que en el nivel 1 es de ${cf('tokens')}² entradas por cabeza. SD 1.5 la pone en los niveles 1–3 y en el medio (8×8, barata); SDXL la saca del nivel de mayor resolución justamente por este costo.` },
          { t: 'op', block: 'cross-attn', model: 'stable-diffusion', diagram: 'sd-transformer-block', title: 'Cross-attention: Q de la imagen, K y V del texto',
            tex: R`\mathrm{CA}(\mathbf{X}, \mathbf{C}) = \mathrm{softmax}\!\Big(\frac{(\mathbf{X}W_Q)(\mathbf{C}W_K)^\top}{\sqrt{d_h}}\Big)\mathbf{C}W_V\;W_O,\qquad \mathbf{C}=\tau(y)\in\mathbb{R}^{T_\text{txt}\times D_t}`,
            in: ['d1-attn1-h-n2', TN.ctx], out: ['d1-attn1-ca-o'], params: true, flops: true,
            what: R`§3.3 de LDM: \(Q = W_Q\,\varphi(z_t)\), \(K = W_K\,\tau(y)\), \(V = W_V\,\tau(y)\). W<sub>K</sub> y W<sub>V</sub> llevan de ${cf('Dtxt')} (ancho de CLIP) al ancho C del nivel. La matriz de scores es \(N_\ell\times T_\text{txt}\): cada posición reparte su atención entre las palabras.`,
            why: R`Deja que la condición sea una <b>secuencia</b> de largo variable y que cada región elija qué palabra mirar. Es el mismo mecanismo que en el decoder de un transformer encoder-decoder o en DETR. Es barata (\(T_\text{txt}\) = ${cf('T')} ≪ \(N_\ell\)). Los mapas de esta atención son los que manipula la edición tipo Prompt-to-Prompt (Hertz et al., ICLR 2023, arXiv:2208.01626).` },
          { t: 'op', block: 'ff-geglu', model: 'stable-diffusion', diagram: 'sd-transformer-block', title: 'Feed-forward GEGLU',
            tex: R`\mathrm{FF}(\mathbf{x}) = \big[(\mathbf{x}W_a + b_a)\odot \mathrm{GELU}(\mathbf{x}W_g + b_g)\big]W_2 + b_2,\qquad W_a, W_g\in\mathbb{R}^{C\times 4C}`,
            in: ['d1-attn1-h-n3'], out: ['d1-attn1-ff-o'], params: true, flops: true,
            what: 'Un MLP con compuerta: una rama lineal multiplicada elemento a elemento por la GELU de otra rama (Shazeer, "GLU Variants Improve Transformer", arXiv:2002.05202). En la implementación es una sola lineal C → 8C que se parte en dos mitades.',
            why: 'Mismo papel que el MLP del transformer, con la variante con compuerta que en lenguaje rinde algo mejor a igual costo. Es el pariente de la SwiGLU de Llama (<a href="#llm-decoder">decoder</a>), con GELU en vez de SiLU.' },

          { t: 'h3', text: 'La U-Net completa' },
          { t: 'op', block: 'unet', model: 'stable-diffusion', diagram: 'sd-overview', title: 'U-Net: 4 niveles abajo, medio, 4 niveles arriba',
            tex: R`\hat\varepsilon = \varepsilon_\theta(x_t,\ t,\ \tau(y)):\quad \mathbb{R}^{\frac{H}{f}\times\frac{W}{f}\times c}\ \to\ \mathbb{R}^{\frac{H}{f}\times\frac{W}{f}\times c}`,
            in: [TN.zt, TN.ctx], out: [TN.eps], params: true, flops: true,
            what: R`conv_in (${cf('latentC')} → ${cf('C')}) → 4 niveles de bajada (anchos C, 2C, 4C, 4C con C = ${cf('C')}; ${cf('layers')} bloques residuales por nivel, con transformer en los niveles 1–3; downsample con conv stride 2 entre niveles) → medio (residual, transformer, residual) → 4 niveles de subida (3 bloques residuales por nivel, cada uno concatena un skip del encoder) → GroupNorm, SiLU, conv_out (${cf('C')} → ${cf('latentC')}). ${sh('zt')} → ${sh('eps')}.`,
            why: R`Los niveles bajos (8×8) deciden la composición global; los altos (64×64) el detalle. Los skips llevan ese detalle sin pasar por el cuello de botella, igual que en segmentación. Es ${np('unet')} parámetros y ${met('mU')} por evaluación: casi todo el costo del muestreo (${met('denoiserSamplingShare')}).` },

          { t: 'h3', text: 'El camino de vuelta: un paso del sampler' },
          { t: 'p', html: R`Con ε̂ en la mano, cada sampler estima x₀ y decide cuánto de ese x₀ y cuánto de ruido poner en el paso siguiente. Todos empiezan por la misma inversión de la forma cerrada:` },
          { t: 'math', display: true, tex: R`\hat x_0 = \frac{x_t - \sqrt{1-\bar\alpha_t}\,\hat\varepsilon}{\sqrt{\bar\alpha_t}}`, caption: 'La "predicción de x₀" en cada paso. En t alto es borrosa (un promedio de las imágenes posibles); en t bajo, nítida.' },
          { t: 'math', display: true, tex: R`\textbf{DDPM:}\quad x_{t-1} = \frac{1}{\sqrt{\alpha_t}}\Big(x_t - \frac{\beta_t}{\sqrt{1-\bar\alpha_t}}\,\hat\varepsilon\Big) + \sigma_t\,z,\qquad z\sim\mathcal{N}(0,I),\ \ \sigma_t^2\in\{\beta_t,\ \tilde\beta_t\}`, caption: 'Algoritmo 2 de DDPM: estocástico, un paso por cada t (1,000 evaluaciones). σ²_t = β_t o β̃_t = β_t(1 − ᾱ_{t−1})/(1 − ᾱ_t) dieron resultados parecidos (§3.2). z = 0 en el último paso.' },
          { t: 'math', display: true, tex: R`\textbf{DDIM:}\quad x_{t'} = \sqrt{\bar\alpha_{t'}}\,\hat x_0 + \sqrt{1-\bar\alpha_{t'}-\sigma^2}\;\hat\varepsilon + \sigma\,z,\qquad t' < t\ \ (\text{p. ej. } t' = t-20),\quad \eta=0\Rightarrow\sigma=0`, caption: 'DDIM, Ec. 12: "predicted x₀" + "dirección hacia x_t" + ruido. Con η = 0 es determinista y se puede saltar de 20 en 20 (50 pasos en vez de 1,000); con η = 1 recupera DDPM. El mismo x_T da imágenes con la misma estructura con 20 o 100 pasos.' },
          { t: 'p', html: R`<b>Por qué DDIM puede saltar.</b> DDIM muestra que la pérdida de DDPM solo depende de las marginales q(x_t | x₀), no de la cadena paso a paso; existe una familia de procesos con las mismas marginales y uno de ellos es determinista. Un modelo entrenado como DDPM sirve tal cual: solo cambia el sampler. El paper reporta muestras de calidad comparable "10× to 50× faster" (${DDIM}). Visto así, muestrear es resolver una ecuación diferencial (la probability-flow ODE), y los samplers modernos (DPM-Solver, Euler de EDM) son mejores integradores de esa ODE.` },

          { t: 'h3', text: 'Classifier-free guidance' },
          { t: 'math', display: true, tex: R`\hat\varepsilon_\text{CFG} = \hat\varepsilon_\theta(x_t, t, \varnothing) + w\,\big(\hat\varepsilon_\theta(x_t, t, c) - \hat\varepsilon_\theta(x_t, t, \varnothing)\big)`, caption: 'La forma de diffusers (guidance_scale = w; 7.5 por defecto en las pipelines de SD). El paper escribe (1 + w)·ε_c − w·ε_u: es lo mismo con w_paper = w − 1. w = 1 es el modelo condicional sin guía.' },
          { t: 'list', items: [
            R`<b>Entrenamiento</b>: el mismo modelo aprende las dos cosas. Con probabilidad p<sub>uncond</sub> se reemplaza el texto por el prompt vacío (∅). El paper prueba 0.1, 0.2 y 0.5: 0.1 y 0.2 rinden igual y 0.5 peor (${CFG}, §4). SD 1.5 usa 10 % (${CARD}).`,
            R`<b>Por qué funciona</b>: ε_c − ε_u apunta hacia "lo que el texto agrega" (el gradiente de log p(c | x_t), un clasificador implícito). Amplificar esa dirección hace las muestras más típicas de la condición: más fidelidad al prompt, menos diversidad. El paper lo mide en ImageNet 64×64: el mejor FID sale con guía chica (1.55 con w<sub>paper</sub> = 0.1) y empeora con guía fuerte (26.22 con w<sub>paper</sub> = 4), mientras el IS sube de 66.1 a 260.2 (Tabla 1).`,
            R`<b>Costo</b>: dos evaluaciones de la U-Net por paso ("evaluating the denoising model twice"; el paper lo lista como su desventaja). En la práctica se hace en una sola llamada con el batch duplicado: [∅; texto]. ×2 en MACs y en activaciones de la U-Net (el text encoder también corre dos veces, pero el embedding vacío se puede cachear).`,
            R`<b>Negative prompt</b>: reemplaza ∅ por el embedding de un texto ("borroso, deformado"). La guía empuja <b>lejos</b> de ese texto, no solo hacia el prompt. Es el mismo costo: la rama incondicional ya existía.`,
          ] },

          { t: 'h3', text: 'Decoder del VAE (una vez por imagen)' },
          { t: 'op', block: 'vae-decoder', model: 'stable-diffusion', title: 'Decoder del VAE: latente → píxeles',
            tex: R`\hat{\mathbf{x}} = \mathcal{D}\big(z_0 / s\big):\ \ \mathbb{R}^{\frac{H}{f}\times\frac{W}{f}\times c}\to\mathbb{R}^{H\times W\times 3}\qquad(s = \text{scaling\_factor del VAE})`,
            diagram: 'sd-overview', in: ['z-prev'], out: [TN.out], params: true, flops: true,
            what: R`Deshace el escalado (÷ ${SCALE}) y sube la resolución ×${cf('f')} por lado con bloques residuales y upsampling: ${sh('lat')} → ${sh('out')}. Tiene un bloque de self-attention en su nivel más chico (64×64).`,
            why: R`Es una pasada, pero a resolución completa: cuesta ${met('mVd')}, más que una evaluación de la U-Net. Con pocos pasos (modelos destilados) el decoder pasa a pesar en la latencia; por eso existen decoders "tiny" (TAESD) para previsualizar.` },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor en orden forward de <b>una</b> evaluación de la U-Net (más el text encoder y el decoder del VAE). Toca una fila para resaltar el tensor en el diagrama.` },
          { t: 'trace', model: 'stable-diffusion' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`SD 1.5 completo son tres redes: U-Net ${met('pU')}, VAE ${met('pV')} (encoder ${met('vaeEncoderParams')} + decoder ${met('vaeDecoderParams')}) y text encoder ${met('pT')}: ${qn('params.total')} en total, ${met('unetParamsShare')} en la U-Net. La tabla de parámetros cuenta los tres (el encoder del VAE aparece aunque no corre al muestrear). La de MACs es <b>un paso</b> del grafo de muestreo: el text encoder, <b>una</b> evaluación de la U-Net y el decoder del VAE; para una imagen, la U-Net se multiplica por pasos × 2 (abajo).` },
          { t: 'params', model: 'stable-diffusion', group: 'block' },
          { t: 'flops', model: 'stable-diffusion' },
          { t: 'h3', text: 'Cuánto cuesta una imagen' },
          { t: 'math', display: true, tex: R`\text{MACs}_\text{imagen} = \underbrace{S}_{\text{pasos}}\times\underbrace{2}_{\text{CFG}}\times\text{MACs}_\text{U-Net} \;+\; \underbrace{2}_{\text{CFG}}\times\text{MACs}_\text{text} \;+\; \text{MACs}_\text{VAE dec}`, caption: 'Una evaluación de la U-Net = una NFE (network function evaluation). Con CFG cada paso son 2 NFE (en una llamada con batch 2), y el text encoder corre dos veces (prompt y vacío). Es la fórmula de samplingMacs del calculador.' },
          { t: 'calc', title: 'SD 1.5, 512×512, 50 pasos, CFG (cuenta a mano; el explorador la recalcula)', rows: [
            { label: 'Una evaluación de la U-Net', expr: 'calculador', value: met('mU') },
            { label: 'Text encoder (una pasada; 2 con CFG)', expr: 'calculador', value: met('mT') },
            { label: 'Decoder del VAE (una vez)', expr: 'calculador', value: met('mVd') },
            { label: 'Por imagen', expr: R`${cf('steps')} × 2 × U-Net + 2 × text + VAE`, value: met('mImg'), note: R`la U-Net es ${met('denoiserSamplingShare')}` },
          ], result: R`Comparado con un LLM: un LLM de 7B gasta ≈ 1 MAC por parámetro y por token (${qn('params.total', 'llama2-7b')} parámetros en Llama 2 7B), así que una imagen de SD 1.5 cuesta como el prefill de ${est('≈ 6,000 tokens')} (${met('mImg')} ÷ ≈ 6.7 G), pero repartido en ${cf('steps')} llamadas secuenciales a la U-Net (de batch 2 por CFG: ${cf('nfe')} evaluaciones). Lo que manda es el número de pasos.` },
          { t: 'h3', text: 'Dónde se va el cómputo dentro de la U-Net' },
          { t: 'p', html: R`La U-Net no reparte el costo parejo. El nivel 1 (64×64, ${cf('C')} canales) tiene pocos canales pero ${cf('tokens')} posiciones, y su self-attention arma una matriz de ${cf('tokens')} × ${cf('tokens')} por cabeza: QKᵀ y A·V crecen con N². Los niveles bajos tienen muchos canales y pocas posiciones: ahí pesan las convs y los parámetros. Los dos lados del nivel de 64×64 (<b>down-1</b>: ${nG('down-1')}MACs; <b>up-4</b>: ${nG('up-4')}MACs) se llevan una parte grande de los ${met('mU')} de la U-Net, aunque tienen la cuarta parte de canales que los niveles bajos. De toda la U-Net, ${met('selfScoreShareUnet')} son QKᵀ y A·V de las self-attention, y ${met('attnShareUnet')} todo lo de atención (con proyecciones).` },
          { t: 'callout', kind: 'trap', title: '"La atención de la U-Net es barata porque son pocas capas"', html: R`<p>En MACs, a 512 px, la atención es una parte (${met('selfScoreShareUnet')} de la U-Net son QKᵀ y A·V); en <b>memoria</b> y en latencia sin FlashAttention es otra historia: la matriz de scores del nivel 1 en fp16 ocupa ${met('selfAttnScoreBytes')} por capa con B = 1, y CFG duplica el batch. A 1024 px son 4× tokens → 16× entradas. Por eso xFormers/FlashAttention (SDPA en PyTorch 2) fue el primer gran acelerador de SD, y por eso SDXL no pone atención en el nivel de mayor resolución.</p>` },
          { t: 'h3', text: 'Cómo escala: resolución, pasos y guía' },
          { t: 'p', html: R`Mueve la resolución de la imagen (el latente es res/8 por lado), los pasos y la guía. Mira la parte de atención al subir la resolución:` },
          { t: 'scaling', model: 'stable-diffusion', knobs: [{ key: 'res', values: [256, 512, 768, 1024] }, { key: 'steps', values: [1, 4, 20, 50] }, { key: 'cfg', values: [0, 1] }], show: ['samplingMacs', 'unetMacs', 'selfScoreShareUnet', 'selfAttnScoreBytes', 'latentTokens', 'msPerImage'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 resolución → ×4 posiciones del latente → ≈ ×4 en las convs y lineales, ×16 en QKᵀ y A·V de la self-attention, y la parte de atención crece; ×2 pasos → ×2 en la U-Net (≈ ×1.97 por imagen, porque el texto y el VAE no se repiten); CFG apagado → ≈ ÷1.94 por imagen (÷2 en la U-Net). El text encoder no cambia con nada de esto; el decoder del VAE crece con la resolución (×4 por ×2 de lado).` },
          { t: 'h3', text: 'Contra SDXL y DiT' },
          { t: 'compare', models: [C, XL, DT], rows: ['res', 'tokens', 'unetParams', 'ditParams', 'unetMacs', 'ditMacs', 'nfe', 'samplingMacs'], caption: R`SD 1.5 (512 px, latente ${sh('lat')}), SDXL (1024 px, latente ${qn('metrics.latentShape', XL)}, dos text encoders con ${qn('metrics.textEncoderParams', XL)} parámetros, sin atención en el nivel de mayor resolución) y DiT-XL/2 (256 px, latente ${qn('metrics.latentShape', DT)}, un transformer puro sobre ${qn('tokens', DT)} parches; ver <a href="#dit">DiT</a>). "Tokens" son posiciones del latente en SD y parches en DiT; los MACs de la red son por evaluación; los de la imagen usan los pasos por defecto de cada config (${cf('steps')} en SD, ${qn('cfg.steps', DT)} en el paper de DiT), con CFG. En SDXL la self-attention más grande ya no está en el nivel de 128×128 sino en el de 64×64: ${qn('metrics.selfAttnTokens', XL)} tokens, como SD 1.5 a 512.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota: "one image is steps times two U-Net evaluations, so latency is linear in steps and guidance doubles it; the U-Net is almost all the compute; attention at the 64 by 64 level dominates memory and grows sixteen-fold when you double the resolution." Bonus: decir que el VAE decoder es una pasada pero cara, y que se vuelve relevante cuando bajas a 1–4 pasos.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Dos entrenamientos separados. Primero el <b>autoencoder</b> (una vez, sobre imágenes sin texto). Después la <b>U-Net</b>, con el VAE y el text encoder congelados: cada ejemplo es (imagen, caption) → latente → ruido a un t al azar → MSE.` },
          { t: 'archdiagram', diagram: 'sd-training', walk: 'training', caption: 'Un paso de entrenamiento: imagen → encoder del VAE (congelado) → latente z₀ → se agrega ruido ε en un t al azar → la U-Net predice el ruido con t y el texto (10 % de las veces, sin texto) → MSE entre el ruido real y el predicho. Solo la U-Net recibe gradiente.' },
          { t: 'math', display: true, tex: R`\mathcal{L}_\text{LDM}=\mathbb{E}_{\mathcal{E}(x),\,y,\,\varepsilon,\,t}\Big[\big\lVert\varepsilon-\varepsilon_\theta\big(z_t,\,t,\,\tau(\tilde y)\big)\big\rVert_2^2\Big],\qquad z_t=\sqrt{\bar\alpha_t}\,s\,\mathcal{E}(x)+\sqrt{1-\bar\alpha_t}\,\varepsilon,\qquad \tilde y=\begin{cases}\varnothing & \text{con prob. } 0.1\\ y & \text{si no}\end{cases}`, caption: 'Ec. 3 de LDM más el dropout de la condición para CFG. s = scaling_factor del VAE. El text encoder τ y el encoder del VAE ℰ están congelados.' },
          { t: 'h3', text: 'El autoencoder' },
          { t: 'p', html: R`Pérdida: reconstrucción + perceptual (LPIPS) + adversarial con un discriminador de parches + KL con peso ≈ 10⁻⁶ (${LDM}, §3.1 y Apéndice G). En SD 1.x el VAE es el KL-f8 de LDM (latente de 4 canales); más tarde Stability publicó un decoder ajustado (ft-MSE) que mejora caras y texto chico sin cambiar el latente, así que es intercambiable. SDXL reentrenó el autoencoder con batch más grande (256 vs 9) y EMA (${SDXL}, §2.4).` },
          { t: 'h3', text: 'Datos y checkpoints de SD 1.x' },
          { t: 'table', caption: 'La historia de los checkpoints v1 (todos a 512×512 salvo el inicio de v1-1)', head: ['Checkpoint', 'Desde', 'Pasos y datos', 'Dropout del texto'], rows: [
            ['v1-1', '— (desde cero)', '237K pasos a 256×256 en laion2B-en, luego 194K a 512×512 en laion-high-resolution (imágenes ≥ 1024 px)', '—'],
            ['v1-2', 'v1-1', '515K pasos en laion-improved-aesthetics (subconjunto de laion2B-en filtrado por tamaño, estética y probabilidad de watermark)', '—'],
            ['v1-3', 'v1-2', '195K pasos en laion-improved-aesthetics', '10 %'],
            ['v1-4', 'v1-2', '225K pasos en "laion-aesthetics v2 5+"', '10 %'],
            ['v1-5', 'v1-2', '595K pasos en "laion-aesthetics v2 5+"', '10 %'],
            ['v1-5 inpainting', 'v1-5', '440K pasos de inpainting (U-Net con 5 canales extra: máscara + imagen enmascarada codificada)', '10 %'],
          ], note: R`Fuente: ${CARD}. Común: 32 × 8 A100, AdamW, batch 2048 (32 × 8 × 2 de acumulación × 4), LR con warmup a 10⁻⁴ en 10,000 pasos y después constante; ≈ 150,000 horas de A100 en total (estimación de la propia card). LAION: ${LAION}.` },
          { t: 'list', items: [
            R`<b>v1.4 vs v1.5</b>: misma arquitectura y mismo punto de partida (v1-2); v1.5 entrena más pasos (595K vs 225K) en el mismo subconjunto estético. No hay una diferencia de diseño: es más entrenamiento. Por eso los LoRA de uno suelen funcionar en el otro.`,
            R`<b>Resolución por etapas</b>: empezar a 256 y pasar a 512 es el mismo truco que el fine-tuning a más resolución de ViT: lo barato primero. Un modelo entrenado a 512 genera mal a 1024 (duplica sujetos: la U-Net nunca vio esa escala de composición).`,
            R`<b>Filtrado estético</b>: los últimos cientos de miles de pasos son en un subconjunto con puntaje estético alto. Es la versión de "datos de calidad al final" de los LLMs; también sesga el estilo (todo sale "lindo").`,
            R`<b>El LDM original</b> no es SD: el modelo texto→imagen del paper tiene 1.45B parámetros, entrena en LAION-400M y usa un transformer propio con el tokenizer de BERT (§4.3.1 y Tabla 15). SD 1.x cambió el condicionador por el text encoder de CLIP ViT-L/14 congelado y entrenó en LAION-2B.`,
          ] },
          { t: 'callout', kind: 'trap', title: '"El dropout del 10 % es regularización"', html: R`<p>No: es lo que hace posible la guía. Sin él, el modelo nunca aprendió ε(x_t, ∅) y CFG no tiene rama incondicional que restar. v1-1 y v1-2 no lo tenían; desde v1-3 sí. Si haces fine-tuning completo y lo apagas, la guía se degrada.</p>` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los nombres de los subconjuntos de LAION y los pasos por checkpoint son material de consulta. Lo que sí se pregunta: VAE aparte y congelado, MSE sobre ε con t uniforme, 10 % sin texto para CFG, 256 → 512, filtrado estético, y que el costo de entrenamiento está en la U-Net.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Texto → embeddings (una vez)', html: R`<p>Tokenizar y truncar/rellenar a ${cf('T')} tokens; text encoder: ${sh('ids')} → ${sh('ctx')}. Con CFG, también el prompt vacío (o el negativo). Se puede cachear por prompt.</p>` },
            { title: 'Ruido inicial', html: R`<p>x_T ~ N(0, I) con forma ${sh('lat')} (× el sigma inicial del scheduler, 1 en DDIM). La <b>semilla</b> fija este tensor: con un sampler determinista, misma semilla + mismo prompt = misma imagen.</p>` },
            { title: 'Bucle de denoising', html: R`<p>Por cada paso: U-Net con batch [∅; texto] → ε̂_u, ε̂_c → CFG → el scheduler calcula x_{t'}. ${cf('steps')} pasos × 2 = ${cf('nfe')} evaluaciones de la U-Net. Es <b>secuencial</b>: el paso k necesita el resultado del k − 1.</p>` },
            { title: 'Decoder del VAE', html: R`<p>z₀ ÷ ${SCALE} → decoder → ${sh('out')} en [−1, 1] → [0, 255]. Después, en diffusers, el safety checker (opcional).</p>` },
          ] },
          { t: 'h3', text: 'Schedulers: cuántos pasos necesitas' },
          { t: 'table', caption: 'El mismo modelo entrenado con DDPM, distintos integradores (rangos típicos de uso; la calidad depende del modelo y del prompt)', head: ['Sampler', 'Idea', 'Pasos típicos', 'Fuente'], rows: [
            ['DDPM', 'La cadena original, estocástica, un paso por t', '1,000', DDPM],
            ['DDIM', 'Determinista (η = 0), salta pasos; misma estructura con distintos S', '50 (25–100)', DDIM],
            ['PNDM / PLMS', 'Método multipaso (reusa ε̂ de pasos anteriores); el default de las pipelines de SD 1.x en diffusers', '50', PNDM],
            ['Euler / Euler a (EDM)', 'Integrador de la ODE (o SDE, "ancestral") en la parametrización de σ de Karras', '20–50', EDM],
            ['DPM-Solver++ (2M)', 'Solver de alto orden diseñado para la ODE de difusión; robusto con CFG', '15–25', DPMS],
            ['LCM (destilado)', 'Un modelo destilado predice directo la solución de la ODE', '2–4', LCM],
            ['ADD / SDXL-Turbo (destilado)', 'Destilación con pérdida adversarial + score distillation', '1–4', ADD],
          ] },
          { t: 'viz', kind: 'denoise-steps', params: { config: C, sampler: 'ddim', steps: 50, cfg: 1 }, caption: 'Izquierda: un juguete 2-D muestreado con DDPM, DDIM o flujo rectificado con N pasos (ilustrativo: el error es solo de discretizar). Derecha: el costo real de una imagen de SD 1.5 según N, del calculador.' },
          { t: 'p', html: R`<b>Pasos vs calidad:</b> la calidad sube rápido hasta ≈ 20 pasos con un buen solver y después casi no cambia; DDPM a 50 pasos se ve mal porque es estocástico y necesita los 1,000. Un sampler no se elige por "el mejor", sino por cuántos pasos te puedes pagar. Para bajar a 1–4 hace falta <b>otro modelo</b> (destilado), no solo otro scheduler.` },
          { t: 'h3', text: 'La escala de guía' },
          { t: 'list', items: [
            'w = 1: sin guía. Imágenes variadas pero que siguen mal el prompt y salen "lavadas".',
            'w ≈ 5–9: el rango de uso normal en SD 1.5 (7.5 es el default de diffusers).',
            'w ≥ 12–15: sobresaturación, contraste excesivo, artefactos y poca diversidad: la extrapolación saca a x̂₀ del rango de los datos. Arreglos: dynamic thresholding (Imagen), CFG rescale (φ ≈ 0.7 con w = 7.5, Lin et al.), guiar solo en un intervalo intermedio de ruido (Kynkäänniemi et al., 2024). El porqué está en la <a href="#stable-diffusion.entrevista">entrevista</a>.',
            'Modelos destilados con guía incorporada (LCM) o sin ella (SDXL-Turbo, guidance_scale = 0): sin CFG en inferencia → ÷2 en el costo.',
          ] },
          { t: 'h3', text: 'Latencia y memoria' },
          { t: 'calc', title: 'Cota de una imagen en una H100 (roofline del calculador, cuenta a mano)', rows: [
            { label: 'MACs por imagen (50 pasos, CFG)', expr: 'calculador', value: met('mImg') },
            { label: 'Una evaluación de la U-Net (batch 2 por CFG)', expr: 'máx(2·MACs·2 ÷ 989 TFLOPS, pesos ÷ 3.35 TB/s)', value: est('≈ ' + met('unetNfeMs') + ' ms'), note: R`${met('unetBound')}-bound: intensidad ≈ ${met('denoiserIntensity')} FLOPs/byte contra ≈ ${met('ridgePoint')} de la H100` },
            { label: 'Decoder del VAE (una vez)', expr: 'igual, una pasada', value: est('≈ ' + met('vaeDecodeMs') + ' ms') },
            { label: 'Por imagen', expr: R`${cf('steps')} × U-Net + text + VAE`, value: est('≈ ' + met('msPerImage') + ' ms'), note: 'sin overheads, sin el tráfico de activaciones ni la parte que no usa tensor cores (GroupNorm, softmax, elementwise)' },
          ], result: R`La cota es optimista: la U-Net tiene muchas normas y operaciones elementwise que no usan los tensor cores, y las convs de alta resolución mueven muchas activaciones. Mide en tu GPU con torch.cuda.Event alrededor del bucle (y aparte el VAE): la latencia real es más alta, ${est('varias veces la cota')} (estimación nuestra, sin medición: mídelo). Hardware: hoja de datos de NVIDIA H100 SXM (989 TFLOPS bf16 denso, 3.35 TB/s), las mismas convenciones que la página de inferencia de LLMs.` },
          { t: 'p', html: R`<b>Memoria:</b> pesos en fp16/bf16 = 2 bytes × (${met('pU')} + ${met('pV')} + ${met('pT')}) = ${met('weightBytes')}. Lo que crece son las activaciones con la resolución y el batch (CFG duplica el batch), sobre todo la matriz de atención del nivel 1 sin FlashAttention, y el decoder del VAE a resolución completa (por eso existe <i>tiled VAE decoding</i>).` },
          { t: 'table', caption: 'Trucos de inferencia', head: ['Truco', 'Qué hace', 'Costo / riesgo'], rows: [
            ['fp16/bf16 + SDPA (FlashAttention)', 'Atención sin materializar la matriz N×N; la mayor ganancia en memoria a resolución alta', 'Ninguno real con la U-Net; el VAE de SDXL da NaN en fp16 (decodifica en fp32, <code>force_upcast</code> en diffusers, o usa sdxl-vae-fp16-fix); con el de SD 1.x pasa rara vez'],
            ['Menos pasos con mejor solver', 'DPM-Solver++ / Euler a 20–25 pasos en vez de 50', 'Ninguno a 20+ pasos; debajo de ≈ 10 se nota'],
            ['Destilación (LCM, LCM-LoRA, ADD)', '1–4 pasos y, a veces, sin CFG', 'Otro modelo (o un LoRA); menos diversidad; ADD pierde control con guía'],
            ['Batch', 'Varias imágenes por llamada: la U-Net a 64×64 ya es bastante compute-bound, así que el batch ayuda menos que en LLMs', 'Latencia por petición sube; memoria'],
            ['torch.compile / TensorRT', 'Fusiona GroupNorm + SiLU + conv, CUDA graphs', 'Tiempo de compilación; formas fijas'],
            ['Token merging (ToMe para SD)', 'Fusiona tokens parecidos antes de la atención, sin reentrenar; hasta 2× más rápido según el paper', R`Algo de calidad; ${TOME}`],
            ['Cache de features entre pasos (DeepCache)', 'Reusa las features de alto nivel de la U-Net entre pasos vecinos y solo recalcula la rama superficial', R`2.3× en SD 1.5 según el paper; ${DEEPC}`],
            ['Tiny VAE (TAESD) para previews', 'Decoder mucho más chico para mostrar pasos intermedios', 'Menos calidad: solo para preview'],
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Comparado con un LLM (<a href="#llm-inferencia">inferencia de LLMs</a>): no hay KV cache ni decode memory-bound; cada paso es un forward completo sobre un tensor de tamaño fijo, más parecido a un prefill. La latencia es <b>pasos × costo por paso</b>, y la palanca grande es bajar los pasos, no el batch.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p><b>Puente a robótica.</b> Diffusion Policy (${DPOL}) usa esta misma maquinaria. Lo que se genera es un <b>chunk de acciones</b>: en la configuración típica predice T<sub>p</sub> = 16 pasos, ejecuta T<sub>a</sub> = 8 y replanifica, condicionado en las últimas T<sub>o</sub> = 2 observaciones; en la versión CNN la observación entra por FiLM (escala y sesgo por canal), como el t en esta U-Net. Se entrena con 100 pasos de DDPM y en los robots reales se muestrea con 10–16 de DDIM (≈ 0.1 s con 10 pasos en una RTX 3080, según el paper). <b>Por qué difusión y no MSE</b>: con dos formas válidas de rodear un obstáculo, la MSE predice el promedio y choca; la difusión muestrea un modo. Otras salidas multimodales: tokens discretos con softmax (RT-2, OpenVLA), mezcla de gaussianas o un CVAE (ACT). Más en <a href="#imitation">Imitation learning</a> (Próximamente); el camino recto para acciones (π0) está en <a href="#dit">DiT + flow matching</a>.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Texto en la imagen.</b> "The model cannot render legible text" (${CARD}, limitaciones). Dos causas: el VAE f = 8 pierde los trazos finos, y el text encoder de CLIP ve el prompt como significado, no como deletreo. Imagen mostró que escalar el encoder de lenguaje (T5-XXL, congelado) mejora la alineación con el prompt más que escalar la red de difusión (${IMAGEN}); SD3 suma T5-XXL a sus encoders CLIP y dibuja texto bastante mejor (ver <a href="#dit">DiT</a>).`,
            R`<b>Manos, conteos y composición.</b> Seis dedos, "tres gatos" que salen cuatro, "un cubo rojo sobre una esfera azul" con los colores cambiados (la card lo da como ejemplo de composición difícil). La pérdida es por elemento del latente: no hay nada que castigue un dedo de más si la textura es plausible. Y CLIP tiende a tratar el texto como "bolsa de palabras": le cuesta el orden y la asignación de atributos (${BOW}).`,
            R`<b>Prompts largos.</b> El text encoder ve ${cf('T')} tokens con el de inicio y el EOT (fin de texto): el resto se <b>trunca</b> sin aviso. Las interfaces que "aceptan" prompts largos los parten en trozos de 75 y concatenan los embeddings: funciona, pero no es lo que el modelo vio al entrenar.`,
            R`<b>Brillo medio y CFG alto.</b> El schedule de SD no llega a ruido puro en t = T (\(\sqrt{\bar\alpha_T}\) ≈ 0.068): el modelo aprendió que en t = T queda algo de la imagen (su brillo medio), pero al generar arranca de ruido puro; resultado: le cuesta hacer imágenes muy oscuras o muy claras. Arreglos: schedule con SNR terminal cero + v-prediction + empezar en el último paso ("trailing") + CFG rescale (${ZSNR}); el "offset noise" es un parche que también sirve. Y con w alto, sobresaturación.`,
            R`<b>Memorización y copyright.</b> Carlini et al. generaron 175 millones de imágenes con los 350,000 captions más duplicados de LAION y extrajeron 94 casi-copias de imágenes de entrenamiento (109 con revisión manual): sobre todo imágenes duplicadas muchas veces en el dataset (${CARLINI}). Somepalli et al. muestran copias de estilo y de composición (${SOMEP}). La mitigación principal es deduplicar los datos.`,
            R`<b>Contenido inseguro y sesgos.</b> LAION trae contenido NSFW y sesgos (profesiones, géneros, etnias). SD 1.x se distribuye con un <b>safety checker</b> en diffusers: compara el embedding CLIP de la imagen generada con embeddings de conceptos NSFW ocultos y umbrales fijos, <b>después</b> de generar (${CARD}). Es un filtro de salida, fácil de apagar; SD 2.x filtró los datos de entrenamiento.`,
          ] },
          { t: 'h3', text: 'Trade-offs que se preguntan' },
          { t: 'table', caption: 'Decisiones de diseño (filas = criterios)', head: ['Criterio', 'Píxeles (DDPM, Imagen)', 'Latente (SD)', 'Comentario'], rows: [
            ['Costo por paso', 'Alto: la red ve H×W×3', R`${met('comp')}× menos valores`, 'Imagen usa una cascada: base a 64×64 + super-resolución'],
            ['Detalle fino', 'Sin techo del autoencoder', 'Limitado por el VAE (texto chico, caras chicas)', 'SD3/Flux pasan a 16 canales de latente'],
            ['Entrenamiento', 'Una etapa', 'Dos etapas (VAE, después difusión)', 'El VAE se reusa entre modelos'],
          ] },
          { t: 'table', head: ['Criterio', 'U-Net (SD 1.5, SDXL)', 'Transformer (DiT, SD3, Flux)'], rows: [
            ['Sesgo inductivo', 'Convs locales + atención en algunos niveles', 'Solo atención sobre parches del latente'],
            ['Escalado', 'Muchos hiperparámetros (canales por nivel, dónde va la atención)', 'Una receta: más capas/ancho, menos patch → mejor FID de forma predecible'],
            ['Condición', 'Cross-attention al texto + t sumado en los resblocks', 'adaLN (DiT) o atención conjunta texto-imagen (MMDiT)'],
            ['Costo con la resolución', 'Convs lineales en posiciones; atención cuadrática en los niveles altos', 'Todo es atención: cuadrático en tokens (se compensa con patch 2 y latentes chicos)'],
            ['Dónde lo ves', 'Esta página', '<a href="#dit">DiT + flow matching</a>'],
          ] },
          { t: 'table', head: ['Criterio', 'ε-prediction', 'v-prediction', 'Flow matching (velocidad)'], rows: [
            ['Qué predice', 'El ruido ε', R`\(v = \sqrt{\bar\alpha_t}\,\varepsilon - \sqrt{1-\bar\alpha_t}\,x_0\)`, R`\(v = \varepsilon - x_0\) en el camino recto x_t = (1 − t)x₀ + tε`],
            ['Dónde falla', 'En t ≈ T: predecir ε de algo que ya es casi todo ε dice poco de x₀', 'Estable en todos los t, incluido SNR = 0', 'Igual que v; el camino por par es recto, pero con buen solver la ventaja en pasos es empírica (SD3) y depende de la agenda'],
            ['Quién la usa', 'SD 1.x, SD 2-base, SDXL', 'SD 2.x 768-v; necesaria con SNR terminal cero', 'SD3, Flux; π0 para acciones'],
            ['Fuente', DDPM, VPRED, '<a href="#dit">DiT + flow matching</a>'],
          ] },
          { t: 'callout', kind: 'senior', html: R`<p>"Steps vs quality" no es un trade-off continuo: con un buen solver (DPM-Solver++, Euler) la calidad satura alrededor de 20–30 pasos; debajo de ≈ 10 cae rápido, y la única forma de llegar a 1–4 pasos es <b>destilar</b> (LCM, ADD, progressive distillation), que cambia el modelo y suele costar diversidad. Lo que un entrevistador anota: separar "mejor integrador" de "modelo destilado".</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo / técnica', 'Qué cambia (una línea)', 'Dónde lo ves'], rows: [
            [R`LDM (${LDM})`, 'El paper: difusión en el latente de un autoencoder, cross-attention para condicionar; el modelo de texto del paper usa un transformer propio y LAION-400M.', 'Esta página'],
            ['SD 1.4 / 1.5', 'CLIP ViT-L/14 congelado como condicionador, LAION-2B y subconjuntos estéticos; 1.5 = más pasos que 1.4 desde el mismo punto.', 'Esta página'],
            ['SD 2.0 / 2.1 (Stability AI, 2022)', 'Text encoder OpenCLIP ViT-H/14 (cross-attention de 1024); modelo de 768 px entrenado con <b>v-prediction</b> (el de 512 sigue con ε); datos filtrados de NSFW. Misma U-Net en tamaño.', R`<a href="#stable-diffusion.fallas">Fallas</a> (ε vs v)`],
            [R`SDXL (${SDXL})`, R`U-Net de ${qn('metrics.unetParams', XL)} parámetros (2.6B en la Tabla 1 del paper), 1024 px, dos text encoders (OpenCLIP ViT-bigG + CLIP ViT-L, concatenados: ${qn('cfg.Dtxt', XL)}), condicionamiento por tamaño y recorte, buckets de aspecto y un refiner opcional; sin atención en el nivel de mayor resolución.`, R`<a href="#stable-diffusion.costo">Costo</a> (compare)`],
            [R`ControlNet (${CNET})`, 'Copia entrenable del encoder de la U-Net que recibe un mapa (bordes, pose, profundidad) y suma su salida a los 12 skips y al bloque medio con convs 1×1 inicializadas en cero; la U-Net original queda congelada.', 'Entrevista'],
            [R`LoRA (${LORA})`, 'Matrices de rango bajo sumadas a las proyecciones de atención (Q, K, V, O) de la U-Net; megabytes en vez de gigabytes por estilo o sujeto.', 'Entrevista'],
            [R`DreamBooth (${DB})`, 'Fine-tuning de toda la U-Net (y a veces el text encoder) con 3–5 fotos y un identificador raro ("a [V] dog") + pérdida de preservación de la clase con imágenes generadas por el propio modelo.', 'Entrevista'],
            [R`Textual inversion (${TI})`, 'Solo se aprende el embedding de una palabra nueva; el modelo entero congelado. Pocos KB, menos fidelidad.', 'Entrevista'],
            [R`Inpainting / img2img (${SDEDIT})`, 'img2img: arrancar de la imagen con ruido hasta un t intermedio (strength) y muestrear desde ahí. Inpainting: un modelo con canales extra (máscara + imagen enmascarada).', 'Entrevista'],
            [R`LCM / LCM-LoRA (${LCM})`, 'Destilación de consistencia en el latente: 2–4 pasos; la guía queda dentro del modelo. LCM-LoRA lo empaqueta como un LoRA.', R`<a href="#stable-diffusion.inferencia">Inferencia</a>`],
            [R`SDXL-Turbo (${ADD})`, 'SDXL destilado con ADD: 1–4 pasos a 512×512, sin CFG (guidance_scale = 0).', R`<a href="#stable-diffusion.inferencia">Inferencia</a>`],
            ['DiT, SD3 (MMDiT), Flux', 'La U-Net se reemplaza por un transformer sobre parches del latente; SD3 y Flux además entrenan con rectified flow.', '<a href="#dit">DiT + flow matching</a>'],
            [R`Imagen (${IMAGEN})`, 'Difusión en píxeles en cascada (64 → 256 → 1024) condicionada por T5-XXL congelado; dynamic thresholding para CFG alto.', '—'],
            ['Diffusion Policy (Chi et al., RSS 2023, arXiv:2303.04137)', 'La misma maquinaria (DDPM/DDIM, U-Net 1-D condicionada) para generar secuencias de acciones de un robot.', R`<a href="#imitation">Imitation learning</a> (Próximamente)`],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Difusión aparece en entrevistas de dos formas: "explícame cómo funciona" (con o sin matemática) y preguntas de sistema (costo, latencia, fine-tuning, evaluación). Preguntas en inglés, respuestas en español; cada senior trae la frase para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Explain diffusion models to me in two minutes, first without math, then with math.',
              junior: 'Es una red que genera imágenes a partir de ruido.',
              senior: R`<b>Sin matemática</b>: hay un proceso fijo que destruye una imagen agregándole ruido en mil pasitos hasta que es ruido puro. Entreno una red para el camino de vuelta: le muestro una imagen con ruido en un nivel al azar y le pido que diga cuál fue el ruido. Es una regresión, estable. Para generar, parto de ruido y aplico la red repetidas veces, quitando un poco de ruido cada vez. Si le doy texto, quita el ruido "en la dirección" de ese texto. <b>Con matemática</b>: el forward es \(q(x_t\mid x_0) = \mathcal{N}(\sqrt{\bar\alpha_t}x_0, (1-\bar\alpha_t)I)\), así que \(x_t = \sqrt{\bar\alpha_t}x_0 + \sqrt{1-\bar\alpha_t}\varepsilon\) en un paso. La pérdida es \(\lVert\varepsilon - \varepsilon_\theta(x_t, t, c)\rVert^2\) con t uniforme. Para muestrear, de ε̂ saco \(\hat x_0\) y doy un paso a t menor con DDPM (estocástico, 1,000 pasos) o DDIM (determinista, ≈ 50). En SD todo pasa en un latente de ${sh('lat')} del VAE, y la U-Net corre 2 veces por paso por CFG.`,
              say: 'A fixed forward process gradually adds Gaussian noise until the image is pure noise. We train a network to predict the noise that was added at a random noise level, which is just an MSE regression. To generate, we start from noise and repeatedly subtract the predicted noise with a sampler like DDIM. Mathematically, x_t is square root of alpha-bar times x_0 plus square root of one minus alpha-bar times epsilon, and the loss is the squared error between the true and predicted epsilon.',
              why: 'Se anota que sepas bajar de la intuición a la fórmula sin perderte: forma cerrada, pérdida, un sampler, y dónde entra el texto.' },
            { q: 'Why predict the noise instead of the clean image?',
              junior: 'Porque es más fácil predecir ruido.',
              senior: R`Tres razones. (1) <b>Escala</b>: ε es N(0, I) en todos los t, así que el objetivo tiene la misma magnitud en todo el rango y la MSE pesa los t de forma pareja; x₀ es casi imposible en t alto y trivial en t bajo. (2) <b>Evidencia</b>: en DDPM, predecir ε con la MSE simplificada dio FID 3.17 en CIFAR-10, y predecir la media μ̃ con MSE fue inestable (Tabla 2). (3) <b>Teoría</b>: ε̂ es, salvo un factor \(-1/\sqrt{1-\bar\alpha_t}\), el score \(\nabla_{x_t}\log p(x_t)\): predecir ruido es denoising score matching a varios niveles. Pero son parametrizaciones intercambiables (de ε̂ sale x̂₀ con una línea), y ε falla justo cerca de t = T, donde x_t ya es casi ε: por eso SD 2 usa v-prediction y los modelos de flow matching predicen una velocidad.`,
              say: 'Noise has the same unit scale at every timestep, so the regression target is well conditioned across noise levels, and in the DDPM ablation it trained much better than predicting the mean. It also equals a scaled score function, so it is denoising score matching. The parameterizations are interchangeable, and epsilon breaks down near pure noise, which is why v-prediction and flow matching exist.',
              why: 'Trampa: decir "es más fácil" sin explicar por qué. Se anota la escala por t, la ablación y que no es la única opción (v, flow).', trap: true },
            { q: 'Derive why predicting ε is equivalent to predicting x₀ and to estimating the score.',
              junior: 'Porque se puede despejar x₀ de x_t.',
              senior: R`Tres líneas. (1) <b>ε ↔ x₀</b>: \(x_t = \sqrt{\bar\alpha_t}\,x_0 + \sqrt{1-\bar\alpha_t}\,\varepsilon\) es lineal, así que \(\hat x_0 = (x_t-\sqrt{1-\bar\alpha_t}\,\hat\varepsilon)/\sqrt{\bar\alpha_t}\) y \(x_0-\hat x_0 = -\sqrt{(1-\bar\alpha_t)/\bar\alpha_t}\,(\varepsilon-\hat\varepsilon)\). Al cuadrado: \(\lVert\varepsilon-\hat\varepsilon\rVert^2 = \mathrm{SNR}(t)\,\lVert x_0-\hat x_0\rVert^2\). Predecir ε con MSE <b>es</b> predecir x₀ con una MSE pesada por SNR(t): pesa mucho los t bajos (casi limpios) y casi nada los altos. Min-SNR recorta ese peso a min(SNR, 5) y converge más rápido (${MINSNR}). Con \(v = \sqrt{\bar\alpha_t}\,\varepsilon - \sqrt{1-\bar\alpha_t}\,x_0\) (Salimans y Ho), \(\lVert v-\hat v\rVert^2 = (\mathrm{SNR}(t)+1)\,\lVert x_0-\hat x_0\rVert^2\): el peso no se anula en SNR = 0. (2) <b>Qué aprende</b>: la MSE se minimiza con la media condicional, ε* = E[ε | x_t], y por lo tanto x̂₀ = E[x₀ | x_t]. Por eso x̂₀ es borroso en t alto: es el promedio de las imágenes compatibles con x_t. (3) <b>Score</b>: \(\nabla_{x_t}\log q(x_t\mid x_0)\) vale \(-(x_t-\sqrt{\bar\alpha_t}\,x_0)/(1-\bar\alpha_t)\), que es \(-\varepsilon/\sqrt{1-\bar\alpha_t}\). Por denoising score matching (Vincent, 2011), el minimizador de \(\mathbb{E}\lVert s(x_t)-\nabla\log q(x_t\mid x_0)\rVert^2\) es el score de la marginal, \(\nabla\log p_t(x_t)\). Juntando: \(\varepsilon^*(x_t) = -\sqrt{1-\bar\alpha_t}\,\nabla\log p_t(x_t)\). Es la fórmula de Tweedie leída al revés: \(\mathbb{E}[x_0\mid x_t]\) = \(\big(x_t + (1-\bar\alpha_t)\nabla\log p_t(x_t)\big)/\sqrt{\bar\alpha_t}\). Conclusión: ε, x₀, score y v son la misma función con factores que dependen de t; entre ellos cambian el peso implícito por t y la estabilidad numérica en los extremos.`,
              say: 'The forward process is linear, so x-zero-hat is an affine function of epsilon-hat, and the epsilon MSE equals the x-zero MSE weighted by the signal-to-noise ratio. The MSE minimizer is a conditional mean, so x-zero-hat is the posterior mean, which is why it looks blurry at high noise. The gradient of the log Gaussian transition is minus epsilon over sigma, so by denoising score matching the optimal noise predictor is minus sigma times the score. Same function, different time-dependent scaling and loss weighting.',
              why: 'Trampa: decir "es equivalente" sin poder escribir el factor. Se anota la identidad con SNR(t), la media condicional (Tweedie) y el score como −ε/σ.', trap: true },
            { q: 'Why do diffusion in a latent space instead of pixels?',
              junior: 'Para que la imagen pese menos.',
              senior: R`Porque casi todos los bits de una imagen son detalle de alta frecuencia que no cambia la semántica, y en píxeles la red de difusión gastaría capacidad y cómputo en eso, ${cf('steps')} × 2 veces por imagen. El paper separa compresión perceptual (un autoencoder con pérdida perceptual + adversarial, entrenado una vez) y compresión semántica (la difusión). Con f = 8 y 4 canales el latente tiene ${met('comp')}× menos valores (${sh('img')} → ${sh('lat')}); el barrido de f del paper da f = 4–8 como mejor punto (con f = 1–2 entrena lento, con 32 pierde calidad). El costo: el techo de detalle lo pone el decoder del VAE (texto chico, caras chicas), y por eso los modelos nuevos usan latentes de 16 canales.`,
              say: 'Most pixel bits are imperceptible high-frequency detail. A separately trained autoencoder with perceptual and adversarial losses compresses the image by forty-eight times, and the diffusion model only has to learn the semantic part, which makes each of the many denoising steps much cheaper. The trade-off is that the VAE caps fine detail, like small text.',
              why: 'Se anota: el número (48×), la separación perceptual/semántica, el barrido de f y el costo (techo de detalle).' },
            { q: 'Why is the VAE trained separately, and why not just MSE?',
              junior: 'Porque así se entrena más rápido.',
              senior: 'Con MSE sola, un autoencoder que comprime ×48 da reconstrucciones borrosas: la MSE premia el promedio de las texturas posibles. La pérdida perceptual (LPIPS) compara features de una red, y el discriminador de parches castiga lo que no parece una textura real: el decoder aprende a <b>inventar</b> detalle plausible. El KL con peso ≈ 10⁻⁶ solo evita que el latente tenga varianza arbitraria. Entrenarlo aparte y congelarlo da a la difusión un espacio fijo (no se mueve mientras la U-Net aprende), y el mismo autoencoder se reusa entre modelos. Detalle práctico: el latente se escala por 0.18215 para tener desviación ≈ 1; olvidarlo rompe el schedule de ruido.',
              say: 'Pure MSE gives blurry reconstructions at forty-eight-times compression. Perceptual and patch-adversarial losses make the decoder produce sharp, plausible texture, and the tiny KL term just keeps the latent variance bounded. Training it first and freezing it gives the diffusion model a fixed target space, and the latent is rescaled to unit variance.',
              why: 'Se anota que el VAE "inventa" textura (no es un VAE generativo en el sentido clásico) y el factor de escala.', trap: true },
            { q: 'What is classifier-free guidance, and why does it double the cost?',
              junior: 'Es un parámetro que hace que la imagen se parezca más al prompt.',
              senior: R`Entrenas un solo modelo condicional, pero el 10 % de las veces le borras el texto (prompt vacío), así que también aprende ε(x_t, ∅). Al muestrear evalúas las dos y extrapolas: \(\hat\varepsilon = \hat\varepsilon_u + w(\hat\varepsilon_c - \hat\varepsilon_u)\). La diferencia es, salvo escala, el gradiente de \(\log p(c\mid x_t)\): un clasificador implícito, sin entrenar uno aparte (de ahí el nombre). w = 1 es el modelo condicional sin guía; 7.5 es el default. Dobla el costo porque son dos evaluaciones de la U-Net por paso (en la práctica, una con batch 2). Trade-off: más w, más fidelidad al prompt y menos diversidad; demasiado, colores quemados. Ojo con la convención: el paper escribe (1 + w)ε_c − wε_u, así que su w es el de diffusers menos uno.`,
              say: 'You train one model and drop the text ten percent of the time, so it also learns the unconditional prediction. At sampling you run both and extrapolate from the unconditional toward the conditional prediction by a scale w. The difference acts like the gradient of an implicit classifier. It doubles cost because every step needs two U-Net evaluations, usually done as a batch of two. Higher w gives better prompt adherence and less diversity, and too high oversaturates.',
              why: 'Se anota el dropout en entrenamiento, la fórmula, por qué es ×2 y el trade-off. La convención (1 + w) es un detalle que distingue a quien leyó el paper.' },
            { q: 'Why does classifier-free guidance work, and what breaks at high guidance scales?',
              junior: 'Porque amplifica el prompt; si lo subes mucho la imagen se satura.',
              senior: R`<b>Por qué funciona</b>: por Bayes, \(p(c\mid x_t)\propto p(x_t\mid c)/p(x_t)\), así que \(\nabla\log p(c\mid x_t)\) = \(\nabla\log p(x_t\mid c)-\nabla\log p(x_t)\). Como ε̂ = −σ_t·score (con \(\sigma_t = \sqrt{1-\bar\alpha_t}\)), \(\hat\varepsilon_c - \hat\varepsilon_u = -\sigma_t\,\nabla\log p(c\mid x_t)\): el gradiente de un clasificador implícito. Guiar con w (convención de diffusers) equivale a seguir el score de \(p(x_t)\,p(c\mid x_t)^{w}\): un clasificador "afilado" (temperatura 1/w). Salen muestras más típicas de c y menos diversas. Classifier guidance (${ADM}) hacía lo mismo con un clasificador aparte entrenado sobre imágenes ruidosas; CFG lo saca del propio modelo y evita los gradientes adversariales de ese clasificador. <b>Qué se rompe</b>: (1) \(p(x_t)\,p(c\mid x_t)^w\) en cada t <b>no</b> es la versión ruidosa de una misma distribución \(p(x_0)\,p(c\mid x_0)^w\): el sampler sigue un campo que no es el score de ningún proceso de difusión. Con w alto, x̂₀ se sale del rango de los datos: sobresaturación, contraste quemado, texturas repetidas. (2) Colapsa la diversidad: el recall cae. (3) No pesa igual en todos los t: con mucho ruido la guía fija la composición y mata variedad; con poco ruido casi no aporta. <b>Arreglos</b>: dynamic thresholding (Imagen: recortar x̂₀ a un percentil y reescalar), CFG rescale (${ZSNR}: igualar la desviación de la predicción guiada a la de la condicional y mezclar con φ ≈ 0.7), guiar solo en un intervalo intermedio de ruido (${GINT}) o destilar la guía en el modelo (${GDIST}). Ojo con la intuición "guía solo en los primeros pasos": es justo el tramo de mucho ruido, donde la guía más daña la diversidad; el resultado del intervalo es apagarla al principio y al final.`,
              say: 'By Bayes, the gradient of log p of c given x is the conditional score minus the unconditional score, and epsilon is minus sigma times the score, so the difference of the two predictions is an implicit classifier gradient. Guidance scale w samples from p of x times p of c given x to the power w, a sharpened classifier, so samples get more typical and less diverse. At high scale the guided field is no longer the score of any diffused distribution, x-zero-hat leaves the data range and images oversaturate; fixes are dynamic thresholding, CFG rescale, guidance only in a middle noise interval, or distilling guidance.',
              why: 'Se anota la derivación por Bayes, la distribución afilada p·p(c|x)^w, por qué se rompe (no es un score válido, x̂₀ fuera de rango) y al menos dos arreglos.', trap: true },
            { q: 'How many U-Net evaluations does it take to make one image, and how would you cut that?',
              junior: 'Cincuenta, uno por paso.',
              senior: R`Con 50 pasos y CFG son ${cf('nfe')} evaluaciones (${met('mImg')} por imagen, casi todo U-Net). Palancas, de menor a mayor esfuerzo: (1) <b>mejor solver</b>: DPM-Solver++ o Euler a 20–25 pasos, sin reentrenar; (2) <b>sacar CFG en parte</b>: guiar solo en un intervalo de ruido (en los últimos pasos casi no aporta y apagarla ahorra NFE; en los primeros reduce la diversidad: ${GINT}), o destilar la guía (${GDIST}; LCM la trae adentro) → hasta la mitad de evaluaciones; (3) <b>destilar</b> a 1–4 pasos: LCM / LCM-LoRA (consistencia), ADD / SDXL-Turbo (adversarial), progressive distillation; (4) <b>reusar trabajo entre pasos</b>: DeepCache (features altas de la U-Net cacheadas, 2.3× en SD 1.5 según el paper); (5) <b>hacer cada evaluación más barata</b>: fp16 + FlashAttention, ToMe, torch.compile/TensorRT, menor resolución + upscaler. Siempre midiendo calidad (FID/CLIP score en un set fijo de prompts y una evaluación humana) antes y después: destilar cuesta diversidad.`,
              say: 'Fifty steps with guidance is a hundred U-Net evaluations. I would first switch to a better solver at twenty to twenty-five steps, then remove or bake in guidance, then distill to one to four steps with LCM or adversarial distillation, and make each step cheaper with half precision, flash attention and compilation. I would track FID, CLIP score and human preference, because distillation costs diversity.',
              why: 'Trampa: olvidar CFG (×2). Se anota el número, separar solver de destilación y que se mide la calidad.', trap: true },
            { q: 'What does the sampler change (DDIM vs DPM-Solver vs Euler), and why can you cut steps without retraining?',
              junior: 'Unos son más rápidos que otros.',
              senior: R`La red fija un campo (ε̂ ≈ −σ_t·score); el sampler es el <b>integrador</b> de la probability-flow ODE. (1) <b>DDIM</b> (η = 0) es un paso de primer orden de esa ODE en la variable correcta; de hecho es exactamente DPM-Solver de orden 1. (2) <b>DPM-Solver</b> (${DPMS}) aprovecha que la ODE es semilineal: integra exacta la parte lineal en x (integrador exponencial) y solo aproxima el término de ε̂ con Taylor en λ = log(α_t/σ_t) (medio log-SNR). Con orden 2–3 bastan 10–20 pasos. DPM-Solver++ trabaja con x̂₀ y es más estable con CFG alto; "2M" es multipaso: reusa el ε̂ del paso anterior, así que tiene segundo orden con 1 NFE por paso. (3) <b>Euler/Heun de EDM</b> (${EDM}): la misma ODE en la parametrización σ (x = x₀ + σ·ε), con pasos espaciados según Karras (más pasos a σ chico); Heun es de segundo orden pero cuesta 2 NFE por paso. (4) <b>Ancestrales</b> ("Euler a") y DDPM meten ruido en cada paso (SDE): corrigen errores acumulados y dan más variedad, pero no convergen a una imagen fija al subir los pasos y necesitan más. <b>Por qué se pueden cortar pasos</b>: el error de discretizar depende del orden del método y de la curvatura de la trayectoria, no de los T = ${cf('trainSteps')} pasos del entrenamiento (la pérdida solo dependía de las marginales). <b>Límite</b>: debajo de ≈ 10 NFE la curvatura es real y ningún integrador alcanza; hay que destilar. Bonus: un sampler determinista se puede invertir (DDIM inversion) para editar fotos reales.`,
              say: 'The network defines the field and the sampler is just an ODE integrator. DDIM is a first-order step and equals first-order DPM-Solver; DPM-Solver integrates the linear part exactly and uses a higher-order Taylor expansion in log-SNR, and the multistep 2M variant reuses the previous evaluation, so it gets second order at one evaluation per step. Ancestral samplers inject noise, which adds diversity but needs more steps. You can cut steps because discretization error depends on solver order and path curvature, not on the thousand training steps; below about ten evaluations you need distillation.',
              why: 'Se anota: el sampler es un integrador, DDIM = DPM-Solver-1, semilineal + log-SNR, multipaso = 1 NFE, ODE vs ancestral, y dónde deja de alcanzar.' },
            { q: 'How do distillation methods (progressive, consistency/LCM, adversarial) get diffusion to 1–4 steps?',
              junior: 'Entrenas un modelo más chico que imita al grande.',
              senior: R`No es un modelo más chico: es el mismo tamaño, entrenado para <b>saltar</b> más. Cuatro familias. (1) <b>Progressive distillation</b> (${VPRED}): el alumno aprende a hacer en 1 paso lo que el maestro hace en 2 pasos DDIM; se repite y cada ronda parte del alumno anterior (de miles de pasos a 4). Usan v-prediction (o x₀) porque con pocos pasos ε falla cerca del ruido puro. (2) <b>Consistency models</b> (${CM}): una red f(x_t, t) que lleva cualquier punto de una trayectoria de la ODE a su origen x₀. Se entrena con autoconsistencia: f(x_{t_{n+1}}) ≈ f_EMA(x̂_{t_n}), donde x̂_{t_n} sale de un paso del solver del maestro (destilación) o sin maestro (consistency training). Una parametrización con skip fuerza f(x, t_min) = x. Se muestrea en 1 paso, o en 2–4 volviendo a agregar ruido. (3) <b>LCM</b> (${LCM}): lo mismo en el latente de SD, sobre la ODE <b>ya guiada</b> (w queda adentro: sin CFG en inferencia, ÷2) y saltando k pasos del maestro en cada objetivo; LCM-LoRA lo entrena como un LoRA. (4) <b>Adversarial</b>: ADD (SDXL-Turbo, ${ADD}) parte de imágenes reales con ruido y combina una pérdida adversarial (un discriminador sobre features congeladas de DINOv2) para la nitidez con score distillation del maestro para la fidelidad; DMD (${DMD}) iguala la distribución del alumno con la del maestro (distribution matching). Aparte: guidance distillation (${GDIST}) mete la CFG en una sola pasada (÷2 sin bajar pasos), y reflow endereza un modelo de flujo (ver <a href="#dit">DiT</a>). Costos: un entrenamiento extra, menos diversidad, a veces perder la perilla de CFG o el negative prompt; con 1 paso suelen salir texturas más planas.`,
              say: 'Distillation keeps the model size but teaches it to take bigger jumps. Progressive distillation halves the step count repeatedly by matching two teacher DDIM steps with one student step. Consistency models learn a function that maps any point on an ODE trajectory straight to its origin, trained by making adjacent points agree; LCM does this in latent space with guidance baked in. Adversarial diffusion distillation adds a discriminator for sharpness plus score distillation from the teacher. The cost is extra training and less diversity.',
              why: 'Trampa: "un modelo más chico". Se anota el mecanismo de cada familia en una frase, que LCM trae la guía adentro y qué se pierde.', trap: true },
            { q: 'Where does the text enter the U-Net, and why cross-attention rather than concatenation?',
              junior: 'Se concatena el embedding del texto a la imagen.',
              senior: R`En cada bloque transformer de los niveles 1–3 y del medio: después de la self-attention, una cross-attention donde las queries salen de las posiciones del latente y las keys/values de los ${cf('T')} tokens de CLIP (${sh('ctx')}), proyectados de ${cf('Dtxt')} al ancho del nivel. Por qué así: (1) la condición es una <b>secuencia</b> de largo variable; concatenarla a un mapa espacial obligaría a resumirla en un vector (y "robot" y "plantas" quedarían mezclados); (2) cada región elige a qué palabra atender: control espacial implícito; (3) es barata (\(N_\ell\times T_\text{txt}\) con T<sub>txt</sub> = ${cf('T')}). El paso t, en cambio, sí entra como un vector sumado (o escalado en adaLN de DiT), porque es un escalar global. Alternativas: concatenar tokens de texto e imagen en la misma atención (MMDiT de SD3) y adaLN con el embedding pooled (SDXL también suma el pooled de CLIP al embedding de t).`,
              say: 'Text enters through cross-attention in every transformer block: queries come from the latent positions, keys and values from the seventy-seven CLIP token embeddings. It handles a variable-length sequence and lets each spatial location attend to the words that matter there, at a small cost. The timestep, being a global scalar, is just added to every residual block.',
              why: 'Se anota Q de la imagen y K, V del texto, que es la secuencia y no el embedding pooled, y por qué el t entra distinto.' },
            { q: 'You need to fine-tune Stable Diffusion on 20 photos of a product. DreamBooth, LoRA or textual inversion?',
              junior: 'Fine-tuning de todo el modelo con las 20 fotos.',
              senior: R`Depende de fidelidad vs costo vs portabilidad. <b>Textual inversion</b>: aprendo solo el embedding de un token nuevo (modelo congelado): KBs, barato, pero captura "el concepto" y no detalles finos de un producto (logos, texto, geometría). <b>DreamBooth</b>: ajusto toda la U-Net (y a veces el text encoder) con un identificador raro ("a [V] bottle") + <b>pérdida de preservación de la clase</b> con imágenes generadas por el modelo original de "a bottle", para que no olvide la clase ni se sobreajuste (el paper usa 3–5 fotos; con Imagen, ≈ 1,000 iteraciones): máxima fidelidad, un checkpoint entero por sujeto, fácil de sobreajustar. <b>LoRA</b> (sola o combinada con la receta de DreamBooth): matrices de rango bajo en las proyecciones de atención; fidelidad cercana a DreamBooth, MBs por sujeto, se puede combinar y apagar. <b>Memoria</b> (SD 1.5 a 512): DreamBooth completo entrena los ${met('pU')} parámetros de la U-Net con AdamW en precisión mixta, ${est('≈ 16 bytes por parámetro ≈ 14 GB')} entre pesos, gradientes y estados del optimizador, más activaciones: una GPU de 24 GB, o Adam de 8 bits + gradient checkpointing. LoRA de rango 4–32 en Q, K, V y O de las atenciones: ${est('≈ 0.8–6.4 M parámetros, ≈ 1.6–13 MB en fp16')} (r × Σ(d<sub>in</sub> + d<sub>out</sub>) sobre esas proyecciones, contado en el venv), y el entrenamiento entra en ${est('≈ 8–12 GB')}. Textual inversion: un vector de ${cf('Dtxt')} números (≈ 3 KB en fp32). Para un producto elijo <b>DreamBooth + LoRA</b> con prior preservation, captions variados (fondos, ángulos), LR bajo y pocos cientos de pasos, y valido con prompts que pongan el producto en contextos nuevos. Si lo crítico es el logo o el texto del empaque, ninguno lo garantiza: inpainting del logo real o ControlNet con la silueta.`,
              say: 'Textual inversion only learns a new token embedding, so it is tiny but weak on fine product details. DreamBooth fine-tunes the U-Net with a rare identifier and a class prior-preservation loss, giving the best fidelity at the cost of a full checkpoint and overfitting risk. LoRA trains low-rank adapters on the attention projections and gets close to DreamBooth fidelity in a few megabytes. For a product I would do DreamBooth-style training with LoRA and prior preservation, and paste the real logo with inpainting if it must be exact. Full DreamBooth needs roughly fourteen gigabytes of weights, gradients and optimizer state for the U-Net, LoRA training fits in about eight to twelve, and textual inversion trains a single seven-hundred-sixty-eight-dimensional vector.',
              why: 'Se anota qué entrena cada uno, la pérdida de preservación de clase y su motivo (language drift), tamaño del artefacto y la memoria de entrenamiento, y el límite con logos y texto.' },
            { q: 'How do you evaluate a text-to-image model? What are the traps?',
              junior: 'Con FID: más bajo es mejor.',
              senior: R`Tres ejes. (1) <b>Calidad/realismo</b>: FID (distancia entre gaussianas ajustadas a features de Inception de imágenes reales y generadas, ${FID}), típicamente en COCO-30K zero-shot. Trampas: está sesgado con pocas muestras (compara siempre con el mismo N, ≥ 10K), depende del resize y la compresión (${CLEANFID}), usa features de ImageNet que no ven bien texto ni caras, y no mide si la imagen sigue el prompt; por eso hay alternativas con mejores features: FD-DINOv2 (${FDDINO}) y CMMD con embeddings de CLIP (${CMMD}). Para separar calidad de diversidad, precisión y recall (fracción de muestras dentro de la variedad de los datos reales, y de datos reales cubiertos por las muestras): la guía sube la primera y baja la segunda. Además, la guía fuerte <b>empeora</b> el FID mientras sube el IS y la adherencia al prompt (Ho y Salimans, Tabla 1): un solo número esconde el trade-off. (2) <b>Alineación con el prompt</b>: CLIP score (coseno imagen-texto, ${CLIPS}): satura, se puede "hackear" y hereda la ceguera de CLIP para conteo y relaciones; mejor con métricas por objeto como GenEval (detector que verifica conteo, color, posición, ${GENEVAL}) o VQA-based. (3) <b>Preferencia humana</b>: comparaciones por pares en prompts difíciles (DrawBench de Imagen, PartiPrompts de Parti), con instrucciones claras y varios evaluadores; o modelos de preferencia entrenados (HPS, ImageReward, PickScore) como proxy. Para un producto: un set fijo de prompts de tu dominio con semillas fijas, reportar curvas FID vs CLIP score barriendo w (no un solo número), y diversidad (precisión/recall o distancia entre semillas).`,
              say: 'I measure realism, prompt alignment and human preference separately. FID on a fixed set like COCO with a fixed sample count, knowing it is biased with few samples, sensitive to resizing and blind to prompt adherence. CLIP score for alignment, plus object-level checks like GenEval, since CLIP is weak at counting and relations. And pairwise human preference on hard prompt sets like DrawBench or PartiPrompts. I report FID versus CLIP score curves across guidance scales instead of one number, and precision and recall to separate quality from diversity.',
              why: 'Trampa: un solo número. Se anota qué mide cada métrica, sus sesgos (N, resize, CLIP ciego) y la curva barriendo w.', trap: true },
            { q: 'How would you serve Stable Diffusion: batching, latency, memory?',
              junior: 'Lo pongo en una GPU y ya.',
              senior: R`A diferencia de un LLM, no hay KV cache ni decode memory-bound: cada paso es un forward completo de tamaño fijo, y la latencia es pasos × costo por paso. (1) <b>Latencia</b>: elijo el solver y los pasos (20–25 con DPM-Solver++, o un modelo destilado a 1–4), fp16 + SDPA, compilo (TensorRT/torch.compile) con formas fijas por resolución. (2) <b>Batching</b>: agrupo peticiones con la <b>misma resolución y pasos</b> (formas iguales) en un batch; la U-Net a 64×64 ya aprovecha bastante la GPU con batch 2 (CFG), así que el batch sube el throughput menos que en un LLM y sube la latencia de cada uno. Se puede hacer batching por paso (meter peticiones nuevas entre pasos) si el scheduler lo permite. (3) <b>Memoria</b>: pesos en fp16 ${met('weightBytes')}, activaciones proporcionales a batch × resolución² (y la atención del nivel 1 sin FlashAttention), el decoder del VAE a resolución completa (tiled si hace falta). (3b) <b>Muchos LoRA</b>: si cada cliente tiene su LoRA, lo cargo como adaptador sin fusionar, agrupo las peticiones por LoRA (o uso kernels multi-LoRA para mezclarlas en un batch) y dejo los más usados en la GPU; fusionar en los pesos quita la latencia del adaptador, pero obliga a una copia del modelo por LoRA. (4) <b>Producto</b>: previews con un VAE pequeño, cola por prioridad, cachear embeddings de prompts frecuentes, safety checker y watermark en la salida, y métricas p50/p99 por resolución.`,
              say: 'Unlike an LLM there is no KV cache: each step is a fixed-size forward pass, so latency is steps times cost per step. I cut steps with a better solver or a distilled model, use half precision with flash attention and compile per resolution. I batch requests with the same resolution and step count; the gain is smaller than for LLMs because the U-Net is already fairly compute-bound. Memory is about two gigabytes of weights plus activations that grow with batch and resolution, and the VAE decode at full resolution.',
              why: 'Se anota la diferencia con LLMs, batching por forma, que el batch ayuda menos y la memoria del VAE.' },
            { q: 'What happens if you generate at 1024×1024 with SD 1.5?',
              junior: 'Sale una imagen más grande y con más detalle.',
              senior: R`Dos cosas. <b>Costo</b>: el latente pasa a 128×128 (4× posiciones): convs y lineales ×4, QKᵀ y A·V de la self-attention del nivel 1 ×16 (de ${cf('tokens')} a 4 × ${cf('tokens')} tokens), y su matriz de scores no entra en memoria sin FlashAttention. <b>Calidad</b>: SD 1.5 entrenó a 512; la composición se aprende a esa escala, así que a 1024 suele duplicar sujetos o repetir patrones (dos cabezas, paisajes en mosaico). Soluciones: generar a 512 y subir con un upscaler o con img2img a 1024 (hires fix), o un modelo entrenado a 1024 (SDXL, con buckets de aspecto).`,
              say: 'The latent becomes 128 by 128, so convolutions cost four times more and self-attention at the top level sixteen times more. Quality also suffers, because SD 1.5 learned composition at 512 and tends to duplicate subjects at 1024; the usual fix is generate at 512 and upscale with a second img2img pass, or use SDXL.',
              why: 'Trampa: pensar solo en el costo. Se anota el ×16 de la atención y la duplicación de sujetos por salir de la escala de entrenamiento.', trap: true },
            { q: 'What is a negative prompt, mechanically?',
              junior: 'Una lista de cosas que el modelo debe evitar, que el modelo entiende como "no".',
              senior: R`Es reemplazar el prompt vacío de la rama incondicional de CFG por otro texto: \(\hat\varepsilon = \hat\varepsilon_\text{neg} + w(\hat\varepsilon_c - \hat\varepsilon_\text{neg})\). La guía extrapola <b>alejándose</b> de lo que describe el negativo, además de acercarse al prompt. No hay un "no" en el text encoder (CLIP entiende mal la negación: "sin bigote" en el prompt positivo suele <b>agregar</b> bigote). No cuesta nada extra: la segunda evaluación ya existía. Con modelos sin CFG (SDXL-Turbo) el negative prompt no hace nada.`,
              say: 'A negative prompt replaces the empty prompt in the unconditional branch of classifier-free guidance, so sampling extrapolates away from it. It costs nothing extra, and it works because of guidance, not because the text encoder understands negation.',
              why: 'Trampa: creer que el modelo "entiende" la negación. Se anota la fórmula y que sin CFG no existe.', trap: true },
            { q: 'Why does SD 1.5 struggle with very dark or very bright images?',
              junior: 'Porque el dataset tiene pocas imágenes oscuras.',
              senior: R`Por el schedule: en t = T = 1000 todavía queda señal (\(\sqrt{\bar\alpha_T}\) ≈ 0.068, SNR ≈ 0.0047). Al entrenar, el modelo ve que en t = T el latente conserva un poco de la imagen, en particular su <b>media</b> (el brillo global, la frecuencia más baja, que el ruido tarda más en borrar), y aprende a usarla. Al generar se arranca de ruido puro, que tiene media ≈ 0, y el modelo "ve" brillo medio y lo conserva. Lin et al. lo arreglan con SNR terminal cero (rescalar las β), v-prediction (ε no tiene sentido a SNR 0), empezar el muestreo en t = T ("trailing") y CFG rescale. El "offset noise" (ruido con un componente constante por canal) es un parche que también ayuda.`,
              say: 'The noise schedule never reaches zero signal-to-noise at the last step, so during training the model always sees a bit of the image mean, but at sampling time it starts from pure noise with zero mean. It ends up producing medium brightness. The fix is a zero-terminal-SNR schedule with v-prediction, sampling from the last timestep and guidance rescaling; offset noise is a cheaper patch.',
              why: 'Se anota que es un defecto del schedule (con el número), no de los datos, y los cuatro arreglos.', trap: true },
            { q: 'How does ControlNet add spatial control without breaking the base model?',
              junior: 'Agrega la imagen de bordes como un canal más de entrada.',
              senior: 'Congela la U-Net original y crea una <b>copia entrenable</b> de su encoder (y bloque medio) que recibe el mapa de control (bordes Canny, pose, profundidad) además del latente. Las salidas de la copia se suman a los 12 skips y al bloque medio de la U-Net a través de <b>convs 1×1 inicializadas en cero</b>: al inicio la suma es exactamente cero y el modelo arranca idéntico al original; el gradiente igual llega a los pesos de la conv cero (porque la entrada no es cero), así que aprende sin ruido inicial que dañe al modelo. El paper reporta que funciona con datasets chicos (≪ 50K) y grandes (≫ 1M), con ≈ 23 % más memoria y 34 % más tiempo por iteración que entrenar SD, y que en entrenamiento reemplaza 50 % de los prompts por vacío para forzar a leer el mapa. Agregar un canal de entrada obligaría a reentrenar la primera capa y mueve todo el modelo.',
              say: 'ControlNet freezes the base U-Net and trains a copy of its encoder that sees the control map. The copy feeds the skip connections and middle block through one-by-one convolutions initialized to zero, so training starts exactly from the base model and cannot damage it early on.',
              why: 'Se anota la copia entrenable, las zero convolutions y por qué el gradiente no es cero. Es el mismo truco que la compuerta en cero de Flamingo y adaLN-Zero de DiT.' },
            { q: 'How does img2img "strength" work, what does it cost, and how is inpainting done?',
              junior: 'Strength dice cuánto se parece la salida a la imagen original.',
              senior: R`<b>img2img (SDEdit, ${SDEDIT})</b>: codifico la imagen con el encoder del VAE (z₀), elijo strength s ∈ [0, 1], salto a t ≈ s·T con la forma cerrada (\(z_t = \sqrt{\bar\alpha_t}\,z_0 + \sqrt{1-\bar\alpha_t}\,\varepsilon\)) y corro el sampler desde ahí. En diffusers solo corren ⌊s × num_inference_steps⌋ pasos: con 50 pasos y s = 0.6 son 30 (60 NFE con CFG), más una pasada del encoder del VAE (${met('mVe')}). El costo baja proporcional a s. Con s bajo se conserva la composición y cambian texturas y estilo; con s alto es casi texto → imagen (con s = 1 la entrada casi no cuenta). Es un trade-off fidelidad a la entrada vs realismo que SDEdit mide como curva. <b>Inpainting</b>: (a) con el modelo base, en cada paso se reemplaza la zona conocida por la imagen original con el ruido de ese t (blended latent; RePaint, ${REPAINT}, además re-ruida para armonizar). Es barato pero deja costuras, porque el modelo no "ve" la máscara. (b) Con un modelo de inpainting: la U-Net recibe 9 canales (4 del latente ruidoso + 1 de la máscara a 64×64 + 4 del latente de la imagen enmascarada), ajustada aparte (SD 1.5 inpainting: 440K pasos, ver <a href="#stable-diffusion.entrenamiento">entrenamiento</a>). Da mejor coherencia en los bordes. Detalles: la máscara baja ×8, así que bordes de menos de 8 px no existen en el latente; y el decoder del VAE también altera la zona "no tocada": se pega el original fuera de la máscara en píxeles.`,
              say: 'Img2img encodes the image, noises it in closed form to strength times T and runs only the remaining steps, so strength zero point six with fifty steps costs thirty steps. Low strength keeps composition, high strength mostly follows the prompt. Inpainting either blends the known region back in at every step with the base model, which is cheap but leaves seams, or uses a nine-channel inpainting U-Net that sees the mask and the masked image latent.',
              why: 'Se anota t = s·T, que el costo baja con s, el trade-off y las dos formas de inpainting, con los 9 canales.' },
            { q: 'Your fine-tuned model generates nearly identical images for different seeds. What happened and how do you check?',
              junior: 'Las semillas están mal.',
              senior: 'Sobreajuste o colapso por el fine-tuning: con pocas fotos y muchos pasos (o LR alto) el modelo memoriza las imágenes de entrenamiento y el prompt del identificador las reproduce. Lo verifico: (1) distancia (LPIPS o features de DINO/CLIP) entre muestras y contra las imágenes de entrenamiento: casi-copias = memorización; (2) diversidad entre semillas; (3) prompts de la clase sin identificador ("a bottle"): si también salen como mi producto, hubo language drift (faltó la pérdida de preservación de clase). Arreglo: menos pasos o checkpoint anterior, LR más bajo, prior preservation, captions variados, LoRA de rango menor. Si además usé CFG muy alto, baja w: también reduce la diversidad.',
              say: 'It is overfitting from fine-tuning on a handful of images: the model memorizes them. I check distances between samples and to the training images, seed diversity, and whether plain class prompts also produce my product, which signals language drift. I fix it with fewer steps, a lower learning rate, prior preservation, varied captions and a smaller LoRA rank.',
              why: 'Se anota medir memorización y language drift, y los arreglos de la receta.' },
            { q: 'Diffusion vs GANs: why did diffusion win for text-to-image?',
              junior: 'Porque las imágenes de difusión son más lindas.',
              senior: 'Entrenamiento: difusión es una regresión estable con una sola red; una GAN es un juego min-max con dos redes, sensible a hiperparámetros y con <b>colapso de modos</b> (cubre pocos tipos de imagen). Cobertura: la pérdida de difusión obliga a modelar toda la distribución, y eso escala con datos web enormes y condición de texto. Control: CFG da una perilla fidelidad/diversidad, y el mismo modelo hace inpainting e img2img sin reentrenar. El precio es el muestreo: decenas de pasos contra uno de una GAN. Por eso los destilados rápidos (ADD) vuelven a usar una pérdida adversarial: la combinación da 1–4 pasos.',
              say: 'Diffusion trains as a stable regression with one network and covers the whole distribution, while GANs are an unstable min-max game prone to mode collapse. Diffusion also gives a guidance knob and editing for free. The cost is many sampling steps, which is why fast distilled models bring an adversarial loss back.',
              why: 'Se anota estabilidad, cobertura de modos, control y el costo en pasos; bonus por mencionar que ADD vuelve a usar un discriminador.' },
          ] },
          { t: 'callout', kind: 'note', html: R`<p>Fuentes de las métricas: ${FID}; ${CLIPS}; ${CLEANFID}; ${GENEVAL}; DrawBench en ${IMAGEN}; PartiPrompts en ${PARTI}. Modelos de preferencia: HPS v2 (Wu et al., arXiv:2306.09341), ImageReward (Xu et al., NeurIPS 2023, arXiv:2304.05977), PickScore (Kirstain et al., NeurIPS 2023, arXiv:2305.01569).</p>` },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: 'Generas con tu propio bucle y las imágenes salen grises y lavadas, o saturadas y con manchas. Usaste el VAE de diffusers directo.',
              a: R`Revisa el <code>scaling_factor</code>: al codificar se multiplica por ${SCALE} y al decodificar se divide. Sin dividir, el decoder recibe un latente ≈ 5× más chico (imagen gris); si escalas dos veces, uno 5× más grande (saturada). En diffusers: <code>vae.decode(latents / vae.config.scaling_factor)</code>. Y no copies ${SCALE} a otro modelo: SDXL usa 0.13025, y SD3 usa además un shift (z = (ℰ(x) − 0.0609) · 1.5305). Léelo siempre de <code>vae.config</code>.` },
            { q: 'Con DDIMScheduler de 50 pasos tus imágenes salen bien, pero con 1,000 pasos de DDPMScheduler y el mismo modelo salen peor que con 50 de DDIM. ¿Bug?',
              a: 'Probablemente no: revisa que uses la config del modelo (scaled_linear 0.00085 → 0.012, no el linear 10⁻⁴ → 0.02 por defecto de la clase); con el schedule equivocado todo el muestreo está corrido. Si la config es la correcta, DDPM a 1,000 pasos debería verse bien: compara con la misma semilla.' },
            { q: 'Tu servidor de SD 1.5 tira out of memory solo a 1024×1024 con batch 4, y no a 512 con batch 4.',
              a: R`El latente pasa a 128×128 (4 × ${cf('tokens')} posiciones en el nivel 1) y CFG duplica el batch a 8: si la atención materializa la matriz de scores, son 8 (batch) × ${cf('h')} (cabezas) × (4 × ${cf('tokens')})² entradas en fp16 por capa: ${est('≈ 34 GB')} (a 512 y batch 1 son ${met('selfAttnScoreBytes')}; ×8 por el batch, ×16 por la resolución). Activa SDPA/FlashAttention (o xFormers), usa tiled VAE decoding, y recuerda que SD 1.5 a 1024 además se ve mal.` },
            { q: 'Estimación rápida: ¿cuántas imágenes por hora salen de una GPU con SD 1.5 a 512, 50 pasos, CFG?',
              a: R`Mídelo: si una imagen tarda t segundos, salen 3,600 / t por hora y por GPU en serie. El calculador da una cota optimista (roofline, H100, no A100) de ${est('≈ ' + met('msPerImage') + ' ms')} por imagen, ≤ ${met('imagesPerSecUpperBound')} imágenes/s; la real es más lenta (normas, elementwise, activaciones; ${est('varias veces')}, estimación nuestra: mídela). Sea cual sea t, bajar de 50 a 25 pasos con DPM-Solver++ casi duplica el throughput (la U-Net es ${met('denoiserSamplingShare')} del costo), y un destilado a 4 pasos sin CFG hace 25× menos evaluaciones de la U-Net (100 → 4), pero solo ≈ ÷14 en MACs por imagen: el decoder del VAE (${met('mVd')}, que no cambia) pasa a ser ≈ 44 % del costo.` },
            { q: 'Tu prompt de 120 palabras ignora todo lo que escribiste al final. ¿Por qué?',
              a: R`El text encoder de CLIP ve ${cf('T')} tokens (incluidos el de inicio y el EOT) y el tokenizer trunca el resto. Acorta el prompt, pon lo importante al principio, o usa una interfaz que parta el prompt en trozos de 75 y concatene embeddings (fuera de distribución para el modelo).` },
            { q: 'Tu pérdida de difusión dejó de bajar a los 20K pasos de fine-tuning. ¿Dejó de aprender el modelo?',
              a: R`No necesariamente. La MSE promediada sobre t está dominada por un error que no se puede bajar: el óptimo es E[ε | x_t], no ε, y en t alto ese error es grande. Por eso la curva casi no se mueve mientras las muestras siguen mejorando. Mide FID o CLIP score con los pesos <b>EMA</b> (los que se publican: el checkpoint de SD v1-5 trae pesos EMA) sobre un set fijo de prompts y semillas cada N pasos, y mira la pérdida por tramos de t (el error en t bajo sí refleja el detalle fino).` },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las formas; luego los "¿qué pasa si…?" (todas las respuestas las calcula el calculador) y al final los dos ejercicios de código que más se piden en entrevistas de generativos: el paso de entrenamiento de difusión y un sampler DDIM con CFG.` },
          { t: 'h3', text: 'Diagrama en blanco: el pipeline' },
          { t: 'blankdiagram', diagram: 'sd-overview', slots: [
            { node: 'text-encoder', ask: 'label', hint: 'de dónde salen las K y V de la cross-attention' },
            { node: 'scheduler', ask: 'label', hint: 'la fórmula que da el latente del paso siguiente' },
            { node: 'vae-decoder', ask: 'label', hint: 'del latente a píxeles' },
            { node: 'unet', tensor: TN.eps, ask: 'shape' },
            { node: 'text-encoder', tensor: TN.ctx, ask: 'shape' },
          ] },
          { t: 'h3', text: 'Diagrama en blanco: el bloque transformer' },
          { t: 'blankdiagram', diagram: 'sd-transformer-block', slots: [
            { node: 'cross-attn', ask: 'label', hint: 'Q de la imagen, K y V del texto' },
            { node: 'ff-geglu', ask: 'label', hint: 'el MLP con compuerta' },
            { node: 'self-attn', ask: 'label', hint: 'mezcla global entre posiciones del latente' },
          ] },
          { t: 'h3', text: 'Diagrama en blanco: el bloque residual' },
          { t: 'blankdiagram', diagram: 'sd-resblock', slots: [
            { node: 'time-proj', ask: 'label', hint: 'por dónde entra t' },
            { node: 'gn1', ask: 'label', hint: 'la normalización que no depende del batch' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'stable-diffusion', pool: 'all', configs: [C] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: 'Duplicas la resolución de 512 a 1024. ¿Por qué factor cambian los MACs de una evaluación de la U-Net?', change: { res: 1024 }, ask: 'unetMacs',
              explain: 'Más de ×4: las convs y lineales crecen ×4 (4× posiciones), y QKᵀ y A·V de la self-attention ×16. El factor total queda entre 4 y 16, más cerca de 4 a 512 px porque la atención es una parte.' },
            { q: 'Misma duplicación de resolución. ¿Qué parte de los MACs de la U-Net es ahora QKᵀ y A·V?', change: { res: 1024 }, ask: 'selfScoreShareUnet', expect: 'value',
              explain: 'Sube: el término N² crece 16× y el resto 4×. Por eso la atención se vuelve el cuello de botella a alta resolución y SDXL la saca del nivel más grande.' },
            { q: 'Pasas de 50 a 20 pasos. ¿Por qué factor cambian los MACs por imagen?', change: { steps: 20 }, ask: 'samplingMacs',
              explain: '≈ ÷2.5: la U-Net es casi todo y corre una vez por paso (×2 por CFG); el text encoder y el VAE no cambian, así que es un poco menos que ÷2.5 exacto.' },
            { q: 'Apagas la guía (CFG). ¿Qué pasa con los MACs por imagen?', change: { cfg: 0 }, ask: 'samplingMacs',
              explain: '≈ ÷2 (÷1.94 exacto: el text encoder y el VAE no se dividen): una evaluación de la U-Net por paso en vez de dos. Es lo que hacen los destilados sin guía (SDXL-Turbo) o con la guía destilada adentro.' },
            { q: 'Pasas a 1 paso sin CFG (la misma U-Net destilada a un paso, como hace ADD con SDXL-Turbo). ¿Qué parte del costo por imagen es ahora el decoder del VAE?', change: { steps: 1, cfg: 0 }, ask: 'vaeDecoderShare', expect: 'value',
              explain: R`Pasa de ${met('vaeDecoderShare')} a la mayor parte del costo: el decoder (${met('mVd')}) cuesta ≈ 3 evaluaciones de la U-Net (${met('mU')}), y ahora la U-Net corre una sola vez. Con modelos destilados, optimiza también el VAE (un decoder chico tipo TAESD, o tiling).` },
          ] },

          { t: 'h3', text: 'Escríbelo (1): forward noising y el paso de entrenamiento' },
          { t: 'p', html: R`Sin mirar: (1) el schedule de SD (scaled linear: lineal en \(\sqrt{\beta}\)) y \(\bar\alpha_t\); (2) <code>q_sample(x0, t, eps)</code> con la forma cerrada, con broadcast de un t por ejemplo; (3) <code>train_step</code>: t uniforme, ε ~ N(0, I), x_t, dropout de la condición para CFG, MSE contra ε. Verificado en el venv del Atlas (PyTorch 2.14, diffusers 0.41): \(\bar\alpha_t\) coincide con <code>DDPMScheduler</code> con la config de SD 1.5 (diferencia ≈ 5·10⁻⁷, diffusers guarda float32), <code>q_sample</code> con <code>add_noise</code> (≈ 2·10⁻⁶ en float32) y la pérdida de un toy 2-D condicionado baja de forma sostenida. El paso de entrenamiento también corre con x₀ en un acelerador (probado en MPS: t y el schedule siguen a <code>x0.device</code>).` },
          { t: 'code', title: 'Solución de referencia (PyTorch)', files: [
            { name: 'diffusion_train.py', lang: 'python', code: [
              'import torch',
              'import torch.nn.functional as F',
              '',
              'T = 1000',
              '# Schedule de SD 1.x ("scaled_linear"): lineal en sqrt(beta), de 0.00085 a 0.012',
              'betas = torch.linspace(0.00085 ** 0.5, 0.012 ** 0.5, T, dtype=torch.float64) ** 2',
              'alphas_bar = torch.cumprod(1.0 - betas, dim=0)               # (T,)  abar_t, de ~0.999 a ~0.0047',
              '',
              '',
              'def q_sample(x0, t, eps):',
              '    # x0: (B, ...) dato limpio · t: (B,) enteros en [0, T) · eps: como x0, N(0, I)',
              '    ab = alphas_bar.to(x0.device, x0.dtype)[t].view(-1, *[1] * (x0.dim() - 1))   # (B, 1, ...), en el device de x0',
              '    return ab.sqrt() * x0 + (1 - ab).sqrt() * eps                     # x_t ~ q(x_t | x_0), un solo paso',
              '',
              '',
              'def train_step(model, opt, x0, cond, p_uncond=0.1, null_cond=None):',
              '    # x0: (B, d) latentes limpios · cond: (B, c) condición · model(x_t, t, cond) -> eps_hat (B, d)',
              '    B = x0.shape[0]',
              '    t = torch.randint(0, T, (B,), device=x0.device)           # un t al azar por ejemplo (uniforme)',
              '    eps = torch.randn_like(x0)                                # el objetivo: el ruido que agregamos',
              '    x_t = q_sample(x0, t, eps)                                # (B, d)',
              '    if null_cond is not None:                                 # dropout de la condición para CFG',
              '        drop = torch.rand(B, device=x0.device) < p_uncond     # (B,) ~10 % sin texto',
              '        cond = torch.where(drop[:, None], null_cond.expand_as(cond), cond)',
              '    loss = F.mse_loss(model(x_t, t, cond), eps)               # L_simple: MSE contra el ruido',
              '    opt.zero_grad()',
              '    loss.backward()',
              '    opt.step()',
              '    return loss.item()',
            ] },
            { name: 'check_train.py', lang: 'python', code: [
              'import torch',
              'from diffusers import DDPMScheduler',
              'from diffusion_train import T, alphas_bar, q_sample, train_step',
              '',
              'torch.manual_seed(0)',
              'sched = DDPMScheduler(num_train_timesteps=1000, beta_start=0.00085, beta_end=0.012,',
              '                      beta_schedule="scaled_linear")             # la config de SD 1.5',
              'print((sched.alphas_cumprod.double() - alphas_bar).abs().max().item())   # ~5e-7 (diffusers en float32)',
              '',
              'x0 = torch.randn(8, 4, 64, 64)                                   # un batch de latentes 64x64x4 (C x H x W)',
              'eps = torch.randn_like(x0)',
              't = torch.randint(0, T, (8,))',
              'print((q_sample(x0, t, eps) - sched.add_noise(x0, eps, t)).abs().max().item())   # ~2e-6',
              '',
              '# Toy 2-D condicionado por clase: la pérdida tiene que bajar',
              'class Toy(torch.nn.Module):',
              '    def __init__(s, d=2, c=3, h=128):',
              '        super().__init__()',
              '        s.net = torch.nn.Sequential(torch.nn.Linear(d + c + 1, h), torch.nn.SiLU(),',
              '                                    torch.nn.Linear(h, h), torch.nn.SiLU(), torch.nn.Linear(h, d))',
              '    def forward(s, x, t, c):',
              '        return s.net(torch.cat([x, c, (t.float() / T)[:, None]], 1))',
              '',
              'centers = torch.tensor([[2., 0.], [-1., 1.7], [-1., -1.7]])     # tres clases',
              'model = Toy()',
              'opt = torch.optim.Adam(model.parameters(), 2e-3)',
              'null = torch.zeros(1, 3)                                         # la "condición vacía"',
              'losses = []',
              'for it in range(3000):',
              '    k = torch.randint(0, 3, (256,))',
              '    x0 = centers[k] + 0.1 * torch.randn(256, 2)',
              '    c = torch.nn.functional.one_hot(k, 3).float()',
              '    losses.append(train_step(model, opt, x0, c, null_cond=null))',
              'print(sum(losses[:100]) / 100, sum(losses[-100:]) / 100)        # baja (≈ 0.36 → ≈ 0.05 con esta semilla)',
              'torch.save(model.state_dict(), "toy.pt")',
            ] },
          ] },
          { t: 'callout', kind: 'trap', title: 'Los bugs que este ejercicio atrapa', html: R`<p>(1) Usar \(\sqrt{\beta}\) donde va \(\sqrt{\bar\alpha}\) (o \(1-\bar\alpha\) sin raíz): el ruido queda con otra varianza. (2) Un solo t para todo el batch: funciona, pero la pérdida es mucho más ruidosa. (3) Olvidar el broadcast: <code>alphas_bar[t]</code> tiene forma (B,) y hay que llevarlo a (B, 1, 1, 1). (4) t de 1 a 1000 en un lado y de 0 a 999 en el otro: diffusers indexa desde 0. (5) Predecir x₀ y comparar contra ε. (6) Dejar t, el sorteo del dropout o el schedule en la CPU con x₀ en la GPU: <code>ab.sqrt() * x0</code> falla con "Expected all tensors to be on the same device" (por eso el código crea t en <code>x0.device</code> y mueve <code>alphas_bar</code>).</p>` },

          { t: 'h3', text: 'Escríbelo (2): un sampler DDIM con classifier-free guidance' },
          { t: 'p', html: R`Sin mirar: los timesteps "leading" de diffusers con <code>steps_offset = 1</code> (981, 961, …, 1 con 50 pasos), la U-Net con el batch duplicado [∅; condición], la combinación CFG y el paso DDIM con η = 0 (x̂₀ y la dirección hacia x_t). En el último paso, \(\bar\alpha_{t'}\) es el de t = 0 (<code>set_alpha_to_one = False</code>, como en SD). Verificado contra <code>DDIMScheduler.step</code> de diffusers 0.41 con la config de SD 1.5, 50 pasos, w = 3, sobre el toy entrenado: diferencia máxima 0.0 en float64. Prueba w = 0 (las tres clases mezcladas: es el modelo incondicional), w = 1 (la condicional) y w = 15 (las muestras se salen del modo de su clase).` },
          { t: 'code', title: 'Solución de referencia (PyTorch)', files: [
            { name: 'ddim_cfg.py', lang: 'python', code: [
              'import torch',
              'from diffusion_train import T, alphas_bar',
              '',
              '',
              'def ddim_timesteps(steps, T=T, offset=1):',
              '    # "leading" de diffusers con steps_offset=1 (config de SD): 981, 961, ..., 1 con 50 pasos',
              '    ratio = T // steps',
              '    return [i * ratio + offset for i in reversed(range(steps))]',
              '',
              '',
              '@torch.no_grad()',
              'def sample_ddim_cfg(model, cond, null_cond, shape, steps=50, w=7.5, generator=None):',
              '    # cond, null_cond: (B, c) · shape: (B, d) · model(x, t, c) -> eps_hat',
              '    x = torch.randn(shape, generator=generator, dtype=torch.float64)   # x_T ~ N(0, I)',
              '    ratio = T // steps',
              '    for t in ddim_timesteps(steps):',
              '        # CFG: un solo forward con el batch duplicado [incondicional; condicional] -> 2B evaluaciones',
              '        x_in = torch.cat([x, x])                                         # (2B, d)',
              '        c_in = torch.cat([null_cond.expand_as(cond), cond])              # (2B, c)',
              '        t_in = torch.full((x_in.shape[0],), t)',
              '        eps_u, eps_c = model(x_in, t_in, c_in).chunk(2)                  # (B, d) cada uno',
              '        eps = eps_u + w * (eps_c - eps_u)                                # extrapola desde el incondicional',
              '        ab_t = alphas_bar[t]',
              '        t_prev = t - ratio',
              '        ab_prev = alphas_bar[t_prev] if t_prev >= 0 else alphas_bar[0]   # set_alpha_to_one=False (SD)',
              '        x0_hat = (x - (1 - ab_t).sqrt() * eps) / ab_t.sqrt()             # "predicted x0"',
              '        x = ab_prev.sqrt() * x0_hat + (1 - ab_prev).sqrt() * eps         # DDIM con eta = 0: determinista',
              '    return x',
            ] },
            { name: 'check_ddim.py', lang: 'python', code: [
              'import torch',
              'from diffusers import DDIMScheduler',
              'from check_train import Toy                       # (re)entrena el toy y guarda toy.pt',
              'from ddim_cfg import sample_ddim_cfg',
              '',
              'model = Toy().double()',
              'model.load_state_dict({k: v.double() for k, v in torch.load("toy.pt").items()})',
              'null = torch.zeros(1, 3, dtype=torch.float64)',
              'cond = torch.nn.functional.one_hot(torch.tensor([0, 1, 2] * 100), 3).double()',
              '',
              'g = torch.Generator().manual_seed(1)',
              'mine = sample_ddim_cfg(model, cond, null, (300, 2), steps=50, w=3.0, generator=g)',
              '',
              '# Referencia: DDIMScheduler con la config de SD 1.5 (alphas_cumprod en float64 para comparar exacto)',
              's = DDIMScheduler(num_train_timesteps=1000, beta_start=0.00085, beta_end=0.012, beta_schedule="scaled_linear",',
              '                  clip_sample=False, set_alpha_to_one=False, steps_offset=1)',
              's.set_timesteps(50)                                  # 981, 961, ..., 1',
              'b = torch.linspace(0.00085 ** 0.5, 0.012 ** 0.5, 1000, dtype=torch.float64) ** 2',
              's.alphas_cumprod = torch.cumprod(1 - b, 0)',
              's.final_alpha_cumprod = s.alphas_cumprod[0]',
              'g = torch.Generator().manual_seed(1)',
              'x = torch.randn((300, 2), generator=g, dtype=torch.float64)',
              'with torch.no_grad():',
              '    for t in s.timesteps:',
              '        tt = torch.full((600,), int(t))',
              '        eu, ec = model(torch.cat([x, x]), tt, torch.cat([null.expand_as(cond), cond])).chunk(2)',
              '        x = s.step(eu + 3.0 * (ec - eu), t, x, eta=0.0).prev_sample',
              'print((mine - x).abs().max().item())               # 0.0',
            ] },
          ] },
          { t: 'callout', kind: 'trap', title: 'Los bugs que este ejercicio atrapa', html: R`<p>(1) Llamar a la U-Net dos veces por separado en vez de con batch 2 (correcto, pero el doble de overhead). (2) CFG al revés: \(\varepsilon_c + w(\varepsilon_c - \varepsilon_u)\) o con la convención del paper mezclada con el w de diffusers. (3) Recorrer los timesteps de menor a mayor. (4) En el último paso usar \(\bar\alpha = 1\) cuando el modelo se entrenó con <code>set_alpha_to_one = False</code>: es una diferencia chica, pero ya no coincide con la referencia. (5) Agregar ruido en cada paso (eso es DDPM o η &gt; 0, no DDIM determinista).</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. Sigue con <a href="#dit">DiT + flow matching</a>: la misma pérdida con un transformer, y el camino recto que usa π0 para acciones.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'stable-diffusion-01', kind: 'forma', q: 'SD 1.5 a 512×512: forma del latente.', a: R`${sh('lat')} (f = 8 por lado, 4 canales).` },
      { id: 'stable-diffusion-02', kind: 'forma', q: 'SD 1.5: forma de la salida de la U-Net.', a: R`${sh('eps')}: el ruido estimado, misma forma que el latente de entrada.` },
      { id: 'stable-diffusion-03', kind: 'forma', q: 'SD 1.5: forma de los embeddings de texto que leen las cross-attention.', a: R`${sh('ctx')}: la secuencia de la última capa del text encoder de CLIP ViT-L/14.` },
      { id: 'stable-diffusion-04', kind: 'forma', q: 'SD 1.5 a 512: tokens del latente en el nivel 1 de la U-Net (donde está la atención más cara).', a: R`${cf('tokens')} (64 × 64).` },
      { id: 'stable-diffusion-05', kind: 'formula', q: 'Forma cerrada del forward: q(x_t | x_0).', a: R`\(q(x_t\mid x_0)=\mathcal{N}(\sqrt{\bar\alpha_t}\,x_0,\ (1-\bar\alpha_t)I)\), con \(\bar\alpha_t=\prod_{s\le t}(1-\beta_s)\).` },
      { id: 'stable-diffusion-06', kind: 'formula', q: 'La pérdida de entrenamiento de SD (L_simple).', a: R`\(\mathbb{E}\,\lVert\varepsilon-\varepsilon_\theta(\sqrt{\bar\alpha_t}x_0+\sqrt{1-\bar\alpha_t}\varepsilon,\ t,\ \tau(y))\rVert^2\), con t uniforme.` },
      { id: 'stable-diffusion-07', kind: 'formula', q: 'Predicción de x₀ a partir de ε̂.', a: R`\(\hat x_0 = (x_t-\sqrt{1-\bar\alpha_t}\,\hat\varepsilon)/\sqrt{\bar\alpha_t}\).` },
      { id: 'stable-diffusion-08', kind: 'formula', q: 'Paso DDIM determinista (η = 0) de t a t′.', a: R`\(x_{t'}=\sqrt{\bar\alpha_{t'}}\,\hat x_0+\sqrt{1-\bar\alpha_{t'}}\,\hat\varepsilon\).` },
      { id: 'stable-diffusion-09', kind: 'formula', q: 'Classifier-free guidance (convención de diffusers).', a: R`\(\hat\varepsilon=\hat\varepsilon_u+w(\hat\varepsilon_c-\hat\varepsilon_u)\); w = 1 es sin guía.` },
      { id: 'stable-diffusion-10', kind: 'formula', q: 'Cross-attention de SD: de dónde salen Q, K y V.', a: R`\(Q=W_Q\varphi(z_t)\) (posiciones del latente); \(K=W_K\tau(y)\), \(V=W_V\tau(y)\) (tokens de texto).` },
      { id: 'stable-diffusion-11', kind: 'formula', q: 'MACs para generar una imagen con S pasos y CFG.', a: R`S × 2 × MACs<sub>U-Net</sub> + 2 × MACs<sub>text</sub> + MACs<sub>VAE dec</sub> (el 2 es CFG: prompt y vacío).` },
      { id: 'stable-diffusion-12', kind: 'conteo', q: 'Parámetros de la U-Net de SD 1.5.', a: met('pU') },
      { id: 'stable-diffusion-13', kind: 'conteo', q: 'Parámetros del VAE de SD 1.5 (encoder + decoder).', a: met('pV') },
      { id: 'stable-diffusion-14', kind: 'conteo', q: 'Parámetros del text encoder de SD 1.5 (CLIP ViT-L/14, texto).', a: met('pT') },
      { id: 'stable-diffusion-15', kind: 'conteo', q: 'Factor de compresión del VAE de SD (valores de la imagen / valores del latente).', a: R`${met('comp')}× = (8·8·3)/4.` },
      { id: 'stable-diffusion-16', kind: 'conteo', q: 'MACs de una evaluación de la U-Net de SD 1.5 a 512.', a: met('mU') },
      { id: 'stable-diffusion-17', kind: 'conteo', q: 'Evaluaciones de la U-Net para una imagen con 50 pasos y CFG.', a: R`${cf('nfe')} (50 × 2).` },
      { id: 'stable-diffusion-19', kind: 'conteo', q: 'Escala de guía por defecto en las pipelines de SD de diffusers.', a: '7.5.' },
      { id: 'stable-diffusion-20', kind: 'conteo', q: 'Schedule de ruido de entrenamiento de SD 1.x.', a: '1,000 pasos, β "scaled linear" (lineal en √β) de 0.00085 a 0.012.' },
      { id: 'stable-diffusion-21', kind: 'conteo', q: '√ᾱ_T del schedule de SD en t = T (Lin et al.).', a: '≈ 0.068: en el último paso todavía queda señal (SNR ≈ 0.0047).' },
      { id: 'stable-diffusion-22', kind: 'concepto', q: '¿Qué distingue el entrenamiento de SD v1.5 del de v1.4?', a: 'Solo la cantidad de pasos: los dos siguen desde v1-2 con los mismos datos; v1.5 entrena 595K pasos y v1.4 225K.' },
      { id: 'stable-diffusion-23', kind: 'conteo', q: 'Factor por el que se escala el latente del VAE de SD 1.x.', a: R`${SCALE} (para desviación ≈ 1; se divide antes de decodificar).` },
      { id: 'stable-diffusion-24', kind: 'concepto', q: '¿Por qué predecir ε y no x₀? (una razón)', a: 'Porque ε tiene la misma escala (N(0, I)) en todos los t: el objetivo de la regresión está igual de bien condicionado en todo el rango de ruido.' },
      { id: 'stable-diffusion-25', kind: 'concepto', q: '¿Qué pérdidas entrenan el VAE de SD?', a: 'Reconstrucción + perceptual (LPIPS) + adversarial de parches + un KL con peso ≈ 10⁻⁶.' },
      { id: 'stable-diffusion-26', kind: 'concepto', q: '¿Por qué DDIM puede saltar pasos con un modelo entrenado como DDPM?', a: 'Porque la pérdida solo depende de las marginales q(x_t | x₀); DDIM define un proceso con las mismas marginales que es determinista y admite subsecuencias de t.' },
      { id: 'stable-diffusion-27', kind: 'concepto', q: '¿Cómo entra el paso t en la U-Net de SD?', a: 'Embedding sinusoidal → MLP → una lineal por bloque residual que se suma (un bias por canal) entre sus dos convs.' },
      { id: 'stable-diffusion-28', kind: 'concepto', q: '¿Qué es un negative prompt, mecánicamente?', a: 'El texto que reemplaza al prompt vacío en la rama incondicional de CFG: la guía extrapola alejándose de él.' },
      { id: 'stable-diffusion-29', kind: 'concepto', q: 'ControlNet en una línea.', a: 'Copia entrenable del encoder de la U-Net congelada que lee un mapa de control y suma a los skips y al bloque medio por convs 1×1 inicializadas en cero.' },
      { id: 'stable-diffusion-30', kind: 'concepto', q: '¿Qué es la pérdida de preservación de clase de DreamBooth?', a: 'Entrenar también con imágenes de "a [clase]" generadas por el modelo original, para que no olvide la clase (language drift) ni pierda diversidad.' },
      { id: 'stable-diffusion-31', kind: 'concepto', q: 'Textual inversion: ¿qué se entrena?', a: 'Solo el embedding de un token nuevo; el text encoder y la U-Net quedan congelados.' },
      { id: 'stable-diffusion-32', kind: 'concepto', q: 'v-prediction: ¿qué predice la red?', a: R`\(v=\sqrt{\bar\alpha_t}\,\varepsilon-\sqrt{1-\bar\alpha_t}\,x_0\) (Salimans y Ho); SD 2.x 768-v la usa.` },
      { id: 'stable-diffusion-33', kind: 'tradeoff', q: 'Más escala de guía w: ¿qué ganas y qué pierdes?', a: 'Ganas fidelidad al prompt; pierdes diversidad y, con w alto, aparecen sobresaturación y artefactos.' },
      { id: 'stable-diffusion-34', kind: 'tradeoff', q: 'Mejor solver vs destilación para bajar pasos.', a: 'Un solver (DPM-Solver++, Euler) llega a ≈ 20 pasos con el mismo modelo; para 1–4 pasos hace falta destilar (LCM, ADD), que cambia el modelo y cuesta diversidad.' },
      { id: 'stable-diffusion-35', kind: 'tradeoff', q: 'LoRA vs DreamBooth completo para un sujeto.', a: 'DreamBooth completo: máxima fidelidad, un checkpoint entero, más sobreajuste. LoRA: fidelidad cercana en MBs, combinable y apagable.' },
      { id: 'stable-diffusion-36', kind: 'trampa', q: '"La guía (CFG) es gratis: solo es un número."', a: 'Dobla el costo: dos evaluaciones de la U-Net por paso (una condicional y una incondicional, en un batch de 2).' },
      { id: 'stable-diffusion-37', kind: 'trampa', q: '"El dropout del 10 % del texto es regularización."', a: 'Es lo que entrena la rama incondicional ε(x_t, ∅) que CFG necesita: en SD 1.5 se borra el texto en el 10 % de los ejemplos (desde v1-3; model card).' },
      { id: 'stable-diffusion-38', kind: 'trampa', q: '"SD 1.5 genera mejor a 1024 porque hay más píxeles."', a: 'Entrenó a 512: a 1024 duplica sujetos, y la atención del nivel 1 cuesta 16× más.' },
      { id: 'stable-diffusion-39', kind: 'trampa', q: '"FID más bajo = el modelo sigue mejor el prompt."', a: 'FID mide realismo/distribución con features de Inception; no mira el texto. La alineación se mide aparte (CLIP score, GenEval, humanos).' },
      { id: 'stable-diffusion-40', kind: 'trampa', q: '"El text encoder de SD entiende la negación: \'sin bigote\' quita el bigote."', a: 'No: CLIP entiende mal la negación y suele agregar lo negado.' },
      { id: 'stable-diffusion-41', kind: 'concepto', q: '¿Qué peso implícito pone la pérdida sobre ε al error en x₀?', a: 'SNR(t) = ᾱ_t/(1 − ᾱ_t): ‖ε − ε̂‖² = SNR(t)·‖x₀ − x̂₀‖². Sobrepondera los t poco ruidosos.' },
      { id: 'stable-diffusion-42', kind: 'formula', q: 'Relación entre el ε óptimo y el score (Tweedie).', a: R`\(\varepsilon^*(x_t) = -\sqrt{1-\bar\alpha_t}\,\nabla_{x_t}\log p_t(x_t)\); equivalente: \(\mathbb{E}[x_0\mid x_t] = (x_t + (1-\bar\alpha_t)\nabla\log p_t)/\sqrt{\bar\alpha_t}\).` },
      { id: 'stable-diffusion-43', kind: 'formula', q: 'CFG con escala w (diffusers): ¿de qué distribución sigue el score?', a: R`De \(p(x_t)\,p(c\mid x_t)^{w}\): un clasificador implícito "afilado" (por Bayes, ε̂_c − ε̂_u = −σ_t ∇log p(c | x_t)).` },
      { id: 'stable-diffusion-44', kind: 'trampa', q: '"Para ahorrar, guía solo en los primeros pasos."', a: 'Es el tramo de mucho ruido, donde la guía más daña la diversidad. El resultado del intervalo de guía (Kynkäänniemi et al., 2024) es apagarla al principio y al final y guiar en el medio.' },
      { id: 'stable-diffusion-45', kind: 'concepto', q: 'DDIM y DPM-Solver: ¿qué relación tienen?', a: 'DDIM (η = 0) es DPM-Solver de orden 1: un paso de primer orden de la probability-flow ODE. DPM-Solver sube el orden con Taylor en log-SNR.' },
      { id: 'stable-diffusion-46', kind: 'concepto', q: '¿Qué significa "2M" en DPM-Solver++ 2M?', a: 'Multipaso de segundo orden: reusa el ε̂ (o x̂₀) del paso anterior, así que tiene segundo orden con 1 NFE por paso.' },
      { id: 'stable-diffusion-47', kind: 'concepto', q: 'LCM: ¿por qué no necesita CFG en inferencia?', a: 'Se destila con consistencia sobre la ODE ya guiada: la escala w queda dentro del modelo, así que corre una sola evaluación por paso (2–4 pasos).' },
      { id: 'stable-diffusion-48', kind: 'conteo', q: 'img2img con 50 pasos y strength 0.6: ¿cuántos pasos corren?', a: '⌊0.6 × 50⌋ = 30 pasos (60 NFE con CFG), más una pasada del encoder del VAE.' },
      { id: 'stable-diffusion-49', kind: 'conteo', q: 'Canales de entrada de la U-Net de SD 1.5 inpainting.', a: '9 = 4 del latente ruidoso + 1 de la máscara + 4 del latente de la imagen enmascarada.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'latent diffusion model (LDM)', es: 'modelo de difusión latente', def: 'Difusión en el latente comprimido de un autoencoder entrenado aparte, en vez de en píxeles; Stable Diffusion es uno.', say: 'Stable Diffusion is a latent diffusion model: it denoises in the VAE latent, not in pixel space.' },
      { en: 'forward process', es: 'proceso de forward (difusión)', def: 'La cadena fija que agrega ruido gaussiano en T pasos; tiene forma cerrada q(x_t | x₀).', say: 'The forward process has a closed form, so training samples any timestep directly.' },
      { en: 'noise schedule', es: 'schedule de ruido', def: 'Los β_t que fijan cuánto ruido se agrega en cada paso; SD usa scaled linear 0.00085 → 0.012 en 1,000 pasos.', say: 'SD uses a scaled-linear beta schedule with a thousand training steps.' },
      { en: 'epsilon-prediction', es: 'predicción del ruido (ε)', def: 'Parametrización en la que la red estima el ruido agregado; la pérdida es una MSE contra ese ruido.', say: 'The U-Net is trained with epsilon-prediction and a simple MSE loss.' },
      { en: 'v-prediction', es: 'predicción de la velocidad (v)', def: 'La red predice v = √ᾱ·ε − √(1 − ᾱ)·x₀; estable también cerca de ruido puro.', say: 'SD 2 768 uses v-prediction, which stays well-defined at zero SNR.' },
      { en: 'sampler / scheduler', es: 'sampler / scheduler', def: 'La regla que convierte la predicción de la red en el latente del paso siguiente (DDPM, DDIM, DPM-Solver, Euler); no tiene parámetros.', say: 'Switching the scheduler to DPM-Solver lets us use twenty steps instead of fifty.' },
      { en: 'classifier-free guidance (CFG)', es: 'guía sin clasificador', def: 'Extrapolar desde la predicción incondicional hacia la condicional por un factor w; requiere entrenar con la condición borrada a veces y duplica el costo por paso.', say: 'Classifier-free guidance trades diversity for prompt adherence and doubles the cost per step.' },
      { en: 'negative prompt', es: 'prompt negativo', def: 'Texto que reemplaza al vacío en la rama incondicional de CFG para alejar la muestra de él.', say: 'A negative prompt is just the unconditional branch of guidance with some text in it.' },
      { en: 'NFE (number of function evaluations)', es: 'evaluaciones de la red', def: 'Cuántas veces corre la red de denoising para una muestra: pasos × (2 con CFG). Con CFG las dos evaluaciones de un paso suelen ir en una llamada de batch 2.', say: 'Fifty steps with guidance is a hundred NFEs.' },
      { en: 'cross-attention conditioning', es: 'condicionamiento por cross-attention', def: 'Las queries salen del latente y las keys/values de los tokens de texto; así entra el prompt en la U-Net.', say: 'The prompt enters the U-Net through cross-attention to the CLIP token embeddings.' },
      { en: 'distillation (LCM, ADD)', es: 'destilación (LCM, ADD)', def: 'Entrenar un modelo que muestrea en 1–4 pasos imitando al original (consistencia, o adversarial + score distillation).', say: 'We distilled the model with LCM-LoRA to sample in four steps.' },
      { en: 'prior preservation loss', es: 'pérdida de preservación de clase', def: 'En DreamBooth, entrenar también con imágenes de la clase generadas por el modelo original para no olvidarla.', say: 'Prior preservation keeps the model from forgetting what a generic dog looks like.' },
      { en: 'probability-flow ODE', es: 'ODE de flujo de probabilidad', def: 'La ecuación diferencial determinista cuyas trayectorias tienen las mismas marginales que el proceso de difusión; DDIM, DPM-Solver y Euler son integradores de ella.', say: 'Samplers like DDIM and DPM-Solver are just integrators of the probability-flow ODE.' },
      { en: 'img2img strength', es: 'intensidad de img2img', def: 'Fracción s del camino de ruido desde la que arranca el muestreo: se ruida la imagen hasta t ≈ s·T y corren ⌊s × pasos⌋ pasos.', say: 'With strength zero point six and fifty steps, img2img only runs thirty steps.' },
      { en: 'zero terminal SNR', es: 'SNR terminal cero', def: 'Schedule cuyo último paso es ruido puro; el de SD 1.x no lo es, lo que limita el brillo de las imágenes.', say: 'With zero terminal SNR the model can finally generate very dark images.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
