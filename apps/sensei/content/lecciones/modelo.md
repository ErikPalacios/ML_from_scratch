---
titulo: Qué es un modelo
en: What a model is
subtitulo: Un modelo es una función con perillas. Qué sale de ella, cómo se vuelve una probabilidad y una decisión, y contra qué se compara para saber si sirve.
pregunta: Cuando el modelo dice «Tenis, 94 %», ¿de dónde sale ese número, qué tanto le puedo creer y cómo sé si el modelo sirve?
requisitos: camino-completo
---

:::idea
Un modelo es una función con millones de perillas: entran números y salen puntajes, que softmax o la sigmoide vuelven probabilidades. La decisión la pone el sistema que lo rodea, y un modelo solo sirve si le gana al rival más simple: el baseline.
:::

## Un modelo es una función {A model is a function}

En la lección anterior viste que un [[modelo]] aprende de ejemplos en vez de seguir reglas escritas a mano. Ahora vamos a abrir la caja. Lo primero que hay adentro es una idea de tu clase de matemáticas.

Una [[funcion|función]] es una regla que a cada entrada le asigna exactamente una salida. Con f(x) = 2x + 1, si entra 3 sale 2 × 3 + 1 = 7. Si vuelve a entrar 3, vuelve a salir 7: una función no cambia de opinión.

Un modelo es exactamente eso: entran números y salen números. Tiene dos diferencias con las funciones de la escuela: es enorme, y una parte de ella no la escribe nadie.

### Un modelo de dos perillas

Imagina que el marketplace quiere sugerirle a Ana un precio para sus tenis usados. Un modelo muy chico podría ser:

:::formula Modelo lineal de una entrada
y = w × x + b
- x: la entrada: los años de uso de los tenis
- w: el peso (*weight*): cuánto cambia el precio por cada año, en pesos por año
- b: el sesgo (*bias*): el precio cuando \(x\) = 0, en pesos
- y: el precio sugerido, en pesos
:::

La forma («multiplica los años por algo y súmale algo») la eligió una persona. Los números w y b son los [[parametro|parámetros]]: las perillas del modelo. Sus letras vienen de *weight* (peso) y *bias* (sesgo), nombres que vas a ver en todas partes. Nadie los pone a mano: el [[entrenamiento]] los ajusta mirando miles de ventas pasadas, hasta que el modelo se equivoca lo menos posible con ellas.

:::cuenta Una predicción con las perillas ya puestas
La entrada \(x\) // unos tenis con 2 años de uso | años | 2
Multiplicar por \(w\) // w = −300, supuesta para el ejemplo | \(w × x\) = −300 × 2 | −600
Sumar \(b\) // b = 1,500, también supuesta | \(y = w × x + b\) = −600 + 1,500 | 900
= Precio sugerido: **900 pesos**.
:::

Con las mismas perillas, unos tenis nuevos salen en 1,500 pesos y unos de 4 años en −1,200 + 1,500 = 300. Si el entrenamiento hubiera dejado w = −200 y b = 1,800, los de 2 años saldrían en −400 + 1,800 = 1,400. Misma forma, otras perillas, otra respuesta.

Fíjate en algo: con 6 años sale −300 × 6 + 1,500 = −300 pesos. El modelo no sabe que un precio no puede ser negativo. No tiene sentido común: solo calcula. Todo lo que «sabe» quedó en sus perillas, y lo que esté lejos de lo que vio al entrenar lo puede responder muy mal sin avisar.

### Del modelo de juguete a la ResNet-50 de Alba

Alba, la empresa que seguimos en todo el curso, es un marketplace en línea (una tienda donde cualquiera publica lo que vende): recibe ≈ 2.5 millones de publicaciones al día y, al publicar, le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Su modelo es una [[resnet|ResNet-50]], una [[red-neuronal|red neuronal]] diseñada para fotos: muchísimas cuentas como la del juguete (multiplicar cada entrada por su peso y sumar), encadenadas, donde lo que sale de un paso entra al siguiente. La idea es la del juguete, solo que mucho más grande:

| | Modelo de juguete | ResNet-50 de Alba |
|---|---|---|
| Qué entra | 1 número (los años) | 150,528 números: la foto ya preparada, de 224 × 224 [[pixel\|píxeles]] (sus puntitos de color), con 3 números de color cada uno. Lo ves en la siguiente lección |
| Qué sale | 1 número (el precio) | 500 números, uno por categoría |
| Perillas | 2 | ≈ 24.5 millones (la ResNet-50 original, de 1,000 categorías, tiene 25.6 millones) |
| Cuentas por respuesta | 1 multiplicación y 1 suma | ≈ 4 mil millones de multiplicaciones, cada una con su suma |

A la forma de la función («ResNet-50», «multiplica y suma») se le llama **arquitectura** (*architecture*). A los valores de las perillas también se les dice **pesos** (*weights*). Calcular una respuesta, de la entrada a la salida, se llama [[forward-pass]]: es lo que pasa en cada [[inferencia]].

El archivo del modelo que se guarda después de entrenar son, sobre todo, esos 24.5 millones de números. Un byte es la unidad con que se mide la memoria, y cada uno de esos números ocupa 4 bytes en [[float32]], la forma más común de guardar un número con decimales. El archivo pesa 24.5 millones × 4 bytes = 98 millones de bytes ≈ 98 MB (megabytes).

:::ojo
«El modelo» se usa para dos cosas. A veces es la arquitectura («usamos una ResNet-50») y a veces el archivo con los parámetros ya entrenados («desplegamos el modelo de octubre»). Dos ResNet-50 entrenadas con datos distintos son dos modelos distintos con la misma forma. Cuando un sistema anota qué versión respondió cada pregunta (en un campo como `model_version`), se refiere a lo segundo.
:::

## Las perillas por dentro {Inside the knobs} [extra]

Esta sección es para una segunda pasada. Vuelve al modelo de juguete para ver qué hace cada perilla, qué pasa cuando hay más entradas y por qué los modelos grandes no son una sola suma.

### Qué hace cada perilla

Si dibujas el precio contra los años, este modelo es una recta. Por eso se le llama **modelo lineal** (*linear model*), y en los libros aparece como y = w·x + b.

- **b** es la altura de la recta cuando x vale 0: el precio de unos tenis nuevos. Moverla sube o baja la recta entera.
- **w** es la inclinación: cuánto cambia el precio por cada año. Con w = −300, cada año le quita 300 pesos. Con w = 0 la recta queda plana: el modelo ignora los años y siempre dice b.

:::figura modelo-recta
Ventas pasadas (puntos de ejemplo) y dos modelos lineales. Entrenar es buscar la recta que pasa más cerca de los puntos. Con 6 años, la recta llena ya predice un precio negativo.
:::

:::calculadora modelo-lineal
Reto: encuentra la recta que da 1,200 pesos con 2 años y 400 con 6 años. Solo hay una.
:::

### Más entradas, una perilla por cada una

Un precio no depende solo de los años. Si agregas una segunda entrada, por ejemplo si los tenis traen su caja (1 si sí, 0 si no), el modelo gana una perilla:

:::formula Suma ponderada
y = w_1 × x_1 + w_2 × x_2 + b
- x_1: los años de uso
- x_2: si los tenis traen su caja: 1 si sí, 0 si no
- w_1, w_2: el peso de cada entrada, en pesos por unidad de esa entrada
- b: el sesgo, en pesos
- y: el precio sugerido, en pesos
:::

Con \(w_1\) = −300, \(w_2\) = 400 y \(b\) = 1,500, unos tenis de 2 años con caja salen en \(y\) = −300 × 2 + 400 × 1 + 1,500 = −600 + 400 + 1,500 = 1,300 pesos, y sin caja (\(x_2\) = 0) en −600 + 0 + 1,500 = 900. Son 3 parámetros: dos pesos y un sesgo. Esta cuenta (multiplicar cada entrada por su peso, sumar todo y agregar el sesgo) se llama **suma ponderada**, y es el ladrillo de casi todo: una [[neurona]] hace justo esa cuenta y luego la dobla un poco. Lo ves en «Redes neuronales y CNNs».

Una suma ponderada sola no se puede doblar. Con una entrada es una recta; con mil, algo así como un plano de mil dimensiones, pero siempre derecho. Si el precio real baja rápido el primer año y luego despacio, ninguna recta lo sigue bien. Por eso los modelos grandes apilan muchas sumas ponderadas con dobleces entre ellas.

:::analogia Una consola de sonido con millones de perillas
En una consola de audio, cada perilla cambia un poco el sonido, y el ingeniero las mueve escuchando hasta que suena bien. Un modelo se parece: cada combinación de perillas produce respuestas distintas, y entrenar es moverlas hasta que las respuestas salen bien.

**Dónde se rompe la analogía:** nadie mueve las perillas de un modelo a mano; el entrenamiento las mueve todas a la vez, un poquito cada vez, millones de veces. Y en una consola cada perilla significa algo («graves», «volumen»). En un modelo, una perilla sola casi nunca significa nada: lo que funciona es la combinación de millones.
:::

## Qué le puedes preguntar: los tipos de tarea {Kinds of tasks}

