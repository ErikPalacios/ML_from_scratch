---
titulo: API, nube o servidor propio
en: TCO and break-even calculator
subtitulo: Cuánto cuesta al mes el mismo trabajo pagando una API por token, rentando GPUs en la nube o comprando el servidor, con depreciación, luz y personas, y a partir de cuándo conviene cada uno.
pregunta: ¿Le sale más barato al cliente comprar su servidor, rentar GPUs o pagar una API?
sensei: nube, maquinas
---

:::idea
Hay tres formas de darle un LLM a una empresa. **Pagar una API por token:** no compras nada, pagas lo que usas y los datos salen de tu red. **Rentar GPUs en la nube:** pagas cada hora que están prendidas, uses o no el modelo. **Comprar el servidor:** pagas mucho al principio y luego solo luz, espacio y personas. Cuál sale más barata depende casi solo de **cuánto se usa**. El [[tco|costo total]] de cada una se suma con la misma lista, y el [[punto-de-equilibrio|punto de equilibrio]] dice a partir de qué volumen cambia la respuesta.
:::

## Qué responde esta calculadora {What this calculator answers}

En Sensei (lección «Qué es la nube») está la cuenta de comprar o rentar un servidor: el propio cuesta lo mismo cada mes, lo uses o no, y la renta cuesta por hora. Aquí se le suma la tercera opción, la que casi todo cliente compara primero: pagarle a un proveedor por cada token, como OpenAI, Anthropic, Google o los que sirven modelos abiertos (DeepInfra, Fireworks, Together, Groq).

Piensa en cómo se mueve una persona en la ciudad. Puede pedir taxi por viaje (la API), rentar un coche por mes (la nube) o comprarse uno (el propio). Si sale dos veces por semana, el taxi gana. Si maneja todo el día, comprar gana. Y en medio hay un número de kilómetros a partir del cual cambia la respuesta. La calculadora encuentra ese número para tu caso.

Las tres opciones atienden **el mismo trabajo**: los tokens al mes de la empresa. El tráfico es el de la herramienta «Cuántas GPUs hacen falta», y las GPUs, las que ella pidió.

## La API: pagar por token {Paying per token}

Una API cobra por millón de tokens, con dos precios: uno por los de **entrada** (el prompt, con todo el contexto que le mandes) y otro, más caro, por los de **salida** (la respuesta). Escribir cuesta más que leer, por lo que viste en «Qué tan rápido contesta»: cada token de salida es un paso de decode entero.

:::formula La API al mes
M_e = U × r × N_p × D ÷ 10^6
M_s = U × r × N_o × D ÷ 10^6
A = M_e × p_e + M_s × p_s
- U, r: personas y preguntas por persona al día
- N_p, N_o: los tokens de cada prompt y de cada respuesta
- D: los días de uso al mes
- M_e, M_s: los millones de tokens de entrada y de salida al mes
- p_e, p_s: el precio por millón de tokens de entrada y de salida, en US$
- A: lo que cuesta la API al mes
:::

Lo que no se ve en la fórmula: **con una API, los datos salen de la red de la empresa.** Para un despacho, una clínica o un banco, eso puede decidir antes que el costo. Esta calculadora pone el dinero; la decisión completa la ven las lecciones.

Los precios cambian seguido y bajan mucho de un año a otro. Los del archivo de datos son los estándar (sin descuentos por lote ni por caché), del nivel más barato cuando el precio sube con el contexto, cada uno con su fecha y su fuente.

:::cuenta El despacho con Qwen3 32B por API
Preguntas al mes // 200 personas × 15 al día × 22 días (la ficha del despacho de los casos) | 200 × 15 × 22 | 66,000
Tokens de entrada, \(M_e\) // 6,000 por prompt | 66,000 × 6,000 | 396 millones
Tokens de salida, \(M_s\) // 500 por respuesta | 66,000 × 500 | 33 millones
API al mes // DeepInfra, Qwen3 32B: US$0.08 entrada, US$0.28 salida (2026-11-25) | 396 × 0.08 + 33 × 0.28 | **≈ US$41**
Con un modelo cerrado // Claude Sonnet 5.5: US$2 y US$10 (2026-11-25) | 396 × 2 + 33 × 10 | ≈ US$1,122
= El mismo trabajo cuesta 27 veces más con un modelo cerrado de primera que con un modelo abierto servido por un tercero. Elegir el modelo mueve el costo más que elegir el hardware.
:::

