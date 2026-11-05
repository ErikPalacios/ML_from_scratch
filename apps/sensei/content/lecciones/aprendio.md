---
titulo: ¿Aprendió de verdad?
en: Did it really learn?
subtitulo: Cómo saber si un modelo entendió o solo memorizó, y cómo medir qué tan bien acierta sin que los números te engañen.
pregunta: Mi modelo dice 99 % de accuracy. ¿Ya puedo confiar en él?
minutos: 30
requisitos: aprender
---

:::idea
Un modelo aprendió de verdad cuando acierta en fotos que nunca vio. Y para saber cuánto acierta no basta un número: hay que ver en qué se equivoca, con qué categorías y cuánto cuesta cada error.
:::

## Memorizar no es aprender {Memorizing is not learning}

En la lección anterior viste cómo aprende un modelo: adivina, mide qué tanto se equivocó con la [[loss]] y mueve sus [[parametro|parámetros]] para equivocarse menos. Pero fíjate en lo que eso promete: se equivoca menos **en las fotos con las que entrena**. A nosotros nos importa otra cosa: que acierte con la foto de Ana, que nunca vio.

A esa capacidad se le llama [[generalizacion|generalización]]: acertar en ejemplos nuevos, parecidos a los del entrenamiento pero no iguales.

:::analogia El estudiante que memoriza el examen de práctica
Un profesor reparte un examen de práctica con 50 preguntas y sus respuestas. Un estudiante se aprende de memoria las 50 respuestas. Otro entiende cómo se resuelven. En el examen de práctica, los dos sacan 10. En el examen real, con preguntas nuevas, el primero reprueba.

Un modelo con millones de parámetros puede hacer lo mismo: aprenderse de memoria cada foto del entrenamiento, incluso sus [[etiqueta|etiquetas]] equivocadas, sin quedarse con nada que sirva para una foto nueva.

**Dónde se rompe la analogía:** el estudiante sabe si memorizó o entendió; el modelo no sabe nada de eso y no te lo puede decir. La única forma de averiguarlo es examinarlo con fotos que nunca vio. Además, el modelo no «entiende» como una persona: «generalizar» solo quiere decir que acierta en fotos nuevas.
:::

Por eso las fotos se reparten desde el principio en grupos que no se mezclan. Ya los viste en la lección de datos; aquí está para qué sirve cada uno:

| Grupo | Para qué sirve | ¿El modelo aprende de él? |
|---|---|---|
| [[train-set\|Entrenamiento]] (*train*) | Para mover los parámetros | Sí: lo ve una vez en cada [[epoch\|época]] |
| [[validation-set\|Validación]] (*validation*) | Para comparar versiones y decidir cuándo parar | No: solo se le mide |
| [[test-set\|Prueba]] (*test*) | El examen final | No, y se usa una sola vez, al final |

En C01 hay además un examen especial que no cambia de un mes a otro: el [[golden-set|golden set]], unas 50,000 fotos revisadas a mano y congeladas. Como siempre es el mismo, sirve para comparar el modelo de este mes contra el del mes pasado con las mismas preguntas.

:::ojo
Si una foto del examen también está en el entrenamiento, el examen mide memoria, no aprendizaje. En un marketplace pasa fácil: la misma persona sube la misma foto en dos publicaciones, una cae en entrenamiento y la otra en prueba. A eso se le llama [[leakage]] (fuga de datos): el número sale bonito y es mentira.
:::

## Overfitting y underfitting {Overfitting and underfitting}

Hay dos formas de fallar, y son opuestas.

- **[[underfitting|Underfitting]]** (subajuste): el modelo es demasiado simple, o entrenó muy poco, y ni siquiera aprende bien las fotos del entrenamiento. Se equivoca en todas partes.
- **[[overfitting|Overfitting]]** (sobreajuste): el modelo aprendió demasiado bien el entrenamiento, incluidos detalles que solo son casualidad (el fondo de cierta foto, una marca de agua), y empeora con fotos nuevas. Es el estudiante que memorizó.

¿Cómo sabes cuál te está pasando? Midiendo la loss en dos grupos al final de cada época: en entrenamiento y en validación. Las dos líneas, época tras época, forman la [[curva-aprendizaje|curva de aprendizaje]].