Antes de elegir un modelo se decide qué tipo de pregunta le vas a hacer. Eso es la [[tarea]]. La tarea fija tres cosas: qué forma tiene lo que sale, cómo se mide si acertó y qué hace el producto con la respuesta. En una entrevista de diseño de sistemas de ML, ponerle nombre a la tarea es de lo primero que se califica.

### Clasificación: elegir de una lista

En la [[clasificacion|clasificación]] el modelo elige de una lista fija de opciones. A cada opción se le llama **clase**. Hay tres variantes, y confundirlas rompe sistemas:

- **Binaria:** dos clases, sí o no. ¿Este pago es fraude? ¿Este correo es spam? Es la [[clasificacion-binaria|clasificación binaria]]. A la clase que buscas (fraude, spam) se le dice *positiva*; a la otra, *negativa*.
- **Multiclase:** más de dos clases, y cada ejemplo tiene **exactamente una** correcta. Es la [[multiclase]]. Alba es así: cada foto va en una sola de 500 categorías.
- **Multietiqueta:** varias clases, y cada ejemplo puede tener **varias a la vez, o ninguna**. Es la [[multietiqueta]] (*multi-label*): cada clase recibe su propio sí o no.

El ejemplo clásico de multietiqueta es la moderación de contenido. Imagina una red social que revisa cada post contra 7 políticas: spam, amenazas y violencia, odio, desnudez y otras. Un mismo post puede ser spam **y** violento, como un mensaje que vende seguidores falsos y amenaza a quien lo reporte. Si el modelo tuviera que elegir una sola clase, se le escaparía la otra. Por eso su modelo de moderación da un score por política.

:::ojo
La lista de clases se fija al entrenar. El modelo no puede inventar una clase nueva: por eso, en Alba, cuando el 1 de octubre el negocio agrega «bolsas», el modelo viejo simplemente no la puede elegir.
:::

### Regresión: dar un número

En la [[regresion|regresión]] sale un número en una escala continua: el precio de la sección anterior, el tiempo que tarda un envío o cuántos litros de leche va a vender una tienda mañana. El nombre es histórico y no ayuda: no tiene nada que ver con «regresar».

La diferencia con la clasificación está en cómo se mide el error. En clasificación aciertas o no. En regresión importa qué tan lejos quedaste: sugerir 950 pesos cuando el par se vendió en 900 es un error chico; sugerir 3,000 es uno grande.

### Ranking: ordenar

En el [[ranking]] el modelo ordena una lista. Cuando Ana busca «tenis» hay miles de publicaciones, y alguien tiene que decidir cuáles ve primero. El modelo le da un puntaje a cada una y se ordenan. Aquí importa el orden, no el número exacto. Muchas veces el puntaje es la probabilidad de un clasificador binario, por ejemplo la de que esa persona haga clic.

### Visión: mirar dentro de la foto

Con imágenes hay tareas que no se conforman con una respuesta para toda la foto:

- **[[deteccion|Detección de objetos]]:** encuentra cada objeto y dibuja una caja alrededor. Por cada caja da cuatro números (dónde está y qué tamaño tiene), una clase y una confianza. Una foto puede dar cero cajas o cincuenta. Es el cuadrito que dibuja la cámara de tu celular alrededor de las caras.
- **[[segmentacion|Segmentación]]:** le pone una clase a cada [[pixel|píxel]] de la imagen (cada uno de los puntitos de color que la forman). No dice «hay un tenis más o menos aquí», sino exactamente qué píxeles son tenis y cuáles son fondo. Es parte de lo que usa el «modo retrato» para desenfocar el fondo.
- **[[ocr|OCR]]** (*optical character recognition*): lee el texto que aparece en la imagen y lo devuelve como texto que la computadora puede usar, como la talla en la etiqueta de un tenis.

:::figura modelo-tareas
La misma idea, cuatro preguntas distintas. Cada una devuelve algo con otra forma: una categoría, cajas, una máscara de píxeles o texto.
:::

### Todas juntas

| Tarea | Qué sale | Ejemplo de todos los días | Un sistema que la usa |
|---|---|---|---|
| Clasificación binaria | una de 2 clases, con su probabilidad | ¿este correo es spam? | detección de fraude en tiempo real |
| Multiclase | una de muchas clases | ¿de qué categoría es esta foto? | las sugerencias de Alba (500 categorías) |
| Multietiqueta | un sí o no por cada clase | las etiquetas de una foto: #playa #perro | moderación de contenido (7 políticas) |
| Regresión | un número | ¿en cuánto vendo estos tenis? | pronóstico de demanda |
| Ranking | una lista ordenada | ¿qué publicaciones veo primero? | búsqueda semántica, recomendación, predicción de clics en anuncios |
| Detección | cajas con clase y confianza | el cuadrito en las caras de la cámara | video en tiempo real con varias cámaras, inspección visual en una línea de manufactura |
| Segmentación | una clase por píxel | desenfocar el fondo en «modo retrato» | segmentación de imágenes médicas o industriales |
| OCR | texto | copiar el texto de una foto | procesamiento de documentos |

:::nota Las tareas se combinan
Un sistema real a veces usa varias. Un OCR suele ser una detección (dónde hay texto) seguida de un reconocimiento (qué dice). El de Alba es solo una: clasificación multiclase.
:::

## Logits y softmax: de puntajes a probabilidades {Logits and softmax}

Aquí viene la primera sorpresa. El modelo de Alba no devuelve la palabra «Tenis». Devuelve 500 números, uno por categoría, siempre en el mismo orden. Esos números crudos se llaman [[logit|logits]].

Un logit es un puntaje: entre más alto, más se inclina el modelo por esa clase. Pero no es un porcentaje:

- Puede ser cualquier número: 3.0, 0, −12.7 o 41.
- No suma nada en especial: 500 logits pueden sumar 87 o −300.
- Solo no dice mucho. Un logit de 3 es alto solo si los de las demás clases son más bajos.

Para seguir las cuentas con lápiz, usemos solo tres categorías. Una foto de unos tenis da estos logits: Tenis 3.0, Botas 1.0 y Sandalias 0.0. El modelo prefiere «Tenis», pero ¿qué tanto? Con estos números no se puede decir todavía.

### Softmax en tres pasos

Queremos convertir los logits en números que cumplan tres cosas: que cada uno quede entre 0 y 1, que sumen 1 entre todos y que el orden no cambie. La cuenta que hace eso se llama [[softmax]].

Para el primer paso necesitas un número famoso: **e ≈ 2.718** (el número de Euler). «e elevado a x» se escribe eˣ. Si x es un entero, es multiplicar e por sí mismo x veces: e³ = e × e × e ≈ 20.09. Si tiene decimales, la tecla eˣ de la calculadora lo resuelve. Su gracia: el resultado siempre es positivo, aunque x sea negativo (e⁻¹ ≈ 0.37).

:::formula Softmax
p_i = frac{e^{z_i}}{sum_{j=1}^{K} e^{z_j}}
- K: cuántas clases hay: 3 en el ejemplo, 500 en Alba
- z_i: el logit de la clase \(i\) (Tenis, Botas…); \(z_j\) recorre los de todas las clases, de la 1 a la \(K\)
- e: el número de Euler, ≈ 2.718
- p_i: la probabilidad de la clase \(i\), entre 0 y 1
:::

:::cuenta Softmax de los logits 3, 1 y 0
1. Elevar e a cada logit, \(e^{z_i}\) // e⁰ = 1, como cualquier número elevado a 0 | e³ · e¹ · e⁰ | 20.09 · 2.72 · 1.00
2. Sumar todo: el denominador \(sum e^{z_j}\) | 20.09 + 2.72 + 1.00 | 23.81
3. Dividir cada uno entre la suma: \(p_i\) | 20.09 ÷ 23.81 · 2.72 ÷ 23.81 · 1.00 ÷ 23.81 | 0.844 · 0.114 · 0.042
Revisar | 0.844 + 0.114 + 0.042 | 1.000
= Tenis **84.4 %**, Botas **11.4 %** y Sandalias **4.2 %**.
:::

En Alba la suma de abajo lleva 500 términos (\(K\) = 500) en vez de 3, pero la cuenta es la misma.

:::figura modelo-softmax
Softmax con tres logits. Las barras amarillas y las azules tienen la misma proporción: dividir entre la suma no cambia el tamaño relativo, solo hace que todo sume 100 %.
:::

:::calculadora modelo-softmax
Pon los tres logits iguales: cada uno se queda con un tercio. Después súbele 1 al de Tenis y mira cuánto gana.
:::

### Tres cosas que conviene notar

**Lo que cuenta es la diferencia entre logits.** Súmales 10 a todos: 13, 11 y 10. Las probabilidades salen idénticas: 84.4 %, 11.4 % y 4.2 %. La razón: e¹³ = e³ × e¹⁰, y ese e¹⁰ aparece arriba y abajo de cada división, así que se cancela.

**La exponencial exagera las diferencias.** El logit de Tenis (3) le gana al de Botas (1) por 2 puntos, pero su probabilidad es 84.4 ÷ 11.4 ≈ 7.4 veces mayor. Cada punto de diferencia multiplica por e ≈ 2.72: 2 puntos son 2.72 × 2.72 ≈ 7.4 veces; 5 puntos, ≈ 148 veces.

