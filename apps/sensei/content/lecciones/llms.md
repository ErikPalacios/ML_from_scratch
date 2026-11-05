---
titulo: Transformers y LLMs
en: Transformers and LLMs
subtitulo: Qué hace por dentro un modelo como los que conversan contigo, por qué escribe una palabra a la vez y por qué necesita tanta memoria de GPU.
pregunta: Cuando le escribo a un chat de IA, ¿qué pasa entre que mando la pregunta y que aparece la respuesta, palabra por palabra?
minutos: 35
requisitos: embeddings
---

:::idea
Un LLM hace una sola cosa: dado un texto, calcula qué tan probable es cada pedacito de texto que podría seguir, elige uno y lo agrega. Repite eso cientos de veces. Todo lo demás (la memoria que ocupa, por qué tarda, por qué a veces inventa) sale de ahí.
:::

## El texto, en pedacitos: tokens {Text as tokens}

Un modelo solo sabe de números. Antes de que un modelo de lenguaje pueda leer «Ana vende sus tenis blancos», alguien tiene que convertir ese texto en números. Eso lo hace el [[tokenizer]].

El tokenizer parte el texto en pedacitos llamados [[token|tokens]]. Un token puede ser una palabra completa, un trozo de palabra o un signo de puntuación. Luego cambia cada token por su número en una lista fija, el **vocabulario**. A ese número se le llama el **id** del token.

¿Por qué pedacitos y no letras, o palabras completas?

- **Letras:** el vocabulario sería chiquito (unas cuantas decenas de símbolos), pero cada frase se volvería larguísima, y el modelo tendría que aprender desde cero que «t-e-n-i-s» forma algo con significado.
- **Palabras completas:** las frases serían cortas, pero el vocabulario sería enorme (cada conjugación, cada plural, cada nombre propio) y una palabra nueva no tendría número.
- **Pedacitos (*subwords*):** el punto medio. Las palabras comunes son un solo token; las raras se arman con varios pedazos que sí existen. Cualquier texto se puede escribir con el vocabulario.

:::ejemplo Una frase partida en tokens
Un tokenizer podría partir «Ana vende sus tenis blancos.» así:

| Token | Id |
|---|---|
| `Ana` | 23,817 |
| `·vende` | 54,120 |
| `·sus` | 4,512 |
| `·ten` | 3,402 |
| `is` | 285 |
| `·blanc` | 41,903 |
| `os` | 437 |
| `.` | 13 |

El `·` marca un espacio: el espacio va pegado a la palabra que sigue, como parte del token. Cinco palabras y un punto se volvieron 8 tokens. **Los cortes y los ids son ilustrativos**: cada tokenizer real parte distinto y tiene sus propios números.
:::

:::figura llms-tokens
Del texto a los números: el tokenizer parte la frase en tokens, cada token tiene un id, y cada id saca su vector de una tabla. Cortes e ids de ejemplo.
:::

Dos cosas que vas a oír mucho:

- **En inglés, como regla aproximada, un token es unas ¾ partes de una palabra.** En español suelen salir más tokens por palabra, porque los tokenizers se arman con mucho texto en inglés. La Ronda (M14) lo menciona porque los proveedores (las empresas que te venden acceso a su modelo) **cobran por token**: el mismo texto puede costar distinto según el idioma y el modelo.
- **Cada modelo trae su tokenizer.** El de Llama 3 tiene un vocabulario de 128,256 tokens. No se pueden mezclar: los ids de un tokenizer no significan nada para otro modelo.

### De ids a vectores

Un id es solo una etiqueta: el token 23,817 no es «más grande» que el 285 en ningún sentido útil. Así que lo primero que hace el modelo es cambiar cada id por un [[embedding]], como los de la lección anterior.

Para eso tiene una **tabla de embeddings**: una fila por cada token del vocabulario, y en cada fila un vector. El id dice qué fila leer. En Llama 3 8B cada vector tiene 4,096 números, así que la tabla mide:

128,256 tokens × 4,096 números = 525,336,576 números

Unos 525 millones de [[parametro|parámetros]] solo para esa tabla, el 6.5 % de todo el modelo. Esos vectores se aprenden durante el [[entrenamiento]], igual que el resto: al final, tokens que se usan parecido quedan con vectores parecidos.

## Un LLM adivina el siguiente token {Predicting the next token}

Ya con la frase convertida en vectores, ¿qué calcula el modelo? Algo sorprendentemente simple: **qué token es más probable que siga**.

Esto ya lo conoces. El modelo de C01 recibe una foto y da una probabilidad para cada una de sus 500 categorías. Un modelo de lenguaje recibe un texto y da una probabilidad para cada token de su vocabulario: en Llama 3, para cada uno de los 128,256. Es una [[clasificacion|clasificación]] gigante, que se repite una y otra vez.

Por dentro funciona igual que en C01: la última capa da una calificación por opción, el [[logit]], y el [[softmax]] las convierte en [[probabilidad|probabilidades]] que suman 100 %. (Softmax calcula e ≈ 2.718 elevado a cada logit y divide cada resultado entre la suma de todos.)

Un [[llm|LLM]] (*large language model*, modelo grande de lenguaje) es un modelo así, con miles de millones de parámetros, entrenado con cantidades enormes de texto a adivinar el siguiente token. Después se le entrena un poco más con ejemplos de conversaciones para que siga instrucciones. De esa sola tarea, «adivina lo que sigue», salen las respuestas, los resúmenes y el código.

El texto que tú le das para que continúe se llama [[prompt]]: tu pregunta, las instrucciones y lo que haga falta para responder.

### Elegir: sampling y temperatura

El modelo da probabilidades, pero hay que **elegir** un token. Hay dos formas:

- **Tomar siempre el más probable** (*greedy*). Respuestas repetibles, a veces aburridas o en círculos.
- **Sortearlo respetando las probabilidades**, que se llama [[sampling]] (muestreo): si «tenis» tiene 66.5 %, sale unas 66 de cada 100 veces. Respuestas más variadas.

La perilla del sorteo es la [[temperatura]]. Antes del softmax, los logits se dividen entre la temperatura. Dividir entre un número chico agranda las diferencias; dividir entre uno grande las achica.

:::ejemplo Temperatura con tres tokens
Imagina que después de «Ana vende unos» el modelo solo tuviera tres opciones, con estos logits: «tenis» = 2, «zapatos» = 1, «libros» = 0.

**Temperatura 1** (los logits quedan igual):

1. e² ≈ 7.39, e¹ ≈ 2.72, e⁰ = 1.
2. Suma: 7.39 + 2.72 + 1 = 11.11.
3. Probabilidades: 7.39 ÷ 11.11 ≈ **66.5 %**, 2.72 ÷ 11.11 ≈ **24.5 %**, 1 ÷ 11.11 ≈ **9.0 %**.

**Temperatura 0.5** (los logits se dividen entre 0.5, o sea, se duplican: 4, 2 y 0):

1. e⁴ ≈ 54.60, e² ≈ 7.39, e⁰ = 1. Suma: 62.99.
2. Probabilidades: **86.7 %**, **11.7 %** y **1.6 %**. «Tenis» casi siempre gana.

**Temperatura 2** (los logits se dividen entre 2: 1, 0.5 y 0):

1. e¹ ≈ 2.72, e^0.5 ≈ 1.65, e⁰ = 1. Suma: 5.37.
2. Probabilidades: **50.6 %**, **30.7 %** y **18.6 %**. «Libros» ya sale casi 1 de cada 5 veces.

(Las sumas pueden dar 99.9 % por el redondeo.)
:::

:::figura llms-temperatura
Las mismas tres opciones con tres temperaturas. Baja, el favorito se lleva casi todo; alta, el reparto se empareja.
:::