## La nube: pagar por hora {Paying per hour}

Rentar GPUs es la cuenta de Sensei: precio por hora × horas. Con \(G\) GPUs, por \(G\). Y aquí se suma algo que la API no tiene: **alguien tiene que operar el modelo.** Instalar el servidor, actualizarlo, vigilarlo, arreglarlo a las 3 de la mañana. Esa persona cuesta lo mismo si la GPU es rentada o propia.

:::formula La nube al mes
R = G × c × h + O_{pers}
- G: las GPUs que pide el trabajo
- c: la renta de cada GPU por hora, en US$
- h: las horas que están prendidas al mes; 730 es el mes entero
- O_{pers}: lo que cuestan al mes las personas que operan el modelo (la parte de su tiempo que le dedican)
- R: lo que cuesta la nube al mes
:::

Una ventaja de rentar: se puede apagar. Si la oficina trabaja 10 horas al día, 22 días, son 220 horas en vez de 730. Pero apagar y prender un modelo grande tarda minutos, y muchos proveedores no garantizan que la GPU siga disponible cuando la vuelvas a pedir.

## El servidor propio: pagar al principio {Paying up front}

El propio es la cuenta de Sensei, \(P = K ÷ V + O\), con tres cosas que aquí se desglosan.

**La [[depreciacion|depreciación]].** Lo que pagas al comprar, \(K\), se reparte en los meses que va a servir, \(V\). Como un coche: vale menos cada año, y al final lo vendes por una parte de lo que costó. Esa parte es el valor de reventa. Las GPUs envejecen rápido: en 3 años hay modelos mucho mejores por el mismo dinero, así que 36 meses es una vida útil común y el valor de reventa, un supuesto que hay que revisar.

**La luz.** Una GPU no consume siempre su máximo: depende de cuánto trabaja. Y el cuarto entero gasta más que los equipos, porque hay que enfriarlos. Esa relación se llama [[pue|PUE]]: lo que gasta todo el cuarto entre lo que gastan los equipos. Un centro de datos moderno anda cerca de 1.2 a 1.5; un cuarto de servidores de oficina con aire acondicionado normal, más.

**La operación.** Espacio, red, mantenimiento y refacciones, más las mismas personas que operan el modelo en la nube.

:::formula El servidor propio al mes
K = G × K_{GPU} + n_s × S
P = K × (1 − v_r) ÷ V + E + O_{esp} + O_{pers}
E = (G × W_{GPU} × u + n_s × W_s) ÷ 1,000 × PUE × 730 × p_{kWh}
- K_{GPU}: la compra de cada GPU; S: el resto de cada servidor; n_s: los servidores, \(⌈G ÷ \) GPUs por servidor\(⌉\)
- v_r: el valor de reventa al final, como parte de \(K\)
- V: la vida útil, en meses
- E: la luz al mes, en US$
- W_{GPU}: el consumo máximo de cada GPU, en watts; u: la parte de ese máximo que usa en promedio
- W_s: lo que consume el resto de cada servidor
- PUE: lo que gasta el cuarto entero entre lo que gastan los equipos
- p_{kWh}: el precio de la luz por kWh
- O_{esp}: espacio, red y mantenimiento; O_{pers}: las personas
:::

Con \(v_r\) = 0 y \(O\) = \(E + O_{esp} + O_{pers}\), es exactamente la de Sensei.

:::cuenta El despacho con 3 L40S propias
Compra, \(K\) // las 3 L40S que pide la herramienta de sizing, a US$9,005 (IT Creations, 2026-11-25), + un servidor de US$8,000 (supuesto) | 3 × 9,005 + 8,000 | US$35,015
Depreciación // 3 años, 20 % de reventa (supuesto) | 35,015 × 0.8 ÷ 36 | US$778 al mes
Consumo promedio // 350 W cada L40S al 60 % + 400 W del resto (supuestos) | 3 × 350 × 0.6 + 400 | 1.03 kW
Luz // PUE de 1.5, US$0.15 por kWh (supuestos) | 1.03 × 1.5 × 730 × 0.15 | US$169 al mes
Propio al mes, \(P\) // + US$200 de espacio y red + US$1,000 de personas (supuestos) | 778 + 169 + 200 + 1,000 | **≈ US$2,147**
Rentadas // 3 L40S a US$1.09 por hora (RunPod, 2026-11-13), todo el mes, + personas | 3 × 1.09 × 730 + 1,000 | ≈ US$3,387
= Para el despacho, la API de Qwen3 32B (US$41) es 52 veces más barata que el servidor propio. En dinero no hay discusión: si eligen IA privada, es por sus datos.
:::

