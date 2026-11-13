---
titulo: Datos, ejemplos, features y etiquetas
en: Data, examples, features and labels
subtitulo: Con qué aprende un modelo, cómo se vuelve todo números, cómo se reparte el material para examinarlo, de dónde salen las etiquetas y las trampas que hacen que el examen mienta.
pregunta: ¿Qué le das exactamente a un modelo para que aprenda, y cómo sabes que no se aprendió las respuestas de memoria?
requisitos: modelo, imagenes
---

:::idea
Un modelo aprende de ejemplos que ya traen su respuesta, escritos como números. Para saber si de verdad aprendió, hay que examinarlo con ejemplos que nunca vio, cuidar que el examen no se filtre y recordar que las respuestas también las escribió alguien que se equivoca.
:::

## Un ejemplo: lo que entra y la respuesta {One example: input and answer}

Un [[ejemplo]] es un caso del que ya sabes la respuesta. Tiene dos partes: la **entrada**, que es lo que el modelo va a ver, y la [[etiqueta]], que es la respuesta correcta. Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. En Alba, un ejemplo es la foto de una publicación junto con su categoría: la foto de los tenis de Ana y «Calzado › Tenis».

A aprender de ejemplos que ya traen su respuesta, como una tarea ya calificada, se le llama **aprendizaje supervisado** (*supervised learning*). Casi todo lo que vas a ver en el curso es de este tipo, empezando por el modelo de Alba, que es una [[clasificacion|clasificación]]: elegir una categoría entre 500.

### Features: la entrada, en datos sueltos

Cada dato de la entrada que el modelo usa para decidir es una [[feature]]. En español a veces se dice «característica» o «variable», pero en el trabajo casi todo el mundo dice *feature*.

**Datos en tabla.** En un sistema de detección de fraude, un modelo decide si un pago con tarjeta es fraude mientras se cobra. En otro, un sitio de noticias predice si le darán clic a un anuncio. Su entrada es una fila de datos sueltos, cada uno con nombre, y a los datos que caben así se les llama **tabulares**:

| | Fraude en pagos | Clics en anuncios |
|---|---|---|
| La pregunta | ¿Este pago es fraude? | ¿Le darán clic a este anuncio? |
| Las features de un ejemplo | monto US$45 · giro del comercio «videojuegos» · hora 03:12 · 4 intentos de la tarjeta en el último minuto | sección «deportes» · dispositivo «android» · hora 21 · anuncio de «autos» · lugar en la página «arriba» |
| La etiqueta y de dónde sale | fraude sí o no: llega como contracargo, cuando el dueño de la tarjeta desconoce el cargo, semanas después | clic sí o no, en los 30 minutos siguientes |
| Qué tan rara es la respuesta «sí» | ≈ 0.08 %: 1 de cada 1,250 pagos | ≈ 0.35 %: 1 de cada ≈ 286 anuncios mostrados |

Fíjate en tres cosas. Unas features son números (el monto) y otras, categorías (el giro), que hay que convertir en números porque un modelo solo hace cuentas. La etiqueta no siempre la pone una persona: aquí la escribe lo que pasó después. Y la respuesta «sí» es rarísima, lo que complica medir: un modelo que dijera siempre «no» acertaría 99.92 % de los pagos sin atrapar un solo fraude.

**Imágenes.** En una foto no hay columnas con nombre. La entrada son los [[pixel|píxeles]]: una foto de 224 × 224 píxeles, con 3 números por píxel (cuánto rojo, cuánto verde y cuánto azul), son 224 × 224 × 3 = **150,528 números**. Ninguno significa nada por sí solo: el número 10,000 no es «tiene agujetas». Un modelo para imágenes recibe los píxeles crudos y aprende por dentro sus propias features útiles: primero bordes, luego formas y luego cosas como «suela». Lo verás en la lección de redes neuronales.

| | Datos en tabla | Imágenes |
|---|---|---|
| Qué es una feature | Una columna con nombre: monto, giro, hora | Un píxel; las features útiles las arma el modelo por dentro |
| Quién elige las features | Una persona (a eso se le llama *feature engineering*) | El modelo, mientras aprende |
| Cuántos números por ejemplo | Decenas o cientos | 150,528 en una foto de 224 × 224 |
| Ejemplos | Fraude en pagos, pronóstico de ventas, clics en anuncios | La categoría de una foto en Alba, video de varias cámaras, inspección de piezas en una fábrica |

El modelo de Alba solo mira la foto. Pero la publicación trae más cosas: el precio, el título, la historia del vendedor. Son features posibles. Usarlas o no es una decisión de diseño: un precio de 30 pesos casi descarta «Refrigeradores», pero Ana sube la foto antes de terminar de escribir, así que en ese momento el precio todavía no existe y el modelo no puede contar con él.

:::ojo
Una feature solo sirve si existe **en el momento de predecir**. Guarda esa frase: es la mitad de la sección de *leakage*, más abajo.
:::

### El dataset es una tabla

Un [[dataset]] junta muchos ejemplos. Piénsalo como una tabla: cada fila es un ejemplo, cada columna una feature y la última columna, la etiqueta.

:::figura ejemplos-tabla
Cuatro filas de un dataset. En Alba la columna «foto» no guarda la imagen misma, sino dónde está guardada; así se puede tener una versión fija de cada mes sin copiar cientos de gigabytes.
:::

La última columna es la más cara: de dónde sale lo ves en «Etiquetas», más abajo.

## Convertir todo en números {Encoding, missing values and scaling}

Un modelo solo multiplica y suma, así que todo le tiene que llegar como número, y bien: sin relaciones inventadas, sin huecos y en escalas comparables. Son tres decisiones de casi cualquier dataset de tabla. En las tres vas a leer dos palabras que la sección siguiente explica a fondo: **train**, la parte de los datos con la que el modelo aprende, y **test**, la que se guarda para examinarlo al final.

### Categorías: por qué no 1, 2 y 3

El giro del comercio no es un número: es «supermercado», «gasolinera» o «videojuegos». Convertirlo en números se llama [[codificacion|codificación]] (*encoding*). Numerarlos 1, 2 y 3 es la peor forma, porque inventa un **orden** (videojuegos, el 3, sería «más» que supermercado) y una **distancia** (gasolinera, el 2, quedaría a la mitad).

:::ejemplo Un solo peso para tres giros
Imagina un modelo que da un puntaje sumando cada feature multiplicada por su peso, un número que el entrenamiento ajusta. Con el giro numerado hay un solo peso para él, digamos 0.4:

- Supermercado: 0.4 × 1 = 0.4
- Gasolinera: 0.4 × 2 = 0.8
- Videojuegos: 0.4 × 3 = 1.2

El efecto de videojuegos queda obligado a ser el triple que el de supermercado, y el de gasolinera, justo el doble. Si en los datos las gasolineras casi no tienen fraude y los videojuegos mucho, ningún peso único puede decirlo.
:::

La solución más común es el [[one-hot]]: una columna por cada valor posible, con 1 en la del valor que tiene el ejemplo y 0 en las demás.

| Pago | Giro | ¿supermercado? | ¿gasolinera? | ¿videojuegos? |
|---|---|---|---|---|
| 1 | supermercado | 1 | 0 | 0 |
| 2 | videojuegos | 0 | 0 | 1 |
| 3 | gasolinera | 0 | 1 | 0 |
| 4 | videojuegos | 0 | 0 | 1 |

Ahora cada giro tiene su propio peso: el modelo puede aprender que videojuegos sube mucho el riesgo y gasolinera casi nada, y ningún giro queda «más grande» ni «a la mitad» de otro. Tres detalles:

- **Cuando el orden sí existe**, numerar está bien: en las tallas chica, mediana y grande, el orden 1, 2 y 3 es verdadero. Que de una talla a la siguiente haya la misma distancia sigue siendo una suposición, pero razonable.
- **Un valor que no se vio al entrenar** no tiene columna. Se reserva una columna «otro» para lo nuevo.
- **Con muchísimos valores**, one-hot se vuelve enorme. En el ejemplo de anuncios varias features son combinaciones de dos, como «sección deportes y anuncio de autos» o «región y anunciante», y entre todas pueden sumar cientos de miles de valores distintos: una columna por cada uno, casi todas en 0, y una lista que habría que mantener al día. Ahí se usa *hashing*: una fórmula fija manda cada valor a una de un número fijo de casillas, sin lista. Ese sistema usa 2²⁴ = 16,777,216 casillas con un peso cada una: 2²⁴ × 4 bytes ≈ 67 MB, y un anuncio nuevo cae en sus casillas desde que aparece. La otra salida es aprender una lista de números por valor, un [[embedding]], que ves en su propia lección.

### Valores faltantes

A veces una feature no tiene valor: el pago llegó sin el programa que identifica al dispositivo (el SDK), o la tienda no subió sus ventas. Es un [[valor-faltante|valor faltante]] (*missing value*), y hay que decidir qué hacer con él **antes** de entrenar, y hacer lo mismo al servir. Hay tres salidas:

:::pasos
1. Quitar
Borrar los ejemplos con huecos, o la columna si casi siempre falta. Es lo más fácil y a veces lo peor: si lo que falta no falta al azar, quitas justo un tipo de caso. En el ejemplo de fraude, sin los pagos que no traen dispositivo, el modelo no sabe qué hacer cuando llega uno.
2. Rellenar (imputar)
Poner un valor razonable: la [[mediana]] de train (el valor de en medio cuando los ordenas) o una regla del negocio. Un sistema que pronostica ventas de supermercado rellena a la tienda que no reportó con sus ventas del mismo día de la semana anterior, y marca esas filas (`imputed_input`) para medirlas aparte.
3. Dejarlo como «no sé»
Guardar el hueco como un valor especial, NaN (*not a number*, «no es un número»), para un modelo que lo sabe usar. Los modelos de fraude y de ventas de supermercado suman muchos árboles de decisión, cadenas de preguntas como «¿monto mayor que 100?», y a esa técnica se le llama *gradient boosting*; sus librerías (LightGBM, XGBoost) aprenden por qué rama mandar los NaN. En una categoría se agrega el valor «desconocido» con su propio peso, como hace el de anuncios cuando no sabe qué lee una persona.
:::

:::ejemplo Rellenar con el promedio puede mentir
Seis pagos traen «compras del mismo dispositivo en 24 horas»: 0, 1, 1, 2, 3 y 40. Otros dos no lo traen.

- Promedio: (0 + 1 + 1 + 2 + 3 + 40) ÷ 6 = 47 ÷ 6 ≈ **7.8**.
- Mediana: ordenados, los dos de en medio son 1 y 2, así que (1 + 2) ÷ 2 = **1.5**.

Rellenar con 7.8 haría que dos pagos de los que no sabes nada parezcan muy activos, por culpa de un solo valor raro, el 40. Por eso se prefiere la mediana, y se marca la fila como rellenada.
:::

:::ojo
**Nunca rellenes con 0 si 0 significa otra cosa.** En el ejemplo de fraude, «0 compras en 24 horas» es una afirmación: un cliente tranquilo, de bajo riesgo. «No sé cuántas» es otra, y con un 0 el modelo lee calma donde no hay información. El pronóstico de ventas de supermercado tiene la versión más traicionera: un producto sin ventas ayer puede haber **vendido cero** (había y nadie lo compró), estar **agotado** (no había, y la demanda real no se sabe) o **no tener dato** (la tienda no subió nada). Confundirlos es una de las fuentes más comunes de pronósticos que se hunden solos.
:::

### Escalas

Las features de tabla vienen en escalas muy distintas: el monto va de centavos a miles de dólares; la hora, de 0 a 23. Para un modelo que suma *peso × feature* y aprende moviendo sus pesos a pasitos (lo ves en «Cómo aprende un modelo»), la feature en miles domina y el aprendizaje avanza a tirones. Por eso se hace [[escalamiento]] (*feature scaling*): llevarlas a una escala parecida.

La forma más común es **estandarizar**: restarle a cada valor el promedio y dividir entre la [[desviacion-estandar|desviación estándar]], que mide qué tan lejos del promedio suelen caer los valores.

:::formula Estandarizar una feature
μ = frac{1}{n} sum_{i=1}^{n} x_i
σ = sqrt{frac{1}{n} sum_{i=1}^{n} (x_i − μ)^2}
z = frac{x − μ}{σ}
- x_i: cada valor de la feature en train; hay \(n\) valores
- μ: el promedio de train (la letra griega «mu»), en las unidades de la feature: dólares, para el monto
- σ: la desviación estándar de train («sigma»), en las mismas unidades
- x: el valor que vas a estandarizar
- z: el valor estandarizado: cuántas desviaciones estándar queda \(x\) arriba (si es positivo) o abajo (si es negativo) del promedio. No tiene unidad
:::

:::ejemplo Estandarizar cinco montos
Los montos de cinco pagos de train: 20, 30, 35, 40 y 50 dólares.

- Promedio, \(μ\): (20 + 30 + 35 + 40 + 50) ÷ 5 = 175 ÷ 5 = **35**.
- Distancia de cada uno al promedio, \(x_i − μ\): −15, −5, 0, 5 y 15.
- Al cuadrado: 225, 25, 0, 25 y 225. Su promedio, 500 ÷ 5 = 100, es la [[varianza]], \(σ^2\).
- La desviación estándar es su raíz: \(σ = sqrt{100}\) = **10**.
- Estandarizados, con \(z = (x − μ)/σ\): (20 − 35) ÷ 10 = −1.5, y luego −0.5, 0, 0.5 y 1.5.

Ahora «z = 1.5» quiere decir «una desviación y media arriba del promedio», sea monto u hora. Un pago nuevo de US$90 queda en (90 − 35) ÷ 10 = **5.5**: muy lejos de lo habitual. (Aquí se divide entre 5; hay una versión que divide entre 4, n − 1. Con miles de datos casi no cambia, y la diferencia la ves en la lección de ruido.)
:::

Dos reglas, y las dos vienen de errores reales:

- **El promedio y la desviación se calculan solo con train**, y se guardan. Si los sacas con todo el dataset antes de repartir, el train ya «sabe» algo del test: es una forma discreta de [[leakage]].
- **Al servir se usan los mismos 35 y 10**, guardados junto al modelo. Si se recalcularan con lo que llega, con un solo pago la desviación sería 0 y la cuenta ni se podría hacer; y si cambian un poco, el modelo recibe números distintos a los que aprendió sin que nada truene. A esa diferencia entre lo que el modelo vio al entrenar y lo que recibe al servir se le llama [[training-serving-skew]].

A un árbol de decisión le da igual la escala: solo compara cada feature contra un corte. Y en imágenes ya lo viste con otro nombre: la [[normalizacion]] de la lección anterior es esta cuenta, por canal, con el promedio y la desviación de ImageNet.

## Tres montones: train, validación y test {Train, validation and test}

La pregunta importante no es si el modelo acierta. Es si acierta **con fotos que nunca vio**, como la de Ana. Un modelo con 24.5 millones de [[parametro|parámetros]] tiene perillas de sobra para aprenderse de memoria cada foto de su entrenamiento. Si lo examinas con esas mismas fotos, puede sacar casi 100 % y fallar con la primera foto nueva. A que le vaya bien con datos nuevos se le llama [[generalizacion|generalización]], y es lo único que importa en producción.

Por eso, antes de entrenar, el dataset se reparte en tres partes que no se mezclan. A eso se le llama hacer el [[split]]:

:::pasos
1. Train
El [[train-set]] es con lo que el modelo aprende: sus perillas se ajustan para acertarles a estas fotos. Es la parte más grande.
2. Validación
El [[validation-set]] no se usa para aprender. Lo miras tú mientras desarrollas, para decidir: cuándo parar de entrenar, qué ajustes usar, cuál de dos versiones es mejor.
3. Test
El [[test-set]] se guarda bajo llave y se usa al final, una vez, con el modelo ya elegido. Ese número es tu mejor estimación de cómo le irá en producción.
:::

:::ejemplo Repartir 50,000 fotos
Un reparto típico es 80 / 10 / 10. Cada parte recibe el total por su fracción, \(N × f\): 50,000 × 0.80 = 40,000 fotos a train, 50,000 × 0.10 = 5,000 a validación y otras 5,000 a test. Suman 50,000 y ninguna foto está en dos partes.
:::

:::diagrama ejemplos-split
Toca cada caja para ver por qué está ahí, o sigue los dos recorridos.
:::

:::analogia El examen de la escuela
- **Train** son los ejercicios resueltos del libro: con ellos estudias.
- **Validación** son los exámenes de práctica: te los pones para ver cómo vas y cambiar cómo estudias.
- **Test** es el examen final: uno, al final, con preguntas que no habías visto.

**Dónde se rompe la analogía.** Primero: si pruebas 40 versiones y te quedas con la que mejor salió en validación, la elegiste en parte por suerte, y su número sale optimista sin que nadie lo note; por eso hace falta un test aparte. Segundo: ningún alumno memoriza 2 millones de ejercicios, y un modelo sí puede aprenderse de memoria casi 2 millones de fotos. Tercero: el examen final de verdad es producción, que cambia con el tiempo ([[drift]]); el test solo dice cómo le irá si el mundo se parece al test.
:::

:::ojo
**Nunca decidas con el test.** Si miras el test, cambias algo y lo vuelves a mirar, el test se convirtió en validación y ya no tienes un número honesto. Dicho de otra forma: probar 40 variantes y reportar la mejor en test convierte el test en validación.
:::

### ¿Cuánto va a cada parte?

Depende del tamaño. Con 1,000 fotos, 10 % de validación son 100 fotos: muy pocas para medir bien, y tal vez convenga 20 %. Con millones, un porcentaje chico ya es muchísimo. En Alba, el dataset de septiembre trae 1,840,211 fotos en train y 92,417 en validación:

- Total: 1,840,211 + 92,417 = 1,932,628 fotos.
- Validación: 92,417 ÷ 1,932,628 ≈ 0.048, o sea ≈ 5 %.

### Al azar o estratificado

La forma más simple de repartir es al azar: cada foto se sortea por separado, con 10 % de probabilidad de ir a validación, 10 % a test y 80 % a train. Con categorías grandes funciona bien. Con categorías chicas, la suerte pesa mucho. Para medir cuánto, estas son las cuentas de una categoría chica repartida al azar:

:::formula Una categoría chica, repartida al azar
E = m × f
P_0 = (1 − f)^m
P_1 = m × f × (1 − f)^{m − 1}
P_2 = frac{m × (m − 1)}{2}
× f^2 × (1 − f)^{m − 2}
- m: las fotos de la categoría
- f: la probabilidad de que una foto vaya a validación, como fracción: 0.1 para 10 %
- E: cuántas fotos de la categoría esperas en validación, en promedio
- P_0, P_1, P_2: la probabilidad de que caigan justo 0, 1 o 2 en validación. Cada foto se queda fuera con probabilidad \(1 − f\), y \(m × (m − 1)/2\) cuenta las parejas de fotos posibles
:::

:::cuenta Una categoría de 20 fotos, repartida de dos formas
Fotos de «Máquinas de escribir», \(m\) | en el dataset | 20
Probabilidad de ir a validación, \(f\) // 10 % | por foto | 0.1
Al azar: esperadas en validación, \(E\) | \(E = m × f\) = 20 × 0.1 | 2, en promedio
Al azar: que no caiga ninguna, \(P_0\) // cada una se queda fuera con 1 − 0.1 = 0.9 | \(P_0 = (1 − f)^m\) = 0.9²⁰ | ≈ 0.122
Al azar: que caiga justo 1, \(P_1\) | \(P_1 = m × f × (1 − f)^{m − 1}\) = 20 × 0.1 × 0.9¹⁹ | ≈ 0.270
Al azar: que caigan justo 2, \(P_2\) // hay 20 × 19 ÷ 2 = 190 parejas posibles | \(P_2\) = 190 × 0.1² × 0.9¹⁸ | ≈ 0.285
Al azar: que caigan 0 o 1 | \(P_0 + P_1\) = 0.122 + 0.270 | ≈ 0.39
Estratificado: train, validación y test | 20 × 0.8, 20 × 0.1 y 20 × 0.1 | 16, 2 y 2, siempre
= Al azar, unas 12 de cada 100 veces validación se queda sin ninguna máquina de escribir, y 39 de cada 100 tiene una o ninguna: esa categoría no se puede medir. Solo ≈ 29 de cada 100 veces sale el reparto «justo».
:::

El arreglo es un [[estratificado|split estratificado]]: repartir **cada categoría por separado** en la misma proporción, así las 20 máquinas de escribir quedan siempre en 16, 2 y 2. Se puede estratificar por cualquier cosa que deba salir bien representada: la categoría, o si la foto vino del celular o de la web.

:::calculadora ejemplos-dividir
Sube las fotos de la categoría rara a 50 y mira cómo baja el riesgo; luego baja la validación a 5 % y mira cómo vuelve a subir.
:::

### El test de Alba: el golden set

Cada mes Alba entrena un modelo nuevo, y para saber si es mejor que el de producción hay que examinarlos **con exactamente las mismas fotos**: si el examen cambia, no sabes si la diferencia es del modelo o del examen. Para eso está el [[golden-set|golden set]], un conjunto de evaluación de la mejor calidad que se arma una vez y se congela. El de Alba:

- ≈ 50 mil imágenes, cada una etiquetada por dos personas; si no coinciden, alguien con más experiencia decide.
- Estratificado: al menos ≈ 50 por categoría, para que la cola larga tenga con qué medirse, y repartido entre fotos de celular y de web.
- Congelado y **jamás usado para entrenar**. Si se entrenara con él, el modelo se lo sabría y dejaría de medir.
- Cuesta ≈ US$5–10 mil, una sola vez. La cuenta está en «Etiquetas», y ahí verás también por qué no sirve de examen la categoría que eligió quien vende.

## Leakage: cuando el examen se filtra {Data leakage}

El [[leakage]] (fuga de datos) es cuando el entrenamiento o la evaluación tienen información que no va a existir en el momento de predecir, o cuando el test se parece demasiado al train. El nombre lo dice: es un examen filtrado. El síntoma típico: un resultado sospechosamente bueno antes de producción que se derrumba en producción.

Es de lo más importante de esta lección porque no da ningún error: todo corre, los números se ven increíbles y nadie se entera hasta producción. Tres formas muy comunes:

### 1 · La misma foto en train y en test

En un marketplace la misma foto aparece una y otra vez: el vendedor sube la misma foto en tres publicaciones, o fotografía todo sobre la misma mesa con la misma luz. Si repartes al azar por publicación, las copias pueden quedar separadas: una en train y su gemela en test. El modelo no necesita entender nada para «acertarle»: ya la vio. Qué tan seguido pasa se calcula así:

:::formula Copias de una foto, repartidas al azar
P_{train} = t^k
P_{test} = (1 − t)^k
P_{sep} = 1 − P_{train} − P_{test}
P_{vista} = frac{P_{sep}}{1 − P_{train}}
- t: la fracción que va a train: 0.8 para 80 %
- k: cuántas copias de la foto hay
- P_{train}, P_{test}: la probabilidad de que todas las copias caigan en train, o todas en test
- P_{sep}: la probabilidad de que queden separadas, al menos una de cada lado
- P_{vista}: de las veces en que alguna copia sale en el examen, la fracción en que el modelo ya vio una gemela suya en train
:::

:::ejemplo La misma foto en tres publicaciones
Reparto al azar, 80 % a train y 20 % a test (\(t\) = 0.8). Para una foto que aparece en 3 publicaciones (\(k\) = 3):

- Las 3 caen en train: \(P_{train}\) = 0.8³ = 0.8 × 0.8 × 0.8 = 0.512.
- Las 3 caen en test: \(P_{test}\) = 0.2³ = 0.2 × 0.2 × 0.2 = 0.008.
- Quedan separadas (al menos una en cada lado): \(P_{sep}\) = 1 − 0.512 − 0.008 = 0.48.

Ahora mira solo los casos en que al menos una copia está en test: \(1 − P_{train}\) = 1 − 0.512 = 0.488. De esos, 0.48 tienen a su gemela en train: \(P_{vista}\) = 0.48 ÷ 0.488 ≈ 0.98. Es decir, **98 de cada 100 veces** que esa foto sale en el examen, el modelo ya vio una copia suya.
:::

La defensa tiene dos partes. Primero, **quitar copias antes de repartir**: a cada archivo se le calcula un *hash*, una huella digital corta que sale del contenido; dos archivos idénticos tienen la misma huella. Para fotos recortadas o vueltas a comprimir, los [[duplicado-cercano|casi duplicados]], hay huellas «perceptuales» que se parecen si las imágenes se parecen. Segundo, **repartir por grupo**: en Alba todas las fotos de un vendedor van al mismo lado, así que reconocer «la mesa de este vendedor» ya no sirve para acertar en validación. Eso es un [[split-por-grupo|split por grupo]]; las dos defensas, en código, están en la sección siguiente.

### 2 · Una feature que trae escondida la respuesta

A veces una columna de la tabla contiene la etiqueta disfrazada. Por ejemplo, un campo «re-categorizada por un moderador» o «estado final de la publicación». Se llenan **después** de que se publicó, a veces justo porque la categoría estaba mal. En el dataset histórico están llenos, y el modelo aprende a usarlos. En producción, cuando Ana sube su foto, ese campo todavía está vacío.

En fraude pasa con «contracargos de la tarjeta en los últimos 90 días», calculada hoy para todo el historial: un pago fraudulento del 1 de septiembre cuyo contracargo llegó el 20 queda con la feature en 1, y ese 1 es su propia etiqueta. En el examen, el modelo se ve casi perfecto.

La prueba es una pregunta, columna por columna: **¿este dato ya existía en el instante en que el modelo tiene que responder?** Si la respuesta es no, fuera.

### 3 · Información del futuro

Imagina una feature «ventas del vendedor en los últimos 90 días» que alguien calcula **hoy, 1 de junio,** para todas las publicaciones, también para una del 1 de marzo. Esos 90 días van de marzo a junio: ventas que el 1 de marzo todavía no habían pasado. El modelo aprende con un dato que en producción nunca va a tener.

Lo mismo pasa al repartir: si el modelo va a predecir el futuro, el examen tiene que venir del futuro. Es un [[split-temporal|split temporal]]: si entrenas con datos hasta el 5 de enero, evalúas desde el 6. Al azar, el modelo «ya conoce» las modas de diciembre cuando lo examinas con noviembre.

:::figura ejemplos-partir
Las mismas 12 fotos, de tres vendedores, repartidas de tres formas. Solo la del medio respeta el tiempo y solo la de abajo deja a cada vendedor entero de un lado. Se pueden combinar: por vendedor y, además, por fecha.
:::