¿Cuál conviene? Depende de la tarea. Para extraer datos de un texto (la marca y la talla de unos tenis, por ejemplo) se usa temperatura 0, porque quieres siempre la misma respuesta. (No se puede dividir entre 0: «temperatura 0» quiere decir, por convención, tomar siempre el más probable.) Para escribir la descripción de un producto, algo de temperatura da textos menos repetitivos.

:::ojo
Temperatura 0 no garantiza respuestas idénticas. En un servidor real, tu pregunta se calcula junto con las de otras personas, y el orden de las sumas puede cambiar los últimos decimales; a veces eso basta para que gane otro token. La Ronda (M14) lo menciona al hablar de cómo evaluar un LLM: si dos corridas del mismo modelo difieren, una «mejora» del mismo tamaño no es una mejora.
:::

## Un token a la vez: leer rápido, escribir lento {One token at a time}

El modelo predice **un** token. Para escribir una respuesta completa, se hace un ciclo:

:::pasos
1. Predecir
El modelo recibe el texto y da las probabilidades del siguiente token.
2. Elegir
Se elige uno (el más probable, o con un sorteo).
3. Agregar
El token elegido se pega al final del texto.
4. Repetir
El texto, ya un token más largo, vuelve a entrar al modelo. Se repite hasta que el modelo elige un token especial de «fin», o hasta llegar a un límite de tokens.
:::

Esto se llama [[generacion-autorregresiva|generación autorregresiva]]: cada token nuevo depende de los que el propio modelo ya escribió. Es la razón de que veas la respuesta aparecer palabra por palabra: el servidor te manda cada token en cuanto sale, en vez de esperar al final. Eso es *streaming*.

### Leer el prompt contra escribir la respuesta

Fíjate en una asimetría enorme.

**Leer el prompt** se hace de una sola pasada. Todos los tokens del prompt ya existen, así que el modelo los procesa todos a la vez, en paralelo. A esto se le llama *prefill*.

**Escribir la respuesta** no se puede hacer en paralelo: el token 2 depende del token 1, que todavía no existía. Son tantas pasadas como tokens tenga la respuesta, una detrás de otra. A esto se le llama *decode*.

¿Y por qué cada pasada del decode es lenta? Porque para calcular **un solo** token el modelo usa **todos** sus parámetros, y tiene que leerlos de la memoria de la GPU en cada paso.

:::ejemplo Cuántos tokens por segundo, como máximo
Un LLM de 8 mil millones de parámetros, con 2 bytes por parámetro, pesa ≈ 16 GB. Una L4 (una GPU de NVIDIA con 24 GB de memoria, muy usada para servir modelos) puede leer su memoria a unos 300 GB por segundo.

Si cada token obliga a leer los 16 GB completos:

300 GB/s ÷ 16 GB por token ≈ **19 tokens por segundo**, como techo, para una sola conversación.

Una respuesta de 250 tokens: 250 ÷ 19 ≈ **13 segundos**. En cambio, los 2,000 tokens del prompt se leen en una sola pasada: cada peso que se lee se usa para los 2,000 tokens a la vez.
:::

Por eso, en la Ronda, la velocidad de un LLM se mide con dos números distintos: cuánto tarda en salir el **primer** token (lo domina el prefill, y se llama TTFT, *time to first token*) y cuánto tarda **cada** token después (lo domina el decode). En M14 vas a ver cómo los servidores como vLLM juntan muchas conversaciones en cada paso, para que una sola lectura de los pesos le sirva a todas.

:::diagrama llms-request
El camino de una pregunta: el prompt entra entero en una pasada (prefill) y la respuesta sale de un token a la vez (decode), leyendo los pesos y el KV cache en cada paso.
:::

### La ventana de contexto

