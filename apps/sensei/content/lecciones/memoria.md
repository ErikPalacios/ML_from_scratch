---
titulo: Memoria, caché y disco
en: Memory, cache and disk
subtitulo: Dónde viven los bytes de un modelo y de una foto, por qué el mismo dato tarda 1 nanosegundo o 10 milisegundos según el piso en que esté, y qué pasa cuando la memoria se acaba.
pregunta: ¿Dónde viven los bytes de un modelo y de una foto, y por qué el mismo dato tarda 1 ns o 10 ms según dónde esté?
requisitos: unidades, programa-proceso
---

:::idea
Una computadora guarda los bytes en una escalera de memorias. Arriba, las cachés de la CPU: poquitas y rapidísimas, ≈ 1 ns. En medio, la RAM: ≈ 100 ns. Abajo, los discos: enormes, guardan aunque se apague todo y tardan de ≈ 0.1 a ≈ 10 ms. El mismo dato puede tardar diez millones de veces más según el piso donde esté, y casi todo lo rápido de un sistema sale de tener cerca lo que se va a usar.
:::

En la lección de FLOPs viste que una GPU puede pasar más tiempo esperando bytes que calculando. Aquí abrimos la computadora completa para ver dónde esperan esos bytes.

Piensa en el servidor de GPU de C01. El modelo es un archivo de ≈ 50 a 150 MB guardado en un disco, y para responder tiene que estar en la memoria de la GPU. La foto de Ana hace otro viaje: nunca toca un disco. Llega por la red, vive unos milisegundos en la memoria y desaparece.

Al terminar vas a poder contestar preguntas de todos los días en producción. ¿Por qué recorrer una tabla en orden es varias veces más rápido? ¿Por qué un LLM tarda minutos en arrancar la primera vez y segundos la segunda? ¿Por qué a veces un servidor al que le falta memoria no se cae, sino que se vuelve lentísimo? ¿Y por qué un contenedor muere con «OOMKilled» aunque a la máquina le sobre memoria?

## Dos memorias: la RAM y el disco {Two memories: RAM and disk}

Tu celular lo dice en la caja con dos números: «128 GB» y «8 GB de RAM». El primero es el **almacenamiento**, el disco; el segundo, la **memoria**. No son lo mismo.

### La RAM: la memoria de trabajo

La [[ram|RAM]] es donde viven los programas mientras corren y los datos que están usando. Imagínala como una fila enorme de casillas de un byte, cada una con su número, su **dirección**: la casilla 0, la 1, la 2… hasta miles de millones. Para leer, la [[cpu|CPU]] da la dirección y la RAM entrega el byte.

Se llama RAM, *random access memory* («memoria de acceso aleatorio»), porque cualquier casilla tarda más o menos lo mismo, sin importar cuál pediste antes: ≈ 100 ns, como viste en la lección de unidades. Y una vez que empieza a entregar, da muchos bytes seguidos: de decenas a cientos de GB por segundo, según la máquina. La Mac M4 donde se escribió esta lección da 120 GB/s; un servidor grande, varios cientos. Son dos números distintos, y toda memoria tiene los dos: cuánto tarda en llegar lo primero que pides (su [[latencia]]) y cuántos bytes por segundo entrega después (su [[ancho-banda|ancho de banda]]).

Tiene dos debilidades. La primera: **se borra al apagar**. Cada bit es una carguita eléctrica en un capacitor diminuto que se escapa sola; el chip la refresca cada pocas decenas de milisegundos, y sin luz se pierde todo. Por eso se le dice DRAM, RAM *dinámica*. La segunda: es cara. Por eso una laptop trae de 8 a 32 GB, y un servidor, de decenas de GB a varios TB.

### El disco: el almacén que no olvida

El [[disco]] guarda los archivos aunque se apague la computadora: el sistema, los programas instalados, tus fotos, un dataset, los pesos de un modelo. Cabe mucho más y cuesta mucho menos por GB que la RAM, pero tarda en encontrar cada dato. Por dentro también es una fila de casillas numeradas, solo que más grandes: **bloques** de 512 bytes o de 4 KiB, según el disco. Se lee de bloque en bloque, nunca un byte suelto, y el sistema operativo casi siempre pide 4 KiB o más a la vez. Hay dos tipos:

- El **disco duro** (*HDD*, *hard disk drive*): platos que giran y un brazo que lee. Encontrar un dato tarda ≈ 10 ms, porque hay que mover piezas.
- El [[ssd|SSD]] (*solid-state drive*): chips de memoria flash, la misma de una memoria USB, sin nada que se mueva. Encuentra un dato en ≈ 0.05 a 0.1 ms. Se conecta por **SATA**, la conexión que se diseñó para los discos duros (hasta ≈ 550 MB/s), o por **NVMe**, una hecha para flash que da varios GB/s.

| | RAM | SSD NVMe | Disco duro |
|---|---|---|---|
| ¿Guarda sin luz? | No | Sí | Sí |
| Tamaño típico | 8 GB a varios TB | cientos de GB a decenas de TB | hasta ≈ 40 TB |
| Encontrar un dato (latencia) | ≈ 100 ns (0.0001 ms) | ≈ 0.05 a 0.1 ms | ≈ 10 ms |
| Leer de corrido (ancho de banda) | decenas a cientos de GB/s | 1 a 14 GB/s | 0.1 a 0.3 GB/s |
| Por GB, cuesta | lo más caro | unas cien veces menos (2026) | unas veces menos que un SSD |

¿Por qué no usar solo una? Porque no existe una memoria rápida, grande, barata y que no olvide. La RAM es rápida, pero olvida y es cara; el disco recuerda y es barato, pero es demasiado lento para calcular con él. Así que cada máquina tiene las dos, y una regla manda: **la CPU solo calcula con lo que está en la RAM**. Todo programa y todo archivo se **carga**, se copia del disco a la RAM, antes de usarse. Es lo que pasa en los segundos que tarda en abrir una app.

La [[gpu|GPU]] tiene además su propia memoria, la [[vram|VRAM]], aparte de la RAM. Para que calcule, los bytes tienen que cruzar a ella por [[pcie|PCIe]], el camino que une la CPU con la GPU (≈ 16 GB/s en la T4 de C01).

### Dónde viven los bytes de C01

Junta las piezas en el servidor de GPU de C01, una máquina que en Kubernetes se llama **nodo**. El modelo es un archivo, el *engine* de TensorRT (la ResNet-50 ya convertida para correr rápido en una GPU de NVIDIA). Vive en el disco, dentro de la imagen de Docker de Triton, el programa que sirve el modelo (la imagen es el paquete con el que se arma su contenedor). Al arrancar, Triton lo lee a la RAM y copia los pesos a la VRAM: ≈ 49 MB (24.5 millones de parámetros de 2 bytes, en FP16), que se quedan ahí mientras el servidor viva.

La foto de Ana hace otro viaje, y nunca toca un disco. El gateway ya la decodificó y la preparó: llega por la red como un tensor de 602 KB, pasa por la RAM y por la VRAM y, unos milisegundos después, ya no existe.

:::diagrama memoria-nodo
Toca cada caja para ver qué guarda. Usa «Recorrer» para seguir el arranque, la foto de Ana y lo que pasa si se va la luz.
:::

## La caché de la CPU y la escalera de memoria {The CPU cache and the memory ladder}

### El problema: la CPU espera

Un [[nucleo|núcleo]] de la CPU, cada uno de los procesadores que trae el chip, hace varias operaciones por nanosegundo. Si cada número viniera de la RAM, en los 100 ns de espera podría haber hecho cientos de operaciones: se pasaría casi todo el tiempo esperando. Es el **muro de la memoria** (*memory wall*): desde hace décadas, las CPU se aceleraron mucho más que la RAM.

### La solución: memorias pequeñitas junto al núcleo

Dentro del chip de la CPU hay memorias diminutas y muy rápidas que guardan copia de lo que se usó hace poco: la [[cache-cpu|caché]] (*cache*). Están hechas con SRAM, RAM *estática*: cada bit es un circuito de seis transistores que no necesita refrescarse. Es rápida, pero ocupa mucho espacio del chip y es cara. Por eso hay poca, en varios niveles:

| Nivel | Tamaño típico | Tarda | De quién es |
|---|---|---|---|
| L1 | 32 a 128 KiB | ≈ 1 ns | de cada núcleo |
| L2 | 1 a 16 MiB | ≈ 3 a 5 ns | de cada núcleo o de un grupo |
| L3 | decenas a cientos de MiB | ≈ 10 a 30 ns | de un grupo o de todos |

Son valores de CPUs de 2022 a 2025. En [[linux|Linux]], `lscpu` te dice las de tu máquina.

