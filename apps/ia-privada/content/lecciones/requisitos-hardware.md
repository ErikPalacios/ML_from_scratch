---
titulo: De requisitos a hardware
en: From requirements to hardware
subtitulo: El método completo, de punta a punta, para convertir «somos 200 y queremos que sea rápido» en un número de GPUs que se puede defender: preguntas que dan números, perfil de carga, presupuesto de latencia, los tres techos de una GPU, holgura, N+1, crecimiento y la cola que casi nadie cuenta.
pregunta: El cliente dice «somos 200 y queremos que sea rápido». ¿Cómo se vuelve eso, paso a paso, en «3 L40S» o «2 RTX PRO 6000», y cómo se defiende ese número ante el cliente?
sensei: percentiles, unidades
---

:::idea
Dimensionar no es adivinar una GPU: es una receta de siete pasos que cualquiera puede repetir y revisar. Las palabras del cliente se vuelven números (personas, preguntas, tokens, segundos); los números se vuelven una carga por segundo; la carga se compara con lo que aguanta **una** GPU, que es el menor de tres techos (memoria, ancho de banda y cómputo); y de ahí salen las GPUs, con holgura, con una de repuesto y con espacio para crecer. El paso que casi todos se saltan es la **cola**: el tiempo al primer token que da una cuenta con la GPU libre no es el que siente la persona número 95 de cada 100 en la hora pico.
:::

## «Somos 200 y queremos que sea rápido» {“We are 200 and we want it fast”}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus 30,000 expedientes con un LLM sin que un solo documento salga de su red. Lo usarían **200 personas**, cada una haría ≈ **15 preguntas al día** entre las 9:00 y las 19:00, y en la hora más cargada llega **2.5 veces** el promedio. Cada pregunta lleva ≈ **6,000 tokens** de entrada (instrucciones, la pregunta y cinco fragmentos de expediente) y la respuesta, ≈ **500**. Quieren el primer token en **2 s o menos en el p95** y al menos **20 tokens por segundo** por persona. El modelo candidato es **Qwen3 32B en INT4 de [[awq|AWQ]]**, con el razonamiento apagado. Todos esos números son supuestos del ejemplo; viven en una sola ficha y se usan tal cual.

En la primera reunión nadie dice esas cifras: el socio director dice «somos 200 y queremos que sea rápido». Esta lección es el camino de esa frase a una cotización, y abre por dentro la [herramienta de sizing](/herramientas/sizing/): al final vas a reproducir su resultado, **3 L40S**, y explicar cada número.

### Lo que el sistema hace y cómo lo hace

Los requisitos **funcionales** dicen *qué* hace el sistema: «contesta sobre los expedientes y cita el documento y la página». Los [[requisito-no-funcional|no funcionales]] (*non-functional requirements*) dicen *qué tan bien*: qué tan rápido, para cuántos, cuántas horas, cuánto puede fallar. «Somos 200 y queremos que sea rápido» son dos no funcionales en lenguaje de sobremesa.

El hardware sale casi entero de los no funcionales: el mismo «contesta con cita» cabe en una laptop si lo usa una persona a la semana, y pide un [[servidor-gpu|servidor de rack]] si lo usan 200 en su hora pico. Y sin número no sirven: «rápido» no se puede comprar.

:::analogia El ingeniero civil y el puente
Un puente no se diseña con «que pase mucha gente». Se diseña con cuántos vehículos por hora, de qué peso, en la hora pico, con un viento máximo, y luego se multiplica por un factor de seguridad. Dimensionar un servidor de LLMs es lo mismo: la carga en números, la capacidad de cada pieza, y un margen.

Dónde se rompe: el puente se calcula con leyes físicas que no cambian. Aquí las «leyes» son modelos aproximados (eficiencias supuestas, colas simplificadas), y por eso el último paso no es firmar el cálculo sino **medirlo** en un piloto.
:::

### La receta en siete pasos

:::pasos
1. Preguntas que dan números
Personas, preguntas al día, horario, hora pico y tokens por tarea: la etapa de [[descubrimiento]], con cada respuesta en número o en supuesto escrito.

2. Perfil de carga
Lo que llega al servidor por segundo en la hora pico: preguntas, tokens de entrada y de salida, conversaciones a la vez.

3. Presupuesto de latencia
El «rápido» en milisegundos: cuánto se come la red, la búsqueda, la fila y el prefill.

4. Los tres techos de una GPU
Cuánto aguanta una GPU por memoria, por ancho de banda y por cómputo, por separado.

5. La capacidad por GPU y el cuello de botella
Los techos bien mezclados dan lo que aguanta la GPU; el que manda es el que hay que atacar.

6. Cuántas GPUs: holgura, N+1 y crecimiento
La carga entre la capacidad, hacia arriba, con margen, con repuesto y con un plan a 12 y 24 meses.

7. Candidatos de hardware
Los pasos 4 a 6 con cada GPU candidata, lado a lado.
:::

:::diagrama requisitos-hardware-receta
Toca cada paso para ver qué entra y qué sale, o usa «Recorrer» para seguir al despacho de la frase del socio a la cotización.
:::

Fíjate en la flecha que regresa del piloto: los números de los pasos 1 a 3 y las eficiencias del paso 4 son supuestos hasta que se miden. Una buena estimación dice cuáles son, para que el piloto los mida.

## Paso 1: preguntas que dan números {Step 1: questions that yield numbers}

La hoja de [[descubrimiento]] del [recorrido](/recorrido/) (tareas, usuarios, volumen, datos, idioma, latencia, restricciones) aquí se afila: **cada pregunta tiene que terminar en un número con su unidad**, o en un supuesto escrito que el cliente acepta.

| Lo que dice el cliente | La pregunta que da el número | El despacho |
|---|---|---|
| «Somos 200» | ¿Cuántas personas tendrán acceso? ¿Cuántas lo usarán de verdad cada día? | \(U\) = 200 |
| «Lo vamos a usar mucho» | ¿Cuántas veces al día pregunta alguien que lo usa? Dame tres preguntas de la semana pasada. | \(r\) = 15 preguntas por persona |
| «En horario de oficina» | ¿De qué hora a qué hora? ¿Hay turnos, fines de semana? | \(H\) = 10 horas |
| «Todos llegan a las 10» | ¿A qué hora se junta más gente? ¿Cuánto más que en una hora normal? | \(k_{pico}\) = 2.5 |
| «Preguntas sobre expedientes» | ¿Qué tareas, en qué proporción? ¿Cuánto texto lleva cada una y cuánto contesta? | 6,000 tokens de entrada, 500 de salida |
| «Que sea rápido» | ¿Cuánto puede esperar la primera palabra? ¿Qué tan rápido debe escribir? ¿Para cuántas de cada 100 preguntas? | TTFT ≤ 2 s en el p95; ≥ 20 tokens/s |

La última fila es la que más se negocia. «Rápido» se vuelve dos números: el [[ttft|TTFT]] (*time to first token*, lo que tarda la primera palabra) y la velocidad al escribir, cada uno con un **percentil**: «≤ 2 s en el p95» es que 95 de cada 100 preguntas ven su primera palabra en 2 s o menos ([Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/)). Se fija **antes** de calcular: es contra lo que se mide al final.

### Ninguna fuente te da «15 preguntas al día»

**No existe una medición pública confiable de cuántas preguntas al día le hace una persona a un asistente interno de su empresa.** Los reportes de uso de Microsoft y OpenAI (2025–2026) hablan de millones de usuarios y de adopción, no de mensajes por persona por día. El 15 y el factor de pico de 2.5 del despacho son **supuestos del ejemplo**, igual que el rango de 2 a 3 que sugiere la herramienta para el pico. Se hacen tres cosas:

- **Preguntarle al cliente con ejemplos.** «¿Cuántas veces buscaste algo en un expediente ayer?» da un orden de magnitud mejor que cualquier promedio de internet.
- **Calcular con tres valores.** Con 8, 15 y 30 preguntas por persona, el despacho pide 2, 3 y 6 L40S. Si el número de GPUs casi no cambia, el supuesto no importa; si se triplica, hay que medirlo antes de comprar.
- **Medir en la [[prueba-piloto|prueba piloto]]** (8 semanas con 20 abogados): de ahí salen el \(r\) y el \(k_{pico}\) reales.

### De páginas a tokens: la [[mezcla-de-tareas|mezcla de tareas]]

El despacho pidió tres tareas: preguntar sobre los expedientes (con cita), resumir un expediente y encontrar cláusulas parecidas. Cada una pesa distinto en la GPU, y la [[mezcla-de-tareas|mezcla]] (*task mix*: qué fracción del tráfico es cada tarea) cambia el resultado.

Para saber cuánto pesa una tarea hay que pasar de páginas a tokens. Una página a espacio sencillo tiene ≈ 500 palabras, y en español cada palabra son ≈ 1.6 tokens: un expediente de 50 páginas son ≈ **40,000 tokens**, y el prompt de 6,000 tokens de una pregunta son ≈ 7.5 páginas. De dónde salen esas cifras, en el recuadro.

:::profundo De páginas a tokens, con su fuente
Un artículo de octubre de 2025 («Beyond Fertility», en arXiv) midió cuántos tokens hace cada palabra (la *fertilidad* del tokenizador) en noticias: con el tokenizador de Qwen2.5-72B, **1.61 en español formal** y 1.25 en inglés. Nadie publicó la cifra con Qwen3 (su vocabulario es casi idéntico) ni con texto jurídico: es aproximada, y se mide con el tokenizador real. Lo firme: **en español el mismo texto cuesta ≈ 20–30 % más tokens que en inglés.**

:::formula De páginas a tokens
N = p × w × f
- p: las páginas del documento
- w: las palabras por página (≈ 500 a espacio sencillo, ≈ 250 a doble espacio)
- f: los tokens por palabra del tokenizador en ese idioma (≈ 1.61 en español formal, con Qwen2.5)
- N: los tokens que ocupa el documento
:::