:::nota Una más, discreta
A veces la información del test se cuela por una cuenta: el promedio y la desviación para [[escalamiento|escalar]], o la mediana para rellenar huecos, se calculan con todo el dataset antes de repartir, y así el train ya «sabe» algo del test. Esas cuentas se hacen solo con train.
:::

:::ojo
**Desconfía de un número demasiado bueno.** Si tu modelo saca 99 % en validación en una tarea que nadie resuelve tan bien, lo primero no es celebrar: es buscar copias entre las partes, features que no existen al predecir y datos del futuro.
:::

## Repartir en código: por tiempo, por grupo y sin copias {Splitting in code: by time, by group and without copies} [extra]

La regla de la sección anterior cabe en una frase: **parte por lo que va a ser nuevo en producción**, sea el futuro o un vendedor, y antes de todo quita las copias. Aquí va con números y en Python que puedes correr tal cual.

### El split estratificado

Primero, las máquinas de escribir de «Tres montones». Este programa reparte 1,000 fotos (980 de tenis y 20 de máquinas de escribir) en 80 / 10 / 10. Revuelve con una [[semilla]] fija, el número con el que arranca el generador de números al azar, para que el sorteo salga igual cada vez.

```python
import random

# 1,000 fotos: 980 de tenis y 20 de máquinas de escribir
fotos = [("tenis", i) for i in range(980)] + [("maquina", i) for i in range(20)]

def al_azar(datos, semilla):
    d = list(datos)                     # una copia: el original no se toca
    random.Random(semilla).shuffle(d)   # revolver; con la misma semilla, el mismo orden
    n = len(d)
    return d[:int(n * 0.8)], d[int(n * 0.8):int(n * 0.9)], d[int(n * 0.9):]

def maquinas(parte):
    return sum(clase == "maquina" for clase, _ in parte)

train, val, test = al_azar(fotos, semilla=17)
print(len(train), len(val), len(test))
print("máquinas en train, val y test:", maquinas(train), maquinas(val), maquinas(test))

# el mismo reparto con 1,000 semillas distintas
vacios = sum(maquinas(al_azar(fotos, s)[1]) == 0 for s in range(1000))
print("repartos con validación sin máquinas:", vacios, "de 1000")
```

```salida
800 100 100
máquinas en train, val y test: 17 0 3
repartos con validación sin máquinas: 124 de 1000
```

Con la semilla 17 salió justo el caso malo: ninguna máquina en validación. De 1,000 sorteos, 124 (12.4 %) quedan igual, cerca del 12 % de la cuenta. No sale idéntico porque 1,000 sorteos también tienen suerte: con otras 1,000 semillas saldría otro número, casi siempre entre 10 % y 14 %. (Que aquí vayan exactamente 100 fotos a validación, en vez de sortear cada foto, lo baja un poquito: la cuenta exacta da 11.9 %.) Ahora, estratificado:

```python
import random

fotos = [("tenis", i) for i in range(980)] + [("maquina", i) for i in range(20)]

def al_azar(datos, semilla):
    d = list(datos)
    random.Random(semilla).shuffle(d)
    n = len(d)
    return d[:int(n * 0.8)], d[int(n * 0.8):int(n * 0.9)], d[int(n * 0.9):]

def estratificado(datos, semilla):
    por_clase = {}
    for foto in datos:                          # juntar las fotos de cada clase
        por_clase.setdefault(foto[0], []).append(foto)
    train, val, test = [], [], []
    for clase in sorted(por_clase):             # y repartir cada clase por separado
        tr, va, te = al_azar(por_clase[clase], semilla)
        train += tr; val += va; test += te
    return train, val, test

for s in (17, 18, 19):
    train, val, test = estratificado(fotos, semilla=s)
    print(s, [sum(c == "maquina" for c, _ in parte) for parte in (train, val, test)])
print(len(train), len(val), len(test))
```

```salida
17 [16, 2, 2]
18 [16, 2, 2]
19 [16, 2, 2]
800 100 100
```

Con cualquier semilla: 16, 2 y 2. El sorteo decide **cuáles** máquinas van a cada lado, pero ya no **cuántas**.

### Por tiempo: ventas de supermercado y etiquetas que tardan

Toma un sistema que pronostica ventas de supermercado. Cada noche calcula las ventas de los próximos 14 días para ≈ 4.8 millones de combinaciones tienda × producto (≈ 400 tiendas con ≈ 12,000 productos cada una). Con un split al azar, el martes podría quedar en evaluación y el lunes y el miércoles en entrenamiento: el modelo **interpola** (adivina el martes con los días de al lado) en vez de **pronosticar**, y su número sale mejor que en la vida real, donde el miércoles todavía no existe.

El split correcto es temporal: entrenar con lo que se sabía hasta una fecha de corte y evaluar los 14 días siguientes. Como una semana puede ser rara (una quincena, un feriado), el sistema lo repite con 8 cortes semanales y promedia. Eso es un **backtest**: examinar al modelo como si hubiera vivido cada una de esas semanas.

En fraude aparece una vuelta más: la etiqueta llega tarde. La cuenta de cuántos fraudes todavía no tienen su etiqueta es esta:

:::formula Fraudes que todavía no tienen etiqueta
F = N × p
F_{llegó} = F × r
F_{falta} = F × (1 − r)
p_{vista} = p × r
- N: los pagos de un día
- p: la tasa de fraude de verdad, como fracción: 0.0008 para 0.08 %
- F: los fraudes de ese día
- r: la fracción de los contracargos que ya llegó, a la edad que tienen esos pagos: 0.6 a los 30 días
- F_{llegó}, F_{falta}: los fraudes de ese día que ya tienen su contracargo, y los que todavía parecen pagos buenos
- p_{vista}: la tasa de fraude que ves en los datos
:::

:::ejemplo Los fraudes que todavía parecen pagos buenos
Un sistema de fraude procesa ≈ 10 millones de pagos al día y ≈ 0.08 % son fraude: \(F = N × p\) = 10,000,000 × 0.0008 = 8,000 al día. La etiqueta llega cuando el banco abre un contracargo, y eso tarda. Con supuestos típicos, a los 30 días ha llegado ≈ 60 % de los contracargos y a los 60 días, ≈ 90 %.

- Fraudes de hace 30 días que ya tienen su contracargo: \(F_{llegó} = F × r\) = 8,000 × 0.6 = **4,800**.
- Fraudes que todavía parecen pagos buenos: \(F_{falta} = F × (1 − r)\) = 8,000 × 0.4 = **3,200** por cada día de pagos.
- La tasa de fraude que verías: \(p_{vista} = p × r\) = 0.08 % × 0.6 = **0.048 %**: parece que hay 40 % menos fraude del que hay.

Si entrenas con el mes pasado, le enseñas al modelo que miles de fraudes son pagos normales. Por eso un sistema así entrena solo con **cohortes maduras**: grupos de pagos (los de una misma semana) que ya tienen 60 a 90 días o más, cuando ya llegaron casi todos sus contracargos. Las filas que no han madurado se quitan, no se marcan como «no fraude».
:::

### Por grupo: cada vendedor, entero de un lado

:::ejemplo Un vendedor con 400 fotos sobre la misma mesa
Un vendedor de artículos de cocina fotografía sus 400 productos sobre la misma mesa, con la misma luz. Con un reparto al azar de 95 % a train y 5 % a validación, usa las letras de «Al azar o estratificado», con \(m\) = 400 fotos y \(f\) = 0.05:

- Fotos suyas que esperas en validación: \(E = m × f\) = 400 × 0.05 = **20**.
- Probabilidad de que las 400 caigan en train: \(P_0 = (1 − f)^m\) = 0.95⁴⁰⁰ ≈ 0.000000001. En la práctica, nunca.

Cada una de esas 20 tiene ≈ 380 hermanas en train con la misma mesa. El modelo puede acertarles por la mesa, sin mirar el producto, y validación lo premia. Con un vendedor nuevo, en producción, la mesa no ayuda.
:::

Alba lo resuelve con un hash del id del vendedor: un número que sale del texto «vend-00024» con una fórmula fija, siempre el mismo. Si su residuo al dividir entre 100 (el *módulo* 100) es menor que 95, el vendedor entero va a train; si no, a validación. Su equipo lo escribe así en la tarjeta del dataset de septiembre: «por seller_id (hash mod 100 < 95 → train)».

```python
import hashlib

def lado(vendedor):
    # la huella del id: el mismo texto da siempre el mismo número
    h = int(hashlib.sha256(vendedor.encode()).hexdigest(), 16)
    return "train" if h % 100 < 95 else "val"

for v in ["vend-00021", "vend-00022", "vend-00023", "vend-00024", "vend-00025"]:
    print(v, lado(v))

vendedores = [f"vend-{i:05d}" for i in range(10_000)]
en_val = sum(lado(v) == "val" for v in vendedores)
print("vendedores en validación:", en_val, "de", len(vendedores))
```

