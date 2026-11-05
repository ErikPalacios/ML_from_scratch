---
titulo: Cómo aprende un modelo
en: How a model learns
subtitulo: La pérdida, el gradiente y el ciclo que gira millones de perillas un poquito a la vez hasta que el modelo se equivoca menos, y lo que la GPU tiene que guardar para lograrlo.
pregunta: Cuando alguien dice que un modelo «está entrenando», ¿qué está pasando, paso a paso, y por qué hace falta una GPU?
requisitos: ejemplos
---

:::idea
Entrenar es repetir un ciclo: el modelo adivina, un número mide qué tan mal le fue (la pérdida), la backpropagation calcula hacia dónde girar cada perilla para que le vaya un poco menos mal (el gradiente) y el optimizador las gira todas un poquito. Cientos de miles de veces, en una GPU que tiene que guardar en su memoria todo lo que ese ciclo necesita.
:::

## La pérdida: un número para lo mal que va {Loss: how wrong, in one number}

Para mejorar algo necesitas medirlo. Para entrenar un modelo hace falta un solo número que diga **qué tan equivocado está**: mientras más bajo, mejor, y 0 si es perfecto. Ese número es la [[loss|pérdida]] (*loss*), y la fórmula que lo calcula se llama función de pérdida. Entrenar es, literalmente, hacer que la pérdida baje.

### La entropía cruzada, para un ejemplo

En una [[clasificacion|clasificación]] como C01, el modelo no da una sola respuesta: da una [[probabilidad]] para cada una de las 500 categorías, y suman 100 %. La pérdida más usada se llama [[entropia-cruzada|entropía cruzada]] (*cross-entropy*) y funciona así:

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

:::profundo ¿Por qué un logaritmo y no otra cosa?
Si el modelo le da 0.9, 0.8 y 0.5 a las respuestas correctas de tres fotos, entonces, según el propio modelo, la probabilidad de que las tres respuestas correctas salgan juntas es 0.9 × 0.8 × 0.5 = 0.36 (si las tomamos como independientes). Entrenar bien sería hacer ese producto lo más grande posible. Pero con miles de fotos el producto se vuelve diminuto y la computadora ya no lo distingue de 0.

El logaritmo convierte el producto en una suma: −ln(0.36) = −ln(0.9) − ln(0.8) − ln(0.5) = 0.105 + 0.223 + 0.693 ≈ 1.02. Así que bajar la entropía cruzada es lo mismo que hacer más probable lo que de verdad pasó. Por eso premia las probabilidades honestas: decir 99 % y fallar sale carísimo.
:::

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

### Para predecir un número: el error cuadrático

Muchos modelos no eligen una categoría sino que predicen un número: cuántos kilos de jitomate va a vender una tienda mañana, cuánto va a tardar un pedido. Eso es una [[regresion|regresión]], y ahí no hay «probabilidad de la respuesta correcta». La pérdida más usada es el [[mse|error cuadrático medio]] (*mean squared error*, MSE): para cada ejemplo, el error al cuadrado, (predicción − respuesta)², y luego el promedio.

:::ejemplo Cuatro días de jitomate
| Día | Pronóstico (kg) | Se vendió (kg) | Error | Error al cuadrado |
|---|---|---|---|---|
| Lunes | 30 | 28 | +2 | 4 |
| Martes | 20 | 21 | −1 | 1 |
| Miércoles | 25 | 31 | −6 | 36 |
| Jueves | 40 | 37 | +3 | 9 |

- Suma de los cuadrados: 4 + 1 + 36 + 9 = 50.
- MSE: 50 ÷ 4 = **12.5**. Está en kilos al cuadrado, una unidad rara; su raíz, √12.5 ≈ **3.5 kg**, vuelve a kilos y se llama RMSE.
- El miércoles, con un error de 6 kg, aporta 36 de los 50: el **72 %**.
:::

:::figura aprender-mse
Cada error, dibujado como un cuadrado: su área es el error al cuadrado. El error de 6 kg ocupa más que los otros tres juntos.
:::

¿Por qué al cuadrado? Quita el signo (pasarse 2 kg y quedarse corto 2 kg cuentan igual) y castiga mucho más los errores grandes: uno de 6 pesa 36 veces lo que uno de 1.

Y una consecuencia que conviene saber: **el número que hace más chico el MSE es el promedio.** Si un producto vendió 2, 3, 3, 4 y 13 kilos en cinco días, la predicción fija con menor MSE es 5, el promedio (MSE de 16.4), y no 3, el valor de en medio (MSE de 20.4): el día de 13 kilos jala la respuesta hacia arriba. Entrenar con MSE es pedirle el promedio; para otra cosa, como un número que alcance 9 de cada 10 días, hace falta otra pérdida (C14, en «En la vida real»).

| Lo que predice el modelo | Ejemplo | Pérdida usual |
|---|---|---|
| Una de varias categorías | C01: 500 categorías | Entropía cruzada, sobre el [[softmax]] |
| Sí o no | C15: ¿le darán clic al anuncio? | Entropía cruzada de dos clases (*log loss*) |
| Un número | C14: kilos que se van a vender | MSE, error absoluto o cuantiles |

:::nota ¿De dónde salen esas probabilidades?
El modelo, por dentro, produce un número cualquiera para cada categoría (un [[logit]]), y una función llamada [[softmax]] los convierte en probabilidades que suman 100 %. Lo viste en la lección «Qué es un modelo». En el código, a la función de pérdida casi siempre se le dan los logits directo: ella aplica el softmax por dentro.
:::

## El gradiente y el descenso de gradiente {The gradient and gradient descent}

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

La pérdida bajó 36 − 35.7604 = 0.2396 por mover la perilla 0.01. Por cada unidad, eso es 0.2396 ÷ 0.01 = 23.96, y como bajó, se escribe con signo menos: la pendiente es ≈ **−24**.
:::

Ese −24 es el gradiente de la perilla w en el punto w = 0. Se lee en dos partes:

- **El signo dice la dirección.** Negativo quiere decir que si subes la perilla, la pérdida baja. Así que hay que subirla. La regla general: mover cada perilla **en contra** de su gradiente.
- **El tamaño dice qué tan empinado está.** 24 es mucho: cerca de aquí, cualquier cambio de la perilla mueve mucho la pérdida.

Para este modelo hay una fórmula que da la pendiente exacta sin mover nada: 2 × error × entrada = 2 × (−6) × 2 = −24. Sale de la derivada, una herramienta del cálculo, pero basta con la idea de «mueve un poquito y mira qué pasa».

La ResNet-50 de C01 tiene unos 24.5 millones de perillas, así que su gradiente es una lista de 24.5 millones de números. Medirlo moviendo cada perilla por separado exigiría pasar las fotos por el modelo 24.5 millones de veces **para un solo paso**. En la sección siguiente verás cómo se calcula todo de una vez.

:::analogia Bajar un cerro con niebla
Estás en un cerro con una niebla tan espesa que no ves el valle. Lo único que sientes es la inclinación del suelo bajo tus pies. Para bajar, das un paso hacia donde el suelo baja, vuelves a sentir y das otro. Tu posición son las perillas, la altura es la pérdida y la inclinación es el gradiente.

**Dónde se rompe la analogía.** El cerro de un modelo no tiene dos direcciones (norte y este) sino 24.5 millones. El suelo cambia un poco con cada paso, porque cada vez se mide con fotos distintas. Y puedes acabar en un hoyo que no es el más bajo de todos, aunque con redes grandes eso preocupa menos de lo que parece.
:::

### Descenso de gradiente

Con el gradiente en la mano, la regla para mejorar es simple y se llama [[descenso-gradiente|descenso de gradiente]] (*gradient descent*):

> perilla nueva = perilla − learning rate × gradiente

El [[learning-rate|learning rate]] (tasa de aprendizaje, o *lr*) es un número chico que decide **qué tan grande es cada paso**. El signo menos es el «en contra»: si el gradiente es negativo, la perilla sube; si es positivo, baja.

:::cuenta Un paso de descenso de gradiente, con la perilla de juguete
Predicción // con la perilla en w = 0 | 0 × 2 | 0
Error // predicción menos respuesta | 0 − 6 | −6
Pérdida | (−6)² | 36
Gradiente // 2 × error × entrada | 2 × (−6) × 2 | −24
Perilla nueva // learning rate = 0.05 | 0 − 0.05 × (−24) | **1.2**
= Con w = 1.2 la predicción es 2.4 y la pérdida baja de 36 a **12.96**.
:::

Desde w = 1.2 se repite la misma cuenta: el gradiente ahora es −14.4 y la perilla sube a 1.92. Desde ahí el gradiente es −8.64 y sube a 2.352. Después de tres pasos la predicción es 4.704 y la pérdida, 1.68: bajó de 36 a 1.68. El mejor valor posible es w = 3, porque 3 × 2 = 6 da error 0.

:::figura aprender-valle
La perilla baja por el valle de la pérdida. Cada salto es más corto que el anterior sin que nadie cambie el learning rate: el valle se va aplanando y el gradiente se hace más chico.
:::

