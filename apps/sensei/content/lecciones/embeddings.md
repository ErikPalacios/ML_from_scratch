---
titulo: Embeddings: el significado como coordenadas
en: Embeddings: meaning as coordinates
subtitulo: Cómo un modelo convierte una foto o una frase en una lista de números donde lo parecido queda cerca, cómo se mide ese «cerca» y cómo se busca entre 100 millones de esas listas en milisegundos.
pregunta: ¿Cómo encuentra una app «productos parecidos» a una foto, si la computadora solo sabe de números?
requisitos: redes
---

:::idea
Un embedding es una lista de números que un modelo le asigna a cada cosa, de modo que las cosas parecidas reciben listas parecidas. Así, «buscar algo parecido» se convierte en «buscar el punto más cercano», y eso ya es una cuenta.
:::

## Vectores y embeddings {Vectors and embeddings}

Empecemos por la palabra que vas a oír en todo lo que sigue. Un [[vector]] es una lista ordenada de números. Por ejemplo:

- (4, 3) es un vector con 2 números.
- (0.12, −0.80, 0.33) es un vector con 3 números.
- Un vector de 512 números es lo mismo, solo que más largo.

La cantidad de números se llama la [[dimensionalidad|dimensión]] del vector. (4, 3) tiene dimensión 2. El orden importa: (4, 3) y (3, 4) son vectores distintos.

¿Por qué llamarle «vector» y no «lista»? Porque un vector se puede **dibujar**. Con 2 números, el primero dice cuántos pasos ir a la derecha y el segundo cuántos hacia arriba. El vector (4, 3) es el punto que queda 4 a la derecha y 3 arriba del origen (el punto (0, 0), donde se cruzan los ejes). También se dibuja como una flecha que sale del origen y llega a ese punto: el punto dice *dónde*; la flecha, además, *hacia dónde apunta*. Las dos ideas nos van a servir.

Con 3 números ya es un punto en el espacio: derecha, arriba y hacia el frente. Con 512 números ya no lo puedes imaginar, pero las cuentas son exactamente las mismas que en 2D. Por eso en esta lección todo se explica en 2D y luego se dice qué cambia al crecer.

:::nota Vector y tensor
En la lección de imágenes viste que una foto, para el modelo, es un [[tensor]]: una tabla de números con varias dimensiones (canales, alto y ancho). Un vector es un tensor de una sola dimensión: una fila de números. Ojo con la palabra: en un tensor, «dimensiones» cuenta las direcciones de la tabla; en un vector, «dimensión» cuenta cuántos números trae. Un embedding de 512 números es un tensor de 1 dimensión y, a la vez, un vector de dimensión 512.
:::

### Un mapa de productos

Imagina que tomamos cuatro productos del marketplace de C01 y los colocamos en un plano, de modo que los que se parecen queden juntos. Una forma posible:

| Producto | Vector |
|---|---|
| Tenis | (4, 3) |
| Botas | (3, 4) |
| Playera | (−3, 4) |
| Bolsa | (−4, 3) |

Los dos calzados quedan a la derecha, muy juntos. La playera y la bolsa (ropa y accesorios) quedan a la izquierda, también juntas. Entre los dos grupos hay un buen espacio.

:::figura embeddings-plano
Cuatro productos como flechas desde el origen. Los calzados apuntan casi en la misma dirección; la playera queda a 90° de los tenis. Los números son inventados para el ejemplo.
:::

Fíjate en algo importante: **los ejes no tienen nombre**. No dijimos «el eje x es qué tan deportivo es». Solo pedimos que lo parecido quede cerca, y estas coordenadas lo cumplen. Esa es exactamente la situación de un embedding real.

### Qué es un embedding

Un [[embedding]] es el vector que un modelo produce para una cosa (una foto, una frase, un producto, un usuario) con una propiedad muy especial: **cosas parecidas producen vectores cercanos**.

¿De dónde sale? De una [[red-neuronal|red neuronal]] ya entrenada. En la lección de redes viste que una red es una pila de [[capa|capas]], y que cada capa transforma los números que recibe. Las primeras capas detectan cosas simples (bordes, colores); las de más adentro, cosas más abstractas (una suela, unas agujetas). La última capa convierte todo eso en la respuesta final, por ejemplo las 500 categorías de C01.

Si cortas la red **justo antes de esa última capa**, lo que sale es un vector que resume la foto. Ese vector es un embedding. En la ResNet-50 de C01, justo antes de la última capa, sale un vector de 2,048 números.

:::ejemplo Por qué ese vector agrupa lo parecido
Para elegir bien entre 500 categorías, la red tuvo que aprender a dejar las fotos de cada categoría en su propia zona de su espacio interno: si una foto de tenis cayera en la zona de las bolsas, la última capa le pondría «bolsa». Y como tenis y botas comparten mucho (suela, agujetas, forma de pie), sus zonas suelen quedar cerca, y la de las bolsas, lejos. Nadie le pidió «agrupa lo parecido»: lo aprendió porque le servía para acertar. Es una tendencia, no una garantía: el entrenamiento solo le pedía separar categorías.
:::

También hay modelos entrenados **a propósito** para producir embeddings. Se llaman *encoders* (codificadores): entran datos, sale un vector. Muchos se entrenan con [[aprendizaje-contrastivo|aprendizaje contrastivo]]: se les muestran pares que deben quedar juntos, como una foto y su título, y se les corrige cada vez que un par queda lejos o que quedan cerca cosas que no son pareja. Lo ves a fondo en una sección extra, más adelante.

### ¿Por qué no basta con un número por producto?

Cada producto ya tiene un id. ¿Para qué 512 números? Porque un id no dice nada de parecido. Si tenis = 7, botas = 8 y bolsa = 9, parecería que las botas están «entre» los tenis y la bolsa, y eso no significa nada: los números se pusieron en orden de llegada.

La siguiente idea es el [[one-hot]]: un vector con un 1 en la posición de su categoría y 0 en las demás. Con 3 categorías, tenis = (1, 0, 0), botas = (0, 1, 0) y bolsa = (0, 0, 1). Ya no hay un orden falso, pero tampoco hay parecido: cada producto es una esquina distinta, y todas las esquinas están a la misma distancia entre sí. Los tenis quedan igual de lejos de las botas que de la bolsa.

Un embedding resuelve justo eso: **la distancia entre dos vectores significa algo**. Y gana otra cosa: una publicación nueva, que el modelo nunca vio, recibe su vector igual, porque el modelo lo calcula a partir de su foto.

### Tamaños reales

Un embedding real no tiene 2 números, tiene cientos o miles. Algunos que vas a oír:

| Modelo | Qué codifica | Dimensión |
|---|---|---|
| ResNet-50 (antes de su última capa) | Fotos | 2,048 |
| BERT-base | Texto | 768 |
| CLIP ViT-B/32 | Fotos y texto, en el mismo espacio | 512 |

Cada número se guarda normalmente como [[float32]], que ocupa 4 bytes. Un embedding de 512 números ocupa entonces 512 × 4 bytes = 2,048 bytes ≈ 2 KB. Parece nada. Guarda esa cifra: cuando sean 100 millones de productos, va a decidir la arquitectura.

### Texto e imágenes en el mismo espacio

Un embedding [[multimodal]] pone cosas de distinto tipo, como fotos y textos, en el **mismo espacio**, para compararlas directamente. El más conocido es **CLIP**, que OpenAI publicó en 2021: dos redes, una para fotos y otra para texto, entrenadas juntas para que una foto quede cerca de su descripción. El vector del texto «unos tenis blancos» queda cerca del vector de una foto de unos tenis blancos. Así puedes buscar fotos con texto, texto con fotos o fotos con fotos, con la misma búsqueda. La versión CLIP ViT-B/32 (su red de fotos es un [[vit|ViT]], un transformer que parte la foto en cuadritos de 32 × 32 píxeles) produce 512 números para las dos cosas.

:::analogia Coordenadas en un mapa
Un embedding funciona como las coordenadas de una ciudad en un mapa: dos ciudades vecinas tienen coordenadas parecidas, y para saber si dos ciudades están cerca no necesitas conocerlas, basta con restar sus coordenadas.

**Dónde se rompe:** un mapa tiene 2 ejes con significado (norte-sur y este-oeste). Un embedding tiene cientos de ejes y ninguno, por separado, significa algo que puedas nombrar. Además, en un mapa la distancia es un hecho físico; en un embedding, «cerca» quiere decir «el modelo los considera parecidos», que puede no ser lo que tú considerarías parecido.
:::

:::ojo
Dos embeddings solo se pueden comparar si los produjo **el mismo modelo, en la misma versión**. Cada modelo inventa su propio «mapa». Comparar el vector de una foto hecho con la versión 1 contra uno hecho con la versión 2 es como comparar coordenadas de dos mapas con distinto origen y distinta escala: la cuenta sale, pero no significa nada. En la Ronda esto aparece como una regla: nunca mezclar versiones de embeddings en un mismo índice.
:::

## El producto punto {The dot product}

Para comparar dos embeddings hace falta una cuenta. La más importante de toda la lección, y una de las más repetidas de todo ML, es el [[producto-punto|producto punto]] (*dot product*): **multiplicas coordenada por coordenada y sumas todo**. Se escribe a · b, y el resultado es **un solo número**, no otro vector.

