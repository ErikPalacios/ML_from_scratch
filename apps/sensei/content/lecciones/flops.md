---
titulo: Matrices, FLOPs y qué tan rápido calcula una GPU
en: Matrices, FLOPs and how fast a GPU computes
subtitulo: Cómo se cuenta el trabajo de un modelo en multiplicaciones y sumas, cuánto tarda una GPU en hacerlo y por qué casi nunca llega a la velocidad que promete su hoja de datos.
pregunta: Si una GPU hace más de cien billones de operaciones por segundo, ¿por qué un LLM escribe en ella apenas unos 20 tokens por segundo?
requisitos: numeros-maquina
---

:::idea
Casi todo lo que calcula un modelo es multiplicar matrices, y ese trabajo se cuenta: una matriz de n × k por una de k × m cuesta 2 × n × m × k operaciones. Dividirlas entre la velocidad de la GPU da el tiempo mínimo, pero la GPU solo llega a esa velocidad si cada byte que trae de su memoria lo usa en muchas operaciones. Si no, manda la memoria.
:::

## Matrices y cómo se multiplican {Matrices and how to multiply them}

En la lección de embeddings viste que un [[vector]] es una lista ordenada de números, como (2, 1, 3). Esta lección sube un escalón: de la lista a la tabla. Casi todo lo que calcula un modelo, al entrenar y al responder, son cuentas con tablas de números.

### Qué es una matriz

Una [[matriz]] (*matrix*) es una tabla de números ordenada en filas y columnas, todas del mismo largo. Esta tiene 2 filas y 3 columnas:

| Fila ↓ · columna → | 1 | 2 | 3 |
|---|---|---|---|
| 1 | 2 | 1 | 3 |
| 2 | 1 | 0 | 2 |

Su tamaño se dice **filas × columnas**: es una matriz de 2 × 3, y se lee «dos por tres». Para señalar un número das su fila y su columna, en ese orden. El de la fila 1 y la columna 3 es 3; el de la fila 2 y la columna 1 es 1. Si la matriz se llama A, se escribe A₁₃ = 3. En Python se cuenta desde 0, así que el mismo número es `A[0][2]`.

Un vector es una matriz con una sola fila (1 × 3) o una sola columna (3 × 1). Y una matriz es un [[tensor]] de dos dimensiones: su [[shape]] en PyTorch sería [2, 3].

### Dónde hay matrices en ML

En todas partes. Cuatro que ya conoces:

- **Los pesos de una capa densa.** Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y, con una ResNet-50 que corre en GPUs, le sugiere a quien vende la categoría de cada foto, entre 500 posibles. La última [[capa]] de esa ResNet-50 recibe 2,048 números y saca 500 [[logit|logits]], uno por categoría. Sus pesos forman una matriz de 2,048 × 500: una fila por cada número que entra y una columna por categoría.
- **Un batch.** Si entran 32 fotos a la vez (un [[batch]]), los 2,048 números de cada una se apilan en una matriz de 32 × 2,048: una fila por foto.
- **Una tabla de datos.** Una fila por [[ejemplo]] y una columna por [[feature]].
- **Una foto en blanco y negro.** Una de 224 × 224 [[pixel|píxeles]] es una matriz de 224 × 224. A color son tres, una por [[canal]], y juntas forman el tensor de 3 × 224 × 224 que recibe la ResNet-50: 150,528 números.

### Cuánto ocupa

Una matriz ocupa **filas × columnas × los bytes de cada número**. En la lección anterior viste cuántos [[byte|bytes]] ocupa cada [[dtype]]: 4 en [[float32]], 2 en [[fp16|FP16]] y [[bf16|BF16]], 1 en [[int8|INT8]].

Los pesos de la última capa de la ResNet-50 de Alba son 2,048 × 500 = 1,024,000 números. En FP16, con 2 bytes por número, ocupan 1,024,000 × 2 = 2,048,000 bytes, ≈ 2 MB. Guarda esta idea para la segunda mitad de la lección: los bytes van a importar tanto como las cuentas, porque cada byte tiene que viajar desde la memoria hasta el lugar donde se calcula.

### Multiplicar: filas por columnas

Recuerda el [[producto-punto|producto punto]] de [la lección de embeddings](/embeddings/): multiplicas dos vectores coordenada por coordenada y sumas todo. Si compras 2 playeras de $50, 1 gorra de $120 y 3 pares de calcetines de $15, pagas (2, 1, 3) · (50, 120, 15) = 100 + 120 + 45 = $265.

Una [[multiplicacion-matrices|multiplicación de matrices]] (*matrix multiplication*, o *matmul*) son muchos productos punto de un jalón. Para multiplicar A por B, la casilla de la fila i y la columna j del resultado es **el producto punto de la fila i de A con la columna j de B**.

:::ejemplo Dos compras, dos totales
Sofía compra 2 playeras, 1 gorra y 3 pares de calcetines. Luis compra 1 playera, ninguna gorra y 2 pares de calcetines. Eso es A, de 2 × 3: una fila por persona y una columna por producto.

De cada producto se sabe su precio y sus gramos: playera, $50 y 200 g; gorra, $120 y 100 g; calcetines, $15 y 50 g. Eso es B, de 3 × 2: una fila por producto y una columna por dato.

Cada casilla del resultado C es una fila de A por una columna de B:

| Casilla | Valor | Fila de A por columna de B |
|---|---|---|
| Sofía, precio | **265** | 2 × 50 + 1 × 120 + 3 × 15\n= 100 + 120 + 45 |
| Sofía, gramos | **650** | 2 × 200 + 1 × 100 + 3 × 50\n= 400 + 100 + 150 |
| Luis, precio | **80** | 1 × 50 + 0 × 120 + 2 × 15\n= 50 + 0 + 30 |
| Luis, gramos | **300** | 1 × 200 + 0 × 100 + 2 × 50\n= 200 + 0 + 100 |

C mide 2 × 2: una fila por persona y una columna por total. Sofía paga $265 y su paquete pesa 650 g; Luis paga $80 y el suyo pesa 300 g.
:::

:::figura flops-matmul
B va arriba y A a la izquierda, para que cada casilla de C quede justo donde se cruzan su fila de A y su columna de B. La casilla marcada sale de la fila de Sofía por la columna del precio.
:::

### La regla de los tamaños

Para multiplicar, la fila de A y la columna de B tienen que medir lo mismo, o el producto punto no tiene pareja para cada número. En tamaños:

**(n × k) · (k × m) da n × m**

Las dos dimensiones de adentro (las k) deben ser iguales; las de afuera dicen el tamaño del resultado. Tres casos:

- (2 × 3) · (3 × 2) da 2 × 2: el ejemplo de las compras.
- (32 × 2,048) · (2,048 × 500) da 32 × 500: un batch de 32 fotos por los pesos de la última capa de la ResNet-50 de Alba da 500 logits por foto.
- (2 × 3) · (2 × 3) no se puede: las filas de A tienen 3 números y las columnas de B, 2.

**El orden importa.** B · A sí se puede, porque (3 × 2) · (2 × 3) cuadra por dentro, pero da una tabla de 3 × 3 que no significa nada para la tienda: su primera casilla suma el precio de una playera por las playeras de Sofía con los gramos de una playera por las playeras de Luis. En general, A · B ≠ B · A.

:::nota La transpuesta
Voltear una matriz para que sus filas se vuelvan columnas se llama **transponer**. La transpuesta de A se escribe Aᵀ y mide 3 × 2. Sirve para que los tamaños cuadren: la vas a ver en la atención de los transformers, que calcula Q · Kᵀ.
:::

### Una capa densa es una multiplicación de matrices

En la lección de redes, una [[neurona]] multiplicaba cada entrada por su peso y sumaba: un producto punto, más su sesgo. Una capa de 500 neuronas son 500 productos punto. Si llegan 32 fotos, son 32 × 500. Todo eso es **una sola** multiplicación de matrices: el batch, de 32 × 2,048, por la matriz de pesos, de 2,048 × 500, da los logits, de 32 × 500. Después se le suma a cada columna el sesgo de su categoría.

:::figura flops-capa
La misma idea con números de verdad. Cada logit es la fila de una foto por la columna de una categoría: un producto punto de 2,048 números.
:::

Por eso se dice que el deep learning es «multiplicar matrices». Una capa densa es una; una [[convolucion|convolución]] se reorganiza como una (lo ves en una sección extra); la [[atencion|atención]] de un [[transformer]] usa dos. Las [[gpu|GPUs]] modernas tienen hasta circuitos que solo saben hacer esto.

## Contar el trabajo: MACs y FLOPs {Counting the work: MACs and FLOPs}

Antes de preguntar cuánto tarda una GPU, hay que saber cuánto trabajo le pides. Ese trabajo se cuenta igual en cualquier máquina, como los kilómetros de un viaje no dependen del coche.

### Dos unidades

Cada casilla del resultado es un producto punto de k números: k multiplicaciones, cada una sumada a lo que llevas. Ese par «multiplica y acumula» es una [[mac|MAC]] (*multiply-accumulate*), la unidad que ya usaste en la lección de redes. El resultado tiene n × m casillas, así que hay n × m × k MACs.

Un [[flop|FLOP]] (*floating-point operation*) es una sola operación con números decimales, es decir, de [[punto-flotante|punto flotante]]: una multiplicación **o** una suma. Una MAC son dos FLOPs. Las dos cuentas, con letras:

:::formula El trabajo de una multiplicación de matrices
text{MACs} = n × m × k
F = 2 × n × m × k
- n: las filas de A (por ejemplo, las fotos de un batch)
- k: las columnas de A, que son también las filas de B: el largo de cada producto punto
- m: las columnas de B
- MACs: cuántos pares «multiplica y acumula» hace la multiplicación
- F: cuántos FLOPs hace, el doble de las MACs
:::

En las compras de Sofía y Luis, \(n\) = 2 personas, \(m\) = 2 datos y \(k\) = 3 productos: 2 × 2 × 3 = 12 MACs, que son \(F\) = 2 × 12 = 24 FLOPs. Las dos unidades miden lo mismo, contando el par o cada pieza; mezclarlas es uno de los errores más comunes (lo ves al final).

:::nota ¿Por qué 2k y no 2k − 1?
Para sumar k números bastan k − 1 sumas. Pero el acumulador empieza en 0 y cada multiplicación se le suma, y el hardware hace las dos cosas en una sola instrucción, la FMA (*fused multiply-add*), que cuenta como 2 FLOPs. Con k = 2,048, la diferencia es de 1 en 4,096: nadie la pelea.
:::

### Los prefijos

Los números crecen rápido, así que se usan los prefijos que viste en la lección de unidades, con su [[notacion-cientifica|notación científica]]:

| Prefijo | Vale | Ejemplo de esta lección |
|---|---|---|
| M (mega) | 10⁶, un millón | 65.5 MFLOPs: la última capa de la ResNet-50 de Alba con 32 fotos |
| G (giga) | 10⁹, mil millones | 8.2 GFLOPs: la ResNet-50 con una foto |
| T (tera) | 10¹², un billón | 65 TFLOPS: lo que hace una T4 por segundo, como máximo |
| P (peta) | 10¹⁵, mil billones | 82 PFLOPs: las ≈ 10 millones de fotos que Alba clasifica en un día |

:::ojo
**«Billón» no es *billion*.** En español, un billón es un millón de millones (10¹²); el *billion* del inglés es mil millones (10⁹). Cuando leas «8 billion parameters», son 8 mil millones de parámetros. En esta lección se escribe «mil millones» o 10⁹ para no confundir.
:::

### Una capa densa

Una capa densa con e entradas y s salidas, aplicada a un batch de b ejemplos, es una matmul de (b × e) · (e × s). En la fórmula de arriba, \(n\) = b, \(k\) = e y \(m\) = s: **b × e × s MACs**. Con b = 1 queda la regla de la lección de redes: entradas × salidas.

:::cuenta La última capa de la ResNet-50 de Alba, con un batch de 32
Tamaño del resultado \(n × m\) // \(n\) = 32 fotos, \(k\) = 2,048 números por foto, \(m\) = 500 categorías | (32 × 2,048) · (2,048 × 500) | 32 × 500
MACs // \(text{MACs} = n × m × k\) | 32 × 500 × 2,048 | 32,768,000
FLOPs \(F\) // \(F = 2 × text{MACs}\) | 2 × 32,768,000 | 65,536,000 ≈ 65.5 MFLOPs
Por foto // \(F\) entre las \(n\) = 32 fotos | 65,536,000 ÷ 32 | 2,048,000 ≈ 2 MFLOPs
= Cada foto pide ≈ 2 millones de FLOPs en esta capa. Es muy poco: la red completa pide ≈ 4,000 veces más.
:::

:::calculadora flops-matmul
Empieza con la última capa de la ResNet-50 de Alba y un batch de 32: n = 32, k = 2048 y m = 500. Baja n a 1, una sola foto: el trabajo baja 32 veces. Después pon 4096 en los tres: la multiplicación grande que vas a ver más adelante.
:::

### La ResNet-50 completa

Sumando todas sus capas, la ResNet-50 de Alba hace ≈ 4,100 millones de MACs por foto (4,088 millones, contadas capa por capa): **4.1 GMACs**, que son \(F\) = 2 × 4.1 = **8.2 GFLOPs**. Es el dato con el que Alba hace sus cuentas, y lo vas a usar en toda la lección.

Compáralo con sus 24.5 millones de parámetros: 4,088 millones de MACs ÷ 24.5 millones de pesos ≈ 167. **Cada peso se usa, en promedio, unas 167 veces por foto.** No es igual en todas partes: en una convolución sobre un mapa grande, cada peso se usa en miles de posiciones; en la capa final, una sola vez. Esa reutilización va a ser la clave de la segunda mitad de la lección.

### Un LLM

En un [[llm|LLM]], escribir un [[token]] usa cada parámetro en una MAC: ≈ 2 FLOPs por parámetro. Llama 3 8B tiene 8.03 mil millones de parámetros, así que hace ≈ 2 × 8.03 × 10⁹ ≈ **16 GFLOPs por token**, el doble que una foto en la ResNet-50 de Alba (8.2 GFLOPs). Falta la atención sobre los tokens anteriores, que crece con el largo de la conversación, pero en conversaciones cortas es una parte chica.

## FLOPS: qué tan rápido calcula una GPU {FLOPS: how fast a GPU computes}

Ya sabes contar el trabajo. Ahora, la velocidad.

### FLOPs y FLOPS

Fíjate en la última letra. **FLOPs**, con s minúscula, es un plural: una **cantidad** de operaciones. **FLOPS**, con S mayúscula, es *floating-point operations per second*: una **velocidad**. La ResNet-50 pide 8.2 GFLOPs por foto; una T4 hace hasta 65 TFLOPS. Es la diferencia entre kilómetros y kilómetros por hora.

Los [[tflops|TFLOPS]] son billones (10¹²) de operaciones por segundo. Con el trabajo y la velocidad, el tiempo sale de una división, como el de un viaje:

:::formula Tiempo mínimo de un cálculo
t_{mín} = frac{F}{P}
- F: el trabajo del cálculo, en FLOPs
- P: el pico de la GPU, en FLOPS (FLOPs por segundo), el de su hoja de datos
- t_{mín}: el tiempo mínimo, en segundos: lo que tardaría si la GPU fuera siempre a su pico
:::

### Por qué una GPU es tan rápida

Una [[cpu|CPU]] tiene de 8 a unas decenas de núcleos muy capaces, que hacen cualquier cosa, una tras otra. Una [[gpu|GPU]] tiene miles de núcleos sencillos que hacen **la misma operación sobre muchos números a la vez**, y las multiplicaciones de matrices son justo eso: millones de productos punto que no dependen unos de otros.

Las GPUs modernas tienen además [[tensor-core|*tensor cores*]]: circuitos que multiplican un bloque pequeño de matrices completo en un solo paso. La T4, la GPU en la que Alba sirve su modelo, tiene 2,560 núcleos normales (los *CUDA cores*) y 320 tensor cores, como viste en la lección de cómo aprende un modelo.

Los tensor cores son rapidísimos, pero solo con ciertos tipos de dato, casi todos de pocos bits: FP16, BF16, [[fp8|FP8]] o INT8, según la GPU. Los de la T4 no aceptan float32: con float32, la T4 usa sus núcleos normales y hace 8.1 TFLOPS; con FP16 y sus tensor cores, 65: **ocho veces más**. Por eso Alba sirve su modelo en FP16, convertido con TensorRT, el compilador de NVIDIA que prepara un modelo para correr rápido en una GPU concreta.

### Las GPUs que más vas a oír

Estas son las GPUs que más vas a oír, con sus números principales:

| | T4 | L4 | A100 | H100 |
|---|---|---|---|---|
| Año | 2018 | 2023 | 2020 | 2022 |
| Memoria (VRAM) | 16 GB | 24 GB | 40 u 80 GB | 80 GB |
| FP16 con tensor cores, denso | 65 TFLOPS | ≈ 121 TFLOPS | 312 TFLOPS | ≈ 990 TFLOPS |
| FP8 | no tiene | ≈ 242 TFLOPS | no tiene | ≈ 1,979 TFLOPS |
| INT8, denso | 130 TOPS | ≈ 242 TOPS | 624 TOPS | ≈ 1,979 TOPS |
| Ancho de banda de memoria | 320 GB/s | 300 GB/s | 1,555 GB/s (40 GB)\n2,039 GB/s (80 GB) | 3,350 GB/s |
| Precio en AWS, por GPU y hora | ≈ US$0.53 | ≈ US$0.80 | ≈ US$2.75 (40 GB)\n≈ US$3.43 (80 GB) | ≈ US$6.88 |

La H100 es la versión SXM, un módulo que va montado en la placa del servidor; la que viene en tarjeta (PCIe) es más lenta. Los precios son aproximados, de septiembre de 2026. Para leer la tabla:

- **Denso.** NVIDIA suele publicar también el doble, *with sparsity*: supone un modelo podado con un patrón especial que casi ningún modelo cumple (lo ves en una sección extra). Divide entre 2. La T4 no tiene sparsity: sus números ya son densos.
- **TOPS.** Con enteros como INT8 no son operaciones de punto flotante; se dice TOPS, *tera operations per second*.
- **La precisión manda.** En los tensor cores, con la mitad de bytes por número el pico suele duplicarse: la L4 hace ≈ 121 TFLOPS en FP16 y ≈ 242 en FP8.
- **El ancho de banda** es la otra mitad de la historia, la de la sección que sigue. Entre la T4 y la H100, los TFLOPS crecen ≈ 15 veces y el ancho de banda, ≈ 10.

### El chequeo de cordura de Alba

Con la tabla ya puedes hacer la cuenta que se llama chequeo de cordura (*sanity check*): ¿cuántas fotos por segundo podría responder una T4, como máximo? Si cada foto pide \(F\) FLOPs y la GPU hace \(P\) por segundo, caben \(P ÷ F\) fotos en un segundo. Comparar eso con lo que de verdad se mide da la utilización, que la sección siguiente explica:

:::formula Chequeo de cordura
x_{máx} = frac{P}{F}
u = frac{x}{x_{máx}}
- F, P: los FLOPs de una foto y el pico de la GPU, como en \(t_{mín} = F/P\)
- x_{máx}: el techo de fotos por segundo, si la GPU fuera siempre a su pico
- x: las fotos por segundo que de verdad se miden
- u: la **utilización**: la fracción del pico que se aprovecha, entre 0 y 1 (o en %)
:::

:::cuenta Una T4 contra la ResNet-50
FLOPs por foto \(F\) // ≈ 4.1 GMACs × 2 | 4.1 × 10⁹ × 2 | 8.2 × 10⁹
Pico de la T4 \(P\), por segundo // FP16 con tensor cores | hoja de datos de NVIDIA | 65 × 10¹²
Tiempo mínimo por foto \(t_{mín}\) | \(t_{mín} = F/P\) = 8.2 × 10⁹ ÷ (65 × 10¹²) | ≈ 0.126 ms
Techo de fotos por segundo \(x_{máx}\) | \(x_{máx} = P/F\) = 65 × 10¹² ÷ (8.2 × 10⁹) | ≈ 7,900
Lo medido en Alba, \(x\) // con perf_analyzer (la herramienta de Triton, el servidor del modelo, que mide cuántas peticiones por segundo aguanta), TensorRT en FP16 y batches de hasta 32 | dato de Alba | ≈ 1,200
Utilización \(u\) | \(u = x/x_{máx}\) = 1,200 ÷ 7,900 | ≈ 15 %
= La T4 llega a ≈ 15 % de su pico. Suena a poco, y es normal.
:::

### Utilización: cuánto del pico usas de verdad

Esa fracción tiene nombre: la **utilización** de la GPU, la parte de su velocidad de catálogo que de verdad aprovechas. Se calcula también como FLOPS logrados ÷ FLOPS pico, \(u = x × F/P\), que es lo mismo que \(x/x_{máx}\). En Alba, \(x × F\) = 1,200 fotos por segundo × 8.2 GFLOPs = 9.84 TFLOPS logrados, contra \(P\) = 65 de pico: 9.84 ÷ 65 ≈ 15 %.

¿Por qué tan poco? Hay cuatro razones:

1. La T4 baja su velocidad cuando llega a su tope de consumo, 70 W, y bajo carga sostenida llega seguido.
2. No todas las capas usan los tensor cores.
3. Entre una operación y la siguiente hay tiempo muerto.
4. Algunas capas usan muy poco cada byte que leen de la memoria, y se quedan esperando.

La cuarta razón es la idea más importante de esta lección, y es la sección que sigue.