```salida
vend-00021 train
vend-00022 train
vend-00023 train
vend-00024 val
vend-00025 train
vendedores en validación: 487 de 10000
```

Dos cosas salen gratis: el mismo vendedor cae siempre del mismo lado, mes tras mes, sin guardar ninguna lista; y como la fórmula reparte parejo, ≈ 5 % va a validación (487 de 10,000).

:::ojo
No uses la función `hash()` de Python para esto: con textos, Python cambia su fórmula cada vez que arranca el programa (a propósito, como protección contra cierto ataque), y el mismo vendedor caería de un lado hoy y del otro mañana. `hashlib` da lo mismo en cualquier computadora.
:::

Otros sistemas hacen lo mismo. Uno que marca tumores en imágenes de patología reparte por paciente: una lámina produce ≈ 3,000 pedacitos de imagen casi idénticos entre vecinos, y un paciente puede tener varias. Uno que vigila video de varias cámaras reparte por cámara y por fecha.

### Casi duplicados y huellas perceptuales

Un hash como sha256 sirve para copias exactas, pero cambia por completo si cambia un solo byte: una foto vuelta a comprimir ya tiene otra huella. Para los [[duplicado-cercano|casi duplicados]] se usa una huella **perceptual**, que se calcula sobre la imagen «vista de lejos». La más sencilla, el *average hash*, hace esto:

:::pasos
1. Achicar
Llevar la foto a una cuadrícula diminuta en gris: 8 × 8 = 64 píxeles en la vida real; aquí, 4 × 4 = 16 para seguirlo a mano.
2. Comparar con el promedio
Cada píxel arriba del promedio de la cuadrícula es un 1; abajo, un 0: el bit \(b_i\) del píxel \(i\) vale 1 si su gris \(g_i\) es mayor que el promedio de los 16 grises. Esos bits son la huella.
3. Contar diferencias
Dos fotos son casi duplicadas si sus huellas difieren en pocos bits. Contar los bits distintos se llama distancia de Hamming.
:::

```python
import hashlib

def huella(gris):            # gris: los 16 píxeles de la foto achicada a 4 × 4
    prom = sum(gris) / len(gris)
    return "".join("1" if g > prom else "0" for g in gris)

def distintos(h1, h2):       # cuántos bits no coinciden
    return sum(a != b for a, b in zip(h1, h2))

tenis     = [200, 190, 60, 50, 210, 180, 70, 40, 90, 112, 30, 20, 220, 230, 80, 60]
recompri  = [198, 193, 62, 49, 207, 183, 68, 44, 94, 117, 33, 21, 219, 227, 83, 58]
mas_clara = [g + 25 for g in tenis]
otra_foto = [40, 60, 200, 210, 50, 70, 220, 190, 30, 90, 180, 200, 20, 40, 60, 230]

print("huella de los tenis:", huella(tenis))
for nombre, foto in [("recomprimida", recompri), ("más clara", mas_clara), ("otra foto", otra_foto)]:
    print(f"{nombre:12} bits distintos: {distintos(huella(tenis), huella(foto))} de 16")

print("sha256 de los tenis:  ", hashlib.sha256(bytes(tenis)).hexdigest()[:16])
print("sha256 recomprimida:  ", hashlib.sha256(bytes(recompri)).hexdigest()[:16])
```

```salida
huella de los tenis: 1100110000001100
recomprimida bits distintos: 1 de 16
más clara    bits distintos: 0 de 16
otra foto    bits distintos: 13 de 16
sha256 de los tenis:   53b7a26d1293f19c
sha256 recomprimida:   29515c5130af0803
```

La recomprimida cambia 1 bit de 16; la más clara, ninguno, porque el promedio sube lo mismo que cada píxel; la otra foto, 13. Sus sha256, en cambio, no se parecen en nada. pHash (*perceptual hash*), una huella muy usada, es una versión más robusta de la misma idea. Otra forma es comparar los [[embedding|embeddings]] de dos fotos, listas de números que resumen lo que muestran, con la [[similitud-coseno]], que da cerca de 1 cuando las dos listas apuntan casi en la misma dirección.

¿Importa? Barz y Denzler (2020) revisaron CIFAR-10 y CIFAR-100, dos datasets clásicos de fotos chicas: el 3.3 % y el 10 % de sus imágenes de test tenían un casi duplicado en train. Si pasa en los datasets con que todo el mundo compara modelos, en los tuyos también.

## Etiquetas: de dónde salen y cuánto cuestan {Labels: where they come from and what they cost}

La etiqueta es el dato más caro por unidad y el techo de todo lo demás: un modelo difícilmente va a ser más consistente que sus etiquetas, y con etiquetas malas ni siquiera lo puedes medir. Si dos personas no se ponen de acuerdo en si una foto es «Tenis» o «Calzado deportivo», el modelo tampoco va a poder.

### No todas valen lo mismo

En Alba salen de tres lugares. Los porcentajes son los del dataset de septiembre:

| Fuente | Qué parte del dataset | Qué tan buena |
|---|---|---|
| La categoría que eligió quien vende | 72 %, ya filtrada | Abundante pero ruidosa. Y está contaminada: la gente suele aceptar lo que el modelo le sugirió, así que el modelo terminaría aprendiendo a imitarse a sí mismo |
| Correcciones de moderadores | 7 % | Muy buena, pero solo de las publicaciones que alguien revisó |
| Personas que etiquetan a mano | 21 % | La mejor y la más cara; hoy se suman unas 5 mil fotos al mes, elegidas a propósito |

En otros sistemas la etiqueta la escribe lo que pasó después: el contracargo en el de fraude, el clic en el de anuncios, lo vendido en el pronóstico de ventas. Cada fuente trae su sesgo, y conviene poder decirlo en una frase: la de quien vende está influida por la sugerencia; la de moderación solo existe para lo revisado; el contracargo tarda semanas.

### Etiquetar es un proceso

[[etiquetado|Etiquetar]] no es solo poner respuestas. Tiene cuatro piezas:

- **Quién.** Un proveedor (escala rápido, pero sabe poco de tu tema), un equipo propio, expertos para los casos difíciles, o la gente dentro de su trabajo, como los moderadores de Alba.
- **Una guía escrita.** Qué es cada clase, con ejemplos y contraejemplos; los casos límite decididos por escrito («¿un celular con funda va en celulares o en fundas?»); una salida para «no sé», para no obligar a inventar; y una versión, para saber con qué reglas se hizo cada etiqueta.
- **Control de calidad.** Una parte la etiquetan dos personas sin saberlo (en Alba, el 10 %), se mide cuánto coinciden y un experto decide los desacuerdos. Lo que se resuelve entra a la guía. Ojo: el porcentaje de coincidencia engaña cuando casi todo es de una clase, porque coincidir en lo fácil no cuesta nada. Por eso se mide con [[kappa]], que descuenta lo que coincidirían por puro azar; la cuenta está en «Acuerdo y ruido».
- **Un costo**, que se calcula antes de empezar.

El costo sale de cuatro cuentas:

:::formula Lo que cuesta etiquetar
A = n × (1 + d)
D = A × c
H = frac{A × s}{3,600}
T = frac{H}{160}
- n: las fotos a etiquetar
- d: la fracción de fotos con doble anotación: 0.1 para 10 %
- A: las anotaciones; una foto con doble anotación cuenta dos veces
- c: el precio por anotación, en dólares
- D: el costo, en dólares
- s: los segundos que tarda una anotación
- H: las horas de trabajo; una hora son 3,600 s
- T: las personas de tiempo completo durante un mes, si cada una etiqueta ≈ 160 horas al mes
:::

:::cuenta Lo que cuesta etiquetar en Alba
Fotos al mes, \(n\) // elegidas a propósito; dato de Alba | la cola del mes | ≈ 5,000
Doble anotación, \(d\) // dato de Alba | 10 % | 0.1
Anotaciones, \(A\) | \(A = n × (1 + d)\) = 5,000 × 1.1 | 5,500
Tiempo, \(H\) // \(s\) = 20–30 s por foto, con 500 categorías | \(H = A × s ÷ 3,600\) = 5,500 × 20–30 ÷ 3,600 | ≈ 31–46 h al mes
Personas, \(T\) | \(T = H ÷ 160\) = 31–46 ÷ 160 | ≈ 0.2–0.3
Costo de las 5,000 fotos // \(c\) = US$0.05–0.10 por anotación | \(n × c\) = 5,000 × US$0.05–0.10 | ≈ US$250–500
Costo al mes, \(D\) // más US$25–50 por las 500 anotaciones dobles | \(D = A × c\) = 5,500 × US$0.05–0.10 | ≈ US$275–550
Golden set: anotaciones, \(A\) // 50,000 fotos, todas dobles: \(d\) = 1 | 50,000 × (1 + 1) | 100,000
Su costo, \(D\) | 100,000 × US$0.05–0.10 | ≈ US$5–10 mil
Su tiempo, \(H\) | 100,000 × 20–30 ÷ 3,600 | ≈ 560–830 h
Personas-mes, \(T\) // una sola vez | \(T\) = 560–830 ÷ 160 | ≈ 3.5–5
= La cola del mes es menos de media persona. El golden set son ≈ 3.5–5 personas-mes, una sola vez: por eso se congela y se cuida. Los precios por etiqueta cambian mucho por tarea y proveedor.
:::

