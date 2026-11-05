---
titulo: Redes neuronales y CNNs
en: Neural networks and CNNs
subtitulo: Qué hay dentro de la ResNet-50 de C01, desde una sola neurona hasta el modelo completo, y por qué se empieza con un modelo que ya vio más de un millón de fotos.
pregunta: ¿Qué es exactamente una «red neuronal» y por qué funciona tan bien con fotos?
minutos: 32
requisitos: aprender
---

:::idea
Una red neuronal es una pila de capas que hacen cuentas muy simples (multiplicar, sumar y quitar los negativos), repetidas millones de veces. Una CNN mira la foto por pedacitos, con el mismo filtro en todas partes, y por eso reconoce un tenis esté donde esté.
:::

## Una neurona, con números {One neuron, with numbers}

En las lecciones anteriores viste que un modelo es una función con [[parametro|parámetros]] y que entrenar es ajustarlos. Ahora vamos a abrir la caja: ¿qué cuentas hace por dentro?

La pieza más chica es la [[neurona]]. Hace tres cosas:

:::pasos
1. Multiplica cada entrada por su peso
Recibe varios números de entrada y a cada uno lo multiplica por un número propio, su **peso** (*weight*). El peso dice qué tanto le importa esa entrada, y si la cuenta a favor (positivo) o en contra (negativo).
2. Suma todo y le agrega su sesgo
Suma esos productos y les agrega otro número propio, el **sesgo** (*bias*), que mueve el resultado hacia arriba o hacia abajo.
3. Pasa el resultado por una activación
Al final aplica una función sencilla, la [[activacion|activación]], que decide qué sale. La más usada es la [[relu|ReLU]]: si el número es negativo, sale 0; si no, sale igual.
:::

:::figura redes-neurona
Una neurona con tres entradas. Los pesos (en amarillo) y el sesgo son sus parámetros: lo que el entrenamiento ajusta.
:::

:::ejemplo La cuenta de la figura
Entradas: 0.5, 0.8 y 0.2. Pesos: 2, −1 y 3. Sesgo: 0.1.

- Multiplicar: 0.5 × 2 = 1.0, 0.8 × (−1) = −0.8 y 0.2 × 3 = 0.6.
- Sumar y agregar el sesgo: 1.0 − 0.8 + 0.6 + 0.1 = **0.9**.
- ReLU: 0.9 no es negativo, así que sale **0.9**.

Si la segunda entrada fuera 2.0 en lugar de 0.8: 1.0 − 2.0 + 0.6 + 0.1 = −0.3. Es negativo, así que la ReLU deja salir **0**. Se dice que la neurona «no se activó».

Esta neurona tiene 4 parámetros: 3 pesos (uno por entrada) y 1 sesgo.
:::

:::ojo
El «sesgo» de aquí (*bias*, el número que se suma) no tiene nada que ver con el sesgo de la lección anterior (*bias* contra *variance*, el error de un modelo demasiado simple). En inglés se llaman igual y son cosas distintas; el contexto dice cuál es.
:::

### ¿Para qué la activación?

Parece un detalle, pero sin ella nada funcionaría. Sin activación, una neurona solo multiplica y suma: es una función lineal, una recta. Y si apilas rectas, sale otra recta. Por ejemplo, si una capa hace y = 3x + 1 y la siguiente hace z = 2y − 1, juntas hacen z = 2 × (3x + 1) − 1 = 6x + 1. Otra recta. Cien capas sin activación valen lo mismo que una.

La activación dobla la recta. La ReLU la dobla en el 0: todo lo negativo se aplana. Con muchas neuronas, cada una doblada en un lugar distinto, la red puede formar curvas tan complicadas como haga falta, como la frontera que separa «foto de tenis» de «foto de bota».

:::analogia ¿Por qué «neurona»?
El nombre viene de las neuronas del cerebro: reciben señales de otras y, si la suma pasa de cierto nivel, «disparan». La ReLU se parece: si la suma es negativa, no sale nada.