:::profundo Las cachés de dos máquinas de verdad
En la Mac con chip M4 donde se escribió esta lección, cada núcleo rápido tiene 128 KiB de L1 para datos, y los 4 núcleos rápidos comparten 16 MiB de L2; Apple no tiene una L3 como tal, sino otra caché que comparte con la GPU. Un Ryzen 9 9950X (AMD, 2024) trae por núcleo 48 KiB de L1 para datos y 1 MiB de L2, y 32 MiB de L3 por cada 8 núcleos.
:::

### Aciertos, fallos y líneas

Cuando el núcleo necesita un dato, lo busca primero en la L1. Si está, es un **acierto** (*cache hit*): llega en ≈ 1 ns. Si no, es un **fallo** (*cache miss*): lo busca en la L2, luego en la L3 y al final en la RAM. De regreso, el dato se queda copiado en las cachés, y para hacerle lugar sale lo que lleva más tiempo sin usarse.

La caché nunca trae un byte suelto. Trae un bloque de **64 bytes seguidos**, una **línea de caché** (*cache line*); en los chips de Apple, 128. Un float32 ocupa 4 bytes, así que una línea trae 16: pides uno y llegan sus 15 vecinos. Nadie lo pide: el hardware hace todo esto solo, sin que el programa se entere.

¿Cuánto pesan los fallos? Supón, para el ejemplo, que 95 de cada 100 lecturas aciertan en la L1 y que las otras 5 van hasta la RAM (para simplificar, sin contar la L2 ni la L3):

:::cuenta Cuánto tarda una lectura, en promedio
Las 95 de cada 100 que aciertan // en la L1 | 95 × 1 ns | 95 ns
Las 5 que fallan // van a la RAM | 5 × 100 ns | 500 ns
Las 100 juntas | 95 + 500 | 595 ns
Promedio | 595 ÷ 100 | ≈ 6 ns
= Con 95 % de aciertos, una lectura tarda en promedio 6 veces lo de un acierto, y el 84 % del tiempo se va en ese 5 % de fallos. Con 99 %, el promedio baja a ≈ 2 ns.
:::

:::calculadora memoria-aciertos
Mueve los aciertos y mira cuánto pesan los pocos fallos.
:::

### La escalera completa

Ya conoces todos los pisos. Juntos forman la [[jerarquia-memoria|jerarquía de memoria]] (*memory hierarchy*). Arriba, los registros: unas decenas de casillas dentro de cada núcleo, con los números que está usando en este instante. Luego, las cachés, la RAM y, abajo, los discos. Cada piso hacia abajo guarda más y cuesta menos por byte, pero tarda más.

:::figura memoria-escalera
La escalera de memoria, de la más rápida a la más lenta. Cada línea punteada vale 100 veces la anterior: de la L1 al disco duro hay siete [[orden-magnitud|órdenes de magnitud]], diez millones de veces. A la derecha, lo mismo a escala humana, como si 1 ns durara 1 segundo.
:::

Los nanosegundos no se sienten; estíralos como en la figura:

:::cuenta La escalera, si 1 ns durara 1 segundo
L1 | 1 ns × 10⁹ | 1 s
L2 | 4 ns × 10⁹ | 4 s
L3 | 15 ns × 10⁹ | 15 s
RAM | 100 ns × 10⁹ | 100 s = 1 min 40 s
SSD NVMe // leer 4 KiB al azar | 100 µs × 10⁹ | 100,000 s ≈ 28 h
Disco de red // EBS gp3: un disco que AWS conecta por la red | 1 ms × 10⁹ | 10⁶ s ≈ 12 días
Disco duro | 10 ms × 10⁹ | 10⁷ s ≈ 4 meses
= Del primer piso al último, el mismo dato pasa de un segundo a cuatro meses: diez millones de veces más.
:::

:::analogia La cocina, completa
En la lección de FLOPs, la caché de la GPU era la mesa junto a la estufa. Completa ahora la cocina de la CPU con la escala de arriba. Los registros son lo que tienes en la mano. La caché es la mesa: estiras el brazo y listo. La RAM es la bodega del fondo: casi dos minutos de ida y vuelta. Un SSD es ir al mercado: un día entero. Un disco duro es un pedido que llega por barco, en cuatro meses. Por eso un buen cocinero sube a la mesa lo que va a usar, y un buen programa también.

**Dónde se rompe:** en la cocina, tú decides qué subes a la mesa; la caché la llena el hardware solo, y cuando pides un jitomate te sube la caja entera (la línea de 64 bytes). Además, la mesa no se vacía si se va la luz; la RAM y las cachés sí.
:::

:::profundo La escalera de la GPU
La GPU tiene su propia escalera. Arriba están sus registros y una memoria pegada a cada grupo de núcleos, de decenas o cientos de KB; luego su caché L2 (4 MB en la T4) y, abajo, la VRAM, con su [[ancho-banda-memoria|ancho de banda]] de 320 GB/s en la T4. Los *tiles* de la lección de FLOPs son la manera de aprovechar esa escalera. Entre la escalera de la CPU y la de la GPU hay un puente, PCIe, más angosto que cualquiera de las dos memorias.
:::

## Discos por dentro: disco duro, SSD y discos de la nube {Inside disks: hard drives, SSDs and cloud disks} [extra]

### Por qué un disco duro tarda

Un disco duro guarda los bits en platos magnéticos que giran sin parar, casi siempre a 7,200 vueltas por minuto (*rpm*). Encima flota un brazo con una cabeza lectora. Los datos van en círculos, las **pistas**. Para leer un dato en un lugar al azar hay que esperar dos cosas:

:::pasos
1. Mover el brazo
La cabeza viaja hasta la pista del dato. Se llama *seek* y, en un disco de 7,200 rpm, tarda en promedio unos 8 ms (los fabricantes dan de ≈ 7.5 a 8.5 ms).
2. Esperar el giro
La cabeza ya está en la pista, pero el dato puede venir del otro lado del plato. En promedio hay que esperar media vuelta.
:::

:::cuenta Una lectura al azar en un disco duro de 7,200 rpm
Una vuelta | 60 s ÷ 7,200 | 8.33 ms
Media vuelta // la espera promedio | 8.33 ÷ 2 | ≈ 4.2 ms
Mover el brazo // el *seek* promedio | dato del fabricante | ≈ 8 ms
Una lectura al azar | 8 + 4.2 | ≈ 12 ms
Lecturas al azar por segundo | 1 s ÷ 12.2 ms | ≈ 80
Leer 1 GB a saltos de 4 KiB // 10⁹ B ÷ 4,096 B = 244,141 lecturas | 244,141 × 12.2 ms | ≈ 50 minutos
Leer 1 GB de corrido // ≈ 250 MB/s, ya en posición | 1 GB ÷ 250 MB/s | ≈ 4 s
= El mismo GB tarda 4 segundos de corrido y casi una hora a saltos. Un disco duro es bueno leyendo seguido y pésimo saltando.
:::

:::figura memoria-disco
Lo que espera un disco duro en cada lectura al azar: que el brazo lleve la cabeza a la pista del dato (la línea punteada) y que el giro traiga el dato hasta la cabeza. Abajo, las mismas esperas a escala: el SSD es una rayita, y la RAM ni se ve.
:::

Hoy los discos duros viven donde importa el precio por TB y no la velocidad: respaldos, archivos viejos y el almacenamiento «frío» de las nubes.

### La flash de un SSD

Un SSD guarda cada bit como una carga atrapada en una celda de memoria flash, que no se escapa aunque no haya luz. Se lee directo, sin mover nada: ≈ 0.05 a 0.1 ms por lectura al azar, más de 100 veces menos que un disco duro.

Tiene sus mañas. La flash se lee y se escribe por páginas propias, de unos KiB, pero solo se puede borrar por bloques grandes, de muchas páginas: reescribir un dato obliga al SSD a mover otros y a borrar después. Y cada celda aguanta un número limitado de escrituras, del orden de mil a unos pocos miles: un SSD se gasta con el uso. Escribir sin parar, por ejemplo usándolo de swap, lo gasta más rápido.

### SATA contra NVMe

La diferencia entre un SSD lento y uno rápido muchas veces no está en la flash, sino en cómo se conecta. **SATA** es la conexión que se diseñó a principios de los 2000 para discos duros: la CPU le puede dejar una sola fila de 32 pedidos, y su tope es de 6 Gb/s (gigabits por segundo). Como de cada 10 bits que viajan solo 8 son datos, quedan 600 MB/s, y ≈ 550 en la práctica. **NVMe** (*Non-Volatile Memory Express*) se diseñó para flash y va directo por PCIe: muchas filas de pedidos a la vez (el estándar permite hasta 65,535), de ≈ 3 a 14 GB/s en los más rápidos que se venden, según la generación de PCIe, y cientos de miles de lecturas al azar por segundo. Los NVMe que trae una máquina de la nube suelen dar ≈ 1 a 3 GB/s.

