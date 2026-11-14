---
titulo: Números grandes, unidades y estimaciones
en: Big numbers, units and estimates
subtitulo: Cómo escribir números enormes y diminutos sin perderte, por qué un disco de 1 TB dice 931 GB, por qué 100 megas de internet no bajan 100 MB por segundo y cómo se convierten «10 millones de fotos al día» en GPUs y dólares al mes.
pregunta: Si me dicen «10 millones de fotos al día», ¿cómo sé cuántas máquinas necesito, cuántos bytes se van a mover y cuánto va a costar?
requisitos: camino-completo
---

:::idea
Casi todas las decisiones de un sistema salen de unas pocas cuentas con números enormes o diminutos: cuántas requests llegan por segundo, cuántos bytes viajan, cuánto tarda cada paso. Si escribes esos números como potencias de diez, cuidas las unidades (bits contra bytes, KB contra KiB, por día contra por segundo) y redondeas las máquinas hacia arriba, una servilleta basta para saber si necesitas una GPU o cien.
:::

## Notación científica, órdenes de magnitud y tiempo {Scientific notation, orders of magnitude and time}

Un sistema de ML está lleno de números así. Alba, la empresa que seguimos en todo el curso, es un marketplace en línea: recibe ≈ 2.5 millones de publicaciones nuevas al día y, para cada foto, le sugiere a quien vende la categoría, entre 500 posibles. Su modelo, una ResNet-50, tiene 24,532,532 [[parametro|parámetros]]; la foto entra como 150,528 números; el modelo hace unos 4,100,000,000 de multiplicaciones por foto, y el servicio recibe 10,000,000 de fotos al día (≈ 3 por publicación, más las que piden otros equipos de Alba). También hay números diminutos: copiar la foto a la [[gpu|GPU]] tarda 0.00004 segundos. Contar ceros es lento, y un cero de menos es un error de 10 veces.

### Una cifra por una potencia de diez

La [[notacion-cientifica|notación científica]] (*scientific notation*) escribe cada número como una cifra entre 1 y 10 multiplicada por una potencia de diez:

- 10³ = 1,000 (un 1 con tres ceros), 10⁶ = 1,000,000 y 10⁹ = 1,000,000,000.
- 86,400 = 8.64 × 10⁴: el punto decimal se movió 4 lugares a la izquierda.
- 0.00004 = 4 × 10⁻⁵: el exponente negativo quiere decir que el punto se movió a la derecha. 10⁻⁵ es 1 ÷ 10⁵.

La cifra de adelante se llama **mantisa**, y el número chiquito arriba del 10, **exponente**. El exponente dice el tamaño; la mantisa, el detalle.

| Número | En notación científica | Qué es |
|---|---|---|
| 10,000,000 | 1 × 10⁷ | fotos al día en Alba |
| 24,532,532 | ≈ 2.45 × 10⁷ | parámetros de la ResNet-50 de Alba |
| 4,100,000,000 | 4.1 × 10⁹ | multiplicaciones con su suma ([[mac\|MACs]]) por foto |
| 86,400 | 8.64 × 10⁴ | segundos en un día |
| 0.2 | 2 × 10⁻¹ | la promesa de Alba, en segundos |
| 0.00004 | 4 × 10⁻⁵ | copiar la foto a la GPU, en segundos |

La ventaja aparece al hacer cuentas. Para multiplicar, se multiplican las mantisas y se **suman** los exponentes; para dividir, se dividen las mantisas y se **restan**.

:::cuenta Dos cuentas de Alba con potencias de diez
Logs de un día // 10⁷ fotos, ≈ 300 bytes de log por cada una | 1 × 10⁷ × 3 × 10² B | 3 × 10⁹ B = 3 GB
Fotos por segundo // se dividen las mantisas y se restan los exponentes | 1 × 10⁷ ÷ (8.64 × 10⁴ s) = (1 ÷ 8.64) × 10⁷⁻⁴ | ≈ 0.116 × 10³
Acomodado // con la mantisa entre 1 y 10 | 0.116 × 10³ = 1.16 × 10² | ≈ 116 por segundo
= Los exponentes se suman o se restan de memoria; solo queda una cuenta chica con las mantisas.
:::

Python y las hojas de cálculo escriben la notación científica con una **e**: `8.64e+04` quiere decir 8.64 × 10⁴ y `4e-05`, 4 × 10⁻⁵. Para escribir números largos en el código, Python acepta guiones bajos como separadores de miles: `10_000_000`.

```python
dia = 24 * 60 * 60                  # segundos en un día
print(dia, f"{dia:.2e}")            # la e quiere decir «× 10 a la»
print(10_000_000 / dia)             # 10 millones de fotos al día, por segundo
print(f"{24_532_532:.2e}", f"{0.00004:.0e}")
print(1e7 * 300 / 1e9, "GB de logs al día")
```

```salida
86400 8.64e+04
115.74074074074075
2.45e+07 4e-05
3.0 GB de logs al día
```

### Órdenes de magnitud

El [[orden-magnitud|orden de magnitud]] (*order of magnitude*) de un número es la potencia de diez más cercana: 86,400 es «del orden de 10⁵». Dos cosas que difieren en un orden de magnitud están a unas 10 veces una de otra; en tres órdenes, a unas mil veces.

Para redondear se mira la mantisa: si es menor que √10 ≈ 3.16, el orden es su potencia; si es mayor, la siguiente. Así, 2.45 × 10⁷ es del orden de 10⁷ y 8.64 × 10⁴, del orden de 10⁵. El corte va en 3.16 y no en 5 porque, en una escala que avanza multiplicando por 10, 3.16 queda justo a la mitad: 1 × 3.16 ≈ 3.16 y 3.16 × 3.16 ≈ 10.

Hay otra costumbre: llamar orden de magnitud solo al exponente, sin redondear. Con ella, 86,400 es del orden de 10⁴. Las dos se usan; en esta lección, la potencia más cercana.

¿Por qué importa? Porque en un diseño las decisiones cambian por órdenes de magnitud. Dicho de otro modo: si te equivocas por 2 veces y la decisión no cambia, no importa; si te equivocas por 10, pasas de «un par de máquinas» a «un cluster». Una [[estimacion|estimación]] de servilleta no busca decimales: busca atinarle al orden de magnitud.

### Los prefijos: kilo, mega, giga

Para no escribir la potencia cada vez, el Sistema Internacional de unidades (SI) le pone nombre a cada salto de mil:

| Prefijo | Símbolo | Vale | Ejemplo |
|---|---|---|---|
| kilo | k | 10³ | 1 km = 1,000 m |
| mega | M | 10⁶ | una foto de 12 MP tiene 12 millones de píxeles |
| giga | G | 10⁹ | 4.1 GMACs por foto |
| tera | T | 10¹² | una T4 hace ≈ 65 TFLOPS en float16 |
| peta | P | 10¹⁵ | un mes de audio sin comprimir de un servicio de subtítulos en vivo: ≈ 1.7 PB |
| mili | m | 10⁻³ | la promesa de 200 ms |
| micro | µ | 10⁻⁶ | copiar la foto: 40 µs |
| nano | n | 10⁻⁹ | leer la RAM: 100 ns |

(El SI escribe el kilo con k minúscula; en computación casi siempre vas a ver KB, y así lo escribe este curso.) En ML vas a ver además letras sueltas: «25.6 M parámetros» (la ResNet-50 original, la de 1,000 categorías) son 25.6 millones, «5k fotos» son 5 mil y un LLM «de 8B» tiene 8 *billion*: **8 mil millones**.

:::ojo Un billón no es un billion
En español, un billón es un millón de millones, 10¹²; en inglés, *billion* es mil millones, 10⁹. Un modelo «de 8B», como Llama 3 8B, tiene ≈ 8 × 10⁹ parámetros: leerlo como «8 billones» es equivocarse por mil. Y *trillion* es nuestro billón.
:::

### El tiempo: de nanosegundos a días

El tiempo se mide en segundos, y casi todo lo interesante de una computadora pasa en pedacitos de segundo. Los tres que vas a usar siempre:

- **Milisegundo** ([[ms]]): una milésima de segundo, 10⁻³ s. Es la unidad de la red y de los modelos: la promesa de Alba es que el [[p99]] quede en 200 ms o menos, es decir, que 99 de cada 100 requests tarden 200 ms o menos.
- **Microsegundo** (µs): una millonésima, 10⁻⁶ s. La µ es la letra griega «mu»; cuando no se puede escribir, se pone `us`. Es la escala de copiar datos y de leer un disco rápido.
- **Nanosegundo** (ns): una milmillonésima, 10⁻⁹ s. Es la escala de lo que pasa dentro del chip.

Cada uno es mil veces el siguiente: 1 s = 1,000 ms = 1,000,000 µs = 10⁹ ns. Para convertir, cuenta cuántos saltos de mil das: 200 ms = 0.2 s; 40 µs = 0.04 ms; 100 ns = 0.1 µs.

:::figura unidades-tiempo
El tiempo en una regla de potencias de diez, del nanosegundo al día. Entre leer la RAM y la promesa de 200 ms hay más de seis marcas: más de un millón de veces.
:::