:::ejemplo Tres productos punto con lápiz
Tenis = (4, 3) y botas = (3, 4): 4 × 3 + 3 × 4 = 12 + 12 = **24**.

Tenis y playera = (−3, 4): 4 × (−3) + 3 × 4 = −12 + 12 = **0**.

Tenis y bolsa = (−4, 3): 4 × (−4) + 3 × 3 = −16 + 9 = **−7**.

Con 3 números es igual: (1, 2, 3) · (4, 5, 6) = 4 + 10 + 18 = **32**. Con 512 números son 512 multiplicaciones y 511 sumas.
:::

No es una cuenta rara de matemáticos. La haces cada vez que pagas en una tienda: compras 2 playeras de $50, 1 gorra de $120 y 3 pares de calcetines de $15. Las cantidades son el vector (2, 1, 3) y los precios, (50, 120, 15). El total es su producto punto: 2 × 50 + 1 × 120 + 3 × 15 = 100 + 120 + 45 = **$265**. Cada cantidad se «pesa» con su precio y todo se suma.

Y ya lo viste en la lección de redes: una [[neurona]] multiplica cada entrada por su peso y suma. Eso es el producto punto entre las entradas y los pesos, más el sesgo. La última capa de la ResNet-50 de C01 hace 500 productos punto, uno por categoría, de 2,048 números cada uno: 2,048 × 500 = 1,024,000 multiplicaciones para sacar los 500 [[logit|logits]].

### Lo que significa en el dibujo

El **signo** dice hacia qué lado apuntan las dos flechas:

- **Positivo** si apuntan hacia el mismo lado, es decir, si forman menos de 90°: tenis y botas, 24.
- **Cero** si son perpendiculares, a 90°: tenis y playera, 0.
- **Negativo** si apuntan hacia lados opuestos, a más de 90°: tenis y bolsa, −7.

El **tamaño** también se lee. Primero, el producto punto de un vector consigo mismo da su largo al cuadrado: (4, 3) · (4, 3) = 16 + 9 = 25, y √25 = 5. Es el teorema de Pitágoras: la flecha de los tenis mide 5. Las botas también miden 5.

Segundo, el producto punto es una **sombra**. Desde la punta de los tenis baja una línea perpendicular hasta la línea que apunta hacia las botas. El pedazo de esa línea que va del origen al punto donde cae mide 4.8: es lo que los tenis avanzan en la dirección de las botas, su «sombra» sobre ellas. Multiplica esa sombra por el largo de las botas: 4.8 × 5 = 24. Es el producto punto.

:::figura embeddings-proyeccion
Arriba, la sombra de los tenis sobre la dirección de las botas mide 4.8, y 4.8 × 5 = 24. Abajo, el signo del producto punto según el ángulo entre las flechas.
:::

¿De qué depende el largo de esa sombra? Del largo de los tenis y del ángulo entre las dos flechas. Con el ángulo muy cerrado, la sombra es casi tan larga como la flecha; a 90°, desaparece; si el ángulo pasa de 90°, cae del lado contrario y cuenta como negativa. Esa fracción de la flecha que queda como sombra tiene un nombre que seguramente viste en la prepa: el **coseno** del ángulo, una función que vale 1 a 0°, 0 a 90° y −1 a 180°. Para tenis y botas el ángulo es de unos 16° y su coseno, 0.96: la sombra mide 5 × 0.96 = 4.8. Juntando todo:

a · b = (largo de a) × (largo de b) × (coseno del ángulo entre a y b)

Con tenis y botas: 5 × 5 × 0.96 = 24.

:::ojo
**El producto punto mezcla dirección y largo.** Una flecha más larga saca productos punto más grandes con todo. (8, 6) apunta exactamente hacia donde apunta (4, 3), pero (8, 6) · (3, 4) = 24 + 24 = 48, el doble. Si comparas embeddings con el producto punto sin cuidar el largo, un vector largo «se parece» a todo. La siguiente sección arregla eso.
:::

¿Por qué el producto punto está en todas partes? Porque es la forma más barata de medir «qué tanto apuntan juntos» dos vectores: si cada uno tiene d números (d es su dimensión), son d multiplicaciones y d − 1 sumas, sin nada más. Y muchos productos punto juntos son una multiplicación de matrices, la operación para la que están hechas las [[gpu|GPUs]]; lo ves en la lección de matrices y FLOPs. En la lección de transformers vas a ver que la atención compara palabras exactamente así.

## Coseno, distancia y normalización L2 {Cosine, distance and L2 normalization}

Si «parecido» significa «cerca», necesitamos medir qué tan cerca están dos vectores. Hay dos medidas que se usan muchísimo, y una forma de preparar los vectores que hace que las dos digan lo mismo.

### Distancia euclidiana: la de la regla

La [[distancia-euclidiana|distancia euclidiana]] es la distancia en línea recta, la que medirías con una regla. Es el teorema de Pitágoras: restas coordenada por coordenada, elevas al cuadrado, sumas y sacas raíz.

:::ejemplo Distancia entre tenis y botas
Tenis = (4, 3) y botas = (3, 4).

1. Restas: 4 − 3 = 1 y 3 − 4 = −1.
2. Elevas al cuadrado: 1² = 1 y (−1)² = 1.
3. Sumas: 1 + 1 = 2.
4. Raíz: √2 ≈ 1.41.

Entre tenis (4, 3) y playera (−3, 4): diferencias 7 y −1; cuadrados 49 y 1; suma 50; √50 ≈ 7.07. La playera está unas cinco veces más lejos que las botas.
:::

Con 512 números es lo mismo, solo que restas, elevas y sumas 512 veces.

### Similitud coseno: hacia dónde apuntan

La [[similitud-coseno|similitud coseno]] no mide la distancia entre las puntas, sino el **ángulo** entre las dos flechas. Si apuntan en la misma dirección, vale 1. Si son perpendiculares (90°), vale 0. Si apuntan en direcciones opuestas, vale −1. Se calcula con la fórmula de la sección anterior, despejada: el producto punto dividido entre los dos largos.

coseno = (a · b) ÷ (largo de a × largo de b)

:::cuenta El coseno entre tenis y botas
Producto punto | 4 × 3 + 3 × 4 | 24
Largo de los tenis // Pitágoras | √(4² + 3²) = √25 | 5
Largo de las botas | √(3² + 4²) = √25 | 5
Coseno | 24 ÷ (5 × 5) | **0.96**
Ángulo // el que tiene ese coseno | arccos 0.96 | ≈ 16°
= 0.96: casi la misma dirección. Con la playera: 0 ÷ 25 = **0** (90°, nada que ver). Con la bolsa: −7 ÷ 25 = **−0.28** (≈ 106°, lados algo opuestos).
:::

:::calculadora embeddings-coseno
Prueba también **b** = (−4, −3): son los tenis al revés, a 180°, y el coseno da −1.
:::

### ¿Por qué ignorar el largo?

Imagina una publicación de tenis con una descripción larguísima, y que el modelo le da el vector (8, 6) en vez de (4, 3). Es la misma dirección, solo el doble de larga. La distancia euclidiana entre (4, 3) y (8, 6) es 5, más lejos que la playera de su bolsa (√2 ≈ 1.41). El coseno, en cambio, es (32 + 18) ÷ (5 × 10) = 50 ÷ 50 = 1: idénticos en dirección.

Muchas veces lo que importa es la dirección (de qué se trata) y no el largo. Para eso sirve normalizar.

### Normalización L2: que todos midan 1

Normalizar un vector es dividir cada uno de sus números entre su largo, para que el vector mida exactamente 1. Se llama [[normalizacion-l2|normalización L2]] porque «norma L2» es el nombre técnico del largo de Pitágoras (la raíz de la suma de los cuadrados).

:::ejemplo Normalizar los tenis
Los tenis (4, 3) miden 5. Divididos entre 5: (4 ÷ 5, 3 ÷ 5) = **(0.8, 0.6)**. Comprueba el largo: 0.8² + 0.6² = 0.64 + 0.36 = 1, y √1 = 1.

Las botas quedan en (0.6, 0.8); la playera, en (−0.6, 0.8), y la bolsa, en (−0.8, 0.6). Los tenis «largos» (8, 6) miden 10, y divididos entre 10 también quedan en (0.8, 0.6): normalizar borra la diferencia de largo y deja solo la dirección.
:::

Con todos los vectores normalizados pasan dos cosas muy útiles:

1. **El coseno es solo el producto punto**, porque los largos valen 1 y dividir entre 1 no cambia nada: (0.8, 0.6) · (0.6, 0.8) = 0.48 + 0.48 = 0.96. Una cuenta menos en cada comparación, y son millones de comparaciones.
2. **La distancia y el coseno ordenan igual a los vecinos.** Con vectores de largo 1, la distancia al cuadrado es exactamente 2 − 2 × coseno. Mientras más alto el coseno, más chica la distancia.

:::cuenta Distancia y coseno, con vectores de largo 1
Coseno = producto punto // tenis (0.8, 0.6) y botas (0.6, 0.8), ya normalizados | 0.8 × 0.6 + 0.6 × 0.8 | 0.96
Distancia al cuadrado | (0.8 − 0.6)² + (0.6 − 0.8)² | 0.08
La misma, con la fórmula | 2 − 2 × 0.96 | 0.08
Distancia | √0.08 | ≈ 0.28
= Ordenar a los vecinos por coseno (de mayor a menor) o por distancia (de menor a mayor) da exactamente la misma lista.
:::