La regla que deja el chequeo: **el techo teórico dice qué es imposible, no qué vas a obtener**. Si un benchmark te diera 10,000 fotos por segundo en una T4 con la misma ResNet-50 en FP16, serían \(x × F\) = 10,000 × 8.2 GFLOPs = 82 TFLOPS, más que el pico \(P\) = 65. El benchmark está midiendo mal.

:::ojo
La palabra «utilización» se usa para tres cosas distintas. (1) La fracción del pico que logras, la de aquí. (2) La fracción del tiempo que un servidor está ocupado, la que se usa para las colas (la ves en «Qué tan rápido y cuánto: latencia y throughput»). (3) La [[utilizacion-gpu|utilización de GPU]] que muestra `nvidia-smi`, el programa de NVIDIA que reporta el estado de la GPU: el porcentaje del tiempo en que la GPU tuvo **algún** trabajo corriendo, no qué parte de sus núcleos trabajó. Una GPU puede marcar 100 % en `nvidia-smi` con los tensor cores casi parados.
:::

## La memoria también tiene velocidad {Memory has a speed too}

Hay una pregunta que la tabla de TFLOPS no contesta: ¿de dónde salen los números que la GPU multiplica?

### El viaje de los números

Los pesos del modelo y las entradas viven en la memoria de la GPU, la [[vram|VRAM]]. Los núcleos no calculan ahí: antes, cada número tiene que viajar de la VRAM al chip. Y ese viaje tiene su propio límite de velocidad, el [[ancho-banda-memoria|ancho de banda de memoria]] (*memory bandwidth*): cuántos bytes por segundo puede entregar la VRAM. En una T4 son 320 GB/s; en una H100, 3,350 GB/s.

Dentro del chip hay una memoria pequeñita y muchísimo más rápida, una caché: 4 MB en la T4, unas decenas de MB en las GPUs más nuevas. Un buen programa trae un bloque de números una vez y lo usa muchas veces ahí antes de soltarlo. Cuántas veces logra usar cada byte que trae es la pregunta de toda esta sección.

:::diagrama flops-gpu
Sigue «Una multiplicación grande» y luego «Un token de un LLM»: la misma GPU, con dos historias opuestas. El tercer recorrido adelanta el remedio, el batching, que tiene su propia sección extra.
:::

:::ojo
**GB/s no es Gb/s**, como viste en la lección de unidades. La memoria se mide en giga**bytes** por segundo; la red, como los ≈ 2.4 Gb/s de tensores que llegan a las GPUs de Alba cuando recibe 500 fotos por segundo, su pico de diseño, en giga**bits**, 8 veces menos. Los 320 GB/s de una sola T4 son 2,560 Gb/s: unas mil veces ese tráfico de red.
:::

### Dos relojes

Cualquier cálculo en una GPU tiene dos tiempos mínimos, como dos relojes que corren a la vez:

- **El reloj del cálculo:** FLOPs ÷ FLOPS pico.
- **El reloj de la memoria:** bytes que hay que mover ÷ ancho de banda.

Los dos trabajos se enciman (mientras los núcleos calculan un bloque, ya viene el siguiente), así que el cálculo termina cuando termina el más lento:

:::formula Los dos relojes
t_{cálculo} = frac{F}{P}
t_{memoria} = frac{D}{W}
t ≥ max(t_{cálculo}, t_{memoria})
- F, P: los FLOPs del cálculo y el pico de la GPU, en FLOPS
- D: los bytes que hay que mover entre la VRAM y el chip (los **datos**): leer las entradas y los pesos, y escribir el resultado
- W: el ancho de banda de memoria, en bytes por segundo (320 GB/s en una T4)
- t_{cálculo}, t_{memoria}: los dos relojes, en segundos: lo que tardaría si solo contaran las cuentas, o si solo contara mover los bytes
- t: lo que de verdad tarda la operación, en segundos: nunca menos que el más lento de los dos relojes
:::

:::ejemplo Una matriz por un vector, en una T4
Una matriz de 4,096 × 4,096 en FP16 por un vector de 4,096 números. Es lo que hace un LLM, capa por capa, cuando escribe un token: Llama 3 8B tiene matrices justo de ese tamaño.

- FLOPs: \(F = 2 × n × m × k\), con \(n\) = 1 vector, \(k\) = 4,096 y \(m\) = 4,096: 2 × 1 × 4,096 × 4,096 = 33,554,432, unos 33.6 millones.
- Bytes \(D\): leer la matriz (4,096 × 4,096 × 2 = 33,554,432 bytes) y el vector, y escribir el resultado. En total, ≈ 33.6 MB.
- Reloj del cálculo: \(t_{cálculo} = F/P\) = 33.6 × 10⁶ ÷ (65 × 10¹²) ≈ **0.0005 ms**.
- Reloj de la memoria: \(t_{memoria} = D/W\) = 33.6 × 10⁶ ÷ (320 × 10⁹) ≈ **0.105 ms**.

La memoria tarda ≈ 200 veces más que el cálculo. Cada peso que llega se usa en una sola multiplicación, y los núcleos pasan casi todo el tiempo esperando.
:::

### Intensidad aritmética

La comparación entre los dos relojes depende de una sola propiedad del cálculo: cuántas operaciones hace por cada byte que mueve. Se llama [[intensidad-aritmetica|intensidad aritmética]] (*arithmetic intensity*):

:::formula Intensidad aritmética
I = frac{F}{D}
- F: los FLOPs del cálculo
- D: los bytes que mueve de la memoria, como en los dos relojes
- I: la intensidad, en FLOPs por byte
:::

| Cálculo, en FP16 | Intensidad \(I = F/D\) | FLOPs \(F\) | Bytes \(D\) |
|---|---|---|---|
| Producto punto de dos vectores de 4,096 | 0.5 | 8,192 | 16,384 |
| Matriz de 4,096 × 4,096 por un vector | ≈ 1 | ≈ 33.6 millones | ≈ 33.6 MB |
| Dos matrices de 1,024 × 1,024 | ≈ 341 | ≈ 2.1 mil millones | ≈ 6.3 MB |
| Dos matrices de 4,096 × 4,096 | ≈ 1,365 | ≈ 137 mil millones | ≈ 101 MB |

Fíjate en el patrón. Una matriz por un vector usa cada peso **una vez**: 2 FLOPs por cada 2 bytes. Dos matrices cuadradas de lado n usan cada número **n veces**: \(F = 2n^3\) FLOPs para mover \(D = 3 × n^2 × 2\) bytes (leer las dos y escribir el resultado, 2 bytes por número), así que \(I = 2n^3 ÷ 6n^2 = n/3\). Mientras más grandes las matrices, más se reusa cada byte.

La intensidad es una propiedad **del cálculo**: no depende de la GPU en que corra.

### El punto de quiebre de la GPU

Del otro lado está la GPU. Si divides su pico de FLOPS entre su ancho de banda, sale cuántas operaciones tiene que hacer con cada byte para que la memoria alcance a alimentar a sus núcleos. Es su **punto de quiebre** (*ridge point*), y es una propiedad **de la GPU**:

:::formula Punto de quiebre de una GPU
I_{quiebre} = frac{P}{W}
- P: el pico de la GPU, en FLOPS
- W: su ancho de banda de memoria, en bytes por segundo
- I_{quiebre}: cuántos FLOPs tiene que hacer con cada byte para que la memoria alcance a sus núcleos, en FLOPs por byte
:::

:::cuenta Puntos de quiebre, en FP16
T4 // \(P\) = 65 TFLOPS, \(W\) = 320 GB/s | \(I_{quiebre} = P/W\) = 65 × 10¹² ÷ (320 × 10⁹) | ≈ 203 FLOPs por byte
L4 // 121 TFLOPS, 300 GB/s | 121 × 10¹² ÷ (300 × 10⁹) | ≈ 403
A100 de 80 GB // 312 TFLOPS, 2,039 GB/s | 312 × 10¹² ÷ (2,039 × 10⁹) | ≈ 153
H100 // 990 TFLOPS, 3,350 GB/s | 990 × 10¹² ÷ (3,350 × 10⁹) | ≈ 295
= Para tener ocupados sus tensor cores, una T4 necesita usar cada byte que trae en ≈ 200 operaciones. Es común redondear los dos primeros a ≈ 200 y ≈ 400.
:::

Con las dos cosas, la decisión es una comparación:

- Si la intensidad del cálculo es **menor** que el punto de quiebre (\(I < I_{quiebre}\)), los núcleos esperan a la memoria. El cálculo es [[memory-bound]] (limitado por la memoria): tarda bytes ÷ ancho de banda, y una GPU con más TFLOPS no lo acelera.
- Si es **mayor** (\(I ≥ I_{quiebre}\)), la memoria alcanza y los núcleos van a su máximo. Es [[compute-bound]] (limitado por el cálculo): tarda FLOPs ÷ FLOPS, y una GPU con más ancho de banda no lo acelera.

:::analogia Una cocina y su bodega
Un cocinero (los núcleos) pica y guisa rapidísimo, pero los ingredientes están en una bodega (la VRAM), y un ayudante los trae por un pasillo a cierta velocidad (el ancho de banda). Si la receta usa cada costal para un solo corte, el cocinero pasa el día esperando al ayudante: memory-bound. Si con cada costal de papas hace puré, sopa y guarnición, el ayudante le sobra y el límite es qué tan rápido cocina: compute-bound. La mesa junto a la estufa es la caché: lo que está ahí se usa sin esperar.

**Dónde se rompe:** en la cocina, usar un ingrediente lo gasta. En una GPU, un número se puede usar las veces que quieras sin volver por él, mientras siga en la mesa. Y no hay un cocinero sino miles, todos haciendo el mismo corte a la vez.
:::

### El decode de un LLM: memory-bound

En [la lección de LLMs](/llms/) viste que la respuesta sale de un token a la vez (el [[decode]]) y que cada token obliga a leer todos los pesos. Ahora puedes decir con números por qué eso es lento.

:::cuenta Un token de Llama 3 8B en una L4
Bytes \(D\): los pesos // 8.03 mil millones de parámetros en BF16, 2 bytes cada uno | 8.03 × 10⁹ × 2 B | ≈ 16.06 GB
FLOPs por token \(F\) // una MAC por parámetro: 2 FLOPs | 2 × 8.03 × 10⁹ | ≈ 16 GFLOPs
Intensidad \(I\) | \(I = F/D\) = 16 GFLOPs ÷ 16 GB | ≈ 1 FLOP por byte
Reloj del cálculo // \(P\) = 121 TFLOPS, el pico FP16 de la L4 | \(t_{cálculo} = F/P\) = 16 × 10⁹ ÷ (121 × 10¹²) | ≈ 0.13 ms
Reloj de la memoria // \(W\) = 300 GB/s, el ancho de banda de la L4 | \(t_{memoria} = D/W\) = 16.06 GB ÷ 300 GB/s | ≈ 54 ms
Techo // un token por cada paso, y el paso no baja de \(t_{memoria}\) | 1 token ÷ 54 ms | ≈ 19 tokens por segundo
= El quiebre de la L4 es ≈ 400 y la intensidad es 1: **memory-bound**, unas 400 veces por debajo. Los núcleos trabajan 0.13 ms y esperan 54.
:::