### Tres números de un disco

Un disco se mide con tres números que no se deben mezclar:

- **Latencia:** cuánto tarda **una** lectura. ≈ 12 ms un disco duro; ≈ 0.1 ms un SSD.
- **IOPS** (*input/output operations per second*): cuántas lecturas o escrituras chicas, normalmente de 4 KiB, aguanta por segundo. ≈ 80 un disco duro; cientos de miles un NVMe.
- **[[throughput|Throughput]]:** su ancho de banda, cuántos MB por segundo da leyendo de corrido. Es el nombre que usa AWS en sus discos.

Para un disco, «rápido» no dice nada si no dices para qué: para leer un archivo grande de corrido, o para saltar entre millones de pedacitos.

### Los discos de la nube

En AWS hay dos tipos de disco para una máquina:

- **Local** (*instance store*): un NVMe pegado a la máquina, rápido. Pero se borra cuando la máquina se detiene: sirve para copias de trabajo, no para guardar. La g4dn.xlarge, la máquina con una T4 de C01, trae ≈ 125 GB.
- **De red** (EBS, *Elastic Block Store*): un disco que vive en otro lado del centro de datos y se conecta por la red. Sobrevive a la máquina, pero cada lectura cruza la red, con una latencia de un dígito de milisegundos. El más común, **gp3**, da de base 3,000 IOPS y 125 MiB/s (≈ 131 MB/s); pagando más, hasta 2,000 MiB/s.

El gp3 es el disco raíz típico (el disco con el que arranca la máquina) de los nodos de Kubernetes en AWS, y sus 125 MiB/s de base son justo el número que la Ronda (M05) señala como el cuello de botella al bajar imágenes y pesos.

## Localidad: por qué recorrer en orden es más rápido {Locality: why going in order is faster}

Las [[cache-cpu|cachés]] funcionan por una razón: los programas no leen la memoria al azar. Tienen [[localidad]] (*locality*), de dos tipos:

- **Temporal:** lo que usaste hace un momento lo vas a volver a usar pronto. El contador de un ciclo, los promedios con los que se normaliza cada canal de una foto, los pesos de una capa que se aplican a las 32 fotos de un [[batch]].
- **Espacial:** lo que está junto a lo que usaste lo vas a usar enseguida. El siguiente píxel, el siguiente número de una lista.

La caché aprovecha las dos: guarda lo reciente y trae líneas completas. Además, la CPU tiene un **prefetcher**, un circuito que detecta cuando recorres la memoria en orden y trae las siguientes líneas antes de que las pidas.

### Una matriz se guarda fila tras fila

La memoria es una sola fila de casillas, así que una tabla de dos dimensiones hay que aplanarla. NumPy (la librería de Python para arreglos de números) y PyTorch, como el lenguaje C, guardan una fila completa y luego la siguiente: es el orden *row-major* («por filas»). En una matriz de float32 con 1,024 columnas, el número de la fila i y la columna j está en:

**dirección = inicio + (i × 1,024 + j) × 4 bytes**

El de la fila 2 y la columna 5, por ejemplo, está (2 × 1,024 + 5) × 4 = 8,212 bytes después del inicio. Recorrer por filas es avanzar de 4 en 4 bytes: cada línea trae 16 números seguidos. Recorrer por columnas es brincar 1,024 × 4 = 4,096 bytes en cada paso, una fila entera: cada lectura cae en una línea distinta. Ojo: la RAM sí tarda casi lo mismo con cualquier dirección; lo que cambia es cuántas veces hay que ir a ella.

:::figura memoria-lineas
La misma matriz, recorrida de dos maneras. Por filas, cada línea que llega trae los siguientes 3 números (15 en una CPU real). Por columnas, cada lectura pide una línea nueva, y si la matriz no cabe en la caché, la línea ya se fue cuando el recorrido vuelve por ella.
:::

:::cuenta Recorrer una matriz de 1,024 × 1,024 float32 con una caché de 32 KiB
Bytes de la matriz | 1,048,576 × 4 B | 4 MiB
Por filas: líneas que llegan // 64 B cada una | 4 MiB ÷ 64 B | 65,536 fallos
Aciertos por filas | 1 − 65,536 ÷ 1,048,576 | 93.75 %
Por columnas // la caché guarda 32 KiB ÷ 64 B = 512 líneas, y cada columna toca 1,024: al volver, ya se fueron | 1,048,576 lecturas | 1,048,576 fallos
Promedio por filas // 15 de cada 16 aciertan: 1 ns por acierto, 100 ns por fallo | 15/16 × 1 + 1/16 × 100 | ≈ 7.19 ns
Tiempo por filas | 1,048,576 × 7.19 ns | ≈ 7.5 ms
Tiempo por columnas | 1,048,576 × 100 ns | ≈ 105 ms
= Los mismos números, leídos en otro orden: 16 veces más fallos y ≈ 14 veces más tiempo.
:::

Este simulador cuenta los fallos con una caché de juguete de 32 KiB, que saca la línea que lleva más tiempo sin usarse:

```python
from collections import OrderedDict

LINEA = 64                       # bytes por línea de caché
LINEAS_EN_CACHE = 512            # una caché de juguete: 512 × 64 B = 32 KiB
FILAS = COLUMNAS = 1024          # una matriz de float32: 1024 × 1024 × 4 B = 4 MiB

def recorrer(por_filas):
    cache, fallos = OrderedDict(), 0
    for a in range(FILAS):
        for b in range(COLUMNAS):
            i, j = (a, b) if por_filas else (b, a)
            direccion = (i * COLUMNAS + j) * 4        # fila tras fila, 4 bytes por número
            linea = direccion // LINEA
            if linea in cache:
                cache.move_to_end(linea)              # acierto: la línea ya estaba
            else:
                fallos += 1                           # fallo: hay que traerla de la RAM
                cache[linea] = True
                if len(cache) > LINEAS_EN_CACHE:
                    cache.popitem(last=False)         # sale la que lleva más tiempo sin usarse
    return fallos

lecturas = FILAS * COLUMNAS
for nombre, por_filas in (("por filas", True), ("por columnas", False)):
    f = recorrer(por_filas)
    print(f"{nombre:>12}: {f:>9,} fallos de {lecturas:,} lecturas · aciertos {1 - f / lecturas:.2%}")
```

```salida
   por filas:    65,536 fallos de 1,048,576 lecturas · aciertos 93.75%
por columnas: 1,048,576 fallos de 1,048,576 lecturas · aciertos 0.00%
```

Tu CPU tiene tres niveles y un prefetcher, así que los números de verdad son otros, pero la idea es la misma. Mídelo con una lista de 3 millones de números, sumada en orden y en desorden:

```python
import random, time

N = 3_000_000
datos = list(range(N))                 # 3 millones de números, creados en orden
orden = list(range(N))                 # los lugares en orden: 0, 1, 2…
desorden = orden[:]
random.seed(7)
random.shuffle(desorden)               # los mismos lugares, revueltos

def sumar(lugares):
    inicio = time.perf_counter()
    total = 0
    for i in lugares:
        total += datos[i]
    return total, time.perf_counter() - inicio

suma1, t_orden = sumar(orden)
suma2, t_desorden = sumar(desorden)
print("¿las dos sumas dan lo mismo?", suma1 == suma2)
print("¿en desorden tardó más del doble?", t_desorden > 2 * t_orden)
```

```salida
¿las dos sumas dan lo mismo? True
¿en desorden tardó más del doble? True
```

Los tiempos cambian con la máquina y con la corrida; por eso el código solo imprime si pasó. En la Mac donde se escribió esta lección, el desorden tardó de 5 a 12 veces más. La razón: en Python, cada número es un objeto aparte y la lista guarda dónde está cada uno. Como se crearon en orden, quedaron uno tras otro; en desorden, cada salto cae en otra línea, lejos.

### Dónde lo vas a ver en ML

- **CHW contra HWC.** Pillow entrega la foto en HWC (los tres colores de cada píxel juntos) y el modelo la quiere en [[chw|CHW]]. Transponer en PyTorch (`permute`) no mueve ni un byte: solo cambia el orden en que se van a leer. El tensor queda «no contiguo» (`x.is_contiguous()` da `False`), y algunas operaciones primero lo copian en orden. Haz esa copia una vez, con `.contiguous()`, y no en cada paso.
- **NumPy contra una lista.** Un arreglo de NumPy guarda sus números juntos, 4 u 8 bytes cada uno; una lista de Python guarda direcciones de objetos regados por la memoria. Es parte de por qué NumPy es tan rápido.
- **El batch.** Es localidad temporal en la GPU: cada peso que se trae de la VRAM se usa con todas las fotos del batch antes de soltarlo.
- **Archivos chicos contra grandes.** En un disco, leer un archivo grande de corrido le gana a saltar entre millones de archivos chicos. Por eso los datasets grandes se empaquetan en archivos de cientos de MB (*shards*).

