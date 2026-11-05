---
titulo: Redes neuronales y CNNs
en: Neural networks and CNNs
subtitulo: Qué hay dentro de la ResNet-50 de C01, desde una sola neurona hasta el modelo completo: cómo se cuentan sus parámetros y sus cuentas, cómo mira una foto y por qué se empieza con un modelo que ya vio más de un millón de fotos.
pregunta: ¿Qué es exactamente una «red neuronal», qué cuentas hace por dentro y por qué funciona tan bien con fotos?
requisitos: imagenes, aprender
---

:::idea
Una red neuronal es una pila de capas que hacen cuentas muy simples (multiplicar, sumar y quitar los negativos), repetidas miles de millones de veces; contar esas cuentas te dice cuánta memoria y cuánta GPU pide el modelo. Una CNN mira la foto por pedacitos, con el mismo filtro en todas partes: por eso reconoce un tenis esté donde esté, con pocos parámetros.
:::

## Una neurona y el perceptrón {One neuron and the perceptron}

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

La activación dobla la recta. La ReLU la dobla en el 0: todo lo negativo se aplana. Con muchas neuronas, cada una doblada en un lugar distinto, la red puede formar curvas tan complicadas como haga falta, como la frontera entre «foto de tenis» y «foto de bota». Antes se usaban activaciones suaves, como la [[sigmoide]], que aplasta cualquier número entre 0 y 1; la ReLU se impuso en la década de 2010 porque es baratísima y con ella las redes profundas aprenden más rápido.

:::analogia ¿Por qué «neurona»?
El nombre viene de las neuronas del cerebro: reciben señales de otras y, si la suma pasa de cierto nivel, «disparan». La ReLU se parece: si la suma es negativa, no sale nada.

**Dónde se rompe:** la neurona artificial es solo una multiplicación y una suma; una neurona real es una célula muchísimo más compleja. Una red neuronal no es un cerebro ni funciona como uno. Es una función matemática que tomó el nombre de una inspiración de hace décadas.
:::

### El perceptrón: la primera neurona que aprendía

En 1958, el psicólogo estadounidense Frank Rosenblatt publicó el [[perceptron|perceptrón]]: una neurona como la de arriba, pero con una activación de **escalón**: si la suma pasa de 0 sale 1 («sí») y si no, 0 («no»). Lo nuevo era que **aprendía solo**, con una regla simple. Si acierta, no cambia nada. Si dijo 0 y era 1, le suma cada entrada a su peso (y 1 al sesgo), para que la próxima vez su suma salga más alta; si dijo 1 y era 0, se las resta.

Probémoslo con dos funciones de dos entradas. El AND vale 1 solo si las dos valen 1. El XOR («o exclusivo») vale 1 si **exactamente una** vale 1. Cada «vuelta» es una pasada por los cuatro casos.

```python
# El perceptrón de Rosenblatt: si se equivoca, mueve sus pesos hacia la respuesta
def entrenar(datos, vueltas=20):
    w1, w2, b = 0, 0, 0
    for vuelta in range(1, vueltas + 1):
        errores = 0
        for x1, x2, y in datos:
            pred = 1 if w1 * x1 + w2 * x2 + b > 0 else 0   # el escalón
            if pred != y:
                errores += 1
                w1 += (y - pred) * x1          # dijo 0 y era 1: suma la entrada
                w2 += (y - pred) * x2          # dijo 1 y era 0: la resta
                b += (y - pred)
        if errores == 0:
            return f"aprendió en la vuelta {vuelta}: w1={w1}, w2={w2}, b={b}"
    return f"tras {vueltas} vueltas sigue fallando {errores} de 4"

AND = [(0, 0, 0), (0, 1, 0), (1, 0, 0), (1, 1, 1)]
XOR = [(0, 0, 0), (0, 1, 1), (1, 0, 1), (1, 1, 0)]
print("AND:", entrenar(AND))
print("XOR:", entrenar(XOR))
```

```salida
AND: aprendió en la vuelta 6: w1=2, w2=1, b=-2
XOR: tras 20 vueltas sigue fallando 4 de 4
```

Con el AND, a la sexta vuelta ya no se equivoca: con w₁ = 2, w₂ = 1 y b = −2, solo la entrada (1, 1) da una suma positiva (2 + 1 − 2 = 1). Con el XOR se queda en un ciclo en el que cada corrección deshace la anterior; ni con mil vueltas aprende.

Rosenblatt llegó a construir una máquina, la Mark I Perceptron, que veía con una cámara de 20 × 20 = 400 fotoceldas, y un periódico de 1958 contó que la Marina de Estados Unidos esperaba que una máquina así llegara a caminar, hablar y ver. No pasó: el perceptrón tenía un límite que ninguna cantidad de vueltas arregla.

### Lo que una neurona sola no puede: el XOR

¿Por qué falla? Una neurona con escalón responde 1 cuando w₁x₁ + w₂x₂ + b > 0 y 0 cuando no. La frontera entre las dos respuestas, w₁x₁ + w₂x₂ + b = 0, es una **recta**: una neurona sola parte el plano en dos con una recta, y nada más.

:::figura redes-xor
Arriba, el AND: el único punto que vale 1 queda solo de un lado de una recta. En medio, el XOR: los dos que valen 1 están en esquinas opuestas y ninguna recta los aparta de los otros dos. Abajo, la solución de la siguiente sección: una capa oculta mueve los puntos y ahí una recta sí sirve.
:::

Pon los cuatro casos como puntos, con x₁ a lo ancho y x₂ a lo alto. En el AND, el único 1 es la esquina (1, 1), y una recta la aparta. En el XOR, los unos están en esquinas opuestas, (0, 1) y (1, 0): cualquier recta que los deje del mismo lado deja también a alguno de los ceros. No es que el perceptrón no se esfuerce: lo que le pides no se puede dibujar con una recta.

En 1969, Marvin Minsky y Seymour Papert publicaron *Perceptrons*, un libro que convirtió este tipo de límites en teoremas. Se le suele culpar de que el interés y el dinero para las redes neuronales se enfriaran durante años; la historia real tiene más causas (computadoras lentas, pocos datos), pero el límite es real. La salida es juntar varias neuronas, en capas.

## Capas y MLP: la red completa y lo que cuesta {Layers and MLPs: the whole network and its cost}

Una neurona sola traza una recta. Se juntan muchas en una [[capa]]: todas reciben las mismas entradas, cada una con sus propios pesos, y cada una saca un número. Las salidas de una capa son las entradas de la siguiente. Eso es una [[red-neuronal|red neuronal]].

Cuando cada neurona de una capa ve **todas** las salidas de la anterior, la capa se llama **densa** (*dense* o *fully connected*). Una red de capas densas con activaciones entre ellas es un [[mlp|MLP]] (*multilayer perceptron*, perceptrón multicapa), un nombre en honor al de Rosenblatt aunque ya no usa escalón. Las capas de en medio se llaman **capas ocultas** (*hidden layers*).

### El XOR, resuelto con una capa oculta

:::ejemplo Dos neuronas ocultas y una salida
La capa oculta tiene dos neuronas con ReLU:

- h₁ = ReLU(x₁ + x₂): cuenta cuántas entradas valen 1.
- h₂ = ReLU(x₁ + x₂ − 1): solo se prende cuando las dos valen 1.

La salida, sin activación: y = h₁ − 2 × h₂.

| x₁, x₂ | h₁ | h₂ | y = h₁ − 2 × h₂ |
|---|---|---|---|
| 0, 0 | 0 | ReLU(−1) = 0 | 0 − 0 = **0** |
| 0, 1 | 1 | ReLU(0) = 0 | 1 − 0 = **1** |
| 1, 0 | 1 | ReLU(0) = 0 | 1 − 0 = **1** |
| 1, 1 | 2 | ReLU(1) = 1 | 2 − 2 = **0** |

Es exactamente el XOR. La red tiene 9 parámetros: 4 pesos y 2 sesgos en la capa oculta, y 2 pesos y 1 sesgo en la salida.
:::

¿Qué hizo la capa oculta? Movió los puntos: con las coordenadas (h₁, h₂), los dos casos que valen 1 caen juntos en (1, 0), y ahí una recta sí los separa de los ceros (el panel de abajo de la figura). Esa es la idea de toda red neuronal: **cada capa acomoda los datos para que a la siguiente le sea más fácil**.

Aquí los pesos los puse a mano. En una red de verdad los encuentra el entrenamiento, con la [[backpropagation]] de la lección anterior: justo lo que faltaba en 1969, una forma de repartir la culpa del error entre las capas ocultas.

Usar redes con muchas capas es el [[deep-learning|deep learning]] (aprendizaje profundo): «profundo» se refiere a la cantidad de capas. Cada capa trabaja sobre lo que encontró la anterior, así que más capas dan más pasos para combinar cosas simples en complicadas. La ResNet-50 de C01 tiene 50 capas con pesos.

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

