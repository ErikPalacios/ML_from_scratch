---
titulo: Qué es un modelo
en: What a model is
subtitulo: Qué hace un modelo por dentro, qué tipos de preguntas sabe responder y qué significa de verdad el «94 %» que devuelve.
pregunta: Cuando el modelo dice «Tenis, 94 %», ¿de dónde sale ese número y qué tanto le puedo creer?
minutos: 30
requisitos: camino-completo
---

:::idea
Un modelo es una función con millones de perillas: entran números y salen números. Lo que sale no es una respuesta, sino un puntaje para cada opción. Convertir esos puntajes en probabilidades, y las probabilidades en una decisión, es trabajo del sistema que rodea al modelo.
:::

## Una función con perillas {A function with knobs}

En la lección anterior viste que un [[modelo]] aprende de ejemplos en vez de seguir reglas escritas a mano. Ahora vamos a abrir la caja.

En matemáticas, una función es una regla que a cada entrada le asigna una salida. Con f(x) = 2x + 1, si entra 3 sale 7. Un modelo es exactamente eso: una función. Tiene dos diferencias con las de la escuela: es enorme, y una parte de ella no la escribe nadie.

### Un modelo de dos perillas

Imagina que el marketplace quiere sugerirle a Ana un precio para sus tenis usados. Un modelo muy chico podría ser:

`precio = a × años de uso + b`

La forma («multiplica los años por algo y súmale algo») la eligió una persona. Los números `a` y `b` son los [[parametro|parámetros]]: las perillas. Nadie los pone a mano. El [[entrenamiento]] los ajusta mirando miles de ventas pasadas, hasta que el modelo se equivoca lo menos posible con ellas.

:::ejemplo Calcular con las perillas ya puestas
Supón que, después de entrenar, quedó a = −300 y b = 1,500.

- Tenis nuevos (0 años): −300 × 0 + 1,500 = **1,500 pesos**.
- Con 2 años de uso: −300 × 2 + 1,500 = −600 + 1,500 = **900 pesos**.
- Con 4 años: −300 × 4 + 1,500 = −1,200 + 1,500 = **300 pesos**.

Si el entrenamiento hubiera dejado otras perillas, por ejemplo a = −200 y b = 1,800, el mismo par de 2 años saldría en −400 + 1,800 = 1,400 pesos. Misma forma, otras perillas, otra respuesta.
:::

Fíjate en algo: con 6 años sale −300 × 6 + 1,500 = −300 pesos. El modelo no sabe que un precio no puede ser negativo. No tiene sentido común: solo calcula. Todo lo que «sabe» es lo que quedó guardado en sus perillas, y lo que esté fuera de lo que vio al entrenar lo puede responder muy mal sin avisar.

### Del modelo de juguete a la ResNet-50 de C01

El modelo de C01 es una [[resnet|ResNet-50]]. Es una [[red-neuronal|red neuronal]]: una función armada con muchas multiplicaciones y sumas encadenadas, donde lo que sale de un paso entra al siguiente. Esta en particular está diseñada para fotos. La idea es la misma que la del juguete, solo que mucho más grande:

| | Modelo de juguete | ResNet-50 de C01 |
|---|---|---|
| Qué entra | 1 número (los años) | 150,528 números (la foto ya preparada; lo ves en la siguiente lección) |
| Qué sale | 1 número (el precio) | 500 números, uno por categoría |
| Perillas | 2 | ≈ 24.5 millones (la ResNet-50 original, de 1,000 categorías, tiene 25.6 millones) |
| Cuentas por respuesta | 1 multiplicación y 1 suma | ≈ 4 mil millones de multiplicaciones, cada una con su suma |

A la forma de la función («ResNet-50», «multiplica y suma») se le llama **arquitectura** (*architecture*). A los valores de las perillas también se les dice **pesos** (*weights*). Calcular una respuesta, de la entrada a la salida, se llama [[forward-pass]]: es lo que pasa en cada [[inferencia]].