Por eso la Ronda dice que el encoder de C07 entrega vectores de 512 números «L2-normalizados»: el índice puede comparar con el producto punto, la cuenta más barata. Y cuando una publicación junta su foto y su título en un solo vector, se promedian los dos y el resultado **se vuelve a normalizar**, porque el promedio de dos flechas de largo 1 casi nunca mide 1 (lo calculas en los ejercicios).

:::ojo
**No es la normalización de las fotos.** En la lección de imágenes, [[normalizacion|normalizar]] era restarle a cada píxel un promedio y dividirlo entre una desviación. La normalización L2 es otra cosa: divide un vector completo entre su largo. Las dos se llaman «normalizar» porque las dos llevan los números a una escala estándar.
:::

:::nota La métrica de un índice
Al crear un índice de vectores te piden la métrica: distancia L2, coseno o producto punto (*inner product*). Con vectores normalizados, las tres ordenan igual. Sin normalizar, el producto punto premia a los vectores largos. La regla es usar la métrica con la que se entrenó el modelo; su documentación la dice.
:::

Así se ve todo en Python, sin instalar nada:

```python
import math

def punto(a, b):
    return sum(x * y for x, y in zip(a, b))

def largo(a):
    return math.sqrt(punto(a, a))

def coseno(a, b):
    return punto(a, b) / (largo(a) * largo(b))

def normalizar(a):
    n = largo(a)
    return [x / n for x in a]

tenis = [4, 3]
otros = {"botas": [3, 4], "playera": [-3, 4], "bolsa": [-4, 3], "tenis × 2": [8, 6]}
for nombre, v in otros.items():
    print(f"{nombre:10} punto = {punto(tenis, v):3}   coseno = {coseno(tenis, v):5.2f}")

t, b = normalizar(tenis), normalizar([3, 4])
print("tenis normalizado:", t, "  largo:", largo(t))
print("punto de los dos normalizados:", round(punto(t, b), 2))
```

```salida
botas      punto =  24   coseno =  0.96
playera    punto =   0   coseno =  0.00
bolsa      punto =  -7   coseno = -0.28
tenis × 2  punto =  50   coseno =  1.00
tenis normalizado: [0.8, 0.6]   largo: 1.0
punto de los dos normalizados: 0.96
```

## Buscar el más cercano entre 100 millones {Searching among 100 million}

Con lo anterior ya puedes construir una [[busqueda-semantica|búsqueda semántica]], una búsqueda por significado: calculas el embedding de lo que el usuario busca y encuentras los productos cuyo embedding está más cerca. Encontrar los k más cercanos se llama búsqueda de [[vecinos-cercanos|vecinos más cercanos]] (*nearest neighbors*). Si k = 30, quieres los 30 más parecidos.

La forma más obvia es la **búsqueda exacta**, también llamada fuerza bruta (*brute force*): comparas el vector de la búsqueda contra todos los del catálogo, uno por uno, y te quedas con los mejores. Así se ve con un catálogo de juguete de 6 productos, con vectores inventados de 3 números:

```python
import math

def normalizar(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]

catalogo = {                      # vectores inventados de 3 números
    "tenis blancos":  [0.9, 0.3, 0.1],
    "tenis negros":   [0.8, 0.5, 0.0],
    "botas cafés":    [0.5, 0.8, 0.2],
    "sandalias":      [0.6, 0.1, 0.7],
    "playera blanca": [0.1, 0.2, 0.9],
    "bolsa de piel":  [-0.2, 0.9, 0.3],
}
indice = {nombre: normalizar(v) for nombre, v in catalogo.items()}   # una sola vez

def buscar(consulta, k):
    q = normalizar(consulta)
    puntajes = []
    for nombre, v in indice.items():                 # fuerza bruta: contra todos
        puntajes.append((sum(a * b for a, b in zip(q, v)), nombre))
    puntajes.sort(reverse=True)
    return puntajes[:k]

for coseno, nombre in buscar([0.85, 0.35, 0.15], k=3):
    print(f"{coseno:.3f}  {nombre}")
```

```salida
0.996  tenis blancos
0.973  tenis negros
0.818  botas cafés
```

Fíjate en dos cosas. Los vectores del catálogo se normalizan **una vez**, al armar el índice; la consulta se normaliza en cada búsqueda. Y el ciclo `for` recorre **todo** el catálogo. Con 6 productos es instantáneo. Veamos con un catálogo de verdad.

### Las cuentas de C07

En la Ronda, el caso C07 es una búsqueda por texto y por foto sobre el mismo marketplace de C01. Tiene ≈ 100 millones de publicaciones activas, cada una con un embedding de 512 números, y en la hora pico llegan ≈ 1,750 búsquedas por segundo.

:::cuenta Memoria para guardar los vectores
Un vector // 512 números en float32 | 512 × 4 bytes | 2,048 bytes ≈ 2 KB
El catálogo | 100,000,000 × 2,048 bytes | 204,800,000,000 bytes
En gigabytes | ÷ 1,000,000,000 | **204.8 GB ≈ 205 GB**
= Una laptop típica tiene 8 o 16 GB de memoria: esto no cabe ni en 10 laptops de 16 GB.
:::

:::cuenta El trabajo de una búsqueda exacta
Una comparación // un producto punto de 512 números | 512 multiplicaciones | 512
Una búsqueda // contra todo el catálogo: 51.2 mil millones | 100,000,000 × 512 | **51,200,000,000**
Un segundo en el pico // unos 90 millones de millones | 51,200,000,000 × 1,750 | ≈ 90,000,000,000,000
Leer los vectores // en cada búsqueda, a 200 GB por segundo | 204.8 GB ÷ 200 GB/s | ≈ 1 s
= Cada búsqueda tendría que leer los 205 GB completos de la memoria, y solo eso ya tarda del orden de un segundo.
:::

La memoria de un servidor grande entrega del orden de unos cientos de GB por segundo. A 200 GB por segundo, solo leer los vectores tomaría ≈ 1 segundo por búsqueda; aun al doble de velocidad, medio segundo. Y C07 se compromete a que 99 de cada 100 búsquedas de texto respondan en menos de 300 ms.

:::calculadora embeddings-indice
Prueba los números de C08 de la Ronda: 100 millones de vectores de 128 números en int8 (1 byte). La memoria baja a 12.8 GB, pero la búsqueda exacta sigue leyendo todo en cada consulta.
:::

La búsqueda exacta es perfecta en calidad e imposible en costo. Hace falta otra idea.

### Búsqueda aproximada: no mirarlo todo

Casi siempre no necesitas los 30 vecinos **exactos**. Te basta con 30 que sean muy buenos, aunque de vez en cuando se te escape alguno de los verdaderos. Esa renuncia es la que abre la puerta: buscar los vecinos más cercanos **aproximados**, en inglés *approximate nearest neighbors*, o [[ann|ANN]].

Un ANN no compara contra todo el catálogo. Antes de que llegue cualquier búsqueda, organiza los vectores para que, cuando llegue una, solo tenga que revisar una parte pequeña y bien elegida. Esa organización guardada se llama [[indice-vectorial|índice vectorial]].

### Estantes: la idea más simple

:::analogia Una biblioteca ordenada por estantes
En una biblioteca sin orden, para encontrar un libro de cocina tendrías que revisar todos los libros. En una biblioteca ordenada por temas vas directo al estante de cocina y revisas solo ese. Ordenar los estantes costó trabajo, pero se hizo una vez; cada búsqueda después es rápida.

Un índice vectorial puede hacer lo mismo: agrupa los vectores en «estantes» de vectores parecidos. Cuando llega una búsqueda, primero ve qué estantes quedan más cerca y revisa solo esos. Los índices de este tipo se llaman IVF (*inverted file*).

**Dónde se rompe (y por qué importa):** un libro de nutrición con muchas recetas pudo quedar en el estante de salud. Si solo revisas el de cocina, no lo ves, aunque era justo el que buscabas. En la biblioteca esto pasa poco; en un espacio de 512 dimensiones, con millones de vectores cerca de las orillas de cada grupo, pasa todo el tiempo. Por eso un ANN se puede equivocar, y por eso se mide cuánto.
:::

:::figura embeddings-estantes
Un índice por grupos. La búsqueda (la estrella) solo revisa el grupo más cercano. El vecino verdadero más cercano quedó del otro lado de la orilla, en otro grupo, y se pierde: eso es lo que mide el recall.
:::

### Velocidad contra recall

¿Qué tanto se pierde? Se mide comparando el ANN contra la búsqueda exacta en una muestra de búsquedas. Si la búsqueda exacta dice que estos son los 100 vecinos verdaderos y el ANN encontró 95 de ellos, su **recall@100** es 95 ÷ 100 = 0.95. Es el mismo [[recall]] de la lección «¿Aprendió de verdad?»: de lo que había que encontrar, cuánto encontraste.