:::calculadora ejemplos-etiquetar
Prueba también una cola chica, de 800 fotos al mes, con 20 % de doble anotación: con 10 % serían solo 80 fotos dobles, muy pocas para medir el acuerdo de cada clase.
:::

### Etiquetar lo que más enseña

Con 5,000 etiquetas al mes y millones de fotos, la pregunta es **cuáles**. Al azar, casi todas serían fotos que el modelo ya acierta sin dudar: dinero que no enseña nada. El [[active-learning|active learning]] elige las que más enseñan:

- **Las dudosas.** En Alba, las fotos cuyo primer lugar tiene [[confianza]] menor que 0.3, o en las que el primero y el segundo casi empatan.
- **Los desacuerdos.** Quien vende eligió una categoría fuera de las 5 sugeridas, o moderación corrigió.
- **Lo nuevo.** Una categoría que el negocio acaba de agregar se llena a mano hasta tener ≈ 200–500 fotos.
- **Una parte al azar**, el 20–30 % del presupuesto. Parece desperdicio y es lo más importante: es lo único que dice cuánto se equivoca el modelo con el tráfico de verdad.

:::diagrama ejemplos-etiquetado
De la foto de Ana al examen del modelo siguiente; los números siguen el primer recorrido. Toca cada caja.
:::

### Etiquetas con ruido

Aun así, algunas etiquetas quedan mal. Es el [[ruido-etiquetas|ruido en las etiquetas]], y hace dos daños. En train, le enseña cosas falsas al modelo. En evaluación, el modelo «falla» donde la etiqueta estaba mal, y el número mide en parte el ruido. Cuánto hay, en la sección siguiente.

## Acuerdo y ruido, con números {Agreement and label noise, with numbers} [extra]

### 97 % de acuerdo que vale poco

Medir la calidad con el porcentaje de veces que dos personas coinciden engaña cuando una clase domina, porque coincidir en lo fácil no cuesta nada. Un ejemplo de inspección visual en una fábrica lo muestra: dos inspectores revisan las mismas 1,000 piezas, casi todas buenas. La corrección que hace falta tiene su fórmula:

:::formula Kappa de Cohen
p_o = frac{a + b}{N}
p_e = p_A × p_B
+ (1 − p_A) × (1 − p_B)
κ = frac{p_o − p_e}{1 − p_e}
- N: los casos que revisaron las dos personas
- a, b: los casos en que las dos dicen «sí» (aquí, «defecto»), y en los que las dos dicen «no»
- p_A, p_B: la fracción de casos en que la persona A, o la B, dice «sí»
- p_o: el acuerdo observado: la fracción de casos en que coinciden
- p_e: el acuerdo esperado por puro azar, si cada persona dijera «sí» al azar con su propia fracción
- κ: la kappa (letra griega): 1 es acuerdo perfecto y 0, lo mismo que el azar
:::

:::cuenta 97 % de acuerdo que vale poco
Los dos dicen «defecto», \(a\) / los dos dicen «buena», \(b\) | conteo | 10 / 960
Desacuerdos // A dice defecto y B no, y al revés | conteo | 15 / 15
Acuerdo observado, \(p_o\) | \(p_o = (a + b)/N\) = (10 + 960) ÷ 1,000 | 0.97
Fracción de «defecto» de cada inspector, \(p_A\) y \(p_B\) // sus 10 coincidencias más sus 15 desacuerdos | (10 + 15) ÷ 1,000 | 2.5 % cada uno
Acuerdo esperado por puro azar, \(p_e\) // \(p_e = p_A × p_B + (1 − p_A) × (1 − p_B)\) | 0.025 × 0.025 + 0.975 × 0.975 | 0.95125
Kappa, \(κ\) | \(κ = (p_o − p_e)/(1 − p_e)\) = (0.97 − 0.95125) ÷ (1 − 0.95125) | ≈ 0.38
= De las 40 piezas que alguno marcó como defecto, coinciden en 10. El 97 % venía casi todo de las piezas buenas.
:::

Esa corrección es la [[kappa]] de Cohen, la \(κ\) de la fórmula de arriba. En su fracción, arriba va lo que coincidieron por encima del azar; abajo, lo más que podían coincidir por encima del azar. 1 es acuerdo perfecto y 0, lo mismo que el azar. Una escala muy citada (Landis y Koch, 1977), que es una convención y no una ley, llama «moderado» a 0.41–0.60, «sustancial» a 0.61–0.80 y «casi perfecto» a más de 0.80. Si al aclarar la guía el acuerdo sube a 99 %, con los mismos 2.5 % de defectos por inspector (así el azar sigue dando \(p_e\) = 0.95125), kappa sube a (0.99 − 0.95125) ÷ (1 − 0.95125) ≈ 0.79: dos puntos más de acuerdo duplican kappa.

### Cuánto ruido hay

Northcutt, Athalye y Mueller (2021) revisaron los test sets de 10 datasets muy usados y estimaron, en promedio, al menos 3.3 % de etiquetas erróneas, y ≈ 6 % en la validación de ImageNet. Si los datasets famosos tienen eso, el tuyo también. Dos consecuencias:

- **Un techo en lo que puedes medir.** Si 6 de cada 100 etiquetas del examen están mal y el modelo da la respuesta verdadera, el examen se las cuenta como errores: un modelo perfecto mediría ≈ 94 %. No es exacto, porque un modelo real a veces coincide con la etiqueta mala, pero da la idea.
- **Comparaciones que se mueven solas.** El examen automático que decide si un modelo nuevo sale (el *gate*) puede cambiar de opinión por etiquetas mal puestas, no por el modelo.

Qué se hace: marcar como sospechosas las fotos donde el modelo contradice la etiqueta con mucha seguridad (técnicas como *confident learning*, de la librería cleanlab) y mandarlas a **revisión humana**. No se borran solas: un «error» seguro del modelo puede ser justo el caso difícil que necesitas.

### Active learning, con cuidado

Dos trampas, y Alba tiene que cuidarse de las dos:

- **Evaluar con lo que eligió.** Un conjunto armado con las fotos más dudosas es, a propósito, más difícil que el tráfico real: el porcentaje de aciertos medido ahí sale más bajo de lo que vive la gente. Se entrena con todo lo etiquetado, pero se evalúa con el golden set y con la parte al azar.
- **El modelo que se imita a sí mismo.** Si quien vende acepta casi siempre la primera sugerencia, entrenar con su elección enseña al modelo a repetir sus propios errores, y la métrica medida con esas etiquetas sube aunque nada mejore. Alba guarda un grupo aparte: ≈ 1 % de los vendedores no ve sugerencias y elige a mano. Sus etiquetas son las únicas que el modelo no influyó.

## Clases desbalanceadas y la cola larga {Class imbalance and the long tail} [extra]

Casi nunca hay el mismo número de ejemplos de cada categoría. A eso se le llama [[desbalance|desbalance de clases]], y engaña de una forma muy concreta.

:::ejemplo El modelo flojo que acierta 95 %
Un dataset con 1,000 fotos: 950 de tenis y 50 de botas. Un «modelo» que siempre responde «tenis», sin mirar la foto:

- Aciertos: las 950 de tenis. 950 ÷ 1,000 = 95 %.
- Botas que reconoce: 0 de 50. O sea, 0 %.

Un 95 % que no sirve para nada si tú vendes botas. En el ejemplo de fraude y en el de anuncios es todavía más extremo. Ahí el «sí» es rarísimo: 0.08 % de los pagos y 0.35 % de los anuncios, como en la tabla del inicio. Un modelo que siempre dice «no» acierta 100 % − 0.08 % = 99.92 % de los pagos y 100 % − 0.35 % = 99.65 % de los anuncios mostrados, y no atrapa ni un fraude ni predice un solo clic.
:::

Por eso, con clases desbalanceadas, el porcentaje de aciertos total ([[accuracy]]) no basta. Hay que medir cada clase por separado: de las botas que había, ¿cuántas reconoció? Eso se llama [[recall]], y lo ves a fondo en la lección «¿Aprendió de verdad?».

### La cola larga de Alba

Con 500 categorías el desbalance tiene una forma típica: la [[long-tail|cola larga]]. Unas cuantas categorías tienen decenas de miles de fotos, muchas tienen unos cientos o miles, y algunas apenas decenas. Si las ordenas de la más grande a la más chica, la gráfica cae rápido y luego sigue, baja y larga: esa es la «cola».

:::figura ejemplos-cola
Los números son ilustrativos, pero la forma es la de Alba: las barras de la cola casi no se ven.
:::

Una cuenta para dimensionarlo. Alba tiene ≈ 1.84 millones de fotos de entrenamiento (1,840,211 en el dataset de septiembre) y 500 categorías:

- Si se repartieran parejo: 1,840,000 ÷ 500 = 3,680 fotos por categoría.
- Pero casi ninguna está cerca de ese promedio. En la figura, la primera tiene 62,000 (17 veces el promedio) y la última, 40 (92 veces menos).

El equipo de Alba lo dice así: con 500 categorías, el promedio lo dominan unas 50 categorías grandes, y la cola puede estar rota sin que se note. Por eso Alba mide aparte la **cabeza** (*head*, las 100 categorías con más tráfico) y la cola.

### Qué se hace con el desbalance

- **Medir por clase.** Lo primero, porque sin eso ni sabes que hay un problema. Un promedio que le da el mismo peso a cada categoría, sin importar su tamaño, es el [[macro-promedio]].
- **Estratificar el split**, para que cada categoría chica llegue a validación y a test.
- **Etiquetar más donde hay poco.** Cuando el negocio agrega una categoría, Alba la llena a mano hasta tener unas 200 a 500 fotos.
- **Mostrar más seguido las fotos raras** (*oversampling*). Cuidado: 40 fotos repetidas muchas veces se aprenden de memoria ([[overfitting]]).
- **Que equivocarse en una clase rara cueste más.** Se hace en la [[loss|pérdida]], el número que mide el error al entrenar y que ves en la siguiente lección.

### Data augmentation: variaciones que no cambian la respuesta

Unos tenis volteados como espejo, un poco más oscuros o recortados un poco más a la izquierda siguen siendo tenis. La [[augmentation|data augmentation]] aprovecha eso: al entrenar, a cada foto se le aplican cambios al azar que **no cambian su etiqueta** (voltearla, recortar un pedazo distinto con un [[crop]] al azar, cambiar el brillo, girarla unos grados), y así el modelo aprende que esos cambios no importan. Como el cambio es al azar en cada pasada, casi nunca ve dos veces la misma imagen: en Alba cada foto de train pasa 8 veces por el modelo al entrenar, y cada vez llega un poquito distinta.

:::ojo
Tres reglas, y cada una evita un error real:

- **Solo si la etiqueta sigue siendo verdad.** Unos tenis en espejo son tenis; una letra en espejo ya no es la misma letra, y un 6 de cabeza es un 9.
- **Solo en train.** Validación y test van sin cambios, con el mismo [[preprocesamiento]] que tendrá producción. Si no, mides con fotos que no se parecen a las de Ana.
- **Imita lo que de verdad llega.** Los celulares toman fotos oscuras y chuecas: variar el brillo y girar un poco ayuda; voltear de cabeza lo que nadie sube de cabeza, no.
:::

Y su límite: la augmentation no inventa información. Si de una categoría tienes 40 fotos de las mismas 3 monedas, todas sus variaciones siguen siendo 3 monedas. Para la cola larga ayuda, pero no reemplaza etiquetar más.

### Slices: el promedio esconde cosas

Un [[slice]] es un pedazo de los datos de evaluación que comparte algo y se mide por separado: fotos de celular contra fotos de web, fotos con poca luz, imágenes muy chicas. Es medir por clase, aplicado a cualquier grupo.

:::ejemplo Un modelo nuevo que «mejora»
Con números ilustrativos: el 95 % de las fotos del golden set tienen buena luz y el 5 %, poca luz. El total es el promedio pesado \(w_1 × a_1 + w_2 × a_2\): cada \(w\) es la fracción de fotos de un slice y cada \(a\), el porcentaje de aciertos en él.

- Modelo actual: 85.4 % con buena luz y 77.4 % con poca. En total: 0.95 × 85.4 + 0.05 × 77.4 = 81.13 + 3.87 = **85.0 %**.
- Modelo nuevo: 86.0 % con buena luz y 70.0 % con poca. En total: 0.95 × 86.0 + 0.05 × 70.0 = 81.7 + 3.5 = **85.2 %**.

El total subió 0.2 puntos y parece una mejora. Pero con poca luz bajó 7.4 puntos, y esas fotos pueden venir sobre todo de celulares baratos: sería un grupo de personas al que el modelo nuevo le va bastante peor. Solo el slice lo muestra.
:::

## Errores comunes {Common mistakes}

Las trampas que más se repiten al armar un dataset, y cómo evitar cada una.

1. **Repartir al azar lo que viene en familias.** Fotos repetidas, el mismo vendedor, días seguidos: el examen sale alto y se cae en producción. **Cómo evitarla:** pregunta qué va a ser nuevo en producción (el futuro, un vendedor, un paciente) y parte por eso; quita copias y casi copias antes de repartir.
2. **Sacar cuentas con todo el dataset antes de repartir.** El promedio para escalar, la mediana para rellenar, la lista de categorías para el one-hot. **Cómo evitarla:** calcula todo solo con train, guárdalo junto al modelo y úsalo igual en validación, en test y en producción.
3. **Numerar categorías que no tienen orden.** 1, 2 y 3 para giros o colores inventan un orden y una distancia. **Cómo evitarla:** one-hot con una columna «otro»; con millones de valores, hashing o embeddings.
4. **Rellenar huecos con 0.** «Cero compras» y «no sé cuántas» se vuelven lo mismo. **Cómo evitarla:** NaN para un modelo que lo entienda, o la mediana de train más una columna que marque el relleno.
5. **Decidir con el test.** Mirarlo, cambiar algo y volverlo a mirar lo convierte en validación. **Cómo evitarla:** decide con validación; el test, o el golden set, se usa al final para el número que reportas.
6. **Evaluar con etiquetas sesgadas.** La elección de quien vende, influida por el modelo, o lo que eligió el active learning, más difícil que lo normal. **Cómo evitarla:** evalúa con el golden set y con una muestra al azar; con el resto, entrena.
7. **Repartir por grupo con `hash()` de Python.** Cambia cada vez que arranca el programa, y los vendedores saltan de lado. **Cómo evitarla:** `hashlib` (por ejemplo sha256), que da lo mismo siempre.

## En la vida real {In real life} [extra]

Las mismas ideas, en seis lugares distintos. Fíjate en que la columna «cómo se reparte» nunca dice «al azar».

| Dónde | El ejemplo y su etiqueta | Cómo se reparte | La trampa típica |
|---|---|---|---|
| Alba · categoría de una foto | Una foto; su categoría, de quien vende, de moderación o de una persona | Por vendedor y sin copias; el examen es el golden set | Entrenar y examinar con la elección de quien vende, que el modelo influyó |
| Fraude en pagos | Un pago; fraude o no, por un contracargo semanas después | Por tiempo, solo con cohortes maduras | Una feature calculada hoy que ya cuenta el contracargo |
| Ventas de supermercado | Tienda × producto × día; lo que se vendió | Por tiempo, con 8 fechas de corte | Tomar un día agotado como demanda de cero |
| Clics en anuncios | Un anuncio mostrado; clic o no en 30 minutos | Entrenar con días pasados y examinar con el día siguiente | Medir accuracy con 1 clic de cada ≈ 286 anuncios |
| Imágenes de patología | Un pedacito de una lámina; la región que marcó un especialista | Por paciente | Pedacitos vecinos de la misma lámina, a los dos lados |
| Fuera de ML · un examen de admisión | Una pregunta; su respuesta correcta | Preguntas nuevas, no las del banco con que se estudió | Practicar con el examen real: el puntaje mide memoria, no lo que sabes |

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Para los de números, las calculadoras de arriba sirven para comprobar.

:::ejercicios
? [facil] Tienes 120,000 fotos y las repartes 85 / 10 / 5. ¿Cuántas van a cada parte? Si estratificas, ¿cuántas fotos de una categoría con 300 van a test?
Cada parte recibe el total por su fracción, \(N × f\).

- Train: 120,000 × 0.85 = **102,000**.
- Validación: 120,000 × 0.10 = **12,000**.
- Test: 120,000 × 0.05 = **6,000**. Suman 120,000.

Estratificado, la categoría se reparte igual, con \(m × f\): 300 × 0.05 = **15** a test (30 a validación y 255 a train).
? [facil] Codifica con one-hot el dispositivo de cuatro anuncios del ejemplo de clics: android, web, iphone y android. ¿Cuántas columnas usas? Después llega uno visto en una tablet, que nunca apareció en train: ¿qué le das?
Tres valores (android, iphone y web) más una columna «otro»: cuatro.

- android = [1, 0, 0, 0] · web = [0, 0, 1, 0] · iphone = [0, 1, 0, 0] · android = [1, 0, 0, 0]

La tablet va a «otro»: [0, 0, 0, 1]. Sin esa columna quedaría en puros ceros, una combinación que el modelo nunca vio.
? [facil] En train, el monto tiene promedio 35 y desviación estándar 10. Estandariza 25, 35 y 62. En producción llega un pago de 35: ¿cuál es su z?
Con \(z = (x − μ)/σ\), \(μ\) = 35 y \(σ\) = 10:

- (25 − 35) ÷ 10 = **−1.0** · (35 − 35) ÷ 10 = **0** · (62 − 35) ÷ 10 = **2.7**

