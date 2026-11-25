---
titulo: Cuántas GPUs hacen falta
en: GPU sizing calculator
subtitulo: De cuántas personas usan el sistema, cuánto preguntan y qué tan rápido quieres que conteste, a cuántas GPUs comprar o rentar y de cuál tipo, con la cuenta completa.
pregunta: Un cliente tiene 200 personas que van a usar un LLM privado. ¿Cuántas GPUs necesita, y cuáles?
sensei: latencia, llms, flops
---

:::idea
Dimensionar es contestar tres preguntas en orden. **¿Cuántas conversaciones hay a la vez en la hora pico?** Sale del tráfico: personas, preguntas al día y lo que dura cada respuesta. **¿Cuántas aguanta una copia del servidor?** Sale de la GPU: cuántas caben en su memoria y cuántas puede atender sin bajar de la velocidad que prometiste. **¿Cuántas copias?** La primera entre la segunda, hacia arriba. Esta página explica cada paso desde cero y la calculadora lo repite para cada GPU del catálogo, para que veas cuál conviene.
:::

## Qué responde esta calculadora {What this calculator answers}

Cuando un cliente pregunta «¿cuántas GPUs necesito?», casi nunca sabe contestar «¿cuántas conversaciones a la vez?». Sabe otras cosas: cuántas personas lo van a usar, más o menos cuánto, en qué horario y qué tan rápido lo quiere. Esta calculadora traduce eso a GPUs.

Piensa en un restaurante que va a abrir. El dueño no sabe cuántas mesas necesita, pero sí cuántos clientes espera al día, a qué hora llegan y cuánto tarda cada uno en comer. Con eso, y sabiendo cuántas mesas atiende cada mesero, se calcula cuántos meseros contratar. Aquí los clientes son preguntas, las mesas son conversaciones abiertas y los meseros son copias del servidor.

Usa las fórmulas de las otras dos herramientas: la memoria de «¿Cabe en la GPU?» y la velocidad de «Qué tan rápido contesta». Lo nuevo es el tráfico.

## Del tráfico a conversaciones a la vez {From traffic to concurrent conversations}

### Las preguntas por segundo {Requests per second}

Si 200 personas hacen 20 preguntas al día cada una, son 4,000 preguntas. Pero no llegan repartidas en las 24 horas: llegan en horario de oficina, y unas horas más que otras. Por eso hay dos ajustes:

- **Las horas de tráfico, \(H\).** En una oficina, unas 8. Las 4,000 preguntas en 8 horas son 0.14 por segundo.
- **El [[factor-de-pico|factor de pico]], \(k_{pico}\).** La hora más cargada contra el promedio. A las 10 de la mañana llegan más que a las 3 de la tarde. Un factor de 2 quiere decir que en la hora pico llega el doble del promedio.

:::formula Las preguntas por segundo en la hora pico
λ = U × r ÷ (H × 3,600) × k_{pico}
- U: las personas que usan el sistema
- r: las preguntas que hace cada una al día
- H: las horas del día en que llega casi todo el tráfico
- 3,600: los segundos de una hora
- k_{pico}: la hora más cargada entre el promedio
- λ: las preguntas que llegan por segundo en la hora pico (la letra griega lambda)
:::

Se dimensiona para el pico, no para el promedio: un sistema que aguanta el promedio se cae todos los días a las 10.

### La ley de Little {Little's law}

Ya sabes cuántas preguntas llegan por segundo. ¿Cuántas están abiertas al mismo tiempo? Depende de cuánto dura cada una. Si en una fila llegan 2 personas por minuto y cada una tarda 5 minutos en ser atendida, en promedio hay 10 personas dentro. Eso es la [[ley-de-little|ley de Little]], de la lección «Latencia y throughput» de Sensei:

:::formula Conversaciones a la vez
c = λ × N_o ÷ v
- λ: las preguntas por segundo en el pico
- N_o ÷ v: lo que dura cada respuesta, en segundos: sus tokens entre la velocidad a la que se escriben
- v: la velocidad objetivo de cada conversación, en tokens por segundo
- c: las conversaciones que el servidor tiene abiertas a la vez, en promedio, durante el pico
:::

Ojo con la palabra «a la vez». No son las personas conectadas, ni las que tienen la ventana abierta: son las que están recibiendo una respuesta en ese segundo. Doscientas personas en una oficina casi nunca son más que unas cuantas conversaciones simultáneas.