La perilla es cuánto del catálogo revisar. En un índice por estantes, cuántos estantes. En [[hnsw|HNSW]], el índice que elige C07, el tamaño de la lista de candidatos que mantiene al buscar, que se llama `ef_search`. HNSW une los vectores en una red de caminos y busca saltando de vecino en vecino; lo ves por dentro en la sección siguiente.

| Mueves la perilla a… | Velocidad | Recall |
|---|---|---|
| Revisar muy poco (1 estante, una lista corta) | Muy rápido | Más bajo: se escapan los vecinos de la orilla |
| Revisar más (10 estantes, una lista larga) | Más lento | Más alto |
| Revisar todo | Tan lento como la búsqueda exacta | 1.0, perfecto |

No existe el índice rápido y perfecto: existe el punto de la perilla que tu sistema puede pagar. En C07 se pide **recall@100 ≥ 0.95**, y se vigila en producción con un *job* (un programa que corre solo, termina y vuelve a correr) que cada hora lanza un set fijo de unas 1,000 búsquedas contra el ANN y contra la búsqueda exacta sobre los mismos vectores, y compara.

## Un grafo con atajos: HNSW {A graph with shortcuts: HNSW} [extra]

Uno de los índices más usados hoy, y el que elige C07, se llama [[hnsw|HNSW]] (*Hierarchical Navigable Small World*, «mundo pequeño navegable por niveles»; Malkov y Yashunin, 2016). En lugar de estantes, organiza los vectores como una red de caminos: puntos unidos por líneas, lo que en matemáticas se llama un grafo.

:::pasos
1. Cada vector se une con unos cuantos vecinos
Al construir el índice, cada vector se conecta con unas decenas de vectores cercanos. Así queda una red de caminos cortos entre vectores parecidos.
2. Buscar es caminar hacia la consulta
Empiezas en un punto de entrada. Miras a sus vecinos y saltas al que quede más cerca de tu consulta. Repites desde ahí. Cuando ningún vecino te acerca más, te detienes: ahí están tus candidatos.
3. Los niveles son los atajos
Con puros caminos cortos, cruzar 100 millones de puntos tomaría muchísimos saltos. Por eso HNSW arma niveles: arriba, pocos puntos unidos por saltos largos; abajo, todos los puntos con caminos cortos. La búsqueda empieza arriba, se acerca rápido a la zona correcta, baja de nivel y termina con pasos finos.
:::

:::figura embeddings-grafo
Una búsqueda en HNSW con 24 puntos. Arriba, tres saltos largos acercan rápido a la zona de la consulta (la estrella); abajo, dos pasos cortos terminan el trabajo. Con 100 millones de puntos, la parte que se revisa es muchísimo menor que la mitad.
:::

:::analogia Manejar a otra ciudad
Para ir de Guadalajara a una calle de Monterrey no recorres todas las calles del país: tomas la carretera hasta la ciudad correcta y ahí te mueves por calles hasta la puerta. Los niveles de HNSW son eso: carretera primero, calles al final.

**Dónde se rompe:** tú llevas un mapa completo; HNSW no. En cada punto solo ve a sus vecinos y salta al que esté más cerca de la consulta. Por eso se puede quedar en un punto que es el mejor de su barrio sin serlo del mapa entero. Para equivocarse menos, no sigue un solo camino: mantiene una lista de los mejores candidatos que ha visto y explora desde varios a la vez. El tamaño de esa lista es su perilla principal: el `ef_search` de la sección anterior.
:::

Gracias a los atajos, el trabajo crece muy despacio con el tamaño del catálogo. En la Ronda lo vas a leer como «el recorrido de HNSW crece como log N», donde N es el número de vectores: si el catálogo se duplica, la búsqueda da unos pocos saltos más, no el doble de trabajo.

## Dimensiones, bytes y umbrales {Dimensions, bytes and thresholds} [extra]

La [[dimensionalidad]] de un embedding, cuántos números tiene, es una decisión de diseño con un precio claro. En la calculadora de memoria viste que la memoria y el trabajo crecen **en proporción** a la dimensión: 1,024 números cuestan el doble que 512. ¿Qué se compra con ese precio?

### Más números, más lugar para los detalles

Con más dimensiones, el modelo tiene más lugar para separar cosas finas: el color exacto, el estilo, la marca. Con pocas tiene que apretar: lo general sobrevive y lo fino se pierde. Pero la ganancia se aplana: en general, cada vez que duplicas la dimensión ganas menos que la vez anterior, mientras el costo se sigue duplicando. Por eso se busca la dimensión más chica que cumpla con la calidad.

La Ronda elige distinto en cada caso, y siempre con la cuenta de memoria enfrente:

| Caso | Qué guarda | Dimensión | Lo que pesa |
|---|---|---|---|
| C08 · Recomendación | Un vector por publicación, entrenado para recomendar | 128 | 100 M × 128 × 1 byte = 12.8 GB en int8 |
| C07 · Búsqueda | Foto y título en el mismo espacio | 512 | 100 M × 512 × 1 byte = 51.2 GB en int8 |
| C11 · [[rag\|RAG]] | Pedazos de documentos de ≈ 400 [[token\|tokens]] | 1,024 | 12 M × 1,024 × 4 bytes ≈ 49.2 GB en float32 |

C08 usa 128 y no 512 porque sus vectores se entrenan solo para recomendar, no para describir la foto: cuatro veces menos memoria. Algunos modelos modernos dejan elegir la dimensión sin reentrenar: sus primeros números ya funcionan como un embedding más chico (se llaman embeddings *Matryoshka*, como las muñecas rusas que caben una dentro de otra). En C11, uno de los modelos candidatos permite cualquier dimensión de 32 a 1,024.

### Bytes por número

Cada número tampoco tiene que ocupar 4 bytes:

| Formato | Bytes por número | 100 M vectores de 512 | Qué pierdes |
|---|---|---|---|
| float32 | 4 | 204.8 GB | Nada: es la referencia |
| float16 | 2 | 102.4 GB | Casi nada |
| int8 | 1 | 51.2 GB | Algo de precisión en las distancias |

Guardar con menos bytes se llama [[cuantizacion|cuantización]]; la ves con calma en la lección de cómo guarda números una computadora. C07 recorre el índice en int8 y, para el orden final, recalcula la distancia de sus mejores 200 candidatos de cada pedazo con los vectores completos en float32. Así, el recorrido del grafo, que toca muchísimos vectores, trabaja con 51.2 GB y no con 204.8, y los vectores completos solo se leen para esos 200 candidatos: se recupera casi toda la exactitud.

### El índice pesa más que los vectores

Un índice HNSW guarda, además de los vectores, sus caminos. La perilla de construcción se llama M: cuántos vecinos guarda cada punto. En el nivel de abajo guarda hasta 2 × M, y cada vecino es un número de 4 bytes (su posición en la lista).

:::cuenta La memoria del índice de C07
Vectores en int8 | 100,000,000 × 512 × 1 byte | 51.2 GB
Caminos de un vector // con M = 32: hasta 64 vecinos | 64 × 4 bytes | 256 bytes
Caminos de todo el catálogo | 100,000,000 × 256 bytes | ≈ 25.6 GB
Total | 51.2 + 25.6 | **≈ 77 GB**
= C07 lo parte en 4 pedazos (*shards*) de 25 M vectores, de ≈ 19 GB cada uno más lo que agrega el motor, y guarda 2 copias de cada pedazo en máquinas distintas.
:::

### Lo raro de muchas dimensiones

En muchas dimensiones pasa algo que no se ve en 2D: **dos vectores al azar salen casi perpendiculares**. Compruébalo:

```python
import math, random

random.seed(7)

def coseno(a, b):
    p = sum(x * y for x, y in zip(a, b))
    return p / math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))

for d in [2, 16, 128, 512]:
    cosenos = []
    for _ in range(2000):                     # 2,000 pares de vectores al azar
        a = [random.gauss(0, 1) for _ in range(d)]
        b = [random.gauss(0, 1) for _ in range(d)]
        cosenos.append(abs(coseno(a, b)))     # sin signo: qué tan lejos de 0
    tipico = sum(cosenos) / len(cosenos)
    arriba = sum(c > 0.2 for c in cosenos) / len(cosenos)
    print(f"d = {d:3}   coseno típico = {tipico:.3f}   pares con más de 0.2: {arriba:4.0%}")
```

```salida
d =   2   coseno típico = 0.637   pares con más de 0.2:  88%
d =  16   coseno típico = 0.204   pares con más de 0.2:  44%
d = 128   coseno típico = 0.071   pares con más de 0.2:   2%
d = 512   coseno típico = 0.037   pares con más de 0.2:   0%
```

En 2 dimensiones, dos flechas al azar suelen tener un coseno grande. En 512, casi nunca pasan de 0.2: el coseno típico baja más o menos como 1 ÷ √d. Hay tantas direcciones posibles que dos vectores sin relación casi no se «tocan».

Eso tiene dos consecuencias. Primera: un coseno de 0.3 entre dos embeddings de 512 números puede querer decir mucho, porque al azar saldría ≈ 0.04. Segunda: los vectores de un modelo real **no** están repartidos al azar; muchos modelos los dejan en una zona estrecha del espacio, y ahí hasta dos frases sin relación pueden dar un coseno alto. Por eso la escala de los cosenos cambia de un modelo a otro, y un umbral nunca se copia de un modelo a otro: se mide con pares revisados por personas, como en el ejemplo que sigue.