**Dónde se rompe:** la neurona artificial es solo una multiplicación y una suma; una neurona real es una célula muchísimo más compleja. Una red neuronal no es un cerebro ni funciona como uno. Es una función matemática que tomó el nombre de una inspiración de hace décadas.
:::

## Capas, redes y por qué «deep» {Layers, networks and why «deep»}

Una neurona sola hace poco. Se juntan muchas en una [[capa]]: todas reciben las mismas entradas, cada una con sus propios pesos, y cada una saca un número. Las salidas de una capa son las entradas de la siguiente. Eso es una [[red-neuronal|red neuronal]].

Usar redes con muchas capas es lo que se llama [[deep-learning|deep learning]] (aprendizaje profundo): «profundo» se refiere a la cantidad de capas, no a nada filosófico. Cada capa trabaja sobre lo que encontró la anterior, así que entre más capas, más pasos para combinar cosas simples en cosas complicadas. La ResNet-50 de C01 tiene 50 capas con pesos.

### Un forward pass con lápiz

Hacer pasar una entrada por todas las capas, de la primera a la última, se llama [[forward-pass|forward pass]] (pasada hacia adelante). Es lo que hace el modelo cada vez que responde. Hagamos uno a mano en una red de juguete: **2 entradas → 3 neuronas con ReLU → 2 salidas**, una para «Tenis» y otra para «Botas».

:::ejemplo Una red de juguete, de punta a punta
Entradas: **1** y **2**.

**Capa 1.** Tres neuronas, cada una con 2 pesos y 1 sesgo:

| Neurona | Pesos | Sesgo | Suma | Después de la ReLU |
|---|---|---|---|---|
| h1 | 0.5 y −1 | 1 | 1 × 0.5 + 2 × (−1) + 1 = −0.5 | **0** |
| h2 | 1 y 0.5 | 0 | 1 × 1 + 2 × 0.5 + 0 = 2 | **2** |
| h3 | −1 y 1 | 0.5 | 1 × (−1) + 2 × 1 + 0.5 = 1.5 | **1.5** |

**Capa 2.** Dos salidas, cada una con 3 pesos (uno por neurona de la capa 1) y 1 sesgo, sin ReLU:

| Salida | Pesos | Sesgo | Suma |
|---|---|---|---|
| Tenis | 2, 1 y 1 | −0.5 | 0 × 2 + 2 × 1 + 1.5 × 1 − 0.5 = **3.0** |
| Botas | 1, 0 y 0.5 | 0.25 | 0 × 1 + 2 × 0 + 1.5 × 0.5 + 0.25 = **1.0** |

Esos dos números, 3.0 y 1.0, son los [[logit|logits]]. El [[softmax]] los convierte en probabilidades: e³ ≈ 20.09 y e¹ ≈ 2.72, que suman 22.81. Tenis: 20.09 / 22.81 ≈ **88 %**. Botas: 2.72 / 22.81 ≈ **12 %**.
:::

Eso es todo lo que hace una red al responder: multiplicar, sumar y aplicar la activación, capa por capa. La ResNet-50 hace lo mismo con la foto de Ana, solo que con unos 4,100 millones de multiplicaciones (cada una con su suma) en lugar de una docena.

### Contar parámetros

Los parámetros de una red son todos sus pesos y todos sus sesgos. En la red de juguete:

- Capa 1: 2 entradas × 3 neuronas = 6 pesos, más 3 sesgos = **9**
- Capa 2: 3 entradas × 2 salidas = 6 pesos, más 2 sesgos = **8**
- Total: 9 + 8 = **17 parámetros**

La regla sirve para cualquier capa de este tipo, que se llama *densa* o *totalmente conectada* porque cada neurona ve todas las entradas: **entradas × salidas + salidas**. La última capa de la ResNet-50 de C01 recibe 2,048 números y saca 500: 2,048 × 500 + 500 = 1,024,500 parámetros, solo esa capa.

Contar parámetros no es un juego: cada uno ocupa memoria. Guardado como [[float32]] ocupa 4 bytes, así que los 25.6 millones de una ResNet-50 son 25.6 M × 4 B ≈ 102 MB. Es la primera cuenta que hace la Ronda en M04 para saber cuánta memoria de GPU necesita el modelo.