**Nunca da exactamente 0 ni 100 %.** Sandalias, con logit 0, todavía se lleva 4.2 %. En Alba, las 495 categorías que no entran al top-5 tienen probabilidades diminutas, pero ninguna es cero.

### Softmax en Python

Son tres líneas, una por paso. Cópialo y córrelo: no necesita instalar nada.

```python
import math

def softmax(logits):
    exps = [math.exp(z) for z in logits]   # 1. e elevado a cada logit
    total = sum(exps)                      # 2. sumar
    return [e / total for e in exps]       # 3. dividir entre la suma

logits = [3.0, 1.0, 0.0]                   # Tenis, Botas, Sandalias
print([round(p, 3) for p in softmax(logits)])
print(round(sum(softmax(logits)), 6))
print([round(p, 3) for p in softmax([z + 10 for z in logits])])   # sumar 10 a todos
print([round(p, 3) for p in softmax([z * 2 for z in logits])])    # multiplicar por 2
```

```salida
[0.844, 0.114, 0.042]
1.0
[0.844, 0.114, 0.042]
[0.98, 0.018, 0.002]
```

La última línea es un adelanto de la temperatura, en la sección extra «Por dentro de softmax y sigmoide»: multiplicar los logits no cambia el orden, pero el favorito se ve mucho más seguro.

## Sigmoide: un sí o un no por etiqueta {Sigmoid: a yes or no per label}

Softmax sirve cuando hay que repartir el 100 % entre clases que compiten. Hay dos casos donde eso no es lo que quieres: cuando la pregunta es un solo sí o no, y cuando un ejemplo puede tener varias clases a la vez. Para los dos está la [[sigmoide]].

### Una sola pregunta

En la clasificación binaria basta un solo logit, que se suele llamar z: positivo si el modelo se inclina por el «sí», negativo si se inclina por el «no». La sigmoide lo convierte en la probabilidad del «sí»:

:::formula Sigmoide
p = frac{1}{1 + e^{−z}}
- z: el logit del modelo, cualquier número
- p: la probabilidad del «sí», entre 0 y 1
:::

:::cuenta La sigmoide de z = 2
e elevado a menos el logit, \(e^{−z}\) | e^(−2) | 0.135
Sumarle 1: \(1 + e^{−z}\) | 1 + 0.135 | 1.135
Dividir 1 entre eso: \(p\) | \(p = 1 ÷ (1 + e^{−z})\) = 1 ÷ 1.135 | 0.881
= Probabilidad del «sí»: **88.1 %**.
:::

Tres cosas que se ven en la cuenta y en la figura:

- **En z = 0 da exactamente 50 %**, porque e⁰ = 1 y 1 ÷ (1 + 1) = 0.5. Un logit de 0 es «no sé».
- **Es simétrica.** z = −2 da 1 ÷ (1 + e²) = 1 ÷ 8.39 ≈ 11.9 %, que es justo 100 % − 88.1 %.
- **Nunca llega a 0 ni a 100 %.** Con z = 4 ya da 98.2 % y con z = 8, 99.97 %, pero en la cuenta exacta siempre falta un poquito. (En la computadora sí puede salir 1.0: con z = 40, lo que falta es tan chico que Python lo redondea.)

:::figura modelo-sigmoide
La sigmoide convierte cualquier logit en un número entre 0 y 1. Un umbral de 0.5 corta la curva justo en z = 0; uno de 0.9 pide un logit de al menos 2.2.
:::

La sigmoide da una probabilidad, no una decisión. La decisión la pone un [[umbral]]: si p queda arriba, «sí». Con umbral 0.5, decir «sí» es lo mismo que pedir un logit de 0 o más. Con un umbral más exigente, como 0.9, hace falta un logit de al menos 2.2 (de dónde sale ese número está en la sección extra que sigue).

:::calculadora modelo-sigmoide
Mueve el logit hasta que la decisión cambie. Después sube el umbral y busca otra vez el punto de cambio.
:::

### Varias preguntas a la vez

Regresa a la moderación de contenido. El modelo da un logit por política, y cada uno pasa por su propia sigmoide. Las probabilidades no compiten: cada una contesta su propia pregunta, y no tienen por qué sumar 100 %.

:::ejemplo El mismo post, con sigmoides y con softmax
Un post da estos logits en tres de las políticas: spam 2.0, violencia 1.0 y odio −3.0.

- Con **una sigmoide por política**: spam 88.1 %, violencia 73.1 % y odio 4.7 %. Suman 165.9 %, y está bien: son tres preguntas distintas.
- Con **softmax**, las tres compiten por el 100 %: e² ≈ 7.39, e¹ ≈ 2.72 y e⁻³ ≈ 0.05 suman 10.16, y quedan spam 72.7 %, violencia 26.8 % y odio 0.5 %.

En este ejemplo, la política de violencia manda a revisión desde un score de ≈ 0.5 (un umbral ilustrativo). Con su sigmoide, 73.1 % pasa la línea y una persona lo revisa. Con softmax, 26.8 % no la pasa: el spam «se comió» la probabilidad de la violencia, y un post con una amenaza se publica sin que nadie lo mire.
:::

:::figura modelo-multietiqueta
Los mismos tres logits. Con softmax compiten y suman 100 %; con una sigmoide por política, cada una se contesta sola. La línea marca 50 %: con softmax, la violencia no llega.
:::

### La tarea decide cómo termina el modelo

| Tarea | Qué saca el modelo | Qué se le aplica | Cómo se decide |
|---|---|---|---|
| Binaria | 1 logit | una sigmoide | un umbral |
| Multiclase | un logit por clase | softmax | el ganador o las k mejores |
| Multietiqueta | un logit por etiqueta | una sigmoide por etiqueta | un umbral por etiqueta |
| Regresión | un número | nada: el número es la respuesta | lo usa el producto (un pedido, un precio) |
| Ranking | un puntaje por opción | a veces una sigmoide | ordenar |

## Por dentro de softmax y sigmoide {Inside softmax and sigmoid} [extra]

Esta sección es para una segunda pasada. Explica de dónde viene el nombre «logit», por qué softmax y sigmoide son la misma idea, qué hace la temperatura, por qué las librerías no calculan el softmax tal cual y quién lo calcula en Alba.

### El logit es un momio con logaritmo

En las apuestas se habla de **momios** (*odds*): «4 a 1» quiere decir que algo pasa 4 veces por cada vez que no pasa. Una probabilidad se convierte en momio dividiéndola entre su contraria: con p = 0.8, el momio es 0.8 ÷ 0.2 = 4.

El logaritmo natural, ln, deshace lo que hace eˣ: ln 4 es el número al que hay que elevar e para que dé 4, y vale ≈ 1.39 (porque e^1.39 ≈ 4). El logit de una probabilidad es el ln de su momio: ln(p ÷ (1 − p)). Con p = 0.8 da ln 4 ≈ 1.39. Y es la inversa exacta de la sigmoide: la sigmoide de 1.39 da otra vez 0.8. De ahí viene el nombre: un logit es, literalmente, «el logaritmo del momio».

:::formula Logit de una probabilidad
z = ln frac{p}{1 − p}
- p: una probabilidad, entre 0 y 1 (sin llegar a ninguno de los dos)
- frac{p}{1 − p}: el momio: cuántas veces pasa por cada vez que no pasa
- z: el logit, cualquier número
:::

| Logit | Momio (e^logit) | Probabilidad |
|---|---|---|
| 0 | 1 a 1 | 50 % |
| 1 | 2.72 a 1 | 73.1 % |
| 2 | 7.39 a 1 | 88.1 % |
| 3 | 20.1 a 1 | 95.3 % |

Cada punto de logit multiplica el momio por e ≈ 2.72. Con la fórmula del logit, \(z = ln(p ÷ (1 − p))\), sale el número de la sección anterior: un umbral de 0.9 es un momio de 0.9 ÷ 0.1 = 9, y \(z\) = ln 9 ≈ 2.2. Un umbral de 0.3 da \(z\) = ln(0.3 ÷ 0.7) ≈ ln 0.429 ≈ −0.85.

### Una sigmoide es un softmax de dos

Toma un softmax de dos clases con logits z y 0. La primera recibe eᶻ ÷ (eᶻ + 1). Si divides arriba y abajo entre eᶻ, queda 1 ÷ (1 + e⁻ᶻ): la sigmoide. Con z = 2: 7.39 ÷ (7.39 + 1) = 0.881, igual que en la cuenta de la sigmoide.

En general, un softmax de dos logits a y b le da a la primera clase la sigmoide de a − b: otra vez, solo importa la diferencia. Por eso un clasificador binario puede terminar en 1 logit con sigmoide o en 2 logits con softmax. Es lo mismo escrito de dos formas.

:::nota Un modelo lineal con sigmoide
Si z sale de un modelo lineal, z = w·x + b, y le pones una sigmoide, tienes el clasificador más clásico que existe: la **regresión logística** (*logistic regression*). Pese al nombre, no es una regresión: es un clasificador binario. Es un [[baseline]] muy común cuando los datos son una tabla.
:::

