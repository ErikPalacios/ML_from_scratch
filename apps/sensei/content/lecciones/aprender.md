---
titulo: Cómo aprende un modelo
en: How a model learns
subtitulo: La pérdida, el gradiente y el ciclo que gira millones de perillas un poquito a la vez hasta que el modelo se equivoca menos.
pregunta: Cuando alguien dice que un modelo «está entrenando», ¿qué está pasando, paso a paso?
minutos: 35
requisitos: ejemplos
---

:::idea
Entrenar es repetir un ciclo: el modelo adivina, un número mide qué tan mal le fue (la pérdida), se calcula hacia dónde girar cada perilla para que le vaya un poco menos mal (el gradiente) y se giran todas un poquito. Cientos de miles de veces.
:::

## La pérdida: qué tan mal le fue, en un número {Loss: how wrong, in one number}

Para mejorar algo necesitas medirlo. Para entrenar un modelo hace falta un solo número que diga **qué tan equivocado está**: mientras más bajo, mejor, y 0 si es perfecto. Ese número es la [[loss|pérdida]] (*loss*), y la fórmula que lo calcula se llama función de pérdida. Entrenar es, literalmente, hacer que la pérdida baje.

### La entropía cruzada, para un ejemplo

En una [[clasificacion|clasificación]] como C01, el modelo no da una sola respuesta: da una [[probabilidad]] para cada una de las 500 categorías, y suman 100 %. La pérdida más usada se llama **entropía cruzada** (*cross-entropy*) y funciona así:

1. Mira solo la probabilidad que el modelo le dio a la **respuesta correcta**. Llámala p.
2. La pérdida es −ln(p).

«ln» es el logaritmo natural, la tecla «ln» de la calculadora. No necesitas saber más que dos cosas: ln(1) = 0, y mientras p se hace más chica, −ln(p) se hace más grande, sin tope.

:::ejemplo La foto de Ana, con dos modelos
La foto es de unos tenis.

- El modelo A le da 94 % a «Calzado › Tenis»: pérdida = −ln(0.94) ≈ **0.062**.
- El modelo B le da solo 10 % a «Calzado › Tenis» (y 85 % a «Botas»): pérdida = −ln(0.10) ≈ **2.30**.

El modelo B tiene una pérdida 37 veces más grande (2.30 ÷ 0.062 ≈ 37). La fórmula casi no castiga al que acierta con seguridad, y castiga mucho al que está seguro de otra cosa.
:::

:::figura aprender-perdida
Cuando la probabilidad de la respuesta correcta se acerca a 100 %, la pérdida se acerca a 0. Cuando se acerca a 0 %, la pérdida se dispara.
:::

| Probabilidad de la respuesta correcta | Pérdida, −ln(p) | Qué quiere decir |
|---|---|---|
| 100 % | 0 | Perfecto, y seguro |
| 94 % | 0.062 | Muy bien |
| 50 % | 0.693 | Duda entre dos |
| 10 % | 2.303 | Casi seguro de otra cosa |
| 1 % | 4.605 | Muy seguro de otra cosa |
| 1 de 500 (0.2 %) | 6.215 | Como tirar un dado de 500 caras |

Esa última fila sirve en la práctica. Un modelo que todavía no sabe nada reparte parejo, 1 entre 500 para cada categoría, y su pérdida es −ln(1/500) = ln(500) ≈ 6.21. Si empiezas a entrenar un modelo nuevo de 500 categorías y la pérdida arranca cerca de 6.2, todo va normal. Si arranca en 50, algo está roto.

### Por qué no basta con contar aciertos

¿Por qué no usar simplemente «porcentaje de aciertos»? Porque casi no se mueve con cambios pequeños. Imagina que el modelo le da 40 % a «Tenis» y 45 % a «Botas»: se equivoca. Le giras un poquito una perilla y ahora da 41 % a «Tenis»: se sigue equivocando, y el porcentaje de aciertos no cambió. Pero la pérdida sí bajó, de −ln(0.40) ≈ 0.92 a −ln(0.41) ≈ 0.89. La pérdida dice «vas mejor» antes de que el modelo acierte. Esa es justo la señal que hace falta para saber hacia dónde girar.