La regla muestra lo que los números sueltos esconden: cosas que «son rápidas» pueden estar a miles de veces una de otra. Leer la [[ram|RAM]], la memoria de trabajo de la computadora (≈ 100 ns), contra la promesa de Alba (200 ms) es 0.2 ÷ 10⁻⁷ = 2 × 10⁶: dos millones de veces. Por eso, cuando un servicio tarda, rara vez es por una suma de más en el código: suele ser la espera por la red, el disco o la GPU, que viven varias marcas más abajo.

### Los números del reloj

Para los números grandes de tiempo, este curso usa siempre los mismos:

:::cuenta Los números del reloj que vas a usar siempre
Un día | 24 × 60 × 60 | 86,400 s
El atajo para la cabeza // el día real es 13.6 % más corto | 86,400 ÷ 100,000 | 0.864
Un mes, para costos // un año repartido en 12: ≈ 30.4 días | 365 × 24 ÷ 12 | 730 h
Un mes, para disponibilidad // 30 días exactos | 30 × 24 × 60 | 43,200 min
Un año // 31,536,000 s | 365 × 86,400 | ≈ 3.15 × 10⁷ s
= Un día ≈ 10⁵ s, un mes ≈ 2.6 × 10⁶ s y un año ≈ π × 10⁷ s: con tres números redondos sale casi cualquier cuenta de tiempo.
:::

¿Por qué dos meses? Las nubes dan el precio de sus máquinas por hora, y un mes promedio del año tiene 8,760 ÷ 12 = 730 horas: **costo al mes = precio por hora × 730**. Las promesas de [[disponibilidad]] (qué parte del tiempo funciona bien el servicio), en cambio, suelen contarse en ventanas de 30 días, 43,200 minutos, para que todas las ventanas valgan igual; así las cuenta Alba. Entre 730 h y 720 h hay 1.4 %: no cambia ninguna decisión, pero en una misma cuenta se usa uno solo.

:::ojo El atajo, para la cabeza; 86,400, para el número final
10 M ÷ 10⁵ = 100 req/s, pero el número real es 116: el atajo se queda 13.6 % abajo. Para explorar sirve; para comprar máquinas, usa 86,400.
:::

## Bits, bytes, KB y KiB {Bits, bytes, KB and KiB}

### Un bit y un byte

Una computadora guarda todo como interruptores prendidos o apagados (en la práctica son cargas eléctricas o puntos magnetizados, pero cada uno vale solo 0 o 1). Cada uno es un [[bit]] (*binary digit*): un 0 o un 1. Con un bit hay 2 posibilidades; con dos, 4 (00, 01, 10 y 11); con n bits, 2ⁿ. Ocho bits forman un [[byte]], y en ellos caben 2⁸ = 256 valores: del 0 al 255.

¿Te suena «del 0 al 255»? Es justo lo que guarda un canal de un [[pixel|píxel]] en [[uint8]]: un byte. Un número en [[float32]] ocupa 4 bytes, 32 bits. Cómo se escriben los números con ceros y unos (el sistema [[binario]]) lo verás en «Cómo guarda números una computadora»; aquí basta con contar.

:::cuenta La foto de Ana, en bytes y en bits
Números de la foto | 3 × 224 × 224 | 150,528
En uint8 // 1 byte por número | 150,528 × 1 B | 150,528 B ≈ 150 KB
En float32 // 4 bytes por número | 150,528 × 4 B | 602,112 B ≈ 602 KB
En bits | 602,112 × 8 | 4,816,896 bits ≈ 4.8 Mb
= El mismo tensor son 602 KB o 4.8 Mb: un factor de 8 que depende de una sola letra.
:::

**b minúscula es bit y B mayúscula es byte.** 1 Mb (megabit) es 8 veces más chico que 1 MB (megabyte). Y aquí vive la trampa más común de todas: las velocidades de red se anuncian en **bits por segundo**, y los archivos se miden en **bytes**.

- Un plan de internet de «100 megas» es de 100 Mb/s: 100 ÷ 8 = **12.5 MB por segundo**. Un archivo de 1 GB tarda ≈ 80 s, no 10.
- 1 Gb/s (un gigabit por segundo) son 125 MB/s, y 1 GB/s son 8 Gb/s.

Lo que un canal puede mover por segundo es su [[ancho-banda|ancho de banda]]; tiene su propia sección más abajo.

### Del byte al petabyte

Con los bytes pasa lo mismo que con el tiempo: lo que maneja un sistema de ML ocupa 15 órdenes de magnitud.

:::figura unidades-bytes
Lo que ocupa cada cosa, del byte al petabyte. En verde, las piezas más chicas; en azul, la foto de Ana y su viaje; en ámbar, lo que Alba guarda; en naranja, el modelo y la GPU; en violeta, ejemplos de otros sistemas: el buscador con embeddings y el audio de unos subtítulos en vivo.
:::

Del log de una predicción (≈ 300 B) a un año de logs de Alba (1.1 TB) hay casi diez marcas: ≈ 3.65 × 10⁹ veces, que son justo sus predicciones de un año (10 M al día × 365). Un atajo útil para estas cuentas: **1 millón de cosas de 1 KB son 1 GB**, porque 10⁶ × 10³ = 10⁹. Con él, 10 M logs de 300 B son 10 × 0.3 = 3 GB sin hacer la cuenta larga.

### KB contra KiB: los dos kilos

Con la memoria pasó algo raro. Las computadoras cuentan en potencias de 2, y 2¹⁰ = 1,024 se parece mucho a mil. Así que, durante décadas, «un kilobyte» quiso decir 1,000 bytes o 1,024 según quién hablara. Con los kilos la diferencia era de 2.4 %; con los gigas y los teras ya no es poca cosa.

En diciembre de 1998, la Comisión Electrotécnica Internacional (IEC), que fija estándares eléctricos y electrónicos, separó los nombres. Los [[prefijo-binario|prefijos binarios]] llevan una i: **kibi** (KiB), **mebi** (MiB), **gibi** (GiB), **tebi** (TiB) y **pebi** (PiB).

| Decimal (SI) | Bytes | Binario (IEC) | Bytes | El binario es más grande por |
|---|---|---|---|---|
| 1 KB | 1,000 | 1 KiB | 2¹⁰ = 1,024 | 2.4 % |
| 1 MB | 10⁶ | 1 MiB | 2²⁰ = 1,048,576 | 4.9 % |
| 1 GB | 10⁹ | 1 GiB | 2³⁰ = 1,073,741,824 | 7.4 % |
| 1 TB | 10¹² | 1 TiB | 2⁴⁰ = 1,099,511,627,776 | 10.0 % |
| 1 PB | 10¹⁵ | 1 PiB | 2⁵⁰ ≈ 1.126 × 10¹⁵ | 12.6 % |

:::figura unidades-prefijos
Las tres ideas de esta sección. Arriba, un byte por dentro: cada casilla vale el doble que la de su derecha, y el número es la suma de las prendidas. En medio, cuánto más grande es cada prefijo binario que el decimal. Abajo, el mismo disco de 1 TB medido con las dos reglas.
:::

¿Quién usa cuál?

- **Decimal:** los fabricantes de [[disco|discos]], las velocidades de red y macOS (desde 2009).
- **Binario:** la RAM (un módulo «de 16 GB» trae 16 GiB), AWS al describir la memoria de sus máquinas (una g4dn.xlarge, la máquina con una T4 que usa Alba, trae 16 GiB), Windows (que escribe «GB» pero divide entre 2³⁰), `df -h` en Linux, `nvidia-smi` y PyTorch.

:::cuenta Un disco de 1 TB, visto por Windows
Lo que vende el fabricante | 1 TB = 10¹² bytes | 1,000,000,000,000 B
Lo que muestra Windows // divide entre un GiB, aunque escriba «GB» | 10¹² ÷ 2³⁰ | ≈ 931.3
En TiB | 10¹² ÷ 2⁴⁰ | ≈ 0.909
= El disco trae los bytes que prometió; cambió la regla con la que se miden. Nadie se quedó con 69 GB.
:::

:::calculadora unidades-datos
Prueba 64 con prefijo giga: la memoria USB «de 64 GB» que Windows muestra como ≈ 59.6. Después escribe 15,360 con prefijo mega y binario: los MiB que `nvidia-smi` reporta para una T4 (de sus 16 GiB, una parte se reserva para corregir errores). Son ≈ 16.1 GB.
:::

El mismo trabajo, en Python. Fíjate en que `2**30` y `10**9` son exactos: así no hay redondeos escondidos.

```python
# Las dos maneras de contar bytes, y los bits
KB, MB, GB, TB = 10**3, 10**6, 10**9, 10**12      # decimales (SI)
KiB, MiB, GiB, TiB = 2**10, 2**20, 2**30, 2**40   # binarios (IEC)

disco = 1 * TB
print(f"1 TB = {disco:,} bytes = {disco / GiB:.1f} GiB = {disco / TiB:.3f} TiB")

tensor = 3 * 224 * 224 * 4          # la foto de Alba en float32
print(f"tensor: {tensor:,} B = {tensor / KB:.0f} KB = {tensor / KiB:.0f} KiB")
print(f"        {tensor * 8:,} bits")

for nombre, dec, bina in [("kilo", KB, KiB), ("mega", MB, MiB),
                          ("giga", GB, GiB), ("tera", TB, TiB)]:
    print(f"{nombre}: el binario es {100 * (bina / dec - 1):.1f} % más grande")
```