Todo modelo tiene un límite de cuántos tokens puede tener en cuenta en un request, sumando el prompt y la respuesta. Ese límite es su [[ventana-contexto|ventana de contexto]]. Llama 3 8B salió en abril de 2024 con una ventana de 8,192 tokens; su versión 3.1, de julio de 2024, la amplió a ≈ 128 mil (131,072). Las cuentas de esta lección usan los 8,192 del Llama 3 original, como la Ronda.

Lo que no cabe en la ventana, el modelo no lo ve. Si el prompt tiene 8,000 tokens y la ventana es de 8,192, solo quedan 192 para la respuesta. Y en producción, como verás en la sección 5, cada token dentro de la ventana ocupa memoria de GPU: la ventana también es una cuestión de costo.

## El transformer y la atención {The transformer and attention}

¿Qué hay dentro del modelo, entre los vectores que entran y las probabilidades que salen? En casi todos los LLMs actuales, un [[transformer]]. Es una arquitectura que presentó un artículo de Google de 2017, «Attention Is All You Need». Es una pila de bloques iguales (32 en Llama 3 8B, 80 en Llama 3 70B), y cada bloque tiene dos partes:

- Una capa de **atención**, donde los tokens se pasan información entre sí.
- Una pequeña [[red-neuronal|red neuronal]] que procesa cada token por separado.

La parte nueva, la que le dio nombre al artículo, es la atención.

### Cada palabra mira a las demás

Lee estas dos frases:

- «Me senté en el **banco** del parque.»
- «Saqué dinero del **banco**.»

La palabra «banco» es la misma, y su vector de la tabla de embeddings también: la tabla no sabe en qué frase está. Pero el significado cambia por **las otras palabras**. La [[atencion|atención]] es el mecanismo que resuelve eso: **cada token mira a los tokens anteriores, decide cuáles le importan y toma información de ellos en esa proporción**. Después de la atención, el vector de «banco» ya no es el de la tabla: está mezclado con lo que aportaron «senté» o «dinero».

Esto pasa en cada bloque. En los primeros, los tokens resuelven cosas cercanas (a qué sustantivo va un adjetivo); en los de más adentro, relaciones más abstractas.

### Q, K y V, con calma

¿Cómo decide un token a quién mirar? Para cada token, el modelo calcula tres vectores, [[qkv|Q, K y V]], multiplicando su vector por tres tablas de parámetros aprendidas:

- **Q (*query*, consulta):** lo que este token anda buscando.
- **K (*key*, llave):** la etiqueta con la que este token se ofrece a los demás.
- **V (*value*, valor):** la información que este token entrega si alguien lo mira.

Y el procedimiento, para un token:

:::pasos
1. Calificar
Compara su Q con la K de cada token (incluido él mismo) con el producto punto, el mismo de la similitud coseno pero sin dividir entre los largos: si apuntan parecido, la calificación es alta.
2. Repartir
Convierte las calificaciones en porcentajes con softmax, para que sumen 100 %.
3. Mezclar
Su nuevo vector es la suma de las V de todos, cada una multiplicada por su porcentaje.
:::

:::ejemplo La atención de «banco», con vectores de 2 números
Frase: «Me senté en el banco». Veamos solo a «banco». Los números son inventados para que se puedan seguir con lápiz; un modelo real usa vectores de 128 números o más.

La Q de «banco» es (1, 0). Las K de cada token:

| Token | K | Q · K |
|---|---|---|
| Me | (0, 1) | 1 × 0 + 0 × 1 = 0 |
| senté | (3, 0) | 1 × 3 + 0 × 0 = 3 |
| en | (0, 2) | 0 |
| el | (0, −1) | 0 |
| banco | (1, 1) | 1 × 1 + 0 × 1 = 1 |

Softmax de (0, 3, 0, 0, 1): e⁰ = 1 tres veces, e³ ≈ 20.09 y e¹ ≈ 2.72. Suman 1 + 20.09 + 1 + 1 + 2.72 = 25.81.