De ahí sale la regla más útil de la lección para los LLMs:

:::formula Techo de tokens por segundo en el decode
v ≤ frac{W}{D_{pesos}}
- W: el ancho de banda de memoria de la GPU, en GB/s
- D_{pesos}: los bytes de todos los pesos del modelo, en GB: se leen enteros en cada token
- v: los tokens por segundo que puede escribir, como techo
:::

Por eso, para que un LLM escriba más rápido, no sirve una GPU con el doble de TFLOPS. Sirve una con más ancho de banda: en una H100, \(W ÷ D_{pesos}\) = 3,350 ÷ 16 ≈ 210 tokens por segundo, como techo. O leer menos bytes por token: con los pesos en INT8 (8.03 GB), la misma L4 sube a 300 ÷ 8.03 ≈ 37 (lo ves en la sección extra de la precisión). O usar cada peso leído para varias conversaciones a la vez: el batching, en otra sección extra. Y fíjate en la trampa: la L4 tiene casi el doble de TFLOPS que la T4, pero un poco **menos** ancho de banda (300 contra 320 GB/s). Para el decode, la L4 no es más rápida; lo que sí tiene es más VRAM (24 GB, donde cabe un modelo de 8B en BF16, que en los 16 GB de la T4 no cabe) y soporte de BF16, que la T4 no tiene.

### El prefill es lo contrario

Leer el [[prompt]] es otra historia. En el [[prefill]], los 2,000 tokens de un prompt pasan juntos por el modelo, y cada peso que se lee se usa para los 2,000. La intensidad sube a ≈ 2,000 FLOPs por byte (cada peso de 2 bytes hace 2 FLOPs por cada uno de los 2,000 tokens), muy por encima del quiebre de la L4, ≈ 403, y manda el cálculo. Por eso el tiempo al primer token ([[ttft|TTFT]]) depende de los FLOPs, y el tiempo de cada token después ([[tpot|TPOT]]), de los bytes. Son el mismo modelo en la misma GPU, en los dos lados del punto de quiebre.

:::diagrama flops-diagnostico
El razonamiento completo para cualquier operación. Sigue los tres recorridos: una multiplicación grande, un token de un LLM y la última capa de la ResNet-50 de Alba.
:::

## El roofline: ¿cálculo o memoria? {The roofline: compute or memory?} [extra]

Todo lo anterior cabe en una sola gráfica, el [[roofline]] (*roofline model*, «el modelo del techo»), que propusieron Samuel Williams, Andrew Waterman y David Patterson en 2009.

### Cómo se lee

A lo ancho va la intensidad aritmética del cálculo; a lo alto, los TFLOPS que puede alcanzar. Las dos escalas son logarítmicas: cada marca vale 10 veces la anterior, para que quepan juntos 0.1 y 10,000. La línea de arriba es el máximo posible:

:::formula El roofline
R = min(P, I × W)
- P: el pico de la GPU, en FLOPS: el techo plano
- I: la intensidad aritmética del cálculo, en FLOPs por byte
- W: el ancho de banda de memoria, en bytes por segundo
- I × W: los FLOPS que la memoria alcanza a alimentar: la rampa
- R: los FLOPS alcanzables, el menor de los dos
:::

Tiene dos partes:

- **La rampa.** Con intensidad baja, lo que llega por la memoria limita: cada byte por segundo rinde \(I\) FLOPs por segundo. En una T4, \(R = I × W\) = \(I\) × 320 GB/s. Si duplicas la intensidad, duplicas la velocidad.
- **El techo.** Con intensidad alta, la memoria ya alcanza y el límite es el pico: 65 TFLOPS en la T4. Subir más la intensidad ya no sirve.

Las dos partes se juntan donde \(I × W = P\), es decir, en \(I = P/W\): el punto de quiebre, ≈ 203 FLOPs por byte en la T4.

:::figura flops-roofline
El roofline de una T4. A la izquierda del quiebre, la rampa: manda la memoria y cada FLOP por byte de más rinde. A la derecha, el techo plano de 65 TFLOPS. Los tres puntos son cálculos de esta lección.
:::

Lee los tres puntos. El decode de un LLM, con intensidad 1, alcanza a lo mucho \(R = I × W\) = 1 × 320 GB/s = 0.32 TFLOPS: el 0.5 % del pico. La última capa de la ResNet-50 de Alba con 32 fotos, con intensidad ≈ 30 (29.6), puede llegar a lo mucho a 29.6 × 320 GB/s ≈ 9.5 TFLOPS. La multiplicación de dos matrices de 4,096 toca el techo.

:::calculadora flops-roofline
Empieza con la T4 y una intensidad de 1. Sube la intensidad hasta pasar 203 y mira cuándo deja de crecer lo alcanzable. Después pon los números de la H100: 990 TFLOPS y 3,350 GB/s.
:::

### Una multiplicación grande: compute-bound

Dos matrices de 4,096 × 4,096 son lo mismo que una capa de 4,096 entradas y 4,096 salidas aplicada a un batch de 4,096: la multiplicación grande y con batch por excelencia.

:::cuenta Dos matrices de 4,096 × 4,096 en FP16, en una T4
FLOPs \(F\) // \(n = k = m\) = 4,096 | \(F = 2 × n × m × k\) = 2 × 4,096³ | ≈ 137.4 × 10⁹
Bytes \(D\) // leer A y B, escribir C: cada una de 4,096² números de 2 bytes | 3 × 4,096² × 2 | ≈ 100.7 MB
Intensidad \(I\) | \(I = F/D\) = 137.4 × 10⁹ ÷ (100.7 × 10⁶) | ≈ 1,365 FLOPs por byte
Reloj del cálculo // \(P\) = 65 TFLOPS | \(t_{cálculo} = F/P\) = 137.4 × 10⁹ ÷ (65 × 10¹²) | ≈ 2.11 ms
Reloj de la memoria // \(W\) = 320 GB/s | \(t_{memoria} = D/W\) = 100.7 MB ÷ 320 GB/s | ≈ 0.31 ms
= 1,365 es mucho más que 203: **compute-bound**. Tarda por lo menos ≈ 2.1 ms. Una GPU con más ancho de banda no la acelera; una con más TFLOPS, sí.
:::

### La misma cuenta, en Python

```python
def roofline(nombre, flops, bytes_, pico_tflops, gb_s):
    t_calculo = flops / (pico_tflops * 1e12)        # segundos
    t_memoria = bytes_ / (gb_s * 1e9)
    intensidad = flops / bytes_                      # FLOPs por byte
    quiebre = pico_tflops * 1e12 / (gb_s * 1e9)
    manda = "compute-bound" if intensidad >= quiebre else "memory-bound"
    print(f"{nombre:26}{intensidad:8.1f}{t_calculo * 1e3:10.4f}{t_memoria * 1e3:10.4f}  {manda}")

def matmul(n, k, m, bytes_por_numero=2):            # FP16: 2 bytes por número
    flops = 2 * n * k * m
    bytes_ = bytes_por_numero * (n * k + k * m + n * m)   # leer A y B, escribir C
    return flops, bytes_

print(f"{'operación':26}{'FLOPs/B':>8}{'cálculo':>10}{'memoria':>10}  (ms)")
roofline("matmul 4096, T4", *matmul(4096, 4096, 4096), 65, 320)
roofline("matriz por vector, T4", *matmul(1, 4096, 4096), 65, 320)
roofline("capa final Alba x32, T4", *matmul(32, 2048, 500), 65, 320)
pesos = 8.03e9 * 2                                   # Llama 3 8B en BF16
roofline("token de Llama 3 8B, L4", 2 * 8.03e9, pesos, 121, 300)
roofline("prefill de 2,000, L4", 2 * 8.03e9 * 2000, pesos, 121, 300)
```

```salida
operación                  FLOPs/B   cálculo   memoria  (ms)
matmul 4096, T4             1365.3    2.1144    0.3146  compute-bound
matriz por vector, T4          1.0    0.0005    0.1049  memory-bound
capa final Alba x32, T4       29.6    0.0010    0.0069  memory-bound
token de Llama 3 8B, L4        1.0    0.1327   53.5333  memory-bound
prefill de 2,000, L4        2000.0  265.4545   53.5333  compute-bound
```

Las dos últimas filas son el mismo modelo en la misma GPU. Un token suelto no baja de ≈ 54 ms, por los bytes; el prefill de 2,000 tokens, de ≈ 265 ms, por las cuentas. Sueltos, esos 2,000 tokens serían 2,000 × 54 ms ≈ 107 segundos: la diferencia es cuántas veces se usa cada peso leído.

## El batching: usar cada byte muchas veces {Batching: using each byte many times} [extra]

Si el problema del decode es que cada peso se usa una sola vez, el remedio es usarlo varias veces por cada lectura. Eso hace el [[batch|batching]].

### Una lectura, muchos usos

Con un batch de b entradas, la matriz de pesos se lee **una vez** y se multiplica por las b entradas. Los FLOPs se multiplican por b; los bytes de los pesos, no. Mientras los pesos sean casi todos los bytes, la intensidad queda \(I ≈ b × I_1\), con \(I_1\) la intensidad con una sola entrada. En una capa en FP16, \(I_1\) ≈ 1, así que \(I ≈ b\).

:::figura flops-batch
Una capa de 4,096 × 4,096 en FP16. Arriba, con 1 entrada cada peso que se lee se usa una vez; con 8, ocho veces, casi por los mismos bytes. Abajo, la intensidad según el batch, contra los quiebres de la T4 y de la L4.
:::

¿Por qué no es exactamente b? Porque las entradas y las salidas también son bytes, y crecen con el batch. Con la cuenta completa, la capa de 4,096 pasa el quiebre de la T4 con un batch de 226, no de 204; lo calculas en los ejercicios.

### En Alba: el dynamic batching

La ResNet-50 tiene su propia historia, capa por capa. En FP16, cada peso ocupa 2 bytes y cada uso suyo son 2 FLOPs, así que, si cuentas solo los pesos, **la intensidad es igual al número de veces que se usa cada peso**: \(I = (2 × text{MACs}) ÷ (2 × text{pesos}) = text{MACs} ÷ text{pesos}\).

:::cuenta Usos por peso en la ResNet-50 de Alba, a batch 1
Etapa 1 // mapas de 56 × 56; \(I = text{MACs} ÷ text{pesos}\) | 668 M MACs ÷ 0.216 M pesos | ≈ 3,100
Etapa 3 // mapas de 14 × 14 | 1,464 M ÷ 7.1 M | ≈ 206
Etapa 4 // mapas de 7 × 7 | 809 M ÷ 15.0 M | ≈ 54
Capa final // densa: cada peso, una vez | 1,024,000 ÷ 1,024,500 | ≈ 1
= Contando solo los pesos, y contra el quiebre de la T4 (≈ 203): la etapa 1 sobra, la etapa 3 está justo en el límite, y la etapa 4 y la capa final quedan debajo con una sola foto.
:::

