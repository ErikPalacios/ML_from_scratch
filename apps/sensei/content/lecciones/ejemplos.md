---
titulo: Datos, ejemplos, features y etiquetas
en: Data, examples, features and labels
subtitulo: Con qué aprende un modelo, cómo se reparte ese material para poder examinarlo y las trampas que hacen que el examen mienta.
pregunta: ¿Qué le das exactamente a un modelo para que aprenda, y cómo sabes que no se aprendió las respuestas de memoria?
minutos: 30
requisitos: modelo
---

:::idea
Un modelo aprende de ejemplos que ya traen su respuesta. Para saber si de verdad aprendió, hay que examinarlo con ejemplos que nunca vio, y cuidar que el examen no se filtre.
:::

## Un ejemplo: lo que entra y la respuesta {One example: input and answer}

Un [[ejemplo]] es un caso del que ya sabes la respuesta. Tiene dos partes: la **entrada**, que es lo que el modelo va a ver, y la [[etiqueta]], que es la respuesta correcta. En C01, un ejemplo es la foto de una publicación junto con su categoría: la foto de los tenis de Ana y «Calzado › Tenis».

A aprender de ejemplos que ya traen su respuesta se le llama **aprendizaje supervisado** (*supervised learning*): «supervisado» porque alguien revisó la respuesta de cada uno. Casi todo lo que vas a ver en la Ronda es de este tipo, empezando por C01, que es una [[clasificacion|clasificación]]: elegir una categoría entre 500.

### Features: la entrada, en datos sueltos

Cada dato de la entrada que el modelo usa para decidir es una [[feature]]. En español a veces se dice «característica» o «variable», pero en el trabajo casi todo el mundo dice *feature*. Qué es una feature depende mucho del tipo de dato.

**Datos en tabla.** Imagina un modelo que, en vez de la categoría, predice si una publicación se va a vender en su primera semana. Su entrada sería una fila de datos sueltos: precio 1,200 pesos, el vendedor lleva 14 ventas, su cuenta tiene 380 días, la publicación trae 3 fotos. Cada uno de esos números es una feature, y una persona eligió cuáles poner. A los datos que caben así, en columnas con nombre, se les llama **tabulares**.

**Imágenes.** En una foto no hay columnas con nombre. La entrada son los [[pixel|píxeles]]: una foto de 224 × 224 píxeles, con 3 números por píxel (cuánto rojo, cuánto verde y cuánto azul), son 224 × 224 × 3 = **150,528 números**. Ninguno significa nada por sí solo: el número 10,000 no es «tiene agujetas». Un modelo para imágenes recibe los píxeles crudos y aprende por dentro sus propias features útiles: primero bordes, luego formas y luego cosas como «suela». Lo verás en la lección de redes neuronales.

| | Datos en tabla | Imágenes |
|---|---|---|
| Qué es una feature | Una columna con nombre: precio, días de la cuenta | Un píxel; las features útiles las arma el modelo por dentro |
| Quién elige las features | Una persona (a eso se le llama *feature engineering*) | El modelo, mientras aprende |
| Cuántos números por ejemplo | Decenas o cientos | 150,528 en una foto de 224 × 224 |
| En la Ronda | Fraude (C09), clics en anuncios (C15) | C01, video (C02), inspección de piezas (C03) |

El modelo de C01 solo mira la foto. Pero la publicación trae más cosas: el precio, el título, la historia del vendedor. Son features posibles. Usarlas o no es una decisión de diseño: un precio de 30 pesos casi descarta «Refrigeradores», pero Ana sube la foto antes de terminar de escribir, así que en ese momento el precio todavía no existe y el modelo no puede contar con él.

:::ojo
Una feature solo sirve si existe **en el momento de predecir**. Guarda esa frase: es la mitad de la sección de *leakage*, más abajo.
:::

### El dataset es una tabla

Un [[dataset]] junta muchos ejemplos. Piénsalo como una tabla: cada fila es un ejemplo, cada columna una feature y la última columna, la etiqueta.