## Convolución: un filtro que recorre la foto {Convolution: a filter that slides over the photo}

¿Por qué no meter la foto directo a una red como la de juguete? Hagamos la cuenta. Una foto de 224 × 224 [[pixel|píxeles]] con 3 colores son 224 × 224 × 3 = 150,528 números. Una sola capa densa de 1,000 neuronas sobre ellos necesitaría 150,528 × 1,000 ≈ **150 millones de pesos**: casi 6 veces la ResNet-50 entera, en una sola capa. Y además desperdicia algo obvio: en una foto lo que importa son los píxeles **cercanos** entre sí. Un píxel de la esquina tiene poco que decirle a uno del centro.

La solución es la [[convolucion|convolución]]. En vez de que cada neurona vea toda la foto, se usa un [[filtro]] chico, por ejemplo de 3 × 3, que se va deslizando por la foto. En cada posición mira solo 9 píxeles, los multiplica por sus 9 pesos, suma todo y escribe un número. Luego se mueve un lugar y repite.

:::figura redes-convolucion
Un filtro de 3 × 3 sobre una cuadrícula de 5 × 5. En la ventana marcada, cada píxel se multiplica por el peso que le cae encima; la suma, 24, se escribe en la salida.
:::

:::ejemplo Una salida de la convolución, paso a paso
La cuadrícula es una foto en blanco y negro de 5 × 5, donde 0 es negro y 9 es muy claro: las tres columnas de la izquierda son claras y las dos de la derecha, oscuras. El filtro tiene en cada fila los pesos 1, 0 y −1. Está sobre la ventana de las filas 1 a 3 y las columnas 2 a 4:

| Fila de la ventana | Píxeles | × pesos 1 · 0 · −1 |
|---|---|---|
| 1 | 9 · 9 · 1 | 9 + 0 − 1 = 8 |
| 2 | 8 · 9 · 0 | 8 + 0 − 0 = 8 |
| 3 | 9 · 8 · 1 | 9 + 0 − 1 = 8 |

Suma: 8 + 8 + 8 = **24**.

En la primera posición (columnas 1 a 3), donde todo es claro, las filas son 8 · 9 · 9, 9 · 8 · 9 y 9 · 9 · 8, y da (8 − 9) + (9 − 9) + (9 − 8) = −1 + 0 + 1 = **0**.

Haciendo lo mismo en las 9 posiciones posibles, la salida es una cuadrícula de 3 × 3 cuyas tres filas son 0 · 24 · 25, 0 · 25 · 25 y 0 · 24 · 25. Este filtro da números grandes donde hay un cambio de claro a oscuro, de izquierda a derecha, y 0 donde todo es parejo: es un **detector de bordes verticales**.
:::

Nadie programó ese filtro. En una red de verdad, los 9 pesos los encuentra el entrenamiento, y muchos filtros de las primeras capas terminan pareciéndose a detectores de bordes como este.

La salida es más chica que la entrada (de 5 × 5 a 3 × 3) porque, a lo largo de una fila de 5, una ventana de 3 cabe en 5 − 3 + 1 = 3 posiciones.

:::profundo Stride, padding y una aclaración de nombre
El filtro no tiene que moverse de uno en uno: si salta de dos en dos (*stride* 2), la salida queda de la mitad de ancho y de alto. Y si quieres que la salida mida lo mismo que la entrada, se agrega un marco de ceros alrededor de la foto (*padding*). La primera capa de la ResNet-50 usa filtros de 7 × 7 con stride 2: la foto de 224 × 224 queda en 112 × 112.

Una aclaración para quien sepa matemáticas: en una convolución «de libro» el filtro se voltea antes de aplicarlo. Las redes neuronales no lo voltean (técnicamente hacen una correlación), pero todo el mundo le dice convolución. Como los pesos se aprenden, da igual.
:::

### Canales y mapas de activaciones