### Para un grupo de fotos: el promedio

Al entrenar no se mira una foto a la vez sino un grupo, y la pérdida del grupo es el promedio.

:::ejemplo Cuatro fotos
El modelo le dio a la respuesta correcta de cada foto 94 %, 80 %, 30 % y 5 %:

- −ln(0.94) ≈ 0.062
- −ln(0.80) ≈ 0.223
- −ln(0.30) ≈ 1.204
- −ln(0.05) ≈ 2.996

Suma: 4.485. Promedio: 4.485 ÷ 4 ≈ **1.12**. La foto del 5 % aporta 2.996 de los 4.485, dos terceras partes del total: la pérdida se fija sobre todo en lo que peor va.
:::

:::nota ¿De dónde salen esas probabilidades?
El modelo, por dentro, produce un número cualquiera para cada categoría (un [[logit]]), y una función llamada [[softmax]] los convierte en probabilidades que suman 100 %. Lo viste en la lección «Qué es un modelo». Y no todas las tareas usan entropía cruzada: si el modelo predice un número, como un precio, una pérdida común es el error al cuadrado, (predicción − respuesta)². La vas a usar en la sección siguiente.
:::

## El gradiente: hacia dónde girar cada perilla {The gradient: which way to turn each knob}

La pérdida depende de las perillas del modelo, sus [[parametro|parámetros]]. Si mueves una perilla, la pérdida cambia. La pregunta clave del entrenamiento es: **si muevo esta perilla un poquito, ¿la pérdida sube o baja, y cuánto?** La respuesta, para todas las perillas a la vez, es el [[gradiente]].

Veámoslo con un modelo de juguete que tiene **una sola perilla**.

:::ejemplo Un modelo de una perilla
- El modelo multiplica su entrada por la perilla w: predicción = w × entrada.
- Tenemos un solo ejemplo: entrada 2, respuesta correcta 6.
- Pérdida: el error al cuadrado, (predicción − 6)².

Con w = 0 la predicción es 0 × 2 = 0, el error es 0 − 6 = −6 y la pérdida es (−6)² = **36**.

**Medir la pendiente a mano.** Movamos la perilla un poquito, de 0 a 0.01:

- Predicción: 0.01 × 2 = 0.02.
- Error: 0.02 − 6 = −5.98.
- Pérdida: (−5.98)² = 35.7604.

La pérdida bajó 36 − 35.7604 = 0.2396 por mover la perilla 0.01. Por cada unidad, eso es 0.2396 ÷ 0.01 ≈ 23.96, y como bajó, se escribe con signo menos: la pendiente es ≈ **−24**.
:::

Ese −24 es el gradiente de la perilla w en el punto w = 0. Se lee en dos partes:

- **El signo dice la dirección.** Negativo quiere decir que si subes la perilla, la pérdida baja. Así que hay que subirla. La regla general: mover cada perilla **en contra** de su gradiente.
- **El tamaño dice qué tan empinado está.** 24 es mucho: cerca de aquí, cualquier cambio de la perilla mueve mucho la pérdida.

Para este modelo, hay una fórmula que da la pendiente exacta sin tener que mover nada: 2 × error × entrada = 2 × (−6) × 2 = −24. Sale de una herramienta del cálculo, la derivada, pero no la necesitas para seguir esta lección: basta con la idea de «mueve un poquito y mira qué pasa».

### Con 24.5 millones de perillas

La ResNet-50 de C01 tiene unos 24.5 millones de perillas. Su gradiente es una lista de 24.5 millones de números: uno por perilla, cada uno diciendo hacia dónde girarla y qué tan fuerte. Medirlo «a mano», moviendo cada perilla por separado, exigiría pasar las fotos por el modelo 24.5 millones de veces **para un solo paso**. Imposible. En la sección de backpropagation verás cómo se calcula todo el gradiente de una vez.

:::analogia Bajar un cerro con niebla
Estás en un cerro con una niebla tan espesa que no ves el valle. Lo único que sientes es la inclinación del suelo bajo tus pies. Para bajar, das un paso hacia donde el suelo baja, vuelves a sentir y das otro. Tu posición son las perillas, la altura es la pérdida y la inclinación es el gradiente.

