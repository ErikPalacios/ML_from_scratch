---
titulo: CPU y GPU
en: CPU and GPU
subtitulo: Qué hay dentro de cada chip, por qué la ResNet-50 de C01 corre en una GPU, qué cables y qué software la unen con la CPU, y qué mide de verdad el porcentaje que muestra nvidia-smi.
pregunta: Si una CPU hace miles de millones de operaciones por segundo, ¿por qué la ResNet-50 de C01 corre en una GPU, qué hay dentro de cada chip y qué los une?
requisitos: flops, memoria
---

:::idea
Una CPU tiene pocos núcleos muy listos que hacen cualquier tarea, una tras otra y muy rápido. Una GPU tiene miles de carriles sencillos que hacen la misma cuenta sobre muchos números a la vez, y circuitos que multiplican bloques de matrices de un jalón. La ResNet-50 de C01 es casi pura multiplicación de matrices: por eso va en la GPU. Pero la GPU no trabaja sola: la CPU le prepara los datos y le dice qué hacer, una conexión llamada PCIe las une, y el software de NVIDIA (CUDA y el driver) las pone de acuerdo.
:::

En la lección de FLOPs contaste el trabajo: la ResNet-50 pide 8.2 GFLOPs por foto. En el pico de diseño de C01, 500 fotos por segundo, eso es:

**500 × 8.2 × 10⁹ = 4.1 × 10¹² FLOPs por segundo: 4.1 [[tflops|TFLOPS]] de trabajo útil.**

¿Qué chip puede con eso? En «Memoria, caché y disco» viste dónde viven los bytes. Aquí abrimos los dos chips que hacen las cuentas, los cables que los unen y el software que los pone de acuerdo. Vas a seguir la foto de Ana desde que una CPU la decodifica hasta que la GPU devuelve 500 logits.

Al final vas a poder explicar con números tres cosas que la Ronda da por sabidas: por qué C01 sirve en una T4 y no en una CPU, por qué la T4 sola no basta (alguien tiene que prepararle las fotos) y por qué su GPU marca un porcentaje que engaña.

## La CPU por dentro: núcleos, hilos de hardware y vCPU {Inside the CPU: cores, hardware threads and vCPUs}

La [[cpu|CPU]] (*central processing unit*) es el chip que corre los programas. Un programa, ya listo para correr, es una lista de instrucciones muy simples: sumar dos números, compararlos, copiar un número de la memoria, saltar a otra instrucción si algo es cierto.

### El núcleo

Un [[nucleo|núcleo]] (*core*) es un procesador completo dentro del chip: puede correr un programa por su cuenta. Hace siempre lo mismo: lee la siguiente instrucción, la ejecuta y pasa a la otra. Va al ritmo de un reloj que hace tic miles de millones de veces por segundo; cada tic es un **ciclo**. Los tics por segundo se miden en hercios (Hz): un reloj de 3 GHz da 3 × 10⁹ ciclos por segundo, y un núcleo moderno termina varias instrucciones en cada ciclo.

Para trabajar, el núcleo tiene sus **registros**: unas decenas de casillas dentro del chip donde guarda los números con los que está haciendo cuentas. Tiene también su propia [[cache-cpu|caché]], la memoria chiquita y rapidísima de la lección anterior, para no esperar a la [[ram|RAM]].

Un chip trae varios núcleos: de 8 a 16 en una laptop y decenas en un servidor (los más grandes pasan de cien). Cada núcleo corre su propio [[hilo]] al mismo tiempo que los demás: eso es [[paralelismo]] de verdad, no turnos.

:::profundo Por qué un solo núcleo es tan rápido
Un núcleo moderno no espera a terminar una instrucción para empezar la siguiente: las procesa en cadena, como una línea de ensamble. Adivina hacia dónde va a saltar el programa (*branch prediction*) para no frenar la línea, y adelanta las instrucciones que no dependen de las anteriores (*out-of-order execution*). Todo ese ingenio sirve para que **un** hilo termine pronto, aunque su programa esté lleno de decisiones. Una GPU casi no tiene nada de eso: usa ese espacio del chip para poner más carriles de cálculo.
:::

### Hilos de hardware: un núcleo que se presenta como dos

En «Programa, proceso e hilo» viste que muchos núcleos de servidor corren dos hilos a la vez. Así lo hacen. Mientras un hilo espera un dato de la RAM, partes del núcleo se quedan quietas. Para aprovecharlas, casi todos los núcleos de servidor x86 (la [[arquitectura-cpu|arquitectura]] de los chips de Intel y AMD) tienen lugar para **dos hilos de hardware**: dos juegos de registros, cada uno con un hilo, que el núcleo avanza a la vez, llenando los huecos de uno con instrucciones del otro. Intel lo llama *Hyper-Threading*; el nombre general es SMT (*simultaneous multithreading*). El [[sistema-operativo|sistema operativo]] ve dos «CPUs» donde hay un solo núcleo, y en cada una pone a correr un hilo.

Los dos hilos comparten los mismos circuitos de cálculo: juntos hacen un poco más de trabajo que uno solo, no el doble. Una red neuronal tiene esos circuitos ocupados casi todo el tiempo y deja pocos huecos que llenar: ahí la ganancia es chica.

### El vCPU: lo que renta la nube

En la nube no rentas núcleos: rentas [[vcpu|vCPU]] (*virtual CPU*). En las máquinas de AWS con procesador Intel, como las dos de C01, **un vCPU es un hilo de hardware: medio núcleo físico**. En las de procesador Graviton, los chips de AWS con arquitectura Arm (la de los teléfonos), un vCPU sí es un núcleo completo, porque no tienen SMT; lo mismo en las de AMD más nuevas, como las m7a, que AWS ofrece con el SMT apagado.

Dos máquinas de C01, en AWS:

- **g4dn.xlarge**, la de la GPU: 4 vCPU (2 núcleos físicos), 16 GiB de RAM y una T4, por ≈ US$0.526 la hora.
- **c6i.xlarge**, la del gateway, la puerta de entrada que recibe las fotos: 4 vCPU y ninguna GPU.

Un vCPU de una c6i cuesta ≈ US$0.0425 la hora (la máquina entera, ≈ US$0.17, entre 4); en la g4dn sale a 0.526 ÷ 4 ≈ US$0.13, ≈ 3 veces más, porque ahí pagas también la GPU. Por eso C01 no hace en la máquina de la GPU lo que puede hacer una CPU barata.

En Kubernetes, «1 CPU» es 1 vCPU, y se cuenta como **tiempo**: un *pod* (cada copia de un programa que Kubernetes pone a correr) con un límite de 2 CPU puede usar 2 segundos de CPU por cada segundo de reloj, entre todos sus hilos; por ejemplo, 4 hilos que corren medio segundo cada uno. Si se pasa, el kernel lo frena un rato (*CPU throttling*) con el mismo [[cgroup]] que le pone su tope de memoria.

### La CPU que alimenta a la GPU

Antes de que la GPU vea la foto de Ana, una CPU la decodifica, la gira según su [[exif|EXIF]], la reduce a 224 × 224 y la normaliza. En C01 eso cuesta ≈ 6 ms de CPU por foto. En el pico de diseño:

**500 fotos por segundo × 6 ms = 3,000 ms de CPU por segundo = 3 vCPU ocupados todo el tiempo.**

Si una T4 trabajara a su máximo medido, 1,200 fotos por segundo, harían falta 1,200 × 6 ms = 7.2 vCPU solo para prepararle las fotos. La g4dn.xlarge trae 4, y Triton, el programa de NVIDIA que sirve el modelo, ya pide 2. La GPU se quedaría esperando a la CPU. Por eso C01 prepara las fotos en su propio *tier* (una capa aparte de máquinas): los pods del gateway, en máquinas c6i. A la máquina de la GPU solo le llegan tensores listos.

:::calculadora cpu-gpu-alimentar
Arranca con el pico de diseño de C01. Después pon 1200, lo que pediría una T4 a su máximo: ¿cuántas c6i.xlarge hacen falta al 60 %?
:::

## SIMD: muchos números en una sola instrucción {SIMD: many numbers in a single instruction}

Si un núcleo hiciera una suma por instrucción, ni con decenas de núcleos llegaría a los billones de operaciones por segundo de una red. El truco es que una instrucción puede trabajar sobre varios números a la vez.

### Registros anchos

Se llama [[simd|SIMD]] (*single instruction, multiple data*: una instrucción, muchos datos). El núcleo tiene **registros vectoriales**, registros anchos donde caben varios números en fila, y circuitos que operan sobre todos al mismo tiempo. Cada posición del registro es un **carril** (*lane*).

Las familias que vas a oír, en los chips x86:

| Instrucciones | Desde | Ancho del registro | Números FP32 por registro |
|---|---|---|---|
| SSE | 1999 | 128 bits | 4 |
| AVX y AVX2 | 2011 y 2013 | 256 bits | 8 |
| AVX-512 | 2017, en servidores | 512 bits | 16 |

Los chips Arm, como los de los teléfonos, las Mac con chip de Apple y los Graviton, traen NEON, de 128 bits; los Graviton más nuevos agregan otra, SVE.

:::figura cpu-gpu-simd
Arriba, una suma normal: una instrucción, una suma. En medio, una suma con AVX-512: los registros miden 512 bits, caben 16 números FP32, y una instrucción hace las 16 sumas a la vez. Abajo, cuántos números caben en esos 512 bits según el formato.
:::

