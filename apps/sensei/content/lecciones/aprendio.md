---
titulo: ¿Aprendió de verdad?
en: Did it really learn?
subtitulo: Cómo saber si un modelo aprendió o solo memorizó, cómo medir qué tan bien acierta sin que los números te engañen y cómo se conecta esa medida con lo que le importa a la gente.
pregunta: Mi modelo dice 99 % de accuracy. ¿Ya puedo confiar en él?
requisitos: aprender
---

:::idea
Un modelo aprendió de verdad cuando acierta en datos que nunca vio. Y para saber cuánto acierta no basta un número: hay que ver en qué se equivoca, con qué categorías y con qué grupos, qué tan honesta es su seguridad y si ese acierto le sirve a la gente que lo usa.
:::

## Memorizar no es aprender {Memorizing is not learning}

En la lección anterior viste cómo aprende un modelo: adivina, mide qué tanto se equivocó con la [[loss]] y mueve sus [[parametro|parámetros]] para equivocarse menos. Pero fíjate en lo que eso promete: se equivoca menos **en las fotos con las que entrena**. A nosotros nos importa otra cosa: que acierte con la foto de Ana, que nunca vio.

A esa capacidad se le llama [[generalizacion|generalización]]: acertar en ejemplos nuevos, parecidos a los del entrenamiento pero no iguales.

:::analogia El estudiante que memoriza el examen de práctica
Un profesor reparte un examen de práctica con 50 preguntas y sus respuestas. Un estudiante se aprende de memoria las 50 respuestas. Otro entiende cómo se resuelven. En el examen de práctica, los dos sacan 10. En el examen real, con preguntas nuevas, el primero reprueba.

Un modelo con millones de parámetros puede hacer lo mismo: aprenderse de memoria cada foto del entrenamiento, incluso sus [[etiqueta|etiquetas]] equivocadas, sin quedarse con nada que sirva para una foto nueva.

**Dónde se rompe la analogía:** el estudiante sabe si memorizó o entendió; el modelo no sabe nada de eso y no te lo puede decir. La única forma de averiguarlo es examinarlo con fotos que nunca vio. Además, el modelo no «entiende» como una persona: «generalizar» solo quiere decir que acierta en fotos nuevas.
:::

Por eso las fotos se reparten desde el principio en grupos que no se mezclan:

| Grupo | Para qué sirve | ¿El modelo aprende de él? |
|---|---|---|
| [[train-set\|Entrenamiento]] (*train*) | Para mover los parámetros | Sí: lo ve una vez en cada [[epoch\|época]] |
| [[validation-set\|Validación]] (*validation*) | Para comparar versiones y decidir cuándo parar | No: solo se le mide |
| [[test-set\|Prueba]] (*test*) | El examen final | No, y se usa una sola vez, al final |

En C01 hay además un examen especial que no cambia de un mes a otro: el [[golden-set|golden set]], unas 50,000 fotos revisadas a mano y congeladas. Como siempre es el mismo, sirve para comparar el modelo de este mes contra el del mes pasado con las mismas preguntas.

:::ojo
Si una foto del examen también está en el entrenamiento, el examen mide memoria, no aprendizaje. En un marketplace pasa fácil: la misma persona sube la misma foto en dos publicaciones, una cae en entrenamiento y la otra en prueba. A eso se le llama [[leakage]] (fuga de datos): el número sale bonito y es mentira.
:::

### Overfitting y underfitting

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

- **Quedarse con el mejor momento.** Se guarda un [[checkpoint]] (una copia de los parámetros) al final de cada época y se usa el de la época 8, no el de la 20. Parar cuando la validación deja de mejorar se llama [[early-stopping|early stopping]] (parada temprana).
- **Más datos, o datos más variados.** Con más fotos distintas, memorizarlas todas es más difícil. Si no hay más, se inventan variaciones de las que hay: voltearlas, recortarlas, cambiarles la luz. Eso es [[augmentation]].
- **Ponerle trabas a la memoria.** A esas trabas se les llama [[regularizacion|regularización]]. Una es el [[dropout]]: mientras entrena, el modelo apaga al azar una parte de sus piezas en cada paso, así que no puede depender de unas pocas que se aprendieron algo de memoria. Lo ves con calma en la siguiente lección.
- **Si es underfitting, lo contrario:** un modelo más capaz o entrenar más tiempo.

## Sesgo, varianza y validación cruzada {Bias, variance and cross-validation} [extra]

Esta sección es para una segunda pasada. Responde dos preguntas que aparecen en cuanto hay pocos datos: ¿por qué un modelo cambia tanto según con qué fotos lo entrenes?, y ¿cómo mides bien si tu examen es chiquito?

### Sesgo y varianza

Hay otra forma de decir lo de overfitting y underfitting, que vas a oír mucho: [[bias-variance|sesgo contra varianza]] (*bias vs variance*).

- **Sesgo** (*bias*): el error que viene de que el modelo es demasiado simple para la tarea. Se equivoca de forma parecida aunque lo entrenes con otras fotos. Mucho sesgo es underfitting.
- **Varianza** (*variance*): qué tanto cambia el modelo si lo entrenas con otra muestra de fotos. Si cada muestra da un modelo muy distinto, es que está aprendiendo las casualidades de cada muestra. Mucha varianza es overfitting.

:::analogia Tirar dardos
Imagina que entrenas el mismo modelo cinco veces, cada una con una muestra distinta de fotos, y que cada modelo es un dardo. Con mucho sesgo, los cinco dardos caen juntos pero lejos del centro: fallan siempre igual. Con mucha varianza, caen alrededor del centro pero desparramados: cada uno falla distinto. Lo que quieres es que caigan juntos y en el centro.

**Dónde se rompe:** en el tablero ves dónde está el centro; en ML no lo ves, solo lo estimas con los datos de validación. Y en las redes grandes de hoy la historia es más complicada que «simple contra complicado»: un modelo enorme puede generalizar bien si tiene suficientes datos y trabas contra la memoria. Lo que no falla es la regla práctica: mide en fotos que el modelo nunca vio.
:::

### El examen también tiene ruido

La varianza no es solo del modelo: el **resultado del examen** también cambia según qué fotos te tocaron. Imagina un marketplace chico, o una categoría nueva de C01, con solo **250 fotos etiquetadas**. Apartas 50 para validación y entrenas con 200. Cada foto de validación vale 1 / 50 = **2 puntos** de accuracy, y con otras 50 fotos al azar el resultado se mueve varios puntos por pura suerte: unas veces te tocan fotos fáciles y otras, difíciles.

:::profundo ¿Cuánto se mueve un examen por pura suerte?
Una regla aproximada: si el modelo acierta una fracción p de las fotos y el examen tiene n fotos, el resultado se puede mover por pura suerte hasta unos ±1.96 × √(p × (1 − p) / n). Es la mitad del ancho de un [[intervalo-confianza|intervalo de confianza]] del 95 %, que ves en la lección «Ruido, muestras y pruebas A/B». Con p = 0.85:

| Fotos en el examen | ± por pura suerte |
|---|---|
| 50 | 1.96 × √(0.85 × 0.15 / 50) ≈ ±9.9 puntos |
| 1,000 | ≈ ±2.2 puntos |
| 50,000 (el golden set de C01) | ≈ ±0.3 puntos |

Por eso, en la Ronda, el gate de C01 no le pide al modelo nuevo «sacar más» que el actual, sino «no sacar menos» por más de 0.3 puntos, comparando los dos foto por foto: con 50,000 fotos, diferencias así de chicas pueden salir por pura suerte.
:::

### Validación cruzada: que todas las fotos sean examen

La [[validacion-cruzada|validación cruzada]] (*cross-validation*) usa todas las fotos como examen, una vez cada una. La versión más común se llama *k-fold*:

:::pasos
1. Partir las fotos en k grupos
Con 250 fotos y k = 5: cinco grupos (*folds*) de 50, sin repetir ninguna foto.
2. Entrenar k veces
En cada vuelta, un grupo distinto es la validación y los otros cuatro (200 fotos) son el entrenamiento. Cada vuelta empieza de cero.
3. Juntar los k resultados
Se promedian las k accuracies y se mira qué tanto se separan entre sí.
:::

:::figura aprendio-kfold
Validación cruzada con 5 grupos. En cada vuelta, el grupo naranja es la validación y los azules, el entrenamiento.
:::

:::ejemplo Cinco vueltas con 250 fotos
| Vuelta | Validación | Aciertos | Accuracy |
|---|---|---|---|
| 1 | grupo 1 | 43 de 50 | 86 % |
| 2 | grupo 2 | 46 de 50 | 92 % |
| 3 | grupo 3 | 40 de 50 | 80 % |
| 4 | grupo 4 | 42 de 50 | 84 % |
| 5 | grupo 5 | 44 de 50 | 88 % |

Promedio: (86 + 92 + 80 + 84 + 88) / 5 = 430 / 5 = **86 %**, lo mismo que contar todos los aciertos juntos: 215 de 250. Y el rango, de 80 % a 92 %, dice lo que un solo examen de 50 fotos habría escondido: según qué fotos te tocaran, podías reportar cualquier número entre 80 y 92.
:::

¿Y con cuál de los cinco modelos te quedas? Con ninguno. La validación cruzada mide una **receta** (la arquitectura, los [[hiperparametro|hiperparámetros]], cómo se preparan los datos), no un modelo. Cuando ya elegiste la receta, entrenas el modelo final con las 250 fotos. Y para comparar dos recetas, compáralas **vuelta por vuelta**, con los mismos grupos: si B le gana a A en las cinco vueltas, aunque sea por poco, créelo; si gana en promedio pero pierde en dos vueltas, puede ser suerte.

Tres cuidados, los mismos del reparto normal:

- **Estratificar.** Que cada grupo tenga la misma proporción de cada clase ([[estratificado]]).
- **Repartir por grupo.** Todas las fotos de un vendedor van al mismo grupo; si no, hay leakage entre vueltas ([[split-por-grupo]]).
- **Respetar el tiempo.** Si el modelo predice el futuro, cada vuelta entrena con el pasado y evalúa con lo que sigue ([[split-temporal]]). En la Ronda, el caso de pronóstico de demanda (C14) entrena hasta una fecha de corte, evalúa los 14 días siguientes y lo repite con 8 cortes semanales: un *backtest* con origen móvil.

¿Y en C01? No hace falta. Con 92,417 fotos de validación y el golden set de 50,000, el ruido de un solo examen ya es chico, y entrenar cinco veces una ResNet-50 cuesta cinco veces las horas de GPU. La validación cruzada es para cuando hay pocos datos (cientos o pocos miles) o el modelo es barato de entrenar.

## La matriz de confusión y sus métricas {The confusion matrix and its metrics}

Ya sabes que hay que medir en fotos nuevas. Ahora, ¿medir qué? La primera idea es la [[accuracy]] (exactitud): de todas las fotos, qué fracción acertó.

En el resto de la lección vamos a usar un solo ejemplo. Tenemos **1,000 fotos de prueba**. De ellas, **100 son de tenis** y 900 de otras cosas (botas, playeras, bicicletas…). Por ahora hacemos una sola pregunta: ¿esta foto es de tenis, sí o no?

### Por qué la accuracy miente

Imagina un modelo flojísimo que siempre contesta «no es tenis», sin ver la foto. Acierta en las 900 que no son tenis y falla en las 100 que sí:

accuracy = 900 / 1,000 = **90 %**

Un 90 % que no sirve para nada: nunca encuentra un tenis.

Cuando las clases están más disparejas es peor. Si 1 de cada 100 compras es fraude, un modelo que siempre dice «no es fraude» saca **99 % de accuracy** y no atrapa ni un fraude. En el caso de fraude de la Ronda (C09) es más extremo: el fraude es ≈ 0.08 % de las compras, así que no hacer nada saca 99.92 %. Cuando una clase es mucho más común que otra hay [[desbalance]], y ahí la accuracy sola engaña.

:::ojo
Antes de creerle a una accuracy, pregunta: ¿cuánto sacaría un modelo que siempre dice la clase más común? Ese punto de comparación es el [[baseline]] más simple. Si el tuyo saca 99 % y el baseline también, el tuyo no aprendió nada.
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

### Qué cuesta cada error

Los dos errores no cuestan lo mismo, y eso lo decide el negocio, no el modelo.

- **Un falso positivo en C01:** Ana sube unas botas y la app le sugiere «Tenis». Si no se da cuenta y acepta, la publicación queda en la categoría equivocada: quien busca botas no la encuentra, y alguien de moderación la tiene que mover. En la Ronda, el porcentaje de publicaciones que moderación recategoriza es justo una de las métricas que no pueden empeorar.
- **Un falso negativo en C01:** Ana sube unos tenis y «Tenis» no aparece entre las sugerencias. Tiene que buscar la categoría a mano. Es una molestia; si pasa mucho, más gente deja la publicación a medias.

En fraude la balanza cambia: un falso negativo es dinero robado y un falso positivo es un cliente honesto con la compra rechazada. Decidir **qué error duele más** es de lo primero que pide la Ronda en M01, porque de ahí sale cómo se configura el modelo, como verás en la sección del umbral.

### Precision y recall

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

Cuando necesitas un solo número que salga bajo si cualquiera de las dos es mala, se usa el [[f1|F1]]: la media armónica de precision y recall, F1 = 2 × precision × recall / (precision + recall).

:::cuenta El F1 del modelo de tenis
Precision // de lo que dijo «tenis», cuánto era | 80 / (80 + 40) | 0.667
Recall // de los tenis, cuántos encontró | 80 / (80 + 20) | 0.800
Arriba: 2 × P × R | 2 × 0.667 × 0.800 | 1.067
Abajo: P + R | 0.667 + 0.800 | 1.467
F1 | 1.067 / 1.467 | ≈ 0.727
Directo de la tabla // sin pasar por P y R | 2·80 / (2·80 + 40 + 20) = 160 / 220 | ≈ 0.727
= F1 ≈ 0.727, o sea 72.7 %. Las dos rutas dan lo mismo.
:::