:::figura ejemplos-tabla
Cuatro filas de un dataset. En C01 la columna «foto» no guarda la imagen misma, sino dónde está guardada; así se puede tener una versión fija de cada mes sin copiar cientos de gigabytes.
:::

¿De dónde salen las etiquetas? En C01, de tres lugares, y no todas valen lo mismo. Los porcentajes son los del dataset de septiembre en la Ronda:

| Fuente | Qué parte del dataset | Qué tan buena |
|---|---|---|
| La categoría que eligió quien vende | 72 %, ya filtrada | Abundante pero ruidosa. Y está contaminada: la gente suele aceptar lo que el modelo le sugirió, así que el modelo terminaría aprendiendo a imitarse a sí mismo |
| Correcciones de moderadores | 7 % | Muy buena, pero solo de las publicaciones que alguien revisó |
| Personas que etiquetan a mano | 21 % | La mejor y la más cara: unas 5 mil fotos al mes, elegidas a propósito |

:::nota Basura entra, basura sale
Un modelo no puede ser más consistente que las etiquetas con las que aprendió. Si dos personas no se ponen de acuerdo en si una foto es «Tenis» o «Calzado deportivo», el modelo tampoco va a poder. Cómo se miden y se cuidan las etiquetas lo vemos a fondo en la estación 1, «Datos y etiquetas».
:::

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
Un reparto típico es 80 / 10 / 10:

- Train: 50,000 × 0.80 = 40,000 fotos.
- Validación: 50,000 × 0.10 = 5,000 fotos.
- Test: 50,000 × 0.10 = 5,000 fotos.

Las tres suman 50,000 y ninguna foto está en dos partes.
:::

:::diagrama ejemplos-split
Toca cada caja para ver por qué está ahí, o sigue los dos recorridos.
:::

:::analogia El examen de la escuela
- **Train** son los ejercicios resueltos del libro: con ellos estudias.
- **Validación** son los exámenes de práctica: te los pones para ver cómo vas y cambiar cómo estudias.
- **Test** es el examen final: uno, al final, con preguntas que no habías visto.

**Dónde se rompe la analogía.** Primero: un alumno que repite el mismo examen de práctica diez veces se lo acaba aprendiendo y lo sabe. Con un modelo pasa lo mismo, pero nadie lo nota: si pruebas 40 versiones y te quedas con la que mejor salió en validación, la elegiste en parte por suerte, y su número en validación sale optimista. Por eso hace falta un test aparte. Segundo: un alumno entiende, y un modelo puede memorizar literalmente casi 2 millones de fotos. Tercero: el examen final de verdad de un modelo es producción, y producción cambia con el tiempo ([[drift]]); el test solo dice cómo le irá si el mundo se parece al test.
:::

:::ojo
**Nunca decidas con el test.** Si miras el test, cambias algo y lo vuelves a mirar, el test se convirtió en validación y ya no tienes un número honesto. La Ronda lo dice así: probar 40 variantes y reportar la mejor en test convierte el test en validación.
:::

### ¿Cuánto va a cada parte?

Depende del tamaño. Con 1,000 fotos, 10 % de validación son 100 fotos: muy pocas para medir bien, y tal vez convenga 20 %. Con millones, un porcentaje chico ya es muchísimo. En C01, el dataset de septiembre de la Ronda trae 1,840,211 fotos en train y 92,417 en validación:

- Total: 1,840,211 + 92,417 = 1,932,628 fotos.
- Validación: 92,417 ÷ 1,932,628 ≈ 0.048, o sea ≈ 5 %.

Y en C01, ¿dónde está el test? Lo hace el [[golden-set]], un conjunto aparte de unas 50 mil fotos que no cambia de un mes a otro. Lo vemos al final de esta lección.

### Al azar o estratificado

La forma más simple de repartir es al azar: cada foto se sortea por separado, con 10 % de probabilidad de ir a validación, 10 % a test y 80 % a train. Con categorías grandes funciona bien. Con categorías chicas, la suerte pesa mucho.

