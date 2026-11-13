---
titulo: Máquinas, GPUs y cómo se cobran
en: Machines, GPUs and how they are billed
subtitulo: Qué es exactamente lo que rentas cuando pides una GPU en la nube, cómo se lee su nombre, cuánto cuesta cada hora y cada predicción, y las cuatro maneras de pagarla.
pregunta: C01 paga ≈ US$768 al mes por dos GPUs que trabajan al 5 %. ¿Qué renta exactamente, por qué cuesta eso, y cómo se paga menos sin que un día se quede sin máquinas?
requisitos: cpu-gpu, flops, nube
---

:::idea
En la nube no compras una GPU: rentas una **instancia**, una máquina virtual con CPU, RAM, disco, red y GPUs, que se cobra por cada hora que está encendida, trabaje o no. Para comparar se divide entre sus GPUs (la **GPU-hora**) y luego entre las predicciones que de verdad hace (el **costo por predicción**). Después decides cómo pagarla: precio de lista, capacidad sobrante que te pueden quitar (spot) o un compromiso de un año. Y ninguno de los tres te garantiza que haya máquinas el día que las pidas.
:::

C01 sirve su ResNet-50 en dos máquinas `g4dn.xlarge`, una en cada [[zona-disponibilidad|zona]]. Cada una trae una GPU T4 y cuesta ≈ US$0.526 la hora en la región `us-east-1`, en Virginia (noviembre de 2026). Al mes son ≈ US$768. En un día normal, cada T4 atiende ≈ 58 fotos por segundo (la mitad de las ≈ 116 que llegan en promedio), y aguanta ≈ 1,200. Trabaja al ≈ 5 % de lo que podría (58 ÷ 1,200).

Eso no es un error de diseño: la segunda T4 está ahí para que el sistema sobreviva si se cae una zona, como viste en la lección de [[region|regiones]]. Pero sí dice algo importante sobre cómo cobra la nube. **Te cobra la máquina encendida, no el trabajo que hace.** Una GPU al 5 % cuesta casi lo mismo que al 100 %.

En la lección de CPU y GPU viste qué hay dentro de una [[gpu|GPU]], y en la de FLOPS, qué tan rápido calcula y lee memoria. En la de [[nube]] viste que lo que rentas es una [[maquina-virtual|máquina virtual]], cobrada con [[pago-por-uso|pago por uso]]. Aquí juntas las tres: qué máquinas hay, qué GPUs traen, cuánto cuestan y cómo se paga menos. Al final harás la cuenta que hace cualquier equipo antes de elegir una GPU: **cuánto cuesta cada predicción, con el tráfico de verdad**.

## La instancia: lo que de verdad rentas {The instance: what you actually rent}

Una **[[instancia]]** (*instance*) es una máquina virtual que rentas por hora a un [[proveedor-nube|proveedor de nube]]. No es una computadora física entera: es un pedazo de una, apartado para ti por el [[hipervisor]]. Tú ves una computadora completa, con su sistema operativo, y el proveedor reparte la máquina física entre varios clientes.

Cada instancia trae cinco cosas, y las cinco importan para ML:

- **vCPU.** La unidad de CPU que renta la nube. En la lección de CPU y GPU viste que en las máquinas de Intel de AWS un [[vcpu|vCPU]] es un hilo de hardware, medio [[nucleo|núcleo]] físico. La CPU decodifica las fotos, arma los [[batch|lotes]] y le da trabajo a la GPU.
- **RAM.** La memoria de la CPU, en GiB. Ahí viven el programa, las bibliotecas de [[cuda|CUDA]] y los datos mientras pasan a la GPU.
- **Disco.** Casi siempre, un disco de red que se cobra aparte: vive en otro servidor y la máquina lo ve como si fuera suyo, a través de la red (en AWS se llama EBS). Algunas familias traen además un [[ssd|SSD]] **NVMe** local: pegado a la máquina física y conectado por la vía más rápida que existe para un SSD. Es rapidísimo, pero se borra cuando apagas la máquina.
- **Red.** Cuántos gigabits por segundo puede mandar y recibir: por ahí llegan las fotos y se baja el modelo. La lección de redes en la nube lo detalla.
- **GPUs.** Cero, una, cuatro u ocho, de un modelo fijo. No eliges la GPU por separado: eliges una instancia que la trae.

El precio por hora cubre todo eso junto (menos el disco de red). Por eso dos instancias con la misma GPU pueden costar muy distinto: una puede traer el doble de CPU y de RAM.

### Familias y tamaños: leer `g4dn.xlarge`

AWS ordena sus instancias en **[[familia-instancia|familias]]** (*instance families*): grupos de máquinas con el mismo tipo de hardware, en varios tamaños. El nombre se lee por partes.

:::figura maquinas-nombre
El nombre de una instancia de AWS, por partes. Arriba, la de C01; abajo, la de ocho H100. La regla de los tamaños (cada «xlarge» son 4 vCPU) se cumple en las instancias de las tablas.
:::

- **La letra** dice para qué es la familia. Las de GPU son dos: la **g** (GPUs para inferencia y gráficos: T4, A10G, L4, L40S) y la **p** (GPUs grandes para entrenar y para modelos enormes: A100, H100, H200, B200). Otras letras son de CPU: la **c** es de cómputo (el [[api-gateway|gateway]] de C01, la puerta que recibe las peticiones antes del modelo, es una `c6i.xlarge`), la **m** es de uso general y la **r** trae mucha RAM.
- **El número** es la generación. Una `g6` es más nueva que una `g4dn`, y casi siempre trae otra GPU.
- **Las letras de después** son extras. En `g4dn`, la **d** dice que trae disco NVMe local y la **n**, red más rápida. La `i` de `c6i` dice que el procesador es de Intel.
- **Después del punto**, el tamaño. `large` son 2 vCPU y `xlarge` son 4. El número de adelante multiplica esos 4: `2xlarge` son 2 × 4 = 8, `12xlarge` son 48 y `48xlarge` son 192.

En las familias de GPU, el tamaño también decide cuántas GPUs vienen. Las `xlarge` traen una. Una `g4dn.12xlarge` trae cuatro T4 y 48 vCPU. Una `p5.48xlarge` trae ocho H100 y 192 vCPU. Y hay tamaños en medio, como la `g6.2xlarge`, que trae **la misma L4** que la `g6.xlarge` pero con el doble de vCPU y de RAM.

| Instancia | vCPU | RAM | GPUs | ≈ US$/h (us-east-1, nov. 2026) |
|---|---|---|---|---|
| `c6i.xlarge` (el gateway de C01) | 4 | 8 GiB | ninguna | 0.17 |
| `g4dn.xlarge` (C01) | 4 | 16 GiB | 1 × T4 | 0.526 |
| `g6.xlarge` | 4 | 16 GiB | 1 × L4 | 0.805 |
| `g5.xlarge` | 4 | 16 GiB | 1 × A10G | 1.006 |
| `g6e.xlarge` | 4 | 32 GiB | 1 × L40S | 1.861 |
| `g4dn.12xlarge` | 48 | 192 GiB | 4 × T4 | 3.912 |
| `p5.48xlarge` | 192 | 2,048 GiB | 8 × H100 | 55.04 |

:::ojo GiB no es GB
La RAM de las instancias de AWS y Azure viene en **GiB** (2³⁰ bytes, ≈ 1.074 GB), como viste en la lección de [[prefijo-binario|unidades]]. La memoria de la GPU (la [[vram|VRAM]]) y su ancho de banda vienen en **GB** (10⁹ bytes). Los 16 GiB de RAM de la `g4dn.xlarge` son ≈ 17.2 GB; los 16 GB de VRAM de su T4 son 16 GB. Google mezcla: en unas familias escribe GB y en otras GiB. Cuando sumes memorias, convierte primero.
:::

### Instancias de un grupo: el nodo

Las dos `g4dn.xlarge` de C01 no viven solas. Son parte de un **cluster**: un grupo de máquinas que trabajan juntas bajo un mismo programa que reparte el trabajo. En C01 ese programa es Kubernetes, el [[orquestacion|orquestador]] que decide en qué máquina corre cada programa. Cada máquina del grupo se llama **[[nodo]]** (*node*). Un nodo es una instancia vista desde el cluster: su CPU, su RAM y sus GPUs son el espacio donde el cluster acomoda programas.

La diferencia importa por una razón: cuando el cluster necesita otra GPU, no basta con arrancar otra copia de Triton, el programa que sirve el modelo de C01. Hay que **pedirle a la nube otra instancia**, esperar a que arranque y a que se una al grupo. Eso toma minutos, no segundos. Las estaciones de Kubernetes explican quién hace ese pedido; aquí te importa lo que pasa del otro lado: si hay cuota, si hay máquinas y cuánto se cobra desde ese momento.

## Las GPUs que se rentan {The GPUs you can rent}

En la lección de FLOPS aprendiste los tres números de una GPU que deciden casi todo: cuánta **memoria** tiene (la [[vram|VRAM]], que dice qué modelo cabe), qué tan rápido la **lee** (el [[ancho-banda-memoria|ancho de banda de memoria]], que manda cuando el trabajo es [[memory-bound]]) y cuántas operaciones hace por segundo (los [[tflops|TFLOPS]], que mandan cuando es [[compute-bound]]). Aquí van esos números para las GPUs que de verdad se rentan, con su precio.