El learning rate fue siempre 0.05, pero los pasos se achicaron solos (1.2, luego 0.72, luego 0.432), porque el gradiente se achica cerca del fondo. Muy cerca del fondo el gradiente es casi 0 y la perilla casi no se mueve. Se dice que el entrenamiento [[convergencia|convergió]]: los pasos ya casi no cambian nada.

### Muy chico, bien, muy grande

¿Qué pasa con otros learning rates? Las mismas cuentas, empezando en w = 0:

| Learning rate | Valores de la perilla | Pérdida en los primeros pasos | Qué pasa |
|---|---|---|---|
| 0.005 (muy chico) | 0 → 0.12 → 0.235 → 0.346 | 36 → 33.18 → 30.58 → 28.18 | Avanza, pero lentísimo: necesita 140 pasos para quedar a menos de 0.01 del fondo |
| 0.05 (bien) | 0 → 1.2 → 1.92 → 2.352 | 36 → 12.96 → 4.67 → 1.68 | Baja rápido y sin pasarse: 12 pasos |
| 0.3 (muy grande) | 0 → 7.2 → −2.88 → 11.23 | 36 → 70.56 → 138.30 → 271.06 | Se pasa del fondo al otro lado, cada vez más lejos: la pérdida explota |

Con 0.3, el primer paso lleva la perilla a 7.2, al otro lado del valle y más lejos del 3 que antes, donde la pendiente es más fuerte; el siguiente salto es aún más grande. En un entrenamiento real se ve como una pérdida que sube hasta que aparece `NaN` (*not a number*, «no es un número»): los números crecieron tanto que la computadora ya no los puede representar, y las cuentas con ellos dejan de dar resultados válidos.

:::ojo
Si la pérdida sube en vez de bajar, o salta a `NaN`, lo primero que se sospecha es un learning rate demasiado grande.
:::

### Juega con el learning rate

En esta parábola hay un atajo para hacer todos los pasos de golpe. El gradiente es 2 × (2w − 6) × 2 = 8 × (w − 3): ocho veces la distancia al fondo. Si llamas *distancia* a w − 3, cada paso hace:

> distancia nueva = distancia − lr × 8 × distancia = (1 − 8 × lr) × distancia

Con lr = 0.05 el factor es 1 − 0.4 = 0.6, y la distancia pasa de −3 a −1.8, a −1.08, a −0.648: los mismos 1.2, 1.92 y 2.352 de antes. Ese es el atajo: después de n pasos, la distancia es −3 × 0.6ⁿ, sin dar los pasos uno por uno. Si el factor está entre −1 y 1, la perilla se acerca al fondo; si es negativo, brinca al otro lado en cada paso; si se sale de ese rango, se aleja.

:::calculadora aprender-descenso
Con lr = 0.2 el factor es −0.6: baja igual de rápido que con 0.05, pero brincando de un lado al otro del valle.
:::

### En código

El mismo descenso en Python puro, sin nada que instalar. Córrelo y cambia los learning rates de la lista:

```python
def perdida(w):
    return (w * 2 - 6) ** 2        # predicción = w × 2; respuesta correcta = 6

def gradiente(w):
    return 2 * (w * 2 - 6) * 2     # 2 × error × entrada

for lr in [0.05, 0.3]:
    w = 0.0
    print(f"learning rate = {lr}")
    for paso in range(1, 6):
        w = w - lr * gradiente(w)  # el descenso de gradiente
        print(f"  paso {paso}:  w = {w:7.3f}   pérdida = {perdida(w):8.2f}")
```

```salida
learning rate = 0.05
  paso 1:  w =   1.200   pérdida =    12.96
  paso 2:  w =   1.920   pérdida =     4.67
  paso 3:  w =   2.352   pérdida =     1.68
  paso 4:  w =   2.611   pérdida =     0.60
  paso 5:  w =   2.767   pérdida =     0.22
learning rate = 0.3
  paso 1:  w =   7.200   pérdida =    70.56
  paso 2:  w =  -2.880   pérdida =   138.30
  paso 3:  w =  11.232   pérdida =   271.06
  paso 4:  w =  -8.525   pérdida =   531.28
  paso 5:  w =  19.135   pérdida =  1041.32
```

### El learning rate de C01

C01 entrena con lr = 3e-4, que quiere decir 3 × 10⁻⁴ = 3 ÷ 10,000 = **0.0003**. Es mucho más chico que el 0.05 del juguete por dos razones: hay millones de perillas moviéndose a la vez, y C01 no empieza de cero sino desde un modelo que ya sabe mucho ([[fine-tuning]]: ajustar un modelo ya entrenado), así que solo quiere ajustarlo con suavidad. La primera versión de C01 partió de una ResNet-50 entrenada con ImageNet; desde entonces, cada reentrenamiento mensual parte del modelo que está en producción. No existe un learning rate correcto universal: depende del modelo, del optimizador y del tamaño del batch, y se encuentra probando.

## Backpropagation y el ciclo de entrenamiento {Backpropagation and the training loop}

### El forward pass: de la foto a la respuesta

Un modelo grande no es una sola multiplicación como el juguete. Es una cadena de pasos, uno tras otro, que se llaman [[capa|capas]]: la foto entra a la primera, lo que sale entra a la segunda, y así hasta la última, que da las probabilidades. Recorrer esa cadena de principio a fin es el [[forward-pass|forward pass]] (pasada hacia adelante).

Es exactamente lo que hace la [[inferencia]]. La diferencia es que, al entrenar, además de la respuesta se **guardan los resultados intermedios** de cada capa, las *activaciones*, porque el paso siguiente los necesita. Por eso entrenar ocupa mucha más memoria que responder.

### La regla de la cadena

Medir el gradiente moviendo cada perilla funciona con una, no con 24.5 millones. El atajo viene del cálculo, y se entiende con un ejemplo de todos los días.

:::ejemplo Del kilómetro al peso, en dos pasos
Un coche recorre 12 km con un litro de gasolina, y supón que el litro cuesta $24.

- Si manejas 1 km más, gastas 1/12 de litro más.
- Cada litro más cuesta $24.
- Cada kilómetro más cuesta, entonces, 24 × 1/12 = **$2**.

Compruébalo: 120 km son 10 litros, $240; 121 km son 10.083 litros, $242. Dos pesos más.
:::

Esa multiplicación es la [[regla-cadena|regla de la cadena]]: si A mueve a B y B mueve a C, lo que C cambia por cada pedacito de A es **lo que C cambia por B, multiplicado por lo que B cambia por A**. No hizo falta manejar el kilómetro extra: bastó con conocer cada eslabón por separado.

:::ejemplo La cadena del modelo de juguete
El juguete también es una cadena, de tres eslabones: perilla w → predicción = w × 2 → error = predicción − 6 → pérdida = error². Con w = 0 (predicción 0, error −6), de atrás para adelante:

- ¿Cuánto cambia la pérdida si cambia el error? 2 × error = 2 × (−6) = **−12**.
- ¿Cuánto cambia el error si cambia la predicción? Lo mismo: **1**.
- ¿Cuánto cambia la predicción si cambia w? Lo que vale la entrada: **2**.

Multiplicando: −12 × 1 × 2 = **−24**. El mismo número que mediste moviendo la perilla a mano, pero sin moverla.
:::

### Backpropagation: la cadena de la culpa

La [[backpropagation]] (o *backprop*) es la regla de la cadena aplicada a todo el modelo a la vez. Recorre la cadena **al revés**: de la pérdida hacia la entrada. Cada capa sabe una cosa local, «si mi entrada cambia un poquito, mi salida cambia tanto», y la culpa del error se va multiplicando por esas sensibilidades de atrás para adelante. Al final, cada perilla sabe qué parte de la culpa le toca: ese es su gradiente. Una pasada hacia atrás da los 24.5 millones de números.

:::analogia Un platillo que salió salado
En una cocina, un platillo regresa salado. El mesero no tiene la culpa de la sal: se lo pasa al chef que emplató; el chef revisa qué parte puso cada quien y le pasa a la salsa su parte; quien hizo la salsa revisa sus ingredientes. La culpa viaja de la mesa hacia atrás, y cada quien recibe la parte que le toca.

**Dónde se rompe la analogía.** En la cocina se adivina quién tuvo la culpa; en backpropagation es una cuenta exacta, y nadie queda libre: cada una de los millones de perillas recibe su pedacito y todas se ajustan a la vez.
:::

Lo importante para producción:

- **Nadie la programa a mano.** Los frameworks (las librerías con las que se escriben los modelos, como PyTorch) la hacen solos. En PyTorch, la línea `loss.backward()` calcula el gradiente de las 24.5 millones de perillas.
- **Cuesta más o menos el doble que el forward pass.** Así que entrenar con una foto (forward más backpropagation) cuesta unas 3 veces lo que cuesta responderla. Es una regla práctica, no una ley exacta.
- **No es nueva.** La popularizó un artículo de Rumelhart, Hinton y Williams en 1986; lo que cambió después fue tener datos y GPUs para usarla en modelos enormes.