**Dónde se rompe la analogía.** El cerro de un modelo no tiene dos direcciones (norte y este) sino 24.5 millones. Además, el suelo cambia un poco con cada paso, porque cada vez se mide con fotos distintas, y la inclinación que sientes es solo una estimación. Y puedes acabar en un hoyo que no es el más bajo de todos; con redes grandes, en la práctica eso preocupa menos de lo que parece.
:::

## Descenso de gradiente y learning rate {Gradient descent and the learning rate}

Con el gradiente en la mano, la regla para mejorar es simple y se llama [[descenso-gradiente|descenso de gradiente]] (*gradient descent*):

> perilla nueva = perilla − learning rate × gradiente

El [[learning-rate|learning rate]] (tasa de aprendizaje, o *lr*) es un número chico que decide **qué tan grande es cada paso**. El signo menos es el «en contra»: si el gradiente es negativo, la perilla sube; si es positivo, baja.

:::ejemplo Tres pasos con la perilla de juguete
Mismo modelo de antes, empezando en w = 0, con learning rate = 0.05. En cada paso: calcular la predicción, el error, la pérdida y el gradiente (2 × error × 2), y mover la perilla.

**Paso 1.** w = 0 → predicción 0, error −6, pérdida 36, gradiente −24.
w nueva = 0 − 0.05 × (−24) = 0 + 1.2 = **1.2**.

**Paso 2.** w = 1.2 → predicción 2.4, error −3.6, pérdida 12.96, gradiente 2 × (−3.6) × 2 = −14.4.
w nueva = 1.2 − 0.05 × (−14.4) = 1.2 + 0.72 = **1.92**.

**Paso 3.** w = 1.92 → predicción 3.84, error −2.16, pérdida 4.67, gradiente −8.64.
w nueva = 1.92 + 0.432 = **2.352**.

Después del paso 3, la predicción es 4.704 y la pérdida, 1.68. La pérdida bajó de 36 a 1.68 en tres pasos. El mejor valor posible es w = 3, porque 3 × 2 = 6 da error 0.
:::

:::figura aprender-valle
La perilla baja por el valle de la pérdida. Cada salto es más corto que el anterior sin que nadie cambie el learning rate: el valle se va aplanando y el gradiente se hace más chico.
:::

Fíjate en algo: el learning rate fue siempre 0.05, pero los pasos se fueron haciendo más chicos (1.2, luego 0.72, luego 0.432). Es porque el gradiente se achica cerca del fondo. Cuando el gradiente llega a 0, la perilla deja de moverse: estás en el fondo del valle.

### Muy chico, bien, muy grande

¿Qué pasa con otros learning rates? Las mismas cuentas, empezando en w = 0:

| Learning rate | Valores de la perilla | Pérdida en los primeros pasos | Qué pasa |
|---|---|---|---|
| 0.005 (muy chico) | 0 → 0.12 → 0.235 → 0.346 | 36 → 33.18 → 30.58 → 28.18 | Avanza, pero lentísimo: necesitaría cientos de pasos |
| 0.05 (bien) | 0 → 1.2 → 1.92 → 2.352 | 36 → 12.96 → 4.67 → 1.68 | Baja rápido y sin pasarse |
| 0.3 (muy grande) | 0 → 7.2 → −2.88 → 11.23 | 36 → 70.56 → 138.30 → 271.06 | Se pasa del fondo al otro lado, cada vez más lejos: la pérdida explota |

Con 0.3, el primer paso lleva la perilla a 7.2, muy lejos del 3 al otro lado del valle, donde la pendiente es todavía más fuerte, y el siguiente salto es aún más grande. En un entrenamiento real eso se ve como una pérdida que sube y sube hasta que aparece `NaN` (*not a number*): los números crecieron tanto que la computadora ya no los puede representar.

:::ojo
Si la pérdida sube en vez de bajar, o salta a `NaN`, lo primero que se sospecha es un learning rate demasiado grande.
:::

### El learning rate de C01