La tabla sale de las hojas de datos de los fabricantes y de las listas de precios oficiales, consultadas el 13 de noviembre de 2026. El año entre paréntesis es el del anuncio del fabricante. Los TFLOPS son **densos**, en [[fp16|FP16]] con [[tensor-core|tensor cores]]: los que ve un modelo normal, sin el truco de la *sparsity* que se explica abajo.

Dos columnas más piden explicación. La de «BF16 · FP8» dice si la GPU calcula en esos dos formatos de números ([[bf16|BF16]] y [[fp8|FP8]]). Junto a la VRAM va su tipo: GDDR6 es la memoria de las tarjetas de video comunes; [[hbm|HBM]] es memoria apilada junto al chip, mucho más rápida y más cara.

| GPU | VRAM | Ancho de banda | FP16 denso | BF16 · FP8 | Potencia | ≈ US$ por GPU-hora en AWS (us-east-1) |
|---|---|---|---|---|---|---|
| T4 (2018) | 16 GB GDDR6 | 320 GB/s | 65 TFLOPS | No · No | 70 W | 0.526 (`g4dn.xlarge`) |
| L4 (2023) | 24 GB GDDR6 | 300 GB/s | 121 | Sí · Sí | 72 W | 0.805 (`g6.xlarge`) |
| A10G (2021) | 24 GB GDDR6 | 600 GB/s | 70 | Sí · No | 300 W | 1.006 (`g5.xlarge`) |
| L40S (2023) | 48 GB GDDR6 | 864 GB/s | 362 | Sí · Sí | 350 W | 1.861 (`g6e.xlarge`) |
| A100 80 GB (2020) | 80 GB HBM2e | 2,039 GB/s | 312 | Sí · No | 400 W | 3.43 (`p4de.24xlarge` ÷ 8) |
| H100 SXM (2022) | 80 GB HBM3 | 3,350 GB/s | 989.5 | Sí · Sí | 700 W | 6.88 (`p5.48xlarge` ÷ 8) |
| H200 (2023) | 141 GB HBM3e | 4,800 GB/s | 989.5 | Sí · Sí | 700 W | 7.91 (`p5en.48xlarge` ÷ 8) |
| B200 (2024) | 180 GB HBM3e | ≈ 8,000 GB/s | 2,250 | Sí · Sí | hasta 1,000 W | 14.24 (`p6-b200.48xlarge` ÷ 8) |
| AMD MI300X (2023) | 192 GB HBM3 | 5,300 GB/s | 1,300 | Sí · Sí | 750 W | — (Azure, eastus2: 6.00) |

Tres cosas saltan a la vista:

- **El precio sube más rápido que la memoria.** De la T4 a la H100, la VRAM crece 5 veces y el precio por hora, 13. Si tu modelo cabe en 16 GB, pagar por 80 es tirar dinero.
- **La H200 tiene el mismo cómputo que la H100.** Lo que cambia es la memoria: 141 GB y 4,800 GB/s. Para un [[llm|LLM]] que genera texto, limitado por memoria, eso es casi todo; para una ResNet-50, casi nada.
- **La A10G y la L4 se parecen en VRAM y no en lo demás.** La A10G lee el doble de rápido (600 contra 300 GB/s) y gasta cuatro veces la energía. La L4 calcula más y trae FP8. Cuál conviene depende de si tu modelo es memory-bound o compute-bound.

:::ojo Dos trampas de las hojas de datos
**La sparsity.** NVIDIA publica casi todos sus TFLOPS «*with sparsity*», el doble de lo que ve un modelo normal. Esa cifra solo se alcanza si la mitad de los pesos del modelo son cero, acomodados en un patrón especial; casi ningún modelo es así (la lección de FLOPS lo explica). La página de la H100 dice 1,979 TFLOPS en FP16; los densos son ≈ 989.5. La de la L4 dice 242; son ≈ 121. La A100, la L40S y la MI300X sí publican las dos cifras (la L40S: 362 densos y 733 con sparsity), y la T4 publica una sola, que ya es densa porque no tiene sparsity. **Divide entre 2 cuando solo veas la cifra con *sparsity***: sale una aproximación (en la L40S daría 366.5 contra los 362 que publica).

**El mismo nombre, otra GPU.** «H100» son tres tarjetas. La **SXM** (la que va montada en una placa de ocho, en vez de enchufarse en una ranura [[pcie|PCIe]] como una tarjeta de video; es la de AWS, Google y las `ND H100 v5` de Azure) trae 80 GB a 3,350 GB/s, gasta hasta 700 W y se conecta con sus vecinas por [[nvlink|NVLink]] a 900 GB/s. La **PCIe** trae 80 GB a ≈ 2,000 GB/s y 350 W. La **NVL** (la de las `NC H100 v5` de Azure, y una de las tres que renta RunPod) trae 94 GB a 3,900 GB/s. Lo mismo con la A100: la `NC24ads_A100_v4` de Azure es PCIe, con 1,935 GB/s en vez de 2,039. Lee siempre la versión.
:::

:::profundo Por qué las GPUs grandes vienen de a ocho
La A100 y la H100 de AWS (salvo la `p5.4xlarge`) solo se rentan en máquinas de ocho. No es capricho. Esas GPUs son **SXM**: no se enchufan en una ranura PCIe como una tarjeta de video, sino que se montan en una placa que trae ocho y un chip, el **NVSwitch**, que conecta a cada una con las otras siete por [[nvlink|NVLink]]: a 900 GB/s en la H100 y a 600 GB/s en la A100. Los 900 son ≈ 7 veces lo que da un PCIe Gen5 (128 GB/s). Para repartir un modelo de 140 GB entre dos o más GPUs, o para entrenar con las ocho a la vez, esos cables son lo que importa: las GPUs se pasan pedazos del modelo o de los gradientes en cada paso.

Por eso la unidad mínima de A100 en AWS es una instancia de ≈ US$22–27 la hora. La `p5.4xlarge`, con una H100 suelta a ≈ US$6.88, existe para quien solo necesita una; cuesta lo mismo por GPU-hora que la de ocho. Y la H100 NVL de Azure es otra solución: tarjetas PCIe unidas por un puente NVLink de dos en dos, a 600 GB/s.
:::

:::profundo Las mismas GPUs en Google, Azure y las neoclouds
AWS no es la única opción, ni la más barata. Google Cloud y Azure tienen casi las mismas GPUs. Y existen las **[[neocloud|neoclouds]]**, proveedores que solo rentan GPUs, como Lambda y RunPod.

| GPU | Google Cloud (us-central1) | Azure (East US) | Neocloud |
|---|---|---|---|
| T4 | US$0.35 la GPU **más** la VM que la hospeda | 0.526 (`NC4as_T4_v3`) | — |
| L4 | 0.71 (`g2-standard-4`) | — | RunPod 0.69 |
| A100 80 GB | 5.07 por GPU (`a2-ultragpu-1g`) | 3.67 (`NC24ads_A100_v4`, PCIe) | Lambda 3.19 · RunPod 2.19 |
| H100 | 11.06 por GPU (`a3-highgpu-8g` ÷ 8) | 12.29 por GPU (`ND96isr_H100_v5` ÷ 8) | Lambda 4.59 · RunPod 4.39 |

Precios de lista on-demand por GPU-hora, en US$, de noviembre de 2026. Los de Lambda son los que publica desde el 16 de noviembre. Los de RunPod son los de su *Secure Cloud* (centros de datos certificados); en su *Community Cloud*, con máquinas de terceros, cuestan menos (la H100 SXM, US$2.69; la A100 SXM, 1.39).

Fíjate en la T4 de Google: es la única fila donde **la GPU se cobra aparte**. Rentas una máquina normal de la familia N1 y le «enchufas» una T4 por US$0.35 la hora más. En las familias nuevas de Google (A2, A3, G2, G4) la GPU ya va incluida en el precio de la máquina, como en AWS. Si comparas el US$0.35 contra el US$0.526 de AWS sin sumar la VM, comparas una GPU sola contra una computadora completa.
:::

## La GPU-hora: el mismo chip, muchos precios {The GPU-hour: one chip, many prices}

Para comparar máquinas con distinto número de GPUs se usa una unidad: la **[[gpu-hora|GPU-hora]]** (*GPU-hour*), una GPU encendida durante una hora. Se calcula dividiendo el precio de la instancia entre sus GPUs.

:::cuenta De la hora al mes, y de la instancia a la GPU
Una T4 de C01 // `g4dn.xlarge`, us-east-1, nov. 2026 | 0.526 US$/h × 730 h | ≈ US$384 al mes
Las dos de C01 // una por zona | 2 × 384 | ≈ US$768 al mes
Ocho H100 // `p5.48xlarge` | 55.04 US$/h ÷ 8 GPUs | ≈ US$6.88 por GPU-hora
Una H100 todo el mes | 6.88 × 730 | ≈ US$5,022
= La nube cobra por hora; para planear se multiplica por 730, las horas de un mes promedio (8,760 ÷ 12).
:::

El número de 730 horas es una convención: las 8,760 horas de un año de 365 días, repartidas en 12 meses iguales. Así lo usan las calculadoras de los proveedores y la Ronda.

### Más grande no es más barato