```salida
1 TB = 1,000,000,000,000 bytes = 931.3 GiB = 0.909 TiB
tensor: 602,112 B = 602 KB = 588 KiB
        4,816,896 bits
kilo: el binario es 2.4 % más grande
mega: el binario es 4.9 % más grande
giga: el binario es 7.4 % más grande
tera: el binario es 10.0 % más grande
```

## Ancho de banda: Gb/s contra GB/s {Bandwidth: Gb/s vs GB/s} [extra]

El [[ancho-banda|ancho de banda]] (*bandwidth*) es cuántos datos puede mover un canal por segundo: una red, un disco, el cable entre el [[cpu|CPU]] y la GPU, la memoria. Tiene dos costumbres de unidades:

- **La red se mide en bits por segundo:** Mb/s y Gb/s, con prefijos decimales. 1 Gb/s = 10⁹ bits por segundo.
- **La memoria, los discos y el bus de la GPU, en bytes por segundo:** GB/s.

Entre las dos hay un 8. Lo primero en cualquier cuenta es pasar todo a la misma unidad.

### Cuánto tarda en llegar algo grande

El tiempo de mandar algo es **su tamaño entre el ancho de banda**, con las unidades parejas.

:::formula Tiempo de transferencia
t = frac{S}{B}
- S: el tamaño de lo que mandas, en bits o en bytes
- B: el ancho de banda del canal, en la **misma** unidad por segundo: si \(B\) está en Gb/s, pasa \(S\) a gigabits (× 8 si venía en bytes)
- t: cuánto tarda en pasar todo, en segundos, en el mejor caso
:::

:::ejemplo La imagen de Triton y los pesos del modelo
La imagen de Docker del servidor Triton (el paquete de su [[contenedor]]) pesa del orden de 10 GB comprimida, que es como viaja. Por una red de 1 Gb/s: \(S\) = 10 GB × 8 = 80 Gb, y \(t = S/B\) = 80 Gb ÷ 1 Gb/s = **80 s**. Por una de 10 Gb/s, 80 ÷ 10 = 8 s. Es parte de por qué una máquina nueva tarda en estar lista: antes de responder la primera foto tiene que bajar esos bytes.

Los pesos de la ResNet-50 de Alba en float32 son ≈ 98 MB (24.5 M parámetros × 4 bytes). Por la red de 1 Gb/s: 98 MB × 8 = 784 Mb, y 784 Mb ÷ 1,000 Mb/s ≈ 0.8 s. Por [[pcie|PCIe]], el bus que une la CPU con la GPU (≈ 16 GB/s): 98 MB ÷ 16,000 MB/s ≈ 6 ms. Leídos de la [[vram|VRAM]] de una T4 (320 GB/s): 98 MB ÷ 320,000 MB/s ≈ 0.3 ms.
:::

Cada canal vive en otro orden de magnitud. En la tabla hay dos máquinas de AWS: la c6i.xlarge, sin GPU, es la del gateway de Alba, y la g4dn.xlarge trae la T4. «Sostenida» es lo que aguantan todo el tiempo; el «hasta» del catálogo es varias veces más, pero solo dura un rato (de 5 a 60 minutos, según el tamaño de la máquina). El tensor de 602 KB de Alba (4.8 Mb), por cada canal, con \(t = S/B\):

| Canal | Ancho de banda \(B\) | Mover 602 KB: \(t = S/B\) |
|---|---|---|
| La subida de un celular (un ejemplo) | 10 Mb/s | ≈ 0.48 s |
| La red de una c6i.xlarge, sostenida | ≈ 1.56 Gb/s | ≈ 3.1 ms |
| La red de una g4dn.xlarge, sostenida | ≈ 5 Gb/s | ≈ 1 ms |
| PCIe de la T4 | ≈ 16 GB/s | ≈ 40 µs |
| La VRAM de una T4 | 320 GB/s | ≈ 1.9 µs |
| La VRAM de una H100 | 3.35 TB/s | ≈ 0.18 µs |

Del celular a la memoria de una H100 hay más de seis órdenes de magnitud. Los números de las máquinas salen de las tablas de AWS y de NVIDIA; la memoria de la GPU tiene su propia historia en «Matrices, FLOPs y qué tan rápido calcula una GPU» ([[ancho-banda-memoria]]).

### Ancho de banda no es latencia

:::analogia Una camioneta llena de discos
Imagina una camioneta con 100 discos duros de 20 TB que maneja 10 horas hasta otro centro de datos. Lleva 2 PB, así que su «ancho de banda» es 2 × 10¹⁵ × 8 bits ÷ 36,000 s ≈ 440 Gb/s, más que casi cualquier red. Pero el primer byte llega a las 10 horas: su [[latencia]] es pésima. Andrew Tanenbaum, autor de un libro clásico de redes, ya lo decía con una camioneta llena de cintas, y hay nubes que de verdad mudan petabytes mandando discos por paquetería.

**Dónde se rompe:** una red manda un flujo continuo y el primer byte llega en milisegundos; la camioneta es todo o nada. Pero la idea sirve: el ancho de banda dice cuánto cabe por segundo y la latencia, cuánto tarda en llegar lo primero. Son dos números distintos, y un canal puede tener uno bueno y el otro malo.
:::

La latencia tiene además un piso físico. En 1 ns la luz avanza unos 30 cm, y dentro de una fibra óptica, unos 20: 100 km de fibra son ≈ 0.5 ms de ida y otro tanto de vuelta. De ahí sale una regla práctica: **≥ 1 ms de ida y vuelta por cada 100 km**. Más ancho de banda no la baja; solo acercarse.

### La red de Alba

En una entrevista de diseño, la cuenta de la red no va en los primeros cinco minutos: se deja para cuando el entrevistador pide profundizar. Pero es la que distingue a quien la hace. El ancho de banda que hace falta es \(B = R × S\): cuántas cosas pasan por segundo, \(R\), por lo que pesa cada una, \(S\).

:::cuenta Lo que viaja del gateway a las GPUs en Alba
Tensor por foto, \(S\) // 150,528 números en float32 | 150,528 × 4 B | 602,112 B ≈ 602 KB
En el pico de diseño // \(R\) = 500 fotos por segundo, el tráfico para el que Alba compra máquinas (de dónde sale, más abajo) | \(B = R × S\) = 500 × 602 KB | ≈ 301 MB/s
En bits por segundo | 301 MB/s × 8 | ≈ 2.4 Gb/s
Por nodo del gateway // Alba tiene dos, uno en cada zona | 2.4 ÷ 2 | ≈ 1.2 Gb/s
Contra lo que sostiene una c6i.xlarge // ≈ 1.56 Gb/s, de la tabla de arriba | 1.2 ÷ 1.56 | ≈ 77 %
Mandando uint8 en vez de float32 // 1 byte por número: 4 veces menos | 2.4 ÷ 4 | ≈ 0.6 Gb/s
= En el gateway, la red se aprieta antes que la CPU, que en cada nodo va al ≈ 40 % (500 fotos/s × ≈ 0.006 s de CPU por foto = 3 [[vcpu|vCPU]] ocupados, de los 8 que suman sus dos nodos: 3 ÷ 8 = 37.5 %). Mandar la foto en uint8 y normalizar ya dentro del modelo divide el tráfico entre 4.
:::

Los bytes también cuestan dinero. En un mes de costos (30.4 días) viajan 602 KB × 10 M × 30.4 ≈ 183 TB de tensores. En AWS, pasar datos de una zona a otra cuesta ≈ US$0.01 por GB en cada sentido; si la mitad de ese tráfico cruzara de zona, serían ≈ 91,500 GB × US$0.02 ≈ **US$1,830 al mes**, más que las dos GPUs (≈ US$768). Por eso Alba manda cada request a la GPU de su misma zona.

:::diagrama unidades-viaje
Toca cada caja para ver sus números y usa «Recorrer» para seguir la foto. Cada tramo tiene su unidad: KB y Mb/s afuera, Gb/s en la red interna, GB/s y µs hacia la GPU, ms en el cálculo.
:::

El video es el caso extremo. Piensa en un sistema de video en tiempo real, con cámaras que mandan 1080p a 15 [[fps]] (supuesto del ejemplo). Un cuadro sin comprimir pesa 1,920 × 1,080 × 3 ≈ 6.2 MB; 15 por segundo son ≈ 93 MB/s, ≈ 0.75 Gb/s por cámara. Comprimido con H.264, el formato más común, viaja a ≈ 4 Mb/s: unas 190 veces menos. Por eso el video viaja comprimido y se descomprime junto al modelo.

## De eventos por día a requests por segundo {From events per day to requests per second}

Los negocios hablan por día («recibimos 10 millones de fotos al día»); las máquinas trabajan por segundo. Esta sección es el puente.

### Throughput y QPS

El [[throughput]] es cuánto trabajo termina un sistema por unidad de tiempo: requests por segundo, fotos por segundo, tokens por segundo. No es lo mismo que la [[latencia]], que es cuánto tarda **una** request: un servicio puede atender 500 por segundo aunque cada una tarde 50 ms, porque atiende muchas a la vez.

