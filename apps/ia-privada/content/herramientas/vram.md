---
titulo: ¿Cabe en la GPU?
en: VRAM calculator
subtitulo: Cuánta memoria de GPU necesita un modelo abierto para atender a varias personas a la vez, y si cabe en la GPU que vas a comprar o rentar, con la cuenta completa a la vista.
pregunta: Una empresa quiere correr un LLM en su propio servidor. ¿Cuánta memoria de GPU necesita, y en cuál GPU cabe?
sensei: llms, numeros-maquina, cpu-gpu
---

:::idea
Una GPU solo puede usar lo que tiene en su propia memoria, la [[vram|VRAM]]. Para servir un LLM ahí tienen que caber tres cosas: los **pesos** del modelo (lo que sabe), el **KV cache** de cada conversación (lo que recuerda de ella) y el **overhead** (el programa que lo sirve y un margen de seguridad). Si la suma pasa de lo que tiene la GPU, no cabe. Esta página explica cada pieza desde cero y la calculadora hace la suma por ti, con cada paso a la vista.
:::

## Qué responde esta calculadora {What this calculator answers}

Llevar IA a una empresa sin que sus datos salgan de su red empieza casi siempre igual: alguien elige un [[open-weight|modelo open weight]], lo descarga y pregunta «¿en qué lo corro?». La respuesta depende de una sola cuenta de memoria.

Piensa en la [[vram|VRAM]] como la mesa de trabajo de la GPU. La GPU calcula muy rápido, pero solo con lo que está sobre la mesa. Lo que está en el disco o en la RAM de la computadora es la bodega: traerlo cada vez sería demasiado lento. Así que todo lo que el modelo necesita para contestar tiene que estar sobre la mesa al mismo tiempo.

¿Qué hay sobre esa mesa?

- **Los pesos.** Los números que el modelo aprendió. Son fijos y los comparten todas las conversaciones.
- **El KV cache.** Lo que el modelo guarda de cada conversación mientras la atiende. Crece con cada token y con cada conversación nueva.
- **El overhead.** El programa que sirve el modelo y un margen que se deja libre a propósito.

La calculadora suma las tres y las compara con la VRAM de una GPU real. Las especificaciones de las GPUs salen de un solo archivo con fecha y fuente para cada número, el mismo que usa Sensei. Las fórmulas también son las de Sensei (lecciones «Transformers y LLMs» y «Cómo guarda números una computadora»); aquí se juntan en una sola cuenta y se les agrega lo que cambia cuando el modelo es de verdad.

## Los pesos: lo que el modelo sabe {Weights}

Un LLM es, por dentro, una montaña de números: sus [[pesos|pesos o parámetros]]. Un modelo de «8B» tiene unos 8 mil millones (la B es de *billion*, mil millones en inglés). Imagina las perillas de una consola de sonido gigante: entrenar es girarlas hasta que la música suene bien; servir es usarlas tal como quedaron. Cada token que el modelo escribe pasa por todas, así que tienen que estar todas en la VRAM.

Lo que ocupan depende de cuántos bytes usa cada número. En el formato normal para servir, BF16 o FP16, cada peso son 16 bits, o sea 2 bytes. La cuenta corta de Sensei es parámetros × bytes por parámetro.

Para que ocupen menos se usa la [[cuantizacion|cuantización]]: guardar cada peso con 8 o 4 bits en vez de 16. Es como pasar una foto de millones de colores a una paleta de 16: pesa mucho menos y casi no se nota, pero con muy pocos colores los saltos se empiezan a ver. En un modelo no se ve a ojo: se mide con evals.

Con 4 bits hay dos detalles que la cuenta corta no ve, y que esta calculadora sí cuenta:

1. **La escala de cada grupo.** Un número de 4 bits solo puede tomar 16 valores. Para saber cuánto vale cada escalón, los pesos se agrupan (de 128 en 128, en AWQ) y cada grupo guarda su propia [[escala-por-grupo|escala]] en 16 bits, más un punto cero de 4 bits. Es como si cada cajón de un taller trajera su propia regla: el de tornillos mide en milímetros, el de vigas en metros. Eso suma (16 + 4) ÷ 128 ≈ 0.16 bits a cada peso: en vez de 4 bits, ≈ 4.16. (Un GPTQ simétrico no guarda punto cero: ≈ 4.13.)
2. **Las tablas de tokens.** Un LLM tiene dos [[tablas-de-tokens|tablas]] que traducen entre tokens y números, una de entrada y una de salida, con vocabulario × tamaño del vector parámetros cada una. Son grandes, y AWQ, GPTQ y FP8 normalmente cuantizan solo las capas lineales y las dejan fuera: en los modelos de ejemplo de esta página se quedan en 16 bits. En un modelo chico pesan mucho: en Llama 3.1 8B son el 13 % de los parámetros.

:::formula Los pesos, \(W\)
W = (P − E) × bits ÷ 8 + E × 2
- P: los parámetros del modelo, en miles de millones
- E: los parámetros de las tablas de tokens, en miles de millones (vocabulario × tamaño del vector, una o dos veces)
- bits: los bits de cada peso cuantizado, con su escala: 16, 8, ≈ 4.16 en INT4 de AWQ
- W: lo que ocupan los pesos, en GB (miles de millones de bytes)
:::

Con \(E\) = 0 y bits = 16, la fórmula es exactamente la de Sensei: \(W = P × 2\).

:::cuenta Los pesos de Llama 3.1 8B
Tablas de tokens, \(E\) // vocabulario de 128,256 tokens, vectores de 4,096 números, dos tablas | 128,256 × 4,096 × 2 | ≈ 1.051 mil millones
En BF16 // 16 bits = 2 bytes por peso | (8.030 − 1.051) × 16 ÷ 8 + 1.051 × 2 | ≈ 16.06 GB
En INT4 de AWQ // ≈ 4.16 bits los demás pesos, 2 bytes las tablas | (8.030 − 1.051) × 4.156 ÷ 8 + 1.051 × 2 = 3.63 + 2.10 | **≈ 5.73 GB**
INT4 ideal // 4 bits todo, sin escalas ni tablas en 16 bits | 8.030 × 4 ÷ 8 | ≈ 4.02 GB
= El INT4 de verdad ocupa ≈ 43 % más que el ideal. Si dimensionas con el ideal, te quedas corto.
:::

## El KV cache: lo que el modelo recuerda de cada conversación {The KV cache}

Un LLM escribe un token a la vez. Para escribir el siguiente, su mecanismo de atención necesita dos vectores de cada token anterior, llamados K y V. Recalcularlos en cada paso sería tirar trabajo, así que se guardan: esa memoria es el [[kv-cache|KV cache]]. En Sensei («Transformers y LLMs») está la explicación completa; aquí basta la idea.

Piensa en un mesero que anota lo que pide cada mesa para no volver a preguntar. Cada platillo es una línea más en su libreta y cada mesa nueva abre su propia página. La libreta es la VRAM que queda después de los pesos, y tiene hojas contadas.

Por cada token se guardan una K y una V en cada bloque del modelo. En cada bloque la atención trabaja con varias cabezas, pero los modelos modernos comparten un mismo juego de K y V entre varias cabezas ([[gqa|GQA]]): como cuatro estudiantes que comparten un solo juego de apuntes. Por eso cuenta el número de juegos, no el de cabezas.

:::formula El KV cache
m_{token} = 2 × L × g × d × b_{kv}
m_{conv} = m_{token} × N
- 2: una K y una V
- L: los bloques del modelo (num_hidden_layers en su config.json)
- g: los juegos de K y V por bloque (num_key_value_heads)
- d: los números de cada K o V (head_dim)
- b_{kv}: los bytes de cada número: 2 en BF16, 1 en FP8
- m_{token}: lo que ocupa un token, en bytes
- N: los [[contexto|tokens de la conversación]], prompt más respuesta
- m_{conv}: lo que ocupa una conversación entera, en bytes
:::

Y luego se multiplica por las [[concurrencia|conversaciones a la vez]], \(u\): cada una tiene su propio KV cache. Ojo: son las que el servidor atiende en el mismo momento, no los usuarios registrados. Doscientos abogados de un despacho no escriben todos en el mismo segundo.