En código, un paso de entrenamiento en PyTorch se ve más o menos así. Es una ilustración (sin PyTorch instalado no corre); fíjate en que son los cuatro pasos del ciclo:

```python
for fotos, etiquetas in batches:              # un grupo de fotos con sus respuestas
    predicciones = modelo(fotos)              # 1. forward pass
    perdida = cross_entropy(predicciones, etiquetas)   # 2. pérdida
    optimizador.zero_grad()                   #    (borra el gradiente del paso anterior)
    perdida.backward()                        # 3. backpropagation: el gradiente
    optimizador.step()                        # 4. gira las perillas
```

### Batch, paso y época: con cuántas fotos se da cada paso

¿Con cuántas fotos se calcula la pérdida en cada vuelta? Hay dos extremos y los dos son malos:

- **Con todas las fotos de train a la vez.** Son casi 2 millones en C01: no caben juntas en la memoria de la [[gpu|GPU]], y darías un solo paso cada vez que las procesas todas.
- **Con una foto a la vez.** El gradiente de una sola foto es muy ruidoso (lo que ayuda a esa foto puede empeorar a otras) y desperdicia la GPU, que está hecha para calcular muchas cosas en paralelo.

El punto medio es el [[batch]] (lote): un grupo de fotos, por ejemplo 64, que se procesan juntas. La pérdida es el promedio de las 64, y con su gradiente se da un paso. Dos palabras más:

- Un [[paso]] (*step* o iteración) es una vuelta del ciclo con un batch: forward pass, pérdida, backpropagation y ajuste de las perillas.
- Una [[epoch|época]] (*epoch*) es una pasada completa por el train: cada foto se vio una vez.

:::diagrama aprender-ciclo
El ciclo de un paso. Sigue el recorrido «Un paso» y luego «Si la máquina se cae».
:::

Con 50,000 fotos en batches de 64: 50,000 ÷ 64 = 781.25. Son 781 batches completos (49,984 fotos) y uno más con las 16 que sobran: **782 pasos por época**. Es redondear hacia arriba, lo que en programación se llama *ceil* (techo): ⌈781.25⌉ = 782. Si se tira el batch incompleto (en PyTorch, `drop_last=True`), son 781.

:::cuenta Los pasos de un entrenamiento de C01
Fotos de train | según la Ronda | 1,840,211
Batches completos de 64 | 1,840,211 ÷ 64 = 28,753.3 | 28,753
Fotos que sobran // van en un último batch chico | 1,840,211 − 28,753 × 64 | 19
Pasos por época // redondear hacia arriba | ⌈28,753.3⌉ | 28,754
Pasos en 8 épocas | 28,754 × 8 | **230,032**
= Cada foto pasa 8 veces por el modelo, una por época, y cada vez con variaciones al azar distintas (la [[augmentation]] de la lección anterior).
:::

Dos detalles que vas a oír:

- **Al empezar cada época se revuelven las fotos.** Así los batches no son siempre los mismos grupos, en el mismo orden.
- **El gradiente de un batch es una estimación.** 64 fotos son una muestra de todo el train; otro batch daría un gradiente un poco distinto. Por eso el descenso con batches al azar se llama *estocástico*, que quiere decir «con algo de azar». Batches más grandes dan una estimación menos ruidosa, pero ocupan más memoria.

:::ojo
La palabra **batch** también se usa en producción, con otro sentido. En C01, el servidor del modelo (Triton) junta las fotos que llegan casi al mismo tiempo de personas distintas para calcularlas juntas en la GPU. Es batching en **inferencia**: sin pérdida ni gradiente, solo forward pass. Cuando la Ronda dice «dynamic batching», habla de eso.
:::

## Backpropagation a mano, y gradientes que se apagan o explotan {Backpropagation by hand, and vanishing or exploding gradients} [extra]

El juguete tenía una perilla. Ahora, la red más chica que ya tiene la forma de una red de verdad: dos perillas y una activación en medio.

> y = w2 × ReLU(w1 × x)

La [[relu|ReLU]] deja pasar los números positivos tal cual y cambia los negativos por 0 (la verás a fondo en la lección de redes). Usamos el mismo ejemplo de siempre: entrada x = 2, respuesta correcta 6, y la pérdida (y − 6)². Las perillas empiezan en w1 = 0.5 y w2 = 2.

Una notación antes de empezar: «cuánto cambia la pérdida L si mueves w1 un poquito» se escribe **∂L/∂w1** y se lee «derivada de L respecto a w1». Es un nombre corto, no una división que tengas que hacer.

:::figura aprender-cadena
Los valores bajan por la izquierda (forward) y los gradientes suben por la derecha (backward). Cada perilla toma su gradiente del eslabón donde se usa.
:::

:::cuenta Backpropagation a mano, eslabón por eslabón
z = w1 × x // forward | 0.5 × 2 | 1
h = ReLU(z) // 1 no es negativo: pasa igual | ReLU(1) | 1
y = w2 × h | 2 × 1 | 2
Pérdida L = (y − 6)² | (2 − 6)² | 16
∂L/∂y // backward: empieza en la pérdida | 2 × (y − 6) = 2 × (−4) | −8
∂L/∂w2 // y = w2 × h: mover w2 mueve y en h veces | −8 × h = −8 × 1 | **−8**
∂L/∂h // mover h mueve y en w2 veces | −8 × w2 = −8 × 2 | −16
∂L/∂z // la ReLU deja pasar todo si z > 0 | −16 × 1 | −16
∂L/∂w1 // z = w1 × x: mover w1 mueve z en x veces | −16 × x = −16 × 2 | **−32**
= Con lr = 0.01: w1 = 0.5 − 0.01 × (−32) = **0.82** y w2 = 2 − 0.01 × (−8) = **2.08**. Ahora y = 2.08 × 1.64 = 3.41 y la pérdida baja de 16 a **6.70**.
:::

Tres cosas que se ven en esta cuenta y que pasan igual en la ResNet-50:

- **Cada gradiente usa los valores del forward.** ∂L/∂w2 necesita h, y ∂L/∂w1 necesita x. Por eso al entrenar se guardan las activaciones.
- **El gradiente de una perilla del principio pasa por las de después.** ∂L/∂w1 se multiplicó por w2. Si las capas de después cambian, cambia la culpa de las de antes.
- **Se calcula una vez, de atrás para adelante,** y sirve para todas las perillas.

La forma de saber si una backpropagation está bien es compararla con lo que hiciste en la sección del gradiente: mover cada perilla un poquito y medir (*gradient checking*). En Python:

```python
def perdida(w1, w2, x=2.0, t=6.0):
    h = max(0.0, w1 * x)           # ReLU: los negativos se vuelven 0
    return (w2 * h - t) ** 2

w1, w2, x = 0.5, 2.0, 2.0
# backpropagation a mano: las mismas cuentas de la tabla
z = w1 * x
h = max(0.0, z)
y = w2 * h
dL_dy = 2 * (y - 6.0)
dL_dw2 = dL_dy * h
dL_dz = dL_dy * w2 * (1.0 if z > 0 else 0.0)
dL_dw1 = dL_dz * x
# la prueba: mover cada perilla un poquito para cada lado
e = 0.0001
num_w1 = (perdida(w1 + e, w2) - perdida(w1 - e, w2)) / (2 * e)
num_w2 = (perdida(w1, w2 + e) - perdida(w1, w2 - e)) / (2 * e)
print(f"dL/dw1:  backprop {dL_dw1:.4f}   moviendo la perilla {num_w1:.4f}")
print(f"dL/dw2:  backprop {dL_dw2:.4f}   moviendo la perilla {num_w2:.4f}")
```

```salida
dL/dw1:  backprop -32.0000   moviendo la perilla -32.0000
dL/dw2:  backprop -8.0000   moviendo la perilla -8.0000
```

### Cuando la ReLU se apaga

Cambia solo una cosa: w1 = −0.5. Entonces z = −0.5 × 2 = −1, la ReLU lo vuelve h = 0, y = 2 × 0 = 0 y la pérdida es 36. Hacia atrás: ∂L/∂y = 2 × (0 − 6) = −12, pero ∂L/∂w2 = −12 × h = −12 × 0 = **0**, y en la ReLU, como z es negativo, no pasa nada: ∂L/∂z = 0 y ∂L/∂w1 = **0**.

Los dos gradientes son 0: la pérdida es enorme y ninguna perilla se mueve. Se dice que esa ReLU está «muerta», al menos para este ejemplo. En una red grande le pasa a una parte de sus ReLU, y un learning rate demasiado grande puede apagar muchas de golpe.

### Gradientes que se apagan o explotan

En la ResNet-50 la culpa no pasa por dos eslabones sino por unas 50 capas, y en cada una se multiplica por su sensibilidad local. Multiplicar muchas veces es peligroso:

- Si cada capa multiplica el gradiente por 0.5, después de 20 capas queda multiplicado por 0.5²⁰ ≈ **0.00000095**, casi una millonésima. Las primeras capas casi no reciben señal y no aprenden: el gradiente **se apagó** (*vanishing gradient*).
- Si cada capa lo multiplica por 1.5, después de 20 capas queda multiplicado por 1.5²⁰ ≈ **3,325**. Los pasos se vuelven gigantes y aparece `NaN`: el gradiente **explotó** (*exploding gradient*).

A los dos problemas juntos se les llama [[gradiente-inestable|gradientes inestables]]. Fueron una de las razones por las que durante años no se podían entrenar redes profundas. Las funciones de activación de antes, como la sigmoide, multiplicaban el gradiente por 0.25 como mucho en cada capa: con diez capas, 0.25¹⁰ ≈ 0.00000095 otra vez. Hoy se combaten con varias piezas a la vez:

- **La ReLU**, que deja pasar el gradiente sin achicarlo cuando su entrada es positiva (multiplica por 1).
- **Buena inicialización** de las perillas, para que al principio cada capa ni agrande ni achique la señal.
- **[[batchnorm|BatchNorm]]**, que mantiene los números de cada capa en una escala razonable, y **las conexiones residuales** de la [[resnet|ResNet]], que le dan al gradiente un atajo directo hacia las primeras capas. Las ves en la lección de redes.
- **Recortar el gradiente** (*gradient clipping*): si el gradiente completo mide más que un tope, se escala para que mida el tope. Un gradiente (30, 40) mide √(30² + 40²) = 50; con tope 1 se multiplica por 1/50 y queda (0.6, 0.8): la misma dirección, con un paso controlado.
- **Un learning rate más chico al principio**, el *warmup* de la sección del learning rate en el tiempo.

:::nota Otro gradiente que se apaga: el de los números chicos
Al entrenar en precisión mixta (muchas cuentas en números de 16 bits; C01 lo hace con AMP, la precisión mixta automática de PyTorch), un gradiente muy pequeño puede redondearse a 0 porque ese formato no alcanza a representarlo. Por eso PyTorch multiplica la pérdida por un número grande antes de la backpropagation (al principio, 65,536) y divide el gradiente por lo mismo después. Lo hace una pieza llamada GradScaler, y su estado también se guarda en el checkpoint. Lo ves con calma en la lección «Cómo guarda números una computadora».
:::

## El optimizador: SGD, momentum y Adam {The optimizer: SGD, momentum and Adam}

La pieza que toma el gradiente y decide cuánto girar cada perilla se llama [[optimizador]]. Vas a oír tres nombres todo el tiempo.

### SGD: la regla tal cual

**SGD** (*stochastic gradient descent*, descenso de gradiente estocástico) es la regla que ya conoces, con el gradiente de un batch: perilla − lr × gradiente. Le cuestan los valles angostos: si el valle es empinado de lado y casi plano a lo largo, el gradiente apunta sobre todo a las paredes, y la perilla rebota de pared a pared avanzando poco. Y como cada batch da un gradiente un poco distinto, los pasos tiemblan.

### Momentum: arrastrar la dirección de antes

El [[momentum]] (inercia) arregla las dos cosas con una idea: cada paso arrastra parte de la dirección de los anteriores. Para cada perilla lleva una **velocidad** v:

> v nueva = 0.9 × v + gradiente, y luego: perilla nueva = perilla − lr × v nueva

El 0.9 es el valor usual y dice cuánto se recuerda del pasado.

:::ejemplo La velocidad, con números
**Un gradiente que insiste.** Si el gradiente es −5 en tres pasos seguidos, la velocidad va −5, luego 0.9 × (−5) − 5 = −9.5, luego 0.9 × (−9.5) − 5 = −13.55. Los pasos crecen: en una dirección constante, el momentum acelera hasta 10 veces el gradiente (porque 1 ÷ (1 − 0.9) = 10).

**Un gradiente que zigzaguea.** Si el gradiente es +10, −10, +10, la velocidad va 10, luego 0.9 × 10 − 10 = −1, luego 0.9 × (−1) + 10 = 9.1. El brinco de ida y vuelta casi se cancela en el segundo paso.
:::

:::analogia Una pelota que rueda
Una pelota que baja por una barranca no se detiene en cada piedrita, y en una bajada larga va cada vez más rápido. El descenso sin momentum es alguien que se para, siente el suelo y da un paso; con momentum, es la pelota.

**Dónde se rompe.** La pelota de verdad tiene peso y fricción; aquí el 0.9 es solo un número que decide cuánto se recuerda. Y como la pelota, una perilla con mucha inercia se puede pasar del fondo.
:::

### Adam: un paso a la medida de cada perilla

[[adam|Adam]] (Kingma y Ba, 2014) es el optimizador que más se usa por defecto, y el de C01. Para cada perilla lleva **dos** promedios:

- **m**, el promedio de sus gradientes recientes: hacia dónde ha empujado, como el momentum.
- **v**, el promedio de sus gradientes **al cuadrado**: qué tan grandes suelen ser.

El paso es lr × m ÷ √v. Dividir entre √v, que mide el tamaño típico del gradiente de esa perilla, **iguala los pasos**: una perilla con gradientes enormes y otra con gradientes chiquitos avanzan parecido, del orden del learning rate. Al principio m y v valen 0, así que Adam los corrige para que los primeros promedios no salgan demasiado chicos; a los ya corregidos se les escribe con gorrito, m̂ y v̂.

:::cuenta Un paso de Adam con dos perillas, lr = 0.0003
Gradiente de cada perilla // A muy empinada, B casi plana | A: 100 · B: 0.01 | 100 · 0.01
m // primer paso: 0.1 × gradiente | 0.1 × 100 · 0.1 × 0.01 | 10 · 0.001
v // primer paso: 0.001 × gradiente² | 0.001 × 100² · 0.001 × 0.01² | 10 · 0.0000001
m̂ // corrige el arranque: m ÷ 0.1 | 10 ÷ 0.1 · 0.001 ÷ 0.1 | 100 · 0.01
√v̂ // corrige el arranque: √(v ÷ 0.001) | √10,000 · √0.0001 | 100 · 0.01
Paso de Adam // lr × m̂ ÷ √v̂ | 0.0003 × 100 ÷ 100 · 0.0003 × 0.01 ÷ 0.01 | **0.0003 · 0.0003**
Paso de SGD, para comparar // lr × gradiente | 0.0003 × 100 · 0.0003 × 0.01 | 0.03 · 0.000003
= Con Adam las dos perillas avanzan **0.0003**. Con SGD, una avanzaría 10,000 veces más que la otra.
:::

En Python, el mismo primer paso (los números 0.9, 0.999 y 0.00000001 son los que trae Adam por defecto):

```python
import math

lr, b1, b2, eps = 0.0003, 0.9, 0.999, 1e-8
for g in [100.0, 0.01]:              # el gradiente de cada perilla
    m = (1 - b1) * g                 # primer paso: m y v arrancan en 0
    v = (1 - b2) * g ** 2
    m_hat = m / (1 - b1)             # corrección del arranque
    v_hat = v / (1 - b2)
    paso_adam = lr * m_hat / (math.sqrt(v_hat) + eps)
    print(f"gradiente {g:>6}:  SGD mueve {lr * g:.6f}   Adam mueve {paso_adam:.6f}")
```

```salida
gradiente  100.0:  SGD mueve 0.030000   Adam mueve 0.000300
gradiente   0.01:  SGD mueve 0.000003   Adam mueve 0.000300
```

Dos consecuencias prácticas. Con Adam, el learning rate es casi **cuánto se mueve cada perilla por paso**: con 0.0003, del orden de 0.0003. Y si el gradiente de una perilla cambia de signo a cada rato (puro ruido), m se cancela y el paso se achica solo. Por eso funciona bien sin tanto ajuste fino; PyTorch trae 0.001 por defecto y 0.0003 es otro punto de partida muy usado.

El precio: m y v son **dos números extra por perilla**, que viven en memoria todo el entrenamiento. En C01 son 24.5 millones × 2 = 49 millones de números más. El momentum de SGD pide uno; SGD solo, ninguno. Los vas a volver a ver en el checkpoint y en la memoria de la GPU.

### Parámetros contra hiperparámetros

Son dos palabras que se confunden mucho y que la Ronda usa a cada rato:

| | Parámetros | Hiperparámetros |
|---|---|---|
| Qué son | Las perillas del modelo | Las decisiones de cómo entrenar |
| Quién los decide | El entrenamiento, con el optimizador | Tú, antes de entrenar |
| Cuántos son | Millones (24.5 M en C01) | Unos cuantos |
| Ejemplos | Cada número de cada capa | Learning rate, tamaño del batch, épocas, optimizador, qué augmentations |
| Dónde quedan | En el archivo del modelo | En la configuración y en el registro del experimento |