En el súper, el paquete grande sale más barato por kilo. En la nube, casi nunca. Mira cuánto cuesta cada T4 según la instancia que la trae:

- En la `g4dn.xlarge`: ≈ US$0.526 por GPU-hora.
- En la `g4dn.12xlarge`, con cuatro: US$3.912 ÷ 4 ≈ **US$0.978** por GPU-hora. Casi el doble.

La T4 es la misma. Lo que pagas de más es la CPU y la RAM: la grande trae 48 vCPU y 192 GiB, doce veces más que la chica, para cuatro veces más GPUs. Con la L4 pasa lo mismo: en la `g6.xlarge` cuesta ≈ US$0.805 y en la `g6.48xlarge`, con ocho, ≈ US$1.67 cada una.

:::profundo La GPU-hora de todas las instancias, en Python
El programa hace la misma división para cada instancia de las tablas y agrega una columna: cuánto cuesta cada GB de VRAM por hora.

```python
# instancia: (GPUs, US$/h en us-east-1, VRAM por GPU en GB) — AWS, noviembre de 2026
instancias = {
    "g4dn.xlarge":   (1, 0.526,   16),
    "g4dn.12xlarge": (4, 3.912,   16),
    "g6.xlarge":     (1, 0.8048,  24),
    "g5.xlarge":     (1, 1.006,   24),
    "g6e.xlarge":    (1, 1.861,   48),
    "p4de.24xlarge": (8, 27.44705, 80),
    "p5.48xlarge":   (8, 55.04,   80),
    "p5en.48xlarge": (8, 63.296, 141),
}
print(f"{'instancia':15} {'GPU-hora':>9} {'al mes':>8} {'por GB de VRAM':>15}")
for nombre, (gpus, hora, vram) in instancias.items():
    gpu_hora = hora / gpus                      # lo que cuesta una GPU durante una hora
    mes = gpu_hora * 730                        # una GPU encendida todo el mes
    por_gb = gpu_hora / vram * 100              # centavos por GB de VRAM por hora
    print(f"{nombre:15} {gpu_hora:9.3f} {mes:8,.0f} {por_gb:12.2f} ¢")
```

```salida
instancia        GPU-hora   al mes  por GB de VRAM
g4dn.xlarge         0.526      384         3.29 ¢
g4dn.12xlarge       0.978      714         6.11 ¢
g6.xlarge           0.805      588         3.35 ¢
g5.xlarge           1.006      734         4.19 ¢
g6e.xlarge          1.861    1,359         3.88 ¢
p4de.24xlarge       3.431    2,505         4.29 ¢
p5.48xlarge         6.880    5,022         8.60 ¢
p5en.48xlarge       7.912    5,776         5.61 ¢
```

La última columna es una manera de ver qué tan cara es la memoria. La H200 (`p5en`) cuesta 15 % más por hora que la H100 y trae 76 % más memoria: por GB sale bastante más barata. Si tu problema es que el modelo no cabe, esa columna importa más que los TFLOPS.
:::

### El mismo chip en cinco nubes

La H100 SXM es la misma tarjeta en todos lados. Su precio no: en noviembre de 2026, una hora costaba ≈ US$12.29 en Azure y ≈ US$4.39 en RunPod, casi tres veces menos. Y los precios cambian seguido. **Antes de diseñar, consulta el precio del día.**

:::profundo Cinco precios para el mismo chip
:::figura maquinas-h100
Lo que cuesta una hora de la misma H100 SXM según quién la rente, en noviembre de 2026 (RunPod: su *Secure Cloud*). La más cara cuesta casi tres veces la más barata.
:::

Las nubes grandes (las de *hiperescala*: AWS, Google Cloud y Azure, con centros de datos en medio mundo) cobran más por la misma GPU porque venden algo más que la GPU: la red privada, los permisos, el almacenamiento a un lado, el soporte, las zonas, y que tu sistema ya vive ahí. Una neocloud es más barata por GPU-hora y trae menos de todo eso. La lección de [[nube]] explica cuándo vale la pena.

Y las listas de precios no siguen la lógica del hardware. En Google, una hora de H200 (≈ US$10.60) cuesta **menos** que una de H100 (≈ US$11.06), aunque la H200 es mejor. Los precios los decide cada proveedor según sus costos, su inventario y su competencia, y cambian: AWS bajó los de P4 y P5 hasta 45 % en junio de 2025.
:::

### Right-sizing: la más chica que cumple

Juntando todo sale una regla que la Ronda repite: **para inferencia, gana la instancia más chica que trae tu GPU**. Eso se llama **[[right-sizing]]**: elegir el tamaño justo, ni más ni menos. Tres razones:

- **Por GPU-hora, la chica es más barata**, como acabas de ver.
- **Escalas más fino.** Con instancias de una GPU, el sistema crece de una en una. Con instancias de cuatro, cada paso es de cuatro GPUs, aunque te falte una.
- **Una falla se lleva menos.** Si se cae una máquina de una GPU, pierdes una; si se cae una de ocho, pierdes ocho.

Hay excepciones, y las tres tienen sentido:

- **El modelo no cabe en una GPU.** Un modelo de 140 GB no entra en ninguna tarjeta de 80. Hay que repartirlo entre varias GPUs de la misma máquina, que se hablan por [[nvlink|NVLink]]: por eso las A100 y H100 vienen de a ocho.
- **Entrenar con muchas GPUs.** Las GPUs se pasan gradientes todo el tiempo y necesitan los cables rápidos de la misma máquina.
- **El preproceso necesita CPU.** En el caso de segmentación de imágenes médicas de la Ronda (c04), cada L4 necesita más CPU de la que trae la `g6.xlarge` para abrir y cortar en pedazos las enormes imágenes de microscopio, y se usa la `g6.2xlarge`: la misma GPU, el doble de vCPU, ≈ US$0.98 la hora. Ahí «se paga por la CPU, no por la GPU».

Y el *right-sizing* tiene un paso más: elegir la GPU, no solo el tamaño. Una H100 hace todo lo que hace una T4, y más rápido. Pero si tu modelo cabe en una T4 y la T4 aguanta tu tráfico, la H100 cuesta 13 veces más por hora para hacer lo mismo. La pregunta no es «¿cuál es la mejor GPU?», sino «¿cuál es la más barata que cumple?». Y para responderla hay que medir el costo de cada predicción.

## Hora facturada contra hora trabajando {Billed hours versus busy hours}

La nube cobra por **[[hora-facturada|hora facturada]]**: cada hora que la instancia existe y está encendida, haga algo o no. En AWS, las máquinas Linux se cobran por segundo, con un mínimo de un minuto. Apagarla detiene el cobro de cómputo; lo que sigue cobrando es su disco de red.

Por eso hay dos relojes distintos:

- **Horas facturadas**: las que la máquina estuvo encendida.
- **Horas trabajando**: las que de verdad hizo algo útil.

La diferencia es dinero tirado. En el caso de segmentación de imágenes médicas de la Ronda (c04), los [[worker|workers]] (los programas que toman trabajo de una cola y lo hacen) procesan las imágenes de microscopio que los laboratorios suben durante el día. Trabajan ≈ 8.3 horas diarias. Pero entre que el sistema enciende máquinas, espera un rato por si llega más trabajo y las vuelve a apagar, quedan encendidas ≈ 15. Al mes, con una `g6.2xlarge` a ≈ US$0.98:

- Trabajando: 8.3 h × 30 días × 0.98 ≈ **US$244**.
- Facturado: 15 h × 30 días × 0.98 ≈ **US$441**.

Casi la mitad (≈ 45 %) es máquina encendida sin hacer nada. No es un error: bajar una GPU y volverla a subir toma minutos, y alguien decidió esperar un rato antes de apagarla. Pero es una decisión con precio, y conviene verla.

### El costo de cada predicción

El precio por hora no dice si una GPU es cara. Una GPU que cuesta el doble pero atiende el triple sale más barata. Lo que importa es el **[[costo-por-prediccion|costo por predicción]]**, que se suele dar por cada 1,000:

**US$ por 1,000 predicciones = US$ por hora ÷ (predicciones por hora ÷ 1,000)**

Y aquí entra la [[utilizacion|utilización]]. Las predicciones por hora no son las que la GPU *podría* hacer: son las que **de verdad le llegan**.

:::cuenta Lo que cuestan 1,000 predicciones de C01
Si la T4 trabajara a tope // ≈ 1,200 fotos/s medidas | 0.526 ÷ (1,200 × 3,600 ÷ 1,000) | ≈ US$0.00012
A la capacidad planificada // 600 fotos/s: se planea a la mitad del máximo, para dejar margen | 0.526 ÷ (600 × 3,600 ÷ 1,000) | ≈ US$0.00024
Lo que de verdad llega // ≈ 116 fotos/s en promedio, entre las dos | 116 × 3,600 × 730 | ≈ 304.8 M fotos al mes
Lo que se paga // 2 T4 todo el mes | 2 × 0.526 × 730 | ≈ US$768 al mes
Costo real | 768 ÷ (304.8 M ÷ 1,000) | ≈ US$0.0025
= El costo real es ≈ 20 veces el de la GPU a tope, porque cada T4 trabaja al ≈ 5 %.
:::