Con \(b\) fotos juntas, cada peso se usa \(b\) veces más: \(I ≈ 54 × b\) en la etapa 4. Con 4 fotos, 54 × 4 = 216, y pasa el quiebre; con 32, 54 × 32 ≈ 1,730. Ojo: esta cuenta solo mira los pesos. Las activaciones (los mapas que cada capa lee y escribe) también viajan, así que la intensidad real es menor, sobre todo donde los mapas son grandes. Una convolución de 1 × 1 de la etapa 1, por ejemplo, mueve ≈ 2 MB de mapas por cada 32 KB de pesos: su intensidad real ronda 50, no 3,100. Y como los mapas crecen con el batch, juntar fotos no se la sube. En resumen: con batches de 32, la ResNet-50 tiende a ser compute-bound; con los batches de 1 a 3 que trae el tráfico real, parte de sus capas espera a la memoria o al costo de lanzar cada operación. Por eso la capacidad se mide, no se deduce de estas cuentas.

Por eso Alba usa el *dynamic batching* de Triton, el servidor que corre su modelo: junta las fotos que llegan casi juntas, hasta 32, y las calcula en un solo batch. El precio es la espera. El equipo de Alba le pone un tope de 2 ms en la cola, para que juntar fotos no se coma el presupuesto de [[latencia]] (un [[p99]] de 200 ms o menos, medido en la API).

### En un LLM: varias conversaciones por paso

En el decode, el batch son varias conversaciones a la vez: en cada paso los pesos se leen una vez y sale un token para cada conversación. Pero cada conversación trae su propio [[kv-cache|KV cache]], que se lee aparte y no se comparte. Haz la cuenta para Llama 3 8B en una L4 con 4 conversaciones de 8,192 tokens, con 1.07 GB de KV cache cada una (lo que cabe en sus 24 GB). Es el reloj de la memoria, \(D/W\), con los bytes de un paso:

:::formula Un paso de decode con un batch de conversaciones
t_{paso} = frac{D_{pesos} + b × D_{kv}}{W}
v_{total} = frac{b}{t_{paso}}
v_{conv} = frac{1}{t_{paso}}
- D_{pesos}: los bytes de los pesos, en GB, que se leen una vez por paso
- b: cuántas conversaciones van a la vez (el batch)
- D_{kv}: los bytes del KV cache de cada conversación, en GB
- W: el ancho de banda de memoria, en GB/s
- t_{paso}: el tiempo mínimo de un paso, en segundos, que da un token a cada conversación
- v_{total}, v_{conv}: tokens por segundo de toda la GPU y de cada conversación
:::

:::cuenta Cuatro conversaciones a la vez, en una L4
Bytes por paso // \(D_{pesos}\) = 16.06 GB, \(b\) = 4, \(D_{kv}\) = 1.07 GB | 16.06 GB + 4 × 1.07 GB | ≈ 20.3 GB
Tiempo por paso \(t_{paso}\) // \(W\) = 300 GB/s | 20.3 GB ÷ 300 GB/s | ≈ 68 ms
Tokens por segundo en total \(v_{total}\) // 4 tokens por paso | \(b/t_{paso}\) = 4 ÷ 0.068 s | ≈ 59
Tokens por segundo de cada conversación \(v_{conv}\) | \(1/t_{paso}\) = 1 ÷ 0.068 s, o 59 ÷ 4 | ≈ 15
= Con una sola conversación eran ≈ 19 tokens por segundo. Con cuatro, cada una va un poco más lento (≈ 15), pero la GPU produce ≈ 3 veces más (≈ 59).
:::

Los servidores de LLMs como vLLM hacen esto sin parar: su *continuous batching* mete y saca conversaciones del batch en cada paso. El límite ya no son los pesos, sino la memoria para los KV caches: cada conversación más ocupa más VRAM y agrega bytes a cada paso.

:::calculadora flops-tokens
Prueba 4 conversaciones con 1.07 GB de KV cache cada una: ≈ 59 tokens por segundo en total y ≈ 15 por conversación. Luego pon el ancho de banda de una H100, 3,350 GB/s.
:::

### Lo que cuesta el batching

El batching no es gratis:

- **Espera.** Para juntar un batch hay que esperar a que lleguen las entradas. Por eso se le pone un tope de tiempo, como los 2 ms de Alba.
- **Memoria.** Más entradas a la vez son más activaciones, o más KV caches, en la VRAM.
- **La latencia de cada uno.** En un LLM, cada conversación más hace un poco más lento el paso de todas: es el TPOT que ve cada persona.
- **Que haya a quién juntar.** En un teléfono hay una sola persona escribiendo: batch 1, siempre.

## Por dentro de una multiplicación: tiles, caché y fusión {Inside a multiplication: tiles, cache and fusion} [extra]

La intensidad de una matmul que calculaste (≈ 1,365 para dos matrices de 4,096) supone que cada número viaja de la VRAM **una sola vez**. Lograrlo es trabajo de quien programa la GPU, y entender cómo explica varias cosas que vas a oír.

### El programa más directo, en Python

Así se multiplica sin bibliotecas, contando cada multiplicación con su suma:

```python
def matmul(A, B):
    n, k, m = len(A), len(B), len(B[0])
    assert len(A[0]) == k, "las dimensiones de adentro no coinciden"
    C = [[0] * m for _ in range(n)]
    macs = 0
    for i in range(n):              # cada fila de A
        for j in range(m):          # cada columna de B
            for t in range(k):      # el producto punto, número por número
                C[i][j] += A[i][t] * B[t][j]   # multiplica y acumula: 1 MAC
                macs += 1
    return C, macs

compras = [[2, 1, 3],               # Sofía: playeras, gorras, calcetines
           [1, 0, 2]]               # Luis
productos = [[50, 200],             # playera: precio y gramos
             [120, 100],            # gorra
             [15, 50]]              # calcetines
C, macs = matmul(compras, productos)
print("C =", C)
print("MACs =", macs, "  FLOPs =", 2 * macs)

for n, k, m in [(4, 8, 5), (1, 64, 10), (16, 16, 16)]:
    A = [[1] * k for _ in range(n)]
    B = [[1] * m for _ in range(k)]
    print(f"({n} x {k}) . ({k} x {m}): MACs = {matmul(A, B)[1]:5}  n*m*k = {n * m * k}")
```

```salida
C = [[265, 650], [80, 300]]
MACs = 12   FLOPs = 24
(4 x 8) . (8 x 5): MACs =   160  n*m*k = 160
(1 x 64) . (64 x 10): MACs =   640  n*m*k = 640
(16 x 16) . (16 x 16): MACs =  4096  n*m*k = 4096
```

Son tres ciclos, uno dentro de otro: uno por cada fila de A (n vueltas), uno por cada columna de B (m vueltas) y uno por cada número del producto punto (k vueltas). Por eso el contador siempre da n × m × k. NumPy y PyTorch hacen exactamente las mismas cuentas, solo que muchísimo más rápido. Lo que cambia, además de repartir el trabajo entre muchos núcleos, es cuántas veces traen cada número de la memoria.

### Si no se reusa nada

Ese programa, tal cual, traería de la VRAM los dos números de cada MAC: 4 bytes en FP16 para 2 FLOPs. Intensidad 0.5: memory-bound para siempre, sin importar el tamaño de las matrices. Las cuentas son las mismas; lo que cambia es cuántas veces viaja cada número.

### Tiles

Los programas de verdad parten el resultado en bloques, llamados *tiles* (mosaicos). Para calcular un bloque de T × T casillas de C, traen al chip una franja de T filas de A y una de T columnas de B, y usan cada número T veces antes de soltarlo.

:::cuenta Cuánto rinde un tile de T × T, en FP16
FLOPs del bloque \(F\) // T × T casillas, cada una con k MACs; es \(F = 2 × n × m × k\) con \(n = m = T\) | 2 × T × T × k | 2T²k
Bytes que se traen \(D\) // T filas de A y T columnas de B, de k números de 2 bytes | 2 × (T × k + k × T) | 4Tk
Intensidad \(I\) | \(I = F/D\) = 2T²k ÷ 4Tk | T ÷ 2
Con T = 64 | 64 ÷ 2 | 32 FLOPs por byte
Con T = 256 | 256 ÷ 2 | 128 FLOPs por byte
= Mientras más grande el tile, más se reusa cada número. El límite es la memoria rápida junto a los núcleos, de apenas decenas o cientos de KB por cada grupo de núcleos, así que los programas reales usan tiles dentro de tiles, uno por cada nivel de la [[jerarquia-memoria|jerarquía de memoria]] (de la VRAM a la caché, y de ahí a la memoria junto a los núcleos), y se acercan a la intensidad ideal.
:::

Nadie escribe esto a mano para su modelo: lo traen las bibliotecas de NVIDIA (cuBLAS para matrices, cuDNN para convoluciones) y los compiladores como TensorRT, que prueban varios tamaños de tile en tu GPU y se quedan con el más rápido.

### Una convolución, como matmul

En [la lección de redes](/redes/) contaste las MACs de una [[convolucion|convolución]]: **posiciones de salida × filtros × pesos por filtro**. Es una multiplicación de matrices disfrazada.

Toma la primera capa de la ResNet-50. Cada [[filtro]] mira una ventana de 7 × 7 píxeles en los 3 canales: 147 números. Si para cada una de las 112 × 112 = 12,544 posiciones pones en una fila los 147 números que mira el filtro, armas una matriz de 12,544 × 147. Los 64 filtros, uno por columna, forman otra de 147 × 64. Su producto mide 12,544 × 64: los 64 [[mapa-activaciones|mapas de activaciones]] de 112 × 112, uno por columna.

:::cuenta La primera capa de la ResNet-50, como matmul
Matriz de ventanas, \(n × k\) // una fila por posición, con los 147 números que mira el filtro: \(n\) = 12,544, \(k\) = 147 | 12,544 × 147 | 1,843,968 números
Matriz de filtros, \(k × m\) // una columna por filtro: \(m\) = 64 | 147 × 64 | 9,408 pesos
MACs // \(text{MACs} = n × m × k\) | 12,544 × 64 × 147 | 118,013,952
= Las mismas 118 millones de MACs que contaste en la lección de redes. Las bibliotecas de las GPUs suelen calcular las convoluciones así, como multiplicaciones de matrices, para aprovechar el hardware que las multiplica.
:::

### Matrices chicas, GPU desperdiciada

Si la matriz es más chica que los tiles, no hay qué reusar ni con qué llenar los miles de núcleos. Además, cada operación es un [[kernel-gpu|*kernel*]]: un programita que la CPU le manda a la GPU, con un costo fijo de lanzamiento del orden de microsegundos. Una ResNet-50 son decenas de kernels por foto, y más de cien si no se fusionan. A batch 1, ese costo fijo y las matrices chicas pueden pesar más que el cálculo: la GPU parece ociosa sin estarlo. Se arregla con un runtime compilado: TensorRT, que junta capas y deja menos kernels, o torch.compile con *CUDA graphs*, que lanza todos los kernels de un jalón.