:::ejemplo Una categoría con 20 fotos
«Máquinas de escribir» tiene 20 fotos. Al azar, cada una tiene 10 % de probabilidad de caer en validación, así que en promedio esperas 2. Pero:

- La probabilidad de que una foto **no** caiga en validación es 0.9.
- La de que **ninguna** de las 20 caiga es 0.9 multiplicado por sí mismo 20 veces: 0.9²⁰ ≈ 0.12.

Es decir, unas 12 de cada 100 veces validación se queda sin ninguna máquina de escribir, y no puedes medir esa categoría. Si tienes 100 categorías así de chicas, esperas que unas 12 queden sin medir.
:::

El arreglo es un [[estratificado|split estratificado]]: repartir **cada categoría por separado** en la misma proporción. Con 20 fotos y 80 / 10 / 10 quedan exactamente 16 en train, 2 en validación y 2 en test, siempre. Se puede estratificar por cualquier cosa que quieras que salga bien representada: la categoría, o si la foto vino del celular o de la web.

:::profundo ¿Y la probabilidad de que salgan justo 2?
Hay que contar de cuántas formas se pueden elegir las 2 fotos que van a validación: 20 × 19 ÷ 2 = 190 parejas. Cada pareja tiene probabilidad 0.1 × 0.1 de ir a validación y las otras 18 fotos, 0.9¹⁸ ≈ 0.150 de no ir. Juntas: 190 × 0.01 × 0.150 ≈ 0.285. Solo 28 de cada 100 veces sale el reparto «justo». Lo demás es suerte, para un lado o para el otro.
:::

## Leakage: cuando el examen se filtra {Data leakage}

El [[leakage]] (fuga de datos) es cuando el entrenamiento o la evaluación tienen información que no va a existir en el momento de predecir, o cuando el test se parece demasiado al train. El nombre lo dice: es un examen filtrado. El síntoma siempre es el mismo: un resultado sospechosamente bueno antes de producción que se derrumba en producción.

Es de lo más importante de esta lección, porque no da ningún error. Todo corre, los números se ven increíbles y nadie se entera hasta que el modelo ya está respondiendo mal. Estas son tres formas muy comunes.

### 1 · La misma foto en train y en test

En un marketplace la misma foto aparece una y otra vez: el vendedor sube la misma foto en tres publicaciones, o fotografía todo sobre la misma mesa con la misma luz. Si repartes al azar por publicación, las copias se separan: una queda en train y su gemela en test. El modelo no necesita entender nada para «acertarle»: ya la vio.

:::ejemplo La misma foto en tres publicaciones
Reparto al azar, 80 % a train y 20 % a test. Para una foto que aparece en 3 publicaciones:

- Las 3 caen en train: 0.8 × 0.8 × 0.8 = 0.512.
- Las 3 caen en test: 0.2 × 0.2 × 0.2 = 0.008.
- Quedan separadas (al menos una en cada lado): 1 − 0.512 − 0.008 = 0.48.

Ahora mira solo los casos en que al menos una copia está en test: 1 − 0.512 = 0.488. De esos, 0.48 tienen a su gemela en train: 0.48 ÷ 0.488 ≈ 0.98. Es decir, **98 de cada 100 veces** que una de esas fotos sale en el examen, el modelo ya se la sabía.
:::

La defensa tiene dos partes. Primero, **quitar copias antes de repartir**: a cada archivo se le calcula un *hash*, una huella digital corta que sale del contenido; dos archivos idénticos tienen la misma huella. Para fotos casi iguales (recortadas o vueltas a comprimir) hay huellas «perceptuales» que se parecen si las imágenes se parecen. Segundo, **repartir por grupo**: en C01 todas las fotos de un mismo vendedor van al mismo lado, así que el modelo no puede memorizar «la mesa de este vendedor». Los hashes los vemos a fondo en la lección «Tiempo, hashes e identificadores».

### 2 · Una feature que trae escondida la respuesta