## Memoria virtual: cada proceso ve su propio mapa {Virtual memory: each process sees its own map}

En una computadora corren muchos [[proceso|procesos]] a la vez, los programas en marcha de la lección anterior, y todos comparten la misma RAM. Si cada uno escribiera directo en las direcciones de verdad, un error en uno podría pisar la memoria de otro, y cada programa tendría que averiguar qué casillas están libres.

La solución es la [[memoria-virtual|memoria virtual]] (*virtual memory*). Cada proceso ve su propio espacio de direcciones, que empieza en 0 y llega hasta un número enorme, como si tuviera la máquina para él solo. Son direcciones **virtuales**. El [[sistema-operativo|sistema operativo]], el programa que administra la máquina y reparte la RAM entre los procesos, las traduce a direcciones de verdad con ayuda de una pieza de la CPU, la **MMU** (*memory management unit*).

### Páginas y tabla de páginas

Traducir byte por byte sería carísimo, así que se traduce por bloques, las **páginas** (*pages*): 4 KiB en casi todo Linux y 16 KiB en las Mac con chip de Apple. Cada proceso tiene una **tabla de páginas** que dice, para cada página suya, en qué **marco** (*frame*) de la RAM de verdad está. Dos procesos pueden usar la misma dirección virtual y caer en marcos distintos: nunca se pisan.

Un ejemplo con la figura de abajo y páginas de 4 KiB (4,096 bytes). El proceso A lee su dirección virtual 4,100. La CPU divide: 4,100 ÷ 4,096 da 1 y sobran 4, así que es el byte 4 de su página 1. La tabla de A dice que esa página está en el marco 2, y el byte de verdad está en 2 × 4,096 + 4 = 8,196. Si B lee la misma dirección, 4,100, cae en su propia página 1, que todavía no tiene marco.

:::figura memoria-paginas
Dos procesos con sus propios mapas. Cada flecha es una línea de su tabla de páginas: una página puede estar en un marco de la RAM, compartida con otro proceso, en el disco o en ningún lado todavía. La página 1 de A, en el marco 2, es la del ejemplo.
:::

Ese mapa le da al sistema operativo cuatro poderes:

- **Aislar:** un proceso no puede ni ver la memoria de otro. Si truena, no corrompe a los demás.
- **Reservar sin entregar:** cuando un programa pide 1 GB, el sistema anota la reserva y no le da ni un marco. La RAM llega de página en página, la primera vez que el programa escribe en cada una.
- **Compartir:** dos procesos pueden apuntar al mismo marco. Así se comparten las librerías y los archivos abiertos con mmap, que ves en la siguiente sección.
- **Mandar páginas al disco:** si falta RAM, una página poco usada se puede guardar en el disco para liberar su marco. Es el swap, dos secciones adelante.

El segundo poder explica algo pendiente de la lección anterior: por qué Linux casi siempre dice que sí cuando un proceso pide memoria, aunque no la tenga. Se llama *overcommit* («prometer de más»). La cuenta llega después, cuando el proceso escribe y cada página necesita su marco. Si entonces no hay RAM, ya no hay a quién decirle que no, y actúa el OOM killer.

### Fallos de página

¿Qué pasa cuando un proceso toca una página sin marco, como B con su página 1? La CPU lo detiene y avisa al sistema operativo: es un **fallo de página** (*page fault*). No es un fallo de caché: aquel lo resuelve el hardware solo, yendo a la RAM; este lo resuelve el sistema operativo. El sistema consigue la página, actualiza la tabla y deja seguir al proceso. Si basta con darle un marco nuevo lleno de ceros, cuesta del orden de un microsegundo. Si hay que leer la página del disco, de 0.1 a 10 ms. El mismo acceso a la memoria puede tardar 100 ns o 10 ms, según dónde esté la página: es la respuesta completa a la pregunta de esta lección.

### Lo que de verdad ocupa un proceso: la RSS

Por todo esto, el tamaño virtual de un proceso dice poco: puede reservar decenas de GB sin ocupar casi nada. Lo que importa es su [[rss|RSS]] (*resident set size*): cuánta de su memoria está en la RAM en este momento. En `ps` o `top`, esa es la columna RSS (o RES); VSZ (o VIRT) es el tamaño virtual. Compruébalo. El código le pide memoria al sistema con `mmap.mmap(-1, …)`, la forma más directa desde Python: el `-1` quiere decir «sin archivo». Con un archivo, es el mmap de la siguiente sección.

```python
import mmap, resource, sys

def ram_mb():                          # la RSS más alta que ha tenido este proceso, en MB
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / 1e6 if sys.platform == "darwin" else r * 1024 / 1e6   # macOS la da en bytes; Linux, en KiB

TAM = 400_000_000                      # 400 MB
antes = ram_mb()
m = mmap.mmap(-1, TAM)                 # le pide al sistema 400 MB de memoria
print(f"pedí 400 MB:                   la RAM creció ≈ {ram_mb() - antes:.0f} MB")
m[0] = 1                               # escribe un solo byte
print(f"escribí 1 byte:                la RAM creció ≈ {ram_mb() - antes:.0f} MB")
saltos = range(0, TAM, 4096)
for i in saltos:
    m[i] = 1                           # un byte cada 4 KiB
print(f"escribí {len(saltos):,} bytes sueltos: la RAM creció ≈ {ram_mb() - antes:.0f} MB")
```

```salida
pedí 400 MB:                   la RAM creció ≈ 0 MB
escribí 1 byte:                la RAM creció ≈ 0 MB
escribí 97,657 bytes sueltos: la RAM creció ≈ 400 MB
```

Pedir no ocupó nada. Escribir 97,657 bytes, menos de 0.1 MB, ocupó 400 MB, porque cada byte cayó en una página distinta y cada página se entrega completa. Dos avisos. `resource` solo existe en macOS y Linux: en Windows, este bloque no corre. Y en una Mac las páginas son de 16 KiB, así que escribir cada 4 KiB toca cada página cuatro veces, con el mismo resultado.

:::profundo La TLB, las páginas grandes y la memoria fijada
Traducir cada dirección pediría leer la tabla de páginas, que está en la RAM: otra vez 100 ns. Para no hacerlo, la CPU guarda las traducciones recientes en una caché propia, la **TLB** (*translation lookaside buffer*), de unos cientos a unos miles de traducciones. Con páginas de 4 KiB, 1,500 traducciones cubren ≈ 6 MiB; con **páginas grandes** (*huge pages*) de 2 MiB, ≈ 3 GiB. Por eso las usan las bases de datos y otros programas que manejan mucha memoria.

Como el sistema puede mover las páginas o mandarlas al swap, la GPU, que copia de la RAM por su cuenta, necesita memoria **fijada** (*pinned*), que el sistema promete dejar quieta: lo ves en «CPU y GPU».
:::

## Cargar el modelo: la page cache y mmap {Loading the model: the page cache and mmap}

### La page cache: la RAM libre, trabajando

La RAM libre no se queda de brazos cruzados. Cada vez que un programa lee un archivo, el sistema operativo se queda con una copia en la RAM que nadie está usando: la [[page-cache|page cache]]. La segunda vez que alguien lee ese archivo, sale de la RAM y no del disco. Si un programa necesita la memoria, el sistema suelta esa copia sin preguntar: no estorba.

Por eso, en un servidor Linux, el comando `free` casi siempre muestra poca memoria «free» y mucha en «buff/cache». No es un problema: la columna que importa es «available», lo que de verdad hay si alguien lo pide. La confusión es tan común que tiene su propia página web: «Linux ate my RAM» («Linux se comió mi RAM»).

Las escrituras también pasan por la page cache y llegan al disco segundos después. Por eso hay que «expulsar» una memoria USB antes de sacarla: expulsar obliga a escribir lo pendiente.

### mmap: abrir un archivo como si fuera memoria

Hay dos maneras de usar un archivo. La normal es leerlo (`read`): el sistema lo trae a la page cache y lo **copia** a la memoria del proceso, así que queda dos veces en la RAM. La otra es [[mmap]] (*memory map*): el proceso pide que el archivo aparezca en sus [[memoria-virtual|direcciones virtuales]], y el sistema apunta esas páginas a la page cache, sin copiar nada. Los bytes no se leen del disco hasta que el programa toca cada página: es un fallo de página de los que leen del disco.