### Fusión

Las operaciones elemento a elemento, como sumar el sesgo o aplicar una [[relu|ReLU]], hacen una operación por número: leen 2 bytes, escriben 2 y hacen 1 FLOP. Intensidad 0.25, memory-bound al extremo.

Si cada una fuera un kernel aparte, el resultado de la convolución se escribiría en la VRAM, se volvería a leer para sumar el sesgo, se escribiría otra vez, se leería para la ReLU y se escribiría al final. La **fusión de capas** (*layer fusion*) junta la convolución, el sesgo y la ReLU en un solo kernel: la ReLU se aplica mientras el resultado sigue en el chip, y nunca viaja de más. Es de lo primero que hace TensorRT, junto con «plegar» la [[batchnorm|BatchNorm]] dentro de la convolución anterior, como viste en la lección de redes.

:::nota Lo vas a ver con calma después
La lección «Memoria, caché y disco» explica por qué hay varias memorias de distinta velocidad, y «CPU y GPU», cómo se reparten el trabajo los núcleos de una GPU.
:::

## Menos bits, más velocidad {Fewer bits, more speed} [extra]

En la lección anterior viste que un número puede guardarse en 4, 2, 1 o medio byte. En el roofline, bajar la precisión mueve las dos cosas a la vez.

### Dos efectos

1. **Menos bytes por número.** El mismo cálculo en FP16 mueve la mitad de bytes que en float32: la intensidad se duplica y el reloj de la memoria tarda la mitad.
2. **Un techo más alto.** Los tensor cores hacen más operaciones por segundo con números más chicos: la T4 pasa de 8.1 TFLOPS en float32 a 65 en FP16 y a 130 TOPS en INT8; la H100, de ≈ 990 en FP16 a ≈ 1,979 en FP8.

Qué efecto te ayuda depende de qué te limita.

### En una CNN: hasta 2×

La ResNet-50 con batches grandes tiende a ser compute-bound, así que lo que más la acelera es el techo. En la T4, pasar de FP16 a INT8 sube el techo de 65 a 130: **2× como máximo**. Las capas que esperan a la memoria tampoco ganan más de 2×, porque sus bytes bajan a la mitad. Y solo si los pesos **y** las activaciones están en INT8, porque los tensor cores INT8 necesitan los dos números en INT8. En la práctica no todo se cuantiza y hay conversiones de por medio: el equipo de Alba estima ≈ 1.5 a 2× sobre FP16 para su ResNet-50. Además, [[cuantizacion|cuantizar]] puede bajar la accuracy, así que se mide con el [[golden-set|golden set]] antes de aceptarlo.

### En el decode de un LLM: tanto como bajen los bytes

El decode es memory-bound: lo que lo acelera es leer menos bytes. Aquí basta cuantizar **solo los pesos** (*weight-only*): se guardan en INT8 o INT4 y se convierten de vuelta a 16 bits (BF16 o FP16) justo antes de multiplicar, ya dentro del chip. Esa conversión cuesta cálculo, pero el cálculo sobra. La cuenta es el techo del decode, \(v ≤ W/D_{pesos}\), con \(W\) = 300 GB/s y cada vez menos bytes:

:::cuenta Llama 3 8B en una L4, con menos bits
BF16 // \(D_{pesos}\) = 8.03 × 10⁹ pesos × 2 bytes | \(v ≤ W/D_{pesos}\) = 300 GB/s ÷ 16.06 GB | ≈ 19 tokens por segundo
INT8 // 1 byte por peso: 8.03 × 10⁹ × 1 | 300 GB/s ÷ 8.03 GB | ≈ 37
INT4 // medio byte por peso, más las escalas de cada grupo; muchos formatos dejan en BF16 la tabla de embeddings y la capa de salida, ≈ 1,000 millones de pesos | 300 GB/s ÷ ≈ 5.73 GB | ≈ 52
= Si los pesos pesan la mitad, el techo se duplica. INT4 no llega a 4× porque parte del modelo se queda en BF16. Más TFLOPS no habrían movido nada.
:::

### Servir en float32 sale caro

El otro lado de la moneda. En Alba, PyTorch sin optimizar, en float32 y de una foto en una, responde del orden de 100 fotos por segundo: \(x × F\) = 100 × 8.2 GFLOPs = 0.82 TFLOPS, ≈ 10 % del pico float32 de la T4 (0.82 ÷ 8.1) y ≈ 1.3 % de su pico FP16 (0.82 ÷ 65). Así, el equipo de Alba calcula que harían falta 500 ÷ 100 ≈ 5 GPUs solo para el pico de diseño de 500 fotos por segundo, contra 1 con TensorRT en FP16 (≈ 1,200 fotos por segundo por T4).

### Sparsity

El último truco de las hojas de datos. Desde la generación de la A100, los tensor cores pueden saltarse ceros si en cada grupo de 4 pesos hay 2 en cero (*sparsity* 2:4). Eso duplica los TFLOPS anunciados, pero exige podar el modelo con ese patrón y reentrenarlo un poco para recuperar la calidad, y casi ningún modelo que te dan lo cumple. Por eso esta lección usa siempre los números densos, y tú también deberías.

## Errores comunes {Common mistakes}

Casi todos vienen de mirar un solo número, los FLOPs o los TFLOPS, y olvidar la memoria o las unidades.

### Confundir FLOPs con FLOPS

**Qué pasa:** «la ResNet-50 hace 8.2 GFLOPS» mezcla una cantidad con una velocidad. Después se divide o se multiplica al revés y salen tiempos sin sentido.

**Cómo evitarlo:** di las unidades completas: «8.2 GFLOPs **por foto**» y «65 TFLOPS» (por segundo). Si al dividir no te quedan segundos, o algo por segundo, algo está al revés.

### Olvidar el factor 2

**Qué pasa:** se mezclan MACs con FLOPs. Pasa más de lo que crees, porque muchos artículos llaman «FLOPs» a las MACs: el artículo original de las ResNet (He y otros, 2015) dice que su red de 34 capas hace «3.6 mil millones de FLOPs (*multiply-adds*)», es decir, de MACs. Si divides MACs entre los TFLOPS de una hoja de datos, que sí cuentan FLOPs, tu tiempo sale a la mitad.

**Cómo evitarlo:** pregunta siempre «¿MACs o FLOPs?». 1 MAC = 2 FLOPs, y los TFLOPS de los fabricantes cuentan FLOPs.

### Creer que el pico se alcanza

**Qué pasa:** «8.2 GFLOPs por foto y 65 TFLOPS: ≈ 7,900 fotos por segundo por T4». Alba mide ≈ 1,200, el 15 %. Si dimensionas con el pico, compras varias veces menos GPUs de las que hacen falta.

**Cómo evitarlo:** usa el pico solo como chequeo de cordura, para saber qué es imposible. Dimensiona con lo **medido** (en Alba, con perf_analyzer y tráfico parecido al real). Y si tu medición pasa el pico, la medición está mal.

### Ignorar el ancho de banda de memoria

**Qué pasa:** «el LLM va lento: compro una GPU con el doble de TFLOPS». El decode es memory-bound: la L4 tiene casi el doble de TFLOPS que la T4 y, aun así, menos GB/s.

**Cómo evitarlo:** antes de comprar, calcula la intensidad del cálculo y compárala con el quiebre de la GPU. Para el decode, la cuenta rápida es tokens por segundo ≤ GB/s ÷ GB de pesos.

### Confundir cuánta memoria hay con qué tan rápido se lee

**Qué pasa:** «es memory-bound porque la T4 tiene poca VRAM». Es la respuesta típica de quien empieza (*junior*) en una entrevista de diseño. La capacidad (GB) decide qué cabe; el ancho de banda (GB/s), qué tan rápido se lee. Un modelo puede caber con espacio de sobra y ser memory-bound igual.

**Cómo evitarlo:** separa las dos preguntas: ¿cabe? (GB) y ¿qué tan rápido se lee? (GB/s). Se resuelven con palancas distintas.

### Comparar TFLOPS de distinta precisión, o con sparsity

**Qué pasa:** comparar los ≈ 1,979 TFLOPS de la H100 en FP8 con los 312 de la A100 en FP16 y concluir que es 6 veces más rápida. En la misma precisión (FP16) son ≈ 990 contra 312: ≈ 3 veces. Y si la tabla dice *with sparsity*, es el doble de lo que tu modelo va a ver.

**Cómo evitarlo:** compara siempre en la misma precisión, densa, y la que de verdad vas a usar.

### Leer la utilización de `nvidia-smi` como «qué tanto trabajan los núcleos»

**Qué pasa:** `nvidia-smi` marca 100 % y se concluye «la GPU está al máximo, hay que comprar otra». Ese número es el porcentaje del tiempo en que corrió algún kernel. Un decode memory-bound marca casi 100 % con los tensor cores casi ociosos; con batches de 1, puede marcar 30 % mientras usas el 5 % de lo que la GPU daría con batches grandes.

**Cómo evitarlo:** compara el [[throughput]] logrado contra el máximo medido, mira cómo cambia el throughput al subir el batch y, si hace falta el detalle, usa un perfilador como Nsight.

## En la vida real {In real life} [extra]

**Alba · Una T4 que trabaja al 5 %.** Cuando Ana sube la foto de sus tenis, la ResNet-50 de Alba hace 8.2 GFLOPs en una T4, que mide ≈ 1,200 fotos por segundo: el 15 % de su pico. Un día completo son 10 millones de fotos, 82 PFLOPs, que una sola T4 resolvería en ≈ 2.3 horas a su máximo medido (la cuenta va abajo). En promedio llegan 10,000,000 ÷ 86,400 s ≈ 116 fotos por segundo para 2 GPUs: ≈ 58 cada una contra ≈ 1,200 posibles, 58 ÷ 1,200 ≈ 5 % de carga. Las dos T4 (2 × US$0.526 la hora × 730 horas ≈ US$768 al mes) están ahí por disponibilidad, para que el servicio siga si se cae una, no por cálculo. Por eso cuantizar a INT8 (2× como máximo) no ahorra GPUs en Alba: no es el cálculo lo que fija cuántas hay.

:::cuenta Todas las fotos de un día de Alba
Fotos al día \(N_{día}\) // ≈ 2.5 M publicaciones con ≈ 3 fotos cada una (7.5 M), más ≈ 2.5 M que mandan otros equipos | dato de Alba | 10,000,000
FLOPs por foto \(F\) | 2 × 4.1 × 10⁹ | 8.2 × 10⁹
FLOPs al día // \(N_{día} × F\) | 10,000,000 × 8.2 × 10⁹ | 8.2 × 10¹⁶ = 82 PFLOPs
Una T4 a lo medido // \(N_{día} ÷ x\), con \(x\) ≈ 1,200 fotos por segundo | 10,000,000 ÷ 1,200 | ≈ 8,300 s ≈ 2.3 horas
= 82 PFLOPs suena enorme, pero es menos de una décima parte del día de una sola T4.
:::