El mismo registro guarda más números si son más chicos: en 512 bits caben 16 FP32, 32 [[fp16|FP16]] o BF16, o 64 [[int8|INT8]]. También en una CPU, menos bits por número son más números por instrucción, si el chip trae instrucciones para ese formato.

### Multiplicar y sumar de un jalón

La instrucción más importante para una red es la **FMA** (*fused multiply-add*): multiplica y suma en un solo paso, d = a × b + c, en todos los carriles. Es una [[mac|MAC]] por carril, que se cuenta como 2 FLOPs. Con eso ya puedes calcular el pico de un núcleo. Los Xeon, los chips de Intel para servidor, como los de las máquinas de C01, tienen por núcleo dos unidades FMA de 512 bits: dos circuitos que hacen, cada uno, una FMA de 16 carriles en cada ciclo.

:::cuenta El pico de un núcleo con AVX-512, en FP32
Carriles por instrucción // 512 bits entre 32 bits | 512 ÷ 32 | 16
FLOPs por instrucción // cada carril hace una FMA: 2 FLOPs | 16 × 2 | 32
FLOPs por ciclo // dos unidades FMA por núcleo | 32 × 2 | 64
Por segundo // a 3 GHz, un supuesto redondo | 64 × 3 × 10⁹ | ≈ 192 GFLOPS
Una c6i.xlarge // 4 vCPU = 2 núcleos | 2 × 192 | ≈ 384 GFLOPS
= Una T4 hace 8.1 TFLOPS en FP32 y 65 en FP16: ≈ 21 y ≈ 170 veces una c6i.xlarge entera. Y el pico de la CPU, como el de cualquier chip, tampoco se alcanza.
:::

Python puro no usa nada de esto: cada suma pasa por el intérprete, un número a la vez. NumPy, PyTorch y ONNX Runtime sí lo usan, porque llaman a código escrito para SIMD (como oneDNN, una biblioteca de Intel que usa PyTorch). Por eso un `for` de Python sobre un millón de números es decenas o cientos de veces más lento que la misma suma en NumPy.

### INT8 en la CPU: VNNI y AMX

Para INT8, los Xeon recientes traen instrucciones especiales. **VNNI** (*Vector Neural Network Instructions*, desde 2019; las c6i la tienen) hace 4 veces más MACs por instrucción que FP32. **AMX** (*Advanced Matrix Extensions*, desde 2023; la tienen las c7i, la generación que sigue a las c6i) es un circuito dentro de cada núcleo que multiplica bloques de matrices, parecido a los tensor cores de una GPU que ves en un rato. Con ellas, la distancia entre una CPU y una GPU chica se acorta mucho, y por eso la Ronda deja pendiente medir la ResNet-50 en INT8 en CPU. Sin ellas, INT8 puede ser **más lento** que FP32, como advierte la documentación de ONNX Runtime que cita M08.

:::profundo VNNI, AMX y cómo saber qué tiene tu CPU
VNNI multiplica, en cada carril de 32 bits, 4 pares de INT8 y los suma en un solo paso: con 512 bits son 64 MACs por instrucción, contra 16 en FP32. AMX multiplica bloques de INT8 o de BF16; según Intel, hace 2,048 operaciones INT8 por ciclo por núcleo, 8 veces VNNI.

En Linux, `lscpu` lista las instrucciones del chip en su renglón *Flags*: busca `avx512f` (AVX-512), `avx512_vnni` (VNNI) y `amx_int8` (AMX). Dentro de un contenedor ves las del chip de la máquina, porque el contenedor no cambia el procesador. Y una laptop no se parece a un servidor: un chip de Apple tiene NEON y su propia unidad de matrices, y por eso sus tiempos no sirven para dimensionar una máquina x86 (M08 lo muestra con números).
:::

## La GPU por dentro: SMs, warps y miles de hilos {Inside the GPU: SMs, warps and thousands of threads}

La [[gpu|GPU]] resuelve el mismo problema, hacer billones de cuentas por segundo, al revés. En vez de pocos núcleos listísimos, trae muchísimos carriles sencillos y los mantiene ocupados con miles de hilos.

Un hilo de GPU es más sencillo que los de «Programa, proceso e hilo»: es una de miles de copias de la misma función, cada una sobre su pedacito de los datos, por ejemplo un número de la matriz de salida. Cómo se escribe esa función lo ves en la sección de CUDA.

### El SM: el «núcleo» de la GPU

Una GPU de NVIDIA está hecha de [[sm|SMs]] (*streaming multiprocessors*). Un SM es lo más parecido a un núcleo de CPU: tiene quien reparta las instrucciones, sus registros, una memoria chiquita y rápida, y circuitos de cálculo. Una T4 tiene 40 SMs; una H100 SXM (la versión montada en la placa del servidor, la de la lección de FLOPs), 132.

Dentro de cada SM de la T4 hay 64 carriles para FP32 y 8 [[tensor-core|tensor cores]], que ves en la sección que sigue. Los 2,560 «CUDA cores» de la T4, que en lecciones anteriores llamamos núcleos sencillos, como los anuncia NVIDIA, son esos carriles: 40 SMs × 64 = 2,560. Ojo con el nombre: un CUDA core no es un núcleo como los de una CPU, porque no puede correr su propio programa. Es un carril, como cada uno de los 16 de AVX-512.

:::figura cpu-gpu-chips
Arriba, una CPU de 8 núcleos grandes, cada uno con su caché y 32 carriles FP32. Abajo, la T4: 40 SMs, una caché L2 para todos y la VRAM afuera. Al final, un SM de cerca, con sus 64 carriles, sus 8 tensor cores y sus hilos en grupos de 32, los warps. Compara los carriles: 256 contra 2,560.
:::

De ahí salen los 8.1 TFLOPS en FP32 de la lección de FLOPs: 40 SMs × 64 carriles × 2 FLOPs por FMA × 1.59 × 10⁹ ciclos por segundo (el reloj de la T4 a toda velocidad) ≈ 8.1 × 10¹².

### El warp: 32 hilos que marchan juntos

Un SM no maneja sus hilos uno por uno. Los agrupa de 32 en 32, y cada grupo es un [[warp]]. Los 32 hilos de un warp ejecutan **la misma instrucción al mismo tiempo**, cada uno con sus propios datos. NVIDIA lo llama SIMT (*single instruction, multiple threads*). Es SIMD con otra cara: cada carril parece un hilo independiente, pero todos marchan al paso.

¿Cuántos hilos caben? Un SM de la T4 mantiene vivos, con sus registros listos para correr, hasta 1,024 a la vez, 32 warps: en toda la T4, 40 × 1,024 = **40,960 hilos**. Una H100 SXM, con 2,048 por SM, pasa de 270,000. Una CPU de 32 núcleos con SMT corre 64 a la vez.

### Esconder la espera

¿Para qué tantos hilos, si cada SM tiene 64 carriles? Para no esperar.

Traer un número de la [[vram|VRAM]] tarda cientos de ciclos. Una CPU combate esa espera con cachés grandes y adivinando qué va a necesitar. Un SM hace otra cosa: cuando un warp se queda esperando un dato, en el siguiente ciclo pone a trabajar a otro warp que ya tiene el suyo. Cada warp tiene sus propios registros, así que cambiar de uno a otro no cuesta nada. El [[cambio-contexto|cambio de contexto]] entre hilos de una CPU, en cambio, cuesta microsegundos.

Con números: sus 64 carriles le alcanzan a un SM de la T4 para avanzar 64 hilos por ciclo, el equivalente a 2 warps. Los otros 30 pueden estar esperando sus datos, y el ciclo no se pierde mientras quede alguno listo.

La consecuencia práctica: **una GPU solo es rápida si le das muchísimo trabajo independiente a la vez**. Una multiplicación de matrices grande, o un batch de 32 fotos, la llena. Una sola foto la deja medio vacía.

:::analogia Maestros y cuadrillas
Una CPU es un taller con 16 maestros relojeros: cada uno arma un reloj completo, toma decisiones y cambia de plan cuando algo sale distinto. Una GPU es una obra con 40 capataces, cada uno al frente de varias cuadrillas de 32 albañiles. El capataz grita una orden («¡pongan un ladrillo!») y los 32 de una cuadrilla la cumplen a la vez, cada uno en su lugar del muro. Cuando una cuadrilla espera material, el capataz le grita la siguiente orden a otra. El maestro es un núcleo; el capataz, un SM; la cuadrilla, un warp, y cada albañil, un hilo.

**Dónde se rompe:** un albañil de verdad puede hacer otra cosa si su ladrillo no llegó; un hilo de un warp, no: si unos van por un camino y otros por otro, la cuadrilla recorre los dos, uno tras otro (está en el bloque de abajo). Y cambiar de cuadrilla, que a un capataz le toma tiempo, a la GPU no le cuesta nada.
:::

:::profundo Cuando los hilos de un warp no están de acuerdo
Si el código tiene un `if` y unos hilos del warp van por el «sí» y otros por el «no», el warp no puede dar dos instrucciones distintas a la vez. Recorre los dos caminos, uno tras otro, y en cada uno los hilos del otro camino esperan sin hacer nada. Se llama **divergencia** (*warp divergence*). Basta un hilo distinto para que todo el warp pague los dos caminos:

```python
def instrucciones(warp, costo_si=10, costo_no=30):
    """Un warp da una sola instrucción a la vez a sus 32 hilos.
    Si al menos un hilo va por un camino, el warp entero lo recorre."""
    total = 0
    if any(warp):
        total += costo_si          # los hilos del «no» esperan sin hacer nada
    if not all(warp):
        total += costo_no          # ahora esperan los del «sí»
    return total

casos = {
    "los 32 por el sí": [True] * 32,
    "los 32 por el no": [False] * 32,
    "mitad y mitad": [i % 2 == 0 for i in range(32)],
    "31 por el sí y 1 por el no": [True] * 31 + [False],
}
for nombre, warp in casos.items():
    print(f"{nombre:<27} {instrucciones(warp)} instrucciones")
```

```salida
los 32 por el sí            10 instrucciones
los 32 por el no            30 instrucciones
mitad y mitad               40 instrucciones
31 por el sí y 1 por el no  40 instrucciones
```

Por eso los kernels de una GPU se escriben para que los hilos vecinos hagan lo mismo, y por eso una red neuronal, que hace la misma cuenta sobre millones de números, le sienta tan bien.
:::

## Tensor cores: por qué la ResNet-50 va en la GPU {Tensor cores: why the ResNet-50 runs on the GPU}

Con sus carriles normales, una T4 hace 8.1 TFLOPS: unas 21 veces una c6i.xlarge. Es mucho, pero casi toda su velocidad sale de otro lado.

### Un circuito para multiplicar bloques

Un [[tensor-core|tensor core]] es un circuito dentro del SM que hace una sola cosa: multiplica dos bloques chicos de matrices y le suma el resultado a un tercero, **D = A × B + C**, como una sola operación. En la T4, cada tensor core multiplica en cada ciclo un bloque de 4 × 4 por otro de 4 × 4, en FP16. El resultado tiene 4 × 4 = 16 casillas, y cada una es un producto punto de 4 pares: 16 × 4 = 64 MACs. Las sumas se acumulan en FP32, como viste en «Cómo guarda números una computadora».

Una multiplicación grande se parte en esos bloques, y cada SM los despacha con sus 8 tensor cores:

:::cuenta Los 65 TFLOPS de la T4
MACs por ciclo en un SM, con tensor cores // 8 tensor cores × 64 MACs | 8 × 64 | 512
Contra sus carriles normales // 64 carriles, una FMA cada uno | 512 ÷ 64 | 8 veces más
FLOPs por ciclo en un SM | 512 × 2 | 1,024
Toda la T4, por segundo // 40 SMs a 1.59 GHz | 1,024 × 40 × 1.59 × 10⁹ | ≈ 65 TFLOPS
= Son las 8 veces de la lección de FLOPs (65 contra 8.1 TFLOPS), con su origen: en cada ciclo, un SM hace 512 MACs en sus tensor cores y solo 64 en sus carriles.
:::

### Qué piden

Son rapidísimos, pero exigentes:

- **Formatos de pocos bits.** Los dos números de cada multiplicación tienen que estar en un formato que el tensor core acepte, y en el mismo: FP16 con FP16, INT8 con INT8. Con un modelo en FP32, la T4 deja sus tensor cores parados y su techo baja 8 veces.
- **Matrices grandes.** Si una matriz tiene una sola fila, llena 1 de las 4 filas de cada bloque y tira por lo menos tres cuartas partes del trabajo: otra razón para el [[batch|batching]].
- **La generación correcta.** Nacieron en 2017, con la V100, y cada generación agregó formatos:

| GPU (generación, año) | Formatos de sus tensor cores |
|---|---|
| T4 (Turing, 2018) | FP16, INT8 e INT4 |
| A100 (Ampere, 2020) | además, BF16 y TF32 |
| H100 (Hopper, 2022) y L4 (Ada, 2023) | además, FP8 (la H100 ya no trae INT4) |
| B200 (Blackwell, 2024) | además, FP6 y FP4 |

### La respuesta para C01

Ya puedes poner los números juntos. Esta es la tabla de la lección: cuántas operaciones hace cada pieza en **un ciclo** de su reloj.

| Pieza | Operaciones por ciclo |
|---|---|
| Un núcleo de CPU con AVX-512, en FP32 | 64 |
| Un núcleo de CPU con AMX, en INT8 | 2,048 (según Intel) |
| Un SM de la T4, carriles FP32 | 128 |
| Un SM de la T4, tensor cores FP16 | 1,024 |
| Un SM de la T4, tensor cores INT8 | 2,048 |

Fíjate: en FP32, un SM hace por ciclo apenas el doble que un núcleo de CPU, y a la mitad del reloj; con AMX, un núcleo iguala a un SM en INT8. La GPU gana porque trae 40 SMs (132 en una H100 SXM), porque sus tensor cores multiplican 8 veces más que sus carriles y porque mantiene miles de hilos listos para no esperar.

:::cuenta ¿Quién da los 4.1 TFLOPS de C01?
Lo que pide C01 en el pico de diseño // 500 fotos por segundo × 8.2 GFLOPs | 500 × 8.2 × 10⁹ | 4.1 TFLOPS
Lo que da una T4, medido // ≈ 1,200 fotos por segundo: el 15 % de su pico | 1,200 × 8.2 × 10⁹ | ≈ 9.8 TFLOPS
Margen de una sola T4 // contra el pico de diseño | 1,200 ÷ 500 | 2.4 veces
Núcleos de CPU en FP32, con eficiencia perfecta // 192 GFLOPS cada uno, algo que nunca pasa | 4.1 × 10¹² ÷ (192 × 10⁹) | ≈ 21 núcleos
Esos núcleos, en dinero // 2 vCPU por núcleo en una c6i, a ≈ US$0.0425 cada uno | 21 × 2 × 0.0425 | ≈ US$1.8 la hora
= Una sola T4, por US$0.526 la hora, da más del doble del pico de diseño. La CPU en FP32 costaría ≈ 3.4 veces más solo por el modelo, y eso con una eficiencia perfecta que nunca logra: en la práctica, varias veces más. Aparte van los núcleos que preparan las fotos.
:::

Esa es la respuesta corta: la ResNet-50 es casi pura multiplicación de matrices, y una GPU con tensor cores la hace varias veces más barato por foto que una CPU en FP32, siempre que la GPU tenga trabajo. La letra chica: las T4 de C01 trabajan en promedio al ≈ 5 % de su capacidad, y con la GPU casi vacía la CPU en INT8 vuelve a ser candidata (la cuenta está en «En la vida real»).

¿Dónde gana la CPU? En lo que tiene muchas decisiones y poco cálculo repetido: los árboles de decisión, cadenas de preguntas de sí o no (como el modelo de C14), los modelos chicos o con poco tráfico, el preprocesamiento y todo el código que no es el modelo. ¿Y la GPU? En las CNNs con tráfico alto, en los [[llm|LLMs]] y en casi todo el entrenamiento.

## CUDA y los kernels: cómo la CPU le da trabajo a la GPU {CUDA and kernels: how the CPU gives the GPU work}

La GPU no corre Python ni el sistema operativo, ni decide nada sola: hace lo que la CPU le manda. Esta sección es cómo se lo manda.

### CUDA

[[cuda|CUDA]] (*Compute Unified Device Architecture*) es la plataforma de NVIDIA para programar sus GPUs, desde 2007: el juego de herramientas para escribir programas que las usen. Trae un lenguaje (C++ con algunas extensiones), un compilador, un *runtime* (las funciones con que un programa le pide cosas a la GPU) y bibliotecas con el trabajo ya hecho (cuBLAS viene con CUDA; las otras tres, NVIDIA las publica aparte):

- **cuBLAS**, para multiplicar matrices.
- **cuDNN**, para convoluciones y otras capas de redes.
- **NCCL**, para que varias GPUs se pasen datos.
- **TensorRT**, el compilador que convierte un modelo en un *engine* hecho a la medida de un tipo de GPU, como el de C01 para la T4 (en otro tipo no carga: lo ves en la sección extra del driver).

Casi nunca escribes CUDA: cuando PyTorch multiplica dos tensores en la GPU, llama a cuBLAS. CUDA solo funciona en GPUs de NVIDIA; AMD tiene su propia plataforma (ROCm), y las TPUs, los chips que Google diseñó para ML, otra (XLA). Casi veinte años de bibliotecas y código escritos para CUDA son buena parte de por qué casi todo el ML corre en NVIDIA.

### El kernel: una función que corren miles de hilos

Un [[kernel-gpu|kernel]] es la función que corren los hilos de la GPU: miles de copias a la vez, y cada una calcula un pedacito del resultado. Para sumar dos vectores de un millón de números, el kernel dice «suma el número i de los dos», y lo corren un millón de hilos, cada uno con su i. Cada capa del modelo es uno o más kernels: una convolución, sumar el sesgo, una [[relu|ReLU]].

:::ojo
«Kernel» quiere decir al menos tres cosas en este oficio. Aquí es una función de la GPU. En «El sistema operativo» vas a ver el [[kernel]] de Linux, el programa que manda sobre el hardware de la máquina. Y en inglés, el [[filtro]] de una convolución también se llama *kernel*. No tienen nada que ver entre sí: fíjate en el contexto.
:::

### Lanzar: la CPU deja el trabajo en una fila

Para correr un kernel, la CPU lo **lanza** (*launch*): el runtime de CUDA le pasa la orden al [[driver]], el programa del sistema operativo que habla con la GPU (tiene su propia sección extra), y la orden queda en una fila de trabajo de la GPU, un *stream*. La GPU corre los kernels de una fila en orden, uno tras otro.