:::cuenta El KV cache de Llama 3.1 8B, 4 conversaciones de 8,192 tokens
Por token, \(m_{token}\) // \(L\) = 32, \(g\) = 8, \(d\) = 128, \(b_{kv}\) = 2 | 2 × 32 × 8 × 128 × 2 = 131,072 bytes | 128 KiB
Por conversación, \(m_{conv}\) // \(N\) = 8,192 tokens | 131,072 × 8,192 | ≈ 1.07 GB
Las 4 a la vez // \(u\) = 4 | 1.074 × 4 | **≈ 4.29 GB**
= Solo de KV cache, más de la cuarta parte de lo que ocupan los pesos en BF16. Con conversaciones más largas o más personas, el KV cache pasa a los pesos.
:::

Un KiB son 1,024 bytes. Las cuentas de memoria mezclan potencias de 2 (KiB, GiB) y de 10 (GB); la calculadora trabaja en bytes y da los resultados en GB de 10⁹ bytes, igual que las hojas de datos de las GPUs.

## El overhead: lo que no es el modelo {Overhead}

Si llenas un camión de mudanza con muebles hasta el techo, la puerta no cierra: también van las cobijas, las cuerdas y algo de espacio libre. En la GPU pasa lo mismo. El [[overhead]] tiene dos partes:

- **El programa, \(M_{prog}\).** El contexto de CUDA, las librerías, la memoria de trabajo de cada paso (las activaciones) y los buffers del servidor. Del orden de 1 a 5 GB, según el servidor, el modelo y cuántas GPUs. La calculadora arranca en 2 GB, como el ejemplo de Sensei con una L4.
- **El margen, \(f\).** Una parte de la VRAM que el servidor deja libre a propósito, para que un pico no lo tumbe. vLLM, uno de los servidores de LLMs más usados, por omisión usaba el 90 % de la memoria (\(f\) = 0.1) en su versión 0.10.2; en versiones más nuevas ese valor cambió. Revisa la documentación de la versión que uses.

:::ojo
La mejor medida del overhead no es una fórmula: es lo que imprime el servidor al arrancar. vLLM dice cuánta memoria ocupan los pesos y cuántos tokens de KV cache le caben. Usa la calculadora para decidir qué comprar o rentar, y el arranque del servidor para confirmar.
:::

## ¿Cabe? La cuenta completa {Does it fit}

Ya están las tres piezas. Lo que necesitas es su suma; lo que tienes es la VRAM de las GPUs menos el margen.

:::formula ¿Cabe en la GPU?
M_{necesito} = W + m_{conv} × u + M_{prog}
M_{útil} = (1 − f) × n × M_{GPU}
c = ⌊ (M_{útil} − W − M_{prog}) ÷ m_{conv} ⌋
- W: los pesos, en GB
- m_{conv} × u: el KV cache de todas las conversaciones a la vez
- M_{prog}: el programa que sirve el modelo, en GB
- n: las GPUs que forman una copia del servidor
- M_{GPU}: la VRAM de cada GPU, en GB
- f: el margen que el servidor deja libre (0.1 = 10 %)
- c: cuántas conversaciones de \(N\) tokens caben a la vez; ⌊ ⌋ es redondear hacia abajo
:::

Cabe cuando \(M_{necesito} ≤ M_{útil}\). La última fila, \(c\), es la cuenta de Sensei para saber cuántas conversaciones caben.

:::calculadora vram
Cada resultado trae debajo su cuenta con los números del momento. La lista de GPUs sale del archivo de datos de Sensei; los modelos de ejemplo, de su config.json oficial.
:::

:::cuenta Llama 3.1 8B en BF16, en una L4
Lo que necesitas // pesos + KV cache de 4 conversaciones + programa | 16.06 + 4.29 + 2 | 22.35 GB
Lo que tienes, \(M_{útil}\) // L4: 24 GB; \(f\) = 0.1 | (1 − 0.1) × 1 × 24 | 21.6 GB
¿Cabe? | 21.6 − 22.35 | **faltan 0.75 GB**
Caben, \(c\) | ⌊(21.6 − 16.06 − 2) ÷ 1.074⌋ = ⌊3.3⌋ | 3 conversaciones
Con pesos en INT4 de AWQ | 5.73 + 4.29 + 2 = 12.02 GB, contra 21.6 | **sí cabe, y caben 12**
= Cuantizar los pesos no solo hace que el modelo quepa: libera memoria para el KV cache, y eso es atender a más personas a la vez.
:::