:::cuenta Un expediente del despacho y un prompt de pregunta
Un expediente, \(N\) // \(p\) = 50 páginas de la ficha, \(w\) = 500, \(f\) = 1.61 | 50 × 500 × 1.61 | **40,250 tokens**
El prompt de una pregunta, en palabras // 6,000 tokens de la ficha ÷ \(f\) | 6,000 ÷ 1.61 | ≈ 3,727 palabras
En páginas // ÷ \(w\) = 500 | 3,727 ÷ 500 | ≈ 7.5 páginas
= Una pregunta normal le pasa al modelo unas 7 páginas y media. Resumir un expediente entero son 50: más de seis veces el prompt, y cinco veces el tope de contexto de 8,192 tokens que el despacho fijó por conversación.
:::
:::

Las tres tareas, lado a lado. Los 6,000 y 200 tokens de «buscar cláusulas» y los 700 de salida de un resumen son supuestos; no están en la ficha.

| Tarea | Tokens de entrada | Tokens de salida | Prefill en una L40S | KV cache |
|---|---|---|---|---|
| Preguntar (con cita) | 6,000 | 500 | ≈ 2.4 s | 1.70 GB |
| Buscar cláusulas (supuesto) | 6,000 | 200 | ≈ 2.4 s | 1.63 GB |
| Resumir un expediente (supuesto de salida) | 40,250 | 700 | ≈ 24 s | 10.73 GB |

Un resumen ocupa la GPU en su [[prefill|prefill]] lo que diez preguntas, y su [[kv-cache|KV cache]] lo de cinco conversaciones del tope. Por eso la primera decisión es **cuáles tareas entran en el sizing de la hora pico**. El despacho empieza por preguntar, y la herramienta dimensiona solo esa; los resúmenes, que nadie mira mientras se escriben, pueden ir a una fila de baja prioridad o a la noche.

## Pasos 2 y 3: el perfil de carga y el presupuesto de latencia {Steps 2 and 3: the load profile and the latency budget}

Las respuestas del cliente se vuelven lo que la GPU tendrá que hacer: cuánto le llega por segundo (el perfil) y en cuánto tiempo contesta (el presupuesto).

### Paso 2: el perfil de carga

El [[perfil-de-carga|perfil de carga]] (*load profile*) es lo que llega al servidor, en números: preguntas por segundo, tokens de entrada y de salida, y conversaciones abiertas a la vez. Antes del perfil se habla de personas; después, de tokens y segundos.