Fíjate dónde se va el dinero del propio: casi la mitad son personas. Si la empresa ya tiene a alguien que opera sus servidores y le dedica un rato, ese costo baja mucho. Si hay que contratar, sube.

## El punto de equilibrio {The break-even point}

El [[punto-de-equilibrio|punto de equilibrio]] es el volumen en que dos opciones cuestan lo mismo. Hay dos que importan.

**Con la API.** El costo de la API crece con los tokens; el del propio, no (mientras tus GPUs aguanten). Así que el propio gana a partir de cierto volumen: el que hace que la API cueste lo mismo que \(P\).

:::formula Los puntos de equilibrio
x^{*} = P ÷ A
h^{*} = (P − O_{pers}) ÷ (G × c)
m^{*} = K ÷ (A − E − O_{esp} − O_{pers})
- x^{*}: cuántas veces tu volumen de hoy hace que la API cueste lo mismo que el propio
- h^{*}: las horas al mes de renta a partir de las que comprar sale más barato (la de Sensei, \(h^{*} = P ÷ c\), con \(G\) GPUs y sin las personas, que pagas igual en las dos)
- m^{*}: los meses en que lo que te ahorras frente a la API paga la compra; si el ahorro no cubre ni los gastos fijos, nunca
:::

\(x^{*}\) tiene una trampa: si el volumen sube 52 veces, también suben las GPUs que hacen falta. Úsalo como señal («estamos lejísimos» o «estamos cerca»), y para el número de verdad vuelve a la herramienta de sizing con el tráfico nuevo.

:::cuenta El mismo despacho, 10 veces más grande y con un modelo cerrado
GPUs // la herramienta de sizing con 2,000 personas: 55.6 conversaciones a la vez, 7 por RTX PRO 6000 Blackwell (con L40S serían 29) | ⌈55.6 ÷ 7⌉ | 8 RTX PRO 6000
API // Claude Sonnet 5.5, 3,960 millones de entrada y 330 de salida | 3,960 × 2 + 330 × 10 | US$11,220 al mes
Propio // 8 tarjetas a US$16,290 (gpuprix, 2026-11-25) en 2 servidores de 4: compra de US$146,320 | depreciación 3,252 + luz 604 + 200 + 1,000 | ≈ US$5,056 al mes
Recuperar la compra, \(m^{*}\) | 146,320 ÷ (11,220 − 604 − 200 − 1,000) | **≈ 15.5 meses**
= Con muchos usuarios y un modelo caro, el servidor propio se paga en poco más de un año y luego ahorra ≈ US$6,000 al mes. La comparación justa también pregunta si Qwen3 32B contesta tan bien como Sonnet para lo que necesita el despacho; eso se mide con evals.
:::

:::calculadora tco
La tabla de abajo repite tu trabajo con cada API del archivo de datos, de la más barata a la más cara, contra tu opción propia y la rentada. Con una GPU SXM (H100 SXM, H200, B200), pon el resto del servidor en 0: su precio de referencia ya es el de un servidor de 8 entre 8.
:::

## Lo que la calculadora no cuenta {What it leaves out} [extra]

- **La privacidad y la ley.** Si los datos no pueden salir de la red, la API no es opción, cueste lo que cueste. En Sensei, «Datos personales y la ley».
- **La calidad del modelo.** Una API cerrada de primera puede contestar mejor que un modelo abierto en tu servidor. Eso cambia cuánto vale cada respuesta, y se mide con evals.
- **Los descuentos.** Las APIs dan ≈ 50 % de descuento por lote y mucho más por caché de prompts repetidos; la nube da descuentos por comprometerte 1 a 3 años. Pueden mover el equilibrio bastante.
- **Lo que cuesta tener el hardware parado.** Si el tráfico baja a la mitad, el propio cuesta lo mismo y la API, la mitad.
- **Los impuestos y la deducción.** En muchos países la compra se deduce en varios años y la renta en el mes. Eso es cuenta del contador del cliente.
- **El tipo de cambio.** Todo está en dólares. En México, un servidor se paga en dólares o al tipo de cambio del día de la compra; la luz y las personas, en pesos.