:::figura aprendio-curvas
La loss de entrenamiento baja siempre. La de validación baja, toca fondo en la época 8 y vuelve a subir: desde ahí el modelo memoriza. Números de ejemplo.
:::

:::ejemplo Leer la curva con números
Un entrenamiento de 20 épocas. Al final de algunas de ellas, la loss en cada grupo (números inventados, pero con la forma típica):

| Época | Loss en entrenamiento | Loss en validación | Qué está pasando |
|---|---|---|---|
| 1 | 2.10 | 2.15 | Las dos altas: todavía no aprende (underfitting) |
| 4 | 0.95 | 1.05 | Las dos bajan juntas: aprende cosas que sirven |
| 8 | 0.55 | 0.80 | La validación toca fondo: el mejor momento |
| 14 | 0.25 | 0.95 | Entrenamiento baja, validación sube: overfitting |
| 20 | 0.10 | 1.15 | Memoriza cada vez más |

En la época 8 la distancia entre las dos líneas es 0.80 − 0.55 = 0.25. En la 20 es 1.15 − 0.10 = 1.05: más de cuatro veces mayor. Esa brecha que crece mientras la validación sube es la firma del overfitting.
:::

¿Qué se hace con eso?

- **Quedarse con el mejor momento.** Se guarda un [[checkpoint]] (una copia de los parámetros) al final de cada época y se usa el de la época 8, no el de la 20. Parar cuando la validación deja de mejorar se llama *early stopping* (parada temprana).
- **Más datos, o datos más variados.** Con más fotos distintas, memorizarlas todas es más difícil. Si no hay más, se inventan variaciones de las que hay: voltearlas, recortarlas, cambiarles la luz. Eso es [[augmentation]].
- **Ponerle trabas a la memoria.** Hay técnicas que hacen más difícil memorizar. Una es el [[dropout]]: mientras entrena, el modelo apaga al azar una parte de sus piezas en cada paso, así que no puede depender de unas pocas que se aprendieron algo de memoria. Lo ves con calma en la siguiente lección.
- **Si es underfitting, lo contrario:** un modelo más capaz o entrenar más tiempo.

### Sesgo y varianza {Bias and variance}

Hay otra forma de decir lo mismo, que vas a oír mucho: [[bias-variance|sesgo contra varianza]] (*bias vs variance*).

- **Sesgo** (*bias*): el error que viene de que el modelo es demasiado simple para la tarea. Se equivoca de forma parecida aunque lo entrenes con otras fotos. Mucho sesgo es underfitting.
- **Varianza** (*variance*): qué tanto cambia el modelo si lo entrenas con otra muestra de fotos. Si cada muestra da un modelo muy distinto, es que está aprendiendo las casualidades de cada muestra. Mucha varianza es overfitting.

:::analogia Tirar dardos
Imagina que entrenas el mismo modelo cinco veces, cada una con una muestra distinta de fotos, y que cada modelo es un dardo. Con mucho sesgo, los cinco dardos caen juntos pero lejos del centro: fallan siempre igual. Con mucha varianza, caen alrededor del centro pero desparramados: cada uno falla distinto. Lo que quieres es que caigan juntos y en el centro.

**Dónde se rompe:** en el tablero ves dónde está el centro; en ML no lo ves, solo lo estimas con los datos de validación. Y en las redes grandes de hoy la historia es más complicada que «simple contra complicado»: un modelo enorme puede generalizar bien si tiene suficientes datos y trabas contra la memoria. Lo que no falla es la regla práctica: mide en fotos que el modelo nunca vio.
:::

## Accuracy y la matriz de confusión {Accuracy and the confusion matrix}

Ya sabes que hay que medir en fotos nuevas. Ahora, ¿medir qué? La primera idea es la [[accuracy]] (exactitud): de todas las fotos, qué fracción acertó.

En el resto de la lección vamos a usar un solo ejemplo. Tenemos **1,000 fotos de prueba**. De ellas, **100 son de tenis** y 900 de otras cosas (botas, playeras, bicicletas…). Por ahora hacemos una sola pregunta: ¿esta foto es de tenis, sí o no?

### Por qué la accuracy miente

Imagina un modelo flojísimo que siempre contesta «no es tenis», sin ver la foto. Acierta en las 900 que no son tenis y falla en las 100 que sí:

accuracy = 900 / 1,000 = **90 %**

Un 90 % que no sirve para nada: nunca encuentra un tenis.

Cuando las clases están más disparejas es peor. En la detección de fraude, de cada 1,000 compras, más o menos 10 son fraude (1 %). Un modelo que siempre dice «no es fraude» acierta 990 de 1,000: **99 % de accuracy**, y no atrapa ni un fraude. Cuando una clase es mucho más común que otra hay [[desbalance]], y ahí la accuracy sola engaña.

:::ojo
Antes de creerle a una accuracy, pregunta: ¿cuánto sacaría un modelo que siempre dice la clase más común? Si el tuyo saca 99 % y ese también, el tuyo no aprendió nada.
:::

### La tabla que no miente

Para ver en qué se equivoca el modelo se cuenta cada combinación de «lo que era» y «lo que dijo». Esa tabla es la [[matriz-confusion|matriz de confusión]] (*confusion matrix*). Para una pregunta de sí o no tiene 2 × 2 casillas. Esta es la de un modelo de verdad, no la del flojo:

:::figura aprendio-matriz
Las 1,000 fotos de prueba, según lo que eran (filas) y lo que dijo el modelo (columnas). En verde, los aciertos; en naranja, los dos tipos de error.
:::

Las cuatro casillas tienen nombre, y conviene aprendérselos porque se usan en todas partes:

| | Dijo «tenis» | Dijo «no es tenis» |
|---|---|---|
| **Era tenis (100)** | 80 · verdadero positivo (*TP*) | 20 · [[falso-negativo\|falso negativo]] (*FN*) |
| **No era tenis (900)** | 40 · [[falso-positivo\|falso positivo]] (*FP*) | 860 · verdadero negativo (*TN*) |

«Positivo» es la clase que buscas (tenis) y «negativo» es todo lo demás. «Verdadero» o «falso» dice si el modelo acertó. Así, un **falso positivo** es un «sí» equivocado: dijo tenis y era una bota. Un **falso negativo** es un «no» equivocado: era tenis y no lo vio.

La accuracy sale de la diagonal: (80 + 860) / 1,000 = 940 / 1,000 = **94 %**. Suena muy bien. Pero la tabla cuenta algo que el 94 % esconde: de los 100 tenis, al modelo se le escaparon 20, y además le dijo «tenis» a 40 cosas que no lo eran.

### Qué cuesta cada error en C01

Los dos errores no cuestan lo mismo, y eso lo decide el negocio, no el modelo.

- **Un falso positivo en C01:** Ana sube unas botas y la app le sugiere «Tenis». Si no se da cuenta y acepta, la publicación queda en la categoría equivocada: quien busca botas no la encuentra, y después alguien de moderación la tiene que mover. En la Ronda, el porcentaje de publicaciones que moderación tiene que recategorizar es justo una de las métricas que no pueden empeorar.
- **Un falso negativo en C01:** Ana sube unos tenis y «Tenis» no aparece entre las sugerencias. Tiene que buscar la categoría a mano. Es una molestia; si pasa mucho, más gente deja la publicación a medias.

En otros problemas la balanza cambia. En fraude, un falso negativo es dinero robado y un falso positivo es un cliente honesto con la tarjeta bloqueada. Decidir **qué error duele más** es de lo primero que pide la Ronda en M01, porque de ahí sale cómo se configura el modelo, como verás dos secciones más abajo.

### Con 500 categorías

C01 no pregunta «¿es tenis?»: elige entre 500 categorías. Su matriz de confusión es la misma idea, pero de **500 × 500**: una fila por lo que era la foto y una columna por lo que dijo el modelo. Son 500 × 500 = 250,000 casillas. La diagonal (500 casillas) son los aciertos; todo lo demás son confusiones.

Nadie la lee completa. Se buscan las casillas grandes fuera de la diagonal: «botas que dijo tenis: 30», «sandalias que dijo chanclas: 25». Esas parejas dicen dónde está confundido el modelo, y muchas veces destapan un problema de etiquetas: dos categorías que ni las personas distinguen bien.

Y de la tabla grande sale la chica. Para cualquier categoría, todo lo que no es esa categoría se junta como «negativo» y vuelves a tener un 2 × 2. Así, cada una de las 500 categorías tiene su propia matriz de 2 × 2.