Eso le da tres ventajas a quien carga un modelo:

- **Abrir no cuesta:** un archivo de 100 GB se «abre» al instante; solo se lee lo que se toca.
- **Una sola copia en la RAM:** la de la page cache.
- **Se comparte:** dos procesos que abren el mismo archivo usan los mismos marcos.

Para eso existe el formato *safetensors*: un encabezado en JSON (un formato de texto con nombres y valores, como `{"dtype": "F32"}`) que dice dónde está cada tensor y, después, los números tal cual, sin nada que interpretar. Además, abrirlo no puede ejecutar código escondido, cosa que sí puede pasar con un *pickle*, el formato que usa PyTorch si no le pides otro. `torch.load(..., mmap=True)` abre con mmap los archivos de PyTorch, y vLLM, el programa que sirve el LLM de C10, lee sus safetensors con mmap. Este bloque arma un archivo de «pesos» al estilo safetensors y lo abre así:

```python
import json, mmap, os, resource, struct, sys, tempfile

def ram_mb():                          # la RSS más alta del proceso, en MB, como en la sección anterior
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / 1e6 if sys.platform == "darwin" else r * 1024 / 1e6

n = 50_000_000                         # 50 millones de pesos float32: 200 MB
encabezado = json.dumps({"capa.peso": {"dtype": "F32", "shape": [n], "data_offsets": [0, 4 * n]}}).encode()
ruta = os.path.join(tempfile.mkdtemp(), "modelo.safetensors")
with open(ruta, "wb") as f:            # el largo del encabezado, el encabezado y los números
    f.write(struct.pack("<Q", len(encabezado)) + encabezado)
    for _ in range(200):
        f.write(struct.pack("<f", 0.5) * 250_000)       # 1 MB de pesos que valen 0.5

antes = ram_mb()
with open(ruta, "rb") as f:
    m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)  # los 200 MB aparecen en la memoria
largo = struct.unpack("<Q", m[:8])[0]
info = json.loads(m[8:8 + largo])["capa.peso"]
pesos = memoryview(m)[8 + largo:].cast("f")            # los números, sin copiarlos
print(f"abrí {len(m) / 1e6:.0f} MB · tensor {info['dtype']} de {info['shape'][0]:,} números")
print(f"el peso del medio vale {pesos[n // 2]} · la RAM creció ≈ {ram_mb() - antes:.0f} MB")
print(f"todos suman {sum(pesos):,.0f} · la RAM creció ≈ {ram_mb() - antes:.0f} MB")
pesos.release(); m.close(); os.remove(ruta)
```

```salida
abrí 200 MB · tensor F32 de 50,000,000 números
el peso del medio vale 0.5 · la RAM creció ≈ 0 MB
todos suman 25,000,000 · la RAM creció ≈ 200 MB
```

Leer el encabezado y un peso del medio tocó dos páginas: la RAM ni se movió. Sumar todo tocó los 200 MB. Un detalle honesto: como el archivo se acababa de escribir, sus páginas ya estaban en la page cache y no se leyó nada del disco. Con un archivo «frío», cada página que tocas espera al disco.

### El arranque en frío

Ya puedes seguir los pesos de un LLM desde que el nodo nace hasta que responde. Es el **arranque en frío** (*cold start*): una máquina nueva, sin nada en su disco ni en su page cache. Los pesos vienen de S3, el almacén de archivos de AWS, y pasan por el disco de la máquina: un NVMe local, pegado a ella, o el disco de red con el que arranca, un gp3, que de base lee 125 MiB/s.

:::diagrama memoria-arranque
Sigue «Primer arranque en un nodo nuevo» y compáralo con «Reinicio en el mismo nodo». «Con una lectura normal» muestra la copia de más que evita mmap.
:::

:::cuenta Cargar Llama 3 8B en BF16, 16.06 GB
Los pesos // 8,030 millones de parámetros de 2 bytes | 8.03 × 10⁹ × 2 B | 16.06 GB
Desde S3, por la red // M05: ≈ 0.2 a 1 GB/s por nodo | 16.06 GB ÷ (0.2 a 1 GB/s) | ≈ 16 a 80 s
Desde un disco gp3 de base // 125 MiB/s ≈ 131 MB/s | 16.06 GB ÷ 131 MB/s | ≈ 123 s ≈ 2 min
Desde un NVMe local // ≈ 2 GB/s | 16.06 GB ÷ 2 GB/s | ≈ 8 s
Desde la page cache // un reinicio en el mismo nodo | sin tocar el disco | segundos
A la VRAM, por PCIe // ≈ 16 a 32 GB/s | 16.06 GB ÷ (16 a 32 GB/s) | ≈ 0.5 a 1 s
= El disco decide: el mismo modelo tarda 2 minutos u 8 segundos en salir del disco, y casi nada si ya estaba en la page cache. Cruzar a la GPU es lo de menos.
:::

:::calculadora memoria-carga
Prueba también el engine de C01, 0.15 GB, con el gp3 de base: ≈ 1 s. A C01 le preocupa bajar la imagen de Triton, de varios GB, no su modelo.
:::

En C10, que sirve un LLM propio con 70.6 GB de pesos, la Ronda pone el arranque completo en ≈ 5 a 10 minutos: conseguir la máquina, bajar la imagen, copiar los pesos de S3 al NVMe y cargarlos a las GPUs. Leerlos de un gp3 de base tardaría ≈ 9 minutos, contra ≈ 35 segundos del NVMe.

## Cuando la RAM se acaba: swap y OOM {When RAM runs out: swap and OOM}

Ahora imagina que los procesos de una máquina necesitan más RAM de la que hay: no la que pidieron, sino la que de verdad usan. El sistema operativo tiene tres salidas, más o menos en este orden:

1. **Soltar la [[page-cache|page cache]].** Es gratis: son copias de archivos que siguen en el disco.
2. **Mandar páginas al swap.** El [[swap]] es un pedazo del disco reservado para guardar páginas de memoria. El sistema elige las que no se han usado en un rato, las escribe ahí y libera sus marcos.
3. **Matar un proceso.** Es el [[oom|OOM]] (*out of memory*) de la lección anterior: el sistema elige un proceso, casi siempre el que más memoria usa, y lo termina de golpe para recuperar su RAM.

### El precio del swap

El swap evita matar a alguien, pero cobra. Cuando un proceso toca una página que se fue al swap, hay un fallo de página de los caros: el sistema la lee del disco. Desde un SSD tarda ≈ 100 µs, mil veces lo de la RAM; desde un disco duro, ≈ 10 ms, cien mil veces.

:::cuenta Un servidor que saca 1 de cada 100 lecturas del swap
99 lecturas de la RAM | 99 × 100 ns | 9,900 ns
1 lectura del swap, en un SSD | 1 × 100 µs | 100,000 ns
Promedio por lectura | (9,900 + 100,000) ÷ 100 | ≈ 1,099 ns
Comparado con todo en la RAM | 1,099 ÷ 100 | ≈ 11 veces más lento
Con el swap en un disco duro | (9,900 + 10,000,000) ÷ 100 | ≈ 100,099 ns: ≈ 1,000 veces
= Basta 1 % de lecturas en el swap para que todo vaya 11 veces más lento. Es la cuenta de los aciertos de la caché, un piso más abajo: pruébala en la calculadora con 99 %, 100 y 100000.
:::

Y puede ser peor. Si lo que los programas usan todo el tiempo no cabe en la RAM, el sistema saca una página, el programa la pide de vuelta, el sistema saca otra… y se pasa la vida moviendo páginas. Se llama *thrashing* («dar tumbos»): la máquina no se cae, pero se arrastra.

### Laptop contra servidor

En una laptop, el swap vale la pena: es mejor que tus apps abiertas se pongan lentas un rato a que el sistema las cierre. macOS, además, comprime la memoria poco usada antes de mandarla al swap. En la Mac de 16 GB donde se escribió esta lección, `sysctl vm.swapusage` marcaba más de 5 GB de swap en uso.

En un servidor que responde requests es al revés. Un servidor lento es peor que uno caído: las requests se tardan, se amontonan, el [[p99]] explota y nada da un error que avise. Uno caído se reinicia en segundos o se reemplaza. Por eso los servidores de producción casi siempre tienen el swap apagado. Kubernetes, tal como viene, ni siquiera arranca en una máquina con swap; las versiones recientes ya lo permiten, pero hay que activarlo a propósito en cada nodo.

### El límite de un contenedor