### Un umbral: ¿es la misma foto?

A veces no quieres «los más parecidos», sino decidir **sí o no**: ¿estas dos fotos son la misma? Un vendedor sube la misma foto en tres publicaciones, una recortada y otra recomprimida. Byte por byte los archivos son distintos, pero sus embeddings quedan casi en el mismo punto. Encontrarlos para quedarse con uno, o para tratarlos como grupo, se llama [[deduplicacion|deduplicación]] (*deduplication*, o *dedup*).

La regla es sencilla: si el coseno entre dos fotos pasa un [[umbral]], se marcan como [[duplicado-cercano|casi duplicadas]]. Lo difícil es elegir el umbral, y eso se hace con ejemplos revisados por personas, no a ojo.

:::ejemplo Elegir el umbral con 8 pares revisados
Una persona revisó 8 pares de fotos y anotó cuáles son la misma foto:

| Par | Coseno | ¿La misma foto? |
|---|---|---|
| 1 | 0.99 | Sí: recomprimida |
| 2 | 0.98 | Sí: recortada |
| 3 | 0.96 | Sí: con marca de agua |
| 4 | 0.95 | No: los mismos tenis, otra foto del mismo vendedor |
| 5 | 0.93 | Sí: con filtro de color |
| 6 | 0.91 | No: el mismo modelo, otro vendedor |
| 7 | 0.88 | No |
| 8 | 0.80 | No |

Hay 4 duplicados de verdad: los pares 1, 2, 3 y 5. Con cada umbral cambia lo que se marca (se marca todo par con coseno igual o mayor):

| Umbral | Marca | Aciertos | Precision | Recall |
|---|---|---|---|---|
| 0.97 | pares 1 y 2 | 2 de 2 | 1.00 | 2 de 4 = 0.50 |
| 0.95 | pares 1 a 4 | 3 de 4 | 0.75 | 3 de 4 = 0.75 |
| 0.90 | pares 1 a 6 | 4 de 6 | 0.67 | 4 de 4 = 1.00 |
:::

Es el mismo juego de [[precision]] contra [[recall]] de la lección «¿Aprendió de verdad?», y el umbral correcto depende de **qué cuesta cada error**:

- **Antes de repartir un dataset** en entrenamiento y examen conviene un umbral bajo, con recall alto. Un duplicado que se escapa pone la misma foto en los dos lados y el examen mide memoria: es [[leakage]]. Juntar de más dos fotos distintas cuesta poco: solo caen del mismo lado.
- **En moderación de contenido** (C06 en la Ronda), una decisión se aplica a todo un grupo de casi duplicados: si quitas una imagen, quitas sus copias. Ahí conviene un umbral estricto, con precision alta, porque juntar de más castigaría algo distinto.

Dos detalles prácticos. Las copias **exactas** se detectan antes y más barato con un hash del archivo: una huella de sus bytes que cambia si cambia un solo byte (ya la usaste en «Datos, ejemplos, features y etiquetas»; a fondo, en «Tiempo, hashes e identificadores»). Los embeddings son para lo que no es idéntico: recortes, recompresiones, filtros. Y en un catálogo grande no se compara cada foto contra todas: para cada foto nueva se buscan sus vecinos más cercanos con un índice, como el de la búsqueda, y solo a esos se les aplica el umbral.

## Palabras contra significado: búsqueda híbrida {Words versus meaning: hybrid search} [extra]

Antes de los embeddings, los buscadores emparejaban palabras. Esa forma de buscar sigue siendo muy buena en algunas cosas, y por eso no desaparece: se combina.

### La búsqueda por palabras y BM25

Un buscador por palabras guarda, para cada palabra, la lista de documentos que la contienen. Es un **índice invertido**, como el índice alfabético al final de un libro: buscas «tenis» y te dice en qué páginas está. Cuando alguien busca «tenis jordan blancos», junta las publicaciones que tienen esas palabras y las ordena con una fórmula. La más usada desde hace décadas es [[bm25|BM25]] (*Best Matching 25*, de Robertson y su equipo, en los años noventa). Su intuición son tres ideas:

1. **Las palabras raras pesan más.** «Para» aparece en casi todo y no ayuda a distinguir; «jordan» aparece en poquitas publicaciones, y si coincide, dice mucho. Ese peso se llama IDF (*inverse document frequency*, frecuencia inversa en los documentos).
2. **Repetir no vale tanto.** Que «tenis» aparezca 10 veces en un título no lo hace 10 veces más relevante: con los valores que usa por defecto Lucene (la biblioteca que hay debajo de Elasticsearch y OpenSearch, dos motores de búsqueda muy usados), 10 repeticiones valen menos del doble que una. Así un vendedor no gana repitiendo la palabra.
3. **Los textos largos se castigan un poco.** Una coincidencia en un título corto dice más que en una descripción de 300 palabras.

El peso de la primera idea se calcula con el [[logaritmo]] natural, que se escribe ln: una función que crece muy despacio (ln 10 ≈ 2.3 y ln 2,000 ≈ 7.6). En su versión más simple, el peso de una palabra es ln(publicaciones en total ÷ publicaciones que la tienen):

:::cuenta El peso de tres palabras en 1,000,000 de publicaciones
«blancos» // está en 100,000 | ln(1,000,000 ÷ 100,000) = ln 10 | ≈ 2.3
«tenis» // está en 20,000 | ln(1,000,000 ÷ 20,000) = ln 50 | ≈ 3.9
«jordan» // está en 500 | ln(1,000,000 ÷ 500) = ln 2,000 | ≈ 7.6
= Una coincidencia en «jordan» pesa unas 3 veces lo que una en «blancos». La fórmula exacta de BM25 agrega un 0.5 (para no dividir entre cero si ninguna publicación tiene la palabra) y un 1 (para que el peso nunca salga negativo), y aquí da prácticamente lo mismo: 2.30, 3.91 y 7.60.
:::

Gracias al logaritmo, una palabra 200 veces más rara no pesa 200 veces más, sino unas 3.

### Dónde falla cada una

| Lo que pasa | Por palabras (BM25) | Por significado (embeddings) |
|---|---|---|
| Buscas «chamarra de mezclilla» y la publicación dice «chaqueta de jean» | No la encuentra: ninguna palabra coincide | La encuentra: significan lo mismo |
| Buscas «algo para ir a la playa» | Busca «playa» literal | Trae sandalias, trajes de baño, sombreros |
| Escribes con un error | Falla si la palabra no existe tal cual | Muchas veces lo tolera |
| Buscas «iPhone 13 Pro 128» | Encuentra el modelo exacto | Lo confunde con «iPhone 12 Pro 256»: quedan cerca |
| Buscas «error E-4012» (C11) | Encuentra el código exacto | Un código no «significa» nada para el modelo |

En C07, la búsqueda de hoy es BM25, y ≈ 8 % de las búsquedas no dan ningún resultado, sobre todo por vocabulario: «chamarra» contra «chaqueta», «tenis» contra «zapatillas». Pero BM25 es justo lo que encuentra marcas, modelos y tallas exactas.

### Juntar las dos: RRF

La [[busqueda-hibrida|búsqueda híbrida]] corre las dos búsquedas en paralelo sobre el mismo catálogo y junta sus listas. El problema es que sus puntajes no se pueden comparar: BM25 da números como 13.8 (la suma de los tres pesos de arriba, para una publicación que tiene las tres palabras) y el coseno, como 0.82. La forma más usada de juntarlas no mira los puntajes, solo las **posiciones**: RRF (*Reciprocal Rank Fusion*, Cormack y su equipo, 2009). Cada lista le da a cada publicación 1 ÷ (k + su posición), con k = 60, y se suman.

:::cuenta RRF con k = 60
1.ª en la semántica y 3.ª en BM25 | 1/61 + 1/63 | ≈ 0.0323
20.ª en las dos listas | 1/80 + 1/80 | 0.025
1.ª solo en BM25 // no aparece en la otra | 1/61 | ≈ 0.0164
= Ganan las publicaciones que las dos listas ponen arriba. Ser 20.ª en las dos vale más que ser 1.ª en una sola.
:::

El 60 viene del artículo original y casi nadie lo cambia: suaviza las diferencias entre los primeros lugares, para que ninguna lista sola decida todo.

### Primero rápido, después fino: retrieval y re-ranking

El índice vectorial compara vectores calculados **por separado**: el de la búsqueda y el de cada producto, cada uno sin saber del otro. Eso es un modelo de [[dos-torres|dos torres]], una para las búsquedas y otra para los productos. Es rápido, pero se le escapan detalles: «tenis blancos sin agujetas» y «tenis blancos con agujetas» pueden quedar casi en el mismo punto. Por eso los sistemas de búsqueda trabajan en dos etapas:

:::pasos
1. Retrieval: traer candidatos
El [[retrieval]] (recuperación) usa el índice vectorial y BM25 para traer, en unas decenas de milisegundos, unos cientos de candidatos de entre los 100 millones. Su trabajo no es ordenarlos perfecto: es **no dejar fuera** lo bueno. Es barato por candidato porque solo compara vectores ya calculados.
2. Re-ranking: ordenar bien los primeros
El [[re-ranking]] (reordenar) usa un modelo más caro y más preciso, un *cross-encoder*, que lee la búsqueda y cada candidato **juntos**, palabra por palabra, y les pone una calificación nueva. Como solo mira los primeros (decenas, no millones), se puede dar el lujo de ser lento por candidato.
:::