Sus piezas ya las conoces: el [[factor-de-pico|factor de pico]] (se dimensiona para la hora más cargada, porque lo que aguanta el promedio se cae todos los días a las 10), la [[ley-de-little|ley de Little]] (lo que hay adentro es lo que llega por segundo por lo que dura cada uno; a fondo en [concurrencia](/concurrencia/)) y el paso de eventos al día a eventos por segundo de [Números grandes, unidades y estimaciones](https://sensei.trueml.app/unidades/). Lo nuevo es juntarlas y agregarles los tokens.

:::formula El perfil de carga en la hora pico
λ = frac{U × r}{H × 3,600} × k_{pico}
T_{ent} = λ × N_p
T_{sal} = λ × N_o
c = λ × (t_{pre} + frac{N_o}{v})
- U: las personas que usan el sistema
- r: las preguntas por persona al día
- H: las horas del día con tráfico (× 3,600 s por hora)
- k_{pico}: la hora más cargada ÷ la hora promedio
- λ: las preguntas por segundo en la hora pico
- N_p, N_o: los tokens de entrada (prompt) y de salida (respuesta) de cada pregunta
- T_{ent}, T_{sal}: los tokens por segundo que el servidor lee y escribe en el pico
- t_{pre}: el prefill de una pregunta, en s (sale del paso 4; aquí, el de la L40S)
- v: la velocidad objetivo de cada conversación, en tokens por segundo
- c: las conversaciones abiertas a la vez, en promedio, en el pico
:::

:::cuenta El perfil del despacho
Preguntas al día // \(U\) = 200, \(r\) = 15 | 200 × 15 | 3,000
Por segundo, en promedio // \(H\) = 10 h | 3,000 ÷ (10 × 3,600) | 0.0833
En la hora pico, \(λ\) // \(k_{pico}\) = 2.5: 750 preguntas en esa hora | 0.0833 × 2.5 | **0.208 por segundo**
Tokens de entrada, \(T_{ent}\) // \(N_p\) = 6,000 | 0.208 × 6,000 | **1,250 tokens/s**
Tokens de salida, \(T_{sal}\) // \(N_o\) = 500 | 0.208 × 500 | **≈ 104 tokens/s**
Lo que dura cada conversación // \(t_{pre}\) = 2.38 s en una L40S, \(N_o ÷ v\) = 500 ÷ 20 | 2.38 + 25 | 27.38 s
Conversaciones a la vez, \(c\) | 0.208 × 27.38 | **≈ 5.70**
Tokens al día // para la herramienta de TCO | 3,000 × (6,000 + 500) | 19.5 millones
= Doscientas personas, en su peor hora, son ≈ 5.7 conversaciones abiertas, que leen 1,250 tokens por segundo y escriben ≈ 104.
:::

La ficha del despacho dice 5.6, no 5.70, porque calcula la duración con los 2 s del objetivo en vez de los 2.38 s de la L40S; el número de GPUs sale igual. Y \(c\) depende un poco de la GPU, porque \(t_{pre}\) depende de ella: 5.57 con la RTX PRO 6000 Server Edition.

:::figura requisitos-hardware-embudo
De 200 personas a 5.7 conversaciones a la vez: cada escalón usa un número de la ficha. Abajo, lo que le piden a la GPU en tokens por segundo.
:::

Lo más importante del perfil es la proporción entre entrada y salida. El despacho usa RAG (*retrieval-augmented generation*: buscar fragmentos de sus expedientes y pasárselos al modelo con la pregunta; tema de una lección posterior), y por eso lee **doce veces** lo que escribe. Leer es [[prefill|prefill]] y depende del cómputo; escribir es [[decode|decode]] y depende del ancho de banda: el problema va a estar en el prefill.

:::calculadora requisitos-hardware-perfil
Arranca con el despacho. Sube la fracción de resúmenes a 0.05: los tokens de entrada suben ≈ 29 % y el prefill medio ≈ 45 % (la atención crece con el cuadrado del prompt), con las mismas peticiones. Luego regresa a 0 y baja el pico a 1: el promedio del día pide menos de la mitad de conversaciones.
:::

:::profundo La mezcla cambia el perfil
La herramienta de sizing dimensiona una sola tarea. Si el despacho mezclara las tres en la hora pico, el perfil cambia aunque el número de preguntas no. Con una mezcla ilustrativa (un supuesto, no un dato del despacho): 90 % preguntas, 5 % resúmenes y 5 % búsquedas de cláusulas.

:::cuenta El prefill medio con una mezcla de tareas
Preguntas // 90 % × 2.38 s | 0.90 × 2.38 | 2.14 s
Resúmenes de 40,250 tokens // 5 % × ≈ 23.95 s | 0.05 × 23.95 | 1.20 s
Cláusulas // 5 % × 2.38 s | 0.05 × 2.38 | 0.12 s
Prefill medio por pregunta | 2.14 + 1.20 + 0.12 | **≈ 3.46 s**
= Un 5 % de resúmenes sube el prefill medio ≈ 45 %. Y además no caben: con el tope de 8,192 tokens por conversación, un resumen de 40,250 tokens ni siquiera entra al servidor configurado para preguntar.
:::

La conclusión: el perfil se escribe **por tarea**, y las de lote (resúmenes, extracción masiva) se separan de las interactivas. Las interactivas se dimensionan por latencia; las de lote, por throughput y por su ventana de tiempo, como la financiera del final.
:::

### Paso 3: el presupuesto de latencia

«TTFT ≤ 2 s» no es un número del modelo: es de **todo el camino** hasta que aparece la primera palabra en la pantalla. La documentación de métricas de NVIDIA NIM lo dice explícito: el TTFT incluye la cola, el prefill y la red. Con RAG hay una pieza más: buscar los cinco fragmentos antes de mandarle nada al modelo. [Latencia y throughput](https://sensei.trueml.app/latencia/) reparte así la latencia de punta a punta; aquí se hace con los tramos de un LLM.

El [[presupuesto-de-latencia|presupuesto de latencia]] (*latency budget*) es repartir esos 2 s entre las piezas del camino, como el dinero de un viaje: tanto para el avión, tanto para el hotel, y lo que sobra. Si lo comprometido ya pasa del total, no hay GPU que lo arregle: hay que cambiar el objetivo o el camino.

:::formula El tiempo al primer token que siente la persona
TTFT = t_{red} + t_{rec} + t_{cola} + t_{pre}
t_{cola} + t_{pre} ≤ TTFT_{obj} − t_{red} − t_{rec}
- t_{red}: la red y el [[gateway-de-llm|gateway]] (el programa que va delante de las GPUs: revisa quién pregunta y a qué GPU manda la pregunta), ida y vuelta, en s
- t_{rec}: la recuperación (*retrieval*): buscar los fragmentos que se parecen a la pregunta, en s
- t_{cola}: lo que la pregunta espera a que una GPU se desocupe para leerla, en s
- t_{pre}: el prefill de la pregunta con la GPU libre, en s
- TTFT_{obj}: el objetivo, 2 s en el p95 en el despacho
:::

:::cuenta El presupuesto del despacho
Objetivo, \(TTFT_{obj}\) // la ficha: p95 | dato | 2,000 ms
Red y gateway, \(t_{red}\) // supuesto: red local de oficina, ida y vuelta | supuesto | ≈ 20 ms
Búsqueda de fragmentos, \(t_{rec}\) // supuesto: se mide en la lección de RAG | supuesto | ≈ 150 ms
Lo que queda para la fila y el prefill | 2,000 − 20 − 150 | **1,830 ms**
Prefill en una L40S, \(t_{pre}\) // la herramienta de sizing | dato | 2,380 ms
Con la L40S, para la fila | 1,830 − 2,380 | **−550 ms**
Prefill en una RTX PRO 6000 Server Edition // con ≈ 500 TFLOPS densos, derivado | 4.31 × 10¹⁴ ÷ (0.5 × 500 × 10¹²) | ≈ 1,724 ms
Con la Server Edition, para la fila | 1,830 − 1,724 | **≈ 106 ms**
= Con la L40S el presupuesto está roto antes de que exista la fila. Con la Server Edition cabe, pero le deja a la fila una décima de segundo en el p95: cualquier espera se lo come.
:::

Los 20 ms y los 150 ms **son supuestos de esta lección**, no datos de la ficha (una red de oficina y una búsqueda local típicas), y se miden en el piloto. Son **décimas** de segundo contra **segundos** de prefill: el presupuesto lo deciden la GPU y el tamaño del prompt.

:::diagrama requisitos-hardware-latencia
El camino de una pregunta del despacho hasta su primera palabra, con lo que cuesta cada tramo. Usa «Recorrer» para sumar el presupuesto tramo por tramo.
:::

**La otra mitad: la velocidad al escribir.** El presupuesto tiene una segunda parte, más fácil: «≥ 20 tokens por segundo» quiere decir que entre un token y el siguiente no pueden pasar más de 1 ÷ 20 = **50 ms**. Ese es el [[tpot|TPOT]] (*time per output token*) del objetivo. Un paso de decode tiene que caber en 50 ms con todas las conversaciones que lleve, y dejar tiempo para los prefills de las que llegan: lo cuida el paso 5.

:::ojo
Los percentiles no se suman ([Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/)): sumar los p95 de cada tramo da una cota **pesimista**. Para un presupuesto está bien (si cabe así, cabe); el número real se mide de punta a punta, como lo siente la persona.
:::

## Paso 4: los tres techos de una GPU {Step 4: the three ceilings of a GPU}

Ahora se cambia de lado: lo que aguanta **una** GPU. Lo aguanta con tres recursos, y cada uno pone su techo. Los viste por partes: la memoria en [¿Cabe en la GPU?](/herramientas/vram/), el ancho de banda y el prefill en [batching](/batching/) y [concurrencia](/concurrencia/). Aquí van lado a lado para dos GPUs: la **L40S** de 48 GB (864 GB/s, 362.05 TFLOPS densos en FP16, del [catálogo](/herramientas/catalogo/)) y la **RTX PRO 6000 Blackwell Server Edition** de 96 GB, la [[tarjeta-pasiva|variante pasiva]] de rack que [Comprar hardware](/comprar-hardware/) propone como alternativa. NVIDIA publica para ella 1,597 GB/s y «1 PFLOP» en FP16 sin decir si cuenta la [[sparsity]] (página consultada en noviembre de 2026); comparada con la Workstation Edition, del mismo chip, el pico denso es ≈ **500 TFLOPS**, un valor derivado. El catálogo trae la Workstation Edition, de torre (1,792 GB/s): no las confundas.

**Techo 1, la memoria: cuántas conversaciones caben.** Lo que queda de la [[vram|VRAM]] después de los [[pesos]] y del programa, entre el [[kv-cache|KV cache]] de una conversación.

**Techo 2, el [[ancho-de-banda|ancho de banda]]: cuántas se escriben a la velocidad prometida.** Cada paso de [[decode|decode]] lee los pesos una vez y el KV cache de cada conversación; con más conversaciones se alarga, y no puede pasar de \(1 ÷ v\).

**Techo 3, el cómputo: cuántas preguntas nuevas se leen por segundo.** El [[prefill|prefill]] de 6,000 tokens lo limita el [[pico-de-calculo|pico de cálculo]]. Cada pregunta ocupa la GPU \(t_{pre}\) segundos leyendo su prompt, así que una GPU no lee más de \(1 ÷ t_{pre}\) preguntas por segundo.

:::formula Los tres techos, por separado
b_{mem} = ⌊ frac{(1 − f) × M − W − M_{prog}}{m × N_{tope}} ⌋
a_0 = frac{W}{η_m × B}
a_1 = frac{m × N_m}{η_m × B}
b_{anch} = ⌊ frac{1 ÷ v − a_0}{a_1} ⌋
t_{pre} = frac{2 × A × N_p + 2 × L × h × d × N_p^2}{η_c × F}
λ_{máx} = frac{1}{t_{pre}}
- M: la VRAM, en GB; f: el margen que deja libre el servidor (0.1); M_{prog}: el programa que sirve el modelo (2 GB)
- W: los pesos, en GB (19.32 en Qwen3 32B en INT4 de [[awq|AWQ]])
- m: los bytes de KV cache por token (256 KiB en Qwen3 32B); N_{tope}: el tope de contexto (8,192)
- b_{mem}: las conversaciones que caben; ⌊ ⌋ redondea hacia abajo
- B: el ancho de banda; η_m: la [[eficiencia|eficiencia]] de memoria (0.7, supuesta)
- a_0: el tiempo fijo de un paso de decode (leer los pesos); a_1: lo que le suma cada conversación (leer su KV cache a media respuesta, \(N_m\) = 6,250 tokens)
- b_{anch}: las conversaciones cuyo paso cabe en \(1 ÷ v\), sin contar prefills
- A: los parámetros que usa cada token (32,762 millones; en un modelo denso, todos)
- L, h, d: los bloques (64), las cabezas de atención (64) y los números por cabeza (128) de Qwen3 32B; el segundo término es la atención, que crece con el cuadrado del prompt
- F: el pico denso en FP16, en FLOPS; η_c: la eficiencia de cálculo (0.5, supuesta)
- t_{pre}: el prefill de una pregunta, en s; λ_{máx}: las preguntas por segundo que la GPU lee si no hiciera nada más
:::

El pico es el de **FP16** aunque los pesos estén en 4 bits, porque AWQ los convierte a 16 bits para multiplicar. Es la hipótesis de la herramienta, no medida contra los kernels reales; por eso \(η_c\) es un supuesto que el piloto calibra.

:::cuenta Los tres techos de una L40S con el despacho
Útil para KV // 0.9 × 48 GB − 19.32 − 2 | 43.2 − 21.32 | 21.88 GB
Una conversación al tope // \(m × N_{tope}\) = 262,144 × 8,192 | dato | ≈ 2.147 GB
Techo de memoria, \(b_{mem}\) | ⌊21.88 ÷ 2.147⌋ = ⌊10.19⌋ | **10**
Paso fijo, \(a_0\) // \(η_m × B\) = 0.7 × 864 = 604.8 GB/s | 19.32 ÷ 604.8 | 31.95 ms
Por conversación, \(a_1\) // 262,144 × 6,250 ≈ 1.638 GB | 1.638 ÷ 604.8 | 2.709 ms
Techo de ancho de banda, \(b_{anch}\) // \(1 ÷ v\) = 50 ms | ⌊(50 − 31.95) ÷ 2.709⌋ = ⌊6.66⌋ | **6**
FLOPs del prefill // 2 × 32.762 × 10⁹ × 6,000 + 2 × 64 × 64 × 128 × 6,000² | 3.931 × 10¹⁴ + 0.378 × 10¹⁴ | 4.309 × 10¹⁴
Prefill, \(t_{pre}\) // \(η_c × F\) = 0.5 × 362.05 TFLOPS | 4.309 × 10¹⁴ ÷ 181.0 × 10¹² | **2.38 s**
Techo de cómputo, \(λ_{máx}\) | 1 ÷ 2.38 | 0.420 preguntas/s
Lo que el pico le pide a una sola L40S // \(λ\) = 0.208 | 0.208 ÷ 0.420 | **≈ 50 % del tiempo en prefills**
= Por memoria caben 10 (el 8 de la ficha es su número de diseño, no el máximo); por ancho de banda se escriben 6 a 20 tokens por segundo; por cómputo, el pico del despacho tendría a una sola L40S la mitad del tiempo leyendo prompts.
:::

En la RTX PRO 6000 Server Edition salen **30, 22 y ≈ 1.72 s** (la cuenta, en el recuadro). El doble de memoria da el triple de conversaciones (los pesos ya están pagados), y casi el doble de ancho de banda da más del triple a 20 tokens por segundo (el paso fijo se acorta a la mitad). El cómputo, en cambio, solo mejora ≈ 38 %: es el techo que menos se mueve.

:::profundo Los tres techos en la Server Edition, paso a paso
:::cuenta Los mismos tres techos en una RTX PRO 6000 Server Edition
Útil para KV // 0.9 × 96 GB − 19.32 − 2 | 86.4 − 21.32 | 65.08 GB
Techo de memoria, \(b_{mem}\) // 2.147 GB por conversación | ⌊65.08 ÷ 2.147⌋ = ⌊30.3⌋ | **30**
Paso fijo, \(a_0\) // 0.7 × 1,597 = 1,117.9 GB/s | 19.32 ÷ 1,117.9 | 17.28 ms
Por conversación, \(a_1\) | 1.638 ÷ 1,117.9 | 1.466 ms
Techo de ancho de banda, \(b_{anch}\) | ⌊(50 − 17.28) ÷ 1.466⌋ = ⌊22.3⌋ | **22**
Prefill, \(t_{pre}\) // 0.5 × ≈ 500 TFLOPS, derivado | 4.309 × 10¹⁴ ÷ 250 × 10¹² | **≈ 1.72 s**
Lo que el pico le pide a una sola | 0.208 × 1.724 | **≈ 36 % del tiempo en prefills**
= 30, 22 y ≈ 1.72 s, contra 10, 6 y 2.38 s en la L40S.
:::
:::

:::figura requisitos-hardware-techos
Los tres techos de cada GPU con el despacho, en conversaciones. La línea punteada son las ≈ 5.7 conversaciones de la hora pico. La barra de abajo es lo que de verdad aguanta cada GPU cuando el prefill y el decode comparten el tiempo: el paso 5.
:::

:::calculadora requisitos-hardware-techos
Empieza con la L40S y el despacho: 10, 6 y 2, y 3 GPUs. Cambia a la RTX PRO 6000 (la de gpus.json es la Workstation Edition; para la Server Edition elige «Otro» y escribe 1,597 GB/s y 500 TFLOPS). Después prueba la H100 SXM y mira cómo el techo de ancho de banda deja de mandar.
:::

## Paso 5: la capacidad por GPU y el cuello de botella {Step 5: capacity per GPU and the bottleneck}

La [[capacidad-por-gpu|capacidad por GPU]] es cuántas conversaciones a la vez atiende una GPU (o una [[copia-del-servidor|copia del servidor]]) **cumpliendo** la promesa: que quepan y que cada una reciba su velocidad. La regla de siempre es «el menor de los techos»: en la L40S, 10 y 6 dan 6. La herramienta dice **2**. ¿Quién tiene razón?

La herramienta, y el porqué es lo más importante de esta sección. Los techos 2 y 3 **comparten el tiempo** de la misma GPU: mientras la L40S lee el prompt de una pregunta nueva, no escribe para las demás. El techo de 6 supone que el decode tiene la GPU entera, pero cada conversación escribe 500 tokens a 20 por segundo (25 s) y en ese tiempo le cuesta a la GPU 2.38 s de prefill: un 9.5 % extra por conversación, que se le resta al decode.

:::formula Lo que aguanta una GPU cuando prefill y decode comparten el tiempo
v × (a_0 + b × a_1) + b × frac{v × t_{pre}}{N_o} ≤ 1
b_{vel} = ⌊ frac{1 − v × a_0}{v × a_1 + v × t_{pre} ÷ N_o} ⌋
b = min(b_{mem}, b_{vel})
- v × (a_0 + b × a_1): la fracción de cada segundo que se va en los \(v\) pasos de decode con \(b\) conversaciones
- v × t_{pre} ÷ N_o: la fracción de cada segundo que cada conversación cuesta en prefills (llega una nueva cada \(N_o ÷ v\) segundos por lugar)
- b_{vel}: las conversaciones que caben en un segundo de GPU sin pasarse de él
- b: la capacidad por GPU, el menor de los dos
- a_0, a_1, t_{pre}, b_{mem}: como en el paso 4
:::

:::cuenta La capacidad de cada GPU con el despacho
L40S: decode fijo, \(v × a_0\) // 20 × 31.95 ms | dato | 0.639
L40S: decode por conversación, \(v × a_1\) // 20 × 2.709 ms | dato | 0.0542
L40S: prefill por conversación, \(v × t_{pre} ÷ N_o\) // 20 × 2.38 ÷ 500 | dato | 0.0952
L40S: \(b_{vel}\) | ⌊(1 − 0.639) ÷ (0.0542 + 0.0952)⌋ = ⌊2.42⌋ | **2**
Server Edition: \(v × a_0\), \(v × a_1\), prefill // 20 × 17.28 ms; 20 × 1.466 ms; 20 × 1.724 ÷ 500 | dato | 0.346; 0.0293; 0.0690
Server Edition: \(b_{vel}\) | ⌊(1 − 0.346) ÷ (0.0293 + 0.0690)⌋ = ⌊6.66⌋ | **6**
= Una L40S atiende 2 conversaciones del despacho a ≥ 20 tokens por segundo; una Server Edition, 6. Caben 10 y 30: la memoria sobra en las dos.
:::

De cada segundo de la L40S, el **64 %** se va en leer los pesos 20 veces. Queda el 36 %, y cada conversación se come casi 15 % (5.4 de decode y 9.5 de prefill): caben dos. (La herramienta también calcula un techo de cómputo del decode, 9.6 en la L40S, que aquí no manda.)

:::ojo
\(b\) = 2 **no es el tope** que se le pone al motor: es cuántas conversaciones lleva **en promedio** cada L40S a ≥ 20 tokens por segundo, y sirve para contar GPUs. El tope del motor (`--max-num-seqs` en [[vllm|vLLM]]; el comando de [Del laptop al servidor](/stack-serving/) usa 8, el número de diseño) va más alto a propósito: con 2, la tercera pregunta de esa GPU esperaría hasta ≈ 27 s, lo que dura una respuesta. Con 8, en un momento lleno todas escriben un rato más despacio (8 escribiendo, sin prompts nuevos: ≈ 18.6 tokens por segundo) y nadie espera para empezar.
:::

### El cuello de botella

El [[cuello-de-botella|cuello de botella]] (*bottleneck*) es el recurso que se satura primero, como el tubo más angosto ([Latencia y throughput](https://sensei.trueml.app/latencia/) lo explica en una cadena de servicios). Lo nuevo aquí es que **dentro de una sola GPU** hay varios recursos, y el cuello puede ser uno de ellos o el tiempo que comparten. Nombrarlo dice **qué palanca mover**: si agrandas el cuello, la capacidad sube; si agrandas otro recurso, no pasa nada.

En el despacho con la L40S, el cuello es el **tiempo de la GPU**, repartido entre leer los pesos (ancho de banda) y leer prompts (cómputo). La memoria no: le sobran 8 lugares. Eso descarta ideas que suenan bien:

- **Comprar la misma GPU con más memoria no sirve.** Una L40S de 96 GB (si existiera) atendería las mismas 2.
- **Bajar el KV cache a FP8 ayuda poco.** Duplica el techo de memoria, que no manda, y recorta \(a_1\) a la mitad, que es solo un tercio del costo por conversación.
- **Lo que mueve el cuello:** más ancho de banda (baja \(a_0\)), más cómputo (baja \(t_{pre}\)) o menos tokens de entrada (baja \(t_{pre}\) y \(a_1\)). Con 3 fragmentos en vez de 5, el prompt baja a ≈ 3,500 tokens y la L40S pasa de 2 a 4 conversaciones.

:::analogia La cocina con un solo horno
Una cocina tiene refrigerador grande (la memoria), un pasillo para traer ingredientes (el ancho de banda) y un horno (el cómputo). Si el pasillo y el horno los usa **el mismo cocinero**, el que se acaba primero no es ni el pasillo ni el horno: es el tiempo del cocinero. Un refrigerador más grande no cocina más platillos.

Dónde se rompe: en una GPU de verdad el prefill y el decode sí van juntos en el mismo paso (el [[chunked-prefill|chunked prefill]] mezcla trozos de prompt con tokens de decode). Pero el trabajo total es el mismo, y la cuenta que reparte el tiempo da el orden correcto.
:::

## Pasos 6 y 7: cuántas GPUs y de cuál {Steps 6 and 7: how many GPUs, and which}

Con la carga (\(c\)) y la capacidad por GPU (\(b\)), lo primero es dividir y redondear hacia arriba: no existen 2.85 GPUs. Eso da el **mínimo**. Un sizing que se queda en el mínimo se cae el primer martes con más trabajo, el primer día que una tarjeta falla o el primer año que el despacho contrata gente. Tres ajustes lo vuelven un plan (paso 6), y luego se repite todo con cada GPU candidata (paso 7).

### Holgura: no llenar al 100 %

La [[holgura|holgura]] (*headroom*) es la capacidad que se deja sin usar a propósito, y se mide como capacidad ÷ demanda. [Latencia y throughput](https://sensei.trueml.app/latencia/) explica qué paga (el p99 lejos del codo, la caída de una [[replica|réplica]], el error de la medición) y da su regla práctica para un servicio en línea: planear a ≈ 50–70 % de la capacidad medida. No hay un porcentaje oficial; los libros de SRE de Google piden reservar capacidad para sobrecargas y redundancia sin dar un número. Aquí se usa una **utilización máxima** \(u_{máx}\) de 70 % en la hora pico, un supuesto en el borde menos exigente de esa regla. Con un LLM hay una razón más para no apretarla: \(b\) está **calculada** con eficiencias supuestas, no medida.

### N+1: que una falla no tumbe el servicio

[[n-mas-1|N+1]] quiere decir: si para el pico hacen falta \(N\) GPUs, se tienen \(N + 1\), de modo que **si una falla, las demás todavía aguantan el pico**. Es la forma concreta de la [[redundancia]]. Los mismos libros de Google la tratan como un nivel que se elige por servicio (algunos piden N+2), distinto de un par activo y pasivo (1 + 1), donde una máquina espera sin hacer nada.

:::formula Del mínimo al plan
k_{mín} = ⌈ frac{c}{b} ⌉
k_{holg} = ⌈ frac{c}{b × u_{máx}} ⌉
k_{N+1} = k_{mín} + 1
H = frac{k × b}{c}
- c: las conversaciones a la vez en el pico (paso 2); b: la capacidad por GPU (paso 5)
- ⌈ ⌉: redondear hacia arriba
- u_{máx}: la utilización máxima aceptada en el pico (0.7 = 70 %, supuesto)
- k_{mín}, k_{holg}, k_{N+1}: las GPUs sin margen, con holgura y con una de repuesto
- H: la holgura de un plan con \(k\) GPUs, en veces (1 = justo; 1.4 = 40 % de sobra)
:::

:::cuenta El despacho: mínimo, holgura y N+1
L40S, mínimo, \(k_{mín}\) // \(c\) = 5.70, \(b\) = 2 | ⌈5.70 ÷ 2⌉ = ⌈2.85⌉ | **3**
Holgura de 3 L40S, \(H\) | 3 × 2 ÷ 5.70 | **1.05×**
Si una de las 3 falla // quedan 2 × 2 = 4 lugares | 4 < 5.70 | no aguanta el pico
L40S con \(u_{máx}\) = 0.7, \(k_{holg}\) | ⌈5.70 ÷ (2 × 0.7)⌉ = ⌈4.07⌉ | 5
L40S con N+1, \(k_{N+1}\) // si una falla, quedan 3 × 2 = 6 ≥ 5.70 | 3 + 1 | **4**
Las 8 de diseño de la ficha a ≥ 20 tokens/s | ⌈8 ÷ 2⌉ | 4
Server Edition, mínimo // \(c\) = 5.57, \(b\) = 6 | ⌈5.57 ÷ 6⌉ = ⌈0.93⌉ | **1**, con \(H\) = 1.08×
Server Edition con \(u_{máx}\) = 0.7, \(k_{holg}\) | ⌈5.57 ÷ (6 × 0.7)⌉ = ⌈1.33⌉ | 2
Server Edition con N+1 | 1 + 1 | **2**, con \(H\) = 12 ÷ 5.57 ≈ 2.15×
Las 8 de diseño en Server Edition | ⌈8 ÷ 6⌉ | 2
= Las 3 L40S de la herramienta cubren el promedio del pico con 5 % de sobra. Con repuesto o para las 8 de diseño, son 4; con la holgura de la regla práctica, 5. Con la Server Edition, 2 tarjetas dan a la vez el repuesto, la holgura y las 8 de diseño.
:::

No contradice a la herramienta: ella da el mínimo, **3 L40S**, y avisa que no suma repuesto ni crecimiento. Un matiz con la Server Edition: con 2, si una falla, la otra atiende el promedio (6 ≥ 5.57) pero no las 8 de diseño. N+1 protege el promedio, no el peor momento.

### Crecimiento y el plan de capacidad

El [[plan-de-capacidad|plan de capacidad]] (*capacity plan*) es la tabla de cuántas GPUs hacen falta en cada fecha según crezca la carga, y **cuándo** pedir la siguiente. Los libros de SRE de Google piden pronosticar el [[crecimiento]] **orgánico** (más gente, más preguntas por persona) y el **inorgánico** (un lanzamiento, una fusión, una tarea nueva como los resúmenes), más lejos que el [[tiempo-de-entrega|tiempo de entrega]]: si una GPU tarda tres meses en llegar, se pide tres meses antes.

:::profundo Los escenarios de crecimiento del despacho
¿Cuánto crecerá el despacho? Nadie lo sabe, y ninguna fuente da un «% al año» que sirva. Se calculan escenarios (supuestos) y se ve cuándo cada uno obliga a comprar:

| Escenario del tráfico | \(c\) | L40S mínimo | L40S con N+1 | Server Edition mínimo | Server Edition con N+1 |
|---|---|---|---|---|---|
| Hoy | 5.7 | 3 | 4 | 1 | 2 |
| +25 % (por ejemplo, a 12 meses) | 7.1 | 4 | 5 | 2 | 3 |
| +50 % | 8.6 | 5 | 6 | 2 | 3 |
| El doble (por ejemplo, a 24 meses) | 11.4 | 6 | 7 | 2 | 3 |

Con L40S, cada 25 % de crecimiento es casi una GPU más, y al doble ya no caben en un servidor de 4 ranuras. Con la Server Edition, la segunda tarjeta aguanta hasta el doble (12 lugares contra 11.4).
:::

En la práctica, el servidor de hoy se compra con **ranuras, fuente y enfriamiento** para el escenario de 24 meses, aunque las tarjetas lleguen después ([Comprar hardware](/comprar-hardware/) y [El cuarto](/el-cuarto/)).

### Paso 7: los candidatos de hardware

El último paso repite los pasos 4 a 6 con cada GPU candidata. Las especificaciones viven en el [catálogo](/herramientas/catalogo/), con su fuente y su fecha; aquí van los resultados con el despacho, con las fórmulas de la herramienta y las mismas eficiencias.

| GPU | Prefill, \(t_{pre}\) | Techo de memoria (8,192) | Techo de ancho de banda | Capacidad, \(b\) | GPUs para 5.7 | Para las 8 de diseño | Con N+1 (5.7) |
|---|---|---|---|---|---|---|---|
| L40S | 2.38 s | 10 | 6 | 2 | 3 | 4 | 4 |
| RTX PRO 6000 Server Edition (cómputo derivado) | 1.72 s | 30 | 22 | 6 | 1 | 2 | 2 |
| RTX PRO 6000 Workstation Edition | 1.71 s | 30 | 26 | 7 | 1 | 2 | 2 |
| H100 PCIe | 1.14 s | 23 | 30 | 10 | 1 | 1 | 2 |
| H100 SXM | 0.87 s | 23 | 59 | 17 | 1 | 1 | 2 |

Cómo leerla:

- **El prefill ordena la tabla.** El TTFT sin fila va de 2.38 s a 0.87 s y decide si la promesa de 2 s es posible: las H100 con holgura, las RTX PRO 6000 justas.
- **La capacidad crece más que el ancho de banda.** La H100 SXM tiene ≈ 3.9 veces el de la L40S y atiende 8.5 veces más, porque el paso fijo \(a_0\) se encoge.
- **Por capacidad, a todas les sobra salvo a la L40S.** Una sola H100 o RTX PRO 6000 atiende el promedio del pico y la segunda es el repuesto (el TTFT con fila, en la sección siguiente). La pregunta pasa a ser «cuál cuesta menos por la promesa», la de [Comprar hardware](/comprar-hardware/) y la [herramienta de TCO](/herramientas/tco/).

La decisión del despacho, que esta lección no cambia: **cotizar dos opciones**, 3 L40S (el sizing de la ficha; 4 con repuesto) y 2 RTX PRO 6000 Server Edition, y que el piloto decida con mediciones. La decisión final va en el caso del despacho.

:::profundo El método completo, en Python
Los siete pasos para el despacho y las dos GPUs, en un programa que puedes correr. Las eficiencias, el programa de 2 GB y el margen de 10 % son los de la herramienta.

```python
from math import ceil, floor
# 1-2) Perfil de carga del despacho (la ficha)
U, r, H, pico = 200, 15, 10, 2.5          # personas, preguntas/día, horas, factor de pico
Np, No, v, ctx = 6000, 500, 20, 8192      # tokens de entrada, de salida, tokens/s, tope
lam = U * r / (H * 3600) * pico           # preguntas por segundo en la hora pico
# Qwen3 32B en INT4 de AWQ: bytes de pesos, parámetros, bytes de KV por token
W, P, kv = 19.32e9, 32.762e9, 262144
F_pre = 2 * P * Np + 2 * 64 * 64 * 128 * Np**2   # FLOPs del prefill (con la atención)
gpus = {"L40S": (48, 864, 362.05), "PRO 6000 Server": (96, 1597, 500.0)}
for nombre, (M, BW, F16) in gpus.items():
    t_pre = F_pre / (0.5 * F16 * 1e12)          # 4) techo de cómputo: el prefill
    a0 = W / (0.7 * BW * 1e9)                   # paso de decode: leer los pesos
    a1 = kv * (Np + No / 2) / (0.7 * BW * 1e9)  # y el KV de cada conversación
    mem = floor((0.9 * M * 1e9 - W - 2e9) / (kv * ctx))   # techo de memoria
    bw = floor((1 / v - a0) / a1)                         # techo de ancho de banda
    b = min(mem, floor((1 - a0 * v) / (a1 * v + t_pre * v / No)))  # 5) los mezcla
    c = lam * (t_pre + No / v)                  # Little: conversaciones a la vez
    k = ceil(c / b)                             # 6) copias, sin holgura
    print(f"{nombre}: prefill {t_pre:.2f} s · techos mem {mem}, ancho {bw}, "
          f"mezcla {b} · c = {c:.2f} → {k} GPU(s); con N+1 {k + 1}; "
          f"holgura {k * b / c:.2f}×")
```

```salida
L40S: prefill 2.38 s · techos mem 10, ancho 6, mezcla 2 · c = 5.70 → 3 GPU(s); con N+1 4; holgura 1.05×
PRO 6000 Server: prefill 1.72 s · techos mem 30, ancho 22, mezcla 6 · c = 5.57 → 1 GPU(s); con N+1 2; holgura 1.08×
```

Cambia `r` a 8 o a 30, o `Np` a 3,500, y vuelve a correrlo: es la forma más rápida de saber qué supuesto mueve el resultado.
:::

## La cola: por qué 2.38 s no es el p95 {The queue: why 2.38 s is not the p95}

El despacho ya tiene su número: 3 L40S de mínimo, o 2 Server Edition. Falta la promesa que más le importa al socio: **TTFT ≤ 2 s en el p95**. La herramienta lo avisa en letra chica: su TTFT de 2.38 s (1.72 s en la Server Edition) es **sin fila**, el prefill con la GPU libre.

El objetivo es el p95 en la hora pico, y ahí las preguntas llegan al azar: a veces dos casi juntas a la misma GPU, y la segunda espera el prefill de la primera. Ese [[ttft-con-cola|TTFT con cola]] es el que siente la persona. La lección de [concurrencia](/concurrencia/) ya lo simuló con el prefill de 2.17 s de la cuenta sencilla; aquí va con los 2.38 s de la herramienta, las dos GPUs y una pregunta nueva: ¿importa **cómo** se reparten las preguntas entre las GPUs?

### El p95, con una simulación

El promedio de la espera tiene fórmula (en el recuadro del final: ≈ 0.24 s con 3 L40S), pero la promesa es el p95, y el p95 se simula. Así está hecha la simulación:

- **Las llegadas.** 0.208 preguntas por segundo, al azar: cualquier instante es igual de probable, así que a veces llegan dos casi juntas (las llegadas de Poisson de [concurrencia](/concurrencia/)).
- **La GPU.** Cada una lee un prompt a la vez y tarda siempre lo mismo: 2.38 s la L40S, 1.724 s la Server Edition. Si llega otra pregunta mientras lee, espera su turno. Luego escribe la respuesta (25 s) sin frenar la lectura de prompts: lo único que hace fila es el prefill, y el motor acepta a todas (su tope de conversaciones no se alcanza).
- **El TTFT.** La espera más el prefill, sin red ni búsqueda. De 200,000 preguntas simuladas, ordenadas, el p95 es la del lugar 190,000.
- **Cuatro repartos.** **Al azar**: cada pregunta a una GPU cualquiera, sin mirar nada. **Menos abiertas**: a la GPU con menos peticiones abiertas, la idea de *least outstanding requests* de [Balanceadores, proxies y gateways](https://sensei.trueml.app/balanceo/). **Por turno** (*round-robin*): una a cada GPU, en orden. **Viendo la fila**: a la GPU con menos prompts por leer, es decir, con menos preguntas que todavía no reciben su primer token ([[menos-pendientes|reparto viendo la fila]]).

```python
import random, heapq
lam = 200 * 15 / (10 * 3600) * 2.5        # 0.208 preguntas/s en la hora pico

def p95(prefill, copias, reparto, n=200_000, escribe=25.0):
    rnd, t, turno, ttft = random.Random(7), 0.0, 0, []
    lee = [0.0] * copias                   # cuándo termina cada GPU de leer los prompts que tiene
    abiertas = [[] for _ in range(copias)] # cuándo termina cada respuesta abierta de cada GPU
    for _ in range(n):
        t += rnd.expovariate(lam)                          # llegadas al azar
        for a in abiertas:
            while a and a[0] <= t: heapq.heappop(a)        # quita las que ya terminaron
        if reparto == "al azar": j = rnd.randrange(copias)
        elif reparto == "por turno": j, turno = turno % copias, turno + 1
        elif reparto == "menos abiertas": j = min(range(copias), key=lambda q: len(abiertas[q]))
        else: j = min(range(copias), key=lambda q: lee[q])  # viendo la fila de prompts
        lee[j] = max(t, lee[j]) + prefill                  # espera su turno y lee su prompt
        ttft.append(lee[j] - t)
        heapq.heappush(abiertas[j], lee[j] + escribe)      # luego escribe 25 s
    return sorted(ttft)[int(n * 0.95)]

repartos = ("al azar", "menos abiertas", "por turno", "viendo la fila")
print(" " * 18 + "".join(f"{r:>16}" for r in repartos))
for nombre, prefill, copias in (("3 L40S", 2.38, 3), ("4 L40S", 2.38, 4),
                                ("2 PRO 6000 Server", 1.724, 2)):
    print(f"{nombre:18}" + "".join(f"{p95(prefill, copias, r):>14.2f} s" for r in repartos))
```

```salida
                           al azar  menos abiertas       por turno  viendo la fila
3 L40S                      4.24 s          3.28 s          2.38 s          2.38 s
4 L40S                      3.94 s          2.45 s          2.38 s          2.38 s
2 PRO 6000 Server           3.13 s          2.67 s          1.77 s          1.77 s
```

**Al azar, ninguna opción cumple.** 3 L40S: ≈ 4.2 s, más del doble de la promesa; una cuarta apenas lo baja a ≈ 3.9 s. 2 Server Edition: ≈ 3.1 s. Las GPUs pasan solo 16–18 % del tiempo en prefills, y aun así la mala suerte de las llegadas le pega a 1 de cada 20.

**Lo que importa es qué mira el balanceador.** Por turno o viendo la fila, el p95 de 3 L40S queda en 2.38 s: el prefill solo. Contar las peticiones abiertas ayuda menos (≈ 3.3 s): de las ≈ 2 abiertas de cada GPU, casi siempre todas están escribiendo, que apenas estorba a un prompt nuevo, y el conteo no distingue un prompt a medio leer. Por turno funciona aquí porque las preguntas pesan casi igual y las GPUs son iguales; fuera de eso, no hay garantía. Viendo la fila lo puede hacer un [[gateway-de-llm|gateway]], que ve cuándo sale el primer token. Ojo con lo de fábrica: LiteLLM, el gateway de [esa lección](/gateway/), reparte al azar si no se le dice otra cosa (`simple-shuffle`), y su `least-busy` es «menos abiertas» (su documentación, a noviembre de 2026). Es la palanca más barata, y no es del hardware.

**Con la L40S, el piso es el prefill.** Ningún reparto baja de 2.38 s: con L40S y prompts de 6,000 tokens la promesa no se cumple, como ya dice la ficha del despacho. Con 2 Server Edition bien repartidas, 1.77 s; con los 170 ms supuestos de red y búsqueda, ≈ 1.94 s: en el filo, y en un modelo que deja cosas fuera. Es una razón para cotizarla, no una garantía.

:::figura requisitos-hardware-cola
El TTFT de cada opción contra la promesa de 2 s: sin fila, el p95 repartiendo viendo la fila, el p95 repartiendo al azar y una cota pesimista. Solo quedan bajo la línea las dos barras más bajas de la Server Edition, y la segunda por poco.
:::

:::ojo
Es un modelo simple y deja fuera tres cosas. En [[vllm|vLLM]], con [[batching-continuo|batching continuo]] y [[chunked-prefill|chunked prefill]], el prefill se mezcla con el decode de las demás y tarda un poco más que con la GPU sola. No tiene ráfagas: si en la hora pico llegara el doble, el p95 de 3 L40S subiría a ≈ 5.3 s al azar y a ≈ 2.9 s viendo la fila (simulado). Y todos los prompts miden lo mismo: si varían ≈ 30 %, el p95 sube con cualquier reparto (≈ 3.7 s en 3 L40S viendo la fila). Nada de esto cambia la ficha: 3 L40S sigue siendo el resultado del sizing y la Server Edition, la alternativa por cotizar. El p95 de verdad lo mide la prueba de carga del piloto, tema de la lección «Pruebas de carga y benchmarks honestos».
:::

### Las palancas, de la más barata a la más cara

1. **Repartir bien.** Por turno o viendo la fila, nunca al azar: es configurar el gateway. En el modelo, baja el p95 casi hasta el prefill.
2. **Menos tokens de entrada.** Tres fragmentos en vez de cinco: ≈ 3,500 tokens y ≈ 1.34 s de prefill en la L40S, si el examen de 200 preguntas confirma que las respuestas no empeoran.
3. **Aflojar la promesa.** Un p95 de 3 s quizá baste para una pregunta que antes costaba una hora de buscar: se habla con el cliente.
4. **Más cómputo por GPU.** Baja el piso. Es la cara.
5. **Más GPUs.** Al azar, de 3 a 4 L40S el p95 baja ≈ 0.3 s: la que más se pide y la que menos rinde para el TTFT.

:::profundo Dos fórmulas: la espera promedio y una cota pesimista
Si cada GPU tiene su propia fila, las preguntas le llegan al azar y su prefill dura siempre lo mismo, la espera promedio tiene fórmula cerrada: la de una cola M/D/1 (llegadas al azar, servicio de duración fija, un servidor), que [Latencia y throughput](https://sensei.trueml.app/latencia/) presenta junto a la M/M/1. Con servicio fijo, la espera promedio es la mitad que con servicio al azar.

:::formula La espera promedio en la fila de una GPU
ρ = frac{λ}{k} × t_{pre}
t_{cola} = frac{ρ × t_{pre}}{2 × (1 − ρ)}
TTFT_{medio} = t_{pre} + t_{cola}
- λ: las preguntas por segundo en el pico; k: las GPUs (cada una recibe \(λ ÷ k\), reparto al azar)
- t_{pre}: el prefill, la duración fija del «servicio»
- ρ: la fracción del tiempo de cada GPU que se va en prefills (su ocupación por prefills)
- t_{cola}: la espera promedio en la fila antes de empezar el prefill
- TTFT_{medio}: el TTFT promedio con cola, sin red ni búsqueda
:::

:::cuenta El TTFT promedio con cola en el despacho
3 L40S: ocupación, \(ρ\) // \(λ\) = 0.208, \(t_{pre}\) = 2.38 s | (0.208 ÷ 3) × 2.38 | 0.165
3 L40S: espera, \(t_{cola}\) | 0.165 × 2.38 ÷ (2 × 0.835) | ≈ 0.24 s
3 L40S: \(TTFT_{medio}\) | 2.38 + 0.24 | **≈ 2.62 s**
2 Server Edition: ocupación, \(ρ\) // \(t_{pre}\) = 1.724 s | (0.208 ÷ 2) × 1.724 | 0.180
2 Server Edition: espera, \(t_{cola}\) | 0.180 × 1.724 ÷ (2 × 0.820) | ≈ 0.19 s
2 Server Edition: \(TTFT_{medio}\) | 1.724 + 0.19 | **≈ 1.91 s**
= En promedio, la fila suma ≈ 10 % al TTFT, y el promedio de la Server Edition queda bajo 2 s. Pero la promesa no es el promedio: es el p95.
:::

Para una cota pesimista del p95, se toma la espera de una cola M/M/1 (como si los prefills duraran un tiempo al azar, con distribución exponencial, lo que alarga la fila) y se le suma el prefill fijo. Para la espera de esa cola sí hay fórmula del percentil.

:::formula El p95 del TTFT con la espera de una M/M/1
t_{95} = t_{pre} + frac{ln(ρ ÷ 0.05)}{1 ÷ t_{pre} − λ ÷ k}
- ρ: la ocupación por prefills de cada GPU, como arriba (si es menor que 0.05, la espera del p95 es cero)
- 1 ÷ t_{pre} − λ ÷ k: lo que la GPU atiende por segundo menos lo que le llega
- t_{95}: el TTFT del p95, con la espera de la fila
:::

Con 3 L40S: \(ρ\) = 0.165, y 2.38 + ln(3.31) ÷ (0.420 − 0.069) = 2.38 + 1.196 ÷ 0.351 ≈ **5.8 s**. Con 2 Server Edition, ≈ **4.4 s**. Es pesimista porque los prefills del despacho son casi iguales, no exponenciales. Si los prompts variaran mucho, el p95 al azar quedaría entre la simulación (4.2 s y 3.1 s) y esta cota: por eso se presenta como un rango, no como un número.
:::

## Rehacer y defender el número {Redoing and defending the number} [extra]

Un sizing bien hecho se rehace en minutos, y el cliente siempre cambia algo. Luego hay que defenderlo.

### Si cambian el modelo o los requisitos

Los cambios que el despacho va a preguntar, con las fórmulas de la herramienta:

**Menos fragmentos (3 en vez de 5).** El prompt baja de 6,000 a ≈ 3,500 tokens (≈ 400 de instrucciones, ≈ 100 de pregunta y 3 de ≈ 1,000). El prefill de la L40S baja a **1.34 s**, la capacidad sube de 2 a **4** y bastan **2 L40S** (3 con repuesto). En la simulación, con 2 L40S el p95 del TTFT queda en ≈ 2.3 s al azar y en 1.34 s viendo la fila. Es el cambio que más mueve el resultado, y el que más hay que validar: si las respuestas pierden su cita correcta, no sirve.

**Aflojar el TTFT a 3 s en el p95.** La capacidad no cambia (la herramienta dimensiona por velocidad de escritura), pero la promesa sí se vuelve alcanzable: 3 L40S repartiendo viendo la fila dan ≈ 2.4 s de p95, ≈ 2.55 s con la red y la búsqueda supuestas. Al azar, 4.2 s: no.

**Subir la velocidad a 30 tokens por segundo.** En la L40S, leer los pesos 30 veces ya se come el 96 % de cada segundo: no queda lugar ni para una conversación. La Server Edition atiende 3, y hacen falta 2. Pedir más velocidad de escritura castiga mucho más a las GPUs de poco ancho de banda.

**Qwen3 30B-A3B, un MoE.** Un modelo de mezcla de expertos ([[moe|MoE]]): de sus ≈ 30.5 mil millones de parámetros, cada token usa ≈ 3.3 mil millones (sus [[parametros-activos|parámetros activos]]). En INT4 de [[awq|AWQ]] pesa ≈ 16.8 GB y su prefill en la L40S baja a ≈ 0.3 s. La capacidad por L40S es incierta: ≈ 29 si cada paso lee solo los expertos que usa (lo que supone la herramienta) y ≈ 13 si, con muchas conversaciones, termina leyendo casi todos. Con cualquiera de las dos, la cuenta cabría en una sola L40S. **Eso no quiere decir que al despacho le baste una L40S**: el despacho eligió Qwen3 32B, y con él son 3. Cambiar de modelo no es una decisión de hardware. Primero el modelo nuevo tiene que pasar el examen de 200 preguntas (≥ 85 % bien y con la cita correcta, como pide la ficha); solo entonces se rehace el sizing con él y se mide en el piloto. Cómo se compara, en [Elegir un modelo para la tarea](/elegir-modelo/).

**Llama 3.3 70B.** En [[fp8-dinamico|FP8]] pesa ≈ 72.7 GB: no cabe en una L40S y hacen falta 2 por [[replica|copia]] ([Varias GPUs: tensor y pipeline parallel](/varias-gpus/)). Aun así, leer 72.7 GB por paso con el ancho de banda de las dos tarda ≈ 60 ms, más de los 50 ms de la promesa: **ni una conversación** llega a 20 tokens por segundo. En una Server Edition sola, ≈ 65 ms: tampoco. En INT4 de AWQ (≈ 39.8 GB) sí: **6 L40S** (3 copias de 2), 6 Server Edition (capacidad de 1, por un prefill de ≈ 3.6 s) o **1 H100 SXM**. Las cuentas con 2 GPUs por copia suponen que repartir el modelo no cuesta; con PCIe sí, y la lección de varias GPUs lo mide.

:::nota La regla de bolsillo
Para cada cambio, pregunta qué letra mueve. Tokens de entrada: \(t_{pre}\) y \(a_1\). Velocidad: el \(v × a_0\) fijo. Modelo: \(W\), \(A\) y \(m\). Tráfico: solo \(c\). Las GPUs siguen al techo que se movió.
:::

### Defender el número ante el cliente

Al socio director no se le enseñan fórmulas, sino una página que aguante que la lea su experto de TI, que la comparen con otra cotización y que dentro de un año alguien pregunte «¿por qué compramos esto?». Lleva:

1. **El requisito y el perfil, en números**, y cuáles son supuestos («las 15 preguntas se miden en el piloto»).
2. **El cuello de botella, con nombre.** «Con L40S, el tiempo de la GPU entre leer los pesos y leer los prompts. La memoria sobra.»
3. **Las opciones, con lo que compra cada una.** 3 L40S: el mínimo, sin repuesto. 4 L40S: repuesto, o las 8 de diseño. 2 RTX PRO 6000 Server Edition: repuesto y las 8 de diseño, con prefill de 1.72 s. Cada una con su TTFT como **rango** (sin fila, al azar, viendo la fila).
4. **La sensibilidad.** «Si preguntan 30 veces al día en vez de 15, son 6 L40S o 2 Server Edition»: el cliente ve cuánto arriesga con cada opción.
5. **Lo que decide el piloto:** \(r\), \(k_{pico}\), las eficiencias reales y el p95 de punta a punta, con una prueba de carga con el perfil del despacho.

**Contrastar con lo publicado.** Al «¿y esto de dónde sale?» del experto de TI: el método no es invento de esta lección.

- **NVIDIA** («LLM Inference Benchmarking: How Much Does Your LLM Inference Cost?») sigue el mismo camino: medir la curva de rendimiento contra latencia de una unidad de despliegue, quedarse con el mejor punto que cumple la latencia, estimar el pico de peticiones por segundo (usuarios no es concurrencia) y dividir. Ahí la capacidad por instancia **se mide**; aquí se calcula como primera estimación.
- **Databricks** («LLM Inference Performance Engineering: Best Practices») explica que el decode a lotes chicos lo predice el ancho de banda de memoria, y define su utilización (*MBU*) igual que \(η_m\). En su ejemplo de 7 mil millones de parámetros sale ≈ 50 %: el 0.7 de la herramienta es un supuesto, no esa medición.
- **Red Hat** publicó en MLPerf Inference v4.1 un servidor con **4 L40S** sirviendo Llama 2 70B en FP8 con [[vllm|vLLM]] 0.5.1, como dos [[replica|réplicas]] de 2 L40S: 1,469 tokens por segundo a 4.97 peticiones por segundo con TTFT ≤ 2 s y 200 ms por token. La herramienta con ese modelo da el mismo orden de magnitud, pero la fuente no da el largo de los prompts, y sin él no se puede validar a ±20 %: no la contradice ni la confirma.
- **Un blog de Hugging Face** (junio de 2026, de un tercero) midió Gemma-4 31B en FP8 con vLLM 0.20 en una RTX PRO 6000 de 96 GB (sin decir cuál variante): con 12 a 24 peticiones a la vez, TTFT de 0.73 s en el p50 y **2.82 s en el p95**. El p95 casi cuatro veces el p50: la misma lección de la cola, medida.

Ninguno es el número del despacho (otro modelo, otra cuantización, otros prompts): sirven para decir «el método es el estándar y el orden de magnitud cuadra», no para sustituir la medición con el perfil propio (por ejemplo, con `vllm bench serve`), tema de la lección «Pruebas de carga y benchmarks honestos».

## Errores comunes {Common mistakes}

1. **Dimensionar con usuarios en vez de conversaciones a la vez.** «Son 200, necesito 200 lugares», y en la hora pico son ≈ 5.7. **Cómo evitarlo:** de personas a preguntas por segundo con el factor de pico, y de ahí a conversaciones con la ley de Little.
2. **Dimensionar con el promedio del día.** Con el promedio salen ≈ 2.3 conversaciones a la vez y 2 L40S; a las 10 de la mañana, la fila crece. **Cómo evitarlo:** usa siempre la hora pico, y escribe de dónde salió el factor.
3. **Tomar el TTFT sin fila como el p95.** Los 2.38 s de la herramienta son el prefill con la GPU libre; el p95 al azar es ≈ 4.2 s. **Cómo evitarlo:** presupuesto de punta a punta y un modelo de cola; al final, medir.
4. **Quedarse con el techo más alto que suena bien.** «Caben 10 en la memoria, compro 1 L40S». La memoria no manda: el prefill y el ancho de banda comparten la GPU y dejan 2. **Cómo evitarlo:** calcula los tres techos y la mezcla, y nombra el cuello de botella.
5. **Sumar GPUs para arreglar el TTFT.** De 3 a 4 L40S el p95 baja ≈ 0.3 s; repartir viendo la fila en vez de al azar lo baja casi 2 s (en el modelo). **Cómo evitarlo:** antes de comprar, mueve las palancas baratas: reparto, menos tokens, una promesa razonable.
6. **Meter los resúmenes en el sizing interactivo sin decirlo.** Un 5 % de resúmenes de 40,250 tokens sube el prefill medio ≈ 45 %, y ni siquiera caben con un tope de 8,192. **Cómo evitarlo:** un perfil por tarea; las de lote, en otra fila o de noche.
7. **Presentar el número sin sus supuestos.** «3 L40S» sin decir «con 15 preguntas, sin repuesto, con eficiencias supuestas» es una promesa que no se puede revisar. **Cómo evitarlo:** la página de «Defender el número», con sensibilidad y con lo que mide el piloto.

## En la vida real {In real life} [extra]

**El despacho.** Del «somos 200 y queremos que sea rápido» salen ≈ 0.21 preguntas por segundo en el pico y ≈ 5.7 conversaciones a la vez, que leen 1,250 tokens por segundo. Una L40S aguanta 2 (por memoria cabrían 10): el mínimo es **3 L40S**, el resultado de la herramienta de sizing, con holgura de 1.05×; con repuesto o para las 8 de diseño, 4. La alternativa son **2 RTX PRO 6000 Server Edition**: una atiende el promedio y la otra es el repuesto. Ninguna opción garantiza el TTFT ≤ 2 s en el p95 repartiendo al azar (≈ 4.2 s y ≈ 3.1 s, simulados); repartiendo viendo la fila, la Server Edition queda en el filo (≈ 1.8 s, ≈ 1.9 s con la red y la búsqueda supuestas) y la L40S en su piso de 2.38 s. El despacho cotiza las dos y el piloto decide.

**Una clínica con picos al abrir consultas.** Supuestos del ejemplo: 60 médicos que dictan 20 notas al día en 8 horas, con prompts de ≈ 2,000 tokens y notas de ≈ 300; Qwen3 32B en INT4 en una L40S. Lo que cambia es el pico: a las 8:00, cuando abren las consultas, llega **4 veces** el promedio. Con eso, \(λ\) ≈ 0.17 por segundo y ≈ 2.6 conversaciones a la vez; con prompts cortos el prefill baja a ≈ 0.75 s y una L40S aguanta 5. A la clínica le basta **1 L40S**, y una segunda como repuesto. Si el descubrimiento hubiera usado un pico de 2, el resultado sería el mismo: aquí el supuesto no mueve la decisión, y eso también hay que saberlo.

**Una fábrica con turnos de 24 horas.** Supuestos del ejemplo: 300 operarios que consultan manuales 6 veces al día, repartidos en las 24 horas, con un pico de 1.5 en los cambios de turno, prompts de ≈ 3,000 tokens y respuestas de ≈ 300. Son ≈ 0.03 preguntas por segundo y **media conversación** a la vez: la capacidad sobra con una sola GPU. Lo que manda es el N+1: a las 3 de la mañana no hay nadie de TI, y si la única GPU falla, la línea se queda sin manuales hasta el día siguiente. Aquí se dimensiona por disponibilidad, no por carga.

**Una financiera con un trabajo por lotes de noche.** Supuestos del ejemplo: cada noche hay que extraer datos de 50,000 documentos de ≈ 3,000 tokens, con respuestas de ≈ 200, en una ventana de 6 horas. Nadie espera el primer token: solo hay que terminar antes de las 6:00, y manda el **throughput**. En una L40S, cada documento cuesta ≈ 1.14 s de prefill y, en decode con 26 a la vez (lo que cabe en la memoria), ≈ 0.51 s más: ≈ 1.65 s de GPU por documento, sin contar que el prefill y el decode se pueden traslapar. Son ≈ 23 horas de GPU por noche: **4 L40S** para la ventana de 6 horas. La misma GPU que en el despacho atiende 2 conversaciones, aquí procesa ≈ 2,200 documentos por hora.

## Ejercicios {Exercises}

:::ejercicios
? [facil] El despacho descubre que su hora pico es de **4 veces** el promedio, no de 2.5. Con todo lo demás igual (y \(t_{pre}\) = 2.38 s), ¿cuántas conversaciones a la vez hay en el pico y cuántas L40S hacen falta como mínimo?
\(λ\) = 200 × 15 ÷ 36,000 × 4 = 0.0833 × 4 ≈ **0.333 por segundo**. \(c\) = 0.333 × (2.38 + 25) = 0.333 × 27.38 ≈ **9.13**. Con \(b\) = 2 por L40S: ⌈9.13 ÷ 2⌉ = ⌈4.56⌉ = **5 L40S**. El factor de pico es un supuesto que mueve el resultado: vale la pena medirlo.
? [facil] Un contrato de 20 páginas a espacio sencillo, en español. ¿Cuántos tokens ocupa, con \(f\) = 1.61? ¿Cabe en una conversación del despacho con tope de 8,192?
\(N\) = 20 × 500 × 1.61 = **16,100 tokens**. No cabe: es casi el doble del tope. Para preguntar sobre él hay que pasarle fragmentos (como hace el despacho) o subir el tope, con todo lo que eso cuesta en KV cache y en prefill.
? [facil] ¿Qué holgura tienen 4 L40S para el despacho (\(c\) = 5.70, \(b\) = 2)? ¿Aguantan el pico si una falla?
\(H\) = 4 × 2 ÷ 5.70 = 8 ÷ 5.70 ≈ **1.40×**. Si una falla, quedan 3 × 2 = 6 ≥ 5.70: **sí aguantan** el promedio del pico, justo. Es el N+1 de las 3 L40S.
? [medio] Calcula el techo de memoria de la Server Edition con conversaciones de 6,500 tokens (el largo típico: prompt más respuesta), no con el tope de 8,192. ¿Por qué la herramienta usa ese largo?
Útil para KV: 0.9 × 96 − 19.32 − 2 = 65.08 GB. Una conversación de 6,500: 6,500 × 262,144 ≈ 1.704 GB. ⌊65.08 ÷ 1.704⌋ = ⌊38.2⌋ = **38**. La herramienta usa el largo real de la conversación porque el servidor reparte el KV cache en bloques según lo que se usa; diseñar con el tope es no quedarse corto. En la L40S la misma cuenta da 12, contra 10 con el tope (el 8 de la ficha es otra cosa: su número de diseño de conversaciones a la vez). En ninguna de las dos GPUs manda la memoria.
? [medio] Calcula el techo de ancho de banda de una H100 SXM con el despacho (3,350 GB/s, \(η_m\) = 0.7, 50 ms por token). ¿Por qué es casi 10 veces el de la L40S si su ancho de banda es ≈ 3.9 veces?
\(η_m × B\) = 0.7 × 3,350 = 2,345 GB/s. \(a_0\) = 19.32 ÷ 2,345 ≈ 8.24 ms; \(a_1\) = 1.638 ÷ 2,345 ≈ 0.699 ms. \(b_{anch}\) = ⌊(50 − 8.24) ÷ 0.699⌋ = ⌊59.8⌋ = **59**. En la L40S, el paso fijo se come 32 de los 50 ms y quedan 18; en la H100, se come 8 y quedan 42. Lo que sobra crece más que el ancho de banda, porque el costo fijo de leer los pesos se resta primero.
? [medio] El piloto mide **30 preguntas** por persona al día en vez de 15. ¿Cuántas L40S y cuántas Server Edition hacen falta como mínimo y con N+1? (\(t_{pre}\) = 2.38 s y 1.724 s.)
\(λ\) = 200 × 30 ÷ 36,000 × 2.5 ≈ 0.417 por segundo. L40S: \(c\) = 0.417 × 27.38 ≈ 11.41; ⌈11.41 ÷ 2⌉ = **6**, con N+1 **7**. Server Edition: \(c\) = 0.417 × (1.724 + 25) ≈ 11.13; ⌈11.13 ÷ 6⌉ = **2**, con N+1 **3**. Duplicar el uso duplica las L40S, pero la Server Edition absorbe el cambio con la misma segunda tarjeta.
? [reto] El despacho quiere meter los resúmenes en la hora pico: 20 % de las peticiones serían resúmenes de 40,250 tokens (prefill ≈ 23.95 s en una L40S) y 80 % preguntas (2.38 s). Con 3 L40S, ¿qué fracción del tiempo de cada GPU se va en prefills? ¿Qué le recomiendas?
Prefill medio: 0.8 × 2.38 + 0.2 × 23.95 = 1.90 + 4.79 ≈ **6.69 s**. Cada L40S recibe 0.208 ÷ 3 ≈ 0.0694 peticiones por segundo: \(ρ\) = 0.0694 × 6.69 ≈ **46 %**, contra 16.5 % solo con preguntas. Casi la mitad del tiempo en prefills: el decode de las demás cae muy por debajo de 20 tokens por segundo, y cuando llega un resumen, las preguntas de esa GPU esperan hasta 24 s. Además, con el tope de 8,192 tokens el resumen ni entra. Recomendación: los resúmenes a una fila aparte, de baja prioridad o de noche, con su propio sizing por throughput.
? [reto] Diseña la opción más barata en GPUs para el despacho con L40S que cumpla un TTFT de 3 s en el p95 (contando los 170 ms supuestos de red y búsqueda) y tenga repuesto. Puedes cambiar a 3 fragmentos (prompt de ≈ 3,500 tokens) si el examen de calidad lo permite.
Con 5 fragmentos: la capacidad pide 3 L40S y N+1 pide 4; viendo la fila, el p95 simulado es ≈ 2.38 + 0.17 = 2.55 s, cumple; al azar, ≈ 4.2 + 0.17 s, no. Con 3 fragmentos: \(t_{pre}\) = 1.34 s, \(b\) = 4, \(c\) ≈ 5.49, ⌈5.49 ÷ 4⌉ = 2, con N+1 **3 L40S**. El p95 simulado con 2 L40S al azar es ≈ 2.3 s (≈ 2.5 s con red y búsqueda), dentro de los 3 s aun repartiendo al azar; con 3 L40S, mejor. La más barata: **3 L40S con 3 fragmentos**, si el examen de 200 preguntas sigue en ≥ 85 % con citas correctas. Si no, 4 L40S con 5 fragmentos, repartiendo viendo la fila.
:::

## Lo que sigue {What comes next} [extra]

- **[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)** contesta lo que esta lección dejó abierto: si las 3 L40S del despacho llevan una copia del modelo cada una o reparten uno solo, y qué cuesta repartir un modelo grande como Llama 3.3 70B entre GPUs conectadas por PCIe.
- **[Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM](/stack-serving/)** pone el número en un programa: qué motor corre en esas GPUs y qué perillas fijan cuántas conversaciones acepta.
- **[Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/)** es donde vive el reparto «viendo la fila» que más bajó el p95, junto con las [[cuota-de-tokens|cuotas por persona]] que salen de la capacidad de este sizing.
- **«Pruebas de carga y benchmarks honestos»** mide lo que aquí se calculó: el p95 real, las eficiencias reales, la curva del despacho.
- La [herramienta de sizing](/herramientas/sizing/) hace los pasos 2, 4, 5 y el mínimo del 6 para cualquier GPU del catálogo, y la de [TCO](/herramientas/tco/) les pone precio.
- En Sensei: [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/) para leer un p95 sin engañarte, y [Números grandes, unidades y estimaciones](https://sensei.trueml.app/unidades/) para las cuentas de servilleta de los pasos 1 y 2.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
requisito-no-funcional perfil-de-carga mezcla-de-tareas presupuesto-de-latencia capacidad-por-gpu cuello-de-botella holgura n-mas-1 plan-de-capacidad crecimiento ttft-con-cola menos-pendientes
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué «somos 200» no es el número con que se dimensiona?
Porque no preguntan a la vez: en la hora pico son ≈ 0.21 preguntas por segundo y ≈ 5.7 conversaciones abiertas. Eso atiende la GPU.
? ¿Cuáles son los tres techos de una GPU y qué limita cada uno?
Memoria (cuántas caben con su KV cache), ancho de banda (cuántas se escriben a la velocidad prometida) y cómputo (cuántos prompts nuevos lee por segundo).
? Si en la L40S caben 10 por memoria y 6 por ancho de banda, ¿por qué la capacidad es 2?
Porque el prefill y el decode comparten el tiempo: leer los pesos 20 veces por segundo se come el 64 %, y cada conversación cuesta casi 15 % más entre decode y prefill. Caben dos.
? ¿Qué es N+1 y cuántas L40S lo cumplen para el despacho?
Una GPU más de las que pide el pico, para que si una falla las demás aguanten: 4 L40S (si una falla, 3 × 2 = 6 ≥ 5.7).
? La herramienta dice TTFT = 2.38 s. ¿Por qué no es el p95 que pide el despacho?
Porque es el prefill con la GPU libre. En el pico, las preguntas a veces esperan a otra: con reparto al azar, el p95 de 3 L40S sale ≈ 4.2 s simulado (≈ 5.8 s en la cota pesimista).
? ¿Cuál es la palanca más barata para bajar el p95 del TTFT, según el modelo de la lección?
Repartir viendo la fila (a la GPU con menos prompts por leer) o por turno, no al azar: en 3 L40S, de ≈ 4.2 s a ≈ 2.4 s sin comprar nada. Después, menos tokens de entrada.
? ¿Por qué los resúmenes de expediente se dimensionan aparte?
Un resumen de 40,250 tokens cuesta ≈ 24 s de prefill (diez preguntas) y no cabe en el tope de 8,192; nadie mira su primer token: se dimensiona por throughput, en otra fila o de noche.
:::