:::cuenta El despacho: 200 abogados
Preguntas al día // 200 personas × 20 preguntas (supuesto del ejemplo) | 200 × 20 | 4,000
Por segundo, promedio // en 8 horas | 4,000 ÷ (8 × 3,600) | 0.139
En la hora pico, \(λ\) // factor de pico de 2 | 0.139 × 2 | 0.278 por segundo
Lo que dura cada respuesta // 500 tokens a 15 tokens/s | 500 ÷ 15 | 33.3 s
Conversaciones a la vez, \(c\) | 0.278 × 33.3 | **≈ 9.3**
= Doscientos abogados, en su peor hora, son unas 9 conversaciones abiertas. Eso es lo que hay que dimensionar.
:::

## Cuántas aguanta una copia {How many one copy can serve}

Una **copia del servidor** es un modelo cargado y atendiendo: una GPU, o varias que se reparten el modelo. Aguanta tantas conversaciones como permita el menor de dos límites.

### El límite de la memoria {The memory limit}

Es la cuenta de «¿Cabe en la GPU?»: lo que queda de la [[vram|VRAM]] después de los pesos y el programa, entre el [[kv-cache|KV cache]] de una conversación completa (prompt más respuesta). Si el modelo ni siquiera cabe en una GPU con una conversación, la calculadora sube las GPUs por copia a 2, 4 u 8, que son las formas comunes de repartir un modelo.

### El límite de la velocidad {The speed limit}

Este es el que casi siempre manda. De «Qué tan rápido contesta»: cada paso de decode lee los pesos una vez y el KV cache de cada conversación. Con más conversaciones, el paso tarda más y cada una recibe menos tokens por segundo. Prometer 15 tokens por segundo quiere decir que el paso no puede pasar de 1 ÷ 15 = 67 ms.

Pero hay un detalle: la copia también tiene que leer los prompts nuevos (el [[prefill]]), y mientras lo hace, no escribe. Es como un mesero que, además de servir, tiene que tomar las órdenes de las mesas que llegan. Cada conversación nueva le roba un rato.

:::formula Las conversaciones que mantienen la velocidad
v × (a_0 + a_1 × b) + b × v × t_{pre} ÷ N_o ≤ 1
b_{vel} = (1 − v × a_0) ÷ (v × a_1 + v × t_{pre} ÷ N_o)
- a_0: el tiempo fijo de cada paso: leer los pesos, \(W ÷ (n × W_{GPU} × η_m)\)
- a_1: lo que cada conversación le suma al paso: leer su KV cache a media respuesta
- v: la velocidad objetivo; en un segundo hay \(v\) pasos
- t_{pre}: el tiempo del prefill de un prompt nuevo
- b × v ÷ N_o: los prompts nuevos que llegan por segundo a una copia con \(b\) conversaciones, cada una de \(N_o\) tokens
- b_{vel}: las conversaciones que caben en un segundo sin pasar de él; se redondea hacia abajo
:::

La primera línea dice: en cada segundo, los \(v\) pasos de decode más los prefills de las conversaciones que llegan no pueden pasar de un segundo. La segunda es la misma, despejando \(b\). La calculadora también revisa que el cálculo de cada paso no pase a la memoria (el [[roofline]] de la otra herramienta) y se queda con el límite más bajo.

:::cuenta Una copia en una L40S, Qwen3 32B en INT4 de AWQ
Pesos, \(W\) // de «¿Cabe en la GPU?» | (32.762 − 1.556) × 4.156 ÷ 8 + 1.556 × 2 | 19.32 GB
Una conversación completa // 256 KiB por token × 3,500 tokens | 262,144 × 3,500 | 0.918 GB
Límite de memoria // 90 % de 48 GB, menos pesos y 2 GB de programa | ⌊(43.2 − 19.32 − 2) ÷ 0.918⌋ | 23
Paso fijo, \(a_0\) // 864 GB/s, \(η_m\) = 0.7 | 19.32 ÷ (864 × 0.7) | 31.9 ms
Cada conversación, \(a_1\) // KV cache a media respuesta: 3,250 tokens | 262,144 × 3,250 ÷ (864 × 0.7) GB/s | 1.41 ms
Un prompt de 3,000 tokens, \(t_{pre}\) // 2.06 × 10¹⁴ FLOPs, 362 TFLOPS, \(η_c\) = 0.5 | 2.06 × 10¹⁴ ÷ (362 × 10¹² × 0.5) | 1.14 s
Límite de velocidad // \(v\) = 15 | (1 − 15 × 0.0319) ÷ (15 × 0.00141 + 15 × 1.14 ÷ 500) | ⌊9.4⌋ = 9
Por copia, \(b\) | mín(23, 9) | **9 conversaciones**
= Cabrían 23 en la memoria, pero solo 9 reciben 15 tokens por segundo. En esta GPU manda la velocidad: el ancho de banda, no la VRAM.
:::