El «archivo del modelo» que se guarda después de entrenar son, sobre todo, esos 24.5 millones de números. Un byte es la unidad con que se mide la memoria de una computadora, y cada uno de esos números con decimales ocupa 4 bytes (lo verás en la siguiente lección, con el tipo [[float32]]). Así que el archivo pesa 24.5 millones × 4 bytes = 98 millones de bytes ≈ 98 MB (megabytes).

:::analogia Una consola de sonido con millones de perillas
En una consola de audio, cada perilla cambia un poco el sonido, y el ingeniero las mueve escuchando hasta que suena bien. Un modelo se parece: cada combinación de perillas produce respuestas distintas, y entrenar es moverlas hasta que las respuestas salen bien.

**Dónde se rompe la analogía:** nadie mueve las perillas de un modelo a mano; el entrenamiento las mueve todas a la vez, un poquito cada vez, millones de veces. Y en una consola cada perilla significa algo («graves», «volumen»). En un modelo, una perilla sola casi nunca significa nada: lo que funciona es la combinación de millones.
:::

:::ojo
«El modelo» se usa para dos cosas. A veces es la arquitectura («usamos una ResNet-50») y a veces el archivo con los parámetros ya entrenados («desplegamos el modelo de octubre»). Dos ResNet-50 entrenadas con datos distintos son dos modelos distintos con la misma forma. Cuando en la Ronda veas `model_version`, se refiere a lo segundo.
:::

## Qué le puedes preguntar: los tipos de tarea {Kinds of tasks}

Antes de elegir un modelo se decide qué tipo de pregunta le vas a hacer. Eso es la [[tarea]]. La tarea fija tres cosas: qué forma tiene lo que sale, cómo se mide si acertó y qué hace el producto con la respuesta.

### Clasificación: elegir de una lista

En la [[clasificacion|clasificación]] el modelo elige una opción de una lista fija. A cada opción se le llama **clase**. Si hay dos clases, la clasificación es **binaria**: ¿este correo es spam o no?, ¿este pago es fraude o no? Si hay más de dos y cada ejemplo tiene exactamente una correcta, es [[multiclase]]. C01 es multiclase: cada foto va en una sola de 500 categorías.

La lista se fija al entrenar. El modelo no puede inventar una clase nueva: por eso, en el Dojo, cuando el negocio agrega «bolsas», el modelo viejo simplemente no la puede elegir.

:::ojo Multiclase no es lo mismo que multietiqueta
Si una foto puede tener varias respuestas correctas a la vez («tenis» y «calcetines» en la misma publicación), la tarea es **multietiqueta** (*multi-label*): cada clase recibe su propio sí o no. Se calcula distinto, porque ahí no tiene sentido repartir el 100 % entre las clases. C01 es multiclase porque cada publicación va en una sola categoría.
:::

### Regresión: dar un número

En la [[regresion|regresión]] sale un número en una escala continua: el precio del ejemplo de arriba, el tiempo que tarda un envío o cuántos pares de tenis se van a vender la próxima semana en cada tienda. El nombre es histórico y no ayuda: no tiene nada que ver con «regresar».

La diferencia con la clasificación está en cómo se mide el error. En clasificación aciertas o no. En regresión importa qué tan lejos quedaste: sugerir 950 pesos cuando el par se vendió en 900 es un error chico; sugerir 3,000 es uno grande.

### Ranking: ordenar

En el [[ranking]] el modelo ordena una lista. Cuando Ana busca «tenis» hay miles de publicaciones, y alguien tiene que decidir cuáles ve primero. El modelo le da un puntaje a cada una y se ordenan. Aquí importa el orden, no el número exacto.

Muchas veces el ranking se arma con un clasificador. Un sistema de anuncios estima, para cada anuncio, la probabilidad de que esa persona le haga clic (una clasificación binaria) y luego los ordena por esa probabilidad.