Da menos que el promedio simple, (66.7 + 80) / 2 = 73.3 %: la media armónica se carga hacia el número más chico. Con el modelo que dice «tenis» a todo se nota más: F1 = 2 × 0.10 × 1.00 / (0.10 + 1.00) ≈ 0.18, cuando el promedio simple le habría regalado 55 %. Y fíjate en que TN, los 860 aciertos de «no es tenis», no aparece en precision, ni en recall, ni en F1: las tres no se dejan impresionar por la clase grande, y por eso se usan cuando hay desbalance.

:::calculadora aprendio-matriz
Las mismas cuentas, con los números que quieras. La última fila es el baseline: la accuracy de un modelo que siempre dice «no».
:::

### Las mismas cuentas en Python

Las cuatro casillas se cuentan directo de dos listas: lo que era cada foto y lo que dijo el modelo. Con 20 fotos:

```python
# 1 = «tenis», 0 = «no es tenis». Una posición por foto.
reales    = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0]
predichas = [1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0]

pares = list(zip(reales, predichas))
tp = pares.count((1, 1))   # era tenis y dijo tenis
fp = pares.count((0, 1))   # no era y dijo tenis
fn = pares.count((1, 0))   # era tenis y no lo vio
tn = pares.count((0, 0))   # no era y dijo que no

accuracy  = (tp + tn) / len(pares)
precision = tp / (tp + fp)
recall    = tp / (tp + fn)
f1        = 2 * precision * recall / (precision + recall)

print(f"TP={tp}  FP={fp}  FN={fn}  TN={tn}")
print(f"accuracy  = {accuracy:.3f}")
print(f"precision = {precision:.3f}")
print(f"recall    = {recall:.3f}")
print(f"F1        = {f1:.3f}")
```

```salida
TP=5  FP=3  FN=2  TN=10
accuracy  = 0.750
precision = 0.625
recall    = 0.714
F1        = 0.667
```

Si escribes 5, 3, 2 y 10 en la calculadora, sale lo mismo. Las librerías de ML traen estas funciones hechas, pero por dentro cuentan exactamente así.

## Muchas categorías: por clase, macro y top-k {Many classes: per class, macro and top-k}

C01 no pregunta «¿es tenis?»: elige entre 500 categorías. Su matriz de confusión es la misma idea, pero de **500 × 500**: 250,000 casillas, con los 500 aciertos en la diagonal. Nadie la lee completa: se buscan las casillas grandes fuera de la diagonal, como «botas que dijo tenis: 30», que dicen dónde se confunde el modelo y muchas veces destapan dos categorías que ni las personas distinguen bien. Y para cualquier categoría, todo lo demás se junta como «negativo» y vuelves a tener su propio 2 × 2.

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

Hasta aquí, «acertar» quería decir que la respuesta número uno del modelo era la correcta. Pero el modelo da una [[probabilidad]] para cada una de las 500 categorías, y se pueden ordenar de mayor a menor. Eso abre otra forma de medir, la [[top-k-accuracy|top-k accuracy]]:

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

¿Cuál importa? La que se parece a cómo se usa el modelo. En C01 la app le muestra a Ana **5 sugerencias** y ella elige. Por eso la métrica offline principal de C01 en la Ronda es la top-5 (*offline* quiere decir que se mide con fotos guardadas, antes de que el modelo le responda a nadie). El modelo de C01 saca ≈ 85 % de top-1 y ≈ 96 % de top-5: en nuestras 1,000 fotos, la primera sugerencia es la correcta en 850, y la correcta aparece entre las cinco en 960.

:::nota De dónde viene la top-5
La top-5 se hizo famosa con la competencia de ImageNet, un concurso anual de clasificación de fotos con 1,000 categorías que se hizo de 2010 a 2017 y la usaba como métrica principal. Con tantas categorías parecidas, a veces hasta las personas dudan entre dos o tres.
:::

## El umbral: cambiar un error por otro {The threshold: trading one error for another}

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

:::calculadora aprendio-umbral
Un modelo de juguete con 1,000 fotos, hecho para que con el umbral en 0.50 salga la matriz de la sección anterior.
:::

### Cómo se elige

En C01 el modelo no usa un umbral para decidir solo: siempre muestra sus 5 sugerencias. Pero imagina que el negocio quiere **preseleccionar** la categoría sin preguntarle a Ana. Ahí sí hace falta un umbral, y uno alto, porque preseleccionar mal es un falso positivo que Ana quizá ni note. Ese umbral se guarda en la configuración, con su versión, porque moverlo cambia lo que hace el sistema tanto como cambiar el modelo. En fraude la Ronda lo dice sin rodeos: el umbral sale del dinero, no de un F1 (la cuenta está en «En la vida real»).

Si en lugar de unos cuantos umbrales pruebas todos, sale una curva que resume al modelo completo: la [[curva-roc|curva ROC]]. Su área, el [[auc|AUC]], es un número de 0.5 (adivinar al azar) a 1 (perfecto) para comparar modelos antes de elegir umbral. Las dos están en la sección siguiente, junto con la curva que conviene cuando los positivos son rarísimos.

## Todos los umbrales a la vez: ROC, PR y mAP {All thresholds at once: ROC, PR and mAP} [extra]

Esta sección es para una segunda pasada: las curvas que resumen a un modelo en todos sus umbrales a la vez, y cómo se califica con ellas un detector de objetos.

### La curva ROC

Para cada umbral se anotan dos números:

- **Tasa de verdaderos positivos** (*TPR*): es el recall, TP / (TP + FN). De los tenis, a cuántos les dijo que sí.
- **Tasa de falsos positivos** (*FPR*): FP / (FP + TN). De los que **no** eran tenis, a cuántos les dijo que sí por error.

Con las 10 fotos: umbral 0.80 → FPR 0 / 6 = 0 % y TPR 50 %. Umbral 0.50 → FPR 1 / 6 ≈ 17 % y TPR 75 %. Umbral 0.30 → FPR 2 / 6 ≈ 33 % y TPR 100 %. Si dibujas cada umbral como un punto (la FPR a lo ancho, la TPR a lo alto) y los unes, tienes la [[curva-roc|curva ROC]].

:::figura aprendio-roc
La curva ROC de las 10 fotos. Cada escalón es un umbral distinto. La diagonal punteada es lo que haría un modelo que adivina al azar.
:::

Un modelo perfecto sube hasta arriba sin moverse a la derecha: encuentra todos los tenis sin ningún falso positivo. Uno que adivina al azar va por la diagonal. El nombre viene de los radares de la Segunda Guerra Mundial: *receiver operating characteristic*, «característica de operación del receptor». Servía para ver qué tan bien se distinguía un avión del ruido.

### AUC: la curva en un número