Una foto de color no es una cuadrícula sino tres, una por color: rojo, verde y azul. Cada una es un [[canal]]. Por eso, un filtro de verdad no es de 3 × 3 sino de 3 × 3 × 3: mira los tres canales a la vez. Son 27 pesos más 1 sesgo = 28 parámetros.

Y una capa no tiene un solo filtro, sino muchos: uno busca bordes verticales, otro horizontales, otro un cambio de color, y así. Cada filtro, al recorrer la foto, produce su propia cuadrícula de salida, que se llama [[mapa-activaciones|mapa de activaciones]] (*feature map*): dice **dónde** de la foto encontró lo que busca ese filtro. Una capa con 64 filtros produce 64 mapas, y esos 64 mapas son los 64 canales de entrada de la capa siguiente.

:::ejemplo Cuántos parámetros tiene una capa convolucional
Una capa con 64 filtros de 3 × 3 sobre una foto de 3 canales:

- Cada filtro: 3 × 3 × 3 = 27 pesos + 1 sesgo = 28
- 64 filtros: 64 × 28 = **1,792 parámetros**

Compáralo con los ≈ 150 millones de la capa densa de antes: 150,528,000 / 1,792 = 84,000 veces menos. La razón es que el mismo filtro de 28 números se reutiliza en todas las posiciones de la foto.
:::

## Pooling y por qué las CNNs ven tan bien {Pooling and why CNNs see so well}

Después de algunas convoluciones conviene achicar los mapas: hay menos números que calcular, y cada filtro de la capa siguiente alcanza a ver un pedazo más grande de la foto. Eso hace el [[pooling]]. El más común, el *max pooling* de 2 × 2, parte el mapa en cuadritos de 2 × 2 y de cada uno se queda con el número más grande.

:::ejemplo Max pooling de 2 × 2
Un mapa de 4 × 4, partido en cuatro cuadritos:

| Cuadrito | Sus 4 números | Se queda |
|---|---|---|
| Arriba a la izquierda | 1, 3, 4, 2 | **4** |
| Arriba a la derecha | 2, 0, 1, 1 | **2** |
| Abajo a la izquierda | 0, 1, 2, 0 | **2** |
| Abajo a la derecha | 5, 6, 7, 3 | **7** |

El mapa de 4 × 4 (16 números) queda de 2 × 2 (4 números): cuatro veces menos. Se pierde *exactamente dónde* estaba lo encontrado dentro de cada cuadrito, pero se conserva *que sí estaba*. El pooling no tiene parámetros: no aprende nada, solo resume.
:::

### Por qué las CNNs sirven tan bien para fotos

Una red hecha de convoluciones, activaciones y pooling es una [[cnn|CNN]] (*convolutional neural network*, red neuronal convolucional). Les va bien a las fotos por tres razones:

1. **Mira de cerca.** Cada filtro mira un pedacito, y en una foto el significado está en los píxeles vecinos: un borde, una textura, una agujeta.
2. **Usa el mismo filtro en todas partes.** El filtro que encuentra una agujeta la encuentra en la esquina o en el centro. El tenis de Ana puede estar en cualquier lugar de la foto y no hay que aprenderlo una vez por cada lugar. Por eso tiene tan pocos parámetros.
3. **Arma lo complicado con lo simple.** Las primeras capas encuentran bordes y manchas de color. Las de en medio combinan bordes en texturas y formas (una suela, una costura). Las últimas combinan partes en objetos (un tenis). Nadie programa esa jerarquía: sale del entrenamiento.

:::analogia Una lupa con una plantilla
Una convolución es como revisar una foto con una lupa que tiene pegada una plantilla: la pasas por toda la foto y apuntas en cada lugar qué tanto se parece lo que ves a la plantilla. Muchas lupas, cada una con su plantilla, dan muchos mapas.

**Dónde se rompe:** tú eliges la plantilla de tu lupa; en una CNN las plantillas (los pesos de los filtros) las aprende el entrenamiento. Y en las capas profundas los filtros no buscan algo con un nombre claro como «agujeta»: buscan combinaciones que a veces ni sabemos describir.
:::

## Backbone, cabeza y ResNet {Backbone, head and ResNet}