Para un servicio que responde requests, el throughput se dice en **req/s** o [[qps|QPS]] (*queries per second*, consultas por segundo; el nombre viene de los buscadores). La cuenta base es una división: \(R_{prom} = E ÷ 86,400\), los eventos al día \(E\) entre los segundos de un día.

Un número para memorizar: **1 millón al día ≈ 11.6 por segundo** (10⁶ ÷ 86,400 = 11.57). Con él, 10 M al día son ≈ 116 por segundo y 100 M, ≈ 1,157. «Un millón al día» suena a muchísimo; «doce por segundo», a poco. Las dos frases dicen lo mismo.

### El promedio esconde el pico

Nadie sube fotos a las 4 de la mañana como a las 8 de la noche. Si Alba recibiera sus 10 millones de fotos al día parejas, llegarían 116 por segundo a toda hora. No es así:

:::figura unidades-dia
Un día ilustrativo de Alba: cada barra es una hora. Entre todas suman los 10 M de fotos; la más alta, a las 20 h, lleva 1/8 del día.
:::

El [[factor-pico|factor de pico]] (*peak factor*) es el pico dividido entre el [[promedio]]: cuántas veces el promedio llega en el momento de más tráfico. Hay una forma sencilla de estimarlo: si la hora pico lleva una fracción *f* del tráfico del día, el factor es **24 × f**. Con 1/8 (12.5 %), 24 × 1/8 = 3. Con 10 %, 2.4; con 20 %, 4.8. En apps que usan personas en una sola zona horaria suele estar entre 2 y 5; en un proceso automático que trabaja parejo día y noche, cerca de 1.

Al pico se le agrega un **margen de diseño** (de 1.3 a 1.5 veces) para lo que no sabes: picos de unos minutos, crecimiento del negocio, el error de tu propia estimación. El resultado se redondea hacia arriba a un número fácil de decir. Ese es el **pico de diseño**, para el que se compran las máquinas. Las tres cuentas juntas:

:::formula Del día al pico de diseño
R_{prom} = frac{E}{86,400}
k = 24 × f
R_{pico} = k × R_{prom}
R_{diseño} = m × R_{pico}
- E: los eventos (fotos, requests) que llegan en un día
- R_{prom}: el promedio, en req/s; 86,400 son los segundos de un día
- f: la fracción del tráfico del día que llega en la hora pico: 1/8 si esa hora lleva 12.5 %
- k: el factor de pico, cuántas veces el promedio llega en la hora pico (24 horas × \(f\))
- R_{pico}: el pico de un día normal, en req/s
- m: el margen de diseño, de 1.3 a 1.5
- R_{diseño}: el pico de diseño, en req/s: un número redondo, hacia arriba
:::

:::cuenta De fotos al día a pico de diseño en Alba
Promedio \(R_{prom}\) // \(E\) = 10 M fotos al día, dato de Alba | \(E ÷ 86,400\) = 10,000,000 ÷ 86,400 | ≈ 116 req/s
Factor de pico \(k\) // supuesto: la hora pico lleva \(f\) = 1/8 del día | \(24 × f\) = 24 × 1/8 | 3
Pico \(R_{pico}\) | \(k × R_{prom}\) = 3 × 116 | ≈ 350 req/s
Pico de diseño \(R_{diseño}\) // margen \(m\) ≈ 1.4, y hacia arriba a un número redondo | \(m × R_{pico}\) = 1.4 × 350 ≈ 490 | 500 req/s
= Alba diseña su sistema para 500 req/s. El promedio de 116 es el que paga la factura: lo que se cobra por volumen (logs, red, cada predicción) sigue al promedio, y la mayor parte del día las máquinas trabajan muy por debajo de lo que pueden.
:::

:::calculadora unidades-por-dia
Pon factor 1 y margen 1.3: el tráfico parejo de un proceso automático. Después prueba 50 millones al día con factor 3: las de un buscador con 50 M de búsquedas al día (supuesto del ejemplo), ≈ 1,740 por segundo en el pico (el curso lo redondea a 1,750).
:::

## Cuántas máquinas y cuánto cuestan {How many machines, and what they cost}

Con el pico de diseño ya se pueden contar máquinas. Hacen falta dos números más.

### Capacidad medida y utilización objetivo

La **capacidad** de una máquina es cuántas requests por segundo aguanta cumpliendo la promesa de latencia. No se adivina: se mide con una **prueba de carga** (*load test*), mandándole cada vez más tráfico hasta que la latencia se pasa del límite. Para una T4 que sirve la ResNet-50 de Alba ya optimizada, el equipo de Alba midió ≈ 1,200 fotos por segundo. En una entrevista es una estimación; en el trabajo, es lo primero que se mide.

Además, no se planea al 100 %. Cerca del límite, las requests empiezan a esperar en cola y la latencia se dispara; y si llega un pico, hace falta aire mientras se encienden más máquinas. Por eso se fija una **utilización objetivo** de ≈ 50 a 70 %. Alba planea al 50 %: cada T4 cuenta por 1,200 × 0.5 = **600** fotos por segundo.

### Siempre hacia arriba, y una de repuesto

:::formula Cuántas máquinas
M = ⌈frac{R_{diseño}}{c × u}⌉ + s
- R_{diseño}: el pico de diseño, en req/s
- c: la capacidad **medida** de una máquina, en req/s (de la prueba de carga)
- u: la utilización objetivo, como fracción: 0.5 para 50 %
- c × u: la capacidad planeada de cada máquina, en req/s
- s: las máquinas de repuesto: 1 para N+1
- M: las máquinas que pides, en total
:::

Los corchetes ⌈ ⌉ quieren decir [[ceil|redondear hacia arriba]]: ⌈0.83⌉ = 1 y ⌈2.1⌉ = 3. Media máquina no existe, y la fracción que falta es tráfico sin atender. El repuesto es **N+1**: si necesitas N máquinas, pones una más, en otra zona de disponibilidad (otro centro de datos de la misma región, a algunos kilómetros del primero), para que la caída de una no se note. Es la forma más simple de [[redundancia]].

Ojo con las tres formas de redondear de Python:

```python
import math

pico, por_maquina = 500, 1200 * 0.5      # req/s de diseño y capacidad planeada
x = pico / por_maquina
print(x, math.floor(x), round(x), math.ceil(x))

pico = 1250                              # con más tráfico
x = pico / por_maquina
print(x, math.floor(x), round(x), math.ceil(x))
print(round(2.5), round(3.5))            # ¡ojo!: round va al par más cercano
```

```salida
0.8333333333333334 0 1 1
2.0833333333333335 2 2 3
2 4
```

`floor` (hacia abajo) daría cero máquinas para Alba. `round` (al más cercano) acierta con 0.83, pero con 2.08 pide 2 cuando hacen falta 3, y con 2.5 da 2, porque Python redondea los empates al número par. Para capacidad, solo `math.ceil`.

### El costo al mes

Las nubes dan el precio de las máquinas por hora (aunque muchas cobran por segundo), así que el costo de tenerlas encendidas todo el mes es \(G = M × h × 730\): las máquinas \(M\), por el precio por máquina y hora \(h\) en US$, por las 730 horas de un mes. \(G\) sale en US$ al mes.

:::cuenta Cuántas T4 necesita Alba, y cuánto cuestan
Capacidad planeada por T4 \(c × u\) // \(c\) = 1,200 fotos/s medidas, \(u\) = 0.5 | 1,200 × 0.5 | 600 fotos/s
Por tráfico // \(R_{diseño}\) = 500 req/s, de la cuenta de arriba | \(⌈R_{diseño} ÷ (c × u)⌉\) = ⌈500 ÷ 600⌉ = ⌈0.83⌉ | 1
Con repuesto, \(M\) // \(s\) = 1: N+1, una en cada zona | 1 + 1 | 2 T4
Una, todo el mes // \(h\) = US$0.526: precio de lista aproximado de una g4dn.xlarge (on demand, en us-east-1) | \(h × 730\) = US$0.526 × 730 h | ≈ US$384
Las dos, \(G\) | \(G = M × h × 730\) = 2 × US$384 | ≈ US$768 al mes
Carga promedio de cada una // \(R_{prom}\) = 116 req/s repartidas entre las 2, contra su máximo medido \(c\) | \((R_{prom} ÷ M) ÷ c\) = (116 ÷ 2) ÷ 1,200 | ≈ 5 %
= Una GPU alcanza para el tráfico; la segunda la pide la disponibilidad. Y en promedio las dos trabajan al 5 %: es la primera pregunta de costo que te van a hacer.
:::

:::calculadora unidades-maquinas
Quita el repuesto (0) y mira la carga «si se cae una»: no queda ninguna. Luego sube el pico a 1,250: son 2.08 máquinas, que se vuelven 3.
:::

Los precios de la nube cambian y dependen de la región: dalos como orden de magnitud y di que los verificas.

## Por ciento contra puntos porcentuales {Percent and percentage points} [extra]

Los porcentajes están en todas partes: la utilización de una GPU, la accuracy de un modelo, la disponibilidad de un servicio. Y se prestan a tres confusiones.

### Por ciento: siempre «de qué»

Un por ciento es una parte de cien, y siempre es parte de algo. «Cada GPU de Alba trabaja al 5 %» es cierto contra su máximo medido (58 de 1,200 fotos por segundo: sus 116 de promedio entre 2 GPUs); contra la capacidad planeada (600) es ≈ 10 %. Un porcentaje sin su base no dice nada.