### Contar parámetros y multiplicaciones

Los parámetros de una red son todos sus pesos y todos sus sesgos. En la red de juguete:

- Capa 1: 2 entradas × 3 neuronas = 6 pesos, más 3 sesgos = **9**
- Capa 2: 3 entradas × 2 salidas = 6 pesos, más 2 sesgos = **8**
- Total: 9 + 8 = **17 parámetros**

La regla sirve para cualquier capa densa: **parámetros = entradas × salidas + salidas**.

La otra cuenta es cuánto trabajo hace. Cada peso se usa una vez por ejemplo: se multiplica por su entrada y se suma a lo acumulado. Ese par «multiplica y suma» se llama [[mac|MAC]] (*multiply-accumulate*) y es la unidad con que se mide el trabajo de una red. Una capa densa hace **entradas × salidas** MACs por ejemplo; la red de juguete, 2 × 3 + 3 × 2 = 12.

:::cuenta La última capa de la ResNet-50 de C01, contada
Pesos // recibe 2,048 números y saca uno por categoría | 2,048 × 500 | 1,024,000
Sesgos | uno por salida | 500
Parámetros | 1,024,000 + 500 | 1,024,500
Memoria // en float32, 4 bytes por número | 1,024,500 × 4 B | ≈ 4.1 MB
MACs por foto // cada peso se usa una vez | 2,048 × 500 | 1,024,000
Parte de los parámetros del modelo | 1,024,500 ÷ 24,532,532 | ≈ 4.2 %
Parte de las MACs del modelo | 1,024,000 ÷ ≈ 4,100 millones | ≈ 0.025 %
= Esta capa guarda el 4 % de los números del modelo, pero hace solo el 0.025 % del trabajo. El resto de la red reutiliza cada peso miles de veces por foto: lo vas a ver en la convolución.
:::

¿Y si le das la foto entera a un MLP? La calculadora empieza con el clásico de los años 90: dígitos escritos a mano de 28 × 28 píxeles en gris (el dataset MNIST), 128 neuronas ocultas y 10 salidas, una por dígito.

:::calculadora redes-mlp
Después prueba lado 224, 3 canales y 500 salidas: la foto de C01.
:::

Con los dígitos son 101,770 parámetros. Con la foto de C01 y apenas 128 neuronas ocultas, la primera capa ya tiene 150,528 × 128 + 128 = 19,267,712, tres cuartas partes de la ResNet-50 entera. Y como cada píxel tiene su propio peso, la red tendría que aprender a encontrar el tenis en cada posición por separado. La convolución arregla las dos cosas.

Contar parámetros dice cuánta memoria pide el modelo. Guardado como [[float32]], cada uno ocupa 4 bytes: los 25.6 millones de una ResNet-50 son 25.6 M × 4 B ≈ 102 MB, la primera cuenta de la Ronda en M04 para saber cuánta memoria de [[gpu|GPU]] necesita.

Contar MACs dice cuánto cálculo pide cada foto: la ResNet-50 hace ≈ 4,100 millones, 4.1 GMACs (G es «giga», mil millones). Cada MAC son dos operaciones, así que son 8.2 GFLOPs ([[flop|FLOPs]]: operaciones con números decimales). La Ronda, en M03, lo usa como chequeo de cordura: una GPU T4 hace a lo mucho ≈ 65 × 10¹² operaciones por segundo en float16, así que nunca pasará de 65 × 10¹² ÷ 8.2 × 10⁹ ≈ 7,900 fotos por segundo. Lo medido es ≈ 1,200: el techo dice qué es imposible, no qué vas a obtener.

:::profundo De 1958 a hoy, en ocho fechas
| Año | Qué pasó |
|---|---|
| 1958 | Rosenblatt publica el perceptrón, una neurona que aprende de sus errores. |
| 1969 | Minsky y Papert publican *Perceptrons*: una sola capa no puede con el XOR. |
| 1986 | Rumelhart, Hinton y Williams popularizan la backpropagation: ya se entrenan capas ocultas. |
| 1989–1998 | Yann LeCun y su equipo entrenan CNNs que leen dígitos escritos a mano; a finales de los 90 una lee cheques en bancos de Estados Unidos. |
| 2009 | Se publica ImageNet. De 2010 a 2017 hay una competencia anual con su versión de 1,000 categorías. |
| 2012 | AlexNet, una CNN entrenada en dos GPUs, gana con 15.3 % de error top-5 contra 26.2 % del segundo lugar. Despega el deep learning. |
| 2015 | Gana la ResNet, con atajos y 152 capas. Salen también la BatchNorm y la U-Net. |
| 2020 | El Vision Transformer muestra que un transformer, la arquitectura de los LLMs, también ve fotos. |

Entre 1986 y 2012 la idea básica casi no cambió. Cambiaron tres cosas: muchos más datos, GPUs para hacer las cuentas y trucos para entrenar redes profundas (la ReLU, una buena inicialización, el Dropout, la BatchNorm y los atajos), que están todos en esta lección.
:::

## Inicialización: con qué números empieza una red {Initialization: where the weights start} [extra]

Antes del primer paso del entrenamiento, cada peso necesita un valor. Elegirlo se llama [[inicializacion|inicialización]] (*initialization*). Parece un detalle, pero durante años fue una de las razones por las que las redes profundas no aprendían.

### ¿Por qué no empezar todo en cero?

Piensa en dos neuronas ocultas que empiezan con los mismos pesos. Reciben las mismas entradas, así que calculan lo mismo; la backpropagation les reparte la misma culpa, así que se mueven igual. Paso tras paso siguen siendo gemelas: dos neuronas que valen por una. Es el problema de la **simetría**. Con todo en cero es peor: las ocultas sacan 0, la salida las multiplica por pesos que valen 0, la culpa regresa multiplicada por esos mismos ceros y nada se mueve.

```python
# Dos neuronas ocultas que empiezan iguales: ¿se separan al entrenar?
r = lambda fila: [round(a, 4) for a in fila]

def entrenar(w0, pasos=3, lr=0.01):
    x, y = [1.0, 2.0], 1.0                   # un ejemplo y su respuesta
    W = [[w0, w0], [w0, w0]]                 # pesos de las 2 neuronas ocultas
    v = [w0, w0]                             # pesos de la salida
    for paso in range(1, pasos + 1):
        h = [max(0.0, W[i][0] * x[0] + W[i][1] * x[1]) for i in range(2)]  # ReLU
        err = v[0] * h[0] + v[1] * h[1] - y  # la pérdida es err²
        for i in range(2):                   # backpropagation, a mano
            culpa = 2 * err * v[i] * (1 if h[i] > 0 else 0)
            v[i] -= lr * 2 * err * h[i]
            W[i] = [W[i][j] - lr * culpa * x[j] for j in range(2)]
        print(f"  paso {paso}: neurona 1 {r(W[0])}   neurona 2 {r(W[1])}")

print("Todo en 0.5:"); entrenar(0.5)
print("Todo en 0:");   entrenar(0.0)
```

```salida
Todo en 0.5:
  paso 1: neurona 1 [0.495, 0.49]   neurona 2 [0.495, 0.49]
  paso 2: neurona 1 [0.4908, 0.4816]   neurona 2 [0.4908, 0.4816]
  paso 3: neurona 1 [0.4873, 0.4746]   neurona 2 [0.4873, 0.4746]
Todo en 0:
  paso 1: neurona 1 [0.0, 0.0]   neurona 2 [0.0, 0.0]
  paso 2: neurona 1 [0.0, 0.0]   neurona 2 [0.0, 0.0]
  paso 3: neurona 1 [0.0, 0.0]   neurona 2 [0.0, 0.0]
```

Con 0.5, las dos neuronas se mueven, pero en cada paso tienen exactamente los mismos pesos. Con 0, ni se mueven. La salida es romper la simetría con **números al azar**: cada neurona empieza distinta, recibe una culpa distinta y termina aprendiendo algo distinto.

### ¿Qué tan grandes?

Al azar, sí, pero ¿de qué tamaño? Si los pesos son un poco grandes, los números crecen un poco en cada capa y después de 20 o 50 capas explotan; si son un poco chicos, se encogen hasta casi 0. Lo mismo le pasa a la culpa del entrenamiento, que viaja de regreso por los mismos pesos.

El tamaño justo depende de cuántas entradas suma cada neurona: entre más entradas, más chicos los pesos, para que la suma no crezca. La regla más usada con ReLU es la de He (Kaiming He y otros, 2015, el mismo primer autor de la ResNet): pesos al azar alrededor de 0 con una desviación estándar (qué tanto se alejan de 0, en promedio) de √(2 ÷ entradas). El 2 compensa que la ReLU apaga más o menos la mitad de los números, los negativos.