Una CNN que clasifica tiene dos partes:

- El [[backbone]] («columna vertebral»): todas las capas convolucionales. Recibe la foto y la convierte en una lista de números que describen lo que hay en ella, sus [[feature|features]]. Al final del backbone de la ResNet-50, un pooling global promedia cada uno de sus 2,048 mapas en un solo número: salen **2,048 números** por foto.
- La **cabeza** (*head*): una capa densa que convierte esos 2,048 números en un logit por categoría. En C01 son 500 logits; luego el softmax los vuelve probabilidades y se toman las 5 más altas.

:::diagrama redes-cnn
La ResNet-50 de C01, de la foto a las 5 sugerencias. Toca cada caja; el recorrido sigue a la foto de Ana.
:::

Separarlo así sirve mucho en producción. El backbone es lo caro y lo que sabe «ver»; la cabeza es chica y es la que sabe de *tus* categorías. Además, esos 2,048 números sirven solos: fotos parecidas dan listas parecidas, y se pueden usar para buscar productos similares. Una lista de números así, donde lo parecido queda cerca, se llama [[embedding]]. La ves a fondo en la siguiente lección.

### ResNet: el atajo que permitió ir profundo

Durante años, apilar más capas parecía la forma obvia de mejorar. Pero pasaba algo raro: a partir de cierta profundidad, una red **más** profunda acertaba **menos**, incluso en las fotos de entrenamiento. No era overfitting (el overfitting empeora la validación, no el entrenamiento): la red más profunda simplemente era más difícil de entrenar.

En 2015, Kaiming He y sus colegas de Microsoft Research propusieron una solución sencilla, la [[resnet|ResNet]] (*residual network*, red residual). Cada grupo de capas, un *bloque*, tiene un atajo, la **conexión residual** (*skip connection*): la entrada del bloque se le **suma** a su salida.

salida = bloque(x) + x

:::figura redes-residual
Un bloque residual. La entrada x va por las capas del bloque y también por el atajo; al final, las dos se suman.
:::

¿Por qué ayuda tanto? Dos intuiciones:

- **Cada bloque solo aprende una corrección.** No tiene que reconstruir todo lo que ya traía la entrada, solo lo que hay que agregarle. Si un bloque no sirve, le basta aprender a sacar casi 0, y la entrada pasa por el atajo sin daño. Agregar bloques ya no puede empeorar tanto las cosas.
- **El aprendizaje llega hasta abajo.** Al entrenar, la corrección del error viaja de la última capa hacia la primera (es la [[backpropagation]]). Con 50 capas apiladas, esa señal se debilita en el camino; los atajos le dan una vía directa.

Con esa idea, el equipo entrenó redes de hasta 152 capas y ganó la competencia de ImageNet de 2015.

### La ResNet-50, en números

| Qué | Cuánto |
|---|---|
| Capas con pesos | 50 en el camino principal: 49 convolucionales y la densa del final |
| Bloques residuales | 16, en cuatro etapas de 3, 4, 6 y 3 bloques |
| Entrada | Una foto de 3 × 224 × 224; con el batch al frente, el tensor [1, 3, 224, 224] |
| Salida del backbone | 2,048 números |
| Parámetros, versión original (1,000 categorías de ImageNet) | ≈ 25.6 millones |
| Parámetros en C01 (500 categorías) | ≈ 24.5 millones |
| Pesos de la versión original en memoria | ≈ 102 MB en float32 · ≈ 51 MB en float16 (2 bytes por número) |

¿De dónde sale la diferencia entre 25.6 y 24.5 millones? Solo de la cabeza. Con 1,000 categorías: 2,048 × 1,000 + 1,000 = 2,049,000 parámetros. Con 500: 2,048 × 500 + 500 = 1,024,500. La diferencia es 1,024,500, casi un millón. Con las cuentas exactas: 25,557,032 − 1,024,500 = 24,532,532. El backbone, que es casi todo, es idéntico.