Ese «20 veces» no se arregla con una GPU más barata: se arregla usando mejor la que ya pagas, o aceptándolo porque compra otra cosa. En C01 compra disponibilidad: la segunda T4 está para cuando falle una zona. La cuenta no dice que esté mal; dice cuánto cuesta esa decisión.

```python
def costo_por_mil(usd_hora, replicas, req_s_promedio):
    """US$ por cada 1,000 predicciones con el tráfico de verdad."""
    usd_mes = usd_hora * 730 * replicas
    predicciones_mes = req_s_promedio * 3600 * 730
    return usd_mes, usd_mes / (predicciones_mes / 1000)

maximo_t4 = 1200                       # fotos por segundo que aguanta una T4 (medido)
for req_s in (116, 600, 1200, 2400):   # tráfico promedio de todo el sistema
    mes, mil = costo_por_mil(0.526, 2, req_s)
    uso = req_s / (2 * maximo_t4)
    print(f"{req_s:5} fotos/s  uso {uso:6.1%}  US${mes:,.0f}/mes  US${mil:.6f} por 1,000")
```

```salida
  116 fotos/s  uso   4.8%  US$768/mes  US$0.002519 por 1,000
  600 fotos/s  uso  25.0%  US$768/mes  US$0.000487 por 1,000
 1200 fotos/s  uso  50.0%  US$768/mes  US$0.000244 por 1,000
 2400 fotos/s  uso 100.0%  US$768/mes  US$0.000122 por 1,000
```

La factura no se mueve: US$768 en las cuatro filas. Lo que cambia es cuánto sale cada predicción. Duplicar el tráfico divide el costo entre dos, sin tocar nada. Por eso la Ronda insiste: **di el precio por hora y luego el costo por 1,000 con tu utilización real**. Una comparación de GPUs que solo mira US$/h o TFLOPS está incompleta.

:::calculadora maquinas-costo
Sube el tráfico y mira cómo baja el costo por predicción sin que cambie la factura. Después prueba una L4: US$0.805 la hora y un máximo de ≈ 3,000 fotos por segundo. Ese máximo es un supuesto de la Ronda, que hay que confirmar con una prueba de carga.
:::

### ¿De quién es esta GPU? Las etiquetas

Cuando una empresa tiene cien instancias, la factura dice «EC2: US$40,000» (EC2 es el servicio de máquinas virtuales de AWS). No dice qué equipo, qué modelo ni qué [[ambiente]] gastó cada dólar. (Un ambiente es una copia completa del sistema para un fin, como *staging*, la copia donde se prueba antes de pasar a producción.)

Para eso existen las **[[etiqueta-costos|etiquetas de asignación de costos]]** (*cost allocation tags*): pares de llave y valor que le pegas a cada recurso, como `equipo=catalogo`, `modelo=c01-categorias` o `ambiente=staging`. Cuando las activas en la consola de facturación, la factura se puede partir por cada etiqueta.

El comando de abajo es solo una ilustración de cómo se pegan (no lo corras; necesita una cuenta de AWS y el id de una instancia real):

```bash
aws ec2 create-tags --resources i-0abc123de456f7890 \
  --tags Key=equipo,Value=catalogo Key=modelo,Value=c01-categorias Key=ambiente,Value=staging
```

Con etiquetas, preguntas como «¿cuánto cuesta staging?» tienen respuesta. En C01, staging es una T4 encendida 24/7: ≈ US$384 al mes. Encendida solo en horas de trabajo, ≈ 60 horas a la semana, baja a ≈ US$137. Sin etiquetas, esos US$250 al mes se esconden en una sola línea que dice «EC2».

## On-demand y spot {On-demand and spot}

Hasta aquí, todos los precios eran **[[on-demand]]** (bajo demanda): el [[precio-lista|precio de lista]], sin compromiso, contra el que se mide cualquier descuento. La pides, la usas, la apagas y pagas solo esas horas. Su ventaja: no te compromete a nada. Su desventaja: es el precio más alto.

La primera manera de pagar menos es **[[spot]]** (en Google, *Spot VM*). La idea: el proveedor tiene máquinas que nadie está usando en este momento. En vez de dejarlas apagadas, te las renta más baratas, con una condición: **te las puede quitar cuando las necesite** alguien que paga precio completo.

:::analogia Un asiento de último minuto
Una aerolínea vende los asientos vacíos de último minuto con descuento. Viajas igual de cómodo y llegas igual de rápido. Pero si llega alguien con boleto completo y no hay lugar, te bajan del avión.

Dónde se rompe: a ti te bajan antes de despegar. En spot, te bajan **a medio vuelo**: la máquina se apaga con lo que estaba haciendo a la mitad. Y no hay compensación: solo dejas de pagar (en AWS, si te la quitan en su primera hora, esa hora no se cobra).
:::

### El aviso de interrupción

Cuando el proveedor necesita la máquina, te avisa un poco antes de apagarla. Ese **[[aviso-interrupcion|aviso de interrupción]]** (*interruption notice*) es corto:

- **AWS:** 2 minutos.
- **Google Cloud y Azure:** 30 segundos.

Y es *best effort*: el proveedor intenta avisar, pero no lo promete. Tu programa tiene que leer el aviso y, en ese tiempo, guardar lo que pueda y salir en orden. En AWS hay dos maneras de enterarse: preguntarle cada pocos segundos a una dirección especial que cada máquina tiene para consultar datos de sí misma, o escuchar el evento (un mensaje automático) que la nube publica.

Esos segundos deciden qué puede correr en spot. La pregunta no es «¿cuánto ahorro?», sino **«¿qué le pasa a mi sistema si me quitan la máquina con 2 minutos de aviso?»**:

- **Si solo se repite un pedazo de trabajo, sirve.** Un entrenamiento que guarda un [[checkpoint]] cada media hora pierde, como mucho, media hora. Un [[backfill]] (volver a procesar datos viejos, como todo el catálogo) partido en pedazos repite solo el pedazo que iba.
- **Si un usuario ve un error, no sirve.** Si la T4 que atiende a Ana desaparece, su foto falla. Por eso el mínimo de réplicas en línea de C01 (las copias del modelo que atienden en vivo) nunca va en spot.

| Trabajo | ¿Spot? | Por qué |
|---|---|---|
| Entrenamiento con checkpoints | Sí | Pierdes lo que no estaba guardado y sigues |
| Trabajos por lotes (*batch*) y asíncronos, [[idempotencia\|idempotentes]] (c04) | Sí | El mensaje vuelve a la cola y otro lo hace |
| Backfills, [[ci\|CI]], pruebas | Sí | Nadie espera la respuesta en segundos |
| Réplicas extra para una ráfaga | Con cuidado | Si se van, las demás aguantan un rato |
| El mínimo en línea (las 2 T4 de C01) | No | Un usuario ve el error |

### Cómo se vuelve seguro: cola, checkpoint y otra máquina

El diagrama muestra el patrón de la Ronda para los trabajos en spot. Los pedazos de trabajo esperan en una [[cola-mensajes|cola]]. Un worker en spot toma uno y, mientras lo procesa, el mensaje queda invisible por un rato (el [[visibility-timeout|visibility timeout]] de la lección de colas). Si el worker termina, borra el mensaje. Si desaparece, el mensaje reaparece y otro worker lo toma.

:::diagrama maquinas-spot
Toca cada caja para ver por qué está ahí. Los dos recorridos cuentan un pedazo normal y uno que se interrumpe a la mitad.
:::

Dos detalles hacen que funcione:

- **Diversificar.** Si todos tus workers son `g4dn.xlarge` en una zona, cuando el proveedor necesite esas máquinas te las quita todas a la vez. Si pides varios tipos y varias zonas, una interrupción se lleva solo una parte. AWS tiene una estrategia que elige automáticamente dónde hay más capacidad sobrante y mejor precio (`price-capacity-optimized`). Ojo: muchos equipos compilan su modelo con TensorRT, la herramienta de NVIDIA que lo convierte en un archivo optimizado (un *engine*) para un modelo exacto de GPU. Un engine hecho para una T4 no corre en una L4. Diversificar pide tener un engine para cada GPU.
- **Elegir cada cuánto guardar.** Guardar un checkpoint cuesta tiempo; no guardarlo cuesta repetir trabajo. En la práctica se guarda cada pocos minutos o cada hora, nunca «solo al recibir el aviso»: con 30 segundos no alcanza a guardar un modelo grande.

:::profundo Simular cada cuánto guardar
El programa de abajo simula un entrenamiento de 40 horas en spot, con el supuesto de que la nube quita la máquina, en promedio, dos veces al día, y que arrancar otra y cargar el checkpoint toma ≈ 15 minutos.

```python
import random
random.seed(7)

def horas_pagadas(trabajo_h, cada_h, interrupciones_por_dia):
    """Simula un entrenamiento en spot que guarda un checkpoint cada `cada_h` horas."""
    hecho, pagado = 0.0, 0.0
    while hecho < trabajo_h:
        # cuánto dura la máquina antes de que la nube la recupere (al azar)
        vida = random.expovariate(interrupciones_por_dia / 24)
        falta = trabajo_h - hecho
        if vida >= falta:                     # termina antes de que se la quiten
            return pagado + falta
        pagado += vida
        hecho += (vida // cada_h) * cada_h    # solo cuenta lo que quedó en un checkpoint
        pagado += 0.25                        # ≈ 15 min para arrancar otra y cargar el checkpoint
    return pagado

for cada in (0.25, 1, 4, 12):
    corridas = [horas_pagadas(40, cada, 2) for _ in range(2000)]
    print(f"checkpoint cada {cada:5} h → {sum(corridas) / len(corridas):5.1f} h pagadas en promedio")
```

