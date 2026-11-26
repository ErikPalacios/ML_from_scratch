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

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus 30,000 expedientes con un LLM sin que un solo documento salga de su red. Lo usarían **200 personas**, cada una haría ≈ **15 preguntas al día** entre las 9:00 y las 19:00, y en la hora más cargada llega **2.5 veces** el promedio. Cada pregunta lleva ≈ **6,000 tokens** de entrada (instrucciones, la pregunta y cinco fragmentos de expediente) y la respuesta, ≈ **500**. Quieren el primer token en **2 s o menos en el p95** y al menos **20 tokens por segundo** por persona. El modelo candidato es **Qwen3 32B en INT4 de AWQ**, con el razonamiento apagado. Todos esos números son supuestos del ejemplo; viven en una sola ficha y se usan tal cual.

En la primera reunión nadie dice esas cifras: el socio director dice «somos 200 y queremos que sea rápido». Esta lección es el camino de esa frase a una cotización, y abre por dentro la [herramienta de sizing](/herramientas/sizing/): al final vas a reproducir su resultado, **3 L40S**, y explicar cada número.

### Lo que el sistema hace y cómo lo hace

Un requisito es algo que el sistema debe cumplir. Los **funcionales** dicen *qué* hace: «contesta sobre los expedientes y cita el documento y la página». Los [[requisito-no-funcional|no funcionales]] (*non-functional requirements*) dicen *qué tan bien*: qué tan rápido, para cuántos, cuántas horas, cuánto puede fallar. «Somos 200 y queremos que sea rápido» son dos no funcionales en lenguaje de sobremesa.

El hardware sale casi entero de los no funcionales. El mismo «contesta con cita» cabe en una laptop si lo usa una persona a la semana, y pide un servidor de rack si lo usan 200 en su hora pico. Un requisito no funcional sin número no sirve: «rápido» no se puede comprar.

:::analogia El ingeniero civil y el puente
Un puente no se diseña con «que pase mucha gente». Se diseña con cuántos vehículos por hora, de qué peso, en la hora pico, con un viento máximo, y luego se multiplica por un factor de seguridad. Dimensionar un servidor de LLMs es lo mismo: la carga en números, la capacidad de cada pieza, y un margen.

Dónde se rompe: el puente se calcula con leyes físicas que no cambian, y luego se prueba poco. Aquí las «leyes» son modelos aproximados (eficiencias supuestas, colas simplificadas) y por eso el último paso no es firmar el cálculo: es **medirlo** en un piloto. El cálculo dice dónde buscar; la medición decide.
:::

### La receta en siete pasos

:::pasos
1. Preguntas que dan números
Del «somos 200» a personas, preguntas al día, horario, hora pico y tokens por tarea. Es la etapa de [[descubrimiento]] con una regla más: cada respuesta tiene que ser un número o un supuesto escrito.

2. Perfil de carga
De esos números, lo que llega al servidor por segundo en la hora pico: preguntas, tokens de entrada, tokens de salida y conversaciones a la vez.

3. Presupuesto de latencia
Del «rápido» a milisegundos: cuánto del tiempo al primer token se come la red, la búsqueda de fragmentos, la fila y el prefill, y cuánto queda.

4. Los tres techos de una GPU
Cuánto aguanta una GPU por memoria, por ancho de banda y por cómputo, cada uno por separado.

5. La capacidad por GPU y el cuello de botella
El menor de los tres (bien mezclados) es lo que aguanta la GPU, y el techo que manda es el que hay que atacar.

6. Cuántas GPUs: holgura, N+1 y crecimiento
La carga entre la capacidad, hacia arriba, con margen, con una de repuesto y con un plan a 12 y 24 meses.

7. Candidatos de hardware
Repetir 4 a 6 con cada GPU candidata, compararlas y escribir lo que se defiende ante el cliente.
:::

:::diagrama requisitos-hardware-receta
Toca cada paso para ver qué entra y qué sale, o usa «Recorrer» para seguir al despacho de la frase del socio a la cotización.
:::

Fíjate en la flecha que regresa del piloto. La receta no es una línea recta: los números de los pasos 1 a 3 son supuestos hasta que se miden, y las eficiencias del paso 4 también. Una buena estimación dice cuáles de sus números son supuestos, para que el piloto los mida en ese orden.

## Paso 1: preguntas que dan números {Step 1: questions that yield numbers}

La lección del [recorrido](/recorrido/) presenta la hoja de [[descubrimiento]]: tareas, usuarios, volumen, datos, idioma, latencia y restricciones. Aquí se afila: **cada pregunta tiene que terminar en un número con su unidad**, o en un supuesto escrito que el cliente acepta.

| Lo que dice el cliente | La pregunta que da el número | El despacho |
|---|---|---|
| «Somos 200» | ¿Cuántas personas tendrán acceso? ¿Cuántas lo usarán de verdad cada día? | \(U\) = 200 |
| «Lo vamos a usar mucho» | ¿Cuántas veces al día pregunta alguien que lo usa? Dame tres preguntas de la semana pasada. | \(r\) = 15 preguntas por persona |
| «En horario de oficina» | ¿De qué hora a qué hora? ¿Hay turnos, fines de semana? | \(H\) = 10 horas |
| «Todos llegan a las 10» | ¿A qué hora se junta más gente? ¿Cuánto más que en una hora normal? | \(k_{pico}\) = 2.5 |
| «Preguntas sobre expedientes» | ¿Qué tareas, en qué proporción? ¿Cuánto texto lleva cada una y cuánto contesta? | 6,000 tokens de entrada, 500 de salida |
| «Que sea rápido» | ¿Cuánto puede esperar la primera palabra? ¿Qué tan rápido debe escribir? ¿Para cuántas de cada 100 preguntas? | TTFT ≤ 2 s en el p95; ≥ 20 tokens/s |

La última fila es la que más se negocia. «Rápido» se vuelve dos números: el [[ttft|TTFT]] (*time to first token*, lo que tarda la primera palabra) y la velocidad al escribir. Cada uno con un **percentil**, no con un promedio: «≤ 2 s en el p95» es que 95 de cada 100 preguntas ven su primera palabra en 2 s o menos (lo ves a fondo en [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/)). Se fija **antes** de calcular, porque es contra lo que se mide al final.

### Ninguna fuente te da «15 preguntas al día»

Hay que decirlo claro: **no existe una medición pública confiable de cuántas preguntas al día le hace una persona a un asistente interno de su empresa**. Los reportes de uso de Microsoft y OpenAI (2025–2026) hablan de millones de usuarios y de adopción, no de mensajes por persona por día. El 15 y el factor de pico de 2.5 del despacho son **supuestos del ejemplo**, igual que el rango de 2 a 3 que sugiere la herramienta para el pico. Se hacen tres cosas:

- **Preguntarle al cliente con ejemplos.** «¿Cuántas veces le preguntaste algo a un colega o buscaste en un expediente ayer?» da un orden de magnitud mejor que cualquier promedio de internet.
- **Calcular con tres valores y ver cuánto cambia la respuesta.** Con 8, 15 y 30 preguntas por persona, el despacho pide 2, 3 y 6 L40S (lo calculas en el paso 6). Si el número de GPUs casi no cambia, el supuesto no importa; si se triplica, hay que medirlo antes de comprar.
- **Medir en la [[prueba-piloto|prueba piloto]].** El despacho ya planea 8 semanas con 20 abogados: de ahí salen el \(r\) y el \(k_{pico}\) reales.

### De páginas a tokens: la [[mezcla-de-tareas|mezcla de tareas]]

El despacho pidió tres tareas: preguntar sobre los expedientes (con cita), resumir un expediente y encontrar cláusulas parecidas. Cada una pesa distinto en la GPU, y la [[mezcla-de-tareas|mezcla]] (*task mix*: qué fracción del tráfico es cada tarea) cambia el resultado.