A veces una columna de la tabla contiene la etiqueta disfrazada. Por ejemplo, un campo «re-categorizada por un moderador» o «estado final de la publicación». Se llenan **después** de que se publicó, a veces justo porque la categoría estaba mal. En el dataset histórico están llenos, y el modelo aprende a usarlos. En producción, cuando Ana sube su foto, ese campo todavía está vacío.

La prueba es una pregunta, columna por columna: **¿este dato ya existía en el instante en que el modelo tiene que responder?** Si la respuesta es no, fuera.

### 3 · Información del futuro

Imagina una feature «ventas del vendedor en los últimos 90 días». Para armar el dataset, alguien la calcula **hoy** para todas las publicaciones, también para una del 1 de marzo. Pero los 90 días anteriores a hoy incluyen ventas de marzo a junio, que el 1 de marzo todavía no habían pasado. El modelo aprende con un dato que en producción nunca va a tener.

Lo mismo pasa al repartir: si el modelo va a predecir el futuro, el examen tiene que venir del futuro. Si entrenas con datos hasta el 5 de enero, evalúas con datos desde el 6. Si repartes al azar en el tiempo, el modelo «ya conoce» las modas de diciembre cuando lo examinas con noviembre.

:::nota Una más, discreta
A veces la información del test se cuela por una cuenta. Por ejemplo, para [[normalizacion|normalizar]] los datos se calcula el promedio de todo el dataset antes de repartir: así el train ya «sabe» algo del test. Esas cuentas se hacen solo con train.
:::

:::ojo
**Desconfía de un número demasiado bueno.** Si tu modelo saca 99 % en validación en una tarea que nadie resuelve tan bien, lo primero no es celebrar: es buscar copias entre las partes, features que no existen al predecir y datos del futuro.
:::

## Clases desbalanceadas y la cola larga {Class imbalance and the long tail}

Casi nunca hay el mismo número de ejemplos de cada categoría. A eso se le llama [[desbalance|desbalance de clases]], y engaña de una forma muy concreta.

:::ejemplo El modelo flojo que acierta 95 %
Un dataset con 1,000 fotos: 950 de tenis y 50 de botas. Un «modelo» que siempre responde «tenis», sin mirar la foto:

- Aciertos: las 950 de tenis. 950 ÷ 1,000 = 95 %.
- Botas que reconoce: 0 de 50. O sea, 0 %.

Un 95 % que no sirve para nada si tú vendes botas.
:::

Por eso, con clases desbalanceadas, el porcentaje de aciertos total ([[accuracy]]) no basta. Hay que medir cada clase por separado: de las botas que había, ¿cuántas reconoció? Eso se llama [[recall]], y lo ves a fondo en la lección «¿Aprendió de verdad?».

### La cola larga de C01

Con 500 categorías el desbalance tiene una forma típica: la [[long-tail|cola larga]]. Unas cuantas categorías tienen decenas de miles de fotos, muchas tienen unos cientos o miles, y algunas apenas decenas. Si las ordenas de la más grande a la más chica, la gráfica cae rápido y luego sigue, baja y larga: esa es la «cola».

:::figura ejemplos-cola
Los números son ilustrativos, pero la forma es la de C01: las barras de la cola casi no se ven.
:::

Una cuenta para dimensionarlo. C01 tiene ≈ 1.84 millones de fotos de entrenamiento y 500 categorías:

- Si se repartieran parejo: 1,840,000 ÷ 500 = 3,680 fotos por categoría.
- Pero casi ninguna está cerca de ese promedio. En la figura, la primera tiene 62,000 (17 veces el promedio) y la última, 40 (92 veces menos).

La Ronda lo dice así para C01: con 500 categorías, el promedio lo dominan unas 50 categorías grandes, y la cola puede estar rota sin que se note. Por eso C01 mide aparte la **cabeza** (*head*, las 100 categorías con más tráfico) y la cola.

### Qué se hace con el desbalance