```salida
checkpoint cada  0.25 h →  41.3 h pagadas en promedio
checkpoint cada     1 h →  42.6 h pagadas en promedio
checkpoint cada     4 h →  48.5 h pagadas en promedio
checkpoint cada    12 h →  67.5 h pagadas en promedio
```

Con checkpoints cada 15 minutos, pagas 41 horas por 40 de trabajo. Cada 12 horas, pagas 67: el descuento de spot se va en repetir. La simulación no cuenta lo que tarda guardar cada checkpoint (con un modelo grande, minutos), y por eso el mejor intervalo real no es «lo más seguido posible», sino uno de minutos a una hora.
:::

### Cuánto ahorra de verdad

AWS anuncia descuentos de spot «de hasta 90 %», Google «de hasta 91 %» y Azure «de hasta 90 %». Son techos de publicidad. Lo que se observa en GPUs es otra cosa. La Ronda tomó una foto de los precios spot en `us-east-1` en octubre de 2026:

| Instancia | On-demand | Spot observado | Descuento |
|---|---|---|---|
| `g4dn.xlarge` (T4) | ≈ 0.526 | ≈ 0.27 | ≈ 49 % |
| `g5.xlarge` (A10G) | ≈ 1.006 | ≈ 0.46 | ≈ 54 % |
| `g6.xlarge` (L4) | ≈ 0.805 | ≈ 0.60 | ≈ 25 % |
| `g6e.xlarge` (L40S) | ≈ 1.861 | ≈ 1.84 | ≈ 1 % |
| `p5.48xlarge` (8 × H100) | ≈ 55.04 | ≈ 21.5 | ≈ 61 % |

Es una foto de un día, no un promedio: el precio spot lo fija el proveedor según cuánta capacidad le sobra, y cambia. Las GPUs que todos quieren (como la L40S ese día) casi no tienen descuento; las demás de inferencia, de ≈ 25 a ≈ 54 %; la `p5` (8 H100), 61 %. Hay que **restarle el trabajo repetido**.

Un ejemplo: un [[fine-tuning|fine-tune]] (seguir entrenando un modelo ya entrenado, con tus propios datos) de 40 horas, en una A10G.

:::cuenta Un fine-tune de 40 horas en spot
On-demand // `g5.xlarge`, us-east-1 | 40 h × 1.006 | ≈ US$40.24
Spot, con 4 interrupciones // cada una repite ≈ 25 min | (40 + 4 × 25 ÷ 60) h × 0.462 | ≈ US$19.25
Ahorro | 1 − 19.25 ÷ 40.24 | ≈ 52 %
= Del ≈ 54 % de descuento spot de ese día quedan ≈ 52 % después de repetir trabajo: sigue valiendo la pena, porque los checkpoints son frecuentes.
:::

## Compromisos: pagar menos a cambio de un plazo {Commitments: a lower price for a term}

La segunda manera de pagar menos es prometer. Le dices al proveedor «voy a gastar esto durante uno o tres años, pase lo que pase», y a cambio te cobra menos por hora. Es el mismo trueque en las tres nubes, con nombres distintos:

- **[[savings-plan|Savings Plan]]** (AWS): te comprometes a gastar un monto **por hora** (por ejemplo, US$0.70 cada hora) durante 1 o 3 años. Todo lo que uses hasta ese monto sale con descuento; lo que pase de ahí, a precio on-demand. Si usas menos, pagas el monto igual. El *Compute Savings Plan* aplica a cualquier familia y región; el *EC2 Instance Savings Plan* se amarra a una familia en una región, a cambio de más descuento.
- **[[instancia-reservada|Instancia reservada]]** (*Reserved Instance*, RI, en AWS y Azure) y **CUD** (*Committed Use Discount*, en Google): te comprometes a una instancia o a una cantidad de recursos, no a un monto (Google también tiene un CUD flexible, por monto). El trueque es el mismo: plazo por precio.

Los descuentos máximos anunciados son de «hasta 72 %» en las RIs y en el EC2 Instance Savings Plan, «hasta 66 %» en el Compute Savings Plan, «hasta 55 %» en los CUD de Google y «hasta 72 %» en Azure. Pero, como en spot, el máximo es para 3 años con pago adelantado y para ciertas máquinas. Para GPUs de inferencia a 1 año, sin pagar adelantado, la Ronda observó ≈ 35–37 % (`g4dn.xlarge` y `g5.xlarge` ≈ 37 %, `g6.xlarge` ≈ 35 %), y a 3 años ≈ 54–57 %.

### La regla: comprometer la base, nunca el pico

Un compromiso convierte una máquina que pagas por hora en una que pagas siempre. Con un descuento de 37 %, una T4 comprometida cuesta 0.526 × 0.63 ≈ US$0.331 la hora, **las 730 horas del mes**, la uses o no: ≈ US$242. On-demand, en cambio, pagas 0.526 por cada hora que de verdad la usas. Las dos cuentas se igualan cuando 0.526 × horas = 0.331 × 730, es decir, en 730 × 0.63 ≈ 460 horas. Por eso el compromiso conviene solo si la usarías más de:

**1 − descuento = 1 − 0.37 = 63 % de las horas**

Debajo de ese uso, on-demand sale más barato. Por eso se compromete solo **la base**. La Ronda la define con una pregunta: *«¿qué parte de mi uso estoy seguro de que existirá todo el año?»*.

:::figura maquinas-base
Un día de GPUs de un sistema en línea. La franja de abajo nunca se apaga: esa se compromete. Lo que sube y baja con el tráfico va on-demand. El trabajo de la madrugada, que puede repetirse, va en spot.
:::

En C01, la base son las 2 T4 y los 2 nodos del gateway, que nunca se apagan: ≈ US$768 + ≈ US$248 ≈ US$1,016 al mes. Un Savings Plan de 1 año con 30–40 % de descuento ahorra ≈ US$305–406 al mes. Lo que **no** se compromete es el máximo del autoscaler (el programa que enciende y apaga réplicas según el tráfico; lo verás en [[autoscaling]]): las réplicas que existen solo en las horas pico.

:::cuenta El error de comprometer el pico
El autoscaler de C01 llega a 4 T4 en el pico | 4 × 0.331 × 730 | ≈ US$967 al mes comprometidos
Pero en promedio hay ≈ 2.33 T4 encendidas | 2.33 × 0.526 × 730 | ≈ US$895 al mes on-demand
= Comprometer el pico cuesta ≈ US$70 más al mes que no comprometer nada. Usarías las 4 T4 solo ≈ 58 % de las horas, menos que el 63 % que pide el descuento.
:::

Dos consejos más de la Ronda: espera de 2 a 3 meses de uso real antes de comprometer (para conocer tu base de verdad) y empieza por 1 año. Un compromiso de 3 años sobre una T4 apuesta a que tu modelo seguirá corriendo en una GPU de 2018 hasta el final del plazo.

:::calculadora maquinas-compromiso
Mueve las horas y mira dónde el compromiso empieza a ganar: justo en 730 × (1 − descuento), ≈ 460 horas con 37 %. Luego baja el descuento de spot a 1 %, el que tenía la L40S el día de la foto.
:::

## Cuotas, capacidad y reservas {Quotas, capacity and reservations}

Hay algo que sorprende la primera vez: **pagar no te garantiza que haya máquinas**. Para que una instancia arranque tienen que pasar dos filtros distintos, y ninguno de los dos depende del precio.

:::diagrama maquinas-pedir
Toca cada caja; los recorridos cuentan el caso feliz, las dos maneras de quedarte sin máquina y lo que cambia una reserva.
:::

### Primer filtro: la cuota

Una **[[cuota-servicio|cuota de servicio]]** (*service quota*) es un límite administrativo: cuántos recursos de un tipo puede tener tu cuenta en una región. Existe para proteger al proveedor y a ti (un script con un error no puede encender mil GPUs). Cada nube la cuenta distinto:

- **AWS** cuenta **vCPUs**, por grupo de familias y por región. Hay una cuota para las instancias G y VT on-demand (VT es una familia para procesar video), otra para las P y otra para las G y VT en spot. Una `g4dn.xlarge` gasta 4 vCPU de la cuota G; una `p5.48xlarge`, 192 de la cuota P.
- **Google Cloud** cuenta **GPUs** por modelo y región, más una cuota global de GPUs en todas las regiones (`GPUS_ALL_REGIONS`).
- **Azure** cuenta **vCPUs por familia** de máquina y región.

Si pides una máquina y te pasas, el error llega al instante y no se arregla esperando: hay que pedir más cuota, y eso puede tardar de horas a días, porque a veces la revisa una persona. En cuentas nuevas, las cuotas de GPU suelen ser chicas. Las de SageMaker AI, el servicio de AWS que entrena y sirve modelos por ti, son aparte, y muchas arrancan en 0.

La cuota se pide **para el máximo**, no para el promedio, y **antes** del lanzamiento. En C01:

:::cuenta La cuota de C01
Máximo del autoscaler // para el pico de diseño | 4 | 4 máquinas
Más una de sobra al desplegar una versión nueva // el *surge*: la versión nueva arranca antes de apagar la vieja | 4 + 1 | 5 máquinas
Más staging y CI // una para cada uno | 5 + 1 + 1 | 7 máquinas
Total | 7 × 4 vCPU | 28 vCPU de instancias G
= Si el cluster puede usar también `g4dn.2xlarge` (8 vCPU, la misma T4), en el peor caso las 7 son de ese tamaño: 7 × 8 = 56 vCPU de cuota.
:::

Así se ve en AWS. El comando es una ilustración: muestra la cuota de instancias G on-demand de una región (necesita una cuenta y permisos):

```bash
aws service-quotas get-service-quota --region us-east-1 \
  --service-code ec2 --quota-code L-DB2E81BA
```

### Segundo filtro: la capacidad

Tener cuota no quiere decir que haya máquinas. Las GPUs son físicas: en una zona hay un número fijo de servidores con T4, y si otros clientes ya los están usando, no hay más. Entonces la nube responde con un **[[error-capacidad|error de capacidad insuficiente]]**: en AWS, `InsufficientInstanceCapacity` (ICE, en la jerga).

No es tu culpa ni de tu cuota. Se arregla de tres maneras:

- **Otra zona.** La misma región tiene varias, y la capacidad de cada una es distinta.
- **Otro tipo.** Si no hay `g4dn.xlarge`, quizá haya `g4dn.2xlarge` (la misma T4) o `g6.xlarge` (otra GPU, que necesita su propio engine de TensorRT).
- **Reservar antes.** Lo único que garantiza que haya máquinas.

:::ojo Una plataforma gestionada no te salva
SageMaker AI, la plataforma de ML de AWS, saca sus máquinas `ml.*` de la misma capacidad física que EC2. Si en la zona no hay GPUs para ti, tampoco las hay para tu endpoint gestionado. La lección de [[servicio-gestionado|servicios gestionados]] lo detalla.
:::

### Reservas: lo único que garantiza máquinas

Aquí está la confusión más cara de esta lección: **un descuento no es una reserva**. Un Savings Plan, una RI regional (la que vale en cualquier zona de la región) o un CUD flexible de Google te bajan el precio de lo que uses. **No apartan ninguna máquina.** Si el día del pico no hay T4 en la zona, tu Savings Plan no te consigue una. La excepción confirma la regla: en Google, un CUD de GPUs por recursos **exige** adjuntarle una reserva de esas mismas GPUs, y es la reserva, no el descuento, la que las aparta.

Para eso hay dos productos:

- **[[reserva-capacidad|Reserva de capacidad]]** (*On-Demand Capacity Reservation*, en AWS): apartas, por ejemplo, 2 `g4dn.xlarge` en `us-east-1a`. Están ahí para ti siempre, y **las pagas se usen o no**, a precio on-demand (un Savings Plan puede bajarle el precio). Sirve para el mínimo que no puede fallar: en C01, las 2 T4.
- **[[capacity-block|Bloque de capacidad para ML]]** (*Capacity Blocks for ML*): para GPUs grandes, por días o semanas con fecha fija. Por ejemplo, 8 H100 del 3 al 10 de diciembre para un entrenamiento. Se aparta hasta 8 semanas antes, se paga por adelantado y no se cancela.

| Producto | ¿Baja el precio? | ¿Garantiza máquinas? | ¿Pagas si no la usas? |
|---|---|---|---|
| On-demand | No | No | No |
| Spot | Sí, ≈ 25–55 % (inferencia), a veces nada | No, y te la quitan | No |
| Savings Plan, RI regional, CUD flexible | Sí, ≈ 35–37 % a 1 año | **No** | Sí, el compromiso |
| Reserva de capacidad | No (salvo que la combines con un Savings Plan) | **Sí** | Sí |
| Bloque de capacidad | Precio propio | Sí, en sus fechas | Sí, por adelantado |

## Más allá de una GPU entera {Beyond one whole GPU} [extra]

Las secciones anteriores suponen que rentas GPUs completas, de NVIDIA, a una nube. Hay otras tres opciones: rentar un pedazo de GPU, usar chips que diseñó el propio proveedor, o comprar la GPU.

### Partir una GPU: MIG y fracciones

Si tu modelo usa 3 GB de una GPU de 80, pagar la GPU entera es caro. Hay dos maneras de compartirla.

**[[mig|MIG]]** (*Multi-Instance GPU*) parte una GPU grande en hasta 7 pedazos **con aislamiento de hardware**: cada pedazo tiene su propia memoria y sus propios [[sm|SMs]] (los bloques de cómputo de la GPU), y lo que pase en uno no frena a los otros. Existe en la A100, la H100 y la H200 (y en hasta 4 pedazos en la RTX PRO 6000, una tarjeta de escritorio que vuelve al final de esta sección). Un pedazo de H100 se llama, por ejemplo, `1g.10gb`: una séptima parte del cómputo y 10 GB. La Ronda calcula que cuesta ≈ US$6.88 ÷ 7 ≈ US$0.98 por hora: casi el doble de una T4 completa. MIG **no existe** en la T4, la L4, la A10G ni la L40S.

Las **[[fraccion-gpu|fracciones de GPU]]** comparten sin aislamiento:

- **Time-slicing**: varios programas se turnan la GPU. Kubernetes anuncia, por ejemplo, «4 GPUs» donde hay una. La Ronda lo resume bien: *multiplica el número anunciado, no la capacidad*. Si un programa usa mucha memoria, los otros se quedan sin ella.
- **MPS** (*Multi-Process Service*): varios procesos corren a la vez en la misma GPU, con mejor uso que turnarse, pero si uno falla puede afectar a los demás.
- **La fracción del proveedor**: AWS renta la `g6f.large`, con 1/8 de una L4 (≈ 3 GB), por ≈ US$0.20 la hora. Google tiene algo parecido con la RTX PRO 6000 (la `g4-standard-6`, 1/8 de GPU, ≈ US$0.65 la hora en us-central1).

Para C01, la Ronda sugiere otra cosa: **compartir las T4 que ya paga** con modelos chicos de otros equipos, sirviendo varios modelos en el mismo Triton. Las T4 trabajan al 5 %; ahí cabe mucho. Ahorra ≈ US$250 al mes de GPUs que no hay que rentar.

### Aceleradores propios de cada nube

Las nubes grandes diseñan sus propios chips para ML: los **[[acelerador-propio|aceleradores propios]]**.

- **Google** tiene las **TPU** (*Tensor Processing Unit*), solo en Google Cloud. Se programan con XLA, un compilador que usan las bibliotecas de ML JAX, TensorFlow y PyTorch/XLA (la versión de PyTorch para TPU).
- **AWS** tiene **Inferentia** (instancias `inf2`), para inferencia, y **Trainium** (`trn`), para entrenar. Se usan con el **Neuron SDK**, que compila el modelo para ese chip.

Suelen salir más baratos por predicción que una GPU equivalente. El precio: tu modelo tiene que compilarse con otra herramienta, no todos los modelos ni todas las operaciones funcionan igual, y quedas más atado a esa nube (la [[dependencia-proveedor|dependencia del proveedor]] de la lección de la nube). La Ronda pide evaluarlos con **la misma prueba de carga** que una GPU, midiendo costo por 1,000 predicciones, no con la hoja de datos.

### Rentar contra comprar

La última opción es no rentar: comprar la GPU. Hagamos la cuenta corta con una tarjeta de *workstation* (una computadora de escritorio muy potente, para diseño o ciencia): la RTX PRO 6000 Blackwell, con 96 GB. En noviembre de 2026 se veía en una tienda de EE. UU. en ≈ US$16,399, y la tienda de NVIDIA la pedía en US$16,000 (un precio volátil, que casi duplicó los ≈ US$8,565 de su lanzamiento). Rentada en el *Secure Cloud* de RunPod cuesta ≈ US$2.69 la hora.

:::cuenta ¿Cuántas horas de renta pagan la tarjeta?
Horas de renta que valen lo mismo | 16,399 ÷ 2.69 | ≈ 6,096 horas
En meses, encendida 24/7 | 6,096 ÷ 730 | ≈ 8.4 meses
Si solo la usas 8 h al día // ≈ 243 h al mes | 6,096 ÷ 243 | ≈ 25 meses
= Comprar gana si la vas a usar casi todo el tiempo durante años. Si la usas poco, rentar gana por mucho. Y con la renta más barata (≈ US$1.69 en el *Community Cloud* de RunPod) el punto de equilibrio se aleja a ≈ 9,700 horas, más de 13 meses 24/7.
:::

Y la cuenta de verdad tiene más renglones: la computadora donde va la tarjeta, la luz (600 W encendida 730 horas son ≈ 438 kWh al mes), el enfriamiento, quién la repara si falla, que en 3 años habrá GPUs mucho mejores, y que una tarjeta en tu oficina no tiene zonas ni [[n-mas-uno|N+1]] (una de sobra por si falla otra). Del otro lado, comprar te da algo que la renta no: los datos y el modelo nunca salen de tu edificio.