Para saber cuánto pesa una tarea hay que pasar de páginas a tokens. Un artículo de octubre de 2025 («Beyond Fertility», en arXiv) midió cuántos tokens hace cada palabra (la *fertilidad* del tokenizador) en noticias: con el tokenizador de Qwen2.5-72B, **1.61 en español formal** y 1.25 en inglés. Nadie publicó la cifra con Qwen3 (su vocabulario es casi idéntico) ni con texto jurídico: es aproximada, y se mide con el tokenizador real. Lo firme: **en español el mismo texto cuesta ≈ 20–30 % más tokens que en inglés.**

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

Las tres tareas, lado a lado. Los 6,000 y 200 tokens de «buscar cláusulas» y los 700 de salida de un resumen son supuestos; no están en la ficha.

| Tarea | Tokens de entrada | Tokens de salida | Prefill en una L40S | KV cache |
|---|---|---|---|---|
| Preguntar (con cita) | 6,000 | 500 | ≈ 2.4 s | 1.70 GB |
| Buscar cláusulas (supuesto) | 6,000 | 200 | ≈ 2.4 s | 1.63 GB |
| Resumir un expediente (supuesto de salida) | 40,250 | 700 | ≈ 24 s | 10.73 GB |

Un resumen ocupa la GPU en su [[prefill|prefill]] lo que diez preguntas, y su [[kv-cache|KV cache]] lo de cinco conversaciones del tope. Por eso la primera decisión es **cuáles tareas entran en el sizing de la hora pico**. El despacho empieza por preguntar, y la herramienta dimensiona solo esa; los resúmenes, que nadie mira mientras se escriben, pueden ir a una fila de baja prioridad o a la noche.

## Paso 2: el perfil de carga {Step 2: the load profile}

El [[perfil-de-carga|perfil de carga]] (*load profile*) es la descripción, en números, de lo que llega al servidor: cuántas preguntas por segundo, con cuántos tokens de entrada y de salida, a qué hora, y cuántas conversaciones están abiertas a la vez. Es la frontera entre el cliente y la GPU: todo lo que está antes habla de personas; todo lo que está después habla de tokens y segundos.