:::diagrama embeddings-busqueda
Una búsqueda híbrida: el catálogo se convierte en vectores antes; cada búsqueda calcula un solo vector, corre BM25 y el ANN en paralelo, junta las listas con RRF y reordena unos pocos.
:::

Fíjate en que hay **dos caminos** con presupuestos muy distintos. Convertir todo el catálogo en vectores se hace antes, en lote (todo junto, sin que nadie esté esperando), y puede tardar horas. Cada búsqueda, en cambio, tiene que contestar en milisegundos: solo calcula **un** vector (el de lo que escribió el usuario) y consulta el índice que ya existe.

:::ejemplo Cuántos candidatos reordenar: una decisión de dinero
En C07 de la Ronda, el re-ranker es la pieza que más mueve el costo, porque corre en GPUs por cada búsqueda de texto. Si reordena los 100 primeros candidatos de cada búsqueda de texto, necesita ≈ 24 GPUs; si reordena solo los 30 primeros, ≈ 8. El diseño elige 30 y lo confirma con una medición: si reordenar 100 casi no mejora los resultados, no se paga. Dieciséis GPUs de diferencia por una mejora que nadie nota sería una mala compra.
:::

Este patrón, «un paso barato y amplio, luego un paso caro y preciso», aparece en toda la Ronda: en búsqueda, en recomendación (C08, donde la Ronda lo llama **embudo**) y en moderación de contenido (C06, donde lo llama **cascada**: un modelo barato revisa todo y uno caro, solo lo dudoso).

## Cómo aprende un encoder: aprendizaje contrastivo {How an encoder learns: contrastive learning} [extra]

Un encoder como el de C07 no se entrena con etiquetas como «tenis» o «botas». Se entrena con **pares**: cosas que deben quedar juntas. Una foto y su título. Una pregunta y el párrafo que la responde. Un usuario y la publicación que contactó. Eso es el [[aprendizaje-contrastivo|aprendizaje contrastivo]] (*contrastive learning*): acercar los vectores de cada par y alejar los de lo que no es pareja.

¿De dónde salen los «no pareja»? Del mismo [[batch]]. Si el batch trae B pares, cada foto tiene 1 título correcto y B − 1 incorrectos: los títulos de las otras fotos. No hay que etiquetar nada más; los pares ya existen (cada publicación tiene su foto y su título).

:::diagrama embeddings-entrenamiento
Un paso de entrenamiento de un modelo de dos torres. Toca cada caja o recorre el paso completo.
:::

Las dos torres convierten las B fotos y los B títulos en vectores normalizados, y se calcula el coseno de cada foto contra cada título: una tabla de B × B. La diagonal son los pares correctos. Cada fila de esa tabla se trata como una pregunta de opción múltiple: «foto, ¿cuál de estos títulos es el tuyo?». Los cosenos se dividen entre un número chico, la temperatura (se escribe τ, la letra griega tau), y pasan por un [[softmax]], que los vuelve probabilidades. La [[loss|pérdida]] es la [[entropia-cruzada|entropía cruzada]]: −ln de la probabilidad que le tocó al título correcto. Es la misma pérdida de un clasificador, solo que aquí las «clases» son los títulos del batch.

:::figura embeddings-similitudes
Un batch de 3 pares. Arriba, el coseno de cada foto contra cada título: el entrenamiento sube la diagonal y baja lo demás. Abajo, la foto de tenis elige su título con dos temperaturas distintas.
:::

:::ejemplo La fila de los tenis, con números
Cosenos de la foto de tenis contra los tres títulos: 0.80 (el suyo), 0.55 y 0.10. Con τ = 0.1, se dividen entre 0.1: quedan 8, 5.5 y 1.

- Exponenciales: e⁸ ≈ 2,981.0; e elevado a 5.5 ≈ 244.7; e¹ ≈ 2.7. Suman ≈ 3,228.4.
- Probabilidad del título correcto: 2,981.0 ÷ 3,228.4 ≈ **0.92**.
- Pérdida: −ln 0.92 ≈ **0.08**.

Sin temperatura (τ = 1), los cosenos quedan muy juntos, el softmax casi no los distingue y el título correcto solo recibe 0.44: pérdida 0.82. Dividir entre un número chico separa los cosenos para que el softmax pueda decidir. CLIP aprende su temperatura durante el entrenamiento; empieza en 0.07.
:::

Así se ve el batch completo en Python:

```python
import math

# coseno de cada foto (fila) contra cada título (columna); la diagonal son los pares correctos
tabla = [[0.80, 0.55, 0.10],    # foto de tenis
         [0.60, 0.75, 0.05],    # foto de botas
         [0.15, 0.30, 0.60]]    # foto de bolsa

def perdida(tabla, tau):
    total = 0
    for i, fila in enumerate(tabla):
        exps = [math.exp(c / tau) for c in fila]   # softmax de los cosenos ÷ tau
        p = exps[i] / sum(exps)                    # lo que le da al título correcto
        print(f"  foto {i + 1}: P(título correcto) = {p:.2f}")
        total += -math.log(p)                      # entropía cruzada
    return total / len(tabla)

for tau in [1.0, 0.1]:
    print(f"temperatura {tau}")
    print(f"  pérdida promedio = {perdida(tabla, tau):.2f}")
```

```salida
temperatura 1.0
  foto 1: P(título correcto) = 0.44
  foto 2: P(título correcto) = 0.42
  foto 3: P(título correcto) = 0.42
  pérdida promedio = 0.85
temperatura 0.1
  foto 1: P(título correcto) = 0.92
  foto 2: P(título correcto) = 0.82
  foto 3: P(título correcto) = 0.94
  pérdida promedio = 0.11
```

Mira la foto 2, la de botas: es la que peor le va (0.82), porque su coseno con el título de los tenis, 0.60, está cerca del suyo, 0.75. Botas y tenis son los dos calzado; es un **negativo difícil**. Ahí la pérdida es más grande, y el [[gradiente]] empuja más: el entrenamiento gasta su esfuerzo justo en separar lo que confunde. Por eso los batches grandes ayudan: más negativos, y más negativos difíciles. CLIP usó ≈ 400 millones de pares de internet y batches de 32,768 pares. Además, CLIP hace la misma cuenta por columnas (cada título elige su foto) y promedia las dos.

### Lo que sale: dos torres que hablan el mismo idioma

Al terminar, la torre de imagen y la de texto ponen sus vectores en el mismo espacio. Eso es lo que hace posible buscar fotos con texto. Y permite un truco: clasificar una foto **sin entrenar una [[cabeza]]**. Calculas su vector y lo comparas con los vectores de textos como «una foto de unos tenis», «una foto de unas botas» y «una foto de una bolsa»; gana el texto más cercano. Sirve para arrancar sin datos etiquetados, pero en categorías muy específicas, como las 500 de C01, un modelo ajustado con tus propias fotos suele acertar más.

La misma receta sirve fuera de las fotos. En C08 de la Ronda, un modelo de dos torres se reentrena cada semana: una torre convierte a cada usuario en un vector de 128 números; la otra, a cada publicación. Los pares positivos son los contactos y clics de la gente; los negativos, las otras publicaciones del mismo batch. Las dos torres se publican juntas, con la misma versión, porque un vector de una versión no se compara con uno de otra.

## Errores comunes {Common mistakes}

Casi todos los errores con embeddings tienen algo en común: **nada truena**. La búsqueda responde, con el formato correcto, y solo baja la calidad. Estos son los que más se repiten.

### Comparar vectores sin normalizar

**Qué pasa:** el índice usa producto punto y los vectores no miden 1. Los vectores largos salen arriba en todas las búsquedas, no porque se parezcan más, sino porque son largos. Pasa también cuando se promedian vectores (foto y título) y se olvida volver a normalizar.

**Cómo evitarlo:** normaliza al guardar y al consultar, o usa la métrica coseno. Antes de llenar el índice, revisa que el largo de una muestra de vectores dé 1. Y usa la métrica con la que se entrenó el modelo.

### Mezclar versiones del modelo

**Qué pasa:** se actualiza el encoder a la versión 8, pero el índice todavía tiene vectores de la versión 7, o la mitad del catálogo se recalculó y la otra mitad no. Las cuentas salen, pero comparan coordenadas de dos mapas distintos.

**Cómo evitarlo:** un índice = una versión del modelo. Guarda la versión junto con cada vector, verifica en cada consulta que el encoder y el índice coincidan, y al cambiar de modelo recalcula todo el catálogo en un índice nuevo antes de cambiar el tráfico (en la Ronda, con *blue/green*: dos índices completos y un cambio de un solo golpe).

### Creer que un coseno de 0.9 quiere decir «idéntico»

**Qué pasa:** se decide «son el mismo producto» porque el coseno es 0.9. Pero en otro modelo 0.9 es normal entre cosas distintas, y «iPhone 13 Pro 128» y «iPhone 12 Pro 256» pueden quedar así de cerca.