### Visión: mirar dentro de la foto

Con imágenes hay tareas que no se conforman con una respuesta para toda la foto:

- **[[deteccion|Detección de objetos]]:** encuentra cada objeto y dibuja una caja alrededor. Por cada caja da cuatro números (dónde está y qué tamaño tiene), una clase y una confianza. Una foto puede dar cero cajas o cincuenta. Es el cuadrito que dibuja la cámara de tu celular alrededor de las caras.
- **[[segmentacion|Segmentación]]:** le pone una clase a cada [[pixel|píxel]] de la imagen (cada uno de los puntitos de color que la forman). No dice «hay un tenis más o menos aquí», sino exactamente qué píxeles son tenis y cuáles son fondo. Es lo que usa el «modo retrato» para desenfocar el fondo.
- **[[ocr|OCR]]** (*optical character recognition*): lee el texto que aparece en la imagen y lo devuelve como texto que la computadora puede usar. Por ejemplo, la talla en la etiqueta de un tenis o el total de un ticket.

:::figura modelo-tareas
La misma idea, cuatro preguntas distintas. Cada una devuelve algo con otra forma: una categoría, cajas, una máscara de píxeles o texto.
:::

### Todas juntas

| Tarea | Qué sale | Ejemplo de todos los días | Dónde la vas a ver en la Ronda |
|---|---|---|---|
| Clasificación binaria | una de 2 clases, con su probabilidad | ¿este correo es spam? | C09 (fraude), C06 (moderación) |
| Multiclase | una de muchas clases | ¿de qué categoría es esta foto? | C01 (500 categorías) |
| Regresión | un número | ¿en cuánto vendo estos tenis? | C14 (pronóstico de demanda) |
| Ranking | una lista ordenada | ¿qué publicaciones veo primero? | C07 (búsqueda), C08 (recomendación), C15 (anuncios) |
| Detección | cajas con clase y confianza | el cuadrito en las caras de la cámara | C02 (video), C03 (planta) |
| Segmentación | una clase por píxel | desenfocar el fondo en «modo retrato» | C04 (imágenes médicas) |
| OCR | texto | copiar el texto de una foto | C05 (documentos) |

:::nota Las tareas se combinan
Un sistema real a veces usa varias. Un OCR suele ser una detección (dónde hay texto) seguida de un reconocimiento (qué dice). C01 es solo una: clasificación multiclase. El resto de la lección sigue ese caso.
:::

## Lo que sale de verdad: logits {Logits}

Aquí viene la primera sorpresa. El modelo de C01 no devuelve la palabra «Tenis». Devuelve 500 números, uno por categoría, siempre en el mismo orden. Esos números crudos se llaman [[logit|logits]].

Un logit es un puntaje: entre más alto, más se inclina el modelo por esa clase. Pero no es un porcentaje:

- Puede ser cualquier número: 3.0, 0, −12.7 o 41.
- No suma nada en especial: 500 logits pueden sumar 87 o −300.
- Solo no dice mucho. Un logit de 3 es alto solo si los de las demás clases son más bajos.

Para seguir las cuentas con lápiz, usemos solo tres categorías. La foto de Ana da estos logits:

| Categoría | Logit |
|---|---|
| Tenis | 3.0 |
| Botas | 1.0 |
| Sandalias | 0.0 |

El modelo prefiere «Tenis», pero ¿qué tanto? Con estos números no se puede decir todavía. Falta convertirlos en algo que se entienda.

:::ojo El modelo no sabe cómo se llaman las categorías
Para el modelo, «Tenis» es solo la posición 137 (por decir una) de su lista de 500 números. Los nombres viven en una lista aparte, y el programa que lo rodea los pega al final. Si esa lista se desacomoda, el modelo «dice» tenis y la app muestra «Bolsas», sin ningún error. Por eso en la Ronda los nombres viajan junto con el modelo y al arrancar se revisa que haya 500 nombres para 500 logits.
:::