:::nota Un detalle del conteo
Cuatro de los 16 atajos no son una suma pura: cuando el bloque cambia la cantidad de canales o el tamaño de los mapas, el atajo lleva una convolución chica para que los dos lados cuadren. Esas cuatro no cuentan en el «50» del nombre, pero sus parámetros sí están en los 25.6 millones.
:::

## BatchNorm, Dropout y el bug de model.eval() {BatchNorm, Dropout and the model.eval() bug}

Hay dos tipos de capa que se portan **distinto** cuando la red entrena y cuando responde. Si se te olvida decirle a la red en qué momento está, en producción da respuestas raras sin ningún error. Es uno de los bugs más clásicos de llevar un modelo a producción.

### BatchNorm

Los números que salen de una capa pueden crecer o achicarse mucho de capa en capa, y eso hace difícil entrenar. La [[batchnorm|BatchNorm]] (*batch normalization*, Ioffe y Szegedy, 2015) los acomoda: en cada canal les resta su promedio y los divide entre su desviación estándar, para que queden alrededor de 0 y con una dispersión de más o menos 1. Después los escala y los mueve con dos parámetros propios, que también se entrenan.

La pregunta clave es: ¿el promedio **de qué**?

- **Al entrenar**, el de las fotos del [[batch]] actual. Y de paso va guardando un promedio de esos promedios a lo largo de todo el entrenamiento: sus *running stats* (estadísticas acumuladas).
- **Al responder**, debe usar esas estadísticas acumuladas, que ya no cambian.

:::ejemplo La misma foto, respuestas distintas
Para simplificar, supongamos que cada foto aporta un solo número a un canal (en una CNN aporta uno por cada posición del mapa, pero la idea es la misma).

En un batch de 4 fotos, el canal da 2, 4, 6 y 8. Promedio: 5. La varianza es el promedio de las distancias al promedio, al cuadrado: (9 + 1 + 1 + 9) / 4 = 5, así que la desviación estándar es √5 ≈ 2.24. La foto que dio 4 queda en (4 − 5) / 2.24 ≈ **−0.45**.

Ahora esa misma foto llega sola a producción, en un batch de 1, con el modelo en modo entrenamiento. El promedio del batch es 4, ella misma, así que queda en (4 − 4) / … = **0**. La misma foto dio −0.45 y ahora da 0, y ese cambio viaja por todas las capas que siguen.

Peor: si el servidor junta la foto de Ana con otras para aprovechar la GPU (C01 lo hace), su respuesta depende de **qué otras fotos le tocaron en el batch**.

En modo de inferencia, en cambio, se usan las estadísticas acumuladas (digamos, promedio 5 y desviación 2.24): la foto da −0.45 siempre, llegue sola o acompañada.
:::

### Dropout

El [[dropout]] (Srivastava, Hinton y otros, 2014) es una traba contra el overfitting. **Al entrenar**, en cada paso apaga al azar una fracción de las neuronas, por ejemplo la mitad, y multiplica las que quedan para compensar (con la mitad apagada, por 2). Así la red no puede depender de unas pocas neuronas que memorizaron algo: tiene que repartir lo que sabe. **Al responder** no apaga nada.

Si se queda en modo entrenamiento en producción, cada request apaga neuronas distintas: **la misma foto, enviada dos veces, da dos respuestas diferentes**.

:::nota La ResNet-50 no trae Dropout
La ResNet-50 estándar (la de torchvision, la librería de visión de PyTorch) no tiene capas de Dropout: su riesgo es la BatchNorm. Muchos otros modelos sí lo tienen, por ejemplo justo antes de la cabeza.
:::

### El interruptor: model.eval()

En PyTorch, un modelo tiene un interruptor con dos posiciones: `model.train()` y `model.eval()`. En [[modo-eval|modo eval]], la BatchNorm usa sus estadísticas acumuladas y el Dropout no apaga nada. Un modelo recién creado o recién cargado está en modo train, así que el servidor tiene que cambiarlo **una vez, al arrancar**:

```python
import torch
from torchvision.models import resnet50

model = resnet50(num_classes=500)
model.load_state_dict(torch.load("pesos.pt", weights_only=True))
model.eval()                      # BatchNorm y Dropout en modo inferencia

with torch.inference_mode():      # y además: no guardes nada para aprender
    logits = model(x)
```

