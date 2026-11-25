---
titulo: Elegir un modelo para la tarea
en: Choosing a model for the task
subtitulo: Cómo leer el nombre de un modelo abierto, qué compra cada tamaño, qué cuesta pensar, qué mide de verdad un benchmark y cómo un despacho llega de decenas de candidatos a uno solo con filtros duros y su propio examen.
pregunta: Hay decenas de modelos abiertos y cada uno dice ser el mejor en su tabla. ¿Cómo elijo el que conviene para mi tarea, mi GPU y mi idioma?
sensei: llms, ruido
---

:::idea
No existe «el mejor modelo»: existe el mejor para tu tarea, tu licencia, tu GPU y tu idioma. Primero se descarta lo que no puede servir (filtros duros que se contestan con sí o no), después se ordena lo que queda con benchmarks leídos con su ruido, y al final decide un examen con preguntas de tu propia tarea. La lista de modelos cambia cada pocos meses; el método no.
:::

Esta lección sigue a **el despacho**, un ejemplo ficticio que usamos en toda la app: un despacho de abogados en la Ciudad de México con 200 abogados y asistentes que quiere preguntarle a sus 30,000 expedientes con un LLM sin que un solo documento salga de su red. Trabaja en español (con algunos contratos en inglés), y cada pregunta lleva ≈ 6,000 tokens de entrada y ≈ 500 de respuesta. Diseña para 8 conversaciones a la vez de hasta 8,192 tokens cada una, y quiere que el modelo empiece a contestar en ≤ 2 s y escriba al menos a 20 tokens por segundo para cada persona. Su candidato de hoy es **Qwen3 32B en INT4 de AWQ**. Por memoria, las 8 conversaciones caben en una GPU NVIDIA L40S de 48 GB: 38.50 GB de los 43.2 útiles, como calcula la [herramienta de VRAM](/herramientas/vram/). Pero caber no es atenderlas bien: leer los 6,000 tokens de una pregunta ya le toma a la L40S ≈ 2.2–2.4 s, y la cuenta completa de velocidad pide **3 L40S**. Esa diferencia entre «cabe» y «se atiende bien» va a pesar al elegir modelo.