El nombre «logit» viene de una función de la estadística; hoy se le dice así a cualquier salida cruda de un clasificador. En C01 el modelo corre en un servidor de modelos (Triton, en la Ronda) que devuelve exactamente eso: 500 logits de 4 bytes cada uno: 2,000 bytes, unos 2 KB (kilobytes).

## Softmax: de puntajes a probabilidades {Softmax}

Queremos convertir los logits en números que cumplan tres cosas: que cada uno quede entre 0 y 1, que sumen 1 entre todos, y que el orden no cambie (el logit más alto debe quedar con la probabilidad más alta). La cuenta que hace eso se llama [[softmax]].

Tiene tres pasos. Para el primero necesitas un número famoso: **e ≈ 2.718** (el número de Euler). «e elevado a x» se escribe eˣ. Si x es un entero, es multiplicar e por sí mismo x veces; si tiene decimales, la tecla eˣ de la calculadora lo resuelve igual.

:::pasos
1. Elevar e a cada logit
e³ = 2.718 × 2.718 × 2.718 ≈ 20.09. e¹ = 2.72. e⁰ = 1, porque cualquier número elevado a 0 da 1. Esto tiene una ventaja: el resultado siempre es positivo, aunque el logit sea negativo (e⁻¹ ≈ 0.37).
2. Sumar todo
20.09 + 2.72 + 1.00 = 23.80.
3. Dividir cada uno entre la suma
Tenis: 20.09 ÷ 23.80 = 0.844. Botas: 2.72 ÷ 23.80 = 0.114. Sandalias: 1.00 ÷ 23.80 = 0.042. Revisa: 0.844 + 0.114 + 0.042 = 1.000.
:::

:::figura modelo-softmax
Softmax con tres logits. Las barras amarillas y las azules tienen la misma proporción: dividir entre la suma no cambia el tamaño relativo, solo hace que todo sume 100 %.
:::

Escrito como fórmula, para la clase i: `pᵢ = e^(logitᵢ) ÷ (suma de e^(logit) de todas las clases)`. En C01 la suma lleva 500 términos en vez de 3, pero la cuenta es la misma.

### Tres cosas que conviene notar

**Lo que cuenta es la diferencia entre logits.** Súmales 10 a todos: 13, 11 y 10. Las probabilidades salen idénticas: 84.4 %, 11.4 % y 4.2 %. La razón: e¹³ = e³ × e¹⁰, y ese e¹⁰ aparece arriba y abajo de cada división, así que se cancela.

**La exponencial exagera las diferencias.** El logit de Tenis (3) le gana al de Botas (1) por 2 puntos, pero su probabilidad es 84.4 ÷ 11.4 ≈ 7.4 veces mayor. Cada punto de diferencia multiplica por e ≈ 2.72: 2 puntos son 2.72 × 2.72 ≈ 7.4 veces; 5 puntos son ≈ 148 veces.

**Nunca da exactamente 0 ni 100 %.** Sandalias, con logit 0, todavía se lleva 4.2 %. En C01, las 495 categorías que no entran al top-5 tienen probabilidades diminutas, pero ninguna es cero.

:::profundo Doblar los logits, y por qué eso se llama temperatura
Multiplica los logits por 2: quedan 6, 2 y 0. Ahora e⁶ ≈ 403.4, e² ≈ 7.39 y e⁰ = 1; suman 411.8, y las probabilidades son 98.0 %, 1.8 % y 0.2 %. El orden no cambió, pero el modelo «se ve» mucho más seguro.

Divídelos entre 2: quedan 1.5, 0.5 y 0. Ahora sale 62.9 %, 23.1 % y 14.0 %: mismo orden, menos seguridad.