C01 entrena con lr = 3e-4. Esa notación quiere decir 3 × 10⁻⁴ = 3 ÷ 10,000 = **0.0003**. Es mucho más chico que el 0.05 del juguete, por dos razones: hay millones de perillas moviéndose a la vez, y C01 no empieza de cero sino desde un modelo que ya sabe mucho ([[fine-tuning]]: ajustar un modelo ya entrenado), así que solo quiere ajustarlo con suavidad. La primera versión de C01 partió de una ResNet-50 entrenada con ImageNet, el dataset famoso de la lección de las fotos; desde entonces, cada reentrenamiento mensual parte del modelo que está en producción. No existe un learning rate correcto universal: depende del modelo, del optimizador y del tamaño del grupo de fotos, y se encuentra probando. Además, muchas veces no es fijo: se va bajando durante el entrenamiento, para dar pasos grandes al principio y finos al final.

## Forward pass y backpropagation {Forward pass and backpropagation}

### El forward pass: de la foto a la respuesta

Un modelo grande no es una sola multiplicación como el juguete. Es una cadena de pasos, uno tras otro, que se llaman [[capa|capas]]: la foto entra a la primera, lo que sale entra a la segunda, y así hasta la última, que da las probabilidades. Recorrer esa cadena de principio a fin es el [[forward-pass|forward pass]] (pasada hacia adelante).

Es exactamente lo que hace la [[inferencia]]. La diferencia es que, al entrenar, además de la respuesta se **guardan los resultados intermedios** de cada capa, porque el paso siguiente los necesita. Por eso entrenar ocupa mucha más memoria que responder.

### Backpropagation: la cadena de la culpa

La [[backpropagation]] (o *backprop*) es la forma de calcular el gradiente de todas las perillas a la vez. Recorre la cadena **al revés**: de la pérdida hacia la entrada. Cada paso de la cadena sabe una cosa local, «si mi entrada cambia un poquito, mi salida cambia tanto», y la culpa del error se va multiplicando por esas sensibilidades de atrás para adelante. Al final, cada perilla sabe qué parte de la culpa le toca: ese es su gradiente.

:::ejemplo La cadena del modelo de juguete
El juguete también es una cadena, de tres pasos: perilla w → predicción = w × 2 → error = predicción − 6 → pérdida = error². Con w = 0 (predicción 0, error −6), de atrás para adelante:

- ¿Cuánto cambia la pérdida si cambia el error? 2 × error = 2 × (−6) = **−12**.
- ¿Cuánto cambia el error si cambia la predicción? Lo mismo: **1**.
- ¿Cuánto cambia la predicción si cambia w? Lo que vale la entrada: **2**.

Multiplicando: −12 × 1 × 2 = **−24**. El mismo número que mediste moviendo la perilla a mano, pero sin moverla. En el cálculo, multiplicar así a lo largo de la cadena se llama regla de la cadena.
:::

:::analogia Un platillo que salió salado
En una cocina, un platillo regresa salado. El mesero no tiene la culpa de la sal: se lo pasa al chef que emplató; el chef revisa qué parte puso cada quien y le pasa a la salsa su parte; quien hizo la salsa revisa sus ingredientes. La culpa viaja de la mesa hacia atrás, y cada quien recibe la parte que le toca.

**Dónde se rompe la analogía.** En la cocina se adivina quién tuvo la culpa; en backpropagation es una cuenta exacta. Y nadie queda libre: cada una de los millones de perillas recibe su pedacito de culpa y todas se ajustan un poquito al mismo tiempo.
:::

Lo importante para producción:

- **Nadie la programa a mano.** Los frameworks (las librerías con las que se escriben los modelos, como PyTorch) la hacen solos. En PyTorch, la línea `loss.backward()` calcula el gradiente de las 24.5 millones de perillas.
- **Cuesta más o menos el doble que el forward pass.** Así que entrenar con una foto (forward más backpropagation) cuesta unas 3 veces lo que cuesta responderla. Es una regla práctica, no una ley exacta.
- **Se inventó hace décadas.** La popularizó un artículo de Rumelhart, Hinton y Williams en 1986. Lo que cambió después fue tener datos y GPUs (chips hechos para hacer miles de cuentas a la vez) para usarla en modelos enormes.

En código, un paso de entrenamiento en PyTorch se ve más o menos así. No tienes que entender cada línea; fíjate en que son los cuatro pasos del ciclo:

```python
for fotos, etiquetas in batches:              # un grupo de fotos con sus respuestas
    predicciones = modelo(fotos)              # 1. forward pass
    perdida = cross_entropy(predicciones, etiquetas)   # 2. pérdida
    optimizador.zero_grad()                   #    (borra el gradiente del paso anterior)
    perdida.backward()                        # 3. backpropagation: el gradiente
    optimizador.step()                        # 4. gira las perillas
```

## Batch, paso y época {Batch, step and epoch}

¿Con cuántas fotos se calcula la pérdida en cada vuelta? Hay dos extremos y los dos son malos:

- **Con todas las fotos de train a la vez.** Son casi 2 millones en C01: no caben juntas en la memoria de la GPU, y darías un solo paso cada vez que las procesas todas.
- **Con una foto a la vez.** El gradiente de una sola foto es muy ruidoso (lo que ayuda a esa foto puede empeorar a otras) y desperdicia la GPU, que está hecha para calcular muchas cosas en paralelo.

El punto medio es el [[batch]] (lote): un grupo de fotos, por ejemplo 64, que se procesan juntas. La pérdida es el promedio de las 64, y con su gradiente se da un paso. Dos palabras más:

- Un [[paso]] (*step* o iteración) es una vuelta del ciclo con un batch: forward pass, pérdida, backpropagation y ajuste de las perillas.
- Una [[epoch|época]] (*epoch*) es una pasada completa por el train: cada foto se vio una vez.

:::diagrama aprender-ciclo
El ciclo de un paso. Sigue el recorrido «Un paso» y luego «Si la máquina se cae».
:::

:::ejemplo ¿Cuántos pasos tiene una época?
50,000 fotos de train, en batches de 64:

- 50,000 ÷ 64 = 781.25. No sale exacto.
- 781 batches completos son 781 × 64 = 49,984 fotos.
- Sobran 50,000 − 49,984 = 16 fotos, que van en un último batch más chico.
- Total: **782 pasos por época**.

Eso es redondear hacia arriba, lo que en programación se llama *ceil* (techo): ⌈781.25⌉ = 782. Algunas configuraciones prefieren tirar el batch incompleto (en PyTorch, `drop_last=True`) y entonces son 781. Si entrenas 10 épocas: 782 × 10 = 7,820 pasos.
:::

:::ejemplo Los números de C01
En la Ronda, C01 entrena con 1,840,211 fotos, batches de 64 y 8 épocas:

- 1,840,211 ÷ 64 = 28,753.3. Redondeado hacia arriba: **28,754 pasos por época** (el último batch trae 1,840,211 − 28,753 × 64 = 19 fotos).
- 8 épocas: 28,754 × 8 = **230,032 pasos**.
- Cada foto pasa 8 veces por el modelo, una por época, y cada vez con variaciones al azar distintas (la [[augmentation]] de la lección anterior).
:::

Dos detalles que vas a oír:

- **Al empezar cada época se revuelven las fotos.** Así los batches no son siempre los mismos grupos, en el mismo orden.
- **El gradiente de un batch es una estimación.** 64 fotos son una muestra de todo el train; otro batch daría un gradiente un poco distinto. Por eso el descenso con batches al azar se llama *estocástico*, que quiere decir «con algo de azar». Batches más grandes dan una estimación menos ruidosa, pero ocupan más memoria.

:::ojo
La palabra **batch** también se usa en producción, con otro sentido. En C01, el servidor del modelo (Triton) junta las fotos que llegan casi al mismo tiempo de personas distintas para calcularlas juntas en la GPU. Eso es batching en **inferencia**: no hay pérdida ni gradiente, solo forward pass, y se hace para aprovechar la GPU. Cuando la Ronda dice «dynamic batching», habla de eso.
:::

## El optimizador y los hiperparámetros {Optimizers and hyperparameters}

### El optimizador: cómo girar las perillas

La pieza que toma el gradiente y decide cuánto girar cada perilla se llama [[optimizador]]. Hay dos que vas a oír todo el tiempo:

- **SGD** (*stochastic gradient descent*, descenso de gradiente estocástico) es la regla que ya conoces, tal cual: perilla − learning rate × gradiente del batch. Muchas veces se le agrega **momentum** (inercia): el paso arrastra un poco de la dirección de los pasos anteriores, como una pelota que rueda y no se frena en cada bache.
- **Adam** (propuesto en 2014 por Kingma y Ba) es una forma más lista de girar las perillas. Para **cada perilla** lleva dos promedios: el de sus gradientes recientes (hacia dónde ha ido empujando, como el momentum) y el de su tamaño. Con eso ajusta el paso de cada perilla por separado: una perilla cuyo gradiente siempre es enorme recibe pasos más cuidadosos, y una con gradientes chiquitos pero constantes, pasos relativamente más grandes. Funciona bien en muchos casos sin tanto ajuste fino del learning rate, y es una opción por defecto muy común.

El precio de Adam: esos dos promedios son **dos números extra por perilla**, que viven en memoria durante todo el entrenamiento. En C01 son 24.5 millones × 2 = 49 millones de números más. Los vas a volver a ver en los checkpoints.

### Parámetros contra hiperparámetros

Son dos palabras que se confunden mucho y que la Ronda usa a cada rato:

| | Parámetros | Hiperparámetros |
|---|---|---|
| Qué son | Las perillas del modelo | Las decisiones de cómo entrenar |
| Quién los decide | El entrenamiento, con el optimizador | Tú, antes de entrenar |
| Cuántos son | Millones (24.5 M en C01) | Unos cuantos |
| Ejemplos | Cada número de cada capa | Learning rate, tamaño del batch, épocas, optimizador, qué augmentations |
| Dónde quedan | En el archivo del modelo | En la configuración y en el registro del experimento |

Los [[hiperparametro|hiperparámetros]] de C01, según la Ronda: Adam, learning rate 3e-4, batch 64, 8 épocas y semilla 17. ¿Cómo se eligen? Probando varias opciones y comparando cómo le va a cada una en **validación**, nunca en el test (ya viste por qué en la lección anterior).

:::nota La semilla no se «busca»
La semilla (la verás en la siguiente sección) se anota con los hiperparámetros, pero no se elige probando. Entrenar con diez semillas y quedarte con la que mejor salió es elegir por suerte, no por mérito.
:::

## Entrenar en serio: checkpoints, semillas y GPUs {Training for real: checkpoints, seeds and GPUs}

### Checkpoints: guardar a medio camino

Un entrenamiento de C01 dura horas. Si la máquina se apaga en la hora tres, ¿empiezas de cero? No, si guardaste un [[checkpoint]]: un archivo con todo el estado del entrenamiento en un momento dado. Lleva tres cosas: las perillas, el estado del optimizador (los dos promedios de Adam) y en qué época y paso iba, junto con el estado del azar.

¿Por qué se guarda a media corrida, y no solo al final?

- **Las máquinas fallan, o te las quitan.** En la nube (computadoras que se rentan por hora, por ejemplo a AWS, la de Amazon) hay máquinas mucho más baratas, llamadas *spot*, que el proveedor puede reclamar cuando las necesita (en AWS, con un aviso de apenas dos minutos). Con checkpoints, perder la máquina cuesta minutos, no la corrida entera.
- **Para quedarte con la mejor versión.** A veces el modelo le va mejor en validación en la época 6 que en la 8, porque al final empezó a memorizar el train ([[overfitting]]). Si guardaste la 6, la puedes usar.
- **Para seguir después.** El modelo de C01 de cada mes empieza desde el que está en producción, no desde cero.

:::ejemplo ¿Cuánto pesa un checkpoint de C01?
- Las perillas: 24.5 millones, cada una guardada en 4 bytes ([[float32]]): 24.5 M × 4 = **98 MB**.
- Los dos promedios de Adam, uno por perilla cada uno: 2 × 98 MB = **196 MB**.
- Total: 98 + 196 ≈ **294 MB**.

C01 guarda uno cada 15 minutos. Si la máquina se cae, se pierden como mucho 15 minutos de trabajo.
:::