### Temperatura: afilar o aplanar

:::formula Softmax con temperatura
p_i = frac{e^{z_i ÷ T}}{sum_{j=1}^{K} e^{z_j ÷ T}}
- T: la temperatura: el número entre el que se dividen todos los logits antes del softmax. Con \(T\) = 1 es el softmax de siempre
- z_i, K, p_i: las mismas letras del softmax de arriba
:::

Multiplica por 2 los logits de los tenis (3, 1 y 0), que es lo mismo que usar \(T\) = 0.5: quedan 6, 2 y 0. Ahora e⁶ ≈ 403.4, e² ≈ 7.39 y e⁰ = 1 suman 411.8, y las probabilidades son 403.4 ÷ 411.8 ≈ 98.0 %, 7.39 ÷ 411.8 ≈ 1.8 % y 1 ÷ 411.8 ≈ 0.2 %. El orden no cambió, pero el modelo «se ve» mucho más seguro. Con \(T\) = 2 quedan 1.5, 0.5 y 0: e^1.5 ≈ 4.48, e^0.5 ≈ 1.65 y e⁰ = 1 suman 7.13, y sale 62.9 %, 23.1 % y 14.0 %: mismo orden, menos seguridad.

Dividir los logits entre un número antes del softmax se llama usar una [[temperatura]]. Una temperatura mayor que 1 aplana las probabilidades y una menor que 1 las afila. Sirve para dos cosas que vas a ver: corregir un modelo que se cree demasiado (a esto se le llama *temperature scaling*, y no cambia el orden del top-5) y, en los [[llm|LLMs]] (los modelos que escriben texto, como ChatGPT), elegir palabras más o menos arriesgadas. La calculadora de softmax tiene una perilla de temperatura para que lo pruebes.

### Números que no caben

Una computadora guarda cada número en un espacio fijo, y hay un máximo. En [[float32]] (4 bytes) el número más grande es ≈ 3.4 × 10³⁸, y e⁸⁹ ya se pasa. En los números de Python (8 bytes) el tope es ≈ 1.8 × 10³⁰⁸, y e⁷¹⁰ ya no cabe. Un logit de 1,000 parece exagerado, pero llegar ahí es fácil: con una temperatura de 0.01, un logit de 20 se vuelve 2,000.

La solución usa la primera propiedad del softmax: restarle lo mismo a todos los logits no cambia nada. Las librerías le restan a todos el más alto, así el mayor exponente es e⁰ = 1 y nada se desborda.

```python
import math

def softmax_ingenuo(logits):
    exps = [math.exp(z) for z in logits]
    return [e / sum(exps) for e in exps]

def softmax_estable(logits):
    m = max(logits)                              # restar el más alto no cambia el resultado...
    exps = [math.exp(z - m) for z in logits]     # ...y el exponente más grande queda en 0
    total = sum(exps)
    return [e / total for e in exps]

logits = [1000.0, 999.0, 998.0]
try:
    print(softmax_ingenuo(logits))
except OverflowError as error:
    print("ingenuo:", error)
print("estable:", [round(p, 4) for p in softmax_estable(logits)])
```

```salida
ingenuo: math range error
estable: [0.6652, 0.2447, 0.09]
```

:::nota El mismo softmax en ChatGPT
Un [[llm|LLM]] hace algo muy parecido a cada paso: da un logit para cada pedazo de texto que conoce (cada [[token]]), que son decenas de miles o más (Llama 3, de Meta, conoce ≈ 128 mil), aplica softmax, con este mismo cuidado de restar el más alto, y elige uno. Lo ves en la lección «Transformers y LLMs».
:::

### ¿Quién calcula el softmax?

Muchas veces, el propio modelo no. El modelo entrega logits, y el softmax lo aplica el programa que lo rodea. En Alba, el servidor de modelos (Triton, un programa de NVIDIA hecho para servir modelos) devuelve los 500 logits, de 4 bytes cada uno: 500 × 4 = 2,000 bytes, unos 2 KB. El programa que está frente a él calcula el softmax, el top-5 y los nombres de categoría en ≈ 1 ms.

¿Por qué no lo hace el modelo? Porque al entrenar, la cuenta que mide qué tan mal le fue, la pérdida ([[loss]]), ya trae el softmax adentro y trabaja directamente con logits. La ves en «Cómo aprende un modelo». Si además el modelo terminara con un softmax, se aplicaría dos veces, y ese es uno de los errores comunes de esta lección.

:::ojo El modelo no sabe cómo se llaman las categorías
Para el modelo, «Tenis» es solo la posición 137 (por decir una) de su lista de 500 números. Los nombres viven en una lista aparte, y el programa que lo rodea los pega al final. Si esa lista se desacomoda, el modelo «dice» tenis y la app muestra «Bolsas», sin ningún error. Por eso en Alba los nombres viajan junto con el modelo y al arrancar se revisa que haya 500 nombres para 500 logits.
:::

## Probabilidad y confianza: qué significa «94 %» {Probability and confidence}

Una [[probabilidad]] es un número de 0 a 1 (o de 0 % a 100 %) que dice qué tan posible es algo. 0.25 es «una de cada cuatro veces». Las de todas las opciones juntas suman 1, como las que salen del softmax.

La [[confianza]] de un modelo es la probabilidad que le da a su respuesta favorita, la del primer lugar. También la vas a ver como *score* o «score top-1». Cuando la app de Ana dice «Tenis, 94 %», la confianza es 0.94.

Ahora, la pregunta importante: **¿94 % quiere decir que acertó?** No. Es lo seguro que dice estar el modelo, calculado con los patrones que vio al entrenar. No es una garantía, por tres razones.

### 1. Puede estar mal calibrado

Un modelo está **bien calibrado** cuando sus porcentajes cumplen lo que dicen: de todas las fotos a las que les da alrededor de 94 %, acierta en unas 94 de cada 100. Eso se revisa con datos, y se llama [[calibracion|calibración]].

:::ejemplo Lo que quiere decir 94 % cuando el modelo está bien calibrado
Toma 10,000 fotos a las que el modelo les dio alrededor de 94 %. Si está bien calibrado, acierta en ≈ 9,400 y falla en ≈ 600: aun «muy seguro», 6 de cada 100 de esas fotos tienen la categoría equivocada.

Ahora imagina un modelo demasiado confiado, que con esas mismas fotos acierta solo en 8,500. Dice 94 %, pero vale 85 %. Las redes neuronales modernas tienden a pecar de eso, como mostró un estudio muy citado de 2017 (Guo y otros, «On Calibration of Modern Neural Networks»).
:::

En Alba esto importa porque el score se le muestra a Ana y decide si una foto es «dudosa» (si el top-1 es menor que 0.3). Por eso el contrato de la API de Alba (lo que promete devolverle a la app) dice «scores calibrados», y la evaluación antes de aprobar un modelo nuevo revisa la calibración.

:::analogia El pronóstico del clima
Cuando el pronóstico dice «70 % de probabilidad de lluvia», un buen meteorólogo es uno que, de todos los días en que dijo 70 %, llovió más o menos en 7 de cada 10. Eso es estar bien calibrado, y es justo lo que se le pide al modelo.

**Dónde se rompe la analogía:** el clima siempre tiene las mismas dos opciones, llueve o no llueve. El modelo a veces recibe algo que no está en su lista, y aun así tiene que repartir su 100 % entre las opciones que conoce.
:::

### 2. Solo reparte entre lo que conoce

Softmax siempre reparte el 100 % entre las 500 categorías. Siempre. Si alguien sube la foto de un pastel en forma de tenis, el modelo no puede decir «esto no es nada de mi lista»: va a repartir el 100 % entre sus 500 categorías, y bien puede darle 90 % a «Calzado › Tenis». Es lo que pasa en Alba con «bolsas»: antes de que el 1 de octubre exista esa categoría, la foto de una bolsa recibe su 100 % repartido entre las categorías viejas, y la más parecida puede salir con una confianza alta.

### 3. El mundo cambia

Cuando llegan fotos distintas a las del entrenamiento (el [[drift]] de la lección anterior), el modelo acierta menos, y su confianza no siempre baja al mismo ritmo. Por eso, en el monitoreo de Alba, la confianza es una alarma temprana y no una prueba: si de pronto muchas fotos salen con confianza baja, algo cambió; pero que la confianza siga alta no prueba que todo esté bien.

:::ojo Dos «confianzas» distintas
La palabra aparece con dos sentidos. «Baja confianza» es el score del modelo. «Intervalo de confianza» es otra cosa, de estadística: qué tanto puede variar una medición por puro azar. Lo ves en la lección «Ruido, muestras y pruebas A/B».
:::

## Del puntaje a la decisión: argmax, top-k y umbral {From scores to decisions: argmax, top-k and threshold}

Ya tenemos 500 probabilidades. Falta decidir qué ve Ana. Para eso hay tres herramientas, y ninguna es parte del modelo: las pone el producto.

### Argmax: el ganador