Esa cuenta completa (con luz, servidor, depreciación y cuántos usuarios atiende cada tarjeta) es el tema de **IA Privada**, la app de TrueML sobre modelos de pesos abiertos en hardware propio. Esta lección te deja la unidad con la que se hace: la GPU-hora, y el costo por predicción con la utilización de verdad.

## Errores comunes {Common mistakes}

### Elegir la GPU por el precio por hora, o por los TFLOPS

**Qué pasa:** «la T4 es la más barata, usamos T4» o «la H100 tiene más TFLOPS, usamos H100». Ninguna de las dos frases dice cuánto cuesta cada predicción.
**Cómo evitarlo:** mide en una [[prueba-carga|prueba de carga]] cuántas predicciones por segundo hace cada GPU con tu modelo, y compara US$ por 1,000 predicciones **con tu tráfico real**. Una GPU que cuesta el doble y atiende el triple sale más barata.

### Comparar una GPU sola contra una máquina completa

**Qué pasa:** la T4 de Google «cuesta US$0.35» y la de AWS US$0.526, y se concluye que Google es más barato. Pero en Google la GPU se cobra aparte de la VM que la hospeda.
**Cómo evitarlo:** compara siempre el costo de la máquina completa que necesitas, con su CPU y su RAM. Y divide entre las GPUs que trae (una `p5.48xlarge` cuesta US$55.04 por **ocho** H100).

### Creerle a la hoja de datos sin leer la letra chica

**Qué pasa:** «la L40S tiene 733 TFLOPS» (es con *sparsity*: los densos son 362), «la H100 tiene 3.35 TB/s» (la SXM; la PCIe tiene ≈ 2) o «16 GiB de RAM son 16 GB» (son ≈ 17.2).
**Cómo evitarlo:** busca «*sparsity*» y divide entre 2; revisa qué versión de la GPU trae la instancia; convierte GiB y GB antes de sumar.

### «Spot ahorra 90 %»

**Qué pasa:** se planea el presupuesto con el descuento máximo anunciado.
**Cómo evitarlo:** usa el descuento que observas en tu tipo y tu región (en GPUs de inferencia, ≈ 25–55 %, a veces casi nada) y réstale el trabajo repetido. Y nunca pongas en spot lo que un usuario ve fallar.

### Comprometer el máximo del autoscaler

**Qué pasa:** se compra un Savings Plan por las 4 T4 del pico, que solo existen unas horas al día. Se paga por máquinas que no corren.
**Cómo evitarlo:** compromete solo la base que corre todo el año, después de 2 o 3 meses de uso real. El compromiso conviene si la usarías más de 1 − descuento de las horas.

### Creer que el descuento aparta máquinas

**Qué pasa:** «tenemos Savings Plan, no nos vamos a quedar sin GPUs». El día del pico llega `InsufficientInstanceCapacity`.
**Cómo evitarlo:** el descuento baja el precio; la **reserva de capacidad** aparta máquinas. Para el mínimo que no puede fallar, reserva. Y pide la cuota para el máximo antes de lanzar.

### Olvidar las horas encendidas sin trabajo

**Qué pasa:** el staging, el [[notebook]] de alguien o el worker que espera «por si llega algo» quedan encendidos toda la noche.
**Cómo evitarlo:** etiqueta cada recurso, revisa la factura por etiqueta y apaga lo que no trabaja. Staging de C01 en horario de oficina pasa de ≈ US$384 a ≈ US$137 al mes.

## En la vida real {In real life} [extra]

**C01, el marketplace.** Dos `g4dn.xlarge` on-demand, una por zona: ≈ US$768 al mes. No son por el tráfico (una sola aguanta el pico de 500 fotos por segundo) sino por la disponibilidad. Trabajan al ≈ 5 %, y la predicción sale en ≈ US$0.0025 por 1,000 solo de GPUs (≈ US$0.006 con toda la infraestructura). La Ronda compara con 2 L4: ≈ US$1,175 al mes, 53 % más por hora. Hoy gana la T4; la L4 ganaría si el tráfico creciera de 3 a 5 veces y una prueba de carga confirmara que atiende ≈ 2.5 veces más (si atendiera solo 1.25 veces más, no le alcanzaría para pagar su precio, ≈ 1.53 veces el de la T4).

En C01, spot queda solo para el backfill del catálogo (4 `g4dn.2xlarge` durante ≈ 14 h: ≈ 56 GPU-horas, ≈ US$42 on-demand a US$0.752 la hora) y el entrenamiento. La base (≈ US$1,016 al mes) va a un Savings Plan de 1 año. Si la zona anda escasa de T4, las 2 mínimas pueden ir además con reserva de capacidad. Cuota pedida: 28 vCPU.

**Segmentación de imágenes médicas (c04).** Workers en `g6.2xlarge` (1 L4, 8 vCPU) a ≈ US$0.98 la hora, porque el cuello está en la CPU que abre y corta las imágenes de microscopio. Facturan ≈ 450 horas al mes (≈ US$441) y trabajan ≈ 249. Como el trabajo es asíncrono e idempotente, va en spot: con la cola y su visibility timeout, una interrupción solo repite un pedazo. Cuota: 4 nodos × 8 vCPU = 32, y 40 contando el *surge*.

**Video en tiempo real (c02).** Para 5,000 cuadros por segundo hacen falta 19 `g6.xlarge`, ≈ US$11.2k al mes. Aquí no hay spot: el video no espera. El ahorro viene de un compromiso sobre la base, y de medir cuántos cuadros por segundo saca de verdad cada L4.

**Recomendación (c08).** El ranker (el modelo que ordena qué recomendar primero) corre en 4 `g6.2xlarge` (≈ US$2.9k al mes). La `g6.xlarge` tenía la misma L4, pero su red sostenida (≈ 2.5 Gb/s) se saturaba con las [[feature|features]] que recibe en cada petición. Se pagó ≈ US$126 más al mes por nodo para tener más red, no más GPU. Es el mismo *right-sizing*, con otro cuello.

**Moderación de contenido (c06).** 10 `g6.xlarge` encendidas 24/7, ≈ US$5.9k al mes, en dos etapas: 6 para la primera (≈ US$3.5k) y 4 para la segunda (≈ US$2.35k). Como el tráfico nunca baja a cero, esas 10 son base: el candidato perfecto para un compromiso.

**Un LLM propio (c10).** 32 H100 en 4 `p5.48xlarge`: ≈ US$160.7k al mes a ≈ US$6.88 por H100-hora. La alternativa era una API de un proveedor de modelos: ≈ US$442k al mes. Con GPUs tan caras, cada punto de utilización vale miles de dólares, y aquí sí se piensa en bloques de capacidad y en neoclouds.

**Fuera de ML.** El mismo trueque existe en el transporte. Rentar un auto por día es on-demand: caro por día, sin compromiso. Un arrendamiento de 3 años es un compromiso: barato por día, lo pagas aunque no salgas. El auto de una plataforma que te cancela si aparece un viaje mejor es spot. Y comprar el auto es comprar: gana si manejas mucho, durante años. Dónde se rompe: la plataforma te cancela antes de que te subas, y spot te baja a medio camino. Y ninguna arrendadora cobra por segundo.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa los precios de las tablas de la lección (on-demand, us-east-1, noviembre de 2026, salvo que se diga otra cosa) y 730 horas al mes.