```python
# ¿Qué le pasa a la señal después de 20 capas, según el tamaño de los pesos?
import math, random
random.seed(0)
n, capas = 100, 20                            # 100 neuronas por capa

def tamano(x):                                # qué tan grandes son los números
    return math.sqrt(sum(v * v for v in x) / len(x))

for nombre, sigma in [("chicos, 0.05", 0.05), ("He, √(2/100)", math.sqrt(2 / n)), ("grandes, 0.3", 0.3)]:
    x = [random.gauss(0, 1) for _ in range(n)]
    for capa in range(capas):
        W = [[random.gauss(0, sigma) for _ in range(n)] for _ in range(n)]
        x = [max(0.0, sum(w * xi for w, xi in zip(fila, x))) for fila in W]  # ReLU
    print(f"pesos {nombre:<14} tamaño tras {capas} capas: {tamano(x):.3g}")
```

```salida
pesos chicos, 0.05   tamaño tras 20 capas: 3.45e-09
pesos He, √(2/100)   tamaño tras 20 capas: 1.48
pesos grandes, 0.3   tamaño tras 20 capas: 1.34e+06
```

La entrada empieza con números de tamaño ≈ 1. `3.45e-09` es como Python escribe 3.45 × 10⁻⁹ (0.00000000345), y `1.34e+06` es 1.34 millones. Con 0.05 la señal casi desaparece; con 0.3 se dispara; con la regla de He, √(2 ÷ 100) ≈ 0.141, llega viva. No es un ajuste fino: es la diferencia entre aprender y no aprender.

:::cuenta Con qué desviación empieza una convolución de 3 × 3
Entradas de cada neurona // un filtro de 3 × 3 que mira 64 canales | 3 × 3 × 64 | 576
Desviación de He | √(2 ÷ 576) | ≈ 0.059
Con 512 canales de entrada | √(2 ÷ (3 × 3 × 512)) = √(2 ÷ 4,608) | ≈ 0.021
= Más entradas, pesos más chicos: así la suma de cada neurona se queda del mismo tamaño en toda la red.
:::

En la práctica no lo escribes tú: PyTorch inicializa cada capa con una regla de este tipo al crearla, y la ResNet de torchvision usa la de He en sus convoluciones. En C01 casi ni importa, porque el backbone llega ya entrenado con ImageNet: solo la capa nueva de 2,048 → 500 empieza al azar, con números entre −1/√2,048 y +1/√2,048, o sea entre −0.022 y +0.022.

:::ojo
Inicializar al azar es una de las razones por las que dos entrenamientos con los mismos datos dan resultados un poco distintos. Por eso C01 fija la [[semilla]]: con la misma semilla salen los mismos «azares».
:::

## Convolución: un filtro que recorre la foto {Convolution: a filter that slides over the photo}

Ya viste el problema del MLP: una foto de 224 × 224 [[pixel|píxeles]] con 3 colores son 150,528 números, y una sola capa densa de 1,000 neuronas sobre ellos necesitaría 150,528 × 1,000 ≈ **150 millones de pesos**, casi 6 veces la ResNet-50 entera. Además desperdicia algo obvio: en una foto lo que importa son los píxeles **cercanos** entre sí. Un píxel de la esquina tiene poco que decirle a uno del centro.

La solución es la [[convolucion|convolución]]. En vez de que cada neurona vea toda la foto, un [[filtro]] chico, por ejemplo de 3 × 3, se va deslizando por la foto. En cada posición mira solo 9 píxeles, los multiplica por sus 9 pesos, suma todo y escribe un número; luego se mueve un lugar y repite.

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

### Canales y mapas de activaciones

Una foto de color no es una cuadrícula sino tres, una por color: rojo, verde y azul. Cada una es un [[canal]]. Por eso, un filtro de verdad no es de 3 × 3 sino de 3 × 3 × 3: mira los tres canales a la vez. Son 27 pesos más 1 sesgo = 28 parámetros.

Y una capa no tiene un solo filtro, sino muchos: uno busca bordes verticales, otro horizontales, otro un cambio de color. Cada filtro produce su propia cuadrícula de salida, su [[mapa-activaciones|mapa de activaciones]] (*feature map*), que dice **dónde** encontró lo que busca. Una capa con 64 filtros produce 64 mapas, y esos son los 64 canales de entrada de la capa siguiente.

:::cuenta Una capa de 64 filtros de 3 × 3 sobre la foto de color
Pesos de un filtro // mira los 3 canales a la vez | 3 × 3 × 3 | 27
Parámetros de un filtro | 27 pesos + 1 sesgo | 28
Parámetros de la capa | 64 filtros × 28 | 1,792
Posiciones del filtro // con un marco de ceros la salida mide lo mismo que la entrada (lo ves abajo) | 224 × 224 | 50,176
MACs de la capa | 50,176 posiciones × 64 filtros × 27 pesos | 86,704,128 ≈ 87 millones
Veces que se usa cada peso | una por posición | 50,176
= 1,792 parámetros, 84,000 veces menos que los ≈ 150 millones de la capa densa, pero ≈ 87 millones de MACs: cada peso se reutiliza en las 50,176 posiciones.
:::

Esa es la diferencia de fondo: en una capa densa cada peso se usa una vez por foto; en una convolución, una vez por posición. Por eso la Ronda, en M04, dice que una CNN en GPU, con batches moderados, suele estar limitada por el cálculo y no por la memoria: cada peso que lee lo usa miles de veces.

### Stride y padding: el tamaño de la salida

En el ejemplo, la entrada era de 5 × 5 y la salida de 3 × 3: en una fila de 5, una ventana de 3 cabe en 5 − 3 + 1 = 3 posiciones. Dos perillas cambian esa cuenta:

- El [[stride]] (paso): cuántos píxeles salta el filtro de una posición a la siguiente. Con stride 2 salta de dos en dos, y la salida queda de la mitad de ancho y de alto.
- El [[padding]] (relleno): un marco de ceros alrededor de la entrada, para que el filtro también se centre en las orillas y la salida no se encoja.

Con las dos, el lado de la salida es:

**lado de salida = (n + 2p − k) ÷ s + 1, redondeando la división hacia abajo**

Aquí n es el lado de la entrada, k el del filtro, p el padding (filas de ceros por lado) y s el stride. ¿De dónde sale? Con el marco, la entrada mide n + 2p; la primera ventana ocupa k píxeles y caben (n + 2p − k) ÷ s saltos más antes de salirse, más la posición de arranque. Si la división no es exacta, la última ventana no cabe completa y esas columnas se quedan sin visitar.

:::ejemplo La entrada de 5 × 5, moviendo las perillas
| Filtro, padding y stride | Cuenta | Salida |
|---|---|---|
| 3 × 3, p = 0, s = 1 | (5 + 0 − 3) ÷ 1 + 1 | 3 × 3 |
| 3 × 3, p = 1, s = 1 | (5 + 2 − 3) ÷ 1 + 1 | **5 × 5**, igual que la entrada |
| 3 × 3, p = 1, s = 2 | (5 + 2 − 3) ÷ 2 + 1 | 3 × 3 |
| 3 × 3, p = 0, s = 2 | (5 + 0 − 3) ÷ 2 + 1 | 2 × 2 |

El segundo renglón es el truco más común: con filtro de k × k (k impar), padding (k − 1) ÷ 2 y stride 1, el mapa queda del mismo tamaño. Por eso casi todas las convoluciones de 3 × 3 llevan padding 1.
:::

:::figura redes-padding
Padding 1 y stride 2 sobre la entrada de 5 × 5: el marco de ceros la vuelve de 7 × 7 y la ventana de 3 × 3 salta de dos en dos, así que la salida es de 3 × 3. Su columna izquierda sale negativa: el filtro confunde el marco de ceros con un borde.
:::

El stride es la forma barata de achicar: con stride 2 queda la cuarta parte de las posiciones, así que la capa siguiente hace cuatro veces menos cuentas por filtro.

:::cuenta La primera capa de la ResNet-50
Lado de salida // filtros de 7 × 7, padding 3, stride 2 | (224 + 6 − 7) ÷ 2 = 111.5, baja a 111; más 1 | 112
Parámetros // sin sesgo: la BatchNorm que sigue ya suma su propio número | 7 × 7 × 3 × 64 | 9,408
MACs // cada posición usa los 7 × 7 × 3 = 147 pesos de cada filtro | 112 × 112 × 64 × 147 | 118,013,952 ≈ 118 millones
Después, el max pooling // ventana de 3 × 3, padding 1, stride 2 | (112 + 2 − 3) ÷ 2 = 55.5, baja a 55; más 1 | 56
= La foto de 224 × 224 × 3 sale de las dos primeras capas como 64 mapas de 56 × 56: 16 veces menos posiciones, por apenas el 2.9 % de las MACs de toda la red.
:::