En la lección anterior viste que un [[contenedor]] tiene su propio tope de memoria, que el sistema operativo hace cumplir con un [[cgroup]]: si sus procesos lo pasan, los mata aunque a la máquina le sobre RAM, y Kubernetes lo reporta como **OOMKilled**, con [[codigo-salida|código de salida]] 137, el de la [[senal|señal]] SIGKILL. En C01, el contenedor de Triton pide 6 GiB y tiene ese mismo límite: si se pasa, muere de golpe y se reinicia, en vez de ponerse lento.

Con lo de esta lección ya puedes decir qué cuenta contra ese tope: la memoria propia de sus procesos y las páginas de archivos que usan activamente, como unos pesos abiertos con mmap. La page cache que nadie usa se puede soltar, y no lo mata.

### La GPU no tiene swap

En un servidor con Linux, la VRAM no tiene un piso de abajo. Si un tensor no cabe, PyTorch falla en el momento con «CUDA out of memory»: no se pone lento, truena. En Windows, en cambio, el [[driver]] de NVIDIA (el programa que maneja la GPU) puede usar la RAM como respaldo, y entonces se arrastra en vez de tronar.

## La memoria de un contenedor: workers y memoria compartida {A container's memory: workers and shared memory} [extra]

### N workers, N copias

Un servidor de Python suele correr varias copias de sí mismo para usar varios núcleos: `uvicorn --workers 4` (uvicorn es el programa que corre servidores de Python como el gateway) arranca 4 procesos, cada uno un [[worker]] que atiende requests. Cada uno tiene su propia memoria virtual. Si cada uno carga el modelo con un `torch.load` normal, hay 4 copias en la RAM. La Ronda lo advierte en M05: varios workers dentro de un contenedor «duplican la memoria».

:::cuenta Cuatro workers en un contenedor de 4 GiB
El límite // 4 GiB | 4 × 1,073,741,824 B | ≈ 4.29 GB
Memoria propia de cada worker // Python y librerías | un supuesto | ≈ 0.4 GB
Pesos del modelo // ≈ 300 millones de parámetros en FP32 | 300 M × 4 B | 1.2 GB
Cada worker con su copia | 4 × (0.4 + 1.2) | 6.4 GB: OOMKilled
Con mmap, una sola copia | 4 × 0.4 + 1.2 | 2.8 GB: cabe
= El mismo modelo y los mismos workers: con 4 copias no caben; con mmap caben y sobra un tercio del límite.
:::

:::calculadora memoria-workers
Busca cuántos workers caben con cada forma de cargar el modelo.
:::

C01 evita el problema de raíz: corre un solo proceso de uvicorn por contenedor y, si hace falta más, Kubernetes agrega réplicas (M05). Con GPU hay otra razón: cada worker carga además su propia copia de los pesos en la VRAM y su propio contexto de [[cuda|CUDA]], lo que el software de NVIDIA aparta en la GPU para cada proceso, de 0.3 a 1 GB cada uno. Ahí mmap no ayuda (M07).

### Sumar la RSS engaña

Si haces `top` en ese contenedor con mmap, cada worker marca una [[rss|RSS]] de ≈ 1.6 GB: su memoria propia más el modelo, que todos tocan. Sumarlas da 6.4 GB, más que el límite, y sin embargo caben. Las páginas compartidas aparecen en la RSS de cada uno, pero existen una sola vez. En Linux, la **PSS** (*proportional set size*) reparte cada página compartida entre quienes la usan, y ahí sí cuadra. Lo que mira el límite es el total del contenedor, no la suma de las RSS.

### fork y copy-on-write

Hay otra forma de compartir. Si el servidor carga el modelo **antes** de crear a los workers (en gunicorn, otro programa como uvicorn, la opción `--preload`), cada worker nace como una copia del proceso original con `fork`, y el sistema no copia ni un marco: los mapas apuntan a los mismos. Solo cuando alguien **escribe** en una página, esa página se copia. Se llama *copy-on-write* («copiar al escribir»).

En Python tiene una trampa: cada objeto lleva un contador de cuántos lo usan, y actualizarlo es escribir, así que los objetos chicos terminan copiados de todos modos. Los pesos, que viven en bloques grandes de números que nadie modifica, sí se quedan compartidos.

### /dev/shm: memoria compartida con nombre

Para pasarse datos grandes sin copiarlos, los procesos usan **memoria compartida**: un pedazo de RAM que varios mapean. En Linux se ve como una carpeta, `/dev/shm`, cuyos archivos viven en la RAM y no en el disco. El DataLoader de PyTorch, la pieza que arma los batches al entrenar, la usa cuando `num_workers` es mayor que 0: sus procesos preparan cada batch y lo dejan ahí. Triton, vLLM y NCCL, la librería con la que se comunican las GPUs, también la usan.

Docker le da a cada contenedor un `/dev/shm` de 64 MiB (≈ 67 MB). Un batch de 64 fotos de 3 × 224 × 224 en float32 pesa 38.5 MB, y con 4 workers que preparan 2 batches por adelantado cada uno, el DataLoader necesita del orden de 300 MB. Con 64 MiB truena con un mensaje famoso: «Unexpected bus error encountered in worker. This might be caused by insufficient shared memory (shm)».

La salida es agrandarlo: `--shm-size=1g` en Docker, `shm_size: 1g` en Docker Compose o, en Kubernetes, un volumen en memoria (`emptyDir` con `medium: Memory`) [[montaje|montado]] en `/dev/shm`, es decir, puesto en esa carpeta. Ojo: lo que se escribe ahí es RAM y cuenta contra el límite del contenedor.

## Errores comunes {Common mistakes}

### 1. Leer «free» y creer que la máquina se quedó sin RAM

`free` marca casi nada en «free», y quien lo mira se asusta o pide máquinas más grandes. Es la [[page-cache|page cache]], que se suelta en cuanto alguien necesita memoria.

**Cómo evitarlo:** mira «available» y, en un contenedor, su *working set*, la memoria que de verdad usa. Lo que avisa que falta RAM es que empiece a usarse el swap o a morir procesos.

### 2. Medir el arranque en una máquina caliente

Reinicias el servidor en tu máquina y carga en 5 segundos. En producción, un nodo nuevo tarda minutos: su page cache está vacía y su disco es otro.

**Cómo evitarlo:** mide el arranque en un nodo nuevo, o vacía antes la page cache. En Linux, como [[root]], el usuario con permiso para casi todo: `sync; echo 3 > /proc/sys/vm/drop_caches` (`sync` escribe lo pendiente y el `echo` suelta la page cache). Anota siempre de qué disco se leyó.

### 3. Dejar el swap encendido en un servidor de inferencia

Nada falla, pero la latencia sube de a poco y el p99 se dispara con más carga. Los health checks (las revisiones automáticas de que el servidor responde) pasan, así que nadie reinicia nada.

**Cómo evitarlo:** [[swap]] apagado en las máquinas que sirven, un límite de memoria en cada contenedor y una alerta cuando la memoria se acerca al límite. Mejor que muera rápido y se reinicie a que se arrastre.

### 4. Contar mal la memoria de los workers

Hay dos errores opuestos. Sumar la RSS de 4 workers que comparten un modelo abierto con mmap y concluir que no caben. O suponer que comparten el modelo cuando cada uno cargó su copia, y llevarse un OOMKilled.

**Cómo evitarlo:** mide el total del contenedor (lo que reporta Kubernetes, o en Linux la PSS, que reparte cada página compartida entre quienes la usan) y decide a propósito cómo se carga el modelo: mmap, `--preload` (cargarlo antes de crear a los workers) o un solo proceso por contenedor, como hace C01.

### 5. Recorrer los datos contra su orden

Un ciclo que va por columnas en una matriz guardada por filas, un tensor transpuesto que se usa miles de veces sin hacerlo contiguo, o millones de archivos chicos leídos al azar. El código es correcto y va varias veces más lento.

**Cómo evitarlo:** recorre en el orden en que están guardados los datos, haz `.contiguous()` una vez y no en cada paso, y empaqueta los archivos chicos en archivos grandes.

### 6. Leer los pesos de un disco de red lento

Los pesos de un LLM en el gp3 de base con el que arranca la máquina, a 125 MiB/s: los 141 GB de Llama 3 70B en BF16 (70,600 millones de parámetros de 2 bytes) tardan ≈ 18 minutos solo en leerse. Una réplica nueva, que se arrancó porque subió el tráfico, tarda esos 18 minutos de más en ayudar.

**Cómo evitarlo:** copia los pesos a un NVMe local, paga más throughput en el disco o bájalos al nodo antes de que se necesiten. Y si el modelo es chico, como el de C01, mételo en la imagen.

## En la vida real {In real life} [extra]

### C01: el servidor de la T4