| Token | Atención |
|---|---|
| Me | 1 ÷ 25.81 ≈ 3.9 % |
| senté | 20.09 ÷ 25.81 ≈ **77.8 %** |
| en | 3.9 % |
| el | 3.9 % |
| banco | 2.72 ÷ 25.81 ≈ 10.5 % |

El nuevo vector de «banco» se arma con 77.8 % de la V de «senté», 10.5 % de su propia V y 3.9 % de la de cada una de las otras tres. «Banco» quedó teñido de «sentarse»: es el banco del parque, no el de dinero.
:::

:::figura llms-atencion
A quién mira «banco» en «Me senté en el banco», con los números del ejemplo. El grosor de cada línea es su porcentaje de atención.
:::

:::analogia Un tablero de anuncios
Imagina un tablero con un anuncio por cada palabra de la frase. Tu Q es lo que necesitas («¿quién me dice qué tipo de banco soy?»). La K de cada anuncio es su título, y la V es lo que dice el anuncio. Lees con más cuidado los anuncios cuyo título se parece a lo que buscas.

**Dónde se rompe:** tú elegirías un anuncio y leerías ese. La atención no elige: lee **todos**, cada uno en su porcentaje, y los mezcla. Además, nadie escribió los títulos: las tablas que producen Q, K y V se aprendieron solas durante el entrenamiento, y lo que «busca» cada Q no siempre tiene una interpretación humana.
:::

Dos detalles más que importan para lo que sigue:

- **En un LLM, cada token solo mira a los anteriores** (y a sí mismo). Tiene sentido: cuando el modelo escribe, los tokens siguientes todavía no existen. Por eso la K y la V de un token, una vez calculadas, **ya no cambian** aunque la frase siga creciendo.
- **La atención se hace varias veces en paralelo en cada bloque**, con tablas distintas. Cada una se llama **cabeza** (*head*) y puede especializarse en algo diferente. Llama 3 8B tiene 32 cabezas de 128 números en cada uno de sus 32 bloques.

:::profundo La fórmula completa, por si la ves escrita
En los artículos verás: atención(Q, K, V) = softmax(Q · Kᵀ ÷ √d) · V. Es exactamente el ejemplo de arriba, hecho para todos los tokens a la vez con multiplicación de matrices. La única pieza nueva es dividir entre √d, la raíz del tamaño de los vectores: con vectores de 128 números los productos punto salen muy grandes, y dividirlos evita que el softmax le dé casi el 100 % a un solo token. Con nuestros vectores de 2 números no hacía falta.

También verás que las CNN de la lección de redes miran solo a sus vecinos cercanos (un filtro de 3 × 3 píxeles), mientras que la atención deja que cualquier token mire a cualquier otro anterior, esté a 2 o a 2,000 tokens de distancia. Ese alcance es una de las razones de su éxito, y también de su costo: con n tokens hay del orden de n × n comparaciones.
:::

## Lo que ocupa en la GPU: pesos y KV cache {What fills the GPU: weights and KV cache}

Ya tenemos lo necesario para entender las dos cuentas de memoria que la Ronda hace una y otra vez.

### Los pesos

Los LLMs se nombran por su número de parámetros: 7B, 8B, 70B. La **B** es de *billion*, que en inglés significa mil millones. Un modelo 70B tiene unos 70 mil millones de parámetros. Para comparar: la ResNet-50 de C01 tiene 25.6 millones en su versión original; 70 mil millones son unas 2,700 veces más.

Cada parámetro es un número, y cuánto ocupa depende del formato en que se guarde. En la lección de imágenes viste [[float32]], de 4 bytes. Para servir LLMs casi siempre se usa un formato de 2 bytes, FP16 o BF16 (dos maneras de guardar un número decimal en 16 bits), y a veces uno de 1 byte o menos.

:::ejemplo Cuánto pesa un modelo de 70B
**Pesos = parámetros × bytes por parámetro.**