- **Medir por clase.** Lo primero, porque sin eso ni sabes que hay un problema. Un promedio que le da el mismo peso a cada categoría, sin importar su tamaño, es el [[macro-promedio]].
- **Etiquetar más donde hay poco.** Cuando el negocio agrega una categoría, C01 la llena a mano hasta tener unas 200 a 500 fotos.
- **Mostrar más seguido las fotos raras** (*oversampling*). Cuidado: 40 fotos repetidas muchas veces se aprenden de memoria ([[overfitting]]).
- **Que equivocarse en una clase rara cueste más.** Se hace en la [[loss|pérdida]], que es el número que mide el error al entrenar y que ves en la siguiente lección.

## Data augmentation: variaciones que no cambian la respuesta {Data augmentation}

Una foto de tenis volteada como espejo sigue siendo una foto de tenis. Un poco más oscura, también. Recortada un poco más a la izquierda, también. La [[augmentation|data augmentation]] aprovecha eso: al entrenar, a cada foto se le aplican cambios al azar que **no cambian su etiqueta**. Así el modelo aprende que esos cambios no importan para decidir la categoría.

Las variaciones más comunes en fotos:

- Voltearla como espejo, de izquierda a derecha.
- Recortar un pedazo un poco distinto y llevarlo al mismo tamaño (un [[crop]] al azar).
- Cambiar un poco el brillo, el contraste o el color.
- Girarla unos cuantos grados.

Como el cambio es al azar en cada pasada, el modelo casi nunca ve dos veces exactamente la misma imagen. En C01 cada foto de train pasa 8 veces por el modelo durante el entrenamiento, y cada vez llega un poquito distinta.

:::ojo
Tres reglas, y cada una evita un error real:

- **Solo si la etiqueta sigue siendo verdad.** Unos tenis en espejo son tenis. Pero en un modelo que lee texto, una letra en espejo ya no es la misma letra, y un 6 de cabeza es un 9.
- **Solo en train.** Validación y test van sin cambios, con el mismo [[preprocesamiento]] que tendrá producción. Si no, mides con fotos que no se parecen a las de Ana.
- **Imita lo que de verdad llega.** Los celulares toman fotos oscuras y chuecas: variar el brillo y girar un poco ayuda. Voltear de cabeza fotos que nadie sube de cabeza no ayuda.
:::

Y su límite: la augmentation no inventa información. Si de una categoría tienes 40 fotos de las mismas 3 monedas, todas sus variaciones siguen siendo 3 monedas. Para la cola larga ayuda, pero no reemplaza etiquetar más.

## Golden set y slices: un adelanto {Golden set and slices: a preview}

La Ronda usa mucho dos palabras que salen de todo lo anterior. Aquí solo qué son y por qué existen; los módulos de la Ronda las desarrollan.

### Golden set: la regla que no se mueve

Cada mes C01 entrena un modelo nuevo. ¿Cómo sabes si es mejor que el que está en producción? Tienes que examinarlos **con exactamente las mismas fotos**. Si el examen cambia cada mes, no sabes si la diferencia es del modelo o del examen.

Para eso está el [[golden-set|golden set]]: un conjunto de evaluación de la mejor calidad, que se arma una vez y se congela. El de C01, según la Ronda:

- ≈ 50 mil imágenes, cada una etiquetada por dos personas; si no coinciden, alguien con más experiencia decide.
- Estratificado: al menos ≈ 50 por categoría, para que la cola larga tenga con qué medirse, y repartido entre fotos de celular y de web.
- Congelado y **jamás usado para entrenar**. Si se entrenara con él, el modelo se lo sabría y dejaría de medir.
- Cuesta ≈ US$5–10 mil una sola vez. Por eso se cuida.

¿Por qué no usar como examen la categoría que eligió quien vende? Porque, como viste arriba, está contaminada por las sugerencias del propio modelo.

### Slices: el promedio esconde cosas

Un [[slice]] es un pedazo de los datos de evaluación que comparte algo y que se mide por separado: fotos de celular contra fotos de web, fotos con poca luz, imágenes muy chicas, categorías delicadas.