## Cuántas copias y cuántas GPUs {How many copies and GPUs}

Con las conversaciones a la vez y las que aguanta cada copia, lo demás es dividir y redondear hacia arriba: no existen 1.03 copias.

:::formula Las GPUs
k = ⌈ c ÷ b ⌉
G = k × n
- c: las conversaciones a la vez en el pico
- b: las que aguanta una copia
- ⌈ ⌉: redondear hacia arriba
- k: las copias del servidor
- n: las GPUs de cada copia
- G: las GPUs en total
:::

En el despacho: ⌈9.3 ÷ 9⌉ = 2 copias de una L40S cada una, **2 GPUs**. Y si el sistema no se puede caer, una copia más: si una GPU falla, las demás tienen que aguantar el pico solas. Eso se llama redundancia N+1, y en un cliente real casi siempre se pide.

:::calculadora sizing
La tabla de abajo repite tu tráfico en cada GPU de gpus.json, ordenada de menos a más GPUs: así contestas «de cuál tipo». Las columnas de dinero usan el precio de compra de referencia y la renta más barata de gpus.json, cada una con su fecha y fuente en el catálogo.
:::

## De cuál tipo {Which kind}

La tabla de la calculadora contesta una pregunta que el cliente casi nunca hace bien: «¿me conviene una GPU grande o varias chicas?». Con el despacho se ve el patrón:

- **Las GPUs con mucho ancho de banda piden menos.** Una H100 aguanta las 9 conversaciones sola; una L4, con 300 GB/s, necesita dos para que quepa el modelo y aun así atiende pocas conversaciones por copia.
- **La memoria rara vez manda en tráfico de oficina.** Casi siempre sobra VRAM y falta velocidad. Por eso comprar la GPU con más memoria «por si acaso» no es la mejor regla: mira primero los GB/s.
- **El precio por GPU no es el precio por conversación.** Dos GPUs baratas pueden salir más caras que una cara, y al revés. Compara la columna de dinero, no el precio de cada tarjeta.

Elegir la GPU también depende de cosas que la tabla no ve: si se consigue, si cabe en el servidor que ya tienen, cuánto consume y si el modelo que quieren tiene buen soporte en ella. Esas son de la lección «Comprar hardware».

## Lo que la calculadora no cuenta {What it leaves out} [extra]

- **La fila del TTFT.** La calculadora asegura la velocidad del texto, pero en el pico un prompt puede esperar a que la copia termine otro. Con la carga de prefill baja (en el despacho, ≈ 3 % del tiempo por conversación), la espera es corta; con prompts muy largos, crece. Si el TTFT importa mucho, deja holgura: usa una velocidad objetivo un poco más alta.
- **Conversaciones de largo distinto.** Supone que todas tienen el mismo prompt y la misma respuesta. Con mezclas (unas de 500 tokens, otras de 30,000), las largas mandan sobre la memoria.
- **El batching real.** vLLM y los demás servidores arman el batch solos y no siempre llegan al óptimo; la eficiencia \(η_m\) ya absorbe una parte.
- **Las ráfagas.** El factor de pico promedia la hora más cargada. Dentro de esa hora hay minutos peores. Para eso es la copia de sobra.
- **Modelos MoE con muchas conversaciones.** Con un batch grande, Qwen3 30B-A3B termina leyendo casi todos sus expertos en cada paso: la calculadora le da una velocidad optimista. Para un MoE, pon \(A\) más cerca de \(P\) conforme crezca \(b\).

## Errores comunes {Common mistakes}