:::ojo
`model.eval()` **no** apaga el cálculo de lo que se necesita para aprender: solo cambia cómo se portan esas dos capas. Para lo otro está `torch.inference_mode()` (o el más viejo `torch.no_grad()`). Sin él, PyTorch guarda resultados intermedios para un aprendizaje que nunca va a llegar, y gasta memoria y tiempo. Son dos cosas distintas, y en producción van las dos.
:::

Lo traicionero de este bug es que **nada truena**: no hay error, la respuesta tiene el formato correcto y en tu [[notebook]] la accuracy se veía bien (porque ahí sí llamaste a `model.eval()`). Solo baja la calidad, en silencio. Por eso la Ronda insiste en la prueba de paridad: comparar, foto por foto, las respuestas del modelo que se sirve contra las del modelo que se evaluó.

## Transfer learning y fine-tuning {Transfer learning and fine-tuning}

Entrenar una ResNet-50 desde cero pide muchísimas fotos etiquetadas y mucho tiempo de GPU. Pero hay un atajo enorme: alguien ya la entrenó.

**ImageNet** es un [[dataset]] público de fotos etiquetadas; su versión más usada tiene ≈ 1.28 millones de fotos de entrenamiento en 1,000 categorías (perros, coches, frutas, instrumentos…). Un modelo entrenado con ImageNet ya aprendió, en su backbone, lo que sirve para casi cualquier foto: bordes, texturas, formas, partes de objetos. Y esos pesos se pueden descargar.

Usar lo que un modelo aprendió en una tarea para resolver otra se llama [[transfer-learning|transfer learning]] (aprendizaje por transferencia). En C01 se hace así:

:::pasos
1. Partir de un modelo preentrenado
Se carga la ResNet-50 con los pesos de ImageNet. Su backbone ya sabe «ver».
2. Cambiar la cabeza
La cabeza original saca 1,000 logits, uno por cada categoría de ImageNet, que no son las del marketplace. Se quita y se pone una nueva de 2,048 → 500, con pesos al azar.
3. Seguir entrenando con las fotos propias
Se entrena con las fotos de C01, con un [[learning-rate|learning rate]] chico para no destruir lo que el backbone ya sabía. Eso es el [[fine-tuning]] (ajuste fino). En la Ronda, el de C01 usa un learning rate de 0.0003, 8 épocas y batches de 64 fotos, y cabe en una sola GPU en unas horas.
:::

En código, los dos primeros pasos son dos líneas:

```python
from torchvision.models import resnet50, ResNet50_Weights

model = resnet50(weights=ResNet50_Weights.IMAGENET1K_V2)   # backbone que ya vio ImageNet
model.fc = torch.nn.Linear(2048, 500)                       # cabeza nueva: 500 categorías
```

El fine-tuning se puede hacer de dos formas, y se pueden combinar: **congelar** el backbone (no mover sus pesos) y entrenar solo la cabeza, que es rápido y sirve con pocos datos; o **entrenar todo** con learning rate chico, que es más lento y suele dar mejor resultado cuando hay muchas fotos, como en C01.

:::analogia Una cocinera que cambia de restaurante
Una cocinera con años de experiencia entra a un restaurante nuevo. No vuelve a aprender a picar, a freír ni a sazonar: eso ya lo trae. Solo aprende el menú nuevo. El backbone preentrenado es lo que ya sabe hacer; la cabeza nueva es el menú.

**Dónde se rompe:** si el restaurante nuevo es de algo muy distinto, mucho de lo que sabe sirve menos. Con los modelos pasa igual: el backbone de ImageNet ayuda muchísimo con fotos de productos, que se parecen a las fotos de ImageNet, pero bastante menos con radiografías o imágenes de satélite. Ahí hay que reentrenar más del backbone, o buscar uno preentrenado con imágenes parecidas.
:::