La CPU no espera a que el kernel termine: deja la orden y sigue con la siguiente línea de tu programa. Es **asíncrono**. La CPU solo espera cuando pide un resultado. En PyTorch, eso pasa cuando haces `x.item()` o `x.cpu()` (traer un número o un tensor de la GPU), cuando imprimes un tensor o cuando llamas a `torch.cuda.synchronize()`, que espera a que la GPU acabe todo lo pendiente.

### Lo que cuesta lanzar

Cada lanzamiento le cuesta a la CPU unos microsegundos; 5 µs es un número redondo para las cuentas. Parece nada, hasta que cuentas los kernels de un modelo:

```python
etapas = [3, 4, 6, 3]                    # bloques de cada etapa de la ResNet-50
bloques = sum(etapas)                    # 16 bloques de 3 convoluciones
convs = 1 + 3 * bloques + len(etapas)    # la del inicio, las de los bloques y 4 atajos
relus = 1 + 3 * bloques                  # la del inicio; en cada bloque, dos adentro y una tras la suma
sueltos = convs + convs + relus + bloques + 3   # convs, una BatchNorm por conv, ReLUs, sumas, 2 poolings y la capa final
fusionados = convs + 3                   # cada conv se lleva su BatchNorm, su ReLU y su suma
print(f"convoluciones: {convs} · kernels sin fusionar: {sueltos} · fusionados: {fusionados}")

lanzar = 5e-6                            # segundos de CPU por lanzamiento (un número redondo)
for nombre, n in (("sin fusionar", sueltos), ("fusionados", fusionados), ("un CUDA graph", 1)):
    print(f"{nombre:>13}: {n:>3} × 5 µs = {n * lanzar * 1e6:,.0f} µs de CPU por batch")
```

```salida
convoluciones: 53 · kernels sin fusionar: 174 · fusionados: 56
 sin fusionar: 174 × 5 µs = 870 µs de CPU por batch
   fusionados:  56 × 5 µs = 280 µs de CPU por batch
un CUDA graph:   1 × 5 µs = 5 µs de CPU por batch
```

Sin fusionar, la ResNet-50 son 174 operaciones por batch, y cada una es al menos un kernel. TensorRT fusiona (junta en un solo kernel) cada convolución con su BatchNorm, su ReLU y su suma, y quedan 56. ¿Importan esos microsegundos? Depende de **quién espera a quién**:

```python
def correr(duraciones_us, lanzar_us):
    """La CPU lanza los kernels uno tras otro; la GPU corre cada uno en cuanto le llega."""
    lanzado = fin = trabajo = 0.0
    for d in duraciones_us:
        lanzado += lanzar_us             # la CPU terminó de lanzar este kernel
        inicio = max(lanzado, fin)       # la GPU espera a que llegue y a que acabe el anterior
        fin = inicio + d
        trabajo += d
    return fin, trabajo / fin

for nombre, d in (("56 kernels de 50 µs", 50), ("56 kernels de 3 µs", 3)):
    total, ocupada = correr([d] * 56, lanzar_us=5)
    print(f"{nombre}: {total:,.0f} µs en total · la GPU trabajó el {ocupada:.0%} del tiempo")
```

```salida
56 kernels de 50 µs: 2,805 µs en total · la GPU trabajó el 100% del tiempo
56 kernels de 3 µs: 283 µs en total · la GPU trabajó el 59% del tiempo
```

Mientras cada kernel tarde en la GPU más de lo que la CPU tarda en lanzar el siguiente, el costo se esconde: la CPU va adelante, llenando la fila. Con kernels de 3 µs pasa lo contrario: la CPU no alcanza a la GPU, que pasa cuatro de cada diez microsegundos esperando. Eso pasa con modelos chicos, con batches de 1 y con PyTorch corriendo operación por operación desde Python, que le agrega su propio costo a cada una. La Ronda (M07) estima que C01 sacaría del orden de 100 fotos por segundo por proceso con PyTorch sin optimizar en una T4, contra ≈ 1,200 con Triton y TensorRT: el salto junta el engine en FP16, la fusión y el batching.

### Tres remedios

- **Menos kernels:** fusionar capas, lo primero que hace TensorRT.
- **Kernels más grandes:** el [[batch|batching]]. Un batch de 32 lanza los mismos 56 kernels que una foto sola, cada uno con 32 veces más trabajo.
- **Un solo lanzamiento:** un *CUDA graph* graba una vez la secuencia completa de kernels y después la relanza de un jalón. Lo usa `torch.compile`, el compilador de PyTorch, en su modo `reduce-overhead`, y los servidores de LLMs como vLLM lo preparan al arrancar (C10 lo menciona).

:::profundo Varios hilos no hacen un batch
Si tu servidor atiende requests con varios hilos de Python y cada uno llama al modelo de PyTorch con su foto, parece que la GPU recibe trabajo en paralelo. No: por omisión, los kernels de todos van a la misma fila y la GPU los corre uno tras otro, cada uno con una foto. La GPU sigue viendo batches de 1. Para juntar fotos hace falta alguien que las junte antes de llamar al modelo: el *dynamic batching* de Triton, que en C01 espera hasta 2 ms para juntar hasta 32. En CPU es distinto: ahí varios hilos sí suman, hasta llenar los núcleos (M07). Por qué, con el [[gil|GIL]] de Python de por medio, lo ves en la lección de async.
:::

## La memoria de la GPU y los cables: HBM, PCIe y NVLink {GPU memory and the wires: HBM, PCIe and NVLink}

Los números viajan por tres caminos, cada uno con su velocidad: de la VRAM al chip, de la RAM de la máquina a la GPU y, en los modelos grandes, de una GPU a otra.

### GDDR y HBM: dos maneras de hacer la VRAM

La [[vram|VRAM]] de las GPUs medianas, como la T4, la L4 y la A10G, es **GDDR6**: chips de memoria soldados en la tarjeta (la placa donde va montada la GPU), alrededor del chip. La de las GPUs grandes, como la A100, la H100 y la H200, es [[hbm|HBM]] (*high bandwidth memory*, memoria de alto ancho de banda): capas de memoria apiladas y pegadas al chip de la GPU. La T4 lee su VRAM a 320 GB/s; la H100 SXM, a 3,350 GB/s, diez veces más. Es cara, así que solo la llevan las GPUs donde ese ancho de banda vale el precio. Ya viste en la lección de FLOPs para qué sirve: el [[decode]] de un LLM, que escribe un token a la vez, es [[memory-bound]], y sus tokens por segundo crecen casi en proporción a los GB/s.

:::profundo Por qué la HBM es tan rápida: más cables, no cables más veloces
La T4 tiene 8 chips de GDDR6 alrededor de la GPU. Cada chip se conecta con 32 cables de datos, y por cada cable pasan 10 mil millones de bits por segundo (10 Gb/s). La HBM apila varias capas de memoria, unidas por conductores que las atraviesan, y pone las pilas sobre la misma base que el chip de la GPU. Cada pila se conecta con 1,024 cables: van más lentos que los de GDDR, pero son muchísimos más.

:::figura cpu-gpu-hbm
Arriba, la T4: 8 chips GDDR6 alrededor de la GPU, 256 cables a 10 Gb/s. Abajo, la H100 SXM: 5 pilas de HBM3 pegadas al chip, 5,120 cables a ≈ 5.23 Gb/s. Fíjate en la cuenta: veinte veces más cables, cada uno a la mitad de velocidad.
:::

:::cuenta Ancho de banda = cables × velocidad de cada cable
T4, GDDR6 // 8 chips × 32 cables | 256 × 10 Gb/s ÷ 8 | 320 GB/s
H100 SXM, HBM3 // 5 pilas × 1,024 cables, a ≈ 5.23 Gb/s cada uno | 5,120 × 5.23 Gb/s ÷ 8 | ≈ 3,350 GB/s
Cuántas veces más | 3,350 ÷ 320 | ≈ 10
= Diez veces más rápida, no por cables más veloces sino por más cables. El ÷ 8 pasa de bits a bytes.
:::
:::

### PCIe: de la máquina a la GPU

La GPU es una tarjeta conectada a la máquina por [[pcie|PCIe]] (*PCI Express*), el bus (la conexión de cables) por donde la CPU habla con las tarjetas: la GPU, la de red, los discos rápidos. PCIe está hecho de **carriles** (*lanes*), cada uno con cables para ir y otros para volver. Es la misma palabra de SIMD con otro sentido: aquí un carril es un camino de cables, no una posición de un registro. Una GPU usa 16 carriles (se escribe x16), y cada generación duplica la velocidad:

| Generación | Por carril, en un sentido | x16, en un sentido | GPUs |
|---|---|---|---|
| Gen3 | ≈ 1 GB/s | ≈ 16 GB/s | T4 |
| Gen4 | ≈ 2 GB/s | ≈ 32 GB/s | L4, A10G |
| Gen5 | ≈ 4 GB/s | ≈ 64 GB/s | H100 |

Las dos direcciones van a la vez, y NVIDIA suele anunciarlas sumadas: 32 GB/s para la T4 y 64 para la L4.