## Errores comunes {Common mistakes}

1. **Comparar el precio de la GPU con el de la API, sin personas.** El propio sin operación parece regalado. **Cómo evitarlo:** pon lo que cuesta de verdad la parte del tiempo de alguien que lo va a operar.
2. **Olvidar el enfriamiento.** Cada watt que consume la GPU hay que sacarlo del cuarto con más watts. **Cómo evitarlo:** multiplica por el PUE; en una oficina, 1.5 o más.
3. **Depreciar a 5 años.** Una GPU de hoy en 5 años vale poco y rinde mucho menos que las nuevas. **Cómo evitarlo:** 3 años, y un valor de reventa conservador.
4. **Comparar contra la API más cara.** Si el cliente va a usar un modelo abierto en su servidor, el competidor justo es ese mismo modelo por API, no el mejor modelo cerrado. **Cómo evitarlo:** mira la tabla con todas las APIs.
5. **Rentar todo el mes un trabajo de oficina.** 730 horas para un uso de 220. **Cómo evitarlo:** si el proveedor te deja apagar, pon las horas reales; si no, eso también cuenta.
6. **Tomar el equilibrio de volumen como promesa.** Si el volumen sube 50 veces, las GPUs también. **Cómo evitarlo:** vuelve al sizing con el volumen nuevo.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Un equipo de 50 personas hace 30 preguntas al día, 22 días al mes, con prompts de 2,000 tokens y respuestas de 400. ¿Cuántos millones de tokens de entrada y de salida son al mes?
Preguntas: 50 × 30 × 22 = 33,000. Entrada: 33,000 × 2,000 = **66 millones**. Salida: 33,000 × 400 = **13.2 millones**.
? [facil] Con esos tokens, ¿cuánto cuesta al mes Llama 3.3 70B en DeepInfra (US$0.10 entrada, US$0.32 salida) y en Fireworks (US$0.90 y US$0.90), precios del 2026-11-25?
DeepInfra: 66 × 0.10 + 13.2 × 0.32 = 6.60 + 4.22 ≈ **US$10.82**. Fireworks: (66 + 13.2) × 0.90 ≈ **US$71.28**. El mismo modelo cuesta 6.6 veces más según quién lo sirva.
? [medio] Un servidor de US$40,000 con 2 GPUs de 600 W, más 500 W del resto, trabaja al 50 % del consumo de las GPUs en promedio, con PUE de 1.4 y luz a US$0.12 por kWh. ¿Cuánto paga de luz al mes?
Consumo promedio: 2 × 600 × 0.5 + 500 = 1,100 W = 1.1 kW. Con el cuarto: 1.1 × 1.4 = 1.54 kW. Al mes: 1.54 × 730 × 0.12 ≈ **US$135**. La luz casi nunca es lo que más pesa; la depreciación de ese servidor (US$40,000 × 0.8 ÷ 36 ≈ US$889) pesa 6.6 veces más.
? [medio] Con el despacho de esta página (propio ≈ US$2,147 al mes, US$1,000 de personas, 3 L40S rentables a US$1.09 por hora), ¿a partir de cuántas horas al mes conviene comprar en vez de rentar?
\(h^{*}\) = (2,147 − 1,000) ÷ (3 × 1.09) ≈ **351 horas**, el 48 % del mes. Si solo las prendes en horario de oficina (≈ 220 horas), rentar sale más barato: 3 × 1.09 × 220 + 1,000 ≈ US$1,719 contra US$2,147.
? [reto] El despacho grande (8 RTX PRO 6000, propio ≈ US$5,056 al mes, compra de US$146,320) cambia Claude Sonnet 5.5 por Claude Haiku 5.5 (US$0.10 entrada, US$0.50 salida, 2026-11-25). ¿Sigue conviniendo el servidor propio?
API con Haiku: 3,960 × 0.10 + 330 × 0.50 = 396 + 165 = **US$561 al mes**, contra US$5,056 del propio. Ya no: la API sale ≈ 9 veces más barata, y la compra nunca se recupera (US$561 no cubre ni los US$1,804 de gastos fijos). El equilibrio depende tanto del modelo contra el que compites como de tu volumen. Por eso el argumento de IA privada casi nunca es solo de costo.
:::

## Palabras que vas a oír {Words you'll hear}

:::conceptos
tco depreciacion pue punto-de-equilibrio
:::