| Formato | Bytes por parámetro | 7B | 70B |
|---|---|---|---|
| FP32 | 4 | 28 GB | 280 GB |
| FP16 o BF16 | 2 | 14 GB | **140 GB** |
| FP8 o INT8 | 1 | 7 GB | 70 GB |
| INT4 | 0.5 | 3.5 GB | 35 GB |

La cuenta de la fila en negritas: 70,000,000,000 × 2 bytes = 140,000,000,000 bytes = 140 GB. Llama 3 70B tiene en realidad ≈ 70.6 mil millones de parámetros, así que en BF16 pesa ≈ 141 GB: es el número que usa la Ronda.

Una H100, de las GPUs más grandes, tiene 80 GB. **El modelo ni siquiera cabe en una.** Hay que repartirlo entre varias GPUs o guardarlo con menos bytes por parámetro. En C10 de la Ronda se sirve en FP8 (≈ 70.6 GB) repartido entre 2 H100.
:::

Los pesos se cargan una vez y no cambian. Pero no son lo único que vive en la GPU.

### El KV cache: no volver a calcular

Recuerda el ciclo: para escribir el token 251 de una respuesta, la atención necesita la K y la V de **todos** los tokens anteriores: los 2,000 del prompt y los 250 ya escritos. Podrías recalcularlas todas en cada paso, pero sería tirar trabajo: ya las calculaste antes, y viste que no cambian.

Así que se guardan. Esa memoria de K y V ya calculadas se llama [[kv-cache|KV cache]]: el modelo «recuerda lo que ya calculó». En cada paso solo calcula la K y la V del token nuevo y las agrega.

El precio es memoria. Por **cada token** de **cada conversación activa** hay que guardar una K y una V **en cada bloque** del modelo.

:::ejemplo El KV cache de Llama 3 8B
Llama 3 8B tiene 32 bloques. Tiene 32 cabezas de Q, pero solo 8 juegos de K y V, que se comparten entre grupos de 4 cabezas (un truco para ahorrar memoria). Cada K o V tiene 128 números, y cada número ocupa 2 bytes (BF16).

**Por token:**

2 (K y V) × 32 bloques × 8 juegos × 128 números × 2 bytes = **131,072 bytes = 128 KiB**

(Un KiB son 1,024 bytes. Las computadoras cuentan la memoria en potencias de 2; lo ves en la lección de unidades.)

**Por una conversación que llena la ventana de 8,192 tokens:**

128 KiB × 8,192 = **1 GiB** (≈ 1.07 GB)

Ahora junta las dos cuentas en una L4 de 24 GB: los pesos se llevan ≈ 16 GB, y quedan menos de 8 GB para todo lo demás. A 1 GiB por conversación larga, caben unas cuantas a la vez, no cientos: en la práctica ≈ 3 o 4, porque el servidor también se guarda un margen de memoria para trabajar. M04 hace esa cuenta completa.
:::

Para Llama 3 70B la misma cuenta da 320 KiB por token (tiene 80 bloques en vez de 32). En C10 de la Ronda, cada réplica (una copia del servidor, aquí con 2 H100) carga los pesos en FP8 y le quedan ≈ 68 GB para KV cache, que alcanzan para ≈ 93 conversaciones de 2,250 tokens al mismo tiempo. Por eso el KV cache, y no la velocidad de cálculo, suele ser lo que decide cuántas personas atiende una GPU a la vez.

:::ojo
No confundas el KV cache con el caché de respuestas de una página web. El KV cache no guarda respuestas para reutilizarlas con otras personas: guarda cálculos intermedios **de una conversación** mientras se escribe, y se libera al terminar. (Hay una variante que comparte el KV cache de un inicio de prompt común entre conversaciones, el *prefix caching*; la Ronda la ve en M14.)
:::

## Lo que un LLM hace mal, y cómo se ajusta {Hallucinations, fine-tuning, LoRA and RAG}

### Alucinaciones