:::cuenta El tensor de Ana cruza PCIe
Tamaño // 150,528 números en float32 | 150,528 × 4 B | 602,112 B
Ancho de banda // PCIe Gen3 x16, en un sentido | 16 carriles × ≈ 0.985 GB/s | ≈ 15.75 GB/s
Tiempo | 602,112 B ÷ 15.75 GB/s | ≈ 38 µs
Contra la red // del gateway a Triton | dato de la Ronda | 2 a 4 ms
Contra el cálculo // TensorRT en FP16, una foto sola | dato de la Ronda | ≈ 3 ms
= PCIe se lleva ≈ 1 % del tiempo de la GPU: mover el tensor cuesta en la red, no en PCIe. De vuelta viajan 500 logits, 2 KB.
:::

¿Cuándo sí importa PCIe? Cuando lo que cruza es grande o repetido:

```python
def tiempo(bytes_, gb_s):
    s = bytes_ / (gb_s * 1e9)
    return f"{s * 1e6:.1f} µs" if s < 1e-3 else f"{s * 1e3:.1f} ms" if s < 1 else f"{s:.1f} s"

canales = {"red 5 Gb/s": 5 / 8, "PCIe Gen3": 15.75, "PCIe Gen4": 31.5, "NVLink": 450}   # GB/s
cosas = {
    "tensor de Ana, float32": 602_112,
    "tensor de Ana, uint8": 150_528,
    "ResNet-50 de C01, FP16": 49e6,          # 24.5 M pesos × 2 B
    "Llama 3 8B en BF16": 16.06e9,
}
print(f"{'':<23}" + "".join(f"{c:>11}" for c in canales))
for cosa, b in cosas.items():
    print(f"{cosa:<23}" + "".join(f"{tiempo(b, v):>11}" for v in canales.values()))
```

```salida
                        red 5 Gb/s  PCIe Gen3  PCIe Gen4     NVLink
tensor de Ana, float32    963.4 µs    38.2 µs    19.1 µs     1.3 µs
tensor de Ana, uint8      240.8 µs     9.6 µs     4.8 µs     0.3 µs
ResNet-50 de C01, FP16     78.4 ms     3.1 ms     1.6 ms   108.9 µs
Llama 3 8B en BF16          25.7 s      1.0 s   509.8 ms    35.7 ms
```

La primera columna es la red de la g4dn.xlarge; la última, en un sentido, NVLink, la conexión directa entre GPUs que ves en un momento. Los pesos de la ResNet-50 cruzan PCIe una vez, al arrancar: 3 ms; los de un LLM de 8B, un segundo. Lo que sí nota PCIe es el video 4K sin comprimir, o un modelo con una capa que no corre en la GPU y manda tensores de ida y vuelta a la CPU en cada foto (M08 lo cuenta de ONNX Runtime).

:::diagrama cpu-gpu-viaje
Toca cada caja para ver qué hace y cuánto tarda. Sigue «La foto de Ana», luego «Arrancar el servidor» y «Si la GPU preparara sus fotos».
:::

### NVLink: de una GPU a otra

Cuando un modelo no cabe en una GPU, se parte entre varias, que en cada capa se pasan resultados parciales: por PCIe, cada paso se alargaría. [[nvlink|NVLink]] es una conexión directa entre GPUs de NVIDIA, que no pasa por PCIe: en una H100 SXM da 450 GB/s en cada sentido (900 sumados), unas 7 veces PCIe Gen5. En las máquinas de 8 GPUs, como la p5.48xlarge de AWS, unos chips llamados NVSwitch conectan las 8 entre sí a esa velocidad. La T4, la L4 y la A10G no tienen NVLink. Cómo lo usa C10 está en «En la vida real».

:::profundo Memoria fijada y DMA
La CPU no copia el tensor byte por byte: lo copia un circuito que lee directo de la RAM (DMA, *direct memory access*) mientras la CPU sigue con otra cosa. Para eso, el tensor tiene que estar en memoria **fijada** (*pinned*): RAM que el sistema operativo promete no mover ni mandar al disco, cosa que la [[memoria-virtual|memoria virtual]] sí podría hacer. Si no está fijada, el driver primero la copia a un *buffer* fijado, y tarda más: por eso los servidores de modelos usan *buffers* fijados, y PyTorch tiene `pin_memory=True`. La GPU tiene además sus propios motores de copia, así que puede copiar el siguiente batch mientras calcula el actual. C01 lo aprovecha con dos instancias del modelo, dos copias cargadas en la misma T4: mientras una copia datos, la otra calcula.
:::

## Qué mide de verdad la utilización de GPU {What GPU utilization really measures}

Falta leer el número que todos miran primero cuando una GPU parece lenta.

### Lo que dice nvidia-smi

`nvidia-smi` es el programa de NVIDIA, incluido con el driver, que reporta el estado de cada GPU: memoria usada, temperatura, potencia y un porcentaje llamado *GPU-Util*. Ese porcentaje es la [[utilizacion-gpu|utilización de GPU]], y su definición oficial es esta: **la parte del tiempo, en la última fracción de segundo, en que al menos un kernel estaba corriendo**. La misma métrica sale como `DCGM_FI_DEV_GPU_UTIL` en DCGM (*Data Center GPU Manager*), la herramienta de NVIDIA para vigilar las GPUs de un centro de datos, y como `nv_gpu_utilization` en Triton.

Fíjate en lo que no dice: cuántos de los 40 SMs trabajaron, si se usaron los tensor cores, cuántas requests están esperando. Mide **tiempo**, no cuánto del chip.

:::analogia El estacionamiento
Imagina un estacionamiento de 40 lugares y un vigilante que solo anota, minuto a minuto, si había **al menos un coche** adentro. Si un solo coche se queda todo el día, el vigilante reporta «ocupado el 100 % del tiempo», con 39 lugares vacíos. Eso es nvidia-smi: los lugares son los SMs, y el coche, un kernel que usa solo unos pocos.

**Dónde se rompe:** cada coche usa un lugar, y un kernel puede usar uno, diez o los 40 SMs. Pero la lección es la misma: «hubo algo» no es «estuvo lleno».
:::

:::figura cpu-gpu-utilizacion
Tres GPUs, cada una durante un segundo. Lo ancho de cada barra es tiempo; lo alto, cuántos SMs usa. nvidia-smi solo mide lo ancho: marca 100 % con un kernel chiquito que nunca para, y 17 % con las fotos de C01, aunque las dos estén lejos de su capacidad.
:::

En código, medir el tiempo o medir el chip es una línea de diferencia:

```python
def medir(kernels, sms=40, ventana=1000):
    """kernels: (inicio_ms, fin_ms, SMs que ocupa), sin encimarse. Lo que verían las dos métricas."""
    con_kernel = sum(fin - ini for ini, fin, _ in kernels)            # ms con algún kernel
    sm_ms = sum((fin - ini) * n for ini, fin, n in kernels)           # ms × SMs ocupados
    return con_kernel / ventana, sm_ms / (sms * ventana)

casos = {
    "un kernel chiquito que nunca para": [(0, 1000, 2)],
    "medio segundo con la GPU llena": [(0, 500, 40)],
    "58 fotos de 3 ms, la mitad de los SMs": [(k * 17, k * 17 + 3, 20) for k in range(58)],
}
for nombre, ks in casos.items():
    util, sm = medir(ks)
    print(f"{nombre:<38} nvidia-smi {util:4.0%} · SMs ocupados {sm:4.0%}")
```

```salida
un kernel chiquito que nunca para      nvidia-smi 100% · SMs ocupados   5%
medio segundo con la GPU llena         nvidia-smi  50% · SMs ocupados  50%
58 fotos de 3 ms, la mitad de los SMs  nvidia-smi  17% · SMs ocupados   9%
```

La tercera fila usa dos supuestos: que una foto sola ocupa la GPU ≈ 3 ms (lo que dice la Ronda para TensorRT con batches chicos) y que usa la mitad de sus SMs.

### Tres números para la misma T4

:::cuenta La T4 de C01 en un momento promedio
Fotos por segundo, por GPU // 116 en promedio (10 millones al día ÷ 86,400 s), repartidas entre 2 GPUs | 116 ÷ 2 | 58
Carga: contra el máximo medido // la parte de su capacidad que usa de verdad | 58 ÷ 1,200 | ≈ 5 %
nvidia-smi // 58 batches de una foto, de ≈ 3 ms cada uno (supuesto) | 58 × 3 ms = 174 ms por segundo | ≈ 17 %
SMs ocupados // si cada foto usa la mitad de los 40 SMs (supuesto) | 17 % × ½ | ≈ 9 %
= La misma GPU, en el mismo segundo, «está» al 5 %, al 17 % o al 9 % según qué preguntes. El ≈ 5 % de la Ronda es la carga, no lo que marca nvidia-smi.
:::

### Falla en las dos direcciones

La Ronda (M06) lo resume así:

- **Marca mucho con poco trabajo.** Con batches de 1, nvidia-smi puede marcar 30 o 40 % cuando la GPU haría varias veces más con batches grandes.
- **Se queda en 100 % aunque falte capacidad.** Cuando la GPU está ocupada todo el tiempo, marca ≈ 100 % igual con 2 requests en la cola que con 200. No dice cuánto esperan ni cuánto [[throughput]] queda si los batches crecen.

:::calculadora cpu-gpu-utilizacion
Arranca con la T4 de C01 en un momento promedio. Sube las fotos a 250, el pico de diseño de cada GPU: con batches de 1, nvidia-smi marca 74 %; con batches de 3, 38 %, con las mismas fotos. Después prueba 500 fotos con batches de 1: la GPU no alcanza, la cola crece y nvidia-smi se queda en 100 %.
:::

### Qué mirar en su lugar