:::profundo Cuánto cuesta entrenar
Entrenar suma la [[backpropagation]], que cuesta unas dos veces el [[forward-pass|forward pass]]: calcula gradientes para las activaciones y para los pesos. Por eso un paso de entrenamiento cuesta ≈ 3 veces responder, como viste en la lección de cómo aprende un modelo.

La cuenta es \(F_{entrenar} ≈ 3 × F × N_{fotos} × E\): \(F\) los FLOPs de responder una foto, \(N_{fotos}\) las fotos de entrenamiento y \(E\) las épocas (las vueltas completas a los datos). En Alba: 3 × 8.2 GFLOPs × 1,840,211 fotos × 8 épocas ≈ 3.6 × 10¹⁷ FLOPs por cada entrenamiento mensual. En la A10G con que Alba entrena (≈ 1,000 a 1,400 fotos por segundo, una estimación) son ≈ 3 a 4 horas; en una T4, como las de producción, tardaría ≈ 10 horas.

Para los LLMs se usa la misma regla escrita de otra forma: entrenar cuesta \(F_{entrenar} ≈ 6 × N_{param} × N_{tokens}\), con \(N_{param}\) los parámetros y \(N_{tokens}\) los tokens de entrenamiento: 2 FLOPs del forward y ≈ 4 de la backpropagation por cada parámetro y cada token. Es la cuenta que se usa para estimar cuántas GPUs y cuántas semanas pide un modelo nuevo.
:::

**Un LLM propio.** Pensemos en un servicio que sirve su propio LLM: un modelo de 70.6 mil millones de parámetros en FP8, ≈ 70.6 GB de pesos. Cada réplica usa 2 H100 y las dos se reparten los pesos (*tensor parallelism*), así que en cada paso de decode cada H100 lee su mitad: \(D/W\) = 35.3 GB ÷ 3,350 GB/s ≈ 10.5 ms, el piso del paso. Con 40 conversaciones a la vez, cada GPU lee además ≈ 13.9 GB de KV cache: el paso sube a (35.3 + 13.9) GB ÷ 3,350 GB/s ≈ 15 ms. Su objetivo es un TPOT de 50 ms o menos en el p95 (≈ 20 tokens por segundo por persona), así que queda margen. El prefill, en cambio, es compute-bound: con ≈ 4.2 preguntas por segundo por réplica y ≈ 1,000 tokens nuevos en cada prompt (el resto es un principio que se repite entre preguntas, y su KV cache ya estaba calculado), son 2 FLOPs × 70.6 × 10⁹ parámetros × 1,000 tokens × 4.2 por segundo ≈ 593 TFLOPS, ≈ 15 % del pico FP8 de las dos H100 (≈ 3,958). Son cotas: la capacidad real de cada réplica sale de un barrido de carga.

**Un teléfono con un modelo chico.** Un teléfono atiende a una sola persona, así que siempre está a batch 1: el decode es memory-bound sin remedio. Su memoria es compartida por la CPU, la GPU y la NPU (el chip para redes neuronales), y entrega unas decenas de GB/s. Las NPUs anuncian decenas de TOPS, pero para escribir texto casi no importan: importan los bytes. Apple publicó en 2024 que su modelo para el iPhone, de ≈ 3,000 millones de parámetros comprimido a ≈ 3.5 bits por peso, genera ≈ 30 tokens por segundo en un iPhone 15 Pro. Haz la cuenta: 3 × 10⁹ × 3.5 ÷ 8 ≈ 1.3 GB de pesos. Apple no publica el ancho de banda de esa memoria; si es del orden de 50 GB/s, una estimación razonable, el techo es ≈ 38 tokens por segundo. Lo publicado queda cerca del techo (≈ 80 %), como debe ser en un cálculo memory-bound. Por eso los modelos de los teléfonos son chicos y van muy cuantizados: duplicar los TOPS de la NPU no movería nada, y bajar los bytes por token sí.

**Fuera del ML: los videojuegos.** Las GPUs nacieron para dibujar. Cada vértice de un modelo 3D se multiplica por una matriz de 4 × 4 para ponerlo en la pantalla, y una imagen de 1080p tiene 1920 × 1080 = 2,073,600 píxeles, cada uno con su propia cuenta, 60 veces por segundo: ≈ 124 millones de píxeles por segundo. Es el mismo tipo de trabajo que una red neuronal: muchísimas multiplicaciones iguales e independientes. En 2012, AlexNet ganó el concurso ImageNet entrenada en dos tarjetas de videojuegos (GTX 580), y desde entonces el deep learning vive en GPUs.

## Ejercicios {Exercises}

Resuélvelos con lápiz (y calculadora para los números grandes) antes de abrir la solución. Los cuatro primeros son directos; los dos últimos juntan varias ideas.

:::ejercicios
? [facil] ¿Se puede multiplicar una matriz de 3 × 4 por una de 4 × 2? ¿Y una de 3 × 4 por una de 2 × 4? Si se puede, ¿de qué tamaño sale y cuántas MACs y FLOPs cuesta?
**3 × 4 por 4 × 2:** sí, porque las de adentro coinciden (4 y 4). Sale de \(n × m\) = 3 × 2. Con \(text{MACs} = n × m × k\) y \(F = 2 × text{MACs}\), donde \(n\) = 3, \(k\) = 4 y \(m\) = 2: MACs = 3 × 2 × 4 = **24**; FLOPs \(F\) = 2 × 24 = **48**.

**3 × 4 por 2 × 4:** no. Las filas de la primera tienen 4 números y las columnas de la segunda, 2. Con la transpuesta de la segunda, que mide 4 × 2, sí se podría.
? [facil] Calcula A · B y B · A, con A = [[1, 2], [3, 4]] y B = [[5, 6], [7, 8]] (cada corchete de adentro es una fila). ¿Cuántas MACs hiciste en cada una?
A · B, fila por columna:

- Fila 1: 1 × 5 + 2 × 7 = 19 y 1 × 6 + 2 × 8 = 22.
- Fila 2: 3 × 5 + 4 × 7 = 43 y 3 × 6 + 4 × 8 = 50.

A · B = **[[19, 22], [43, 50]]**.

B · A: 5 × 1 + 6 × 3 = 23, 5 × 2 + 6 × 4 = 34, 7 × 1 + 8 × 3 = 31 y 7 × 2 + 8 × 4 = 46. B · A = **[[23, 34], [31, 46]]**: otro resultado, aunque las dos midan 2 × 2.

Cada una cuesta \(n × m × k\) = 2 × 2 × 2 = **8 MACs**, y \(F\) = 2 × 8 = 16 FLOPs.
? [facil] Un MLP para dígitos tiene una capa de 784 entradas y 128 salidas. ¿Cuántas MACs y FLOPs hace con un batch de 64 imágenes? ¿Cuánto tardaría, como mínimo, en una T4 a 65 TFLOPS?
Es una matmul de (64 × 784) · (784 × 128): \(n\) = 64, \(k\) = 784, \(m\) = 128. Se usan \(text{MACs} = n × m × k\), \(F = 2 × text{MACs}\) y \(t_{mín} = F/P\):

- MACs: 64 × 128 × 784 = **6,422,528**.
- FLOPs: \(F\) = 2 × 6,422,528 = **12,845,056**, unos 12.8 millones.
- Tiempo mínimo, con \(P\) = 65 × 10¹²: 12,845,056 ÷ (65 × 10¹²) ≈ 2 × 10⁻⁷ s = **0.2 µs**.

Es tan poco que pesan más otras cosas: el costo fijo de lanzar la operación en la GPU, del orden de microsegundos, y hasta leer sus ≈ 0.32 MB de entradas, pesos y salidas en FP16, ≈ 1 µs a 320 GB/s.
? [facil] Un detector pide 20 GFLOPs por imagen y una GPU anuncia 100 TFLOPS en la precisión que usas. ¿Cuál es el tiempo mínimo por imagen y el techo de imágenes por segundo? Si mides 900 por segundo, ¿qué utilización tienes?
Con \(F\) = 20 × 10⁹ FLOPs, \(P\) = 100 × 10¹² FLOPS y \(x\) = 900 imágenes por segundo, se usan \(t_{mín} = F/P\), \(x_{máx} = P/F\) y \(u = x/x_{máx}\):

- Tiempo mínimo: \(t_{mín}\) = 20 × 10⁹ ÷ (100 × 10¹²) = 0.0002 s = **0.2 ms**.
- Techo: \(x_{máx}\) = 100 × 10¹² ÷ (20 × 10⁹) = **5,000 imágenes por segundo**.
- Utilización: \(u\) = 900 ÷ 5,000 = **18 %**. Un número normal, como el 15 % que mide Alba en sus T4.
? [medio] Multiplicas dos matrices de 1,024 × 1,024 en FP16. Calcula sus FLOPs, los bytes mínimos (leer las dos y escribir el resultado) y su intensidad. ¿Es compute-bound en una T4? ¿Y en una L4?
Se usan \(F = 2 × n × m × k\) con \(n = k = m\) = 1,024, \(I = F/D\) y la comparación con \(I_{quiebre} = P/W\):

- FLOPs: \(F\) = 2 × 1,024³ = 2,147,483,648 ≈ **2.15 × 10⁹**.
- Bytes: \(D\) = 3 matrices × 1,024² números × 2 bytes = 6,291,456 ≈ **6.3 MB**.
- Intensidad: \(I\) = 2.15 × 10⁹ ÷ (6.3 × 10⁶) ≈ **341 FLOPs por byte**.

En la T4 (\(I_{quiebre}\) ≈ 203) es **compute-bound**. En la L4 (\(I_{quiebre}\) ≈ 403) es **memory-bound**, por poco. Ahí los dos relojes quedan cerca: el cálculo, \(t_{cálculo} = F/P\) = 2.15 × 10⁹ ÷ (121 × 10¹²) ≈ 0.018 ms; la memoria, \(t_{memoria} = D/W\) = 6.3 MB ÷ 300 GB/s ≈ 0.021 ms. La misma operación cambia de lado según la GPU: la intensidad es del cálculo, el quiebre es de la máquina.
? [medio] ¿Cuántos tokens por segundo, como techo, da Llama 3 8B en BF16 (≈ 16.06 GB) en una A100 de 80 GB y en una H100? ¿Y un modelo de 70.6 mil millones de parámetros en FP8, en una sola H100, si cupiera con su KV cache?
El techo del decode es \(v ≤ W/D_{pesos}\), con \(W\) en GB/s y \(D_{pesos}\) en GB:

- A100 de 80 GB: 2,039 ÷ 16.06 ≈ **127 tokens por segundo**.
- H100: 3,350 ÷ 16.06 ≈ **209** (≈ 210 redondeado, el número de la sección del decode).
- El de 70.6 mil millones en FP8 pesa \(D_{pesos}\) = 70.6 × 10⁹ × 1 byte ≈ 70.6 GB: 3,350 ÷ 70.6 ≈ **47**.