## Precision, recall y F1 {Precision, recall and F1}

Con las cuatro casillas se arman las dos métricas más importantes de la clasificación. Cada una responde una pregunta distinta.

**[[precision|Precision]]** (precisión): *cuando el modelo dice «tenis», ¿qué tan seguido es verdad?*

precision = TP / (TP + FP) = 80 / (80 + 40) = 80 / 120 ≈ **66.7 %**

De cada 3 veces que dijo «tenis», acertó 2.

**[[recall|Recall]]** (exhaustividad o sensibilidad): *de todos los tenis que había, ¿cuántos encontró?*

recall = TP / (TP + FN) = 80 / (80 + 20) = 80 / 100 = **80 %**

De cada 10 tenis, encontró 8.

Las dos ponen arriba los mismos 80 aciertos, pero dividen entre cosas distintas: la precision, entre todo lo que el modelo *dijo* que era tenis (la columna de la izquierda); el recall, entre todo lo que *era* tenis (la fila de arriba).

:::nota Cómo no confundirlas
**Precision** mira lo que el modelo dijo: ¿cuánta de su lista de «tenis» es basura? **Recall** mira lo que había: ¿cuántos tenis se le escaparon? El modelo flojo que siempre dice «no» tiene recall de 0 %: no encontró ninguno.
:::

¿Por qué no basta con una? Porque cada una sola se puede inflar sacrificando a la otra. Un modelo que dice «tenis» a las 1,000 fotos tiene recall de 100 % (encontró los 100) y precision de 100 / 1,000 = 10 %. Uno que solo dice «tenis» a la foto más obvia, y acierta, tiene precision de 100 % y recall de 1 / 100 = 1 %.

### F1: las dos en un número

Cuando necesitas un solo número que salga bajo si cualquiera de las dos es mala, se usa el [[f1|F1]]: la media armónica de precision y recall.

F1 = 2 × precision × recall / (precision + recall)

Con nuestro modelo:

F1 = 2 × 0.667 × 0.80 / (0.667 + 0.80) = 1.067 / 1.467 ≈ **0.727**, o sea 72.7 %

Da menos que el promedio simple, que sería (66.7 + 80) / 2 = 73.3 %: la media armónica se carga hacia el número más chico. Con el modelo que dice «tenis» a todo se nota más: F1 = 2 × 0.10 × 1.00 / (0.10 + 1.00) = 0.20 / 1.10 ≈ 0.18, cuando el promedio simple le habría regalado 55 %.

:::profundo La misma cuenta, directo de la tabla
El F1 también sale de las casillas sin pasar por precision y recall: F1 = 2·TP / (2·TP + FP + FN) = 160 / (160 + 40 + 20) = 160 / 220 ≈ 0.727. Da lo mismo. Fíjate en que TN, los 860 aciertos de «no es tenis», no aparece: el F1 no se deja impresionar por la clase grande, y por eso se usa cuando hay desbalance.
:::

## Muchas categorías: por clase, macro y top-k {Many classes: per class, macro and top-k}

### Una métrica por categoría

Con 500 categorías, cada una tiene su precision y su recall, sacados de su propio 2 × 2. Esa es la métrica **por clase**. Luego hay que resumir 500 números en uno, y hay dos formas que dan resultados muy distintos:

- **Contar fotos.** Juntas todas las fotos y cuentas cuántas acertó. Es la accuracy de siempre (también se le dice *micro-promedio*). Cada foto pesa lo mismo, así que las categorías con muchas fotos mandan.
- **Promediar categorías.** Sacas el recall de cada categoría y promedias los 500 números. Es el [[macro-promedio|macro-promedio]]: cada **categoría** pesa lo mismo, tenga 10,000 fotos o 15.

¿Por qué importa? Porque en un marketplace las categorías tienen un [[long-tail|long tail]] (cola larga): unas pocas, como tenis o celulares, tienen muchísimas fotos, y cientos de categorías raras (patines de hielo, refacciones de máquinas de coser) tienen poquitas. Un modelo puede mejorar en las grandes, empeorar en todas las chicas, y la accuracy casi ni se mueve.