- **Para saber si falta capacidad:** el throughput contra el máximo medido con una prueba de carga, el tiempo que las requests pasan en la cola de Triton y el tamaño promedio de los batches. C01 escala por el tiempo en cola.
- **Para saber cuánto del chip trabaja:** las métricas de perfilado de DCGM, que miden por dentro del chip. *SM activity* promedia, sobre todos los SMs, la parte del tiempo con algún warp activo; *tensor activity*, la de los ciclos con los tensor cores trabajando. Si sirves en FP16 y la segunda está cerca de 0, tu engine no usa los tensor cores.
- **Para saber si la GPU baja el ritmo:** la potencia y el reloj. La T4, una tarjeta de 70 W sin ventilador propio, baja su reloj cuando llega a su tope de potencia o se calienta (*throttling* otra vez, ahora por calor o potencia y no por un límite de Kubernetes): la misma utilización, menos trabajo hecho.

Y en Kubernetes una GPU se pide entera (1, 2…, nunca 0.5): sin herramientas para partirla, un pod ocupa la T4 completa aunque use el 5 %.

:::profundo La memoria que marca nvidia-smi
nvidia-smi también muestra la memoria usada, en MiB ([[prefijo-binario|prefijos binarios]]). Tampoco es carga: PyTorch se queda con la memoria que ya usó para volver a usarla y no se la devuelve al driver (su *caching allocator*), y TensorRT reserva la que necesita su engine al cargarlo. Una VRAM llena no es una GPU ocupada. Para saber cuánta memoria pide de verdad un modelo, en PyTorch se usa `torch.cuda.max_memory_allocated()`.
:::

## El driver y las versiones de CUDA {The driver and CUDA versions} [extra]

El error más común al llevar a un contenedor un modelo que usa GPU no está en el modelo: está en las versiones. Para entenderlo hay que separar qué pone la máquina y qué pone tu imagen, el paquete del que nace tu contenedor.

### El driver

Un [[driver]] (controlador) es el programa que le permite al sistema operativo manejar un aparato: una impresora, una tarjeta de red, una GPU. El de NVIDIA tiene dos partes:

- **Un módulo del [[kernel]] de Linux** (`nvidia.ko`), una pieza que se le agrega al kernel: la parte que habla directo con la GPU.
- **Las bibliotecas del driver** (`libcuda.so`, y NVML, la que usa `nvidia-smi`): por donde los programas le piden cosas.

El driver vive en la **máquina** (el *host*), no en tu [[contenedor]]. Cuando un contenedor usa la GPU, el NVIDIA Container Toolkit le [[montaje|monta]] adentro las bibliotecas del driver de la máquina: las hace aparecer en el contenedor sin copiarlas. En Kubernetes, además, un programa del fabricante que corre en cada nodo, el *device plugin*, detecta las GPUs y se las anuncia a Kubernetes como un recurso (`nvidia.com/gpu`). Sin él, para Kubernetes ese nodo no tiene GPUs.

### Qué pone cada quien

| Pieza | Dónde vive | En C01 |
|---|---|---|
| La GPU y su arquitectura | El hardware | T4 (sm_75) |
| El driver: módulo y `libcuda` | La máquina | El que venga instalado en los nodos g4dn |
| El runtime de CUDA y sus bibliotecas | Tu imagen | CUDA 12.6, de `tritonserver:24.08` |
| TensorRT y el engine | Tu imagen y tu repositorio de modelos | TensorRT 10.3 |
| Tu programa | Tu imagen | Triton |

:::diagrama cpu-gpu-pila
Toca cada caja. Sigue «Un arranque normal» y después los dos errores más comunes: un driver más viejo que el CUDA de la imagen, y el engine de la T4 en una L4.
:::

### La regla de las versiones

Un driver nuevo corre programas hechos con un CUDA viejo; al revés, no. La regla, en una línea: **el driver de la máquina tiene que ser al menos el que pide el CUDA de tu imagen**. NVIDIA da un margen dentro de cada versión mayor (el primer número: todas las 12.algo son la versión mayor 12): un programa hecho con cualquier CUDA 12.x corre con un driver 525 o más nuevo, y uno con CUDA 13.x, con un 580 o más (en Linux, en x86). Las imágenes de NGC, el catálogo de NVIDIA, traen además un paquete que, en GPUs de centro de datos como la T4, les permite correr con algunos drivers más viejos.

Si el driver no alcanza, el programa falla al arrancar con mensajes como «The NVIDIA driver on your system is too old». Una trampa clásica: la cabecera de `nvidia-smi` dice «CUDA Version: 12.2», y eso **no** es el CUDA de tu imagen. Es el CUDA más nuevo que soporta el driver de la máquina: dentro de un contenedor con CUDA 12.6 puedes ver «12.2» sin que haya contradicción. El de tu imagen se mira con `torch.version.cuda` o en las notas de la imagen.

Resuélvelo con lápiz antes de abrir la solución:

:::ejercicios
? [medio] Un nodo tiene el driver 535, que soporta hasta CUDA 12.2. (a) ¿Corre una imagen con PyTorch hecho para CUDA 12.6? (b) ¿Y una con PyTorch de PyPI (el sitio de donde se bajan los paquetes de Python) para CUDA 13.0? (c) Dentro del contenedor de (a), ¿qué dice nvidia-smi en «CUDA Version»?
- (a) **Sí**, con límites: cualquier CUDA 12.x corre con un driver 525 o más nuevo. Lo que necesite funciones de un driver más nuevo falla con un error claro.
- (b) **No**: CUDA 13.x pide un driver 580 o más nuevo, y esos paquetes de PyPI no traen el paquete de compatibilidad de las imágenes de NGC. Falla con «driver too old».
- (c) **12.2**: el CUDA más nuevo que soporta el driver de la máquina, no el de la imagen.
:::

### La arquitectura de la GPU: sm_75, sm_89

Cada generación de GPUs entiende sus propias instrucciones, y NVIDIA le pone un número, la *compute capability*: 7.5 para la T4 (se escribe sm_75), 8.0 para la A100, 8.6 para la A10G, 8.9 para la L4 y 9.0 para la H100. Es la misma idea que la arquitectura de una CPU, x86-64 o arm64: lo que se compila para una no corre en otra. Los kernels se compilan para una o varias de esas arquitecturas. Si tu programa no trae kernels para la tuya, falla con «no kernel image is available for execution on the device».

TensorRT es más estricto: el engine eligió sus kernels cronometrándolos en **esa** GPU y quedó guardado en el formato de **esa** versión de TensorRT. El engine de C01, construido para la T4 con TensorRT 10.3, no carga en una L4. Por eso la Ronda (M15) pide construir de antemano un engine por cada tipo de GPU que podrías usar si te mudas de región (otro grupo de centros de datos de la nube, en otra parte del mundo), y por eso cambiar de GPU o de versión del contenedor de NVIDIA obliga a reconstruirlo.

### Fallar temprano

Lo peor no es el error: es que no haya error. Si un pod arranca sin GPU asignada y el código usa la GPU solo cuando la encuentra, PyTorch corre el modelo en la CPU, decenas de veces más lento, y nadie se entera hasta que el p99 explota. La regla de la Ronda (M05): pide siempre la GPU, verifica al arrancar que la ves (`torch.cuda.is_available()`) y termina el proceso si falta.

## Errores comunes {Common mistakes}

### 1. Contar un vCPU como un núcleo completo

Una c6i.xlarge de «4 vCPU» tiene 2 núcleos físicos. Si mides tu servicio en una laptop de 10 núcleos y después rentas 10 vCPU «porque es lo mismo», te quedan 5 núcleos: la mitad de lo que mediste. Si comparas los vCPU de una máquina de Intel con los de una Graviton, comparas medios núcleos con núcleos enteros.

**Cómo evitarlo:** mide en el tipo de máquina de producción y dimensiona en vCPU de esa máquina: vCPU = fotos por segundo × ms de CPU por foto ÷ 1,000.

### 2. Olvidar a la CPU que alimenta a la GPU

Decodificar y preparar las fotos en la máquina de la GPU «porque ahí ya hay CPU». Una g4dn.xlarge trae 4 vCPU; una T4 a su máximo pediría ≈ 7 solo para preparar fotos. La GPU se queda esperando y parece lenta.

**Cómo evitarlo:** haz la cuenta de la CPU aparte, como C01: el preproceso en su propio tier de CPU barata, y a la GPU, tensores listos.

### 3. Medir la GPU con el reloj de la CPU

`t0 = time.time(); y = modelo(x); print(time.time() - t0)` mide cuánto tardó la CPU en **dejar** los kernels en la fila, no cuánto tardó la GPU en correrlos. Salen tiempos de fantasía.

**Cómo evitarlo:** antes de parar el reloj, espera a la GPU con `torch.cuda.synchronize()`, o pide el resultado con `.cpu()`. Mide muchas veces y tira las primeras: las primeras llamadas preparan cosas que después ya están listas.

### 4. Escalar por la utilización de GPU

«nvidia-smi marca 100 %: hay que agregar otra GPU», o «marca 40 %: sobra». La utilización mide tiempo con algún kernel corriendo, no capacidad usada, y se congela en 100 % justo cuando más importa.

**Cómo evitarlo:** escala por la cola (tiempo en cola o requests en espera por réplica) y compara el throughput contra el máximo medido. La utilización, para un dashboard.

### 5. Buscar el driver en tu imagen