:::ojo
¿Por qué guardar también el estado del optimizador, si el modelo para responder solo necesita las perillas (los 98 MB)? Porque sin él, Adam vuelve a empezar sus promedios desde cero y los primeros pasos después de reanudar ya no son los que habría dado. Reanudar sin el estado completo no es seguir: es empezar algo un poco distinto.
:::

### Semillas: por qué dos corridas dan resultados distintos

Entrena dos veces el mismo modelo, con los mismos datos y la misma configuración, y no vas a obtener exactamente el mismo resultado. Porque el entrenamiento tiene azar en varios lugares:

- Los valores iniciales de las perillas nuevas. Cuando el modelo de C01 se entrenó por primera vez a partir de un modelo genérico, su última capa, la de las 500 categorías, empezó con números al azar; y cuando se agrega una categoría, sus perillas nuevas también.
- El orden en que se revuelven las fotos en cada época, que cambia qué fotos van juntas en cada batch.
- Las variaciones de la augmentation: qué foto se voltea, cuánto se recorta.
- Algunas capas que apagan pedazos del modelo al azar mientras entrena ([[dropout]], si el modelo lo usa).

Una computadora no tira dados de verdad: genera números que parecen al azar a partir de un número inicial, la [[semilla]] (*seed*). Con la misma semilla sale exactamente la misma secuencia de «azares». C01 fija la semilla 17.

Pero en una GPU, ni con la misma semilla sale idéntico. La GPU hace millones de sumas en paralelo y no siempre en el mismo orden. Y con decimales en la computadora, el orden de una suma puede cambiar el resultado.

:::ejemplo El orden de una suma importa
Con números [[float32]], que guardan unos 7 dígitos significativos:

- (100,000,000 + 1) − 100,000,000 = **0**, porque 100,000,001 no cabe y se redondea a 100,000,000 antes de restar.
- (100,000,000 − 100,000,000) + 1 = **1**.

La misma cuenta en otro orden da otro resultado. Repetido millones de veces, dos entrenamientos se separan un poquito.
:::

¿Cuánto se separan? La Ronda trae un ejemplo con números ilustrativos: la misma receta de C01 entrenada con 5 semillas da 85.21 %, 85.34 %, 85.12 %, 85.29 % y 85.18 % de aciertos en el golden set. El promedio es 426.14 ÷ 5 ≈ 85.23 %, y entre el mejor y el peor hay 85.34 − 85.12 = 0.22 **puntos porcentuales** (puntos de diferencia entre dos porcentajes). La lección: si dos corridas difieren en 0.2 puntos, eso no dice nada; puede ser pura semilla. Por eso «reproducible», en producción, quiere decir «el mismo resultado dentro del ruido», no idéntico.

### Por qué entrenar tarda horas y responder tarda milisegundos

Ya tienes todas las piezas para hacer la cuenta.

:::ejemplo Responder contra entrenar, en C01
**Responder (inferencia).** Una foto, un forward pass. La ResNet-50 hace unos 4,100 millones de multiplicaciones y sumas por foto. En la GPU de producción de C01, ese cálculo tarda del orden de 3 a 6 milisegundos.

**Entrenar.** Cada foto de train pasa por el modelo una vez por época:

- 1,840,211 fotos × 8 épocas = 14,721,688 pasadas.
- Cada una con forward pass y backpropagation, que cuesta unas 3 veces un forward pass solo: ≈ 44 millones de «respuestas» de trabajo.

La Ronda dice que el entrenamiento mensual de C01 tarda unas 3 a 4 horas en una GPU y cuesta del orden de US$10 a 50. Haz la cuenta al revés: 4 horas son 4 × 3,600 = 14,400 segundos, y 14,721,688 ÷ 14,400 ≈ 1,000 fotos por segundo. Es la velocidad que tiene que sostener la GPU. Es razonable para una GPU moderna, pero varía mucho con el modelo de GPU y la configuración: tómala como un orden de magnitud, no como un dato.
:::

¿Y por qué una GPU? Una CPU, el procesador normal de una computadora, tiene pocos núcleos muy capaces. Una GPU tiene miles de núcleos más simples que hacen la misma operación sobre muchos números a la vez. Entrenar es casi todo eso: multiplicar y sumar tablas enormes de números, una y otra vez. En CPU, el mismo entrenamiento tardaría del orden de días, según cuántos núcleos tenga la máquina. Lo ves a fondo en la lección «CPU y GPU».