El área bajo la curva ROC es el [[auc|AUC]] (*area under the curve*). En la práctica va de 0.5 (al azar) a 1 (perfecto). Y tiene una lectura muy útil: **es la probabilidad de que, si tomas al azar una foto de tenis y una que no lo es, el modelo le dé más puntos a la de tenis.**

:::ejemplo El AUC de las 10 fotos, contando parejas
Hay 4 fotos de tenis y 6 que no: 4 × 6 = 24 parejas. Contamos en cuántas la de tenis tiene el número más alto:

- Foto 1 (0.95) le gana a las 6. → 6
- Foto 2 (0.85) le gana a las 6. → 6
- Foto 4 (0.60) le gana a 5; pierde contra la foto 3 (0.70). → 5
- Foto 6 (0.35) le gana a 4; pierde contra las fotos 3 y 5. → 4

Total: 6 + 6 + 5 + 4 = 21 de 24. AUC = 21 / 24 = **0.875**. Si calculas el área de los escalones de la figura, sale lo mismo: 1/6 × 0.50 + 1/6 × 0.75 + 4/6 × 1 = 0.083 + 0.125 + 0.667 = 0.875.
:::

El AUC sirve para comparar dos modelos antes de elegir umbral. Pero no te dice qué umbral usar ni cuánto vas a acertar con él: eso lo decides tú, con el costo de cada error.

### Cuando los positivos son rarísimos: la curva PR

La ROC tiene un punto ciego. Su eje horizontal, la tasa de falsos positivos, divide entre **todos** los negativos. Si los negativos son millones, miles de falsas alarmas se ven como un porcentaje chiquito.

:::cuenta Un detector de fraude que en la ROC se ve casi perfecto
Fraudes en un día de C09 // ≈ 0.08 % de 10 millones de compras | 10,000,000 × 0.0008 | 8,000
Compras buenas | 10,000,000 − 8,000 | 9,992,000
Fraudes atrapados // supón un recall de 70 % | 8,000 × 0.70 | 5,600
Compras buenas marcadas // supón una FPR de 1 % | 9,992,000 × 0.01 | 99,920
Precision | 5,600 / (5,600 + 99,920) | ≈ 5.3 %
= En la ROC es el punto (1 %, 70 %), casi pegado a la esquina buena. Pero de cada 100 compras que marca, ≈ 95 son de clientes honestos.
:::

La [[curva-pr|curva PR]] (*precision–recall*) no tiene ese punto ciego: para cada umbral dibuja el recall a lo ancho y la precision a lo alto. La precision divide entre lo que el modelo **marcó**, así que las falsas alarmas no se esconden detrás de un denominador gigante. Y la línea del azar ya no es la diagonal: un modelo que adivina tiene precision igual a la fracción de positivos, la **prevalencia**. En fraude, 0.08 %.

:::figura aprendio-pr
Un modelo de ejemplo con la prevalencia de C09: atrapa 70 % del fraude marcando 1 % de las compras buenas, como en la cuenta de arriba.
:::

Al área bajo la curva PR se le llama *average precision* (AP), o PR-AUC. En el modelo de la figura, el AUC es 0.98 y la AP, 0.29: el mismo modelo, dos historias. Con las 10 fotos de tenis la diferencia es chica (AUC 0.875 y AP ≈ 0.85), porque ahí 4 de cada 10 fotos son positivas. La regla práctica: **si los positivos son pocos, mira la curva PR** (un estudio muy citado de 2015, de Saito y Rehmsmeier, lo mostró con detalle). En la Ronda, C09 usa el AUC y la PR-AUC solo como chequeo de sanidad; para decidir mira el punto de operación: cuánto fraude atrapa y a cuántos clientes buenos molesta con el umbral que de verdad se va a usar.

### Detección: IoU y mAP

En [[deteccion|detección de objetos]] (una caja alrededor de cada persona, casco o producto) la pregunta «¿acertó?» tiene un paso más: ¿la caja del modelo cae donde está el objeto? Se mide con la [[iou|IoU]] (*intersection over union*): el área que comparten la caja del modelo y la caja real, dividida entre el área que cubren juntas.

:::figura aprendio-iou
La caja real (verde) y la del modelo (azul), corrida 20 píxeles a la derecha y 20 hacia abajo. En amarillo, lo que comparten.
:::

:::cuenta IoU de dos cajas
Caja real // la dibujó una persona | x de 40 a 140, y de 20 a 220: 100 × 200 | 20,000 px²
Caja del modelo // corrida 20 y 20 | x de 60 a 160, y de 40 a 240: 100 × 200 | 20,000 px²
Intersección // lo que comparten | x de 60 a 140, y de 40 a 220: 80 × 180 | 14,400 px²
Unión // todo lo que cubre alguna | 20,000 + 20,000 − 14,400 | 25,600 px²
IoU | 14,400 / 25,600 | 0.5625
= IoU ≈ 0.56. Va de 0 (no se tocan) a 1 (idénticas).
:::

La regla clásica dice que una caja es acierto si su IoU con una caja real es **0.5 o más**. Fíjate en lo exigente que es: la caja quedó corrida 20 píxeles de 100 de ancho y apenas pasa. Y castiga los dos errores: una caja corrida comparte menos, y una caja demasiado grande agranda la unión aunque cubra todo el objeto.

:::calculadora aprendio-iou
Con los valores iniciales sale la cuenta de arriba.
:::

Con esa regla, cada caja del modelo es un acierto (TP) o una falsa alarma (FP), y cada objeto que nadie encontró es un FN. ¿Y los verdaderos negativos? No existen: en una foto hay infinitas cajas vacías posibles. Sin TN no hay tasa de falsos positivos ni curva ROC, así que la detección vive en la curva PR.

La calificación más usada de un detector es el [[map|mAP]] (*mean average precision*). Se ordenan todas las cajas del modelo por confianza, se recorre la lista anotando precision y recall, y el área bajo esa curva PR es la AP de la clase. El mAP es el promedio de las AP de todas las clases. La versión de COCO, un conjunto de fotos de referencia muy usado, es más estricta: repite la cuenta con 10 mínimos de IoU, de 0.50 a 0.95, y los promedia.

:::profundo La AP con cinco cajas
Una clase, «persona», con 3 personas reales en las fotos. El modelo dio 5 cajas; ordenadas por confianza resultan: acierto, acierto, falsa alarma, acierto, falsa alarma.

| Caja | ¿Acierto? | Precision acumulada | Recall acumulado |
|---|---|---|---|
| 1 | sí | 1 / 1 = 1.00 | 1 / 3 |
| 2 | sí | 2 / 2 = 1.00 | 2 / 3 |
| 3 | no | 2 / 3 ≈ 0.67 | 2 / 3 |
| 4 | sí | 3 / 4 = 0.75 | 3 / 3 |
| 5 | no | 3 / 5 = 0.60 | 3 / 3 |