El [[argmax]] de una lista es la **posición** de su valor más alto, no el valor. Con los logits 3.0, 1.0 y 0.0 de Tenis, Botas y Sandalias, el máximo es 3.0 y el argmax es la posición de Tenis. Esa posición, traducida a su nombre, es la respuesta top-1 del modelo.

¿Por qué da lo mismo sacarlo de los logits o de las probabilidades? Porque softmax no cambia el orden. eˣ crece cuando x crece, así que el logit más alto da la exponencial más alta, y dividir todas entre la misma suma no cambia cuál es la mayor. Para saber **cuál** gana no hace falta el softmax; hace falta para saber **por cuánto**.

```python
logits = {"Tenis": 3.0, "Botas": 1.0, "Sandalias": 0.0, "Fútbol": -0.5, "Calcetines": -1.2}

orden = sorted(logits, key=logits.get, reverse=True)   # de mayor a menor logit
print("argmax (top-1):", orden[0])
print("top-3:", orden[:3])
```

```salida
argmax (top-1): Tenis
top-3: ['Tenis', 'Botas', 'Sandalias']
```

### Top-k: más de una sugerencia

[[top-k|Top-k]] es quedarte con las k opciones más probables, en orden: es el argmax repetido k veces. Top-1 es la favorita; top-5, las cinco primeras. Alba devuelve el top-5 de sus 500 categorías, cada una con su score. La app las muestra como sugerencias ordenadas: Ana toca una, o busca otra en el selector de categorías.

| Lugar | Categoría | Probabilidad |
|---|---|---|
| 1 | Calzado › Tenis | 0.62 |
| 2 | Calzado › Botas | 0.14 |
| 3 | Calzado › Sandalias | 0.08 |
| 4 | Deportes › Fútbol | 0.05 |
| 5 | Ropa › Calcetines | 0.03 |
| | las otras 495 juntas | 0.08 |

Revisa la suma: 0.62 + 0.14 + 0.08 + 0.05 + 0.03 + 0.08 = 1.00.

¿Por qué cinco y no una? Por la diferencia que hace en la práctica. En Alba, el modelo acierta con la primera sugerencia en ≈ 85 de cada 100 fotos, y la correcta está entre las cinco en ≈ 96 de cada 100. Con cinco opciones, Ana casi nunca tiene que buscar a mano. A esas dos medidas se les llama top-1 y top-5 *accuracy* ([[top-k-accuracy]]). Como softmax no cambia el orden, el top-5 de los logits y el de las probabilidades son el mismo: el softmax solo hace falta para mostrar el porcentaje y compararlo con un umbral.

### Umbral: una línea que pone una persona

Un [[umbral]] (*threshold*) es una línea: si la confianza queda arriba, se hace una cosa; si queda abajo, otra. No lo decide el modelo. Lo elige una persona mirando datos, es una regla del producto y se puede cambiar sin reentrenar nada.

Alba usa 0.3 como la línea de «baja confianza»: si el top-1 es menor que 0.3, la foto cuenta como dudosa. Con eso pasan dos cosas:

- La foto se aparta para que una persona le ponga su categoría. Son las fotos que más le pueden enseñar al siguiente modelo.
- Se cuenta. Si la proporción de fotos dudosas llega al doble de su promedio de los últimos 7 días durante media hora, salta una alerta: algo cambió (un error al preparar las fotos, un tipo de foto nueva, un modelo malo).

Fíjate en lo que esa regla **no** hace en Alba: no cambia lo que ve Ana. Ella recibe sus cinco sugerencias de todos modos. El selector de categorías, donde Ana busca a mano, aparece por otra razón: cuando el modelo no contesta a tiempo (en Alba, si no hay respuesta en 300 ms) o falla. Un producto podría usar también un umbral para lo que ve Ana, por ejemplo no marcar ninguna sugerencia cuando el top-1 es muy bajo. Sería otra regla, y también la pondría una persona.

:::diagrama modelo-salida
Lo que pasa en cada foto y lo que decide la regla de baja confianza. Prueba los dos recorridos: cuando el modelo está seguro y cuando duda.
:::

:::ojo El umbral es de un modelo, no de todos
Si sale una versión nueva que es más confiada en general, el mismo 0.3 corta en otro lugar: de pronto casi ninguna foto es «dudosa», aunque el modelo no sea mejor. Cada vez que cambias de modelo hay que revisar su calibración y sus umbrales. Por eso el umbral se guarda y se versiona igual que el modelo.
:::

## Decidir cerca de la línea: empates y umbrales {Deciding near the line} [extra]

Esta sección es para una segunda pasada. Explica qué pasa cuando dos categorías quedan casi empatadas y por qué mover un umbral siempre cuesta algo.

### Empates y casi empates

El argmax no tiene término medio: gana una sola posición, aunque sea por una centésima.

:::ejemplo Un casi empate
Una foto da Tenis 2.31 y Botas 2.30: el argmax es Tenis por una centésima. Al pasar el modelo a FP16, que guarda cada número en 2 bytes en vez de 4 y corre más rápido (lo ves en «Cómo guarda números una computadora»), los logits cambian del orden de 0.01. Basta que queden Tenis 2.30 y Botas 2.31 para que el top-1 cambie. Por eso Alba no exige logits idénticos, sino que el top-1 coincida en al menos 99.5 % de las fotos de prueba. Y por eso Alba aparta para etiquetar las fotos con poco margen entre el primer y el segundo lugar: ahí el modelo duda aunque el primero no se vea bajo.
:::

Si dos logits empatan exacto, las librerías suelen quedarse con la primera posición. Es una regla arbitraria: el modelo no tiene preferencia.

### Mover el umbral siempre cuesta algo

Con un clasificador binario se ve más claro. Imagina el modelo de moderación de un marketplace: para cada publicación da la probabilidad de que esté prohibida, y si pasa del umbral, se bloquea.

:::ejemplo Diez publicaciones y tres umbrales
El modelo da estas probabilidades de «prohibida»: 0.95, 0.91, 0.80, 0.62, 0.55, 0.40, 0.30, 0.12, 0.05 y 0.02. En realidad, las prohibidas son cuatro: las de 0.95, 0.91, 0.62 y 0.40. Las otras seis están bien.

| Umbral | Bloquea | Prohibidas atrapadas (de 4) | Buenas bloqueadas por error |
|---|---|---|---|
| 0.35 | 6 | 4 | 2 (la de 0.80 y la de 0.55) |
| 0.5 | 5 | 3 (se escapa la de 0.40) | 2 |
| 0.9 | 2 | 2 (se escapan 0.62 y 0.40) | 0 |

Con 0.9 no castigas a ningún vendedor inocente, pero se te escapa la mitad de lo prohibido. Con 0.35 atrapas todo, pero molestas a dos vendedores que no hicieron nada.
:::

No hay un umbral gratis. Una buena publicación bloqueada por error es un [[falso-positivo|falso positivo]]; una prohibida que se escapa es un [[falso-negativo|falso negativo]]. Subir el umbral cambia unos por otros, y la pregunta de fondo es cuál de los dos errores duele más en tu producto. Eso lleva a dos medidas que ves en «¿Aprendió de verdad?»: la [[precision]] (de lo que bloqueaste, qué parte sí era prohibido) y el [[recall]] (de lo prohibido, qué parte atrapaste). Con el umbral de 0.35, la precision es 4 de 6 y el recall, 4 de 4.

## El baseline: el rival que hay que vencer {Baselines: the rival to beat}

Imagina que alguien presume: «mi modelo de fraude acierta 99.9 % de las veces». Suena increíble. La pregunta correcta es: ¿comparado con qué?

Un [[baseline]] (línea base) es la solución más simple con la que comparas tu modelo. Si tu modelo no le gana, no aprendió nada que valga la pena, por bonito que se vea su número. La [[accuracy]] (la fracción de aciertos) del ejemplo lo muestra:

:::cuenta El «modelo» que siempre dice «no es fraude»
Pagos al día // una plataforma de pagos; supuesto del ejemplo | ≈ 10 M | 10,000,000
Fraudes // ≈ 0.08 % de los pagos | 0.08 % × 10,000,000 | 8,000
Aciertos de «aprobar todo» // acierta todos los buenos | 10,000,000 − 8,000 | 9,992,000
Accuracy = aciertos ÷ pagos | 9,992,000 ÷ 10,000,000 | 99.92 %
Fraudes atrapados | 0 de 8,000 | 0 %
= Sin mirar nada, saca **99.92 %** de accuracy y no atrapa **ni un fraude**. Ese 99.92 % es el piso, no un logro.
:::

:::figura modelo-baseline
1,250 pagos, uno de ellos fraude (0.08 %, la tasa del ejemplo). «Aprobar todo» acierta 1,249 y deja pasar justo el que importaba.
:::

El «99.9 %» que presumían al principio queda **debajo** de ese piso: ese modelo acierta menos que no hacer nada. Podría servir de todos modos, si atrapa muchos fraudes a cambio de rechazar a algunos clientes buenos, pero la accuracy sola no lo dice: hay que contar los fraudes atrapados y los clientes rechazados.

### Cuatro rivales, de menos a más