Instalar el driver de NVIDIA dentro de la imagen, o creer que el «CUDA Version» de nvidia-smi es el de tu imagen.

**Cómo evitarlo:** el driver es de la máquina; el CUDA, de la imagen. La regla: el driver tiene que ser al menos el que pide tu CUDA. Pruébalo arrancando la imagen en un nodo real.

### 6. Llevar un engine a otra GPU

Construir el engine de TensorRT en una laptop o en una L4 y servirlo en la T4, o al revés. No carga, o carga mal.

**Cómo evitarlo:** construye el engine en el mismo tipo de GPU y con la misma versión de TensorRT que producción, guarda junto a él para qué GPU y qué versión es, y ten uno listo por cada tipo de GPU que puedas llegar a usar.

## En la vida real {In real life} [extra]

### C01: dos T4 al 5 %, y la CPU que las alimenta

C01 tiene dos T4 en dos [[zona-disponibilidad|zonas]] distintas (centros de datos separados de la nube), para seguir respondiendo si se cae una. Cada una aguanta ≈ 1,200 fotos por segundo; en promedio, a cada una le llegan 58. La decisión la tomó la disponibilidad, no el cálculo, y la Ronda lo dice claro: en promedio pagas dos GPUs al ≈ 5 % de su capacidad, ≈ US$768 al mes.

Todo lo de esta lección aparece en el camino de cada foto. La CPU de los pods del gateway, en máquinas c6i, gasta ≈ 6 ms por foto en decodificar y preparar: ≈ 3 vCPU en el pico de diseño. El tensor de 602 KB cruza la red (2 a 4 ms) y PCIe (≈ 38 µs). Triton junta las fotos que llegan en 2 ms, hasta 32, y corre el engine de TensorRT en FP16 en los tensor cores, con dos instancias del modelo (dos copias cargadas en la misma T4) para que una copie datos mientras la otra calcula.

La Ronda deja anotadas dos mejoras que salen de esta lección:

- **Mandar la entrada en uint8** y normalizar dentro del modelo: 4 veces menos bytes por la red. A su máximo, una T4 pediría 1,200 × 602 KB ≈ 5.8 Gb/s de tensores en float32, más que los ≈ 5 Gb/s que sostiene la red de su g4dn.xlarge: la red la limitaría antes que la GPU.
- **Medir la ResNet-50 en INT8 en CPU**, en una c7i con AMX:

:::cuenta ¿CPU en INT8 o dos T4?
La meta de la medición // sin perder más de 0.5 puntos en el golden set | supuesto de la Ronda | ≈ 15 ms de un vCPU por imagen
vCPU ocupados en el pico de diseño | 500 × 15 ms | 7.5
A provisionar en el pico // C01 agrega pods antes de que la CPU pase del 60 % | 7.5 ÷ 0.6 | ≈ 13 vCPU
A provisionar en promedio // 116 fotos por segundo | 116 × 15 ms ÷ 0.6 | ≈ 3 vCPU
Al mes, con 4 a 8 vCPU facturados en promedio // la estimación de la Ronda, con lo que no baja de noche (pods mínimos, máquinas enteras); a ≈ US$0.0446 por vCPU-hora, el de una c7i | (4 a 8) × 0.0446 × 730 | ≈ US$130 a 260
Las dos T4 | 2 × 0.526 × 730 | ≈ US$768
= Si la medición da lo que la Ronda espera, la CPU sale de 3 a 6 veces más barata y elimina un tier entero, el de las GPUs. Si da 30 o 50 ms por imagen, hacen falta de 2 a 3 veces más vCPU y el ahorro se achica. Por eso se mide antes de decidir.
:::

### C10: un LLM partido en dos H100

C10 sirve un modelo de 70,600 millones de parámetros en FP8: ≈ 70.6 GB, que en una H100 de 80 GB casi no dejan lugar para el [[kv-cache|KV cache]]. Cada réplica (una copia completa del servicio) lo parte entre 2 H100 con *tensor parallelism*: cada capa se divide en dos mitades, cada GPU calcula la suya y, dos veces por capa, las dos juntan sus resultados (un *all-reduce*). Con 80 capas, son 160 intercambios por token.

:::cuenta Lo que se pasan las dos H100 en un paso de decode (una estimación)
Datos por intercambio, por conversación // el vector del token en esa capa: 8,192 números en BF16 | 8,192 × 2 B | ≈ 16 KB
Por token // 2 intercambios × 80 capas | 160 × 16 KB | ≈ 2.6 MB
Por paso, con 40 conversaciones | 40 × 2.6 MB | ≈ 105 MB
Por NVLink // 450 GB/s en un sentido | 105 MB ÷ 450 GB/s | ≈ 0.23 ms
Por PCIe Gen5 // ≈ 64 GB/s en un sentido | 105 MB ÷ 64 GB/s | ≈ 1.6 ms
= Contra un paso de ≈ 15 ms, NVLink agrega ≈ 1.5 % y PCIe, ≈ 11 %. Entre dos máquinas, por la red, sería más lento y con 160 esperas por token: por eso C10 nunca reparte una réplica entre nodos.
:::

Las 8 H100 de una p5.48xlarge, unidas por NVSwitch, dan 4 réplicas por máquina, y cualquier par de GPUs sirve para una réplica. El [[decode]] es memory-bound, así que lo que más pesa en cada paso es la HBM: cada H100 lee su mitad de los pesos, 35.3 GB, a 3,350 GB/s, como calculaste en la lección de FLOPs.

### C02: el video se decodifica en la GPU

En C02, cada centro de distribución tiene una caja con una L4 para 40 cámaras, cada una a 5 fotogramas por segundo: 200 por sitio. En la CPU, decodificar tanto video y copiar cada fotograma sería el cuello de botella; la L4 lo hace en circuitos dedicados, los NVDEC: trae 4, que juntos dan un techo teórico de ≈ 3,600 fotogramas 1080p (de 1920 × 1080 pixeles) por segundo, según la Ronda. Ahí, la «CPU que alimenta a la GPU» de C01 se vuelve un circuito dentro de la propia GPU. Y como la caja vive en un cuarto del sitio, la Ronda advierte que, si no tiene clima, la GPU baja su reloj en verano: el throttling de la sección de utilización.

### C14: cuando la CPU gana

El pronóstico de demanda de C14 no usa una red sino árboles de decisión, y se entrena en CPU: ≈ 490 millones de filas en una máquina de 96 vCPU, unas 2 a 3 horas cada domingo. Los árboles son puras decisiones («¿es fin de semana?») y casi nada de multiplicación de matrices: el terreno de los núcleos listos, no de los carriles.

### Fuera de ML: contraseñas y GPUs