Dividir los logits entre un número antes del softmax se llama usar una [[temperatura]]. Una temperatura mayor que 1 aplana las probabilidades y una menor que 1 las afila. Sirve para dos cosas que vas a ver: corregir un modelo que se cree demasiado (la Ronda lo llama *temperature scaling*, y no cambia el orden del top-5) y, en los [[llm|LLMs]] (los modelos que escriben texto, como ChatGPT), elegir palabras más o menos arriesgadas.

Un detalle de las computadoras: el número más grande que cabe en un float32 es ≈ 3.4 × 10³⁸, y e⁸⁹ ya es más grande. Por eso las librerías le restan a todos los logits el más alto antes de elevar. Como acabas de ver, restarles lo mismo a todos no cambia el resultado.
:::

:::nota El mismo truco en ChatGPT
Un [[llm|LLM]] hace algo muy parecido a cada paso: da un logit para cada uno de sus decenas de miles de posibles pedazos de texto ([[token|tokens]]), aplica softmax y elige uno. Lo ves en la lección «Transformers y LLMs».
:::

### ¿Quién calcula el softmax?

Muchas veces, el propio modelo no. El modelo entrega logits, y el softmax lo aplica el programa que lo rodea. En C01, el servidor de modelos devuelve los 500 logits y el programa que está frente a él calcula el softmax, el top-5 y los nombres de categoría en ≈ 1 ms.

¿Por qué no lo hace el modelo? Porque al entrenar, la cuenta que mide qué tan mal le fue, llamada pérdida ([[loss]]), ya trae el softmax adentro y trabaja directamente con logits. La ves en la lección «Cómo aprende un modelo». Si además el modelo terminara con un softmax, se aplicaría dos veces.

:::ojo Softmax dos veces
Si alguien aplica softmax a algo que ya eran probabilidades, nada truena, pero los números salen mal. Toma 0.844, 0.114 y 0.042 y vuelve a aplicar softmax: e^0.844 ≈ 2.33, e^0.114 ≈ 1.12 y e^0.042 ≈ 1.04; suman 4.49, y quedan 51.8 %, 25.0 % y 23.2 %. El orden es el mismo, así que el top-5 sigue igual y nadie lo nota a simple vista. Pero una foto que el modelo veía al 84 % ahora parece estar al 52 %, y cualquier regla que dependa de esos números, como el umbral de la última sección, se descompone.
:::

## Probabilidad y confianza: qué significa «94 %» {Probability and confidence}

Una [[probabilidad]] es un número de 0 a 1 (o de 0 % a 100 %) que dice qué tan posible es algo. 0.25 es «una de cada cuatro veces». Las de todas las opciones juntas suman 1, como las que salen del softmax.

La [[confianza]] de un modelo es la probabilidad que le da a su respuesta favorita: la del primer lugar. En la Ronda también la vas a ver como *score* o «score top-1». Cuando la app de Ana dice «Tenis, 94 %», la confianza es 0.94.

Ahora, la pregunta importante: **¿94 % quiere decir que acertó?** No. Es lo seguro que dice estar el modelo, calculado con los patrones que vio al entrenar. No es una garantía, por tres razones.

### 1. Puede estar mal calibrado

Un modelo está **bien calibrado** cuando sus porcentajes cumplen lo que dicen: de todas las fotos a las que les da alrededor de 94 %, acierta en unas 94 de cada 100. Eso se revisa con datos, y se llama [[calibracion|calibración]].

:::ejemplo Lo que quiere decir 94 % cuando el modelo está bien calibrado
Toma 10,000 fotos a las que el modelo les dio alrededor de 94 %. Si está bien calibrado, acierta en ≈ 9,400 y falla en ≈ 600. Es decir: aun con el modelo «muy seguro», 6 de cada 100 de esas fotos tienen la categoría equivocada.

Ahora imagina un modelo demasiado confiado, que con esas mismas fotos acierta solo en 8,500. Dice 94 %, pero vale 85 %. Las redes neuronales modernas tienden a pecar de eso, como mostró un estudio muy citado de 2017 (Guo y otros, «On Calibration of Modern Neural Networks»).
:::