Y no es solo tiempo, también memoria. Al entrenar, la GPU tiene que guardar a la vez las perillas, el gradiente de cada perilla, los promedios de Adam y los resultados intermedios de cada capa para la backpropagation. Para responder solo necesita las perillas y un poco de espacio para calcular. Por eso una GPU que responde con holgura puede quedarse corta para entrenar el mismo modelo.

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M10 · MLOps** registra cada entrenamiento con sus hiperparámetros (lr, épocas, semilla), sus métricas por época y sus checkpoints; explica los cinco ingredientes para reproducir un entrenamiento y por qué en GPU «misma semilla» no alcanza. Ahí está la cuenta del checkpoint de 294 MB cada 15 minutos.
- **M04 · Hardware para inferencia** compara la memoria de entrenar con la de responder: entrenar con Adam ocupa ≈ 16 bytes por parámetro (perillas, gradiente y promedios, guardados en varios tamaños de número), y servir en FP16 (números de 2 bytes) solo 2 bytes por parámetro.
- **C01 en la Ronda** describe el reentrenamiento mensual: un fine-tune desde el modelo en producción, unas horas en una GPU, con semillas y configuración fijadas, que solo pasa a producción si no empeora en el golden set.
- **M03 · Latencia y capacidad** y **M07 · Servidores de modelos** usan «batch» en el otro sentido: el dynamic batching de Triton, que junta peticiones en inferencia.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
loss gradiente descenso-gradiente backpropagation learning-rate optimizador batch epoch paso checkpoint hiperparametro semilla forward-pass
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? El modelo le da 30 % a la categoría correcta. ¿Cuál es su pérdida? ¿Y si después de entrenar le da 60 %?
−ln(0.30) ≈ 1.20. Con 60 %: −ln(0.60) ≈ 0.51. La pérdida bajó a menos de la mitad, aunque en los dos casos el modelo podría estar acertando o no, según cuánto les dé a las demás categorías.
? El gradiente de una perilla es +5 y el learning rate es 0.01. ¿Hacia dónde se mueve la perilla, y cuánto?
Hacia abajo, en contra del gradiente: perilla nueva = perilla − 0.01 × 5 = perilla − 0.05. Gradiente positivo quiere decir que subir la perilla sube la pérdida, así que hay que bajarla.
? Tienes 30,000 fotos de train y batches de 64. ¿Cuántos pasos hay por época? ¿Y en 3 épocas?
30,000 ÷ 64 = 468.75. Son 468 batches completos (29,952 fotos) y uno más con las 48 que sobran: 469 pasos por época, redondeando hacia arriba. En 3 épocas, 469 × 3 = 1,407 pasos (o 468 × 3 = 1,404 si se tira el batch incompleto).
? La pérdida sube en cada paso y termina en NaN. ¿Qué sospechas primero?
Un learning rate demasiado grande: cada paso se pasa del fondo del valle al otro lado, cada vez más lejos, hasta que los números crecen tanto que la computadora ya no los puede representar.
? ¿El learning rate es un parámetro o un hiperparámetro? ¿Y un número dentro de una capa del modelo?
El learning rate es un hiperparámetro: lo eliges tú antes de entrenar y el entrenamiento no lo cambia. Un número de una capa es un parámetro: lo ajusta el entrenamiento.
? Entrenas dos veces con la misma configuración y sale 85.3 % y 85.1 %. ¿El segundo modelo es peor?
No se puede decir. El entrenamiento tiene azar (perillas iniciales, orden de las fotos, augmentation, sumas en paralelo en la GPU) y, con números como los de la Ronda, la diferencia entre semillas ya es de unos 0.2 puntos. Para comparar recetas hay que medir cuánto varía el resultado entre semillas.
? ¿Por qué un checkpoint de C01 pesa ≈ 294 MB si el modelo solo pesa 98 MB?
Porque además de las perillas guarda el estado de Adam: dos promedios por perilla, 2 × 98 MB = 196 MB. Sin ellos, reanudar no sería seguir el mismo entrenamiento.
:::