El servidor de GPU de C01 es una g4dn.xlarge: 4 [[vcpu|vCPU]] (la unidad de CPU que renta la nube; en estas máquinas de Intel, cada uno es medio núcleo), 16 GiB de RAM, una T4 con 16 GB de VRAM y ≈ 125 GB de NVMe local. El engine de la ResNet-50, de ≈ 50 a 150 MB, va dentro de la imagen de Triton, y cargarlo de cualquier disco toma ≈ 1 s. Lo que tarda es bajar la imagen, de varios GB: ≈ 2 a 5 minutos, según la Ronda. El contenedor de Triton tiene 6 GiB de RAM, que se van sobre todo en las librerías de CUDA y los *buffers* (la memoria donde se acomodan los datos que van y vienen); el modelo vive en la GPU.

Y la foto de Ana nunca toca un disco. El gateway la decodifica en su RAM, pero antes de abrirla revisa su tamaño y rechaza las de más de 40 MP: una de 40 millones de píxeles abierta en RGB ocupa 40 M × 3 bytes = 120 MB.

### C07: 51 GB servidos desde la page cache

C07 busca entre 100 millones de publicaciones. Cada máquina guarda en un disco de red gp3 los vectores en FP32 de su pedazo del índice, uno de 4: 25 millones de vectores de 512 números de 4 bytes, 51.2 GB. Con ellos revisa con precisión los 200 mejores candidatos de cada búsqueda. ¿Se pueden leer del disco en cada búsqueda?

:::cuenta Por qué los vectores de C07 tienen que estar en la page cache
Búsquedas por máquina en el pico // cada búsqueda pasa por los 4 pedazos, y cada pedazo tiene 2 copias | 1,750 ÷ 2 copias | ≈ 875 por segundo
Lecturas al azar // 200 candidatos por búsqueda | 875 × 200 | 175,000 por segundo
Lo que aguanta el disco de red // el techo de EBS de esa máquina | dato de AWS | 40,000 por segundo
Faltan | 175,000 ÷ 40,000 | ≈ 4.4 veces
Precalentar // leer los 51.2 GB de corrido, si el volumen da sus 125 MiB/s de base | 51.2 GB ÷ 131 MB/s | ≈ 6.5 minutos
= Del disco no salen. Por eso C07 usa máquinas de 128 GiB, donde los 51.2 GB caben en la page cache, y una copia nueva lee sus vectores de corrido antes de recibir tráfico. Un NVMe local quitaría el precalentamiento.
:::

La Ronda lo dice con una frase que resume esta lección: dentro del índice, «un fallo de página en medio del grafo es un acceso a disco».

### C10: 70.6 GB al NVMe, leídos con mmap

C10 sirve un LLM de 70,600 millones de parámetros en FP8, en máquinas con 8 H100 y 2 TiB de RAM. Al arrancar, un primer contenedor copia los 70.6 GB de pesos de S3 al NVMe local, en ≈ 1 a 2 minutos, y verifica que ningún archivo venga alterado; luego vLLM los abre con [[mmap]]. Por eso la memoria que pide cada servidor, 256 GiB, cuenta la page cache de esos archivos, además del `/dev/shm` y los buffers. Y por eso su `/dev/shm` es grande: con los 64 MiB de siempre, los procesos de vLLM no se pueden coordinar.

En la GPU, C10 vive al borde de la VRAM. Cada conversación ocupa su [[kv-cache|KV cache]], la memoria donde el LLM guarda lo que ya calculó de ella, y cuando ya no caben, vLLM saca algunas y las recalcula después, cuando hay lugar: la persona ve una pausa y la GPU repite trabajo. Antes, vLLM también podía guardar esos bloques en la RAM de la CPU en vez de tirarlos, un «swap» un piso más arriba; la versión de hoy prefiere recalcular, porque le cuesta menos (M14). Por eso, dice la Ronda en C10, en un LLM la memoria es la capacidad: contar las conversaciones que se sacan avisa del problema antes que la latencia.

### El Jetson y tu Mac: una sola memoria

En un Jetson, el equipo chico de NVIDIA para el *edge* (el cómputo junto a donde nacen los datos, como una cámara), la CPU y la GPU comparten la misma RAM: no hay VRAM aparte. Un Orin Nano de 8 GB, con el sistema y la app usando ≈ 2.5 GB, le deja al modelo ≈ 5.5 GB como máximo (M04). Las Mac con chip de Apple hacen lo mismo con su «memoria unificada»: la GPU de la M4 usa los mismos 16 GB que la CPU. La ventaja es que no hay copia por PCIe; el costo, que todo compite por la misma memoria y por el mismo ancho de banda.

### Fuera de ML