Los [[hiperparametro|hiperparámetros]] de C01, según la Ronda: Adam, learning rate 3e-4, batch 64, 8 épocas y [[semilla]] 17 (el número que fija el azar del entrenamiento). ¿Cómo se eligen? Probando varias opciones y comparando cómo le va a cada una en **validación**, nunca en el test (ya viste por qué en la lección anterior).

## El learning rate en el tiempo, cuándo parar y cómo no memorizar {Schedules, warmup, early stopping and regularization} [extra]

### Un calendario para el learning rate

Un mismo learning rate de principio a fin casi nunca es lo mejor. Al principio conviene avanzar rápido; al final, dar pasos finos para asentarse en el fondo sin brincar de un lado al otro. El plan de cómo cambia se llama [[scheduler-lr|scheduler]] (calendario) del learning rate. Dos formas muy comunes:

- **Escalones.** Se divide entre 10 cuando la validación deja de mejorar. Así entrenaron la ResNet original en 2015: SGD con momentum 0.9, learning rate que empezaba en 0.1 y se dividía entre 10 al estancarse, batches de 256.
- **Coseno.** Baja suave, como media ola, desde el máximo hasta casi 0 al final: en el paso t de un total de T, lr = máximo × ½ × (1 + cos(π × t ÷ T)).

La Ronda no dice qué calendario usa C01, así que supón uno de coseno para hacer la cuenta: con máximo 0.0003 y 230,032 pasos, a la mitad (paso 115,016) el coseno vale 0, así que el lr es 0.0003 × ½ = 0.00015; a tres cuartos, 0.0003 × ½ × (1 − 0.707) ≈ 0.000044; al final, 0.

### Warmup: arrancar despacio

Los primeros pasos son los más peligrosos. Las perillas están lejos de lo bueno; si se estrena una última capa al azar, como en la primera versión de C01, sus gradientes son grandes y desordenados; y Adam todavía tiene muy pocos gradientes para promediar. Un paso grande ahí puede deshacer lo que el modelo ya sabía o hacer explotar la pérdida.

El [[warmup]] (calentamiento) empieza con un learning rate casi 0 y lo sube en línea recta durante los primeros cientos o miles de pasos. Con un warmup de 1,000 pasos hasta 0.0003: en el paso 100 vale 0.00003, en el 500 vale 0.00015 y en el 1,000 llega a 0.0003. Después sigue el calendario.

:::figura aprender-calendario
Un calendario típico: warmup en línea recta y luego coseno hasta 0. Comparado con un learning rate fijo, da pasos chicos al arrancar y al terminar.
:::

Un ejemplo famoso: en 2017, Goyal y otros, de Facebook, entrenaron una ResNet-50 con ImageNet en una hora, con batches de 8,192 fotos repartidos en 256 GPUs. Para que funcionara, subieron el learning rate en la misma proporción que el batch y lo calentaron durante las primeras 5 épocas; sin ese calentamiento, el modelo de batches gigantes salía peor que el de batches normales.

### Convergencia, con batches de verdad

En el juguete, la perilla se acerca al fondo y casi se queda quieta. Con batches al azar eso no pasa: cada batch da un gradiente un poco distinto, así que la pérdida **tiembla** alrededor de un nivel en vez de quedarse quieta. En la práctica se dice que un entrenamiento convergió cuando ese nivel deja de bajar: la pérdida de una época casi no mejora la de la anterior. Bajar el learning rate al final, con el calendario, reduce el temblor y deja asentarse en un punto más bajo.

Ojo con lo que dice y lo que no: que la pérdida de **entrenamiento** convergiera dice que el modelo terminó de aprender lo que podía de esas fotos. No dice que le vaya a ir bien con fotos nuevas. Eso solo lo dice la validación.

### Early stopping: parar cuando la validación deja de mejorar

Si se entrena demasiado, el modelo empieza a memorizar las fotos de train, con todo y sus casualidades, y empeora con fotos nuevas. Eso es [[overfitting]], y lo ves a fondo en la lección siguiente. Se nota en la validación: deja de bajar y empieza a subir, aunque la pérdida de train siga bajando.

El [[early-stopping|early stopping]] (parada temprana) mide la validación al final de cada época, guarda el [[checkpoint]] de la mejor y para si no mejora en N épocas seguidas. A esa N se le llama la *paciencia*.

:::ejemplo Paciencia de 2 épocas (números de ejemplo)
| Época | Pérdida en validación | ¿Mejoró? | Épocas sin mejorar |
|---|---|---|---|
| 3 | 0.95 | Sí | 0 |
| 4 | 0.88 | Sí | 0 |
| 5 | 0.86 | Sí: la mejor | 0 |
| 6 | 0.87 | No | 1 |
| 7 | 0.89 | No | 2: se para |

Se para al final de la época 7 y se usa el checkpoint de la época 5. Las épocas 6 y 7 se gastaron solo para estar seguros de que la 5 era el mejor momento.
:::

C01 entrena 8 épocas fijas, pero registra la validación de cada época: con esa curva se ve si alguna época anterior salió mejor o si convendría parar antes. Es la misma idea, revisada a mano.

### Regularización y weight decay

[[regularizacion|Regularización]] es todo lo que se hace para que el modelo no memorice: no busca bajar la pérdida de entrenamiento, a veces la sube a propósito, sino que le vaya bien con datos nuevos. Ya conoces dos: más datos o la [[augmentation]] (fotos volteadas, recortadas), y el early stopping. Otra es el [[dropout]], que apaga al azar algunas [[neurona|neuronas]] mientras entrena.

Otra muy usada vive dentro del optimizador: el [[weight-decay|weight decay]] (decaimiento de pesos). En cada paso, además del paso del gradiente, encoge cada perilla un poquito hacia 0:

> perilla nueva = perilla − lr × λ × perilla

λ (lambda) es otro hiperparámetro. La idea: una perilla solo se queda grande si el gradiente la sostiene, porque de verdad ayuda; las que no sirven se van apagando. Un modelo con perillas chicas suele ser más «suave» y memoriza menos.

:::ejemplo Cuánto encoge
Perilla w = 2, lr = 0.01, λ = 0.1. Cada paso le quita 2 × 0.01 × 0.1 = 0.002: queda en 1.998. Parece nada, pero se acumula: sin un gradiente que la sostenga, después de 1,000 pasos bajaría a 2 × 0.999¹⁰⁰⁰ ≈ **0.74**.
:::

Los valores típicos dependen del optimizador. La ResNet original usó λ = 0.0001 con SGD. Con Adam, sumar el encogimiento al gradiente no funciona igual, porque Adam lo divide entre √v; por eso existe **AdamW** (Loshchilov y Hutter), que lo aplica aparte. En PyTorch, AdamW trae λ = 0.01 por defecto.

## Checkpoints y semillas {Checkpoints and seeds} [extra]

Un entrenamiento de C01 dura horas. Si la máquina se apaga en la hora tres, ¿empiezas de cero? No, si guardaste un [[checkpoint]]: un archivo con todo el estado del entrenamiento en un momento dado. Lleva las perillas, el estado del optimizador (los dos promedios de Adam), la época y el paso, el estado del calendario del learning rate y el del azar.

¿Por qué se guarda a media corrida, y no solo al final?

- **Las máquinas fallan, o te las quitan.** En la nube (computadoras que se rentan por hora, por ejemplo a AWS, la de Amazon) hay máquinas mucho más baratas, llamadas *spot*, que el proveedor puede reclamar cuando las necesita (en AWS, con un aviso de apenas dos minutos). Con checkpoints, perder la máquina cuesta minutos, no la corrida entera.
- **Para quedarte con la mejor versión.** A veces la época 6 sale mejor en validación que la 8 (es el early stopping).
- **Para seguir después.** El modelo de C01 de cada mes empieza desde el que está en producción, no desde cero.

:::cuenta ¿Cuánto pesa un checkpoint de C01?
Las perillas // cada una en 4 bytes ([[float32]]) | 24.5 M × 4 B | 98 MB
Los dos promedios de Adam // m y v, uno por perilla cada uno | 2 × 98 MB | 196 MB
Checkpoint completo | 98 + 196 | **≈ 294 MB**
= C01 guarda uno cada 15 minutos. Si la máquina se cae, se pierden como mucho 15 minutos de trabajo.
:::

:::ojo
¿Por qué guardar también el estado del optimizador, si el modelo para responder solo necesita las perillas (los 98 MB)? Porque sin él, Adam vuelve a empezar sus promedios desde cero y los primeros pasos después de reanudar ya no son los que habría dado. Reanudar sin el estado completo no es seguir: es empezar algo un poco distinto.
:::

### Semillas: por qué dos corridas dan resultados distintos

Entrena dos veces el mismo modelo, con los mismos datos y la misma configuración, y no vas a obtener exactamente el mismo resultado, porque el entrenamiento tiene azar en varios lugares:

- Los valores iniciales de las perillas nuevas. Cuando el modelo de C01 se entrenó por primera vez a partir de un modelo genérico, su última capa, la de las 500 categorías, empezó con números al azar; y cuando se agrega una categoría, sus perillas nuevas también.
- El orden en que se revuelven las fotos en cada época, que cambia qué fotos van juntas en cada batch.
- Las variaciones de la augmentation: qué foto se voltea, cuánto se recorta.
- El dropout, si el modelo lo usa.

Una computadora no tira dados de verdad: genera números que parecen al azar a partir de un número inicial, la [[semilla]] (*seed*). Con la misma semilla sale exactamente la misma secuencia de «azares». C01 fija la semilla 17.

:::nota La semilla no se «busca»
La semilla se anota con los hiperparámetros, pero no se elige probando. Entrenar con diez semillas y quedarte con la que mejor salió es elegir por suerte, no por mérito.
:::

Pero en una GPU, ni con la misma semilla sale idéntico: hace millones de sumas en paralelo, no siempre en el mismo orden, y con decimales el orden de una suma puede cambiar un poquito el resultado. Repetido millones de veces, dos entrenamientos se separan un poco (el ejemplo con números está en la sección de la máquina).

¿Cuánto se separan? La Ronda trae un ejemplo con números ilustrativos: la misma receta de C01 entrenada con 5 semillas da 85.21 %, 85.34 %, 85.12 %, 85.29 % y 85.18 % de aciertos en el [[golden-set|golden set]]. El promedio es 426.14 ÷ 5 ≈ 85.23 %, y entre el mejor y el peor hay 85.34 − 85.12 = 0.22 **puntos porcentuales** (puntos de diferencia entre dos porcentajes). La lección: si dos corridas difieren en 0.2 puntos, eso no dice nada; puede ser pura semilla. Por eso «reproducible», en producción, quiere decir «el mismo resultado dentro del ruido», no idéntico.

## La máquina que entrena: CPU, GPU y VRAM {The machine that trains: CPU, GPU and VRAM} [extra]

### Por qué una GPU

Casi todo el trabajo de esta lección, el forward pass y la backpropagation, es una sola operación: **multiplicar dos números y sumar el resultado**, repetida miles de millones de veces sobre tablas enormes. El paso de Adam, en comparación, es poquito. Hay dos tipos de chip para hacerlo:

- La [[cpu|CPU]], el procesador normal de una computadora, tiene pocos núcleos muy capaces: de 8 a 16 en una laptop, decenas en un servidor. Cada uno hace cualquier tipo de trabajo, muy rápido, uno tras otro.
- La [[gpu|GPU]] tiene miles de núcleos sencillos que hacen **la misma operación sobre muchos números a la vez**. La T4 con la que C01 sirve su modelo tiene 2,560 núcleos CUDA (los núcleos normales de una GPU de NVIDIA) y 320 *tensor cores*, núcleos especiales para multiplicar tablas de números.

Para multiplicar y sumar tablas, la GPU gana por mucho. Por eso el entrenamiento de C01 tarda horas en una GPU, y en una CPU tardaría de días a semanas, según cuántos núcleos tenga la máquina. Lo ves a fondo en la lección «CPU y GPU».

:::diagrama aprender-maquina
Dónde pasa cada parte de un paso. Sigue «Un paso, en la máquina», luego «Qué ocupa la VRAM» y «Si la CPU no alcanza».
:::

La CPU no sobra: lee las fotos, las decodifica y les aplica la augmentation mientras la GPU calcula el batch anterior. Si la CPU tarda más en preparar un batch que la GPU en calcularlo, la GPU se queda esperando.

### Por qué en una GPU no sale idéntico

Sumar en paralelo tiene una consecuencia rara. Con números [[float32]], que guardan unos 7 dígitos significativos, el orden de una suma importa:

- (100,000,000 + 1) − 100,000,000 da **0**, porque 100,000,001 no cabe y se redondea a 100,000,000 antes de restar.
- (100,000,000 − 100,000,000) + 1 da **1**.

La misma cuenta en otro orden da otro resultado. La GPU reparte cada suma grande entre miles de núcleos y no siempre las junta en el mismo orden, así que dos corridas con la misma semilla se separan un poquito. Por eso la Ronda define «reproducible» como «dentro del ruido medido entre semillas».

:::ejemplo Responder contra entrenar, en C01
**Responder (inferencia).** Una foto, un forward pass. La ResNet-50 hace unos 4,100 millones de multiplicaciones con su suma por foto. En la GPU de producción de C01, ese cálculo tarda del orden de 3 a 6 milisegundos.

**Entrenar.** Cada foto de train pasa por el modelo una vez por época:

- 1,840,211 fotos × 8 épocas = 14,721,688 pasadas.
- Cada una con forward pass y backpropagation, que cuesta unas 3 veces un forward pass solo: ≈ 44 millones de «respuestas» de trabajo.

La Ronda dice que el entrenamiento mensual de C01 tarda unas 3 a 4 horas en una GPU y cuesta del orden de US$10 a 50. Haz la cuenta al revés: 4 horas son 4 × 3,600 = 14,400 segundos, y 14,721,688 ÷ 14,400 ≈ 1,000 fotos por segundo. Es la velocidad que tiene que sostener la GPU. Es razonable para una GPU moderna, pero varía mucho con el modelo de GPU y la configuración: tómala como un orden de magnitud, no como un dato.
:::

### Lo que tiene que caber en la VRAM

La GPU solo calcula con lo que está en su propia memoria, la [[vram|VRAM]]: 16 GB en una T4, 24 GB en una L4 o una A10G, 80 GB en una H100. Al entrenar tienen que caber, a la vez:

- **Las perillas.**
- **El gradiente** de cada perilla.
- **El estado del optimizador**: con Adam, m y v.
- **Las activaciones** de cada capa, guardadas para la backpropagation. Crecen con el tamaño del batch.

Y aparte de eso, el *runtime*: lo que ocupan CUDA (el software de NVIDIA para programar la GPU) y sus librerías en cuanto arrancan, de 0.3 a 1 GB, antes de guardar un solo número del modelo.

Las tres primeras de la lista son fijas: dependen solo de cuántas perillas tiene el modelo y de cuántos bytes ocupa cada número. Con Adam en precisión mixta, la cuenta clásica (la del artículo de ZeRO, de Rajbhandari y otros, 2020) da **≈ 16 bytes por parámetro**: 2 de la perilla en 16 bits, 2 de su gradiente en 16 bits y 12 que se guardan en float32: una copia exacta de la perilla, m y v. Para responder en [[fp16|FP16]] (números de 16 bits, 2 bytes), en cambio, bastan 2 bytes por parámetro: entrenar pide **8 veces** más memoria fija que servir.

:::figura aprender-memoria
Lo que ocupa cada parámetro según lo que hagas con él. Entrenar con Adam pide 16 bytes, con o sin precisión mixta; servir en FP16, 2.
:::

:::cuenta La memoria de entrenar C01, contra la de servirlo
Lo fijo para entrenar // perillas, gradientes, m y v | 24.5 M × 16 B | ≈ 392 MB
Activaciones con batch 64 // estimación: ≈ 11 M números por foto, guardados ≈ 2 veces, en 2 bytes | 64 × ≈ 44 MB | ≈ 3 GB
Entrenar, sin contar el runtime | 0.39 + 3 | ≈ 3.4 GB
Servir: solo los pesos en FP16 | 24.5 M × 2 B | ≈ 49 MB
= En una red para fotos como la de C01 (una [[cnn|CNN]]), lo que más ocupa al entrenar son las **activaciones**, y todo cabe holgado en una GPU de 16 GB. La cifra de activaciones es una estimación: se mide con `torch.cuda.max_memory_allocated()`.
:::

En un LLM la historia cambia: un modelo de 8,000 millones de parámetros pide 8 × 10⁹ × 16 B = **128 GB** solo de lo fijo, más de lo que tiene una H100. Lo vas a ver en la [lección de LLMs](/llms/), junto con la salida más común: [[lora|LoRA]], que deja quietas las perillas originales y entrena solo unas tablas chiquitas.

:::calculadora aprender-memoria
Arranca con los números de C01. Luego escribe 8000 millones de parámetros y 0 GB de activaciones, y mira cuántas GPUs de 80 GB pediría solo lo fijo.
:::

## Errores comunes {Common mistakes}