:::ejemplo Un modelo nuevo que «mejora» y en realidad empeora
Con 1,000 fotos y 500 categorías no alcanza: salen 2 fotos por categoría en promedio. Así que aquí pasamos al golden set de C01, de 50,000 fotos. Para simplificar, partimos las 500 categorías en dos grupos y suponemos que dentro de cada grupo todas tienen el mismo recall:

| Grupo | Categorías | Fotos | Recall del modelo actual | Recall del modelo nuevo |
|---|---|---|---|---|
| Cabeza (las grandes) | 200 | 45,000 | 87 % | 89.5 % |
| Cola (las chicas) | 300 | 5,000 | 67 % | 47 % |

**Accuracy, contando fotos:**

- Actual: (0.87 × 45,000 + 0.67 × 5,000) / 50,000 = (39,150 + 3,350) / 50,000 = 42,500 / 50,000 = **85.0 %**
- Nuevo: (0.895 × 45,000 + 0.47 × 5,000) / 50,000 = (40,275 + 2,350) / 50,000 = 42,625 / 50,000 = **85.25 %**

**Macro-recall, promediando categorías:**

- Actual: (200 × 87 + 300 × 67) / 500 = (17,400 + 20,100) / 500 = **75.0 %**
- Nuevo: (200 × 89.5 + 300 × 47) / 500 = (17,900 + 14,100) / 500 = **64.0 %**

La accuracy dice «mejoró un cuarto de punto». El macro-recall dice «empeoró 11 puntos». Las dos son ciertas: el modelo nuevo le sirve un poquito mejor a la mayoría de las fotos y mucho peor a 300 categorías. Para quien vende patines de hielo, es un desastre.
:::

Por eso el examen de C01 en la Ronda no se queda con la accuracy: exige que el recall de las 100 categorías con más tráfico (las que más publicaciones reciben) no se caiga y que **el macro-recall del long tail no empeore**.

### Top-1 y top-5

Hasta aquí, «acertar» quería decir que la respuesta número uno del modelo era la correcta. Pero el modelo no da una sola respuesta: da una [[probabilidad]] para cada una de las 500 categorías, y se pueden ordenar de mayor a menor. Eso abre otra forma de medir, la [[top-k-accuracy|top-k accuracy]]:

- **Top-1 accuracy:** la categoría correcta es la primera de la lista.
- **Top-5 accuracy:** la categoría correcta está entre las 5 primeras.

:::ejemplo Unos botines
Llega la foto de unos botines. Su etiqueta correcta es «Botas». El modelo responde:

| Lugar | Categoría | Probabilidad |
|---|---|---|
| 1 | Tenis | 48 % |
| 2 | Botas | 31 % |
| 3 | Sandalias | 9 % |
| 4 | Zapatos de vestir | 6 % |
| 5 | Pantuflas | 3 % |
| — | Las otras 495, juntas | 3 % |

Para la top-1 es un error: la primera es «Tenis». Para la top-5 es un acierto: «Botas» está en el lugar 2.
:::

¿Cuál importa? La que se parece a cómo se usa el modelo. En C01 la app le muestra a Ana **5 sugerencias** y ella elige. Si la correcta está entre las 5, Ana la toca y listo. Por eso la métrica offline principal de C01 en la Ronda es la top-5 (*offline* quiere decir que se mide con fotos guardadas, antes de que el modelo le responda a nadie). El modelo de C01 saca ≈ 85 % de top-1 y ≈ 96 % de top-5: en nuestras 1,000 fotos, la primera sugerencia es la correcta en 850, y la correcta aparece entre las cinco en 960.

:::nota De dónde viene la top-5
La top-5 se hizo famosa con la competencia de ImageNet, un concurso anual de clasificación de fotos con 1,000 categorías que se hizo de 2010 a 2017 y la usaba como métrica principal. Con tantas categorías parecidas, a veces hasta las personas dudan entre dos o tres.
:::

## El umbral y la curva ROC {The threshold and the ROC curve}

El modelo no dice «sí» o «no»: dice un número, por ejemplo «tenis: 0.70». Para convertir ese número en una decisión se elige un [[umbral]] (*threshold*): si el número es igual o mayor que el umbral, cuenta como «sí».

Para ver qué pasa al moverlo, tomemos 10 fotos, 4 de tenis y 6 de otras cosas, con el número que el modelo le dio a «tenis», ordenadas de mayor a menor:

| Foto | ¿Era tenis? | Número del modelo |
|---|---|---|
| 1 | sí | 0.95 |
| 2 | sí | 0.85 |
| 3 | no | 0.70 |
| 4 | sí | 0.60 |
| 5 | no | 0.40 |
| 6 | sí | 0.35 |
| 7 | no | 0.25 |
| 8 | no | 0.15 |
| 9 | no | 0.10 |
| 10 | no | 0.05 |

Probemos tres umbrales:

| Umbral | Dice «tenis» a | TP | FP | FN | Precision | Recall |
|---|---|---|---|---|---|---|
| 0.80 | fotos 1 y 2 | 2 | 0 | 2 | 2 / 2 = 100 % | 2 / 4 = 50 % |
| 0.50 | fotos 1 a 4 | 3 | 1 | 1 | 3 / 4 = 75 % | 3 / 4 = 75 % |
| 0.30 | fotos 1 a 6 | 4 | 2 | 0 | 4 / 6 ≈ 66.7 % | 4 / 4 = 100 % |

Subir el umbral vuelve al modelo más exigente: dice «sí» menos veces, se equivoca menos cuando lo dice (sube la precision) y se le escapan más (baja el recall). Bajarlo hace lo contrario. **No hay umbral que mejore las dos a la vez:** se elige según qué error duele más.

En C01 el modelo no usa un umbral para decidir solo: siempre muestra sus 5 sugerencias. Pero imagina que el negocio quiere ir más lejos y **preseleccionar** la categoría sin preguntarle a Ana. Ahí sí hace falta un umbral, y uno alto, porque preseleccionar mal es un falso positivo que Ana quizá ni note. Solo se preselecciona cuando el modelo está muy seguro; en los demás casos se muestran las sugerencias. Ese umbral se guarda en la configuración, con su versión, porque moverlo cambia lo que hace el sistema tanto como cambiar el modelo.

### La curva ROC

Si en lugar de tres umbrales pruebas todos, y para cada uno anotas dos números, sale una curva:

- **Tasa de verdaderos positivos** (*TPR*): es el recall, TP / (TP + FN). De los tenis, a cuántos les dijo que sí.
- **Tasa de falsos positivos** (*FPR*): FP / (FP + TN). De los que **no** eran tenis, a cuántos les dijo que sí por error.

Con las 10 fotos: umbral 0.80 → FPR 0 / 6 = 0 % y TPR 50 %. Umbral 0.50 → FPR 1 / 6 ≈ 17 % y TPR 75 %. Umbral 0.30 → FPR 2 / 6 ≈ 33 % y TPR 100 %. Si dibujas cada umbral como un punto (la FPR a lo ancho, la TPR a lo alto) y los unes, tienes la [[curva-roc|curva ROC]].

:::figura aprendio-roc
La curva ROC de las 10 fotos. Cada escalón es un umbral distinto. La diagonal punteada es lo que haría un modelo que adivina al azar.
:::

Un modelo perfecto sube hasta arriba sin moverse a la derecha: encuentra todos los tenis sin ningún falso positivo. Uno que adivina al azar va por la diagonal. Entre más se pegue la curva a la esquina de arriba a la izquierda, mejor.

El nombre viene de los radares de la Segunda Guerra Mundial: *receiver operating characteristic*, «característica de operación del receptor». Servía para ver qué tan bien se distinguía un avión del ruido.

### AUC: la curva en un número

El área bajo la curva ROC es el [[auc|AUC]] (*area under the curve*). En la práctica va de 0.5 (al azar) a 1 (perfecto); menos de 0.5 querría decir que el modelo tiene las cosas al revés. Y tiene una lectura muy útil: **es la probabilidad de que, si tomas al azar una foto de tenis y una que no lo es, el modelo le dé más puntos a la de tenis.**

:::ejemplo El AUC de las 10 fotos, contando parejas
Hay 4 fotos de tenis y 6 que no: 4 × 6 = 24 parejas. Contamos en cuántas la de tenis tiene el número más alto:

- Foto 1 (0.95) le gana a las 6. → 6
- Foto 2 (0.85) le gana a las 6. → 6
- Foto 4 (0.60) le gana a 5; pierde contra la foto 3 (0.70). → 5
- Foto 6 (0.35) le gana a 4; pierde contra las fotos 3 y 5. → 4