¿Por qué C01 empieza así? Porque con un modelo preentrenado hacen falta muchas menos fotos y muchas menos horas de GPU para llegar a una buena top-5. Y como C01 se reentrena cada mes, cada reentrenamiento parte de pesos que ya saben ver, no de cero.

:::nota Otra familia: los transformers
Las CNNs no son la única forma de ver fotos. Desde 2020 hay modelos de visión hechos con [[transformer|transformers]]: redes en las que cada pedazo de la entrada mira a todos los demás y decide cuáles le importan, en vez de mirar solo a sus vecinos con un filtro. Es la misma familia de los [[llm|LLMs]], los modelos de lenguaje de los chats. El de visión más conocido es el ViT (*Vision Transformer*): parte la foto en cuadritos y los trata como si fueran palabras. Los verás en la lección de transformers y LLMs. Para C01, la ResNet-50 sigue siendo una elección sólida: rápida, chica y muy probada.
:::

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M04 · Hardware para inferencia** arranca con la cuenta de esta lección: ResNet-50, 25.6 M parámetros × 4 bytes ≈ 102 MB en float32 (la Ronda le dice FP32) y ≈ 51 MB en float16 (FP16); para C01, 24.5 M parámetros ≈ 49 MB en float16. Después suma lo que falta para la memoria real de la GPU.
- **M07 · Servidores de modelos** carga el modelo una vez al arrancar, con `model.eval()` y `torch.inference_mode()`: sin lo primero, la BatchNorm usa las estadísticas del batch.
- **M08 · Optimización** muestra que algunas herramientas que capturan el modelo para acelerarlo (`torch.export`, `torch.compile`) conservan la BatchNorm en modo train si olvidaste `eval()`, y que al convertir el modelo a un formato rápido la BatchNorm se «pliega» dentro de la convolución anterior.
- **El caso C01** da el modelo por hecho: «ResNet-50 con una capa final de 500 clases», con un fine-tuning reproducible. Ahora sabes qué quiere decir cada palabra.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
neurona activacion relu capa red-neuronal deep-learning convolucion filtro mapa-activaciones pooling cnn backbone resnet batchnorm dropout modo-eval transfer-learning fine-tuning
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Una neurona tiene entradas 1 y 3, pesos 2 y −1, y sesgo 0.5. ¿Qué sale después de la ReLU?
1 × 2 + 3 × (−1) + 0.5 = 2 − 3 + 0.5 = −0.5. Es negativo, así que la ReLU deja salir 0.
? ¿Cuántos parámetros tiene una capa densa con 2,048 entradas y 500 salidas?
2,048 × 500 pesos + 500 sesgos = 1,024,000 + 500 = 1,024,500. Es la cabeza de la ResNet-50 de C01.
? ¿Por qué una CNN necesita tan pocos parámetros comparada con una red densa sobre los mismos píxeles?
Porque cada filtro mira solo un pedacito y el mismo filtro se usa en todas las posiciones de la foto. Una capa de 64 filtros de 3 × 3 × 3 tiene 1,792 parámetros; una capa densa de 1,000 neuronas sobre 224 × 224 × 3 píxeles tendría ≈ 150 millones.
? ¿Qué hace la conexión residual de una ResNet?
Le suma al bloque su propia entrada: salida = bloque(x) + x. Así cada bloque solo aprende una corrección y la señal del aprendizaje llega bien hasta las primeras capas. Eso permitió entrenar redes de 50, 101 y hasta 152 capas.
? En producción, la misma foto da respuestas distintas según qué otras fotos venían en su batch. ¿Qué revisas primero?
Que el modelo esté en modo eval (`model.eval()`). En modo train, la BatchNorm normaliza con las estadísticas del batch actual, así que la respuesta depende de las otras fotos; y el Dropout, si lo hay, apaga neuronas al azar.
? ¿Por qué C01 parte de una ResNet-50 preentrenada en ImageNet en vez de entrenar desde cero?
Porque su backbone ya aprendió a ver bordes, texturas y formas con ≈ 1.28 millones de fotos. Basta con cambiar la cabeza a 500 categorías y hacer fine-tuning: hacen falta muchas menos fotos y horas de GPU.
:::