El recall sube en tres escalones de 1/3 (cajas 1, 2 y 4), y en cada uno la precision es 1.00, 1.00 y 0.75. El área: (1 + 1 + 0.75) / 3 ≈ **0.92**. Si otra clase saca AP de 0.70, el mAP de las dos es (0.92 + 0.70) / 2 ≈ 0.81. Las librerías tienen variantes de esta cuenta; la idea es la misma.
:::

En la Ronda, el caso de cámaras de seguridad (C02) lo dice claro: el mAP por frame «se reporta, no decide». Lo que se exige es que cada intrusión real produzca una alerta (un recall por evento de 95 % o más): una persona que cruza durante 4 segundos aparece en 20 frames, y perderla en algunos casi no importa, pero perderla en todos sí. La IoU aparece en otro lugar del mismo caso: para revisar que el modelo optimizado que corre en el sitio dé las mismas cajas que el original, C02 pide que al menos 99 % de las detecciones coincidan con IoU ≥ 0.5.

## Calibración: ¿el 90 % es 90 %? {Calibration: is 90 % really 90 %?} [extra]

Cuando el modelo dice «Tenis, 90 %», ¿qué quiere decir ese 90 %? Lo que uno esperaría: que de todas las veces que dice 90 %, acierta 90 de cada 100. Cuando eso se cumple, el modelo está bien calibrado. A eso se le llama [[calibracion|calibración]], y ya la viste de pasada en «Qué es un modelo». Esta sección, para una segunda pasada, la mide y la corrige.

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
:::

:::figura aprendio-confiabilidad
La misma tabla, dibujada. Si el modelo estuviera bien calibrado, sus puntos caerían sobre la diagonal. A esta gráfica se le llama diagrama de confiabilidad (*reliability diagram*).
:::

### ECE: la calibración en un número

Para resumir la tabla en un número se usa el [[ece|ECE]] (*expected calibration error*, error de calibración esperado): la distancia entre lo que dijo y lo que acertó en cada grupo, promediada y pesada por la fracción de fotos del grupo. El primer grupo tiene 100 de 1,000 fotos, así que pesa 0.10.

:::cuenta El ECE de las 1,000 fotos
Grupo de 50 % // 100 de 1,000 fotos | 0.10 × (0.50 − 0.45) | 0.005
Grupo de 70 % // 100 de 1,000 fotos | 0.10 × (0.70 − 0.64) | 0.006
Grupo de 90 % // 300 de 1,000 fotos | 0.30 × (0.90 − 0.82) | 0.024
Grupo de 99 % // 500 de 1,000 fotos | 0.50 × (0.99 − 0.99) | 0
ECE | 0.005 + 0.006 + 0.024 + 0 | 0.035
= ECE = 0.035: en promedio, la seguridad del modelo se aleja 3.5 puntos de lo que acierta.
:::

Aquí todas las diferencias salen positivas porque el modelo exagera. Si en un grupo dijera menos de lo que acierta, la distancia cuenta igual: se suma sin signo.

¿Por qué le importa esto a producción? Porque en C01 el número **se usa**: ordena las sugerencias, y si un día hay un umbral para preseleccionar, ese umbral solo tiene sentido si «90 %» quiere decir 90 %. Por eso el examen de C01 en la Ronda pide un ECE de 0.05 o menos. Este modelo pasaría (0.035), aunque el grupo del 90 % muestra dónde exagera: un promedio que pasa puede esconder un grupo que no. En fraude (C09) es más directo todavía: el umbral se calcula con la probabilidad, así que si «5 %» no es 5 %, la cuenta se descompone.

### Temperature scaling: un solo número

Cuando un modelo está mal calibrado hay arreglos baratos que no tocan lo que aprendió. El más común es el [[temperature-scaling|temperature scaling]]: dividir todos los [[logit|logits]] entre un mismo número T antes del [[softmax]]. Es la misma [[temperatura]] que vas a ver en los LLMs, usada para otra cosa. Con T mayor que 1, las probabilidades se aplanan y el modelo dice estar menos seguro.

:::ejemplo La misma foto con T = 1.5
Logits 3, 1 y 0 (tenis, botas y sandalias). Sin temperatura, el softmax da 84.4 %, 11.4 % y 4.2 %. Dividiendo entre 1.5 quedan 2, 0.67 y 0: e² ≈ 7.39, e^0.67 ≈ 1.95 y e⁰ = 1, que suman 10.34. Ahora: 7.39 / 10.34 ≈ **71.5 %**, 1.95 / 10.34 ≈ 18.8 % y 1 / 10.34 ≈ 9.7 %.

Tenis sigue primero. Solo bajó su seguridad, de 84 % a 71 %.
:::

¿Cuál T? Uno solo para todo el modelo, elegido con el set de validación: el que deja las probabilidades más honestas, por ejemplo el que hace más baja la pérdida de validación. Como dividir entre un número positivo no cambia cuál logit es más grande, **la top-1 y la top-5 no se mueven**; solo cambia qué tan seguro dice estar. Por eso el gate de C01 pide ECE ≤ 0.05 **después** de temperature scaling: es un ajuste casi gratis que se hace siempre.

:::profundo Elegir T con cinco fotos, en Python
Cinco fotos de validación con dos clases. En las cinco, el logit de la favorita le gana por 4 al de la otra, así que el modelo dice 98 % en todas; acertó en 4 de 5, o sea 80 %. Probamos varios T y medimos la pérdida de validación: el promedio de −ln de la probabilidad que le dio a la respuesta correcta, la misma [[entropia-cruzada|entropía cruzada]] del entrenamiento.

```python
import math

# 5 fotos de validación. En las cinco, el logit de la clase favorita le gana
# por 4 al de la otra clase (supón solo dos clases). Acertó en 4 de las 5.
diferencia = 4.0
acierto = [True, True, True, True, False]

def seguridad(T):              # softmax de dos clases con temperatura T
    return 1 / (1 + math.exp(-diferencia / T))

def perdida(T):                # pérdida de validación: −ln de lo que le dio a la verdad
    p = seguridad(T)
    return sum(-math.log(p if a else 1 - p) for a in acierto) / len(acierto)

for T in [1.0, 2.0, 2.9, 4.0]:
    print(f"T = {T}: dice {seguridad(T):.0%}, pérdida {perdida(T):.3f}")

mejor = min((perdida(t / 10), t / 10) for t in range(5, 101))
print(f"Mejor T entre 0.5 y 10: {mejor[1]} (dice {seguridad(mejor[1]):.0%})")
```

```salida
T = 1.0: dice 98%, pérdida 0.818
T = 2.0: dice 88%, pérdida 0.527
T = 2.9: dice 80%, pérdida 0.500
T = 4.0: dice 73%, pérdida 0.513
Mejor T entre 0.5 y 10: 2.9 (dice 80%)
```

La pérdida más baja sale con T ≈ 2.9, y con ese T el modelo dice 80 %: justo lo que acierta. Nadie le dijo que buscara el 80 %; la pérdida lo empuja ahí sola, porque castiga tanto la seguridad de más como la de menos.
:::

## El examen completo: del golden set a la gente {The full evaluation: from the golden set to people}