**Cómo evitarlo:** un umbral se mide con pares revisados por personas, para ese modelo y ese uso, y se vuelve a medir cuando cambia el modelo. Lo que tiene que ser exacto (modelo, talla, código) se compara con filtros o con [[bm25|BM25]], no con un coseno.

### Olvidar el recall del ANN

**Qué pasa:** el equipo de modelos mide la calidad con una búsqueda exacta sobre un catálogo chico, y en producción el mismo modelo va a un índice aproximado sobre 100 millones, con int8 y filtros. El número que aprobaste no es el que la gente ve.

**Cómo evitarlo:** mide el recall@k del índice contra la búsqueda exacta sobre los mismos vectores, con un set fijo de consultas que corre solo (en C07, cada hora, con un mínimo de 0.95), y evalúa los modelos nuevos sobre el índice real.

### Filtrar después de buscar

**Qué pasa:** pides los 100 más cercanos y **después** quitas los que no son de la ciudad que pidió el usuario. Si esa ciudad tiene el 0.1 % del catálogo, de 100 resultados sobreviven en promedio 0.1: casi siempre la página sale vacía.

**Cómo evitarlo:** el filtro va **dentro** de la búsqueda. Los motores de índices vectoriales lo permiten; si el filtro deja muy pocos vectores, incluso conviene una búsqueda exacta sobre ese pedacito, que ahí sí es barata.

### Usar solo embeddings para lo exacto

**Qué pasa:** la búsqueda semántica reemplaza a BM25 y empiezan a fallar las búsquedas de marcas, modelos, tallas y códigos de error, que antes funcionaban.

**Cómo evitarlo:** [[busqueda-hibrida|búsqueda híbrida]]: BM25 en paralelo, fusión con RRF, y BM25 solo como respaldo si lo semántico falla.

### Calcular la memoria solo con los vectores

**Qué pasa:** «100 millones × 512 × 1 byte = 51.2 GB, cabe en una máquina de 64 GB». Falta el grafo de HNSW (≈ 25.6 GB más si cada vector guarda hasta 64 vecinos), lo que agrega el motor, las copias para no caerse y el índice nuevo que se construye al lado cuando cambia el modelo.

**Cómo evitarlo:** suma todo: vectores + grafo + ≈ 10 % del motor, por el número de copias, más espacio para el índice nuevo. Con eso decides en cuántos pedazos partirlo.

## En la vida real {In real life} [extra]

Los embeddings no son de un solo caso: aparecen en casi toda la Ronda, cada vez con otra cara.

**C01 · Clasificación de fotos.** La ResNet-50 ya produce 2,048 números por foto antes de su cabeza. Con ellos, el marketplace puede mostrar «publicaciones parecidas» a la foto de los tenis de Ana sin entrenar nada nuevo. Sirven también para limpiar el dataset: la misma foto aparece en varias publicaciones, y antes de repartir en entrenamiento y examen se quitan las copias exactas con un hash y los recortes y recompresiones con un hash perceptual o con embeddings. Y para vigilar el [[drift]]: el vector promedio de las fotos de hoy se compara contra el de una muestra de referencia; si se separan, cambió el contenido (por ejemplo, empiezan a llegar muchas fotos de un tipo de producto que antes casi no había), algo que las estadísticas de color o brillo no ven.

**C07 · Búsqueda semántica.** Todo lo de esta lección junto: 100 M publicaciones, vectores de 512 números normalizados, un índice HNSW en int8 de ≈ 77 GB partido en 4 pedazos, BM25 en paralelo, RRF, un re-ranker sobre los 30 primeros y 99 de cada 100 búsquedas de texto en menos de 300 ms.

**C11 · RAG.** Un asistente que responde con los documentos internos de una empresa. ≈ 1.5 millones de documentos se parten en ≈ 12 millones de pedazos de ≈ 400 [[token|tokens]], cada uno con un embedding de 1,024 números: ≈ 49.2 GB en float32 y ≈ 24.6 GB en float16. Cada pregunta corre BM25 y la búsqueda vectorial en paralelo (50 candidatos cada una), los junta con RRF y un re-ranker elige los 8 pedazos que se le dan al [[llm|LLM]]. BM25 es indispensable aquí: códigos de error, siglas y nombres de sistemas internos. Lo ves en la lección de LLMs, como [[rag|RAG]].

**C06 · Moderación de contenido.** Las copias de una imagen que viola las reglas se suben miles de veces, recortadas o con filtros. Para imágenes se usa un hash perceptual (PDQ, de 256 bits: dos imágenes casi iguales tienen hashes con pocos bits distintos); para textos parecidos, métodos de casi duplicados o embeddings con un umbral estricto. Los casi duplicados se agrupan y una persona decide una sola vez por grupo: 10,000 resubidas de la misma imagen son una sola revisión.

**C08 · Recomendación.** Para llenar la pantalla de inicio de cada usuario, un modelo de dos torres convierte al usuario en un vector de 128 números y un índice HNSW devuelve ≈ 500 candidatos de entre 100 millones de publicaciones, ≈ 3,100 veces por segundo en el pico. Su índice pesa ≈ 38 GB (12.8 GB de vectores en int8 más 25.6 GB del grafo) y cabe entero en una máquina.

**Fuera del ML.** El producto punto es la cuenta de cualquier ticket de compra (cantidades por precios), y la idea de «parecido = cerca» es la de cualquier mapa: dos ciudades vecinas tienen coordenadas parecidas.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los primeros cuatro son directos; los últimos dos piden juntar varias ideas.

:::ejercicios
? [facil] Calcula el producto punto de (2, −1, 3) y (4, 0, −2). ¿Las dos flechas apuntan hacia el mismo lado?
Multiplica coordenada por coordenada y suma: 2 × 4 + (−1) × 0 + 3 × (−2) = 8 + 0 − 6 = **2**.

Es positivo, así que forman menos de 90°: apuntan hacia el mismo lado, aunque apenas. Su coseno lo confirma: los largos son √(4 + 1 + 9) = √14 ≈ 3.74 y √(16 + 0 + 4) = √20 ≈ 4.47, y 2 ÷ (3.74 × 4.47) ≈ 0.12, muy cerca de 0.
? [facil] Normaliza el vector (6, 8) y comprueba que el resultado mide 1.
Largo: √(6² + 8²) = √(36 + 64) = √100 = 10.

Normalizado: (6 ÷ 10, 8 ÷ 10) = **(0.6, 0.8)**.

Comprobación: 0.6² + 0.8² = 0.36 + 0.64 = 1, y √1 = 1. Es la misma dirección que las botas (3, 4).
? [facil] ¿Cuál es la similitud coseno entre (1, 2) y (3, 6)? ¿Y su distancia euclidiana? ¿Qué te dice la diferencia?
Producto punto: 1 × 3 + 2 × 6 = 15. Largos: √(1 + 4) = √5 ≈ 2.24 y √(9 + 36) = √45 ≈ 6.71. Coseno: 15 ÷ (2.24 × 6.71) = 15 ÷ 15 = **1**. (Exacto: √5 × √45 = √225 = 15.)

Distancia: √((3 − 1)² + (6 − 2)²) = √(4 + 16) = √20 ≈ **4.47**.

(3, 6) es (1, 2) multiplicado por 3: la misma dirección, el triple de largo. El coseno dice «idénticos»; la distancia dice «lejos». Si el largo no significa nada para tu modelo, el coseno (o normalizar antes) es la medida correcta.
? [facil] Un catálogo tiene 10 millones de embeddings de 768 números. ¿Cuánta memoria ocupan en float32? ¿Y en float16?
float32: 10,000,000 × 768 × 4 bytes = 30,720,000,000 bytes ≈ **30.7 GB**.

float16 usa 2 bytes por número, la mitad: ≈ **15.4 GB**.
? [medio] Para una consulta, la búsqueda exacta dice que los 10 vecinos verdaderos son A, B, C, D, E, F, G, H, I y J. El índice ANN devolvió A, B, C, D, E, F, G, H, X y Y. ¿Cuál es su recall@10? Si te piden 0.95, ¿qué mueves y qué pagas?
De los 10 verdaderos, el ANN encontró 8 (de la A a la H). Recall@10 = 8 ÷ 10 = **0.8**.

Para subirlo hay que revisar más del catálogo: en HNSW, una lista de candidatos más larga (`ef_search`); en un índice por estantes, más estantes. Se paga en [[latencia]] y en [[cpu|CPU]] por búsqueda, y por lo tanto en máquinas para atender el mismo tráfico. Y una consulta no basta para decidir: el recall se mide sobre un set de cientos o miles de consultas.
? [medio] Junta con RRF (k = 60: cada lista le da a cada publicación 1 ÷ (60 + su posición), y se suman) tres publicaciones. P está 1.ª en BM25 y no aparece en la lista semántica. Q está 4.ª en BM25 y 2.ª en la semántica. R está 10.ª en las dos. ¿En qué orden quedan?
:::cuenta RRF de las tres
P // solo en BM25 | 1/61 | ≈ 0.0164
Q // en las dos | 1/64 + 1/62 ≈ 0.0156 + 0.0161 | ≈ 0.0318
R // en las dos | 1/70 + 1/70 | ≈ 0.0286
= Orden: **Q, R, P**.
:::
P fue la primera de una lista, pero solo de una. Q y R aparecen en las dos, y RRF premia ese acuerdo.
? [medio] En C07, el vector de una publicación es el promedio del vector de su foto y el de su título. Si la foto da f = (1, 0) y el título t = (0, 1), los dos normalizados, ¿cuánto mide el promedio? ¿Qué hay que hacer y por qué?
Promedio: ((1 + 0) ÷ 2, (0 + 1) ÷ 2) = (0.5, 0.5). Largo: √(0.25 + 0.25) = √0.5 ≈ **0.71**. No mide 1.

