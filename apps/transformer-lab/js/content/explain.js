/* Transformer Lab — contenido pedagógico en español (TL.Content, SPEC §8).
 *
 * - Todo el LaTeX va en plantillas String.raw (R`…`): se escribe con UNA sola barra.
 * - Marcadores que sustituye la app: {T} {d} {h} {dk} {dff} {V} {N} {l} {hd} {lr}.
 *   Nunca van pegados a una orden LaTeX: los símbolos genéricos se escriben sin llaves
 *   (\frac1T, \sqrt d, ^T …) para que la sustitución no los convierta en números.
 *   Por eso el gradiente se escribe \mathrm dX (idéntico a \mathrm{d}X al renderizar):
 *   «{d}» es un marcador y \mathrm{d} se convertiría en \mathrm{8}.
 * - En los campos HTML: \( … \) en línea y \[ … \] en bloque; se usa \lt, \le, \gt en vez de "<".
 * - Convención de cabezas: como subíndice, h indica «la cabeza h-ésima» (Q_h); como dimensión,
 *   h es el número de cabezas (d_k = d/h), igual que en SPEC §3.4.
 */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const R = String.raw;

  // Bloque estándar de dimensiones: forma simbólica (LaTeX) + forma numérica (marcadores) + nota.
  function dims(sym, num, note) {
    return R`<p><b>Simbólico:</b> \(${sym}\)</p><p><b>En este modelo:</b> ${num}</p>` +
      (note ? '<p>' + note + '</p>' : '');
  }

  // ───────────────────────────── Símbolos y notación ─────────────────────────────
  const symbols = [
    { sym: 'T', key: 'T', tex: 'T', name: 'longitud de la secuencia',
      desc: 'Número de tokens de entrada, es decir, de posiciones que el modelo procesa en paralelo. Cada matriz de activaciones tiene T filas (una por token). Como máximo vale la ventana de contexto (maxLen).' },
    { sym: 'd', key: 'd', tex: 'd', name: 'dimensión del modelo',
      desc: 'Tamaño del vector que representa a cada token a lo largo de toda la red (d_model). Es el «ancho» del flujo residual.' },
    { sym: 'h', key: 'h', tex: 'h', name: 'número de cabezas',
      desc: 'Número de cabezas de atención por capa; debe dividir a d. Cuando aparece como subíndice (Q_h, A_h) indica una cabeza concreta.' },
    { sym: 'd_k', key: 'dk', tex: 'd_k', name: 'dimensión por cabeza',
      desc: 'd_k = d / h. Tamaño de las consultas, claves y valores dentro de cada cabeza.' },
    { sym: 'd_ff', key: 'dff', tex: R`d_{\text{ff}}`, name: 'dimensión oculta de la FFN',
      desc: 'Número de «neuronas» de la red feed-forward por token; normalmente 4·d.' },
    { sym: 'V', key: 'V', tex: 'V', name: 'tamaño del vocabulario',
      desc: 'Número de tokens distintos que conoce el modelo; es el número de columnas de los logits. No confundir con la matriz de valores V de la atención.' },
    { sym: 'N', key: 'N', tex: 'N', name: 'número de capas',
      desc: 'Número de bloques transformer (atención + FFN) apilados.' },
    { sym: 'η', key: 'lr', tex: R`\eta`, name: 'tasa de aprendizaje',
      desc: 'Tamaño del paso que da el optimizador en cada actualización (learning rate).' },
  ];

  const notation = [
    { tex: R`\mathrm dX := \frac{\partial\mathcal L}{\partial X}`,
      desc: 'Gradiente de la pérdida respecto de X. Tiene siempre la misma forma que X: la entrada (i, j) dice cuánto cambiaría la pérdida si X[i, j] aumentara un poquito.' },
    { tex: R`X\in\mathbb R^{T\times d}`,
      desc: 'X es una matriz de T filas y d columnas. Por convenio, cada fila es un token y cada columna una característica.' },
    { tex: R`A\,B`,
      desc: 'Producto de matrices: (m×k)·(k×n) → m×n. La dimensión interior k debe coincidir y desaparece («se contrae»).' },
    { tex: R`A^{\top}`, desc: 'Traspuesta: intercambia filas y columnas (m×n → n×m).' },
    { tex: R`A\odot B`, desc: 'Producto elemento a elemento (Hadamard): ambas matrices tienen la misma forma.' },
    { tex: R`[\,A\,\|\,B\,]`, desc: 'Concatenación por columnas: una matriz al lado de la otra.' },
    { tex: R`\mathbf x_t = X_{t,:}`, desc: 'Fila t de X: el vector del token en la posición t. X_{:,j} es la columna j.' },
    { tex: R`\mathbf 1\,b`,
      desc: 'Difusión (broadcast) de un vector fila b (1×n) a las T filas; 1 es una columna de unos (T×1). En el backward se convierte en una suma sobre las filas.' },
    { tex: R`\textstyle\sum_{\text{filas}}`, desc: 'Suma a lo largo de las filas (sobre las posiciones): convierte una matriz T×n en un vector 1×n.' },
    { tex: R`\overline{\mathbf u}`, desc: 'Media de las componentes de una fila (en el backward de LayerNorm): un número por token.' },
    { tex: R`\operatorname{softmax}_{\text{fila}}`, desc: 'Softmax aplicado a cada fila por separado: cada fila se convierte en una distribución de probabilidad.' },
    { tex: R`X^{[l]}`,
      desc: 'Superíndice entre corchetes = número de capa. X^[0] es la entrada a la primera capa y X^[N] la salida de la última. Con una sola capa, los parámetros no llevan superíndice.' },
    { tex: R`Q_h,\ S_h,\ A_h,\ Z_h`,
      desc: 'Subíndice = cabeza de atención (1, 2, …). En las fórmulas genéricas, Q_h significa «la cabeza h-ésima»; en las dimensiones, h es el número de cabezas.' },
    { tex: R`S_h \to \tilde S_h \to \hat S_h \to A_h`,
      desc: 'Puntuaciones Q·Kᵀ, puntuaciones escaladas por 1/√d_k, puntuaciones con la máscara aplicada, y pesos de atención (tras el softmax).' },
    { tex: R`M_{ij}\in\{0,-\infty\}`,
      desc: 'Máscara causal: 0 si la clave j es visible para la consulta i (j ≤ i) y −∞ si está en el futuro (j > i).' },
    { tex: R`Y,\ y_t`, desc: 'Objetivos: y_t es el id de la palabra correcta en la posición t; Y es su versión one-hot (T×V).' },
    { tex: R`P\ \text{ vs. }\ P_{\text{pos}}`,
      desc: 'P son las probabilidades de salida (T×V); P_pos es la tabla de posiciones aprendida (solo existe si la codificación posicional es la aprendida, learned).' },
    { tex: R`V\ \text{ vs. }\ V_h`,
      desc: 'Como dimensión, V es el tamaño del vocabulario (logits: T×V). Como matriz, V y V_h son los valores de la atención (T×d y T×d_k).' },
    { tex: R`\gamma,\ \beta`,
      desc: 'Escala y desplazamiento aprendibles de LayerNorm (1×d). No confundir con β₁ y β₂ de Adam, que son hiperparámetros del optimizador.' },
    { tex: R`\mathrm dR_{\text{directo}},\ \mathrm dR_{\text{LN}}`,
      desc: 'Las dos contribuciones al gradiente de un tensor que se usó dos veces en una conexión residual: la que llega intacta por el atajo (directo) y la que vuelve a través de la LayerNorm y su subcapa (LN). El gradiente total es su suma. Lo mismo ocurre con la entrada de la capa: dX^[l−1]_directo y dX^[l−1]_LN.' },
    { tex: R`\mathrm dH_Q,\ \mathrm dH_K,\ \mathrm dH_V`,
      desc: 'Contribuciones al gradiente de H por cada uno de sus tres usos (para formar Q, K y V). Aquí el subíndice es una letra, no un número de cabeza.' },
    { tex: R`f'(U)`, desc: 'Derivada de la función de activación (ReLU o GELU) evaluada en cada entrada de U.' },
    { tex: R`\eta`, desc: 'Tasa de aprendizaje del optimizador.' },
  ];

  const phases = {
    data: { name: 'Datos', color: 'data',
      desc: 'El texto se corta en tokens, se convierte en ids y se forman los pares entrada → objetivo.' },
    forward: { name: 'Forward', color: 'fwd',
      desc: 'Propagación hacia delante: de los ids a las probabilidades del siguiente token, capa a capa.' },
    loss: { name: 'Pérdida', color: 'fwd',
      desc: 'Se compara la predicción con la palabra correcta mediante la entropía cruzada: un único número que resume el error.' },
    backward: { name: 'Backward', color: 'bwd',
      desc: 'Retropropagación: los gradientes viajan desde la pérdida hasta cada parámetro aplicando la regla de la cadena.' },
    update: { name: 'Actualización', color: 'upd',
      desc: 'El optimizador (SGD o Adam) usa los gradientes para modificar los parámetros; la siguiente iteración parte de los pesos nuevos.' },
  };

  // ───────────────────────────── Pasos (plantillas por tpl) ─────────────────────────────
  const steps = {};

  // ── Datos ──
  steps['data.tokenize'] = {
    title: 'Tokenización',
    summary: 'El texto se corta en tokens, cada token se convierte en un número (su id) y se forman los pares entrada → objetivo desplazando la frase una posición.',
    intuition: R`<p>Una red neuronal no lee letras: solo opera con números. Por eso primero partimos la frase en piezas, los <em>tokens</em> (aquí, palabras y signos de puntuación), y a cada pieza le asignamos su posición en el <b>vocabulario</b>. Al principio añadimos un token especial, <code>&lt;s&gt;</code> («inicio de frase»), para que el modelo tenga algo que mirar cuando todavía no ha visto ninguna palabra. La tarea es <b>predecir la siguiente palabra</b>: el objetivo es la misma frase desplazada una posición.</p>`,
    math: [
      R`(w_0, w_1, \dots, w_T),\qquad w_0 = \langle s\rangle`,
      R`\mathbf x = (w_0,\dots,w_{T-1})\ \longrightarrow\ \mathbf y = (w_1,\dots,w_T)`,
      R`x_t,\ y_t \in \{0, 1, \dots, V-1\}`,
    ],
    shapes: dims(R`\text{texto}\ \to\ \mathbf x\in\{0,\dots,V-1\}^T,\ \ \mathbf y\in\{0,\dots,V-1\}^T`,
      R`<b>{T}</b> ids de entrada y <b>{T}</b> ids objetivo; vocabulario de <b>{V}</b> tokens.`,
      R`Aún no hay matrices de números reales, solo índices enteros. Si la frase tiene más de maxLen + 1 tokens (contando <code>&lt;s&gt;</code>), se recorta.`),
    details: R`<p><b>Qué significan los números.</b> El id de un token es solo su posición en la lista del vocabulario, construida en orden de primera aparición en el corpus: con el corpus por defecto, <code>&lt;s&gt;</code> es el 0, «el» el 1, «gato» el 2… Ese número no tiene significado aritmético: «gato» (2) no está «más cerca» de «el» (1) que de «leche». Por eso el paso siguiente no usa el id directamente, sino que lo cambia por un vector aprendible.</p>
<p><b>Por qué desplazar.</b> Con una frase de \(T\) tokens obtenemos \(T\) ejemplos de entrenamiento a la vez: en la posición \(t\) (contando desde 1) el modelo ve \(w_0,\dots,w_{t-1}\) (la máscara causal se encarga de que no vea nada más) y debe predecir \(w_t\). Esto se llama <em>teacher forcing</em>: durante el entrenamiento siempre se le da el prefijo correcto, no sus propias predicciones.</p>
<p><b>Errores típicos.</b> Olvidar el token de inicio (la primera palabra no tendría contexto del que predecirse), desalinear entrada y objetivo en una posición, o tokenizar de forma distinta al entrenar y al generar (una palabra fuera del vocabulario no tiene id). En modo carácter, cada letra, incluido el espacio (␣), es un token: el vocabulario es pequeño pero las secuencias son más largas.</p>`,
    code: `tokens = separar(texto.lower())           # ['el', 'gato', 'come', 'pescado', '.']
ids = [BOS] + [stoi[w] for w in tokens]   # BOS = id del token de inicio (0)
x, y = ids[:-1], ids[1:]                  # entrada / objetivo, T = len(x)`,
  };

  // ── Forward: entrada ──
  steps['fwd.embed'] = {
    title: 'Embedding de tokens',
    summary: 'Cada id se sustituye por su fila de la matriz de embeddings E: el token pasa a ser un vector de d números aprendibles.',
    intuition: R`<p>La matriz \(E\) es un diccionario con una fila por palabra del vocabulario. Buscar la fila de un token es lo mismo que multiplicar su vector <em>one-hot</em> (todo ceros salvo un 1 en la posición del id) por \(E\): el 1 «selecciona» una fila. Al principio las filas son aleatorias; durante el entrenamiento se mueven para que palabras que se usan de forma parecida (como «gato» y «perro») acaben con vectores parecidos.</p>`,
    math: [
      R`X_{\text{emb}} = \operatorname{onehot}(\mathbf x)\,E`,
      R`(X_{\text{emb}})_{t,:} = E_{x_t,:}`,
    ],
    shapes: dims(R`(T\times V)\cdot(V\times d)\to(T\times d)`,
      R`<code>{T}×{V}</code> · <code>{V}×{d}</code> → <code>{T}×{d}</code>`,
      R`La dimensión del vocabulario \(V\) se contrae: cada token queda representado por \(d\) números. La tabla \(E\) tiene {V}·{d} parámetros.`),
    details: R`<p><b>Por qué un vector y no el id.</b> Un vector de \(d\) componentes puede codificar muchas propiedades a la vez (¿es un animal?, ¿es un verbo?, ¿suele ir tras «la»?) y, sobre todo, es <em>diferenciable</em>: podemos ajustar cada componente con el gradiente. Un id es un índice discreto que no se puede derivar.</p>
<p><b>Multiplicar o indexar.</b> Matemáticamente es el producto \(\operatorname{onehot}(\mathbf x)\,E\); en la práctica nadie construye la matriz one-hot, sino que se copian filas (<code>E[ids]</code>), muchísimo más barato: \(O(Td)\) en lugar de \(O(TVd)\). La vista muestra la versión con one-hot porque deja claro que es un producto de matrices, y eso explica el gradiente del último paso del backward.</p>
<p><b>Qué observar.</b> Si un token aparece dos veces en la frase, sus dos filas de \(X_{\text{emb}}\) son idénticas: el embedding no sabe nada de la posición ni del contexto. El orden lo añade el paso siguiente, y el contexto, la atención. La inicialización exacta de \(E\) aparece en el inventario de parámetros de «Datos y modelo».</p>`,
    code: `X_emb = E[ids]                  # (T, d): copia la fila de cada token
# equivalente: np.eye(V)[ids] @ E   (T, V) @ (V, d)`,
  };

  steps['fwd.posenc'] = {
    title: 'Codificación posicional',
    summary: 'A cada fila se le suma un vector que depende solo de la posición, para que el modelo sepa en qué lugar de la frase está cada token.',
    intuition: R`<p>La atención compara tokens mediante productos escalares y los mezcla con medias ponderadas: nada en esas operaciones depende del orden de las filas. Sin información de posición, «el gato come» y «come el gato» se parecerían demasiado. La solución es sumar a cada embedding una «firma» de su posición. En la versión <b>sinusoidal</b>, la firma es un conjunto de ondas de frecuencias distintas, como las agujas de un reloj que giran a velocidades diferentes; en la versión <b>aprendida</b>, es una fila de una tabla de parámetros \(P_{\text{pos}}\).</p>`,
    math: [
      R`X^{[0]} = X_{\text{emb}} + PE_{0:T}`,
      R`PE_{\text{pos},\,2i} = \sin\!\Big(\frac{\text{pos}}{10000^{2i/d}}\Big),\qquad PE_{\text{pos},\,2i+1} = \cos\!\Big(\frac{\text{pos}}{10000^{2i/d}}\Big)`,
      R`\text{(aprendida)}\qquad X^{[0]} = X_{\text{emb}} + (P_{\text{pos}})_{0:T}`,
    ],
    shapes: dims(R`(T\times d) + (T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> + <code>{T}×{d}</code> → <code>{T}×{d}</code>`,
      R`Suma elemento a elemento: la forma no cambia. De la tabla de posiciones (maxLen filas) solo se usan las primeras \(T\).`),
    details: R`<p><b>Cómo leer la tabla sinusoidal.</b> Cada pareja de columnas \((2i, 2i+1)\) es un par (seno, coseno) con frecuencia \(\omega_i = 10000^{-2i/d}\). Las primeras columnas oscilan rápido (cambian mucho entre posiciones vecinas); las últimas, muy despacio. La combinación da a cada posición un vector distinto. Todos los valores están en \([-1,1]\), una escala parecida a la de los embeddings: la suma conserva las dos informaciones sin que una tape a la otra.</p>
<p><b>Por qué senos y cosenos.</b> Para cualquier desplazamiento \(k\), \(PE_{\text{pos}+k}\) se obtiene de \(PE_{\text{pos}}\) girando cada pareja un ángulo \(k\,\omega_i\): una transformación lineal que no depende de pos. Eso facilita que la atención aprenda relaciones relativas («el token dos posiciones atrás»).</p>
<p><b>Sumar en vez de concatenar.</b> Sumar mantiene la dimensión \(d\); la red aprende a usar direcciones distintas para «qué palabra» y «dónde está». La posición 0 (el token <code>&lt;s&gt;</code>) recibe \(\sin 0 = 0\) y \(\cos 0 = 1\) alternados.</p>
<p><b>Aprendida.</b> Si eliges la codificación aprendida (<code>learned</code>), \(P_{\text{pos}}\) es un parámetro de maxLen×d que se entrena como \(E\); no sabe nada de posiciones que nunca vio.</p>`,
    code: `pos = np.arange(T)[:, None]; w = 10000.0 ** (-np.arange(0, d, 2) / d)
PE = np.zeros((T, d)); PE[:, 0::2] = np.sin(pos * w); PE[:, 1::2] = np.cos(pos * w)
X0 = X_emb + PE                 # (T, d)`,
  };

  // ── Forward: bloque de atención ──
  steps['fwd.ln1'] = {
    title: 'LayerNorm 1 (antes de la atención)',
    summary: 'Cada token (cada fila) se normaliza para que sus d valores tengan media 0 y varianza 1, y luego se reescala con γ₁ y se desplaza con β₁.',
    intuition: R`<p>Antes de comparar tokens entre sí conviene ponerlos en una escala común. LayerNorm mira cada fila por separado, le resta su media y la divide por su desviación típica: así ninguna fila entra en la atención con números gigantes o minúsculos. Después, \(\gamma_1\) y \(\beta_1\) (aprendibles) permiten a la red deshacer parte de la normalización si le conviene. Es la misma idea que convertir unas notas en «puntuaciones z», pero aplicada a los \(d\) números de cada token por separado.</p>`,
    math: [
      R`\mu_t = \frac1d\sum_{j=1}^d x_{tj},\qquad \sigma_t^2 = \frac1d\sum_{j=1}^d (x_{tj}-\mu_t)^2`,
      R`\hat x_{tj} = \frac{x_{tj}-\mu_t}{\sqrt{\sigma_t^2+\varepsilon}}`,
      R`H = \mathrm{LN}_1\big(X^{[l-1]}\big) = \gamma_1\odot\hat X + \beta_1`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> → <code>{T}×{d}</code>; \(\mu,\sigma^2\): <code>{T}×1</code>; \(\gamma_1,\beta_1\): <code>1×{d}</code>`,
      R`Las estadísticas se calculan por fila: una media y una varianza por token (vectores \(T\times 1\)) que se difunden a lo ancho de la fila. \(\gamma_1\) y \(\beta_1\) (\(1\times d\)) se difunden a lo alto, a las \(T\) filas.`),
    details: R`<p><b>Qué significan los números.</b> Tras normalizar, cada fila de \(\hat X\) tiene media 0 y varianza (casi) 1, sea cual sea la escala de la entrada. Con \(\gamma = 1\) y \(\beta = 0\) (sus valores iniciales) la salida es exactamente \(\hat X\); al entrenar, \(\gamma\) amplifica o atenúa cada característica y \(\beta\) la desplaza.</p>
<p><b>Por fila, no por columna.</b> A diferencia de BatchNorm, LayerNorm no mezcla tokens ni frases del lote: cada token se normaliza con sus propios \(d\) valores. Por eso funciona igual con una sola frase y durante la generación.</p>
<p><b>El papel de \(\varepsilon\).</b> Vale \(10^{-5}\) y evita dividir por cero si una fila fuera constante (\(\sigma^2 = 0\)). Hace que la varianza de la salida sea \(\sigma^2/(\sigma^2+\varepsilon)\), un poquito menor que 1. La varianza usa \(1/d\) (versión sesgada), no \(1/(d-1)\).</p>
<p><b>Pre-LN.</b> En este modelo (como en GPT-2) la normalización se aplica a la entrada de cada subcapa, no al flujo residual: \(X^{[l-1]}\) pasa intacto por el atajo y solo la rama de atención ve la versión normalizada \(H\). Esto hace el entrenamiento más estable en redes profundas.</p>`,
    code: `mu = X.mean(1, keepdims=True); var = X.var(1, keepdims=True)   # (T, 1)
Xhat = (X - mu) / np.sqrt(var + eps)
H = gamma1 * Xhat + beta1       # gamma1, beta1: (1, d) difundidos a las T filas`,
  };

  steps['fwd.attn.q'] = {
    title: 'Proyección de consultas (Q)',
    summary: 'Cada token normalizado se multiplica por W_Q para obtener su vector de consulta: lo que ese token «busca» en los demás.',
    intuition: R`<p>En la atención cada token desempeña tres papeles, y para cada uno se crea una versión distinta de su vector. La <b>consulta</b> \(\mathbf q_t\) expresa qué información necesita el token \(t\) para hacer su predicción: un verbo como «come» podría necesitar saber «¿quién es el sujeto?». \(W_Q\) es una matriz aprendida que decide qué combinaciones de características de \(H\) forman esa pregunta.</p>`,
    math: [
      R`Q = H\,W_Q`,
      R`\mathbf q_t = \mathbf h_t\,W_Q,\qquad Q_{ti} = \sum_{j=1}^d H_{tj}\,(W_Q)_{ji}`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> · <code>{d}×{d}</code> → <code>{T}×{d}</code>`,
      R`Se contrae la dimensión interior \(d\). Coste: {T}·{d}·{d} operaciones de multiplicar y sumar. Más adelante, las {d} columnas de \(Q\) se repartirán entre las {h} cabezas ({dk} columnas cada una).`),
    details: R`<p><b>Cada token por separado.</b> El producto \(H\,W_Q\) transforma cada fila de forma independiente: la fila \(t\) de \(Q\) solo depende de la fila \(t\) de \(H\). En este paso todavía no se mezcla información entre posiciones; eso solo ocurre al multiplicar por \(A_h\), más adelante.</p>
<p><b>Por qué una proyección.</b> El mismo vector \(\mathbf h_t\) no puede ser a la vez una buena pregunta, una buena etiqueta y un buen contenido. Tres matrices distintas (\(W_Q, W_K, W_V\)) permiten a la red especializar cada papel. Aquí no hay sesgo (como en LLaMA): la operación es puramente lineal.</p>
<p><b>Orientación.</b> Como las filas son tokens, los pesos multiplican por la derecha: \(H\,W_Q\), no \(W_Q\,H\). La columna \(i\) de \(W_Q\) es un «detector»: \(Q_{ti}\) es el producto escalar de \(\mathbf h_t\) con esa columna.</p>
<p><b>Escala.</b> Con pesos de varianza \(1/d\) y filas de \(H\) normalizadas, cada entrada de \(Q\) tiene al principio una varianza cercana a 1: ni explota ni se desvanece.</p>`,
    code: `Q = H @ Wq                      # (T, d) @ (d, d) -> (T, d)`,
  };

  steps['fwd.attn.k'] = {
    title: 'Proyección de claves (K)',
    summary: 'Cada token se multiplica por W_K para obtener su clave: la «etiqueta» con la que se anuncia ante las consultas de los demás.',
    intuition: R`<p>Si la consulta es la pregunta, la <b>clave</b> es el cartel que cada token lleva colgado para que lo encuentren. Cuando la consulta de «come» y la clave de «gato» apunten en direcciones parecidas, su producto escalar será grande y «come» prestará atención a «gato». Las claves también se aprenden: \(W_K\) decide qué rasgos de cada token conviene anunciar (por ejemplo, «soy un sustantivo que puede ser sujeto»).</p>`,
    math: [
      R`K = H\,W_K`,
      R`\mathbf k_t = \mathbf h_t\,W_K`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> · <code>{d}×{d}</code> → <code>{T}×{d}</code>`,
      R`Más adelante se usará traspuesta, \(K_h^{\top}\in\mathbb R^{d_k\times T}\), para comparar cada consulta con todas las claves a la vez.`),
    details: R`<p><b>Consultas y claves trabajan en pareja.</b> La puntuación entre dos tokens será \(\mathbf q_i\cdot\mathbf k_j = \mathbf h_i\,W_Q W_K^{\top}\,\mathbf h_j^{\top}\) (en cada cabeza, con sus bloques de columnas). Lo que de verdad importa es el producto \(W_Q W_K^{\top}\): una forma bilineal que mide la compatibilidad entre dos tokens. Partirla en dos factores de \(d\times d_k\) la hace más barata y de rango limitado (como mucho \(d_k\) por cabeza).</p>
<p><b>Asimetría.</b> Como \(W_Q\ne W_K\), que \(i\) atienda a \(j\) no implica que \(j\) atienda a \(i\): «come» puede buscar a «gato» sin que «gato» busque a «come». Además, la máscara solo permitirá mirar hacia atrás.</p>
<p><b>Qué observar.</b> En este paso cada fila de \(K\) depende solo de su propio token. La clave de un token es la misma para todas las consultas que lo comparan; lo que cambia de una comparación a otra es la consulta.</p>`,
    code: `K = H @ Wk                      # (T, d) @ (d, d) -> (T, d)`,
  };

  steps['fwd.attn.v'] = {
    title: 'Proyección de valores (V)',
    summary: 'Cada token se multiplica por W_V para obtener su valor: la información que entregará a quien le preste atención.',
    intuition: R`<p>El <b>valor</b> es el contenido que un token comparte cuando otro le presta atención. Separarlo de la clave es importante: lo que hace a un token <em>relevante</em> (su clave) no tiene por qué coincidir con lo que conviene <em>transmitir</em> (su valor). «Gato» puede anunciarse como «sujeto» y, en cambio, entregar la información «felino: suele comer pescado». Piensa en una biblioteca: la clave es la ficha del catálogo y el valor, el libro.</p>`,
    math: [
      R`V = H\,W_V`,
      R`\mathbf v_t = \mathbf h_t\,W_V`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> · <code>{d}×{d}</code> → <code>{T}×{d}</code>`,
      R`Aquí \(V\) es la matriz de valores (\(T\times d\)), no el tamaño del vocabulario.`),
    details: R`<p><b>Lo que viaja entre tokens.</b> Más adelante la salida de cada cabeza será \(Z_h = A_h V_h\): cada fila es una media ponderada de filas de \(V_h\). Los valores son, por tanto, lo único que realmente se copia de una posición a otra; consultas y claves solo deciden <em>cuánto</em> se copia de cada una.</p>
<p><b>Lineal frente a no lineal.</b> La salida de la atención es lineal en \(V\) pero no lineal en \(Q\) y \(K\), por culpa del softmax. Por eso el gradiente hacia \(W_V\) será el camino «fácil» (no atraviesa el softmax) y el de \(W_Q\) y \(W_K\), el difícil.</p>
<p><b>Dimensiones.</b> En este modelo los valores tienen la misma anchura que consultas y claves (\(d_k\) por cabeza), aunque no es obligatorio: en general podrían tener otra dimensión, \(d_v\).</p>`,
    code: `V = H @ Wv                      # (T, d) @ (d, d) -> (T, d)`,
  };

  steps['fwd.attn.split'] = {
    title: 'División en cabezas',
    summary: 'Las columnas de Q, K y V se reparten en h bloques de d_k columnas: cada bloque es una cabeza de atención independiente.',
    intuition: R`<p>En lugar de una única atención con vectores de \(d\) dimensiones, usamos \(h\) atenciones más pequeñas en paralelo, cada una con \(d_k = d/h\) dimensiones. Es como poner a varios lectores a buscar pistas distintas en el mismo texto: uno se fija en el sujeto, otro en la palabra anterior. Dividir no cuesta nada: solo se agrupan las columnas en bloques.</p>`,
    math: [
      R`d_k = d/h`,
      R`Q_h = Q_{:,\,(h-1)d_k\,:\,h\,d_k},\qquad K_h = K_{:,\,(h-1)d_k\,:\,h\,d_k},\qquad V_h = V_{:,\,(h-1)d_k\,:\,h\,d_k}`,
      R`Q = [\,Q_1\,\|\,Q_2\,\|\,\cdots\,\|\,Q_h\,]`,
    ],
    shapes: dims(R`(T\times d)\to h\times(T\times d_k)\quad\text{para } Q,\ K,\ V`,
      R`<code>{T}×{d}</code> → {h} bloques de <code>{T}×{dk}</code> (tres veces: \(Q\), \(K\), \(V\))`,
      R`No se crea ni se pierde ningún número: {h}·{dk} = {d}.`),
    details: R`<p><b>No es un cálculo, es una reinterpretación.</b> Dividir en cabezas no cambia ningún número: solo agrupa columnas. La cabeza \(h\) usa las columnas \((h-1)d_k\) a \(h\,d_k-1\) (contando desde 0) de \(Q\), \(K\) y \(V\). Ojo con la notación: en \(d_k = d/h\), \(h\) es el <em>número</em> de cabezas; en \(Q_h\), el <em>índice</em> de una cabeza concreta.</p>
<p><b>Por qué varias cabezas.</b> Una sola cabeza produce una única distribución de atención por token. Con varias, cada una puede fijarse en algo distinto. El coste total es el mismo que el de una cabeza grande, porque \(h\cdot d_k = d\) (ver la derivación «¿Por qué varias cabezas?»).</p>
<p><b>Independencia.</b> Desde aquí hasta la concatenación, cada cabeza calcula sus puntuaciones, su softmax y su mezcla sin mirar a las demás. En las implementaciones reales se hace con un <code>reshape</code> a \((h, T, d_k)\) y productos de matrices por lotes.</p>
<p><b>Restricción.</b> \(h\) debe dividir a \(d\); por eso la pestaña «Datos y modelo» comprueba esa condición antes de reiniciar.</p>`,
    code: `Qh = Q.reshape(T, h, dk).transpose(1, 0, 2)   # (h, T, dk); igual con K y V
# cabeza i (desde 0): Q[:, i*dk:(i+1)*dk]`,
  };

  steps['fwd.attn.scores'] = {
    title: 'Puntuaciones de atención Q·Kᵀ',
    summary: 'Cada consulta se compara con cada clave mediante un producto escalar, lo que da una matriz T×T de compatibilidades.',
    intuition: R`<p>La entrada \((i,j)\) de \(S_h\) responde a la pregunta «¿cuánto le interesa al token \(i\) el token \(j\)?». Se calcula como el producto escalar \(\mathbf q_i\cdot\mathbf k_j\): grande y positivo cuando los dos vectores apuntan en direcciones parecidas, cercano a cero cuando son perpendiculares y negativo cuando se oponen. Es como un buscador: la consulta es lo que escribes y cada clave es la etiqueta de un documento.</p>`,
    math: [
      R`S_h = Q_h\,K_h^{\top}`,
      R`(S_h)_{ij} = \mathbf q_i\cdot\mathbf k_j = \sum_{m=1}^{d_k}(Q_h)_{im}\,(K_h)_{jm}`,
    ],
    shapes: dims(R`(T\times d_k)\cdot(d_k\times T)\to(T\times T)`,
      R`<code>{T}×{dk}</code> · <code>{dk}×{T}</code> → <code>{T}×{T}</code> (cabeza {hd} de {h}); {T}·{T}·{dk} operaciones de multiplicar y sumar`,
      R`La dimensión \(d_k\) se contrae: el resultado ya no habla de características sino de <b>pares de posiciones</b>. Filas = consultas (quién mira); columnas = claves (a quién mira).`),
    details: R`<p><b>Qué significan los números.</b> La fila \(i\) contiene la compatibilidad de la consulta del token \(i\) con las claves de <em>todos</em> los tokens. Un valor alto y positivo (naranja) significa «me interesa mucho»; uno negativo (azul), «no me interesa». Solo importan las diferencias dentro de cada fila, porque el softmax las convertirá en proporciones.</p>
<p><b>También se calcula el futuro.</b> Aunque el token \(i\) no debe ver a los tokens \(j\gt i\), el producto de matrices calcula de golpe la matriz \(T\times T\) completa, porque es más eficiente; el triángulo superior se anulará en el paso de la máscara.</p>
<p><b>Coste cuadrático.</b> El número de operaciones es \(T^2 d_k\) por cabeza: duplicar la longitud del contexto cuadruplica este coste. Es la razón principal por la que los transformers tienen ventanas de contexto limitadas.</p>
<p><b>Error típico.</b> Trasponer el operando equivocado. \(Q_hK_h\) en general ni siquiera encaja, pero \(Q_h^{\top}K_h\) sí encaja y da una matriz \(d_k\times d_k\): una matriz de características, no de posiciones.</p>`,
    code: `S = Qh @ Kh.T                   # (T, dk) @ (dk, T) -> (T, T)`,
  };

  steps['fwd.attn.scale'] = {
    title: 'Escalado por √dₖ',
    summary: 'Las puntuaciones se dividen por √d_k para que su tamaño no crezca con la dimensión de las cabezas y el softmax no se sature.',
    intuition: R`<p>Un producto escalar suma \(d_k\) términos, así que cuantas más dimensiones tienen las consultas y las claves, mayores tienden a ser las puntuaciones. Si son muy grandes, el softmax elige casi siempre una sola clave con probabilidad ≈ 1 y deja de aprender (sus derivadas casi se anulan). Dividir por \(\sqrt{d_k}\) es como bajar el volumen a un nivel en el que el softmax sigue siendo sensible a las diferencias.</p>`,
    math: [
      R`\tilde S_h = \frac{S_h}{\sqrt{d_k}}`,
      R`\operatorname{Var}(\mathbf q\cdot\mathbf k) = \sum_{m=1}^{d_k}\operatorname{Var}(q_mk_m) = d_k\ \ \Longrightarrow\ \ \operatorname{Var}\!\Big(\frac{\mathbf q\cdot\mathbf k}{\sqrt{d_k}}\Big) = 1`,
    ],
    shapes: dims(R`(T\times T)\to(T\times T)`,
      R`<code>{T}×{T}</code> → <code>{T}×{T}</code>, multiplicando cada entrada por \(1/\sqrt{ {dk} }\)`,
      R`Un único escalar multiplica toda la matriz: la forma no cambia.`),
    details: R`<p><b>De dónde sale \(\sqrt{d_k}\).</b> Supón que las componentes de \(\mathbf q\) y \(\mathbf k\) son independientes, de media 0 y varianza 1. Cada producto \(q_mk_m\) tiene media 0 y varianza 1, y la suma de \(d_k\) de ellos tiene varianza \(d_k\), es decir, desviación típica \(\sqrt{d_k}\). Dividir por \(\sqrt{d_k}\) devuelve la varianza a 1.</p>
<p><b>Por qué importa.</b> Con puntuaciones grandes, el softmax se satura: casi toda la probabilidad cae en una clave y las derivadas \(A_{ij}(1-A_{ij})\) se hacen diminutas, así que el modelo deja de aprender a quién mirar.</p>
<p><b>En este modelo</b> \(d_k = {dk}\) y el factor es \(1/\sqrt{ {dk} }\), de modo que el efecto es moderado; con \(d_k = 64\) (GPT-2) el factor es \(1/8\) y resulta imprescindible.</p>
<p><b>Visto como temperatura.</b> Dividir las puntuaciones antes del softmax equivale a usar una temperatura \(\tau = \sqrt{d_k}\).</p>
<p><b>Error típico.</b> Dividir por \(d_k\) en lugar de por \(\sqrt{d_k}\), u olvidar el mismo factor en el backward (\(\mathrm dS_h = \mathrm d\tilde S_h/\sqrt{d_k}\)).</p>`,
    code: `S_tilde = S / np.sqrt(dk)       # (T, T)`,
  };

  steps['fwd.attn.mask'] = {
    title: 'Máscara causal',
    summary: 'Se suma −∞ a las posiciones futuras (j > i) para que ningún token pueda mirar a los que vienen después.',
    intuition: R`<p>Durante el entrenamiento procesamos toda la frase a la vez, pero la posición \(i\) debe predecir el token siguiente usando solo lo que ya «se ha dicho». Si pudiera mirar hacia delante, copiaría la respuesta y no aprendería nada útil para generar texto. La máscara tapa el triángulo superior de la matriz: tras el softmax, \(e^{-\infty} = 0\), así que esas posiciones reciben peso exactamente cero. Es como hacer un examen tapando con una hoja las respuestas que vienen después.</p>`,
    math: [
      R`\hat S_h = \tilde S_h + M`,
      R`M_{ij} = \begin{cases} 0 & j \le i\\ -\infty & j > i\end{cases}`,
    ],
    shapes: dims(R`(T\times T) + (T\times T)\to(T\times T)`,
      R`<code>{T}×{T}</code> + <code>{T}×{T}</code> → <code>{T}×{T}</code>`,
      R`\(M\) es una constante triangular (no se aprende). La fila \(i\) deja visibles las columnas \(0,\dots,i\): el primer token (<code>&lt;s&gt;</code>) solo se ve a sí mismo y el último ve los {T} tokens.`),
    details: R`<p><b>Por qué \(-\infty\) y no 0.</b> Sumar 0 no cambiaría nada. Tampoco sirve anular los pesos <em>después</em> del softmax: la fila ya no sumaría 1. Sumar \(-\infty\) <em>antes</em> hace que \(e^{-\infty} = 0\) y que el softmax reparta el 100 % de la atención solo entre las posiciones visibles.</p>
<p><b>Entrenamiento en paralelo.</b> Gracias a la máscara, una única pasada produce \(T\) predicciones a la vez: la fila \(i\) se comporta exactamente como si la frase terminara en el token \(i\). Sin ella tendríamos que ejecutar el modelo \(T\) veces, una por prefijo.</p>
<p><b>Coherencia con la generación.</b> Al generar texto el modelo solo dispone del pasado; la máscara garantiza que durante el entrenamiento se enfrenta exactamente a la misma situación.</p>
<p><b>Detalles numéricos.</b> Ninguna fila queda completamente tapada, porque la diagonal (\(j = i\)) siempre es visible; si lo estuviera, el softmax daría \(0/0\). Muchas implementaciones usan un número muy negativo (\(-10^9\)) en vez de \(-\infty\). En los mapas de calor, las celdas rayadas son \(-\infty\).</p>`,
    code: `M = np.triu(np.full((T, T), -np.inf), k=1)   # -inf por encima de la diagonal
S_hat = S_tilde + M`,
  };

  steps['fwd.attn.softmax'] = {
    title: 'Softmax de atención',
    summary: 'Cada fila de puntuaciones se convierte en una distribución de probabilidad: pesos positivos que suman 1 y dicen cuánto atiende cada token a cada uno de los anteriores.',
    intuition: R`<p>El softmax hace dos cosas: exponencia (todo pasa a ser positivo y las diferencias se amplifican) y normaliza (cada fila suma 1). La fila \(i\) de \(A_h\) es el <b>presupuesto de atención</b> del token \(i\): el 100 % repartido entre los tokens que puede ver. En los mapas violetas, cuanto más intenso el color de la celda, más atención.</p>`,
    math: [
      R`A_h = \operatorname{softmax}_{\text{fila}}(\hat S_h)`,
      R`(A_h)_{ij} = \frac{e^{(\hat S_h)_{ij}}}{\sum_{k\le i} e^{(\hat S_h)_{ik}}}\ \text{ si } j\le i,\qquad (A_h)_{ij} = 0\ \text{ si } j > i`,
      R`\sum_j (A_h)_{ij} = 1,\qquad (A_h)_{ij}\ge 0`,
    ],
    shapes: dims(R`(T\times T)\to(T\times T)`,
      R`<code>{T}×{T}</code> → <code>{T}×{T}</code> (cabeza {hd})`,
      R`Se normaliza cada fila por separado. Cálculos auxiliares: el máximo de cada fila (\(T\times 1\)), las exponenciales (\(T\times T\)) y la suma de cada fila (\(T\times 1\)).`),
    details: R`<p><b>Qué significan los números.</b> \((A_h)_{ij}\) es la fracción de atención que el token \(i\) dedica al token \(j\). Cada fila suma 1 y las entradas enmascaradas valen exactamente 0. La primera fila siempre es \([1, 0, \dots, 0]\): el token <code>&lt;s&gt;</code> solo puede mirarse a sí mismo.</p>
<p><b>Antes y después de entrenar.</b> Al principio las puntuaciones se parecen y cada fila es casi uniforme: el token en la posición \(t\) (contando desde 1) reparte aproximadamente \(1/t\) a cada una de sus \(t\) posiciones visibles. Tras entrenar, verás filas concentradas: la fila de «come» debería cargar su peso en «gato» o «perro», que es lo que decide entre «pescado» y «carne».</p>
<p><b>Estabilidad numérica.</b> Se resta el máximo de cada fila antes de exponenciar. El resultado no cambia (el factor \(e^{-\max}\) se cancela entre numerador y denominador), pero se evita que \(e^{s}\) se desborde.</p>
<p><b>Error típico.</b> Normalizar por columnas en vez de por filas: entonces serían las claves, y no las consultas, las que repartirían su presupuesto.</p>`,
    code: `e = np.exp(S_hat - S_hat.max(1, keepdims=True))   # exp(-inf) = 0
A = e / e.sum(1, keepdims=True)                    # cada fila suma 1`,
  };

  steps['fwd.attn.context'] = {
    title: 'Mezcla de valores (A·V)',
    summary: 'Cada token obtiene su nuevo vector como una media ponderada de los valores de los tokens a los que atiende.',
    intuition: R`<p>Aquí la atención por fin «trae» información: la fila \(i\) de \(Z_h\) es la suma de los valores de los tokens visibles, cada uno multiplicado por el peso que el token \(i\) le dio. Si «come» atiende casi solo a «gato», su nueva fila será prácticamente el valor de «gato». Es como preparar una mezcla siguiendo una receta: \(A_h\) dice las proporciones y \(V_h\) aporta los ingredientes.</p>`,
    math: [
      R`Z_h = A_h\,V_h`,
      R`(Z_h)_{i,:} = \sum_{j\le i}(A_h)_{ij}\,(V_h)_{j,:}`,
    ],
    shapes: dims(R`(T\times T)\cdot(T\times d_k)\to(T\times d_k)`,
      R`<code>{T}×{T}</code> · <code>{T}×{dk}</code> → <code>{T}×{dk}</code> (cabeza {hd}); {T}·{T}·{dk} operaciones de multiplicar y sumar`,
      R`La dimensión que se contrae es \(T\) (las claves), no una dimensión de características: \((A_h)_{ij}\) multiplica a la fila \(j\) de \(V_h\).`),
    details: R`<p><b>El único paso que mezcla posiciones.</b> En todo el transformer, este es el único lugar donde la información viaja de un token a otro: LayerNorm, las proyecciones y la FFN actúan fila a fila. Gracias a este paso, el vector de «come» puede «saber» quién es el sujeto, y la FFN y la capa de salida podrán predecir «pescado» o «carne».</p>
<p><b>Media ponderada.</b> Como los pesos de cada fila son positivos y suman 1, cada fila de \(Z_h\) es una combinación convexa de los valores visibles: queda «dentro» de la nube de puntos que forman. La atención elige y mezcla; no inventa direcciones nuevas (eso lo harán \(W_O\) y la FFN).</p>
<p><b>Causalidad.</b> Como \((A_h)_{ij} = 0\) para \(j\gt i\), la fila \(i\) de \(Z_h\) solo depende de los tokens \(0,\dots,i\). La primera fila es exactamente el valor de <code>&lt;s&gt;</code>.</p>
<p><b>Error típico.</b> Multiplicar en el orden inverso (\(V_hA_h\)): ni siquiera encaja, \((T\times d_k)(T\times T)\).</p>`,
    code: `Zh = A @ Vh                     # (T, T) @ (T, dk) -> (T, dk)`,
  };

  steps['fwd.attn.concat'] = {
    title: 'Concatenar cabezas',
    summary: 'Las salidas de las h cabezas se colocan una al lado de otra para recuperar una matriz T×d.',
    intuition: R`<p>Cada cabeza ha producido su propio resumen de \(d_k\) columnas por token. Concatenarlas es simplemente ponerlas lado a lado, como juntar los informes de varios lectores en un solo expediente. Es la operación inversa de la división en cabezas.</p>`,
    math: [
      R`Z = [\,Z_1\,\|\,Z_2\,\|\,\cdots\,\|\,Z_h\,]`,
      R`Z_{:,\,(h-1)d_k\,:\,h\,d_k} = Z_h`,
    ],
    shapes: dims(R`h\times(T\times d_k)\to(T\times h\,d_k) = (T\times d)`,
      R`{h} bloques de <code>{T}×{dk}</code> → <code>{T}×{d}</code>`,
      R`\(Z\) vuelve a tener la forma \(T\times d\) del flujo residual.`),
    details: R`<p><b>Una operación sin aritmética.</b> Concatenar solo coloca los números: las columnas \(0\) a \(d_k-1\) de \(Z\) son \(Z_1\), las \(d_k\) siguientes son \(Z_2\), y así sucesivamente. No se suma ni se multiplica nada.</p>
<p><b>Las cabezas siguen separadas.</b> Tras concatenar, cada bloque de columnas contiene todavía lo que encontró una sola cabeza. Nada combina aún la información de cabezas distintas: de eso se encarga la proyección \(W_O\) del paso siguiente.</p>
<p><b>Error típico.</b> Concatenar a lo largo del eje equivocado (las filas) daría una matriz de \(hT\times d_k\), que no encajaría con \(W_O\). En código suele hacerse con <code>transpose</code> + <code>reshape</code>, y el orden de los ejes importa: un <code>reshape</code> sin trasponer antes mezclaría tokens y cabezas.</p>`,
    code: `Z = np.concatenate(Z_heads, axis=1)   # [Z1 | Z2 | …] -> (T, h*dk) = (T, d)`,
  };

  steps['fwd.attn.proj'] = {
    title: 'Proyección de salida W_O',
    summary: 'Una multiplicación por W_O mezcla la información de todas las cabezas y la devuelve al espacio del flujo residual.',
    intuition: R`<p>\(W_O\) es la «mesa de mezclas» de la atención: toma los hallazgos de todas las cabezas y decide cómo escribirlos en el vector de cada token. Gracias a ella, lo que encontró la cabeza 1 puede combinarse con lo que encontró la cabeza 2 y escribirse en cualquier dirección del espacio de \(d\) dimensiones.</p>`,
    math: [
      R`O = Z\,W_O`,
      R`O = \sum_{\text{cabezas } h} Z_h\,W_O^{(h)},\qquad W_O^{(h)} = (W_O)_{(h-1)d_k\,:\,h\,d_k,\ :}`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> · <code>{d}×{d}</code> → <code>{T}×{d}</code>`,
      R`La salida tiene la forma del flujo residual, condición necesaria para poder sumarla en el paso siguiente.`),
    details: R`<p><b>Mezclar cabezas.</b> Si partimos \(W_O\) en bloques de \(d_k\) filas, uno por cabeza, el producto se descompone en una suma:</p>
\[O = Z\,W_O = \sum_{\text{cabezas } h} Z_h\,W_O^{(h)}.\]
<p>Cada cabeza «escribe» en el flujo residual a través de su propio bloque de \(W_O\) y las contribuciones se suman. Así, cada cabeza puede escribir en cualquier dirección de \(\mathbb R^d\), no solo en sus \(d_k\) columnas.</p>
<p><b>Por qué hace falta.</b> Sin \(W_O\), lo que encuentra la cabeza 1 quedaría siempre en las mismas columnas del flujo residual, que quizá la FFN necesita para otra cosa. \(W_O\) aprende dónde conviene escribir cada hallazgo.</p>
<p><b>Parámetros.</b> \(d^2 = {d}\cdot {d}\) pesos, sin sesgo. Junto con \(W_Q\), \(W_K\) y \(W_V\), la atención tiene \(4d^2\) parámetros por capa.</p>`,
    code: `O = Z @ Wo                      # (T, d) @ (d, d) -> (T, d)`,
  };

  steps['fwd.res1'] = {
    title: 'Conexión residual 1',
    summary: 'La salida de la atención se suma a la entrada de la capa: R = X + O.',
    intuition: R`<p>La atención no sustituye la representación del token: le <b>añade</b> una corrección, como una nota al margen. Una buena imagen es el <b>flujo residual</b>: una pizarra compartida de \(d\) números por token que cada subcapa lee (a través de su LayerNorm) y en la que escribe sumando su resultado. Si una subcapa no tiene nada útil que aportar, basta con que su salida sea casi cero y el token sigue tal cual.</p>`,
    math: [
      R`R = X^{[l-1]} + O`,
      R`\mathbf r_t = \mathbf x_t + \mathbf o_t\qquad (t = 1,\dots,T)`,
    ],
    shapes: dims(R`(T\times d) + (T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> + <code>{T}×{d}</code> → <code>{T}×{d}</code>`,
      R`Para poder sumar, la salida de la subcapa debe tener exactamente la forma de su entrada.`),
    details: R`<p><b>Por qué funciona tan bien.</b> Las redes profundas sin atajos son difíciles de entrenar: la señal (y el gradiente) atraviesa muchas transformaciones y se deforma. Con la suma, la salida es «identidad + corrección», y cada subcapa solo tiene que aprender la corrección. Es la idea de las redes residuales (ResNet).</p>
<p><b>La otra cara: el backward.</b> La derivada de una suma respecto de cada sumando es 1, así que en el backward el gradiente llegará <em>sin modificar</em>, por el atajo, hasta \(X^{[l-1]}\). Es una autopista para el gradiente (ver el paso «Residual 1» del backward).</p>
<p><b>Formas.</b> Por eso la atención termina con \(W_O\in\mathbb R^{d\times d}\) y la FFN vuelve de \(d_{\text{ff}}\) a \(d\): las dos ramas deben devolver \(T\times d\).</p>
<p><b>Pre-LN.</b> Se suma la entrada <em>sin normalizar</em>, \(X^{[l-1]}\), no \(H\): la normalización solo afecta a lo que entra en la rama.</p>`,
    code: `R = X + O                       # (T, d)`,
  };

  // ── Forward: bloque FFN ──
  steps['fwd.ln2'] = {
    title: 'LayerNorm 2 (antes de la FFN)',
    summary: 'Cada fila de R se normaliza antes de pasar a la red feed-forward, con sus propios parámetros γ₂ y β₂.',
    intuition: R`<p>Es la misma operación que LayerNorm 1, ahora sobre \(R\), que ya contiene el contexto aportado por la atención. La FFN recibe así cada token en una escala controlada. El flujo residual \(R\) no se modifica: la versión normalizada \(H'\) solo alimenta a la FFN.</p>`,
    math: [
      R`\mu_t = \frac1d\sum_{j=1}^d R_{tj},\qquad \sigma_t^2 = \frac1d\sum_{j=1}^d (R_{tj}-\mu_t)^2`,
      R`H' = \mathrm{LN}_2(R) = \gamma_2\odot\frac{R-\mu}{\sqrt{\sigma^2+\varepsilon}} + \beta_2`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> → <code>{T}×{d}</code>; \(\mu,\sigma^2\): <code>{T}×1</code>; \(\gamma_2,\beta_2\): <code>1×{d}</code>`,
      R`Las estadísticas son por fila (una por token); \(\gamma_2\) y \(\beta_2\) se aplican por columna a todas las filas.`),
    details: R`<p><b>La misma operación, otros parámetros.</b> LN₂ calcula exactamente lo mismo que LN₁, pero sobre \(R\) y con sus propios \(\gamma_2\) y \(\beta_2\). Cada subcapa necesita su propia escala: lo que conviene destacar para buscar relaciones (atención) no tiene por qué ser lo que conviene destacar para transformar cada token (FFN).</p>
<p><b>Qué ha cambiado en la entrada.</b> Las filas de \(R\) ya contienen información de contexto, y su escala ha cambiado al sumar \(O\). LN₂ devuelve cada fila a media 0 y varianza 1, para que la FFN reciba siempre entradas en una escala parecida, independientemente de cuánto haya escrito la atención.</p>
<p><b>Difusión.</b> \(\mu\) y \(\sigma^2\) (\(T\times 1\)) se restan y dividen a lo ancho de cada fila; \(\gamma_2\) y \(\beta_2\) (\(1\times d\)) se aplican a lo alto de cada columna. En el backward, cada difusión se convertirá en una suma.</p>
<p><b>El residual no se toca.</b> Al final de la capa se sumará \(F\) a \(R\), no a \(H'\).</p>`,
    code: `mu = R.mean(1, keepdims=True); var = R.var(1, keepdims=True)
H2 = gamma2 * (R - mu) / np.sqrt(var + eps) + beta2   # H' (T, d)`,
  };

  steps['fwd.ffn1'] = {
    title: 'FFN: primera capa lineal (expansión)',
    summary: 'Cada token se proyecta a un espacio más ancho, de d_ff dimensiones, con W_1, y se le suma el sesgo b_1.',
    intuition: R`<p>Si la atención es el momento de <b>reunir información</b> de otros tokens, la FFN es el momento de <b>procesarla</b>, token a token. Esta primera capa lineal expande cada vector de \(d\) a \(d_{\text{ff}}\) dimensiones: cada columna de \(W_1\) actúa como un detector de un patrón («¿el sujeto es un gato y el verbo es comer?») y \(b_1\) fija su umbral. Más dimensiones significan sitio para más detectores distintos.</p>`,
    math: [
      R`U = H'\,W_1 + \mathbf 1\,b_1`,
      R`U_{tk} = \sum_{j=1}^d H'_{tj}\,(W_1)_{jk} + (b_1)_k`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d_{\text{ff}}) + (1\times d_{\text{ff}})\to(T\times d_{\text{ff}})`,
      R`<code>{T}×{d}</code> · <code>{d}×{dff}</code> + <code>1×{dff}</code> → <code>{T}×{dff}</code>`,
      R`El sesgo \(1\times d_{\text{ff}}\) se difunde (se repite) en las {T} filas. Coste: {T}·{d}·{dff} operaciones de multiplicar y sumar.`),
    details: R`<p><b>Difusión del sesgo.</b> \(b_1\) es un vector fila de \(1\times d_{\text{ff}}\), pero \(H'W_1\) tiene \(T\) filas: se suma el mismo sesgo a cada fila. Formalmente es \(\mathbf 1\,b_1\), con \(\mathbf 1\in\mathbb R^{T\times 1}\) una columna de unos. Escribirlo así deja claro por qué, en el backward, su gradiente será una suma sobre las filas: \(\mathrm db_1 = \mathbf 1^{\top}\mathrm dU\).</p>
<p><b>Token a token.</b> Como en las proyecciones de la atención, cada fila se transforma de forma independiente: la FFN no mezcla posiciones. Es un pequeño perceptrón multicapa (MLP) aplicado a cada token con los mismos pesos.</p>
<p><b>Qué significan los números.</b> \(U_{tk}\) es la «preactivación» de la neurona \(k\) para el token \(t\): positiva si el patrón que detecta está presente (supera su umbral) y negativa si no. La activación del paso siguiente decidirá qué neuronas se encienden.</p>
<p><b>Tamaño.</b> \(W_1\) tiene {d}·{dff} pesos y \(b_1\), otros {dff}. Lo habitual es \(d_{\text{ff}} = 4d\).</p>`,
    code: `U = H2 @ W1 + b1                # (T, d) @ (d, dff) + (1, dff) -> (T, dff)`,
  };

  steps['fwd.act'] = {
    title: 'Activación no lineal (ReLU / GELU)',
    summary: 'Se aplica una función no lineal a cada entrada de U; sin ella, toda la FFN sería una única transformación lineal.',
    intuition: R`<p>Sin una no linealidad, dos capas lineales seguidas equivalen a una sola: \((H'W_1)W_2 = H'(W_1W_2)\). La activación rompe esa linealidad y es lo que permite a la red representar funciones complicadas. <b>ReLU</b> funciona como un interruptor: deja pasar los valores positivos y apaga los negativos. <b>GELU</b> es una versión suave del mismo interruptor.</p>`,
    math: [
      R`G = f(U)\quad\text{(elemento a elemento)}`,
      R`\mathrm{ReLU}(u) = \max(0, u)`,
      R`\mathrm{GELU}(u) \approx \tfrac12\,u\,\Big(1+\tanh\!\big(\sqrt{2/\pi}\,(u + 0.044715\,u^3)\big)\Big)`,
    ],
    shapes: dims(R`(T\times d_{\text{ff}})\to(T\times d_{\text{ff}})`,
      R`<code>{T}×{dff}</code> → <code>{T}×{dff}</code>`,
      R`Cada entrada se transforma sin mirar a las demás: la forma no cambia.`),
    details: R`<p><b>ReLU.</b> \(\max(0,u)\). En el mapa de calor de \(G\) verás muchas celdas exactamente a 0: neuronas apagadas para ese token. Esa dispersión es útil, porque cada token activa solo un subconjunto de detectores. Su riesgo son las <em>neuronas muertas</em>: si una neurona da \(u\le 0\) para todas las entradas, su derivada es siempre 0 y nunca vuelve a aprender.</p>
<p><b>GELU.</b> Es \(u\,\Phi(u)\), donde \(\Phi\) es la función de distribución de la normal estándar: multiplica cada valor por la probabilidad de que «supere al ruido». Para \(u\) muy positivo se comporta como \(u\); para \(u\) muy negativo, como 0; cerca de 0 es suave y deja pasar un poco de los negativos (su mínimo es ≈ −0.17). Aquí se usa la aproximación con \(\tanh\) de GPT-2.</p>
<p><b>Elemento a elemento.</b> Como cada salida depende de una sola entrada, en el backward la derivada será un simple producto elemento a elemento: \(\mathrm dU = \mathrm dG\odot f'(U)\).</p>
<p><b>Error típico.</b> Aplicar también una activación después de \(W_2\): la salida de la FFN debe ser lineal para poder escribir valores positivos y negativos en el flujo residual.</p>`,
    code: `G = np.maximum(0, U)            # ReLU
# GELU: G = 0.5*U*(1 + np.tanh(np.sqrt(2/np.pi)*(U + 0.044715*U**3)))`,
  };

  steps['fwd.ffn2'] = {
    title: 'FFN: segunda capa lineal (compresión)',
    summary: 'Las d_ff activaciones de cada token se combinan con W_2 (más el sesgo b_2) para volver a d dimensiones.',
    intuition: R`<p>Cada neurona \(k\) tiene asociada una fila de \(W_2\): la dirección que «escribe» en el flujo residual cuando se activa. La salida de un token es la suma de las direcciones de sus neuronas encendidas, cada una multiplicada por su intensidad. Juntas, \(W_1\) y \(W_2\) funcionan como una memoria clave–valor: \(W_1\) reconoce un patrón y \(W_2\) dice qué añadir cuando aparece.</p>`,
    math: [
      R`F = G\,W_2 + \mathbf 1\,b_2`,
      R`F_{t,:} = \sum_{k=1}^{d_{\text{ff}}} G_{tk}\,(W_2)_{k,:} + b_2`,
    ],
    shapes: dims(R`(T\times d_{\text{ff}})\cdot(d_{\text{ff}}\times d) + (1\times d)\to(T\times d)`,
      R`<code>{T}×{dff}</code> · <code>{dff}×{d}</code> + <code>1×{d}</code> → <code>{T}×{d}</code>`,
      R`Se contrae \(d_{\text{ff}}\) y se vuelve a la anchura \(d\) del flujo residual.`),
    details: R`<p><b>Vuelta a la dimensión del modelo.</b> La contracción es sobre \(d_{\text{ff}}\): \(F_{tj} = \sum_k G_{tk}(W_2)_{kj} + (b_2)_j\). El resultado tiene la forma \(T\times d\) y se podrá sumar a \(R\).</p>
<p><b>Solo escriben las neuronas activas.</b> Con ReLU, las neuronas con \(G_{tk} = 0\) no aportan nada a la fila \(t\): cada token recibe la suma de las direcciones de sus detectores encendidos.</p>
<p><b>Inicialización.</b> Como cada salida suma \(d_{\text{ff}}\) términos, los pesos se inicializan con varianza \(1/d_{\text{ff}}\) para que \(F\) no crezca con el ancho de la capa.</p>
<p><b>Dónde están los parámetros.</b> \(W_1\) y \(W_2\) suman \(2\,d\,d_{\text{ff}} = 8d^2\) pesos cuando \(d_{\text{ff}} = 4d\): el doble que toda la atención (\(4d^2\)). En los modelos grandes, buena parte del «conocimiento» memorizado vive en las FFN.</p>
<p><b>Sesgo \(b_2\).</b> Se difunde a las \(T\) filas igual que \(b_1\); su gradiente será una suma por filas.</p>`,
    code: `F = G @ W2 + b2                 # (T, dff) @ (dff, d) + (1, d) -> (T, d)`,
  };

  steps['fwd.res2'] = {
    title: 'Conexión residual 2 (salida de la capa)',
    summary: 'La salida de la FFN se suma al flujo residual y se obtiene la salida de la capa {l}.',
    intuition: R`<p>Segunda nota al margen: la corrección de la FFN se suma al flujo residual. Si desplegamos las dos sumas se ve la estructura completa de la capa: la salida es la entrada, más lo que aportó la atención, más lo que aportó la FFN. Con más de una capa, este resultado es la entrada de la siguiente, que volverá a leer y escribir en la misma pizarra.</p>`,
    math: [
      R`X^{[l]} = R + F`,
      R`X^{[l]} = X^{[l-1]} + \underbrace{O}_{\text{atención}} + \underbrace{F}_{\text{FFN}}`,
    ],
    shapes: dims(R`(T\times d) + (T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> + <code>{T}×{d}</code> → <code>{T}×{d}</code>`,
      R`La capa entera conserva la forma \(T\times d\): por eso se pueden apilar tantas capas como se quiera.`),
    details: R`<p><b>El flujo residual completo.</b> Desplegando todas las capas,</p>
\[X^{[N]} = X^{[0]} + \sum_{l=1}^N \big(O^{[l]} + F^{[l]}\big):\]
<p>la representación final es la suma del embedding con su posición y de las contribuciones de todas las subcapas. Esta vista aditiva es muy útil para interpretar transformers: cada subcapa lee el estado acumulado y le añade algo.</p>
<p><b>Qué observar.</b> Compara el mapa de calor de \(X^{[l]}\) con el de \(X^{[l-1]}\): la diferencia es exactamente \(O + F\), lo que han escrito las dos subcapas. Ya desde el principio esas correcciones no son despreciables (los pesos aleatorios también escriben algo), y a medida que el modelo aprende suelen crecer y volverse más útiles.</p>
<p><b>Error típico.</b> Sumar \(F\) a \(H'\) (la versión normalizada) en lugar de a \(R\). Eso rompería el atajo: el flujo residual quedaría normalizado en cada capa, algo parecido a la variante «post-LN» del artículo original, que es más delicada de entrenar.</p>`,
    code: `X1 = R + F                      # salida de la capa: entrada de la siguiente (o de LN_f)`,
  };

  // ── Forward: salida ──
  steps['fwd.lnf'] = {
    title: 'LayerNorm final',
    summary: 'Tras la última capa se normaliza cada fila una vez más (con γ_f y β_f) antes de calcular las puntuaciones del vocabulario.',
    intuition: R`<p>En la arquitectura pre-LN el flujo residual nunca se normaliza dentro de las capas: solo se normaliza lo que entra en cada rama. Tras sumar las contribuciones de todas las capas (aquí, {N}), su escala puede haber crecido. La LayerNorm final lo pone todo en una escala común antes de convertir cada vector en puntuaciones sobre el vocabulario.</p>`,
    math: [
      R`H_f = \mathrm{LN}_f\big(X^{[N]}\big) = \gamma_f\odot\hat X^{[N]} + \beta_f`,
      R`\hat X^{[N]}_{t,:} = \frac{X^{[N]}_{t,:}-\mu_t}{\sqrt{\sigma_t^2+\varepsilon}}`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> → <code>{T}×{d}</code>; \(\gamma_f,\beta_f\): <code>1×{d}</code>`,
      R`Estadísticas por fila, como en las otras LayerNorm.`),
    details: R`<p><b>Por qué hace falta.</b> GPT-2 añadió esta normalización al pasar a pre-LN: sin ella, el tamaño de los logits dependería de cuántas correcciones hayan sumado las capas, y la confianza de las predicciones sería difícil de controlar.</p>
<p><b>El papel de \(\gamma_f\).</b> Como el paso siguiente es lineal (\(H_fW_{\text{out}}\)), escalar \(\gamma_f\) escala directamente los logits: \(\gamma_f\) funciona en parte como una «temperatura» aprendida para cada característica. \(\beta_f\) suma a todos los tokens el mismo vector, que se traduce en un sesgo común sobre el vocabulario (\(\beta_fW_{\text{out}}\)): por ejemplo, hacer más probables en general «el» o «.».</p>
<p><b>Qué observar.</b> Con \(\gamma_f = 1\) y \(\beta_f = 0\) (valores iniciales), cada fila de \(H_f\) tiene media 0 y varianza ≈ 1, sea cual sea la escala de \(X^{[N]}\). Esta es la representación final de cada posición: todo lo que el modelo «sabe» para predecir el siguiente token está en esos \(d\) números.</p>`,
    code: `mu = XN.mean(1, keepdims=True); var = XN.var(1, keepdims=True)
Hf = gamma_f * (XN - mu) / np.sqrt(var + eps) + beta_f   # (T, d)`,
  };

  steps['fwd.logits'] = {
    title: 'Logits: proyección al vocabulario',
    summary: 'Cada fila de H_f se multiplica por W_out para obtener una puntuación (logit) para cada palabra del vocabulario.',
    intuition: R`<p>Cada columna \(j\) de \(W_{\text{out}}\) es como un «retrato» de la palabra \(j\). El logit de la palabra \(j\) en la posición \(t\) es el producto escalar entre el vector final del token y ese retrato: mide cuánto «vota» el modelo por esa palabra como la siguiente. La fila \(t\) de los logits contiene los votos para la palabra que debe seguir al token \(t\).</p>`,
    math: [
      R`\mathrm{logits} = H_f\,W_{\text{out}}`,
      R`\mathrm{logits}_{tj} = \mathbf h_{f,t}\cdot (W_{\text{out}})_{:,j}`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times V)\to(T\times V)`,
      R`<code>{T}×{d}</code> · <code>{d}×{V}</code> → <code>{T}×{V}</code>; {T}·{d}·{V} operaciones de multiplicar y sumar`,
      R`Cada fila pasa de \(d\) características a \(V\) puntuaciones, una por palabra del vocabulario (las columnas llevan su nombre).`),
    details: R`<p><b>Los logits no son probabilidades.</b> Pueden ser cualquier número real, positivo o negativo, y no suman nada en particular. Solo importan las diferencias dentro de cada fila: sumar la misma constante a una fila entera no cambia las probabilidades del paso siguiente. Se interpretan como log-probabilidades sin normalizar.</p>
<p><b>Sin sesgo y sin pesos compartidos.</b> Aquí \(W_{\text{out}}\) es una matriz propia de \(d\times V\), sin sesgo. Muchos modelos usan <em>weight tying</em> (\(W_{\text{out}} = E^{\top}\)): el mismo vector representa a la palabra a la entrada y a la salida, lo que ahorra \(Vd\) parámetros.</p>
<p><b>Coste.</b> En modelos reales \(V\) es de decenas de miles, y esta proyección es una de las operaciones más caras de todo el modelo.</p>
<p><b>Qué observar.</b> Si la frase es «el gato come pescado .», mira la fila del token «come»: tras entrenar, las columnas «pescado» y «carne» deberían destacar sobre el resto, y la elección entre ellas depende de lo que la atención trajo del sujeto.</p>`,
    code: `logits = Hf @ Wout              # (T, d) @ (d, V) -> (T, V)`,
  };

  steps['fwd.softmax_out'] = {
    title: 'Softmax sobre el vocabulario',
    summary: 'Cada fila de logits se convierte en una distribución de probabilidad sobre las V palabras: la predicción del siguiente token.',
    intuition: R`<p>El mismo softmax de la atención, ahora sobre las \(V\) columnas del vocabulario y sin máscara. \(P_{tj}\) es la probabilidad que el modelo asigna a que la palabra \(j\) siga al token de la fila \(t\), habiendo visto solo ese token y los anteriores. Cada fila es una apuesta completa: el 100 % repartido entre todas las palabras posibles.</p>`,
    math: [
      R`P = \operatorname{softmax}_{\text{fila}}(\mathrm{logits})`,
      R`P_{tj} = \frac{e^{\mathrm{logits}_{tj}}}{\sum_{k=1}^V e^{\mathrm{logits}_{tk}}}`,
    ],
    shapes: dims(R`(T\times V)\to(T\times V)`,
      R`<code>{T}×{V}</code> → <code>{T}×{V}</code>`,
      R`Cada una de las {T} filas suma 1.`),
    details: R`<p><b>Una comprobación útil.</b> Un modelo que no sabe nada asigna \(1/V\) a cada palabra, y su pérdida vale \(\ln V\) (con el vocabulario por defecto, de 22 tokens, \(\ln 22\approx 3.09\)). La pérdida de la primera iteración debería estar cerca de ese valor, algo por encima si los logits iniciales no son pequeños. Si sale mucho mayor, suele haber un error de escala en la inicialización.</p>
<p><b>Estabilidad.</b> Como en la atención, se resta el máximo de cada fila antes de exponenciar. En la práctica, la pérdida se calcula con <em>log-softmax</em> (\(\log P = \mathrm{logits} - \log\sum e^{\mathrm{logits}}\)) para no tomar nunca el logaritmo de un número que se ha redondeado a 0.</p>
<p><b>En la generación.</b> Solo interesa la última fila. Antes del softmax, los logits se dividen por una temperatura \(\tau\): con \(\tau\lt 1\) la distribución se afila (más conservadora) y con \(\tau\gt 1\) se aplana (más variada). Después se elige la palabra más probable o se muestrea.</p>`,
    code: `e = np.exp(logits - logits.max(1, keepdims=True))
P = e / e.sum(1, keepdims=True)                # (T, V), cada fila suma 1`,
  };

  // ── Pérdida ──
  steps['loss.ce'] = {
    title: 'Pérdida de entropía cruzada',
    summary: 'Se mide lo sorprendido que queda el modelo con la palabra correcta: la media de −log de la probabilidad que asignó a cada objetivo.',
    intuition: R`<p>Si el modelo dio probabilidad 1 a la palabra correcta, la pérdida es 0; con probabilidad 0.5, vale 0.69; con 0.01, vale 4.6. El logaritmo castiga con dureza los errores cometidos con mucha confianza. En cada fila solo cuenta la probabilidad de la palabra correcta (la one-hot \(Y\) la selecciona), y se promedia sobre las \(T\) posiciones.</p>`,
    math: [
      R`\mathcal L = -\frac1T\sum_{t=1}^T \log P_{t,\,y_t}`,
      R`\mathcal L = -\frac1T\sum_{t=1}^T\sum_{j=1}^V Y_{tj}\,\log P_{tj}`,
      R`\text{perplejidad} = e^{\mathcal L}`,
    ],
    shapes: dims(R`(T\times V),\ (T\times V)\to(T\times 1)\to(1\times 1)`,
      R`<code>{T}×{V}</code> y <code>{T}×{V}</code> → {T} pérdidas por token → 1 número`,
      R`\(Y\) es la matriz one-hot de los objetivos. Primero se obtiene una pérdida por posición y luego se promedia.`),
    details: R`<p><b>Por qué el logaritmo.</b> La probabilidad que el modelo asigna a la frase completa es el producto de las probabilidades condicionales de cada palabra. Maximizar ese producto equivale a maximizar la suma de sus logaritmos, es decir, a minimizar \(\mathcal L\): entrenar con entropía cruzada es entrenar por <em>máxima verosimilitud</em>. Se usa el logaritmo natural.</p>
<p><b>Solo cuenta la palabra correcta.</b> Las demás probabilidades influyen de forma indirecta: como cada fila suma 1, subir la correcta obliga a bajar las otras.</p>
<p><b>Un suelo que no se puede perforar.</b> Algunas posiciones son ambiguas de verdad: al principio de la frase, tras «el» puede venir «gato», «perro» o «niño». Lo mejor que puede hacer el modelo es repartir la probabilidad (≈ 1/3 a cada una), así que la pérdida nunca llega a 0. Otras son deterministas si se mira atrás: tras «el gato come» siempre viene «pescado». Aprenderlas exige que la atención encuentre el sujeto.</p>
<p><b>Perplejidad.</b> \(e^{\mathcal L}\) es el número efectivo de opciones entre las que el modelo duda: 1 es certeza total; \(V\), no saber nada.</p>`,
    code: `loss = -np.log(P[np.arange(T), y]).mean()     # escalar`,
  };

  // ── Backward: salida ──
  steps['bwd.ce'] = {
    title: 'Gradiente de la pérdida respecto de los logits',
    summary: 'El backward empieza con una fórmula sorprendentemente simple: dlogits = (P − Y) / T.',
    intuition: R`<p>El backward recorre el mismo camino que el forward, pero al revés, calculando para cada tensor cuánto afecta a la pérdida. Empieza con una fórmula muy sencilla: el gradiente de los logits es «lo que predije menos lo que debía predecir». En la palabra correcta vale \((P_{t,y_t}-1)/T\), un número negativo: el descenso por gradiente subirá su logit. En las demás vale \(P_{tj}/T\), positivo: se bajarán, tanto más cuanta más probabilidad se les dio por error.</p>`,
    math: [
      R`\mathrm d\,\mathrm{logits} = \frac1T\,(P - Y)`,
      R`\frac{\partial\mathcal L}{\partial\,\mathrm{logits}_{tj}} = \frac1T\big(P_{tj} - Y_{tj}\big)`,
    ],
    shapes: dims(R`(T\times V) - (T\times V)\to(T\times V)`,
      R`<code>{T}×{V}</code> − <code>{T}×{V}</code> → <code>{T}×{V}</code>, dividido por {T}`,
      R`El gradiente tiene la forma de los logits. Nunca se construye \(\mathrm dP\): la combinación softmax + entropía cruzada se deriva de una sola vez.`),
    details: R`<p><b>Derivación.</b> Para una fila, llamemos \(\mathbf z\) a sus logits e \(y\) a su objetivo. Como \(\log P_y = z_y - \log\sum_k e^{z_k}\), la pérdida de esa posición es</p>
\[\ell = -z_y + \log\sum_k e^{z_k}\quad\Longrightarrow\quad \frac{\partial\ell}{\partial z_j} = -[j = y] + \frac{e^{z_j}}{\sum_k e^{z_k}} = P_j - Y_j,\]
<p>donde \([j = y]\) vale 1 si \(j = y\) y 0 si no. Como \(\mathcal L\) es la media de los \(T\) términos \(\ell_t\), cada fila se divide por \(T\).</p>
<p><b>Por qué no pasar por \(\mathrm dP\).</b> Podríamos calcular \(\mathrm dP = -Y/(T\,P)\) y luego aplicar el jacobiano del softmax, pero dividir por probabilidades diminutas es numéricamente peligroso. Al combinar ambos pasos, los términos se cancelan y queda una resta estable.</p>
<p><b>Propiedades.</b> Cada fila suma 0 (porque \(\sum_j P_{tj} = 1 = \sum_j Y_{tj}\)), coherente con que sumar una constante a una fila de logits no cambie nada. Si el modelo acertara con total seguridad (\(P = Y\)), el gradiente sería 0: no quedaría nada que aprender en esa posición.</p>`,
    code: `dlogits = P.copy()
dlogits[np.arange(T), y] -= 1   # P - Y
dlogits /= T                    # (T, V)`,
  };

  steps['bwd.logits.dW'] = {
    title: 'Gradiente de W_out',
    summary: 'El gradiente de la matriz de salida es dW_out = H_fᵀ · dlogits: suma, sobre todas las posiciones, el producto de lo que entró por el error que salió.',
    intuition: R`<p>Cada peso \((W_{\text{out}})_{kj}\) conecta la característica \(k\) del vector final con la palabra \(j\). Su gradiente suma, sobre todas las posiciones, «cuánto valía la característica \(k\)» por «cuánto error hubo en la palabra \(j\)». Si la característica \(k\) estaba alta en posiciones donde la palabra \(j\) debía ser más probable, ese peso crecerá. Es la regla universal de toda capa lineal: <b>entrada traspuesta por error</b>.</p>`,
    math: [
      R`\mathrm dW_{\text{out}} = H_f^{\top}\,\mathrm d\,\mathrm{logits}`,
      R`(\mathrm dW_{\text{out}})_{kj} = \sum_{t=1}^T (H_f)_{tk}\,(\mathrm d\,\mathrm{logits})_{tj}`,
    ],
    shapes: dims(R`(d\times T)\cdot(T\times V)\to(d\times V)`,
      R`<code>{d}×{T}</code> · <code>{T}×{V}</code> → <code>{d}×{V}</code>`,
      R`El resultado tiene la forma de \(W_{\text{out}}\). La dimensión que se contrae es \(T\): se suma sobre las posiciones.`),
    details: R`<p><b>Derivación.</b> Como \(\mathrm{logits}_{tj} = \sum_k (H_f)_{tk}(W_{\text{out}})_{kj}\), la derivada respecto de un peso es \((H_f)_{tk}\), y ese peso interviene en todas las posiciones \(t\). Por la regla de la cadena:</p>
\[(\mathrm dW_{\text{out}})_{kj} = \sum_t (\mathrm d\,\mathrm{logits})_{tj}\,(H_f)_{tk} = \big(H_f^{\top}\,\mathrm d\,\mathrm{logits}\big)_{kj}.\]
<p><b>El truco de las formas.</b> El resultado debe tener la forma de \(W_{\text{out}}\) (\(d\times V\)). Con \(H_f\) (\(T\times d\)) y \(\mathrm d\,\mathrm{logits}\) (\(T\times V\)), la única combinación que da \(d\times V\) es \(H_f^{\top}\,\mathrm d\,\mathrm{logits}\): hay que contraer el eje \(T\).</p>
<p><b>Suma de productos exteriores.</b> Si llamamos \(\boldsymbol\delta_t\) a la fila \(t\) de \(\mathrm d\,\mathrm{logits}\), entonces \(\mathrm dW_{\text{out}} = \sum_t \mathbf h_{f,t}^{\top}\boldsymbol\delta_t\): cada posición aporta una matriz de rango 1, y el total tiene rango como mucho \(T\). Por eso más posiciones (y lotes más grandes) dan gradientes más ricos.</p>`,
    code: `dWout = Hf.T @ dlogits          # (d, T) @ (T, V) -> (d, V)`,
  };

  steps['bwd.logits.dX'] = {
    title: 'Gradiente que vuelve a H_f',
    summary: 'El error se propaga hacia atrás a través de W_out: dH_f = dlogits · W_outᵀ.',
    intuition: R`<p>Ahora el error viaja hacia atrás por la misma matriz, traspuesta. El gradiente del vector final del token \(t\) es una combinación de los «retratos» de las palabras (las columnas de \(W_{\text{out}}\)), ponderada por el error de cada una. Como el error es negativo en la palabra correcta y positivo en las demás, el descenso por gradiente empujará \(\mathbf h_{f,t}\) hacia el retrato de la palabra correcta y lo alejará de las que predijo por error.</p>`,
    math: [
      R`\mathrm dH_f = \mathrm d\,\mathrm{logits}\;W_{\text{out}}^{\top}`,
      R`(\mathrm dH_f)_{tk} = \sum_{j=1}^V (\mathrm d\,\mathrm{logits})_{tj}\,(W_{\text{out}})_{kj}`,
    ],
    shapes: dims(R`(T\times V)\cdot(V\times d)\to(T\times d)`,
      R`<code>{T}×{V}</code> · <code>{V}×{d}</code> → <code>{T}×{d}</code>`,
      R`Se contrae el vocabulario: el gradiente vuelve a tener la forma de \(H_f\).`),
    details: R`<p><b>Derivación.</b> Fijemos una entrada \((H_f)_{tk}\). Influye en todos los logits de su fila, \(\mathrm{logits}_{tj}\) para \(j = 1,\dots,V\), con derivada \((W_{\text{out}})_{kj}\). Sumando las contribuciones:</p>
\[(\mathrm dH_f)_{tk} = \sum_j (\mathrm d\,\mathrm{logits})_{tj}\,(W_{\text{out}})_{kj} = \big(\mathrm d\,\mathrm{logits}\;W_{\text{out}}^{\top}\big)_{tk}.\]
<p>Comprobación de formas: \((T\times V)(V\times d)\to T\times d\), la forma de \(H_f\).</p>
<p><b>Sin mezcla entre posiciones.</b> La fila \(t\) de \(\mathrm dH_f\) solo depende de la fila \(t\) de \(\mathrm d\,\mathrm{logits}\): igual que en el forward, esta capa trata cada token por separado. El error de una posición solo llegará a otras al atravesar la atención.</p>
<p><b>Error típico.</b> Usar un \(W_{\text{out}}\) ya actualizado. Todos los gradientes se calculan con los parámetros que se usaron en el forward; la actualización llega al final, en su propia fase.</p>`,
    code: `dHf = dlogits @ Wout.T          # (T, V) @ (V, d) -> (T, d)`,
  };

  steps['bwd.lnf'] = {
    title: 'Backward de la LayerNorm final',
    summary: 'El gradiente atraviesa la LayerNorm final: se obtienen los gradientes de γ_f y β_f y el gradiente de la salida de la última capa.',
    intuition: R`<p>El gradiente llega a la LayerNorm final y tiene que repartirse entre sus parámetros y su entrada. Para \(\beta_f\) y \(\gamma_f\) es fácil: son un desplazamiento y una escala por columna. Para la entrada hay una sutileza: como cada fila se normaliza con su propia media y varianza, cambiar una entrada cambia también \(\mu\) y \(\sigma^2\). El resultado es que el gradiente pierde las componentes que solo moverían la media o la escala de la fila, porque LayerNorm las anularía de todas formas.</p>`,
    math: [
      R`\mathrm d\beta_f = \textstyle\sum_{\text{filas}}\mathrm dH_f,\qquad \mathrm d\gamma_f = \sum_{\text{filas}}\mathrm dH_f\odot\hat X`,
      R`\mathrm d\hat X = \mathrm dH_f\odot\gamma_f`,
      R`\mathrm dX^{[N]} = r\odot\Big(\mathrm d\hat X - \overline{\mathrm d\hat X} - \hat X\odot\overline{\mathrm d\hat X\odot\hat X}\Big),\qquad r_t = \frac{1}{\sqrt{\sigma_t^2+\varepsilon}}`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d),\ \ (1\times d),\ \ (1\times d)`,
      R`\(\mathrm dH_f\): <code>{T}×{d}</code> → \(\mathrm dX^{[N]}\): <code>{T}×{d}</code>; \(\mathrm d\gamma_f,\mathrm d\beta_f\): <code>1×{d}</code>`,
      R`\(\hat X\) es \(X^{[N]}\) normalizada (guardada en el forward). La barra \(\overline{\,\cdot\,}\) es la media a lo largo de cada fila (sobre las \(d\) columnas); esas medias y \(r\) son vectores \(T\times 1\) que se difunden a lo ancho. Los gradientes de \(\gamma_f\) y \(\beta_f\) suman sobre las \(T\) filas porque esos parámetros se difundieron a todas ellas.`),
    details: R`<p><b>Parámetros.</b> Como \(y_{tj} = \gamma_j\hat x_{tj} + \beta_j\) y \(\gamma_j,\beta_j\) se usan en todas las filas: \(\mathrm d\beta_j = \sum_t \mathrm dy_{tj}\) y \(\mathrm d\gamma_j = \sum_t \mathrm dy_{tj}\,\hat x_{tj}\).</p>
<p><b>Entrada (fila a fila).</b> Con \(r = 1/\sqrt{\sigma^2+\varepsilon}\) y \(\hat x_j = (x_j-\mu)\,r\), usando \(\partial\mu/\partial x_i = 1/d\) y \(\partial\sigma^2/\partial x_i = 2(x_i-\mu)/d\):</p>
\[\frac{\partial\hat x_j}{\partial x_i} = r\Big(\delta_{ij} - \frac1d - \frac{\hat x_i\,\hat x_j}d\Big)\ \Longrightarrow\ \mathrm dx_i = r\Big(\mathrm d\hat x_i - \overline{\mathrm d\hat x} - \hat x_i\,\overline{\mathrm d\hat x\odot\hat x}\Big).\]
<p><b>Propiedades.</b> Cada fila de \(\mathrm dX^{[N]}\) suma 0 y es (salvo el diminuto efecto de \(\varepsilon\)) perpendicular a \(\hat{\mathbf x}_t\): LayerNorm es invariante a desplazar o escalar su entrada, así que el gradiente no tiene componente en esas direcciones.</p>
<p>Como \(X^{[N]}\) es el flujo residual, este gradiente es el que entra en la última capa.</p>`,
    code: `dxhat = dHf * gamma_f; dgamma_f = (dHf * xhat).sum(0); dbeta_f = dHf.sum(0)
dXN = r * (dxhat - dxhat.mean(1, keepdims=True)
           - xhat * (dxhat * xhat).mean(1, keepdims=True))   # r = 1/sqrt(var+eps)`,
  };

  // ── Backward: bloque FFN (de la última capa a la primera) ──
  steps['bwd.res2'] = {
    title: 'Residual 2: el gradiente se bifurca',
    summary: 'Como la salida de la capa es R + F, su gradiente se copia sin cambios a las dos ramas: la de la FFN (dF) y la del atajo residual (hacia dR).',
    intuition: R`<p>Una suma reparte el gradiente de forma muy generosa: la derivada de \(a + b\) respecto de \(a\) es 1, y respecto de \(b\) también. Así que el gradiente de la salida se copia <b>entero</b> a cada rama, como un mensaje reenviado a dos destinatarios: los dos reciben el texto completo, no la mitad cada uno. La copia que va por el atajo es la autopista del gradiente: llega a las capas anteriores sin multiplicarse por ninguna matriz.</p>`,
    math: [
      R`X^{[l]} = R + F\ \Longrightarrow\ \frac{\partial X^{[l]}_{tj}}{\partial F_{tj}} = \frac{\partial X^{[l]}_{tj}}{\partial R_{tj}} = 1`,
      R`\mathrm dF = \mathrm dX^{[l]},\qquad \mathrm dR_{\text{directo}} = \mathrm dX^{[l]}`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d)\ \text{ y }\ (T\times d)`,
      R`<code>{T}×{d}</code> → dos copias de <code>{T}×{d}</code> (capa {l})`,
      R`Copiar no cambia la forma: cada rama recibe una matriz idéntica.`),
    details: R`<p><b>Regla de la suma.</b> Si \(X^{[l]} = R + F\), un cambio en cualquiera de los dos sumandos cambia la salida en la misma cantidad. Por eso el gradiente no se reparte a medias: cada rama recibe todo el error.</p>
<p><b>Dos caminos hacia \(R\).</b> \(R\) influye en la pérdida de dos maneras: directamente (sumándose en \(X^{[l]}\)) y a través de la FFN (\(F = \mathrm{FFN}(\mathrm{LN}_2(R))\)). Por la regla de la cadena multivariable, su gradiente total será la suma de ambas contribuciones. Aquí guardamos la del atajo, \(\mathrm dR_{\text{directo}}\); la de la FFN la calcularemos atravesando \(W_2\), la activación, \(W_1\) y LN₂, y las sumaremos en el paso «Residual 2: se suman los dos caminos».</p>
<p><b>La autopista del gradiente.</b> Por el atajo, el gradiente llega a las capas anteriores sin multiplicarse por ninguna matriz de pesos ni atravesar ninguna saturación. Por eso los transformers profundos se pueden entrenar sin que el gradiente se desvanezca.</p>`,
    code: `dF = dX_l.copy()                # rama FFN
dR_skip = dX_l.copy()           # atajo: se sumará más tarde`,
  };

  steps['bwd.ffn2.dW'] = {
    title: 'Gradiente de W_2',
    summary: 'dW_2 = Gᵀ · dF: cada peso recibe la suma, sobre las posiciones, de la activación de su neurona por el error de su salida.',
    intuition: R`<p>Cada peso \((W_2)_{kj}\) decide cuánto escribe la neurona \(k\) en la componente \(j\) del flujo residual. Su gradiente es «actividad de la neurona» × «error de esa componente», sumado sobre las posiciones. Una neurona que estuvo apagada (\(G_{tk} = 0\)) en todos los tokens no recibe gradiente: no puede aprender qué escribir si no ha participado.</p>`,
    math: [
      R`\mathrm dW_2 = G^{\top}\,\mathrm dF`,
      R`(\mathrm dW_2)_{kj} = \sum_{t=1}^T G_{tk}\,\mathrm dF_{tj}`,
    ],
    shapes: dims(R`(d_{\text{ff}}\times T)\cdot(T\times d)\to(d_{\text{ff}}\times d)`,
      R`<code>{dff}×{T}</code> · <code>{T}×{d}</code> → <code>{dff}×{d}</code>`,
      R`La forma de \(W_2\); se contrae el eje de las posiciones.`),
    details: R`<p><b>Derivación.</b> \(F_{tj} = \sum_k G_{tk}(W_2)_{kj} + (b_2)_j\), así que \(\partial F_{tj}/\partial (W_2)_{kj} = G_{tk}\). El peso interviene en todas las posiciones, luego</p>
\[(\mathrm dW_2)_{kj} = \sum_t G_{tk}\,\mathrm dF_{tj} = \big(G^{\top}\mathrm dF\big)_{kj}.\]
<p>Es el mismo patrón que \(\mathrm dW_{\text{out}} = H_f^{\top}\,\mathrm d\,\mathrm{logits}\): para cualquier capa lineal \(Y = XW\), \(\mathrm dW = X^{\top}\mathrm dY\) (ver la derivación «Gradiente de un producto de matrices»).</p>
<p><b>Filas nulas.</b> Con ReLU, la fila \(k\) de \(\mathrm dW_2\) es exactamente cero si la neurona \(k\) no se activó en ningún token de la frase. En el mapa de calor lo verás como filas enteras del color neutro del cero.</p>
<p><b>Error típico.</b> Escribir \(\mathrm dF^{\top}G\): da \(d\times d_{\text{ff}}\), la traspuesta de lo que buscamos. Comprobar la forma (\(d_{\text{ff}}\times d\), igual que \(W_2\)) lo detecta al instante.</p>`,
    code: `dW2 = G.T @ dF                  # (dff, T) @ (T, d) -> (dff, d)`,
  };

  steps['bwd.ffn2.db'] = {
    title: 'Gradiente del sesgo b_2',
    summary: 'El sesgo se sumó a todas las filas, así que su gradiente es la suma de las filas de dF: db_2 = Σ_t dF_t.',
    intuition: R`<p>El sesgo \(b_2\) se sumó a todas las posiciones por igual, así que cada posición aporta su propio error y el gradiente del sesgo es la suma de todos ellos: si subir \(b_2\) ayuda en tres posiciones, ayuda el triple. Es un caso particular de una regla general: <b>lo que en el forward se copia (difusión), en el backward se suma</b>.</p>`,
    math: [
      R`\mathrm db_2 = \sum_{t=1}^T \mathrm dF_{t,:} = \mathbf 1^{\top}\,\mathrm dF`,
    ],
    shapes: dims(R`(T\times d)\to(1\times d)`,
      R`<code>{T}×{d}</code> → <code>1×{d}</code>`,
      R`Se colapsa el eje de las posiciones: una suma por columna.`),
    details: R`<p><b>Derivación.</b> Escribamos la difusión explícitamente: \(F = G\,W_2 + \mathbf 1\,b_2\), con \(\mathbf 1\in\mathbb R^{T\times 1}\). Es un producto de matrices \(\mathbf 1\cdot b_2\), y la regla \(\mathrm dW = X^{\top}\mathrm dY\) con \(X = \mathbf 1\) da</p>
\[\mathrm db_2 = \mathbf 1^{\top}\mathrm dF = \sum_t \mathrm dF_{t,:}.\]
<p>O, entrada a entrada: \((b_2)_j\) aparece en \(F_{tj}\) para todas las \(t\), con derivada 1, así que \(\mathrm d(b_2)_j = \sum_t \mathrm dF_{tj}\).</p>
<p><b>Sumar, no promediar.</b> El factor \(1/T\) de la media de la pérdida ya está dentro de \(\mathrm d\,\mathrm{logits}\); dividir otra vez aquí sería contarlo dos veces. (Cuando se entrena con un lote de varias frases, los gradientes de las frases sí se promedian.)</p>
<p><b>Qué significan los números.</b> Una componente negativa de \(\mathrm db_2\) indica que, en conjunto, la pérdida bajaría si todos los tokens tuvieran un poco más de esa componente.</p>`,
    code: `db2 = dF.sum(axis=0, keepdims=True)   # (1, d)`,
  };

  steps['bwd.ffn2.dX'] = {
    title: 'Gradiente que vuelve a G',
    summary: 'dG = dF · W_2ᵀ: el error de cada token se reparte entre sus d_ff neuronas según cuánto contribuye cada una a cada salida.',
    intuition: R`<p>El error de cada token (\(\mathrm dF_{t,:}\), \(d\) números) se traduce en un error para cada una de sus \(d_{\text{ff}}\) neuronas. La neurona \(k\) escribe en la dirección \((W_2)_{k,:}\); su gradiente es el producto escalar de esa dirección con el error. Si escribir más en esa dirección hubiera reducido la pérdida, el gradiente es negativo y el modelo querrá que esa neurona se active más.</p>`,
    math: [
      R`\mathrm dG = \mathrm dF\,W_2^{\top}`,
      R`\mathrm dG_{tk} = \sum_{j=1}^d \mathrm dF_{tj}\,(W_2)_{kj}`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d_{\text{ff}})\to(T\times d_{\text{ff}})`,
      R`<code>{T}×{d}</code> · <code>{d}×{dff}</code> → <code>{T}×{dff}</code>`,
      R`El gradiente recupera la forma de \(G\): de \(d\) a \(d_{\text{ff}}\) columnas.`),
    details: R`<p><b>Derivación.</b> Cada \(G_{tk}\) influye en toda la fila \(F_{t,:}\) a través de \((W_2)_{k,:}\):</p>
\[\mathrm dG_{tk} = \sum_j \mathrm dF_{tj}\,(W_2)_{kj} = \big(\mathrm dF\,W_2^{\top}\big)_{tk}.\]
<p>Es la otra mitad de la regla de las capas lineales: si \(Y = XW\), entonces \(\mathrm dX = \mathrm dY\,W^{\top}\). Comprobación de formas: \((T\times d)(d\times d_{\text{ff}})\to T\times d_{\text{ff}}\), la forma de \(G\).</p>
<p><b>Todavía no es el gradiente de \(U\).</b> \(\mathrm dG\) dice cuánto querríamos cambiar las activaciones, pero una neurona apagada por ReLU no puede responder. El paso siguiente multiplica por \(f'(U)\) para tenerlo en cuenta.</p>
<p><b>Token a token.</b> Como en toda la FFN, este paso no mezcla posiciones: la fila \(t\) de \(\mathrm dG\) solo depende de la fila \(t\) de \(\mathrm dF\).</p>`,
    code: `dG = dF @ W2.T                  # (T, d) @ (d, dff) -> (T, dff)`,
  };

  steps['bwd.act'] = {
    title: 'Backward de la activación',
    summary: 'El gradiente atraviesa la no linealidad multiplicándose, elemento a elemento, por su derivada: dU = dG ⊙ f′(U).',
    intuition: R`<p>La activación se aplicó elemento a elemento, así que su backward también: cada gradiente se multiplica por la pendiente de la función en el punto donde se evaluó. Con ReLU la pendiente es 1 o 0, de modo que funciona como una <b>compuerta</b>: el gradiente pasa íntegro por las neuronas que estaban encendidas y se bloquea en las apagadas. Con GELU la compuerta es suave.</p>`,
    math: [
      R`\mathrm dU = \mathrm dG\odot f'(U)`,
      R`\mathrm{ReLU}'(u) = \begin{cases} 1 & u > 0\\ 0 & u\le 0\end{cases}`,
      R`\mathrm{GELU}'(u) = \tfrac12\big(1+\tanh a\big) + \tfrac12\,u\,\big(1-\tanh^2 a\big)\sqrt{2/\pi}\,\big(1 + 3\cdot 0.044715\,u^2\big),\quad a = \sqrt{2/\pi}\,(u + 0.044715\,u^3)`,
    ],
    shapes: dims(R`(T\times d_{\text{ff}})\odot(T\times d_{\text{ff}})\to(T\times d_{\text{ff}})`,
      R`<code>{T}×{dff}</code> ⊙ <code>{T}×{dff}</code> → <code>{T}×{dff}</code>`,
      R`La derivada \(f'(U)\) tiene la misma forma que \(U\); no hay contracción.`),
    details: R`<p><b>Derivación.</b> \(G_{tk} = f(U_{tk})\) depende solo de \(U_{tk}\). El jacobiano es diagonal y la regla de la cadena se reduce a</p>
\[\mathrm dU_{tk} = \mathrm dG_{tk}\,f'(U_{tk}).\]
<p><b>ReLU.</b> \(f'(u) = 1\) si \(u\gt 0\) y 0 si \(u\le 0\) (en \(u = 0\) se toma 0 por convenio). Compara los mapas de calor: donde \(G\) era 0, \(\mathrm dU\) también lo es. Por eso las columnas correspondientes de \(\mathrm dW_1\) y \(\mathrm db_1\) solo reciben contribuciones de los tokens que activaron la neurona.</p>
<p><b>GELU.</b> Su derivada (fórmula de arriba, con la aproximación \(\tanh\)) vale 0.5 en \(u = 0\), tiende a 1 para \(u\) grande y a 0 para \(u\) muy negativo; incluso es ligeramente negativa para \(u\lt -0.75\), donde la función desciende hacia su mínimo. Salvo en ese punto aislado (\(u\approx -0.75\)) y para \(u\) muy negativo, su derivada no se anula, así que casi nunca bloquea del todo el gradiente: eso reduce el problema de las neuronas muertas.</p>`,
    code: `dU = dG * (U > 0)               # ReLU: compuerta 0/1
# GELU: dU = dG * gelu_prime(U)`,
  };

  steps['bwd.ffn1.dW'] = {
    title: 'Gradiente de W_1',
    summary: 'dW_1 = H′ᵀ · dU: la misma regla «entrada traspuesta por error» de toda capa lineal.',
    intuition: R`<p>Cada columna \(k\) de \(W_1\) es el detector de la neurona \(k\). Su gradiente combina lo que el detector vio (las filas de \(H'\)) con el error que la neurona recibió (\(\mathrm dU_{:,k}\)). Si la neurona debería haberse activado más ante cierto token, el descenso por gradiente girará su detector hacia el vector de ese token; si debería haberse activado menos, lo alejará.</p>`,
    math: [
      R`\mathrm dW_1 = H'^{\top}\,\mathrm dU`,
      R`(\mathrm dW_1)_{jk} = \sum_{t=1}^T H'_{tj}\,\mathrm dU_{tk}`,
    ],
    shapes: dims(R`(d\times T)\cdot(T\times d_{\text{ff}})\to(d\times d_{\text{ff}})`,
      R`<code>{d}×{T}</code> · <code>{T}×{dff}</code> → <code>{d}×{dff}</code>`,
      R`La forma de \(W_1\); se contrae el eje de las posiciones.`),
    details: R`<p><b>Derivación.</b> \(U_{tk} = \sum_j H'_{tj}(W_1)_{jk} + (b_1)_k\), luego \(\partial U_{tk}/\partial (W_1)_{jk} = H'_{tj}\) y</p>
\[(\mathrm dW_1)_{jk} = \sum_t H'_{tj}\,\mathrm dU_{tk} = \big(H'^{\top}\mathrm dU\big)_{jk}.\]
<p>Tercera aparición de la misma regla, \(\mathrm dW = X^{\top}\mathrm dY\). Comprobación de formas: \((d\times T)(T\times d_{\text{ff}})\to d\times d_{\text{ff}}\).</p>
<p><b>Columnas nulas.</b> Con ReLU, si la neurona \(k\) estuvo apagada en todos los tokens, la columna \(k\) de \(\mathrm dU\) es cero y también la de \(\mathrm dW_1\): el detector no aprende de ejemplos en los que no participó.</p>
<p><b>Sumar sobre posiciones.</b> Cada token de la frase aporta un producto exterior \((\mathbf h'_t)^{\top}\,\mathrm d\mathbf u_t\) de rango 1; en un lote de varias frases, además, se promedian los gradientes de cada frase.</p>`,
    code: `dW1 = H2.T @ dU                 # (d, T) @ (T, dff) -> (d, dff)`,
  };

  steps['bwd.ffn1.db'] = {
    title: 'Gradiente del sesgo b_1',
    summary: 'db_1 = Σ_t dU_t: la suma de las filas de dU, porque b_1 se difundió a todas las posiciones.',
    intuition: R`<p>\(b_1\) es el umbral de cada neurona: cuánto le cuesta encenderse. Su gradiente acumula, sobre todas las posiciones, el error que recibió cada neurona. Un gradiente negativo significa que la pérdida bajaría si la neurona se activara con más facilidad, y el descenso por gradiente subirá su sesgo.</p>`,
    math: [
      R`\mathrm db_1 = \sum_{t=1}^T \mathrm dU_{t,:} = \mathbf 1^{\top}\,\mathrm dU`,
    ],
    shapes: dims(R`(T\times d_{\text{ff}})\to(1\times d_{\text{ff}})`,
      R`<code>{T}×{dff}</code> → <code>1×{dff}</code>`,
      R`Una suma por columna: un número por neurona.`),
    details: R`<p><b>Derivación.</b> Igual que con \(b_2\): \(U = H'W_1 + \mathbf 1\,b_1\), así que</p>
\[\mathrm db_1 = \mathbf 1^{\top}\mathrm dU = \sum_t \mathrm dU_{t,:}.\]
<p><b>Quién contribuye.</b> Como \(\mathrm dU = \mathrm dG\odot f'(U)\), con ReLU solo suman las posiciones en las que la neurona estaba activa. Una neurona apagada en toda la frase recibe \(\mathrm d(b_1)_k = 0\): ni siquiera su umbral se mueve con SGD (con Adam, el momento acumulado de iteraciones anteriores todavía puede moverlo).</p>
<p><b>La dualidad difusión ↔ suma.</b> Aparece en todos los sesgos, en \(\gamma\) y \(\beta\) de LayerNorm y, con otra forma, en las conexiones residuales: siempre que un mismo valor se usa en varios sitios, su gradiente es la suma de los gradientes de cada uso.</p>`,
    code: `db1 = dU.sum(axis=0, keepdims=True)   # (1, dff)`,
  };

  steps['bwd.ffn1.dX'] = {
    title: 'Gradiente que vuelve a H′',
    summary: 'dH′ = dU · W_1ᵀ: el error regresa de las d_ff neuronas a las d dimensiones del token.',
    intuition: R`<p>El error regresa de las \(d_{\text{ff}}\) neuronas a las \(d\) dimensiones del token. Cada neurona activa devuelve su error a lo largo de su propio detector (su columna de \(W_1\)) y las contribuciones de todas las neuronas se suman. Con esto se completa el backward de la FFN.</p>`,
    math: [
      R`\mathrm dH' = \mathrm dU\,W_1^{\top}`,
      R`\mathrm dH'_{tj} = \sum_{k=1}^{d_{\text{ff}}} \mathrm dU_{tk}\,(W_1)_{jk}`,
    ],
    shapes: dims(R`(T\times d_{\text{ff}})\cdot(d_{\text{ff}}\times d)\to(T\times d)`,
      R`<code>{T}×{dff}</code> · <code>{dff}×{d}</code> → <code>{T}×{d}</code>`,
      R`Se contrae \(d_{\text{ff}}\): el gradiente vuelve a la anchura del modelo.`),
    details: R`<p><b>Derivación.</b> \(H'_{tj}\) influye en todas las neuronas \(U_{tk}\) de su fila, con derivada \((W_1)_{jk}\):</p>
\[\mathrm dH'_{tj} = \sum_k \mathrm dU_{tk}\,(W_1)_{jk} = \big(\mathrm dU\,W_1^{\top}\big)_{tj}.\]
<p><b>Resumen de las capas lineales.</b> Para \(Y = XW + \mathbf 1\,b\) hemos usado una y otra vez las mismas tres fórmulas:</p>
\[\mathrm dW = X^{\top}\mathrm dY,\qquad \mathrm db = \mathbf 1^{\top}\mathrm dY,\qquad \mathrm dX = \mathrm dY\,W^{\top}.\]
<p>Un truco para recordarlas: son las únicas combinaciones de \(X\), \(W\) y \(\mathrm dY\) que producen la forma correcta.</p>
<p><b>Siguiente parada.</b> \(\mathrm dH'\) todavía tiene que atravesar LN₂ para convertirse en un gradiente sobre \(R\).</p>`,
    code: `dH2 = dU @ W1.T                 # (T, dff) @ (dff, d) -> (T, d)`,
  };

  steps['bwd.ln2'] = {
    title: 'Backward de LayerNorm 2',
    summary: 'El gradiente dH′ atraviesa LN₂: se obtienen dγ₂, dβ₂ y la contribución de la rama FFN al gradiente de R.',
    intuition: R`<p>El gradiente que volvió de la FFN atraviesa LN₂. Como en la LayerNorm final, los parámetros \(\gamma_2\) y \(\beta_2\) reciben sumas sobre las filas (un número por columna) y la entrada recibe un gradiente «proyectado»: se le quita la parte que solo cambiaría la media o la escala de cada fila. El resultado, \(\mathrm dR_{\text{LN}}\), es solo la contribución de la rama FFN al gradiente de \(R\); la del atajo se sumará en el paso siguiente.</p>`,
    math: [
      R`\mathrm d\beta_2 = \textstyle\sum_{\text{filas}}\mathrm dH',\qquad \mathrm d\gamma_2 = \sum_{\text{filas}}\mathrm dH'\odot\hat R`,
      R`\mathrm d\hat R = \mathrm dH'\odot\gamma_2`,
      R`\mathrm dR_{\text{LN}} = r\odot\Big(\mathrm d\hat R - \overline{\mathrm d\hat R} - \hat R\odot\overline{\mathrm d\hat R\odot\hat R}\Big)`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d),\ \ (1\times d),\ \ (1\times d)`,
      R`\(\mathrm dH'\): <code>{T}×{d}</code> → \(\mathrm dR_{\text{LN}}\): <code>{T}×{d}</code>; \(\mathrm d\gamma_2,\mathrm d\beta_2\): <code>1×{d}</code>`,
      R`\(\hat R\) es \(R\) normalizada (guardada en el forward); \(r\) y las medias con barra son vectores \(T\times 1\).`),
    details: R`<p><b>Tres términos, tres motivos.</b> En \(\mathrm d\hat R - \overline{\mathrm d\hat R} - \hat R\odot\overline{\mathrm d\hat R\odot\hat R}\):</p>
<ul><li>\(\mathrm d\hat R\) es el gradiente «ingenuo», como si LayerNorm solo multiplicara por \(r\);</li>
<li>\(-\overline{\mathrm d\hat R}\) descuenta el efecto de cada entrada sobre la media \(\mu\);</li>
<li>\(-\hat R\odot\overline{\mathrm d\hat R\odot\hat R}\) descuenta su efecto sobre la varianza \(\sigma^2\).</li></ul>
<p>Todo se multiplica por \(r = 1/\sqrt{\sigma^2+\varepsilon}\): una fila con mucha varianza recibe un gradiente más pequeño, igual que en el forward se encogió más.</p>
<p><b>Error típico.</b> Tratar LayerNorm como si fuera elemento a elemento (quedarse solo con \(r\odot\mathrm d\hat R\)). La forma sale bien, pero el gradiente es incorrecto; la comprobación numérica de gradientes de «Datos y modelo» lo detecta enseguida.</p>
<p>La derivación completa está en «Backward de LayerNorm».</p>`,
    code: `dRhat = dH2 * gamma2; dgamma2 = (dH2 * Rhat).sum(0); dbeta2 = dH2.sum(0)
dR_ln = r * (dRhat - dRhat.mean(1, keepdims=True)
             - Rhat * (dRhat * Rhat).mean(1, keepdims=True))`,
  };

  steps['bwd.res2.merge'] = {
    title: 'Residual 2: se suman los dos caminos',
    summary: 'El gradiente total de R es la suma del que llegó directamente por el atajo y del que regresó a través de LN₂ y la FFN.',
    intuition: R`<p>\(R\) se usó dos veces en el forward: se sumó directamente a la salida de la capa y, además, alimentó a LN₂ y a la FFN. Por la regla de la cadena multivariable, su gradiente total es la suma de lo que llega por cada camino. Aquí se juntan las dos corrientes: la que bajó directa por el atajo y la que dio la vuelta por la FFN.</p>`,
    math: [
      R`X^{[l]} = R + \mathrm{FFN}\big(\mathrm{LN}_2(R)\big)`,
      R`\mathrm dR = \underbrace{\mathrm dR_{\text{directo}}}_{=\,\mathrm dX^{[l]}\ \text{(atajo)}} + \underbrace{\mathrm dR_{\text{LN}}}_{\text{rama FFN}}`,
    ],
    shapes: dims(R`(T\times d) + (T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> + <code>{T}×{d}</code> → <code>{T}×{d}</code>`,
      R`Una suma elemento a elemento de dos gradientes con la forma de \(R\).`),
    details: R`<p><b>La regla general.</b> Si una variable \(x\) se usa en varios sitios, \(\mathcal L\) depende de ella a través de cada uso \(u_1, u_2, \dots\), y</p>
\[\frac{\partial\mathcal L}{\partial x} = \sum_k \frac{\partial\mathcal L}{\partial u_k}\,\frac{\partial u_k}{\partial x}.\]
<p>«Bifurcación en el forward ⇒ suma en el backward.» Es la misma regla que convierte la difusión de un sesgo en una suma de filas.</p>
<p><b>Qué observar.</b> Compara los dos sumandos. \(\mathrm dR_{\text{directo}}\) es el gradiente de la salida tal cual; \(\mathrm dR_{\text{LN}}\) mide el efecto que tiene un cambio en \(R\) sobre la pérdida a través de LN₂ y la FFN. En este modelo el primero suele ser el mayor, y es el que garantiza que el gradiente nunca se pierda.</p>
<p><b>Error típico.</b> En una implementación a mano, sobrescribir el gradiente en lugar de acumularlo (<code>dR = dR_ln</code> en vez de <code>dR = dR_skip + dR_ln</code>). El modelo parece entrenar, pero peor, y la comprobación de gradientes falla. Por eso los frameworks inicializan los gradientes a cero y siempre acumulan con <code>+=</code>.</p>`,
    code: `dR = dR_skip + dR_ln            # (T, d)`,
  };

  // ── Backward: bloque de atención ──
  steps['bwd.res1'] = {
    title: 'Residual 1: el gradiente se bifurca otra vez',
    summary: 'Como R es la suma de la entrada de la capa y de la salida de la atención, dR se copia a la rama de atención (dO) y al atajo hacia la entrada de la capa.',
    intuition: R`<p>Seguimos subiendo por la capa. Como \(R = X^{[l-1]} + O\), el gradiente \(\mathrm dR\) (que ya incluye la contribución de la FFN) se copia de nuevo a dos sitios: a la rama de atención (\(\mathrm dO\)) y, por el atajo, hacia la entrada de la capa. Es la misma bifurcación que en «Residual 2», ahora para la subcapa de atención.</p>`,
    math: [
      R`R = X^{[l-1]} + O\ \Longrightarrow\ \mathrm dO = \mathrm dR,\qquad \mathrm dX^{[l-1]}_{\text{directo}} = \mathrm dR`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d)\ \text{ y }\ (T\times d)`,
      R`<code>{T}×{d}</code> → dos copias de <code>{T}×{d}</code> (capa {l})`,
      R`Tanto \(\mathrm dO\) como la copia del atajo, \(\mathrm dX^{[l-1]}_{\text{directo}}\), son idénticas a \(\mathrm dR\).`),
    details: R`<p><b>Los gradientes se acumulan al retroceder.</b> El gradiente que viaja por este atajo es \(\mathrm dR = \mathrm dX^{[l]} + \mathrm dR_{\text{LN}}\): el gradiente de la salida de la capa más la corrección de la FFN. Al final de este bloque se le sumará también la corrección de la atención, \(\mathrm dX^{[l-1]}_{\text{LN}}\), y obtendremos</p>
\[\mathrm dX^{[l-1]} = \mathrm dX^{[l]} + \mathrm dR_{\text{LN}} + \mathrm dX^{[l-1]}_{\text{LN}}.\]
<p>El primer término llega intacto desde arriba: incluso con muchas capas, la entrada siempre recibe una copia directa del gradiente de la salida.</p>
<p><b>La rama de atención.</b> \(\mathrm dO\) es el punto de partida de todo el backward de la atención: primero \(W_O\), luego la separación en cabezas y, dentro de cada cabeza, la mezcla de valores, el softmax, la máscara, el escalado y el producto \(Q_hK_h^{\top}\). Al terminar, las tres proyecciones y LN₁.</p>`,
    code: `dO = dR.copy()                  # rama de atención
dX_skip = dR.copy()             # atajo hacia la entrada de la capa`,
  };

  steps['bwd.attn.proj.dW'] = {
    title: 'Gradiente de W_O',
    summary: 'dW_O = Zᵀ · dO: la proyección de salida aprende a partir de lo que produjeron las cabezas y del error que llega por la rama de atención.',
    intuition: R`<p>\(W_O\) aprende a combinar lo que encontraron las cabezas. Su gradiente cruza lo que produjo cada cabeza (las columnas de \(Z\)) con el error que llega por la rama de atención (\(\mathrm dO\)). Si una cabeza había encontrado al sujeto y eso era justo lo que faltaba para reducir la pérdida, los pesos que llevan esa información al flujo residual se refuerzan.</p>`,
    math: [
      R`\mathrm dW_O = Z^{\top}\,\mathrm dO`,
      R`(\mathrm dW_O)_{kj} = \sum_{t=1}^T Z_{tk}\,\mathrm dO_{tj}`,
    ],
    shapes: dims(R`(d\times T)\cdot(T\times d)\to(d\times d)`,
      R`<code>{d}×{T}</code> · <code>{T}×{d}</code> → <code>{d}×{d}</code>`,
      R`La forma de \(W_O\). Se contrae el eje \(T\): todas las posiciones de la frase contribuyen.`),
    details: R`<p><b>Derivación.</b> Es la regla de siempre, ahora para \(O = Z\,W_O\): \(\partial O_{tj}/\partial (W_O)_{kj} = Z_{tk}\), y sumando sobre las posiciones</p>
\[(\mathrm dW_O)_{kj} = \sum_t Z_{tk}\,\mathrm dO_{tj}\quad\Longrightarrow\quad \mathrm dW_O = Z^{\top}\mathrm dO.\]
<p><b>Bloques por cabeza.</b> Las filas \((h-1)d_k\) a \(h\,d_k-1\) (contando desde 0) de \(W_O\) solo multiplican a las columnas de \(Z_h\). Por tanto, ese bloque de \(\mathrm dW_O\) es \(Z_h^{\top}\mathrm dO\): combina la salida de esa única cabeza con el error común \(\mathrm dO\). Cada cabeza «entrena» su propio trozo de la proyección de salida.</p>
<p><b>Qué observar.</b> Si una cabeza produce salidas casi nulas o casi iguales en todas las posiciones, su bloque de filas en \(\mathrm dW_O\) será pequeño o muy uniforme: todavía no aporta información útil que reforzar.</p>`,
    code: `dWo = Z.T @ dO                  # (d, T) @ (T, d) -> (d, d)`,
  };

  steps['bwd.attn.proj.dX'] = {
    title: 'Gradiente que vuelve a Z',
    summary: 'dZ = dO · W_Oᵀ: el error de la rama de atención se reparte hacia las columnas de todas las cabezas.',
    intuition: R`<p>El error de la rama de atención se reparte hacia las cabezas a través de \(W_O^{\top}\). Cada cabeza recibe, en sus \(d_k\) columnas de \(\mathrm dZ\), la parte del error que le corresponde según cómo \(W_O\) usaba su salida. Es el momento en que cada cabeza «oye» qué debería haber encontrado.</p>`,
    math: [
      R`\mathrm dZ = \mathrm dO\,W_O^{\top}`,
      R`\mathrm dZ_h = \mathrm dO\,\big(W_O^{(h)}\big)^{\top}`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> · <code>{d}×{d}</code> → <code>{T}×{d}</code>`,
      R`La forma de \(Z\): {h} bloques de {dk} columnas, uno por cabeza.`),
    details: R`<p><b>Derivación.</b> Cada entrada \(Z_{tk}\) influye en toda la fila \(O_{t,:}\) a través de la fila \(k\) de \(W_O\):</p>
\[\mathrm dZ_{tk} = \sum_j \mathrm dO_{tj}\,(W_O)_{kj} = \big(\mathrm dO\,W_O^{\top}\big)_{tk}.\]
<p><b>Por cabeza.</b> Restringido a las columnas de la cabeza \(h\), queda \(\mathrm dZ_h = \mathrm dO\,(W_O^{(h)})^{\top}\), donde \(W_O^{(h)}\) es el bloque de filas de esa cabeza. El paso siguiente solo tendrá que cortar \(\mathrm dZ\) en bloques.</p>
<p><b>Sin mezcla entre posiciones.</b> La fila \(t\) de \(\mathrm dZ\) solo depende de la fila \(t\) de \(\mathrm dO\). El intercambio de gradiente entre tokens ocurrirá dentro de cada cabeza, al retroceder a través de \(A_h\).</p>`,
    code: `dZ = dO @ Wo.T                  # (T, d) @ (d, d) -> (T, d)`,
  };

  steps['bwd.attn.concat'] = {
    title: 'Separar el gradiente por cabezas',
    summary: 'El backward de la concatenación es un corte: las columnas de dZ se reparten entre las cabezas, dZ_1 … dZ_h.',
    intuition: R`<p>En el forward pegamos las salidas de las cabezas una al lado de otra; en el backward hacemos lo contrario: cortamos el gradiente \(\mathrm dZ\) en bloques de \(d_k\) columnas y le devolvemos a cada cabeza el suyo. No hay ninguna cuenta: cada número de gradiente vuelve exactamente al sitio de donde vino.</p>`,
    math: [
      R`Z = [\,Z_1\,\|\,\cdots\,\|\,Z_h\,]\ \Longrightarrow\ \mathrm dZ_h = (\mathrm dZ)_{:,\,(h-1)d_k\,:\,h\,d_k}`,
    ],
    shapes: dims(R`(T\times d)\to h\times(T\times d_k)`,
      R`<code>{T}×{d}</code> → {h} bloques de <code>{T}×{dk}</code>`,
      R`Un corte por columnas, sin aritmética.`),
    details: R`<p><b>Repartir, no calcular.</b> La concatenación solo cambió de sitio los números: la entrada \((t, m)\) de \(Z_h\) acabó en la columna \((h-1)d_k + m\) de \(Z\). Su derivada es 1 hacia ese único destino, así que el gradiente vuelve exactamente al lugar de donde vino. No hay ninguna suma ni producto.</p>
<p><b>Parejas forward ↔ backward.</b> Vale la pena memorizar estas dualidades:</p>
<ul><li>dividir en cabezas ↔ concatenar gradientes;</li><li>concatenar cabezas ↔ dividir gradientes (este paso);</li><li>difundir (copiar) ↔ sumar;</li><li>sumar ↔ copiar.</li></ul>
<p><b>A partir de aquí,</b> cada cabeza hace su backward de forma independiente (en una GPU, en paralelo), igual que en el forward: pesos de atención, valores, softmax, máscara, escalado, consultas y claves.</p>`,
    code: `dZh = [dZ[:, i*dk:(i+1)*dk] for i in range(h)]   # h bloques (T, dk)`,
  };

  // ── Backward: dentro de cada cabeza ──
  steps['bwd.attn.context.dA'] = {
    title: 'Gradiente de los pesos de atención',
    summary: 'dA_h = dZ_h · V_hᵀ: cuánto habría ayudado a reducir la pérdida prestar más atención a cada par (consulta, clave).',
    intuition: R`<p>\((\mathrm dA_h)_{ij}\) responde a «¿habría bajado la pérdida si el token \(i\) hubiera atendido un poco más al token \(j\)?». Si el valor de \(j\) apunta en la dirección hacia la que la salida de \(i\) «quería moverse», la respuesta es sí (gradiente negativo). Así aprende la atención a mirar a los tokens cuyo contenido es útil.</p>`,
    math: [
      R`\mathrm dA_h = \mathrm dZ_h\,V_h^{\top}`,
      R`(\mathrm dA_h)_{ij} = \mathrm d\mathbf z_i\cdot\mathbf v_j = \sum_{m=1}^{d_k}(\mathrm dZ_h)_{im}\,(V_h)_{jm}`,
    ],
    shapes: dims(R`(T\times d_k)\cdot(d_k\times T)\to(T\times T)`,
      R`<code>{T}×{dk}</code> · <code>{dk}×{T}</code> → <code>{T}×{T}</code> (cabeza {hd})`,
      R`El gradiente tiene la forma de \(A_h\): una entrada por par (consulta \(i\), clave \(j\)).`),
    details: R`<p><b>Derivación.</b> En \(Z_h = A_hV_h\), \((Z_h)_{im} = \sum_j (A_h)_{ij}(V_h)_{jm}\), luego \(\partial (Z_h)_{im}/\partial (A_h)_{ij} = (V_h)_{jm}\) y</p>
\[(\mathrm dA_h)_{ij} = \sum_m (\mathrm dZ_h)_{im}\,(V_h)_{jm} = \big(\mathrm dZ_h\,V_h^{\top}\big)_{ij}.\]
<p><b>Interpretación.</b> El descenso por gradiente movería \(\mathbf z_i\) en la dirección \(-\mathrm d\mathbf z_i\). Si el valor \(\mathbf v_j\) apunta hacia allí, el producto \(\mathrm d\mathbf z_i\cdot\mathbf v_j\) es negativo: aumentar \((A_h)_{ij}\) acercaría la salida a donde debía estar.</p>
<p><b>Ojo con el triángulo superior.</b> \(\mathrm dA_h\) se calcula para todos los pares, también para \(j\gt i\), y ahí suele ser distinto de cero: «mirar al futuro ayudaría». Pero esos pesos están fijados a 0 por la máscara, y el backward del softmax (dos pasos más adelante) anulará esas entradas.</p>`,
    code: `dA = dZh @ Vh.T                 # (T, dk) @ (dk, T) -> (T, T)`,
  };

  steps['bwd.attn.context.dV'] = {
    title: 'Gradiente de los valores V_h',
    summary: 'dV_h = A_hᵀ · dZ_h: cada valor recibe el error de todas las consultas que lo usaron, ponderado por la atención que le prestaron.',
    intuition: R`<p>El valor de un token se usó en todas las consultas que lo atendieron, así que su gradiente recoge el error de todas ellas, ponderado por la atención que le prestaron. Un token muy atendido recibe mucho gradiente en su valor; uno ignorado, casi nada.</p>`,
    math: [
      R`\mathrm dV_h = A_h^{\top}\,\mathrm dZ_h`,
      R`(\mathrm dV_h)_{j,:} = \sum_{i\ge j}(A_h)_{ij}\,(\mathrm dZ_h)_{i,:}`,
    ],
    shapes: dims(R`(T\times T)\cdot(T\times d_k)\to(T\times d_k)`,
      R`<code>{T}×{T}</code> · <code>{T}×{dk}</code> → <code>{T}×{dk}</code> (cabeza {hd})`,
      R`\(A_h^{\top}\): la fila \(j\) de la traspuesta es la columna \(j\) de \(A_h\), es decir, quién miró al token \(j\).`),
    details: R`<p><b>Derivación.</b> \((V_h)_{jm}\) aparece en \((Z_h)_{im}\) para todas las consultas \(i\), con derivada \((A_h)_{ij}\):</p>
\[(\mathrm dV_h)_{jm} = \sum_i (A_h)_{ij}\,(\mathrm dZ_h)_{im} = \big(A_h^{\top}\mathrm dZ_h\big)_{jm}.\]
<p>Es la regla \(\mathrm dW = X^{\top}\mathrm dY\) con \(A_h\) en el papel de \(X\). La traspuesta aparece porque ahora recorremos las <em>columnas</em> de \(A_h\) (quién miró a \(j\)) en vez de sus filas.</p>
<p><b>El flujo se invierte.</b> En el forward la información viaja del pasado al futuro (la consulta \(i\) lee valores \(j\le i\)). En el backward, el error viaja del futuro al pasado: el valor \(j\) recibe gradiente solo de las consultas \(i\ge j\). El token <code>&lt;s&gt;</code>, visible para todos, puede recibir gradiente de todas las posiciones; el último token, solo de sí mismo.</p>
<p><b>Camino directo.</b> Este gradiente no atraviesa el softmax: es el camino «fácil» de la atención.</p>`,
    code: `dVh = A.T @ dZh                 # (T, T) @ (T, dk) -> (T, dk)`,
  };

  steps['bwd.attn.softmax'] = {
    title: 'Backward del softmax de atención',
    summary: 'Se aplica el jacobiano del softmax fila a fila: dŜ_h = A_h ⊙ (dA_h − rowsum(dA_h ⊙ A_h)).',
    intuition: R`<p>Como los pesos de cada fila deben sumar 1, dar más atención a un token obliga a quitársela a otros. Por eso lo que importa no es el valor de \(\mathrm dA_{ij}\) por sí solo, sino cómo se compara con la media de su fila (ponderada por la propia atención): si aumentar un peso reduce la pérdida más que la media, su puntuación subirá; si no, bajará. Además, todo se multiplica por \(A\): una entrada con peso casi nulo apenas puede moverse.</p>`,
    math: [
      R`\frac{\partial A_{ij}}{\partial\hat S_{ik}} = A_{ij}\,(\delta_{jk} - A_{ik})`,
      R`\mathrm d\hat S_{ik} = \sum_j \mathrm dA_{ij}\,A_{ij}(\delta_{jk} - A_{ik}) = A_{ik}\Big(\mathrm dA_{ik} - \sum_j \mathrm dA_{ij}A_{ij}\Big)`,
      R`\mathrm d\hat S_h = A_h\odot\big(\mathrm dA_h - \operatorname{rowsum}(\mathrm dA_h\odot A_h)\big)`,
    ],
    shapes: dims(R`(T\times T),\ (T\times T)\to(T\times T)`,
      R`<code>{T}×{T}</code> → <code>{T}×{T}</code> (cabeza {hd}); \(\operatorname{rowsum}\): <code>{T}×1</code>`,
      R`El vector \(\operatorname{rowsum}(\mathrm dA_h\odot A_h)\) (uno por fila, <code>rowDot</code> en la vista) se difunde a lo ancho de cada fila. En las dos primeras fórmulas se omite el subíndice de la cabeza.`),
    details: R`<p><b>Jacobiano de una fila.</b> Para \(\mathbf a = \operatorname{softmax}(\mathbf s)\): \(\partial a_j/\partial s_k = a_j(\delta_{jk}-a_k)\). Aplicando la regla de la cadena:</p>
\[\mathrm ds_k = \sum_j \mathrm da_j\,a_j(\delta_{jk}-a_k) = a_k\big(\mathrm da_k - \langle\mathrm d\mathbf a,\mathbf a\rangle\big).\]
<p>El escalar \(\langle\mathrm d\mathbf a,\mathbf a\rangle\) es la media del gradiente de la fila ponderada por la atención. Cada entrada se compara con esa media.</p>
<p><b>Propiedades.</b> Cada fila de \(\mathrm d\hat S_h\) suma 0, coherente con que el softmax ignore las constantes sumadas a una fila. Donde \(a_k = 0\) (posiciones enmascaradas) el gradiente es 0. Y si la fila está saturada (casi one-hot), todos los términos son diminutos y el gradiente se desvanece: de ahí la importancia de dividir por \(\sqrt{d_k}\).</p>
<p><b>Eficiencia.</b> Nunca se construye el jacobiano \(T\times T\) de cada fila: la fórmula cuesta \(O(T)\) por fila en lugar de \(O(T^2)\).</p>`,
    code: `rowdot = (dA * A).sum(1, keepdims=True)   # (T, 1)
dS_hat = A * (dA - rowdot)                # (T, T)`,
  };

  steps['bwd.attn.mask'] = {
    title: 'Backward de la máscara',
    summary: 'La máscara es una constante que se sumó: el gradiente pasa sin cambios, y en las posiciones tapadas es exactamente cero.',
    intuition: R`<p>Sumar una constante no cambia la pendiente: si \(\hat S = \tilde S + M\), un cambio en \(\tilde S\) produce exactamente el mismo cambio en \(\hat S\). Así que el gradiente atraviesa la máscara sin modificarse. En las posiciones del futuro, además, es exactamente cero: la puntuación de un token que no se puede ver no influye en nada, y lo que no influye no recibe gradiente.</p>`,
    math: [
      R`\hat S_h = \tilde S_h + M\ \Longrightarrow\ \frac{\partial(\hat S_h)_{ij}}{\partial(\tilde S_h)_{ij}} = 1`,
      R`\mathrm d\tilde S_h = \mathrm d\hat S_h,\qquad (\mathrm d\tilde S_h)_{ij} = 0\ \text{ si } j > i`,
    ],
    shapes: dims(R`(T\times T)\to(T\times T)`,
      R`<code>{T}×{T}</code> → <code>{T}×{T}</code> (cabeza {hd})`,
      R`\(M\) no recibe gradiente: es una constante, no un parámetro.`),
    details: R`<p><b>Derivación.</b> \(\partial\hat S_{ij}/\partial\tilde S_{ij} = 1\) para todo par, así que \(\mathrm d\tilde S_h = \mathrm d\hat S_h\). \(M\) es una constante (no un parámetro), así que no hace falta calcular su gradiente.</p>
<p><b>¿Por qué forzar los ceros si ya lo son?</b> En las posiciones \(j\gt i\), el paso anterior ya dio \(A_{ij}(\dots) = 0\), porque \(A_{ij} = 0\). La implementación las pone a 0 explícitamente como medida de seguridad: con \(-\infty\) de por medio, expresiones como \(0\cdot\infty\) o \(\infty-\infty\) producirían <code>NaN</code>, que se propagaría a todo el modelo.</p>
<p><b>Consecuencia.</b> \(W_Q\) y \(W_K\) aprenden solo de pares (consulta, clave) visibles. Aunque \(\mathrm dA_h\) indicaba que «mirar al futuro ayudaría», esa información se descarta aquí: el modelo no puede hacer trampas ni siquiera a través del gradiente.</p>
<p><b>Qué observar.</b> En el mapa de calor de \(\mathrm d\tilde S_h\), el triángulo superior es exactamente 0.</p>`,
    code: `dS_tilde = np.where(M == 0, dS_hat, 0.0)   # futuro: gradiente 0`,
  };

  steps['bwd.attn.scale'] = {
    title: 'Backward del escalado',
    summary: 'Como S̃ = S/√d_k, el gradiente se multiplica por el mismo factor: dS_h = dS̃_h / √d_k.',
    intuition: R`<p>El escalado es lineal: si la salida es la entrada dividida por \(\sqrt{d_k}\), un cambio en la entrada produce un cambio \(\sqrt{d_k}\) veces más pequeño en la salida. Por eso la sensibilidad de la pérdida respecto de \(S_h\) es \(1/\sqrt{d_k}\) veces la que tiene respecto de \(\tilde S_h\): el gradiente también se divide por \(\sqrt{d_k}\).</p>`,
    math: [
      R`\tilde S_h = c\,S_h,\qquad c = \frac{1}{\sqrt{d_k}}`,
      R`\mathrm dS_h = c\;\mathrm d\tilde S_h = \frac{\mathrm d\tilde S_h}{\sqrt{d_k}}`,
    ],
    shapes: dims(R`(T\times T)\to(T\times T)`,
      R`<code>{T}×{T}</code> → <code>{T}×{T}</code>, multiplicando por \(1/\sqrt{ {dk} }\) (cabeza {hd})`,
      R`El mismo escalar del forward; la forma no cambia.`),
    details: R`<p><b>Derivación.</b> \(\tilde S_{ij} = c\,S_{ij}\) depende solo de \(S_{ij}\), con derivada \(c\). Por la regla de la cadena, \(\mathrm dS_{ij} = \mathrm d\tilde S_{ij}\cdot c\).</p>
<p><b>¿Por qué dividir otra vez y no multiplicar?</b> Es una confusión muy común pensar que el backward «deshace» el forward (y que, por tanto, habría que multiplicar por \(\sqrt{d_k}\)). No: el backward propaga <em>derivadas</em>, no inversas. Una operación lineal \(y = cx\) tiene derivada \(c\), así que el gradiente se multiplica por el mismo \(c\) que usó el forward. Si el forward encoge las puntuaciones a la mitad, cualquier cambio en \(S\) solo se nota a medias en \(\tilde S\), y por eso \(S\) tiene la mitad de influencia sobre la pérdida.</p>
<p><b>Efecto.</b> Los gradientes que llegarán a \(Q_h\) y \(K_h\) quedan atenuados por \(\sqrt{d_k}\) (aquí, \(\sqrt{ {dk} }\)), en equilibrio con el forward.</p>
<p><b>Error típico.</b> Olvidar este factor: los gradientes de \(W_Q\) y \(W_K\) saldrían multiplicados por \(\sqrt{d_k}\), y la comprobación numérica de gradientes lo delataría.</p>`,
    code: `dS = dS_tilde / np.sqrt(dk)     # (T, T)`,
  };

  steps['bwd.attn.scores.dQ'] = {
    title: 'Gradiente de las consultas Q_h',
    summary: 'dQ_h = dS_h · K_h: cada consulta se acerca a las claves cuyas puntuaciones debían subir y se aleja de las que debían bajar.',
    intuition: R`<p>Cada consulta se comparó con las claves visibles; su gradiente es una combinación de esas claves, ponderada por cuánto debía cambiar cada puntuación. El descenso por gradiente acerca la consulta \(\mathbf q_i\) a las claves cuyas puntuaciones debían subir (\(\mathrm dS_{ij}\lt 0\)) y la aleja de las que debían bajar. Así es como «come» aprende a formular una pregunta que encaje con la clave de «gato».</p>`,
    math: [
      R`S_h = Q_hK_h^{\top}\ \Longrightarrow\ \mathrm dQ_h = \mathrm dS_h\,K_h`,
      R`\mathrm d\mathbf q_i = \sum_{j\le i}(\mathrm dS_h)_{ij}\,\mathbf k_j`,
    ],
    shapes: dims(R`(T\times T)\cdot(T\times d_k)\to(T\times d_k)`,
      R`<code>{T}×{T}</code> · <code>{T}×{dk}</code> → <code>{T}×{dk}</code> (cabeza {hd})`,
      R`Se contrae el eje de las claves; el resultado tiene la forma de \(Q_h\).`),
    details: R`<p><b>Derivación.</b> \((S_h)_{ij} = \sum_m (Q_h)_{im}(K_h)_{jm}\), luego \(\partial (S_h)_{ij}/\partial (Q_h)_{im} = (K_h)_{jm}\). La consulta \(i\) interviene en toda la fila \(i\) de \(S_h\):</p>
\[(\mathrm dQ_h)_{im} = \sum_j (\mathrm dS_h)_{ij}\,(K_h)_{jm} = \big(\mathrm dS_h\,K_h\big)_{im}.\]
<p>También sale de la regla general: con \(Y = XB\), \(\mathrm dX = \mathrm dY\,B^{\top}\); aquí \(B = K_h^{\top}\) y \(B^{\top} = K_h\).</p>
<p><b>Solo claves visibles.</b> Como \(\mathrm dS_h\) es cero por encima de la diagonal, la suma real es sobre \(j\le i\): la consulta del token \(i\) solo aprende de los tokens que podía ver.</p>
<p><b>Qué observar.</b> Cada fila de \(\mathrm dQ_h\) es una combinación lineal de las filas de \(K_h\), con los coeficientes de la fila correspondiente de \(\mathrm dS_h\).</p>`,
    code: `dQh = dS @ Kh                   # (T, T) @ (T, dk) -> (T, dk)`,
  };

  steps['bwd.attn.scores.dK'] = {
    title: 'Gradiente de las claves K_h',
    summary: 'dK_h = dS_hᵀ · Q_h: cada clave recibe la influencia de todas las consultas que la compararon.',
    intuition: R`<p>Una clave participa en la comparación con todas las consultas que pueden verla. Su gradiente combina esas consultas, ponderadas por cuánto debía cambiar cada puntuación. Así, el token «gato» aprende a «anunciarse» de forma que las consultas que lo necesitan (como la de «come») lo encuentren.</p>`,
    math: [
      R`S_h = Q_hK_h^{\top}\ \Longrightarrow\ \mathrm dK_h = \mathrm dS_h^{\top}\,Q_h`,
      R`\mathrm d\mathbf k_j = \sum_{i\ge j}(\mathrm dS_h)_{ij}\,\mathbf q_i`,
    ],
    shapes: dims(R`(T\times T)\cdot(T\times d_k)\to(T\times d_k)`,
      R`<code>{T}×{T}</code> (traspuesta) · <code>{T}×{dk}</code> → <code>{T}×{dk}</code> (cabeza {hd})`,
      R`Al trasponer \(\mathrm dS_h\), sus filas pasan a ser las claves. El resultado tiene la forma de \(K_h\).`),
    details: R`<p><b>Derivación.</b> \((K_h)_{jm}\) aparece en toda la <em>columna</em> \(j\) de \(S_h\), con derivada \((Q_h)_{im}\):</p>
\[(\mathrm dK_h)_{jm} = \sum_i (\mathrm dS_h)_{ij}\,(Q_h)_{im} = \big(\mathrm dS_h^{\top}Q_h\big)_{jm}.\]
<p>Con la regla general: \(\mathrm d(K_h^{\top}) = Q_h^{\top}\mathrm dS_h\) y, trasponiendo, \(\mathrm dK_h = \mathrm dS_h^{\top}Q_h\).</p>
<p><b>Simetría de papeles.</b> Para \(\mathrm dQ_h\) se recorre una fila de \(\mathrm dS_h\) (las claves que vio la consulta); para \(\mathrm dK_h\), una columna (las consultas que vieron la clave). Por eso aparece la traspuesta. Por la máscara, la clave \(j\) solo recibe gradiente de las consultas \(i\ge j\).</p>
<p><b>Error típico, y traicionero.</b> Escribir \(\mathrm dS_h\,Q_h\) sin trasponer. Como \(\mathrm dS_h\) es cuadrada (\(T\times T\)), <em>la forma sale bien</em> y el código no da ningún error: solo la comprobación numérica de gradientes lo delata.</p>`,
    code: `dKh = dS.T @ Qh                 # (T, T) @ (T, dk) -> (T, dk)`,
  };

  // ── Backward: de vuelta a las proyecciones ──
  steps['bwd.attn.split'] = {
    title: 'Reunir los gradientes de las cabezas',
    summary: 'Los gradientes dQ_h, dK_h y dV_h de todas las cabezas se concatenan por columnas para formar dQ, dK y dV completos.',
    intuition: R`<p>Cada cabeza ya tiene los gradientes de su bloque de consultas, claves y valores. Como en el forward las obtuvimos cortando \(Q\), \(K\) y \(V\) por columnas, ahora hacemos lo contrario: pegamos los bloques para recuperar los gradientes de las matrices completas.</p>`,
    math: [
      R`\mathrm dQ = [\,\mathrm dQ_1\,\|\,\cdots\,\|\,\mathrm dQ_h\,],\quad \mathrm dK = [\,\mathrm dK_1\,\|\,\cdots\,\|\,\mathrm dK_h\,],\quad \mathrm dV = [\,\mathrm dV_1\,\|\,\cdots\,\|\,\mathrm dV_h\,]`,
    ],
    shapes: dims(R`h\times(T\times d_k)\to(T\times d)\quad\text{(tres veces)}`,
      R`{h} bloques de <code>{T}×{dk}</code> → <code>{T}×{d}</code>, para \(\mathrm dQ\), \(\mathrm dK\) y \(\mathrm dV\)`,
      R`Una concatenación sin aritmética.`),
    details: R`<p><b>Dualidad.</b> En el forward dividimos \(Q\), \(K\) y \(V\) en bloques de columnas; en el backward, los gradientes de cada bloque vuelven a su sitio concatenándolos. No hay aritmética: el bloque de columnas de la cabeza \(h\) en \(\mathrm dQ\) es exactamente \(\mathrm dQ_h\).</p>
<p><b>Qué contiene cada bloque.</b> Cada bloque refleja lo que su cabeza necesitaba: si una cabeza aprende a buscar el sujeto y otra la palabra anterior, sus bloques de \(\mathrm dQ\) y \(\mathrm dK\) empujan en direcciones distintas.</p>
<p><b>Consecuencia para los pesos.</b> Como \(Q = H\,W_Q\), el bloque de columnas de \(W_Q\) de la cabeza \(h\) solo recibe gradiente de \(\mathrm dQ_h\). Las cabezas comparten la entrada \(H\), pero cada una tiene sus propias columnas de \(W_Q\), \(W_K\) y \(W_V\).</p>`,
    code: `dQ = np.concatenate(dQ_heads, axis=1)   # (T, d); igual para dK y dV`,
  };

  steps['bwd.attn.q.dW'] = {
    title: 'Gradiente de W_Q',
    summary: 'dW_Q = Hᵀ · dQ: la matriz de consultas aprende a partir de la entrada normalizada y del error que llegó a las consultas.',
    intuition: R`<p>\(W_Q\) decide qué pregunta formula cada token. Su gradiente combina lo que había en \(H\) con cómo debían cambiar las consultas. Si el token «come» debía buscar más al sujeto, se ajustan los pesos que construyen esa búsqueda a partir de las características de «come».</p>`,
    math: [
      R`\mathrm dW_Q = H^{\top}\,\mathrm dQ`,
      R`(\mathrm dW_Q)_{ji} = \sum_{t=1}^T H_{tj}\,\mathrm dQ_{ti}`,
    ],
    shapes: dims(R`(d\times T)\cdot(T\times d)\to(d\times d)`,
      R`<code>{d}×{T}</code> · <code>{T}×{d}</code> → <code>{d}×{d}</code>`,
      R`La forma de \(W_Q\); se contrae el eje de las posiciones.`),
    details: R`<p><b>Derivación.</b> \(Q = H\,W_Q\) es una capa lineal sin sesgo, así que \(\mathrm dW_Q = H^{\top}\mathrm dQ\), con el mismo razonamiento que para \(W_{\text{out}}\), \(W_2\) o \(W_1\): \(\partial Q_{ti}/\partial (W_Q)_{ji} = H_{tj}\), y se suma sobre las posiciones \(t\).</p>
<p><b>Uno de los caminos más largos.</b> Junto con el de \(W_K\), este gradiente es el que más operaciones ha atravesado dentro de la capa: pérdida → logits → \(W_{\text{out}}\) → LN_f → atajo residual → \(W_O\) → mezcla con \(A_h\) → softmax → máscara → escalado → \(Q_hK_h^{\top}\) → \(Q\). Si el softmax está saturado, llegará muy atenuado.</p>
<p><b>Bloques de columnas.</b> Las columnas de la cabeza \(h\) de \(\mathrm dW_Q\) son \(H^{\top}\mathrm dQ_h\): cada cabeza entrena solo su parte de \(W_Q\).</p>`,
    code: `dWq = H.T @ dQ                  # (d, T) @ (T, d) -> (d, d)`,
  };

  steps['bwd.attn.k.dW'] = {
    title: 'Gradiente de W_K',
    summary: 'dW_K = Hᵀ · dK: la matriz de claves aprende de la entrada normalizada y del error que llegó a las claves.',
    intuition: R`<p>\(W_K\) decide cómo se anuncia cada token. Su gradiente combina \(H\) con cómo debían cambiar las claves: si «gato» debía ser más fácil de encontrar para la consulta de «come», se ajustan los pesos que construyen la clave a partir de las características de «gato».</p>`,
    math: [
      R`\mathrm dW_K = H^{\top}\,\mathrm dK`,
      R`(\mathrm dW_K)_{ji} = \sum_{t=1}^T H_{tj}\,\mathrm dK_{ti}`,
    ],
    shapes: dims(R`(d\times T)\cdot(T\times d)\to(d\times d)`,
      R`<code>{d}×{T}</code> · <code>{T}×{d}</code> → <code>{d}×{d}</code>`,
      R`La forma de \(W_K\).`),
    details: R`<p><b>Derivación.</b> Igual que para \(W_Q\): \(K = H\,W_K\Rightarrow \mathrm dW_K = H^{\top}\mathrm dK\).</p>
<p><b>Consultas y claves se entrenan juntas.</b> Recuerda que \(\mathrm dK_h = \mathrm dS_h^{\top}Q_h\) y \(\mathrm dQ_h = \mathrm dS_h K_h\): el gradiente de las claves depende de las consultas actuales, y viceversa. Lo que se aprende en realidad es la forma bilineal \(W_QW_K^{\top}\) (por cabeza); \(W_Q\) y \(W_K\) son sus dos factores, y cada uno se ajusta en función del otro.</p>
<p><b>Por qué dos matrices y no una.</b> Si \(W_Q\) y \(W_K\) fueran iguales, las puntuaciones formarían una matriz simétrica (\(S_{ij} = S_{ji}\)) con la diagonal no negativa (\(\mathbf q_i\cdot\mathbf q_i = \|\mathbf q_i\|^2\ge 0\)), lo que favorece que cada token se atienda a sí mismo. Como se inicializan por separado y reciben gradientes distintos, la compatibilidad puede ser asimétrica: «come» puede buscar a «gato» sin que «gato» busque a «come».</p>`,
    code: `dWk = H.T @ dK                  # (d, T) @ (T, d) -> (d, d)`,
  };

  steps['bwd.attn.v.dW'] = {
    title: 'Gradiente de W_V',
    summary: 'dW_V = Hᵀ · dV: la matriz de valores aprende qué contenido conviene que entregue cada token.',
    intuition: R`<p>\(W_V\) decide qué información entrega cada token cuando otros le prestan atención. Su gradiente combina \(H\) con cómo debían cambiar los valores: si el valor de «gato» debía llevar más claramente la pista «pescado», se ajustan los pesos que lo construyen.</p>`,
    math: [
      R`\mathrm dW_V = H^{\top}\,\mathrm dV`,
      R`(\mathrm dW_V)_{ji} = \sum_{t=1}^T H_{tj}\,\mathrm dV_{ti}`,
    ],
    shapes: dims(R`(d\times T)\cdot(T\times d)\to(d\times d)`,
      R`<code>{d}×{T}</code> · <code>{T}×{d}</code> → <code>{d}×{d}</code>`,
      R`La forma de \(W_V\).`),
    details: R`<p><b>Derivación.</b> \(V = H\,W_V\Rightarrow \mathrm dW_V = H^{\top}\mathrm dV\), con \(\mathrm dV = [\,\mathrm dV_1\,\|\,\cdots\,\|\,\mathrm dV_h\,]\) y \(\mathrm dV_h = A_h^{\top}\mathrm dZ_h\).</p>
<p><b>El camino fácil.</b> A diferencia de \(W_Q\) y \(W_K\), el gradiente de \(W_V\) no atraviesa el softmax, la máscara ni el escalado: solo \(W_O\) y la mezcla con \(A_h\). Por eso no sufre la saturación del softmax y suele llegar con más fuerza (compara el tamaño de \(\mathrm dW_V\) con el de \(\mathrm dW_Q\)).</p>
<p><b>Ponderado por la atención.</b> Un token al que casi nadie atiende contribuye poco a \(\mathrm dV\) y, por tanto, a \(\mathrm dW_V\): los valores se entrenan sobre todo con los tokens que realmente se leen.</p>
<p><b>Forma.</b> \((d\times T)(T\times d)\to d\times d\), la de \(W_V\).</p>`,
    code: `dWv = H.T @ dV                  # (d, T) @ (T, d) -> (d, d)`,
  };

  steps['bwd.attn.q.dX'] = {
    title: 'Gradiente hacia H por el camino de Q',
    summary: 'dQ · W_Qᵀ es la parte del gradiente de H que llega a través de las consultas.',
    intuition: R`<p>\(H\) se usó tres veces: para construir \(Q\), \(K\) y \(V\). Cada uso devuelve su propia contribución al gradiente de \(H\), y las tres se sumarán al final. Esta primera es la del camino de las consultas: cómo debería cambiar cada token para <b>preguntar</b> mejor.</p>`,
    math: [
      R`\mathrm dH_Q = \mathrm dQ\,W_Q^{\top}`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> · <code>{d}×{d}</code> → <code>{T}×{d}</code>`,
      R`Una contribución con la forma de \(H\); todavía falta sumar las otras dos.`),
    details: R`<p><b>Derivación.</b> Para \(Q = H\,W_Q\), la regla \(\mathrm dX = \mathrm dY\,W^{\top}\) da la contribución \(\mathrm dQ\,W_Q^{\top}\). La llamamos \(\mathrm dH_Q\), y no \(\mathrm dH\), porque todavía no es el gradiente completo: faltan los caminos de \(K\) y de \(V\).</p>
<p><b>Qué token recibe qué.</b> La fila \(i\) de \(\mathrm dH_Q\) procede de la consulta del token \(i\), que se comparó con las claves de los tokens \(j\le i\). Así, el gradiente de cada token por este camino depende de los tokens <em>anteriores</em> a él (y de él mismo).</p>
<p><b>Mismo patrón que en la FFN.</b> Es la misma operación que \(\mathrm dH' = \mathrm dU\,W_1^{\top}\): error de la salida por la traspuesta de los pesos. Lo único especial aquí es que \(H\) tiene tres «salidas».</p>`,
    code: `dH_q = dQ @ Wq.T                # (T, d) @ (d, d) -> (T, d)`,
  };

  steps['bwd.attn.k.dX'] = {
    title: 'Gradiente hacia H por el camino de K',
    summary: 'dK · W_Kᵀ es la parte del gradiente de H que llega a través de las claves.',
    intuition: R`<p>Segunda contribución: cómo debería cambiar cada token para <b>anunciarse</b> mejor ante las consultas de los demás. Es un canal curioso: el token \(j\) recibe por aquí gradiente de las consultas de los tokens <em>posteriores</em> a él (y de la suya propia), que se compararon con su clave.</p>`,
    math: [
      R`\mathrm dH_K = \mathrm dK\,W_K^{\top}`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> · <code>{d}×{d}</code> → <code>{T}×{d}</code>`,
      R`Segunda contribución con la forma de \(H\).`),
    details: R`<p><b>Derivación.</b> \(K = H\,W_K\Rightarrow \mathrm dH_K = \mathrm dK\,W_K^{\top}\).</p>
<p><b>El futuro enseña al pasado.</b> Como \(\mathrm d\mathbf k_j = \sum_{i\ge j}(\mathrm dS_h)_{ij}\,\mathbf q_i\), la fila \(j\) de \(\mathrm dH_K\) está hecha de consultas de posiciones \(i\ge j\). Por ejemplo, «gato» recibe por aquí la señal «“come” necesitaba encontrarte más fácilmente». En el forward la información solo va hacia delante; en el backward, este camino (y el de \(V\)) lleva el error hacia atrás en la secuencia.</p>
<p><b>Relación con \(Q\).</b> Los caminos de \(Q\) y \(K\) nacen del mismo \(\mathrm dS_h\): uno lo reparte por filas y el otro por columnas.</p>
<p><b>Forma.</b> <code>{T}×{d}</code>, igual que \(H\).</p>`,
    code: `dH_k = dK @ Wk.T                # (T, d) @ (d, d) -> (T, d)`,
  };

  steps['bwd.attn.v.dX'] = {
    title: 'Gradiente hacia H por el camino de V',
    summary: 'dV · W_Vᵀ es la parte del gradiente de H que llega a través de los valores.',
    intuition: R`<p>Tercera contribución: cómo debería cambiar cada token para <b>aportar</b> un contenido más útil a quienes lo leen. Cuanta más atención recibió un token, más gradiente le llega por este camino.</p>`,
    math: [
      R`\mathrm dH_V = \mathrm dV\,W_V^{\top}`,
    ],
    shapes: dims(R`(T\times d)\cdot(d\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> · <code>{d}×{d}</code> → <code>{T}×{d}</code>`,
      R`Tercera contribución con la forma de \(H\).`),
    details: R`<p><b>Derivación.</b> \(V = H\,W_V\Rightarrow \mathrm dH_V = \mathrm dV\,W_V^{\top}\), con \(\mathrm dV_h = A_h^{\top}\mathrm dZ_h\).</p>
<p><b>Ponderado por la atención recibida.</b> La fila \(j\) de \(\mathrm dV_h\) es \(\sum_{i\ge j}(A_h)_{ij}\,\mathrm d\mathbf z_i\): el error de cada lector, multiplicado por cuánto leyó al token \(j\). El token <code>&lt;s&gt;</code>, visible para todas las posiciones y a menudo muy atendido, suele recibir aquí bastante gradiente.</p>
<p><b>Sin softmax de por medio.</b> Este camino no pasa por el jacobiano del softmax, así que no sufre su saturación. Es, además, el único de los tres que existiría aunque la atención fuera fija (por ejemplo, uniforme).</p>
<p><b>Forma.</b> <code>{T}×{d}</code>. En el paso siguiente se suman las tres contribuciones.</p>`,
    code: `dH_v = dV @ Wv.T                # (T, d) @ (d, d) -> (T, d)`,
  };

  steps['bwd.attn.dH'] = {
    title: 'Sumar las tres contribuciones a dH',
    summary: 'H se usó tres veces (para Q, K y V), así que su gradiente total es la suma de las tres contribuciones.',
    intuition: R`<p>Un mismo \(H\) alimentó a tres proyecciones. Cada una ha devuelto su opinión sobre cómo debería cambiar \(H\): para preguntar mejor, para anunciarse mejor y para aportar mejor contenido. El gradiente total es simplemente la suma de las tres opiniones.</p>`,
    math: [
      R`\mathrm dH = \mathrm dH_Q + \mathrm dH_K + \mathrm dH_V = \mathrm dQ\,W_Q^{\top} + \mathrm dK\,W_K^{\top} + \mathrm dV\,W_V^{\top}`,
      R`\mathrm dH = \big[\,\mathrm dQ\,\|\,\mathrm dK\,\|\,\mathrm dV\,\big]\begin{bmatrix} W_Q^{\top}\\ W_K^{\top}\\ W_V^{\top}\end{bmatrix}`,
    ],
    shapes: dims(R`(T\times d) + (T\times d) + (T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> + <code>{T}×{d}</code> + <code>{T}×{d}</code> → <code>{T}×{d}</code>`,
      R`En la forma por bloques: \((T\times 3d)\cdot(3d\times d)\to(T\times d)\).`),
    details: R`<p><b>Bifurcación ⇒ suma.</b> \(H\) alimentó a tres productos, así que \(\mathcal L\) depende de \(H\) por tres caminos y, por la regla de la cadena multivariable, su gradiente es la suma de las tres contribuciones. Es la misma regla que en las conexiones residuales.</p>
<p><b>Versión fusionada.</b> Muchas implementaciones calculan \(Q\), \(K\) y \(V\) de una vez con \(W_{QKV} = [\,W_Q\,\|\,W_K\,\|\,W_V\,]\in\mathbb R^{d\times 3d}\). Entonces el backward es un único producto: \(\mathrm dH = [\,\mathrm dQ\,\|\,\mathrm dK\,\|\,\mathrm dV\,]\,W_{QKV}^{\top}\), que es exactamente la suma de arriba escrita por bloques.</p>
<p><b>Qué observar.</b> Compara las tres matrices que se suman en este paso: dicen qué papel (preguntar, anunciarse o aportar contenido) está pidiendo más cambios a cada token.</p>`,
    code: `dH = dQ @ Wq.T + dK @ Wk.T + dV @ Wv.T   # (T, d)`,
  };

  steps['bwd.ln1'] = {
    title: 'Backward de LayerNorm 1',
    summary: 'dH atraviesa LN₁: se obtienen dγ₁, dβ₁ y la contribución de la rama de atención al gradiente de la entrada de la capa.',
    intuition: R`<p>Último tramo de la capa: el gradiente \(\mathrm dH\), que resume todo lo que la atención necesita que cambie en su entrada, atraviesa LN₁. Como en LN₂ y LN_f, se obtienen los gradientes de \(\gamma_1\) y \(\beta_1\) y un gradiente para la entrada sin las componentes que solo moverían la media o la escala de cada fila.</p>`,
    math: [
      R`\mathrm d\beta_1 = \textstyle\sum_{\text{filas}}\mathrm dH,\qquad \mathrm d\gamma_1 = \sum_{\text{filas}}\mathrm dH\odot\hat X`,
      R`\mathrm d\hat X = \mathrm dH\odot\gamma_1`,
      R`\mathrm dX^{[l-1]}_{\text{LN}} = r\odot\Big(\mathrm d\hat X - \overline{\mathrm d\hat X} - \hat X\odot\overline{\mathrm d\hat X\odot\hat X}\Big)`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d),\ \ (1\times d),\ \ (1\times d)`,
      R`\(\mathrm dH\): <code>{T}×{d}</code> → \(\mathrm dX^{[l-1]}_{\text{LN}}\): <code>{T}×{d}</code>; \(\mathrm d\gamma_1,\mathrm d\beta_1\): <code>1×{d}</code>`,
      R`\(\hat X\) es la entrada de la capa normalizada, guardada en el forward.`),
    details: R`<p><b>Receta en tres líneas.</b> (1) Parámetros: \(\mathrm d\beta_1\) es la suma de las filas de \(\mathrm dH\), y \(\mathrm d\gamma_1\), la de las filas de \(\mathrm dH\odot\hat X\). (2) Atravesar la escala: \(\mathrm d\hat X = \mathrm dH\odot\gamma_1\). (3) Proyectar: restar a cada fila su media y (casi exactamente) su componente en la dirección de \(\hat{\mathbf x}_t\), y multiplicar por \(r_t\).</p>
<p><b>Interpretar \(\mathrm d\gamma_1\).</b> Una componente negativa de \(\mathrm d\gamma_1\) indica que amplificar esa característica antes de la atención reduciría la pérdida: el modelo querría que pesara más a la hora de formar \(Q\), \(K\) y \(V\).</p>
<p><b>Qué contiene \(\mathrm dX^{[l-1]}_{\text{LN}}\).</b> Toda la influencia de la subcapa de atención sobre la entrada de la capa, a través de sus tres papeles. En el paso siguiente se sumará al gradiente del atajo.</p>`,
    code: `dxhat = dH * gamma1; dgamma1 = (dH * Xhat).sum(0); dbeta1 = dH.sum(0)
dX_ln = r * (dxhat - dxhat.mean(1, keepdims=True)
             - Xhat * (dxhat * Xhat).mean(1, keepdims=True))`,
  };

  steps['bwd.res1.merge'] = {
    title: 'Residual 1: gradiente de la entrada de la capa',
    summary: 'El gradiente de la entrada de la capa es la suma del que llegó por el atajo (dR) y del que regresó a través de LN₁ y la atención (dX_LN).',
    intuition: R`<p>La entrada de la capa se usó dos veces: se sumó directamente en \(R\) y alimentó a LN₁ (y, con ella, a toda la atención). Su gradiente total es la suma de ambos caminos. Con esto termina el backward de la capa {l}.</p>`,
    math: [
      R`\mathrm dX^{[l-1]} = \underbrace{\mathrm dX^{[l-1]}_{\text{directo}}}_{=\,\mathrm dR\ \text{(atajo)}} + \underbrace{\mathrm dX^{[l-1]}_{\text{LN}}}_{\text{rama de atención}}`,
      R`\mathrm dX^{[l-1]} = \mathrm dX^{[l]} + \mathrm dR_{\text{LN}} + \mathrm dX^{[l-1]}_{\text{LN}}`,
    ],
    shapes: dims(R`(T\times d) + (T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> + <code>{T}×{d}</code> → <code>{T}×{d}</code>`,
      R`El gradiente de la entrada tiene la misma forma que el de la salida: por eso el mismo procedimiento sirve para cualquier número de capas.`),
    details: R`<p><b>Otra vez: bifurcación ⇒ suma.</b> \(X^{[l-1]}\) alimentó al atajo y a LN₁; su gradiente es la suma del atajo \(\mathrm dR\) y de la contribución de la atención \(\mathrm dX^{[l-1]}_{\text{LN}}\).</p>
<p><b>La capa completa, de un vistazo.</b> Desplegando \(\mathrm dR\), el gradiente de la entrada es el de la salida más dos correcciones: la de la FFN y la de la atención (segunda fórmula).</p>
<p><b>La autopista, en números.</b> \(\mathrm dX^{[l]}\) aparece tal cual dentro de \(\mathrm dX^{[l-1]}\). Con \(N\) capas, \(\mathrm dX^{[0]}\) contiene \(\mathrm dX^{[N]}\) sin transformar, más la suma de todas las correcciones: el gradiente del final nunca se pierde por el camino.</p>
<p><b>¿Y ahora?</b> Si hay más capas, este gradiente es el punto de partida del backward de la capa anterior, que repite los mismos pasos. Tras la primera capa, \(\mathrm dX^{[0]}\) baja hasta la codificación posicional y el embedding.</p>`,
    code: `dX_prev = dR + dX_ln            # (T, d): gradiente de la entrada de la capa`,
  };

  // ── Backward: entrada ──
  steps['bwd.posenc'] = {
    title: 'Backward de la codificación posicional',
    summary: 'Como la entrada a la primera capa es la suma del embedding y la codificación posicional, el gradiente se copia a ambos: al embedding siempre y a P_pos solo si la codificación es aprendida.',
    intuition: R`<p>En el forward, la entrada a la primera capa era una suma: embedding + posición. En el backward el gradiente se copia a los dos sumandos. Con la codificación <b>sinusoidal</b> la tabla de posiciones es fija, así que su copia no se usa para nada; con la <b>aprendida</b>, las filas de \(P_{\text{pos}}\) de las posiciones usadas reciben el gradiente y se actualizarán.</p>`,
    math: [
      R`\mathrm dX_{\text{emb}} = \mathrm dX^{[0]}`,
      R`\text{(aprendida)}\qquad \mathrm d(P_{\text{pos}})_{0:T} = \mathrm dX^{[0]},\qquad \mathrm d(P_{\text{pos}})_{T:\text{maxLen}} = 0`,
    ],
    shapes: dims(R`(T\times d)\to(T\times d)`,
      R`<code>{T}×{d}</code> → \(\mathrm dX_{\text{emb}}\): <code>{T}×{d}</code> (y, si es aprendida, las primeras {T} filas de \(\mathrm dP_{\text{pos}}\))`,
      R`\(P_{\text{pos}}\) tiene maxLen filas; las posiciones que no aparecen en esta frase reciben gradiente 0.`),
    details: R`<p><b>Derivación.</b> \(X^{[0]} = X_{\text{emb}} + PE_{0:T}\) es una suma: la derivada respecto de cada sumando es 1 y el gradiente se copia sin cambios, \(\mathrm dX_{\text{emb}} = \mathrm dX^{[0]}\).</p>
<p><b>Sinusoidal.</b> \(PE\) es una función fija de la posición, sin parámetros: su gradiente existe (es el mismo \(\mathrm dX^{[0]}\)), pero no hay nada que actualizar.</p>
<p><b>Aprendida.</b> La fila \(t\) de \(P_{\text{pos}}\) se sumó al token de la posición \(t\), así que recibe la fila \(t\) de \(\mathrm dX^{[0]}\) para las \(T\) posiciones usadas, y 0 el resto. Fíjate en la diferencia con el embedding: \(E\) se indexa por <em>qué</em> token es; \(P_{\text{pos}}\), por <em>dónde</em> está. La misma fila de \(P_{\text{pos}}\) aprende de todos los tokens que pasan por esa posición en distintas frases.</p>
<p><b>Limitación.</b> Una posición que nunca aparece en el entrenamiento (más allá de la frase más larga) no recibe gradiente nunca y conserva su valor inicial aleatorio.</p>`,
    code: `dX_emb = dX0.copy()             # (T, d)
if learned: dPpos[:T] += dX0    # solo con codificación aprendida`,
  };

  steps['bwd.embed'] = {
    title: 'Gradiente de la tabla de embeddings',
    summary: 'dE = onehot(x)ᵀ · dX_emb: el gradiente de cada fila de E es la suma de los gradientes de las posiciones donde aparece ese token.',
    intuition: R`<p>Último paso del backward. Cada fila de \(E\) se usó en las posiciones donde aparecía su token; su gradiente es la suma de los gradientes de esas posiciones. Las palabras que no aparecen en la frase reciben gradiente cero: en esta iteración, sus vectores no tienen nada que aprender.</p>`,
    math: [
      R`\mathrm dE = \operatorname{onehot}(\mathbf x)^{\top}\,\mathrm dX_{\text{emb}}`,
      R`\mathrm dE_{v,:} = \sum_{t\,:\,x_t = v}(\mathrm dX_{\text{emb}})_{t,:}`,
    ],
    shapes: dims(R`(V\times T)\cdot(T\times d)\to(V\times d)`,
      R`<code>{V}×{T}</code> · <code>{T}×{d}</code> → <code>{V}×{d}</code>`,
      R`El resultado tiene la forma de \(E\), pero como mucho {T} de sus {V} filas son distintas de cero.`),
    details: R`<p><b>Derivación.</b> En el forward, \(X_{\text{emb}} = \operatorname{onehot}(\mathbf x)\,E\): un producto de matrices cuyo primer factor es constante. La regla \(\mathrm dW = X^{\top}\mathrm dY\) da directamente \(\mathrm dE = \operatorname{onehot}(\mathbf x)^{\top}\mathrm dX_{\text{emb}}\). La one-hot traspuesta (\(V\times T\)) tiene un 1 en \((v, t)\) si el token \(t\) es \(v\): multiplicar por ella «reparte» cada fila de \(\mathrm dX_{\text{emb}}\) a la fila de su token.</p>
<p><b>Los tokens repetidos se suman.</b> Si una palabra aparece dos veces (como «el» en «el perro duerme en el jardín .»), su fila de \(\mathrm dE\) es la suma de dos gradientes. Trampa clásica en NumPy: <code>dE[ids] += dX</code> <em>no</em> acumula los índices repetidos (solo cuenta una vez); hay que usar <code>np.add.at</code>.</p>
<p><b>Actualización dispersa.</b> Con SGD solo se mueven las filas de los tokens presentes. Con Adam, las demás pueden moverse un poco por el momento \(m\) acumulado en iteraciones anteriores.</p>
<p>Con esto, <b>todos los parámetros tienen su gradiente</b> y empieza la fase de actualización.</p>`,
    code: `dE = np.zeros_like(E)           # (V, d)
np.add.at(dE, ids, dX_emb)      # scatter-add: acumula tokens repetidos`,
  };

  // ── Actualización ──
  steps['upd.gradnorm'] = {
    title: 'Norma del gradiente y recorte',
    summary: 'Se mide el tamaño total del gradiente (su norma L2 global) y, si supera el umbral, se reescalan todos los gradientes para que no lo sobrepase.',
    intuition: R`<p>El gradiente indica hacia dónde sube la pérdida, pero su longitud puede dispararse en una zona muy empinada. El recorte funciona como un límite de velocidad: conserva la <b>dirección</b> del paso y solo acota su <b>longitud</b>. Las barras muestran la norma del gradiente de cada parámetro: qué partes del modelo están recibiendo más señal en esta iteración.</p>`,
    math: [
      R`\|g\| = \sqrt{\sum_{\theta}\sum_{i,j}(\mathrm d\theta)_{ij}^2}`,
      R`c = \min\!\Big(1,\ \frac{\tau}{\|g\|}\Big),\qquad \mathrm d\theta \leftarrow c\,\mathrm d\theta\quad\text{para todo parámetro }\theta`,
    ],
    shapes: dims(R`\{\mathrm d\theta\}_{\theta}\ \to\ \|g\|\in\mathbb R`,
      R`todos los gradientes → 1 número (más una norma por parámetro); por ejemplo, \(\mathrm dW_Q\) aporta {d}·{d} componentes y \(\mathrm dE\), {V}·{d}`,
      R`La norma global trata todos los gradientes como un único vector gigante, con tantas componentes como parámetros tiene el modelo. \(\tau\) es el umbral de recorte (<code>clip</code>).`),
    details: R`<p><b>Por qué medir la norma.</b> Es el termómetro del entrenamiento. Los picos repentinos indican que el modelo ha llegado a una zona muy empinada de la función de pérdida; una norma que cae hacia 0 indica que el aprendizaje se está deteniendo.</p>
<p><b>Recorte global.</b> Si \(\|g\|\) supera el umbral \(\tau\), <em>todos</em> los gradientes se multiplican por el mismo factor \(c = \tau/\|g\|\lt 1\). La dirección de descenso se conserva; solo se limita la longitud del paso. Recortar cada parámetro por separado cambiaría la dirección. Si el recorte está desactivado, \(c = 1\).</p>
<p><b>Con Adam.</b> Adam divide por la magnitud típica de cada gradiente, así que un reescalado uniforme le afecta menos que a SGD. Aun así, el recorte evita que un pico aislado contamine los momentos \(m\) y \(v\) durante muchas iteraciones.</p>
<p><b>Lotes.</b> En el entrenamiento normal, los gradientes de las frases del lote se promedian antes de medir la norma; en esta vista paso a paso, el gradiente es el de una sola frase.</p>`,
    code: `norm = np.sqrt(sum((g ** 2).sum() for g in grads.values()))
c = min(1.0, clip / norm) if clip else 1.0
grads = {k: c * g for k, g in grads.items()}`,
  };

  steps['upd.param'] = {
    title: 'Actualización del parámetro',
    summary: 'El parámetro da un pequeño paso en la dirección contraria a su gradiente, con SGD o con Adam, usando la tasa de aprendizaje η = {lr}.',
    intuition: R`<p>El gradiente apunta hacia donde la pérdida crece más deprisa; para reducirla, nos movemos un poco en sentido contrario. \(\eta\) controla el tamaño del paso. <b>SGD</b> da un paso proporcional al gradiente. <b>Adam</b> añade dos ideas: <em>momento</em> (promediar los gradientes recientes para suavizar el ruido) y <em>escala adaptativa</em> (dividir por la magnitud típica del gradiente de cada número, para que todos avancen a un ritmo parecido).</p>`,
    math: [
      R`\text{SGD:}\qquad \theta \leftarrow \theta - \eta\,\mathrm d\theta`,
      R`\text{Adam:}\qquad m \leftarrow \beta_1 m + (1-\beta_1)\,\mathrm d\theta,\qquad v \leftarrow \beta_2 v + (1-\beta_2)\,(\mathrm d\theta)^2`,
      R`\hat m = \frac{m}{1-\beta_1^{\,t}},\qquad \hat v = \frac{v}{1-\beta_2^{\,t}}`,
      R`\theta \leftarrow \theta - \eta\,\frac{\hat m}{\sqrt{\hat v}+\epsilon}`,
    ],
    shapes: dims(R`\theta,\ \mathrm d\theta,\ m,\ v,\ \hat m,\ \hat v\ \ \text{tienen todos la misma forma}`,
      R`cada parámetro conserva su forma; por ejemplo, \(W_Q\): <code>{d}×{d}</code>, \(E\): <code>{V}×{d}</code>, \(W_1\): <code>{d}×{dff}</code>`,
      R`Todas las operaciones son elemento a elemento: cada número del parámetro tiene su propio \(m\), su propio \(v\) y, con Adam, su propio tamaño de paso efectivo.`),
    details: R`<p><b>SGD.</b> \(\theta\leftarrow\theta-\eta\,\mathrm d\theta\) con \(\eta = {lr}\): el paso es proporcional al gradiente. Es simple, pero muy sensible a la escala: los parámetros con gradientes pequeños apenas se mueven.</p>
<p><b>Adam, término a término.</b> \(m\) es una media móvil del gradiente (el <em>momento</em>): suaviza el ruido y acumula velocidad en direcciones consistentes; con \(\beta_1 = 0.9\) recuerda unas 10 iteraciones. \(v\) es una media móvil del gradiente al cuadrado y estima su magnitud típica; con \(\beta_2 = 0.999\), unas 1000 iteraciones. Como \(m\) y \(v\) empiezan en 0, al principio están sesgados hacia 0; dividir por \(1-\beta^t\) (\(t\) = número de actualizaciones) corrige ese sesgo. El cociente \(\hat m/(\sqrt{\hat v}+\epsilon)\) no tiene unidades: en la primera iteración vale casi exactamente \(\pm 1\), así que cada número se mueve ≈ \(\eta\), sea cual sea el tamaño de su gradiente (salvo los que tienen gradiente exactamente 0, como las filas de \(E\) de palabras ausentes, que no se mueven). \(\epsilon\) (por defecto \(10^{-8}\)) evita dividir por 0.</p>
<p><b>Con recorte.</b> Si en el paso anterior se recortó el gradiente, aquí \(\mathrm d\theta\) es ya el gradiente reescalado, \(c\,\mathrm d\theta\).</p>
<p><b>No confundir.</b> Los \(\beta_1\) y \(\beta_2\) de Adam son hiperparámetros; los \(\beta_1\) y \(\beta_2\) de LayerNorm son parámetros que se entrenan.</p>
<p><b>Qué observar.</b> \(\Delta\theta = \theta_{\text{nuevo}}-\theta\) suele ser diminuto. Tras actualizar todos los parámetros, la siguiente iteración verá (normalmente) una pérdida algo menor.</p>`,
    code: `m = b1 * m + (1 - b1) * g;   v = b2 * v + (1 - b2) * g ** 2
mhat = m / (1 - b1 ** t);    vhat = v / (1 - b2 ** t)
theta -= lr * mhat / (np.sqrt(vhat) + eps)      # SGD: theta -= lr * g`,
  };

  // Derivaciones relacionadas con cada paso (ids de «derivations»); campo opcional para la UI.
  const REFS = {
    'data.tokenize': ['cross-entropy'],
    'fwd.embed': ['embedding-grad'],
    'fwd.posenc': ['positional-encoding'],
    'fwd.ln1': ['layernorm-grad'],
    'fwd.attn.q': ['matmul-grad'],
    'fwd.attn.k': ['matmul-grad'],
    'fwd.attn.v': ['matmul-grad'],
    'fwd.attn.split': ['multihead-why'],
    'fwd.attn.scores': ['matmul-grad', 'scale-why'],
    'fwd.attn.scale': ['scale-why'],
    'fwd.attn.mask': ['mask-why'],
    'fwd.attn.softmax': ['softmax-jacobian', 'mask-why'],
    'fwd.attn.context': ['multihead-why'],
    'fwd.attn.concat': ['multihead-why'],
    'fwd.attn.proj': ['multihead-why'],
    'fwd.res1': ['residual'],
    'fwd.ln2': ['layernorm-grad'],
    'fwd.ffn1': ['matmul-grad'],
    'fwd.act': ['activation-grad'],
    'fwd.ffn2': ['matmul-grad'],
    'fwd.res2': ['residual'],
    'fwd.lnf': ['layernorm-grad'],
    'fwd.logits': ['matmul-grad'],
    'fwd.softmax_out': ['softmax-ce'],
    'loss.ce': ['cross-entropy', 'softmax-ce'],
    'bwd.ce': ['softmax-ce', 'softmax-jacobian'],
    'bwd.logits.dW': ['matmul-grad'],
    'bwd.logits.dX': ['matmul-grad'],
    'bwd.lnf': ['layernorm-grad'],
    'bwd.res2': ['residual', 'chain-rule'],
    'bwd.ffn2.dW': ['matmul-grad'],
    'bwd.ffn2.db': ['matmul-grad'],
    'bwd.ffn2.dX': ['matmul-grad'],
    'bwd.act': ['activation-grad'],
    'bwd.ffn1.dW': ['matmul-grad'],
    'bwd.ffn1.db': ['matmul-grad'],
    'bwd.ffn1.dX': ['matmul-grad'],
    'bwd.ln2': ['layernorm-grad'],
    'bwd.res2.merge': ['residual', 'chain-rule'],
    'bwd.res1': ['residual', 'chain-rule'],
    'bwd.attn.proj.dW': ['matmul-grad'],
    'bwd.attn.proj.dX': ['matmul-grad'],
    'bwd.attn.concat': ['chain-rule', 'multihead-why'],
    'bwd.attn.context.dA': ['matmul-grad'],
    'bwd.attn.context.dV': ['matmul-grad'],
    'bwd.attn.softmax': ['softmax-jacobian'],
    'bwd.attn.mask': ['mask-why'],
    'bwd.attn.scale': ['scale-why'],
    'bwd.attn.scores.dQ': ['matmul-grad'],
    'bwd.attn.scores.dK': ['matmul-grad'],
    'bwd.attn.split': ['chain-rule', 'multihead-why'],
    'bwd.attn.q.dW': ['matmul-grad'],
    'bwd.attn.k.dW': ['matmul-grad'],
    'bwd.attn.v.dW': ['matmul-grad'],
    'bwd.attn.q.dX': ['matmul-grad', 'chain-rule'],
    'bwd.attn.k.dX': ['matmul-grad', 'chain-rule'],
    'bwd.attn.v.dX': ['matmul-grad', 'chain-rule'],
    'bwd.attn.dH': ['chain-rule'],
    'bwd.ln1': ['layernorm-grad'],
    'bwd.res1.merge': ['residual', 'chain-rule'],
    'bwd.posenc': ['positional-encoding'],
    'bwd.embed': ['embedding-grad'],
    'upd.gradnorm': ['grad-clipping'],
    'upd.param': ['adam'],
  };
  Object.keys(REFS).forEach(function (k) { if (steps[k]) steps[k].refs = REFS[k]; });

  // ───────────────────────────── Derivaciones largas ─────────────────────────────
  const derivations = {
    'chain-rule': {
      title: 'La regla de la cadena con matrices',
      html: R`<p>Toda la retropropagación es la regla de la cadena aplicada con orden. Si \(\mathcal L\) depende de \(X\) a través de \(Y = f(X)\), entonces, para cada entrada,</p>
\[\frac{\partial\mathcal L}{\partial X_{ij}} = \sum_{k,l}\frac{\partial\mathcal L}{\partial Y_{kl}}\,\frac{\partial Y_{kl}}{\partial X_{ij}}\qquad\text{es decir}\qquad \mathrm dX_{ij} = \sum_{k,l}\mathrm dY_{kl}\,\frac{\partial Y_{kl}}{\partial X_{ij}}.\]
<p>Tres ideas hacen que esto sea manejable:</p>
<ul>
<li><b>El gradiente tiene la forma del tensor.</b> \(\mathrm dX\) es \(T\times d\) si \(X\) lo es. Nunca construimos jacobianos gigantes (de \(Td\times Td\)): cada operación sabe calcular directamente \(\mathrm dX\) a partir de \(\mathrm dY\) (un <em>producto vector–jacobiano</em>).</li>
<li><b>Orden inverso.</b> Se recorre el grafo desde la pérdida (con \(\mathrm d\mathcal L = 1\)) hacia las entradas, de modo que al llegar a una operación ya conocemos el gradiente de su salida. Por eso el backward necesita los valores guardados durante el forward.</li>
<li><b>Bifurcación ⇒ suma.</b> Si \(X\) se usa en varios sitios (\(Y_1 = f_1(X)\), \(Y_2 = f_2(X)\), …), su gradiente es la suma de las contribuciones de cada uso.</li>
</ul>
\[\mathrm dX = \sum_k \mathrm dX^{(k)},\qquad \mathrm dX^{(k)} = \text{contribución a través de } Y_k.\]
<p>Por eso los gradientes se <em>acumulan</em> (se suman) en las conexiones residuales, en \(H\) (usado por \(Q\), \(K\) y \(V\)) y en los parámetros que se usan en todas las posiciones, como los sesgos o \(\gamma\) y \(\beta\).</p>`,
    },
    'matmul-grad': {
      title: 'Gradiente de un producto de matrices',
      html: R`<p>Sea \(Y = XW\) con \(X\in\mathbb R^{T\times n}\), \(W\in\mathbb R^{n\times m}\) e \(Y\in\mathbb R^{T\times m}\). Conocemos \(\mathrm dY\) y queremos \(\mathrm dX\) y \(\mathrm dW\). Entrada a entrada, \(Y_{tj} = \sum_k X_{tk}W_{kj}\), así que</p>
\[\frac{\partial Y_{tj}}{\partial W_{kj}} = X_{tk},\qquad \frac{\partial Y_{tj}}{\partial X_{tk}} = W_{kj}.\]
<p><b>Gradiente de los pesos.</b> \(W_{kj}\) interviene en \(Y_{tj}\) para <em>todas</em> las filas \(t\):</p>
\[\mathrm dW_{kj} = \sum_t \mathrm dY_{tj}\,X_{tk} = (X^{\top}\mathrm dY)_{kj}\quad\Longrightarrow\quad \boxed{\mathrm dW = X^{\top}\,\mathrm dY}\]
<p><b>Gradiente de la entrada.</b> \(X_{tk}\) interviene en toda la fila \(Y_{t,:}\):</p>
\[\mathrm dX_{tk} = \sum_j \mathrm dY_{tj}\,W_{kj} = (\mathrm dY\,W^{\top})_{tk}\quad\Longrightarrow\quad \boxed{\mathrm dX = \mathrm dY\,W^{\top}}\]
<p><b>Sesgo difundido.</b> Si \(Y = XW + \mathbf 1\,b\) con \(\mathbf 1\in\mathbb R^{T\times 1}\), el sesgo es otro producto de matrices cuyo primer factor es \(\mathbf 1\): \(\mathrm db = \mathbf 1^{\top}\mathrm dY = \sum_t \mathrm dY_{t,:}\).</p>
<p><b>Regla mnemotécnica: las formas.</b> \(\mathrm dW\) debe ser \(n\times m\); con \(X\) (\(T\times n\)) y \(\mathrm dY\) (\(T\times m\)), la única forma de obtenerlo es \(X^{\top}\mathrm dY\), que contrae el eje \(T\). \(\mathrm dX\) debe ser \(T\times n\): solo \(\mathrm dY\,W^{\top}\) encaja. Cuidado: con matrices cuadradas, las formas no bastan para detectar un error.</p>
<p><b>Cuando el segundo factor aparece traspuesto,</b> como en \(S = QK^{\top}\), se aplica la regla a \(B = K^{\top}\): \(\mathrm dQ = \mathrm dS\,K\) y \(\mathrm d(K^{\top}) = Q^{\top}\mathrm dS\), es decir, \(\mathrm dK = \mathrm dS^{\top}Q\).</p>`,
    },
    'softmax-jacobian': {
      title: 'Jacobiano del softmax',
      html: R`<p>Sea \(\mathbf a = \operatorname{softmax}(\mathbf s)\) una fila, con \(a_j = e^{s_j}/Z\) y \(Z = \sum_k e^{s_k}\). Derivando el cociente:</p>
\[\frac{\partial a_j}{\partial s_k} = \frac{\delta_{jk}\,e^{s_j}\,Z - e^{s_j}\,e^{s_k}}{Z^2} = a_j\,(\delta_{jk} - a_k).\]
<p>En forma matricial (con \(\mathbf a\) como vector fila), el jacobiano es \(J = \operatorname{diag}(\mathbf a) - \mathbf a^{\top}\mathbf a\): simétrico, y con filas que suman 0.</p>
<p><b>Producto vector–jacobiano.</b> Dado \(\mathrm d\mathbf a\), la regla de la cadena da</p>
\[\mathrm ds_k = \sum_j \mathrm da_j\,a_j(\delta_{jk}-a_k) = a_k\Big(\mathrm da_k - \sum_j a_j\,\mathrm da_j\Big).\]
<p>Aplicado a cada fila de una matriz de atención:</p>
\[\mathrm d\hat S = A\odot\big(\mathrm dA - \operatorname{rowsum}(\mathrm dA\odot A)\big).\]
<p><b>Lectura.</b> \(\sum_j a_j\,\mathrm da_j\) es la media del gradiente ponderada por la propia atención. Cada entrada se compara con esa media: como los pesos suman 1, dar más a uno exige quitar a otros, y solo importa si una entrada es «mejor o peor que la media». El factor \(a_k\) hace que las entradas con peso casi nulo (y las enmascaradas, con peso exactamente 0) apenas reciban gradiente.</p>
<p><b>Saturación.</b> Si la fila es casi one-hot (\(a_k\approx 1\) para un \(k\) y \(\approx 0\) para el resto), todos los términos \(a_j(\delta_{jk}-a_k)\) son casi 0: el softmax deja de transmitir gradiente. Evitarlo es el motivo del escalado por \(\sqrt{d_k}\).</p>
<p><b>Invarianza.</b> Las componentes de \(\mathrm d\mathbf s\) suman 0 porque \(\operatorname{softmax}(\mathbf s + c) = \operatorname{softmax}(\mathbf s)\): mover todas las puntuaciones a la vez no cambia nada, así que el gradiente no tiene componente en esa dirección.</p>`,
    },
    'softmax-ce': {
      title: 'Softmax + entropía cruzada: por qué dlogits = (P − Y)/T',
      html: R`<p>Para una posición con logits \(\mathbf z\) y objetivo \(y\), la pérdida es \(\ell = -\log a_y\), con \(\mathbf a = \operatorname{softmax}(\mathbf z)\).</p>
<p><b>Camino 1: directo.</b> Como \(\log a_y = z_y - \log\sum_k e^{z_k}\),</p>
\[\frac{\partial\ell}{\partial z_j} = -\delta_{jy} + \frac{e^{z_j}}{\sum_k e^{z_k}} = a_j - \delta_{jy}.\]
<p><b>Camino 2: con el jacobiano.</b> Primero \(\mathrm da_j = -\delta_{jy}/a_y\) (solo la entrada correcta). Entonces \(\sum_j a_j\,\mathrm da_j = -1\) y, con la fórmula del softmax,</p>
\[\mathrm dz_k = a_k\big(\mathrm da_k + 1\big) = a_k - \delta_{ky},\]
<p>porque \(a_k\,\mathrm da_k = -\delta_{ky}\). Mismo resultado, pero pasando por \(1/a_y\), que es enorme si \(a_y\) es diminuta: por eso se implementa la versión combinada.</p>
<p><b>Todas las posiciones.</b> \(\mathcal L = \frac1T\sum_t\ell_t\), y cada \(\ell_t\) solo depende de la fila \(t\) de los logits. Con \(Y\) la matriz one-hot de objetivos:</p>
\[\mathrm d\,\mathrm{logits} = \frac1T\,(P - Y).\]
<p><b>Lectura.</b> Negativo en la palabra correcta (hay que subir su logit) y positivo en las demás, en proporción a la probabilidad que se les dio por error. Cada fila suma 0. Si el modelo acierta con total seguridad, el gradiente se anula.</p>`,
    },
    'layernorm-grad': {
      title: 'Backward de LayerNorm',
      html: R`<p>Trabajamos con una fila \(\mathbf x\in\mathbb R^{1\times d}\) (cada token por separado). El forward es</p>
\[\mu = \frac1d\sum_j x_j,\quad \sigma^2 = \frac1d\sum_j (x_j-\mu)^2,\quad r = \frac{1}{\sqrt{\sigma^2+\varepsilon}},\quad \hat x_j = (x_j-\mu)\,r,\quad y_j = \gamma_j\hat x_j + \beta_j.\]
<p><b>1. Parámetros.</b> \(\gamma\) y \(\beta\) se comparten entre las \(T\) filas, así que sus gradientes suman sobre ellas:</p>
\[\mathrm d\beta = \sum_t \mathrm d\mathbf y_t,\qquad \mathrm d\gamma = \sum_t \mathrm d\mathbf y_t\odot\hat{\mathbf x}_t.\]
<p><b>2. A través de la escala.</b> \(\mathrm d\hat x_j = \mathrm dy_j\,\gamma_j\).</p>
<p><b>3. Derivadas de las estadísticas.</b> \(\partial\mu/\partial x_i = 1/d\). Para la varianza, como \(\sum_j (x_j-\mu) = 0\), el término que depende de \(\mu\) se cancela y \(\partial\sigma^2/\partial x_i = \tfrac2d(x_i-\mu)\). Entonces</p>
\[\frac{\partial r}{\partial x_i} = -\tfrac12(\sigma^2+\varepsilon)^{-3/2}\cdot\frac{2(x_i-\mu)}d = -\frac{r^2\,\hat x_i}d.\]
<p><b>4. Jacobiano de la normalización.</b> Derivando \(\hat x_j = (x_j-\mu)\,r\) como un producto:</p>
\[\frac{\partial\hat x_j}{\partial x_i} = \Big(\delta_{ij}-\frac1d\Big)r + (x_j-\mu)\Big(-\frac{r^2\,\hat x_i}d\Big) = r\Big(\delta_{ij} - \frac1d - \frac{\hat x_i\,\hat x_j}d\Big).\]
<p><b>5. Producto vector–jacobiano.</b></p>
\[\mathrm dx_i = \sum_j \mathrm d\hat x_j\,\frac{\partial\hat x_j}{\partial x_i} = r\Big(\mathrm d\hat x_i - \frac1d\sum_j\mathrm d\hat x_j - \hat x_i\,\frac1d\sum_j \mathrm d\hat x_j\,\hat x_j\Big).\]
<p>Con una barra para la media sobre las \(d\) columnas:</p>
\[\mathrm d\mathbf x = r\,\Big(\mathrm d\hat{\mathbf x} - \overline{\mathrm d\hat{\mathbf x}} - \hat{\mathbf x}\;\overline{\mathrm d\hat{\mathbf x}\odot\hat{\mathbf x}}\Big).\]
<p><b>Comprobaciones.</b> \(\sum_i\mathrm dx_i = 0\) (porque \(\sum_i\hat x_i = 0\)): desplazar toda la fila no cambia la salida, así que el gradiente no tiene componente en esa dirección. De forma análoga, \(\mathrm d\mathbf x\) es (salvo el pequeño efecto de \(\varepsilon\)) perpendicular a \(\hat{\mathbf x}\): escalar la fila tampoco cambia la salida. El coste es \(O(d)\) por fila, sin construir el jacobiano \(d\times d\).</p>`,
    },
    'residual': {
      title: 'Conexiones residuales: la autopista del gradiente',
      html: R`<p>Una subcapa con conexión residual calcula \(\mathbf y = \mathbf x + f(\mathbf x)\). Su jacobiano es</p>
\[\frac{\partial\mathbf y}{\partial\mathbf x} = I + \frac{\partial f}{\partial\mathbf x}\quad\Longrightarrow\quad \mathrm d\mathbf x = \mathrm d\mathbf y + \mathrm d\mathbf y\,\Big(\frac{\partial f}{\partial\mathbf x}\Big).\]
<p>(con vectores fila). El primer término es el <b>atajo</b>: el gradiente de la salida llega intacto a la entrada. El segundo es la contribución de la rama \(f\) (atención o FFN), que el backward calcula atravesándola paso a paso.</p>
<p><b>Apilando capas.</b> Con \(N\) capas, el jacobiano total es un producto de factores \((I + J_l)\). Al desarrollarlo aparece siempre el término \(I\): existe un camino en el que el gradiente no se multiplica por ninguna matriz.</p>
\[\frac{\partial X^{[N]}}{\partial X^{[0]}} = \prod_l\,(I + J_l) = I + \sum_l J_l + (\text{productos de dos o más } J_l).\]
<p>Sin residuales, el gradiente atravesaría solo el producto \(\prod_l J_l\), que tiende a desvanecerse o a explotar cuando \(N\) crece.</p>
<p><b>En este modelo</b> hay dos bifurcaciones por capa (tras la atención y tras la FFN). En el backward se ven como los pasos «el gradiente se bifurca» (copiar) y «se suman los dos caminos» (acumular).</p>
<p><b>En el forward,</b> la misma estructura permite ver el flujo residual como una suma: \(X^{[N]} = X^{[0]} + \sum_l \big(O^{[l]} + F^{[l]}\big)\).</p>`,
    },
    'scale-why': {
      title: '¿Por qué dividir por √dₖ?',
      html: R`<p>Supongamos que, al inicio, las componentes de una consulta \(\mathbf q\) y de una clave \(\mathbf k\) son independientes, con media 0 y varianza 1. Cada producto \(q_mk_m\) tiene media 0 y varianza \(\mathbb E[q_m^2]\,\mathbb E[k_m^2] = 1\), y como los términos son independientes:</p>
\[\operatorname{Var}(\mathbf q\cdot\mathbf k) = \sum_{m=1}^{d_k}\operatorname{Var}(q_mk_m) = d_k.\]
<p>La desviación típica de las puntuaciones crece como \(\sqrt{d_k}\). Con \(d_k = 64\), puntuaciones típicas de ±8 producen un softmax casi one-hot: \(e^{8}/e^{0}\approx 3000\).</p>
<p><b>El problema: saturación.</b> Las derivadas del softmax son \(a_j(\delta_{jk}-a_k)\). Si una fila es casi one-hot, todas son casi 0 y el gradiente que llega a \(Q\) y \(K\) se desvanece: el modelo no puede corregir a quién atiende.</p>
<p><b>La solución.</b> Dividir por \(\sqrt{d_k}\) devuelve la varianza a 1, sea cual sea la dimensión de las cabezas:</p>
\[\operatorname{Var}\Big(\frac{\mathbf q\cdot\mathbf k}{\sqrt{d_k}}\Big) = 1.\]
<p><b>En el backward,</b> como \(\tilde S = S/\sqrt{d_k}\) es lineal, \(\mathrm dS = \mathrm d\tilde S/\sqrt{d_k}\): se vuelve a dividir por el mismo factor, porque la derivada de \(y = cx\) es \(c\), no \(1/c\).</p>
<p><b>Otra lectura.</b> Es un softmax con temperatura \(\tau = \sqrt{d_k}\). Con \(d_k\) pequeño, como en este laboratorio, el efecto es moderado; en modelos reales (\(d_k = 64\) o 128) es imprescindible.</p>`,
    },
    'mask-why': {
      title: 'La máscara causal',
      html: R`<p><b>El problema.</b> Entrenamos el modelo para predecir el siguiente token, y lo hacemos en paralelo: con una frase de \(T\) tokens calculamos las \(T\) predicciones a la vez. Si la posición \(i\) pudiera atender a la posición \(i+1\), vería directamente la respuesta que debe predecir y aprendería a copiarla: un truco inútil al generar texto, cuando el futuro todavía no existe.</p>
<p><b>La solución.</b> Antes del softmax se suma</p>
\[M_{ij} = \begin{cases}0 &amp; j\le i\\ -\infty &amp; j\gt i\end{cases}\qquad\Longrightarrow\qquad A_{ij} = \begin{cases}\dfrac{e^{\hat S_{ij}}}{\sum_{k\le i} e^{\hat S_{ik}}} &amp; j\le i\\ 0 &amp; j\gt i.\end{cases}\]
<p>El softmax renormaliza solo entre las posiciones visibles: cada fila sigue sumando 1.</p>
<p><b>Equivalencia.</b> Gracias a la máscara, la fila \(i\) de todas las activaciones es <em>exactamente</em> la misma que obtendríamos ejecutando el modelo solo con el prefijo \(w_0,\dots,w_i\). Una pasada equivale a \(T\) pasadas independientes: ese es el gran truco de eficiencia de los transformers decodificadores.</p>
<p><b>En el backward.</b> Como \(M\) es constante, \(\mathrm d\tilde S = \mathrm d\hat S\), y en las posiciones enmascaradas el gradiente es 0 (porque \(A_{ij} = 0\) anula el jacobiano del softmax). La información del futuro tampoco se cuela por el gradiente.</p>
<p><b>Detalle práctico.</b> La diagonal siempre es visible, así que ninguna fila queda vacía (lo que produciría \(0/0\)).</p>`,
    },
    'multihead-why': {
      title: '¿Por qué varias cabezas?',
      html: R`<p><b>Una cabeza, una distribución.</b> Cada fila de \(A\) es un único reparto de atención. Si un token necesita a la vez información del sujeto y de la palabra anterior, una sola cabeza tiene que elegir o promediar ambas cosas, y el promedio diluye las dos.</p>
<p><b>Varias cabezas, varios repartos.</b> Con \(h\) cabezas, cada una tiene sus propias proyecciones (bloques de columnas de \(W_Q\), \(W_K\) y \(W_V\)) y, por tanto, su propia matriz \(A_h\). Una puede especializarse en «buscar el sujeto» y otra en «mirar el token anterior». Después, \(W_O\) combina sus resultados:</p>
\[O = [\,Z_1\,\|\,\cdots\,\|\,Z_h\,]\,W_O = \sum_{\text{cabezas } h} Z_h\,W_O^{(h)}.\]
<p><b>Mismo coste.</b> Como \(d_k = d/h\), las proyecciones suman los mismos \(3d^2\) parámetros que una sola cabeza de dimensión \(d\), y los productos \(Q_hK_h^{\top}\) cuestan en total \(h\cdot T^2d_k = T^2d\). Lo que cambia es la <em>expresividad</em>: \(h\) patrones de atención distintos, cada uno con puntuaciones de rango como mucho \(d_k\), en lugar de uno solo.</p>
<p><b>Subespacios.</b> Cada cabeza compara tokens dentro de un subespacio de dimensión \(d_k\): \(\mathbf q_i\cdot\mathbf k_j\) usa solo las \(d_k\) columnas de esa cabeza. Distintas cabezas miden «parecidos» distintos.</p>
<p><b>En este laboratorio,</b> observa en la pestaña «Entrenamiento» cómo las cabezas acaban con patrones diferentes. No está garantizado cuál aprende qué: depende de la inicialización (la semilla).</p>`,
    },
    'adam': {
      title: 'Adam, término a término',
      html: R`<p>Adam mantiene, para <em>cada número</em> de cada parámetro, dos medias móviles exponenciales. Con \(g_t\) el gradiente en la iteración \(t\):</p>
\[m_t = \beta_1 m_{t-1} + (1-\beta_1)\,g_t,\qquad v_t = \beta_2 v_{t-1} + (1-\beta_2)\,g_t^2 .\]
<p><b>\(m\): el momento.</b> Una media de los gradientes recientes (memoria de unas \(1/(1-\beta_1) = 10\) iteraciones). Suaviza el ruido de los minilotes y acumula velocidad en direcciones consistentes, como una bola que rueda cuesta abajo.</p>
<p><b>\(v\): la escala.</b> Una media de los gradientes al cuadrado (memoria de unas 1000 iteraciones). \(\sqrt{v}\) estima la magnitud típica del gradiente de ese número.</p>
<p><b>Corrección del sesgo.</b> Como \(m_0 = v_0 = 0\), al principio las medias están sesgadas hacia 0. Si el gradiente fuera constante, \(g_t = g\), desplegando la recurrencia:</p>
\[m_t = (1-\beta_1)\sum_{s=1}^t \beta_1^{\,t-s}\,g = (1-\beta_1^{\,t})\,g\quad\Longrightarrow\quad \hat m_t = \frac{m_t}{1-\beta_1^{\,t}} = g,\]
<p>y análogamente \(\hat v_t = v_t/(1-\beta_2^{\,t})\) recupera \(g^2\).</p>
<p><b>El paso.</b></p>
\[\theta \leftarrow \theta - \eta\,\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}.\]
<p>El cociente no tiene unidades: si el gradiente se multiplica por 100, \(\hat m\) y \(\sqrt{\hat v}\) también, y el paso no cambia. Cada número avanza del orden de \(\eta\) por iteración, tenga gradientes grandes o pequeños; eso hace a Adam mucho menos sensible a la escala que SGD. En la primera iteración, \(\hat m_1/\sqrt{\hat v_1} = g/|g| = \pm 1\). \(\epsilon\) (típicamente \(10^{-8}\)) evita dividir por cero.</p>
<p><b>SGD, para comparar:</b> \(\theta\leftarrow\theta-\eta\,g\). El paso es proporcional al gradiente, sin memoria ni normalización.</p>`,
    },
    'embedding-grad': {
      title: 'Gradiente del embedding',
      html: R`<p>La búsqueda de embeddings se puede escribir como un producto de matrices con una matriz one-hot constante \(C = \operatorname{onehot}(\mathbf x)\in\{0,1\}^{T\times V}\):</p>
\[X_{\text{emb}} = C\,E,\qquad C_{tv} = \begin{cases}1 &amp; x_t = v\\ 0 &amp; \text{en otro caso.}\end{cases}\]
<p>Aplicando la regla del producto de matrices (\(\mathrm dW = X^{\top}\mathrm dY\)) con \(C\) en el papel de \(X\):</p>
\[\mathrm dE = C^{\top}\,\mathrm dX_{\text{emb}},\qquad \mathrm dE_{v,:} = \sum_{t\,:\,x_t = v}(\mathrm dX_{\text{emb}})_{t,:}.\]
<p><b>Interpretación.</b> La fila \(v\) de \(\mathrm dE\) es la suma de los gradientes de las posiciones donde aparece el token \(v\). Si no aparece, es cero; si aparece dos veces, se suman ambas contribuciones.</p>
<p><b>Implementación.</b> Nunca se construye \(C\): se hace un <em>scatter-add</em>, <code>np.add.at(dE, ids, dX_emb)</code>. Ojo: <code>dE[ids] += dX_emb</code> es incorrecto con índices repetidos, porque NumPy aplica la suma una sola vez por índice.</p>
<p><b>Consecuencias.</b> El gradiente de \(E\) es disperso: en cada iteración solo aprenden las palabras que aparecen en el lote. Las palabras raras se entrenan poco y, con SGD, las ausentes no se mueven. Con Adam, el momento \(m\) acumulado puede seguir moviéndolas durante unas iteraciones.</p>
<p><b>Posiciones aprendidas.</b> La codificación posicional aprendida \(P_{\text{pos}}\) sigue la misma lógica, pero indexada por posición: la fila \(t\) recibe la fila \(t\) de \(\mathrm dX^{[0]}\) para las \(T\) posiciones usadas.</p>`,
    },
    'positional-encoding': {
      title: 'Codificación posicional sinusoidal',
      html: R`<p><b>El problema.</b> La autoatención compara vectores con productos escalares y los mezcla con medias ponderadas: nada en esas operaciones depende del orden de las filas. Sin información de posición, el modelo vería algo muy parecido a una «bolsa de palabras» (la máscara causal da alguna pista indirecta, pero muy pobre).</p>
<p><b>La receta.</b> Para cada posición \(\text{pos}\) y cada pareja de columnas \((2i, 2i+1)\), con frecuencia \(\omega_i = 10000^{-2i/d}\):</p>
\[PE_{\text{pos},\,2i} = \sin(\omega_i\,\text{pos}),\qquad PE_{\text{pos},\,2i+1} = \cos(\omega_i\,\text{pos}).\]
<p>Las primeras columnas oscilan rápido (período de \(2\pi\) posiciones) y las últimas muy despacio (período de hasta casi \(2\pi\cdot 10000\)): como las agujas de un reloj, la combinación identifica cada posición.</p>
<p><b>Posiciones relativas como rotaciones.</b> Por las fórmulas del seno y el coseno de una suma,</p>
\[\begin{pmatrix}\sin\omega_i(\text{pos}+k)\\ \cos\omega_i(\text{pos}+k)\end{pmatrix} = \begin{pmatrix}\cos\omega_i k &amp; \sin\omega_i k\\ -\sin\omega_i k &amp; \cos\omega_i k\end{pmatrix}\begin{pmatrix}\sin\omega_i\,\text{pos}\\ \cos\omega_i\,\text{pos}\end{pmatrix}.\]
<p>Desplazarse \(k\) posiciones equivale a aplicar una rotación que depende de \(k\) pero no de \(\text{pos}\): una transformación lineal. Esto facilita que las proyecciones lineales \(W_Q\) y \(W_K\) aprendan relaciones relativas como «el token de dos posiciones atrás».</p>
<p><b>Propiedades.</b> Valores acotados en \([-1,1]\); sin parámetros; definida para cualquier posición. Se <em>suma</em> al embedding (no se concatena), de modo que \(d\) no cambia.</p>
<p><b>Alternativa aprendida.</b> Con la codificación aprendida (<code>posEnc = learned</code>), \(P_{\text{pos}}\in\mathbb R^{\text{maxLen}\times d}\) es un parámetro más, que se entrena como \(E\) pero solo existe para las posiciones 0 … maxLen − 1.</p>`,
    },
    'activation-grad': {
      title: 'Activaciones y sus derivadas',
      html: R`<p>Una activación se aplica elemento a elemento, \(G = f(U)\), así que su jacobiano es diagonal y el backward es un producto elemento a elemento:</p>
\[\mathrm dU = \mathrm dG\odot f'(U).\]
<p><b>ReLU.</b> \(f(u) = \max(0,u)\); \(f'(u) = 1\) si \(u\gt 0\) y 0 si no. Es una compuerta: deja pasar el gradiente por las neuronas activas y lo bloquea en las inactivas. Riesgo: neuronas «muertas» que nunca se activan y nunca reciben gradiente.</p>
<p><b>GELU (aproximación tanh).</b> Con \(a(u) = \sqrt{2/\pi}\,(u + 0.044715\,u^3)\):</p>
\[f(u) = \tfrac12\,u\,\big(1+\tanh a\big),\qquad f'(u) = \tfrac12\big(1+\tanh a\big) + \tfrac12\,u\,\big(1-\tanh^2 a\big)\,\sqrt{2/\pi}\,\big(1 + 3\cdot 0.044715\,u^2\big).\]
<p>El primer término es la «compuerta suave» (entre 0 y 1); el segundo sale de la regla del producto, usando \(\tanh' = 1-\tanh^2\) y la regla de la cadena para \(a(u)\). GELU aproxima \(u\,\Phi(u)\), con \(\Phi\) la función de distribución de la normal estándar.</p>
<p><b>Por qué hace falta una no linealidad.</b> Sin ella, \(H'W_1W_2\) se reduciría a una única matriz \(d\times d\) y la FFN no añadiría capacidad de representación.</p>`,
    },
    'grad-clipping': {
      title: 'Recorte del gradiente por norma global',
      html: R`<p>Tras el backward, juntamos todos los gradientes en un único vector \(g\) (con tantas componentes como parámetros) y medimos su norma euclídea:</p>
\[\|g\| = \sqrt{\sum_{\theta}\sum_{i,j}(\mathrm d\theta)_{ij}^2}.\]
<p>Si supera un umbral \(\tau\), se reescalan <em>todos</em> los gradientes por el mismo factor:</p>
\[c = \min\Big(1,\ \frac{\tau}{\|g\|}\Big),\qquad \mathrm d\theta\leftarrow c\,\mathrm d\theta.\]
<p>Así la dirección de descenso no cambia y la longitud queda acotada por \(\tau\). Protege contra picos esporádicos del gradiente (al principio del entrenamiento o ante ejemplos raros) que podrían lanzar los parámetros a una mala zona en una sola actualización.</p>
<p><b>Global frente a por parámetro.</b> Recortar cada matriz por separado cambiaría la proporción entre sus gradientes, es decir, la dirección. Por eso lo habitual es usar la norma global.</p>`,
    },
    'cross-entropy': {
      title: 'Entropía cruzada y perplejidad',
      html: R`<p>El modelo asigna a cada frase una probabilidad, que es el producto de probabilidades condicionales:</p>
\[p(w_1,\dots,w_T\mid w_0) = \prod_{t=1}^T p(w_t\mid w_0,\dots,w_{t-1}).\]
<p>Maximizar esta probabilidad (<em>máxima verosimilitud</em>) equivale a minimizar su logaritmo negativo, promediado por token:</p>
\[\mathcal L = -\frac1T\sum_{t=1}^T\log p(w_t\mid w_{\lt t}) = -\frac1T\sum_{t=1}^T\log P_{t,\,y_t}.\]
<p>Es la entropía cruzada entre la distribución «verdadera» (one-hot en la palabra correcta) y la predicha: \(-\sum_j Y_{tj}\log P_{tj}\) en cada posición.</p>
<p><b>Valores de referencia.</b> Un modelo que no sabe nada (uniforme sobre \(V\) palabras) obtiene \(\mathcal L = \ln V\); uno perfecto, 0. Si el texto tiene ambigüedad real, el mínimo alcanzable es mayor que 0: es la entropía propia de los datos.</p>
<p><b>Perplejidad.</b> \(\mathrm{PPL} = e^{\mathcal L}\) se interpreta como el número efectivo de palabras entre las que el modelo duda en cada paso: \(V\) para el modelo uniforme, 1 para el perfecto, y 3 si en cada paso dudara entre tres opciones equiprobables.</p>`,
    },
  };

  // ───────────────────────────── Glosario ─────────────────────────────
  const glossary = [
    { term: 'Token', def: 'Unidad mínima de texto que procesa el modelo. Aquí, una palabra o un signo de puntuación (o un carácter, en modo carácter).' },
    { term: 'Tokenización', def: 'Proceso de cortar el texto en tokens y convertir cada uno en su id (su posición en el vocabulario).' },
    { term: 'Vocabulario', def: 'Lista de todos los tokens distintos que conoce el modelo; su tamaño es V. El id de un token es su posición en esa lista.' },
    { term: 'One-hot', def: 'Vector de ceros con un único 1 en la posición del id. Multiplicarlo por una matriz selecciona una fila de esa matriz.' },
    { term: 'Embedding', def: 'Vector aprendido de d números que representa a un token. La tabla de embeddings E tiene una fila por palabra del vocabulario.' },
    { term: 'Codificación posicional', def: 'Vector que depende solo de la posición y se suma al embedding para que el modelo conozca el orden de los tokens. Puede ser sinusoidal (fija) o aprendida.' },
    { term: 'Flujo residual', def: 'La matriz T×d que recorre toda la red: cada subcapa la lee (a través de su LayerNorm) y le suma su resultado.' },
    { term: 'Atención (autoatención)', def: 'Mecanismo por el que cada token calcula una media ponderada de los valores de otros tokens, con pesos que dependen de lo compatibles que son su consulta y las claves de los demás.' },
    { term: 'Consulta, clave y valor (Q, K, V)', def: 'Tres proyecciones lineales de cada token: la consulta expresa lo que busca, la clave cómo se anuncia y el valor, lo que aporta cuando otro token le presta atención.' },
    { term: 'Cabeza de atención', def: 'Una atención independiente que trabaja en un subespacio de d_k = d/h dimensiones. Varias cabezas permiten atender a varias cosas a la vez.' },
    { term: 'Máscara causal', def: 'Matriz de ceros y −∞ que impide que un token atienda a los que vienen después. Permite entrenar todas las posiciones en paralelo sin hacer trampa.' },
    { term: 'Softmax', def: 'Función que convierte un vector de números reales en probabilidades: exponencia cada entrada y divide por la suma. Se usa en la atención y en la salida.' },
    { term: 'Logits', def: 'Puntuaciones sin normalizar, una por palabra del vocabulario, que el softmax convierte en probabilidades.' },
    { term: 'LayerNorm', def: 'Normalización de cada token (cada fila) a media 0 y varianza 1, seguida de una escala γ y un desplazamiento β aprendibles.' },
    { term: 'Conexión residual', def: 'Suma de la entrada de una subcapa a su salida (y = x + f(x)). Facilita el entrenamiento porque el gradiente pasa intacto por el atajo.' },
    { term: 'FFN (red feed-forward)', def: 'Pequeña red de dos capas lineales con una activación en medio, aplicada a cada token por separado: d → d_ff → d.' },
    { term: 'ReLU', def: 'Activación max(0, u): deja pasar los valores positivos y anula los negativos. Su derivada es 1 o 0.' },
    { term: 'GELU', def: 'Activación suave parecida a ReLU, u·Φ(u), usada en GPT y BERT. Deja pasar un poco de los valores negativos cercanos a 0.' },
    { term: 'Entropía cruzada', def: 'Pérdida que mide la sorpresa del modelo ante la palabra correcta: −log de la probabilidad que le asignó, promediada sobre las posiciones.' },
    { term: 'Perplejidad', def: 'e elevado a la pérdida: número efectivo de opciones entre las que duda el modelo. 1 significa certeza total; V, no saber nada.' },
    { term: 'Gradiente', def: 'Derivadas de la pérdida respecto de cada número de un tensor, con su misma forma. Indica hacia dónde crece la pérdida más deprisa.' },
    { term: 'Retropropagación (backpropagation)', def: 'Algoritmo que calcula todos los gradientes aplicando la regla de la cadena desde la pérdida hacia la entrada, reutilizando los resultados intermedios del forward.' },
    { term: 'Regla de la cadena', def: 'Si z depende de y, e y depende de x, entonces dz/dx = dz/dy · dy/dx. Si hay varios caminos de x a z, se suman sus contribuciones.' },
    { term: 'Jacobiano', def: 'Matriz de todas las derivadas parciales de las salidas de una función respecto de sus entradas. En la práctica no se construye: se calcula directamente su producto con el gradiente.' },
    { term: 'Forward', def: 'Propagación hacia delante: el cálculo de la salida (y de la pérdida) a partir de la entrada.' },
    { term: 'Backward', def: 'Propagación hacia atrás: el cálculo de los gradientes, desde la pérdida hasta cada parámetro.' },
    { term: 'Descenso por gradiente', def: 'Método de optimización que mueve los parámetros un pequeño paso en la dirección contraria al gradiente.' },
    { term: 'SGD', def: 'Descenso por gradiente estocástico: θ ← θ − η·g, usando el gradiente de un minilote en lugar del de todos los datos.' },
    { term: 'Adam', def: 'Optimizador que combina momento (media de los gradientes recientes) con un paso normalizado por la magnitud típica del gradiente de cada número.' },
    { term: 'Tasa de aprendizaje (η)', def: 'Tamaño del paso de optimización. Si es demasiado grande, la pérdida oscila o diverge; si es demasiado pequeña, se aprende muy despacio.' },
    { term: 'Lote (minilote)', def: 'Grupo de frases que se procesan juntas en una iteración; sus gradientes se promedian.' },
    { term: 'Iteración', def: 'Un forward, un backward y una actualización de los parámetros.' },
    { term: 'Época', def: 'Una pasada completa por todo el corpus de entrenamiento.' },
    { term: 'Parámetro', def: 'Número del modelo que se aprende con el gradiente: pesos, sesgos, embeddings, γ y β.' },
    { term: 'Hiperparámetro', def: 'Ajuste que se elige antes de entrenar y no se aprende: d, h, N, d_ff, tasa de aprendizaje, tamaño del lote…' },
    { term: 'Sobreajuste', def: 'Cuando el modelo memoriza los datos de entrenamiento en lugar de aprender patrones generales, y funciona peor con datos nuevos. Con un corpus tan pequeño como este, es casi inevitable.' },
    { term: 'Recorte de gradiente', def: 'Reescalar todos los gradientes si su norma global supera un umbral, para evitar pasos demasiado grandes sin cambiar su dirección.' },
    { term: 'Inferencia', def: 'Uso del modelo ya entrenado: solo se ejecuta el forward, sin pérdida, sin backward y sin actualización.' },
    { term: 'Generación autorregresiva', def: 'Generar texto token a token: se predice el siguiente, se añade al contexto y se repite.' },
    { term: 'Muestreo por temperatura', def: 'Dividir los logits por una temperatura τ antes del softmax: τ menor que 1 hace la distribución más concentrada (más conservadora) y τ mayor que 1, más plana (más variada).' },
    { term: 'Decodificación voraz (greedy)', def: 'Elegir siempre el token más probable en cada paso de la generación.' },
    { term: 'Teacher forcing', def: 'Durante el entrenamiento, dar al modelo siempre el prefijo correcto (no sus propias predicciones) para predecir cada siguiente token.' },
    { term: 'Difusión (broadcasting)', def: 'Usar un vector 1×n como si se repitiera en todas las filas de una matriz T×n. En el backward se convierte en una suma sobre las filas.' },
    { term: 'Producto de Hadamard (⊙)', def: 'Producto elemento a elemento de dos matrices de la misma forma.' },
    { term: 'Comprobación de gradientes', def: 'Comparar el gradiente analítico (el del backward) con una aproximación numérica por diferencias finitas, para detectar errores de implementación.' },
    { term: 'Ventana de contexto', def: 'Número máximo de tokens que el modelo puede ver a la vez (maxLen).' },
    { term: 'Inicialización', def: 'Valores aleatorios con los que empiezan los parámetros. Su escala (por ejemplo, varianza 1/d) evita que las activaciones exploten o se desvanezcan.' },
  ];

  // ───────────────────────────── Recorrido inicial ─────────────────────────────
  const tour = [
    { title: 'Te damos la bienvenida a Transformer Lab',
      html: R`<p>Aquí verás <b>una iteración completa de entrenamiento</b> de un transformer pequeño, tipo GPT, paso a paso: desde el texto hasta la actualización de los pesos. Nada es una animación pregrabada: cada número se calcula en tu navegador con el modelo real.</p><p>En cada paso verás la operación, las matrices que entran y salen, sus dimensiones (con números y con símbolos) y la explicación matemática. Con el modelo por defecto (1 capa, 2 cabezas, \(d = 8\)) son unos 90 pasos.</p>` },
    { title: '¿Qué hace un transformer?',
      html: R`<p>Un modelo de lenguaje como GPT hace una sola cosa: <b>predecir el siguiente token</b>. Lee una secuencia, convierte cada token en un vector y, capa tras capa, deja que cada posición <em>atienda</em> a las anteriores para reunir contexto. Al final, cada posición produce una distribución de probabilidad sobre el vocabulario.</p><p><b>Entrenar</b> es ajustar los parámetros para que la palabra correcta sea cada vez más probable: se mide el error (la pérdida), se calcula con retropropagación cuánto contribuyó cada parámetro (los gradientes) y se corrige cada uno un poquito.</p>` },
    { title: 'La tarea de este laboratorio',
      html: R`<p>El corpus tiene 8 frases cortas en español, diseñadas para que la atención sea imprescindible:</p><ul><li>«el gato come» → <b>pescado</b>, pero «el perro come» → <b>carne</b>;</li><li>«la niña bebe» → <b>leche</b>, pero «el niño bebe» → <b>agua</b>.</li></ul><p>Para acertar, la posición de «come» tiene que <b>mirar hacia atrás</b> y encontrar el sujeto. Cuando el modelo haya aprendido, verás en los mapas de atención cómo el verbo concentra su peso en «gato» o en «perro».</p><p>Puedes cambiar el corpus en «Datos y modelo».</p>` },
    { title: 'Las fases y sus colores',
      html: R`<p>Cada paso pertenece a una fase, y el color te dice en cuál estás:</p><ul><li><b>Datos</b> (gris pizarra): el texto se convierte en ids.</li><li><b>Forward</b> (verde azulado): de los ids a las probabilidades. La <b>pérdida</b> cierra el forward: mide cuánto se equivocó el modelo.</li><li><b>Backward</b> (magenta): los gradientes recorren la red al revés, desde la pérdida hasta cada parámetro.</li><li><b>Actualización</b> (ocre): el optimizador modifica los pesos.</li></ul><p>En el diagrama de la arquitectura, el bloque activo se ilumina con el color de su fase; en el backward, las flechas se invierten.</p>` },
    { title: 'Cómo leer las matrices',
      html: R`<p>Cada matriz se dibuja como un <b>mapa de calor</b>, con una celda por número:</p><ul><li><b>azul</b> = negativo, <b>naranja</b> = positivo; cuanto más se parece la celda al color del fondo, más cerca de 0;</li><li><b>violeta</b> = probabilidades (de 0 a 1), como los pesos de atención o las predicciones: cuanto más intenso, más cerca de 1;</li><li>celdas <b>rayadas</b> = \(-\infty\) (posiciones tapadas por la máscara causal).</li></ul><p>Junto a cada matriz verás su nombre, su forma con números (por ejemplo, <code>5×8</code>) y con símbolos (<code>T×d</code>). Las filas suelen ser tokens. <b>Pasa el cursor por una celda</b> del resultado: se resaltan las celdas que la producen y el inspector muestra la cuenta completa.</p>` },
    { title: 'Cómo navegar',
      html: R`<ul><li><b>Línea de tiempo</b> (abajo): una marca por paso, coloreada por fase. Haz clic en cualquiera para saltar.</li><li><b>Teclado</b>: <kbd>←</kbd> y <kbd>→</kbd> paso anterior y siguiente, <kbd>Espacio</kbd> reproducir o pausar, <kbd>Inicio</kbd> y <kbd>Fin</kbd> primer y último paso.</li><li><b>Diagrama</b>: haz clic en un bloque para ir a su paso.</li><li><b>Explicación</b>: resumen, intuición, fórmulas, cómo cambian las dimensiones, derivación y pseudocódigo del paso actual.</li><li><b>Nueva iteración</b>: repite el recorrido con los pesos ya actualizados y observa cómo baja la pérdida.</li></ul>` },
    { title: 'La notación, en dos líneas',
      html: R`<p>\(T\) = tokens de la secuencia, \(d\) = dimensión del modelo, \(h\) = cabezas, \(d_k = d/h\), \(d_{\text{ff}}\) = dimensión de la FFN, \(V\) = vocabulario, \(N\) = capas, \(\eta\) = tasa de aprendizaje.</p><p>Los gradientes se escriben \(\mathrm dX := \partial\mathcal L/\partial X\) y tienen <b>siempre la misma forma que \(X\)</b>. En las matrices de activaciones, las filas son tokens y las columnas, características.</p>` },
    { title: 'Más allá de una iteración',
      html: R`<p><b>Entrenamiento</b>: entrena cientos de iteraciones y observa en vivo la curva de pérdida, la atención y las predicciones. <b>Generación</b>: escribe un comienzo («el gato») y mira cómo el modelo completa la frase token a token usando solo el forward. <b>Datos y modelo</b>: cambia el corpus y los hiperparámetros, consulta el mapa completo de dimensiones y verifica numéricamente los gradientes.</p>` },
  ];

  // ───────────────────────────── Utilidades ─────────────────────────────
  const placeholders = ['T', 'd', 'h', 'dk', 'dff', 'V', 'N', 'l', 'hd', 'lr'];
  const PH_RE = /\{(T|d|h|dk|dff|V|N|l|hd|lr)\}/g;
  // Sustituye los marcadores {T} {d} … por sus valores; los que no tengan valor se dejan intactos.
  function fill(text, values) {
    if (typeof text !== 'string' || !values) return text;
    return text.replace(PH_RE, function (m, k) {
      return values[k] === undefined || values[k] === null ? m : String(values[k]);
    });
  }

  TL.Content = {
    symbols: symbols,
    notation: notation,
    steps: steps,
    derivations: derivations,
    glossary: glossary,
    tour: tour,
    phases: phases,
    placeholders: placeholders,
    fill: fill,
  };
})(typeof window !== 'undefined' ? window : globalThis);