Total: 6 + 6 + 5 + 4 = 21 de 24. AUC = 21 / 24 = **0.875**. Si calculas el área de los escalones de la figura, sale lo mismo: 1/6 × 0.50 + 1/6 × 0.75 + 4/6 × 1 = 0.083 + 0.125 + 0.667 = 0.875.
:::

El AUC sirve para comparar dos modelos antes de elegir umbral. Pero no te dice qué umbral usar ni cuánto vas a acertar con él: eso lo decides tú, con el costo de cada error.

## Calibración: ¿el 90 % es 90 %? {Calibration: is 90 % really 90 %?}

Cuando el modelo dice «Tenis, 90 %», ¿qué quiere decir ese 90 %? Lo que uno esperaría: que de todas las veces que dice 90 %, acierta 90 de cada 100. Cuando eso se cumple, el modelo está bien calibrado. A eso se le llama [[calibracion|calibración]].

No es lo mismo que acertar mucho. Un modelo puede tener buena accuracy y estar mal calibrado: acertar 85 % de las veces y decir siempre «99 %». Las redes neuronales modernas suelen ser **demasiado confiadas**; un estudio muy citado (Guo y otros, 2017) lo mostró con redes de la familia ResNet, la misma de C01.

¿Cómo se revisa? Se agrupan las fotos según la [[confianza]] que dio el modelo y, en cada grupo, se compara lo que dijo con lo que acertó:

:::ejemplo Las 1,000 fotos, agrupadas por confianza
| Lo que decía el modelo (en promedio) | Fotos | Aciertos | % de aciertos | Diferencia |
|---|---|---|---|---|
| 50 % | 100 | 45 | 45 % | 5 puntos |
| 70 % | 100 | 64 | 64 % | 6 puntos |
| 90 % | 300 | 246 | 82 % | 8 puntos |
| 99 % | 500 | 495 | 99 % | 0 puntos |
| **Todas** | **1,000** | **850** | **85 %** | |

Los aciertos suman 45 + 64 + 246 + 495 = 850: es el mismo 85 % de top-1 de antes. Y la tabla dice algo que ese 85 % no dice: **cuando el modelo dice 90 %, acierta 82 %.** Exagera su seguridad.

Para resumir la tabla en un número se usa el **ECE** (*expected calibration error*, error de calibración esperado): el promedio de las diferencias, pesado por la fracción de fotos de cada grupo (el primero tiene 100 de 1,000, o sea 0.10):

ECE = 0.10 × 0.05 + 0.10 × 0.06 + 0.30 × 0.08 + 0.50 × 0.00 = 0.005 + 0.006 + 0.024 + 0 = **0.035**
:::

¿Por qué le importa esto a producción? Porque en C01 el número **se usa**: ordena las sugerencias, y si un día hay un umbral para preseleccionar, ese umbral solo tiene sentido si «90 %» quiere decir 90 %. Por eso el examen de C01 en la Ronda pide un ECE de 0.05 o menos. Este modelo pasaría (0.035), aunque el grupo del 90 % muestra dónde exagera: un promedio que pasa puede esconder un grupo que no.

Cuando un modelo está mal calibrado hay arreglos baratos que no tocan lo que aprendió. El más común es el *temperature scaling*: dividir los [[logit|logits]] entre un número fijo antes del [[softmax]], para «bajarle los humos» a todas sus probabilidades. Ese número se elige con el set de validación: el que deja las probabilidades más honestas. No cambia qué categoría queda primero, así que la top-1 no se mueve; solo cambia qué tan seguro dice estar.

## El examen completo {The full evaluation}

Ahora junta todo. Antes de que un modelo nuevo reemplace al que está en producción, pasa por un examen automático que en la Ronda se llama *gate de evaluación* (la compuerta). Ya tienes casi todas sus piezas:

:::diagrama aprendio-examen
Cómo decide un examen si el modelo nuevo es suficientemente bueno. Toca cada caja para ver por qué está ahí.
:::

Tres ideas para llevarte de esta sección:

:::pasos
1. Se compara contra el modelo actual, con las mismas fotos
No basta con que el nuevo saque «85 %». Tiene que no ser peor que el que ya está, en el mismo golden set y en los mismos grupos de fotos.
2. Las reglas se escriben antes de entrenar
Qué métricas y con qué límite. Si se decide después de ver los resultados, siempre aparece una excusa para aprobar.
3. Ningún número solo basta
Una top-5 alta con el long tail roto, o con la seguridad inflada, no pasa.
:::

:::ojo
Pasar el examen offline no prueba que el modelo funcione con gente real. El golden set es una foto del pasado: con el [[drift]], el mundo se va alejando de él. Por eso, después del examen, el modelo nuevo responde primero solo una parte de las fotos reales que llegan, y se compara con el actual antes de dárselo a todos. Y el [[monitoreo]] sigue midiendo. Eso lo verás en las estaciones de Orquestación y Monitoreo.
:::

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M01 · El mapa y la entrevista** pide bajar el objetivo por una cadena de métricas: negocio (publicaciones completadas) → online (cuántas veces se acepta la sugerencia) → offline (top-5 en el golden set). Y pide decir qué error duele más, falso positivo o falso negativo, porque eso fija precision contra recall y el umbral.
- **M10 · MLOps** arma el gate de evaluación de C01: top-1 y top-5 en el golden set de 50,000 fotos contra el modelo actual, recall de las 100 categorías con más tráfico, macro-recall del long tail, ECE ≤ 0.05 después de temperature scaling y la matriz de confusión guardada con cada entrenamiento. También guarda la curva de validación por época, que es donde se ve el overfitting.
- **M11 · Despliegue** es lo que pasa después del gate: el modelo nuevo primero recibe una copia de las fotos pero nadie ve sus respuestas (*shadow*), y luego responde de verdad a una parte de la gente (*canary*). Cada métrica se compara contra el modelo actual en las mismas horas.
- **M12 · Monitoreo** usa el AUC de una forma ingeniosa: entrena un clasificador que intenta distinguir las fotos de hoy de las de referencia. Si su AUC es ≈ 0.5, no las distingue: no hay drift.
- Los casos de **moderación (c06)** y **fraude (c09)** son donde la accuracy miente más, por el desbalance. Ahí se habla de precision con un recall mínimo y del costo de cada tipo de error.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
generalizacion overfitting underfitting curva-aprendizaje bias-variance accuracy matriz-confusion falso-positivo falso-negativo precision recall f1 macro-promedio top-k-accuracy curva-roc auc calibracion
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? La loss de entrenamiento sigue bajando, pero la de validación lleva cinco épocas subiendo. ¿Qué pasa y qué haces?
Overfitting: el modelo empezó a memorizar el entrenamiento. Te quedas con el checkpoint de la época en que la validación fue más baja (early stopping) y, para el siguiente entrenamiento, consideras más datos, augmentation o más trabas contra la memoria.
? Un detector de fraude tiene 99 % de accuracy. ¿Es bueno?
No se sabe. Si el 1 % de las compras son fraude, un modelo que siempre dice «no es fraude» también saca 99 %. Hay que ver la matriz de confusión, el recall del fraude y la precision.
? De 100 tenis, el modelo encontró 80, y en total dijo «tenis» 120 veces. ¿Cuánto valen la precision y el recall?
Recall = 80 / 100 = 80 %. Precision = 80 / 120 ≈ 66.7 %. Los 40 que sobran son falsos positivos.
? Un modelo nuevo sube la accuracy de 85.0 % a 85.25 %, pero el macro-recall baja de 75 % a 64 %. ¿Qué pasó?
Mejoró un poco en las categorías grandes, que tienen casi todas las fotos, y empeoró mucho en las chicas. La accuracy cuenta fotos; el macro-recall cuenta categorías. En C01 no se aprueba: el long tail empeoró.
? ¿Por qué C01 mide top-5 y no solo top-1?
Porque la app le muestra a quien vende 5 sugerencias y elige una. Si la correcta está entre las 5, la sugerencia funcionó.
? El modelo dijo ≈ 90 % en 300 fotos y acertó en 246. ¿Está bien calibrado?
No del todo: 246 / 300 = 82 %, no 90 %. En ese rango es demasiado confiado. Se puede corregir con temperature scaling, que no cambia qué categoría queda primero.
:::