En C01 esto importa porque el score se le muestra a Ana, ordena las sugerencias y decide si una foto es «dudosa». Por eso el contrato de la API de la Ronda dice «scores calibrados», y la evaluación antes de aprobar un modelo nuevo revisa la calibración.

### 2. Solo reparte entre lo que conoce

Softmax siempre reparte el 100 % entre las 500 categorías. Siempre. Si alguien sube la foto de un pastel en forma de tenis, el modelo no puede decir «esto no es nada de mi lista». Va a repartir el 100 % entre sus 500 categorías, y bien puede darle 90 % a «Calzado › Tenis».

Es el caso de «bolsas» del Dojo: antes de que exista esa categoría, la foto de una bolsa recibe su 100 % repartido entre las categorías viejas, y la más parecida puede salir con una confianza alta.

### 3. El mundo cambia

Cuando llegan fotos distintas a las del entrenamiento (el [[drift]] de la lección anterior), el modelo acierta menos, y su confianza no siempre baja al mismo ritmo. Por eso, en el monitoreo de la Ronda, la confianza es una alarma temprana y no una prueba: si de pronto muchas fotos salen con confianza baja, algo cambió; pero que la confianza siga alta no prueba que todo esté bien.

:::analogia El pronóstico del clima
Cuando el pronóstico dice «70 % de probabilidad de lluvia», un buen meteorólogo es uno que, de todos los días en que dijo 70 %, llovió más o menos en 7 de cada 10. Eso es estar bien calibrado, y es justo lo que se le pide al modelo.

**Dónde se rompe la analogía:** el clima siempre tiene las mismas dos opciones, llueve o no llueve. El modelo a veces recibe algo que no está en su lista, y aun así tiene que repartir su 100 % entre las opciones que conoce.
:::

:::ojo Dos «confianzas» distintas
En la Ronda la palabra aparece con dos sentidos. «Baja confianza» es el score del modelo. «Intervalo de confianza» es otra cosa, de estadística: qué tanto puede variar una medición por puro azar. Lo ves en la lección «Ruido, muestras y pruebas A/B».
:::

## Del porcentaje a la decisión: top-k y umbral {From scores to decisions: top-k and threshold}

Ya tenemos 500 probabilidades. Falta decidir qué ve Ana. Para eso hay dos herramientas, y ninguna es parte del modelo: las pone el producto.

### Top-k: más de una sugerencia

[[top-k|Top-k]] es quedarte con las k opciones más probables, en orden. Top-1 es la favorita; top-5, las cinco primeras. C01 devuelve el top-5 de sus 500 categorías, cada una con su score. La app las muestra como sugerencias ordenadas: Ana toca una, o busca otra en el selector de categorías.

| Lugar | Categoría | Probabilidad |
|---|---|---|
| 1 | Calzado › Tenis | 0.62 |
| 2 | Calzado › Botas | 0.14 |
| 3 | Calzado › Sandalias | 0.08 |
| 4 | Deportes › Fútbol | 0.05 |
| 5 | Ropa › Calcetines | 0.03 |
| | las otras 495 juntas | 0.08 |

Revisa la suma: 0.62 + 0.14 + 0.08 + 0.05 + 0.03 + 0.08 = 1.00.

¿Por qué cinco y no una? Por la diferencia que hace en la práctica. En la Ronda, el modelo de C01 acierta con la primera sugerencia en ≈ 85 de cada 100 fotos, y la correcta está entre las cinco en ≈ 96 de cada 100. Con cinco opciones, Ana casi nunca tiene que buscar a mano. A esas dos medidas se les llama top-1 y top-5 *accuracy* ([[top-k-accuracy]]).