1. **No usar ML: lo que se hace hoy.** En Alba, antes del modelo, Ana elegía la categoría a mano en el selector. Esa es la base contra la que se mide si las sugerencias ayudan: el baseline «sin sugerencia». En el pronóstico de demanda de una cadena de supermercados, una hoja de cálculo sugiere pedir lo que se vendió el mismo día de la semana pasada.
2. **El modelo más tonto.** Sin mirar la entrada: en clasificación, decir siempre la clase más común; en regresión, decir siempre el promedio. Es lo que tu modelo tiene que superar sí o sí.
3. **Una regla simple.** Por ejemplo, para avisar que una foto está borrosa, el baseline es una cuenta que mide qué tan marcados son sus bordes, con un umbral: corre en milisegundos en una CPU (el procesador común de la computadora) y no se entrena. Solo si falla en casos concretos (fotos nocturnas, fondos lisos) se entrena una red.
4. **El modelo que ya existe.** Cuando ya hay uno en producción, el nuevo se compara contra él con el mismo examen. Al que ya está se le suele decir *champion*.

### Por qué siempre hace falta uno

- **Para saber si aprendió algo.** Un número solo no dice nada: 99.92 % parece excelente hasta que ves que no hacer nada da lo mismo.
- **Para saber si vale lo que cuesta.** Un modelo pide datos, máquinas, monitoreo y gente. Si una regla de diez líneas logra casi lo mismo, la regla gana.
- **Para tener un plan B.** Cuando el modelo falla o no contesta a tiempo, algo tiene que responder, y muchas veces es el baseline. En Alba, si no hay respuesta en 300 ms, Ana ve el selector manual. En la detección de fraude, si el modelo no contesta, deciden reglas de respaldo. En el pronóstico de demanda, si la corrida de la noche falla, se publica el pronóstico de ayer.

En una frase: el baseline es a la vez tu punto de comparación y tu plan de degradación.

## Errores comunes {Common mistakes}

1. **Aplicar softmax dos veces.** Si el modelo ya devuelve probabilidades y alguien vuelve a aplicar softmax, nada truena, pero los números se aplanan. Con 0.844, 0.114 y 0.042: e^0.844 ≈ 2.326, e^0.114 ≈ 1.121 y e^0.042 ≈ 1.043 suman 4.490, y queda 51.8 %, 25.0 % y 23.2 %. El orden es el mismo, así que nadie lo nota a simple vista; pero el umbral, la alerta y lo que ve Ana se descomponen. **Cómo evitarlo:** que el contrato diga qué sale del modelo (logits o probabilidades) y revisar en una prueba que el top-1 de una foto clara sea alto.
2. **Leer la confianza como accuracy.** «94 %» es lo que el modelo dice, no lo que logra. **Cómo evitarlo:** medir la calibración con datos etiquetados: de las veces que dijo ≈ 94 %, ¿cuántas acertó?
3. **Comparar logits entre modelos.** Un logit solo vale junto a los demás del mismo modelo. Un modelo con logits 5, 4 y 4 da 57.6 % a su favorito; otro con 2, 0 y 0 da 78.7 %. El de logit más bajo está más seguro. **Cómo evitarlo:** comparar probabilidades calibradas o métricas sobre el mismo examen, nunca logits sueltos.
4. **Usar softmax en un problema multietiqueta.** Obliga a las etiquetas a competir, y una esconde a la otra: el post con spam y amenaza que vimos. **Cómo evitarlo:** si un ejemplo puede tener varias clases a la vez, una sigmoide por etiqueta.
5. **Dejar el umbral en 0.5 porque sí.** 0.5 no tiene nada de especial. El umbral sale de lo que cuesta cada error: en la detección de fraude, para un pago de US$25 conviene rechazar desde ≈ 16 % (la cuenta está en «En la vida real»). **Cómo evitarlo:** elegirlo con datos y costos, y revisarlo con cada versión del modelo.
6. **Presumir un número sin baseline.** 99.92 % de accuracy en fraude es lo que saca «aprobar todo». **Cómo evitarlo:** antes de entrenar, calcula lo que saca el rival más tonto y lo que se hace hoy, y escríbelo junto a tu número.
7. **Desacomodar la lista de nombres.** El modelo dice «posición 137» y la app pega el nombre de otra categoría, sin ningún error. **Cómo evitarlo:** que los nombres viajen con el modelo y que el servidor revise al arrancar que hay tantos nombres como logits, como hace Alba.

## En la vida real {In real life} [extra]

La misma función con perillas aparece en sistemas muy distintos. Lo que cambia es qué sale y cómo se decide.

### Alba: de 150,528 números a cinco sugerencias

La foto de Ana, ya preparada, son 150,528 números. La ResNet-50 los convierte en 500 logits; el programa que está frente al modelo aplica softmax, se queda con el top-5, le pega los nombres y agrega `model_version`. Todo eso tiene que pasar en p99 ≤ 200 ms del lado del servidor: el 99 % de las respuestas, en menos de 200 ms. Aparte, la regla de 0.3 aparta las fotos dudosas para etiquetarlas y alimenta la alerta. Y si no hay respuesta en 300 ms, el baseline (el selector manual) hace de plan B.

:::ojo Otra «línea base»
En monitoreo, «línea base» significa otra cosa: el nivel normal de una métrica. Cuando Alba dice que su alerta salta si la tasa de baja confianza pasa del doble de «su línea base de 7 días», habla de su promedio reciente, no de un modelo rival.
:::

:::ejemplo El baseline de Alba, con números
Para la top-5 de Alba, el baseline más tonto sugiere siempre las 5 categorías más comunes, sin mirar la foto. Supón (es un número de ejemplo) que esas 5 juntan el 10 % de las publicaciones: el baseline acierta en 10 de cada 100 fotos. El modelo acierta en ≈ 96. La distancia entre 10 y 96 es lo que el modelo aporta. Si alguien te dijera «96 %» y el baseline sacara 90, la conversación sería otra.
:::

### OCR de documentos: la salida es una secuencia

En el procesamiento de documentos, imagina una plataforma de créditos que lee facturas, identificaciones y estados de cuenta. El OCR devuelve palabras, cada una con su caja y su confianza. Leer un campo son muchas clasificaciones seguidas, una por carácter, y el campo solo sirve si todas aciertan.

:::ejemplo Una CLABE de 18 dígitos
La CLABE, la clave de una cuenta bancaria en México, tiene 18 dígitos, y un solo dígito mal ya es un error. Supón que el modelo lee cada dígito con 99 % de probabilidad de acertar, y que un error en un dígito no cambia la probabilidad de los demás. Si cada dígito sale bien con probabilidad \(q\), los \(n\) dígitos salen bien con probabilidad \(q^n\). Con \(q\) = 0.99 y \(n\) = 18: 0.99¹⁸ ≈ 0.835, así que falla en 1 de cada 6 campos. Con \(q\) = 0.999, sube a 0.999¹⁸ ≈ 98.2 %.
:::

Por eso un sistema así calibra la confianza **por campo**, no por letra, y pone un umbral por campo: arriba, el campo pasa solo; abajo, una persona lo revisa con el recorte de la imagen. El éxito se mide con el STP (*straight-through processing*): qué porcentaje de documentos pasa sin que nadie lo toque.

### Moderación: una sigmoide y sus umbrales por política

En la moderación de contenido de la red social del ejemplo, el modelo da un logit por cada una de las 7 políticas, y cada uno pasa por su sigmoide, como el post de spam y amenaza de la sección de la sigmoide. Después, cada política compara su probabilidad con sus propios umbrales: por ejemplo, uno para mandar a revisión y otro, mucho más alto, para no publicar sin que nadie lo mire.

:::diagrama modelo-moderacion
Cómo decide un sistema de moderación con un modelo multietiqueta. Prueba los tres recorridos; toca cada caja para ver por qué está ahí.
:::

En Python, la sigmoide es una línea. Aquí está con aquel post y una regla distinta por política, como en la moderación:

```python
import math

def sigmoide(z):
    return 1 / (1 + math.exp(-z))

for z in [-4, -2, 0, 2, 4]:
    print(f"z = {z:>2}  ->  p = {sigmoide(z):.3f}")

logits = {"spam": 2.0, "violencia": 1.0, "odio": -3.0}
reglas = {"spam": (0.98, "bloquear"), "violencia": (0.50, "revisar"), "odio": (0.60, "revisar")}
for politica, z in logits.items():
    p = sigmoide(z)
    umbral, accion = reglas[politica]
    print(f"{politica:<10} p = {p:.3f}  umbral {umbral:.2f}  ->  {accion if p >= umbral else 'nada'}")
```

```salida
z = -4  ->  p = 0.018
z = -2  ->  p = 0.119
z =  0  ->  p = 0.500
z =  2  ->  p = 0.881
z =  4  ->  p = 0.982
spam       p = 0.881  umbral 0.98  ->  nada
violencia  p = 0.731  umbral 0.50  ->  revisar
odio       p = 0.047  umbral 0.60  ->  nada
```

### Recomendación: puntajes para ordenar