1. **Dimensionar por usuarios registrados.** 200 usuarios no son 200 conversaciones a la vez. **Cómo evitarlo:** usa la ley de Little con el tráfico de la hora pico.
2. **Dimensionar por el promedio del día.** Si el tráfico se reparte en 24 horas en vez de 8, y sin factor de pico, sale 6 veces menos. **Cómo evitarlo:** pon las horas reales y un factor de pico de 2 a 3 si no tienes datos.
3. **Ver solo la memoria.** «Caben 23 conversaciones, así que una GPU basta». Caben, pero a 15 tokens por segundo solo van 9. **Cómo evitarlo:** el número por copia es el menor de los dos límites.
4. **Olvidar el prefill.** Con prompts largos (RAG con muchos documentos), leer los prompts se come una parte grande del tiempo de la GPU. **Cómo evitarlo:** pon el prompt real, con todo el contexto que se le agrega.
5. **Prometer una velocidad sin preguntar para qué.** 15 tokens por segundo se leen cómodos; 50 solo hacen falta si otra máquina lee la respuesta. Cada punto de más cuesta GPUs. **Cómo evitarlo:** acuerda la velocidad con el cliente antes de cotizar.
6. **No dejar una copia de sobra.** Con 2 GPUs justas, una falla y el sistema no aguanta el pico. **Cómo evitarlo:** suma una copia si el servicio importa.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Una clínica tiene 50 médicos que hacen 10 preguntas al día cada uno, en 10 horas, con un factor de pico de 3. ¿Cuántas preguntas por segundo llegan en la hora pico?
\(λ\) = 50 × 10 ÷ (10 × 3,600) × 3 = 500 ÷ 36,000 × 3 ≈ **0.042 por segundo**, una cada 24 segundos. (Los números de la clínica son un supuesto del ejercicio.)
? [facil] En la misma clínica, cada respuesta tiene 400 tokens y se promete 20 tokens por segundo. ¿Cuántas conversaciones hay a la vez en el pico?
Cada respuesta dura 400 ÷ 20 = 20 s. Con Little: \(c\) = 0.042 × 20 ≈ **0.83**. Menos de una conversación a la vez: una sola copia del servidor sobra, y la pregunta pasa a ser cuál es la GPU más barata que llega a 20 tokens por segundo con su modelo.
? [medio] En el despacho, ¿cuántas conversaciones a la vez hay si el factor de pico sube a 3 y las respuestas a 800 tokens? ¿Cuántas L40S hacen falta si cada copia aguanta 7?
\(λ\) = 4,000 ÷ 28,800 × 3 ≈ 0.417 por segundo. Cada respuesta dura 800 ÷ 15 ≈ 53.3 s. \(c\) ≈ 0.417 × 53.3 ≈ 22.2. Copias: ⌈22.2 ÷ 7⌉ = **4 L40S**, más una si no se puede caer.
? [medio] Con una velocidad objetivo de 15 tokens por segundo, el paso de decode no puede pasar de 67 ms. Si el paso fijo de una copia es de 32 ms y cada conversación le suma 1.4 ms, sin contar el prefill, ¿cuántas conversaciones caben?
32 + 1.4 × \(b\) ≤ 66.7 → \(b\) ≤ 34.7 ÷ 1.4 ≈ 24.8, o sea **24**. Con el prefill de prompts de 3,000 tokens, la calculadora da 9: leer los prompts se come más de la mitad del tiempo.
? [reto] En el despacho con la L40S, ¿qué pasa si duplicas la velocidad objetivo, de 15 a 30 tokens por segundo? ¿Hacen falta el doble de GPUs?
Con \(v\) = 30, el paso no puede pasar de 33 ms, y solo leer los pesos ya toma 31.9 ms: queda ≈ 1.4 ms para todo lo demás. En la fórmula, \(1 − v × a_0\) = 1 − 30 × 0.0319 ≈ 0.04, casi cero, y con el prefill la cuenta da 0.38: **ninguna conversación** llega a 30 tokens por segundo y la calculadora dice «No llega», aunque la ley de Little ahora pida la mitad de conversaciones (cada respuesta dura la mitad). El costo no crece poco a poco: se dispara cuando te acercas al techo de la GPU. La salida es una GPU con más ancho de banda o pesos más chicos, no más L40S.
:::

## Palabras que vas a oír {Words you'll hear}

:::conceptos
factor-de-pico ley-de-little copia-del-servidor redundancia
:::