:::nota Para el top-k no hace falta el softmax
Como softmax no cambia el orden, las cinco categorías con logit más alto son las mismas que las cinco con probabilidad más alta. El softmax se necesita para mostrar el porcentaje y para compararlo con un umbral.
:::

### Umbral: una línea que pone una persona

Un [[umbral]] (*threshold*) es una línea: si la confianza queda arriba, se hace una cosa; si queda abajo, otra. No lo decide el modelo. Lo elige una persona mirando datos, es una regla del producto y se puede cambiar sin reentrenar nada.

En la Ronda, C01 usa 0.3 como la línea de «baja confianza»: si el top-1 es menor que 0.3, la foto cuenta como dudosa. Con eso pasan dos cosas:

- La foto se aparta para que una persona le ponga su categoría. Son las fotos que más le pueden enseñar al siguiente modelo.
- Se cuenta. Si la proporción de fotos dudosas llega al doble de su promedio de los últimos 7 días durante media hora, salta una alerta: algo cambió (un error al preparar las fotos, un tipo de foto nueva, un modelo malo).

Fíjate en lo que esa regla **no** hace en la Ronda: no cambia lo que ve Ana. Ella recibe sus cinco sugerencias de todos modos. El selector de categorías, donde Ana busca a mano, aparece por otra razón: cuando el modelo no contesta a tiempo (en C01, si no hay respuesta en 300 ms) o falla. Un producto podría usar también un umbral para lo que ve Ana, por ejemplo no marcar ninguna sugerencia cuando el top-1 es muy bajo. Sería otra regla, y también la pondría una persona.

:::diagrama modelo-salida
Lo que pasa en cada foto y lo que decide la regla de baja confianza. Prueba los dos recorridos: cuando el modelo está seguro y cuando duda.
:::

### Mover el umbral siempre cuesta algo

Con un clasificador binario se ve más claro. Imagina el modelo de moderación de un marketplace: para cada publicación da la probabilidad de que esté prohibida, y si pasa del umbral, se bloquea.

:::ejemplo Diez publicaciones y tres umbrales
El modelo da estas probabilidades de «prohibida»: 0.95, 0.91, 0.80, 0.62, 0.55, 0.40, 0.30, 0.12, 0.05 y 0.02. En realidad, las prohibidas son cuatro: las de 0.95, 0.91, 0.62 y 0.40. Las otras seis están bien.

| Umbral | Bloquea | Prohibidas atrapadas (de 4) | Buenas bloqueadas por error |
|---|---|---|---|
| 0.35 | 6 | 4 | 2 (la de 0.80 y la de 0.55) |
| 0.5 | 5 | 3 (se escapa la de 0.40) | 2 |
| 0.9 | 2 | 2 (se escapan 0.62 y 0.40) | 0 |

Con 0.9 nunca castigas a un vendedor inocente, pero se te escapa la mitad de lo prohibido. Con 0.35 atrapas todo, pero molestas a dos vendedores que no hicieron nada.
:::

No hay un umbral gratis. Una buena publicación bloqueada por error es un [[falso-positivo|falso positivo]]; una prohibida que se escapa es un [[falso-negativo|falso negativo]]. Subir el umbral cambia unos por otros. La pregunta de fondo es cuál de los dos errores duele más en tu producto. Eso lleva a dos medidas que ves en la lección «¿Aprendió de verdad?»: la [[precision|precisión]] (de lo que bloqueaste, qué parte sí era prohibido) y el [[recall]] (de lo prohibido, qué parte atrapaste). Con el umbral de 0.35 de la tabla, la precisión es 4 de 6 y el recall, 4 de 4.