:::calculadora redes-conv
Prueba n = 5, k = 3, p = 1 y s = 1: la salida mide 5, como la entrada. Luego sube el stride a 2.
:::

Lo mismo en Python, para varias capas de la ResNet-50:

```python
def lado(n, k, s, p):
    return (n + 2 * p - k) // s + 1    # // divide y redondea hacia abajo

def conv(nombre, n, c_in, c_out, k, s, p):
    m = lado(n, k, s, p)
    params = k * k * c_in * c_out          # sin sesgo, como en la ResNet
    macs = m * m * c_out * k * k * c_in    # posiciones × filtros × pesos por filtro
    print(f"{nombre:<24}{n:>4} -> {m:<4}{params:>12,}{macs:>15,}")

print(f"{'capa':<24}{'lado':>4}{'':8}{'parámetros':>12}{'MACs':>15}")
conv("primera, 7x7 stride 2", 224, 3, 64, 7, 2, 3)
print(f"{'max pooling 3x3 s2':<24}{112:>4} -> {lado(112, 3, 2, 1)}")
conv("3x3 de la etapa 1", 56, 64, 64, 3, 1, 1)
conv("3x3 de la etapa 2", 28, 128, 128, 3, 1, 1)
conv("3x3 de la etapa 3", 14, 256, 256, 3, 1, 1)
conv("3x3 de la etapa 4", 7, 512, 512, 3, 1, 1)
```

```salida
capa                    lado          parámetros           MACs
primera, 7x7 stride 2    224 -> 112        9,408    118,013,952
max pooling 3x3 s2       112 -> 56
3x3 de la etapa 1         56 -> 56        36,864    115,605,504
3x3 de la etapa 2         28 -> 28       147,456    115,605,504
3x3 de la etapa 3         14 -> 14       589,824    115,605,504
3x3 de la etapa 4          7 -> 7      2,359,296    115,605,504
```

Fíjate en las últimas cuatro filas. Cada vez que la ResNet achica el mapa a la mitad de lado, duplica los canales: las posiciones bajan 4 veces y los filtros y los pesos por filtro suben 2 veces cada uno. Las MACs quedan idénticas, pero los parámetros se multiplican por 4 en cada etapa: el trabajo se reparte parejo y los parámetros se amontonan al final.

### Pooling: resumir para achicar

La otra forma de achicar es el [[pooling]]. El más común, el *max pooling* de 2 × 2, parte el mapa en cuadritos de 2 × 2 y de cada uno se queda con el número más grande. Su tamaño sale de la misma fórmula, con k = 2, s = 2 y p = 0.

:::ejemplo Max pooling de 2 × 2
Un mapa de 4 × 4, partido en cuatro cuadritos:

| Cuadrito | Sus 4 números | Se queda |
|---|---|---|
| Arriba a la izquierda | 1, 3, 4, 2 | **4** |
| Arriba a la derecha | 2, 0, 1, 1 | **2** |
| Abajo a la izquierda | 0, 1, 2, 0 | **2** |
| Abajo a la derecha | 5, 6, 7, 3 | **7** |

El mapa de 4 × 4 (16 números) queda de 2 × 2 (4 números): (4 − 2) ÷ 2 + 1 = 2. Se pierde *exactamente dónde* estaba lo encontrado dentro de cada cuadrito, pero se conserva *que sí estaba*. El pooling no tiene parámetros: no aprende nada, solo resume.
:::

Hoy muchas redes achican con convoluciones de stride 2, porque así el achique también aprende. La ResNet-50 usa un solo max pooling, al principio; el resto lo hace con stride 2, y al final un pooling global promedia cada mapa entero en un número.

### Por qué las CNNs sirven tan bien para fotos

Una red hecha de convoluciones, activaciones y pooling es una [[cnn|CNN]] (*convolutional neural network*, red neuronal convolucional). Les va bien a las fotos por tres razones:

1. **Mira de cerca.** Cada filtro mira un pedacito, y en una foto el significado está en los píxeles vecinos: un borde, una textura, una agujeta.
2. **Usa el mismo filtro en todas partes.** El filtro que encuentra una agujeta la encuentra en la esquina o en el centro. El tenis de Ana puede estar en cualquier lugar de la foto y no hay que aprenderlo una vez por cada lugar. Por eso tiene tan pocos parámetros.
3. **Arma lo complicado con lo simple.** Las primeras capas encuentran bordes y manchas de color. Las de en medio combinan bordes en texturas y formas (una suela, una costura). Las últimas combinan partes en objetos (un tenis). Funciona porque cada capa ve un pedazo de la foto más grande que la anterior: su [[campo-receptivo|campo receptivo]] crece, como verás en la siguiente sección. Nadie programa esa jerarquía: sale del entrenamiento.

:::analogia Una lupa con una plantilla
Una convolución es como revisar una foto con una lupa que tiene pegada una plantilla: la pasas por toda la foto y apuntas en cada lugar qué tanto se parece lo que ves a la plantilla. Muchas lupas, cada una con su plantilla, dan muchos mapas.

**Dónde se rompe:** tú eliges la plantilla de tu lupa; en una CNN las plantillas (los pesos de los filtros) las aprende el entrenamiento. Y en las capas profundas los filtros no buscan algo con un nombre claro como «agujeta»: buscan combinaciones que a veces ni sabemos describir.
:::

## El campo receptivo: cuánto de la foto ve cada neurona {Receptive field: how much of the photo a neuron sees} [extra]

Una neurona de la primera capa, con un filtro de 3 × 3, ve 3 × 3 píxeles. Una de la segunda ve 3 × 3 neuronas de la primera, cada una con su propio cuadro de 3 × 3; como se enciman, juntas cubren 5 × 5 píxeles. La de la tercera cubre 7 × 7. El pedazo de la foto que puede influir en una neurona es su [[campo-receptivo|campo receptivo]] (*receptive field*).

:::figura redes-campo
Arriba, de lado: la neurona de la capa 3 depende de 3 neuronas de la capa 2, de 5 de la capa 1 y de 7 píxeles. Abajo, de frente: los cuadros de 3 × 3, 5 × 5 y 7 × 7 que ven las neuronas de las capas 1, 2 y 3, todas centradas en el mismo píxel.
:::

Con stride 1, cada capa de 3 × 3 le suma 2 píxeles al lado: 3, 5, 7, 9… Para ver 224 píxeles harían falta más de 100 capas. El stride lo acelera: después de una capa con stride 2, dos neuronas vecinas están separadas por 2 píxeles de la foto, así que un filtro de 3 × 3 en la capa siguiente abarca más terreno.

La cuenta, capa por capa, lleva dos números: el campo receptivo r y el **salto** j, cuántos píxeles de la foto hay entre dos neuronas vecinas de esa capa. Se empieza con r = 1 y j = 1 (un píxel se ve a sí mismo), y en cada capa con filtro k y stride s:

**r nuevo = r + (k − 1) × j   ·   j nuevo = j × s**

Con tres capas de 3 × 3 y stride 1: r = 1 + 2 = 3, luego 3 + 2 = 5, luego 5 + 2 = 7, como en la figura. Si las tres tienen stride 2: 1 + 2 × 1 = 3 (salto 2), 3 + 2 × 2 = 7 (salto 4), 7 + 2 × 4 = 15 (salto 8).

:::calculadora redes-campo
La calculadora usa el mismo filtro y el mismo stride en todas las capas. Las redes reales mezclan, pero la fórmula de arriba sirve igual, capa por capa.
:::

En la ResNet-50 las capas son distintas: la primera es de 7 × 7, cada bloque tiene convoluciones de 1 × 1 (que no suman nada, porque k − 1 = 0) y una de 3 × 3, y cada etapa a partir de la segunda empieza con stride 2:

:::cuenta El campo receptivo de la ResNet-50, etapa por etapa
Primera capa // 7 × 7, stride 2 | 1 + 6 × 1 | 7 (salto 2)
Max pooling // 3 × 3, stride 2 | 7 + 2 × 2 | 11 (salto 4)
Etapa 1 // 3 bloques, una conv de 3 × 3 en cada uno | 11 + 3 × 2 × 4 | 35 (salto 4)
Etapa 2 // la primera de 3 × 3 con stride 2, luego 3 más | 35 + 2 × 4 + 3 × 2 × 8 | 91 (salto 8)
Etapa 3 // 6 bloques | 91 + 2 × 8 + 5 × 2 × 16 | 267 (salto 16)
Etapa 4 // 3 bloques | 267 + 2 × 16 + 2 × 2 × 32 | 427 (salto 32)
= Cada número del último mapa de 7 × 7 puede depender de un cuadro de 427 × 427 píxeles, más grande que la foto de 224. Y el salto de 32 cuadra con el tamaño del mapa: 224 ÷ 32 = 7.
:::