Ahora junta todo. Antes de que un modelo nuevo reemplace al que está en producción, pasa por un examen automático que en la Ronda se llama *gate de evaluación* (la compuerta). Ya tienes todas sus piezas:

:::diagrama aprendio-examen
Cómo decide un examen si el modelo nuevo es suficientemente bueno. Toca cada caja para ver por qué está ahí.
:::

:::pasos
1. Se compara contra el modelo actual, con las mismas fotos
No basta con que el nuevo saque «85 %». Tiene que no ser peor que el que ya está, en el mismo golden set y en los mismos grupos de fotos.
2. Las reglas se escriben antes de entrenar
Qué métricas y con qué límite. Si se decide después de ver los resultados, siempre aparece una excusa para aprobar.
3. Ningún número solo basta
Una top-5 alta con el long tail roto, con un slice roto o con la seguridad inflada, no pasa.
:::

Los slices del gate son grupos de fotos, y detrás de un grupo de fotos muchas veces hay un grupo de personas: en la lección de datos viste que las fotos con poca luz suelen venir de celulares baratos. Cuando el modelo decide algo **sobre personas** (un crédito, una contratación, una identificación), medir las mismas métricas por grupo de personas es obligatorio y tiene nombre: [[equidad]] (*fairness*). Que el modelo no le falle mucho más a un grupo que a otro. El caso real más famoso está en «En la vida real».

### La métrica del modelo no es la del negocio

Nadie en la empresa quiere «top-5 alta» por sí misma. C01 existe para que más gente termine de publicar. Ese número, el que dice si el sistema le sirve a la empresa y a la gente, es la [[metrica-negocio|métrica de negocio]]. Entre ella y el golden set hay una cadena:

| Nivel | En C01 | Cuándo se puede medir |
|---|---|---|
| Offline: el modelo | Top-5 accuracy en el golden set | Antes de que nadie lo use, en minutos |
| Online: el producto | Tasa de aceptación: qué fracción de vendedores publica con una de las 5 sugerencias | Con vendedores reales, en días |
| Negocio | Tasa de publicaciones completadas | Con vendedores reales, en semanas |

Cada nivel es una aproximación (un *proxy*) del de arriba: se mide el de abajo porque es más rápido y más barato. Además hay *guardrails*: métricas que no tienen que mejorar, pero no pueden empeorar. En C01 son el p99 de latencia, el porcentaje de publicaciones que moderación recategoriza y el tiempo para llenar el formulario.

:::diagrama aprendio-cadena
La cadena de métricas de C01, del golden set al negocio. Prueba los dos recorridos: cuando la cadena se cumple y cuando se rompe.
:::

La cadena se puede romper. La Ronda (M11) trae un ejemplo con los números de C01: un modelo nuevo gana **1.5 puntos de top-5** en el golden set, y en un A/B de dos semanas la tasa de aceptación **baja 0.4 puntos**. Hay tres razones y ninguna es un bug: ganó en los lugares 4 y 5 de la lista y perdió un poco en el 1, que es el que la gente elige; el golden set tenía 8 meses y la ganancia estaba en categorías que hoy casi no se usan, y el modelo era más pesado, así que en el pico más vendedores se quedaban sin sugerencias a tiempo.

:::ojo
Pasar el examen offline no prueba que el modelo funcione con gente real. El golden set es una foto del pasado y, con el [[drift]], el mundo se va alejando de él. Por eso, después del gate, el modelo nuevo primero recibe una copia de las fotos sin que nadie vea sus respuestas (*shadow*), luego responde de verdad a una parte chica del tráfico (*canary*) y, si el cambio es grande, pasa por un [[ab-test|A/B test]] sobre la tasa de aceptación. Y el [[monitoreo]] sigue midiendo. Eso lo verás en las estaciones de Orquestación y Monitoreo.
:::

En fraude (C09) la cadena es más corta, porque la métrica de negocio es dinero: lo que se pierde por fraude contra lo que cuesta molestar a clientes buenos. La cuenta completa está en «En la vida real».

## Errores comunes {Common mistakes}

**1. Creerle a la accuracy cuando una clase domina.** Con 0.08 % de fraude, no hacer nada saca 99.92 %. *Cómo evitarlo:* compara siempre contra el baseline de decir la clase más común, y mira la matriz de confusión y el recall de la clase rara.

**2. Medir con datos que el modelo ya vio.** Copias de la misma foto, el mismo vendedor en los dos lados, datos del futuro: el número sale bonito y es mentira. *Cómo evitarlo:* quita copias antes de repartir, reparte por vendedor y por tiempo, y nunca entrenes con el golden set.

**3. Decidir con el examen final.** Si miras el test, cambias algo y lo vuelves a mirar, el test se volvió validación. *Cómo evitarlo:* decide con validación (o con validación cruzada si hay pocos datos), usa el test una sola vez y escribe las reglas del gate antes de entrenar.

**4. Llamar «mejora» a una diferencia más chica que el ruido.** Con 50 fotos de examen, el resultado se mueve ±10 puntos por pura suerte; con 50,000, ±0.3. *Cómo evitarlo:* estima el ruido antes de celebrar y compara los dos modelos en las mismas fotos, foto por foto o vuelta por vuelta.

**5. Dejar el umbral en 0.5 «porque sí».** El 0.5 no sale de ningún lado. *Cómo evitarlo:* elígelo en validación con el costo de cada error, guárdalo con la versión del modelo y revísalo cada vez que el modelo cambie, porque cada versión reparte su seguridad distinto.

**6. Leer la confianza como si fuera una probabilidad honesta.** Las redes modernas tienden a decir «90 %» cuando aciertan menos. *Cómo evitarlo:* mide el ECE, mira también la tabla por grupos de confianza y corrige con temperature scaling antes de usar el número para decidir.

**7. Quedarse con un solo número.** Una accuracy que sube puede esconder 300 categorías que empeoraron o un grupo de personas al que el modelo le falla, y una top-5 que sube puede bajar la aceptación. *Cómo evitarlo:* mide por clase, por slice y por grupo, y deja la última palabra a la métrica online y a la de negocio.

## En la vida real {In real life} [extra]

### C01: el examen de cada mes

Cada mes sale un modelo nuevo de C01. Antes de que Ana lo vea, el gate lo compara contra el actual en las 50,000 fotos del golden set: top-1 y top-5 que no pueden bajar más de 0.3 puntos, el recall de las 100 categorías con más tráfico, el macro-recall del long tail, los slices (celular, web, poca luz, imágenes chicas) y un ECE de 0.05 o menos después de temperature scaling. Si pasa, sigue el camino de la gente real: shadow, canary y, si el cambio es grande, un A/B sobre la tasa de aceptación, con sus guardrails.

### C09: el fraude se mide en dinero

La meta de C09 es bajar las pérdidas por fraude ≈ 40 % sin rechazar a más clientes buenos. Con los costos que supone la Ronda, el umbral sale de una cuenta:

:::cuenta El umbral que sale del dinero
Costo de un fraude que pasa // el monto promedio más comisiones | US$45 + US$15 | US$60
Costo de rechazar a un cliente bueno // la Ronda supone US$5–10 | punto medio | US$7.5
Marcar conviene si // p = probabilidad de fraude | p × 60 > (1 − p) × 7.5 | p > 7.5 / 67.5
Umbral sobre la probabilidad | 7.5 / 67.5 | ≈ 0.11
= Marcar una compra conviene cuando el modelo le da más de ≈ 11 % de ser fraude. Con un rechazo de US$5, el umbral baja a ≈ 0.08; con US$10, sube a ≈ 0.14.
:::

La cuenta usa la probabilidad del modelo como si fuera verdad, así que solo funciona si el modelo está calibrado. Y no es «el umbral que da el mejor F1»: la Ronda lo resume así, el umbral sale de dinero. C09 además cuenta el recall en dólares. En una cohorte con 1,000 fraudes que suman US$45,000, el modelo A atrapa 700 (70 %) que suman US$22,500 (50 % del dinero), y el B atrapa 600 (60 %) que suman US$33,750 (75 %). Por conteo gana A; en dinero, B evita US$11,250 más.

### Equidad: cuando el grupo son personas

El caso más famoso es de 2018. Un estudio («Gender Shades», de Buolamwini y Gebru) probó tres sistemas comerciales que adivinaban el género en fotos de caras: se equivocaban en no más de 0.8 % de los hombres de piel clara y hasta en 34.7 % de las mujeres de piel oscura. Las colecciones de fotos con que se solían evaluar tenían sobre todo caras de piel clara, así que el promedio no lo mostraba.

Antes de medir se decide qué error importa igualar: el recall (que a nadie se le escapen más los casos reales), los falsos positivos (que a nadie se le acuse más en falso) o la precision. Cuando los grupos tienen proporciones distintas de casos reales no se pueden igualar todas a la vez (lo ves con números en el último ejercicio), así que elegir es una decisión de personas, no del modelo. En la Ronda, M10 pone la equidad en el gate «donde aplica»; en C01 no aplica así, porque el modelo no decide sobre nadie, y en C03, donde las cámaras graban a trabajadores para revisar su equipo de protección, manda la privacidad: las métricas se sacan por zona y turno, nunca por persona.

### C02 y C03: eventos y defectos

En las cámaras de seguridad (C02), el mAP sirve para depurar el detector, pero el sistema se califica por evento. En la planta de C03, la inspección de piezas pide un recall de 99.5 % o más **por tipo** de defecto, no en promedio: una fisura que se escapa no la compensa una rebaba bien detectada, y un defecto que pasa cuesta miles de dólares mientras que una falsa alarma cuesta centavos.

### Fuera de ML: las pruebas médicas

Medicina usa las mismas ideas con otros nombres: la **sensibilidad** es el recall; la **especificidad** es la fracción de sanos que salen negativos, y el **valor predictivo positivo** es la precision. Con números de ejemplo: de 10,000 personas, 1 % están enfermas (100). Una prueba con sensibilidad de 90 % y especificidad de 95 % encuentra a 90 enfermos, pero también marca al 5 % de las 9,900 sanas: 495. De 585 positivos, solo 90 están enfermos: **15 %**. Es el mismo problema del fraude, y por eso un positivo en una prueba de detección se confirma con otra prueba.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Un filtro de spam revisa 1,000 correos, de los cuales 200 son spam. Mandó a la carpeta de spam 180 de esos 200, y además 30 correos buenos. Arma la matriz de confusión y calcula accuracy, precision y recall.
Positivo = spam: TP = 180, FN = 200 − 180 = 20, FP = 30 y TN = 800 − 30 = 770.

- Accuracy = (180 + 770) / 1,000 = **95 %**.
- Precision = 180 / (180 + 30) = 180 / 210 ≈ **85.7 %**.
- Recall = 180 / 200 = **90 %**.

Aquí el error que más duele es el falso positivo: un correo importante perdido en spam.
? [facil] En una red social, 0.5 % de las publicaciones violan las reglas. ¿Qué accuracy y qué recall saca un «modelo» que siempre dice «está bien»?
Acierta en todas las que están bien: **99.5 %** de accuracy. Su recall es **0 %**: no encuentra ni una. La Ronda usa este número en el caso de moderación (C06) para decir que ahí la accuracy nunca es el requisito.
? [facil] La caja real va de x = 0 a 10 y de y = 0 a 10. La del modelo, de x = 2 a 12 y de y = 2 a 12. ¿Cuánto vale la IoU? ¿Cuenta como acierto con la regla de 0.5?
Intersección: de 2 a 10 en x y en y, 8 × 8 = 64. Unión: 100 + 100 − 64 = 136. IoU = 64 / 136 ≈ **0.47**: no pasa. Corrida solo 2 unidades en cada dirección (20 % del lado), ya no cuenta como acierto.
? [facil] Para tres fotos, la categoría correcta quedó en el lugar 1, en el 4 y en el 7 de la lista del modelo. ¿Cuánto vale la top-1 y cuánto la top-5 en esas tres fotos?
Top-1: solo la primera tiene la correcta en el lugar 1: 1 de 3 ≈ **33 %**. Top-5: los lugares 1 y 4 están entre los 5 primeros y el 7 no: 2 de 3 ≈ **67 %**.
? [medio] Un modelo da los logits 2, 1 y 0. Calcula sus probabilidades con softmax, y luego con temperature scaling de T = 2. ¿Cambia la clase de arriba?
Sin temperatura: e² ≈ 7.389, e¹ ≈ 2.718 y e⁰ = 1, que suman 11.107. Probabilidades: ≈ **66.5 %**, 24.5 % y 9.0 %.

Con T = 2 los logits quedan 1, 0.5 y 0: 2.718, 1.649 y 1, que suman 5.367. Probabilidades: ≈ **50.6 %**, 30.7 % y 18.6 % (redondeadas).

La clase de arriba es la misma; solo bajó su seguridad. Por eso el temperature scaling no mueve la top-1 ni la top-5.
? [medio] Un modelo dijo ≈ 60 % en 200 fotos y acertó 130; ≈ 80 % en 300 y acertó 225, y ≈ 95 % en 500 y acertó 460. Calcula el ECE. ¿Pasa el límite de 0.05 de C01?
Aciertos por grupo: 130 / 200 = 65 %, 225 / 300 = 75 % y 460 / 500 = 92 %.

- 60 %: pesa 0.2 y la distancia es 0.05 (aquí dijo **menos** de lo que acierta; cuenta igual) → 0.010.
- 80 %: pesa 0.3 y la distancia es 0.05 → 0.015.
- 95 %: pesa 0.5 y la distancia es 0.03 → 0.015.