En el servicio de «Un LLM propio», en la sección «En la vida real», ese modelo va repartido en dos H100 que leen su mitad cada una, a la vez: el piso baja a 35.3 GB ÷ 3,350 GB/s ≈ 10.5 ms por paso, 1 ÷ 0.0105 s ≈ 95 tokens por segundo como techo para una sola conversación.
? [medio] (La aproximación «intensidad ≈ b» viene de la sección extra del batching.) Una capa de 4,096 × 4,096 en FP16 recibe un batch de b vectores. Escribe su intensidad y encuentra el batch más chico con el que pasa el quiebre de la T4 (≈ 203.1). Compáralo con la aproximación «intensidad ≈ b».
Se usa \(I = F/D\). FLOPs: \(F = 2 × n × m × k\) con \(n\) = b, \(k = m\) = 4,096: 2 × b × 4,096 × 4,096. Bytes: \(D\) = 2 × (b × 4,096 + 4,096 × 4,096 + b × 4,096), las entradas, los pesos y las salidas. Dividiendo entre 2 × 4,096 arriba y abajo:

**intensidad \(I\) = 4,096 × b ÷ (2b + 4,096)**

Para que pase 203.1: 4,096 b ≥ 203.1 × (2b + 4,096), o sea b × (4,096 − 406.2) ≥ 203.1 × 4,096, y b ≥ 831,898 ÷ 3,689.8 ≈ 225.5. El batch más chico es **226** (comprobación: 4,096 × 226 ÷ 4,548 ≈ 203.5).

La aproximación «intensidad ≈ b» diría 204, un 10 % menos. Con batches chicos casi no importa; cerca del quiebre, las entradas y salidas ya pesan.
? [medio] (a) Si Alba pasara su ResNet-50 a INT8 y midiera 2,000 fotos por segundo por T4, ¿qué parte del pico INT8 de la T4 (130 TOPS) usaría? (b) Un proveedor jura que con la misma T4 y la misma ResNet-50 en FP16 llega a 10,000 fotos por segundo. ¿Le crees?
**(a)** Con \(u = x × F/P\): \(x × F\) = 2,000 × 8.2 × 10⁹ = 16.4 × 10¹² operaciones por segundo, contra \(P\) = 130 × 10¹²: 16.4 ÷ 130 ≈ **13 %**. Más fotos por segundo que en FP16, pero una utilización parecida: la misma T4, con las mismas esperas.

**(b)** No: \(x × F\) = 10,000 × 8.2 × 10⁹ = 82 TFLOPS, más que el pico \(P\) = 65. En FP16 es imposible. Algo cambió sin decirlo (un modelo más chico, menos resolución, INT8) o midió mal. Pide ver cómo midió.
? [reto] (Las partes c y d usan la sección extra del batching.) La ResNet-50 de Alba tiene 24.5 millones de parámetros y hace 4.1 GMACs por foto. (a) En FP16 y contando solo los pesos, ¿cuál es su intensidad a batch 1? (b) Su etapa 4 tiene 15.0 millones de pesos y hace 809 millones de MACs: ¿cuál es su intensidad a batch 1? (c) ¿Desde qué batch pasa la etapa 4 el quiebre de la T4? (d) ¿Por qué la intensidad real es menor que estas cuentas?
**(a)** Con \(I = F/D\): FLOPs \(F\) = 2 × 4.1 × 10⁹ = 8.2 × 10⁹. Bytes de pesos \(D\) = 24.5 × 10⁶ × 2 = 49 MB. Intensidad: \(I\) = 8.2 × 10⁹ ÷ (49 × 10⁶) ≈ **167 FLOPs por byte**, un poco debajo de los ≈ 203 de la T4. Es lo mismo que «cada peso se usa ≈ 167 veces»: en FP16, 2 FLOPs por uso y 2 bytes por peso se cancelan.

**(b)** En FP16, \(I\) = MACs ÷ pesos (2 FLOPs por uso y 2 bytes por peso se cancelan): 809 ÷ 15.0 ≈ **54**: casi todos los pesos de la etapa 4 se usan en las 7 × 7 = 49 posiciones de sus mapas (el promedio sube un poco porque su primera convolución todavía trabaja con mapas de 14 × 14). Memory-bound a batch 1.

**(c)** Con batch b, la intensidad por los pesos es \(I ≈ 54 × b\). Para pasar \(I_{quiebre}\) ≈ 203: b ≥ 203 ÷ 54 ≈ 3.8, así que **batch 4** (54 × 4 = 216).

**(d)** Porque las activaciones también viajan: la entrada de cada capa se lee y su salida se escribe en la VRAM. Esos bytes suman al denominador y bajan la intensidad. En las primeras etapas, con mapas de 56 × 56, las activaciones pesan mucho más que los pesos.
? [reto] En el servicio de «Un LLM propio» (sección «En la vida real»), una réplica sirve un modelo de 70.6 mil millones de parámetros en FP8 (1 byte por peso) con 2 H100, cada una con la mitad de los pesos. (a) ¿Cuál es el piso de un paso de decode por leer los pesos? (b) Con 40 conversaciones, cada GPU lee además ≈ 13.9 GB de KV cache por paso: ¿cuánto tarda el paso y cuántos tokens por segundo salen en total? (c) Para el prefill de un prompt de 2,000 tokens, ¿cuántos FLOPs son, qué intensidad tiene y cuál es su piso en FP8 (≈ 1,979 TFLOPS por H100)? ¿Por qué no tarda 2,000 pasos de decode?
**(a)** Es el reloj de la memoria, \(t_{memoria} = D/W\). Cada H100 lee su mitad, \(D\) = 70.6 GB ÷ 2 = 35.3 GB, a \(W\) = 3,350 GB/s: 35.3 ÷ 3,350 ≈ **10.5 ms**.

**(b)** Con \(t_{paso} = (D_{pesos} + b × D_{kv})/W\) y \(v_{total} = b/t_{paso}\), donde cada GPU lee \(D_{pesos}\) = 35.3 GB más \(b × D_{kv}\) ≈ 13.9 GB de KV cache, el de las 40 conversaciones: (35.3 + 13.9) GB ÷ 3,350 GB/s ≈ **14.7 ms ≈ 15 ms** por paso. Salen \(b\) = 40 tokens por paso: 40 ÷ 0.0147 s ≈ **2,700 tokens por segundo** en total, 2,700 ÷ 40 ≈ 68 por conversación. El TPOT no puede bajar de ≈ 15 ms, y el objetivo de 50 ms deja margen.

**(c)** FLOPs: 2 por parámetro y por token, \(F\) = 2 × 70.6 × 10⁹ × 2,000 ≈ **2.8 × 10¹⁴**. Cada peso de 1 byte se usa para los 2,000 tokens, 2 FLOPs cada vez: \(I = F/D\) = 2 × 2,000 ÷ 1 ≈ **4,000 FLOPs por byte**, contra \(I_{quiebre} = P/W\) de la H100 en FP8: 1,979 × 10¹² ÷ (3,350 × 10⁹) ≈ 591. Compute-bound. Piso, con \(t_{cálculo} = F/P\) y \(P\) = las dos H100 juntas: 2.8 × 10¹⁴ ÷ (2 × 1,979 × 10¹²) ≈ **71 ms**.

2,000 pasos de decode tardarían ≈ 2,000 × 10.5 ms = 21 s, porque leerían los pesos 2,000 veces. El prefill los lee una vez y usa cada byte miles de veces: ahí manda el cálculo, que la H100 tiene de sobra.
:::

## Lo que sigue {What comes next}

Sigue el módulo «La computadora por dentro», que abre con «Programa, proceso e hilo». «Memoria, caché y disco» explica por qué hay memorias de distinta velocidad y qué es una caché; «CPU y GPU» muestra cómo se reparten el trabajo sus núcleos. Más adelante, «Qué tan rápido y cuánto: latencia y throughput» junta estos tiempos mínimos con las colas, y «Máquinas, GPUs y cómo se cobran» les pone precio. En «Export, engine y paridad» conviertes la ResNet-50 de Alba en un engine de TensorRT: lo de las secciones extra «Menos bits, más velocidad» y «Por dentro de una multiplicación» hecho archivo, que corre en FP16 en los tensor cores y trae las capas fusionadas.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
matriz multiplicacion-matrices flop mac tflops intensidad-aritmetica compute-bound memory-bound roofline ancho-banda-memoria
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuántas MACs y cuántos FLOPs cuesta multiplicar una matriz de n × k por una de k × m?
n × m × k MACs, porque cada una de las n × m casillas del resultado es un producto punto de k números. Cada MAC es una multiplicación y una suma: 2 × n × m × k FLOPs.
? ¿Qué diferencia hay entre 8.2 GFLOPs y 65 TFLOPS?
El primero es una cantidad de trabajo (FLOPs, con s minúscula): lo que pide una foto a la ResNet-50. El segundo es una velocidad (FLOPS, por segundo): lo que hace una T4 como máximo. El primero entre el segundo da el tiempo mínimo, ≈ 0.126 ms.
? ¿Qué es la intensidad aritmética y contra qué se compara?
Los FLOPs que hace un cálculo por cada byte que mueve de la memoria. Se compara con el punto de quiebre de la GPU, su pico de FLOPS ÷ su ancho de banda (≈ 203 en una T4): por debajo, memory-bound; por encima, compute-bound.
? ¿Por qué el decode de un LLM es memory-bound, y cuál es su techo de tokens por segundo?
Porque cada token usa cada peso una sola vez: 2 FLOPs por cada 2 bytes, intensidad ≈ 1, cientos de veces debajo del quiebre. El techo es ancho de banda ÷ bytes de los pesos: 300 GB/s ÷ 16 GB ≈ 19 tokens por segundo para Llama 3 8B en una L4.
? ¿Por qué el batching sube la intensidad?
Porque los pesos se leen una vez y se usan para todo el batch: los FLOPs crecen con el batch y los bytes de los pesos no. Con un batch de b, la intensidad de una capa queda ≈ b, mientras los pesos sean casi todos los bytes.
? Una T4 anuncia 65 TFLOPS. ¿Por qué Alba usa solo ≈ 15 %, y por qué no es un problema?
El pico supone todos los núcleos trabajando sin parar; en la práctica la T4 baja su velocidad a 70 W, no todas las capas usan tensor cores, hay tiempo muerto y algunas capas esperan a la memoria. No es un problema: Alba dimensiona con lo medido (≈ 1,200 fotos por segundo por T4), y aun así sus 2 GPUs trabajan al ≈ 5 % en promedio (≈ 58 fotos por segundo cada una).
? ¿Una L4 genera tokens más rápido que una T4 porque tiene casi el doble de TFLOPS?
No. El decode depende del ancho de banda, y la L4 tiene 300 GB/s contra 320 de la T4. Lo que la L4 sí tiene es más VRAM (24 GB, donde cabe un modelo de 8B en BF16) y BF16, que la T4 no tiene.
:::