En un sistema de recomendación, cada vez que alguien abre la pantalla de inicio de un marketplace se juntan ≈ 1,000 publicaciones candidatas, y un modelo les da dos números a cada una: P(click), la probabilidad de que la toque, y P(contacto | click), la de que contacte al vendedor si la tocó. Se ordenan por un puntaje que combina las dos: P(click) × (P(contacto | click) + 0.05). Es un ranking: lo que importa es el orden.

:::ejemplo Dos publicaciones, un orden
A: P(click) = 0.10 y P(contacto | click) = 0.30, así que su puntaje es 0.10 × 0.35 = 0.035. B: P(click) = 0.20 y P(contacto | click) = 0.05, así que 0.20 × 0.10 = 0.020. A va primero aunque B reciba el doble de clics, porque A da más contactos: 0.03 contra 0.01 por cada vez que se muestra. Si una versión nueva infla por error la segunda probabilidad de B a 0.15, B salta a 0.20 × 0.20 = 0.040 y pasa adelante sin merecerlo.
:::

La regla es esta: cuando solo ordenas, el valor exacto importa poco; cuando multiplicas dos salidas, cada una tiene que estar calibrada. Y el baseline de este sistema es la pantalla de inicio de hoy («recientes en tu ciudad» y lo popular), que también es su plan B.

### Fraude: binaria con un umbral que sale del dinero

En la detección de fraude en tiempo real, un modelo da la probabilidad de fraude de cada pago, \(p\), calibrada. Dejar pasar un fraude cuesta el monto más ≈ US$15 de comisión; rechazar a un cliente bueno, ≈ US$5–10 que fija el negocio (usemos el punto medio, US$7.5). Si solo puedes aprobar o rechazar, conviene rechazar cuando lo que esperas perder al aprobar, p × (monto + 15), supera lo que esperas perder al rechazar, (1 − p) × 7.5. El punto donde los dos empatan es el umbral:

:::formula Umbral que sale del costo de cada error
u × c_f = (1 − u) × c_r
u = frac{c_r}{c_f + c_r}
- c_f: lo que cuesta aprobar un fraude: el monto más ≈ US$15 de comisión, en US$
- c_r: lo que cuesta rechazar a un cliente bueno, en US$ (aquí, 7.5)
- u: el umbral: la probabilidad de fraude donde los dos costos esperados empatan. Desde ahí conviene rechazar
:::

:::cuenta El umbral de un pago de US$25
Costo de aprobar un fraude, \(c_f\) // el monto más la comisión | 25 + 15 | US$40
Costo de rechazar a un cliente bueno, \(c_r\) // el negocio lo fija entre US$5 y US$10 | (5 + 10) ÷ 2 | US$7.5
Umbral \(u\), donde los dos costos empatan | \(u = c_r ÷ (c_f + c_r)\) = 7.5 ÷ (40 + 7.5) | 0.158
= Conviene rechazar desde **p ≈ 16 %**. Con un pago de US$250, \(c_f\) = 250 + 15 = 265 y el umbral baja a 7.5 ÷ (265 + 7.5) = 7.5 ÷ 272.5 ≈ **2.8 %**.
:::

El umbral depende del monto, por eso este sistema usa umbrales por segmento (tipo de comercio y rango de monto) y no uno solo. El sistema real tiene una tercera opción, pedir una verificación extra con el banco (*step-up*, por ejemplo un código en el celular), y con ella el rechazo para US$25 solo conviene desde ≈ 44 %. Su baseline son ≈ 400 reglas escritas a mano, que siguen como respaldo.

### Demanda: regresión con su baseline

En el pronóstico de demanda, imagina una cadena de ≈ 400 supermercados que pronostica cada noche cuánto se va a vender de cada producto en cada tienda, para los siguientes 14 días. La salida son números: un valor central y uno alto, para pedir un poco de más por si se vende más de lo normal (el inventario de seguridad). El baseline es la hoja de siempre, «lo mismo que el mismo día de la semana pasada», y se mide con el **WAPE**: el error absoluto total ÷ las ventas totales. En los productos que más se venden, la hoja tiene WAPE ≈ 45 %: se desvía 45 unidades por cada 100 vendidas.

:::formula WAPE
text{WAPE} = frac{sum_t |v_t − y_t|}{sum_t v_t}
- t: cada día (o cada tienda y producto) que entra en la cuenta
- v_t: lo que de verdad se vendió en \(t\), en unidades
- y_t: lo que pronosticó el modelo (o el baseline) para ese mismo \(t\), en unidades
- |v_t − y_t|: el error de ese \(t\), sin signo (el error absoluto)
:::

El baseline sirve hasta en el monitoreo: cada lunes, este sistema compara el modelo contra la hoja en la misma semana. Si los dos empeoraron igual, la semana fue difícil; si solo empeoró el modelo, algo se rompió.

### En tu día a día

- El filtro de spam de tu correo es una clasificación binaria con umbral; la carpeta de spam es la acción.
- La galería de tu celular, que encuentra «playa» y «perro» en la misma foto, es multietiqueta.
- El teclado que sugiere tu siguiente palabra hace un ranking: le da un puntaje a cada palabra posible y te muestra las tres mejores, un top-3.

## Ejercicios {Exercises}

Resuélvelos con lápiz (y una calculadora con la tecla eˣ) antes de abrir la solución.

:::ejercicios
? [facil] Un modelo lineal de precios tiene w = −250 y b = 2,000. ¿Qué precio sugiere para unos tenis de 3 años? ¿Con cuántos años llega a 0?
Usa \(y = w × x + b\). Con 3 años: \(y\) = −250 × 3 + 2,000 = −750 + 2,000 = **1,250 pesos**.

Llega a 0 cuando \(w × x + b = 0\), o sea \(x = −b ÷ w\) = −2,000 ÷ (−250) = **8** años. Después de 8 años predice precios negativos: el modelo no sabe que eso no tiene sentido.
? [facil] Calcula el softmax de los logits 2, 0 y 0.
Usa \(p_i = e^{z_i} ÷ sum e^{z_j}\). Arriba: e² ≈ 7.39 y e⁰ = 1 (dos veces). Abajo, la suma: 7.39 + 1 + 1 = 9.39.

Quedan 7.39 ÷ 9.39 ≈ **78.7 %** y 1 ÷ 9.39 ≈ **10.7 %** para cada una de las otras dos. Revisa: 78.7 + 10.7 + 10.7 = 100.1, que es 100 con el redondeo.
? [facil] ¿Qué tarea es cada una, y con qué termina el modelo? (a) ¿Este correo es spam? (b) La categoría de una foto en Alba, de 500. (c) Las etiquetas de una foto de vacaciones: playa, perro, atardecer. (d) Cuántos minutos tarda un envío.
(a) Binaria: un logit y una sigmoide. (b) Multiclase: 500 logits y softmax. (c) Multietiqueta: un logit por etiqueta y una sigmoide para cada una, porque una foto puede tener las tres. (d) Regresión: un número, sin nada al final.
? [facil] Un clasificador binario da el logit z = −1. ¿Qué probabilidad da la sigmoide? Con umbral 0.5, ¿dice «sí»?
Usa \(p = 1 ÷ (1 + e^{−z})\) con \(z\) = −1: \(e^{−z}\) = e^(−(−1)) = e¹ ≈ 2.72. Entonces \(p\) = 1 ÷ (1 + 2.72) = 1 ÷ 3.72 ≈ **26.9 %**.

Es menor que 0.5, así que dice **no**. Atajo: con umbral 0.5 basta ver el signo del logit; negativo es «no».
? [medio] Un modelo de 5 categorías da los logits 1.2, 3.4, −0.5, 3.1 y 0.0. ¿Cuál es el argmax y cuál el top-2? ¿Cambian si aplicas softmax? ¿Y si les sumas 7 a todos?
El argmax es la **segunda** categoría (logit 3.4). El top-2 son la segunda y la cuarta (3.4 y 3.1).

No cambian con softmax, porque softmax no cambia el orden. Tampoco sumando 7: el orden sigue igual, y además las probabilidades salen idénticas.

Un detalle: la diferencia entre el primero y el segundo es 3.4 − 3.1 = 0.3. Con softmax, la razón entre dos probabilidades es \(p_1 ÷ p_2 = e^{z_1 − z_2}\), así que el primero es solo e^0.3 ≈ 1.35 veces más probable. Es una foto en la que el modelo duda.
? [medio] Un post da los logits spam 1.5, violencia 0.5 y odio −2.0. Calcula sus probabilidades con una sigmoide por política y con softmax. Con un umbral de revisión de 0.5 en cada política, ¿qué se revisa en cada caso?
**Sigmoides**, \(p = 1 ÷ (1 + e^{−z})\). Spam: 1 ÷ (1 + e^(−1.5)) = 1 ÷ (1 + 0.223) ≈ 81.8 %. Violencia: 1 ÷ (1 + e^(−0.5)) = 1 ÷ (1 + 0.607) ≈ 62.2 %. Odio: 1 ÷ (1 + e^2) = 1 ÷ (1 + 7.39) ≈ 11.9 %. Se revisan **spam y violencia**.