Hay que normalizarlo otra vez: (0.5 ÷ 0.71, 0.5 ÷ 0.71) ≈ **(0.71, 0.71)**.

Si no se normaliza y el índice compara con producto punto, todos los puntajes de esa publicación salen multiplicados por 0.71: quedaría castigada en cada búsqueda frente a las publicaciones bien normalizadas, sin ninguna razón.
? [medio] Con los 8 pares revisados del ejemplo de deduplicación, ¿qué precision y recall da un umbral de 0.92? ¿Lo usarías para limpiar un dataset antes de repartirlo? ¿Y para moderar?
Con 0.92 se marcan los pares con coseno de 0.92 o más: 1, 2, 3, 4 y 5, o sea 5 pares. De esos, son duplicados de verdad 1, 2, 3 y 5: 4 aciertos.

- Precision: 4 ÷ 5 = **0.8**.
- Recall: encontró los 4 duplicados que había: 4 ÷ 4 = **1.0**.

Para limpiar un dataset antes de repartirlo es una buena opción: no se escapa ningún duplicado, y el error (el par 4, dos fotos distintas de los mismos tenis) solo hace que dos fotos caigan del mismo lado. Para moderar, donde una decisión se aplica a todo el grupo, es demasiado laxo: juntaría el par 4 y castigaría una foto que es otra.
? [reto] C11 tiene 12 millones de pedazos de documentos, cada uno con un embedding de 1,024 números. (a) ¿Cuánta memoria ocupan en float32 y en float16? (b) ¿Cuántas multiplicaciones haría una búsqueda exacta? (c) Si la memoria entrega 200 GB por segundo, ¿cuánto tarda solo en leer los vectores float32 en cada búsqueda? ¿Cabe en los ≈ 50 a 150 ms que C11 estima para toda esa etapa de búsqueda?
**(a)** 12,000,000 × 1,024 × 4 bytes = 49,152,000,000 bytes ≈ **49.2 GB** en float32. En float16, la mitad: ≈ **24.6 GB**.

**(b)** Un producto punto de 1,024 números por cada pedazo: 12,000,000 × 1,024 = 12,288,000,000 ≈ **12.3 mil millones** de multiplicaciones por pregunta.

**(c)** 49.2 GB ÷ 200 GB por segundo ≈ 0.25 s = **≈ 250 ms**, solo para leer. No cabe: es más que toda la etapa. En float16 serían ≈ 123 ms: casi toda la etapa se iría solo en leer, sin contar las multiplicaciones. Por eso C11 usa un índice HNSW, aunque reciba solo ≈ 2 preguntas por segundo: el problema no es el volumen, es la latencia de cada pregunta.

Un matiz: si un filtro de permisos deja solo unos miles de pedazos (los que una persona puede ver), la búsqueda exacta sobre ese pedacito sí es barata, y los motores la usan en ese caso.
? [reto] Demuestra que, si a y b miden 1, la distancia euclidiana al cuadrado entre ellos es 2 − 2 × coseno. Pista: la distancia al cuadrado es (a − b) · (a − b), y el producto punto se puede repartir como una multiplicación normal.
La distancia al cuadrado es la suma de las diferencias al cuadrado, que es el producto punto de (a − b) consigo mismo:

distancia² = (a − b) · (a − b) = a · a − 2 (a · b) + b · b

Ahora usa lo que sabes:

- a · a es el largo de a al cuadrado: 1² = 1. Igual b · b = 1.
- Como los dos miden 1, a · b es exactamente su coseno.

Entonces: distancia² = 1 − 2 × coseno + 1 = **2 − 2 × coseno**.

Comprobación con tenis y botas normalizados: coseno 0.96, así que 2 − 1.92 = 0.08, y la cuenta directa (0.8 − 0.6)² + (0.6 − 0.8)² = 0.04 + 0.04 = 0.08. La consecuencia práctica: con vectores normalizados, ordenar por distancia o por coseno da los mismos vecinos, así que cualquiera de las dos métricas sirve.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M02 · Patrones de inferencia** usa la búsqueda por embeddings como ejemplo del patrón híbrido: los embeddings del catálogo se calculan en lote; el de la consulta, en cada [[request]]. Ahí también está la cascada: un modelo barato revisa todo y uno caro, solo lo que queda en duda.
- **M07 · Servidores de modelos** sirve los encoders y los re-rankers (en Triton, o en vLLM; son programas que ponen modelos a responder) y menciona `/v1/embeddings`, la dirección de la [[api|API]] a la que se le piden embeddings.
- **M09 · Datos y features** deduplica por hash y por casi duplicados antes de repartir el dataset. Cita un estudio sobre CIFAR-10 y CIFAR-100, dos datasets públicos de fotos chiquitas muy usados en investigación: el 3.3 % de las fotos de examen del primero y el 10 % de las del segundo tienen un casi duplicado en el entrenamiento.
- **M12 · Monitoreo** detecta drift en imágenes comparando embeddings de hoy contra una referencia, desde la distancia entre los promedios hasta métodos más finos.
- Los casos **C07** (búsqueda), **C11** (RAG), **C06** (moderación) y **C08** (recomendación) hacen las cuentas de esta lección en grande: 205 GB en float32 y 51.2 GB en int8, el grafo de 25.6 GB, recall@100 ≥ 0.95, RRF con k = 60, el re-ranker de 30 contra 100 candidatos y las dos torres de 128 números.

**En el Dojo:** la estación 1 (Datos y etiquetas) cruza huellas de contenido contra el [[golden-set|golden set]] para que ninguna foto del examen se cuele al entrenamiento. Es deduplicación de copias exactas; los casi duplicados son el siguiente paso, con lo que viste aquí.

**En Sensei:** la siguiente lección, Transformers y LLMs, convierte cada token en un embedding, compara palabras con productos punto en la atención y usa todo lo de esta lección en RAG. Después, «Cómo guarda números una computadora» explica int8 y la cuantización; «Matrices, FLOPs y qué tan rápido calcula una GPU», por qué miles de productos punto juntos son una multiplicación de matrices, y «Comparar distribuciones», cómo se mide el drift con más cuidado que un promedio.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
vector embedding producto-punto similitud-coseno distancia-euclidiana normalizacion-l2 deduplicacion busqueda-semantica vecinos-cercanos ann indice-vectorial hnsw dimensionalidad bm25 busqueda-hibrida retrieval re-ranking multimodal aprendizaje-contrastivo dos-torres
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué es un embedding y por qué sirve para buscar cosas parecidas?
Es el vector que un modelo produce para una cosa, de forma que cosas parecidas reciben vectores cercanos. Así, «buscar algo parecido» se vuelve «buscar el vector más cercano», que es una cuenta.
? Calcula la similitud coseno entre (1, 0) y (0, 2). ¿Qué significa?
Producto punto: 1 × 0 + 0 × 2 = 0. El coseno es 0 ÷ (1 × 2) = 0. Son perpendiculares: para el modelo, no tienen nada que ver. (El largo distinto no importa: el coseno solo mira la dirección.)
? ¿Por qué se guardan los embeddings normalizados?
Porque con largo 1 el coseno es solo el producto punto, una cuenta más barata, y la distancia y el coseno ordenan igual a los vecinos. Además, ningún vector «gana» solo por ser largo.
? ¿Por qué no se hace la búsqueda exacta sobre 100 millones de vectores?
Porque cada búsqueda tendría que comparar contra todos: 100 M × 512 = 51.2 mil millones de multiplicaciones, y leer ≈ 205 GB de memoria. Con cientos o miles de búsquedas por segundo no hay forma de pagarlo. Un ANN revisa solo una parte bien elegida, a cambio de perder de vez en cuando algún vecino verdadero.
? Un índice ANN tiene recall@100 = 0.90 y te piden 0.95. ¿Qué perilla mueves y qué pagas?
Revisar más del catálogo: más estantes en un índice por grupos, una lista de candidatos más larga (`ef_search`) en HNSW. Sube el recall, pero cada búsqueda tarda más y necesitas más máquinas para la misma cantidad de búsquedas por segundo.
? ¿Por qué C07 no usa solo búsqueda semántica?
Porque los embeddings confunden lo exacto: «iPhone 13 Pro 128» queda cerca de «iPhone 12 Pro 256». BM25 encuentra marcas, modelos y tallas; los embeddings, sinónimos y descripciones vagas. Juntas, con RRF, cada una tapa los huecos de la otra, y BM25 queda de respaldo.
? ¿Por qué el re-ranker solo mira los primeros candidatos y no todo el catálogo?
Porque es caro por candidato: lee la búsqueda y cada candidato juntos. Sobre decenas de candidatos es pagable; sobre millones, imposible. El retrieval barato trae los candidatos y el re-ranker caro ordena bien los primeros.
:::