### Puntos porcentuales

Cuando un porcentaje cambia, hay dos maneras de decir cuánto:

- **La resta:** \(p_2 − p_1\), si el porcentaje pasa de \(p_1\) a \(p_2\). De 85 % a 87 % son 87 − 85 = **2 [[punto-porcentual|puntos porcentuales]]** (*percentage points*, pp).
- **El cambio relativo:** \((p_2 − p_1)/p_1\). 2 ÷ 85 ≈ **2.4 %** más.

Y si miras los errores, que son los que sufre quien recibe una sugerencia mala, bajaron de 100 − 85 = 15 % a 100 − 87 = 13 %: con la misma cuenta relativa, 2 ÷ 15 ≈ **13 % menos**. El mismo cambio, tres números distintos. Ninguno está mal; lo malo es no decir cuál.

El gate de Alba, el examen que tiene que pasar un modelo nuevo antes de salir, está escrito en puntos: el modelo nuevo no puede quedar más de 0.3 puntos abajo del actual en el [[golden-set|golden set]]. Si el actual saca 96 % de top-5, el nuevo pasa con 95.7 % y no pasa con 95.6 %. Si alguien lo leyera como «0.3 % de 96», el límite sería 95.712: otra regla.

### Los nueves

La [[disponibilidad]] es el porcentaje del tiempo (o de las requests) en que el servicio funciona bien. Se dice en «[[nueves]]»: 99.9 % son «tres nueves». La cuenta de cuánto puede fallar es:

:::formula Caída permitida
D = (1 − A) × T
- A: la disponibilidad prometida, como fracción: 0.999 para 99.9 %
- T: la duración de la ventana, en minutos (o en requests, si la promesa se cuenta en requests)
- D: lo que el servicio puede fallar en esa ventana, en la misma unidad que \(T\)
:::

:::cuenta Cuánta caída permite cada nueve en un mes de 30 días
La ventana \(T\) | 30 × 24 × 60 | 43,200 min
99 % // dos nueves: \(1 − A\) = 0.01 | \(D = (1 − A) × T\) = 0.01 × 43,200 | 432 min = 7.2 h
99.9 % // tres nueves, la promesa de Alba | 0.001 × 43,200 | 43.2 min
99.99 % // cuatro nueves | 0.0001 × 43,200 | ≈ 4.3 min
= De 99.9 % a 99.99 % son solo 0.09 puntos porcentuales, pero el margen para fallar se divide entre 10. Cada nueve de más deja 10 veces menos aire.
:::

Si tomas el mes de 730 h, el de los costos, \(T\) = 43,800 min y salen 7.3 h, 43.8 min y 4.4 min: es la diferencia de 1.4 % entre los dos meses, no un error.

Contada en requests, la promesa de Alba deja fallar 0.1 % de ≈ 300 M al mes (10 M al día × 30 días): \(D\) = 0.001 × 300 M = 300,000 fotos sin sugerencia, que reciben el selector de categorías. Ese presupuesto para fallar se llama [[error-budget|error budget]].

### Veces, «por ciento más» y el interés compuesto

- **«3 veces el promedio»** es multiplicar por 3. **«300 % más»** es sumarle el 300 %: multiplicar por 4. En español, «tres veces más» se usa para las dos cosas; para no dudar, di «el triple» o «× 3».
- **Crecer 10 % al mes** no es crecer 120 % en un año. Cada mes crece sobre lo que ya creció: \((1 + g)^n\) con \(g\) = 0.10 y \(n\) = 12 meses, 1.1¹² ≈ 3.14 veces, no 2.2. Un atajo, la **regla del 72**: algo que crece g % por periodo se duplica cada ≈ 72 ÷ g periodos. Con 10 % al mes, cada ≈ 7.2 meses.

## Alba en una servilleta: la estimación completa {Alba on a napkin: the full estimate}

Ya tienes todas las piezas. En una entrevista de diseño, uno de los primeros pasos son estas cuentas: cinco minutos, números redondos y una decisión por número. Esta es la de Alba, con las letras de las fórmulas de arriba.

:::pasos
1. Escribe lo que te dan y lo que supones
≈ 2.5 M publicaciones × ≈ 3 fotos = 7.5 M, más ≈ 2.5 M que piden otros equipos (moderación, búsqueda): \(E\) ≈ 10 M fotos al día, una por request. Dilo en voz alta: es un supuesto.
2. Pásalo a por segundo
\(R_{prom} = E ÷ 86,400\) = 10,000,000 ÷ 86,400 ≈ 116 req/s de promedio.
3. Del promedio al pico y al diseño
\(R_{pico} = k × R_{prom}\) = 3 × 116 ≈ 350 req/s, con \(k\) = 24 × 1/8 = 3 si la hora pico lleva 1/8 del día. \(R_{diseño} = m × R_{pico}\) = 1.4 × 350 ≈ 490, y hacia arriba: 500 req/s.
4. Cuenta las máquinas
\(M = ⌈R_{diseño} ÷ (c × u)⌉ + s\) = ⌈500 ÷ (1,200 × 0.5)⌉ + 1 = 1 + 1 = 2 T4.
5. Revisa que el modelo quepa
Pesos = parámetros × bytes por número: 24.5 M × 2 bytes en float16 ≈ 49 MB, en una GPU de 16 GB: sobra.
6. Ponle precio
\(G = M × h × 730\) = 2 × US$0.526 la hora × 730 h ≈ US$768 al mes de GPUs.
7. Cuenta lo que se queda guardado
Log al día = \(E\) × bytes por log = 10 M × 300 B = 3 GB al día; × 365 ≈ 1.1 TB al año. Las fotos serían 10 M × 200 KB = 2 TB **al día**: por eso se guarda solo una referencia a cada una.
:::

:::diagrama unidades-estimacion
Toca cada caja para ver de dónde sale su número y usa «Recorrer» para hacer la servilleta paso a paso. Cada flecha es una multiplicación o una división.
:::

La misma servilleta en Python, con los números de Alba:

```python
import math

# La servilleta de Alba
fotos_dia = 10_000_000               # ≈ 2.5 M publicaciones × 3 fotos + otros equipos
promedio  = fotos_dia / 86_400       # req/s
pico      = promedio * 3             # la hora pico lleva 1/8 del día
diseno    = 500                      # pico × ≈ 1.4, redondeado hacia arriba
por_gpu   = 1_200 * 0.5              # medido × utilización objetivo
gpus      = math.ceil(diseno / por_gpu) + 1     # N+1
costo_mes = gpus * 0.526 * 730       # US$ por hora × horas del mes
pesos     = 24_532_532 * 2           # bytes en float16
logs_dia  = fotos_dia * 300          # bytes: ≈ 300 B por predicción

print(f"promedio {promedio:.0f} req/s · pico {pico:.0f} · diseño {diseno}")
print(f"GPUs: ⌈{diseno} ÷ {por_gpu:.0f}⌉ + 1 = {gpus}")
print(f"pesos: {pesos / 1e6:.0f} MB en una T4 de 16 GB")
print(f"costo de las GPUs: US${costo_mes:,.0f} al mes")
print(f"logs: {logs_dia / 1e9:.0f} GB al día, {logs_dia * 365 / 1e12:.1f} TB al año")
print(f"carga promedio de cada GPU: {promedio / gpus / 1_200:.0%} de su máximo")
```

```salida
promedio 116 req/s · pico 347 · diseño 500
GPUs: ⌈500 ÷ 600⌉ + 1 = 2
pesos: 49 MB en una T4 de 16 GB
costo de las GPUs: US$768 al mes
logs: 3 GB al día, 1.1 TB al año
carga promedio de cada GPU: 5% de su máximo
```

### Tres costumbres de una buena servilleta

1. **Números redondos.** «115.74 req/s» no da puntos: da la impresión de que no sabes qué importa. 116 basta, y 500 para diseñar.
2. **Un chequeo de cordura.** Compara cada resultado con algo que conoces. ¿Una T4 para 500 fotos por segundo? Cada foto son ≈ 4.1 GMACs, ≈ 8.2 mil millones de operaciones; 500 por segundo son ≈ 4.1 × 10¹² por segundo, muy por debajo de los ≈ 65 TFLOPS de una T4. Cabe. Si la cuenta hubiera dicho 500 GPUs, algo estaría mal.
3. **El número y la decisión.** No «500 req/s», sino «≈ 500 req/s de pico: una T4 cubre el tráfico y pongo dos por disponibilidad; no necesito un cluster grande ni colas». El número solo es aritmética; con la decisión, es diseño.

Lo que depende del hardware (las 1,200 fotos por segundo) o del negocio (el factor de 3) se marca como «a medir», y se mide antes de producción con una prueba de carga. Y si te preguntan «¿y con 10 veces más tráfico?», rehaces la cuenta en voz alta: 5,000 req/s son ⌈5,000 ÷ 600⌉ = 9 GPUs, 10 con repuesto, y ahora sí vale la pena optimizar el modelo o probar otra GPU.

## Estimar lo que no sabes {Estimating what you don't know} [extra]

En la servilleta de Alba, el dato del negocio venía dado: 2.5 M publicaciones al día. Muchas veces no te lo dan, o llega en otra forma. Cuatro herramientas para esos casos.

### Que las unidades hagan la cuenta