Sus piezas ya las conoces. El [[factor-de-pico|factor de pico]]: se dimensiona para la hora más cargada, porque un sistema que aguanta el promedio se cae todos los días a las 10. La [[ley-de-little|ley de Little]] (a fondo en [concurrencia](/concurrencia/)): lo que hay adentro es lo que llega por segundo por lo que dura cada uno. Y el paso de eventos al día a eventos por segundo de [Números grandes, unidades y estimaciones](https://sensei.trueml.app/unidades/). Lo nuevo es juntarlas y agregarle los tokens.

:::formula El perfil de carga en la hora pico
λ = frac{U × r}{H × 3,600} × k_{pico}
T_{ent} = λ × N_p
T_{sal} = λ × N_o
c = λ × (t_{pre} + frac{N_o}{v})
- U: las personas que usan el sistema
- r: las preguntas por persona al día
- H: las horas del día con tráfico; 3,600 son los segundos de una hora
- k_{pico}: la hora más cargada ÷ la hora promedio
- λ: las preguntas por segundo en la hora pico
- N_p, N_o: los tokens de entrada (prompt) y de salida (respuesta) de cada pregunta
- T_{ent}, T_{sal}: los tokens por segundo que el servidor tiene que leer y escribir en el pico
- t_{pre}: lo que tarda el prefill de una pregunta, en s (sale del paso 4; aquí, el de la L40S)
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
= Doscientas personas, en su peor hora, son ≈ 5.7 conversaciones abiertas, que leen 1,250 tokens por segundo y escriben ≈ 104. El servidor lee doce veces más de lo que escribe.
:::

Dos detalles. La ficha del despacho dice 5.6, no 5.70, porque calcula la duración con los 2 s del objetivo en vez de los 2.38 s de la L40S; el resultado del paso 6 es el mismo. Y \(c\) depende un poco de la GPU, porque \(t_{pre}\) depende de ella: 5.57 con la RTX PRO 6000 Server Edition.

:::figura requisitos-hardware-embudo
De 200 personas a 5.7 conversaciones a la vez: cada escalón divide o multiplica por un número de la ficha. Abajo, lo que esas conversaciones le piden a la GPU en tokens por segundo.
:::

La proporción entre entrada y salida es lo más importante del perfil, y casi nadie la mira. Un RAG como el del despacho lee **doce veces** lo que escribe. Leer es [[prefill|prefill]] y depende del cómputo; escribir es [[decode|decode]] y depende del ancho de banda. El perfil ya anuncia que el problema del despacho va a estar en el prefill.

:::calculadora requisitos-hardware-perfil
Arranca con el despacho. Sube la fracción de resúmenes a 0.05: los tokens de entrada por segundo suben ≈ 29 % y el prefill medio ≈ 45 % (la atención crece con el cuadrado del prompt), aunque el número de peticiones no cambió. Después regresa a 0 y baja el factor de pico a 1: el promedio del día cabe en la mitad de conversaciones.
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

## Paso 3: el presupuesto de latencia {Step 3: the latency budget}

«TTFT ≤ 2 s» suena a un número del modelo. No lo es: es de **todo el camino** hasta que aparece la primera palabra en la pantalla. La documentación de métricas de NVIDIA lo dice explícito: el TTFT incluye la cola, el prefill y la red. En un RAG como el del despacho hay una pieza más: buscar los cinco fragmentos antes de mandarle nada al modelo. [Latencia y throughput](https://sensei.trueml.app/latencia/) reparte así la latencia de punta a punta; aquí se hace con los tramos de un LLM.

El [[presupuesto-de-latencia|presupuesto de latencia]] (*latency budget*) es repartir esos 2 s entre las piezas del camino, como el dinero de un viaje: tanto para el avión, tanto para el hotel, y lo que sobra. Si lo comprometido ya pasa del total, no hay GPU que lo arregle: hay que cambiar el objetivo, el camino o las piezas.

:::formula El tiempo al primer token que siente la persona
TTFT = t_{red} + t_{rec} + t_{cola} + t_{pre}
t_{cola} + t_{pre} ≤ TTFT_{obj} − t_{red} − t_{rec}
- t_{red}: la red y el gateway, ida y vuelta, en s
- t_{rec}: la recuperación (*retrieval*): convertir la pregunta en un vector y buscar los fragmentos, en s
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

Los 20 ms y los 150 ms son supuestos para una red de oficina y una búsqueda local; se miden en el piloto. Son **décimas** de segundo contra **segundos** de prefill: lo que decide el presupuesto es la GPU y el tamaño del prompt, no la red.

:::diagrama requisitos-hardware-latencia
El camino de una pregunta del despacho hasta su primera palabra, con lo que cuesta cada tramo. Usa «Recorrer» para sumar el presupuesto tramo por tramo.
:::

### La otra mitad: la velocidad al escribir

El presupuesto tiene una segunda parte, más fácil: «≥ 20 tokens por segundo» quiere decir que entre un token y el siguiente no pueden pasar más de 1 ÷ 20 = **50 ms**. Ese es el [[tpot|TPOT]] (*time per output token*) del objetivo. Un paso de decode del servidor tiene que caber en 50 ms con todas las conversaciones que lleve, y además dejar tiempo para los prefills de las que llegan. Esta parte la cuida el paso 5.

:::ojo
Los percentiles no se suman. Si la red tiene un p95 de 30 ms y el prefill uno de 2.4 s, el p95 de la suma no es 2.43 s: casi nunca coinciden los peores casos de cada tramo, así que suele ser algo menos (lo ves en [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/)). Sumar los p95 de cada tramo da una cota **pesimista**, que está bien para un presupuesto (si cabe así, cabe). Para el número real, se mide el TTFT de punta a punta, como lo siente la persona.
:::

## Paso 4: los tres techos de una GPU {Step 4: the three ceilings of a GPU}

Ahora se cambia de lado: lo que aguanta **una** GPU. Lo aguanta con tres recursos, y cada uno pone su techo. Los viste por partes: la memoria en [¿Cabe en la GPU?](/herramientas/vram/), el ancho de banda y el prefill en [batching](/batching/) y [concurrencia](/concurrencia/). Aquí van lado a lado para dos GPUs: la **L40S** de 48 GB (864 GB/s, 362.05 TFLOPS densos en FP16) y la **RTX PRO 6000 Blackwell Server Edition** de 96 GB, la variante pasiva de rack que [Comprar hardware](/comprar-hardware/) propone como alternativa. NVIDIA publica para ella 1,597 GB/s y «1 PFLOP» en FP16 sin decir si es denso (página consultada en noviembre de 2026); comparada con la Workstation Edition, del mismo chip, el denso es ≈ **500 TFLOPS**, un valor derivado. El catálogo de esta app trae la Workstation Edition, de torre: no las confundas.

**Techo 1, la memoria: cuántas conversaciones caben.** Lo que queda de la [[vram|VRAM]] después de los [[pesos]] y del programa, entre el [[kv-cache|KV cache]] de una conversación. Cuando no hay lugar, la siguiente espera.

**Techo 2, el [[ancho-de-banda|ancho de banda]]: cuántas se escriben a la velocidad prometida.** Cada paso de [[decode|decode]] lee los pesos una vez y el KV cache de cada conversación. Con más conversaciones el paso se alarga, y el paso no puede pasar de \(1 ÷ v\).

**Techo 3, el cómputo: cuántas preguntas nuevas se leen por segundo.** El [[prefill|prefill]] de 6,000 tokens no espera a la memoria: está limitado por el [[pico-de-calculo|pico de cálculo]] de la GPU. Cada pregunta ocupa la GPU \(t_{pre}\) segundos leyendo su prompt, así que una GPU no puede recibir más de \(1 ÷ t_{pre}\) preguntas por segundo.

:::formula Los tres techos, por separado
b_{mem} = ⌊ frac{(1 − f) × M − W − M_{prog}}{m × N_{tope}} ⌋
a_0 = frac{W}{η_m × B}
a_1 = frac{m × N_m}{η_m × B}
b_{anch} = ⌊ frac{1 ÷ v − a_0}{a_1} ⌋
t_{pre} = frac{2 × A × N_p + 2 × L × h × d × N_p^2}{η_c × F}
λ_{máx} = frac{1}{t_{pre}}
- M: la VRAM de la GPU, en GB; f: el margen que deja libre el servidor (0.1)
- W: los pesos, en GB (19.32 en Qwen3 32B en INT4 de AWQ); M_{prog}: el programa que sirve el modelo (2 GB)
- m: los bytes de KV cache por token (256 KiB en Qwen3 32B); N_{tope}: el tope de contexto (8,192)
- b_{mem}: las conversaciones que caben; ⌊ ⌋ redondea hacia abajo
- B: el ancho de banda de la GPU; η_m: la [[eficiencia|eficiencia]] de memoria (0.7, supuesta)
- a_0: el tiempo fijo de un paso de decode: leer los pesos
- a_1: lo que cada conversación le suma al paso: leer su KV cache a media respuesta, \(N_m\) = 6,250 tokens
- b_{anch}: las conversaciones cuyo paso cabe en \(1 ÷ v\), sin contar prefills
- A: los parámetros que usa cada token (32,762 millones; en un modelo denso, todos)
- L, h, d: los bloques (64), las cabezas de atención (64) y los números por cabeza (128) de Qwen3 32B; el segundo término es la atención, que crece con el cuadrado del prompt
- F: el pico de cálculo denso en FP16, en FLOPS; η_c: la eficiencia de cálculo (0.5, supuesta)
- t_{pre}: el prefill de una pregunta, en s; λ_{máx}: las preguntas por segundo que la GPU alcanza a leer si no hiciera nada más
:::

El pico es el de **FP16** aunque los pesos estén en 4 bits: AWQ los convierte a 16 bits para multiplicar. Es la hipótesis de la herramienta, no medida contra los kernels reales para este modelo; por eso \(η_c\) es un supuesto que el piloto calibra.

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
= Por memoria caben 10; por ancho de banda se escriben 6 a 20 tokens por segundo; por cómputo, el pico del despacho tendría a una sola L40S la mitad del tiempo leyendo prompts.
:::

:::cuenta Los mismos tres techos en una RTX PRO 6000 Server Edition
Útil para KV // 0.9 × 96 GB − 19.32 − 2 | 86.4 − 21.32 | 65.08 GB
Techo de memoria, \(b_{mem}\) // 2.147 GB por conversación | ⌊65.08 ÷ 2.147⌋ = ⌊30.3⌋ | **30**
Paso fijo, \(a_0\) // 0.7 × 1,597 = 1,117.9 GB/s | 19.32 ÷ 1,117.9 | 17.28 ms
Por conversación, \(a_1\) | 1.638 ÷ 1,117.9 | 1.466 ms
Techo de ancho de banda, \(b_{anch}\) | ⌊(50 − 17.28) ÷ 1.466⌋ = ⌊22.3⌋ | **22**
Prefill, \(t_{pre}\) // 0.5 × ≈ 500 TFLOPS, derivado | 4.309 × 10¹⁴ ÷ 250 × 10¹² | **≈ 1.72 s**
Lo que el pico le pide a una sola | 0.208 × 1.724 | **≈ 36 % del tiempo en prefills**
= El doble de memoria da el triple de conversaciones (los pesos ya están pagados); casi el doble de ancho de banda da más del triple a 20 tokens por segundo (el paso fijo se acortó a la mitad). El cómputo, en cambio, solo mejoró ≈ 38 %: es el techo que menos se mueve.
:::

:::figura requisitos-hardware-techos
Los tres techos de cada GPU con el despacho, en conversaciones. La línea punteada son las ≈ 5.7 conversaciones de la hora pico. La barra de abajo es lo que de verdad aguanta cada GPU cuando el prefill y el decode comparten el tiempo: el paso 5.
:::

:::calculadora requisitos-hardware-techos
Empieza con la L40S y el despacho: 10, 6 y 2, y 3 GPUs. Cambia a la RTX PRO 6000 (la de gpus.json es la Workstation Edition; para la Server Edition elige «Otro» y escribe 1,597 GB/s y 500 TFLOPS). Después prueba la H100 SXM y mira cómo el techo de ancho de banda deja de mandar.
:::

## Paso 5: la capacidad por GPU y el cuello de botella {Step 5: capacity per GPU and the bottleneck}

La [[capacidad-por-gpu|capacidad por GPU]] es cuántas conversaciones a la vez atiende una GPU (o una [[copia-del-servidor|copia del servidor]]) **cumpliendo** la promesa: que quepan y que cada una reciba su velocidad. La regla de siempre es «el menor de los techos». En la L40S, los techos 1 y 2 dan 10 y 6, así que la respuesta ingenua es 6. La herramienta dice **2**. ¿Quién tiene razón?

La herramienta, y el porqué es lo más importante de esta sección. Los techos 2 y 3 **comparten el tiempo** de la misma GPU: mientras la L40S lee el prompt de una pregunta nueva, no escribe para las demás. El techo de 6 supone que el decode tiene la GPU entera. Pero cada conversación escribe 500 tokens a 20 por segundo (25 s) y en ese tiempo le cuesta a la GPU 2.38 s de prefill: un 9.5 % extra por conversación, que se le resta al decode.

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

De cada segundo de la L40S, el **64 %** se va en leer los pesos 20 veces, antes de atender a nadie. Queda el 36 %, y cada conversación se come casi 15 % (5.4 de decode y 9.5 de prefill): caben dos. (La herramienta también calcula un techo de cómputo del decode, 9.6 en la L40S, que aquí no manda.)

### El cuello de botella

En [Latencia y throughput](https://sensei.trueml.app/latencia/) viste el [[cuello-de-botella|cuello de botella]] (*bottleneck*) de una cadena de servicios: el recurso que se satura primero y fija el throughput de todo, como el tubo más angosto. Lo nuevo aquí es que **dentro de una sola GPU** hay varios recursos, y el cuello puede ser uno de ellos o el tiempo que comparten. Nombrarlo es la mitad del valor de un sizing, porque dice **qué palanca mover**: si agrandas el cuello, la capacidad sube; si agrandas cualquier otro recurso, no pasa nada.

En el despacho con la L40S, el cuello es el **tiempo de la GPU**, repartido entre leer los pesos (el ancho de banda) y leer prompts (el cómputo). La memoria no es: le sobran 8 lugares. Eso descarta de golpe varias ideas que suenan bien:

- **Comprar la misma GPU con más memoria no sirve.** Una L40S de 96 GB (si existiera) atendería las mismas 2.
- **Bajar el KV cache a FP8 ayuda poco.** Duplica el techo de memoria, que no manda, y recorta \(a_1\) a la mitad, que es solo un tercio del costo por conversación.
- **Lo que mueve el cuello:** más ancho de banda (baja \(a_0\)), más cómputo (baja \(t_{pre}\)) o menos tokens de entrada (baja \(t_{pre}\) y \(a_1\)). Con 3 fragmentos en vez de 5, el prompt baja a ≈ 3,500 tokens y la L40S pasa de 2 a 4 conversaciones (lo ves en la sección de cambios).

:::analogia La cocina con un solo horno
Una cocina tiene refrigerador grande (la memoria), un pasillo para traer ingredientes (el ancho de banda) y un horno (el cómputo). Si el pasillo y el horno los usa **el mismo cocinero**, el que se acaba primero no es ni el pasillo ni el horno: es el tiempo del cocinero. Un refrigerador más grande no cocina más platillos.

Dónde se rompe: en una GPU de verdad el prefill y el decode sí pueden ir juntos en el mismo paso (el [[chunked-prefill|chunked prefill]] mezcla trozos de prompt con tokens de decode), así que no es todo o nada como un cocinero. Pero el trabajo total es el mismo, y la cuenta de la herramienta, que reparte el tiempo, da el orden correcto.
:::

## Paso 6: cuántas GPUs, con holgura, N+1 y crecimiento {Step 6: how many GPUs, with headroom, N+1 and growth}

Con la carga (\(c\)) y la capacidad por GPU (\(b\)), lo primero es dividir y redondear hacia arriba: no existen 2.85 GPUs. Eso da el **mínimo**. Un sizing que se queda en el mínimo es un sizing que se cae el primer martes con más trabajo, el primer día que una tarjeta falla o el primer año que el despacho contrata gente. Tres ajustes lo vuelven un plan.

### Holgura: no llenar al 100 %

La [[holgura|holgura]] (*headroom*) es la capacidad que se deja sin usar a propósito. [Latencia y throughput](https://sensei.trueml.app/latencia/) la explica a fondo: paga el p99 lejos del codo, la caída de una réplica, el tiempo de reaccionar y el error de la medición, y su regla práctica para un servicio en línea es planear a ≈ 50–70 % de la capacidad medida. Aquí se aplica con una **utilización máxima** \(u_{máx}\): «en la hora pico, no pasar de 70 % de la capacidad». Y se mide como capacidad ÷ demanda.

No hay un porcentaje oficial: los libros de SRE de Google recomiendan reservar capacidad para sobrecargas y redundancia sin dar un número único. El 70 % de esta lección es un supuesto, el borde menos exigente de esa regla práctica. Con un LLM hay una razón más para no apretarlo: aquí \(b\) es **calculada** con eficiencias supuestas, no medida.

### N+1: que una falla no tumbe el servicio

[[n-mas-1|N+1]] quiere decir: si para el pico hacen falta \(N\) GPUs, se tienen \(N + 1\), de modo que **si una falla, las demás todavía aguantan el pico**. Es la forma concreta de la [[redundancia]]. Los mismos libros de Google la usan como ejemplo de nivel de redundancia que se elige por servicio (algunos piden N+2), y la distinguen de un par activo y pasivo (1 + 1), donde una máquina espera sin hacer nada.

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
= Las 3 L40S de la herramienta cubren el promedio de la hora pico con 5 % de sobra y nada más. Con una de repuesto, o para las 8 conversaciones de diseño, son 4; con la holgura de la regla práctica, 5. Con la Server Edition, 2 tarjetas dan a la vez el repuesto, la holgura y las 8 de diseño.
:::

No contradice a la herramienta: ella da el mínimo, **3 L40S**, y dice que no suma repuesto ni crecimiento. Lo que se agrega es qué compra cada GPU extra. Un matiz con la Server Edition: con 2, si una falla, la otra atiende el promedio (6 ≥ 5.57) pero no las 8 de diseño. N+1 protege el promedio, no el peor momento.

### Crecimiento y el plan de capacidad

Un servidor se compra para años. El [[plan-de-capacidad|plan de capacidad]] (*capacity plan*) es la tabla de cuántas GPUs hacen falta en cada fecha según crezca la carga, y **cuándo** pedir la siguiente. Los libros de SRE de Google piden pronosticar el [[crecimiento]] **orgánico** (más gente, más preguntas por persona) y el **inorgánico** (un lanzamiento, una fusión, una tarea nueva como los resúmenes), más lejos que el [[tiempo-de-entrega|tiempo de entrega]]: si una GPU tarda tres meses en llegar, se pide tres meses antes.

¿Cuánto crecerá el despacho? Nadie lo sabe, y ninguna fuente da un «% al año» que sirva. Se calculan escenarios (supuestos) y se ve cuándo cada uno obliga a comprar:

| Escenario del tráfico | \(c\) | L40S mínimo | L40S con N+1 | Server Edition mínimo | Server Edition con N+1 |
|---|---|---|---|---|---|
| Hoy | 5.7 | 3 | 4 | 1 | 2 |
| +25 % (por ejemplo, a 12 meses) | 7.1 | 4 | 5 | 2 | 3 |
| +50 % | 8.6 | 5 | 6 | 2 | 3 |
| El doble (por ejemplo, a 24 meses) | 11.4 | 6 | 7 | 2 | 3 |

Con L40S, cada 25 % de crecimiento es casi una GPU más, y al doble ya no caben en un servidor de 4 ranuras. Con la Server Edition, la segunda tarjeta aguanta hasta el doble (12 lugares contra 11.4). El servidor de hoy necesita **ranuras, fuente y enfriamiento** para el escenario de 24 meses aunque las tarjetas se compren después: lo ven [Comprar hardware](/comprar-hardware/) y [El cuarto](/el-cuarto/).

## La cola: por qué 2.38 s no es el p95 {The queue: why 2.38 s is not the p95}

El despacho ya tiene su número: 3 L40S de mínimo, o 2 Server Edition. Falta la promesa que más le importa al socio: **TTFT ≤ 2 s en el p95**. La herramienta lo avisa en letra chica: su TTFT de 2.38 s (1.72 s en la Server Edition) es **sin fila**, el prefill con la GPU libre.

El objetivo es el p95 en la hora pico, y ahí las preguntas llegan al azar: a veces dos casi juntas a la misma GPU, y la segunda espera el prefill de la primera. Ese [[ttft-con-cola|TTFT con cola]] es el que siente la persona. La lección de [concurrencia](/concurrencia/) ya lo simuló con el prefill de 2.17 s de la cuenta sencilla; aquí va con los 2.38 s de la herramienta, las dos GPUs y una pregunta nueva: ¿importa **cómo** se reparten las preguntas?

### La espera promedio, con una fórmula

Si cada GPU tiene su propia fila, las preguntas le llegan al azar y su prefill dura siempre lo mismo, la espera promedio tiene fórmula cerrada: la de una cola M/D/1 (llegadas al azar, servicio de duración fija, un servidor), que [Latencia y throughput](https://sensei.trueml.app/latencia/) presenta junto a la M/M/1. Con servicio fijo, la espera promedio es la mitad que con servicio al azar. Los prefills del despacho se parecen al caso fijo, porque todos los prompts rondan los 6,000 tokens.

:::formula La espera promedio en la fila de una GPU
ρ = frac{λ}{k} × t_{pre}
t_{cola} = frac{ρ × t_{pre}}{2 × (1 − ρ)}
TTFT_{medio} = t_{pre} + t_{cola}
- λ: las preguntas por segundo en el pico; k: las GPUs (cada una recibe \(λ ÷ k\))
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
= En promedio, la fila suma ≈ 10 % al TTFT. El promedio de la Server Edition queda bajo 2 s. Pero la promesa no es el promedio: es el p95.
:::

### El p95, con una simulación

El p95 no tiene una fórmula tan limpia, así que se simula. Este programa genera 200,000 preguntas que llegan al azar en la hora pico del despacho y compara dos formas de repartirlas: **al azar** (cada GPU recibe su parte, sin mirar si está ocupada) y **a la más libre** (el balanceador manda cada pregunta a la GPU que antes se desocupa). La segunda es la idea de *least outstanding requests* que ves en [Balanceadores, proxies y gateways](https://sensei.trueml.app/balanceo/): mandar a la copia con [[menos-pendientes|menos trabajo pendiente]]. Es la fila única del banco contra una fila por caja del súper, que Sensei también mide; aquí se mide con los prefills del despacho.

```python
import random
lam = 200 * 15 / (10 * 3600) * 2.5        # 0.208 preguntas/s en la hora pico

def p95(prefill, copias, reparto, n=200_000):
    random.seed(7)
    t, libre, ttft = 0.0, [0.0] * copias, []
    for _ in range(n):
        t += random.expovariate(lam)                       # llegadas al azar
        if reparto == "al azar":
            j = random.randrange(copias)
        else:                                              # a la copia más libre
            j = min(range(copias), key=lambda q: libre[q])
        libre[j] = max(t, libre[j]) + prefill              # espera y luego su prefill
        ttft.append(libre[j] - t)
    return sorted(ttft)[int(n * 0.95)]

for nombre, prefill, copias in (("3 L40S", 2.38, 3), ("4 L40S", 2.38, 4),
                                ("2 PRO 6000 Server", 1.724, 2)):
    for reparto in ("al azar", "a la más libre"):
        print(f"{nombre:18} {reparto:15} p95 = {p95(prefill, copias, reparto):.2f} s")
```

```salida
3 L40S             al azar         p95 = 4.24 s
3 L40S             a la más libre  p95 = 2.38 s
4 L40S             al azar         p95 = 3.94 s
4 L40S             a la más libre  p95 = 2.38 s
2 PRO 6000 Server  al azar         p95 = 3.13 s
2 PRO 6000 Server  a la más libre  p95 = 1.77 s
```

La tabla tiene tres lecciones.

**Con reparto al azar, ninguna opción cumple.** 3 L40S: p95 ≈ 4.2 s, más del doble de la promesa; una cuarta apenas lo baja a ≈ 3.9 s. 2 Server Edition: ≈ 3.1 s. Las GPUs pasan solo 16–18 % del tiempo en prefills, y aun así la mala suerte de las llegadas le pega a 1 de cada 20.

**El reparto vale más que una GPU extra.** A la más libre, el p95 de 3 L40S queda en 2.38 s: el prefill solo. El de 2 Server Edition, en 1.77 s: **dentro** de la promesa, y ≈ 1.94 s con la red y la búsqueda del paso 3: en el filo. Es la palanca más barata, y no es del hardware: es del gateway que va delante, tema de [Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/).

**Con la L40S, el piso es el prefill.** Ningún reparto baja de 2.38 s. Con L40S y prompts de 6,000 tokens, la promesa no se cumple; ya lo decía la ficha del despacho.

:::figura requisitos-hardware-cola
El TTFT de cada opción contra la promesa de 2 s: sin fila, el p95 con reparto al azar, el p95 con reparto a la más libre y una cota pesimista. Solo quedan bajo la línea las dos barras más bajas de la Server Edition, y la segunda por poco.
:::

:::ojo
Es un modelo simple. Supone un prefill a la vez por GPU que el decode no frena; en vLLM, con [[batching-continuo|batching continuo]] y [[chunked-prefill|chunked prefill]], el prefill se mezcla con el decode de las demás y tarda un poco más. No tiene ráfagas: si en la hora pico llegara el doble, el p95 de 3 L40S al azar subiría a ≈ 5.3 s (simulado). Y supone que el balanceador sabe cuál GPU está más libre; en la práctica se aproxima contando las peticiones abiertas. El número final sale de la prueba de carga del piloto, tema de la lección «Pruebas de carga y benchmarks honestos».
:::

### Las palancas, de la más barata a la más cara

Las palancas que bajan el p95 del TTFT, de la más barata a la más cara:

1. **Repartir a la más libre.** Configurar el gateway; en el modelo, baja el p95 casi hasta el prefill.
2. **Menos tokens de entrada.** Tres fragmentos en vez de cinco: ≈ 3,500 tokens y ≈ 1.34 s de prefill en la L40S. Hay que comprobar con el examen de 200 preguntas que las respuestas no empeoran.
3. **Aflojar la promesa.** Un p95 de 3 s quizá sea aceptable para una pregunta que antes costaba una hora de buscar. Es una conversación con el cliente, no una cuenta.
4. **Más cómputo por GPU.** Baja el piso. Es la cara.
5. **Más GPUs.** Con reparto al azar, de 3 a 4 L40S el p95 baja ≈ 0.3 s. Es la que más se pide y la que menos rinde para el TTFT.

:::profundo Una cota pesimista: la cola M/M/1
La simulación supone que todos los prefills duran lo mismo, porque todos los prompts son de ≈ 6,000 tokens. Si los prompts variaran mucho, la espera crece. El caso extremo es suponer que el servicio dura un tiempo al azar con distribución exponencial (una cola M/M/1), y para esa cola sí hay una fórmula cerrada del percentil de la espera.

:::formula El p95 del TTFT en una cola M/M/1
t_{95} = t_{pre} + frac{ln(ρ ÷ 0.05)}{1 ÷ t_{pre} − λ ÷ k}
- ρ: la ocupación por prefills de cada GPU, como arriba (si es menor que 0.05, la espera del p95 es cero)
- 1 ÷ t_{pre} − λ ÷ k: lo que la GPU atiende por segundo menos lo que le llega
- t_{95}: el TTFT del p95, con la espera de la fila
:::

Con 3 L40S: \(ρ\) = 0.165, y 2.38 + ln(3.31) ÷ (0.420 − 0.069) = 2.38 + 1.196 ÷ 0.351 ≈ **5.8 s**. Con 2 Server Edition, ≈ **4.4 s**. Es una cota pesimista, porque los prefills del despacho son casi iguales, no exponenciales. La verdad para reparto al azar está entre la simulación (4.2 s y 3.1 s) y esta cota. Por eso conviene presentarlo como un rango, no como un número.
:::

## Paso 7: los candidatos de hardware {Step 7: hardware candidates}

El último paso es repetir los pasos 4 a 6 con cada GPU candidata y ponerlas lado a lado. Las especificaciones de cada una viven en el [catálogo](/herramientas/catalogo/) (con su fuente y su fecha); aquí van solo los resultados con el despacho, calculados con las fórmulas de la herramienta y las mismas eficiencias.

| GPU | Prefill, \(t_{pre}\) | Techo de memoria (8,192) | Techo de ancho de banda | Capacidad, \(b\) | GPUs para 5.7 | Para las 8 de diseño | Con N+1 (5.7) |
|---|---|---|---|---|---|---|---|
| L40S | 2.38 s | 10 | 6 | 2 | 3 | 4 | 4 |
| RTX PRO 6000 Server Edition (cómputo derivado) | 1.72 s | 30 | 22 | 6 | 1 | 2 | 2 |
| RTX PRO 6000 Workstation Edition | 1.71 s | 30 | 26 | 7 | 1 | 2 | 2 |
| H100 PCIe | 1.14 s | 23 | 30 | 10 | 1 | 1 | 2 |
| H100 SXM | 0.87 s | 23 | 59 | 17 | 1 | 1 | 2 |

Cómo leerla:

- **El prefill ordena la tabla.** El TTFT sin fila va de 2.38 s a 0.87 s, y decide si la promesa de 2 s se puede cumplir: las H100 con holgura, las RTX PRO 6000 justas.
- **La capacidad crece más que el ancho de banda.** La H100 SXM tiene ≈ 3.9 veces el de la L40S y atiende 8.5 veces más: el paso fijo \(a_0\) se encoge y lo que sobra se reparte entre muchas más.
- **Para el despacho, todas sobran salvo la L40S.** Una sola H100 o RTX PRO 6000 basta y la segunda es el repuesto. La pregunta pasa a ser «cuál cuesta menos por la promesa que compro», la de [Comprar hardware](/comprar-hardware/) y la [herramienta de TCO](/herramientas/tco/).

La decisión del despacho, que esta lección no cambia: **cotizar dos opciones**, 3 L40S (el sizing de la ficha; 4 con repuesto) y 2 RTX PRO 6000 Server Edition, y que el piloto decida con mediciones. La decisión final va en el caso del despacho.

### El método completo, en Python

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

## Si cambian el modelo o los requisitos {If the model or the requirements change} [extra]

Un sizing bien hecho se rehace en minutos, y el cliente siempre cambia algo. Los cambios que el despacho va a preguntar, con las fórmulas de la herramienta:

**Menos fragmentos (3 en vez de 5).** El prompt baja de 6,000 a ≈ 3,500 tokens (≈ 400 de instrucciones, ≈ 100 de pregunta y 3 de ≈ 1,000). El prefill de la L40S baja a **1.34 s**, la capacidad sube de 2 a **4** y bastan **2 L40S** (3 con repuesto). En la simulación, con 2 L40S el p95 del TTFT queda en ≈ 2.3 s con reparto al azar y ≈ 1.34 s a la más libre. Es el cambio que más mueve el resultado, y el que más hay que validar: si las respuestas pierden su cita correcta, no sirve.

**Aflojar el TTFT a 3 s en el p95.** La capacidad no cambia (la herramienta dimensiona por velocidad de escritura), pero la promesa sí se vuelve alcanzable: 3 L40S con reparto a la más libre dan ≈ 2.4 s de p95, ≈ 2.55 s con la red y la búsqueda. Con reparto al azar, 4.2 s: no.

**Subir la velocidad a 30 tokens por segundo.** En la L40S, leer los pesos 30 veces ya se come el 96 % de cada segundo: no queda lugar ni para una conversación. La Server Edition atiende 3, y hacen falta 2. Pedir más velocidad de escritura castiga mucho más a las GPUs de poco ancho de banda.

**Qwen3 30B-A3B, un MoE.** Un modelo de mezcla de expertos ([[moe|MoE]]): de sus ≈ 30.5 mil millones de parámetros, cada token usa ≈ 3.3 mil millones (sus [[parametros-activos|parámetros activos]]). En INT4 de AWQ pesa ≈ 16.8 GB y su prefill en la L40S baja a ≈ 0.3 s. La capacidad es incierta: 29 si cada paso lee solo los expertos que usa (la herramienta), ≈ 13 si con muchas conversaciones termina leyendo casi todos. Con cualquiera, **1 L40S** basta (2 con repuesto). La pregunta ya no es el hardware: es si contesta igual de bien en el examen de 200 preguntas, el tema de [Elegir un modelo para la tarea](/elegir-modelo/).

**Llama 3.3 70B.** En FP8 pesa ≈ 72.7 GB: no cabe en una L40S y hacen falta 2 por copia ([Varias GPUs: tensor y pipeline parallel](/varias-gpus/)). Aun así, leer 72.7 GB por paso con el ancho de banda de las dos tarda ≈ 60 ms, más de los 50 ms de la promesa: **ni una conversación** llega a 20 tokens por segundo. En una Server Edition sola, ≈ 65 ms: tampoco. En INT4 de AWQ (≈ 39.8 GB) sí: **6 L40S** (3 copias de 2), 6 Server Edition (capacidad de 1, por un prefill de ≈ 3.6 s) o **1 H100 SXM**. Las cuentas con 2 GPUs por copia suponen que repartir el modelo no cuesta; con PCIe sí, y la lección de varias GPUs lo mide.

:::nota La regla de bolsillo
Para cada cambio, pregunta qué letra mueve. Tokens de entrada: \(t_{pre}\) y \(a_1\). Velocidad: el \(v × a_0\) fijo. Modelo: \(W\), \(A\) y \(m\). Tráfico: solo \(c\). Las GPUs siguen al techo que se movió.
:::

## Defender el número ante el cliente {Defending the number to the client} [extra]

Al socio director no le vas a enseñar fórmulas, sino una página que aguante que la lea su experto de TI, que la comparen con otra cotización y que dentro de un año alguien pregunte «¿por qué compramos esto?».

### Lo que lleva la página

1. **El requisito y el perfil, en números.** 200 personas, 15 preguntas al día, pico de 2.5, 6,000 y 500 tokens, TTFT ≤ 2 s en el p95, ≥ 20 tokens/s; ≈ 0.21 preguntas por segundo y ≈ 5.7 conversaciones a la vez. Y cuáles son supuestos («las 15 preguntas se miden en el piloto»).
2. **El cuello de botella, con nombre.** «Con L40S, el tiempo de la GPU entre leer los pesos y leer los prompts. La memoria sobra.»
3. **Las opciones, con lo que compra cada una.** 3 L40S: el mínimo, sin repuesto. 4 L40S: repuesto, o las 8 conversaciones de diseño. 2 RTX PRO 6000 Server Edition: repuesto y las 8 de diseño, con prefill de 1.72 s. Cada una con su TTFT esperado como **rango** (sin fila, con fila al azar, con reparto a la más libre).
4. **La sensibilidad.** «Si preguntan 30 veces al día en vez de 15, son 6 L40S o 2 Server Edition.» Es lo que convierte una estimación en una decisión: el cliente ve cuánto arriesga con cada opción.
5. **Lo que decide el piloto.** Medir \(r\), \(k_{pico}\), las eficiencias reales y el p95 de punta a punta, con una prueba de carga con el perfil del despacho.

### Contrastar con lo publicado

El experto de TI va a preguntar «¿y esto de dónde sale?». El método no es invento de esta lección:

- **NVIDIA** describe en su blog de benchmarking de inferencia («LLM Inference Benchmarking: How Much Does Your LLM Inference Cost?») el mismo camino: medir la curva de rendimiento contra latencia de una unidad de despliegue, descartar los puntos que rompen la latencia, estimar el pico de peticiones por segundo (subraya que usuarios no es concurrencia) y dividir. La diferencia es que ahí la capacidad por instancia **se mide**; aquí se calcula como primera estimación. Su documentación de métricas define el TTFT con la cola, el prefill y la red incluidos, como el paso 3.
- **Databricks** («LLM Inference Performance Engineering: Best Practices») mide que el decode a lotes chicos lo predice el ancho de banda de memoria, y define la utilización del ancho de banda (*MBU*) igual que \(η_m\). En su ejemplo de un modelo de 7 mil millones de parámetros sale ≈ 50 %: el 0.7 de la herramienta es un supuesto, no esa medición.
- **Red Hat** publicó en MLPerf Inference v4.1 un servidor con **4 L40S** sirviendo Llama 2 70B en FP8 con vLLM 0.5.1, como dos réplicas de 2 L40S: 1,469 tokens por segundo a 4.97 peticiones por segundo con TTFT ≤ 2 s y 200 ms por token. La cuenta de la herramienta con ese modelo da el mismo orden de magnitud, pero el largo de los prompts de esa prueba no está en la fuente, y sin él no se puede validar a ±20 %. Honestamente: no la contradice, no la confirma.
- **Un blog de Hugging Face** (junio de 2026, de un tercero) midió Gemma-4 31B en FP8 con vLLM 0.20 en una RTX PRO 6000 de 96 GB: con 12 a 24 peticiones a la vez, TTFT de 0.73 s en el p50 y **2.82 s en el p95**. El p95 casi cuatro veces el p50 en una GPU bajo carga continua: la misma lección de la cola, medida.

Ninguno de esos números es el del despacho: otro modelo, otra cuantización, otros prompts. Sirven para decir «el método es el estándar y el orden de magnitud cuadra», no para sustituir la medición. Para eso está `vllm bench serve` con el perfil propio, que es el tema de la lección «Pruebas de carga y benchmarks honestos».

## Errores comunes {Common mistakes}

1. **Dimensionar con usuarios en vez de conversaciones a la vez.** «Son 200, necesito 200 lugares». En la hora pico del despacho son ≈ 5.7. **Cómo evitarlo:** pasa de personas a preguntas por segundo con el factor de pico, y de ahí a conversaciones con la ley de Little.
2. **Dimensionar con el promedio del día.** Con el promedio salen ≈ 2.3 conversaciones a la vez y 2 L40S; a las 10 de la mañana, la fila crece. **Cómo evitarlo:** usa siempre la hora pico, y escribe de dónde salió el factor.
3. **Tomar el TTFT sin fila como el p95.** «La herramienta dice 2.38 s» es el prefill con la GPU libre; el p95 con reparto al azar es ≈ 4.2 s. **Cómo evitarlo:** presupuesto de latencia de punta a punta y una simulación o un modelo de cola; al final, medir.
4. **Quedarse con el techo más alto que suena bien.** «Caben 10 en la memoria, compro 1 L40S». La memoria no manda: el prefill y el ancho de banda comparten la GPU y dejan 2. **Cómo evitarlo:** calcula los tres techos y la mezcla, y nombra el cuello de botella.
5. **Sumar GPUs para arreglar el TTFT.** De 3 a 4 L40S el p95 baja ≈ 0.3 s; repartir a la más libre lo baja casi 2 s. **Cómo evitarlo:** antes de comprar, mueve las palancas baratas: reparto, menos tokens, una promesa razonable.
6. **Meter los resúmenes en el sizing interactivo sin decirlo.** Un 5 % de resúmenes de 40,250 tokens sube el prefill medio ≈ 45 %, y ni siquiera caben con un tope de 8,192. **Cómo evitarlo:** un perfil por tarea; las de lote, en otra fila o de noche.
7. **Presentar el número sin sus supuestos.** «3 L40S» sin decir «con 15 preguntas, sin repuesto, con eficiencias supuestas» es una promesa que no se puede revisar. **Cómo evitarlo:** la página del paso anterior, con sensibilidad y con lo que mide el piloto.

## En la vida real {In real life} [extra]

**El despacho.** Del «somos 200 y queremos que sea rápido» salen ≈ 0.21 preguntas por segundo en el pico y ≈ 5.7 conversaciones a la vez, que leen 1,250 tokens por segundo. Una L40S aguanta 2 (por memoria cabrían 10): el mínimo es **3 L40S**, el resultado de la herramienta de sizing, con holgura de 1.05×; con repuesto o para las 8 de diseño, 4. La alternativa son **2 RTX PRO 6000 Server Edition**: una atiende el promedio y la otra es el repuesto. Ninguna opción garantiza el TTFT ≤ 2 s en el p95 con reparto al azar (≈ 4.2 s y ≈ 3.1 s); con reparto a la más libre, la Server Edition queda en el filo (≈ 1.8 s, ≈ 1.9 s con red y búsqueda) y la L40S en su piso de 2.38 s. El despacho cotiza las dos y el piloto decide.

**Una clínica con picos al abrir consultas.** Supuestos del ejemplo: 60 médicos que dictan 20 notas al día en 8 horas, con prompts de ≈ 2,000 tokens y notas de ≈ 300; Qwen3 32B en INT4 en una L40S. Lo que cambia es el pico: a las 8:00, cuando abren las consultas, llega **4 veces** el promedio. Con eso, \(λ\) ≈ 0.17 por segundo y ≈ 2.6 conversaciones a la vez; con prompts cortos el prefill baja a ≈ 0.75 s y una L40S aguanta 5. **1 L40S** basta, y una segunda como repuesto. Si el descubrimiento hubiera usado un pico de 2, el resultado sería el mismo: aquí el supuesto no mueve la decisión, y eso también hay que saberlo.

**Una fábrica con turnos de 24 horas.** Supuestos: 300 operarios que consultan manuales 6 veces al día, repartidos en las 24 horas, con un pico de 1.5 en los cambios de turno, prompts de ≈ 3,000 tokens y respuestas de ≈ 300. Son ≈ 0.03 preguntas por segundo y **media conversación** a la vez: la capacidad sobra con una sola GPU. Lo que manda aquí es el N+1: a las 3 de la mañana no hay nadie de TI, y si la única GPU falla, la línea se queda sin manuales hasta el día siguiente. El sizing de esta fábrica se decide por disponibilidad, no por carga.

**Una financiera con un trabajo por lotes de noche.** Supuestos: cada noche hay que extraer datos de 50,000 documentos de ≈ 3,000 tokens, con respuestas de ≈ 200, en una ventana de 6 horas. Nadie espera el primer token: no hay TTFT que cumplir, solo terminar antes de las 6:00. Aquí manda el **throughput**. En una L40S, cada documento cuesta ≈ 1.14 s de prefill y, en decode con 26 a la vez (lo que cabe en la memoria), ≈ 0.51 s más: ≈ 1.65 s de GPU por documento, sin contar que el prefill y el decode se pueden traslapar. Son ≈ 23 horas de GPU por noche: **4 L40S** para la ventana de 6 horas. La misma GPU que en el despacho atiende 2 conversaciones, aquí procesa ≈ 2,200 documentos por hora.

## Ejercicios {Exercises}

:::ejercicios
? [facil] El despacho descubre que su hora pico es de **4 veces** el promedio, no de 2.5. Con todo lo demás igual (y \(t_{pre}\) = 2.38 s), ¿cuántas conversaciones a la vez hay en el pico y cuántas L40S hacen falta como mínimo?
\(λ\) = 200 × 15 ÷ 36,000 × 4 = 0.0833 × 4 ≈ **0.333 por segundo**. \(c\) = 0.333 × (2.38 + 25) = 0.333 × 27.38 ≈ **9.13**. Con \(b\) = 2 por L40S: ⌈9.13 ÷ 2⌉ = ⌈4.56⌉ = **5 L40S**. El factor de pico es un supuesto que mueve el resultado: vale la pena medirlo.
? [facil] Un contrato de 20 páginas a espacio sencillo, en español. ¿Cuántos tokens ocupa, con \(f\) = 1.61? ¿Cabe en una conversación del despacho con tope de 8,192?
\(N\) = 20 × 500 × 1.61 = **16,100 tokens**. No cabe: es casi el doble del tope. Para preguntar sobre él hay que pasarle fragmentos (como hace el despacho) o subir el tope, con todo lo que eso cuesta en KV cache y en prefill.
? [facil] ¿Qué holgura tienen 4 L40S para el despacho (\(c\) = 5.70, \(b\) = 2)? ¿Aguantan el pico si una falla?
\(H\) = 4 × 2 ÷ 5.70 = 8 ÷ 5.70 ≈ **1.40×**. Si una falla, quedan 3 × 2 = 6 ≥ 5.70: **sí aguantan** el promedio del pico, justo. Es el N+1 de las 3 L40S.
? [medio] Calcula el techo de memoria de la Server Edition con conversaciones de 6,500 tokens (el largo típico), no con el tope de 8,192. ¿Por qué la herramienta usa este y la ficha habla de 8?
Útil para KV: 0.9 × 96 − 19.32 − 2 = 65.08 GB. Una conversación de 6,500: 6,500 × 262,144 ≈ 1.704 GB. ⌊65.08 ÷ 1.704⌋ = ⌊38.2⌋ = **38**. La herramienta usa el largo real de la conversación (prompt + respuesta) porque el servidor reparte el KV cache en bloques según lo que se usa; la ficha diseña con el tope para no quedarse corta. En ninguna de las dos GPUs manda la memoria.
? [medio] Calcula el techo de ancho de banda de una H100 SXM con el despacho (3,350 GB/s, \(η_m\) = 0.7, 50 ms por token). ¿Por qué es casi 10 veces el de la L40S si su ancho de banda es ≈ 3.9 veces?
\(η_m × B\) = 0.7 × 3,350 = 2,345 GB/s. \(a_0\) = 19.32 ÷ 2,345 ≈ 8.24 ms; \(a_1\) = 1.638 ÷ 2,345 ≈ 0.699 ms. \(b_{anch}\) = ⌊(50 − 8.24) ÷ 0.699⌋ = ⌊59.8⌋ = **59**. En la L40S, el paso fijo se come 32 de los 50 ms y quedan 18; en la H100, se come 8 y quedan 42. Lo que sobra crece más que el ancho de banda, porque el costo fijo de leer los pesos se resta primero.
? [medio] El piloto mide **30 preguntas** por persona al día en vez de 15. ¿Cuántas L40S y cuántas Server Edition hacen falta como mínimo y con N+1? (\(t_{pre}\) = 2.38 s y 1.724 s.)
\(λ\) = 200 × 30 ÷ 36,000 × 2.5 ≈ 0.417 por segundo. L40S: \(c\) = 0.417 × 27.38 ≈ 11.41; ⌈11.41 ÷ 2⌉ = **6**, con N+1 **7**. Server Edition: \(c\) = 0.417 × (1.724 + 25) ≈ 11.13; ⌈11.13 ÷ 6⌉ = **2**, con N+1 **3**. Duplicar el uso duplica las L40S, pero la Server Edition absorbe el cambio con la misma segunda tarjeta.
? [medio] Con la fórmula M/D/1, ¿cuál es el TTFT promedio con cola de 4 L40S? Compáralo con el de 3.
\(ρ\) = (0.208 ÷ 4) × 2.38 ≈ 0.124. \(t_{cola}\) = 0.124 × 2.38 ÷ (2 × 0.876) ≈ 0.295 ÷ 1.752 ≈ 0.17 s. \(TTFT_{medio}\) ≈ 2.38 + 0.17 = **≈ 2.55 s**, contra ≈ 2.62 s con 3. Una L40S más mejora el promedio ≈ 0.07 s: el promedio ya casi es el prefill, y el prefill no baja con más GPUs.
? [reto] El despacho quiere meter los resúmenes en la hora pico: 20 % de las peticiones serían resúmenes de 40,250 tokens (prefill ≈ 23.95 s en una L40S) y 80 % preguntas (2.38 s). Con 3 L40S, ¿qué fracción del tiempo de cada GPU se va en prefills? ¿Qué le recomiendas?
Prefill medio: 0.8 × 2.38 + 0.2 × 23.95 = 1.90 + 4.79 ≈ **6.69 s**. Cada L40S recibe 0.208 ÷ 3 ≈ 0.0694 peticiones por segundo: \(ρ\) = 0.0694 × 6.69 ≈ **46 %**, contra 16.5 % solo con preguntas. Casi la mitad del tiempo en prefills: el decode de las demás se cae muy por debajo de 20 tokens por segundo, y cada vez que llega un resumen, las preguntas que caen en esa GPU esperan hasta 24 s. Además, con el tope de 8,192 tokens el resumen ni entra. Recomendación: los resúmenes a una fila aparte, de baja prioridad o de noche, con su propio sizing por throughput.
? [reto] Con 2 Server Edition, ¿se cumple N+1 para las 8 conversaciones de diseño? ¿Y para el promedio del pico? ¿Qué le dirías al cliente?
Con las 2 funcionando: 2 × 6 = 12 ≥ 8 y ≥ 5.57: cumplen las dos. Si una falla: 6 lugares. **Promedio** (5.57): sí, 6 ≥ 5.57, sin holgura (1.08×). **Diseño** (8): no, 6 < 8. Al cliente: «con una tarjeta caída, el servicio sigue en la hora pico promedio, pero en los momentos más llenos algunas respuestas escribirán más despacio de 20 tokens por segundo hasta que se repare. Si eso no es aceptable, es una tercera tarjeta». Y con una sola tarjeta, todas las preguntas caen en la misma fila: el p95 del TTFT simulado sube a ≈ 4.1 s.
? [reto] Diseña la opción más barata en GPUs para el despacho con L40S que cumpla un TTFT de 3 s en el p95 (con red y búsqueda de 170 ms) y tenga repuesto. Puedes cambiar a 3 fragmentos (prompt de ≈ 3,500 tokens) si el examen de calidad lo permite.
Con 5 fragmentos: la capacidad pide 3 L40S y N+1 pide 4; con reparto a la más libre el p95 es ≈ 2.38 + 0.17 = 2.55 s, cumple; con reparto al azar, ≈ 4.2 s, no. Con 3 fragmentos: \(t_{pre}\) = 1.34 s, \(b\) = 4, \(c\) ≈ 5.49, ⌈5.49 ÷ 4⌉ = 2, con N+1 **3 L40S**. El p95 simulado con 2 L40S al azar es ≈ 2.3 s (≈ 2.5 s con red y búsqueda), dentro de los 3 s aun sin reparto inteligente; con 3 L40S, mejor. La opción más barata: **3 L40S con 3 fragmentos**, condicionada a que el examen de 200 preguntas siga en ≥ 85 % con citas correctas. Sin esa validación, 4 L40S con 5 fragmentos y reparto a la más libre.
:::

## Lo que sigue {What comes next} [extra]

- **[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)** contesta lo que esta lección dejó abierto: si las 3 L40S del despacho llevan una copia del modelo cada una o reparten uno solo, y qué cuesta repartir un modelo grande como Llama 3.3 70B entre GPUs conectadas por PCIe.
- **[Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM](/stack-serving/)** pone el número en un programa: qué motor corre en esas GPUs y qué perillas fijan cuántas conversaciones acepta.
- **[Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/)** es donde vive el reparto «a la más libre» que más bajó el p95, junto con las cuotas por persona que salen de la capacidad de este sizing.
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
Repartir a la GPU más libre en vez de al azar: en 3 L40S, de ≈ 4.2 s a ≈ 2.4 s sin comprar nada. Después, menos tokens de entrada.
? ¿Por qué los resúmenes de expediente se dimensionan aparte?
Un resumen de 40,250 tokens cuesta ≈ 24 s de prefill (diez preguntas) y no cabe en el tope de 8,192; nadie mira su primer token: se dimensiona por throughput, en otra fila o de noche.
:::