Un LLM aprendió a producir texto **probable**, no texto **verdadero**. Casi siempre lo probable y lo verdadero coinciden, porque aprendió de mucho texto correcto. Pero si le preguntas algo que no sabe, el token más probable sigue siendo uno que **suena** bien.

Pregúntale a un modelo general por la política de devoluciones del marketplace de C01. Nunca la vio. Lo probable, por lo que leyó de otras tiendas, es «30 días», y eso contesta, con toda seguridad y buena redacción, aunque la política real diga 15. Eso es una [[alucinacion|alucinación]]: algo falso o sin respaldo, dicho con la misma confianza que algo cierto.

No es un error raro que se arregla una vez: es una consecuencia de cómo funcionan. Se reduce, se mide y se diseña alrededor de él. En la Ronda se mide con un conjunto fijo de preguntas con respuesta conocida, el [[golden-set|golden set]].

### Fine-tuning y LoRA

Si quieres que el modelo hable con el tono de tu empresa, o que llene un formato muy específico, puedes seguir entrenándolo con tus propios ejemplos. Eso es [[fine-tuning]]: partir de un modelo ya entrenado y ajustarlo con pocos datos, como viste en la lección de redes con las CNN.

El problema es el tamaño. Entrenar necesita mucha más memoria que servir: además de los pesos, hay que guardar el [[gradiente]] de cada parámetro y los datos extra del [[optimizador]]: con Adam y la mezcla usual de 2 y 4 bytes, del orden de 16 bytes por parámetro. Para un modelo de 8B: 8 mil millones × 16 bytes ≈ 128 GB, sin contar nada más.

[[lora|LoRA]] (*Low-Rank Adaptation*, de un artículo de Microsoft de 2021) es la salida barata. **Congela** los pesos originales y, junto a algunas de sus tablas, entrena dos tablas chiquitas cuyo producto se suma a la original.

:::ejemplo Cuánto ahorra LoRA en una tabla
Una tabla de 4,096 × 4,096 tiene 4,096 × 4,096 = 16,777,216 números. LoRA de «rango 8» entrena en su lugar una tabla de 4,096 × 8 y otra de 8 × 4,096:

4,096 × 8 + 8 × 4,096 = 32,768 + 32,768 = 65,536 números

Es 16,777,216 ÷ 65,536 = **256 veces menos** que entrenar la tabla completa. Lo que se guarda al final es un **adaptador** pequeño, no otra copia de 16 GB del modelo. Por ejemplo, LoRA de rango 8 sobre las tablas de Q y de V de los 32 bloques de Llama 3 8B son ≈ 3.4 millones de números: ≈ 7 MB en BF16. Con rangos más altos y en más tablas llega a decenas o cientos de MB, que sigue siendo poco. Y un mismo modelo base puede servir varios adaptadores (en la Ronda, vLLM lo hace con varios LoRA a la vez).
:::

### RAG: buscar primero, responder después

Para el problema de la política de devoluciones, el fine-tuning no es la herramienta: la política cambia cada mes y no quieres reentrenar por eso. Lo que quieres es que el modelo **lea la política antes de contestar**.

Eso es [[rag|RAG]] (*retrieval-augmented generation*, generación aumentada con búsqueda). Usa las piezas de la lección anterior:

:::pasos
1. Antes: preparar los documentos
Se parten los documentos de la empresa (políticas, manuales, preguntas frecuentes) en pedazos y se calcula el embedding de cada uno. Se guardan en un índice vectorial.
2. Buscar
Llega la pregunta «¿cuántos días tengo para devolver unos tenis?». Se calcula su embedding y se hace un [[retrieval]]: los pedazos más cercanos. A veces se reordenan con un [[re-ranking|re-ranker]].
3. Armar el prompt
Los pedazos encontrados se pegan en el prompt, con la instrucción de contestar solo con ellos, citar de dónde sale cada dato y decir «no lo sé» si no está.
4. Responder
El LLM contesta leyendo la política real: «15 días, según la política de devoluciones».
:::