Las unidades se multiplican y se cancelan como si fueran números. Si escribes cada número con la suya, la cuenta correcta casi se arma sola, y la equivocada se nota:

- fotos/día ÷ s/día = fotos/s.
- US$/h × h/mes = US$/mes.
- Si te sale «fotos × segundos», multiplicaste donde ibas a dividir.

Un ejemplo con el catálogo de Alba: entran ≈ 2.5 M publicaciones nuevas al día, salen más o menos las mismas, y hay ≈ 100 M activas. ¿Cuánto vive una publicación? Las unidades lo dicen: publicaciones ÷ (publicaciones/día) = días. \(W = L ÷ λ\), con \(L\) = 100 M activas (lo que hay adentro) y \(λ\) (la letra griega lambda) = 2.5 M que entran por día: \(W\) = **40 días** en promedio. A esta relación, \(L = λ × W\) (lo que hay adentro = lo que entra por unidad de tiempo × cuánto se queda cada uno), se le llama **[[ley-little|ley de Little]]**.

### Partir lo que no sabes en factores

Enrico Fermi, el físico italiano, era famoso por estimar cosas sin datos. En la primera prueba nuclear, en 1945, soltó pedacitos de papel cuando pasó la onda expansiva y, por cuánto se movieron, estimó la energía: unas 10 mil toneladas de TNT. Lo que se midió después fue de unas 20 a 25 mil: entre 2 y 2.5 veces su cifra. Del orden correcto, con papelitos.

Su método sirve para cualquier número que no sabes: pártelo en factores que sí puedas estimar, estima cada uno y multiplica. Si de un factor solo sabes que está entre a y b, usa **√(a × b)**: entre 1 y 10, di 3; entre 100 y 10,000, di 1,000. Es el punto medio en una escala de potencias de diez.

:::ejemplo ¿Cuántas fotos toma México en un día?
Supuestos, cada uno dicho en voz alta:

- Habitantes: ≈ 130 millones. Con celular y cámara, digamos **100 M**.
- Fotos por persona al día: entre 1 y 10, así que √(1 × 10) ≈ **3**.
- Peso de una foto original de celular: **≈ 3 MB**, como la foto de 12 megapíxeles que Ana toma antes de que la app de Alba la achique.

Fotos = personas × fotos por persona: 100 M × 3 = 3 × 10⁸ al día; ÷ 86,400 ≈ 3,500 por segundo. Bytes = fotos × peso: 3 × 10⁸ × 3 × 10⁶ B ≈ 9 × 10¹⁴ B: **del orden de 1 PB al día**.

Ninguno de los factores es exacto, pero los errores suelen compensarse en parte y el resultado suele quedar en el orden correcto. Si una decisión depende de él, después se mide.
:::

### Tres anclas para revisar cualquier cuenta

Cuando una cuenta da un número que no conoces, compáralo con algo que sí:

- **Personas:** por debajo de ≈ 0.1 s una respuesta se siente instantánea (Jakob Nielsen, 1993). Prometer 2 ms a una persona no le cambia nada; prometerle 2 s, sí.
- **Una GPU:** una T4 hace a lo mucho ≈ 65 × 10¹² operaciones por segundo en float16. Si tu cuenta pide más, ningún ajuste del servidor lo arregla: hacen falta más GPUs o un modelo más ligero.
- **La luz:** ida y vuelta por 100 km de fibra, ≥ 1 ms. Si la otra máquina está en otro continente, la red ya se comió buena parte de los 200 ms.

### Otras formas de llegar al número

- **Desde los usuarios:** \(E = U × a\), los eventos al día \(E\) son los usuarios activos al día \(U\) por las acciones de cada uno \(a\). 5 millones de usuarios que suben 4 fotos son 20 M al día: \(R_{prom}\) = 20,000,000 ÷ 86,400 ≈ 231 req/s de promedio.
- **Requests contra fotos:** en Alba son lo mismo porque va una foto por request. Si la app mandara juntas las 3 fotos de una publicación, las mismas 116 fotos/s llegarían en 116 ÷ 3 ≈ 39 req/s: el gateway trabaja por requests y la GPU por fotos. Cuando te den un número, pregunta de cuál de los dos habla.

:::ojo El pico de un día no es el pico de un minuto
Las gráficas de tráfico suelen promediar por minuto, y aun así esconden ráfagas: 500 req/s no son 5 requests cada 10 ms exactos. Las ráfagas de segundos las absorben las colas y el margen; los eventos (un Buen Fin, una notificación a millones de personas) se planean aparte. En «En la vida real» verás uno.
:::

## Errores comunes {Common mistakes}

Las trampas que más se repiten, y cómo evitarlas.

### 1. Mezclar bits y bytes

«El internet es de 1 giga, así que un archivo de 10 GB baja en 10 segundos.» Son 80: el internet se mide en gigabits y el archivo en gigabytes. En un diseño pasa lo mismo al revés: 301 MB/s de tensores parecen poco hasta que los escribes como 2.4 Gb/s y los comparas con los ≈ 1.56 Gb/s que sostiene la máquina.

**Cómo evitarlo:** escribe siempre la b o la B, y antes de dividir pasa todo a la misma unidad. De bytes a bits, × 8.

### 2. Confundir KB con KiB

El disco «al que le faltan 69 GB» es el caso inofensivo. El caro es sumar los MiB de `nvidia-smi` con los MB de tus cuentas, o comprar memoria «justa» con una regla y llenarla con la otra: en giga hay 7.4 % de diferencia; en tera, 10 %.

**Cómo evitarlo:** anota qué regla usa cada fuente y no mezcles dos en una cuenta; para la memoria de una GPU, usa el total que reporta la propia GPU. Si el margen es chico, haz la cuenta en bytes.

### 3. Diseñar para el promedio

Con el promedio todo cabe. En Alba, el gateway a 116 req/s ocupa ≈ 0.7 [[vcpu|vCPU]] (116 × ≈ 6 ms de CPU por foto = 0.7 s de CPU por segundo; un vCPU es la unidad de CPU que renta la nube); si le das uno «porque sobra», a las 8 de la noche llegan 350 req/s, que piden 350 × 0.006 ≈ 2.1, y la latencia explota.

**Cómo evitarlo:** promedio, pico y pico de diseño, siempre los tres. Y pregunta por los eventos (un Buen Fin, una campaña), además del pico de cada día.

### 4. Redondear las máquinas hacia abajo

⌊0.83⌋ = 0 máquinas, y `round(2.08)` = 2 cuando hacen falta 3. Peor: `round(2.5)` en Python da 2.

**Cómo evitarlo:** máquinas, discos y cualquier capacidad, siempre `math.ceil`. El repuesto se suma después, aparte.

### 5. Confundir por ciento con puntos porcentuales

«La accuracy subió 2 %», cuando pasó de 85 % a 87 %: subió 2 puntos, que son 2.4 %. O «la tasa de error subió apenas 0.1 %», cuando pasó de 0.1 % a 0.2 %: se duplicó.

**Cómo evitarlo:** di los dos, «+2 puntos, de 85 % a 87 %». Con tasas chicas, di también las veces: «el doble de errores».

### 6. Mezclar escalas

Dividir entre 10⁵ en el número final (13.6 % menos tráfico), multiplicar un precio por hora × 720 en una cuenta y × 730 en otra, comparar algo por día con algo por segundo, o leer el «8B» de un LLM como 8 billones, cuando son 8 mil millones.

**Cómo evitarlo:** escribe la unidad junto a cada número y, al final, revisa que se cancelen: fotos/día ÷ s/día = fotos/s. Para las palabras, potencias de diez: 8 × 10⁹.

## En la vida real {In real life} [extra]

### Alba: un minuto de Hot Sale

El equipo de marketing de Alba manda una notificación del Hot Sale a 5 millones de personas, y una parte abre la app y publica algo en el primer minuto. El equipo de Alba hace la cuenta con un supuesto ilustrativo:

:::cuenta Un minuto de notificación en Alba
Personas que la reciben | dato de marketing | 5 M
Suben una foto en el primer minuto // supuesto: ≈ 2 % | 5 M × 0.02 | 100,000
Tasa durante ese minuto | 100,000 ÷ 60 s | ≈ 1,670 req/s
Contra el pico de un día normal // \(R_{pico}\) = 350 req/s | 1,670 ÷ 350 | ≈ 4.8 veces
Las dos T4 // contra su máximo medido, \(c\) = 1,200 cada una | 1,670 ÷ (2 × 1,200) | ≈ 70 %
CPU del gateway // ≈ 6 ms por foto, contra los 8 vCPU de sus dos nodos | 1,670 × 0.006 s | ≈ 10 vCPU
Red del gateway // \(B = R × S\), contra ≈ 3.1 Gb/s sostenidos de sus dos nodos (2 × 1.56) | 1,670 × 602 KB × 8 | ≈ 8 Gb/s
= Las GPUs, planeadas al 50 %, aguantarían; lo que se satura primero es el gateway: su CPU y, más todavía, su red. Cada parte se dimensiona aparte, y los eventos conocidos se preparan con tiempo.
:::

El promedio diario de ese día casi no cambia: es un minuto. Por eso los eventos no se ven en las cuentas por día, y por eso se pregunta por ellos.