Muchos sitios guardan de cada contraseña solo su *hash*: una huella de tamaño fijo que sale de una cuenta fácil de hacer y casi imposible de revertir. Quien roba esos hashes prueba contraseñas candidatas, una tras otra: la misma cuenta repetida sobre datos distintos, justo lo que una GPU hace bien. La Ronda (M15) dice que una RTX 4090, una tarjeta de videojuegos, calcula del orden de 2 × 10¹⁰ hashes SHA-256 por segundo. Por eso los sitios serios no guardan las contraseñas con un hash rápido, sino con funciones hechas a propósito para ser lentas, como bcrypt, o lentas y hambrientas de memoria, como Argon2: le quitan a la GPU la ventaja de sus miles de hilos.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de vCPU y de utilización se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Una c6i.2xlarge tiene 8 vCPU de un Xeon con hyperthreading. ¿Cuántos núcleos físicos son? Si tu servicio gasta 6 ms de CPU por foto, ¿cuántas fotos por segundo aguanta, como máximo? ¿Y si no quieres pasar del 60 %?
- Núcleos: 8 vCPU ÷ 2 hilos por núcleo = **4 núcleos físicos**.
- Máximo: 8 vCPU × 1,000 ms ÷ 6 ms ≈ **1,333 fotos por segundo**, con la CPU al 100 %.
- Al 60 %: 0.6 × 1,333 = **800 fotos por segundo**.
? [facil] Un registro AVX2 mide 256 bits. ¿Cuántos números FP32 caben? ¿Cuántos INT8? Si un núcleo tiene dos unidades FMA de 256 bits y corre a 3 GHz, ¿cuál es su pico en FP32?
- FP32: 256 ÷ 32 = **8**. INT8: 256 ÷ 8 = **32**.
- Por ciclo: 2 unidades × 8 carriles × 2 FLOPs = 32 FLOPs.
- Pico: 32 × 3 × 10⁹ = **96 GFLOPS**, la mitad que con AVX-512.
? [facil] ¿Cuánto tarda el tensor de Ana (602,112 bytes en float32) en cruzar PCIe Gen4 x16, a ≈ 31.5 GB/s en un sentido? ¿Y en uint8?
- float32: 602,112 ÷ (31.5 × 10⁹) ≈ **19 µs**, la mitad que en la T4.
- uint8: 150,528 ÷ (31.5 × 10⁹) ≈ **4.8 µs**.
- Nada, contra los 2 a 4 ms de la red: mandar uint8 ahorra en la red, no en PCIe.
? [facil] Una L4 tiene 58 SMs con 128 carriles FP32 cada uno. ¿Cuántos «CUDA cores» anuncia? Para sumar dos vectores de un millón de números, con un hilo por número, ¿cuántos warps hacen falta?
- CUDA cores: 58 × 128 = **7,424**.
- Warps: 1,000,000 ÷ 32 = **31,250**. No caben vivos a la vez: con hasta 1,536 hilos por SM, la L4 tiene 58 × 48 = 2,784 warps a la vez, y los demás esperan su tanda.
? [medio] El ancho de banda de una memoria es cables × velocidad de cada cable ÷ 8. La A10G usa GDDR6 con 384 cables a 12.5 Gb/s. La A100 de 40 GB usa 5 pilas de HBM2, de 1,024 cables cada una, a ≈ 2.43 Gb/s. Calcula los dos anchos de banda y di cuál daría más tokens por segundo con Llama 3 8B en BF16 (≈ 16.06 GB).
- A10G: 384 × 12.5 ÷ 8 = **600 GB/s**.
- A100: 5 × 1,024 × 2.43 ÷ 8 ≈ **1,555 GB/s**.
- Techo del decode: A10G, 600 ÷ 16.06 ≈ **37 tokens por segundo**; A100, 1,555 ÷ 16.06 ≈ **97**. Gana la A100 por tener más cables, aunque cada uno va 5 veces más lento.
? [medio] Una versión sin fusionar de un modelo lanza 174 kernels por batch, y la CPU tarda 5 µs en lanzar cada uno. Con batch 1, cada kernel tarda ≈ 3 µs en la GPU. (a) ¿Cuánto tarda el batch, como mínimo? (b) ¿Qué parte del tiempo trabaja la GPU? (c) Con batch 32, cada kernel tarda ≈ 60 µs: ¿quién espera ahora?
- (a) La CPU va más lento que la GPU, así que manda el lanzamiento: 174 × 5 µs, más los 3 µs del último kernel: **≈ 873 µs**.
- (b) La GPU trabaja 174 × 3 = 522 µs de ≈ 873: **≈ 60 %**. nvidia-smi marcaría ese 60 % con la GPU esperando a la CPU.
- (c) Ahora espera la CPU, que va adelante: la GPU no para. Son ≈ 174 × 60 µs ≈ **10.4 ms** por 32 fotos, ≈ 0.33 ms por foto, y el costo de lanzar quedó escondido.
? [medio] Con el modelo de la calculadora de utilización (cada batch tarda 2.2 ms fijos más 0.77 ms por foto), a una T4 le llegan 175 fotos por segundo, su parte de la hora pico. ¿Qué marca nvidia-smi con batches de 1? ¿Y con batches de 2? ¿Cuál es su carga contra el máximo con batches de 32?
- Batch 1: 175 batches de 2.97 ms = 520 ms por segundo: nvidia-smi **≈ 52 %**.
- Batch 2: 87.5 batches de 2.2 + 1.54 = 3.74 ms = 327 ms por segundo: **≈ 33 %**.
- Máximo con batches de 32: 32 ÷ 26.84 ms ≈ 1,192 fotos por segundo. Carga: 175 ÷ 1,192 ≈ **15 %** en los dos casos. El mismo tráfico marca 52 % o 33 % según el batching.
? [reto] Se cae una de las dos T4 de C01 en el pico de diseño, y a la que queda le llegan 500 fotos por segundo. Con el mismo modelo (2.2 ms fijos más 0.77 ms por foto): (a) ¿aguanta con batches de 1? (b) ¿Con qué batch promedio deja de crecer la cola? (c) ¿Qué marca nvidia-smi con batches de 2 y con batches de 4?
- (a) Con batches de 1 aguanta 1,000 ÷ 2.97 ≈ 337 fotos por segundo: **no**. Faltan ≈ 163 por segundo, la cola crece sin fin y nvidia-smi marca **100 %**, igual que con cualquier exceso.
- (b) Con batches de b aguanta 1,000 × b ÷ (2.2 + 0.77 b). Para que llegue a 500: 1,000 b ≥ 500 × (2.2 + 0.77 b), es decir, b × (1,000 − 385) ≥ 1,100, y b ≥ 1.79. Con **batches de 2** ya aguanta: 2,000 ÷ 3.74 ≈ 535 fotos por segundo.
- (c) Batches de 2: 250 batches × 3.74 ms = 935 ms por segundo, **≈ 94 %**. Batches de 4, lo que el dynamic batching junta cuando hay cola: 125 × 5.28 ms = 660 ms, **≈ 66 %**.
- Con cola, el dynamic batching sube el batch solo y la GPU rinde más. nvidia-smi no ve ese margen; la cola, sí.
? [reto] Un equipo quiere servir un detector de 20 GFLOPs por imagen a 300 imágenes por segundo, y duda entre CPU en FP32 y una T4. (a) ¿Cuántos TFLOPS pide? (b) ¿Cuántos núcleos con AVX-512 (192 GFLOPS de pico) necesitaría, si lograra el 50 % de ese pico? ¿Cuántos vCPU de una máquina de Intel son? (c) Si la T4 logra el 15 % de sus 65 TFLOPS, ¿cuántas imágenes por segundo daría? (d) ¿Qué más tienes que revisar antes de decidir?
- (a) 300 × 20 × 10⁹ = **6 TFLOPS**.
- (b) Cada núcleo daría 0.5 × 192 = 96 GFLOPS: 6 × 10¹² ÷ (96 × 10⁹) ≈ **63 núcleos**, ≈ **125 vCPU** con hyperthreading. Varias máquinas grandes solo para el modelo.
- (c) 0.15 × 65 = 9.75 TFLOPS, y 9.75 × 10¹² ÷ (20 × 10⁹) ≈ **490 imágenes por segundo**: una T4 alcanza, con margen.
- (d) La CPU que prepara las imágenes, aparte; la red, si el tensor es grande; que el modelo use formatos de los tensor cores; que quepa en 16 GB con su batch; la disponibilidad (una sola GPU no sobrevive a una falla); y una prueba de carga, porque el 15 % es un supuesto.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M04 · Hardware para inferencia** compara CPU, GPU y aceleradores (AVX-512 y AMX contra carriles y tensor cores), dibuja el nodo de inferencia con su CPU, PCIe, VRAM y SMs, y pone lado a lado la T4, la L4, la A10G, la A100 y la H100.
- **M06 · Orquestación y escalado** pide GPUs enteras en Kubernetes con el device plugin y explica por qué escalar Triton por CPU o por utilización no sirve.
- **M07 · Servidores de modelos** parte de la GPU al ≈ 5 %, los hilos cuyos kernels van a la misma fila y el engine atado a sm_75.
- **M08 · Optimización de modelos** fusiona kernels con TensorRT, usa CUDA graphs y mide la inferencia en CPU con VNNI y AMX, contando cada vCPU como medio núcleo.
- También: **M05** (el driver en la máquina, el CUDA en la imagen), **M12** (las métricas de DCGM) y **M14** con **C10** (NVLink).

**En el Dojo:** la estación 7, «Empaquetado (Docker)», ya abierta, la toca de lado: en C01, Triton carga el engine en la GPU antes de estar listo. Cuando abra la 5, «Export, engine y paridad», ahí vas a construir el engine para la T4, y en la 9, «Kubernetes», a poner a Triton en nodos con GPU.

**En Sensei:** sigue «El sistema operativo: Linux, archivos y permisos», con el kernel de Linux, donde vive el driver, y los cgroups que limitan la CPU de un pod. Después, «Hacer varias cosas a la vez» explica cuándo varios hilos de Python llenan una CPU, y «Máquinas, GPUs y cómo se cobran» les pone precio.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
nucleo vcpu simd sm warp tensor-core cuda kernel-gpu hbm pcie nvlink driver utilizacion-gpu
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué es un vCPU en una máquina de Intel en AWS, y cuántos núcleos físicos tiene una g4dn.xlarge?
Un hilo de hardware: medio núcleo físico. La g4dn.xlarge tiene 4 vCPU, 2 núcleos. En las Graviton, un vCPU es un núcleo completo.
? ¿Qué hace SIMD, y cuántos números FP32 procesa una instrucción AVX-512?
La misma operación sobre todos los números de un registro ancho, en una instrucción. En 512 bits: 16 FP32, 32 FP16 o 64 INT8.
? ¿Qué es un warp, y por qué una GPU mantiene miles de hilos vivos?
32 hilos que ejecutan la misma instrucción a la vez. Con miles de hilos listos, cuando un warp espera un dato de la VRAM, otro trabaja en el siguiente ciclo: así se esconde la espera.
? ¿De dónde sale que la T4 haga 8 veces más en FP16 que en FP32?
De los tensor cores: en cada ciclo, un SM hace 512 MACs en FP16 con sus 8 tensor cores, y solo 64 en FP32 con sus carriles.
? ¿Cuánto tarda el tensor de Ana en cruzar PCIe en la T4, y por qué no importa?
≈ 38 µs (602 KB a ≈ 16 GB/s), contra 2 a 4 ms de red y ≈ 3 de cálculo: ≈ 1 %.
? ¿Qué mide la utilización de nvidia-smi, y qué es el «5 %» de las T4 de C01?
La parte del tiempo con al menos un kernel corriendo, no cuánto del chip trabaja. El ≈ 5 % de C01 es la carga, 58 fotos por segundo contra ≈ 1,200; nvidia-smi marcaría ≈ 17 %.
? ¿Por qué el engine de TensorRT de C01 no carga en una L4?
Porque TensorRT lo construyó a la medida de la T4 (su arquitectura, sm_75) y de una versión de TensorRT. La L4 es otra arquitectura (sm_89): hace falta otro engine.
:::
