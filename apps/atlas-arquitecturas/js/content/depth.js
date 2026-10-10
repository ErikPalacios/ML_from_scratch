/* =============================================================================
   Atlas de Arquitecturas — js/content/depth.js
   Página de modelo: profundidad monocular — DPT (Ranftl et al., ICCV 2021, arXiv:2103.13413), la pérdida invariante a
   escala y desplazamiento de MiDaS (Ranftl et al., TPAMI 2022, arXiv:1907.01341), Depth Anything (Yang et al., CVPR 2024,
   arXiv:2401.10891) y Depth Anything V2 (Yang et al., NeurIPS 2024, arXiv:2406.09414). Canónica depth-anything-v2-small
   (DINOv2 ViT-S/14 + cabeza DPT, 518×518). Plantilla fija de 11 secciones (SPEC §5.3, §26.2).
   Regla: ningún número de la arquitectura se escribe a mano. Formas, parámetros, MACs y fps ≈ salen del calculador
   (js/arch/perception.js, modelo depth; bloques op/trace/params/flops/scaling/compare y cantidades {{config.ruta}}, SPEC §6.6).
   Configs leídas de HF (transformers 5.19: DepthAnythingForDepthEstimation, DPTForDepthEstimation "Intel/dpt-large") y del
   código oficial (DepthAnything/Depth-Anything-V2, depth_anything_v2/dpt.py y metric_depth/). Los ejercicios a mano y el
   código se verificaron en el venv del Atlas (scratchpad build14/geom: ssi.py, da.py, da_macs.py). Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/perception.js, SPEC §26.2).
  const C = 'depth-anything-v2-small';   // canónica: DINOv2 ViT-S/14 + DPT, 518×518
  const CB = 'depth-anything-v2-base';
  const CL = 'depth-anything-v2-large';
  const DL = 'dpt-large';                // ViT-L/16 a 384 (Intel/dpt-large), readout "project"

  // Tensores: nombre corto de la página → id del calculador (arch-ids.md).
  const TN = {
    img: 'x-img', patches: 'x-patches', tokens: 'x0', enc: 'x-out',
    tap1: 'tap-1', tap2: 'tap-2', tap3: 'tap-3', tap4: 'tap-4',
    re1: 'rs-1', re2: 'rs-2', re3: 'rs-3', re4: 'rs-4', feat1: 'feat-1',
    fu4: 'fused-4', fu3: 'fused-3', fu2: 'fused-2', fu1: 'fused-1',
    head: 'head-up', depth: 'depth',
  };
  // Nodos del diagrama (js/content/diagrams/depth.js).
  const ND = { embed: 'patch-embed', enc: 'encoder', reasm: 'reassemble', fusion: 'fusion', head: 'head' };
  // Claves de metrics() del calculador. Un solo lugar para adaptarlas.
  const MK = {
    encMacs: 'encoderMacs', headMacs: 'decoderMacs', headShare: 'decoderMacsShare',
    encParams: 'encoderParams', headParams: 'decoderParams', headParamsShare: 'decoderParamsShare', encShare: 'encoderMacsShare',
    fpsOrin: 'fpsOrin', fpsH100: 'fpsH100', msOrin: 'msOrin', msH100: 'msH100', actMem: 'actMem',
  };
  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const sh = (id, cfg) => qn('tensor.' + (TN[id] || id) + '.shape', cfg);
  const sy = (id, cfg) => qn('tensor.' + (TN[id] || id) + '.sym', cfg);
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const np = (id, cfg) => qn('node.' + (ND[id] || id) + '.params', cfg);
  const nm = (id, cfg) => qn('node.' + (ND[id] || id) + '.macsG', cfg);
  const npc = (id, cfg) => qn('node.' + (ND[id] || id) + '.macsPct', cfg);
  const npp = (id, cfg) => qn('node.' + (ND[id] || id) + '.paramsPct', cfg);

  const DPT = 'Ranftl, Bochkovskiy y Koltun, <i>Vision Transformers for Dense Prediction</i> (DPT), ICCV 2021, arXiv:2103.13413';
  const MIDAS = 'Ranftl, Lasinger, Hafner, Schindler y Koltun, <i>Towards Robust Monocular Depth Estimation: Mixing Datasets for Zero-shot Cross-dataset Transfer</i> (MiDaS), TPAMI 2022, arXiv:1907.01341';
  const DA1 = 'Yang et al., <i>Depth Anything: Unleashing the Power of Large-Scale Unlabeled Data</i>, CVPR 2024, arXiv:2401.10891';
  const DA2 = 'Yang et al., <i>Depth Anything V2</i>, NeurIPS 2024, arXiv:2406.09414';
  const ZOE = 'Bhat et al., <i>ZoeDepth: Zero-shot Transfer by Combining Relative and Metric Depth</i>, arXiv:2302.12288 (2023)';
  const DPRO = 'Bochkovskii et al., <i>Depth Pro: Sharp Monocular Metric Depth in Less Than a Second</i>, ICLR 2025, arXiv:2410.02073';
  const M3D = 'Yin et al., <i>Metric3D: Towards Zero-shot Metric 3D Prediction from A Single Image</i>, ICCV 2023, arXiv:2307.10984; Hu et al., <i>Metric3D v2</i>, TPAMI 2024, arXiv:2404.15506';
  const DINO2 = 'Oquab et al., <i>DINOv2: Learning Robust Visual Features without Supervision</i>, TMLR 2024, arXiv:2304.07193';
  const EIGEN = 'Eigen, Puhrsch y Fergus, <i>Depth Map Prediction from a Single Image using a Multi-Scale Deep Network</i>, NIPS 2014, arXiv:1406.2283';
  const MARIGOLD = 'Ke et al., <i>Repurposing Diffusion-Based Image Generators for Monocular Depth Estimation</i> (Marigold), CVPR 2024, arXiv:2312.02145';
  const VDA = 'Chen et al., <i>Video Depth Anything: Consistent Depth Estimation for Super-Long Videos</i>, arXiv:2501.12375 (2025)';
  const REFINE = 'Lin et al., <i>RefineNet: Multi-Path Refinement Networks for High-Resolution Semantic Segmentation</i>, CVPR 2017, arXiv:1611.06612';

  ATLAS.register({
    id: 'depth',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> dada <b>una sola imagen RGB</b> (${sh('img')} en la canónica), devolver un mapa denso de ${sh('depth')}: un número por píxel que dice qué tan lejos está esa parte de la escena. En Depth Anything V2 ese número es una <b>disparidad relativa</b> (inversa de la profundidad, conocida salvo una escala y un desplazamiento por imagen), no metros. La arquitectura es un ViT (DINOv2 ViT-S/14, ${qn('params.totalM')} parámetros en total) que produce tokens y una cabeza <b>DPT</b> que los vuelve a armar como imágenes a cuatro escalas y las funde hasta la resolución de entrada (${DA2}).` },
          { t: 'p', html: R`Por qué está en un atlas de entrevistas de robótica: una cámara cuesta poco, pesa nada y ya está en el robot. Si una red te da profundidad densa desde esa cámara, tienes un "sensor" 3-D gratis para evitar obstáculos, estimar el piso, recortar objetos para agarrarlos o completar un LiDAR ralo. El precio: la profundidad monocular es un problema <b>mal planteado</b> y la red rellena con lo que aprendió. Saber <i>cuándo</i> te alcanza es la pregunta senior.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿Monocular?', 'Por qué'], rows: [
            ['Orden relativo: qué está delante de qué, bordes de profundidad, segmentar el primer plano', '<b>Sí</b>', 'Es exactamente lo que aprende una red relativa; no necesitas metros.'],
            ['Densificar un sensor ralo (LiDAR de pocas líneas, ToF de baja resolución, puntos de un SLAM)', 'Sí, combinado', 'Ajustas escala y desplazamiento por frame con los puntos medidos y la red pone la forma entre ellos (sección <a href="#depth.inferencia">inferencia</a>).'],
            ['Navegación en interiores a baja velocidad, con un modelo métrico afinado en tu dominio', 'Con cuidado', 'Útil para mapas de costo gruesos; valida el error absoluto a las distancias que te importan y ten un sensor de seguridad (bumper, ToF corto).'],
            ['Agarrar un objeto con precisión de milímetros', 'No sola', 'El error típico de un modelo métrico es de varios % de la distancia; para agarrar usa estéreo activo o una cámara RGB-D, y la monocular como respaldo para vidrio y bordes finos.'],
            ['Seguridad: frenar ante un peatón a 20 m en un vehículo', 'No', 'No hay garantía física: una foto de una pared o un dominio raro producen profundidad convincente y falsa. LiDAR o radar más estéreo.'],
            ['Video consistente en el tiempo (reconstrucción, AR)', 'No frame a frame', 'Cada frame tiene su propia escala y desplazamiento: parpadea. Usa un modelo de video o fusión temporal (sección <a href="#depth.variantes">variantes</a>).'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Monocular depth is ill-posed: a single image is consistent with infinitely many scenes, so the network learns priors such as object sizes, perspective and occlusion. Modern models like Depth Anything V2 are a DINOv2 ViT encoder with a DPT decoder that reassembles tokens from four layers into a multi-scale feature pyramid and fuses it to full resolution. They predict relative inverse depth, trained with a scale-and-shift-invariant loss so that many datasets with incompatible depth units can be mixed. For metric depth you either fine-tune a metric head on one domain, condition on the camera intrinsics, or align the relative prediction to a few sparse measurements."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como la segmentación semántica sobre un backbone, pero la salida es un número continuo por píxel y el "backbone" es un <a href="#vit">ViT</a>.</b> Ya conoces el patrón encoder–decoder de las redes densas: un backbone baja la resolución (strides 4, 8, 16, 32 en ResNet), un decoder tipo FPN o U-Net sube y mezcla escalas, una cabeza predice por píxel. DPT es eso con una diferencia: un ViT <b>no tiene pirámide</b>. Todas sus capas viven a la misma resolución (stride 14 en DINOv2, 16 en ViT-L/16). DPT fabrica la pirámide: toma los tokens de cuatro capas distintas, los vuelve a poner en su rejilla 2-D y los re-muestrea a cuatro escalas.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de DPT', head: ['Concepto', 'En ResNet / YOLO / el Atlas', 'En DPT / Depth Anything', '¿Nuevo?'], rows: [
            ['Pirámide de features', 'C2–C5 a strides 4–32 (FPN de YOLO / RetinaNet)', R`Cuatro "taps" de capas del ViT (3, 6, 9, 12 en ViT-S/B) re-muestreados a ×4, ×2, ×1 y ×½ de la rejilla de tokens`, 'Equivale'],
            ['Decoder que sube de resolución', 'FPN top-down: upsample ×2 + suma lateral', 'Fusión tipo RefineNet: unidades residuales de convs 3×3, suma con la escala siguiente, upsample ×2', 'Equivale'],
            ['Tokens → mapa 2-D', R`El image encoder de <a href="#sam">SAM</a> y el neck: tokens 64×64 → mapa`, R`"Reassemble": descartar (o proyectar) el CLS, reacomodar N tokens en (H/p)×(W/p), conv 1×1 y re-muestreo`, 'Equivale'],
            ['Cabeza densa', 'Conv 1×1 por celda (clases + caja en YOLO)', 'Convs 3×3 + upsample a la entrada + conv 1×1 → 1 canal + ReLU (disparidad ≥ 0)', 'Igual'],
            ['La etiqueta', 'Clase o caja con unidades fijas', R`Profundidad <b>con escala y desplazamiento desconocidos</b> por imagen: la pérdida alinea antes de comparar`, '<b>Nuevo</b>'],
            ['Los datos', 'Etiquetas humanas', 'Etiquetas de sensores, estéreo, SfM, sintéticas y, sobre todo, <b>pseudo-etiquetas</b> de un modelo maestro en 62M imágenes', '<b>Nuevo</b>'],
          ] },
          { t: 'h3', text: 'Por qué una sola imagen no alcanza (y aun así funciona)' },
          { t: 'p', html: R`Primero un ejemplo. Una cámara con distancia focal f = 500 px ve un auto de 4 m de largo que ocupa 200 px en la imagen. Con el modelo pinhole, tamaño en píxeles = f·L/z, así que z = 500 × 4 / 200 = 10 m. Pero un auto de juguete de 0.4 m a 1 m ocupa <b>exactamente</b> los mismos 200 px: 500 × 0.4 / 1 = 200. La imagen no distingue las dos escenas. Toda la escena multiplicada por un factor k (tamaños y distancias) da la misma foto: la <b>ambigüedad de escala</b> es geométrica, no un defecto de la red.` },
          { t: 'math', display: true, tex: R`u = f_x\frac{X}{Z} + c_x,\qquad v = f_y\frac{Y}{Z} + c_y\quad\Longrightarrow\quad (kX, kY, kZ)\ \text{proyecta al mismo píxel } (u, v)\ \ \forall k > 0`, caption: 'Proyección pinhole con intrínsecos f_x, f_y, c_x, c_y. Escalar la escena entera no cambia la imagen: la profundidad absoluta no se puede deducir de la geometría de una sola vista.' },
          { t: 'p', html: R`Entonces, ¿de dónde saca la red la profundidad? De <b>regularidades del mundo</b>: tamaños típicos (una puerta mide ≈ 2 m), perspectiva (las líneas paralelas convergen, el piso sube hacia el horizonte), oclusión (lo que tapa está delante), textura que se densifica con la distancia, desenfoque y neblina atmosférica. Son priors aprendidos de los datos: funcionan en escenas parecidas a las de entrenamiento y fallan donde el prior miente (un mural en trompe-l'œil, una maqueta, una vista desde arriba que no vio nunca).` },
          { t: 'callout', kind: 'trap', title: '"La red estima metros porque vio muchas imágenes"', html: R`<p>La escala absoluta depende también de la <b>cámara</b>: la misma escena con un lente de f = 1000 px se ve como si estuviera al doble de cerca que con f = 500 px. Un modelo métrico entrenado con una cámara aprende, implícitamente, esa focal; con otra cámara se equivoca por el cociente de focales. Por eso los modelos métricos "generales" o reciben los intrínsecos, o los estiman (Metric3D normaliza a una cámara canónica; Depth Pro estima la focal), o se afinan en un dominio con una cámara (sección <a href="#depth.entrenamiento">entrenamiento</a>).</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Encoder: el mismo <a href="#vit">ViT</a> que ya conoces, con patches de 14 (DINOv2). Cabeza densa sobre tokens: comparable al neck y al mask decoder de <a href="#sam">SAM</a>. Y la salida, convertida en nube de puntos con los intrínsecos, es la entrada de <a href="#pointnet">PointNet</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`La imagen ${sh('img')} se corta en patches de ${cf('P')}×${cf('P')} (${qn('tokens')} tokens con el CLS) y pasa por los ${cf('L')} bloques del ViT-S. De cuatro bloques se "pinchan" los tokens (los <b>taps</b>); cada tap se re-ensambla como mapa 2-D a una escala distinta (de ${sh('re1')} a ${sh('re4')}); la fusión baja de la escala más gruesa a la más fina sumando y subiendo ×2; la cabeza lleva el resultado a ${sh('depth')}.` },
          { t: 'archdiagram', diagram: 'depth-overview', walk: 'forward', wide: true, caption: R`Depth Anything V2 Small (DINOv2 ViT-S/14 + DPT) a ${cf('H')}×${cf('W')}. Formas, parámetros y MACs del calculador; abre los bloques para ver cada operación.` },
          { t: 'p', html: R`<b>Reassemble, por dentro.</b> Los ${qn('tokens')} tokens de un tap son una secuencia. Para que una conv los entienda: (1) <i>Read</i>, sacar el CLS (Depth Anything lo ignora; DPT-Large lo concatena a cada token y proyecta), (2) <i>Concatenate</i>, poner cada token en su lugar de la rejilla ${met('grid')}×${met('grid')}, (3) <i>Resample</i>, conv 1×1 a los canales de esa escala y un re-muestreo: conv transpuesta ×4 o ×2, identidad, o conv 3×3 con stride 2 para ×½.` },
          { t: 'archdiagram', diagram: 'reassemble', caption: 'Las tres etapas de Reassemble (ecuaciones 1–6 de DPT) para un tap; las cuatro escalas solo cambian los canales y el re-muestreo final.' },
          { t: 'p', html: R`<b>La salida es relativa.</b> Mueve la escala y el desplazamiento de la predicción: el MSE crudo contra la verdad explota, pero después de alinear por mínimos cuadrados (una escala s y un desplazamiento t por imagen) queda solo el error de <i>forma</i>. Esa es la pérdida de MiDaS (<a href="#depth.diagrama~scale-shift.ss-align">el paso de alineación</a>) y la razón por la que se pueden mezclar datasets con unidades incompatibles.` },
          { t: 'viz', kind: 'depth-scale', params: { config: C, a: 2.5, b: 0.4, align: 'lsq', glass: false }, caption: 'Una fila sintética de píxeles (rotulada): la verdad en disparidad, una predicción con escala a y desplazamiento b equivocados y la misma predicción alineada por mínimos cuadrados, por mediana y escala, o con recorte del 20 %. Activa el vidrio: esos píxeles son outliers que mueven s y t, y el recorte los saca de la pérdida. Los números son de este juego, no de un benchmark.' },
          { t: 'archdiagram', diagram: 'scale-shift', caption: 'Relativa vs métrica: la red relativa se compara después de alinear s y t por imagen; para metros hace falta una cabeza métrica, los intrínsecos o medidas externas.' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero con números, sin notación. Una foto de 640×480 se redimensiona para que el lado corto mida 518 manteniendo el aspecto y ambos lados sean múltiplos de 14 (lo hacen el <code>image2tensor</code> oficial, que nunca deja un lado por debajo de 518, y el preprocesador de HF con fotos como esta; ojo: HF elige el factor de escala más cercano a 1, así que una imagen chica de 300×400 queda en 392×518, con el lado <i>largo</i> en 518); para entrenar se recorta a 518×518. A 518×518: 518/14 = 37 patches por lado → 37 × 37 = 1,369 tokens + 1 CLS. Cada token es un vector de 384 (ViT-S). Después de 12 bloques de atención salen otros tantos tokens. Reassemble toma los de los bloques 3, 6, 9 y 12 y los convierte en mapas de 148×148, 74×74, 37×37 y 19×19 (×4, ×2, ×1, ×½ de 37). La fusión vuelve a subir: 19 → 37 → 74 → 148 → 296. La cabeza interpola a 518 × 518 y deja un canal: la disparidad.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Canónica'], rows: [
            ['H, W', 'alto y ancho de la entrada (múltiplos de P)', R`${cf('H')}, ${cf('W')}`],
            ['P', 'lado del patch (DINOv2: 14; ViT-L/16 de DPT: 16)', cf('P')],
            ['N', 'tokens de imagen (H/P)·(W/P), más 1 CLS', R`${qn('tokens')} con el CLS`],
            ['D, L', 'ancho y bloques del ViT', R`${cf('D')}, ${cf('L')}`],
            ['l₁…l₄', 'bloques de los que salen los taps', 'ViT-S/B: 3, 6, 9, 12 · ViT-L: 5, 12, 18, 24'],
            ['D̂ₖ', 'canales de cada escala después de la conv 1×1 (neck_hidden_sizes)', 'Small: 48, 96, 192, 384'],
            ['F', 'canales de la fusión (fusion_hidden_size)', 'Small: 64 · Base: 128 · Large: 256'],
            ['d, d*', 'disparidad predicha y verdadera (inversa de la profundidad z)', '—'],
            ['s, t', 'escala y desplazamiento de la alineación por imagen', '—'],
          ] },
          { t: 'callout', kind: 'trap', title: '"Las escalas de DPT son 1/4, 1/8, 1/16 y 1/32"', html: R`<p>Lo son con patches de 16 (DPT-Large a 384: rejilla de 24 → 96, 48, 24, 12). Con DINOv2 el patch es 14: la rejilla de 37 se re-ensambla a 148, 74, 37 y 19, o sea strides de 3.5, 7, 14 y ≈ 27 píxeles (518/19; el nominal sería 2 × 14 = 28). Los factores (×4, ×2, ×1, ×½ de la rejilla) son los mismos; los strides en píxeles no (las cuatro formas, en <a href="#depth.diagrama~reassemble.rs-scales">la vista de reassemble</a>). Y 37 × ½ no es entero: la conv 3×3 con stride 2 y padding 1 da ⌈37/2⌉ = 19, y la fusión re-interpola 19 → 37 en vez de duplicar a 38 (en HF, <code>DepthAnythingFeatureFusionLayer</code> recibe el tamaño destino).</p>` },

          { t: 'h3', text: '1. Patch embedding y encoder (DINOv2)' },
          { t: 'op', block: ND.embed, model: 'depth', title: 'Patchify + CLS + posición',
            tex: R`X_0 = \big[\,x_{\text{cls}};\ \mathrm{Conv}_{P\times P,\ \text{stride } P}(I)\,\big] + E_{\text{pos}} \in \mathbb{R}^{(N+1)\times D}`,
            in: [TN.img], out: [TN.tokens],
            what: R`La conv de P×P con stride P es el patchify del <a href="#vit">ViT</a>: ${sh('img')} → ${sh('tokens')} con el CLS. La tabla de posición de DINOv2 se aprendió para 518 (37×37 + 1 = 1,370 posiciones) y se <b>interpola</b> bicúbicamente si la entrada tiene otra rejilla.`,
            why: R`Usar DINOv2 y no un ViT de ImageNet es la decisión de Depth Anything: sus features auto-supervisadas ya codifican geometría y semántica fina, y en el estudio de V2 solo el encoder DINOv2 más grande transfiere de datos sintéticos a reales sin ayuda (Fig. 5 de ${DA2}).` },
          { t: 'op', block: ND.enc, model: 'depth', title: 'L bloques pre-LN (atención + MLP), con LayerScale',
            tex: R`X_{\ell} = X'_{\ell} + \gamma_2 \odot \mathrm{MLP}(\mathrm{LN}(X'_{\ell})),\qquad X'_{\ell} = X_{\ell-1} + \gamma_1 \odot \mathrm{MHSA}(\mathrm{LN}(X_{\ell-1}))`,
            in: [TN.tokens], out: [TN.enc],
            what: R`El encoder de <a href="#vit">ViT</a> sin cambios, más LayerScale (γ por canal) como en DINOv2. ${cf('L')} bloques de ancho ${cf('D')}, ${cf('h')} cabezas. Es casi todo el modelo: los ${cf('L')} bloques solos tienen ${np('enc')} parámetros (${npp('enc')}) y ${nm('enc')} MACs (${npc('enc')}) a ${cf('H')}×${cf('W')} (sin el patch embedding ni los taps; con ellos, el total del encoder de la sección <a href="#depth.costo">costo</a>).`,
            why: R`La atención global en cada bloque es lo que DPT reclama como ventaja sobre una CNN: desde el primer bloque, cada token ve la escena entera, y la profundidad depende mucho del contexto (dónde está el horizonte, qué tapa a qué). El costo: la matriz de atención crece con N² (sección <a href="#depth.costo">costo</a>).` },

          { t: 'h3', text: '2. Reassemble: de tokens a una pirámide' },
          { t: 'math', display: true, tex: R`\mathrm{Reassemble}^{\hat D}_{s}(t) = \big(\mathrm{Resample}_s \circ \mathrm{Concatenate} \circ \mathrm{Read}\big)(t),\quad \mathbb{R}^{(N_p+1)\times D} \to \mathbb{R}^{N_p\times D} \to \mathbb{R}^{\frac{H}{p}\times\frac{W}{p}\times D} \to \mathbb{R}^{\frac{H}{s}\times\frac{W}{s}\times\hat D}`, caption: 'Ecuaciones 1, 5 y 6 de DPT. Read maneja el token de readout (CLS): ignore (descartarlo), add (sumarlo a cada token) o project (concatenarlo y proyectar con lineal + GELU, el default de DPT). Depth Anything usa ignore (use_clstoken=False en el código oficial).' },
          { t: 'op', block: ND.reasm, model: 'depth', title: 'Reassemble ×4 (cuatro taps, cuatro escalas)',
            tex: R`R_k = \mathrm{Resample}_{s_k}\big(\mathrm{Conv}_{1\times1}^{D\to\hat D_k}(\mathrm{reshape}(T_{\ell_k}[1{:}]))\big),\quad s_k \in \{\times4,\ \times2,\ \times1,\ \times\tfrac12\}`,
            in: [TN.tap1, TN.tap2, TN.tap3, TN.tap4], out: [TN.re1, TN.re2, TN.re3, TN.re4],
            what: R`Para cada tap: tirar el CLS, reacomodar ${met('grid')}×${met('grid')} tokens en una rejilla, conv 1×1 de ${cf('D')} a D̂ₖ canales y re-muestrear: conv transpuesta 4×4 stride 4 (→ ${sh('re1')}), transpuesta 2×2 stride 2 (→ ${sh('re2')}), identidad (→ ${sh('re3')}) y conv 3×3 stride 2 (→ ${sh('re4')}). Después, una conv 3×3 sin bias lleva cada escala a F = ${cf('F')} canales (<a href="#depth.diagrama~reassemble-1">rama 1 en el diagrama</a>).`,
            why: R`Las capas tempranas conservan detalle local y las profundas, contexto global: se re-ensamblan a alta y baja resolución respectivamente, como C2 y C5 de una ResNet. Los canales por escala son menos donde la resolución es alta (48 a 148×148) para que el costo no explote. La conv transpuesta es aprendida: no es un upsample bilineal gratis, y a 148×148 con 48 canales ya cuesta.` },

          { t: 'h3', text: '3. Fusión (RefineNet) y cabeza' },
          { t: 'op', block: ND.fusion, model: 'depth', title: 'Fusión de grueso a fino',
            tex: R`F_4 = \mathrm{Proj}_{1\times1}\big(\mathrm{Up}(\mathrm{RCU}_2(R'_4))\big),\qquad F_k = \mathrm{Proj}_{1\times1}\Big(\mathrm{Up}_{\times 2}\big(\mathrm{RCU}_2\big(F_{k+1} + \mathrm{RCU}_1(R'_k)\big)\big)\Big),\quad \mathrm{RCU}(x) = x + \mathrm{Conv}_{3\times3}(\mathrm{ReLU}(\mathrm{Conv}_{3\times3}(\mathrm{ReLU}(x))))`,
            in: [TN.re1, TN.re2, TN.re3, TN.re4], out: [TN.fu1],
            what: R`Cuatro bloques de fusión, uno por escala, del más grueso al más fino. Cada uno suma la salida del anterior con su escala (pasada por una unidad residual de dos convs 3×3, RCU), aplica otra RCU, sube con interpolación bilineal y proyecta con una conv 1×1. En DPT cada subida es ×2; en Depth Anything las tres primeras van al tamaño exacto de la escala siguiente (19 → 37, 37 → 74, 74 → 148) y solo la última es ×2 (148 → 296). Termina en ${sh('fu1')}: 296 = 8·(H/P) ≈ 0.57·H en Depth Anything (patch 14), y H/2 en DPT (patch 16).`,
            why: R`Es el top-down de una FPN con convs residuales en vez de sumas desnudas (${REFINE}). DPT desactiva BatchNorm en el decoder porque perjudicaba la regresión (§4 de ${DPT}). Ojo con el costo: la última fusión (<a href="#depth.diagrama~fusion-1">fusión 1</a>) corre sus dos RCU a 148×148 con F canales y convs 3×3 y sube a 296: es la fusión más cara, y junto con la cabeza final (convs a 296 y a 518) se lleva la mayor parte de los MACs de la parte DPT.` },
          { t: 'op', block: ND.head, model: 'depth', title: 'Cabeza de profundidad',
            tex: R`\hat d = \mathrm{ReLU}\Big(\mathrm{Conv}_{1\times1}^{32\to1}\big(\mathrm{ReLU}(\mathrm{Conv}_{3\times3}^{32\to32}(\mathrm{Interp}_{H\times W}(\mathrm{Conv}_{3\times3}^{F\to F/2}(F_1))))\big)\Big)`,
            in: [TN.fu1], out: [TN.depth],
            what: R`Conv 3×3 que baja a F/2 canales, interpolación bilineal a la rejilla × 14 (${cf('H')}×${cf('W')}), conv 3×3 a 32 canales, ReLU, conv 1×1 a un canal y ReLU final: la disparidad relativa no puede ser negativa. En el modelo <b>métrico</b> oficial (metric_depth/), la última activación es una sigmoide multiplicada por <code>max_depth</code> (20 m interiores, 80 m exteriores): metros acotados, no disparidad.`,
            why: R`Las dos convs de la cabeza corren a resolución completa: por eso la cabeza, con muy pocos parámetros, se lleva una fracción visible de los MACs. Y la ReLU final es una pista de entrevista: la salida es disparidad (cerca = grande, cielo = 0), no profundidad.` },

          { t: 'h3', text: '4. La pérdida invariante a escala y desplazamiento (derivada)' },
          { t: 'p', html: R`Primero el ejemplo. Cuatro píxeles con disparidad predicha d = (1, 2, 3, 4) y verdadera d* = (2.9, 5.2, 6.8, 9.1). Comparadas en crudo, el error cuadrático medio es enorme (½·Σ(d − d*)²/M = 6.79), pero la predicción tiene la <b>forma</b> correcta: es casi una recta de la verdad. Si elegimos s y t que minimicen Σ(s·d + t − d*)², sale s = 2.02, t = 0.95; la predicción alineada es (2.97, 4.99, 7.01, 9.03), los residuos (0.07, −0.21, 0.21, −0.07) y la pérdida ½·Σr²/M = 0.012. La red no se penaliza por la escala, solo por la forma.` },
          { t: 'math', display: true, tex: R`(s,t) = \arg\min_{s,t}\sum_{i=1}^{M}\big(s\,d_i + t - d^*_i\big)^2,\qquad \mathcal{L}_{\text{ssi}} = \frac{1}{2M}\sum_{i=1}^{M}\rho\big(s\,d_i + t - d^*_i\big)`, caption: 'Ecuaciones 1 y 2 de MiDaS: M píxeles válidos de UNA imagen; la alineación es por imagen (cada imagen tiene su propia escala y desplazamiento desconocidos). Con ρ(x) = x² es L_ssimse.' },
          { t: 'p', html: R`<b>Deriva tú.</b> E(s, t) = Σ(s·dᵢ + t − d*ᵢ)² es una parábola en (s, t). Primero la derivada en t, que da t en función de s:` },
          { t: 'math', display: true, tex: R`\frac{\partial E}{\partial t} = 2\sum_i \big(s\,d_i + t - d^*_i\big) = 0 \;\Rightarrow\; t = \bar{d^*} - s\,\bar d`, caption: 'd̄ y d̄* son los promedios de la predicción y de la verdad sobre los M píxeles válidos.' },
          { t: 'p', html: R`Sustituyendo t y derivando en s sale la pendiente de una regresión lineal de d* sobre d:` },
          { t: 'math', display: true, tex: R`\sum_i (d_i - \bar d)\big(s\,(d_i - \bar d) - (d^*_i - \bar{d^*})\big) = 0 \;\Rightarrow\; s = \frac{\sum_i (d_i-\bar d)(d^*_i - \bar{d^*})}{\sum_i (d_i - \bar d)^2}` },
          { t: 'p', html: R`En forma matricial, con d⃗ᵢ = (dᵢ, 1)ᵀ y h = (s, t)ᵀ, son las ecuaciones normales de un sistema 2×2:` },
          { t: 'math', display: true, tex: R`h_{\text{opt}} = \Big(\sum_{i=1}^{M}\vec d_i\,\vec d_i^{\top}\Big)^{-1}\Big(\sum_{i=1}^{M}\vec d_i\, d^*_i\Big) = \begin{pmatrix}\sum d_i^2 & \sum d_i\\ \sum d_i & M\end{pmatrix}^{-1}\begin{pmatrix}\sum d_i d^*_i\\ \sum d^*_i\end{pmatrix}`, caption: 'Ecuación 4 de MiDaS. Cinco sumas por imagen y una inversa 2×2: la alineación cuesta O(M) y es diferenciable (se implementa con operaciones de tensor en el lote).' },
          { t: 'p', html: R`En el ejemplo: Σd = 10, Σd² = 30, M = 4, Σd·d* = 70.1, Σd* = 24 → det = 30·4 − 10² = 20; s = (4·70.1 − 10·24)/20 = 40.4/20 = 2.02; t = (30·24 − 10·70.1)/20 = 19/20 = 0.95.` },
          { t: 'p', html: R`<b>La versión robusta.</b> Mínimos cuadrados se deja arrastrar por los outliers de la verdad (sensores ruidosos, estéreo que falla en zonas sin textura). MiDaS propone normalizar predicción y verdad por separado con estimadores robustos y comparar con MAE, recortando además el 20 % de residuos más grandes de cada imagen (ecuaciones 5–7): es la que usó en todos sus experimentos, sumada a un término de gradientes multiescala (ec. 11, α = 0.5, K = 4 escalas). Depth Anything V1 usa la versión con mediana y desviación absoluta media y MAE (ecuaciones 1–3 de ${DA1}) e ignora, en cada muestra pseudo-etiquetada, el 10 % de regiones con mayor pérdida (lo cuenta V2 en su §5.2); V2 usa L_ssi + L_gm con pesos 1:2 (§5.2 y §7.1 de ${DA2}).` },
          { t: 'math', display: true, tex: R`t(d) = \mathrm{median}(d),\quad s(d) = \frac{1}{M}\sum_{i=1}^{M}\big|d_i - t(d)\big|,\quad \hat d = \frac{d - t(d)}{s(d)},\ \ \hat d^* = \frac{d^* - t(d^*)}{s(d^*)},\quad \mathcal{L}_{\text{ssitrim}} = \frac{1}{2M}\sum_{j=1}^{0.8M}\big|\hat d_j - \hat d^*_j\big|_{(\uparrow)}`, caption: 'Ecuaciones 5–7 de MiDaS: centrar con la mediana y escalar con la desviación absoluta media; los residuos ordenados de menor a mayor y solo el 80 % más chico entra en la pérdida (el 20 % más grande se ignora "irrespective of their magnitude").' },
          { t: 'callout', kind: 'trap', title: '"Alinear en profundidad o en disparidad da lo mismo"', html: R`<p>No. MiDaS y Depth Anything predicen y alinean en <b>disparidad</b> (inversa de la profundidad). Un ajuste afín en disparidad, d = s·d̂ + t, es en profundidad z = 1/(s·d̂ + t): no es una escala por un factor. En el ejemplo, la profundidad verdadera (1/d*) es 0.345, 0.192, 0.147, 0.110 y la predicha alineada 0.337, 0.200, 0.143, 0.111. Consecuencias: para pasar a metros necesitas estimar <b>dos</b> números (s y t) con al menos dos medidas no colineales, no uno; y el cielo (disparidad 0, z = ∞) solo existe en disparidad. Por eso Depth Anything pone el cielo en 0 al entrenar (§3.1 de ${DA1}).</p>` },
          { t: 'p', html: R`El recorrido completo con los números del calculador:` },
          { t: 'trace', model: 'depth' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Depth Anything V2 Small tiene ${qn('params.total')} parámetros (${qn('params.totalM')}; el paper y el README oficial dicen 24.8M). Casi todos son del encoder: ${met('encParams')} (DINOv2 ViT-S/14). Reassemble, fusión y cabeza suman ${met('headParams')} (${met('headParamsShare')}). En cómputo el reparto es otro: a ${cf('H')}×${cf('W')}, el encoder hace ${met('encMacs')} y la parte DPT ${met('headMacs')}, el ${met('headShare')} de los ${qn('macs.totalG')} MACs. <b>Pocos parámetros, mucho cómputo</b> (las barras de <a href="#depth.diagrama~macs-bars">MACs por bloque</a>): la cabeza trabaja sobre mapas de hasta 296×296 y 518×518, mientras el encoder trabaja sobre 1,370 tokens.` },
          { t: 'params', model: 'depth', group: 'block' },
          { t: 'flops', model: 'depth' },
          { t: 'callout', kind: 'trap', title: '"La cabeza DPT es despreciable"', html: R`<p>En parámetros sí (${met('headParamsShare')}); en MACs no (${met('headShare')}) y en <b>memoria de activaciones</b> menos aún: un solo mapa de 296×296×64 en fp16 son ≈ 11 MB, y la cabeza a 518×518×32 otros ≈ 17 MB, contra 1,370 × 384 × 2 B ≈ 1 MB de un tensor de tokens. En un Jetson, donde el ancho de banda es el cuello, esas convs a alta resolución pesan más de lo que dicen los MACs. Si subes la resolución, la cabeza crece con H·W (lineal en píxeles) y la atención del encoder con N² (cuadrática en tokens).</p>` },
          { t: 'h3', text: 'Resolución: tokens, atención y la cabeza' },
          { t: 'scaling', model: 'depth', knobs: [{ key: 'res', values: [266, 364, 518, 742, 1036] }], show: ['tokens', 'params', 'macs', MK.encMacs, MK.headMacs, MK.headShare, 'attnMem', MK.msOrin] },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 de lado → ×4 tokens. En el encoder, las lineales (QKV, proyección, MLP) crecen ×4 y la matriz de scores ×16; con ViT-S (D = 384) y N ≈ 1,370 la parte N² ya pesa (QKᵀ y A·V son ${qn('metrics.scoreMacsShare')} de los MACs a 518), y a 1036 px (5,476 patches) domina. La cabeza crece ×4 (es lineal en píxeles). Los parámetros no cambian: la tabla de posición se interpola en cada pasada, no se agranda. Y una advertencia del paper V2: el modelo tiene "test-time resolution scaling up", es decir, entrada a 2× o 4× de 518 da mapas más nítidos (§B.8 de ${DA2}); el costo lo ves aquí.` },
          { t: 'h3', text: 'Small, Base, Large y DPT-Large' },
          { t: 'compare', models: [C, CB, CL, DL], rows: ['params', MK.encParams, MK.headParams, 'macs', MK.encMacs, MK.headMacs, MK.headShare, 'tokens', MK.msOrin, MK.msH100], caption: R`Depth Anything V2 Small / Base / Large a 518×518 (DINOv2 ViT-S, B, L con patch 14) y DPT-Large (ViT-L/16) a 384×384. Tiempos: cota roofline ≈ del calculador (sin overheads), no una medida.` },
          { t: 'p', html: R`Lectura: de Small a Large, ${qn('params.totalM')} → ${qn('params.totalM', CL)} parámetros y ${qn('macs.totalG')} → ${qn('macs.totalG', CL)} MACs. DPT-Large a 384 cuesta ${qn('macs.totalG', DL)}: menos que Depth Anything V2 Large a 518, porque 384/16 = 24 → 576 tokens contra 37² = 1,369. El tamaño de patch y la resolución mueven el costo tanto como el modelo. Licencias, que en un robot comercial importan: V2 Small es Apache-2.0; Base, Large y Giant son CC-BY-NC-4.0 (README oficial).` },
          { t: 'h3', text: 'Latencia en el robot (≈)' },
          { t: 'calc', title: R`Una imagen de ${cf('H')}×${cf('W')}, B = 1 (cotas roofline ≈ del calculador; tabla de hardware del Atlas)`, rows: [
            { label: 'MACs por imagen', expr: 'encoder + reassemble + fusión + cabeza', value: qn('macs.totalG') },
            { label: 'Jetson AGX Orin (≈ 42.5 TFLOPS fp16 denso, 204.8 GB/s)', expr: 'máx(FLOPs ÷ pico, bytes ÷ ancho de banda)', value: est(met('msOrin') + ' ms por imagen'), note: R`≈ ${met('fpsOrin')} fps como techo; la cota la pone la ${met('boundOrin')}` },
            { label: 'H100 SXM', expr: 'la misma cota', value: est(met('msH100') + ' ms por imagen'), note: R`≈ ${met('fpsH100')} fps como techo` },
          ], result: R`Es un <b>piso</b>, no una predicción: kernels chicos, el preprocesado (resize con interpolación cúbica, normalización) y la copia de la imagen suman. Para un número real: exporta a TensorRT en fp16 a la resolución fija que vas a usar y mide en el dispositivo con el resto de la pila corriendo. ${est('En la práctica, espera varias veces la cota')} en un Jetson.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota en "can this run on the robot": "Depth Anything V2 Small is about twenty-five million parameters, almost all in the ViT-S encoder, but the DPT decoder is a fifth of the compute at 518 because it runs convolutions at high resolution. I would fix the input size, export to TensorRT in fp16, measure on the Jetson, and if I need more speed lower the resolution first, since tokens scale with the square of the side, before distilling or quantizing to int8 with calibration on my own images."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Tres generaciones, una idea que crece: <b>mezclar datos</b> es lo que generaliza, y para mezclar datos con profundidades incompatibles hace falta una pérdida que no mire la escala. MiDaS la inventó; DPT cambió el encoder por un ViT; Depth Anything escaló los datos con pseudo-etiquetas; V2 cambió las etiquetas reales por sintéticas.` },
          { t: 'h3', text: 'MiDaS y DPT: mezclar datasets' },
          { t: 'p', html: R`Los datasets de profundidad vienen en unidades distintas: metros absolutos (láser, estéreo calibrado), profundidad salvo escala (SfM) o disparidad salvo escala y desplazamiento (estéreo de películas con baseline desconocido; §3 de ${MIDAS}). MiDaS predice en disparidad y usa L_ssitrim + L_reg; entrenó con hasta cinco datasets (incluido 3D Movies, frames de películas estéreo) y evaluó <b>zero-shot</b> en otros seis. DPT mantuvo la receta y la amplió a MIX 6, ≈ 1.4M imágenes; encoder preentrenado en ImageNet con LR 1e−5 y decoder desde cero con 1e−4, Adam, lado largo a 384 y recortes de 384, 60 épocas de 72,000 pasos con batch 16, solo flips horizontales (§4 de ${DPT}).` },
          { t: 'h3', text: 'Depth Anything V1: 62M imágenes sin etiquetar' },
          { t: 'steps', items: [
            { title: 'Maestro con etiquetas', html: R`<p>1.5M imágenes etiquetadas de 6 datasets (BlendedMVS, DIML, HRWSI, IRS, MegaDepth, TartanAir; Tabla 1), encoder inicializado con DINOv2, pérdida afín-invariante (MAE tras normalizar con la mediana y la desviación absoluta media) en disparidad normalizada a 0–1, el cielo forzado a disparidad 0 con un segmentador. Sin NYUv2 ni KITTI, para poder evaluarlos zero-shot.</p>` },
            { title: 'Pseudo-etiquetas', html: R`<p>El mejor maestro (ViT-L) predice la profundidad de 62M imágenes sin etiqueta de 8 datasets públicos (SA-1B, Open Images, BDD100K, ImageNet-21K, LSUN, Places365, Objects365, Google Landmarks). Una pasada hacia adelante por imagen.</p>` },
            { title: 'Estudiante desde cero', html: R`<p>(re-inicializado, no afinado desde el maestro) sobre etiquetadas + pseudo-etiquetadas, 1:2 por batch. El hallazgo: así, sin más, <b>no mejora</b>. Lo que funciona es hacerle la tarea más difícil al estudiante: perturbaciones fuertes en las imágenes sin etiqueta (color jitter, desenfoque gaussiano y CutMix con probabilidad 0.5), mientras el maestro etiquetó la imagen limpia.</p>` },
            { title: 'Alineación de features', html: R`<p>Con un DINOv2 congelado: 1 − cos(f, f′) por píxel, con un margen de tolerancia α = 0.85 (los píxeles que ya se parecen más que α no cuentan), para heredar semántica sin forzar a que partes de un mismo objeto tengan la misma feature. La pérdida total promedia las tres.</p>` },
          ] },
          { t: 'math', display: true, tex: R`\mathcal{L} = \tfrac{1}{3}\big(\mathcal{L}_l + \mathcal{L}_u + \mathcal{L}_{\text{feat}}\big),\qquad \mathcal{L}_{\text{feat}} = 1 - \frac{1}{HW}\sum_{i=1}^{HW}\cos(f_i, f'_i)\ \ \text{(solo píxeles con } \cos < \alpha\text{)}`, caption: 'Depth Anything V1 (ecuaciones 1, 8 y 9; §3.3: "an average combination of the three losses"). L_u es la pérdida afín-invariante entre el estudiante sobre la imagen perturbada (y mezclada con CutMix) y la pseudo-etiqueta del maestro sobre las imágenes limpias.' },
          { t: 'kv', items: [
            ['Encoder / decoder', 'DINOv2 + DPT; LR 5e−6 para el encoder preentrenado, 10× para el decoder; AdamW con decaimiento lineal', '§4.1 de V1'],
            ['Resolución', 'Lado corto a 518 y recorte de 518×518 al entrenar; al inferir, sin recorte y lados múltiplos de 14', 'Apéndice 6 de V1'],
            ['Etapas', 'Maestro 20 épocas sobre las etiquetadas; estudiante: una pasada por las 62M sin etiqueta', '§4.1 de V1'],
          ] },
          { t: 'h3', text: 'Depth Anything V2: sintético para el maestro, pseudo-etiquetas reales para el estudiante' },
          { t: 'p', html: R`El diagnóstico de V2: las etiquetas reales son <b>ruidosas</b> (sensores que no ven vidrio, estéreo que falla en patrones repetidos, SfM que se rompe con objetos en movimiento) y <b>gruesas</b> (bordes y estructuras finas mal etiquetados). Los modelos entrenados con ellas aprenden esos errores. Las etiquetas sintéticas son exactas, incluido el vidrio y los espejos, pero tienen otro estilo y poca diversidad de escenas. La receta (§5 de ${DA2}):` },
          { t: 'steps', items: [
            { title: 'Maestro grande solo con sintéticos', html: R`<p>DINOv2-G (≈ 1.3B parámetros) sobre 595K imágenes sintéticas precisas (Hypersim, Virtual KITTI 2, IRS, TartanAir, BlendedMVS; la cifra es la del texto, §5.2; las cuentas por dataset de la Tabla 7 suman ≈ 604K). Batch 64, 160K iteraciones. Solo el encoder más grande transfiere bien de sintético a real (Fig. 5).</p>` },
            { title: 'Pseudo-etiquetar 62M imágenes reales', html: R`<p>(los mismos 8 datasets de V1) con ese maestro: el puente que cierra la brecha de dominio y agrega diversidad.</p>` },
            { title: 'Estudiantes (S, B, L, G) solo con las pseudo-etiquetas reales', html: R`<p>Batch 192, 480K iteraciones, Adam con LR 5e−6 (encoder) y 5e−5 (decoder), 518×518. Pérdidas: L_ssi + L_gm con pesos 1:2 (el término de gradientes es clave para la nitidez con datos sintéticos) y la alineación de features de V1 sobre las pseudo-etiquetadas; se ignora el 10 % de regiones con mayor pérdida de cada muestra (pseudo-etiquetas probablemente malas).</p>` },
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"V2 is distillation at the label level: the giant teacher trained only on precise synthetic data labels sixty-two million real images, and the small students learn from those pseudo labels. That transfers the teacher's sharpness and robustness to transparent and reflective surfaces without using noisy real labels, and it avoids feature-level distillation across a huge capacity gap."</p>` },
          { t: 'callout', kind: 'trap', title: '"V2 es mejor en todos los benchmarks"', html: R`<p>En los benchmarks clásicos (KITTI, NYU-D, Sintel, ETH3D, DIODE) V2 es mejor que MiDaS pero <b>apenas comparable</b> con V1 (Tabla 2 de ${DA2}); los autores argumentan que esos test sets tienen ruido (espejos y estructuras finas mal etiquetados en NYU-D, Fig. 8) y crean DA-2K, 1K imágenes con 2K pares de puntos anotados ("¿cuál está más cerca?"). Donde la diferencia es clara es en superficies transparentes: 25.9 % (MiDaS), 53.5 % (V1) y 83.6 % (V2) en el Transparent Surface Challenge (§2 y Tabla 12).</p>` },
          { t: 'h3', text: 'Profundidad métrica: tres caminos' },
          { t: 'table', caption: 'Cómo pasar de relativa a metros', head: ['Camino', 'Ejemplo', 'Cómo resuelve la escala', 'Ojo con'], rows: [
            ['Afinar una cabeza métrica en un dominio', R`V2 metric (Hypersim interiores, máx. 20 m; Virtual KITTI 2 exteriores, máx. 80 m); ZoeDepth (${ZOE})`, R`Aprende la escala de ese dominio y de su cámara. ZoeDepth: preentrenado relativo en 12 datasets, "metric bins" por dominio (NYU y KITTI) y un clasificador latente que elige la cabeza`, 'Fuera del dominio y con otra focal, la escala se va'],
            ['Normalizar o estimar la cámara', R`Metric3D / v2 (${M3D}); Depth Pro (${DPRO})`, R`Metric3D: transforma a un espacio de cámara canónica (focal fija) para entrenar con miles de cámaras. Depth Pro: predice profundidad inversa canónica C y la convierte a metros con la focal, D<sub>m</sub> = f<sub>px</sub> / (w·C) (en el código: inversa métrica = C·w/f<sub>px</sub> y D = 1/inversa; w = ancho de la imagen en píxeles); si no hay EXIF, una cabeza estima el campo de visión y de ahí f<sub>px</sub>`, 'Si das intrínsecos, que sean los de la imagen redimensionada'],
            ['Alinear con medidas externas', 'LiDAR ralo, ToF, puntos de un SLAM, altura conocida de la cámara sobre el piso', R`Ajustar s y t por frame (mínimos cuadrados o RANSAC) en disparidad con los puntos medidos; con el piso, Z = f<sub>y</sub>·h<sub>c</sub>/(v − c<sub>y</sub>) en cada fila (ejemplo en la sección <a href="#depth.entrevista">entrevista</a>)`, 'Necesitas ≥ 2 puntos bien repartidos en profundidad; con uno solo no separas s de t'],
          ] },
          { t: 'p', html: R`Depth Pro reporta un mapa de 2.25 megapíxeles en 0.3 s en una GPU estándar (resumen; su Tabla 5 mide en una V100-32G), con una entrada interna fija de 1536×1536 cortada en parches de 384 para un ViT multiescala. Es otro punto del trade-off: más nitidez y metros sin intrínsecos, a otro costo.` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Preprocesar', html: R`<p>Redimensionar con el lado corto a 518 y ambos lados a múltiplos de 14 (interpolación cúbica en el código oficial), normalizar con la media y desviación de ImageNet. Si la imagen no es cuadrada, los tokens cambian: 640×480 → 686×518 → 49 × 37 = 1,813 patches.</p>` },
            { title: 'Una pasada', html: R`<p>Encoder (${met('encMacs')} a 518×518) + DPT (${met('headMacs')}). Sin bucles, sin NMS, sin prompts: una imagen, un mapa.</p>` },
            { title: 'Post-procesar', html: R`<p>Interpolar la salida al tamaño original (bilineal). La salida es disparidad relativa: para visualizar se normaliza a 0–1 por imagen; para usarla en 3-D hay que pasarla a profundidad con s y t.</p>` },
            { title: 'A 3-D', html: R`<p>Si hace falta: z = 1/(s·d + t) por píxel y back-projection con los intrínsecos, X = (u − c<sub>x</sub>)·z/f<sub>x</sub>, Y = (v − c<sub>y</sub>)·z/f<sub>y</sub>, Z = z. Esa nube es la entrada de <a href="#pointnet">PointNet</a> o de un mapa de ocupación; para pegarla a otra vista o a un mapa se registra con ICP (en la sección <a href="#pointnet.inferencia">inferencia de PointNet</a>).</p>` },
          ] },
          { t: 'h3', text: 'Qué domina latencia y memoria' },
          { t: 'p', html: R`Con B = 1 en un Jetson, los bloques del ViT-S son ${npc('enc')} de los MACs; la atención crece con N² cuando subes la resolución. La cabeza DPT trabaja con mapas grandes: a 518 su costo es ${met('headShare')} de los MACs, pero en bytes movidos pesa más (sección <a href="#depth.costo">costo</a>).` },
          { t: 'h3', text: 'Trucos que se usan en robots' },
          { t: 'list', items: [
            R`<b>Resolución fija y menor</b>: 364×364 (26² = 676 patches) o 266×266 (19² = 361) baja los MACs algo más de ×2 o de ×4 (la parte N² cae más rápido que los tokens), a cambio de bordes menos finos. La cota de latencia del Orin baja menos que los MACs, porque ahí manda la memoria (≈ ×0.52 a 364: lo comprueba un "¿qué pasa si…?" de la práctica). Fíjala: TensorRT optimiza para una forma.`,
            R`<b>TensorRT fp16</b> y, si hace falta, <b>int8</b> con calibración sobre imágenes de tu dominio; valida el error de profundidad (AbsRel en tus datos), no solo el mapa a ojo: la cuantización de una regresión densa puede meter bandas. En un ViT, LayerNorm, softmax y GELU suelen quedarse en fp16 (sus activaciones tienen outliers), así que la ganancia sobre fp16 es menor que en una CNN (pregunta en la sección <a href="#depth.entrevista">entrevista</a>).`,
            R`<b>Destilar</b> a un estudiante más chico o a una CNN con tus propias imágenes pseudo-etiquetadas por el modelo grande: es la receta de V2 a escala doméstica.`,
            R`<b>Escala por frame con sensores</b>: con un LiDAR ralo o un ToF, ajusta s y t por frame (RANSAC sobre pares disparidad–medida) y la red aporta la densidad.`,
            R`<b>Consistencia temporal</b>: suavizar s y t entre frames (un filtro de Kalman sobre la escala) o usar un modelo de video (${VDA}); frame a frame, el mapa parpadea.`,
            R`<b>Recortar a la región útil</b>: si solo importa el piso delante del robot o la mesa, procesa ese recorte a más resolución en vez de la imagen entera.`,
          ] },
          { t: 'callout', kind: 'trap', title: '"Back-proyecto la profundidad y ya tengo una nube de puntos limpia"', html: R`<p>En los bordes de profundidad la red suaviza: los píxeles del contorno quedan entre el objeto y el fondo, y al back-proyectar aparecen "flying pixels", una estela de puntos falsos entre los dos. Para agarrar o para un mapa de ocupación, filtra por gradiente de profundidad (descarta píxeles donde |∇z| es grande) o por consistencia con un segundo sensor. Y usa los intrínsecos de la imagen al tamaño en que interpolaste la salida.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', items: [
            R`<b>Superficies transparentes y reflectantes</b>: un vidrio muestra lo que está detrás; un espejo, otra escena. La red relativa "ve" la escena reflejada a la profundidad equivocada. V2 mejora mucho (83.6 % en el Transparent Surface Challenge contra 53.5 % de V1) porque los sintéticos sí etiquetan el vidrio, pero no es una garantía. Los sensores activos también fallan ahí (el ToF y el LiDAR atraviesan o rebotan): es un problema del robot, no solo de la red.`,
            R`<b>Cielo y lejanía</b>: el cielo debería ser disparidad 0; nubes y cielos con textura confunden (Fig. 6 de V2, con el maestro sin datos reales). Más allá de cierta distancia toda la escena es "lejos" y la resolución en profundidad se pierde.`,
            R`<b>Cambio de dominio</b>: vistas cenitales, fisheye, bajo el agua, endoscopía, imágenes térmicas, escenas sin objetos de tamaño conocido. Los priors de tamaño y perspectiva no aplican. Síntoma: mapas suaves y "plausibles" pero con el orden equivocado.`,
            R`<b>Escala por frame y parpadeo</b>: cada frame tiene su s y su t; en video, la profundidad de una pared quieta cambia de un frame a otro aunque la cámara no se mueva. Para mapas acumulados hay que estabilizar la escala (o usar un modelo de video).`,
            R`<b>Ilusiones geométricas</b>: fotos dentro de la escena (un póster, una pantalla), pinturas en trompe-l'œil, maquetas: la red da profundidad a la imagen pintada.`,
          ] },
          { t: 'table', caption: 'Monocular contra los sensores de profundidad de un robot', head: ['Criterio', 'Monocular (red)', 'Estéreo (pasivo / activo)', 'ToF / luz estructurada', 'LiDAR'], rows: [
            ['Escala absoluta', 'No (relativa) o aprendida por dominio', R`Sí: z = f·B/disparidad, con la calibración`, 'Sí', 'Sí'],
            ['Error con la distancia', 'Relativo, ≈ constante en %; sin cota física', R`Crece ∝ z²: δz = z²·δd/(f·B)`, 'Pequeño hasta su alcance (pocos metros)', 'Centímetros, casi constante; densidad ∝ 1/z²'],
            ['Densidad', 'Un valor por píxel', 'Densa donde hay textura (activo: proyecta textura)', 'Densa, baja resolución', 'Rala (líneas), 360°'],
            ['Falla en', 'Dominio raro, vidrio, espejos, ilusiones', 'Superficies sin textura, patrones repetidos, oclusiones', 'Sol directo (IR), superficies negras o especulares, multipath', 'Vidrio, espejos, lluvia o niebla densas; superficies muy oscuras'],
            ['Costo y consumo', 'Una cámara + GPU', 'Dos cámaras + cómputo de matching', 'Emisor IR; bajo consumo', 'Alto (bajando); partes móviles o estado sólido'],
            ['Uso típico en robots', 'Densificar, orden relativo, respaldo en vidrio', 'Navegación, manipulación de mesa', 'Manipulación de cerca (bin picking)', 'Autos, AMRs en exteriores, mapeo'],
          ] },
          { t: 'p', html: R`<b>Ejemplo del error de estéreo.</b> Con f = 700 px y baseline B = 0.12 m, f·B = 84 px·m. A z = 5 m la disparidad es 84/5 = 16.8 px; un error de matching de 0.25 px cambia z en δz = z²·δd/(f·B) = 25 × 0.25/84 ≈ 0.074 m. A 10 m, cuatro veces más: ≈ 0.30 m. Por eso un estéreo de mesa es excelente a 1 m y mediocre a 10 m, mientras que el error relativo de una red monocular no tiene esa forma (ni una cota).` },
          { t: 'compare', models: [C, CL, DL], rows: ['params', 'macs', MK.headShare, 'tokens', MK.msOrin], caption: 'El costo de subir de Small a Large (o a DPT-Large) a su resolución canónica: ≈ cota roofline en un Jetson AGX Orin.' },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'list', items: [
            R`<b>Eigen et al. (2014)</b>: la primera red profunda para profundidad monocular, coarse-to-fine, con una pérdida invariante a escala en log-profundidad (${EIGEN}). MiDaS la generaliza a escala y desplazamiento en disparidad.`,
            R`<b>MiDaS v1–v3.1</b>: mezcla de datasets + pérdida ssi; v3 = DPT; v3.1 prueba encoders (BEiT, Swin…). El mejor MiDaS v3.1 (BEiT-L 512) es la línea base de Depth Anything.`,
            R`<b>DPT</b> (${DPT}): la cabeza que todos reusan; DPT-Hybrid usa un ResNet-50 como embedding y DPT-Large un ViT-L/16. También para segmentación semántica (ADE20K).`,
            R`<b>Depth Anything V1 / V2</b> (${DA1}; ${DA2}): DINOv2 + DPT + datos (pseudo-etiquetas, sintéticos). Modelos de 24.8M a 1.3B parámetros. Afinados a métrico con el pipeline de ZoeDepth (V1) o en Hypersim / Virtual KITTI 2 (V2).`,
            R`<b>Video Depth Anything</b> (${VDA}): consistencia temporal para videos largos sobre V2.`,
            R`<b>Marigold</b> (${MARIGOLD}): profundidad como generación condicionada, re-usando Stable Diffusion (<a href="#stable-diffusion">página</a>). Detalle fino, pero varias pasadas de denoising; V2 reporta ser más de 10× más rápido y más preciso.`,
            R`<b>Métricos</b>: ZoeDepth (${ZOE}), Metric3D / v2 (${M3D}), Depth Pro (${DPRO}), UniDepth. Diferencia clave: cómo tratan la cámara (sección <a href="#depth.entrenamiento">entrenamiento</a>).`,
            R`<b>Reconstrucción 3-D</b> con muchas vistas: NeRF y 3D Gaussian Splatting (tarjeta del mapa); no estiman profundidad de una imagen, optimizan una escena entera.`,
          ] },
          { t: 'h3', text: 'Referencias' },
          { t: 'list', items: [DPT + '.', MIDAS + '.', DA1 + '.', DA2 + '.', DINO2 + '.', ZOE + '.', DPRO + '.', M3D + '.', EIGEN + '.', MARIGOLD + '.', VDA + '.', REFINE + '.', 'Código oficial: DepthAnything/Depth-Anything-V2 (depth_anything_v2/dpt.py, metric_depth/); HF transformers: DepthAnythingForDepthEstimation, DPTForDepthEstimation.'] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`La profundidad monocular aparece en entrevistas de robótica y percepción de tres formas: el porqué (ambigüedad de escala, relativa vs métrica), la mecánica (DPT, la pérdida ssi) y el diseño (qué sensor, qué latencia, qué hacer cuando falla). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Why is monocular depth estimation ill-posed, and how do modern models still produce good depth?',
              junior: 'Porque no hay dos cámaras; la red aprende la profundidad de muchos ejemplos.',
              senior: R`Porque la proyección pinhole pierde la escala: escalar toda la escena por k da la misma imagen, y además la escala aparente depende de la focal de la cámara. La red resuelve con priors aprendidos (tamaños típicos, perspectiva, oclusión, textura, neblina), así que predice bien la <b>forma</b> relativa y mal la escala absoluta. Por eso MiDaS y Depth Anything predicen disparidad salvo escala y desplazamiento, entrenan con una pérdida que alinea s y t por imagen y así pueden mezclar datasets con unidades incompatibles. Los metros requieren un dominio y una cámara fijos, o intrínsecos, o medidas externas.`,
              say: 'A single image is consistent with the whole scene scaled by any factor, and apparent size also depends on the focal length, so absolute scale is not observable. Networks learn priors like object sizes, perspective and occlusion, which give good relative structure. That is why models like MiDaS and Depth Anything predict affine-invariant inverse depth and train with a scale-and-shift-invariant loss, which lets them mix datasets with incompatible units. Metric depth needs a fixed domain and camera, the intrinsics, or external measurements.',
              why: 'Se anota la ambigüedad de escala geométrica, la focal, priors, relativa vs métrica y por qué la pérdida ssi permite mezclar datos.' },
            { q: 'Derive the scale-and-shift-invariant loss. How do you compute the alignment?',
              junior: 'Se normaliza la predicción y se compara con un MSE.',
              senior: R`Por imagen, (s, t) = argmin Σ(s·dᵢ + t − d*ᵢ)²: una regresión lineal de la verdad sobre la predicción, en disparidad. Derivando: t = mean(d*) − s·mean(d) y s = cov(d, d*)/var(d); en matriz, ecuaciones normales 2×2 con cinco sumas por imagen (Σd, Σd², Σd·d*, Σd*, M), diferenciable y O(M). La pérdida es ½M⁻¹ Σ ρ(s·dᵢ + t − d*ᵢ). La versión robusta de MiDaS normaliza cada mapa con mediana y desviación absoluta media, usa MAE y descarta el 20 % de residuos más grandes; se suma un término de gradientes multiescala para bordes nítidos. Se calcula solo en píxeles válidos (máscara), y en disparidad, porque un ajuste afín en profundidad no es lo mismo.`,
              say: 'Per image I solve a two-by-two least squares problem: scale and shift that best map the predicted disparity to the ground truth, which is a linear regression with five sums, closed form and differentiable. The loss is the mean residual after alignment. MiDaS also has a robust variant that normalizes both maps with the median and mean absolute deviation, uses an absolute error and trims the largest twenty percent of residuals, plus a multi-scale gradient matching term. It is computed only on valid pixels and in disparity space.',
              why: 'Se anota la derivación (no solo "normalizar"), la máscara de válidos, disparidad y la versión robusta.' },
            { q: 'How does DPT turn a ViT into a dense predictor? What are the shapes for Depth Anything V2 Small at 518?',
              junior: 'Agrega un decoder de convoluciones después del ViT.',
              senior: R`El ViT no tiene pirámide: todas las capas están a stride 14. DPT toma los tokens de cuatro bloques (3, 6, 9, 12), descarta el CLS (o lo proyecta), reacomoda los 37×37 tokens en una rejilla, conv 1×1 a 48, 96, 192, 384 canales y re-muestrea ×4, ×2, ×1, ×½: mapas de 148², 74², 37², 19². Después, fusión tipo RefineNet de grueso a fino (unidades residuales, suma, upsample ×2) hasta 296×296 con 64 canales, y una cabeza de convs que interpola a 518 y deja un canal con ReLU. Los parámetros son casi todos del encoder; los MACs de la cabeza no son chicos porque trabaja a alta resolución.`,
              say: 'A ViT has a single stride, so DPT builds a pyramid by tapping four transformer layers, dropping or projecting the class token, reshaping the tokens back into the patch grid and resampling them with one-by-one convolutions and transposed or strided convolutions to four scales. A RefineNet-style fusion goes coarse to fine with residual conv units and upsampling, and a small conv head outputs one channel at input resolution. For the small model at 518 the grid is 37 by 37, and the four maps are 148, 74, 37 and 19 pixels wide.',
              why: 'Se anotan los taps, Read/Concatenate/Resample, las cuatro escalas con el patch de 14 y que la cabeza cuesta en MACs.' },
            { q: 'You are designing perception for a mobile robot (indoor AMR) or a grasping cell. Would you rely on monocular depth? How?',
              junior: 'Sí, uso Depth Anything en la cámara y convierto a nube de puntos.',
              senior: R`Primero el requisito: ¿precisión a qué distancia y con qué consecuencia del error? Para <b>navegación de interiores</b> uso un sensor métrico (estéreo activo o un LiDAR 2-D) para seguridad y mapa, y la monocular para lo que falla en ellos: vidrio, obstáculos finos o bajos fuera del plano del LiDAR, y densificar. Alineo s y t por frame con los puntos medidos (RANSAC en disparidad), suavizo la escala en el tiempo y filtro flying pixels en los bordes. Para <b>agarrar</b> necesito milímetros: RGB-D o estéreo activo a corta distancia, y la monocular solo como respaldo en objetos transparentes. Despliegue: V2 Small (Apache-2.0; Base y Large son no comerciales), TensorRT fp16 a resolución fija, medido en el Jetson con la pila corriendo; si no alcanza, bajo resolución antes que modelo. Monitoreo: comparar la monocular alineada con el sensor métrico donde ambos existen; si el residuo sube, hay cambio de dominio.`,
              say: 'It depends on the error budget. For an indoor robot I would use a metric sensor for safety and mapping, and monocular depth to cover what that sensor misses, like glass and thin or low obstacles, aligning scale and shift per frame to the sparse metric points with RANSAC, smoothing the scale over time and filtering flying pixels at edges. For grasping I need millimeters, so active stereo or RGB-D up close, with monocular depth only as a fallback on transparent objects. I would deploy the small model, which is the only one with a commercial license, in TensorRT fp16 at a fixed resolution, and monitor the residual against the metric sensor to detect domain shift.',
              why: 'Trampa: monocular sola para seguridad o para agarrar. Se anota presupuesto de error, fusión con sensor métrico, alineación por frame, licencias y monitoreo.', trap: true },
            { q: 'Your monocular depth model works on the benchmark but fails on your robot. What are the likely causes and fixes?',
              junior: 'Lo vuelvo a entrenar con más datos.',
              senior: R`Reviso en orden: (1) <b>cámara</b>: otra focal o distorsión (fisheye) cambia la escala y los priors; rectifica y, si es métrico, usa un modelo que reciba intrínsecos; (2) <b>dominio</b>: altura y ángulo de cámara distintos (a 20 cm del piso), iluminación, motion blur, superficies brillantes o vidrio; (3) <b>preprocesado</b>: resolución o normalización distinta a la de entrenamiento, recorte en vez de resize; (4) <b>la métrica</b>: ¿alineas s y t antes de medir? Un modelo relativo evaluado en metros siempre "falla". Fix barato: pseudo-etiquetar imágenes del robot con el modelo grande y afinar el chico (la receta V2), o alinear con los sensores del robot; fix caro: recolectar verdad con un sensor métrico en el dominio.`,
              say: 'I would check the camera first, because a different focal length or fisheye distortion changes both scale and priors, then the domain, like a camera twenty centimeters above the floor, motion blur or glass, then preprocessing mismatches, and finally the metric itself, since a relative model must be aligned before computing errors. The cheap fix is to pseudo label the robot images with the large model and fine-tune the small one, or align to the robot sensors; the expensive one is collecting metric ground truth in the domain.',
              why: 'Se anota cámara/intrínsecos, dominio, preprocesado, evaluación con alineación y la receta de pseudo-etiquetas.' },
            { q: 'A relative depth model reports AbsRel 0.05 on a benchmark. Why might that number say little about your robot, and how would you evaluate instead?',
              junior: 'Lo evalúo con AbsRel en mis imágenes.',
              senior: R`(1) <b>Alineación oráculo</b>: el protocolo alinea s y t por imagen <i>con la verdad</i>. Mide la forma, no la escala que vas a tener online; en el robot la escala sale de tus sensores (unos puntos de LiDAR, el piso) o de un modelo métrico. Reporto las dos: alineada con la verdad (forma) y con mi alineación desplegable (la que puedo calcular en operación). (2) <b>Espacio de alineación</b>: alinear en disparidad o en profundidad da números distintos, y la RMSE en metros la dominan los píxeles lejanos, la AbsRel no. Fijo y escribo el espacio, la profundidad máxima y el recorte (los benchmarks recortan a un rango, por ejemplo 80 m en KITTI, y a una región de la imagen). (3) <b>Máscara y verdad</b>: solo píxeles válidos; la verdad de sensores falla en vidrio y bordes (el argumento de V2 sobre NYU-D), así que parte del "error" es error de la verdad. (4) <b>Lo que le importa al robot</b>: error por bandas de distancia (0–2 m, 2–5 m…) y en la región útil (el piso delante, los obstáculos), calidad de bordes y flying pixels, y <b>estabilidad temporal</b>: cuánto cambia la profundidad de una escena quieta entre frames. (5) <b>Tarea final</b>: obstáculos detectados a la distancia de frenado, o éxito de agarre; la métrica por píxel es un proxy.`,
              say: 'Benchmark AbsRel for a relative model is computed after an oracle per-image scale and shift fit to the ground truth, so it measures shape, not the scale I will have online. I would report both the oracle-aligned error and the error with my deployable alignment from LiDAR points or the ground plane. I fix the alignment space, the depth cap and the crop, mask invalid pixels, and remember that sensor ground truth is wrong on glass and edges. Then I break errors down by distance band and region of interest, measure edge quality, flying pixels and temporal stability on static scenes, and tie it to a task metric like obstacle detection at braking distance.',
              why: 'Trampa: la AbsRel alineada con la verdad como métrica del robot. Se anota oráculo vs alineación desplegable, espacio / rango / recorte, ruido de la verdad, bandas de distancia, bordes, estabilidad temporal y métrica de tarea.', trap: true },
          ] },
          { t: 'qa', items: [
            { q: '¿Qué miden AbsRel y δ &lt; 1.25, y cómo se evalúa un modelo relativo?', a: R`Con z la profundidad (no la disparidad d de esta página): AbsRel = (1/M) Σ |zᵢ − z*ᵢ| / z*ᵢ, el error relativo medio; δ₁ = % de píxeles con máx(zᵢ/z*ᵢ, z*ᵢ/zᵢ) &lt; 1.25 (δ₂ y δ₃ con 1.25² y 1.25³). Calcularlas sobre disparidad es un bug común: da otro número. Para un modelo relativo, primero se alinean s y t por imagen (MiDaS: mínimos cuadrados en disparidad) y después se calculan las métricas; Depth Anything lo hace igual ("the scale and shift of our prediction are manually aligned with the ground truth").` },
            { q: '¿Cuántos tokens procesa el encoder a 518×518 y a 1036×1036? ¿Por qué factor crece la atención?', a: R`(518/14)² = ${met('patches')} patches (+1 CLS = ${qn('tokens')}) y (1036/14)² = 5,476. Los tokens ×4; las lineales ×4; QKᵀ y A·V ×16 (∝ N²).` },
            { q: '¿Por qué la salida de Depth Anything tiene una ReLU al final y el modelo métrico una sigmoide?', a: 'El relativo predice disparidad (≥ 0, cielo = 0). El métrico predice profundidad acotada: sigmoide × max_depth (20 m en Hypersim, 80 m en Virtual KITTI 2).' },
            { q: 'Una predicción relativa y cinco puntos de LiDAR en la misma imagen: ¿cómo obtienes metros?', a: R`Pasas los cinco puntos a disparidad (1/z), ajustas s y t con mínimos cuadrados (o RANSAC si hay outliers) entre la disparidad predicha en esos píxeles y la medida, y conviertes todo el mapa: z = 1/(s·d + t). Con un solo punto no puedes separar s de t.` },
            { q: 'Tu robot tiene la cámara a 0.5 m del piso, eje óptico horizontal, f_y = 600 px. ¿Cómo sacas metros de una predicción relativa sin otro sensor?', a: R`Un píxel del piso en la fila v está a Z = f<sub>y</sub>·h<sub>c</sub>/(v − c<sub>y</sub>): con v − c<sub>y</sub> = 100 px, Z = 600 × 0.5/100 = 3 m. La inversa, 1/Z = (v − c<sub>y</sub>)/(f<sub>y</sub>·h<sub>c</sub>), es lineal en v: con muchos píxeles del piso (segmentados, o la franja inferior de la imagen) ajustas s y t en disparidad por mínimos cuadrados o RANSAC y conviertes todo el mapa. Con la cámara inclinada (pitch), intersecas cada rayo con el plano del piso (hace falta la extrínseca cámara–base). Falla en rampas, escaleras o si el piso no se ve.` },
            { q: 'Elige sensor de profundidad: (a) bin picking de piezas metálicas, (b) AMR en exterior a pleno sol, (c) brazo que trabaja junto a vitrinas.', a: R`(a) Luz estructurada o estéreo activo de corto alcance (resolución milimétrica); el metal brillante deja huecos: varias exposiciones o vistas, y la monocular para rellenar. (b) El IR del ToF y de la luz estructurada se satura al sol: LiDAR + estéreo pasivo (al sol, el estéreo tiene textura de sobra). (c) El LiDAR y el ToF atraviesan o rebotan en el vidrio: sensores de seguridad que no dependen de la óptica (contacto, ultrasonido) y la monocular V2 (mejor en transparentes) como pista, nunca como única barrera.` },
            { q: '¿Qué vigilas al pasar Depth Anything V2 a INT8 en TensorRT?', a: R`Los ViT tienen activaciones con outliers en LayerNorm, softmax y GELU: la calibración por tensor recorta mal. Uso precisión mixta (LayerNorm, softmax y la cabeza final en fp16, el resto en INT8), pesos por canal, y calibro (percentil o entropía) con imágenes de mi robot, no de ImageNet. Valido contra el modelo fp16 en datos propios retenidos: AbsRel y δ₁ con la misma alineación, bandas o escalones en la disparidad (una regresión densa con pocos niveles) y bordes. Y mido en el Jetson: en un ViT la ganancia de INT8 sobre fp16 suele ser menor que en una CNN, porque parte del grafo queda en fp16 y la atención mueve memoria. Con forma fija: TensorRT optimiza para una resolución.` },
            { q: '¿Qué quiere decir que V2 hace "destilación al nivel de etiquetas"?', a: 'El maestro grande no transfiere features ni logits: etiqueta 62M imágenes reales y el estudiante aprende de esas etiquetas. Evita la destilación de features entre modelos de tamaños muy distintos, que el paper cita como no siempre beneficiosa.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama en blanco; después las formas; los "¿qué pasa si…?" y dos ejercicios: la alineación a mano y el conteo de parámetros contra HF.` },
          { t: 'h3', text: 'Diagrama en blanco' },
          { t: 'blankdiagram', diagram: 'depth-overview', slots: [
            { node: ND.enc, ask: 'label' },
            { node: 'reassemble-1', tensor: TN.feat1, ask: 'shape' },   // la arista reassemble-1 > fusión 1 (feat-1, ya con F canales)
            { node: 'fusion-1', ask: 'label' },
            { node: ND.head, tensor: TN.depth, ask: 'shape' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'depth', pool: 'all', configs: [C, DL] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: 'Subes la entrada de 518×518 a 1036×1036 (el doble de lado). ¿Por qué factor cambian los tokens?', change: { res: 1036 }, ask: 'tokens',
              explain: '×2 de lado → ×4 patches (37² → 74²); el CLS es uno solo, así que el cociente es ≈ 4.' },
            { q: 'Mismo cambio, 1036×1036. ¿Por qué factor cambian los MACs del encoder?', change: { res: 1036 }, ask: MK.encMacs,
              explain: 'Más de ×4: las lineales crecen ×4 y QKᵀ y A·V ×16; con ViT-S (D = 384) y miles de tokens, la parte N² ya pesa.' },
            { q: 'Mismo cambio, 1036×1036. ¿Y los MACs de la parte DPT (reassemble + fusión + cabeza)?', change: { res: 1036 }, ask: MK.headMacs,
              explain: '≈ ×4: todo son convs sobre mapas cuya área crece con el cuadrado del lado.' },
            { q: 'Mismo cambio, 1036×1036. ¿Y los parámetros?', change: { res: 1036 }, ask: 'params',
              explain: 'No cambian: la tabla de posición se interpola en cada pasada; los pesos no dependen de la resolución.' },
            { q: 'Bajas a 364×364 para el Jetson. ¿Por qué factor cambia la latencia ≈ en el Orin?', change: { res: 364 }, ask: MK.msOrin,
              explain: 'Baja a algo más de la mitad (≈ ×0.52), no a (364/518)² ≈ 0.49 ni a los ×0.42 de los MACs: en el Orin la cota la pone la memoria a las dos resoluciones. Los bytes son activaciones ∝ píxeles (el calculador no cuenta las matrices de atención, así que la parte N² no entra) más los pesos, que no cambian con la resolución. La caída ≈ ×4 de QKᵀ y A·V se ve en los MACs, no en esta cota.' },
          ] },
          { t: 'h3', text: 'Ejercicio 1: alinea a mano (y luego en PyTorch)' },
          { t: 'p', html: R`Disparidad predicha d = (1, 2, 3, 4), verdadera d* = (2.9, 5.2, 6.8, 9.1). (a) Calcula s y t con las ecuaciones normales. (b) Los residuos y L_ssimse = Σr²/(2M). (c) La misma pérdida sin alinear (s = 1, t = 0). (d) Escribe la alineación en PyTorch para un lote de mapas con máscara de píxeles válidos.` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con NumPy y PyTorch en el venv del Atlas)', a: R`(a) Σd = 10, Σd² = 30, Σd* = 24, Σd·d* = 70.1, M = 4; det = 30·4 − 10² = 20; s = (4·70.1 − 10·24)/20 = 2.02; t = (30·24 − 10·70.1)/20 = 0.95. (b) s·d + t = (2.97, 4.99, 7.01, 9.03); r = (0.07, −0.21, 0.21, −0.07); Σr² = 0.098; L = 0.098/8 = 0.01225. (c) Σ(d − d*)² = 54.3; L = 54.3/8 = 6.79. (d) El código de abajo da s = 2.02 y t = 0.95.` },
          ] },
          { t: 'code', title: 'Alineación de escala y desplazamiento con máscara (PyTorch)', files: [
            { name: 'ssi_loss.py', lang: 'python', code: R`import torch


def scale_shift(pred, gt, mask):
    """pred, gt, mask: (B, H, W). Devuelve s, t: (B,) que minimizan sum mask*(s*pred + t - gt)^2."""
    a00 = (mask * pred * pred).sum((-1, -2))      # sum d^2
    a01 = (mask * pred).sum((-1, -2))             # sum d
    a11 = mask.sum((-1, -2))                      # M (píxeles válidos)
    b0 = (mask * pred * gt).sum((-1, -2))         # sum d * d*
    b1 = (mask * gt).sum((-1, -2))                # sum d*
    det = (a00 * a11 - a01 * a01).clamp_min(1e-12)
    s = (a11 * b0 - a01 * b1) / det               # inversa 2x2 explícita
    t = (-a01 * b0 + a00 * b1) / det
    return s, t


def ssi_mse(pred, gt, mask):
    s, t = scale_shift(pred, gt, mask)
    r = (s[:, None, None] * pred + t[:, None, None] - gt) * mask
    M = mask.sum((-1, -2)).clamp_min(1)
    return ((r ** 2).sum((-1, -2)) / (2 * M)).mean()  # 1/(2M) sum r^2, promedio del lote


if __name__ == '__main__':
    d = torch.tensor([1.0, 2.0, 3.0, 4.0], dtype=torch.float64).view(1, 2, 2)
    g = torch.tensor([2.9, 5.2, 6.8, 9.1], dtype=torch.float64).view(1, 2, 2)
    m = torch.ones_like(d)
    print(scale_shift(d, g, m))   # (tensor([2.0200]), tensor([0.9500]))
    print(ssi_mse(d, g, m))       # tensor(0.0123)
` },
          ] },
          { t: 'h3', text: 'Ejercicio 2: las formas de reassemble' },
          { t: 'p', html: R`Para Depth Anything V2 Small a 518×518 (patch 14, D = 384, neck_hidden_sizes 48, 96, 192, 384, fusion 64), escribe la forma de: los tokens de un tap, la rejilla después de Read + Concatenate, y la salida de cada una de las cuatro ramas de reassemble. Repite para DPT-Large a 384×384 (patch 16, D = 1024, canales 256, 512, 1024, 1024).` },
          { t: 'qa', items: [
            { q: 'Solución', a: R`Small: tap ${sh('tap1')} (con el CLS) → rejilla 37×37×384 → ${sh('re1')}, ${sh('re2')}, ${sh('re3')}, ${sh('re4')}. DPT-Large: tap ${sh('tap1', DL)} → rejilla 24×24×1024 → ${sh('re1', DL)}, ${sh('re2', DL)}, ${sh('re3', DL)}, ${sh('re4', DL)}. Con patch 16 los strides son 4, 8, 16 y 32; con patch 14, 3.5, 7, 14 y ≈ 27 (518/19: la rama ×½ redondea 18.5 hacia arriba).` },
          ] },
          { t: 'h3', text: 'Ejercicio 3: el reparto de parámetros contra HF' },
          { t: 'p', html: R`Sin descargar pesos (dispositivo meta), cuenta los parámetros del modelo de HF por módulo y compáralos con el calculador: total ${qn('params.total')}, encoder ${met('encParams')}, DPT ${met('headParams')}.` },
          { t: 'code', title: 'Conteo por módulo en el dispositivo meta (transformers 5.19)', files: [
            { name: 'count_da.py', lang: 'python', code: R`import torch
from transformers import AutoConfig, DepthAnythingForDepthEstimation

cfg = AutoConfig.from_pretrained('depth-anything/Depth-Anything-V2-Small-hf')
with torch.device('meta'):                       # sin pesos: solo formas
    m = DepthAnythingForDepthEstimation(cfg)

count = lambda mod: sum(p.numel() for p in mod.parameters())
print('total   ', count(m))                      # 24,785,089
print('backbone', count(m.backbone))             # 22,056,576 (DINOv2 ViT-S/14)
print('neck    ', count(m.neck))                 # reassemble + convs 3x3 + fusión
print('head    ', count(m.head))
print(cfg.backbone_config.out_indices, cfg.neck_hidden_sizes, cfg.fusion_hidden_size, cfg.reassemble_factors)
# [3, 6, 9, 12] [48, 96, 192, 384] 64 [4, 2, 1, 0.5]
` },
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. La nube de puntos que sale de este mapa es la entrada de <a href="#pointnet">PointNet</a>.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'depth-01', kind: 'concepto', q: 'Por qué la profundidad monocular es un problema mal planteado.', a: 'Escalar toda la escena por k da la misma imagen (proyección pinhole) y la escala aparente depende de la focal: la escala absoluta no es observable en una sola vista. La red usa priors (tamaños, perspectiva, oclusión).' },
      { id: 'depth-02', kind: 'concepto', q: 'Profundidad relativa: qué sabe y qué no.', a: 'Sabe el orden y la forma: qué está delante, bordes, superficies. No sabe la escala ni el desplazamiento de cada imagen (en disparidad), así que sirve tal cual para ordenar y segmentar el primer plano, y para metros hay que alinearla. La métrica da metros, a cambio de depender del dominio y de la cámara.' },
      { id: 'depth-03', kind: 'formula', q: 'Alineación de escala y desplazamiento (MiDaS).', a: R`(s, t) = argmin Σ(s·dᵢ + t − d*ᵢ)²: t = mean(d*) − s·mean(d), s = cov(d, d*)/var(d). Ecuaciones normales 2×2 por imagen.` },
      { id: 'depth-04', kind: 'formula', q: 'L_ssi de MiDaS.', a: R`\(\mathcal L_{ssi} = \frac{1}{2M}\sum_i \rho(s d_i + t - d^*_i)\); ρ = x² (ssimse) o la versión robusta: mediana y desviación absoluta media, MAE y recorte del 20 % de residuos más grandes (ssitrim).` },
      { id: 'depth-05', kind: 'trampa', q: '"Alinear en profundidad o en disparidad es lo mismo."', a: 'Un ajuste afín en disparidad es z = 1/(s·d + t) en profundidad: hacen falta dos números (s y t) y al menos dos medidas; el cielo es disparidad 0.' },
      { id: 'depth-06', kind: 'concepto', q: 'Las tres etapas de Reassemble en DPT.', a: 'Read (ignorar, sumar o proyectar el CLS), Concatenate (tokens a la rejilla H/p × W/p) y Resample (conv 1×1 + conv transpuesta o con stride a la escala).' },
      { id: 'depth-07', kind: 'conteo', q: 'Escalas de reassemble de Depth Anything V2 Small a 518.', a: 'Rejilla 37×37 → 148, 74, 37 y 19 (×4, ×2, ×1, ×½); strides de 3.5, 7, 14 y ≈ 27 píxeles (518/19; patch 14, no 16).' },
      { id: 'depth-08', kind: 'concepto', q: 'De qué capas salen los taps de DPT.', a: 'ViT-B / ViT-S: bloques 3, 6, 9, 12. ViT-L: 5, 12, 18, 24. Las tempranas van a alta resolución, las profundas a baja.' },
      { id: 'depth-09', kind: 'concepto', q: 'Qué hace un bloque de fusión de DPT.', a: 'Estilo RefineNet: unidad residual (dos convs 3×3) sobre la escala, suma con la salida del bloque anterior, otra unidad residual, upsample ×2 y proyección 1×1; de grueso a fino.' },
      { id: 'depth-10', kind: 'trampa', q: '"La cabeza DPT es despreciable en costo."', a: R`En parámetros sí (${met('headParamsShare')} en V2 Small); en MACs no (${met('headShare')} a 518) ni en memoria de activaciones: corre convs a 296² y 518².` },
      { id: 'depth-11', kind: 'concepto', q: 'Receta de Depth Anything V1.', a: 'Maestro con 1.5M etiquetadas; pseudo-etiquetas en 62M imágenes; estudiante desde cero con perturbaciones fuertes (color, blur, CutMix) y alineación de features con DINOv2 congelado (margen α = 0.85).' },
      { id: 'depth-12', kind: 'concepto', q: 'Receta de Depth Anything V2.', a: 'Maestro DINOv2-G solo con 595K imágenes sintéticas; pseudo-etiqueta 62M reales; estudiantes S/B/L/G solo con las pseudo-etiquetas (destilación al nivel de etiquetas).' },
      { id: 'depth-13', kind: 'trampa', q: '"Sumar pseudo-etiquetas siempre mejora al estudiante."', a: 'En V1, sin más no mejoró: maestro y estudiante cometen los mismos errores. Hizo falta perturbar fuerte las imágenes del estudiante.' },
      { id: 'depth-14', kind: 'formula', q: 'AbsRel y δ₁.', a: 'En profundidad z, no en disparidad: AbsRel = mean |z − z*|/z*; δ₁ = % de píxeles con máx(z/z*, z*/z) &lt; 1.25. Para modelos relativos, después de alinear s y t (y pasar a profundidad).' },
      { id: 'depth-15', kind: 'tradeoff', q: 'Tres caminos a profundidad métrica y dónde falla cada uno.', a: 'Cabeza métrica afinada en un dominio (V2 metric, ZoeDepth): fuera del dominio o con otra focal. Normalizar o estimar la cámara (Metric3D, Depth Pro): intrínsecos equivocados (los de la imagen sin redimensionar). Alinear con medidas externas (LiDAR, ToF, SLAM, el piso): con menos de dos medidas bien repartidas no separas s de t.' },
      { id: 'depth-16', kind: 'formula', q: 'Error de profundidad de un estéreo.', a: 'z = f·B/disparidad ⇒ δz = z²·δd/(f·B): crece con el cuadrado de la distancia.' },
      { id: 'depth-17', kind: 'trampa', q: '"Back-proyecto la profundidad y tengo una nube limpia."', a: 'Los bordes suavizados dan flying pixels entre objeto y fondo: filtra por gradiente de profundidad o con otro sensor; usa los intrínsecos del tamaño correcto.' },
      { id: 'depth-18', kind: 'concepto', q: 'Por qué el modelo relativo termina en ReLU y el métrico en sigmoide.', a: 'Relativo: disparidad ≥ 0 (cielo = 0). Métrico: profundidad acotada = sigmoide × max_depth (20 m interiores, 80 m exteriores en el código oficial).' },
      { id: 'depth-19', kind: 'tradeoff', q: 'Licencias de Depth Anything V2.', a: 'Small: Apache-2.0. Base, Large y Giant: CC-BY-NC-4.0 (no comercial). En un robot comercial, eso decide el modelo antes que la exactitud.' },
      { id: 'depth-20', kind: 'concepto', q: 'Fallas típicas de la profundidad monocular.', a: 'Vidrio y espejos, cielo, cambio de dominio (cámara, altura, fisheye), parpadeo entre frames (escala por frame), ilusiones (pósters, pantallas).' },
      { id: 'depth-21', kind: 'tradeoff', q: 'Monocular vs estéreo vs ToF vs LiDAR en un robot.', a: 'Monocular: densa y barata, sin escala garantizada. Estéreo: métrica, error ∝ z², falla sin textura. ToF: densa de cerca, falla al sol. LiDAR: métrico y preciso, ralo y caro; falla en vidrio.' },
      { id: 'depth-22', kind: 'concepto', q: 'Cómo Depth Pro obtiene metros sin intrínsecos.', a: 'Predice profundidad inversa canónica C; la métrica es D = f_px / (w·C), con w el ancho en píxeles: a igual imagen, una focal el doble de larga da el doble de distancia. Sin EXIF, una cabeza estima el campo de visión (y de ahí f_px) desde las features.' },
      { id: 'depth-23', kind: 'concepto', q: 'Cómo bajar la latencia de Depth Anything en un Jetson.', a: 'Resolución fija y menor (tokens ∝ lado²), TensorRT fp16, int8 calibrado con datos propios, destilar con pseudo-etiquetas, procesar solo la región útil.' },
      { id: 'depth-24', kind: 'trampa', q: '"AbsRel 0.05 en el benchmark: mi robot tendrá 5 % de error."', a: 'Para un modelo relativo, esa AbsRel es tras alinear s y t con la verdad de cada imagen (oráculo). Online la escala sale de tus sensores: evalúa con tu alineación desplegable, por bandas de distancia y con estabilidad temporal.' },
      { id: 'depth-25', kind: 'formula', q: 'Metros desde el piso: cámara a altura h_c, eje óptico horizontal.', a: 'Un píxel del piso en la fila v está a Z = f_y·h_c/(v − c_y); 1/Z es lineal en v, así que los píxeles del piso alcanzan para ajustar s y t en disparidad. Con pitch, intersecar el rayo con el plano del piso.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'monocular depth estimation (MDE)', es: 'estimación de profundidad monocular', def: 'Predecir un mapa de profundidad denso a partir de una sola imagen RGB; mal planteado por la ambigüedad de escala.', say: 'Monocular depth gives relative structure, not guaranteed metric scale.' },
      { en: 'disparity / inverse depth', es: 'disparidad / profundidad inversa', def: 'Proporcional a 1/z; en estéreo, el desplazamiento horizontal entre las dos imágenes. Los modelos relativos predicen disparidad salvo escala y desplazamiento.', say: 'The model outputs affine-invariant inverse depth.' },
      { en: 'scale-and-shift-invariant loss', es: 'pérdida invariante a escala y desplazamiento', def: 'Pérdida que alinea la predicción a la verdad con una escala y un desplazamiento por imagen (mínimos cuadrados, o mediana y desviación absoluta media) antes de comparar.', say: 'We align scale and shift per image before computing the loss.' },
      { en: 'DPT (Dense Prediction Transformer)', es: 'DPT', def: 'Decoder que re-ensambla tokens de cuatro capas de un ViT en una pirámide de mapas y los funde con bloques tipo RefineNet.', say: 'The DPT head turns ViT tokens into a multi-scale feature pyramid.' },
      { en: 'reassemble', es: 're-ensamblado', def: 'Read + Concatenate + Resample: de una secuencia de tokens a un mapa 2-D a una escala dada.', say: 'Reassemble reshapes the patch tokens back into a grid and resamples them.' },
      { en: 'pseudo-labeling (self-training)', es: 'pseudo-etiquetado', def: 'Usar un modelo maestro para etiquetar datos sin etiqueta y entrenar un estudiante con ellas.', say: 'The teacher pseudo-labels sixty-two million unlabeled images.' },
      { en: 'feature alignment loss', es: 'pérdida de alineación de features', def: 'Penalizar 1 − coseno entre las features del modelo y las de un encoder congelado (DINOv2), con un margen de tolerancia.', say: 'A feature alignment loss keeps DINOv2 semantics in the encoder.' },
      { en: 'camera intrinsics', es: 'intrínsecos de la cámara', def: 'Focales f_x, f_y y punto principal c_x, c_y; convierten profundidad por píxel en puntos 3-D y fijan la escala aparente.', say: 'Metric depth needs the intrinsics or a model that estimates them.' },
      { en: 'AbsRel / δ₁', es: 'error relativo absoluto / umbral δ₁', def: 'Métricas estándar, en profundidad z: error |z − z*|/z* medio y % de píxeles con máx(z/z*, z*/z) &lt; 1.25.', say: 'We report AbsRel and delta one after scale and shift alignment.' },
      { en: 'flying pixels', es: 'píxeles voladores', def: 'Puntos falsos entre el primer plano y el fondo al back-proyectar bordes de profundidad suavizados.', say: 'We filter flying pixels with a depth-gradient threshold.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