:::profundo El campo que de verdad se usa
Los 427 píxeles son un máximo teórico: dicen qué píxeles **pueden** influir. Los del centro pesan muchísimo más que los de la orilla, porque llegan a la neurona por muchos más caminos. Un estudio de 2016 (Luo y otros) lo midió: el campo «efectivo» es una mancha que se desvanece del centro hacia afuera y ocupa solo una parte del teórico. Que algo «quepa» en el campo receptivo no garantiza que la red lo note.
:::

¿Para qué sirve en producción? Para dos preguntas de diseño: ¿la red alcanza a ver un objeto grande entero?, y ¿lo chico sobrevive? Con un salto de 32, cada número del último mapa resume un cuadro de 32 × 32 píxeles, y un defecto de 3 píxeles es casi nada ahí. Lo verás con números en la inspección de C03.

## La ResNet-50 por dentro: atajos, BatchNorm y model.eval() {Inside ResNet-50: shortcuts, BatchNorm and model.eval()}

Ya tienes todas las piezas: convoluciones, ReLU, stride y pooling. La ResNet-50 de C01 las junta así. Las dos franjas del diagrama son las dos partes de toda CNN que clasifica: el [[backbone]], que convierte la foto en 2,048 números, y la [[cabeza]], la última capa, que decide la categoría (las ves a fondo en la sección que sigue).

:::diagrama redes-cnn
La ResNet-50 de C01, de la foto a las 5 sugerencias. Toca cada caja; el recorrido sigue a la foto de Ana.
:::

### El atajo que permitió ir profundo

Durante años, apilar más capas parecía la forma obvia de mejorar. Pero a partir de cierta profundidad, una red **más** profunda acertaba **menos**, incluso en las fotos de entrenamiento. No era overfitting (que empeora la validación, no el entrenamiento): la red más profunda simplemente era más difícil de entrenar.

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
| Pesos de la versión original en memoria | ≈ 102 MB en float32 · ≈ 51 MB en [[fp16\|float16]] (2 bytes por número) |
| Cuentas por foto | ≈ 4,100 millones de MACs (4.1 GMACs) |
| Campo receptivo de un número del último mapa | 427 × 427 píxeles (teórico) |

:::nota Un detalle del conteo
Cuatro de los 16 atajos no son una suma pura: cuando el bloque cambia la cantidad de canales o el tamaño de los mapas, el atajo lleva una convolución chica para que los dos lados cuadren. Esas cuatro no cuentan en el «50» del nombre, pero sus parámetros sí están en los 25.6 millones.
:::

¿Dónde viven los parámetros y dónde el trabajo? Contando capa por capa la ResNet-50 de C01, con su capa final de 500:

| Parte | Mapa que sale | Parámetros | MACs por foto |
|---|---|---|---|
| Primera capa y max pooling | 64 × 56 × 56 | 9,536 (< 0.1 %) | 118 millones (2.9 %) |
| Etapa 1 · 3 bloques | 256 × 56 × 56 | 0.2 millones (0.9 %) | 668 millones (16.3 %) |
| Etapa 2 · 4 bloques | 512 × 28 × 28 | 1.2 millones (5.0 %) | 1,028 millones (25.1 %) |
| Etapa 3 · 6 bloques | 1,024 × 14 × 14 | 7.1 millones (28.9 %) | 1,464 millones (35.8 %) |
| Etapa 4 · 3 bloques | 2,048 × 7 × 7 | 15.0 millones (61.0 %) | 809 millones (19.8 %) |
| Capa final (500) | 500 | 1.0 millones (4.2 %) | 1 millón (0.025 %) |
| **Total** | | **24.5 millones** | **≈ 4,088 millones** |

La etapa 4 guarda el 61 % de los parámetros, pero hace menos de una quinta parte del trabajo; la etapa 1, al revés, casi no tiene parámetros y hace el 16 % del trabajo, porque sus mapas son grandes. Para la memoria (M04) mandan las últimas etapas; el cálculo (M03) se reparte entre todas.

### BatchNorm

Hay dos tipos de capa que se portan **distinto** al entrenar y al responder. Si se te olvida decirle a la red en qué momento está, en producción da respuestas raras sin ningún error: uno de los bugs más clásicos de llevar un modelo a producción.

La primera vive dentro de cada bloque de la ResNet. Los números pueden crecer o achicarse mucho de capa en capa, y eso hace difícil entrenar. La [[batchnorm|BatchNorm]] (*batch normalization*, Ioffe y Szegedy, 2015) los acomoda: en cada canal les resta su promedio y los divide entre su desviación estándar, para que queden alrededor de 0 con una dispersión de más o menos 1. Después los escala y los mueve con dos parámetros propios, que también se entrenan.

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
La ResNet-50 estándar (la de torchvision, la librería de visión de PyTorch) no tiene capas de Dropout: su riesgo es la BatchNorm. Muchos otros modelos sí lo tienen, por ejemplo justo antes de la capa final.
:::

### El interruptor: model.eval()

En PyTorch, un modelo tiene un interruptor con dos posiciones: `model.train()` y `model.eval()`. En [[modo-eval|modo eval]], la BatchNorm usa sus estadísticas acumuladas y el Dropout no apaga nada. Un modelo recién creado o cargado está en modo train, así que el servidor lo cambia **una vez, al arrancar** (ilustración: necesita PyTorch y un archivo de pesos):

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

## Backbone, cabeza y transfer learning {Backbone, head and transfer learning}

Una CNN que clasifica tiene dos partes:

- El [[backbone]] («columna vertebral»): todas las capas convolucionales. Recibe la foto y la convierte en una lista de números que describen lo que hay en ella, sus [[feature|features]]. Al final del backbone de la ResNet-50, un pooling global promedia cada uno de sus 2,048 mapas de 7 × 7 en un solo número: salen **2,048 números** por foto.
- La [[cabeza]] (*head*): lo que convierte esas features en la respuesta de la tarea. En C01 es una sola capa densa que da un logit por categoría: 500 logits. Luego el softmax los vuelve probabilidades y se toman las 5 más altas.

Separarlo así sirve mucho en producción. El backbone es lo caro y lo que sabe «ver»; la cabeza es chica y es la que sabe de *tus* categorías. Además, esos 2,048 números sirven solos: fotos parecidas dan listas parecidas, útiles para buscar productos similares. Una lista así, donde lo parecido queda cerca, es un [[embedding]], el tema de la siguiente lección.

¿De dónde sale la diferencia entre los 25.6 millones de parámetros de la ResNet-50 original y los 24.5 de la de C01? Solo de la cabeza. Con 1,000 categorías: 2,048 × 1,000 + 1,000 = 2,049,000. Con 500: 2,048 × 500 + 500 = 1,024,500. La diferencia es 1,024,500: 25,557,032 − 1,024,500 = 24,532,532. El backbone, que es casi todo, es idéntico.

### Una cabeza para cada tarea

El backbone no sabe de categorías: solo describe la foto. Por eso sirve para tareas distintas, cambiando solo la cabeza:

- **[[clasificacion|Clasificación]]** (C01): promedia cada mapa en un número y una capa densa da un logit por categoría. Ya no importa *dónde* estaba algo, solo *qué tanto* hay.
- **[[deteccion|Detección]]** (C02): no puede promediar, porque necesita saber dónde. Su cabeza mira cada posición de los mapas y propone ahí una caja (4 números: dónde está y de qué tamaño) con un puntaje por clase.
- **[[segmentacion|Segmentación]]** (C04): quiere una respuesta por píxel, así que su cabeza es un **decoder**, una red que agranda los mapas de regreso al tamaño de la foto. A la parte que achica, el backbone, en este contexto se le dice **encoder**.

:::diagrama redes-cabezas
Un mismo backbone y tres cabezas. Elige un recorrido para seguir una tarea.
:::

:::ojo Dos «cabezas» distintas
En la lección de transformers vas a leer «cabezas de atención» ([[multi-head|multi-head attention]]). Son otra cosa: copias de la atención que trabajan en paralelo dentro de cada bloque. Aquí, «cabeza» es la parte final de la red, la que cambia según la tarea.
:::

### Transfer learning y fine-tuning

Entrenar una ResNet-50 desde cero pide muchísimas fotos etiquetadas y mucho tiempo de GPU. Pero hay un atajo: alguien ya la entrenó. **ImageNet** es un [[dataset]] público de fotos etiquetadas; su versión más usada tiene ≈ 1.28 millones de fotos de entrenamiento en 1,000 categorías (perros, coches, frutas, instrumentos…). Un modelo entrenado con ImageNet ya aprendió en su backbone lo que sirve para casi cualquier foto: bordes, texturas, formas, partes de objetos. Y esos pesos se pueden descargar.

Usar lo que un modelo aprendió en una tarea para resolver otra se llama [[transfer-learning|transfer learning]] (aprendizaje por transferencia). En C01 se hace así:

:::pasos
1. Partir de un modelo preentrenado
Se carga la ResNet-50 con los pesos de ImageNet. Su backbone ya sabe «ver».
2. Cambiar la cabeza
La cabeza original saca 1,000 logits, uno por cada categoría de ImageNet, que no son las del marketplace. Se quita y se pone una nueva de 2,048 → 500, con pesos al azar.
3. Seguir entrenando con las fotos propias
Se entrena con las fotos de C01, con un [[learning-rate|learning rate]] chico para no destruir lo que el backbone ya sabía. Eso es el [[fine-tuning]] (ajuste fino). En la Ronda, el de C01 usa un learning rate de 0.0003, 8 épocas y batches de 64 fotos, y cabe en una sola GPU en unas horas.
:::

En código, los dos primeros pasos son dos líneas (otra ilustración que necesita PyTorch):

```python
import torch
from torchvision.models import resnet50, ResNet50_Weights

model = resnet50(weights=ResNet50_Weights.IMAGENET1K_V2)   # backbone que ya vio ImageNet
model.fc = torch.nn.Linear(2048, 500)                       # cabeza nueva: 500 categorías
```

El fine-tuning se puede hacer de dos formas, y se pueden combinar: **congelar** el backbone (no mover sus pesos) y entrenar solo la cabeza, que es rápido y sirve con pocos datos; o **entrenar todo** con learning rate chico, que es más lento y suele dar mejor resultado cuando hay muchas fotos, como en C01. Congelado, el entrenamiento solo mueve 1,024,500 de los 24,532,532 parámetros: el 4.2 %.

:::analogia Una cocinera que cambia de restaurante
Una cocinera con años de experiencia entra a un restaurante nuevo. No vuelve a aprender a picar, a freír ni a sazonar: eso ya lo trae. Solo aprende el menú nuevo. El backbone preentrenado es lo que ya sabe hacer; la cabeza nueva es el menú.

**Dónde se rompe:** si el restaurante nuevo es de algo muy distinto, mucho de lo que sabe sirve menos. Con los modelos pasa igual: el backbone de ImageNet ayuda muchísimo con fotos de productos, que se parecen a las fotos de ImageNet, pero bastante menos con radiografías o imágenes de satélite. Ahí hay que reentrenar más del backbone, o buscar uno preentrenado con imágenes parecidas.
:::

¿Por qué C01 empieza así? Porque con un modelo preentrenado hacen falta muchas menos fotos y horas de GPU para llegar a una buena top-5. Y como C01 se reentrena cada mes, cada reentrenamiento parte de pesos que ya saben ver.

## Vision Transformers: la foto como una frase de parches {Vision Transformers: the photo as a sentence of patches} [extra]

Las CNNs no son la única forma de ver fotos. En 2020, un equipo de Google (Dosovitskiy y otros) tomó el [[transformer]], la arquitectura de los [[llm|LLMs]] (los modelos de lenguaje de los chats), y le dio una foto como si fuera una frase. Lo llamaron [[vit|ViT]] (*Vision Transformer*).

Un transformer recibe una lista de [[token|tokens]], cada uno convertido en un vector (una lista de números). El ViT parte la foto en cuadritos de 16 × 16 píxeles, los **parches** (*patches*), y cada parche se vuelve un token.

:::cuenta De la foto a los tokens de un ViT-B/16
Parches por lado | 224 ÷ 16 | 14
Parches en total | 14 × 14 | 196
Números por parche // 16 × 16 píxeles × 3 colores | 16 × 16 × 3 | 768
Del parche a su vector // una capa densa de 768 → 768 | 768 × 768 + 768 | 590,592 parámetros
Tokens que entran // más uno extra, [CLS], que al final resume la foto | 196 + 1 | 197
Pares que compara la atención en cada bloque | 197 × 197 | 38,809
= 197 tokens de 768 números cada uno. «B/16» quiere decir tamaño Base, con parches de 16 píxeles.
:::

:::figura redes-vit
Un ViT-B/16 lee la foto de 224 × 224 como 14 × 14 = 196 parches. Cada parche, de 768 números, se vuelve un token; con el token [CLS] entran 197 al transformer.
:::

Después, el ViT es un transformer como el de los LLMs: 12 bloques, cada uno con [[atencion|atención]] (cada parche mira a todos los demás y decide cuáles le importan; la ves en la lección de transformers y LLMs) y con un MLP chico que procesa cada token por separado. Dos detalles:

- **La posición se suma aparte.** Al convertir los parches en una lista, se pierde dónde estaba cada uno. Por eso a cada token se le suma un vector aprendido que dice «soy el parche 37»: un [[embedding-posicional|embedding posicional]].
- **La respuesta sale del token [CLS].** Al final, una cabeza densa convierte su vector de 768 números en los logits, como la de la ResNet.

| | ResNet-50 | ViT-B/16 |
|---|---|---|
| Parámetros | ≈ 25.6 millones | ≈ 86 millones |
| MACs por foto de 224 × 224 | ≈ 4,100 millones | ≈ 17,600 millones |
| Qué ve la primera capa | 7 × 7 píxeles | todos los parches a la vez |
| Lo que trae de fábrica | ver de cerca y el mismo filtro en todas partes | nada: lo tiene que aprender |
| Cuántas fotos necesita | le basta ImageNet | brilla con preentrenamientos de decenas o cientos de millones de fotos |

La CNN trae dos ideas metidas en su diseño; el ViT tiene que aprenderlas de los datos. Con pocos datos eso es una desventaja: en el artículo original, entrenado solo con ImageNet, el ViT quedaba unos puntos por debajo de una ResNet de tamaño parecido; preentrenado con muchísimas más fotos (14 millones en un caso, 300 millones en otro), la superaba.

¿Y para C01? La Ronda, en M04, cuenta el ViT-B/16 entre los modelos que hay que saber medir: ≈ 172 MB en float16. Para sugerir 500 categorías a ≈ 2.5 millones de publicaciones al día, la ResNet-50 sigue siendo una elección sólida, con 3.5 veces menos parámetros y unas 4 veces menos cuentas por foto. Donde los ViT dominan es en los modelos que ponen fotos y textos en el mismo espacio ([[multimodal|multimodales]]), que verás en la lección de embeddings.

## Errores comunes {Common mistakes}

### 1. Olvidar model.eval() en el servidor

La BatchNorm normaliza con las estadísticas del batch y el Dropout, si lo hay, apaga neuronas al azar. La misma foto da respuestas distintas según con qué otras llegó, y nada truena.

**Cómo evitarlo:** que la función que carga el modelo termine en `model.eval()`, una prueba que revise que `model.training` sea `False` y la prueba de paridad de la Ronda (M08).

### 2. Una normalización distinta a la del entrenamiento

Si en el servidor olvidas dividir entre 255, el rojo de un píxel que vale 236 entra como (236 − 0.485) ÷ 0.229 ≈ 1,028 en vez de (0.925 − 0.485) ÷ 0.229 ≈ 1.92. Si cargas la foto en orden azul-verde-rojo ([[bgr|BGR]]), los canales se cruzan. El modelo no truena: ve una foto «rara» y se equivoca más, en silencio.

**Cómo evitarlo:** el mismo código de preprocesamiento al entrenar y al servir (lo contrario es el [[training-serving-skew]]) y una prueba que compare, número por número, el tensor del servidor con el de la evaluación.

### 3. Confundir el padding y el redondeo

«Padding 1 deja el mapa igual» solo es cierto con filtro de 3 × 3 y stride 1. Y con stride 2 la salida no siempre es la mitad exacta: una entrada de 56 sale de 28, pero una de 57 sale de (57 + 2 − 3) ÷ 2 + 1 = 29, no de 28.5. Un error de uno en el tamaño basta para que dos ramas que se suman (como el atajo de una ResNet) no cuadren.

**Cómo evitarlo:** hacer la cuenta con la fórmula antes de escribir la capa y, en código, pasar un tensor de prueba e imprimir su forma (*shape*) después de cada capa.

### 4. Contar mal los parámetros

Los resbalones típicos: olvidar los canales de entrada (un filtro de 3 × 3 sobre 64 canales tiene 576 pesos, no 9); poner sesgos donde no hay (las convoluciones de la ResNet no llevan); contar como parámetros las estadísticas acumuladas de la BatchNorm (se guardan con el modelo, pero el gradiente no las ajusta); o confundir parámetros (memoria) con MACs (cálculo).

**Cómo evitarlo:** contar con las fórmulas y compararlo con lo que dice PyTorch, `sum(p.numel() for p in model.parameters())`. Para la ResNet-50 debe dar 25,557,032, o 24,532,532 con 500 categorías.

### 5. Cargar pesos con la cabeza equivocada

Los pesos de un modelo de 1,000 categorías no caben en uno de 500: PyTorch truena con un error de *size mismatch* en la capa final. La tentación es «arreglarlo» con `strict=False`, que deja pasar sin avisar las capas cuyos nombres no coinciden. Si los nombres no coinciden (por ejemplo, porque al guardar se les pegó el prefijo `module.`), el modelo se queda con sus pesos al azar y responde basura sin un solo error.