La factura completa de Alba también sale de esta lección. Las GPUs (≈ US$768) son solo una parte: con el gateway, el balanceador, los logs y la red, el equipo de Alba llega a ≈ US$1.8k al mes de infraestructura (≈ US$1,829), dentro de su presupuesto de US$3k. Repartido entre las ≈ 304 M fotos de un mes (10 M × 30.4 días), sale a 1,829 ÷ 304 M × 1,000 ≈ US$0.006 por cada mil predicciones.

### Video que no duerme

Un sistema de video en tiempo real vigila zonas restringidas con 1,000 cámaras en 25 centros de distribución (supuestos del ejemplo). Su tráfico se cuenta en cuadros por segundo, no en requests, y no tiene hora pico: las cámaras graban igual a las 4 de la mañana. Si se analizara todo, serían 1,000 × 15 fps = **15,000 cuadros por segundo** las 24 horas, con factor de pico 1: aquí el promedio sí dimensiona. Y a ≈ 4 Mb/s por cámara son 1,000 × 4 Mb/s ≈ 4 Gb/s de video continuo; bytes al día = bits por segundo × 86,400 ÷ 8 = 4 × 10⁹ × 86,400 ÷ 8 ≈ **43 TB al día**, que no se mandan a la nube sin pensarlo: un sistema así analiza el video de cada sitio en el mismo sitio.

### Cuánto pesa un índice de búsqueda

El buscador de Alba busca entre sus ≈ 100 M publicaciones activas usando [[embedding|embeddings]] de 512 números, guardados en un [[indice-vectorial|índice vectorial]] que tiene que vivir en RAM.

:::cuenta El índice de búsqueda de Alba
Los vectores en float32 // ≈ 190.7 GiB | 100 M × 512 × 4 B | 204.8 GB
En int8 // 1 byte por número | 100 M × 512 × 1 B | 51.2 GB
El grafo del índice // ≈ 256 B por vector, en un HNSW | 100 M × 256 B | 25.6 GB
Lo que tiene que vivir en RAM // cada búsqueda salta solo por una parte, pero no sabes cuál | 51.2 + 25.6 | ≈ 77 GB
En 4 pedazos // a cada pedazo se le dice *shard* | 77 ÷ 4 | ≈ 19 GB cada uno
= Una máquina con 384 GiB (≈ 412 GB) lo cargaría entero, aun con los float32 que se guardan aparte para reordenar los mejores resultados (204.8 + 51.2 + 25.6 ≈ 282 GB en total); se parte en 4 por operación, no por memoria. Y nota el GiB: comparar 204.8 GB con 384 GiB exige pasar los dos a la misma regla.
:::

Las búsquedas también se cuentan como en esta lección: si llegaran 50 M al día (supuesto del ejemplo), \(R_{prom}\) = 50,000,000 ÷ 86,400 ≈ 579 por segundo, y con factor \(k\) = 3, 3 × 579 ≈ 1,740 en el pico, que el curso redondea a 1,750.

### El ancho de banda de la voz

Un servicio de voz a texto en tiempo real pone subtítulos en vivo en videollamadas. Supón que en el pico hay ≈ 60,000 personas hablando a la vez, y el audio llega al modelo como **PCM**: el sonido sin comprimir, 16,000 muestras por segundo de 16 bits cada una.

:::cuenta El audio de los subtítulos en vivo
Una persona hablando // bits por segundo = muestras por segundo × bits por muestra | 16,000 muestras/s × 16 bits | 256 kb/s
En bytes | 256 kb/s ÷ 8 | 32 KB/s
Todo el pico | 60,000 × 256 kb/s | ≈ 15.4 Gb/s ≈ 1.9 GB/s
Comprimido // con Opus, el códec de voz de muchas videollamadas (un códec comprime y descomprime): ≈ 32 kb/s | 256 ÷ 32 | 8 veces menos
Un mes de PCM hacia el modelo // al promedio, un tercio del pico (15.4 ÷ 3 ≈ 5.1 Gb/s), durante 730 h = 2.63 × 10⁶ s; ÷ 8 para pasar a bytes | ≈ 5.1 Gb/s × 2.63 × 10⁶ s ÷ 8 | ≈ 1.7 PB
= Una voz suena «ligera», pero 60,000 a la vez llenan una red. Y aquí manda la b chiquita: los códecs de audio se miden en kb/s.
:::

### Tokens por segundo

Piensa en un servicio que sirve su propio [[llm|LLM]] y recibe ≈ 1.5 M requests al día (supuestos del ejemplo), cada una con ≈ 2,000 [[token|tokens]] de entrada y ≈ 250 de salida. Aquí el throughput se mide en tokens por segundo, y hay dos:

:::cuenta Los tokens de un LLM propio
Requests por segundo, promedio \(R_{prom}\) | \(E ÷ 86,400\) = 1.5 M ÷ 86,400 | ≈ 17.4
Pico de diseño \(R_{diseño}\) // primero \(R_{pico} = k × R_{prom}\), con \(k\) = 3; luego un margen chico para picos de minutos, hacia arriba a un número redondo | 3 × 17.4 ≈ 52, y hacia arriba | 60 req/s
Tokens de salida por segundo en el pico // \(R_{diseño}\) × 250 tokens de salida por request | 60 × 250 | 15,000
Tokens de entrada por segundo en el pico // \(R_{diseño}\) × 2,000 tokens de entrada por request | 60 × 2,000 | 120,000
Lo que ve cada persona // un token nuevo cada ≤ 50 ms | 1 ÷ 0.05 s | ≥ 20 tokens/s
Lo que lee una persona // ≈ 200 a 300 palabras por minuto, en inglés, y ≈ 1.3 tokens por palabra | (200 a 300) ÷ 60 × 1.3 | ≈ 4–7 tokens/s
= Dos throughputs: el que siente cada persona (≥ 20 tokens/s, más rápido de lo que lee) y el de toda la flota de GPUs (15,000 tokens/s de salida), que es el que se paga.
:::

A ese tiempo por token se le llama [[tpot|TPOT]] (*time per output token*). Por qué el techo de tokens por segundo lo pone el ancho de banda de la memoria de la GPU, y no sus TFLOPS, lo ves en «Matrices, FLOPs y qué tan rápido calcula una GPU».

### Fuera de ML: tu internet y tu memoria USB

- Tu plan de «100 megas» son 100 Mb/s = 12.5 MB/s. Una película de 4 GB baja en ≈ 5.3 minutos en el mejor caso, no en 40 segundos.
- Una memoria USB «de 64 GB» aparece en Windows como ≈ 59.6 GB: son 64 × 10⁹ bytes divididos entre 2³⁰.
- Cuando tu banco anuncia que una tasa «bajó un punto», de 12 % a 11 %, son puntos porcentuales: el cambio relativo es de 8.3 %.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución; las calculadoras de la lección sirven para comprobar.