Ya sabes, de [Transformers y LLMs](https://sensei.trueml.app/llms/), qué es un token, qué son los [[pesos]], qué es una mezcla de expertos y cómo un modelo base se vuelve asistente. Aquí no se repite: se usa para **elegir**. Y de [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/) basta recordar una idea: un porcentaje medido con pocas muestras se mueve mucho.

Todos los datos de modelos de esta lección son **a noviembre de 2026** y, salvo que se diga otra cosa, los puntajes los **reportó el propio fabricante** en la ficha de su modelo. Dentro de seis meses habrá modelos nuevos. Por eso la lección enseña a leerlos, no a memorizarlos.

## No hay «el mejor modelo» {There is no «best model»}

Cada semana alguien publica «el mejor modelo abierto». Cada ficha trae una tabla donde su modelo gana. Si eliges por esas tablas, cambias de modelo cada mes y nunca sabes si el nuevo contesta mejor **tus** preguntas.

Elegir un modelo se parece más a contratar a una persona que a comprar el coche más rápido. Importa que sepa hacer el trabajo, que el contrato sea legal, que quepa en tu nómina y que hable tu idioma. Un currículum brillante en otra especialidad dice poco.

Para el despacho, «la tarea» es concreta: leer 5 fragmentos de expediente, contestar en español jurídico y **citar el documento y la página** de donde sale cada dato. Eso no es resolver problemas de olimpiada de matemáticas, que es lo que miden varios de los benchmarks más citados de 2026.

Hay cuatro restricciones que ningún puntaje compensa:

- **La licencia.** Si no permite uso comercial, o pone condiciones que el despacho no puede cumplir, el modelo no existe para él, aunque sea el primero de todas las tablas.
- **La memoria.** Si los pesos más el [[kv-cache|KV cache]] de 8 conversaciones no caben en los 43.2 GB útiles de una L40S, el modelo no arranca, o atiende a menos personas de las que hacen falta. Y si caben, todavía falta ver qué tan rápido las atiende.
- **El idioma.** Un modelo que se entrenó casi solo en inglés puede escribir un español torpe, o contestar en inglés a mitad de la respuesta.
- **El [[contexto]].** Si no le caben los ≈ 6,500 tokens de una pregunta con su respuesta, no sirve.

Después de esos filtros quedan unos pocos candidatos. Ahí sí miras benchmarks, pero sabiendo qué mide cada uno y cuánto ruido trae. Y la decisión final la toma un examen hecho con preguntas reales del despacho.

:::analogia Comprar zapatos para correr
Primero descartas lo que no es de tu talla: no importa qué tan buenas sean las reseñas. Después lees reseñas para quedarte con tres. Al final te los pruebas y corres en la tienda. La talla es el filtro duro, las reseñas son los benchmarks y la prueba es tu examen.

**Dónde se rompe:** un zapato no cambia cada tres meses, y los modelos sí. Además, en la tienda pruebas tú; con un modelo, la «prueba» necesita decenas de preguntas para que el resultado no sea suerte, como verás en la sección de puntajes.
:::

La lista de modelos de abajo envejece rápido. El orden de los pasos, no: **filtrar, ordenar, examinar**.

## Familias de modelos abiertos y cómo leer un nombre {Open model families and how to read a name}

Una [[familia-de-modelos|familia de modelos]] (*model family*) es un grupo de modelos del mismo fabricante que comparten nombre, receta de entrenamiento y estilo de arquitectura, publicados en varios tamaños y versiones. Todos son [[open-weight|open weight]]: sus pesos se descargan y corren en tu máquina.

Estas son las que importan a noviembre de 2026 para una empresa con una o pocas GPUs:

| Familia | Fabricante | Licencia (de los modelos de esta lección) | Lo más nuevo que cabe en una GPU de 48 GB |
|---|---|---|---|
| Qwen | Alibaba | Apache 2.0 | Qwen3.8 27B (agosto de 2026), Qwen3.6 27B y 35B-A3B (abril de 2026) |
| Gemma | Google | Apache 2.0 desde Gemma 4 (Gemma 3 tenía licencia propia) | Gemma 4 31B y 26B-A4B (marzo de 2026) |
| Mistral | Mistral AI | Apache 2.0 en Small; «other» en Medium 3.5 y Large 4 | Mistral Small 3.2 24B (junio de 2025) |
| gpt-oss | OpenAI | Apache 2.0 | gpt-oss-20b (agosto de 2025) |
| Llama | Meta | Llama Community License, a medida | Llama 3.1 8B; Llama 4 Scout ya pesa 108.6 mil millones |
| DeepSeek | DeepSeek | MIT | ninguno: V4 y V4.1 pesan cientos de GB |
| Phi | Microsoft | MIT | Phi-4 14B (diciembre de 2024), contexto de 16,384 |
| OLMo | Ai2 | Apache 2.0 | Olmo 3 32B Think (noviembre de 2025), con datos y código abiertos |

Tres cosas que dice esta tabla:

- **El panorama cambió mucho desde 2025.** Qwen3 32B, el modelo del despacho, salió en abril de 2025. Desde entonces Qwen publicó tres generaciones más. Sigue funcionando y está bien documentado, pero ya no es lo más nuevo.
- **Llama se quedó quieto.** En el listado de Meta en Hugging Face, lo último es Llama 4, de abril de 2025. Los más grandes y nuevos (DeepSeek V4, Kimi K3.1, GLM-5.3) son abiertos, pero no caben en un servidor de una GPU.
- **El tamaño útil para 24–48 GB** son densos de ≈ 24 a 32 mil millones de parámetros o mezclas de expertos de ≈ 20 a 36 mil millones con ≈ 3 a 4 mil millones activos.

### Cómo leer un nombre

Los nombres parecen claves de inventario, pero casi todos siguen el mismo orden. Toma uno real: **Qwen3-30B-A3B-Instruct-2507**.

:::figura elegir-modelo-nombre
Cada pieza del nombre contesta una pregunta distinta: de qué familia y generación es, cuánto ocupa, cuánto trabaja por token, cómo se ajustó y de qué fecha es la revisión.
:::

- **Familia y generación: Qwen3.** El número de generación no es una escala: Qwen3.6 no es «0.6 mejor» que Qwen3. Desde Qwen3.5, la mayoría de los bloques de Qwen usan una atención «lineal» que casi no guarda KV cache; es otra máquina por dentro.
- **Tamaño: 30B.** Parámetros totales, en miles de millones (*billions*). Es lo que decide la memoria.
- **Activos: A3B.** Si aparece, es una mezcla de expertos ([[moe|MoE]]) y ese número son los [[parametros-activos|parámetros activos]] por token. Si no aparece, es un [[modelo-denso|modelo denso]]. Gemma escribe lo mismo como 26B-A4B; gpt-oss no lo pone en el nombre (gpt-oss-20b tiene 3.6 mil millones activos).
- **Cómo se ajustó: Instruct.** «Base» es el modelo sin ajustar; «Instruct» (o «-it» en Gemma) sigue instrucciones; «Thinking» piensa antes de contestar. Si no dice nada, lee la ficha: Qwen3 32B es un solo modelo que hace las dos cosas con un interruptor.
- **Revisión: 2507.** Año y mes: julio de 2025. El mismo modelo puede tener varias revisiones con comportamiento distinto; la de julio separó en dos archivos lo que en abril era uno solo.

A veces el nombre trae un sufijo más, como «-AWQ», «-FP8» o «-GGUF»: es un formato de cuantización, el mismo modelo guardado con menos bits. Lo ves a fondo en la lección «Formatos de cuantización en la práctica».

:::ojo
El nombre no es una ficha técnica. «20b» en gpt-oss-20b son 20.9 mil millones; «Qwen3-32B» son 32.76. Para las cuentas de memoria usa el número exacto de la API de Hugging Face o del config.json, como hace la herramienta de VRAM.
:::

## Tamaños: qué compra cada escalón {Sizes: what each step buys}

Más parámetros compran, en general, más conocimiento y mejor razonamiento. También cuestan más memoria y más tiempo por token. La pregunta no es «¿cuál es el más grande?», sino «¿cuál es el más chico que hace bien mi tarea?».

### Lo que cuesta en memoria

La cuenta corta de los pesos es parámetros por bytes por parámetro. Con 4 bits de AWQ hay que sumar la escala de cada grupo y las [[tablas-de-tokens|tablas de tokens]] en 16 bits; la [herramienta de VRAM](/herramientas/vram/) hace la cuenta exacta. Para comparar tamaños basta la corta:

:::formula Memoria de los pesos, cuenta corta
W ≈ P × frac{bits}{8}
- P: los parámetros totales del modelo, en miles de millones
- bits: los bits por peso: 16 en BF16, 8 en FP8, ≈ 4.16 en INT4 de AWQ con su escala
- W: lo que ocupan los pesos, en GB; la cuenta exacta suma de 1 a 3 GB por las tablas de tokens en 16 bits
:::

| Escalón | Ejemplo | BF16 | FP8 | 4 bits (corta) |
|---|---|---|---|---|
| ≈ 8 mil millones | Llama 3.1 8B | 16.1 GB | 8.0 GB | ≈ 4.2 GB |
| ≈ 24 mil millones | Mistral Small 3.2 24B | 48.0 GB | 24.0 GB | ≈ 12.5 GB |
| ≈ 32 mil millones | Qwen3 32B | 65.5 GB | 32.8 GB | ≈ 17.0 GB (exacta: 19.32) |
| ≈ 70 mil millones | Llama 3.3 70B | 141.1 GB | 70.6 GB | ≈ 36.7 GB (exacta: 39.77) |
| ≈ 120 mil millones | Mistral Small 4 | 238.8 GB | 119.4 GB | ≈ 62.0 GB |

En una L40S, con 43.2 GB útiles, el techo práctico es un denso de ≈ 32 mil millones en 4 bits, porque detrás de los pesos tiene que caber el KV cache de 8 conversaciones. Un 70B en 4 bits ya ocupa casi toda la GPU solo con los pesos.

### Lo que cuesta en velocidad

Cuando un LLM escribe, cada token nuevo obliga a leer de la memoria de la GPU todos los pesos que trabajan en ese token. Lo viste en [Transformers y LLMs](https://sensei.trueml.app/llms/): para una conversación sola, la velocidad tope la pone el **ancho de banda** de la memoria (cuántos GB por segundo puede leer la GPU), no la potencia de cálculo. Ningún programa aprovecha el 100 % de ese ancho de banda; las cuentas del despacho suponen el 70 %.

:::formula Velocidad tope de una conversación sola
v_{tope} ≈ frac{η_m × B}{W_{activo}}
- η_m: la fracción del ancho de banda que se aprovecha de verdad; el despacho supone 0.7
- B: el ancho de banda de la memoria de la GPU, en GB/s (L40S: 864 GB/s)
- W_{activo}: los bytes de pesos que se leen por cada token, en GB: todos los pesos en un denso, solo los activos en un MoE
- v_{tope}: tokens por segundo como máximo para una conversación sola; la real queda por debajo
:::

:::cuenta El techo de Qwen3 32B en INT4 de AWQ, en una L40S
Pesos que se leen por token, \(W_{activo}\) // es denso: todos; la cuenta exacta de la herramienta de VRAM | 19.32 GB | 19.32 GB
Ancho de banda que se aprovecha, \(η_m × B\) // L40S: 864 GB/s, de la tabla de GPUs de la app; \(η_m\) = 0.7 | 0.7 × 864 | 604.8 GB/s
Techo, \(v_{tope}\) // \(η_m × B ÷ W_{activo}\) | 604.8 ÷ 19.32 | **≈ 31 tokens/s**
Contra el objetivo del despacho // 20 tokens/s por persona | 31.3 ÷ 20 | ≈ 1.6 veces
= Una conversación sola va a ≈ 31 tokens por segundo: poco margen sobre los 20 que pide el despacho. El mismo modelo en BF16 (65.5 GB) ni cabe; en FP8 su techo bajaría a 604.8 ÷ 32.76 ≈ 18 tokens/s, por debajo del objetivo.
:::

¿Y con 8 conversaciones a la vez? El servidor lee los pesos **una vez** por paso y los usa para todas las conversaciones que van juntas; así atiende a varias personas casi al costo de una. Lo ves a fondo en la lección «Batching continuo y PagedAttention». Pero hay otro costo que crece con cada pregunta: antes de escribir, el modelo tiene que **leer** sus 6,000 tokens de entrada, y eso sí es cálculo puro, del orden de 2 operaciones por parámetro por token. En la L40S, con Qwen3 32B, esa lectura tarda ≈ 2.2–2.4 s por pregunta, y mientras la hace, las demás conversaciones escriben más lento. Por eso la cuenta completa del despacho pide 3 L40S, no 1. Para elegir modelo basta esto: **cada parámetro que trabaja por token es tiempo que pierdes, al leer la pregunta y al escribir la respuesta**.

### Qué compra el tamaño

Dentro de una misma familia y generación, el más grande casi siempre saca más. En las tablas de Google, Gemma 4 31B saca 85.2 en MMLU-Pro, el 26B-A4B 82.6 y el 12B 77.2. Pero entre generaciones el tamaño pesa menos que la receta: Qwen3.6 27B saca 86.2 en esa misma prueba (tabla de Qwen), y Qwen3 32B, de un año antes, quedaba bastante abajo en las pruebas que sí reportó (por ejemplo, 68.4 en GPQA Diamond con razonamiento, contra 87.8 de Qwen3.6 27B).

La regla práctica: **un modelo nuevo de 27B puede ganarle a uno viejo de 32B**. El tamaño dice cuánto cuesta; la generación dice mucho de cuánto sabe.

## Denso contra MoE, desde la elección {Dense versus MoE, from the buyer's side}

Ya conoces la [[moe|mezcla de expertos]]: en cada bloque hay muchos expertos y un enrutador que elige unos pocos por token. Aquí importa lo que cambia al elegir: un MoE separa dos números que en un denso son el mismo.

- **Los parámetros totales deciden la memoria.** Cualquier token puede ir a cualquier experto, así que todos tienen que estar en la GPU.
- **Los parámetros activos deciden el trabajo por token**: el techo de velocidad de una conversación sola y cuánto cálculo cuesta leer la pregunta.

:::figura elegir-modelo-activos
Cinco modelos con sus parámetros totales (la memoria) y activos (el trabajo). En un denso las dos barras son iguales; en un MoE, la de activos es una fracción. Mistral Small 4 trabaja como uno chico y pesa como uno enorme.
:::

Compara los dos Qwen3 de la misma fecha, abril de 2025, que el despacho tiene en su lista:

:::cuenta Qwen3 32B (denso) contra Qwen3 30B-A3B (MoE), en 4 bits en una L40S
Pesos en memoria // cuenta corta \(P × 4.16 ÷ 8\) con los totales: 32.76 y 30.53 | 17.0 contra 15.9 | casi iguales
KV cache por token // de su config.json: 64 bloques × 8 juegos × 128 contra 48 × 4 × 128, × 2 × 2 bytes | 256 KiB contra 96 KiB | 2.7 veces menos
KV de 8 conversaciones de 8,192 tokens // KV por token × 65,536 tokens | 17.18 GB contra 6.44 GB | 10.7 GB libres de más
Pesos leídos por token, \(W_{activo}\) // activos: 32.8 contra 3.3 mil millones, × 4.16 ÷ 8 | 17.0 GB contra 1.7 GB | 10 veces menos
Techo de una conversación, \(v_{tope}\) // 0.7 × 864 GB/s ÷ \(W_{activo}\); el denso con su cuenta exacta de 19.32 GB | ≈ 31 contra ≈ 350 tokens/s | techos, no mediciones
Leer los 6,000 tokens de la pregunta // ≈ 2 × activos × 6,000 operaciones, entre 0.5 × 362 billones por segundo de la L40S | ≈ 2.2 s contra ≈ 0.2 s | 10 veces menos
Calidad // tablas del paper de Qwen3, con razonamiento: GPQA Diamond y AIME 2025 | 68.4 y 72.9 contra 65.8 y 70.9 | el denso, un poco arriba
= Ocupan casi lo mismo; el MoE escribe muchas veces más rápido, lee la pregunta en una décima del tiempo y guarda menos KV cache, y el denso sabe un poco más. Ninguno «gana» en abstracto, pero al despacho, que no llega a sus 2 s con el denso, el MoE le resuelve justo lo que le aprieta.
:::

El techo de ≈ 350 tokens/s del MoE es una cuenta, no una promesa: la tabla de salida en 16 bits, el KV cache y el propio programa se leen también en cada paso, y bajan ese número. Que el MoE sea varias veces más rápido para una conversación sola sí es lo esperable. Con muchas conversaciones a la vez, entre todas tocan casi todos los expertos, y la ventaja se achica.

El caso extremo es **Mistral Small 4**: 119.4 mil millones en total y 6.5 mil millones activos. Trabaja como un modelo de 6.5B, pero en 4 bits sus pesos ocupan ≈ 62 GB. No cabe en una L40S. El nombre «Small» se refiere a la familia, no a tu GPU.

:::ojo
«3B activos» no quiere decir «sabe como uno de 3B», ni «cabe como uno de 3B». Sabe parecido a un denso algo más chico que su total, cabe como su total y escribe como uno mucho más chico.
:::

## Base, instruct y de razonamiento: el costo de pensar {Base, instruct and reasoning: the cost of thinking}

De [Transformers y LLMs](https://sensei.trueml.app/llms/) ya sabes cómo un modelo preentrenado se vuelve asistente. Para elegir, eso se traduce en tres tipos que vas a ver en los nombres:

- Un [[modelo-base]] solo continúa texto. Sirve de punto de partida para ajustarlo; casi nunca para servirlo en un chat.
- Un [[modelo-instruct]] sigue instrucciones y contesta directo. Es rápido y gasta pocos tokens.
- Un [[modelo-razonamiento|modelo de razonamiento]] (*reasoning* o *thinking model*) escribe una cadena de pensamiento antes de la respuesta, a veces de miles de tokens. Acierta más en problemas difíciles.

:::diagrama elegir-modelo-camino
El camino de un modelo, de base a destilado. Toca cada caja o usa «Recorrer».
:::

En 2026 el razonamiento viene de tres formas:

1. **Un modelo aparte.** Qwen3-30B-A3B-Instruct-2507 y Qwen3-30B-A3B-Thinking-2507 son dos archivos distintos.
2. **Un interruptor en el mismo modelo.** Qwen3 32B y los Qwen3.5 a 3.8 se apagan con `enable_thinking=false`; Mistral Small 4 usa `reasoning_effort` (`none` o `high`); Gemma 4 se enciende con el token `<|think|>` al inicio del *system prompt*. Ojo: desde Qwen3.5, los Qwen **piensan por omisión**.
3. **Solo razonamiento, con niveles.** gpt-oss tiene `Reasoning: low/medium/high`; Qwen3.8 27B, `reasoning_effort` xhigh, medium o low; DeepSeek V4.1 Flash, un esfuerzo de 1 a 100.

### Lo que cuesta pensar

El pensamiento son tokens. Se escriben a la misma velocidad que la respuesta, y la persona espera a que terminen antes de ver la primera palabra útil. También ocupan KV cache, porque el modelo tiene que poder «leer» lo que pensó para escribir la respuesta.

:::formula El costo de pensar
t_{resp} = t_0 + frac{N_p}{v}
t_{total} = t_0 + frac{N_p + N_r}{v}
m_{extra} = N_p × m_{token}
- t_0: el tiempo al primer token, en s (el objetivo del despacho: ≤ 2 s; con Qwen3 32B en la L40S, solo leer la pregunta ya toma ≈ 2.2–2.4 s)
- N_p: los tokens que el modelo piensa antes de contestar
- N_r: los tokens de la respuesta (el despacho: ≈ 500)
- v: la velocidad de escritura por persona, en tokens/s (el despacho: 20)
- t_{resp}: cuánto espera la persona hasta que empieza la respuesta, en s
- t_{total}: cuánto tarda la respuesta completa, en s
- m_{token}: el KV cache de un token, en bytes (Qwen3 32B en BF16: 262,144 bytes = 256 KiB)
- m_{extra}: el KV cache de más que ocupa cada conversación mientras piensa, en bytes
:::

:::cuenta El despacho con un modelo que piensa 1,500 tokens
Sin pensar, \(t_{total}\) // \(N_p\) = 0, con \(t_0\) en el objetivo de 2 s: 2 s + 500 tokens ÷ 20 tokens/s | 2 + 25 | 27 s
Espera hasta la respuesta, \(t_{resp}\) // \(N_p\) = 1,500 (un supuesto del ejemplo) | 2 + 1,500 ÷ 20 | **77 s**
Respuesta completa, \(t_{total}\) | 2 + (1,500 + 500) ÷ 20 | 102 s
Cuántas veces más | 102 ÷ 27 | ≈ 3.8 veces
KV de más por conversación, \(m_{extra}\) // Qwen3 32B en BF16 | 1,500 × 262,144 bytes | ≈ 393 MB
KV de más, 8 conversaciones // si todas piensan a la vez | 393 MB × 8 | ≈ 3.1 GB
Tokens de la conversación // 6,000 de entrada + 1,500 + 500, contra el tope de 8,192 | 8,000 | cabe, por 192 tokens
= Pensar 1,500 tokens convierte una respuesta de medio minuto en una de casi dos, y deja la conversación al borde del tope. Con 2,000 tokens pensados ya serían 8,500: no cabe.
:::

Y 1,500 tokens es poco. El paper de gpt-oss reporta que gpt-oss-20b usa **más de 20,000 tokens de pensamiento por problema, en promedio, en AIME**. A 20 tokens por segundo son 1,000 s, casi 17 minutos, antes de la primera palabra. Qwen recomienda, para las tareas complejas de Qwen3.5 y 3.6, permitir hasta 81,920 tokens de salida, y al menos 128K de contexto para no recortarles el pensamiento.

:::calculadora elegir-modelo-razonamiento
Mueve los tokens pensados y mira cómo crecen la espera y la memoria. Cambia el modelo para ver cuánto pesa cada token pensado en su KV cache.
:::

Para el despacho, la conclusión es directa: con un tope de 8,192 tokens y 20 tokens por segundo, **el razonamiento largo no cabe**, ni en tiempo ni en contexto. Se sirve con el pensamiento apagado, o con el nivel más bajo, y se mide así en su examen. Eso tiene una consecuencia para leer benchmarks: casi todas las tablas de 2026 se midieron **con el razonamiento encendido**. Qwen3 32B saca 68.4 en GPQA Diamond pensando y 54.6 sin pensar (paper de Qwen3). Si tú lo vas a servir sin pensar, tu número es el segundo.

## Benchmarks: qué mide cada uno {Benchmarks: what each one measures}

Un [[benchmark]] es un examen público y fijo, con sus preguntas y su forma de calificar. Sirve para comparar modelos con el mismo instrumento. Cada uno mide **una** cosa, y conviene saber cuál antes de leer su número.

| Benchmark | Qué mide | Tamaño y forma |
|---|---|---|
| MMLU | Conocimiento general en 57 materias (historia, medicina, derecho, matemáticas…) | Opción múltiple, 4 opciones (2020) |
| MMLU-Pro | Lo mismo, más difícil: preguntas de razonamiento y sin las triviales | 10 opciones; la precisión baja 16 a 33 puntos contra MMLU (2024) |
| MMLU-Redux | 5,700 preguntas de MMLU revisadas a mano | Encontró errores en ≈ 6.5 % de MMLU (2024) |
| MMMLU | MMLU traducido por personas a 14 idiomas, español incluido | La forma más común de medir otros idiomas en las fichas |
| GPQA Diamond | Biología, física y química de nivel doctorado, «a prueba de Google» | Del set completo de 448: doctores 65 %, no expertos con internet 34 % (2023) |
| IFEval | Seguir instrucciones verificables con código («más de 400 palabras», «menciona X 3 veces») | ≈ 500 prompts, 25 tipos de instrucción (2023) |
| HumanEval | Escribir una función que pase sus pruebas | Problemas de programación desde su descripción (2021) |
| LiveCodeBench | Programación de concurso (LeetCode, AtCoder, Codeforces), con fecha | Preguntas fechadas para evitar contaminación (2024) |
| MATH / MATH-500 | Matemáticas de competencia con solución paso a paso | 12,500 problemas; MATH-500 es un subconjunto (2021) |
| AIME | El examen de invitación de la olimpiada de matemáticas de EE. UU. | Respuesta entera; muy pocos problemas por año |
| LiveBench | Varias tareas con respuesta objetiva, preguntas renovadas cada mes | 18 tareas en 6 categorías (2024) |
| RULER | Si el modelo usa de verdad el contexto que anuncia | Varias «agujas» escondidas en textos largos (2024) |
| La Leaderboard, IberBench | Español (de España y Latinoamérica) y otras lenguas ibéricas | 66 y 101 conjuntos de datos (2025) |

Para el despacho, ninguno mide exactamente su tarea. Los que más se acercan son IFEval (seguir instrucciones de formato, como «cita documento y página»), MMMLU y los de español (el idioma) y RULER (usar bien 6,000 tokens de fragmentos). AIME y LiveCodeBench miden cosas que el despacho no pide.

### Quién midió el número

Casi todos los puntajes que ves en una ficha los midió **el propio fabricante**, con su prompt, su modo de razonamiento, su versión del benchmark y su fecha. No es trampa: es lo único que hay el día que sale un modelo. Pero tiene tres consecuencias:

- **Dos tablas distintas no se comparan.** gpt-oss-20b saca 91.7 en AIME 2025 en su paper; Qwen3.6 27B, 94.1 en AIME 2026 en el suyo. Son ediciones distintas del examen, con evaluadores distintos.
- **Dentro de una misma tabla se compara mejor.** La ficha de Qwen3.6 27B mide también a Gemma 4 31B con el mismo método. Sigue siendo auto-reportado, pero al menos es el mismo instrumento.
- **Las versiones importan.** LiveCodeBench v5 y v6 tienen problemas distintos: 65.7 en una no se compara con 80.0 en la otra.

| A noviembre de 2026 (tabla de Qwen, auto-reportado, con razonamiento) | Qwen3.6 27B | Qwen3.6 35B-A3B | Gemma 4 31B |
|---|---|---|---|
| MMLU-Pro | 86.2 | 85.2 | 85.2 |
| GPQA Diamond | 87.8 | 86.0 | 84.3 |
| LiveCodeBench v6 | 83.9 | 80.4 | 80.0 |
| AIME 2026 | 94.1 | 92.7 | 89.2 |

Además, en las fichas de 2026 aparecen **benchmarks internos** del fabricante (QwenWebBench, el «internal benchmark» de Mistral) que nadie más puede repetir. Léelos como publicidad.

## Leer un puntaje: un benchmark es una muestra {Reading a score: a benchmark is a sample}

Un benchmark no es «la habilidad del modelo»: es una **muestra** de preguntas. Si hicieras otro examen del mismo tipo, con otras preguntas, el puntaje se movería. ¿Cuánto? Lo dice el [[error-estandar|error estándar]], que viste a fondo en [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/). Aquí lo usamos para leer tablas.

:::formula Ruido de un puntaje y de una diferencia
SE = sqrt{frac{p × (1 − p)}{n}}
text{intervalo} = p ± 1.96 × SE
SE_{dif} = sqrt{SE_A^2 + SE_B^2}
- p: el puntaje, como fracción de 0 a 1 (86 % = 0.86)
- n: cuántas preguntas tiene el examen
- SE: el error estándar del puntaje, como fracción
- 1.96: los errores estándar que dejan adentro el 95 % de una campana
- SE_A, SE_B: los errores estándar de dos modelos, A y B
- SE_{dif}: el error estándar de la diferencia \(p_A − p_B\); si la diferencia es menor que \(1.96 × SE_{dif}\), puede ser puro ruido
:::

La raíz manda: para la mitad del ruido necesitas 4 veces más preguntas.

:::cuenta Dos modelos a 2 puntos, en un examen de 200 preguntas
Error estándar de A, \(SE_A\) // \(p\) = 0.86, \(n\) = 200 | √(0.86 × 0.14 ÷ 200) | 0.0245 = 2.45 puntos
Intervalo de A // \(p ± 1.96 × SE\) | 86 ± 4.8 | de 81.2 a 90.8
Error estándar de B, \(SE_B\) // \(p\) = 0.84 | √(0.84 × 0.16 ÷ 200) | 0.0259 = 2.59 puntos
Ruido de la diferencia, \(1.96 × SE_{dif}\) | 1.96 × √(2.45² + 2.59²) | ±7.0 puntos
¿Se distinguen? // la diferencia contra su ruido | 2 contra 7.0 | **no**
= Con 200 preguntas, 2 puntos de diferencia no dicen nada: dos modelos iguales pueden separarse así por pura suerte de qué preguntas tocaron.
:::

Con este código lo compruebas para tres tamaños de examen. Solo usa la biblioteca estándar:

```python
from math import sqrt

def intervalo(p, n):
    """Puntaje p (de 0 a 1) en n preguntas -> (bajo, alto) del 95 %, en puntos."""
    m = 1.96 * sqrt(p * (1 - p) / n)
    return 100 * (p - m), 100 * (p + m)

def se_distinguen(p1, p2, n1, n2):
    """¿La diferencia entre dos puntajes es más grande que su ruido?"""
    se = sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    z = (p1 - p2) / se
    return round(z, 2), abs(z) >= 1.96

for nombre, p, n in [("30 problemas", 0.941, 30),
                     ("200 preguntas", 0.86, 200),
                     ("12,000 preguntas", 0.862, 12000)]:
    bajo, alto = intervalo(p, n)
    print(f"{nombre:>16}: {100*p:.1f} -> de {bajo:.1f} a {alto:.1f}")

print("94.1 contra 89.2, 30 cada uno:  ", se_distinguen(0.941, 0.892, 30, 30))
print("86 contra 84, 200 cada uno:     ", se_distinguen(0.86, 0.84, 200, 200))
print("86.2 contra 85.2, 12,000 cada uno:", se_distinguen(0.862, 0.852, 12000, 12000))
```

```salida
    30 problemas: 94.1 -> de 85.7 a 102.5
   200 preguntas: 86.0 -> de 81.2 a 90.8
12,000 preguntas: 86.2 -> de 85.6 a 86.8
94.1 contra 89.2, 30 cada uno:   (0.69, False)
86 contra 84, 200 cada uno:      (0.56, False)
86.2 contra 85.2, 12,000 cada uno: (2.21, True)
```

Lee las tres filas:

- **AIME, 30 problemas.** El intervalo de 94.1 llega a 102.5 %, que no existe. Es la señal de que con tan pocas preguntas y tan cerca del 100 % la campana ya no aproxima bien; el intervalo real es asimétrico, pero igual de ancho. Lo importante: 94.1 contra 89.2 (Qwen3.6 27B contra Gemma 4 31B en la tabla de Qwen) **no se distingue**. AIME tiene muy pocos problemas por año; repetir varias veces cada problema baja el ruido del muestreo del modelo, pero no el de haber elegido solo esos problemas.
- **200 preguntas.** Ni 2 puntos se distinguen.
- **12,000 preguntas.** Con un examen del tamaño de MMLU-Pro, 1 punto ya es estadísticamente real. Pero «real» no quiere decir «importante»: es 1 punto en preguntas de opción múltiple que no son las del despacho.

:::figura elegir-modelo-intervalos
Los mismos 2 puntos de diferencia, medidos con tres tamaños de examen. Con 200 preguntas los intervalos casi se tapan; con 10,000 ya no se tocan.
:::

### Dos modelos iguales también difieren

La mejor manera de creerlo es simularlo: dos modelos **idénticos**, los dos aciertan 85 %, cada uno con su examen de 200 preguntas al azar.

```python
import random

random.seed(42)
P, N, VECES = 0.85, 200, 10_000   # dos modelos IGUALES: los dos aciertan 85 %

def examen():
    return 100 * sum(random.random() < P for _ in range(N)) / N

grandes = 0
for _ in range(VECES):
    if abs(examen() - examen()) >= 2:   # 2 puntos o más de diferencia
        grandes += 1
print(f"{grandes / VECES:.1%} de las veces, dos modelos iguales difieren 2 puntos o más")
```

```salida
62.3% de las veces, dos modelos iguales difieren 2 puntos o más
```

Más de la mitad de las veces. Cuando leas «nuestro modelo supera al rival por 2 puntos», pregunta cuántas preguntas tenía el examen.

:::calculadora elegir-modelo-ruido
Pon dos puntajes y el tamaño de cada examen. La última fila dice cuántas preguntas harían falta para distinguir esa diferencia.
:::

:::nota Si los dos modelos contestan las mismas preguntas
La fórmula de arriba trata los dos exámenes como independientes. Cuando los dos modelos contestan exactamente las mismas preguntas, se puede comparar pregunta por pregunta (una prueba pareada) y se distingue un poco mejor. Lo ves en la sección «¿Es real una mejora de 0.2 puntos?» de [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/).
:::

## Contaminación y saturación {Contamination and saturation} [extra]

El ruido es el error que se ve. Hay dos más que no se ven en la tabla.

### Contaminación: el examen ya estaba en el entrenamiento

La [[contaminacion|contaminación]] (*contamination*) es cuando las preguntas de un benchmark, o versiones parafraseadas o traducidas de ellas, se colaron en los datos de entrenamiento. Los modelos se entrenan con billones de tokens de internet; los benchmarks están en internet. El puntaje sube por memoria.

Las pruebas con cifras:

- **GSM1k (2024).** Unos investigadores escribieron a mano, sin LLMs, 1,000 problemas nuevos del estilo de GSM8K (aritmética de primaria en palabras). Algunos modelos cayeron **hasta ≈ 8 puntos** al pasar de GSM8K al set nuevo, según la versión publicada del estudio (la primera versión decía hasta 13). Los modelos de frontera casi no cayeron. Y la caída se relacionaba con qué tan probable era que el modelo «recitara» ejemplos de GSM8K.
- **Parafrasear evade los filtros (2023).** Los fabricantes quitan de sus datos los textos idénticos a los benchmarks. Pero una pregunta reescrita o traducida pasa el filtro: con eso, un modelo de 13 mil millones de parámetros llegó a igualar a GPT-4 en MMLU, GSM8K y HumanEval.
- **MMLU-CF (2024).** Microsoft armó una versión de MMLU sin contaminación, con preguntas cerradas. GPT-4o saca 73.4 % ahí (con 5 ejemplos en el prompt) y 71.9 % sin ejemplos.

La defensa son los benchmarks **con fecha** o **renovados**: LiveCodeBench usa problemas publicados después de cierta fecha, y LiveBench cambia ≈ 1/6 de sus preguntas cada mes. LiveBench mismo dice que limita la contaminación, no que la elimina.

### Saturación: cuando todos sacan casi 100

Un [[saturacion|benchmark saturado]] ya no separa a los buenos. MMLU es el caso clásico: gpt-oss-120b saca 90.0 (su paper), y la revisión a mano de MMLU-Redux encontró errores en ≈ 6.5 % de las preguntas de MMLU, y en 57 % de las de virología. Sobre ≈ 90 % ya se compite contra etiquetas mal puestas.

En MMLU-Redux, Qwen3.6 27B saca 93.5 y Gemma 4 31B 93.7 (tabla de Qwen). Esa diferencia de 0.2 no dice nada. Por eso las fichas de 2026 casi no reportan MMLU clásico y se movieron a MMLU-Pro, GPQA y pruebas de agentes, que en uno o dos años se saturarán también.

:::analogia El examen que circula
Un examen de admisión que lleva años circulando en fotocopias: los alumnos sacan cada vez más, pero no saben más. La universidad lo cambia (un benchmark nuevo), y el ciclo vuelve a empezar.

**Dónde se rompe:** el alumno con fotocopias sabe que hace trampa; el modelo no. Nadie revisó a mano los billones de tokens con que se entrenó.
:::

## Leaderboards por votos y sus sesgos {Vote-based leaderboards and their biases}

Un [[leaderboard]] es una tabla pública que ordena modelos. El más conocido para chat es **LMArena** (antes Chatbot Arena, hoy en arena.ai): una persona escribe una pregunta, recibe dos respuestas de modelos anónimos y vota por la mejor. Con millones de votos sale un puntaje tipo Elo, como el del ajedrez. Al 22 de noviembre de 2026, su tabla de texto juntaba **9,241,799 votos sobre 427 modelos**.

La diferencia de puntos se traduce en qué tan seguido gana uno al otro:

:::formula Probabilidad de ganar con un puntaje tipo Elo
P_A = frac{1}{1 + 10^{−d/400}}
- d: la diferencia de puntos, el de A menos el de B
- P_A: la probabilidad de que una persona prefiera la respuesta de A en un duelo
:::

:::cuenta Qué tan lejos está un modelo chico de la cima
Arriba de los que parecen abiertos // MiMo-V2.6-Pro, en la página del 22 de noviembre de 2026 | 1,481 | 1,481
Un modelo chico // Granite 4.1 8B | 1,305 | 1,305
Diferencia, \(d\) | 1,481 − 1,305 | 176
Probabilidad de que gane el de arriba, \(P_A\) | 1 ÷ (1 + 10^(−176/400)) | ≈ 73 %
Con 100 puntos de diferencia | 1 ÷ (1 + 10^(−100/400)) | ≈ 64 %
= Incluso 176 puntos de diferencia significan que el de abajo gana más de 1 de cada 4 duelos. Y ninguno de los modelos de la cima cabe en una GPU de 48 GB.
:::

Es un buen termómetro de lo que prefiere la gente en general. Para elegir el modelo del despacho tiene cuatro sesgos:

1. **Las preguntas no son las tuyas.** Son las de quien entra a votar: muchas en inglés, cortas, de programación o de curiosidad. Casi ninguna trae 6,000 tokens de expediente.
2. **Premia el estilo.** Una respuesta larga, bien formateada y segura de sí misma gana votos aunque tenga un error que solo un experto ve. Al despacho le importa lo contrario: corto, citado y correcto.
3. **Quien vota no verifica.** Nadie revisa que la cita «expediente 1234, página 17» exista.
4. **Lo de arriba no cabe.** La cima está llena de modelos de cientos de miles de millones de parámetros. Que un modelo grande gane no dice cuál de los que **sí caben** te conviene.

Úsalo para descartar (si un modelo está muy abajo, algo le falta) y para enterarte de qué salió. No para decidir.

## Tu propio examen {Your own exam}

Después de los filtros y de leer benchmarks con su ruido, queda la pregunta que ningún benchmark contesta: **¿contesta bien las preguntas del despacho?** La única forma de saberlo es preguntárselas.

Un examen propio es un conjunto de 50 a 200 preguntas reales de tu tarea, cada una con la respuesta que un experto daría. Para el despacho: preguntas que hicieron abogados de verdad sobre expedientes de verdad, con los fragmentos que el sistema les daría, y la respuesta que un abogado firmaría, con su cita. Fijan 200 preguntas (un supuesto del ejemplo).

¿Por qué 200 preguntas propias valen más que 12,000 de un benchmark, si tienen **más** ruido? Porque el ruido no es el único error. Un benchmark mide con mucha precisión **otra cosa**; tu examen mide con menos precisión **lo que te importa**. Un termómetro de laboratorio en el cuarto equivocado no te dice si tienes fiebre.

Lo que tu examen ve y un benchmark no:

- **Tu idioma y tu jerga.** «Amparo», «litisconsorcio», «cláusula de no competencia» y la forma en que los abogados mexicanos preguntan.
- **Tu formato.** ¿Cita documento y página? ¿Dice «no lo encuentro en los fragmentos» cuando no está, en vez de inventar?
- **Tu configuración.** El modelo cuantizado en 4 bits, con el pensamiento apagado, con tu prompt y con 6,000 tokens de fragmentos. Es como lo vas a servir.
- **Lo que falla.** No solo el porcentaje: leer las respuestas equivocadas dice si el problema es el modelo, los fragmentos o el prompt.

Y lo que no ve: con 200 preguntas, un puntaje de 85 % trae ±4.9 puntos de ruido, y dos modelos tienen que estar a ≈ 7 puntos para distinguirse. Por eso el examen propio sirve para **descartar los que fallan** en tu tarea y para encontrar diferencias grandes, no para decidir entre dos que empatan. Cuando empatan, decide otra cosa: la velocidad, la memoria, lo que ya funciona.

Cómo armar ese examen sin que te engañe (cuántas preguntas, cómo calificar respuestas abiertas, cómo usar otro LLM como calificador y cómo evitar que el examen se cuele al prompt) lo ves a fondo en la lección «Demostrar que el modelo abierto sirve», del módulo de evals.

## Elegir para el despacho, paso a paso {Choosing for the law firm, step by step}

Ahora sí, el método completo con los números del despacho: 8 conversaciones de 8,192 tokens, 2 GB de programa, español, y su modelo de referencia, Qwen3 32B en INT4 de AWQ. El filtro de memoria se hace contra una L40S de 48 GB (43.2 GB útiles con 10 % de margen): es la pregunta «¿cabe en una GPU?». Cuántas GPUs hacen falta para atender bien a todos es otra cuenta, la de velocidad, que con Qwen3 32B da 3 L40S.

:::diagrama elegir-modelo-embudo
Toca cada caja para ver qué pregunta hace, o usa «Recorrer» para seguir al despacho de los cientos de modelos al elegido.
:::

:::pasos
1. Licencia
Se queda con lo que permite uso comercial sin condiciones que el despacho no pueda cumplir. Apache 2.0 y MIT pasan directo. Llama tiene una licencia a medida que hay que leer, y lo marcado «other» (Mistral Medium 3.5, Mistral Large 4, Qwen3.8 Flash Next) también. Cómo se lee una licencia lo ves en la lección «Open weight, open source y licencias».
2. Memoria
Pesos en 4 bits + KV cache de 8 × 8,192 tokens + 2 GB, contra los 43.2 GB útiles de una L40S. Es la cuenta de la herramienta de VRAM, y saca a los que pesan de más aunque sean «Small». Ojo: este filtro dice si **cabe**, no si se atiende bien; eso lo dice la velocidad, más abajo.
3. Idioma
Español declarado por el fabricante, o al menos medido (MMMLU incluye español). Phi-4 declara solo inglés y sale aquí.
4. Contexto
Al menos 8,192 tokens. Casi todos pasan: los modelos de 2026 anuncian 128K o más.
5. Shortlist y examen
Lo que queda se ordena con benchmarks leídos con su ruido, y se examina con las 200 preguntas del despacho.
:::

### El filtro de memoria, con números

:::cuenta Llama 3.3 70B, una alternativa que el despacho tenía anotada
Pesos en INT4 de AWQ // cuenta exacta de la herramienta de VRAM | (70.554 − 2.101) × 4.156 ÷ 8 + 2.101 × 2 | 39.77 GB
KV cache, 8 × 8,192 tokens // 320 KiB por token (80 bloques × 8 × 128 × 2 × 2 bytes) × 65,536 tokens | 327,680 × 65,536 | 21.47 GB
Lo que necesita // pesos + KV + programa | 39.77 + 21.47 + 2 | 63.24 GB
Lo que hay // 0.9 × 48 GB | 43.2 | 43.2 GB
= Faltan ≈ 20 GB. Sale en el filtro de memoria (y su licencia a medida habría pedido una lectura aparte). Mistral Small 4, con ≈ 62 GB solo de pesos, ni llega a la cuenta del KV cache.
:::

Lo que pasa los cuatro filtros:

| Modelo (a noviembre de 2026) | Pesos en 4 bits | KV de 8 × 8,192 | Total aprox. | Leer 6,000 tokens en la L40S | Español |
|---|---|---|---|---|---|
| Qwen3 32B (la referencia) | 19.32 GB (exacta) | 17.18 GB | 38.50 GB | ≈ 2.2 s | 119 lenguas declaradas (paper de Qwen3) |
| Qwen3.6 27B | ≈ 14.4 GB + tablas | 4.29 GB + un estado fijo | ≈ 21 GB | ≈ 1.8 s | no lo declara; mide MMMLU |
| Qwen3.8 27B | igual que 3.6 | igual que 3.6 | ≈ 21 GB | ≈ 1.8 s | no lo declara |
| Gemma 4 31B | ≈ 16.3 GB + tablas | del orden de 12 GB (estimación) | ≈ 30 GB | ≈ 2.0 s | 140+ en preentrenamiento, 35+ soportados |
| gpt-oss-20b | ≈ 13–14 GB (MXFP4, como se publica) | 1.61 GB + 3 MB fijos | ≈ 17 GB | ≈ 0.2 s | no lista; MMMLU en español 81.2 (nivel high) |
| Mistral Small 3.2 24B | ≈ 12.5 GB + tablas | 10.74 GB | ≈ 25 GB | ≈ 1.6 s | 24 idiomas declarados en su ficha |

La columna de lectura es la cuenta corta de cálculo: 2 × parámetros activos × 6,000 tokens, entre el 50 % de los ≈ 362 billones de operaciones por segundo de la L40S; no cuenta la atención ni la cola, así que la real sale algo más alta (para Qwen3 32B, la cuenta completa da ≈ 2.4 s). Todas las cifras con «≈» son cuentas, no mediciones; antes de comprar se confirman con la herramienta de VRAM y arrancando el servidor. El KV de Qwen3.6 sale de sus 16 bloques de atención completa (64 KiB por token): sus otros 48 bloques guardan un estado fijo por conversación que esta cuenta no incluye. El de Gemma 4 mezcla bloques globales y de ventana, y la cifra es una estimación a confirmar. Qwen3 30B-A3B y Qwen3.6 35B-A3B también pasan; el despacho los guarda para una segunda ronda si la velocidad aprieta.

### ¿Por qué no cambiar ya a Qwen3.6 27B?

En la tabla de Qwen, Qwen3.6 27B le gana por mucho a Qwen3 32B: 87.8 contra 68.4 en GPQA Diamond, por ejemplo. ¿Por qué el despacho no cambia y ya? Por cinco razones, todas de esta lección:

1. **Son números de otro examen.** GPQA mide química y física de doctorado; AIME, olimpiada de matemáticas. El despacho pregunta por contratos en español.
2. **Son números con el razonamiento encendido.** El despacho lo sirve apagado, porque pensar no le cabe en 8,192 tokens ni en 20 tokens por segundo. Y los Qwen3.6 piensan por omisión: hay que apagarlos y medirlos así.
3. **Son auto-reportados.** Y en tablas distintas a las de Qwen3 32B, que se midió un año antes, con otras versiones de los benchmarks.
4. **Entre los nuevos, las diferencias son de ruido.** 94.1 contra 89.2 en AIME (30 problemas) no distingue a Qwen3.6 27B de Gemma 4 31B.
5. **Hay ventajas que sí se miden en casa.** Qwen3.6 27B lee la pregunta en ≈ 1.8 s contra ≈ 2.2 de Qwen3 32B: con el de referencia, el despacho ni siquiera llega a su objetivo de 2 s. Y su KV es de 64 KiB por token contra 256 de Qwen3 32B. Con la misma memoria, el despacho podría dar contextos 4 veces más largos: 8 conversaciones de 32,768 tokens ocuparían los mismos 17.18 GB de KV que hoy ocupan las de 8,192. Eso cambia qué cabe en el prompt, y vale la pena medirlo.

Así que el despacho no cambia de modelo por un puntaje: **mete a Qwen3 32B en su propio examen, junto a los cinco nuevos**, con la misma configuración con que los serviría. Si uno nuevo gana por más del ruido (≈ 7 puntos con 200 preguntas), cambia. Si empatan, mira la velocidad y la memoria (con los nuevos, probablemente a favor del cambio, y quizá con menos de 3 L40S), y lo decide con números suyos. Y si Qwen3 32B gana en su tarea, se queda, aunque «haya salido hace año y medio».

Lo que no cambia: el examen se guarda. Cuando salga Qwen4 o Gemma 5, el despacho no lee la ficha y cambia; corre las mismas 200 preguntas.

## Destilación {Distillation} [extra]

En los nombres vas a ver «Distill». La [[destilacion|destilación]] (*distillation*) es entrenar un modelo chico, el alumno, con las respuestas de uno grande, el maestro, para que imite lo que hace el grande a una fracción del costo de servirlo.

El ejemplo más famoso es **DeepSeek-R1-Distill-Qwen-32B** (enero de 2025). El maestro es DeepSeek-R1, un modelo de razonamiento de 671 mil millones de parámetros con 37 mil millones activos, con licencia MIT. El alumno es la base **Qwen2.5-32B** (no Qwen3), ajustada con muestras de preguntas, razonamientos y respuestas que escribió R1. Fue ajuste supervisado (SFT), sin aprendizaje por refuerzo. DeepSeek hizo seis así, de 1.5 a 70 mil millones, sobre bases de Qwen2.5 y Llama.

Sus resultados, en la tabla de DeepSeek (auto-reportado): 72.6 en AIME 2024, 94.3 en MATH-500 y 62.1 en GPQA Diamond, contra 63.6, 90.0 y 60.0 de o1-mini de OpenAI. Un modelo de 32B que cabía en una GPU parecía razonar como uno cerrado de frontera.

¿Por qué funciona tan bien? Porque aprender de un maestro es más barato que descubrir por prueba y error. Qwen lo midió en su paper de Qwen3: para Qwen3-8B, destilar de sus modelos grandes costó ≈ 1,800 horas de GPU y dio 74.4 en AIME 2024; el aprendizaje por refuerzo directo costó ≈ 17,920 horas, casi 10 veces más, y dio 67.6. Qwen3 30B-A3B y los densos de 0.6 a 14B se hicieron así; Qwen3 32B no (se entrenó con refuerzo directo).

Para elegir, dos lecciones:

- **«Distill» dice de dónde salió, no qué tan bueno es hoy.** R1-Distill-Qwen-32B es de 2025 sobre una base de 2024. En las tablas de 2026, los Qwen y Gemma de su tamaño lo superan.
- **El alumno hereda al maestro.** Si el maestro piensa 10,000 tokens, el alumno también tiende a pensar mucho, con todo lo que eso cuesta en la sección del costo de pensar. Y no supera al maestro en lo que el maestro no le enseñó.

:::analogia El aprendiz
Un aprendiz de carpintero que copia cómo trabaja el maestro aprende en meses lo que al maestro le tomó años de errores.

**Dónde se rompe:** el maestro de carpintería explica por qué; el modelo maestro solo da sus respuestas, y el alumno imita la forma sin garantía de entender. Por eso un destilado puede razonar muy bien en matemáticas, donde el maestro dio miles de ejemplos, y flojo en derecho mexicano, donde no dio ninguno.
:::

## Errores comunes {Common mistakes}

1. **Elegir por la ficha del fabricante.** «Saca 94 en AIME, es el mejor». **Cómo evitarlo:** pregunta qué mide ese benchmark, quién lo midió, con qué modo de razonamiento y cuántas preguntas tiene. Y decide con tu propio examen.
2. **Comparar números de tablas distintas.** gpt-oss-20b con 91.7 en AIME 2025 contra Qwen3.6 27B con 94.1 en AIME 2026: son ediciones distintas y evaluadores distintos. **Cómo evitarlo:** compara solo dentro de la misma tabla, y aun ahí con su ruido.
3. **Creer que 2 puntos son una diferencia.** Con 200 preguntas, dos modelos iguales difieren 2 puntos o más el 62 % de las veces. **Cómo evitarlo:** calcula \(1.96 × SE_{dif}\) antes de creer una diferencia.
4. **Medir con el razonamiento encendido y servir apagado.** Qwen3 32B: 68.4 en GPQA pensando, 54.6 sin pensar. **Cómo evitarlo:** examina el modelo con la misma configuración con que lo vas a servir: cuantización, prompt, contexto y razonamiento.
5. **Leer «A3B» o «Small» como «cabe».** Mistral Small 4 tiene 6.5 mil millones activos y ocupa ≈ 62 GB en 4 bits. **Cómo evitarlo:** para la memoria, los parámetros totales, siempre.
6. **Olvidar que pensar cuesta.** Un modelo que piensa 1,500 tokens hace que el despacho espere 77 s antes de ver la respuesta, y casi llena el tope de 8,192. **Cómo evitarlo:** pon los tokens pensados en la calculadora antes de elegir un modelo de razonamiento.
7. **Cambiar de modelo cada vez que sale uno.** **Cómo evitarlo:** guarda tu examen y corre las mismas preguntas con cada candidato nuevo. Cambia solo si gana por más que el ruido, o si empata y es más barato de servir.

## En la vida real {In real life}

**El despacho.** De decenas de familias, los filtros duros dejan seis candidatos que, por memoria, caben en una L40S con 8 conversaciones de 8,192 tokens (atenderlas bien a todas, con Qwen3 32B, pide 3 L40S). Ninguna tabla pública decide: Qwen3 32B, su modelo de referencia, entra al examen de 200 preguntas junto a Qwen3.6 27B, Qwen3.8 27B, Gemma 4 31B, gpt-oss-20b y Mistral Small 3.2 24B, todos en 4 bits y sin razonamiento largo. Si empatan, pesan la velocidad y la memoria: un modelo que lee la pregunta más rápido o guarda un KV cache 4 veces más chico puede ahorrarle GPUs.

**Una clínica que resume expedientes médicos** (supuesto del ejemplo). Su tarea es parecida, pero su filtro de idioma pesa más (términos médicos en español) y su tolerancia a errores es casi cero. Ahí un modelo de razonamiento puede valer la pena: un resumen no tiene prisa de 20 tokens por segundo, se puede generar de noche, y pensar 5,000 tokens no molesta a nadie. El mismo método da otra respuesta porque la tarea es otra.

**Un equipo que quiere un asistente de programación interno** (supuesto del ejemplo). Aquí LiveCodeBench sí se parece a su tarea, y los modelos que piensan suelen ganar en las tablas. Pero su examen propio debe salir de su propio código: los errores de su sistema, en su lenguaje, con sus librerías. Un benchmark de problemas de concurso no ve si el modelo entiende el código de 15 años de su empresa.

**Fuera de la IA.** Las revistas de autos publican la aceleración de 0 a 100. Si compras una camioneta para repartir, ese número no importa: importan la carga, el consumo y si cabe en tus calles. Cada industria aprende lo mismo: el examen genérico ordena, el uso real decide.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Lee el nombre **gemma-4-26B-A4B-it**. ¿Qué familia y generación es, cuántos parámetros ocupan memoria, cuántos trabajan por token y cómo se ajustó?
Familia Gemma (Google), generación 4. **26B**: unos 26 mil millones de parámetros totales (la ficha dice 25.2), que deciden la memoria. **A4B**: unos 4 mil millones activos (3.8 en la ficha): es un MoE. **it**: *instruction-tuned*, ajustado para seguir instrucciones; el equivalente de «Instruct».
? [facil] Mistral Small 3.2 24B tiene 24.011 mil millones de parámetros. Con la cuenta corta, ¿cuánto ocupan sus pesos en BF16 y en 4 bits de AWQ? ¿Cabe en BF16 en una L40S?
Con \(W ≈ P × bits ÷ 8\): en BF16, 24.011 × 16 ÷ 8 ≈ **48.0 GB**. En 4 bits, 24.011 × 4.156 ÷ 8 ≈ **12.5 GB** (más 1 a 3 GB por las tablas de tokens). En BF16 no cabe: 48.0 GB ya pasa de los 43.2 GB útiles, y faltaría todo el KV cache.
? [facil] Un modelo saca 85 % en un examen de 100 preguntas. ¿Cuál es su intervalo del 95 %?
\(SE = sqrt{0.85 × 0.15 ÷ 100}\) ≈ 0.0357. Margen: 1.96 × 3.57 ≈ ±7.0 puntos. Intervalo: **de 78.0 % a 92.0 %**. Con 100 preguntas, un 85 % es casi cualquier cosa entre 78 y 92.
? [facil] En el despacho (\(t_0\) = 2 s, \(v\) = 20 tokens/s), un modelo piensa 3,000 tokens y contesta 500. ¿Cuánto espera el abogado hasta que empieza la respuesta, y cuánto hasta que termina?
\(t_{resp}\) = 2 + 3,000 ÷ 20 = 2 + 150 = **152 s**, más de dos minutos y medio. \(t_{total}\) = 2 + (3,000 + 500) ÷ 20 = 2 + 175 = **177 s**. Sin pensar serían 27 s.
? [medio] Dos modelos sacan 90 % y 87 % en un examen de 300 preguntas cada uno. ¿Se distinguen?
\(SE_A = sqrt{0.90 × 0.10 ÷ 300}\) ≈ 0.0173 (±3.4 puntos). \(SE_B = sqrt{0.87 × 0.13 ÷ 300}\) ≈ 0.0194 (±3.8). \(1.96 × SE_{dif} = 1.96 × sqrt{1.73^2 + 1.94^2}\) ≈ ±5.1 puntos. La diferencia es 3, menor que 5.1: **no se distinguen**. (En errores estándar: 3 ÷ 2.60 ≈ 1.15, menos que 1.96.)
? [medio] Con Qwen3 32B (256 KiB por token en BF16), el modelo piensa 3,000 tokens en cada una de las 8 conversaciones del despacho. ¿Cuánto KV cache de más ocupa, y cabe la conversación en el tope de 8,192?
Por conversación: \(m_{extra}\) = 3,000 × 262,144 bytes ≈ **786 MB**. Las 8: 786 MB × 8 ≈ **6.29 GB** de más. Tokens: 6,000 de entrada + 3,000 + 500 = 9,500, más que 8,192: **no cabe**. La respuesta se cortaría o el servidor la rechazaría.
? [medio] En un leaderboard por votos, el modelo A tiene 50 puntos más que el B. ¿Qué tan seguido gana A un duelo?
\(P_A = 1 ÷ (1 + 10^{−50/400})\) = 1 ÷ (1 + 10^{−0.125}) ≈ 1 ÷ (1 + 0.750) ≈ **57 %**. Gana poco más de la mitad: 50 puntos es una diferencia chica, y aún menos si las preguntas de quienes votan no se parecen a las tuyas.
? [medio] Un modelo saca 92 % en GSM8K y 84 % en un set nuevo de problemas del mismo estilo, escritos a mano. Otro saca 90 % y 89 %. ¿Qué te dice esto?
El primero cae 8 puntos al pasar al set nuevo; el segundo, 1. Con sets de ≈ 1,000 problemas, el ruido de una diferencia es de ≈ ±3 puntos, así que la caída de 8 no es azar: lo más probable es que el primero esté **contaminado** (vio GSM8K o versiones de él al entrenar). El segundo es el que de verdad resuelve problemas nuevos, aunque saque menos en el benchmark famoso.
? [reto] El despacho compara dos candidatos que sacan 88 % y 85 % en su examen. ¿Cuántas preguntas haría falta (las mismas para los dos) para distinguir esos 3 puntos? Y con sus 200 preguntas, ¿qué diferencia mínima distinguiría, más o menos?
Despeja \(n\) de \(p_A − p_B = 1.96 × sqrt{(p_A(1 − p_A) + p_B(1 − p_B)) ÷ n}\): \(n = 1.96^2 × (0.88 × 0.12 + 0.85 × 0.15) ÷ 0.03^2\) = 3.8416 × (0.1056 + 0.1275) ÷ 0.0009 ≈ **995 preguntas**. Con \(n\) = 200 y \(p\) ≈ 0.86 para los dos: \(1.96 × sqrt{2 × 0.86 × 0.14 ÷ 150}\) ≈ 0.068, o sea **≈ 7 puntos**. Conclusión: el examen de 200 preguntas descarta a los que fallan y encuentra diferencias grandes; entre dos que están a 3 puntos, deciden la velocidad, la memoria o una comparación pregunta por pregunta.
? [reto] El despacho quiere subir el tope a 32,768 tokens por conversación, con las mismas 8 conversaciones. ¿Cuánto KV cache necesitaría con Qwen3 32B (256 KiB por token) y con Qwen3.6 27B (64 KiB por token en sus bloques de atención completa)? ¿Cuál cabe en 43.2 GB?
Tokens a la vez: 8 × 32,768 = 262,144. Qwen3 32B: 262,144 × 262,144 bytes ≈ **68.7 GB** de KV; con 19.32 de pesos y 2 de programa son ≈ 90 GB: **no cabe**, ni de lejos. Qwen3.6 27B: 262,144 × 65,536 bytes ≈ **17.2 GB**, lo mismo que hoy ocupa Qwen3 32B con 8,192; con ≈ 14.4 GB de pesos (más sus tablas) y 2 de programa son ≈ 34 GB más el estado fijo de sus bloques lineales: **cabría**, a confirmar arrancando el servidor. La arquitectura nueva cambia qué contexto puedes dar con la misma GPU.
? [reto] Explica con números por qué Mistral Small 4 (119.4 mil millones totales, 6.5 activos) sale del embudo del despacho aunque «trabaje como uno chico».
Memoria: en 4 bits sus pesos son ≈ 119.4 × 4.156 ÷ 8 ≈ **62.0 GB**, más que los 43.2 GB útiles de la L40S, antes de contar un solo byte de KV cache o de programa. Sale en el filtro 2. Sus 6.5 mil millones activos sí lo harían rápido por token, pero la memoria se paga con los totales: ninguna velocidad compensa un modelo que no arranca.
:::

## Lo que sigue {What comes next}

- **«Open weight, open source y licencias»**, en este mismo módulo: el filtro 1 a fondo, cómo leer Apache 2.0, MIT, la licencia de Llama y las marcadas «other».
- **«Batching continuo y PagedAttention»** y **«Concurrencia: la curva de usuarios contra latencia»**: cómo un servidor atiende varias conversaciones con una sola lectura de los pesos, y por qué la memoria dice cuántas caben pero el cálculo dice cuántas se atienden bien.
- **«Formatos de cuantización en la práctica»**: qué se pierde de calidad al pasar de BF16 a los 4 bits con que se examinó cada candidato.
- **«Demostrar que el modelo abierto sirve»**, en el módulo de evals: cómo se arma, se califica y se mantiene el examen propio de 200 preguntas.
- En Sensei, [Transformers y LLMs](https://sensei.trueml.app/llms/) para el porqué del KV cache y de los expertos, y [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/) para la prueba pareada y el diseño de una comparación.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
familia-de-modelos modelo-base modelo-instruct modelo-razonamiento modelo-denso parametros-activos benchmark error-estandar contaminacion saturacion leaderboard destilacion
:::

## Chequeo {Check}

:::chequeo
? ¿Qué cuatro filtros duros aplica el despacho antes de mirar un benchmark?
Licencia comercial, que por memoria quepa en una L40S con 8 conversaciones de 8,192 tokens, español y contexto de al menos 8,192 tokens. Lo que no pasa uno sale sin examen. (Caber no es atender bien: la velocidad se cuenta aparte.)
? En «Qwen3-30B-A3B», ¿qué número decide la memoria y cuál el trabajo por token?
30B, los parámetros totales, decide la memoria. A3B, los ≈ 3.3 mil millones activos, decide el trabajo por token.
? ¿Por qué un modelo que piensa 1,500 tokens le cuesta al despacho 77 s de espera?
Porque los tokens pensados se escriben a la misma velocidad que la respuesta: 2 s + 1,500 ÷ 20 tokens/s = 77 s antes de la primera palabra de la respuesta.
? Dos modelos sacan 86 % y 84 % en un examen de 200 preguntas. ¿Cuál es mejor?
No se sabe. El ruido de la diferencia es de ±7 puntos; 2 puntos pueden ser pura suerte.
? ¿Qué es la contaminación de un benchmark y cómo se detecta?
Que sus preguntas (o versiones parafraseadas) estaban en el entrenamiento. Se detecta con un examen nuevo del mismo estilo: si el modelo cae mucho, había memorizado.
? ¿Por qué el despacho no cambia Qwen3 32B por Qwen3.6 27B solo por su tabla?
Porque esa tabla mide otras tareas, con el razonamiento encendido, auto-reportada y en otra tabla que la de Qwen3 32B. Los mide a los dos en su propio examen, con la configuración con que los serviría.
:::