## Varias GPUs {Several GPUs} [extra]

Cuando un modelo no cabe en una GPU, se reparte entre varias que trabajan como una sola copia del servidor. La calculadora lo modela de la forma más simple: suma la VRAM de las \(n\) GPUs. Es una buena primera aproximación, porque los pesos y el KV cache se reparten entre ellas.

Lo que esa suma no ve:

- **Cada GPU tiene su propio programa.** Con más GPUs, sube \(M_{prog}\). En el ejemplo de Sensei, una copia con 2 H100 usa ≈ 5 GB de programa.
- **El reparto no siempre es parejo.** La forma de partir el modelo (tensor parallel o pipeline parallel) y la red entre GPUs deciden qué tan bien se aprovecha la memoria y qué tan rápido va. Eso es tema de la lección «[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)».
- **Un [[moe|modelo MoE]] no se salva.** Aunque cada token use pocos expertos, en memoria van todos. Qwen3 30B-A3B pesa como un modelo de 30B, no como uno de 3B.

:::cuenta Llama 3.3 70B en FP8, en 2 H100 SXM
Pesos, \(W\) // \(P\) = 70.554, \(E\) = 2.101, 8 bits | (70.554 − 2.101) × 8 ÷ 8 + 2.101 × 2 | 72.655 GB
Lo que tienes, \(M_{útil}\) // 2 × 80 GB, \(f\) = 0.1 | 0.9 × 2 × 80 | 144 GB
Por conversación, \(m_{conv}\) // 320 KiB por token, 2,250 tokens | 327,680 × 2,250 | 0.737 GB
Caben, \(c\) // con \(M_{prog}\) = 5 GB; justo en el borde | ⌊(144 − 72.655 − 5) ÷ 0.73728⌋ = ⌊89.99⌋ | **89**
= Sensei, con la cuenta corta \(W = P × b\) (70.6 GB de pesos), llega a 92. La diferencia son las tablas de tokens en 16 bits: 2.1 GB menos de KV cache, 3 conversaciones menos.
:::

## Contra cifras publicadas {Against published figures}

Una calculadora sirve si se parece a lo que pasa de verdad. Estas son tres comparaciones con números publicados, consultados el 2026-11-25. En las dos primeras la calculadora va sin programa ni margen (\(M_{prog}\) = 0, \(f\) = 0), porque lo que se publica es la memoria de los pesos y del KV cache.

**1. El tamaño de los archivos.** Los pesos de un modelo en BF16 se publican en archivos .safetensors, y Hugging Face dice cuántos bytes suman. Es la prueba más directa de la fórmula de los pesos.

| Modelo | Archivos publicados | La calculadora | Desviación |
|---|---|---|---|
| Llama 3.3 70B, BF16 | 141,107,497,872 bytes | 141.11 GB | < 0.01 % |
| Qwen3 32B, BF16 | 65,524,328,560 bytes | 65.52 GB | < 0.01 % |
| Qwen3 8B, INT4 de AWQ | 6,098,581,864 bytes | 6.10 GB | < 0.05 % |

El tercero confirma las dos correcciones de los 4 bits: la escala de cada grupo y las tablas de tokens en 16 bits. Con el INT4 ideal la calculadora daría 4.10 GB, un 33 % menos que el archivo real.

**2. La memoria medida en una GPU.** La documentación de Qwen publica cuánta memoria de GPU usa Qwen3 32B al generar 2,048 tokens con un prompt de cierta longitud, en una NVIDIA H20 de 96 GB, con Hugging Face Transformers y una conversación a la vez. No dice si sus MB son de 10⁶ o de 2²⁰ bytes; aquí se compara como MiB (2²⁰), que es lo que reporta PyTorch, y se dice. La calculadora cuenta el prompt más los 2,048 tokens generados: 2,049 y 32,768 tokens.