ECE = 0.010 + 0.015 + 0.015 = **0.040**. Pasa, por poco.
? [medio] Comparas dos recetas con validación cruzada de 5 vueltas y los mismos grupos. La A saca 86, 92, 80, 84 y 88 %. En el caso 1, la B saca 88, 93, 81, 85 y 90 %. En el caso 2, la B saca 95, 85, 78, 90 y 89 %. ¿En cuál confías más en que B es mejor?
En los dos casos B promedia 437 / 5 = **87.4 %**, contra 86 % de A. Pero vuelta por vuelta:

- Caso 1: +2, +1, +1, +1 y +2. B gana en las 5.
- Caso 2: +9, −7, −2, +6 y +1. B gana en 3 y pierde en 2.

Confías más en el caso 1: B gana siempre, aunque sea por poco. En el caso 2, el mismo promedio sale de diferencias que van y vienen, y puede ser suerte.
? [reto] Fraude con los costos de C09: en 1,000,000 de compras hay 800 fraudes; un fraude que pasa cuesta US$60 y rechazar a un cliente bueno, US$7.5. Con el umbral bajo, el modelo atrapa 560 fraudes y marca 9,992 compras buenas; con el alto, atrapa 320 y marca 999. Compara el costo de los dos umbrales contra no tener modelo.
- Sin modelo pasan los 800 fraudes: 800 × 60 = **US$48,000**.
- Umbral bajo: pasan 240 fraudes (US$14,400) y se rechazan 9,992 buenas (9,992 × 7.5 = US$74,940). Total: **US$89,340**, casi el doble que no hacer nada.
- Umbral alto: pasan 480 fraudes (US$28,800) y se rechazan 999 buenas (US$7,492.50). Total: **US$36,292.50**, ≈ US$11,700 menos que sin modelo.

La precision lo explica: 560 / 10,552 ≈ 5.3 % con el bajo y 320 / 1,319 ≈ 24.3 % con el alto. El umbral que atrapa más fraude pierde dinero.
? [reto] Un modelo de crédito marca a quién va a dejar de pagar («sí» = no va a pagar). Se evalúa en dos grupos de 1,000 personas: en el A, 300 dejarían de pagar; en el B, 100. En los dos grupos tiene recall de 80 % y tasa de falsos positivos de 10 %. Calcula la precision en cada grupo. ¿Es equitativo?
- Grupo A: TP = 300 × 0.80 = 240; FP = 700 × 0.10 = 70. Precision = 240 / 310 ≈ **77.4 %**.
- Grupo B: TP = 100 × 0.80 = 80; FP = 900 × 0.10 = 90. Precision = 80 / 170 ≈ **47.1 %**.

Depende de qué quieras igualar. Por errores por persona, trata igual a los dos grupos: encuentra al mismo 80 % y acusa en falso al mismo 10 %. Por lo que significa un «sí», no: en el grupo B, más de la mitad de los rechazados (90 de 170) sí iba a pagar. Con proporciones distintas de casos reales (30 % contra 10 %) no se pueden igualar las tres cosas a la vez; cuál importa más lo decide la gente que responde por el sistema.
:::

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M01 · El mapa y la entrevista** pide bajar el objetivo por la cadena de métricas: negocio (publicaciones completadas) → online (tasa de aceptación) → offline (top-5 en el golden set), con uno o dos guardrails, y decir qué error duele más, porque eso fija precision contra recall y el umbral.
- **M10 · MLOps** arma el gate de C01: top-1 y top-5 comparados foto por foto contra el modelo actual con un margen de 0.3 puntos, el recall de las 100 categorías con más tráfico, el macro-recall del long tail, ECE ≤ 0.05 después de temperature scaling, los slices y la equidad donde aplica. También guarda la curva de validación por época y la matriz de confusión de cada entrenamiento.
- **M11 · Despliegue** es lo que pasa después del gate: shadow, canary y A/B sobre la tasa de aceptación, y todas las causas de la brecha entre offline y online.
- **M12 · Monitoreo** entrena un clasificador que intenta distinguir las fotos de hoy de las de referencia: si su AUC es ≈ 0.5, no las distingue y no hay drift.
- **Los casos.** C06 y C09 son donde la accuracy miente más; C09 elige el umbral con dinero. C02 y C03 califican por evento y por tipo de defecto. C14 hace validación cruzada en el tiempo con su backtest.
- **El Dojo y lo que sigue.** La estación 4 del Dojo, «Gate de evaluación y registry», arma este examen (todavía no está lista). En Sensei siguen «Redes neuronales y CNNs», «Ruido, muestras y pruebas A/B» (intervalos y A/B) y «Comparar distribuciones» (cómo se mide el drift).

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
generalizacion overfitting underfitting curva-aprendizaje bias-variance validacion-cruzada accuracy matriz-confusion falso-positivo falso-negativo precision recall f1 macro-promedio top-k-accuracy curva-roc auc curva-pr iou map calibracion ece temperature-scaling metrica-negocio equidad
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? La loss de entrenamiento sigue bajando, pero la de validación lleva cinco épocas subiendo. ¿Qué pasa y qué haces?
Overfitting: el modelo empezó a memorizar. Te quedas con el checkpoint de la época con la validación más baja (early stopping) y, para el siguiente entrenamiento, consideras más datos, augmentation o más trabas contra la memoria.
? Un detector de fraude tiene 99 % de accuracy. ¿Es bueno?
No se sabe. Si el 1 % de las compras son fraude, un modelo que siempre dice «no es fraude» también saca 99 %. Hay que ver la matriz de confusión, el recall del fraude y la precision.
? De 100 tenis, el modelo encontró 80, y en total dijo «tenis» 120 veces. ¿Cuánto valen la precision y el recall?
Recall = 80 / 100 = 80 %. Precision = 80 / 120 ≈ 66.7 %. Los 40 que sobran son falsos positivos.
? Subes el umbral de 0.5 a 0.7. ¿Qué les pasa a la precision y al recall?
La precision sube y el recall baja: el modelo dice «sí» menos veces, se equivoca menos cuando lo dice y se le escapan más casos. En la calculadora del umbral, la precision pasa de 66.7 % a 93 % y el recall baja de 80 % a 56 %.
? Un modelo nuevo sube la accuracy de 85.0 % a 85.25 %, pero el macro-recall baja de 75 % a 64 %. ¿Qué pasó?
Mejoró un poco en las categorías grandes, que tienen casi todas las fotos, y empeoró mucho en las chicas. La accuracy cuenta fotos; el macro-recall cuenta categorías. En C01 no se aprueba.
? El modelo dijo ≈ 90 % en 300 fotos y acertó en 246. ¿Está bien calibrado?
No del todo: 246 / 300 = 82 %, no 90 %. En ese rango es demasiado confiado. Se corrige con temperature scaling, que no cambia qué categoría queda primero.
? Un modelo nuevo gana 1.5 puntos de top-5 en el golden set, pero en el A/B la tasa de aceptación baja. ¿Cómo puede ser?
La top-5 es solo un proxy de lo que hace la gente. Puede ganar en lugares de la lista que nadie mira, en categorías que hoy casi no se usan, o ser más lento y dejar a más vendedores sin sugerencias a tiempo. La última palabra la tiene la métrica online.
:::
