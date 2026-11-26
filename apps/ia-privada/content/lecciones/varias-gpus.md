---
titulo: Varias GPUs: tensor y pipeline parallel
en: Multiple GPUs: tensor and pipeline parallel
subtitulo: Las cuatro formas de usar varias GPUs para servir un LLM (réplicas, tensor parallel, pipeline parallel y expert parallel), qué se pasan las GPUs en cada una y cuánto tarda, y cómo se decide entre ellas cuando el enlace entre tarjetas es PCIe y no NVLink.
pregunta: El despacho tiene 3 L40S. ¿Pone una copia del modelo en cada una o reparte un solo modelo entre las tres? ¿Y si mañana quiere Llama 3.3 70B, que no cabe en una sola?
sensei: cpu-gpu, flops, llms, percentiles, unidades
---

:::idea
Hay dos maneras de usar varias GPUs. Si el modelo **cabe** en una, se pone una copia completa en cada GPU y un balanceador reparte las preguntas: las GPUs no se hablan y la capacidad crece en línea recta. Si **no cabe**, o si una sola pregunta tiene que ir más rápido, el modelo se parte: por matrices (*tensor parallel*), por capas (*pipeline parallel*) o por expertos (*expert parallel*). Partirlo obliga a las GPUs a pasarse resultados en cada token, y entonces el cable entre ellas, PCIe o NVLink, entra en la cuenta. La pregunta que decide no es «¿cuántas GPUs tengo?», sino «¿qué tiene que viajar entre ellas, cuántas veces por token y por qué cable?».
:::

## Por qué repartir un modelo entre GPUs {Why split a model across GPUs}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus expedientes con un LLM sin que un documento salga de su red. Lo usarían **200 abogados y asistentes**. Su modelo es **Qwen3 32B en [[cuantizacion|INT4 de AWQ]]**, con [[pesos]] de ≈ **19.32 GB**. Cada pregunta trae ≈ **6,000 tokens** de entrada y la respuesta ≈ 500, en un [[contexto]] de hasta **8,192**. Pide el primer token en **2 s o menos** (en el p95) y al menos **20 tokens por segundo** por persona. El cálculo de capacidad (la [herramienta de sizing](/herramientas/sizing/)) dio **3 NVIDIA L40S** de 48 GB. Todos los números del despacho son supuestos del ejemplo.

¿Se pone una copia del modelo en cada L40S, o se reparte un solo modelo entre las tres? ¿Y si mañana el despacho quiere Llama 3.3 70B, que no cabe en una sola tarjeta?

Antes de seguir, dos cosas que Sensei explica a fondo y aquí solo se recuerdan:

- Una GPU tiene su propia memoria, la [[vram|VRAM]], y la lee a un [[ancho-de-banda|ancho de banda]] (la L40S, a 864 GB/s). Se conecta con la CPU y con otras GPUs por **PCIe**, el bus de las ranuras de la tarjeta madre; algunas GPUs de NVIDIA tienen además **NVLink**, un cable directo entre GPUs, mucho más rápido. Lo ves en [CPU y GPU](https://sensei.trueml.app/cpu-gpu/).
- El [[decode|decode]], que escribe un token a la vez, está [[memory-bound|limitado por memoria]]: cada token lee todos los pesos. El [[prefill|prefill]], que lee la pregunta entera de golpe, está limitado por el cálculo. Lo ves en [Matrices y FLOPs](https://sensei.trueml.app/flops/).

### Tres razones para usar más de una GPU

1. **El modelo no cabe.** Llama 3.3 70B en INT4 pesa ≈ 39.77 GB. Una L40S tiene 48 GB; con el margen de 10 % le quedan 43.2 útiles, y 2 se van en el programa que sirve el modelo. Los pesos entran, pero sobran 1.43 GB: no alcanza ni para una conversación de 8,192 tokens (2.68 GB). No hay forma de servirlo en una sola.
2. **Se quiere atender a más gente.** Una L40S atiende bien a unas pocas conversaciones a la vez; el despacho tiene en promedio ≈ 5.6 en la hora pico. Hacen falta más GPUs para más conversaciones.
3. **Se quiere que cada pregunta vaya más rápido.** Una sola L40S tarda ≈ 2.2 s en el prefill de 6,000 tokens. Si dos GPUs se reparten ese trabajo, cada pregunta tardaría menos.

Cada razón pide una forma distinta de repartir. Al tema se le llama [[paralelismo]] (*parallelism*): varias GPUs trabajando a la vez para servir un modelo.

:::figura varias-gpus-cuatro-formas
Las cuatro formas con tres o cuatro GPUs. Réplicas: una copia entera del modelo en cada GPU, sin hablarse. Tensor parallel: cada capa partida a lo ancho, con dos sumas entre GPUs por capa. Pipeline parallel: las capas en fila, un tramo por GPU. Expert parallel: los expertos de un MoE repartidos.
:::

### Las cuatro formas, en una frase cada una

En documentación y foros se abrevian por sus siglas en inglés: DP, TP, PP y EP.

- **Réplicas, o data parallel.** Una [[copia-del-servidor|copia]] completa del modelo en cada GPU; un balanceador manda cada pregunta a una. Las GPUs no se hablan.
- **Tensor parallel.** Cada matriz de cada capa se parte entre las GPUs; cada una calcula su pedazo y, dos veces por capa, juntan sus resultados.
- **Pipeline parallel.** Las capas se reparten en tramos: la GPU 1 hace las primeras, le pasa el resultado a la 2, y así. Como una línea de ensamble.
- **Expert parallel.** Solo para modelos [[moe|MoE]]: cada GPU guarda una parte de los expertos, y cada token viaja a las GPUs de los expertos que le tocan.

Se combinan: un servidor puede tener réplicas, cada una partida en tensor parallel. Lo que cambia entre ellas es **qué viaja entre GPUs y cuántas veces**.

## Réplicas: una copia del modelo en cada GPU {Replicas: one copy of the model per GPU}

La forma más simple de usar varias GPUs es no partir nada. Cada GPU carga el modelo **entero**, con su propio [[kv-cache|KV cache]], y atiende sus propias conversaciones. Delante va un balanceador: un programa que recibe cada pregunta y la manda a una de las copias, por ejemplo a la menos ocupada. Cada copia es una [[replica|réplica]].

En el mundo del entrenamiento a esto se le llama [[data-parallel|data parallel]]: cada GPU tiene el modelo completo y procesa **datos distintos**. Los servidores de inferencia usan el mismo nombre: en vLLM el flag es `--data-parallel-size`, y su documentación lo describe así: los pesos se replican en instancias o GPUs separadas que procesan lotes independientes de peticiones.

Lo importante es lo que **no** pasa: una réplica no le manda nada a las otras. No hay cable que esperar, y la capacidad crece en línea recta.

:::formula Capacidad con réplicas
C_{total} = r × C_{1}
G = r × n
- r: el número de réplicas (copias completas del modelo)
- C_{1}: las conversaciones que una réplica atiende bien (con la velocidad que pides)
- C_{total}: las conversaciones que atienden todas juntas
- n: las GPUs de cada réplica (1 si el modelo cabe en una)
- G: las GPUs en total
:::

:::cuenta El despacho con tres réplicas
Conversaciones que caben por memoria en una L40S, al tope // pesos 19.32 GB; KV de 8,192 tokens a 256 KiB por token = 2.147 GB; útiles 0.9 × 48 − 2 de programa = 41.2 GB | ⌊(41.2 − 19.32) ÷ 2.147⌋ | 10
Por memoria, las tres, \(C_{total}\) // \(r\) = 3 réplicas | 3 × 10 | 30
Atendidas a ≥ 20 tokens/s con los prefills, \(C_{1}\) // el resultado de la herramienta de sizing | | 2 por L40S
Atendidas bien, las tres // \(r\) = 3 | 3 × 2 | 6, arriba del promedio de 5.6
GPUs, \(G\) // \(n\) = 1: Qwen3 32B AWQ cabe en una | 3 × 1 | 3
= Tres réplicas cubren el promedio de la hora pico. Las 8 conversaciones de diseño a 20 tokens/s pedirían 4 (8 ÷ 2), como dice el sizing.
:::

El 10 es el máximo bruto por memoria; la ficha del despacho diseña con 8 por L40S, con un colchón. Lo que manda es el 2: la memoria dice cuántas caben y el cálculo dice cuántas se atienden bien (la lección «[De requisitos a hardware](/requisitos-hardware/)» arma ese método completo).

### Lo que dan las réplicas, además de capacidad

- **Fallas independientes.** Si una L40S se muere, las otras dos siguen atendiendo. Es la [[redundancia|redundancia]] gratis: el despacho pierde un tercio de la capacidad, no el servicio.
- **Nada que afinar entre GPUs.** Sin comunicación, no importa cómo conecte la tarjeta madre las ranuras.
- **Se pueden arrancar de dos maneras**, con un flag de vLLM o con procesos separados (abajo, el detalle).

Y lo que cuestan:

- **Cada réplica tiene su propio KV cache, y su propio [[prefix-caching|prefix caching]].** Si la repregunta de una abogada cae en otra réplica, esa réplica no tiene calculados los 6,000 tokens de su primera pregunta y los vuelve a calcular. Por eso conviene que el balanceador mande toda una conversación a la misma réplica (afinidad).
- **Una réplica no hace más rápida una pregunta.** El prefill de 6,000 tokens sigue tardando ≈ 2.2 s en una L40S. Las réplicas atienden a **más** gente, no más **rápido**.
- **Cada réplica necesita que el modelo quepa en sus GPUs.** Con Llama 3.3 70B en una L40S, no.


:::profundo Dos maneras de arrancar las réplicas
Una forma es un solo proceso de vLLM con `--data-parallel-size 3`, que reparte internamente (y entonces `--max-num-seqs`, el tope de conversaciones, aplica a cada réplica). Otra son tres procesos `vllm serve` independientes, uno por GPU, detrás de un balanceador: la documentación de vLLM lo llama balanceo «externo» y dice que un modelo que no es MoE lo puede usar así, con instancias independientes. El balanceador puede ser nginx (un proxy web muy usado) o el gateway que se pone delante de los modelos (lo ve la lección «[Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/)»).
:::

## Tensor parallel: partir cada matriz {Tensor parallel: splitting each matrix}

Cuando el modelo no cabe en una GPU, hay que partirlo. La idea más poderosa, y la que usan todos los servidores de inferencia, es partir **cada capa** entre las GPUs: [[tensor-parallel|tensor parallel]] (paralelismo de tensores; un tensor es una tabla de números de varias dimensiones, como una matriz). La versión que se usa hoy salió de un paper de NVIDIA de 2019, **Megatron-LM** (Shoeybi y otros). Ojo con algo: Megatron-LM es un paper de **entrenamiento**, con sus cifras de entrenamiento; aquí se usa su forma de partir las matrices, que es la misma para servir. vLLM lo declara en su documentación: su implementación incluye el algoritmo de tensor parallel de Megatron-LM.

### Una capa del transformer, en dos piezas

Cada capa de un LLM hace dos cosas, una tras otra (lo ves en [Transformers y LLMs](https://sensei.trueml.app/llms/)):

1. **La atención**, donde cada token mira a los anteriores. Trabaja con varias **cabezas** (*heads*) a la vez, cada una con sus propias matrices. Qwen3 32B tiene 64 cabezas por capa.
2. **El MLP**, dos multiplicaciones de matrices con una función en medio. En Qwen3 32B, la primera lleva el vector del token de 5,120 números a 25,600 y la segunda lo regresa a 5,120. (En Qwen3 la «primera» son dos matrices gemelas, *gate* y *up*, que se parten igual: aquí cuentan como una.)

El vector de 5,120 números que entra y sale de cada capa se llama el *hidden state*, y su largo, \(h\) = 5,120, el *hidden size*. Es lo que viaja entre GPUs, así que vas a verlo mucho.

### El truco de Megatron: columnas, luego filas

Imagina el MLP con 2 GPUs. La primera matriz, \(A\), se parte **por columnas**: la GPU 0 se queda con la mitad izquierda y la GPU 1 con la derecha. Las dos reciben el mismo vector \(x\) del token, y cada una calcula **su mitad** del resultado: 12,800 números de los 25,600. La función de en medio (una no linealidad) se aplica número por número, así que cada GPU la aplica a su mitad sin preguntarle nada a la otra.

La segunda matriz, \(B\), se parte **por filas**: cada GPU multiplica su mitad del resultado intermedio por sus filas y obtiene un vector de 5,120 números que es solo **una parte** de la respuesta. La respuesta es la **suma** de los dos vectores.

:::figura varias-gpus-columnas-filas
El MLP de una capa repartido entre 2 GPUs. Las dos reciben el mismo vector. La primera matriz se parte por columnas, la segunda por filas. Cada GPU termina con un vector parcial del tamaño completo, y un all-reduce los suma para que las dos tengan el resultado.
:::

:::ejemplo Con números de juguete
Un token con \(x\) = (1, 2). La primera matriz tiene 4 columnas; la GPU 0 se queda con las columnas 1 y 2, la GPU 1 con la 3 y la 4. Supón que la GPU 0 obtiene (3, 1) y la GPU 1 obtiene (2, 4), y que la función de en medio las deja igual. La segunda matriz tiene 4 filas: la GPU 0 usa las filas 1 y 2 y obtiene el vector parcial (5, 7); la GPU 1 usa las filas 3 y 4 y obtiene (4, 2). La salida de la capa es la suma: (5 + 4, 7 + 2) = **(9, 9)**. Ninguna GPU la tiene hasta que se pasan sus parciales y suman.
:::

La atención se parte igual, pero por **cabezas**: cada GPU se queda con un grupo de cabezas completas (con 2 GPUs, 32 cabezas cada una) y calcula su atención sin hablar con nadie. Luego la matriz de salida de la atención se parte por filas, y otra vez cada GPU tiene un vector parcial que hay que sumar.

### La suma que todas necesitan: el all-reduce

Esa suma tiene nombre. Un [[all-reduce|all-reduce]] es una operación donde cada GPU pone un vector, se suman todos número por número, y **todas** las GPUs se quedan con el resultado. Es una [[colectiva|operación colectiva]]: participan todas las GPUs del grupo a la vez, y ninguna sigue hasta que la operación termina.

Con el truco de Megatron, cada capa necesita exactamente **dos** all-reduce para servir un token: uno después de la atención y otro después del MLP. El paper lo cuenta como dos en la pasada hacia adelante y dos en la de regreso; la de regreso solo existe al entrenar. Qwen3 32B tiene 64 capas, así que cada token del despacho, con tensor parallel, hace **128 all-reduce**. (En vLLM hay dos juntas más, fuera de las capas: una al leer la tabla de tokens y otra al juntar la salida. Las cuentas las dejan fuera: son 2 contra 128.)

:::analogia El equipo que llena una tabla gigante
Imagina que dos contadores tienen que llenar una tabla de 25,600 columnas. Se reparten las columnas: cada uno llena la mitad, sin hablar, a la mitad del tiempo. Al final, el jefe necesita el total de cada renglón, y eso solo sale sumando lo de los dos. Tienen que juntarse, pasarse sus subtotales y sumar: esa junta es el all-reduce.

Dónde se rompe: los contadores se juntan una vez al final. Las GPUs se juntan **dos veces por capa, por cada token**: 128 juntas por token en el despacho, miles por segundo. Por eso la velocidad del pasillo entre las dos oficinas, el cable, importa muchísimo más que en la oficina.
:::

:::diagrama varias-gpus-token-tp
Toca cada caja para ver qué hace. Sigue «Un token por dos L40S» para ver dónde se detienen las dos GPUs a esperarse.
:::

## El all-reduce en anillo y lo que cuesta {The ring all-reduce and what it costs}

¿Cómo se suman vectores que están en GPUs distintas? La forma ingenua es que todas le manden su vector a una, esa sume y le mande el resultado a todas. Con \(n\) GPUs, esa una recibe \(n − 1\) vectores y manda \(n − 1\): se vuelve un embudo.

La forma que se usa es el [[all-reduce-en-anillo|all-reduce en anillo]] (*ring all-reduce*). Las GPUs se acomodan en un círculo, cada una habla solo con la de al lado, y el vector de cada una se parte en \(n\) trozos. Tiene dos fases:

:::pasos
1. Reducir y repartir (reduce-scatter)
Durante \(n − 1\) pasos, cada GPU le pasa un trozo a la de al lado, que lo suma con su propio trozo y lo sigue pasando. Al final, cada GPU tiene **un** trozo con la suma completa de todas.
2. Juntar (all-gather)
Durante otros \(n − 1\) pasos, cada GPU pasa su trozo ya sumado a la de al lado, que lo copia y lo sigue pasando. Al final, todas tienen todos los trozos sumados.
:::

En cada paso, todas mandan y reciben a la vez: nadie es embudo. Cada GPU manda \(2(n − 1)\) trozos de tamaño \(N ÷ n\): en total, \(2(n − 1)/n\) veces su vector. La documentación de rendimiento de NVIDIA para sus pruebas de comunicación (*nccl-tests*) da ese mismo factor para el all-reduce: cada elemento necesita \(2(n − 1)\) transferencias, y eso vale para cualquier algoritmo hecho de envíos de una GPU a otra, no solo para el anillo.

Quien hace todo esto en las GPUs de NVIDIA es [[nccl|NCCL]] (se pronuncia «nickel»), la biblioteca de comunicación entre GPUs de NVIDIA. Su documentación (versión 2.32.3, consultada el 2026-11-26) dice que conoce la **topología**, es decir, cómo están conectadas las GPUs, y que funciona por PCIe, por NVLink, por InfiniBand (una red rápida para unir servidores) y por la red normal. vLLM y SGLang la usan por dentro. NCCL no siempre usa el anillo: desde 2019 (versión 2.4) tiene también algoritmos en forma de árbol, que según NVIDIA tardan menos en operaciones chicas y medianas, y por omisión elige el algoritmo solo, según la topología. Por eso la fórmula del anillo es un **modelo** del costo, no el algoritmo exacto en todos los tamaños.

### La misma cuenta, en Python

Este programa simula el anillo con 4 GPUs. Cada una tiene un vector de 4 números; al final todas deben tener la suma, y el programa cuenta cuántos trozos mandó cada una.

```python
n = 4                                   # GPUs en el anillo
datos = [[10 * g + t for t in range(n)] for g in range(n)]   # cada GPU: su vector, partido en n trozos
mandados = [0] * n                      # cuántos trozos manda cada GPU

for paso in range(n - 1):               # fase 1, reduce-scatter: sumar al pasar
    envios = [(g, (g - paso) % n, datos[g][(g - paso) % n]) for g in range(n)]
    for g, t, valor in envios:
        datos[(g + 1) % n][t] += valor  # la GPU de al lado suma lo que recibe
        mandados[g] += 1
for paso in range(n - 1):               # fase 2, all-gather: copiar las sumas ya hechas
    envios = [(g, (g + 1 - paso) % n, datos[g][(g + 1 - paso) % n]) for g in range(n)]
    for g, t, valor in envios:
        datos[(g + 1) % n][t] = valor
        mandados[g] += 1

suma = [sum(10 * g + t for g in range(n)) for t in range(n)]
print("suma esperada:", suma)
for g in range(n):
    print(f"GPU {g}: {datos[g]}  mandó {mandados[g]} trozos de {n}")
print(f"cada GPU mandó {mandados[0] / n:.2f} veces su vector; 2(n-1)/n = {2 * (n - 1) / n:.2f}")
```

```salida
suma esperada: [60, 64, 68, 72]
GPU 0: [60, 64, 68, 72]  mandó 6 trozos de 4
GPU 1: [60, 64, 68, 72]  mandó 6 trozos de 4
GPU 2: [60, 64, 68, 72]  mandó 6 trozos de 4
GPU 3: [60, 64, 68, 72]  mandó 6 trozos de 4
cada GPU mandó 1.50 veces su vector; 2(n-1)/n = 1.50
```

Cambia `n` a 2: cada GPU manda su vector **una** vez (factor 1). Con 8 manda 1.75 veces. El factor nunca pasa de 2, por muchas GPUs que haya: esa es la gracia del anillo.

### Lo que tarda: ancho de banda y latencia

Un all-reduce tiene dos costos. Uno es mover los bytes, que depende del ancho de banda del cable. El otro es fijo: arrancar la operación, sincronizar a las GPUs, esperar a que llegue el primer byte. Ese costo fijo, la **latencia**, se paga aunque el mensaje sea diminuto.

:::formula Tiempo de un all-reduce (modelo del anillo)
t_{AR} = frac{2(n − 1)}{n} × frac{N}{B_{enl}} + α
- n: las GPUs que participan
- N: los bytes del vector que pone cada GPU
- B_{enl}: el ancho de banda del enlace entre GPUs, en bytes por segundo y **en una dirección**
- α: la latencia fija de un all-reduce, en segundos
- t_{AR}: lo que tarda un all-reduce
:::

:::ojo
NVIDIA publica los enlaces **sumando las dos direcciones**. La L40S: «PCIe Gen4 x16: 64 GB/s bidireccional», o sea ≈ 31.5 GB/s en cada dirección. La H100 SXM: NVLink de 900 GB/s, ≈ 450 en cada dirección. En la fórmula va la cifra **por dirección**: cada GPU manda y recibe a la vez, y cada sentido tiene su propio carril. Si mezclas una cifra bidireccional con una por dirección, el tiempo sale al doble o a la mitad.
:::

Para \(α\) **no hay una medición publicada** con L40S por PCIe que se pueda citar. En esta lección se usa **10 µs** como supuesto (y 30 µs como caso pesimista, cuando el camino entre las GPUs pasa por la CPU). La única forma honesta de saberlo es medirlo en tu servidor, y la sección «Los flags, lo que se ve al arrancar y cómo se mide» dice cómo.

## Cuántos bytes viajan por token {How many bytes travel per token}

Ya se puede contar. En el decode, cada all-reduce suma el *hidden state* de cada conversación del batch: \(h\) números en 16 bits (2 bytes cada uno). La cuantización de AWQ solo cambia cómo se guardan los pesos: lo que viaja entre GPUs, las activaciones, sigue en 16 bits.

:::formula La comunicación de tensor parallel en un paso de decode
N_{AR} = b × h × 2
t_{com} = 2 × L × t_{AR}(N_{AR})
- b: las conversaciones del batch en ese paso (un token cada una)
- h: el *hidden size* del modelo (5,120 en Qwen3 32B)
- 2: bytes por número en 16 bits
- N_{AR}: los bytes de cada all-reduce
- L: las capas del modelo (64 en Qwen3 32B); el 2 de \(2 × L\) son los dos all-reduce por capa
- t_{com}: el tiempo de comunicación del paso, sumando todos los all-reduce
:::

:::cuenta Un token de Qwen3 32B con tensor parallel en 2 L40S
Bytes de un all-reduce, \(N_{AR}\) // \(b\) = 1, \(h\) = 5,120 | 1 × 5,120 × 2 | 10,240 bytes = 10 KiB
All-reduce por token // \(L\) = 64 capas, 2 por capa | 2 × 64 | 128
Bytes por token // los 128 vectores juntos | 128 × 10,240 | 1,310,720 bytes = 1.25 MiB
Solo los bytes, por PCIe 4.0 // \(n\) = 2: factor 2(n − 1)/n = 1; \(B_{enl}\) = 31.5 GB/s | 1,310,720 ÷ 31.5 × 10⁹ | ≈ 41.6 µs
Solo la latencia // \(α\) = 10 µs, supuesto | 128 × 10 µs | 1.28 ms
Comunicación del token, \(t_{com}\) | 0.04 + 1.28 | ≈ 1.32 ms
Lectura de memoria de cada GPU // la mitad de los pesos y del KV: (19.32 + 1.64) ÷ 2 GB a 0.7 × 864 GB/s | 10.48 GB ÷ 604.8 GB/s | ≈ 17.3 ms
= La comunicación es ≈ 7 % del paso (≈ 18 % si \(α\) fuera 30 µs). Y casi toda es latencia: los bytes del token cruzan PCIe en 42 µs.
:::

Esa última línea contradice lo que casi todos adivinan: «PCIe es 14 veces más lenta que NVLink, así que tensor parallel por PCIe es 14 veces más lento». En el decode con pocas conversaciones, los bytes son poquísimos y lo que pesa son las **128 esperas** por token, que no dependen del ancho de banda: un cable más ancho no las quita (la cuenta usa la misma \(α\) para los dos cables, otro supuesto).

### Donde sí duele: el prefill

El prefill es otra historia. En el prefill de una pregunta del despacho entran **6,000 tokens a la vez**, así que cada all-reduce lleva 6,000 vectores, no uno.

:::formula Un prefill con tensor parallel
t_{pre} = frac{2 × P × T}{n × η_c × F} + 2 × L × t_{AR}(T × h × 2)
- P: los parámetros del modelo (32,762 millones en Qwen3 32B)
- T: los tokens de la pregunta (6,000 en el despacho)
- n: las GPUs que se reparten la capa
- η_c: la [[eficiencia|eficiencia]] del cálculo (0.5 en el despacho, supuesta)
- F: el [[pico-de-calculo|pico de cálculo]] de una GPU (362.05 TFLOPS densos en FP16 la L40S)
- t_{pre}: lo que tarda el prefill: el cálculo repartido entre \(n\), más la comunicación
:::

:::cuenta El prefill de una pregunta del despacho en 1 y en 2 L40S
Cálculo en una L40S // \(n\) = 1: 2 × 32.762 × 10⁹ × 6,000 FLOPs a 0.5 × 362.05 TFLOPS | 3.93 × 10¹⁴ ÷ 1.81 × 10¹⁴ | ≈ 2.17 s
Cálculo en dos // \(n\) = 2: cada una hace la mitad | 2.17 ÷ 2 | ≈ 1.09 s
Bytes de cada all-reduce // \(T\) = 6,000 tokens × 10,240 bytes | 6,000 × 10,240 | 61.4 MB
Bytes del prefill // 128 all-reduce | 128 × 61.4 MB | ≈ 7.86 GB
Comunicación por PCIe 4.0 // factor 1 con \(n\) = 2; 31.5 GB/s | 7.86 GB ÷ 31.5 GB/s | ≈ 0.25 s
Prefill con tensor parallel, \(t_{pre}\) | 1.09 + 0.25 | ≈ 1.34 s
= Con dos L40S en tensor parallel, el prefill de 6,000 tokens bajaría de ≈ 2.2 s a ≈ 1.3 s, dentro de los 2 s. Pero casi una quinta parte de ese 1.34 s, el cuarto de segundo de PCIe, es puro cable: por NVLink serían ≈ 0.02 s.
:::

Ese 1.34 s es **sin cola**: el tiempo de una pregunta sola, sin otras esperando. El objetivo del despacho es el p95 con la hora pico encima, y la cola suma (la lección «[De requisitos a hardware](/requisitos-hardware/)» hace esa cuenta). Pero la dirección es clara: tensor parallel es la única de las cuatro formas que hace más rápida **una** pregunta, porque reparte el cálculo de cada capa.

:::calculadora varias-gpus-comunicacion
Empieza con el despacho: Qwen3 32B en 2 L40S por PCIe 4.0. Sube el batch a 32 y mira cómo el ancho de banda empieza a notarse. Cambia el enlace a NVLink: el decode casi no cambia, el prefill sí. Sube \(α\) a 30 µs, el caso pesimista.
:::

## PCIe contra NVLink {PCIe versus NVLink} [extra]

Ahora se entiende por qué la gente pregunta tanto por NVLink. La tabla junta las cifras de NVIDIA (consultadas el 2026-11-26) y las de PCIe:

| Enlace | Lo que publica | Por dirección | Dónde está |
|---|---|---|---|
| PCIe 4.0 x16 | 64 GB/s bidireccional | ≈ 31.5 GB/s | L40S (sin NVLink) |
| PCIe 5.0 x16 | 128 GB/s bidireccional | ≈ 63 GB/s | RTX PRO 6000 (sin NVLink) |
| NVLink por puente | 600 GB/s | ≈ 300 GB/s | H100 NVL, unidas de dos en dos |
| NVLink 4 | 900 GB/s | ≈ 450 GB/s | H100 SXM, en servidores de 8 |

Entre PCIe 4.0 y NVLink 4 hay ≈ 14 veces: 450 ÷ 31.5 ≈ 14.3 por dirección, o 900 ÷ 64 ≈ 14.1 sumando las dos. La razón sale igual mientras no mezcles. La lista completa de GPUs, con su interconexión, está en el [catálogo](/herramientas/catalogo/).

### Lo que dicen las mediciones publicadas

Un hallazgo honesto: **no hay un benchmark publicado de L40S con tensor parallel por PCIe contra NVLink** que se pueda citar, porque la L40S no tiene NVLink. Lo más cercano:

- **NVIDIA, agosto de 2024.** Un blog con Llama 3.1 70B en H200 con tensor parallel de 2, con preguntas de 8,000 tokens y respuestas de 256. Compara NVSwitch (900 GB/s entre cualquier par) contra enlaces punto a punto de 128 GB/s. Con batch de 1, la ventaja de NVSwitch es **1.0×**: nada. Con batch de 32, **1.5×**. Dice que la sincronización de tensor parallel mueve hasta 20 GB por GPU en una consulta. Ojo: es NVLink contra NVLink con menos enlaces, no PCIe, y sus cifras son modeladas con mediciones internas.
- **Una prueba de un usuario en el foro oficial de vLLM, julio de 2026.** Dos L40S por PCIe 4.0, sin NVLink, un MoE de ≈ 35 mil millones de parámetros en 8 bits, preguntas cortas de 512 tokens y respuestas de 128. Tensor parallel de 2 atendió ≈ 1.3 veces más peticiones por segundo que pipeline parallel de 2 (0.95 contra 0.72) y escribió cada token en 82 ms contra 109; el usuario dice que dos réplicas también quedaron atrás, sin dar números. Es una sola corrida, sin la versión de vLLM y con entradas 12 veces más cortas que las del despacho: sirve como pista, no como regla.

La forma de la curva de NVIDIA coincide con la cuenta de la sección anterior: con batch chico el cable casi no importa; con batch grande y con prefills largos, sí.

### Lo que dice la documentación de vLLM

La documentación de vLLM (consultada el 2026-11-26) da una regla general: si el modelo cabe en una GPU, probablemente no hace falta repartir; si no cabe pero cabe en un servidor, tensor parallel con todas sus GPUs; si no cabe en un servidor, tensor parallel dentro de cada servidor y pipeline parallel entre servidores.

Y tiene una nota que nombra justo a la L40S. Está dentro del caso en que el número de GPUs no divide bien el modelo: ahí sugiere pipeline parallel, que admite repartos disparejos, y agrega que si las GPUs del servidor no tienen NVLink (pone de ejemplo la L40S), conviene pipeline parallel en vez de tensor parallel, «para más [[throughput-de-tokens|throughput]] (tokens por segundo en total) y menos sobrecarga de comunicación». Dos matices: la nota **no trae una medición**, y habla de throughput, no de lo que tarda una pregunta. Úsala como lo que es, una recomendación del equipo de vLLM, y no la estires a «tensor parallel por PCIe siempre pierde». La prueba del foro, con todas sus limitaciones, encontró lo contrario con dos L40S.

### La cuenta, para 1, 2 y 4 GPUs

```python
h, L, P = 5120, 64, 32.762e9        # Qwen3 32B: hidden, capas, parámetros (config.json)
W, K = 19.32e9, 1.64e9              # pesos en INT4 de AWQ; KV de una conversación a media respuesta
mem, calc = 0.7 * 864e9, 0.5 * 362.05e12   # L40S con las eficiencias del despacho
pcie = 31.5e9                       # PCIe 4.0 x16, bytes/s en UNA dirección
alfa = 10e-6                        # latencia fija de cada all-reduce: SUPUESTO, hay que medirla

def allreduce(N, n):                # anillo: 2(n-1)/n × N ÷ ancho de banda, más la latencia
    return 2 * (n - 1) / n * N / pcie + alfa

print(" n   b  memoria  comunic.  tok/s c/u | prefill 6,000: cálculo  comunic.")
for n in (1, 2, 4):
    for b in (1, 8):
        t_mem = (W + b * K) / n / mem
        t_com = 2 * L * allreduce(b * h * 2, n) if n > 1 else 0
        pre = 2 * P * 6000 / (n * calc)
        pre_com = 2 * L * allreduce(6000 * h * 2, n) if n > 1 else 0
        fila = f"{n:>2}{b:>4}{t_mem*1e3:>8.1f} ms{t_com*1e3:>7.2f} ms{1/(t_mem+t_com):>9.1f}  |"
        print(fila + (f"{pre:>14.2f} s{pre_com:>8.2f} s" if b == 1 else ""))
```

```salida
 n   b  memoria  comunic.  tok/s c/u | prefill 6,000: cálculo  comunic.
 1   1    34.7 ms   0.00 ms     28.9  |          2.17 s    0.00 s
 1   8    53.6 ms   0.00 ms     18.6  |
 2   1    17.3 ms   1.32 ms     53.6  |          1.09 s    0.25 s
 2   8    26.8 ms   1.61 ms     35.2  |
 4   1     8.7 ms   1.34 ms     99.9  |          0.54 s    0.38 s
 4   8    13.4 ms   1.78 ms     65.8  |
```

Lee dos cosas en la tabla. Primera: con 8 conversaciones, una L40S sola da 18.6 tokens por segundo a cada una, debajo de los 20 que pide el despacho; dos en tensor parallel dan 35.2. Repartir los pesos hace que cada GPU lea la mitad en cada paso. Segunda: de 2 a 4 GPUs, el cálculo del prefill se parte otra vez a la mitad (de 1.09 a 0.54 s), pero la comunicación **sube** (de 0.25 a 0.38 s), porque el factor del anillo pasa de 1 a 1.5. Cuantas más GPUs, más pesa el cable.

:::profundo Lo que esta cuenta no ve
La cuenta supone que la comunicación no se solapa con el cálculo (el peor caso) y que cada GPU sigue leyendo su memoria al 70 % aunque sus matrices sean la mitad de grandes; con matrices más chicas, la eficiencia suele bajar. Tampoco cuenta el tiempo de lanzar más *kernels* pequeños (cada kernel es una operación que la CPU le encarga a la GPU). Todo eso empuja en contra de tensor parallel. Lo que la cuenta sí da es la **forma**: en el decode manda la latencia, en el prefill y con batches grandes manda el ancho de banda. El número de verdad sale de medir.
:::

### El camino que sí recorren los bytes

Que dos GPUs estén en el mismo servidor no quiere decir que el camino entre ellas sea corto. El servidor que cotiza la lección «[Comprar hardware: de la workstation al rack](/comprar-hardware/)» tiene **2 CPUs**, y cada ranura PCIe cuelga de una de ellas. Dos GPUs del mismo CPU se hablan por PCIe pasando por ese CPU; dos de CPUs distintos tienen que cruzar además el enlace entre los dos procesadores.

NCCL distingue esos casos. Su variable `NCCL_P2P_LEVEL` fija hasta qué distancia usa la comunicación directa entre GPUs, con niveles que van de cerca a lejos: `PIX` (mismo switch PCIe; un switch es un chip que reparte un enlace PCIe entre varias ranuras), `PXB` (varios switches), `PHB` (pasa por el CPU) y `SYS` (cruza entre los dos CPUs). Para tensor parallel en un servidor así, conviene que el par de GPUs vaya en ranuras del **mismo** CPU (la doc de NCCL llama `PHB` a ese caso: mismo nodo NUMA, es decir, la misma CPU y su memoria). Cómo ver la topología de tu servidor está en la sección «Los flags, lo que se ve al arrancar y cómo se mide».

:::nota Un detalle de vLLM con PCIe
vLLM trae su propio all-reduce para mensajes chicos, más rápido que NCCL en ese caso. En su código (rama principal, 2026-11-26), lo **apaga** con más de 2 GPUs conectadas solo por PCIe, con el aviso de que no está soportado en más de dos GPUs solo-PCIe. Con 2 L40S puede usarlo; con 4, cae a NCCL. Es un detalle de implementación que puede cambiar entre versiones: compruébalo en la tuya.
:::

## Cuántas GPUs y cuánta memoria en cada una {How many GPUs, and how much memory on each}

### La regla de las cabezas

Tensor parallel reparte las cabezas de atención entre las GPUs, así que el número de GPUs tiene que **dividir** el número de cabezas. Qwen3 32B tiene 64 cabezas de consulta (*query*) por capa y 8 juegos de K y V compartidos ([[gqa|GQA]]); Llama 3.3 70B, también 64 y 8 (el de Qwen, de su `config.json`; el de Llama, de los parámetros que publica Meta en su repositorio `llama-models`, porque su `config.json` en Hugging Face pide aceptar la licencia).

- 64 se divide entre 1, 2, 4, 8, 16, 32 y 64. Esos son los tensor parallel posibles.
- **64 no se divide entre 3.** Con las 3 L40S del despacho, tensor parallel de 3 **no existe**.
- vLLM lo revisa al arrancar. En su código (2026-11-26) el error dice: `Total number of attention heads (64) must be divisible by tensor parallel size (3).` Es el error que reportan usuarios en sus foros con otros modelos (un Qwen 1.5 32B de 40 cabezas en 6 GPUs, por ejemplo).
- Los 8 juegos de K y V se reparten sin repetirse con 1, 2, 4 u 8 GPUs. Con 16, cada GPU necesitaría medio juego: vLLM entonces **replica** los juegos de K y V para que cada GPU tenga al menos uno, y el KV cache ocupa el doble de lo necesario.

:::profundo Las otras medidas también se dividen
Las 25,600 columnas del MLP de Qwen3 32B entre 2, 4 u 8 dan números enteros, y también sus grupos de AWQ de 128 (200 grupos: 100, 50 o 25 por GPU).
:::

### La memoria de cada GPU

Con tensor parallel, cada GPU guarda la parte que le toca de los pesos y del KV cache, más una parte que **no** se reparte: el programa, sus búferes y el margen.

:::formula Memoria por GPU con tensor parallel
M_{GPU} = frac{W}{n} + c × frac{K_{conv}}{n} + M_{prog}
c_{máx} = ⌊ frac{(1 − f) × V − W/n − M_{prog}}{K_{conv}/n} ⌋
- W: los pesos del modelo entero, en GB
- n: las GPUs de tensor parallel
- K_{conv}: el [[kv-cache|KV cache]] de una conversación al tope de contexto, en GB (de todo el modelo)
- c: las conversaciones a la vez
- M_{prog}: el programa y sus búferes, **en cada GPU** (2 GB en el despacho, supuesto; ojo: la herramienta de VRAM lo cuenta una sola vez para todas las GPUs, ver abajo)
- f: el margen que se deja libre (0.10)
- V: la VRAM de una GPU (48 GB la L40S)
- c_{máx}: las conversaciones que caben por memoria
:::

El reparto del KV cache por \(n\) funciona porque se reparten los juegos de K y V: con 2 GPUs, 4 juegos cada una. Si \(n\) pasa de 8, deja de repartirse (la réplica de arriba).

:::cuenta Llama 3.3 70B en INT4 de AWQ, en 1 y en 2 L40S
Pesos, \(W\) // la fórmula de la herramienta de VRAM con 4.156 bits por peso | | 39.77 GB
KV por token // 2 (K y V) × 80 capas × 8 juegos × 128 números × 2 bytes | 327,680 bytes | 320 KiB
KV de una conversación, \(K_{conv}\) // al tope de 8,192 tokens | 8,192 × 327,680 | 2.684 GB
Útil por GPU // \(f\) = 0.10, \(V\) = 48 | 0.9 × 48 | 43.2 GB
Una L40S: libre // \(n\) = 1, \(M_{prog}\) = 2 | 43.2 − 39.77 − 2 | 1.43 GB: no cabe ni una conversación
Dos L40S: pesos por GPU // \(n\) = 2 | 39.77 ÷ 2 | 19.88 GB
Dos L40S: libre por GPU | 43.2 − 19.88 − 2 | 21.32 GB
Dos L40S: KV por GPU de una conversación // 4 de los 8 juegos | 2.684 ÷ 2 | 1.342 GB
Dos L40S: conversaciones, \(c_{máx}\) | ⌊21.32 ÷ 1.342⌋ | 15
= Con tensor parallel de 2, Llama 3.3 70B cabe en dos L40S con 15 conversaciones de 8,192 tokens. En una sola, no.
:::

:::profundo Repartir también da memoria a un modelo que cabe
Qwen3 32B en una L40S deja 21.88 GB libres: 10 conversaciones al tope. En dos L40S con tensor parallel, cada GPU guarda 9.66 GB de pesos y le quedan 31.54 GB: **29** conversaciones en la copia. Dos réplicas separadas darían 20. Tensor parallel no duplica los pesos, así que deja más memoria para el KV cache.
:::

:::ojo
El \(M_{prog}\) de 2 GB por GPU es optimista con tensor parallel. NCCL reserva búferes para hablar con las otras GPUs (4 MiB cada uno por omisión, según su documentación), y vLLM guarda en cada GPU sus grafos de CUDA (las secuencias de operaciones que graba de antemano para lanzarlas de un jalón; su documentación avisa que ocupan memoria extra) y las activaciones del pico del prefill. Con \(n\) > 1, usa 3 o 4 GB por GPU hasta que lo midas: es un supuesto de esta lección, no una cifra publicada. Con 4 GB, Llama 3.3 70B en 2 L40S baja de 15 a 14 conversaciones.
:::

:::profundo La herramienta de VRAM cuenta el programa una sola vez
La [herramienta de VRAM](/herramientas/vram/) suma la VRAM de las \(n\) GPUs y resta \(M_{prog}\) **una sola vez** (por eso su página pide subirlo cuando hay más GPUs); la fórmula de esta lección lo resta en **cada** GPU. Con los mismos 2 GB, Llama 3.3 70B en 2 L40S da 16 conversaciones en la herramienta y 15 aquí. Para tensor parallel, la de aquí es la que se parece a lo que pasa.
:::

:::calculadora varias-gpus-memoria
Empieza con Llama 3.3 70B en 2 L40S: caben 15. Baja las GPUs a 1: no cabe ninguna. Elige la RTX PRO 6000 Blackwell (96 GB) con 1 GPU. Sube a 16 GPUs con Qwen3 32B y mira el aviso de los juegos de K y V repetidos.
:::

## Pipeline parallel: las capas en fila {Pipeline parallel: the layers in a row}

La otra forma de partir el modelo es por capas. Con [[pipeline-parallel|pipeline parallel]] (paralelismo en tubería), la GPU 0 guarda las primeras capas, la GPU 1 las siguientes, y así. Un token pasa por la GPU 0, que al terminar sus capas le pasa el *hidden state* a la 1, y así hasta el final. Cada tramo de capas en una GPU es una **etapa** (*stage*).

Lo bueno: entre etapas viaja **un solo vector por token**, de una GPU a la siguiente, en un envío de punto a punto. En Qwen3 32B son 10,240 bytes por token y por frontera, que por PCIe 4.0 cruzan en ≈ 0.3 µs más la latencia del envío. Contra los 128 all-reduce de tensor parallel, es casi nada. Por eso el paper de Megatron-LM de 2021 (Narayanan y otros) dice que tensor parallel va mejor **dentro** de un servidor, por su costosa comunicación all-reduce, y que pipeline parallel usa una comunicación punto a punto mucho más barata, que se puede hacer **entre** servidores. Es otro paper de **entrenamiento**, en servidores con NVLink; la regla se aplica a servir, pero no se traslada tal cual a 3 L40S por PCIe.

También admite repartos **disparejos**: 64 capas entre 3 GPUs son 21, 22 y 21 (vLLM le da la capa que sobra a la etapa de en medio y no a la última, que además carga la salida del modelo; se puede cambiar con la variable `VLLM_PP_LAYER_PARTITION`). Por eso, con las 3 L40S del despacho, pipeline parallel de 3 sí existe y tensor parallel de 3 no.

### La burbuja

Lo malo: mientras la GPU 0 hace sus capas, las otras esperan. Si solo hay **una** conversación, en cada instante trabaja **una** GPU: las demás están en la [[burbuja-de-pipeline|burbuja]] (*pipeline bubble*), el tiempo ocioso de una tubería que no está llena.

Para llenar la tubería se parte el trabajo en pedazos que van entrando uno tras otro: cuando el primero pasa a la GPU 1, el segundo entra a la GPU 0. Cada pedazo es un [[micro-batch|micro-batch]]. La fórmula del ocio sale del paper de **GPipe** (Huang y otros, Google, 2018), también de **entrenamiento**:

:::formula La burbuja de un pipeline
o = frac{p − 1}{m + p − 1}
- p: las etapas (las GPUs del pipeline)
- m: los micro-batches que entran uno tras otro
- m + p − 1: los turnos que tarda todo en salir (el último micro-batch entra en el turno \(m\) y tarda \(p\) etapas)
- o: la fracción del tiempo que una GPU pasa ociosa
:::

:::cuenta La burbuja con 3 L40S en fila
Una sola conversación // \(p\) = 3, \(m\) = 1 | (3 − 1) ÷ (1 + 3 − 1) | 2 ÷ 3 ≈ 67 % ocioso
Cuatro micro-batches // \(m\) = 4 | 2 ÷ 6 | ≈ 33 % ocioso
Dieciséis // \(m\) = 16 | 2 ÷ 18 | ≈ 11 % ocioso
= Con una sola conversación, dos de cada tres GPUs esperan. La tubería solo rinde cuando hay muchos pedazos en vuelo.
:::

:::figura varias-gpus-burbuja
Tres GPUs en fila, con 1 micro-batch y con 4. Con uno, cada GPU trabaja un turno de tres y espera dos. Con cuatro, después del arranque las tres trabajan a la vez, y la burbuja queda solo al principio y al final.
:::

:::profundo La regla de GPipe es de entrenamiento
GPipe dice que con 4 micro-batches por cada etapa la burbuja ya es despreciable. Ese «despreciable» es de entrenamiento, donde un lote fijo se parte en los micro-batches que uno quiera y la vuelta hacia atrás ayuda a rellenar. **En inferencia no hay lote fijo**: las conversaciones llegan cuando llegan. En un servidor, los micro-batches son las conversaciones que están en vuelo a la vez, y el [[batching-continuo|batching continuo]] las va metiendo en la tubería.
:::

### Lo que pipeline parallel no hace

- **No hace más rápido un token.** Cada token tiene que pasar por las 64 capas, en orden. Con 3 etapas, cada GPU lee un tercio de los pesos, pero una tras otra: el token tarda lo mismo que en una sola GPU, ≈ 35 ms con el despacho, más los envíos.
- **No hace más rápido un prefill**, por la misma razón: las capas van en fila.
- **Sí reparte la memoria.** Cada GPU guarda un tercio de los pesos y el KV cache de sus capas, así que caben modelos grandes y más conversaciones.
- **Sí da [[throughput-de-tokens|throughput]]**, si hay suficientes conversaciones a la vez para llenar la tubería: con la tubería llena, las tres GPUs trabajan a la vez.

:::analogia La línea de ensamble de una armadora
En una armadora, el chasis pasa por la estación de soldadura, luego la de pintura, luego la de interiores. Si solo hay un coche en la planta, dos estaciones están paradas. Si entran coches uno tras otro, las tres trabajan siempre, y sale un coche por turno.

Dónde se rompe: en un servidor, las conversaciones llegan al azar y cada una pide su token **ya**; no puedes esperar a juntar coches para llenar la línea. Y la línea da más coches por hora, no coches más rápidos.
:::

## Expert parallel: repartir los expertos de un MoE {Expert parallel: spreading out an MoE's experts} [extra]

Un modelo [[moe|MoE]] (*mixture of experts*) tiene, en cada capa, muchas redes chicas llamadas expertos en vez de un solo MLP, y un enrutador que manda cada token a unos pocos. Qwen3 30B-A3B, por ejemplo, tiene 128 expertos por capa y cada token usa 8 (su `config.json`). En memoria tienen que estar **todos**; en el cálculo, cada token solo usa sus [[parametros-activos|parámetros activos]], ≈ 3.3 mil millones.

Con [[expert-parallel|expert parallel]] (paralelismo de expertos), cada GPU guarda una parte de los expertos: con 4 GPUs, 32 de los 128 en cada una. La atención se sigue haciendo en cada GPU (con réplicas o con tensor parallel), pero cuando llega el MLP, cada token tiene que **viajar** a las GPUs donde viven sus 8 expertos y su resultado tiene que regresar. Eso no es un all-reduce, donde todos suman lo mismo: es un [[all-to-all|all-to-all]], donde cada GPU le manda a cada otra un paquete distinto (los tokens que le tocan).

:::ejemplo Cuánto viaja con Qwen3 30B-A3B
El *hidden size* de Qwen3 30B-A3B es 2,048: un token pesa 2,048 × 2 = 4,096 bytes en 16 bits. Si sus 8 expertos estuvieran todos en otras GPUs, el token viajaría 8 veces de ida y 8 de vuelta en cada una de las 48 capas: 2 × 8 × 4,096 × 48 ≈ 3.1 MB por token, en el peor caso. Es una cuenta de este curso, no una medición, y es el peor caso. Con 4 GPUs, 8 expertos siempre comparten GPU (no hay 8 GPUs donde ponerlos): si se eligen al azar, caen en promedio en ≈ 3.6 GPUs distintas, y una puede ser la propia, adonde no hay que viajar. Si el programa manda el token una sola vez a cada GPU de destino, viaja mucho menos que 8 veces; cómo agrupa los envíos depende de cada implementación.
:::

Los flags, según la documentación consultada el 2026-11-26: en vLLM, `--enable-expert-parallel`, que reparte los expertos entre todas las GPUs del proceso (el tamaño del tensor parallel por el de las réplicas; con solo tensor parallel, el mismo número de GPUs). Sin el flag, los expertos se parten como cualquier matriz, con tensor parallel. En SGLang, `--expert-parallel-size` (o `--ep-size`). Para MoE, la documentación de vLLM sugiere réplicas (data parallel) en la atención y expert parallel o tensor parallel en los expertos.

Ojo con las cabezas también aquí: Qwen3 30B-A3B tiene 32 cabezas de consulta y solo 4 juegos de K y V. Tensor parallel de 8 es válido (32 ÷ 8 = 4), pero repetiría los juegos de K y V. El despacho lo tiene en su lista de alternativas; con 30.5 mil millones de parámetros en total, en INT4 cabe en una L40S, y ahí vuelve a ganar la réplica.

## La decisión del despacho {The despacho's decision}

Ya están todas las piezas. Este diagrama las ordena como preguntas.

:::diagrama varias-gpus-decision
Toca cada pregunta. Sigue «El despacho hoy», «Si quiere Llama 3.3 70B» y «Un laboratorio con 16 GPUs».
:::

### Hoy: tres réplicas

Qwen3 32B en INT4 de AWQ **cabe** en una L40S, con lugar para 10 conversaciones al tope. Entonces:

- **Tensor parallel de 3 no existe** (64 cabezas).
- **Pipeline parallel de 3** reparte la memoria, que no hace falta, y no hace más rápida ninguna pregunta.
- **Tres réplicas** no se hablan, aguantan que una GPU falle, y son lo más simple para un equipo de TI de 2 personas que nunca ha operado una GPU.

La decisión es **3 réplicas**, una por L40S, con un balanceador delante que mande cada conversación siempre a la misma réplica. Es lo que ya suponía la herramienta de sizing al pedir 3.

```bash
# Tres réplicas, una por GPU (ilustrativo; los demás flags los ve la lección del stack de serving)
CUDA_VISIBLE_DEVICES=0 vllm serve Qwen/Qwen3-32B-AWQ --max-model-len 8192 --port 8001
CUDA_VISIBLE_DEVICES=1 vllm serve Qwen/Qwen3-32B-AWQ --max-model-len 8192 --port 8002
CUDA_VISIBLE_DEVICES=2 vllm serve Qwen/Qwen3-32B-AWQ --max-model-len 8192 --port 8003

# Lo mismo en un solo proceso, que reparte por dentro
vllm serve Qwen/Qwen3-32B-AWQ --max-model-len 8192 --data-parallel-size 3
```

`CUDA_VISIBLE_DEVICES` es una variable que le dice a un programa qué GPUs puede ver. Qué hace cada flag de `vllm serve` y por qué esos lo ve la lección «[Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM](/stack-serving/)».

### La palanca que queda: tensor parallel en pares

Las réplicas no arreglan lo que la ficha del despacho deja abierto: el primer token tarda ≈ 2.4 s y el objetivo es 2 s. Tensor parallel de 2 sí lo ataca (el prefill bajaría a ≈ 1.3 s en la cuenta), pero pide **pares** de GPUs: con 3 L40S quedaría un par y una GPU sola. Con una cuarta L40S (el servidor que se cotiza trae una cuarta ranura libre) serían 2 pares. **Es una prueba para el piloto, no una compra**: se miden las dos configuraciones con las preguntas reales del despacho, y gana la que cumpla el primer token en el p95 con la hora pico encima.

:::profundo Cuatro réplicas contra dos pares, con números
:::cuenta Cuatro L40S: cuatro réplicas o dos pares en tensor parallel
Cuatro réplicas: prefill de una pregunta, sin cola // cada L40S sola | 2 × 32.762 × 10⁹ × 6,000 ÷ 1.81 × 10¹⁴ | ≈ 2.17 s
Dos pares: prefill, sin cola // la cuenta del prefill con \(n\) = 2 | 1.09 + 0.25 | ≈ 1.34 s
Cuatro réplicas: decode a ≥ 20 tokens/s, cada una // paso ≤ 50 ms: \(b\) ≤ (30.24 − 19.32) ÷ 1.64 | ⌊6.66⌋ | 6, son 24 en total
Dos pares: decode a ≥ 20 tokens/s, cada par // pesos 9.66 y KV 0.82 GB por GPU, más la comunicación | la cuenta del script, con α = 10 µs | 23, son 46 en total
Si falla una GPU // a las réplicas les quedan 3; a los pares, 1 | 3 × 6 contra 23 | 18 contra 23
= En la cuenta, los dos pares ganan en primer token y en decode. Pero el decode no es el límite del despacho: el prefill lo es, y en el prefill tensor parallel **no ahorra trabajo**, solo lo reparte y le suma el cable. La capacidad total para la hora pico queda parecida; lo que mejora es lo que espera cada pregunta.
:::

Por qué el decode gana tanto: con una réplica, de los 50 ms que puede durar un paso, 32 se van en leer los pesos completos; con un par, cada GPU lee la mitad, 16 ms, y le quedan 34 para el KV cache de muchas más conversaciones. Ese es el lado bueno de no duplicar los pesos.

Y por qué no se decide en el papel. La latencia fija de cada all-reduce, \(α\), es un supuesto: si fuera de 30 µs, cada token sumaría ≈ 3.9 ms en vez de 1.3. Las dos GPUs del par tienen que estar en ranuras del mismo CPU. La documentación de vLLM sugiere pipeline parallel, no tensor parallel, en GPUs sin NVLink como la L40S. Y un par pierde toda su copia si falla una de sus dos GPUs. Por eso se mide.
:::

### Si mañana quiere Llama 3.3 70B

Ahora sí hay que partir: en una L40S no cabe ni una conversación. Las opciones, con las cuentas de esta lección (sin cola; la RTX PRO 6000 es la Workstation Edition de `gpus.json`, la variante de torre):

| Opción | Conversaciones por memoria | Decode, 1 conversación | Prefill de 6,000 tokens |
|---|---|---|---|
| 2 L40S, tensor parallel de 2 | 15 | ≈ 27.6 tokens/s | ≈ 2.84 s |
| 4 L40S, tensor parallel de 4 | 46 | ≈ 53 tokens/s | ≈ 1.92 s |
| 1 RTX PRO 6000 (96 GB), sin repartir | 16 | ≈ 30.0 tokens/s | ≈ 3.36 s |

Dos cosas salen de la tabla. Con preguntas de 6,000 tokens, un 70B **no cumple** el primer token de 2 s en ninguna de estas opciones, salvo tensor parallel de 4, y por muy poco y sin cola. Y una sola tarjeta de 96 GB lo carga sin repartir: sin comunicación, sin pares y sin la regla de las cabezas, que es justo lo que una tarjeta grande compra. La RTX PRO 6000 que va en un rack es la **Server Edition**, con 1,597 GB/s según la página de NVIDIA (consultada el 2026-11-26) en vez de los 1,792 de la Workstation: su decode sería ≈ 26.7 tokens/s con la misma cuenta. Antes de cambiar de modelo, el despacho tendría que demostrar con su examen de 200 preguntas que el 70B contesta mejor: si no, es pagar más por lo mismo.

## Los flags, lo que se ve al arrancar y cómo se mide {Flags, what you see at startup and how to measure} [extra]

### Los flags

```bash
# Un 70B partido en dos L40S (ilustrativo; elige un repositorio AWQ de Llama 3.3 70B que hayas revisado)
vllm serve <repositorio-awq-de-llama-3.3-70b> --tensor-parallel-size 2 --max-model-len 8192

# Las 64 capas en fila en tres L40S: el reparto disparejo que sí admite 3
vllm serve <repositorio-awq-de-llama-3.3-70b> --pipeline-parallel-size 3 --max-model-len 8192
```

Los flags de los dos servidores más usados, según su documentación consultada el 2026-11-26:

| Forma | vLLM | SGLang |
|---|---|---|
| Réplicas | `--data-parallel-size` (`-dp`) | `--data-parallel-size` (`--dp-size`, `--dp`) |
| Tensor parallel | `--tensor-parallel-size` (`-tp`) | `--tensor-parallel-size` (`--tp-size`, `--tp`) |
| Pipeline parallel | `--pipeline-parallel-size` (`-pp`) | `--pipeline-parallel-size` (`--pp-size`) |
| Expert parallel | `--enable-expert-parallel` | `--expert-parallel-size` (`--ep-size`, `--ep`) |

En los dos, sin flags, el modelo va en una sola GPU. En vLLM, las GPUs que pide un proceso son el producto: según su documentación, `--data-parallel-size 4` con `--tensor-parallel-size 2` pide 8.

Las cuentas de esta lección tienen un número inventado a propósito, \(α\), y un supuesto sobre el camino de los bytes. Las dos cosas se miden en el servidor antes de decidir.

### Ver la topología

El comando `nvidia-smi topo -m`, que viene con el driver de NVIDIA, imprime una tabla con cada par de GPUs y cómo se conectan, con siglas casi iguales a las de NCCL: `PIX`, `PXB`, `PHB`, `SYS`, o `NV#` si hay NVLink (la leyenda que imprime el propio comando las explica). La tabla trae también `NODE`, que NCCL no usa como nivel: el camino pasa entre dos puentes PCIe de la misma CPU. En un servidor de 2 CPUs con 4 L40S, lo esperable es ver `NODE` o `PHB` (o `PIX`/`PXB` si hay un switch PCIe en la tarjeta madre) entre las GPUs de la misma CPU, y `SYS` entre las de CPUs distintas. Esa tabla dice qué par usar para tensor parallel.

### Medir el all-reduce

Las pruebas de comunicación de NVIDIA, *nccl-tests*, traen un programa, `all_reduce_perf`, que hace all-reduce de tamaños crecientes entre las GPUs que le digas y reporta, para cada tamaño, el tiempo y dos anchos de banda: el *algbw* (el tamaño entre el tiempo) y el *busbw*, que es el *algbw* multiplicado por \(2(n − 1)/n\), el mismo factor del anillo, para que se pueda comparar contra el ancho de banda del cable. Dos lecturas importan para esta lección:

- **Con mensajes chicos** (unos KB, como el decode del despacho), si el modelo de esta lección vale, el tiempo casi no cambia con el tamaño: ese piso es \(α\).
- **Con mensajes grandes** (decenas de MB, como el prefill), el *busbw* se acerca al techo del enlace: eso dice cuánto de los 31.5 GB/s de PCIe 4.0 llega de verdad.

Con esos dos números, la calculadora de comunicación deja de usar supuestos.

### Lo que avisa el servidor

- Si pides tensor parallel de 3 con un modelo de 64 cabezas, vLLM no arranca y dice que las cabezas deben ser divisibles entre el tamaño de tensor parallel.
- Con más de 2 GPUs solo por PCIe, avisa que apagó su all-reduce propio.
- La guía de problemas de vLLM menciona `NCCL_P2P_DISABLE=1`, que apaga la comunicación directa entre GPUs, como arreglo temporal si una prueba se cuelga, y avisa que baja el rendimiento. La documentación de NCCL dice que no se deje fijada en producción. Si alguien la dejó en el arranque, el tensor parallel va más lento de lo que dice cualquier cuenta.
- Con varios servidores, la documentación de vLLM sugiere prender `NCCL_DEBUG=TRACE` y buscar `[send] via NET/Socket`: si aparece, los servidores se están hablando por TCP normal, que no es eficiente para tensor parallel entre servidores.

Y al final, lo que de verdad decide: una prueba de carga con las preguntas del despacho, que mide el primer token y los tokens por segundo con la hora pico encima, en cada configuración. Esa es la lección «Pruebas de carga y benchmarks honestos», más adelante en esta app.

## Errores comunes {Common mistakes}

1. **Repartir un modelo que cabe.** «Tenemos 3 GPUs, pongamos el modelo en las 3.» Si cabe en una, las réplicas dan capacidad en línea recta, sin cable y con fallas independientes. **Cómo evitarlo:** primero pregunta si cabe; reparte solo si no cabe o si necesitas que una pregunta vaya más rápido, y entonces mide.
2. **Creer que PCIe es «14 veces más lento» para tensor parallel.** En el decode con pocas conversaciones, los bytes del token tardan ≈ 42 µs por PCIe 4.0 y lo que pesa son las 128 latencias por token, que NVLink no quita del todo. **Cómo evitarlo:** separa los dos costos, \(N ÷ B_{enl}\) y \(α\), y haz la cuenta para tu batch y para el prefill por separado.
3. **Mezclar cifras bidireccionales con cifras por dirección.** «64 GB/s» de la L40S y «450 GB/s» de NVLink no se comparan: el primero suma las dos direcciones, el segundo no. **Cómo evitarlo:** pasa todo a una dirección (31.5 contra 450) o todo a las dos (64 contra 900).
4. **Pedir un tensor parallel que no divide las cabezas.** Tensor parallel de 3 o de 6 con un modelo de 64 cabezas no arranca. **Cómo evitarlo:** mira `num_attention_heads` y `num_key_value_heads` en el `config.json` y usa un divisor; con 3 GPUs, usa réplicas o pipeline parallel.
5. **Esperar que pipeline parallel acelere una pregunta.** Las capas van en fila: un token tarda lo mismo que en una sola GPU, y con una conversación dos de cada tres GPUs esperan. **Cómo evitarlo:** úsalo para que quepa un modelo o para throughput con muchas conversaciones, no para bajar el primer token.
6. **Contar la memoria del programa una sola vez.** Con tensor parallel, cada GPU carga su propio programa, sus búferes de NCCL y sus grafos. **Cómo evitarlo:** pon \(M_{prog}\) por GPU, de 3 a 4 GB hasta que lo midas.

## En la vida real {In real life}

**El despacho.** Qwen3 32B en INT4 de AWQ cabe en una L40S, así que las 3 L40S del sizing van como **3 réplicas**, una por GPU, con un balanceador que manda cada conversación a la misma réplica para aprovechar el prefix caching. Tensor parallel de 3 no existe con 64 cabezas, y pipeline parallel de 3 no haría más rápida ninguna pregunta. Lo que las réplicas no resuelven es el primer token de ≈ 2.4 s. La palanca que queda es tensor parallel de 2 en pares, que en la cuenta baja el prefill a ≈ 1.3 s, pero pide una cuarta L40S, depende de una latencia de PCIe que nadie ha medido en ese servidor y va contra la sugerencia de la documentación de vLLM: se prueba en el piloto, junto con la alternativa de 2 RTX PRO 6000 Server Edition. Si un día quiere Llama 3.3 70B, ya no cabe en una L40S: va en tensor parallel de 2 (15 conversaciones) o en una sola tarjeta de 96 GB, y con preguntas de 6,000 tokens el primer token pasa de 2 s salvo con 4 GPUs.

**Una startup con un MoE grande.** Supuesto del ejemplo: una empresa que sirve a varios clientes un modelo MoE de varios cientos de miles de millones de parámetros en un servidor de 8 GPUs unidas por NVLink. El modelo no cabe en una GPU, pero cada token usa una fracción chica de los parámetros. Aquí la combinación típica es réplicas en la atención y expert parallel en los expertos (lo que recomienda la documentación de vLLM para MoE): cada GPU guarda un octavo de los expertos y los tokens viajan con all-to-all a donde viven los suyos. El riesgo propio de esta forma es el desbalance: si muchos tokens eligen los mismos expertos, la GPU que los tiene se vuelve el embudo y las demás esperan. La documentación de vLLM avisa que el reparto de tokens entre expertos puede estar muy cargado de un lado, y trae un balanceador de expertos (EPLB) que los cambia de GPU según el uso, o duplica los más pedidos a cambio de memoria.

**Un laboratorio con 2 servidores de 8 GPUs.** Supuesto del ejemplo: un laboratorio de investigación con dos servidores HGX de 8 H100 cada uno (HGX es la placa de NVIDIA con 8 GPUs ya unidas) (8 GPUs [[sxm|SXM]] unidas por NVLink 4 dentro de cada servidor) y una red InfiniBand entre los dos, que sirve un modelo que no cabe en 8 GPUs. Hace lo que dice la documentación de vLLM: tensor parallel de 8 **dentro** de cada servidor, donde están las 128 colectivas por token y hay 450 GB/s por dirección, y pipeline parallel de 2 **entre** servidores, donde solo cruza un vector por token. Si hicieran tensor parallel de 16 a través de la red, cada token esperaría decenas de all-reduce por un cable mucho más lento que NVLink. La regla de Megatron (tensor parallel dentro, pipeline entre) existe justo para este caso.

**Fuera de las computadoras: una cocina de banquetes.** Tres cocineros pueden repartirse un banquete de tres formas: cada uno cocina platillos completos para sus mesas (réplicas); los tres hacen el mismo platillo y se juntan a mezclar dos veces (tensor parallel, que solo funciona con las estaciones pegadas); o uno pica, otro guisa y otro emplata (pipeline parallel, que solo rinde con muchos platillos en camino).

## Ejercicios {Exercises}

:::ejercicios
? [facil] ¿Cuántos bytes lleva un all-reduce de Llama 3.3 70B (hidden de 8,192) en el decode de una conversación, y cuántos bytes suman todos los all-reduce de un token (80 capas)?
\(N_{AR} = b × h × 2\) = 1 × 8,192 × 2 = **16,384 bytes** (16 KiB). Por token: 2 all-reduce × 80 capas = 160; 160 × 16,384 = **2,621,440 bytes** = 2.5 MiB. El doble que Qwen3 32B: un hidden más ancho y más capas.
? [facil] En un all-reduce en anillo con 8 GPUs, ¿cuántas veces su vector manda cada GPU? ¿Y con 2?
Factor \(2(n − 1)/n\): con 8, 2 × 7 ÷ 8 = **1.75 veces**; con 2, 2 × 1 ÷ 2 = **1 vez**. Nunca llega a 2, por muchas GPUs que haya.
? [facil] El despacho piensa en 6 L40S para tensor parallel de 6 con Qwen3 32B (64 cabezas de consulta, 8 juegos de K y V). ¿Arranca? ¿Y con 8?
64 ÷ 6 = 10.67, no es entero: vLLM **no arranca** («must be divisible by tensor parallel size (6)»). Con 8: 64 ÷ 8 = 8 cabezas por GPU, y 8 ÷ 8 = 1 juego de K y V por GPU: **sí**, sin repetir juegos.
? [facil] Un pipeline de 4 etapas con 1 conversación, y luego con 12 micro-batches en vuelo. ¿Qué fracción del tiempo pasa ociosa cada GPU?
\(o = (p − 1) ÷ (m + p − 1)\). Con \(m\) = 1: 3 ÷ 4 = **75 %**. Con \(m\) = 12: 3 ÷ 15 = **20 %**. Con una sola conversación, tres de cada cuatro GPUs esperan.
? [medio] Llama 3.3 70B en tensor parallel de 2 por PCIe 4.0 (31.5 GB/s por dirección), una conversación en decode. ¿Cuánto tardan los bytes de un token, cuánto la latencia con \(α\) = 10 µs, y qué parte del total es latencia?
Bytes por token por GPU: 2,621,440 × 1 (factor con \(n\) = 2). Tiempo de bytes: 2,621,440 ÷ 31.5 × 10⁹ ≈ **83 µs**. Latencia: 160 × 10 µs = **1.6 ms**. Total ≈ 1.68 ms, y la latencia es ≈ **95 %**. Contra la lectura de memoria de cada GPU, ≈ 34.6 ms (19.88 GB de pesos y 1.02 de KV a 604.8 GB/s), la comunicación es ≈ 5 % del paso.
? [medio] Con la fórmula de memoria por GPU, ¿cuántas conversaciones de 8,192 tokens de Llama 3.3 70B AWQ caben en tensor parallel de 4 en L40S (\(f\) = 0.10, \(M_{prog}\) = 2 GB)?
Pesos por GPU: 39.77 ÷ 4 = 9.94 GB. Libre: 43.2 − 9.94 − 2 = 31.26 GB. KV por GPU de una conversación: 2.684 ÷ 4 = 0.671 GB (2 de los 8 juegos por GPU). \(c_{máx}\) = ⌊31.26 ÷ 0.671⌋ = **46**. Tres veces más que con 2 GPUs (15): al partir los pesos en cuatro, cada GPU tiene mucha más memoria libre.
? [medio] Una pregunta del despacho trae 8,192 tokens (el tope). Con Qwen3 32B en tensor parallel de 2, ¿cuánto tarda solo la comunicación de su prefill por PCIe 4.0 y por NVLink 4 (450 GB/s por dirección)?
Bytes por all-reduce: 8,192 × 10,240 = 83.9 MB. Por el prefill: 128 × 83.9 MB ≈ **10.74 GB**. PCIe 4.0: 10.74 ÷ 31.5 ≈ **0.34 s**. NVLink 4: 10.74 ÷ 450 ≈ **0.024 s**. Aquí sí aparece la diferencia de ≈ 14 veces: en el prefill, el cable manda.
? [reto] El despacho compra una cuarta L40S. Compara 4 réplicas contra 2 pares en tensor parallel de 2 con Qwen3 32B: el prefill de 6,000 tokens sin cola, las conversaciones que van a ≥ 20 tokens/s en decode, y qué pasa si falla una GPU. ¿Por qué la capacidad total en la hora pico no mejora tanto como sugiere el decode?
Prefill: una L40S sola, 2 × 32.762 × 10⁹ × 6,000 ÷ (0.5 × 362.05 × 10¹²) ≈ **2.17 s**; un par, 1.09 s de cálculo + 0.25 s de PCIe ≈ **1.34 s**. Decode a ≥ 20 tokens/s (paso ≤ 50 ms, 30.24 GB de lectura a 604.8 GB/s): una réplica, ⌊(30.24 − 19.32) ÷ 1.64⌋ = 6, son **24**; un par, cada GPU lee 9.66 + 0.82 × \(b\) GB más ≈ 1.6 ms de comunicación, y aguanta \(b\) = 23, son **46**. Si falla una GPU: quedan 3 réplicas (18) o un par (23). Pero el límite del despacho es el prefill, y el prefill es trabajo de cálculo: tensor parallel lo reparte entre dos GPUs sin reducirlo, y le suma 0.25 s de cable. En la hora pico, el cálculo total de los prefills es el mismo con las dos configuraciones, así que la capacidad queda parecida; lo que mejora es el primer token de cada pregunta. Y todo depende de \(α\), que no se ha medido.
? [reto] Para Llama 3.3 70B, compara 2 L40S en tensor parallel de 2 contra 1 RTX PRO 6000 Workstation (96 GB, 1,792 GB/s, 503.8 TFLOPS): conversaciones por memoria, tokens/s con una conversación y prefill de 6,000 tokens (\(η_m\) = 0.7, \(η_c\) = 0.5, \(α\) = 10 µs). ¿Cuál elegirías y qué falta saber?
Memoria: el par, **15**; la PRO 6000, (0.9 × 96 − 39.77 − 2) ÷ 2.684 = 44.63 ÷ 2.684 → **16**. Decode con una conversación (KV de 6,250 tokens = 2.05 GB): el par, (19.88 + 1.02) ÷ 604.8 ≈ 34.6 ms + 1.7 ms de comunicación ≈ 36.3 ms → **≈ 27.6 tokens/s**; la PRO 6000, (39.77 + 2.05) ÷ (0.7 × 1,792) ≈ 33.3 ms → **≈ 30.0**. Prefill: el par, 2 × 70.554 × 10⁹ × 6,000 ÷ (2 × 0.5 × 362.05 × 10¹²) ≈ 2.34 s + 0.50 s de PCIe ≈ **2.84 s**; la PRO 6000, 8.47 × 10¹⁴ ÷ (0.5 × 503.8 × 10¹²) ≈ **3.36 s**. Casi empatan: la PRO 6000 gana en simplicidad (sin cable, sin pares) y el par en primer token. Ninguna cumple 2 s con preguntas de 6,000 tokens. Falta: el precio y la ficha de la Server Edition (la de rack, con 1,597 GB/s), medir \(α\), y sobre todo que el 70B saque más en el examen del despacho que el 32B.
:::

## Lo que sigue {What comes next}

- **«[Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM](/stack-serving/)»** pone estas formas en programas concretos: cuáles hacen tensor parallel, cuáles réplicas y cómo se arrancan las 3 réplicas del despacho con todos sus flags.
- **«[Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/)»** es lo que va delante de las réplicas: el balanceador que reparte las conversaciones entre las 3 L40S y las manda siempre a la misma.
- **«[De requisitos a hardware](/requisitos-hardware/)»** hace la cuenta completa de cuántas GPUs pide el despacho, con la cola de la hora pico que esta lección dejó fuera de sus primeros tokens «sin cola».
- **«Pruebas de carga y benchmarks honestos»**, más adelante, mide lo que aquí se supuso: el primer token en el p95 con cada configuración.
- En Sensei: [CPU y GPU](https://sensei.trueml.app/cpu-gpu/) tiene PCIe, NVLink y la HBM por dentro; [Matrices y FLOPs](https://sensei.trueml.app/flops/), por qué el decode espera a la memoria y el prefill al cálculo; [Números grandes, unidades y estimaciones](https://sensei.trueml.app/unidades/), cómo no perderse entre µs, ms y GB/s; y [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/), por qué el objetivo del despacho es el p95 y no el promedio.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
paralelismo replica data-parallel tensor-parallel pipeline-parallel expert-parallel all-reduce all-reduce-en-anillo all-to-all colectiva nccl burbuja-de-pipeline micro-batch
:::

## Chequeo {Check}

:::chequeo
? ¿Cuándo bastan réplicas y cuándo hay que partir el modelo?
Bastan réplicas cuando el modelo cabe en una GPU con lugar para sus conversaciones: dan capacidad en línea recta, sin comunicación. Hay que partir cuando no cabe, o cuando una sola pregunta tiene que ir más rápido de lo que una GPU puede.
? ¿Cuántos all-reduce hace un token de Qwen3 32B con tensor parallel, y por qué?
128: dos por cada una de sus 64 capas, uno después de la atención y otro después del MLP, porque cada GPU termina con un vector parcial que hay que sumar.
? ¿Por qué en el decode con pocas conversaciones PCIe no es «14 veces más lento» que NVLink?
Porque los bytes de un token son poquísimos (1.25 MiB, ≈ 42 µs por PCIe 4.0) y lo que pesa es la latencia fija de los 128 all-reduce, que existe en los dos cables. El ancho de banda pesa en el prefill y con batches grandes.
? ¿Por qué el despacho no puede usar tensor parallel de 3?
Porque Qwen3 32B tiene 64 cabezas de atención y 64 no se divide entre 3: vLLM no arranca. Con 3 GPUs se puede usar réplicas o pipeline parallel, que admite repartos disparejos.
? ¿Qué es la burbuja de un pipeline y cuánto vale con 3 etapas y una conversación?
El tiempo que las GPUs de un pipeline pasan esperando porque la tubería no está llena: \((p − 1) ÷ (m + p − 1)\) = 2 ÷ 3 ≈ 67 %.
? ¿En qué se diferencia el all-to-all de expert parallel del all-reduce de tensor parallel?
En el all-reduce todas las GPUs suman el mismo vector y todas se quedan con el total. En el all-to-all cada GPU le manda a cada otra un paquete distinto: los tokens que van a los expertos que viven en ella.
:::