| Qwen3 32B | Prompt de 1 token | Prompt de 30,720 tokens |
|---|---|---|
| BF16, medido | 62,751 MiB | 70,728 MiB |
| BF16, la calculadora | 63,001 MiB (+0.4 %) | 70,681 MiB (−0.07 %) |
| INT4 de AWQ, medido | 19,109 MiB | 27,718 MiB |
| INT4 de AWQ, la calculadora | 18,941 MiB (−0.9 %) | 26,621 MiB (−4.0 %) |

Con prompts largos la calculadora se queda un poco corta: no cuenta la memoria de trabajo de leer 30,720 tokens de golpe, y con AWQ esa memoria pesa más en proporción. Para eso está el programa, \(M_{prog}\), en la cuenta completa.

**3. Un formato que no es AWQ: GGUF.** llama.cpp y Ollama usan archivos GGUF. El de Llama 3.1 8B en Q4_K_M pesa 4,920,739,232 bytes; con la opción INT4 de AWQ la calculadora da 5.73 GB: **+16 %**. No es un error de la fórmula, es otro formato: GGUF también cuantiza las tablas de tokens y mezcla bloques de 4 y 6 bits. Dividido entre los parámetros, ese archivo sale a ≈ 4.9 bits por peso; el de Qwen3 32B en Q4_K_M, a ≈ 4.8. Para un GGUF, la cuenta que se acerca es \(E\) = 0 con ≈ 4.9 bits: 8.030 × 4.9 ÷ 8 ≈ 4.92 GB.

:::nota De dónde salen los datos
Los parámetros exactos y los tamaños de archivo, de la API de Hugging Face de cada modelo. La arquitectura (bloques, juegos de K y V, tamaño de cada vector, vocabulario), del config.json oficial; el de Meta pide aceptar su licencia, así que se leyó de una copia pública idéntica (la de unsloth). La memoria medida, de la página «Speed Benchmark» de la documentación de Qwen. El margen de vLLM, de su documentación de argumentos del motor (versión 0.10.2 y la más reciente).
:::

## Lo que la calculadora no cuenta {What it leaves out} [extra]

Ninguna calculadora reemplaza arrancar el servidor. Lo que esta deja fuera, a propósito:

- **La memoria de trabajo de un prompt largo.** Leer decenas de miles de tokens de golpe necesita memoria temporal. Lo viste arriba: −4 % con 30,720 tokens.
- **Cómo reparte la memoria el servidor.** vLLM guarda el KV cache en bloques de tamaño fijo; siempre se desperdicia un poco al final de cada conversación. Es tema de la lección «Batching continuo y PagedAttention».
- **Atención con ventana deslizante.** Algunos modelos solo recuerdan los últimos miles de tokens en parte de sus bloques. Para ellos la fórmula del KV cache da de más. Los modelos de ejemplo de esta página no la usan (su config.json lo dice).
- **Arquitecturas que comprimen el KV cache de otra forma.** Algunos modelos guardan una versión comprimida de K y V en vez de los vectores completos; su KV cache sigue otra fórmula. Revisa el config.json antes de confiar en la cuenta.
- **La calidad.** Que un modelo quepa en INT4 no dice si contesta bien en INT4. Eso se mide con evals, en las lecciones del módulo «Evals».

## Errores comunes {Common mistakes}