1. **Un learning rate demasiado grande.** La pérdida sube, brinca o llega a `NaN`. *Cómo evitarlo:* empieza con un valor conocido para tu optimizador (con Adam, del orden de 0.0001 a 0.001), mira la pérdida desde los primeros cientos de pasos y prueba dividir o multiplicar por 3; usa warmup.
2. **Olvidar borrar el gradiente.** PyTorch **suma** cada gradiente nuevo al que ya había. Sin `optimizador.zero_grad()` en cada paso, cada paso usa la suma de todos los anteriores. *Cómo evitarlo:* un zero_grad por vuelta, como en el loop de la sección de backpropagation.
3. **Darle probabilidades a una pérdida que espera logits.** En PyTorch, `cross_entropy` aplica el softmax por dentro. Si le pasas probabilidades, se aplica dos veces: entrena, pero peor, y no sale ningún error. *Cómo evitarlo:* la última capa saca logits; el softmax se aplica solo al responder.
4. **Juzgar el modelo por la pérdida de entrenamiento.** Baja casi siempre, también cuando el modelo memoriza. *Cómo evitarlo:* mide la validación al final de cada época y quédate con el mejor checkpoint.
5. **Reanudar solo con los pesos.** Sin el estado de Adam, del calendario del learning rate y del azar, el entrenamiento reanudado es otro. *Cómo evitarlo:* checkpoint completo: perillas, optimizador, scheduler, GradScaler si usas precisión mixta, época, paso y generadores de azar.
6. **Calcular la memoria solo con los pesos.** 98 MB de pesos no son 98 MB para entrenar. *Cómo evitarlo:* ≈ 16 bytes por parámetro con Adam, más las activaciones; mídelo con `torch.cuda.max_memory_allocated()`. Si no cabe, baja el batch.
7. **Cambiar el batch sin revisar el learning rate.** Un batch 4 veces más grande da 4 veces menos pasos por época y un gradiente menos ruidoso: el learning rate que servía puede quedar chico o grande. *Cómo evitarlo:* trátalos juntos. Para SGD, una regla de partida es escalar el learning rate en proporción al batch, con warmup (Goyal y otros, 2017); con Adam, vuelve a probar en validación.

## En la vida real {In real life} [extra]

### C01: un fine-tune al mes

Cada mes, C01 parte del modelo que está en producción y lo ajusta con las fotos nuevas: Adam con lr 3e-4, batches de 64, 8 épocas (28,754 pasos cada una), semilla 17 y precisión mixta. Guarda un checkpoint de ≈ 294 MB cada 15 minutos, tarda unas 3 a 4 horas en una GPU y cuesta del orden de US$10 a 50. Registra la pérdida y la validación de cada época, y el modelo nuevo solo pasa a producción si **no es peor** que el actual en el golden set. Como arranca de un modelo que ya sabe, su pérdida no empieza en 6.21: eso solo le pasó a la primera versión, cuando su última capa era nueva.

### C14: pronosticar demanda, donde la pérdida decide qué predices

Un supermercado pronostica, para cada tienda y producto, cuánto se va a vender en los próximos 14 días: ≈ 4.8 millones de series. Es una regresión, y con MSE el modelo aprendería el **promedio**. Pero el sistema de pedidos necesita dos números: uno central y uno alto, que alcance 9 de cada 10 días, para el colchón. Pasarse con un fresco cuesta merma (lo que se tira); quedarse corto cuesta una venta perdida. Los costos no son iguales, y el MSE los trata igual.

Por eso C14 entrena dos modelos con una pérdida de **cuantiles** (*pinball*): una para el P50, el valor de en medio, y otra para el P90. La del P90 castiga distinto cada lado: si se vende 2 kg más de lo pronosticado, la pérdida es 0.9 × 2 = 1.8; si se vende 15 kg menos, es 0.1 × 15 = 1.5. Quedarse corto pesa 9 veces más que pasarse, y el modelo aprende a pronosticar alto.

El modelo no es una red sino *gradient boosting*: muchos árboles de decisión (cadenas de preguntas de sí o no, como «¿es fin de semana?», que terminan en un número), cada uno agregado para corregir lo que les faltó a los anteriores, en la dirección contraria al gradiente de la pérdida. Con MSE, ese gradiente es el error de cada fila (por 2), así que cada árbol nuevo aprende a predecir lo que los anteriores fallaron. Es descenso de gradiente con árboles en vez de perillas. Y se entrena en CPU, no en GPU: ≈ 490 millones de filas en una máquina de 96 vCPU (núcleos virtuales), unas 2 a 3 horas cada domingo.

### C15: la probabilidad de un clic, entropía cruzada con dos respuestas

Un medio de noticias decide qué anuncio mostrar multiplicando lo que paga cada anunciante por la probabilidad de clic que predice el modelo (pCTR). La respuesta es sí o no, y la pérdida es la entropía cruzada de dos clases, la *log loss*: si hubo clic, −ln(p); si no, −ln(1 − p).

- El CTR (*click-through rate*: de cada 100 anuncios mostrados, en cuántos se da clic) promedio es ≈ 0.35 %. Si el modelo dice 0.35 % y sí hubo clic: −ln(0.0035) ≈ 5.65. Si no hubo clic: −ln(0.9965) ≈ 0.0035.
- Decir 0.35 % para todo da una log loss promedio de 0.02329. Un modelo con 0.0210 tiene una *normalized entropy* (NE) de 0.0210 ÷ 0.02329 ≈ 0.90: ≈ 10 % mejor que adivinar el promedio.

Aquí las probabilidades honestas son dinero: el precio que paga el anunciante depende del pCTR, así que un pCTR inflado cobra de menos. El modelo se reentrena cada día partiendo del de ayer, con sus pesos **y el estado de su optimizador**, igual que al reanudar desde un checkpoint. Reentrenar seguido paga: en el estudio de Facebook que cita la Ronda (He y otros, 2014), pasar de entrenar cada semana a cada día mejoró la NE ≈ 1 %, en sus datos.

### C10: la escala de preentrenar un LLM

C10 sirve un [[llm|LLM]] abierto de ≈ 70,600 millones de parámetros en GPUs H100 (la Ronda hace las cuentas con la arquitectura de Llama 3.3 70B, de Meta). No lo entrena: el modelo ya viene entrenado por otros, y verlo en números explica por qué.

- Según Meta, se preentrenó con ≈ 15 billones (15 × 10¹²) de [[token|tokens]], los pedazos de texto que lee un LLM, y el de 70B usó ≈ 7 millones de horas de GPU H100.
- Una regla común para LLMs: entrenar cuesta ≈ 6 operaciones por parámetro por token, contando cada multiplicación y cada suma por separado (2 del forward y 4 de la backpropagation). Para este modelo: 6 × 70.6 × 10⁹ × 15 × 10¹² ≈ **6.4 × 10²⁴** operaciones.
- Con 1,000 H100 trabajando a la vez, 7 millones de horas serían 7,000 horas: casi 10 meses.
- Solo ajustarlo completo con Adam pediría 70.6 × 10⁹ × 16 B ≈ **1.13 TB** de lo fijo: al menos 15 H100 de 80 GB antes de contar activaciones. Servirlo en FP8 (1 byte por parámetro) ocupa ≈ 70.6 GB.

### Fuera de ML: la regadera

:::analogia El learning rate de la regadera
Abres la regadera y sale fría. Giras la llave hacia lo caliente: si la giras un poquito, tardas mucho en llegar a la temperatura buena; si la giras de golpe, te pasas a hirviendo, regresas de golpe y acabas brincando de fría a caliente. Es el learning rate muy chico, bien y muy grande de la tabla.

**Dónde se rompe.** En la regadera sientes la temperatura directo y mueves una sola llave. Un modelo mueve millones a la vez y solo «siente» un promedio de 64 fotos. Y en la regadera parte del brinco viene de que el agua tarda en llegar; en el descenso de gradiente, el paso se pasa del fondo en ese mismo instante.
:::

## Ejercicios {Exercises}

Intenta cada uno con lápiz antes de abrir la solución.

