/* =============================================================================
   Atlas de Arquitecturas — js/content/pointnet.js
   Página de modelo: PointNet (Qi, Su, Mo y Guibas, CVPR 2017, arXiv:1612.00593) y PointNet++ (Qi, Yi, Su y Guibas,
   NeurIPS 2017, arXiv:1706.02413). Canónica pointnet-cls (ModelNet40, N = 1,024 puntos, T-Net de entrada 3×3, MLP compartido
   64-64, T-Net de features 64×64, MLP compartido 64-128-1024, max-pool, FC 512-256-40). Plantilla fija de 11 secciones
   (SPEC §5.3, §26.3).
   Regla: ningún número de la arquitectura se escribe a mano. Formas, parámetros, MACs y costos ≈ salen del calculador
   (js/arch/perception.js, modelo pointnet; bloques op/trace/params/flops/scaling/compare y cantidades {{config.ruta}}).
   Arquitectura verificada contra el código oficial (charlesq34/pointnet: models/pointnet_cls.py, transform_nets.py,
   pointnet_seg.py, utils/tf_util.py, train.py; charlesq34/pointnet2: models/pointnet2_cls_ssg.py, pointnet2_cls_msg.py).
   Los ejercicios se verificaron con una PointNet en PyTorch construida de esa arquitectura (scratchpad build14/geom/
   pointnet_ref.py: 3,480,049 parámetros; 819,624 sin T-Nets). Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/perception.js, SPEC §26.3; arch-ids.md).
  const C = 'pointnet-cls';             // canónica: clasificación ModelNet40, N = 1,024, con T-Nets
  const SEG = 'pointnet-seg';           // segmentación de partes (Fig. 2): concat 64 + 1024 → 50 partes, N = 2,048
  const NT = 'pointnet-cls-no-tnet';    // "vanilla": sin T-Nets
  const P2 = 'pointnet2-ssg-cls';       // PointNet++ SSG: 3 niveles de set abstraction

  // Tensores (arch-ids.md §3).
  const TN = {
    pts: 'points', tin: 't-in', ptsT: 'points-t', h1: 'h1', h2: 'h2', tfeat: 't-feat', h2t: 'h2-t',
    h3: 'h3', h4: 'h4', h5: 'h5', g: 'global', f1: 'f1', f2: 'f2', logits: 'logits',
    itnG: 'itn-g', concat: 'concat', plog: 'point-logits',
  };
  // Nodos del diagrama pointnet-overview.
  const ND = { itn: 'input-tnet', mlp1: 'shared-mlp-1', ftn: 'feature-tnet', mlp2: 'shared-mlp-2', pool: 'maxpool', head: 'head', seg: 'seg-head' };
  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const sh = (id, cfg) => qn('tensor.' + (TN[id] || id) + '.shape', cfg);
  const met = (k, cfg) => qn('metrics.' + k, cfg);
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const np = (id, cfg) => qn('node.' + (ND[id] || id) + '.params', cfg);
  const npp = (id, cfg) => qn('node.' + (ND[id] || id) + '.paramsPct', cfg);
  const nmm = (id, cfg) => qn('node.' + (ND[id] || id) + '.macsM', cfg);
  const npc = (id, cfg) => qn('node.' + (ND[id] || id) + '.macsPct', cfg);

  const PN = 'Qi, Su, Mo y Guibas, <i>PointNet: Deep Learning on Point Sets for 3D Classification and Segmentation</i>, CVPR 2017, arXiv:1612.00593';
  const PN2 = 'Qi, Yi, Su y Guibas, <i>PointNet++: Deep Hierarchical Feature Learning on Point Sets in a Metric Space</i>, NeurIPS 2017, arXiv:1706.02413';
  const DGCNN = 'Wang et al., <i>Dynamic Graph CNN for Learning on Point Clouds</i> (DGCNN), ACM TOG 38(5), 2019, arXiv:1801.07829';
  const PT = 'Zhao, Jiang, Jia, Torr y Koltun, <i>Point Transformer</i>, ICCV 2021, arXiv:2012.09164';
  const PP = 'Lang et al., <i>PointPillars: Fast Encoders for Object Detection from Point Clouds</i>, CVPR 2019, arXiv:1812.05784';
  const VOXNET = 'Zhou y Tuzel, <i>VoxelNet: End-to-End Learning for Point Cloud Based 3D Object Detection</i>, CVPR 2018, arXiv:1711.06396';
  const CPOINT = 'Yin, Zhou y Krähenbühl, <i>Center-based 3D Object Detection and Tracking</i> (CenterPoint), CVPR 2021, arXiv:2006.11275';
  const FPN3D = 'Qi et al., <i>Frustum PointNets for 3D Object Detection from RGB-D Data</i>, CVPR 2018, arXiv:1711.08488';
  const KPC = 'Thomas et al., <i>KPConv: Flexible and Deformable Convolution for Point Clouds</i>, ICCV 2019, arXiv:1904.08889';
  const GN6 = 'Mousavian, Eppner y Fox, <i>6-DOF GraspNet: Variational Grasp Generation for Object Manipulation</i>, ICCV 2019, arXiv:1905.10520';
  const CGN = 'Sundermeyer et al., <i>Contact-GraspNet: Efficient 6-DoF Grasp Generation in Cluttered Scenes</i>, ICRA 2021, arXiv:2103.14127';
  const DFUS = 'Wang et al., <i>DenseFusion: 6D Object Pose Estimation by Iterative Dense Fusion</i>, CVPR 2019, arXiv:1901.04780';
  const STN = 'Jaderberg et al., <i>Spatial Transformer Networks</i>, NIPS 2015, arXiv:1506.02025';
  const DEEPSETS = 'Zaheer et al., <i>Deep Sets</i>, NIPS 2017, arXiv:1703.06114';

  ATLAS.register({
    id: 'pointnet',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> PointNet recibe una <b>nube de puntos</b>, un conjunto de N = ${cf('N')} puntos (x, y, z) sin orden ni rejilla (${sh('pts')}), y devuelve ${sh('logits')} puntajes de clase para el objeto entero, o, en su versión de segmentación, una etiqueta por punto. Lo hace con una idea mínima: la <b>misma</b> red chica se aplica a cada punto por separado y un <b>max-pool</b> sobre los puntos resume todo en un vector de ${met('globalDim')} números que no depende del orden (${PN}).` },
          { t: 'p', html: R`Para un robot, la nube de puntos es el formato nativo de un LiDAR y de una cámara de profundidad back-proyectada (ver <a href="#depth">profundidad monocular</a>). PointNet fue el primer modelo que consumió los puntos crudos, sin voxelizar ni renderizar vistas, y su bloque (MLP compartido + max-pool) es hoy una pieza dentro de casi todo: PointNet++, las capas de pilares de PointPillars, las redes de agarre 6-DoF. Esa pieza es lo que se pregunta.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿PointNet?', 'Por qué'], rows: [
            ['Clasificar un objeto ya segmentado (un cluster de un LiDAR, un objeto sobre la mesa)', '<b>Sí</b>', R`Un cluster de cientos o miles de puntos, normalizado: es justo ModelNet40. Costo lineal en N y ${qn('params.totalM')} parámetros.`],
            ['Segmentación de partes o features por punto para agarrar', 'Sí, o PointNet++', 'La rama de segmentación concatena la feature de cada punto con la global; PointNet++ agrega estructura local y suele ser mejor en detalles finos.'],
            ['Escena grande de LiDAR (100k+ puntos, 100 m)', 'No como red entera', R`Sin estructura local y con densidad muy variable. Se usa como <b>codificador local</b> dentro de algo más grande: pilares (PointPillars), voxels (VoxelNet), o PointNet++ / redes de convolución dispersa.`],
            ['Ya tienes una imagen de profundidad alineada con el RGB', 'Quizá no', 'Una CNN 2-D sobre la imagen de profundidad (o RGB-D) aprovecha la rejilla y las convs optimizadas; pasa a puntos cuando necesitas geometría 3-D explícita (pose 6-DoF, agarre).'],
            ['Invarianza a rotaciones arbitrarias (SO(3))', 'No de fábrica', 'El T-Net no garantiza invarianza; ModelNet se entrena rotando solo alrededor del eje vertical. Si los objetos llegan en cualquier orientación, aumenta con rotaciones completas o usa una arquitectura equivariante.'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"A point cloud is an unordered set, so the network must be permutation invariant. PointNet applies the same small MLP to every point independently, which in code is a one-by-one convolution, and then aggregates with a channel-wise max pool, which is a symmetric function. The paper shows that any continuous set function can be approximated this way, and that the max-pooled feature is determined by at most K critical points. T-Nets predict an alignment matrix for the input and for the features. Its weakness is that it has no local structure, which PointNet++ fixes with hierarchical sampling and grouping."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como la cola de una ResNet, pero sin imagen.</b> Recuerda el final de ResNet-50: convs 1×1 que mezclan canales en cada posición por separado, y un global average pooling que resume las 7×7 posiciones en un vector. PointNet es <b>solo eso</b>: convs 1×1 (aquí, una por punto) y un pooling global (aquí, máximo en vez de promedio). Lo que falta es todo lo del medio: no hay convs 3×3, no hay vecindad, no hay stride. Cada punto se procesa solo hasta el max-pool.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de PointNet', head: ['Concepto', 'En ResNet / el Atlas', 'En PointNet', '¿Nuevo?'], rows: [
            ['Mezclar canales en cada posición', 'Conv 1×1 del bottleneck', R`<b>MLP compartido</b>: la misma lineal (+ BN + ReLU) para cada punto = <code>Conv1d(k=1)</code> sobre N×C`, 'Igual'],
            ['Resumen global', 'Global average pooling antes del FC', R`<b>Max-pool</b> por canal sobre los N puntos → ${met('globalDim')} números`, 'Equivale'],
            ['Cabeza de clasificación', 'FC 2048 → 1000', 'FC 1024 → 512 → 256 → 40 con BN y dropout', 'Igual'],
            ['Alinear la entrada', R`Spatial transformer (${STN}); en el Atlas, el canonical frame de la pose`, R`<b>T-Net</b>: una mini-PointNet que predice una matriz 3×3 (y otra 64×64 para features) y se la aplica a los puntos`, 'Equivale'],
            ['La entrada es un conjunto', 'La imagen tiene orden (fila, columna); los tokens de un ViT llevan posición', 'Los puntos no tienen orden: N! permutaciones son la misma nube. La red debe ser <b>invariante a permutaciones</b>', '<b>Nuevo</b>'],
            ['Campo receptivo', 'Crece con cada conv 3×3', 'Un punto hasta el max-pool, todo el objeto después: no hay nada intermedio (PointNet++ lo agrega)', '<b>Nuevo</b>'],
          ] },
          { t: 'h3', text: 'Qué tiene de raro una nube de puntos' },
          { t: 'list', items: [
            R`<b>Sin orden</b>: el archivo puede listar los mismos 1,024 puntos en cualquiera de 1024! órdenes. Un MLP sobre el vector concatenado de 3,072 números daría una salida distinta para cada orden.`,
            R`<b>Irregular</b>: no hay rejilla. Los vecinos de un punto hay que <i>buscarlos</i> (kNN, radio), no indexarlos como en una imagen.`,
            R`<b>Densidad variable</b>: un LiDAR pone muchos puntos cerca y pocos lejos (la densidad cae con la distancia al cuadrado); una cámara RGB-D, muchos en lo que mira de frente y pocos en superficies oblicuas.`,
            R`<b>Transformaciones rígidas</b>: la misma silla rotada o trasladada debe tener la misma clase; las coordenadas cambian todas.`,
          ] },
          { t: 'h3', text: 'Invarianza a permutaciones: la función simétrica' },
          { t: 'p', html: R`Primero un ejemplo en 2-D. Tres puntos: a = (0, 1), b = (2, 0), c = (1, 3). Una función por punto h(x, y) = (x, y, x + y) da h(a) = (0, 1, 1), h(b) = (2, 0, 2), h(c) = (1, 3, 4). El máximo por canal es (2, 3, 4), en el orden a, b, c y en cualquier otro: el máximo no sabe en qué orden llegaron. Fíjate en quién "ganó" cada canal: b (canal 1), c (canales 2 y 3). Si borras a, el resultado no cambia: a no es un <b>punto crítico</b>. Eso es PointNet, con h aprendida y 1,024 canales.` },
          { t: 'math', display: true, tex: R`f(\{x_1,\dots,x_n\}) \approx g\big(h(x_1),\dots,h(x_n)\big),\qquad g = \gamma \circ \mathrm{MAX},\qquad \mathrm{MAX}(v_1,\dots,v_n)_k = \max_i\, v_{i,k}`, caption: 'Ecuación 1 y Teorema 1 de PointNet: h es el MLP compartido (ℝ³ → ℝᴷ), MAX es el máximo por canal (una función simétrica: no cambia si permutas sus argumentos) y γ es el MLP de la cabeza. Teorema 1 (informal): cualquier función continua de conjuntos (continua respecto de la distancia de Hausdorff) se aproxima tanto como quieras con esta forma si K es suficientemente grande.' },
          { t: 'p', html: R`La intuición de la demostración (apéndice del paper): en el peor caso, h puede aprender a "voxelizar": cada canal mira una celda del espacio y se activa si hay un punto ahí; el máximo por canal dice qué celdas están ocupadas, y γ trabaja sobre esa ocupación. En la práctica la red aprende algo mucho más compacto. El paper descarta las alternativas: <b>ordenar</b> los puntos no da un orden estable en alta dimensión (pequeñas perturbaciones cambian el orden), y un <b>RNN</b> entrenado con permutaciones aleatorias como aumento no es invariante de verdad y escala mal a miles de puntos. Entre max-pool, promedio y una suma ponderada con atención, el max-pool ganó por amplio margen (Fig. 5 y §5.2).` },
          { t: 'callout', kind: 'trap', title: '"Con suma o promedio también es invariante, da lo mismo"', html: R`<p>También son simétricas (Deep Sets usa la suma: ${DEEPSETS}), así que la invarianza no es lo que cambia. Cambian otras dos cosas: la exactitud (en el paper, el máximo ganó a promedio y atención) y la <b>robustez</b>: con el máximo, la salida depende solo de a lo sumo K puntos críticos; borrar los demás o agregar puntos que no superen el máximo en ningún canal no la cambia. Con el promedio, cada punto, incluido un outlier, mueve la salida.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Los puntos pueden venir de un LiDAR o de un mapa de <a href="#depth">profundidad</a> back-proyectado con los intrínsecos. Y la misma idea "conjunto sin orden + pooling" aparece en los tokens sin posición de un Transformer: la self-attention sin codificación posicional es equivariante a permutaciones (repaso en <a href="#repaso-atencion">atención</a>).</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`De izquierda a derecha: ${sh('pts')} puntos → T-Net de entrada (una matriz 3×3 que alinea la nube) → MLP compartido 64-64 → T-Net de features (64×64) → MLP compartido 64-128-1024 → <b>max-pool</b> sobre los N puntos → vector global de ${met('globalDim')} → FC 512-256-${cf('K')} → puntajes. La <a href="#pointnet.diagrama~seg-concat">rama de segmentación</a>, en la configuración de segmentación, concatena a cada punto su feature de 64 con el vector global (64 + 1024 = 1088) y vuelve a aplicar un MLP compartido hasta una etiqueta por punto.` },
          { t: 'archdiagram', diagram: 'pointnet-overview', walk: 'forward', wide: true, caption: R`PointNet de clasificación (ModelNet40, N = ${cf('N')}). Formas, parámetros y MACs del calculador; los T-Nets se expanden.` },
          { t: 'p', html: R`<b>El T-Net por dentro</b>: es una PointNet en miniatura. MLP compartido 64-128-1024, max-pool, FC 512-256 y una última lineal a K² números que se reacomodan como matriz K×K. La última lineal arranca con pesos en cero y el sesgo igual a la identidad: al principio el T-Net no hace nada y aprende a desviarse de la identidad (<a href="#pointnet.diagrama~tnet.tn-A">el bloque A = W f + b + I</a>).` },
          { t: 'archdiagram', diagram: 'tnet', caption: 'Un T-Net (el de entrada, K = 3; el de features es igual con K = 64 y entrada de 64 canales).' },
          { t: 'p', html: R`<b>El max-pool y los puntos críticos.</b> Desordena los puntos: la salida no cambia. Borra puntos que no ganan en ningún canal: tampoco. Borra un punto crítico: cambia.` },
          { t: 'viz', kind: 'pointnet-maxpool', params: { config: C, pool: 'max', shape: 'silla' }, caption: 'Juguete 2-D sintético (rotulado): 24 puntos → la misma MLP chica y sin entrenar para cada punto (8 canales) → max-pool por canal. Los puntos resaltados son los críticos. Cambia a promedio: sigue siendo invariante al orden, pero ahora borrar cualquier punto cambia el resultado.' },
          { t: 'archdiagram', diagram: 'maxpool', caption: 'Max-pool por canal: invarianza a permutaciones y conjunto crítico (a lo sumo tantos puntos como canales).' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero con números. Una silla de ModelNet40: 1,024 puntos muestreados uniformemente sobre la superficie del CAD (según el área de cada cara) y normalizados a la esfera unidad, o sea una matriz de 1,024 × 3. El T-Net de entrada mira los 1,024 puntos y devuelve una matriz 3×3; los puntos se multiplican por ella (1,024 × 3 · 3 × 3). Cada punto pasa por la misma lineal 3 → 64 y 64 → 64: 1,024 × 64. El T-Net de features da una 64×64 y se aplica igual. Después 64 → 64 → 128 → 1024 por punto: 1,024 × 1,024. El max-pool toma, para cada uno de los 1,024 canales, el máximo sobre los 1,024 puntos: un vector de 1,024. Tres FC llevan a 40 puntajes.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Canónica'], rows: [
            ['N', 'puntos de la nube', cf('N')],
            ['C', 'canales por punto en una capa (3 a la entrada; 64, 128, 1024 después)', '—'],
            ['K', 'clases (ModelNet40) · en el max-pool, el "bottleneck" de canales', R`${cf('K')} · ${met('globalDim')}`],
            ['A', 'matriz del T-Net (3×3 de entrada, 64×64 de features)', '—'],
            ['h, γ', 'MLP por punto y MLP de la cabeza (Teorema 1)', '—'],
            ['C<sub>S</sub>', 'conjunto crítico: puntos que ganan al menos un canal del max-pool', R`≤ ${met('criticalPointsMax')}`],
          ] },

          { t: 'h3', text: '1. T-Net de entrada: alinear la nube' },
          { t: 'op', block: ND.itn, model: 'pointnet', title: 'Predecir A ∈ ℝ³ˣ³ y aplicarla',
            tex: R`A = \mathrm{T}_3(P) = \mathrm{reshape}_{3\times3}\big(W\,\phi(P) + b\big),\quad b = \mathrm{vec}(I_3),\ W = 0\ \text{al inicio};\qquad P' = P\,A\ \in \mathbb{R}^{N\times 3}`,
            in: [TN.pts], out: [TN.ptsT],
            what: R`φ es una mini-PointNet (MLP compartido 64-128-1024, max-pool, FC 512-256). La última lineal da 9 números que se reacomodan en 3×3; ${sh('pts')} · 3×3 → ${sh('ptsT')}. En el código oficial, la primera capa es una conv de 1×3 sobre (x, y, z): equivale a una lineal 3 → 64 por punto.`,
            why: R`La clase no debería depender de cómo está orientada o escalada la nube. En vez de imponer la invarianza, la red aprende a llevar la entrada a una pose canónica (la idea de los spatial transformers). Es una matriz afín cualquiera, no una rotación: puede escalar y sesgar. Ayuda poco pero ayuda: +0.8 puntos en ModelNet40 (Tabla 5 de ${PN}).` },

          { t: 'h3', text: '2. MLP compartido = convolución 1×1' },
          { t: 'op', block: ND.mlp1, model: 'pointnet', title: 'La misma lineal para cada punto (64-64)',
            tex: R`h_i = \mathrm{ReLU}\big(\mathrm{BN}(W x_i + b)\big)\ \ \forall i \;\Longleftrightarrow\; H = \mathrm{ReLU}\big(\mathrm{BN}(X W^{\top} + \mathbf{1}b^{\top})\big),\quad X \in \mathbb{R}^{N\times C_{\text{in}}}`,
            in: [TN.ptsT], out: [TN.h2],
            what: R`Dos capas: 3 → 64 y 64 → 64 por punto, con BN y ReLU: ${sh('ptsT')} → ${sh('h2')}. Como los pesos se comparten, la capa es una matriz C<sub>in</sub> × C<sub>out</sub> multiplicada por N filas: en PyTorch, <code>nn.Conv1d(C_in, C_out, kernel_size=1)</code> sobre un tensor (B, C, N), o un <code>nn.Linear</code> sobre (B, N, C). Parámetros: C<sub>in</sub>·C<sub>out</sub> + C<sub>out</sub> (sesgo) + 2·C<sub>out</sub> (γ y β de BN). MACs: N·C<sub>in</sub>·C<sub>out</sub>.`,
            why: R`Compartir pesos es lo que hace a la capa <b>equivariante</b> a permutaciones: permutar las filas de X permuta las filas de H y nada más. Y hace que el costo sea lineal en N y que los parámetros no dependan de N: la misma red sirve para 512 o 4,096 puntos.` },
          { t: 'callout', kind: 'trap', title: '"Conv1d(k=1) y Linear no son lo mismo"', html: R`<p>Son la misma operación con el eje de canales en otro lugar: Conv1d espera (B, C, N), Linear opera sobre el último eje de (B, N, C). Mismos pesos (Conv1d los guarda como C<sub>out</sub>×C<sub>in</sub>×1), mismos MACs. Lo que sí cambia es BatchNorm: <code>BatchNorm1d</code> sobre (B, C, N) promedia sobre lote <b>y puntos</b>, que es lo que hace el original. Otro detalle: el código oficial (TF) suma un sesgo antes de BN, que es redundante con β; los conteos del Atlas lo incluyen porque el código lo tiene.</p>` },

          { t: 'h3', text: '3. T-Net de features y el regularizador de ortogonalidad' },
          { t: 'op', block: ND.ftn, model: 'pointnet', title: 'A ∈ ℝ⁶⁴ˣ⁶⁴ sobre las features',
            tex: R`A_{64} = \mathrm{T}_{64}(H),\qquad H' = H\,A_{64}\ \in \mathbb{R}^{N\times 64},\qquad \mathcal{L}_{\text{reg}} = \big\lVert I - A_{64}A_{64}^{\top}\big\rVert_F^2`,
            in: [TN.h2], out: [TN.h2t],
            what: R`Igual que el de entrada, pero con 64 canales de entrada y 64² = 4,096 salidas: ${sh('h2')} → ${sh('h2t')}. Su última lineal (256 → 4,096) es la capa más grande de la red (<a href="#pointnet.diagrama~feature-tnet">T-Net de features en el diagrama</a>). Al entrenar se suma 0.001·L<sub>reg</sub> a la entropía cruzada (apéndice C de ${PN}).`,
            why: R`Una matriz 64×64 libre es difícil de optimizar y puede colapsar (proyectar las features en un subespacio y perder información). El regularizador empuja a A hacia una matriz <b>ortogonal</b>, que no pierde información (preserva normas y ángulos). Sin regularizador el T-Net de features <b>empeora</b> el resultado (86.9 contra 87.1 sin transformaciones); con él, 87.4; con los dos T-Nets y el regularizador, 89.2 (Tabla 5).` },
          { t: 'callout', kind: 'trap', title: 'El ½ escondido en el código oficial', html: R`<p>El paper escribe L<sub>reg</sub> = ‖I − AAᵀ‖²<sub>F</sub> con peso 0.001. El código TF calcula <code>tf.nn.l2_loss(mat_diff)</code>, que es <b>la mitad</b> de la suma de cuadrados, y lo multiplica por 0.001: el peso efectivo es 0.0005. Varias reimplementaciones en PyTorch usan la norma de Frobenius sin elevar al cuadrado y la promedian en el lote: son tres regularizadores distintos con el mismo nombre. Si reproduces números, lee el código.</p>` },

          { t: 'h3', text: '4. MLP 64-128-1024 y max-pool' },
          { t: 'op', block: ND.mlp2, model: 'pointnet', title: 'Subir a 1,024 canales por punto',
            tex: R`H^{(3)} = \mathrm{MLP}_{64\to64\to128\to1024}(H') \in \mathbb{R}^{N\times 1024}`,
            in: [TN.h2t], out: [TN.h5],
            what: R`Tres capas compartidas: 64 → 64 → 128 → 1024. La última es la que manda en el cómputo: N·128·1024 MACs, ${nmm('mlp2')} para el bloque entero (${npc('mlp2')} de los MACs de la red).`,
            why: R`El ancho K del max-pool es el "bottleneck" del Teorema 2: cuántas preguntas distintas puede hacerle la red al conjunto. Con K chico la red no distingue formas: pasar de 64 a 1,024 canales da 2–4 puntos de exactitud en ModelNet40, y la exactitud crece con los puntos de entrada hasta saturarse cerca de 1K (apéndice F y Fig. 15).` },
          { t: 'op', block: ND.pool, model: 'pointnet', title: 'Max-pool por canal sobre los N puntos',
            tex: R`g_k = \max_{i=1..N} H^{(3)}_{i,k},\qquad k = 1..1024`,
            in: [TN.h5], out: [TN.g],
            what: R`${sh('h5')} → ${sh('g')}: (N − 1)·1024 = ${met('maxpoolOpsGlobal')} comparaciones, cero parámetros, cero MACs (con los max-pools de los dos T-Nets, ${met('maxpoolOps')}). Es la única operación de la red que mezcla información entre puntos (<a href="#pointnet.diagrama~maxpool">en el diagrama</a>; los críticos, en <a href="#pointnet.diagrama~maxpool.mp-crit">la vista del max-pool</a>).`,
            why: R`Es la función simétrica: el vector global no depende del orden. Y define el conjunto crítico: para cada canal, el punto que da el máximo. A lo sumo ${met('criticalPointsMax')} puntos distintos (uno por canal, con repeticiones) determinan g.` },
          { t: 'math', display: true, tex: R`\textbf{Teorema 2 (informal).}\ \ \forall S\ \exists\, C_S \subseteq S \subseteq N_S:\quad C_S \subseteq T \subseteq N_S \Rightarrow f(T) = f(S),\qquad |C_S| \le K`, caption: 'C_S, el conjunto crítico, son los puntos que ganan algún canal; N_S, la "forma cota superior", es el conjunto más grande de puntos cuyas features no superan a g en ningún canal. Cualquier nube entre los dos da exactamente la misma feature global. Por eso borrar puntos no críticos o agregar ruido que no supere el máximo no cambia nada (Fig. 7: los puntos críticos dibujan el "esqueleto" del objeto).' },
          { t: 'callout', kind: 'trap', title: '"El conjunto crítico tiene exactamente K = 1024 puntos"', html: R`<p>Tiene <b>a lo sumo</b> K: un mismo punto puede ganar muchos canales. En la PointNet sin entrenar (y sin T-Nets) del ejercicio de abajo, con N = 1,024, salen 127 puntos críticos en la primera nube: el resto puede borrarse sin cambiar los logits. Y con T-Nets hay una sutileza: cada T-Net tiene su propio max-pool, así que la salida depende también de <i>sus</i> puntos críticos.</p>` },

          { t: 'h3', text: '5. Cabeza de clasificación y rama de segmentación' },
          { t: 'op', block: ND.head, model: 'pointnet', title: 'FC 1024 → 512 → 256 → K',
            tex: R`\hat y = W_3\,\mathrm{Drop}\big(\mathrm{ReLU}(\mathrm{BN}(W_2\,\mathrm{Drop}(\mathrm{ReLU}(\mathrm{BN}(W_1 g))))))\big) + b_3`,
            in: [TN.g], out: [TN.logits],
            what: R`Tres FC: 1024 → 512 → 256 → ${cf('K')}, BN y ReLU en las dos primeras, dropout con keep 0.7 después de cada una en el código oficial (el paper lo menciona en la de 256). ${sh('g')} → ${sh('logits')}.`,
            why: R`Es γ del Teorema 1: la parte que "lee" el resumen del conjunto. Su costo no depende de N: ${met('globalMacs')} fijos (con los FC de los T-Nets), contra ${met('perPointMacs')} del resto, que escala con N.` },
          { t: 'op', block: ND.seg, model: 'pointnet', config: SEG, title: 'Segmentación: concatenar local + global',
            tex: R`z_i = \big[\,h'_i \,\Vert\, g\,\big] \in \mathbb{R}^{64 + 1024},\qquad \hat y_i = \mathrm{MLP}_{1088\to512\to256\to128\to128\to m}(z_i)`,
            in: [TN.h2t, TN.g], out: [TN.plog],
            what: R`A cada punto se le pega el vector global (repetido N veces): ${sh('concat', SEG)}. Un MLP compartido 512-256-128-128 y una última capa a m clases por punto (50 partes en ShapeNet part; 13 clases en el S3DIS de escenas, con otras features de entrada): ${sh('plog', SEG)}.`,
            why: R`La feature de un punto solo sabe de ese punto; la global solo sabe del objeto. Concatenadas, cada punto sabe "soy una pata y estoy en una silla". Es la versión mínima de un skip connection de U-Net: lo local y lo global en el mismo vector.` },
          { t: 'p', html: R`El recorrido completo con los números del calculador (clasificación):` },
          { t: 'trace', model: 'pointnet' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`PointNet de clasificación: ${qn('params.total')} parámetros (${qn('params.totalM')}; el paper reporta 3.5M en la Tabla 6). La sorpresa: <b>los T-Nets son la mayor parte</b>, ${met('tnetParams')} (${met('tnetParamsShare')}), y solo la última lineal del T-Net de features (256 × 4,096 + 4,096) pesa más que todo el MLP compartido. Sin T-Nets quedan ${qn('params.total', NT)}. En cómputo: ${qn('macs.totalM')} MACs por nube de ${cf('N')} puntos: ${met('perPointMacs')} en las partes que escalan con N (${met('macsPerPoint')} MACs por punto) y ${met('globalMacs')} en los FC, que no dependen de N.` },
          { t: 'params', model: 'pointnet', group: 'block' },
          { t: 'flops', model: 'pointnet' },
          { t: 'callout', kind: 'note', html: R`<p><b>Contra la Tabla 6 del paper.</b> El paper reporta 440M "FLOPs/sample" para PointNet y 148M para la vanilla (sin T-Nets). Esos números coinciden en orden con los <b>MACs</b> del calculador (${qn('macs.totalM')} y ${qn('macs.totalM', NT)}), no con el doble: como en tantas tablas, "FLOPs" ahí cuenta una multiplicación-suma como una operación. La convención del Atlas: FLOPs = 2 × MACs.</p>` },
          { t: 'h3', text: 'Escala con N: lineal' },
          { t: 'scaling', model: 'pointnet', knobs: [{ key: 'N', values: [256, 512, 1024, 2048, 4096, 16384] }], show: ['params', 'macs', 'maxpoolOps', 'criticalPointsMax', 'msOrin'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 puntos → ×2 MACs del MLP compartido y ×2 comparaciones del max-pool (lineal en N, a diferencia de la atención, que es N²); los FC de la cabeza y de los T-Nets no cambian; los parámetros no cambian (no dependen de N). El conjunto crítico sigue acotado por ${met('globalDim')}: con 16,384 puntos, a lo sumo ${met('criticalPointsMax')} deciden la salida. El paper reporta más de un millón de puntos por segundo en una GTX 1080 con TensorFlow (≈ 1K objetos/s en clasificación, §5.4).` },
          { t: 'h3', text: 'PointNet, sin T-Nets, segmentación y PointNet++' },
          { t: 'compare', models: [C, NT, SEG, P2], rows: ['N', 'params', 'tnetParams', 'macs', 'perPointMacs', 'globalMacs', 'maxpoolOps', 'msOrin'], caption: R`Clasificación con y sin T-Nets (N = ${cf('N')}), segmentación de partes (N = ${cf('N', SEG)}) y PointNet++ SSG. Tiempos: cota roofline ≈ del calculador en un Jetson AGX Orin, sin el muestreo ni la búsqueda de vecinos.` },
          { t: 'p', html: R`<b>PointNet++ cuesta en otro lado.</b> Sus parámetros son pocos (${qn('params.totalM', P2)}), pero cada nivel de set abstraction corre una mini-PointNet sobre cada vecindario: S centros × k vecinos × canales. Además hay dos operaciones sin MACs que en GPU pesan: farthest point sampling (≈ ${met('fpsOps', P2)} operaciones de distancia, secuencial en S) y ball query (≈ ${met('ballQueryOps', P2)}). El paper mide (Tabla 7, batch 8, GTX 1080, TF 1.1): PointNet vanilla 11.6 ms, PointNet 25.3 ms, PointNet++ SSG 82.4 ms, MSG 163.2 ms, MRG 87.0 ms. Más exacto, y entre 3.3 y 6.5 veces más lento que PointNet en esa misma tabla.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota en "is PointNet cheap": "PointNet is linear in the number of points: every point goes through the same MLP, so the cost is N times the per-point MACs, dominated by the 128 to 1024 layer, plus one max over N for each of the 1024 channels. Parameters do not depend on N, and most of them are actually in the T-Nets, especially the 256 to 4096 layer of the feature transform. PointNet++ adds farthest point sampling and ball queries, which are not matrix multiplies and often dominate latency on GPU, so I would profile those before shrinking the MLPs."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Clasificación con entropía cruzada más el regularizador del T-Net de features; segmentación con entropía cruzada por punto. Lo que se pregunta: cómo se muestrean y normalizan los puntos, qué aumentos se usan y cómo se evalúa.` },
          { t: 'math', display: true, tex: R`\mathcal{L} = -\frac{1}{B}\sum_{b=1}^{B}\log p_\theta\big(y_b \mid P_b\big) + w\,\big\lVert I - A_{64}A_{64}^{\top}\big\rVert_F^2,\qquad w = 0.001`, caption: 'Pérdida de clasificación de PointNet (apéndice C). En el código oficial el segundo término lleva un ½ extra (tf.nn.l2_loss).' },
          { t: 'kv', items: [
            ['Datos', 'ModelNet40: 12,311 modelos CAD de 40 categorías; 9,843 de entrenamiento y 2,468 de prueba', '§5.1'],
            ['Muestreo', '1,024 puntos uniformes sobre las caras de la malla (según el área), normalizados a la esfera unidad; solo (x, y, z)', '§5.1'],
            ['Aumentos', 'Rotación aleatoria alrededor del eje vertical y jitter gaussiano por punto (σ = 0.02 en el paper; el código oficial usa σ = 0.01 recortado a 0.05)', '§5.1; provider.py'],
            ['Optimizador', 'Adam, LR 0.001, batch 32; LR ÷2 cada 20 épocas (paper); el código usa decaimiento ×0.7 cada 200,000 pasos y 250 épocas', 'Apéndice C; train.py'],
            ['BN y dropout', 'Decaimiento de BN de 0.5 a 0.99; dropout con keep 0.7 en la cabeza', 'Apéndice C'],
            ['Costo', '3–6 horas en una GTX 1080 con TensorFlow', 'Apéndice C'],
          ] },
          { t: 'h3', text: 'Resultados que se citan (con su tabla)' },
          { t: 'table', caption: 'PointNet y PointNet++ en los benchmarks del paper', head: ['Tarea', 'Resultado', 'Fuente'], rows: [
            ['ModelNet40, clasificación', '89.2 % de exactitud global, 86.2 % promedio por clase (una vista, N = 1,024)', 'Tabla 1 de PointNet'],
            ['Ablación de T-Nets (ModelNet40)', 'ninguno 87.1 · entrada 87.9 · features 86.9 · features + reg 87.4 · ambos 89.2', 'Tabla 5 de PointNet'],
            ['ShapeNet part (16,881 formas, 16 categorías)', '83.7 % mIoU', 'Tabla 2 de PointNet'],
            ['S3DIS (escenas, 13 clases, bloques de 1 m × 1 m)', '47.71 % mIoU, 78.62 % exactitud', 'Tabla 3 de PointNet'],
            ['Robustez (ModelNet40)', 'Con 50 % de los puntos borrados cae 2.4 puntos (muestreo farthest) y 3.8 (aleatorio); más de 80 % con 20 % de outliers', '§5.2 y Fig. 6'],
            ['ModelNet40, PointNet++', '90.7 % (solo puntos); 91.9 % con normales', 'Tabla 2 de PointNet++'],
          ] },
          { t: 'h3', text: 'PointNet++: aprender con densidad variable' },
          { t: 'p', html: R`El problema que ataca PointNet++ es doble: falta de estructura local y densidad no uniforme. Su respuesta de entrenamiento es el <b>random input dropout</b>: para cada nube se elige una tasa θ uniforme en [0, p] con p = 0.95 y se borra cada punto con probabilidad θ; así la red ve nubes densas, ralas y con huecos, y aprende a combinar escalas (MSG) según lo que encuentre. En test se usan todos los puntos (§3.3 de ${PN2}).` },
          { t: 'callout', kind: 'trap', title: '"ModelNet40 al 89 % significa que sirve para mi LiDAR"', html: R`<p>ModelNet40 son CADs limpios, completos, centrados y normalizados, con una sola orientación vertical. Un cluster real de LiDAR está incompleto (solo se ve un lado), es ralo y desigual, tiene ruido y viene sin normalizar. El paper simula escaneos parciales de ShapeNet part con un simulador de Kinect (6 vistas al azar) y pierde 5.3 puntos de mIoU entrenando con ellos; para tu robot, entrena o afina con escaneos de tu sensor (o simulados con su patrón) y evalúa por distancia.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Recortar y muestrear', html: R`<p>Un objeto (un cluster después de quitar el piso, o un recorte por una caja de un detector 2-D: Frustum PointNets, ${FPN3D}). Llevarlo a N fijo: farthest point sampling para cubrir bien la forma, o aleatorio (más barato); si hay menos puntos, repetir.</p>` },
            { title: 'Normalizar', html: R`<p>Restar el centroide y dividir por el radio máximo (esfera unidad), como en entrenamiento. Sin esto, un objeto a 10 m y otro a 1 m tienen coordenadas en rangos distintos y la red falla.</p>` },
            { title: 'Una pasada', html: R`<p>${qn('macs.totalM')} MACs para N = ${cf('N')}; varios objetos de una escena se procesan como un lote (B × N × 3).</p>` },
            { title: 'Salida', html: R`<p>Clase por objeto o etiqueta por punto; la pose se recupera deshaciendo la normalización.</p>` },
          ] },
          { t: 'h3', text: 'Qué domina latencia y memoria' },
          { t: 'p', html: R`Los MACs están casi todos en las capas por punto de 128 → 1024 (la del cuerpo y las de los dos T-Nets). La memoria de activaciones es N × 1024 por cada una de esas capas: con N = 1,024 y fp16, ≈ 2 MB por capa y por nube, nada para una GPU; con 100k puntos de una escena entera, ≈ 200 MB por capa, y ahí se nota. En PointNet++ el costo se mueve a FPS (secuencial: cada nuevo centro depende de los anteriores) y a las búsquedas de vecinos. Cota roofline del calculador en un Jetson AGX Orin: ${est(met('msOrin') + ' ms por nube')} (≈ ${met('fpsOrin')} nubes/s), sin el muestreo ni la normalización.` },
          { t: 'h3', text: 'Trucos que se usan en robots' },
          { t: 'list', items: [
            R`<b>Downsampling por voxels</b> antes de todo (una rejilla de 1–5 cm, un punto por celda): densidad más uniforme y menos puntos; casi gratis comparado con FPS.`,
            R`<b>Lotes de clusters</b>: una escena produce decenas de objetos; procesarlos juntos aprovecha la GPU.`,
            R`<b>FPS aproximado o aleatorio</b> cuando el tiempo manda; FPS en GPU si la cobertura importa (agarre).`,
            R`<b>fp16 / TensorRT</b>: son convs 1×1 y FC, fáciles de exportar; el max-pool sobre N también.`,
            R`<b>Quitar el T-Net de entrada</b> si la nube ya llega alineada (marco del robot con gravedad conocida): menos parámetros y casi la misma exactitud (Tabla 5: −0.8 puntos en ModelNet40, sin el de features).`,
          ] },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', items: [
            R`<b>Sin estructura local</b>: cada punto se procesa solo hasta el max-pool. Patrones finos (una manija, la textura de una superficie) y escenas grandes, donde lo importante es local, salen mal. Es la motivación explícita de PointNet++ (resumen de ${PN2}).`,
            R`<b>Densidad no uniforme</b>: entrenada con muestreo uniforme de CAD, se degrada con LiDAR (denso cerca, ralo lejos) y con oclusiones. Mitigación: voxel downsampling, random input dropout, MSG.`,
            R`<b>Rotaciones</b>: no es invariante a SO(3); el T-Net aprende una alineación aproximada y el entrenamiento solo rota en el eje vertical. Un objeto volcado puede cambiar de clase.`,
            R`<b>Normalización y recorte</b>: supone un objeto aislado y centrado; con el piso o un vecino dentro del recorte, el max-pool mezcla ambos.`,
            R`<b>Outliers que sí superan el máximo</b>: el Teorema 2 protege de puntos que no ganan ningún canal; un outlier lejano (un reflejo, un rayo de LiDAR que rebota) sí puede ganar canales y cambiar g. Filtra outliers estadísticos antes.`,
          ] },
          { t: 'table', caption: 'Cómo representar 3-D en un robot', head: ['Criterio', 'Puntos (PointNet / PointNet++)', 'Voxels (3-D CNN, convolución dispersa)', 'BEV / pilares (PointPillars)', 'Imagen de profundidad o range image (CNN 2-D)'], rows: [
            ['Pérdida de información', 'Ninguna (los puntos crudos)', 'Cuantización a la celda', 'Colapsa la altura en features por pilar', 'Una vista: lo ocluido no existe'],
            ['Costo', 'Lineal en N; PointNet++ paga FPS y vecinos', 'Cúbico en la resolución si es denso; disperso ≈ ∝ celdas ocupadas', 'Una CNN 2-D sobre la rejilla del piso: muy rápido', 'Una CNN 2-D: lo más optimizado del hardware'],
            ['Estructura local', 'No (PointNet) / sí (PointNet++)', 'Sí (kernels 3-D)', 'Sí en el plano; la vertical, dentro del pilar', 'Sí en la imagen; vecinos en píxeles no siempre lo son en 3-D'],
            ['Típico para', 'Objetos aislados, agarre, pose 6-DoF', 'Segmentación de escenas, detección 3-D', 'Detección 3-D en autos y AMRs en tiempo real', 'Segmentación rápida, fusión con RGB'],
          ] },
          { t: 'compare', models: [C, NT, P2], rows: ['params', 'macs', 'perPointMacs', 'maxpoolOps', 'msOrin'], caption: 'PointNet con y sin T-Nets y PointNet++ SSG a N = 1,024: el reparto entre parámetros y cómputo.' },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'h3', text: 'PointNet++ (lo que más se pregunta)' },
          { t: 'p', html: R`PointNet aplicada <b>de forma recursiva</b> sobre una partición anidada de la nube. Un nivel de <b>set abstraction</b> (SA) tiene tres capas (§3.2 de ${PN2}):` },
          { t: 'steps', items: [
            { title: 'Sampling (FPS)', html: R`<p>Elegir S centros con farthest point sampling: cada nuevo centro es el punto más lejano de los ya elegidos. Cubre la forma mejor que el muestreo aleatorio con el mismo número de centros. Cuesta O(N·S) distancias y es secuencial.</p>` },
            { title: 'Grouping (ball query)', html: R`<p>Para cada centro, los puntos dentro de un radio r (con un tope de k vecinos; si hay menos, se repite el primero). A diferencia de kNN, el radio fija una escala espacial: la feature significa lo mismo en zonas densas y ralas. Las coordenadas se pasan al marco local del centro (x − x̂).</p>` },
            { title: 'PointNet local', html: R`<p>Una mini-PointNet (MLP compartido + max-pool) por vecindario: S × k × (3 + C) → S × C′. Es el "kernel" de esta convolución sobre conjuntos.</p>` },
          ] },
          { t: 'p', html: R`La configuración SSG de clasificación (código oficial): SA1 con 512 centros, r = 0.2, 32 vecinos, MLP 64-64-128; SA2 con 128, r = 0.4, 64, MLP 128-128-256; SA3 agrupa todo con MLP 256-512-1024; FC 512-256-40 con dropout 0.5. Para densidad variable: <b>MSG</b> (multi-scale grouping: varios radios por nivel, features concatenadas; caro) y <b>MRG</b> (multi-resolution: concatena el resumen del nivel anterior con una PointNet sobre los puntos crudos de la región; más barato). Para segmentación, <b>feature propagation</b>: interpolar hacia los puntos originales con pesos de distancia inversa sobre los 3 vecinos más cercanos (p = 2, k = 3) y concatenar con skip links.` },
          { t: 'h3', text: 'Otros' },
          { t: 'list', items: [
            R`<b>DGCNN / EdgeConv</b> (${DGCNN}): por cada punto, un grafo kNN (k = 20) y features de arista h(x<sub>i</sub>, x<sub>j</sub> − x<sub>i</sub>) agregadas con máximo; el grafo se <b>recalcula en el espacio de features</b> en cada capa (dinámico). 92.9 % en ModelNet40 (Tabla 2).`,
            R`<b>Point Transformer</b> (${PT}): atención vectorial local sobre kNN con codificación de posición relativa; 93.7 % en ModelNet40 y 70.4 % mIoU en S3DIS Área 5.`,
            R`<b>KPConv</b> (${KPC}): convolución con "kernel points" ubicados en el espacio, rígidos o deformables.`,
            R`<b>VoxelNet</b> (${VOXNET}): voxeliza y codifica los puntos de cada voxel con capas tipo PointNet (VFE), luego convs 3-D.`,
            R`<b>PointPillars</b> (${PP}): columnas verticales (pilares) de 0.16 m; cada punto se aumenta a 9 dimensiones (x, y, z, reflectancia, distancia a la media del pilar y al centro del pilar), una PointNet simplificada (lineal + BN + ReLU + máximo) por pilar con a lo sumo P = 12,000 pilares y N = 100 puntos por pilar, se "esparce" como una pseudo-imagen y se procesa con una CNN 2-D y una cabeza SSD. 62 Hz en KITTI (105 Hz la versión rápida).`,
            R`<b>CenterPoint</b> (${CPOINT}): detección 3-D por centros en BEV sobre voxels o pilares, con seguimiento por velocidad predicha.`,
            R`<b>En manipulación</b>: Frustum PointNets (${FPN3D}) para detección 3-D desde RGB-D; 6-DOF GraspNet (${GN6}) y Contact-GraspNet (${CGN}) generan agarres 6-DoF sobre PointNet++; DenseFusion (${DFUS}) fusiona por píxel color y geometría (con una red tipo PointNet) para pose 6-D.`,
          ] },
          { t: 'h3', text: 'Referencias' },
          { t: 'list', items: [PN + '.', PN2 + '.', DGCNN + '.', PT + '.', KPC + '.', VOXNET + '.', PP + '.', CPOINT + '.', FPN3D + '.', GN6 + '.', CGN + '.', DFUS + '.', STN + '.', DEEPSETS + '.', 'Código oficial: charlesq34/pointnet (models/pointnet_cls.py, transform_nets.py, pointnet_seg.py, utils/tf_util.py, train.py) y charlesq34/pointnet2 (models/pointnet2_cls_ssg.py, pointnet2_cls_msg.py, utils/pointnet_util.py).'] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`PointNet aparece en entrevistas de percepción 3-D y robótica como mecánica (invarianza, max-pool, T-Net), como contraste (puntos vs voxels vs imágenes) y como diseño de sistema (el pipeline de LiDAR de un robot). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'How does PointNet achieve permutation invariance? Why max pooling and not sorting or an RNN?',
              junior: 'Usa max-pooling, que no depende del orden.',
              senior: R`Con una función simétrica sobre features por punto: f(S) ≈ γ(MAX<sub>i</sub> h(x<sub>i</sub>)). h es un MLP compartido (equivariante: permutar los puntos permuta las filas) y el máximo por canal es invariante, así que todo es invariante. El Teorema 1 dice que esa forma aproxima cualquier función continua de conjuntos con K suficiente. Ordenar no sirve en 3-D o en alta dimensión porque no hay un orden estable ante perturbaciones; un RNN con permutaciones como aumento no es invariante de verdad y escala mal. Entre las simétricas (suma, promedio, atención, máximo), el máximo ganó en el paper y además da robustez: la salida depende de a lo sumo K puntos críticos.`,
              say: 'It applies a shared MLP to every point, which is permutation equivariant, and aggregates with a channel-wise max, which is a symmetric function, so the whole network is invariant. The paper proves that this form can approximate any continuous set function given enough channels. Sorting is not stable in high dimensions and an RNN trained on permutations is only approximately invariant. Max also gives robustness, because the output depends only on at most K critical points.',
              why: 'Se anota equivariante + simétrica, el teorema, por qué no ordenar ni RNN, y la robustez del máximo.' },
            { q: 'What are T-Nets and why does the feature T-Net need a regularizer?',
              junior: 'Rotan la nube para alinearla.',
              senior: R`Son mini-PointNets que predicen una matriz (3×3 sobre los puntos, 64×64 sobre las features) inicializada en la identidad. No es una rotación: es afín libre. La de 64×64 tiene 4,096 grados de libertad por nube y es difícil de optimizar; sin restricción puede colapsar el espacio de features. El regularizador ‖I − AAᵀ‖²<sub>F</sub> (peso 0.001) la empuja a ser ortogonal, que preserva la información. En la ablación, el T-Net de features sin regularizador empeora (86.9 contra 87.1) y con él mejora. Y algo para anotar: los T-Nets son la mayoría de los parámetros de la red; si la nube ya llega en un marco con gravedad conocida, el de entrada aporta poco.`,
              say: 'T-Nets are mini PointNets that regress an alignment matrix, three by three for the coordinates and sixty-four by sixty-four for the features, initialized to the identity. It is a general affine matrix, not a rotation. The feature one is hard to optimize, so a penalty on the distance between A A transpose and the identity pushes it towards an orthogonal matrix that does not lose information; without it the feature transform actually hurts. They also hold most of the parameters.',
              why: 'Se anota identidad al inicio, afín (no rotación), la ortogonalidad, la ablación y el costo en parámetros.' },
            { q: 'Design the LiDAR perception pipeline for a mobile robot (warehouse AMR or outdoor delivery robot). Where would PointNet-style models fit?',
              junior: 'Paso toda la nube por PointNet y clasifico los objetos.',
              senior: R`Por etapas, con presupuesto de latencia (≈ 10 Hz del LiDAR). (1) <b>Preprocesado</b>: compensar el movimiento del barrido (deskew con la odometría), recortar por región de interés, voxel downsampling. (2) <b>Piso</b>: ajuste de plano con RANSAC o segmentación por celdas; lo que no es piso es obstáculo potencial. (3) <b>Detección</b>: si necesito clases y cajas 3-D, un detector BEV en tiempo real (PointPillars o CenterPoint sobre pilares/voxels, cuyo codificador por pilar <i>es</i> una PointNet simplificada) en TensorRT; si solo necesito obstáculos, clustering euclidiano y una PointNet chica para clasificar cada cluster (persona, carro, pallet). (4) <b>Seguimiento</b>: Kalman + asociación por distancia o IoU en BEV (<a href="#bytetrack">tracking</a>). (5) <b>Capa de seguridad</b> independiente del modelo: cualquier punto en el volumen de frenado detiene el robot, aunque la red no lo clasifique. Evaluar por distancia y por clase, con escenas de mi sensor, no ModelNet.`,
              say: 'I would deskew the sweep with odometry, crop and voxel-downsample, remove the ground with plane fitting, then either run a real-time BEV detector like PointPillars or CenterPoint in TensorRT, whose pillar encoder is a simplified PointNet, or cluster the non-ground points and classify each cluster with a small PointNet. Tracks come from a Kalman filter with BEV association. Independently of any network, a geometric safety layer stops the robot if any point enters the braking volume. I would evaluate by range and class on data from my own sensor.',
              why: 'Trampa: "toda la nube por PointNet". Se anota deskew, piso, BEV vs clusters, tracking, la capa de seguridad geométrica y evaluar por distancia.', trap: true },
            { q: 'Point cloud, depth image or voxels: which representation would you use for grasping objects from a bin?',
              junior: 'Nube de puntos, porque es 3-D.',
              senior: R`Depende de qué predice la red. Para <b>segmentar instancias</b> en el bin, una CNN sobre RGB-D (o la imagen de profundidad) es lo más rápido y maduro: la cámara ya da una rejilla alineada. Para <b>generar agarres 6-DoF</b> necesito geometría 3-D explícita y robusta al punto de vista: nube de puntos del objeto (o de la escena recortada) con una red tipo PointNet++ (Contact-GraspNet, 6-DOF GraspNet). Voxels (TSDF) si fusiono varias vistas o necesito colisiones con la escena. En la práctica: segmentación 2-D → recorte → nube → agarres en 3-D → verificación de colisión con un voxel map. Y cuidado con vidrio y metales brillantes: la cámara de profundidad deja huecos; ahí ayuda la monocular o el multi-vista.`,
              say: 'It depends on the output. For instance segmentation in the bin I would use a 2D network on RGB-D, which is fast and mature. For six-DoF grasp generation I need explicit 3D geometry, so a point cloud of the cropped object with a PointNet++-based model like Contact-GraspNet, and a voxel or TSDF map for collision checking. Shiny and transparent objects leave holes in the depth, so I would add multi-view or learned depth there.',
              why: 'Se anota que la representación depende de la tarea, el pipeline 2-D → 3-D y los huecos del sensor.' },
            { q: 'Your PointNet classifier works on the validation set but degrades when the sensor or the distance changes. Why, and what do you do?',
              junior: 'Más datos y más épocas.',
              senior: R`La densidad y la completitud cambian con la distancia y el sensor: un objeto a 15 m tiene un décimo de los puntos y solo un lado. PointNet sin estructura local depende de dónde caen los puntos. Mitigación: voxel downsampling a una densidad fija antes de muestrear N, aumentos con dropout aleatorio de puntos (el de PointNet++, p = 0.95) y oclusiones simuladas, entrenar con escaneos del sensor real (o simulados con su patrón de rayos), PointNet++ con MSG si la variación es grande, y evaluar <b>por bandas de distancia</b>. Si el cambio es de sensor, revisar también la normalización (intensidad, rango) y el marco de coordenadas.`,
              say: 'Density and completeness change with range and sensor, and PointNet has no local structure, so it depends on where points land. I would voxel-downsample to a fixed density, train with random point dropout and simulated occlusions, use scans from the real sensor or a simulator with its beam pattern, consider PointNet++ with multi-scale grouping, and report accuracy per range bin.',
              why: 'Se anota densidad vs distancia, random input dropout, datos del sensor, MSG y evaluación por distancia.' },
          ] },
          { t: 'qa', items: [
            { q: '¿Cuántos parámetros tiene la canónica y dónde están?', a: R`${qn('params.total')}: el T-Net de entrada ${np('itn')}, el de features ${np('ftn')}, los MLP compartidos ${np('mlp1')} + ${np('mlp2')} y la cabeza ${np('head')}. Los T-Nets son ${met('tnetParamsShare')} del total.` },
            { q: '¿Por qué factor cambian los MACs si pasas de 1,024 a 2,048 puntos? ¿Y los parámetros?', a: R`Casi ×2: todo lo que es por punto (${met('macsPerPoint')} MACs por punto, ${met('perPointMacs')} en total) escala con N; solo los ${met('globalMacs')} de los FC no cambian. Los parámetros no cambian. Compruébalo en el explorador de <a href="#pointnet.costo">costo</a>.` },
            { q: '¿Qué es un punto crítico y cuántos puede haber como máximo?', a: R`Un punto que da el máximo en al menos un canal del max-pool. Como hay ${met('globalDim')} canales, a lo sumo ${met('criticalPointsMax')} puntos distintos; borrar cualquier otro no cambia la feature global.` },
            { q: '¿Qué diferencia a ball query de kNN en PointNet++?', a: 'Ball query toma los puntos dentro de un radio fijo (hasta k): la escala espacial es la misma en zonas densas y ralas. kNN toma siempre k vecinos: en zonas ralas el vecindario se estira y la feature cambia de significado.' },
            { q: '¿Por qué PointPillars es rápido?', a: 'Reduce la nube a pilares en el plano del piso, codifica cada pilar con una PointNet simplificada y se queda con una pseudo-imagen 2-D: el resto son convs 2-D, lo más optimizado del hardware. 62 Hz en KITTI en su paper.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama en blanco; después las formas, los "¿qué pasa si…?" y tres ejercicios: la invarianza en PyTorch, los parámetros a mano y los puntos críticos.` },
          { t: 'h3', text: 'Diagrama en blanco' },
          { t: 'blankdiagram', diagram: 'pointnet-overview', slots: [
            { node: ND.itn, ask: 'label' },
            { node: ND.mlp2, tensor: TN.h5, ask: 'shape' },
            { node: ND.pool, ask: 'label' },
            { node: ND.pool, tensor: TN.g, ask: 'shape' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'pointnet', pool: 'all', configs: [C, SEG] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`Duplicas los puntos de ${cf('N')} a 2,048. ¿Por qué factor cambian los MACs?`, change: { N: 2048 }, ask: 'macs',
              explain: 'Casi ×2: todo lo que es por punto escala con N; los FC de la cabeza y de los T-Nets (pocos MACs) no cambian.' },
            { q: 'Mismo cambio, 2,048 puntos. ¿Y los parámetros?', change: { N: 2048 }, ask: 'params',
              explain: '×1: los pesos son por capa, compartidos entre puntos; no dependen de N.' },
            { q: 'Mismo cambio, 2,048 puntos. ¿Y el máximo de puntos críticos?', change: { N: 2048 }, ask: 'criticalPointsMax',
              explain: 'No cambia: sigue acotado por los 1,024 canales del max-pool (a lo sumo un punto distinto por canal).' },
            { q: 'Quitas los dos T-Nets (tnet = 0). ¿Por qué factor cambian los parámetros?', change: { tnet: 0 }, ask: 'params',
              explain: 'Bajan a menos de un cuarto: los T-Nets eran la mayoría de los parámetros (la última lineal del de features, 256 × 4,096, sola pesa más que todo el MLP compartido).' },
            { q: 'Mismo cambio, sin T-Nets. ¿Y los MACs?', change: { tnet: 0 }, ask: 'macs',
              explain: 'Bajan a ≈ un tercio: cada T-Net repite un MLP por punto que termina en 1,024 canales.' },
          ] },
          { t: 'h3', text: 'Ejercicio 1: comprueba la invarianza en PyTorch' },
          { t: 'p', html: R`Escribe una PointNet de clasificación (con T-Nets, como el código oficial) y verifica: (a) que permutar los puntos no cambia los logits; (b) cuántos puntos críticos hay (índices únicos del argmax por canal); (c) que quedarte solo con los críticos da los mismos logits en la versión sin T-Nets. Pon el modelo en <code>eval()</code> para que BatchNorm use sus estadísticas guardadas.` },
          { t: 'code', title: 'PointNet de clasificación y las tres comprobaciones (PyTorch)', files: [
            { name: 'pointnet_check.py', lang: 'python', code: R`import torch
import torch.nn as nn


def smlp(cin, cout):                      # MLP compartido = Conv1d k=1 (+ sesgo como el TF oficial) + BN + ReLU
    return nn.Sequential(nn.Conv1d(cin, cout, 1), nn.BatchNorm1d(cout), nn.ReLU())


def fc(cin, cout):
    return nn.Sequential(nn.Linear(cin, cout), nn.BatchNorm1d(cout), nn.ReLU())


class TNet(nn.Module):
    def __init__(self, k, cin):
        super().__init__()
        self.k = k
        self.mlp = nn.Sequential(smlp(cin, 64), smlp(64, 128), smlp(128, 1024))
        self.fc = nn.Sequential(fc(1024, 512), fc(512, 256))
        self.out = nn.Linear(256, k * k)
        nn.init.zeros_(self.out.weight)
        nn.init.zeros_(self.out.bias)

    def forward(self, x):                                  # x: (B, C, N)
        g = self.mlp(x).max(dim=2).values                  # (B, 1024)
        return self.out(self.fc(g)).view(-1, self.k, self.k) + torch.eye(self.k)   # identidad al inicio


class PointNetCls(nn.Module):
    def __init__(self, n_cls=40, tnet=True):
        super().__init__()
        self.tnet = tnet
        if tnet:
            self.t3, self.t64 = TNet(3, 3), TNet(64, 64)
        self.mlp1 = nn.Sequential(smlp(3, 64), smlp(64, 64))
        self.mlp2 = nn.Sequential(smlp(64, 64), smlp(64, 128), smlp(128, 1024))
        self.head = nn.Sequential(fc(1024, 512), nn.Dropout(0.3), fc(512, 256), nn.Dropout(0.3), nn.Linear(256, n_cls))

    def forward(self, pts):                                # pts: (B, N, 3)
        x = pts.transpose(1, 2)                            # (B, 3, N)
        if self.tnet:
            x = torch.bmm(self.t3(x).transpose(1, 2), x)   # (P A)^T
        x = self.mlp1(x)                                   # (B, 64, N)
        if self.tnet:
            x = torch.bmm(self.t64(x).transpose(1, 2), x)
        x = self.mlp2(x)                                   # (B, 1024, N)
        g, idx = x.max(dim=2)                              # (B, 1024) y el punto ganador de cada canal
        return self.head(g), idx


torch.manual_seed(0)
for tnet in (True, False):
    m = PointNetCls(tnet=tnet).eval()
    print('tnet', tnet, 'params', sum(p.numel() for p in m.parameters()))   # 3,480,049 / 819,624
pts = torch.randn(2, 1024, 3)
m = PointNetCls(tnet=False).eval()
with torch.no_grad():
    a, idx = m(pts)
    b, _ = m(pts[:, torch.randperm(1024)])
    print('(a) max |diff| tras permutar:', (a - b).abs().max().item())       # 0.0
    crit = torch.unique(idx[0])
    print('(b) puntos críticos:', crit.numel(), 'de 1024')                   # 127 con esta semilla; ≤ 1024
    c, _ = m(pts[:1, crit])
    print('(c) solo críticos, max |diff|:', (a[:1] - c).abs().max().item())  # ≈ 1e-8 (redondeo de float32)
` },
          ] },
          { t: 'p', html: R`Verificado en el venv del Atlas (PyTorch 2.14): ${qn('params.total')} parámetros con T-Nets y ${qn('params.total', NT)} sin, iguales al calculador; la diferencia tras permutar es 0.0; con la semilla 0, la primera nube tiene 127 puntos críticos y quedarse solo con ellos cambia los logits en ≈ 10⁻⁸ (redondeo de float32).` },
          { t: 'h3', text: 'Ejercicio 2: los parámetros a mano' },
          { t: 'p', html: R`Con la convención del código oficial (cada capa con sesgo, y BN con γ y β): una capa compartida C<sub>in</sub> → C<sub>out</sub> tiene C<sub>in</sub>·C<sub>out</sub> + C<sub>out</sub> + 2·C<sub>out</sub> parámetros. Calcula (a) el MLP 64-128-1024 del cuerpo, (b) la cabeza 1024-512-256-40 (la última sin BN), (c) el T-Net de features entero, y compara con el calculador.` },
          { t: 'qa', items: [
            { q: 'Solución', a: R`(a) 64→64: 4,096 + 64 + 128 = 4,288; 64→128: 8,192 + 128 + 256 = 8,576; 128→1024: 131,072 + 1,024 + 2,048 = 134,144; total ${np('mlp2')}. (b) 1024→512: 524,288 + 512 + 1,024 = 525,824; 512→256: 131,072 + 256 + 512 = 131,840; 256→40: 10,240 + 40 = 10,280; total ${np('head')}. (c) MLP 64-128-1024: 4,288 + 8,576 + 134,144 = 147,008; FC 1024→512 y 512→256 con BN: 525,824 + 131,840 = 657,664; salida 256 → 4,096: 1,048,576 + 4,096 = 1,052,672; total ${np('ftn')}. Los tres totales salen iguales en el calculador (tabla de <a href="#pointnet.costo">parámetros</a>).` },
          ] },
          { t: 'h3', text: 'Ejercicio 3: puntos críticos a mano' },
          { t: 'p', html: R`Cinco puntos en 2-D y una "red" h(x, y) = (x, y, −x, x + y) (sin aprender; cuatro canales): p₁ = (0, 0), p₂ = (3, 1), p₃ = (1, 4), p₄ = (−2, 2), p₅ = (1, 1). (a) Calcula g = max por canal. (b) ¿Cuáles son los puntos críticos? (c) ¿Qué puntos puedes borrar sin cambiar g? (d) ¿Qué punto nuevo cambiaría g si lo agregas: (2, 2) o (4, 0)?` },
          { t: 'qa', items: [
            { q: 'Solución', a: 'h(p₁) = (0, 0, 0, 0); h(p₂) = (3, 1, −3, 4); h(p₃) = (1, 4, −1, 5); h(p₄) = (−2, 2, 2, 0); h(p₅) = (1, 1, −1, 2). (a) g = (3, 4, 2, 5). (b) Críticos: p₂ (canal 1), p₃ (canales 2 y 4), p₄ (canal 3): tres puntos, menos que los 4 canales. (c) p₁ y p₅. (d) (2, 2) da (2, 2, −2, 4): no supera ningún máximo, g no cambia (está dentro de la "forma cota superior"). (4, 0) da (4, 0, −4, 4): supera el canal 1 (4 > 3), g cambia a (4, 4, 2, 5).' },
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. De dónde salen los puntos en un robot sin LiDAR: <a href="#depth">profundidad monocular</a>; y cómo se siguen en el tiempo: <a href="#bytetrack">tracking</a>.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'pointnet-01', kind: 'concepto', q: 'Las tres propiedades de una nube de puntos que complican usar una CNN.', a: 'Sin orden (N! permutaciones son la misma nube), irregular (sin rejilla: los vecinos hay que buscarlos) y densidad variable; además, debe ser robusta a transformaciones rígidas.' },
      { id: 'pointnet-02', kind: 'formula', q: 'La forma de PointNet (Teorema 1).', a: R`f(S) ≈ γ(MAX<sub>i</sub> h(x<sub>i</sub>)): h es un MLP compartido por punto, MAX el máximo por canal (simétrico) y γ la cabeza. Aproxima cualquier función continua de conjuntos con K suficiente.` },
      { id: 'pointnet-03', kind: 'concepto', q: 'MLP compartido en PyTorch.', a: 'Conv1d(C_in, C_out, kernel_size=1) sobre (B, C, N), o Linear sobre (B, N, C): los mismos pesos para cada punto. Equivariante a permutaciones, costo lineal en N.' },
      { id: 'pointnet-04', kind: 'concepto', q: 'Por qué max-pool y no ordenar ni un RNN.', a: 'Ordenar no da un orden estable en alta dimensión; un RNN con permutaciones como aumento no es invariante de verdad. Entre las simétricas, el máximo ganó en el paper y da robustez (puntos críticos).' },
      { id: 'pointnet-05', kind: 'concepto', q: 'Conjunto crítico C_S.', a: 'Los puntos que dan el máximo en algún canal del max-pool. A lo sumo K (= 1024). Cualquier nube entre C_S y la forma cota superior N_S da la misma feature global (Teorema 2).' },
      { id: 'pointnet-06', kind: 'trampa', q: '"El conjunto crítico tiene exactamente 1024 puntos."', a: 'A lo sumo 1024: un punto puede ganar varios canales. En una red sin entrenar con N = 1,024 salen del orden de cien.' },
      { id: 'pointnet-07', kind: 'concepto', q: 'Qué es un T-Net.', a: 'Una mini-PointNet (MLP 64-128-1024, max-pool, FC 512-256) que predice una matriz K×K (3×3 de entrada, 64×64 de features), con pesos en 0 y sesgo = identidad al inicio. Afín, no necesariamente una rotación.' },
      { id: 'pointnet-08', kind: 'formula', q: 'Regularizador del T-Net de features.', a: R`L<sub>reg</sub> = ‖I − AAᵀ‖²<sub>F</sub> con peso 0.001: empuja a A a ser ortogonal (no pierde información). El TF oficial usa l2_loss (la mitad).` },
      { id: 'pointnet-09', kind: 'trampa', q: '"El T-Net de features siempre ayuda."', a: 'Sin regularizador empeora (86.9 vs 87.1 sin transformaciones, Tabla 5); con regularizador 87.4; con ambos T-Nets 89.2.' },
      { id: 'pointnet-10', kind: 'trampa', q: '"Los parámetros de PointNet están en el MLP de 1024 canales."', a: R`La mayoría está en los T-Nets: solo la última lineal del de features (256 × 4,096 + 4,096) pesa más que todo el MLP compartido. Sin T-Nets: ${qn('params.total', NT)} contra ${qn('params.total')}.` },
      { id: 'pointnet-11', kind: 'conteo', q: 'Parámetros de una capa compartida C_in → C_out con BN (convención del código oficial).', a: R`C_in·C_out + C_out (sesgo) + 2·C_out (γ, β). Ej.: 128 → 1024: 128·1024 + 1024 + 2·1024 = ${qn('node.conv5.params')}.` },
      { id: 'pointnet-12', kind: 'concepto', q: 'Rama de segmentación de PointNet.', a: 'Concatenar a cada punto su feature local (64) con la global (1024) → 1088 por punto → MLP compartido 512-256-128-128 → m clases por punto.' },
      { id: 'pointnet-13', kind: 'trampa', q: '"El 440M FLOPs de la Tabla 6 son 2 × MACs."', a: 'Coinciden en orden con los MACs del calculador: la tabla cuenta una multiplicación-suma como una operación.' },
      { id: 'pointnet-14', kind: 'concepto', q: 'Cómo escala PointNet con N.', a: 'MACs y comparaciones del max-pool lineales en N; parámetros constantes; FC de cabeza y T-Nets constantes; el conjunto crítico acotado por 1024.' },
      { id: 'pointnet-15', kind: 'concepto', q: 'La gran limitación de PointNet.', a: 'No tiene estructura local: cada punto se procesa solo hasta el max-pool global. Falla en detalles finos y escenas grandes; PointNet++ lo resuelve con agrupamiento jerárquico.' },
      { id: 'pointnet-16', kind: 'concepto', q: 'Set abstraction de PointNet++.', a: 'Sampling (FPS: S centros), grouping (ball query: vecinos dentro de un radio, hasta k, en coordenadas relativas al centro) y una PointNet local por vecindario: N × (d + C) → S × (d + C′).' },
      { id: 'pointnet-17', kind: 'concepto', q: 'Farthest point sampling.', a: 'Elegir iterativamente el punto más lejano de los ya elegidos: mejor cobertura que el muestreo aleatorio. O(N·S) distancias, secuencial.' },
      { id: 'pointnet-18', kind: 'tradeoff', q: 'Ball query vs kNN.', a: 'Ball query fija la escala espacial (radio): las features significan lo mismo en zonas densas y ralas. kNN fija la cantidad de vecinos: en zonas ralas el vecindario se estira.' },
      { id: 'pointnet-19', kind: 'concepto', q: 'MSG vs MRG en PointNet++.', a: 'MSG: varios radios por nivel, features concatenadas (robusto, ≈ 2× más caro que SSG). MRG: concatena el resumen del nivel anterior con una PointNet sobre los puntos crudos de la región (más barato).' },
      { id: 'pointnet-20', kind: 'concepto', q: 'Random input dropout (PointNet++).', a: 'Por nube, θ ~ U[0, 0.95] y se borra cada punto con probabilidad θ: la red ve densidades variables y aprende a combinar escalas.' },
      { id: 'pointnet-21', kind: 'concepto', q: 'EdgeConv (DGCNN).', a: 'Features de arista h(x_i, x_j − x_i) sobre un grafo kNN (k = 20) agregadas con máximo; el grafo se recalcula en el espacio de features en cada capa.' },
      { id: 'pointnet-22', kind: 'concepto', q: 'PointPillars en una línea.', a: 'Pilares verticales de 0.16 m, PointNet simplificada por pilar (≤ 12,000 pilares, ≤ 100 puntos), pseudo-imagen 2-D, CNN 2-D + cabeza SSD: detección 3-D a 62 Hz.' },
      { id: 'pointnet-23', kind: 'tradeoff', q: 'Puntos vs voxels vs BEV vs imagen de profundidad.', a: 'Puntos: sin pérdida, lineal en N, sin estructura local (PointNet). Voxels: estructura local, cuantización, caro si es denso. BEV/pilares: muy rápido, colapsa la altura. Imagen de profundidad: CNN 2-D madura, una sola vista.' },
      { id: 'pointnet-24', kind: 'concepto', q: 'Preprocesado típico antes de PointNet en un robot.', a: 'Quitar el piso, clusterizar, recortar el objeto, voxel downsampling, muestrear N fijo (FPS o aleatorio) y normalizar a la esfera unidad.' },
      { id: 'pointnet-25', kind: 'concepto', q: 'Datos y aumentos de PointNet en ModelNet40.', a: '12,311 CAD de 40 clases (9,843 / 2,468); 1,024 puntos uniformes sobre la superficie, esfera unidad; rotación en el eje vertical y jitter gaussiano.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'point cloud', es: 'nube de puntos', def: 'Conjunto sin orden de puntos 3-D (más atributos opcionales: intensidad, color, normales); la salida nativa de un LiDAR o de una cámara de profundidad back-proyectada.', say: 'The LiDAR gives us an unordered point cloud per sweep.' },
      { en: 'permutation invariance', es: 'invarianza a permutaciones', def: 'La salida no cambia si se reordenan los elementos del conjunto de entrada.', say: 'A set function must be permutation invariant.' },
      { en: 'symmetric function', es: 'función simétrica', def: 'Función cuyo valor no depende del orden de sus argumentos (suma, máximo, promedio).', say: 'PointNet aggregates with a channel-wise max, a symmetric function.' },
      { en: 'shared MLP', es: 'MLP compartido', def: 'El mismo MLP aplicado a cada punto por separado; equivale a una convolución 1×1.', say: 'The shared MLP is just a one-by-one convolution over points.' },
      { en: 'T-Net', es: 'T-Net', def: 'Mini-PointNet que predice una matriz de alineación para los puntos o las features, inicializada en la identidad.', say: 'The feature T-Net is regularized towards an orthogonal matrix.' },
      { en: 'critical point set', es: 'conjunto crítico', def: 'Puntos que dan el máximo en algún canal del max-pool; determinan la feature global (a lo sumo K).', say: 'The global feature is determined by at most K critical points.' },
      { en: 'farthest point sampling (FPS)', es: 'muestreo del punto más lejano', def: 'Elegir iterativamente el punto más lejano de los ya elegidos para cubrir la nube con pocos centros.', say: 'We use farthest point sampling to pick the centroids.' },
      { en: 'ball query', es: 'consulta por radio', def: 'Vecinos de un centro dentro de un radio fijo, con un tope de k puntos.', say: 'Ball query keeps a fixed spatial scale across densities.' },
      { en: 'set abstraction', es: 'abstracción de conjuntos', def: 'Nivel de PointNet++: muestreo, agrupamiento y una PointNet local por vecindario.', say: 'Each set abstraction level halves the points and widens the receptive field.' },
      { en: 'voxel downsampling', es: 'submuestreo por voxels', def: 'Dejar un punto (o el promedio) por celda de una rejilla 3-D para uniformar la densidad y reducir N.', say: 'We voxel-downsample to five centimeters before the network.' },
      { en: 'BEV (bird\'s-eye view)', es: 'vista de pájaro', def: 'Proyección de la escena sobre el plano del piso; base de los detectores 3-D rápidos de LiDAR.', say: 'PointPillars turns the cloud into a BEV pseudo-image.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