1. **Contar solo los pesos.** «El modelo pesa 16 GB y la GPU tiene 24: cabe». Arranca, pero con 4 conversaciones de 8,192 tokens ya no. **Cómo evitarlo:** pesos + KV cache × conversaciones a la vez + programa, contra la VRAM menos el margen.
2. **Usar el INT4 ideal.** 8 mil millones × 0.5 bytes = 4 GB es lo que nunca vas a ver en disco. **Cómo evitarlo:** suma la escala de cada grupo y las tablas de tokens en 16 bits; con AWQ, ≈ 4.16 bits y \(E\) en 2 bytes.
3. **Confundir usuarios con conversaciones a la vez.** 200 usuarios no son 200 conversaciones simultáneas. **Cómo evitarlo:** estima cuántas llegan en el mismo momento; las herramientas de sizing lo hacen con el tráfico.
4. **Contar cabezas en vez de juegos de K y V.** Con 32 cabezas en vez de 8 juegos, el KV cache sale 4 veces más grande. **Cómo evitarlo:** usa num_key_value_heads del config.json.
5. **Creer que un MoE ocupa lo que calcula.** Qwen3 30B-A3B calcula como uno de 3.3B, pero pesa como uno de 30B. **Cómo evitarlo:** para la memoria, los parámetros totales.
6. **Mezclar GB con GiB.** Una GPU «de 24 GB» tiene 24 × 10⁹ bytes, que son ≈ 22.4 GiB. **Cómo evitarlo:** pasa todo a bytes antes de comparar, como hace la calculadora.
7. **Dar el contexto máximo del modelo por hecho.** Que el modelo acepte 131,072 tokens no quiere decir que tu GPU tenga memoria para eso con varias personas. **Cómo evitarlo:** mira la última fila de la calculadora: el contexto que de verdad te cabe.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Qwen3 8B tiene 8.191 mil millones de parámetros y sus tablas de tokens suman 1.245 mil millones. ¿Cuánto ocupan sus pesos en FP8?
Con \(W = (P − E) × bits ÷ 8 + E × 2\) y 8 bits: (8.191 − 1.245) × 8 ÷ 8 + 1.245 × 2 = 6.946 + 2.490 = **≈ 9.44 GB**. La cuenta corta, 8.191 × 1, daría 8.19 GB: 1.25 GB menos, porque las tablas siguen en 2 bytes.
? [facil] ¿Cuánto KV cache ocupa un token de Qwen3 32B en BF16? Tiene 64 bloques, 8 juegos de K y V y vectores de 128 números.
Con \(m_{token} = 2 × L × g × d × b_{kv}\): 2 × 64 × 8 × 128 × 2 = **262,144 bytes = 256 KiB**. Una conversación de 8,192 tokens: 262,144 × 8,192 ≈ 2.15 GB.
? [medio] Un despacho quiere Qwen3 32B en INT4 de AWQ en una L40S de 48 GB, con 8 conversaciones de 8,192 tokens a la vez, 2 GB de programa y 10 % de margen. ¿Cabe? (Los números del despacho son un supuesto del ejemplo.)
Pesos: (32.762 − 1.556) × 4.156 ÷ 8 + 1.556 × 2 ≈ 16.21 + 3.11 ≈ 19.32 GB. KV cache: 2.15 GB × 8 ≈ 17.18 GB. Lo que necesitas: 19.32 + 17.18 + 2 = 38.50 GB. Lo que tienes: 0.9 × 48 = 43.2 GB. **Cabe**, con 4.7 GB de sobra, al 89 % de la memoria útil.
? [medio] En el mismo despacho, ¿qué pasa si el KV cache se guarda en FP8 en vez de BF16?
\(b_{kv}\) pasa de 2 a 1 byte: el KV cache se reduce a la mitad, 17.18 ÷ 2 ≈ 8.59 GB. Lo que necesitas baja a 19.32 + 8.59 + 2 ≈ 29.91 GB, el 69 % de la memoria útil, y caben ⌊(43.2 − 19.32 − 2) ÷ 1.074⌋ = **20 conversaciones** en vez de 10. El precio, como con los pesos, es algo de precisión que hay que medir.
? [reto] Con Llama 3.1 8B en BF16 en una L4 (21.6 GB útiles, 2 GB de programa), ¿cuál es el contexto más largo que cabe si llegan 4 conversaciones a la vez?
Lo libre para KV cache, con los números de la calculadora (\(P\) = 8.030, \(E\) = 1.051): 21.6 − 16.06 − 2 = 3.54 GB. Cada token de las 4 conversaciones: 4 × 131,072 bytes = 524,288 bytes. Contexto: ⌊3,540,000,000 ÷ 524,288⌋ = **6,752 tokens**, lejos de los 131,072 que acepta el modelo.
:::

## Palabras que vas a oír {Words you'll hear}

:::conceptos
open-weight vram pesos cuantizacion escala-por-grupo tablas-de-tokens kv-cache gqa contexto concurrencia overhead moe
:::