:::ejercicios
? [facil] El modelo le da 25 % a la categoría correcta. ¿Cuál es su pérdida? Si después de entrenar le da 50 %, ¿cuánto bajó?
- Antes: −ln(0.25) ≈ 1.386.
- Después: −ln(0.50) ≈ 0.693.
- Bajó exactamente a la mitad: 1.386 ÷ 2 = 0.693. Pasa porque 0.25 = 0.5 × 0.5, y el logaritmo convierte esa multiplicación en una suma: ln(0.25) = 2 × ln(0.5).
? [facil] Un modelo predice 10, 12 y 8 minutos de entrega, y los pedidos tardaron 11, 15 y 8. ¿Cuál es el MSE?
- Errores: 10 − 11 = −1, 12 − 15 = −3 y 8 − 8 = 0.
- Al cuadrado: 1, 9 y 0. Suma: 10.
- MSE: 10 ÷ 3 ≈ **3.33** minutos al cuadrado. Su raíz, √3.33 ≈ 1.83 minutos, es el RMSE.
? [facil] Una perilla vale 1.5, su gradiente es 4 y el learning rate es 0.1. ¿Cuánto vale después de un paso de descenso de gradiente? ¿Hacia dónde se movió y por qué?
- Perilla nueva = 1.5 − 0.1 × 4 = 1.5 − 0.4 = **1.1**.
- Bajó. El gradiente positivo dice que subir la perilla sube la pérdida, así que hay que moverla en contra: hacia abajo.
? [facil] Tienes 120,000 fotos de train y batches de 256. ¿Cuántos pasos hay por época? ¿Y en 5 épocas?
- 120,000 ÷ 256 = 468.75: 468 batches completos (119,808 fotos) y uno más con las 192 que sobran.
- **469 pasos por época**, redondeando hacia arriba. En 5 épocas, 469 × 5 = **2,345** (o 468 × 5 = 2,340 si se tira el batch incompleto).
? [medio] Usa la regla de la cadena: u = 5 × x − 2 y y = 4 × u. ¿Cuánto cambia y por cada pedacito que cambie x? Compruébalo moviendo x de 1 a 1.01.
- Cada eslabón: u cambia 5 por cada unidad de x; y cambia 4 por cada unidad de u.
- La cadena: 4 × 5 = **20**.
- Con x = 1: u = 3 y y = 12. Con x = 1.01: u = 3.05 y y = 12.2. Cambió 0.2 por un cambio de 0.01: 0.2 ÷ 0.01 = 20.
? [medio] En la parábola de la lección (pérdida 4 × (w − 3)², perilla que empieza en 0), ¿dónde queda la perilla después de 2 pasos con lr = 0.1? ¿Con qué learning rate rebotaría para siempre?
- El factor por paso es 1 − 8 × 0.1 = 0.2.
- La distancia al fondo empieza en −3 y en dos pasos queda en −3 × 0.2 × 0.2 = −0.12. La perilla queda en 3 − 0.12 = **2.88**.
- Rebota para siempre cuando el factor es exactamente −1: 1 − 8 × lr = −1, o sea lr = **0.25**. La perilla brinca entre 0 y 6, y la pérdida se queda en 36.
? [medio] Dos perillas tienen gradientes 50 y −0.5 en el primer paso. ¿Cuánto se mueve cada una con SGD y con Adam, los dos con lr = 0.001?
- SGD: 0.001 × 50 = 0.05 y 0.001 × (−0.5) = −0.0005. La primera baja 0.05; la segunda sube 0.0005: cien veces menos.
- Adam, primer paso: después de corregir el arranque, m̂ es el gradiente y √v̂ su tamaño, así que el paso es lr × gradiente ÷ tamaño del gradiente = 0.001 con el signo del gradiente.
- La primera baja **0.001** y la segunda sube **0.001**: el mismo tamaño de paso.
? [medio] Quieres ajustar completo, con Adam en precisión mixta, un modelo de 1,000 millones de parámetros en una L4 de 24 GB. ¿Cuánta memoria fija pide? ¿Cuánto ocuparía solo para servirlo en FP16?
- Lo fijo: 1,000,000,000 × 16 B = **16 GB**.
- En la L4 quedarían ≈ 8 GB para las activaciones y el runtime (≈ 0.3 a 1 GB). Cabe, pero con un batch chico: con un modelo así, las activaciones de un batch grande pasan fácil de 8 GB.
- Servir en FP16: 1,000,000,000 × 2 B = **2 GB** de pesos. Ocho veces menos.
? [reto] En la red y = w2 × ReLU(w1 × x), con x = 2, respuesta correcta 1, w1 = 1 y w2 = 1.5, calcula todos los gradientes con backpropagation, da un paso con lr = 0.01 y di si la pérdida bajó.
- Forward: z = 1 × 2 = 2; h = ReLU(2) = 2; y = 1.5 × 2 = 3; L = (3 − 1)² = **4**.
- ∂L/∂y = 2 × (3 − 1) = 4.
- ∂L/∂w2 = 4 × h = 4 × 2 = **8**.
- ∂L/∂h = 4 × w2 = 4 × 1.5 = 6; como z > 0, ∂L/∂z = 6.
- ∂L/∂w1 = 6 × x = 6 × 2 = **12**.
- Paso: w1 = 1 − 0.01 × 12 = 0.88 y w2 = 1.5 − 0.01 × 8 = 1.42.
- Nuevo forward: z = 1.76, h = 1.76, y = 1.42 × 1.76 ≈ 2.499, L = (2.499 − 1)² ≈ **2.25**. Bajó de 4 a 2.25: los gradientes eran positivos porque el modelo predecía de más, y las dos perillas bajaron.
? [reto] Otra parábola, mucho más empinada: pérdida 25 × (w − 1)². ¿A partir de qué learning rate diverge el descenso de gradiente? ¿Qué te dice eso de un modelo con millones de perillas?
- El gradiente es 2 × 25 × (w − 1) = 50 × (w − 1). Cada paso: distancia nueva = (1 − 50 × lr) × distancia.
- Diverge si el factor sale de [−1, 1]: 1 − 50 × lr < −1, o sea **lr > 0.04**. En la parábola de la lección (gradiente 8 × (w − 3)) el límite era 0.25.
- Un modelo real tiene direcciones planas y direcciones muy empinadas a la vez, y un solo learning rate tiene que servir para todas. Lo fija la más empinada, y las planas avanzan lento. Adam lo corrige en parte, al dar a cada perilla un paso a la medida de su gradiente.
:::

## Lo que sigue {What comes next}

- **M04 · Hardware para inferencia** hace las cuentas de memoria de la GPU para servir: pesos (2 bytes por parámetro en FP16), activaciones, runtime y margen, para ver qué cabe en una T4, una L4 o una H100. Los ≈ 16 bytes por parámetro de entrenar con Adam (el artículo de ZeRO) los menciona en una nota.
- **M10 · MLOps** registra cada entrenamiento con sus hiperparámetros (lr, épocas, semilla) y su validación por época, guarda el checkpoint de 294 MB cada 15 minutos para poder usar máquinas spot (más baratas, pero el proveedor te las puede quitar), y explica por qué en GPU «misma semilla» no alcanza.
- **El caso C01** describe el reentrenamiento mensual: un fine-tune desde el modelo en producción, unas horas en una GPU, con precisión mixta, semillas y configuración fijadas, que solo pasa a producción si no empeora en el golden set.
- **Los casos C14 y C15** eligen su pérdida por el negocio: cuantiles para el colchón de inventario y log loss calibrada para cobrar bien un clic.
- **M03 · Latencia y capacidad** y **M07 · Servidores de modelos** usan «batch» en el otro sentido: el dynamic batching de Triton, que junta peticiones en inferencia.
- **En el Dojo**, la estación 3, «Entrenamiento», es la de esta lección; todavía está en preparación.
- **En Sensei**, «¿Aprendió de verdad?» mide si lo que aprendió sirve con fotos nuevas (overfitting, curvas, métricas); «Redes neuronales y CNNs» abre las capas por las que pasa la backpropagation; «Cómo guarda números una computadora» explica FP16, BF16 y la precisión mixta; y «CPU y GPU» abre la máquina.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
loss entropia-cruzada mse gradiente descenso-gradiente learning-rate convergencia forward-pass regla-cadena backpropagation gradiente-inestable batch paso epoch optimizador momentum adam hiperparametro scheduler-lr warmup early-stopping regularizacion weight-decay checkpoint semilla cpu gpu vram
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? El modelo le da 30 % a la categoría correcta. ¿Cuál es su pérdida? ¿Y si después de entrenar le da 60 %?
−ln(0.30) ≈ 1.20. Con 60 %: −ln(0.60) ≈ 0.51. La pérdida bajó a menos de la mitad, aunque en los dos casos el modelo podría estar acertando o no, según cuánto les dé a las demás categorías.
? El gradiente de una perilla es +5 y el learning rate es 0.01. ¿Hacia dónde se mueve la perilla, y cuánto?
Hacia abajo, en contra del gradiente: perilla nueva = perilla − 0.01 × 5 = perilla − 0.05. Gradiente positivo quiere decir que subir la perilla sube la pérdida, así que hay que bajarla.
? La pérdida sube en cada paso y termina en NaN. ¿Qué sospechas primero?
Un learning rate demasiado grande: cada paso se pasa del fondo del valle al otro lado, cada vez más lejos, hasta que los números crecen tanto que la computadora ya no los puede representar.
? ¿Qué hace la backpropagation, en una frase?
Aplica la regla de la cadena de la pérdida hacia atrás: multiplica la sensibilidad de cada capa para obtener, en una sola pasada, el gradiente de todas las perillas.
? ¿Por qué Adam ocupa más memoria que SGD?
Porque guarda dos números por perilla, el promedio de sus gradientes (m) y el de sus gradientes al cuadrado (v). En C01 son 49 millones de números, ≈ 196 MB en float32. SGD solo no guarda nada extra; con momentum, uno por perilla.
? Entrenas dos veces con la misma configuración y sale 85.3 % y 85.1 %. ¿El segundo modelo es peor?
No se puede decir. El entrenamiento tiene azar (perillas iniciales, orden de las fotos, augmentation, sumas en paralelo en la GPU) y, con números como los de la Ronda, la diferencia entre semillas ya es de unos 0.2 puntos. Para comparar recetas hay que medir cuánto varía el resultado entre semillas.
? ¿Por qué un checkpoint de C01 pesa ≈ 294 MB si el modelo solo pesa 98 MB?
Porque además de las perillas guarda el estado de Adam: dos promedios por perilla, 2 × 98 MB = 196 MB. Sin ellos, reanudar no sería seguir el mismo entrenamiento.
:::