:::ejercicios
? [facil] La `g6e.12xlarge` trae 4 L40S y cuesta ≈ US$10.49 la hora. ¿Cuántos vCPU tiene, según la regla de los tamaños? ¿Cuánto cuesta por GPU-hora, y cuánto más que una L40S en la `g6e.xlarge`?
- `12xlarge` = 12 × 4 = **48 vCPU**.
- 10.49 ÷ 4 ≈ **US$2.62** por GPU-hora.
- Contra 1.861: 2.62 ÷ 1.861 ≈ 1.41, **≈ 41 % más** por la misma L40S. La diferencia es la CPU y la RAM de más.
? [facil] ¿Cuánto cuesta al mes una `p5.48xlarge` encendida todo el tiempo? ¿Y cada una de sus H100?
- 55.04 × 730 ≈ **US$40,179** al mes.
- Por H100: 55.04 ÷ 8 = 6.88 por hora; 6.88 × 730 ≈ **US$5,022** al mes.
? [facil] La `g4dn.xlarge` trae 16 GiB de RAM y una T4 de 16 GB de VRAM. ¿Son la misma cantidad de bytes? ¿Cuántos GB son 16 GiB?
- No. 16 GiB = 16 × 2³⁰ = 17,179,869,184 bytes ≈ **17.2 GB**.
- 16 GB = 16 × 10⁹ = 16,000,000,000 bytes. La RAM tiene ≈ 7 % más bytes.
? [facil] Una tabla de proveedor dice que la L40S hace «733 TFLOPS en FP16, *with sparsity*». ¿Cuántos ve un modelo normal? ¿Cuántas veces es eso los 312 de la A100?
- Denso, dividiendo: 733 ÷ 2 ≈ **366.5 TFLOPS**. La página de NVIDIA publica el denso exacto: 362.
- 362 ÷ 312 ≈ **1.16 veces**. Sin dividir, parecería 2.35 veces: la trampa duplica la ventaja.
? [medio] C01 cambia sus 2 T4 por 2 L4 (`g6.xlarge`), con el mismo tráfico (≈ 116 fotos por segundo en promedio). ¿Cuánto paga al mes y cuánto le cuesta cada 1,000 predicciones? ¿Y si las dos GPUs trabajaran a su capacidad planificada (la mitad de su máximo): ≈ 600 fotos por segundo la T4 y, con el supuesto de la Ronda de que la L4 atiende ≈ 2.5 veces más, ≈ 1,500 la L4?
- Al mes: 2 × 0.8048 × 730 ≈ **US$1,175**.
- Predicciones: 116 × 3,600 × 730 ≈ 304.8 M al mes, que son 304,848 grupos de 1,000. Costo: 1,175 ÷ 304,848 ≈ **US$0.0039 por 1,000**, contra ≈ US$0.0025 con T4.
- Planificada: en una hora, la L4 hace 1,500 × 3,600 = 5.4 M predicciones, o sea 5,400 grupos de 1,000. Costo: 0.8048 ÷ 5,400 ≈ **US$0.00015 por 1,000**. La T4, a 600 fotos por segundo, hace 2,160 grupos de 1,000 por hora: 0.526 ÷ 2,160 ≈ US$0.00024. Llena, la L4 sale ≈ 39 % más barata por predicción (1 − 0.00015 ÷ 0.00024, con los valores sin redondear); con el tráfico de hoy, la T4 gana. La L4 conviene solo si atiende más de ≈ 1.53 veces lo de una T4 (su precio entre el de la T4) **y** ese tráfico existe.
? [medio] El caso de búsqueda por imágenes de la Ronda (c07) re-embebe su catálogo en ≈ 23 L4-horas. ¿Cuánto cuesta on-demand? ¿Y en spot, con el ≈ 25 % de descuento que se observó en la `g6.xlarge`? ¿Y si además repite ≈ 10 % del trabajo por interrupciones?
- On-demand: 23 × 0.8048 ≈ **US$18.5**.
- Spot: 18.5 × 0.75 ≈ **US$13.9**.
- Con 10 % repetido: 13.9 × 1.1 ≈ **US$15.3**. El ahorro baja de US$4.6 a US$3.2. Vale la pena, pero poco: con descuentos chicos, spot apenas compensa.
? [medio] Los workers de c04 (`g6.2xlarge`, ≈ US$0.98 la hora) facturan 450 horas al mes. ¿Conviene comprometer uno a 1 año con 35 % de descuento? ¿Desde cuántas horas al mes conviene?
- On-demand: 450 × 0.98 = **US$441**.
- Comprometido: 0.98 × 0.65 × 730 ≈ **US$465**, se use o no.
- No conviene: US$24 más caro. El punto de equilibrio es 730 × (1 − 0.35) ≈ **475 horas** al mes (≈ 65 % del tiempo). Por encima, gana el compromiso.
? [medio] Un sistema en `us-east-1` tiene un autoscaler que llega a 6 `g5.xlarge`, despliega con 1 de sobra, y tiene una de staging. Sus workers de batch corren en spot, 4 `g4dn.2xlarge` como máximo. ¿Qué cuotas pide y de cuántos vCPU?
- Cuota de instancias G y VT **on-demand**: (6 + 1 + 1) × 4 = **32 vCPU**.
- Cuota de instancias G y VT **spot**, aparte: 4 × 8 = **32 vCPU**.
- Las dos se piden antes del lanzamiento, en `us-east-1`. Tenerlas no garantiza capacidad.
? [reto] Un modelo de lenguaje de 60 GB (pesos en BF16) tiene que servirse en una sola GPU. Al generar texto con una sola petición a la vez, cada token lee todos los pesos: los tokens por segundo ≈ ancho de banda ÷ 60 GB. Compara la A100 80 GB PCIe de Azure (US$3.673/h, 1,935 GB/s), la H100 SXM de AWS (`p5.4xlarge`, US$6.88/h, 3,350 GB/s) y la H100 NVL de Azure (US$6.98/h, 3,900 GB/s): tokens por segundo, US$ al mes y US$ por millón de tokens. ¿Cabe en una L40S?
- En una L40S no: tiene 48 GB.
- A100 PCIe: 1,935 ÷ 60 ≈ **32 tokens/s**; 3.673 × 730 ≈ US$2,681 al mes; 3.673 ÷ (32.25 × 3,600) × 10⁶ ≈ **US$31.6 por millón**.
- H100 SXM: 3,350 ÷ 60 ≈ **56 tokens/s**; ≈ US$5,022 al mes; ≈ **US$34.2 por millón**.
- H100 NVL: 3,900 ÷ 60 = **65 tokens/s**; ≈ US$5,095 al mes; ≈ **US$29.8 por millón**.
- La H100 es casi el doble de rápida y casi el doble de cara: por token salen parecidas. Con una sola petición a la vez, el trabajo es memory-bound y se paga por ancho de banda. Con muchas peticiones juntas (batching) la cuenta cambia, y la H100 gana más.
? [reto] Una startup duda entre comprar una RTX PRO 6000 (≈ US$16,399) o rentarla en el *Secure Cloud* de RunPod (≈ US$2.69 la hora). La tarjeta gasta 600 W y la luz le cuesta US$0.15 por kWh (un supuesto). (a) Encendida 24/7, ¿cuánto cuesta la luz al mes? (b) ¿En cuántas horas de uso se paga la compra, contando la luz? (c) ¿Y si la usan 8 horas al día? (d) Di dos costos que la cuenta todavía no incluye.
- (a) 0.6 kW × 730 h = 438 kWh; × 0.15 ≈ **US$66 al mes**.
- (b) Cada hora propia ahorra 2.69 − 0.6 × 0.15 = US$2.60. 16,399 ÷ 2.60 ≈ **6,307 horas**: ≈ 8.6 meses 24/7.
- (c) A ≈ 243 horas al mes: 6,307 ÷ 243 ≈ **26 meses**, más de dos años.
- (d) La computadora que la hospeda (CPU, RAM, fuente de poder), el enfriamiento, el tiempo de quien la mantiene, que no tiene N+1 ni zonas, y que en tres años valdrá mucho menos.
:::

## Lo que sigue {What comes next} [extra]

**En la Ronda:**

- **M04 · Hardware para inferencia** usa la tabla de GPUs (memoria, ancho de banda, BF16 y FP8, y el orden de magnitud del precio), la cuenta de costo por 1,000 predicciones con la utilización real y las maneras de compartir una GPU (MIG, time-slicing, la `g6f`).
- **M13 · Nube** es esta lección hecha diseño: los precios de las familias, por qué gana la instancia más chica, spot con su aviso y su cola, Savings Plans y reservas («descuento no es capacidad»), cuotas por vCPU con la cuenta de C01 y las horas facturadas contra las trabajadas.
- **M06 · Orquestación y escalado** explica qué pasa cuando el autoscaler pide un nodo y por qué tarda minutos.

**En Sensei:** la siguiente lección, «Redes en la nube», cobra lo que esta no: los bytes que cruzan de zona, el NAT y la salida a internet, que en C01 suman más que las GPUs. Después, «Servicios gestionados, serverless y permisos» compara servir en tus propias instancias contra un endpoint gestionado y explica el *cold start*. Las estaciones de Kubernetes cuentan quién pide los nodos y cómo se reparten las GPUs entre pods.

**En IA Privada:** la cuenta de rentar contra comprar, completa, con servidores, luz, depreciación y modelos de pesos abiertos. Sus calculadoras parten de la tabla de GPUs de esta lección.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
instancia familia-instancia nodo gpu-hora right-sizing hora-facturada costo-por-prediccion etiqueta-costos on-demand spot aviso-interrupcion savings-plan instancia-reservada cuota-servicio error-capacidad reserva-capacidad capacity-block mig fraccion-gpu acelerador-propio
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué rentas exactamente cuando pides una `g4dn.xlarge`, y qué dice cada parte del nombre?
Una máquina virtual con 4 vCPU, 16 GiB de RAM y una T4. La `g` es la familia de GPUs para inferencia, el `4` la generación, `dn` los extras (disco NVMe local y red rápida) y `xlarge` el tamaño: 4 vCPU.
? ¿Por qué una T4 cuesta casi el doble en la `g4dn.12xlarge` que en la `g4dn.xlarge`?
Porque la grande trae mucha más CPU y RAM por GPU: 3.912 ÷ 4 ≈ US$0.98 contra US$0.526. Para inferencia gana la instancia más chica que trae tu GPU.
? C01 paga lo mismo con 116 o con 1,200 fotos por segundo. ¿Qué cambia?
El costo por predicción: de ≈ US$0.0025 a ≈ US$0.00024 por 1,000. La nube cobra horas encendidas, no trabajo.
? ¿Qué decide si un trabajo puede ir en spot?
Lo que pasa si te quitan la máquina con 2 minutos de aviso (30 s en Google y Azure). Si solo se repite un pedazo, sí; si un usuario ve un error, no.
? ¿Cuándo conviene un compromiso con 37 % de descuento?
Si usarías esa máquina más del 63 % de las horas. Por eso se compromete la base que corre todo el año, nunca el pico.
? Tienes Savings Plan y cuota de sobra. ¿Por qué puede fallar el arranque de una GPU?
Porque la zona puede no tener máquinas de ese tipo (`InsufficientInstanceCapacity`). El descuento no aparta nada; solo una reserva de capacidad lo garantiza.
:::