**Cómo evitarlo:** crear el modelo con el número correcto de categorías antes de cargar; si usas `strict=False`, revisar la lista de capas que no se cargaron, que devuelve la misma función; y evaluar con el golden set después de cargar.

### 6. Achicar la foto y perder lo chico

El [[resize]] del preprocesamiento es parte del modelo, aunque viva en otro archivo. Si un defecto mide 3 píxeles y achicas la foto a menos de la mitad, ya no está cuando la red la ve, y ninguna capa lo recupera.

**Cómo evitarlo:** antes de elegir el tamaño de entrada, calcula cuántos píxeles mide lo más chico que hay que ver. Si son pocos, no achiques: corta la imagen en tiles a resolución completa.

## En la vida real {In real life} [extra]

### C01: la línea del caso, leída

El caso C01 resume su modelo en una frase: «ResNet-50 con una capa final de 500 clases: 24.5 M parámetros y ≈ 4.1 GMACs a 224 × 224». Ya sabes leerla: memoria, cálculo, cabeza y preprocesamiento. Y cabe de sobra en su presupuesto, p99 ≤ 200 ms del lado del servidor: la Ronda estima ≈ 3–6 ms de GPU por foto en una T4. Si el servicio no contesta en 300 ms, la app le muestra a Ana el selector manual de categorías.

### C02: detectar en video, una caja por posición

C02 vigila zonas restringidas con 1,000 cámaras en 25 centros de distribución, con un detector ligero tipo YOLO (≈ 10–30 millones de parámetros) que recibe cada frame a 640 × 640 y busca personas y vehículos.

Su cabeza no promedia, porque necesita saber dónde. En detectores como YOLOv8 mira tres mapas, con saltos de 8, 16 y 32 píxeles: a 640 son 80 × 80 + 40 × 40 + 20 × 20 = 8,400 posiciones, y en cada una propone una caja y un puntaje por clase. Las de puntaje bajo se tiran, y de las que marcan el mismo objeto, el **NMS** (*non-maximum suppression*) deja la de puntaje más alto y borra las que se enciman mucho con ella (lo mide el [[iou|IoU]]).

¿Por qué tres tamaños? Por el campo receptivo: el mapa de salto 8 tiene celdas chicas, buenas para una persona lejana; el de salto 32, un campo enorme para un camión que llena el cuadro. Y como 640 × 640 son 8.2 veces los píxeles de 224 × 224, la Ronda (M04) nota que en detección lo que más crece con la resolución son las activaciones.

### C03: inspección en la línea, defectos de 3 píxeles

C03 revisa soportes metálicos en una planta de autopartes de Nuevo León, con una cámara de 2,448 × 2,048 píxeles por línea, y tiene que encontrar fisuras de 0.2 mm. Aquí manda la aritmética de esta lección:

:::cuenta La fisura de C03, en píxeles
Resolución sobre la pieza // supuesto de la Ronda: 150 mm de campo de visión | 150 mm ÷ 2,448 px | ≈ 0.061 mm por píxel
Fisura de 0.2 mm | 0.2 ÷ 0.061 | ≈ 3.3 píxeles
Si achicas la imagen a 1,024 de ancho | 0.2 ÷ (150 ÷ 1,024) | ≈ 1.4 píxeles: se pierde
Tiles de 512 × 512 sin achicar | 2,448 ÷ 512 y 2,048 ÷ 512, redondeando hacia arriba | 5 × 4 = 20 tiles
Último mapa de un tile // backbone con salto 32 | 512 ÷ 32 | 16 × 16 = 256 celdas
Lo que mide la fisura dentro de una celda | 3.3 ÷ 32 | ≈ 10 % de su ancho
= La fisura apenas ocupa una de 256 celdas. Si la cabeza promediara el mapa entero, como en C01, su señal quedaría diluida 256 veces.
:::

Por eso la Ronda no achica la imagen: la procesa en 20 tiles, como un batch de tamaño fijo. Si 3 píxeles resultan pocos, la solución es óptica (un campo de visión más chico o más resolución), no un modelo más grande. Y para que lo chico no se diluya, muchos métodos de inspección usan mapas de salto 8 o 16 y califican cada posición: la pieza es mala si **alguna** posición es mala (el máximo, no el promedio).

C03 usa también la otra idea de esta lección: un solo engine (el modelo ya convertido para la GPU) con **un backbone compartido y dos cabezas**, una con un puntaje de anomalía y otra con un puntaje por tipo de defecto. Dos backbones casi duplicarían el tiempo, y la inferencia tiene que caber en ≤ 120 ms en el Jetson, la computadora con GPU que va junto a cada línea.

### C04: segmentación, un decoder que agranda

C04 marca tumor en laminillas de patología escaneadas a tan alta resolución que se procesan en tiles de 512 × 512. Un modelo tipo U-Net, de ≈ 30 millones de parámetros, da para cada píxel la probabilidad de que sea tumor: 512 × 512 = 262,144 respuestas por tile, en vez de 500 por foto.

La U-Net (Ronneberger y otros, 2015) se diseñó para imágenes médicas. Es un **encoder-decoder**: el encoder es un backbone que achica el mapa (por ejemplo, 512 → 256 → 128 → 64 → 32 de lado) y el decoder hace el camino de regreso. El mapa de 32 × 32 sabe **qué** hay, pero ya no **dónde** están los bordes; por eso, en cada tamaño, el decoder recibe por un atajo largo el mapa del encoder de ese tamaño, que los conserva. Dibujada, parece una U.

Los tiles avanzan de 448 en 448 píxeles (un stride, otra vez), así que se enciman 64: cerca de la orilla de un tile la red ve ceros de padding en vez de tejido, y el solape evita depender de esas orillas.

### Fuera de ML: los filtros de tu editor de fotos