El de producción también da **0**: se usan el promedio y la desviación de train, guardados con el modelo.
? [facil] Un día del ejemplo de anuncios trae 200,000 anuncios mostrados y 700 clics. ¿Qué accuracy saca un «modelo» que siempre dice «no clic»? ¿Cuántos clics atrapa?
- Aciertos: los 200,000 − 700 = 199,300 sin clic. Accuracy = aciertos ÷ total = 199,300 ÷ 200,000 = **99.65 %**.
- Clics que atrapa: **0 de 700**.

Un 99.65 % que no sirve para nada. Por eso, con una clase tan rara, se mide cada clase por separado: de los 700 clics, ¿cuántos vio venir? Eso es el [[recall]], y aquí vale 0.
? [medio] Una categoría tiene 30 fotos y repartes al azar 90 / 5 / 5. ¿Qué probabilidad hay de que validación se quede sin ninguna? ¿Lo arregla estratificar?
Con \(P_0 = (1 − f)^m\), \(m\) = 30 y \(f\) = 0.05: cada foto se queda fuera de validación con probabilidad 0.95; las 30 a la vez, 0.95³⁰ ≈ **0.21**: una de cada cinco veces.

Estratificar no alcanza: \(m × f\) = 30 × 0.05 = 1.5, así que validación tendría 1 o 2 fotos, que no miden nada. Hace falta juntar más (el golden set de Alba exige al menos ≈ 50 por categoría) o, con muy pocos datos, la [[validacion-cruzada|validación cruzada]] de «¿Aprendió de verdad?»: repartir varias veces, de modo que cada foto esté en validación una vez, y promediar.
? [medio] Un proveedor cobra US$0.08 por etiqueta y tarda 25 s por foto. Quieres 8,000 fotos al mes con 15 % de doble anotación. ¿Cuántas anotaciones, cuánto dinero y cuántas horas son?
Con las letras de «Lo que cuesta etiquetar»: \(n\) = 8,000, \(d\) = 0.15, \(c\) = US$0.08 y \(s\) = 25 s.

- Anotaciones: \(A = n × (1 + d)\) = 8,000 × 1.15 = **9,200**.
- Costo: \(D = A × c\) = 9,200 × US$0.08 = **US$736**.
- Tiempo: \(H = A × s ÷ 3,600\) = 9,200 × 25 s = 230,000 s; ÷ 3,600 ≈ **64 horas** al mes, menos de media persona de tiempo completo.
? [medio] Para un modelo de fraude te proponen: (a) el monto; (b) «cuenta bloqueada», que se marca cuando se confirma un fraude; (c) «contracargos de la tarjeta en 90 días», calculada hoy para todo el historial; (d) intentos de la tarjeta en el minuto anterior al pago; (e) el giro del comercio. ¿Cuáles son leakage?
La pregunta para cada una: ¿existía en el instante de decidir?

- **(a), (d) y (e)** sí. Ojo con (d): el minuto **anterior**, sin contar el pago que se decide.
- **(b)** es leakage: se llena después, justo al confirmar el fraude. Es la etiqueta disfrazada.
- **(c)** también, tal como está: cuenta contracargos que llegaron después del pago, incluido el suyo. Bien hecha, cuenta solo los que habían llegado antes.
? [reto] Dos personas etiquetan 200 fotos como «Tenis» o «No tenis». Coinciden en tenis en 150 y en no tenis en 20; A dice tenis y B no en 18; A dice no y B tenis en 12. Calcula el acuerdo y kappa, como en la cuenta de «Acuerdo y ruido».
Con la fórmula de kappa de «Acuerdo y ruido», donde «sí» es «tenis»: \(a\) = 150, \(b\) = 20 y \(N\) = 200.

- Acuerdo observado: \(p_o = (a + b)/N\) = (150 + 20) ÷ 200 = **0.85**.
- A dice tenis en \(p_A\) = (150 + 18) ÷ 200 = 0.84; B, en \(p_B\) = (150 + 12) ÷ 200 = 0.81.
- Por azar: \(p_e = p_A × p_B + (1 − p_A) × (1 − p_B)\) = 0.84 × 0.81 + 0.16 × 0.19 = 0.6804 + 0.0304 = **0.7108**.
- \(κ = (p_o − p_e)/(1 − p_e)\) = (0.85 − 0.7108) ÷ (1 − 0.7108) = 0.1392 ÷ 0.2892 ≈ **0.48**: «moderado».

El 85 % sonaba bien, pero mucho venía de que casi todo es tenis. Toca revisar los 30 desacuerdos, escribir esos casos en la guía y volver a medir.
? [reto] Te piden entrenar el modelo de fraude en pagos «con los datos más frescos»: los pagos de los últimos 30 días, con su etiqueta de hoy. ¿Qué pasa con las etiquetas? ¿Qué propones?
Usa la cuenta de «Los fraudes que todavía parecen pagos buenos». A los 30 días solo ha llegado ≈ 60 % de los contracargos (\(r\) = 0.6, el supuesto del ejemplo), y en los pagos de ayer casi ninguno. Aun en el día más viejo, \(F_{falta} = F × (1 − r)\) = 8,000 × 0.4 = 3,200 de los ≈ 8,000 fraudes seguirían marcados como pagos buenos: ruido siempre hacia el mismo lado, que enseña que muchos fraudes son normales.

- Entrenar solo con **cohortes maduras**, de hace 60 a 90 días o más, y **quitar** las filas que no han madurado en vez de marcarlas como «no fraude».
- Partir **por tiempo**: entrenar antes de un corte y examinar después, también con etiquetas maduras.
- Vigilar con señales tempranas (reportes del banco, revisión manual) mientras maduran, sin usarlas como etiqueta final.
:::

## Lo que sigue {What comes next}

- **«Datos y etiquetas»** vuelve a todo esto dentro del sistema de Alba: de dónde sale cada etiqueta del mes, cómo se elige la cola que se manda a etiquetar, la doble anotación y la tarjeta del dataset de septiembre, con su reparto por hash del vendedor.
- **«Gate de evaluación y registry»** usa el golden set y los slices en el *gate* de evaluación, el examen automático que decide si un modelo nuevo puede salir a producción: solo pasa si no empeora en el golden set, ni en la cola larga, ni en ningún slice.
- **Las lecciones que siguen:** «Cómo aprende un modelo» (qué hace el entrenamiento con train), «¿Aprendió de verdad?» (overfitting, recall y macro-promedio, medidos en validación y test), «Ruido, muestras y pruebas A/B» (la varianza y la desviación estándar a fondo) y «Tiempo, hashes e identificadores» (cómo funciona un hash por dentro).

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
ejemplo feature codificacion one-hot valor-faltante escalamiento split train-set validation-set test-set estratificado golden-set leakage split-temporal split-por-grupo duplicado-cercano etiquetado active-learning ruido-etiquetas kappa desbalance long-tail augmentation slice
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Tu modelo saca 99 % en validación y 70 % con fotos reales de producción. ¿Qué revisas primero?
Leakage: copias o casi copias entre train y validación, features que traen la respuesta o vienen de después de predecir, y un reparto que no respeta el tiempo ni los grupos. Un número demasiado bueno es una alarma, no un logro.
? ¿Por qué no basta con dos partes, train y test?
Porque mientras desarrollas tomas decisiones (cuándo parar, qué ajustes, qué versión), y si las tomas mirando el test lo vas «gastando»: su número sale optimista. Validación es para decidir; el test, para el número final.
? ¿Por qué no codificar el giro del comercio como 1, 2 y 3?
Porque inventa un orden y una distancia: con un solo peso, el efecto del giro 3 sería por fuerza el triple que el del 1. Con one-hot cada giro tiene su columna y su peso.
? ¿Qué tiene de malo rellenar con 0 un valor que falta?
Que 0 casi siempre es un dato: «cero compras en 24 horas» es un cliente tranquilo, y «no sé cuántas» no dice nada. Se deja como NaN para un modelo que lo entienda, o se rellena con la mediana de train y se marca la fila.
? Un modelo acierta 95 % y alguien dice que es excelente. ¿Qué preguntas?
Cómo están repartidas las clases y cómo le va a cada una. Si el 95 % de las fotos son de una clase, decir siempre esa clase ya da 95 %. Hay que ver el recall por clase, o un promedio que pese igual a todas.
? Dos personas coinciden en 97 % de las etiquetas. ¿Es buena señal?
Depende de cuánto coincidirían por azar. Si una clase domina, coincidir en lo fácil no cuesta nada: en el ejemplo de los inspectores de «Acuerdo y ruido», 97 % de acuerdo era una kappa de ≈ 0.38.
? ¿Qué es el golden set de Alba y por qué nunca se usa para entrenar?
≈ 50 mil fotos con dos etiquetas humanas cada una, estratificadas por categoría y por origen, y congeladas: el mismo examen para modelos de meses distintos. Si se entrenara con él, el modelo se lo sabría y el examen dejaría de medir.
:::