**Softmax**, \(p_i = e^{z_i} ÷ sum e^{z_j}\). e^1.5 ≈ 4.48, e^0.5 ≈ 1.65 y e^(−2) ≈ 0.14 suman 6.27. Quedan spam 4.48 ÷ 6.27 ≈ 71.5 %, violencia 1.65 ÷ 6.27 ≈ 26.3 % y odio 0.14 ÷ 6.27 ≈ 2.2 %. Solo se revisa **spam**: la violencia se escondió. Por eso la multietiqueta va con sigmoides.
? [medio] En un sistema de moderación, 0.5 % de los posts viola alguna política. Un modelo saca 99.6 % de accuracy: de 100,000 posts, atrapa 300 de los que violan y marca por error 200 buenos. Revisa que eso da 99.6 % y di qué te dice de verdad.
Usa accuracy = aciertos ÷ total. De 100,000 posts, violan 0.5 % × 100,000 = 500.

**Baseline** «nada viola»: acierta los 100,000 − 500 = 99,500 buenos: 99,500 ÷ 100,000 = 99.5 %.

**Modelo:** se equivoca en 200 que violan y se escaparon (500 − 300) y en 200 buenos marcados. Son 200 + 200 = 400 errores, así que acierta 100,000 − 400 = 99,600: 99,600 ÷ 100,000 = 99.6 %. Apenas 0.1 puntos mejor que no hacer nada.

Lo que importa: de los 500 que violan, atrapó 300 (60 %); y de los 500 que marcó (300 + 200), 300 eran de verdad (60 %). Esas dos medidas son el recall y la precision, y las ves en «¿Aprendió de verdad?».
? [medio] Una tienda vendió esta semana, de lunes a domingo, 10, 8, 12, 9, 15, 22 y 18 litros de leche. El baseline («lo del mismo día de la semana pasada») había dicho 5, 12, 8, 15, 9, 14 y 26. Un modelo dijo 8, 10, 10, 11, 12, 19 y 21. Calcula el WAPE de cada uno (error absoluto total ÷ ventas totales).
Usa \(WAPE = sum_t |v_t − y_t| ÷ sum_t v_t\). Abajo, las ventas totales: 10 + 8 + 12 + 9 + 15 + 22 + 18 = 94.

**Baseline.** Errores \(|v_t − y_t|\): |10 − 5| = 5, |8 − 12| = 4, 4, 6, 6, 8 y 8, que suman 41. WAPE = 41 ÷ 94 ≈ **43.6 %**.

**Modelo.** Errores: |10 − 8| = 2, |8 − 10| = 2, 2, 2, 3, 3 y 3, que suman 17. WAPE = 17 ÷ 94 ≈ **18.1 %**.

El modelo le gana al baseline en esta semana. Una semana no prueba nada: un sistema de pronóstico de demanda lo compara en muchas semanas y tiendas, y la hoja del ejemplo de los supermercados tiene WAPE ≈ 45 %.
? [reto] Un pago de US$100 tiene probabilidad de fraude calibrada p = 0.08. Aprobar un fraude cuesta el monto más US$15; rechazar a un cliente bueno, US$7.5. Solo puedes aprobar o rechazar. ¿Qué conviene? ¿Desde qué p conviene rechazar?
Compara lo que esperas perder en cada caso, \(p × c_f\) contra \((1 − p) × c_r\), y usa el umbral \(u = c_r ÷ (c_f + c_r)\), con \(c_f\) = 100 + 15 = US$115 y \(c_r\) = US$7.5.

:::cuenta Aprobar o rechazar un pago de US$100
Perder si apruebas, \(p × c_f\) // probabilidad de fraude × lo que cuesta | 0.08 × (100 + 15) | US$9.20
Perder si rechazas, \((1 − p) × c_r\) // probabilidad de que sea bueno × US$7.5 | (1 − 0.08) × 7.5 = 0.92 × 7.5 | US$6.90
Umbral \(u\) | \(u = c_r ÷ (c_f + c_r)\) = 7.5 ÷ (115 + 7.5) | 0.061
= Conviene **rechazar**: cuesta menos en promedio. El umbral para US$100 es **p ≈ 6.1 %**.
:::

Fíjate en dos cosas. El umbral depende del monto (para US$25 era 16 %). Y todo esto funciona solo si p está calibrada: si el modelo dice 0.08 pero en realidad es 0.02, estás rechazando clientes buenos.
? [reto] Alguien agrega por error un softmax extra al final del modelo de Alba, que ya devolvía probabilidades. El top-1 de una foto era 0.9 y las otras 499 categorías se repartían el 0.1 restante. ¿Qué top-1 sale ahora? ¿Qué le pasa a la regla de baja confianza (top-1 menor que 0.3) y a su alerta?
El segundo softmax es \(p_i = e^{z_i} ÷ sum e^{z_j}\), pero ahora las \(z\) son las probabilidades: eleva e a cada una. El top-1 da e^0.9 ≈ 2.46. En promedio, cada una de las otras 499 vale 0.1 ÷ 499 ≈ 0.0002, y e^0.0002 ≈ 1.0002, así que entre todas suman 499 × 1.0002 ≈ 499.1. El total es 2.46 + 499.1 ≈ 501.6.

Top-1 nuevo: 2.46 ÷ 501.6 ≈ **0.0049**, menos de 0.5 %. Ni una foto perfecta se salva: con 1.0, sale e¹ ÷ (e¹ + 499) ≈ 0.54 %.

Así que **todas** las fotos quedan debajo de 0.3. La tasa de baja confianza salta a 100 %, la alerta (el doble de su promedio de 7 días durante 30 minutos) se dispara y la cola de etiquetado se inunda. Ana ve las mismas cinco sugerencias en el mismo orden, pero con porcentajes de 0.5 % para abajo. Nada truena, y por eso este error es peligroso.
:::

## Lo que sigue {What comes next}

- **«Cómo guarda números una computadora»:** qué es FP16 y por qué, al convertir el modelo, los logits cambian del orden de 0.01 y el argmax se puede mover en las fotos casi empatadas.
- **Las siguientes lecciones:** «Una foto, vista por un modelo» explica cómo se arman los 150,528 números que entran; «Cómo aprende un modelo», cómo el entrenamiento gira las perillas; «¿Aprendió de verdad?», cómo se mide un modelo contra su baseline; y «Redes neuronales y CNNs», qué hay entre la entrada y los logits.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
funcion tarea clasificacion clasificacion-binaria multiclase multietiqueta regresion ranking deteccion segmentacion ocr logit softmax sigmoide probabilidad confianza argmax top-k umbral baseline
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Un modelo da los logits 2, 2 y 0 para Tenis, Botas y Sandalias. ¿Qué probabilidades salen?
Con \(p_i = e^{z_i} ÷ sum e^{z_j}\): e² ≈ 7.39 dos veces y e⁰ = 1 suman 15.78. Quedan 7.39 ÷ 15.78 ≈ 46.8 % para Tenis, 46.8 % para Botas y 1 ÷ 15.78 ≈ 6.3 % para Sandalias. El modelo está empatado entre dos. Aunque el top-1 pase de 0.3, la diferencia entre el primero y el segundo es cero: en Alba, una foto con ese margen tan chico también se aparta para que una persona la etiquete.
? ¿Por qué el modelo de moderación de la red social del ejemplo usa una sigmoide por política y no softmax?
Porque un post puede violar varias políticas a la vez. Softmax las haría competir por el 100 %, y una escondería a la otra: con logits 2 y 1, la violencia quedaría en 26.8 % con softmax y en 73.1 % con su sigmoide.
? El modelo dice «Tenis, 94 %». ¿Quiere decir que acertó?
No. Es su confianza, no una garantía. Si está bien calibrado, de cada 100 fotos con 94 % se equivoca en unas 6. Además, siempre reparte el 100 % entre las categorías que conoce, aunque la foto no sea de ninguna, y con fotos distintas a las del entrenamiento puede estar muy seguro y equivocado.
? ¿Por qué el argmax de los logits es el mismo que el de las probabilidades?
Porque softmax no cambia el orden: eˣ crece con x, y dividir todo entre la misma suma no cambia cuál es el mayor. Softmax hace falta para saber por cuánto gana el primero, no cuál gana.
? Un detector de fraude saca 99.9 % de accuracy. ¿Qué preguntas primero?
Cuánto saca el baseline. Si el fraude es ≈ 0.08 % de los pagos, como en el ejemplo de esta lección, «aprobar todo» saca 99.92 % sin atrapar ninguno: el 99.9 % acierta menos que no hacer nada, y aun así podría servir. Hay que ver cuántos fraudes atrapa y a cuántos clientes buenos rechaza.
? En Alba subes el umbral de baja confianza de 0.3 a 0.6. ¿Qué cambia?
Más fotos cuentan como dudosas. Llegan más a la cola de etiquetado, que cuesta dinero porque las revisa una persona, y la tasa de baja confianza sube de golpe: la alerta que la compara con su promedio de 7 días puede saltar sin que nada se haya roto, así que también hay que ajustarla. Ana ve lo mismo: en Alba, la regla no cambia sus sugerencias. El modelo es el mismo: solo cambió la regla.
:::