RAG no elimina las alucinaciones (el modelo todavía puede mezclar el documento con lo que «cree saber»), pero las reduce y, sobre todo, las hace **verificables**: puedes revisar si lo que dijo está en lo que citó. Y fíjate en el costo: los pedazos ocupan lugar en la ventana de contexto y KV cache en la GPU. Cuántos pedazos caben es otra de las cuentas de M14.

:::nota Cuál usar
Una regla práctica: primero, un buen prompt. Si al modelo le falta **información**, RAG. Si le falta **comportamiento** (un formato, un tono, una tarea muy específica), fine-tuning, normalmente con LoRA. La Ronda (M14) lo dice en una frase: si el prompt y RAG no alcanzan, un LoRA sobre el modelo abierto, con su propio golden set.
:::

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M04 · Hardware para inferencia** hace las cuentas de esta lección con detalle: bytes por parámetro (¿cabe Llama 3 70B en una H100?), el KV cache de 128 KiB y 320 KiB por token, y el techo de ≈ 19 tokens por segundo de un modelo de 8B en una L4.
- **M07 · Servidores de modelos** presenta los servidores de LLMs (vLLM, SGLang, TensorRT-LLM), la API compatible con OpenAI y el *streaming* de tokens.
- **M14 · Sistemas con LLMs** arranca en *prefill* contra *decode* (TTFT y tiempo por token), trata el KV cache como la capacidad que limita a cada GPU, junta conversaciones en cada paso, y lleva RAG, evaluación de alucinaciones y costo por token a un diseño completo.
- Los casos **C10** (servir un LLM propio de 70B) y **C11** (un RAG) usan todos estos números.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
token tokenizer prompt ventana-contexto transformer atencion qkv generacion-autorregresiva sampling temperatura kv-cache llm lora rag alucinacion
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué un LLM tarda más en escribir 500 tokens que en leer un prompt de 500 tokens?
Porque el prompt ya existe completo y se procesa en una sola pasada, en paralelo (prefill). La respuesta se escribe de un token a la vez (decode): 500 pasadas una tras otra, y en cada una el modelo lee todos sus pesos de la memoria de la GPU.
? Logits 3 y 1 para dos tokens. ¿Qué probabilidades da el softmax con temperatura 1? ¿Y con temperatura 2?
Temperatura 1: e³ ≈ 20.09 y e¹ ≈ 2.72; suman 22.81; da ≈ 88 % y ≈ 12 %. Temperatura 2: los logits quedan 1.5 y 0.5; e^1.5 ≈ 4.48 y e^0.5 ≈ 1.65; suman 6.13; da ≈ 73 % y ≈ 27 %. Más temperatura, reparto más parejo.
? ¿Cuánta memoria ocupan los pesos de un modelo de 7B en BF16? ¿Y en INT4?
7,000,000,000 × 2 bytes = 14 GB en BF16. En INT4, 0.5 bytes por parámetro: 3.5 GB (más un poco de información extra que guarda el formato).
? ¿Qué guarda el KV cache y por qué crece durante una conversación?
Guarda la K y la V de cada token ya procesado, en cada bloque del modelo, para no recalcularlas en cada token nuevo. Crece porque cada token nuevo agrega su K y su V. En Llama 3 8B son 128 KiB por token.
? En la atención, ¿qué papel juegan Q, K y V?
Q es lo que busca un token; K es la etiqueta con la que cada token se ofrece; V es la información que entrega. Comparar la Q de un token con la K de los demás da cuánto atiende a cada uno, y su nuevo vector es la mezcla de las V en esos porcentajes.
? Un LLM contesta mal sobre un producto que se lanzó la semana pasada. ¿RAG o fine-tuning?
RAG: le falta información nueva, que cambia seguido. Se buscan los documentos del producto y se ponen en el prompt. El fine-tuning sirve para enseñar comportamiento (formato, tono), no para mantenerlo al día con datos que cambian.
:::