El «desenfocar» de un editor de fotos es una convolución con un filtro de 3 × 3 cuyos 9 pesos valen 1/9: cada píxel se vuelve el promedio de sus vecinos. «Enfocar» usa un 5 en el centro y −1 arriba, abajo y a los lados. Y el detector de bordes del ejemplo (columnas de 1, 0 y −1) es el filtro de Prewitt, de los años 70. La diferencia con una CNN es quién elige los pesos: ahí una persona; en la red, el entrenamiento.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución; los de tamaños y parámetros se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Una neurona tiene entradas 1, 2 y 3, pesos 0.5, −1 y 1, y sesgo 0.5. ¿Qué sale después de la ReLU? ¿Y si el sesgo fuera −3?
- Productos: 1 × 0.5 = 0.5, 2 × (−1) = −2 y 3 × 1 = 3.
- Suma con el sesgo: 0.5 − 2 + 3 + 0.5 = **2**. No es negativo: la ReLU deja salir **2**.
- Con sesgo −3: 0.5 − 2 + 3 − 3 = −1.5, negativo: sale **0**. El sesgo decide qué tan fácil se activa la neurona.
? [facil] Un MLP para dígitos de 28 × 28 en gris tiene 784 entradas, una capa oculta de 128 neuronas y 10 salidas. ¿Cuántos parámetros tiene y cuántas MACs hace por imagen?
- Capa oculta: 784 × 128 + 128 = 100,352 + 128 = **100,480**.
- Capa de salida: 128 × 10 + 10 = **1,290**.
- Parámetros: 100,480 + 1,290 = **101,770**.
- MACs: una por peso, 784 × 128 + 128 × 10 = 100,352 + 1,280 = **101,632** por imagen.
? [facil] Una entrada de 32 × 32 pasa por una convolución de 5 × 5 sin padding y con stride 1. ¿De qué tamaño sale? ¿Qué padding necesitas para que salga de 32 × 32?
- Sin padding: (32 + 0 − 5) ÷ 1 + 1 = **28**, como en la primera capa de LeNet-5, la CNN de dígitos de 1998.
- Para 32: (32 + 2p − 5) + 1 = 32, así que 2p = 4 y **p = 2**: la regla (k − 1) ÷ 2.
? [facil] Un max pooling de 2 × 2 con stride 2 recibe 256 mapas de 56 × 56. ¿Qué sale y cuántos parámetros tiene?
- Lado: (56 + 0 − 2) ÷ 2 + 1 = **28**. Salen 256 mapas de 28 × 28: el pooling actúa en cada mapa por separado y no cambia la cantidad de canales.
- Números: de 802,816 a 200,704, cuatro veces menos.
- Parámetros: **0**. Solo toma el máximo.
? [medio] Una convolución de 3 × 3 recibe 64 canales, tiene 128 filtros, no lleva sesgo y su salida es de 28 × 28. ¿Cuántos parámetros tiene, cuántas MACs hace y cuántas veces se usa cada peso?
- Pesos por filtro: 3 × 3 × 64 = 576. Parámetros: 576 × 128 = **73,728**.
- MACs: 28 × 28 posiciones × 128 filtros × 576 = 784 × 128 × 576 = **57,802,752**, unos 58 millones.
- Cada peso se usa una vez por posición: **784 veces**, y por eso hay 784 veces más MACs que parámetros.
? [medio] Alguien olvida el center crop y le pasa a la ResNet-50 fotos de 256 × 256. ¿De qué tamaño sale la primera capa (7 × 7, padding 3, stride 2) y después el max pooling (3 × 3, padding 1, stride 2)? ¿De qué tamaño queda el último mapa? ¿Truena el modelo?
- Primera capa: (256 + 6 − 7) ÷ 2 = 127.5, que baja a 127; más 1: **128**.
- Max pooling: (128 + 2 − 3) ÷ 2 = 63.5, que baja a 63; más 1: **64**.
- Último mapa: con salto 32, 256 ÷ 32 = **8**: mapas de 8 × 8 en vez de 7 × 7.
- **No truena:** el pooling global promedia cada mapa, sea de 7 × 7 o de 8 × 8, y la cabeza recibe siempre 2,048 números. Por eso es peligroso: la respuesta cambia un poco y nada avisa, un caso de [[training-serving-skew]].
? [medio] Cuatro capas de 3 × 3: la segunda tiene stride 2 y las demás stride 1. ¿Cuál es el campo receptivo de una neurona de la cuarta capa? ¿Y si las cuatro tuvieran stride 1?
- Empieza con r = 1 y j = 1. Capa 1 (k = 3, s = 1): r = 1 + 2 × 1 = 3, j = 1.
- Capa 2 (s = 2): r = 3 + 2 × 1 = 5, y el salto pasa a j = 2.
- Capa 3: r = 5 + 2 × 2 = 9. Capa 4: r = 9 + 2 × 2 = **13**.
- Todas con stride 1: 1 + 4 × 2 = **9**. El stride de en medio le ganó 4 píxeles al campo.
? [reto] Una cámara de inspección cubre 300 mm con 2,448 píxeles y hay que ver defectos de 0.3 mm. (a) ¿Cuántos píxeles mide un defecto? (b) Si la red recibe tiles de 512 y su backbone tiene salto 32, ¿qué fracción del ancho de una celda del último mapa ocupa el defecto? (c) ¿Qué cambiarías para verlo mejor?
- (a) 300 ÷ 2,448 ≈ 0.1225 mm por píxel, así que 0.3 ÷ 0.1225 ≈ **2.4 píxeles**. Menos que la fisura de C03.
- (b) 2.4 ÷ 32 ≈ **7.7 %** del ancho de una celda de 32 × 32. Y el tile de 512 tiene 16 × 16 = 256 celdas.
- (c) Primero la óptica: un campo de visión más chico (por ejemplo, dos cámaras de 150 mm) duplica los píxeles por defecto. Después, no achicar la imagen; usar mapas de salto 8, donde el defecto ocupa ≈ 31 % del ancho de una celda; y calificar cada posición y tomar el máximo en vez de promediar.
? [reto] La capa final de la ResNet-50 de C01 guarda ≈ 4 % de los parámetros pero hace ≈ 0.025 % de las MACs; la primera capa tiene 9,408 parámetros pero hace 118 millones de MACs. Explica las dos cosas con números: ¿cuántas veces se usa cada peso en cada capa?
- Capa final, densa: cada peso se usa **una vez** por foto, así que sus MACs (1,024,000) son casi sus parámetros (1,024,500); contra ≈ 4,100 millones del modelo, son ≈ 0.025 %.
- Primera capa, convolucional: cada peso se usa en cada posición de la salida, 112 × 112 = **12,544 veces**; 9,408 × 12,544 = 118,013,952 MACs.
- La conclusión: los parámetros dicen cuánta memoria pide un modelo y las MACs cuánto cálculo. En una CNN no van de la mano, porque cada peso se reutiliza miles de veces.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M03 · Latencia y capacidad** hace el chequeo de cordura de esta lección: 8.2 GFLOPs por foto contra ≈ 65 TFLOPS de una T4, un techo de ≈ 7,900 fotos por segundo.
- **M04 · Hardware para inferencia** arranca con la cuenta de los parámetros: 25.6 M × 4 bytes ≈ 102 MB en float32 (la Ronda le dice FP32) y ≈ 51 MB en float16 (FP16); para C01, ≈ 49 MB en float16. Ahí verás también por qué una CNN suele estar limitada por el cálculo, y cuánto pesan YOLOv8m (≈ 25.9 M parámetros) y ViT-B/16 (≈ 86 M).
- **M07 · Servidores de modelos** carga el modelo una vez al arrancar, con `model.eval()` y `torch.inference_mode()`: sin lo primero, la BatchNorm usa las estadísticas del batch.
- **M08 · Optimización** muestra que algunas herramientas que capturan el modelo para acelerarlo (`torch.export`, `torch.compile`) conservan la BatchNorm en modo train si olvidaste `eval()`, mientras que la exportación a ONNX te protege; y que al convertir el modelo a un formato rápido la BatchNorm se «pliega» dentro de la convolución anterior.
- **Los casos.** C01 da el modelo por hecho («ResNet-50 con una capa final de 500 clases»); C02 usa un detector a 640 × 640 con NMS; C03, 20 tiles con un backbone y dos cabezas; C04, una U-Net sobre tiles que se enciman. Ahora sabes qué quiere decir cada palabra.

**En el Dojo:** la estación 7, Empaquetado, usa la cuenta de esta lección, 25.6 M parámetros × 2 bytes ≈ 51 MB, para decidir que el modelo puede ir dentro del paquete del servidor (la imagen de Docker). Cuando abran las estaciones 3 (Entrenamiento) y 5 (Export, engine y paridad), ahí vas a practicar el fine-tuning y la prueba de paridad con `model.eval()`.

**En Sensei:** la siguiente lección, «Embeddings: el significado como coordenadas», usa los 2,048 números del backbone. «Transformers y LLMs» explica la atención que usa el ViT. Más adelante, «Cómo guarda números una computadora» explica float32 y float16, y «Matrices, FLOPs y qué tan rápido calcula una GPU» convierte las MACs de esta lección en milisegundos.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
neurona activacion relu perceptron capa red-neuronal mlp deep-learning inicializacion convolucion filtro mapa-activaciones stride padding pooling cnn campo-receptivo resnet batchnorm dropout modo-eval backbone cabeza transfer-learning fine-tuning vit
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué un perceptrón no puede aprender el XOR, y qué lo resuelve?
Una neurona con escalón separa el plano con una recta, y en el XOR los dos casos que valen 1 están en esquinas opuestas: ninguna recta los aparta de los ceros. Lo resuelve una capa oculta (un MLP), que mueve los puntos para que una recta sí sirva.
? ¿Cuántos parámetros tiene una capa densa con 2,048 entradas y 500 salidas, y cuántas MACs hace por foto?
2,048 × 500 pesos + 500 sesgos = 1,024,500 parámetros, y 2,048 × 500 = 1,024,000 MACs: cada peso se usa una vez. Es la capa final de la ResNet-50 de C01.
? ¿Por qué una CNN necesita tan pocos parámetros comparada con una red densa sobre los mismos píxeles?
Porque cada filtro mira solo un pedacito y se usa en todas las posiciones de la foto. Una capa de 64 filtros de 3 × 3 × 3 tiene 1,792 parámetros; una densa de 1,000 neuronas sobre los mismos 150,528 números tendría ≈ 150 millones.
? Una entrada de 56 × 56 pasa por una convolución de 3 × 3 con padding 1 y stride 2. ¿De qué tamaño sale?
(56 + 2 − 3) ÷ 2 + 1 = 28.5, que se redondea hacia abajo a 28. Con stride 1 habría salido de 56.
? ¿Qué hace la conexión residual de una ResNet?
Le suma al bloque su propia entrada: salida = bloque(x) + x. Cada bloque solo aprende una corrección y la señal del aprendizaje llega bien hasta las primeras capas; eso permitió entrenar redes de hasta 152 capas.
? En producción, la misma foto da respuestas distintas según qué otras fotos venían en su batch. ¿Qué revisas primero?
Que el modelo esté en modo eval (`model.eval()`). En modo train, la BatchNorm normaliza con las estadísticas del batch actual, así que la respuesta depende de las otras fotos.
? ¿Por qué C01 parte de una ResNet-50 preentrenada en ImageNet en vez de entrenar desde cero?
Porque su backbone ya aprendió a ver bordes, texturas y formas con ≈ 1.28 millones de fotos. Basta cambiar la cabeza a 500 categorías y hacer fine-tuning, con muchas menos fotos y horas de GPU.
:::