:::ojo El umbral es de un modelo, no de todos
Si sale una versión nueva que es más confiada en general, el mismo 0.3 corta en otro lugar: de pronto casi ninguna foto es «dudosa», aunque el modelo no sea mejor. Cada vez que cambias de modelo hay que revisar su calibración y sus umbrales. Por eso el umbral se guarda y se versiona igual que el modelo.
:::

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M01 · El mapa y la entrevista:** lo primero es traducir el problema del negocio a una tarea (clasificación, ranking, regresión) y decir qué error duele más, porque eso fija el umbral. Para C01, la medida principal sin usuarios es la top-5 *accuracy*.
- **M07 · Servidores de modelos:** Triton devuelve 500 logits y el programa de enfrente hace softmax, top-5 y los nombres de categoría, y agrega `model_version` a la respuesta. Los nombres viajan con el modelo y se revisan al arrancar.
- **M08 · Optimización de modelos:** al convertir el modelo a un formato más rápido, los logits cambian un poquito, y eso puede cambiar el top-1 en fotos que estaban empatadas. Por eso se exige que el top-1 coincida en al menos 99.5 % de las fotos de prueba.
- **M12 · Monitoreo:** la distribución del score top-1 y la tasa de baja confianza (top-1 menor que 0.3) son alarmas que llegan en minutos, mucho antes que las etiquetas. Y su trampa favorita: «la confianza no es *accuracy*».
- **C01:** el contrato de la API dice «top-5 de 500 con scores calibrados», porque el score se muestra, ordena las sugerencias y se compara con un umbral.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
tarea clasificacion multiclase regresion ranking deteccion segmentacion ocr logit softmax probabilidad confianza top-k umbral
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Un modelo da los logits 2, 2 y 0 para Tenis, Botas y Sandalias. ¿Qué probabilidades salen?
e² ≈ 7.39, e² ≈ 7.39 y e⁰ = 1. Suman 15.78. Quedan 7.39 ÷ 15.78 ≈ 46.8 % para Tenis, 46.8 % para Botas y 1 ÷ 15.78 ≈ 6.3 % para Sandalias. El modelo está empatado entre dos. Aunque el top-1 pase de 0.3, la diferencia entre el primero y el segundo es casi cero: en la Ronda, una foto con ese margen tan chico también se aparta para que una persona la etiquete.
? Le sumas 5 a todos los logits de un modelo. ¿Qué pasa con las probabilidades?
Nada. Softmax solo depende de las diferencias entre logits: el e⁵ que aparece en cada término se cancela al dividir entre la suma.
? El modelo dice «Tenis, 94 %». ¿Quiere decir que acertó?
No. Es su confianza, no una garantía. Si está bien calibrado, de cada 100 fotos con 94 % se equivoca en unas 6. Además, siempre reparte el 100 % entre las categorías que conoce, aunque la foto no sea de ninguna, y con fotos distintas a las del entrenamiento puede estar muy seguro y equivocado.
? ¿Qué tarea es cada una? (a) Estimar en cuántos días se va a vender una publicación. (b) Marcar cada casco en el video de una fábrica. (c) Leer el número de una placa. (d) Decidir si un pago es fraude.
(a) Regresión: sale un número. (b) Detección: una caja por cada casco. (c) OCR: sale texto. (d) Clasificación binaria: fraude o no.
? Alguien agrega un softmax al final de un modelo que ya terminaba en softmax. ¿Qué se rompe?
El orden no cambia, así que el top-5 sigue igual y a simple vista todo parece bien. Pero las probabilidades se aplanan (84 % puede quedar en 52 %), y todo lo que dependa de su valor se descompone: lo que se le muestra a Ana, el umbral de baja confianza y la alerta que lo vigila.
? En C01 subes el umbral de baja confianza de 0.3 a 0.6. ¿Qué cambia?
Más fotos cuentan como dudosas. Llegan más a la cola de etiquetado, que cuesta dinero porque las revisa una persona, y la tasa de baja confianza sube de golpe: la alerta que la compara con su promedio de 7 días puede saltar sin que nada se haya roto, así que también hay que ajustarla. Ana ve lo mismo: en la Ronda, la regla no cambia sus sugerencias. El modelo es el mismo: solo cambió la regla.
:::