:::ejercicios
? [facil] Escribe en notación científica y di el orden de magnitud de cada número: (a) 2,500,000 publicaciones al día; (b) 602,112 bytes; (c) 0.0000001 segundos.
- La regla: escribe el número como \(text{mantisa} × 10^e\), con la mantisa entre 1 y 10. El orden es \(10^e\) si la mantisa es menor que 3.16 (≈ √10), y \(10^{e+1}\) si no.
- (a) 2.5 × 10⁶. La mantisa, 2.5, es menor que 3.16: orden **10⁶**.
- (b) ≈ 6.02 × 10⁵. Como 6.02 > 3.16, el orden es **10⁶**: casi un megabyte.
- (c) 1 × 10⁻⁷ s = 100 ns: orden **10⁻⁷**, lo que tarda leer la RAM.
? [facil] Un servicio recibe 5 millones de requests al día. ¿Cuántas llegan por segundo en promedio? ¿Y con el atajo de 10⁵ s?
- \(R_{prom} = E ÷ 86,400\) = 5,000,000 ÷ 86,400 ≈ **57.9 req/s**. Con la regla de memoria: 5 × 11.6 = 58.
- Con el atajo: 5 × 10⁶ ÷ 10⁵ = **50 req/s**, 13.6 % abajo.
? [facil] Compras un disco de 4 TB. ¿Cuántos GiB y cuántos TiB muestra tu computadora con Windows?
- Para pasar bytes a binario: GiB = bytes ÷ 2³⁰ y TiB = bytes ÷ 2⁴⁰.
- 4 TB = 4 × 10¹² bytes.
- En GiB: 4 × 10¹² ÷ 2³⁰ ≈ **3,725 GiB**, que Windows escribe como «3,725 GB».
- En TiB: 4 × 10¹² ÷ 2⁴⁰ ≈ **3.64 TiB**. No falta nada: es la regla de 1,024.
? [facil] Tu internet es de 200 Mb/s. ¿Cuánto tarda, en el mejor caso, en bajar una imagen de Docker de 10 GB? ¿Cuánto dirías si confundieras bits con bytes?
- \(t = S/B\), con \(S\) y \(B\) en bits: \(S\) = 10 GB × 8 = 80 Gb = 80,000 Mb.
- \(t\) = 80,000 Mb ÷ 200 Mb/s = **400 s ≈ 6.7 minutos**.
- Confundiendo: 10,000 MB ÷ 200 = 50 s. Te quedarías corto por 8.
? [medio] Una app recibe 20 M fotos al día. La hora pico lleva 1/6 del tráfico y quieres un margen de 1.3. Calcula el promedio, el factor de pico, el pico y el pico de diseño.
- Las fórmulas de «Del día al pico de diseño», con \(E\) = 20 M, \(f\) = 1/6 y \(m\) = 1.3.
- Promedio: \(R_{prom} = E ÷ 86,400\) = 20,000,000 ÷ 86,400 ≈ **231 req/s**.
- Factor: \(k = 24 × f\) = 24 × 1/6 = **4**.
- Pico: \(R_{pico} = k × R_{prom}\) = 4 × 231.5 ≈ **926 req/s** (con el promedio sin redondear; 231 × 4 daría 924).
- Diseño: \(R_{diseño} = m × R_{pico}\) = 1.3 × 926 ≈ 1,204, redondeado hacia arriba a la centena: **1,300 req/s**.
? [medio] El pico de diseño es 1,200 req/s. Cada máquina sostiene 800 req/s medidas, planeas al 60 %, quieres N+1 y cada máquina cuesta US$0.80 la hora. ¿Cuántas máquinas pides y cuánto cuestan al mes? ¿Qué pasaría si usaras `round` de Python?
- \(M = ⌈R_{diseño} ÷ (c × u)⌉ + s\) y \(G = M × h × 730\), con \(R_{diseño}\) = 1,200, \(c\) = 800, \(u\) = 0.6, \(s\) = 1 y \(h\) = US$0.80.
- Capacidad planeada: \(c × u\) = 800 × 0.6 = 480 req/s.
- Por tráfico: 1,200 ÷ 480 = 2.5 → ⌈2.5⌉ = 3. Con N+1: \(M\) = 3 + 1 = **4 máquinas**.
- Costo: \(G\) = 4 × US$0.80 × 730 = **US$2,336 al mes**.
- `round(2.5)` da 2 en Python: pedirías 3 en total. Si se cae una, las 2 que quedan suman 960 req/s planeadas, menos que 1,200: trabajarían al 75 % de su máximo medido (1,200 ÷ 1,600), muy arriba del 60 % que planeaste.
? [medio] El top-5 de un modelo sube de 96 % a 96.5 %. ¿Cuántos puntos porcentuales subió? ¿Qué cambio relativo es? ¿Cuánto bajaron los errores?
- Con \(p_1\) = 96 y \(p_2\) = 96.5: puntos = \(p_2 − p_1\); cambio relativo = \((p_2 − p_1)/p_1\).
- \(p_2 − p_1\) = 96.5 − 96: subió **0.5 puntos porcentuales**.
- Relativo: 0.5 ÷ 96 ≈ **0.52 %** más.
- Errores: de 100 − 96 = 4 % a 100 − 96.5 = 3.5 %, 0.5 ÷ 4 = **12.5 % menos**. Tres maneras de contar el mismo cambio: di cuál usas.
? [medio] Un servicio hace 50 M predicciones al día y guarda un log de 500 B por cada una. ¿Cuánto ocupa al día y al año? Si los discos se compran en TiB, ¿cuántos TiB al año?
- Bytes al día = predicciones al día × bytes por log.
- Al día: 5 × 10⁷ × 500 B = 2.5 × 10¹⁰ B = **25 GB**.
- Al año: 25 GB × 365 = 9,125 GB ≈ **9.1 TB**.
- En TiB: 9.125 × 10¹² ÷ 2⁴⁰ ≈ **8.3 TiB**. Antes de comprimir.
? [reto] Un servicio de lectura de documentos (OCR) recibe 3 M documentos al día de ≈ 2 páginas. El pico es 3× el promedio y el margen, 1.4. Una GPU procesa 50 páginas por segundo medidas; planeas al 50 % con N+1, a US$0.526 la hora. (a) ¿Páginas por segundo de promedio, pico y diseño? (b) ¿GPUs y costo al mes? (c) Si los documentos pueden esperar unas horas y entran a una cola que se procesa pareja, ¿cuántas GPUs?
- Se usan \(R_{prom} = E ÷ 86,400\), \(R_{pico} = k × R_{prom}\), \(R_{diseño} = m × R_{pico}\), \(M = ⌈R_{diseño} ÷ (c × u)⌉ + s\) y \(G = M × h × 730\).
- (a) \(E\) = 3 M documentos × 2 páginas = 6 M páginas al día; \(R_{prom}\) = 6,000,000 ÷ 86,400 ≈ **69 páginas/s**; \(R_{pico}\) = 3 × 69.4 ≈ **208**; \(R_{diseño}\) = 1.4 × 208 ≈ 292 → **300**.
- (b) Capacidad planeada: \(c × u\) = 50 × 0.5 = 25 por GPU. ⌈300 ÷ 25⌉ = 12, más 1: \(M\) = **13 GPUs**. \(G\) = 13 × 0.526 × 730 ≈ **US$4,992 al mes**.
- (c) La cola reparte el pico en las horas tranquilas: dimensionas con el promedio y un margen, 69 × 1.3 ≈ 90 páginas/s. ⌈90 ÷ 25⌉ = 4, más 1: **5 GPUs**, 5 × 0.526 × 730 ≈ **US$1,920**, ≈ 62 % menos. Y como esperar en la cola ya no rompe ninguna promesa, podrías planear más cerca del 100 %, como un trabajo batch (\(u\) = 1): ⌈90 ÷ 50⌉ + 1 = 3. Por eso, cuando nadie espera la respuesta en vivo, se pone una cola entre quien pide y quien procesa.
? [reto] Un centro de distribución tiene 40 cámaras que mandan video 1080p a 15 fps, y su internet sube entre 20 y 50 Mb/s. (a) Sin comprimir, ¿cuántos Gb/s producen entre todas? (b) Comprimido a ≈ 4 Mb/s por cámara, ¿cuántos Mb/s y cuántos TB al día? (c) ¿Cabe ese video en el internet del sitio? ¿Qué harías?
- Ancho de banda = cámaras × bits por segundo de cada una; bytes al día = bits por segundo × 86,400 ÷ 8.
- (a) Un cuadro: 1,920 × 1,080 × 3 B ≈ 6.22 MB. × 15 ≈ 93 MB/s, × 8 ≈ 0.75 Gb/s por cámara. × 40 ≈ **30 Gb/s**.
- (b) 40 × 4 Mb/s = **160 Mb/s**. Al día: 160 × 10⁶ × 86,400 ÷ 8 ≈ 1.73 × 10¹² B ≈ **1.7 TB**.
- (c) **No cabe:** 160 Mb/s contra 20 a 50, y tampoco con un video más ligero de ≈ 1.5 Mb/s por cámara (60 Mb/s). Se analiza **en el sitio**, con una GPU junto a las cámaras, y a la nube solo van los eventos: la decisión de dónde analizar el video sale de una división.
:::

## Lo que sigue {What comes next}

«Promedios, medianas y percentiles» explica por qué la promesa es sobre el p99 y no sobre el promedio. «Probabilidad para sistemas que fallan» calcula cuánto vale de verdad el repuesto N+1 y de dónde salen los nueves. «Cómo guarda números una computadora» abre el binario, float32, float16 e int8. «Matrices, FLOPs y qué tan rápido calcula una GPU» convierte TFLOPS y GB/s en milisegundos, y muestra el techo de tokens por segundo de un LLM. «Qué tan rápido y cuánto: latencia y throughput» junta todo con las colas y la ley de Little. Y «Máquinas, GPUs y cómo se cobran» y «Redes en la nube: VPC, subredes y egress» vuelven al precio por hora × 730 y a lo que cuesta cada GB que cruza la red.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
notacion-cientifica orden-magnitud bit byte prefijo-binario ancho-banda throughput qps factor-pico estimacion ceil punto-porcentual
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué un plan de internet de 100 megas no baja 100 MB por segundo?
Son 100 megabits por segundo, y un byte tiene 8 bits: 100 ÷ 8 = 12.5 MB/s.
? ¿Cuántos segundos tiene un día, y cuántas requests por segundo son 1 millón al día?
86,400 segundos. 1,000,000 ÷ 86,400 ≈ 11.6 req/s.
? Un disco de 1 TB aparece como 931 GB. ¿Qué pasó?
Nada se perdió: el disco trae 10¹² bytes, y Windows los divide entre 2³⁰ (un GiB) aunque escriba «GB»: 10¹² ÷ 2³⁰ ≈ 931.
? ¿Por qué se diseña para el pico de diseño y no para el promedio?
Porque en la hora pico llegan varias veces más requests que en promedio (3 veces en Alba): con capacidad para el promedio, la latencia explotaría. El promedio paga la factura; el pico de diseño decide las máquinas.
? Una cuenta dice que hacen falta 2.1 máquinas. ¿Cuántas pides con N+1?
⌈2.1⌉ = 3 por tráfico, más 1 de repuesto: 4. Nunca hacia abajo.
? La accuracy pasa de 85 % a 87 %. ¿Subió 2 %?
Subió 2 puntos porcentuales; en términos relativos, 2 ÷ 85 ≈ 2.4 %. Los errores bajaron 13 %, de 15 % a 13 %.
? ¿Cuánto cuesta al mes una máquina de US$0.526 la hora encendida todo el tiempo?
US$0.526 × 730 h ≈ US$384.
:::