:::ejemplo Un modelo nuevo que «mejora»
El 95 % de las fotos del golden set tienen buena luz y el 5 %, poca luz.

- Modelo actual: 85.4 % con buena luz y 77.4 % con poca. En total: 0.95 × 85.4 + 0.05 × 77.4 = 81.13 + 3.87 = **85.0 %**.
- Modelo nuevo: 86.0 % con buena luz y 70.0 % con poca. En total: 0.95 × 86.0 + 0.05 × 70.0 = 81.7 + 3.5 = **85.2 %**.

El total subió 0.2 puntos y parece una mejora. Pero con poca luz bajó 7.4 puntos, y esas fotos suelen venir de celulares baratos: es un grupo de personas al que el modelo nuevo le va bastante peor. Solo el slice lo muestra.
:::

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M09 · Datos y features** desarrolla todo esto con números de producción: la sección de *data leakage* (repartir por tiempo y por vendedor, copias exactas y casi copias, el atajo por la fuente de la foto), el etiquetado con doble anotación y el costo del golden set de C01.
- **C01 en la Ronda** muestra el dataset de septiembre tal como se guarda: 1,840,211 fotos en train y 92,417 en validación, repartidas por vendedor con un hash, y el golden set aparte, congelado.
- **M10 · MLOps** usa el golden set y los slices en el *gate* de evaluación, el examen automático que decide si un modelo nuevo puede salir a producción: solo pasa si no empeora en el golden set, ni en la cola larga, ni en ningún slice.
- **M01 · El mapa y la entrevista** ya usa las dos palabras desde el ciclo de vida: «evaluar offline en un golden set fijo» y «el promedio oculta un slice roto (fotos nocturnas)». Ahora sabes qué son.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
ejemplo feature split train-set validation-set test-set estratificado leakage desbalance long-tail augmentation golden-set slice
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Tu modelo saca 99 % en validación y 70 % con fotos reales de producción. ¿Qué revisas primero?
Leakage. Que no haya copias (o casi copias) de la misma foto entre train y validación, que ninguna feature traiga la respuesta escondida o venga de después del momento de predecir, y que el reparto respete el tiempo y los grupos (por vendedor, en C01). Un número demasiado bueno es una alarma, no un logro.
? ¿Por qué no basta con dos partes, train y test?
Porque mientras desarrollas tomas decisiones (cuándo parar, qué ajustes, qué versión), y para eso necesitas medir. Si mides con el test, lo vas «gastando»: el número sale optimista porque elegiste lo que mejor le fue ahí. Validación es para decidir; el test, para el número final.
? Una categoría tiene 20 fotos y repartes al azar con 10 % para validación. ¿Qué puede salir mal y cómo se arregla?
Hay ≈ 12 % de probabilidad (0.9²⁰ ≈ 0.12) de que validación se quede sin ninguna foto de esa categoría, y entonces no la puedes medir. Con un split estratificado cada categoría se reparte por separado: quedan exactamente 16, 2 y 2.
? Un modelo acierta 95 % y alguien dice que es excelente. ¿Qué preguntas?
Cómo están repartidas las clases y cómo le va a cada una. Si el 95 % de las fotos son de una sola clase, un modelo que siempre dice esa clase ya saca 95 % sin aprender nada. Hay que ver el recall por clase, o un promedio que pese igual a todas.
? ¿Le aplicarías data augmentation al test? ¿Voltearías como espejo las fotos de un modelo que lee texto?
No y no. Al test no, porque tiene que parecerse a lo que llega en producción. Y en texto, una letra en espejo ya no es la misma letra: la variación cambia la respuesta, y eso le enseña algo falso al modelo.
? ¿Qué es el golden set de C01 y por qué nunca se usa para entrenar?
Unas 50 mil fotos etiquetadas por dos personas cada una, estratificadas por categoría y por origen, y congeladas. Sirve para comparar modelos de meses distintos con exactamente el mismo examen. Si se entrenara con él, el modelo se lo sabría y el examen dejaría de medir.
:::