- **Tu celular** cierra las apps que dejaste atrás cuando le falta memoria: al volver a una, empieza desde cero. Es un OOM a propósito, para que la app que estás usando no se arrastre.
- **Redis**, una base de datos que guarda todo en la RAM, responde en microsegundos, pero si se reinicia pierde lo que no haya escrito al disco. La Ronda (M02) lo apunta al elegir una cola: «durabilidad según cómo persista Redis».
- **Postgres**, una de las bases de datos más usadas, guarda en su propia RAM las páginas de las tablas que más lee y deja el resto a la page cache del sistema. Su documentación sugiere darle para eso ≈ 25 % de la RAM de la máquina: la page cache hace lo demás.
- **Los videojuegos** tienen pantallas de carga porque copian del disco a la RAM y a la VRAM. El SSD del PlayStation 5, de 5.5 GB/s, casi hizo desaparecer las que el PlayStation 4 sufría con su disco duro.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de aciertos, carga y workers se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] A escala humana (1 ns = 1 s), ¿cuánto tardan una lectura de la L2 (≈ 4 ns), una de la RAM (≈ 100 ns), una lectura al azar de un NVMe (≈ 80 µs) y una de un disco duro (≈ 12 ms)?
- L2: 4 ns × 10⁹ = **4 s**.
- RAM: 100 ns × 10⁹ = 100 s = **1 min 40 s**.
- NVMe: 80 µs = 80,000 ns → 80,000 s; entre 3,600 s por hora, **≈ 22 horas**.
- Disco duro: 12 ms = 12,000,000 ns → 12,000,000 s; entre 86,400 s por día, **≈ 139 días**, unos 4 meses y medio.
? [facil] Una línea de caché mide 64 bytes. ¿Cuántos float32 trae? ¿Cuántos píxeles RGB en uint8? ¿Cuántas líneas ocupa una fila de 224 números float32?
- float32: 64 ÷ 4 = **16**.
- Un píxel RGB en uint8 son 3 bytes: 64 ÷ 3 = 21.3, así que **21 píxeles completos** y un pedazo del siguiente.
- Una fila de 224 float32: 224 × 4 = 896 bytes, y 896 ÷ 64 = **14 líneas**.
? [facil] Se va la luz en el servidor de GPU de C01. ¿Qué se pierde y qué se queda: el engine en el disco, los pesos en la VRAM, el tensor de una foto a la mitad y una línea de log que el servidor acaba de escribir?
- Se queda **el engine**, que está en el disco.
- Se pierden **los pesos en la VRAM** y **el tensor**, que estaban en la VRAM y en la RAM. Al volver, el servidor repite el arranque, y alguien tiene que reintentar esa request.
- La línea de log, **depende**: si ya llegó al disco, se queda; si seguía en la page cache esperando a escribirse, también se pierde.
? [facil] El ONNX de C01 en FP32 pesa ≈ 98 MB. ¿Cuánto tarda en leerse de un disco gp3 de base (125 MiB/s) y de un NVMe a 2 GB/s? ¿Y los 141 GB de Llama 3 70B en BF16, del mismo gp3?
- gp3: 125 MiB/s = 125 × 1,048,576 ≈ 131 MB/s, y 98 ÷ 131 ≈ **0.75 s**.
- NVMe: 98 MB ÷ 2,000 MB/s ≈ **0.05 s**.
- Llama 3 70B: 141,000 MB ÷ 131 MB/s ≈ 1,076 s ≈ **18 minutos**. Para un modelo chico, el disco no importa; para un LLM, decide el arranque.
? [medio] Una lectura acierta en la L1 (1 ns) el 98 % de las veces y las demás van a la RAM (100 ns). ¿Cuánto tarda en promedio? ¿Y con 90 %? ¿Qué parte del tiempo se va en fallos en cada caso?
- 98 %: 0.98 × 1 + 0.02 × 100 = 0.98 + 2 = **2.98 ns**. Los fallos se llevan 2 ÷ 2.98 ≈ **67 %** del tiempo.
- 90 %: 0.9 × 1 + 0.1 × 100 = 0.9 + 10 = **10.9 ns**, casi 11 veces lo de un acierto. Los fallos se llevan 10 ÷ 10.9 ≈ **92 %**.
- Bajar de 98 % a 90 % de aciertos hace cada lectura ≈ 3.7 veces más lenta.
? [medio] Una imagen en escala de grises de 2,000 × 2,000 píxeles en float32 se guarda por filas, y una caché de 32 KiB la recorre. ¿Cuántos bytes ocupa? ¿Cuántos fallos hay por filas? ¿Y por columnas, si cada lectura cae en una línea que ya se fue? ¿Cuánto tarda cada recorrido con 1 ns por acierto y 100 ns por fallo?
- Bytes: 2,000 × 2,000 × 4 = **16,000,000 B**, 16 MB: no cabe en 32 KiB.
- Por filas: 16,000,000 ÷ 64 = **250,000 fallos**, uno cada 16 lecturas.
- Por columnas: cada una de las 4,000,000 lecturas es un fallo: **4,000,000**, 16 veces más.
- Tiempo por filas: cada lectura promedia 15/16 × 1 + 1/16 × 100 ≈ 7.19 ns, y 4,000,000 × 7.19 ns ≈ **29 ms**. Por columnas: 4,000,000 × 100 ns = **400 ms**.
? [medio] En el código de la memoria virtual, cambia el `4096` por `16384`: un byte cada 16 KiB. ¿Cuánto crece la RAM en Linux, con páginas de 4 KiB? ¿Y en una Mac con chip de Apple, con páginas de 16 KiB?
- Escribes 400,000,000 ÷ 16,384 ≈ 24,414 bytes, uno cada 16 KiB.
- **Linux, páginas de 4 KiB:** cada byte cae en una página distinta, pero solo tocas 1 de cada 4 páginas. Crece ≈ **100 MB**.
- **Mac, páginas de 16 KiB:** tocas todas las páginas. Crece ≈ **400 MB**, igual que antes.
- La memoria se entrega de página en página: no cuentan los bytes que escribes, sino cuántas páginas tocas.
? [medio] Un servidor saca de la RAM (100 ns) el 99.9 % de sus lecturas y el 0.1 % del swap en un SSD (100 µs). ¿Cuánto tarda una lectura en promedio, y cuántas veces más que si todo estuviera en la RAM? ¿Y con el swap en un disco duro (10 ms)?
- SSD: 0.999 × 100 + 0.001 × 100,000 = 99.9 + 100 = **199.9 ns**: **≈ 2 veces** más lento.
- Disco duro: 99.9 + 0.001 × 10,000,000 = 99.9 + 10,000 = **10,099.9 ns**: **≈ 101 veces**.
- Hasta 0.1 % de swap duplica el promedio. Y el promedio esconde lo peor: esa lectura de cada mil tarda mil veces más y le cae a alguna request, justo en su p99.
? [reto] Un contenedor con límite de 8 GiB sirve con uvicorn un modelo de 2 GB en CPU. Cada worker usa ≈ 500 MB propios. (a) Si cada worker carga su copia, ¿cuántos caben? (b) ¿Y si abren el modelo con mmap? (c) Con 6 workers y mmap, ¿cuánto da la suma de sus RSS y cuánto ocupan de verdad?
- El límite: 8 × 1,073,741,824 B ≈ **8.59 GB**.
- (a) Cada worker ocupa 0.5 + 2 = 2.5 GB, y 8.59 ÷ 2.5 = 3.4: caben **3**. Con 4 serían 10 GB: OOMKilled.
- (b) El modelo va una sola vez: quedan 8.59 − 2 = 6.59 GB para los workers, y 6.59 ÷ 0.5 = 13.2: caben **13**.
- (c) Cada RSS marca 0.5 + 2 = 2.5 GB, y la suma de 6 da **15 GB**, casi el doble del límite. De verdad ocupan 6 × 0.5 + 2 = **5 GB**. Por eso se mide el total del contenedor, no la suma de las RSS.
? [reto] C10 arranca una réplica en una máquina nueva, con 70.6 GB de pesos. (a) ¿Cuánto tarda en leerlos de un disco gp3 de base y de un NVMe a 2 GB/s? (b) Bajarlos de S3 al NVMe toma ≈ 1 a 2 minutos: ¿a qué ritmo? (c) Si la réplica se reinicia en la misma máquina y los pesos siguen en la page cache, ¿qué paso desaparece? (d) ¿Por qué C10 no mete los pesos en la imagen de Docker, como C01?
- (a) gp3: 70.6 GB ÷ 131 MB/s ≈ 539 s, **≈ 9 minutos**. NVMe: 70.6 ÷ 2 ≈ **35 s**.
- (b) 70.6 GB en 60 a 120 s son **≈ 0.6 a 1.2 GB/s**: el ritmo de bajar de S3 con muchas descargas en paralelo.
- (c) Desaparece leer el disco: los pesos salen de la RAM. Quedan cargarlos a las GPUs y preparar el servidor, ≈ 1 a 2 minutos según la Ronda.
- (d) Una imagen de más de 70 GB sería lentísima de bajar y de descomprimir en cada máquina, y cada versión del modelo pediría otra imagen gigante. Además, en ECR, el registro de imágenes de AWS, cada capa tiene un tope de ≈ 54.5 GB (M05). C01 sí puede, porque su engine pesa ≈ 50 a 150 MB.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M04 · Hardware para inferencia** separa la RAM del *host*, la máquina donde va la GPU, de la VRAM: la primera es mucha, barata y con poco ancho de banda. También explica la memoria fijada para copiar a la GPU, la memoria unificada del Jetson y la memoria rápida dentro del chip.
- **M05 · Contenedores** trae los 125 MiB/s del gp3 como cuello de botella, el NVMe local, la decisión de meter los pesos en la imagen o bajarlos al arrancar, el `/dev/shm` de 64 MiB y los workers que duplican la memoria.
- **M06 · Orquestación** pone el límite de memoria de cada contenedor y explica el OOMKilled; **M07 · Servidores de modelos** cuenta las copias que hace `uvicorn --workers`.
- **Los casos.** C01 (el engine en la imagen y el límite de 6 GiB), C07 (la page cache y el precalentamiento) y C10 (de S3 al NVMe, con mmap).

**En el Dojo:** la estación 7, «Empaquetado», hace la cuenta del disco antes de bajar una imagen: la de Triton pesa ≈ 10 GB comprimida y pide ≈ 30 GB mientras se descomprime. Ahí decides si el modelo va dentro de la imagen.

**En Sensei:** la siguiente lección, «CPU y GPU», abre los núcleos de cada chip, PCIe y la memoria de las GPUs grandes. Después, «El sistema operativo» explica los archivos, los montajes y los cgroups que ponen el límite de un contenedor, y «Hacer varias cosas a la vez» vuelve a los workers.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
ram cache-cpu disco ssd jerarquia-memoria localidad memoria-virtual swap page-cache mmap rss
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué una computadora tiene RAM y disco, y no una sola memoria?
Porque ninguna memoria es rápida, grande, barata y permanente a la vez. La RAM es rápida (≈ 100 ns), pero cara, y se borra al apagar; el disco guarda sin luz, pero tarda de ≈ 0.1 a 10 ms. La CPU solo calcula con lo que está en la RAM, así que todo se carga del disco antes de usarse.
? ¿Qué es un fallo de caché, y por qué unos pocos cambian tanto el promedio?
Es cuando el dato no está en la caché y hay que traerlo de la RAM: ≈ 100 ns en vez de ≈ 1 ns. Con 95 % de aciertos, el promedio es ≈ 6 ns, y el 84 % del tiempo se va en ese 5 % de fallos.
? ¿Por qué recorrer una matriz por filas es más rápido que por columnas?
Porque se guarda fila tras fila y la caché trae líneas de 64 bytes: por filas, cada línea sirve para 16 float32; por columnas, cada lectura cae en una línea distinta. Es la localidad espacial.
? ¿Qué es la RSS de un proceso, y por qué no basta con su tamaño virtual?
Es la parte de su memoria que está en la RAM ahora. Un proceso puede reservar mucho sin ocupar nada: la RAM se entrega de página en página, cuando escribe en cada una. Ojo: la RSS también cuenta las páginas compartidas con otros procesos.
? ¿Por qué el segundo arranque de un modelo es mucho más rápido que el primero?
Porque los pesos quedaron en la page cache, en la RAM libre, y el segundo arranque no toca el disco. Por eso medir en una máquina caliente engaña.
? ¿Por qué los servidores de inferencia apagan el swap?
Porque el swap no tumba al servidor: lo vuelve lento sin avisar. Cada página que vuelve del swap tarda de mil a cien mil veces lo de la RAM. Es mejor que el proceso muera con un OOM y se reinicie.
:::
