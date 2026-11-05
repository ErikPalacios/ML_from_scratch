---
titulo: Hacer varias cosas a la vez: async, event loop y GIL
en: Doing several things at once: async, the event loop and the GIL
subtitulo: Por qué un servidor pasa casi todo su tiempo esperando, cómo un solo hilo atiende cientos de requests turnándose en los puntos de espera, por qué en Python los hilos sirven para esperar y no para calcular, y cómo se calcula cuánta concurrencia hace falta.
pregunta: ¿Cómo atiende un pod del gateway de C01, con un solo proceso y un núcleo, 100 requests por segundo, y cuándo deja de funcionar?
requisitos: programa-proceso
---

:::idea
Una request pasa casi toda su vida esperando: la red, otro servicio, el disco. Async aprovecha esas esperas: un solo hilo, el event loop, se turna entre muchas requests justo donde cada una espera. Lo que calcula no se turna así: dentro del loop congela a todas, y por eso va a un threadpool, a otros procesos o a más máquinas; por el GIL de Python, los hilos solo aceleran las cuentas que corren en C. Cuántas cosas a la vez hacen falta lo dice la Ley de Little: lo que llega por segundo por lo que tarda cada una.
:::

El gateway de C01 es el programa que recibe cada foto, la prepara y se la pasa al modelo. En el pico de diseño, el tráfico para el que se compran las máquinas, le llegan 500 [[request|requests]] por segundo. Las atienden 5 copias del programa (en Kubernetes, cada copia es un *pod*), y cada pod corre **un solo [[proceso]]** de Python con **un [[vcpu|vCPU]]** reservado: la unidad de CPU que renta la nube, que para el programa es un núcleo. Cada request tarda en promedio 50 ms.

A cada pod le tocan 100 requests por segundo. De una en una, a 50 ms cada una, no pasaría de 20 (1 s ÷ 0.05 s), y sin embargo aguanta, con la CPU al 60 %. ¿Cómo? Y también falla: basta una sola línea mal puesta para que el mismo pod se congele entero. ¿Cuándo, y por qué?

De «Programa, proceso e hilo» vas a usar cuatro ideas: un [[proceso]] es un programa corriendo, con su propia memoria; un [[hilo]], una línea de ejecución dentro de él que comparte esa memoria; [[concurrencia]] es tener varias tareas en curso, y [[paralelismo]], varias avanzando en el mismo instante, cada una en su [[nucleo|núcleo]]. Ahí viste que la concurrencia aprovecha las esperas y que en Python cuatro hilos que calculan no van más rápido que uno. Aquí verás cómo y por qué, en cuatro piezas: casi todo es **esperar**; un solo hilo puede **turnarse** en esas esperas; lo que calcula va a otro lado, según el **GIL**; y la **Ley de Little** dice cuántas cosas a la vez hacen falta.

## I/O y bloqueo: casi todo es esperar {I/O and blocking: most of the time is waiting}

### Qué es I/O

Un programa calcula con lo que tiene a la mano: la [[cpu|CPU]], que hace las cuentas, y la [[ram|RAM]], la memoria donde guarda sus datos mientras corre. Todo lo demás está afuera: el [[disco]], la red, otros servicios, la [[gpu|GPU]]. Pedirle algo a lo de afuera, o mandárselo, se llama **[[io|I/O]]** (*input/output*, entrada y salida).

Leer un archivo es I/O. Recibir los bytes de la foto de Ana, también. Y mandarle el tensor a Triton, el servidor que corre el modelo en la GPU, para que regrese los logits, también: la GPU calcula en otra máquina, y el gateway solo espera.

Lo que distingue al I/O es lo que tarda. Los números son aproximados, pero sus [[orden-magnitud|órdenes de magnitud]] no cambian. Para sentirlos, imagina que un nanosegundo durara un segundo:

| Qué | Cuánto tarda | Si 1 ns durara 1 s |
|---|---|---|
| Una operación sencilla de la CPU | ≈ 1 ns | 1 segundo |
| Leer la RAM | ≈ 100 ns | ≈ 2 minutos |
| Leer un bloque de 4 KiB de un [[ssd\|SSD]] NVMe de los de hoy | ≈ 0.1 ms | ≈ 1 día |
| Ir y volver por la red dentro del centro de datos | 0.1 a 0.5 ms | de 1 a 6 días |
| Ir y volver a Triton, en C01 | ≈ 10 ms | ≈ 4 meses |
| Leer un archivo chico de S3, el almacén de archivos de AWS | decenas de ms | de 4 meses a 3 años |
| La respuesta completa del [[llm\|LLM]] de C10 | ≈ 10 s | ≈ 300 años |

Mientras el gateway espera esos 10 ms a Triton, un [[nucleo|núcleo]] de ≈ 3 GHz (3 × 10⁹ ciclos de reloj por segundo) da 3 × 10⁹ × 0.01 s = 30 millones de ciclos, y en cada ciclo termina varias instrucciones. Una operación suelta es casi gratis comparada con una espera. La CPU se nota cuando son millones de operaciones, como al decodificar una foto.

### Bloquear

¿Qué hace un programa mientras espera? Con el código de todos los días, nada. Cuando escribes `datos = archivo.read()` o `r = requests.get(url)` (requests es una de las librerías de Python más usadas para pedir datos por la red), el hilo se queda detenido en esa línea hasta que llegan los bytes. Una llamada así es **bloqueante**, y a esa espera se le llama **[[bloqueo]]** (*blocking*): el hilo pasa al estado «bloqueado» que viste con el planificador en «Programa, proceso e hilo».

Bloquear no gasta CPU: el [[sistema-operativo|sistema operativo]] duerme al hilo y le presta el núcleo a otro. Lo que gasta es **el hilo**: mientras espera, no puede atender nada más. Un servidor con un solo hilo que bloquea atiende de una en una.

:::cuenta Un pod que atiende de una en una
Latencia de cada request // el promedio de C01 en el pico de diseño (M03) | — | 50 ms
Requests por segundo, de una en una | 1 s ÷ 0.05 s | 20
Lo que le toca a cada pod // 500 por segundo entre 5 pods | 500 ÷ 5 | 100 por segundo
Requests que el pod debe tener en curso a la vez | 100 ÷ 20 | 5
= De una en una, el pod atiende la quinta parte de lo que le llega. Necesita ≈ 5 requests en curso al mismo tiempo. La sección de la Ley de Little hace esta cuenta en general.
:::

La salida clásica es darle **un hilo a cada request**: mientras uno espera, el sistema operativo corre otro, y cada cambio es un [[cambio-contexto|cambio de contexto]] de microsegundos. Funciona con decenas o cientos a la vez. Con miles se vuelve caro, porque cada hilo necesita su propia pila en memoria y el sistema operativo tiene que repartirles turnos a todos. La otra salida, la de esta lección, es que un solo hilo aproveche las esperas.

### De qué está hecha una request de C01

| Paso | Qué hace el gateway | Cuánto, en una request típica |
|---|---|---|
| Recibir los bytes de la foto | Espera a la red | 1 a 3 ms (más si la foto es grande) |
| Decodificar, redimensionar y normalizar | Calcula con la CPU | ≈ 6 ms en promedio |
| Mandar el tensor a Triton y esperar los logits | Espera a la red y a la GPU de otra máquina | ≈ 10 ms |
| Softmax, top 5 y armar la respuesta | Calcula con la CPU | ≈ 1 ms |

Suman de 18 a 20 ms: son los números de una request típica (M03 y C01). El promedio que usa la Ronda, ≈ 50 ms, es una estimación más larga: suma las esperas en fila, detrás de otras requests, y las requests lentas, que jalan el promedio hacia arriba. La CPU trabaja ≈ 6 a 7 ms por request, casi todo en el decode; la Ronda usa ≈ 6 ms en sus cuentas de capacidad, y aquí también. **Todo lo demás es esperar**, y ahí está el truco: mientras una request espera, el núcleo puede trabajar para otra.

## CPU-bound contra I/O-bound {CPU-bound vs I/O-bound}

Un trabajo tarda por una de dos razones: mucho que calcular o mucho que esperar. Las dos tienen nombre en inglés:

- **[[cpu-bound|CPU-bound]]**, limitado por la CPU: tarda por las cuentas. Mientras corre, un núcleo está al 100 %. Decodificar una foto, tokenizar texto, correr un modelo en CPU.
- **[[io-bound|I/O-bound]]**, limitado por el I/O: tarda por las esperas. Mientras tanto, la CPU casi no trabaja. Llamar a otro servicio, descargar archivos, escribir *logs* (el registro de lo que va pasando).

### Cómo saber cuál es

Compara dos relojes: el tiempo que pasó y el tiempo que la CPU trabajó para tu programa. Python tiene los dos: `time.perf_counter()` es el reloj de pared (el tiempo que pasa de verdad), y `time.process_time()` cuenta solo el tiempo de CPU de tu proceso.

```python
import time

def esperar():                 # I/O: aquí la espera es un sleep; en la vida, la red o el disco
    time.sleep(0.5)

def calcular():                # CPU: cuentas y nada más
    total = 0
    for i in range(8_000_000):
        total += i * i

for tarea in (esperar, calcular):
    reloj0, cpu0 = time.perf_counter(), time.process_time()
    tarea()
    reloj = time.perf_counter() - reloj0     # cuánto tardó, en el reloj de pared
    cpu = time.process_time() - cpu0         # cuánto trabajó la CPU para este programa
    if cpu / reloj > 0.5:
        print(f"{tarea.__name__:>8}: la CPU trabajó casi todo el tiempo → CPU-bound")
    else:
        print(f"{tarea.__name__:>8}: la CPU casi no trabajó → I/O-bound")
```

```salida
 esperar: la CPU casi no trabajó → I/O-bound
calcular: la CPU trabajó casi todo el tiempo → CPU-bound
```

Donde se escribió esta lección, esperar usó ≈ 0 % de CPU y calcular, ≈ 100 %. En tu máquina los tiempos cambian, pero la diferencia no: esperar no gasta CPU, y calcular la gasta toda.

En producción se lee igual, en las gráficas: lento con un núcleo al 100 % es CPU-bound; lento con la CPU baja, algo está esperando.

### Qué es qué en ML

| Trabajo | Tipo | Por qué |
|---|---|---|
| Decodificar y redimensionar una foto | CPU-bound | Cuentas sobre millones de píxeles |
| Llamar a Triton desde el gateway | I/O-bound | El gateway espera; la GPU calcula en otra máquina |
| Leer y decodificar fotos para entrenar | Las dos | M02: «En CV el cuello de botella suele ser IO + decode, no la GPU» (CV es visión por computadora) |
| Pedirle una respuesta al LLM de C10, visto desde su gateway | I/O-bound | Unos milisegundos de CPU y ≈ 10.5 s de espera: ≈ 99.9 % es esperar |

:::ojo CPU-bound no es compute-bound
En la lección de FLOPs viste [[compute-bound]] y [[memory-bound]]: hablan de un **chip** y de si lo limita calcular o leer su memoria. CPU-bound e I/O-bound hablan de un **programa** y de si lo limita la CPU o la espera. La misma inferencia puede ser las dos cosas: para el gateway de C01, llamar a Triton es I/O-bound (espera 10 ms), y dentro de la GPU, la ResNet-50 con batches grandes tiende a ser compute-bound.
:::

### La regla que ordena todo

**Lo que espera se puede encimar; lo que calcula solo se reparte.** Mientras una request espera, otra puede avanzar, sin gastar un núcleo más. Las cuentas, en cambio, necesitan núcleos: para hacer más hay que repartirlas entre más núcleos o más máquinas, o calcular menos.

C01 tiene de las dos en cada request, y por eso usa dos herramientas: async para las esperas y un [[threadpool]], un grupo de hilos aparte, para las cuentas. Las secciones que siguen las arman.

## async, await y el event loop: turnarse en los puntos de espera {async, await and the event loop: taking turns at the waiting points}

La idea de async: mientras una request espera a Triton, que otra avance en el mismo hilo. Hacen falta dos cosas: código que diga dónde espera y alguien que reparta los turnos.

### Corrutinas: funciones que se pueden pausar

Una función normal corre de principio a fin, y mientras corre, el hilo es suyo. Una **[[corrutina]]** (*coroutine*) es una función que se puede **pausar a la mitad** y seguir después, donde se quedó, con sus variables intactas. En Python se escribe con `async def`.

Dentro de una corrutina, **`await`** marca un punto de espera: «aquí espero algo; mientras llega, que corra otra». `await asyncio.sleep(0.3)` espera 0.3 s sin detener al hilo (`asyncio` es la parte de Python que trae todo esto), y `await triton.infer(...)` espera la respuesta de Triton igual.

### El event loop: el que reparte los turnos

Las corrutinas no se turnan solas. Las administra el **[[event-loop|event loop]]** (ciclo de eventos), un ciclo que corre en **un solo hilo**. Cada corrutina que le entregas es una **tarea** (*task*), y el loop lleva dos listas: las tareas **listas** para avanzar y las que **esperan** algo. Repite cuatro pasos:

:::pasos
1. Toma una tarea lista
La primera de la fila.
2. La deja correr hasta su siguiente await
Ahí la tarea se pausa sola y le regresa el turno al loop.
3. La anota entre las que esperan
Y le pide al sistema operativo que le avise cuando llegue lo que espera: los bytes de una conexión, la respuesta de Triton, que pase cierto tiempo.
4. Vuelve a empezar
Con la siguiente tarea lista. Si no hay ninguna, el loop duerme hasta que el sistema operativo le avise que algo llegó, y esa tarea vuelve a la fila de las listas.
:::

Programar así es **[[async]]** (asíncrono). En Python, el event loop viene en `asyncio`, que es parte de la biblioteca estándar: lo que trae Python sin instalar nada. El gateway de C01 está escrito con FastAPI, una librería de Python para hacer APIs, y lo corre uvicorn, un servidor que arranca un event loop en cada proceso y crea una tarea por cada request que llega.

```python
import asyncio, time

async def atender(nombre, espera):
    print(f"{nombre}: llega y espera {espera} s")
    await asyncio.sleep(espera)                 # el punto de espera: aquí suelta el turno
    print(f"{nombre}: listo")

async def main():
    t0 = time.perf_counter()
    for nombre, espera in (("A", 0.3), ("B", 0.1), ("C", 0.2)):
        await atender(nombre, espera)            # una tras otra: cada una espera a la anterior
    print(f"una tras otra: {time.perf_counter() - t0:.1f} s\n")

    t0 = time.perf_counter()
    await asyncio.gather(atender("A", 0.3), atender("B", 0.1), atender("C", 0.2))
    print(f"turnándose: {time.perf_counter() - t0:.1f} s")

asyncio.run(main())
```

```salida
A: llega y espera 0.3 s
A: listo
B: llega y espera 0.1 s
B: listo
C: llega y espera 0.2 s
C: listo
una tras otra: 0.6 s

A: llega y espera 0.3 s
B: llega y espera 0.1 s
C: llega y espera 0.2 s
B: listo
C: listo
A: listo
turnándose: 0.3 s
```

La última línea, `asyncio.run(main())`, arranca un event loop y le entrega `main` como su primera tarea. Fíjate en dos cosas. Primera: `await` solo no encima nada. En la primera mitad, cada `await atender(...)` espera a que esa request termine antes de empezar la siguiente: 0.3 + 0.1 + 0.2 = 0.6 s. Para turnarse hacen falta **varias tareas a la vez**, y eso hace `asyncio.gather`: convierte cada corrutina en una tarea, se las entrega al loop y espera a que terminen todas. En un servidor no lo escribes tú: uvicorn crea una tarea por request.

Segunda: turnándose, el total es lo que tarda la espera más larga, 0.3 s, y B termina primero aunque llegó segunda. Las tres esperas se encimaron.

:::figura async-turnos
Tres requests, cada una con 2 ms de CPU, 10 ms de espera y otros 2 ms de CPU. Arriba, un hilo que bloquea: una tras otra, la última termina a los 42 ms. Abajo, un event loop: las esperas se enciman y la última termina a los 18 ms. El hilo calcula lo mismo en los dos casos, 12 ms; la diferencia es que abajo no se queda parado esperando.
:::

Esto es [[concurrencia]] sin [[paralelismo]]: tres requests en curso, pero en cada instante solo una corrutina corre, en un solo núcleo. Y async no hace más rápida a ninguna request. La Ronda (M03) lo dice así: «La concurrencia deja atender a otros mientras uno espera a Triton; no acelera a ninguno».

:::analogia El mesero de un restaurante
Un mesero atiende diez mesas. Toma la orden de una, la deja en la cocina y, mientras se cocina, va a otra mesa. No se queda parado junto a la cocina: el plato tarda lo mismo, pero en ese rato atendió a otras cinco mesas. El mesero es el event loop; cada mesa, una request; la cocina, Triton.

**Dónde se rompe:** al mesero lo puedes interrumpir con un grito; al event loop, no: una tarea suelta el turno solo cuando llega a un await. Y el mesero elige a quién atender según su criterio, mientras que el loop atiende a las tareas en el orden en que quedaron listas.
:::

:::diagrama async-loop
Toca cada caja para ver qué hace, o usa «Recorrer» para seguir una vuelta del loop y una tarea que no suelta el turno.
:::

:::calculadora async-proceso
Arranca con un pod de C01 que atiende de una en una: 20 por segundo. Sube «a la vez» a 5 y llega a 100, con la CPU al 60 %. ¿A partir de cuántas a la vez ya no sube más, y por qué?
:::

Desde 9 a la vez ya no sube: con 6 ms de CPU cada una, un núcleo termina como máximo 1,000 ÷ 6 ≈ 167 por segundo, y las que sobran hacen fila. Encimar esperas sirve hasta que la CPU se llena.

:::profundo Cómo sabe el loop qué está listo: epoll, kqueue y las 10,000 conexiones
El loop no revisa cada conexión para ver si ya llegó algo: gastaría CPU en preguntar. Le entrega al sistema operativo la lista de todo lo que espera (para el sistema operativo, cada conexión abierta es un *socket*, con su número) y hace una sola [[syscall|llamada al sistema]] que dice: «duérmeme hasta que alguna de estas tenga datos, o hasta que venza mi próximo temporizador». En Linux esa llamada es **epoll**; en macOS, **kqueue**; en Windows, IOCP. El sistema operativo despierta al loop con la lista de las que ya están listas.

Así, un solo hilo vigila miles de conexiones, y cada corrutina que espera ocupa poca memoria: su estado y sus variables, no un hilo entero. En 1999, Dan Kegel le puso nombre al reto de atender 10,000 conexiones a la vez en un servidor, el *problema C10K*, y la respuesta que se impuso fue esta: pocos hilos y un ciclo de eventos. nginx (un servidor web muy usado), Node.js (JavaScript en el servidor) y uvloop (un event loop más rápido, que uvicorn usa si está instalado) funcionan así.

A este reparto de turnos se le llama **cooperativo** (*cooperative multitasking*): cada tarea suelta el turno por voluntad propia. El del sistema operativo con los hilos es **apropiativo** (*preemptive*): les quita el núcleo cuando le toca a otro, quieran o no. Esa diferencia explica la sección que sigue.
:::

## Lo bloqueante dentro de async: un decode congela el pod {Blocking inside async: one decode freezes the pod}

El loop tiene una regla que no se negocia: una corrutina suelta el turno **solo** en un await. Entre dos await, el hilo es suyo y nadie más corre. Es un trato de confianza: funciona mientras cada una suelte el turno pronto.

### La trampa de C01

En FastAPI, la función que atiende una dirección de la API, como `/v1/classify`, se llama **ruta** (*route*; no es la [[ruta]] de un archivo). La de abajo es la trampa que la Ronda cuenta en C01, M02, M03 y M07; la línea `@app.post` la conecta con su dirección. Es una ilustración, sin salida, porque necesita FastAPI:

```python
@app.post("/v1/classify")
async def classify(request: Request):
    body = await request.body()      # I/O: suelta el turno mientras llegan los bytes. Bien.
    x = preprocess(body)             # CPU: ≈ 6 ms; de 40 a 80 con una foto de 12 MP. Sin await.
    return await infer(x)            # I/O: suelta el turno mientras responde Triton. Bien.
```

`preprocess` decodifica y redimensiona con la CPU, sin ningún await, y mientras tanto **el loop está detenido**. Ninguna otra request avanza: ni las que ya tienen su respuesta de Triton esperando, ni las que acaban de llegar, ni el *health check*, la request que Kubernetes manda cada pocos segundos para preguntar «¿sigues vivo?».

:::cuenta Una foto grande dentro del loop
Tiempo del decode // una foto web de 12 MP decodificada sin draft mode, el atajo de decodificar directo a un tamaño menor: de 40 a 80 ms (M03) | — | ≈ 60 ms
Requests que llegan mientras // a un pod en el pico de diseño | 100 por s × 0.06 s | ≈ 6
Lo que espera de más cada una | — | hasta 60 ms
El loop ocupado si todos los decodes van adentro // ≈ 6 ms cada uno en promedio, a 100 por segundo | 100 × 6 ms ÷ 1,000 ms | 60 %
= Con el decode dentro, el loop pasa 60 % del tiempo congelado. Cada request espera, además de lo suyo, los decodes de las que llegaron antes, y con más tráfico espera más.
:::

### El síntoma

La Ronda lo resume en una frase: «un p99 que crece con la concurrencia sin que la CPU esté llena». La [[mediana]] se mueve poco y las requests más lentas, mucho: las que caen detrás de una foto grande esperan decenas de milisegundos de más, y esas forman el [[p99]], el tiempo que solo 1 de cada 100 supera. Y la CPU no tiene por qué llenarse: la espera no es por falta de núcleos, es por falta de turnos, porque todo pasa por un solo hilo.

Hay un efecto peor. En C01, Kubernetes le pregunta a cada pod por su salud cada 10 s y espera la respuesta 2 s. Si el loop está congelado más de 2 s en tres preguntas seguidas, Kubernetes da al pod por muerto y lo reinicia, justo en la hora de más tráfico.

:::profundo Verlo en tu computadora: un latido que se congela
Este programa tiene un «latido» que debería avanzar cada 50 ms, como un health check, y una ruta que «decodifica» durante 0.3 s. Aquí el decode es un `time.sleep`: bloquea el hilo igual que uno de verdad, aunque no gaste CPU.

```python
import asyncio, time

def decodificar():                       # bloqueante: un decode de verdad ocupa así el hilo
    time.sleep(0.3)

async def latido(huecos):                # como un health check: debería avanzar cada 50 ms
    for _ in range(8):
        antes = time.perf_counter()
        await asyncio.sleep(0.05)
        huecos.append(time.perf_counter() - antes)

async def ruta_mal():
    decodificar()                        # corre en el hilo del loop: nadie más avanza

async def ruta_bien():
    await asyncio.to_thread(decodificar)  # corre en otro hilo; el loop sigue repartiendo turnos

async def probar(ruta):
    huecos = []
    await asyncio.gather(latido(huecos), ruta())
    return max(huecos)

for ruta in (ruta_mal, ruta_bien):
    hueco = asyncio.run(probar(ruta))
    print(f"{ruta.__name__}: entre dos latidos pasaron hasta {round(hueco * 20) * 50} ms")
```

```salida
ruta_mal: entre dos latidos pasaron hasta 300 ms
ruta_bien: entre dos latidos pasaron hasta 50 ms
```

`asyncio.to_thread` manda la función a otro hilo y la espera con await: el loop queda libre. El latido no se entera del decode. Los tiempos los mide tu reloj: con la máquina muy ocupada, alguno puede salir 50 ms más alto, pero la diferencia entre las dos rutas no cambia.
:::

:::figura async-bloqueo
Cien milisegundos de un pod. Arriba, el decode de una foto grande corre dentro del loop: durante 60 ms, la respuesta de Triton para B, la request nueva C y el health check esperan sin avanzar. Abajo, el decode corre en un hilo del pool: el loop sigue libre y atiende a cada una en cuanto le toca.
:::

### Los arreglos

Los sospechosos de siempre son `time.sleep`, las librerías de red que no son async (como `requests`), leer archivos grandes, decodificar imágenes, correr el modelo de PyTorch (`model(x)`) y armar un JSON enorme (el formato de texto con que viajan los datos de una API). El bloque de abajo trae cada uno con su arreglo.

En FastAPI hay tres arreglos. Usar las librerías que se esperan con await para el I/O. Mandar lo bloqueante a un hilo con `await run_in_threadpool(preprocess, body)`, que es el arreglo de C01. O escribir la ruta con `def` en vez de `async def`: FastAPI la corre entera en un hilo de su [[threadpool]].

:::profundo Los sospechosos, uno por uno, y cómo encontrar al que bloquea
| Lo que bloquea | El arreglo |
|---|---|
| `time.sleep(…)` | `await asyncio.sleep(…)` |
| `requests.get(…)` y otros clientes sin «async» | Un cliente que se espera con await: `httpx.AsyncClient`, `aiohttp`, `tritonclient.http.aio` |
| Leer o escribir archivos grandes | `await asyncio.to_thread(…)` |
| Decodificar o redimensionar imágenes | Un hilo del pool |
| `model(x)` de PyTorch | Un hilo del pool, o un servidor de modelos como Triton |
| Armar un JSON enorme, comprimir, sacar la huella (*hash*) de un archivo grande | Un hilo del pool, si tarda más que unos milisegundos |

asyncio trae un modo de depuración: `asyncio.run(main(), debug=True)`, o la variable de ambiente `PYTHONASYNCIODEBUG=1`. En ese modo, avisa en el log cada vez que una tarea retiene el loop más de 100 ms sin soltar el turno, y dice cuál fue. En producción se usa py-spy, un programa que mira en vivo en qué línea está cada hilo de un proceso de Python, sin reiniciarlo ni cambiar su código. Y la defensa de siempre es medir por separado: el gateway de C01 tiene un histograma para el preproceso y otro para la llamada a Triton. Si la latencia sube y solo crece el primero, el problema está en la CPU del gateway, no en la GPU.
:::

## El GIL: los hilos esperan juntos, pero calculan de uno en uno {The GIL: threads wait together but compute one at a time}

Si lo bloqueante va a otro hilo, ¿por qué no hacer todo con hilos? Porque en Python los hilos tienen una restricción que no tienen en la mayoría de los lenguajes.

### Un candado para todo el intérprete

El Python que instalas normalmente se llama CPython: un [[interprete|intérprete]] escrito en C, como viste en «Programa, proceso e hilo». Tiene un candado (*lock*, como el que protege un contador entre hilos) para todo el intérprete: el **[[gil|GIL]]** (*Global Interpreter Lock*), con una regla: **dentro de un proceso, solo el hilo que tiene el GIL ejecuta código de Python**. Los demás hilos esperan su turno.

Un hilo suelta el GIL en tres casos:

- **Cuando espera.** `time.sleep`, leer de la red, leer un archivo. Mientras espera, el GIL queda libre y otro hilo corre.
- **Cuando entra a código en C que lo suelta.** Pillow (la librería de imágenes que usa C01) al decodificar y redimensionar, NumPy en sus operaciones grandes, PyTorch dentro de cada operación. Hacen sus cuentas en C, sin tocar los datos de Python (sus *objetos*), y mientras tanto otro hilo puede correr Python.
- **A la fuerza, cada 5 ms.** Si un hilo calcula Python puro sin parar y otro espera el GIL, a los 5 ms el intérprete le pide que lo suelte (lo dice `sys.getswitchinterval()`), para que ningún hilo se quede sin turno.

La consecuencia, en una frase: **los hilos de Python sirven para esperar, no para calcular**, salvo que el cálculo pase en C y suelte el GIL.

:::figura async-gil
Tres maneras de correr dos tareas. Arriba, dos hilos que esperan: sus esperas se enciman y terminan juntos. En medio, dos hilos que calculan Python puro: el GIL pasa de uno a otro cada ≈ 5 ms, y juntos tardan lo de dos tareas en fila. Abajo, dos procesos, cada uno con su GIL: calculan al mismo tiempo, en dos núcleos.
:::

Este programa lo mide. Cada tarea anota cuánta CPU usó su hilo (`time.thread_time()`), y la suma dividida entre lo que tardaron dice cuántos núcleos trabajaron en promedio:

```python
import time
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
def esperar(_):                      # mientras duerme, el hilo suelta el GIL
    cpu0 = time.thread_time()        # la CPU que usa este hilo
    time.sleep(0.3)
    return time.thread_time() - cpu0

def calcular(_):                     # Python puro: necesita el GIL en cada paso
    cpu0, total = time.thread_time(), 0
    for i in range(4_000_000):
        total += i * i
    return time.thread_time() - cpu0

def nucleos(Pool, tarea):            # núcleos trabajando, en promedio: lo mejor de 5 intentos
    mejor = 0.0
    with Pool(max_workers=2) as pool:
        for _ in range(5):
            t0 = time.perf_counter()
            mejor = max(mejor, sum(pool.map(tarea, range(2))) / (time.perf_counter() - t0))
    return round(mejor)

if __name__ == "__main__":
    print("2 hilos que esperan, núcleos:    ", nucleos(ThreadPoolExecutor, esperar))
    print("2 hilos que calculan, núcleos:   ", nucleos(ThreadPoolExecutor, calcular))
    print("2 procesos que calculan, núcleos:", nucleos(ProcessPoolExecutor, calcular))
```

```salida
2 hilos que esperan, núcleos:     0
2 hilos que calculan, núcleos:    1
2 procesos que calculan, núcleos: 2
```

El programa mide 5 veces y se queda con la mejor, para que no cuente lo que la máquina hacía en otra cosa. Si la tuya tiene al menos dos núcleos y usas el Python de siempre, el que tiene GIL, deberían salirte los mismos números. El `if __name__ == "__main__":` hace falta por los procesos, como en «Programa, proceso e hilo»: para arrancar cada uno, Python vuelve a leer tu archivo (en macOS, en Windows y, desde la 3.14, en Linux), y sin esa línea cada hijo volvería a correr todo el archivo e intentaría arrancar sus propios procesos: Python lo impide con un error (RuntimeError) y el programa falla.

:::analogia Una reunión con un solo micrófono
En la reunión, muchos pueden estar leyendo, pensando o esperando un correo al mismo tiempo, pero solo habla quien tiene el micrófono. Los hilos que esperan son los que leen: no necesitan el micrófono. Los que calculan Python son los que hablan: se lo pasan, y en cada momento habla uno.

**Dónde se rompe:** en una reunión, quien tiene el micrófono lo suelta cuando quiere; aquí, el moderador se lo quita cada 5 ms a quien no lo suelta. Y hay quienes trabajan sin hablar: las librerías en C, como Pillow o PyTorch, calculan sin el micrófono, mientras otro lo usa.
:::

En producción, la Ronda (M07) da el síntoma: «CPU del proceso clavada en ≈ 100 % de un core con los demás libres». Pasa con el código en Python puro alrededor del modelo: recorrer una por una las cajas que encontró un detector de objetos, leer o armar un JSON grande.

:::profundo Por qué existe el GIL, el lado bueno de PyTorch y el Python que no lo tiene
La Ronda (M07) también da el lado bueno: «Las ops de PyTorch sueltan el GIL». Con la ResNet-50 en CPU, en una laptop con Apple M4, midió ≈ 60 imágenes por segundo con 1 hilo y ≈ 95 con 4. Los hilos ayudan, porque PyTorch calcula en C, pero no 4 veces, porque cada llamada de PyTorch ya usa varios núcleos por dentro.

CPython lleva en cada objeto la cuenta de cuántas cosas lo usan, sean variables, listas u otros objetos (*reference counting*); cuando la cuenta llega a 0, libera su memoria. Si dos hilos cambiaran esa cuenta al mismo tiempo, podría quedar mal, y el programa liberaría memoria que todavía se usa. Un candado por objeto sería lento. Un solo candado global es simple y hace rápido al programa de un hilo, que es casi todo el Python que existe. Además, las librerías en C se escriben más fácil sabiendo que nadie más toca los objetos de Python mientras ellas trabajan.

Quitarlo tomó décadas. Desde Python 3.13 (2024) existe, como experimento, una versión sin GIL, la *free-threaded*, y desde la 3.14 (2025) tiene soporte oficial. Pero no es la que se instala por omisión, cada librería en C tiene que adaptarse para funcionar sin GIL (si una no lo está, Python vuelve a activar el GIL al importarla), y con un solo hilo corre un poco más lento: en la 3.14, ≈ 5 a 10 %. La 3.14 trae además otra salida: varios intérpretes dentro de un mismo proceso, cada uno con su GIL (`concurrent.interpreters`), aunque muchas librerías todavía no funcionan con ellos. En producción, hoy, cuenta con que el GIL está ahí: la Ronda lo da por hecho.
:::

## Threadpool, procesos y workers: dónde va el trabajo de CPU {Thread pools, processes and workers: where the CPU work goes}

El trabajo de CPU no va en el loop. ¿A dónde, entonces? Hay tres lugares, del más barato al más caro.

### 1. Un threadpool

Un **[[threadpool]]** (grupo de hilos) es un conjunto de hilos que se reusan: esperan trabajo en una fila. Llega una tarea y la toma un hilo libre; si todos están ocupados, la tarea espera su turno. Tiene dos ventajas: no se paga crear un hilo por tarea, y hay un tope.

En un servidor async, el pool es el lugar natural para lo bloqueante: el loop le pasa la tarea y espera el resultado con await, así que sigue repartiendo turnos. FastAPI usa un pool de 40 hilos por omisión (el de `run_in_threadpool` y las rutas `def`), y asyncio tiene el suyo, el de `asyncio.to_thread`.

¿Y acelera las cuentas? Depende del GIL: sí, para lo que corre en C y lo suelta, como el decode de Pillow, NumPy o PyTorch; no, para Python puro. Aunque no las acelere, el pool libera al loop: el planificador turna los hilos en los núcleos y el GIL cambia de dueño cada 5 ms, así que el loop recibe su turno aunque el decode siga. Si el decode corre en C, como el de Pillow, el loop ni siquiera espera el GIL.

El tope importa tanto como el pool. C01 deja decodificar solo **2 fotos a la vez** por pod, no 40: un PNG de 40 MP llega a ocupar ≈ 320 MB mientras se decodifica (lo midió la Ronda), y el pod tiene 1 GiB de memoria. Cómo se pone ese tope está en la sección extra «Async a fondo».

### 2. Varios procesos

Para calcular Python puro en paralelo hay que salir del GIL: **[[multiproceso]]**, varios [[proceso|procesos]], cada uno con su intérprete, su memoria y su GIL. `concurrent.futures.ProcessPoolExecutor` es el pool de procesos que usaste en la sección anterior.

Cuesta tres cosas: arrancar un intérprete por proceso; copiar los datos de ida y de vuelta, porque los procesos no comparten memoria (Python los convierte en bytes con *pickle*); y que cada proceso cargue su propia copia de todo, modelo incluido.

### 3. Workers

Un **[[worker]]** es un proceso, a veces un hilo, que toma trabajo de una fila y lo hace. La palabra tiene dos usos:

- **Workers de un servidor.** `uvicorn --workers 4` arranca 4 procesos iguales, cada uno con su event loop, que se reparten las requests. Un proceso padre los vigila: si uno muere o se queda colgado, arranca otro. gunicorn, muy usado en Python, hace lo mismo, y puede arrancar workers de uvicorn.
- **Workers de una cola**, los del *patrón asíncrono* de M02 (asíncrono en la arquitectura, no en el código): procesos que sacan trabajos (*jobs*) de una cola y los procesan a su ritmo.

Los workers de un servidor tienen una trampa cuando hay un modelo adentro: **cada proceso carga el suyo**. Con una [[cnn|CNN]] chica como la ResNet-50 caben, pero se turnan la GPU sin armar [[batch|batches]] entre ellos. Con Llama 3 8B, que pesa ≈ 16 GB en BF16 (8 mil millones de parámetros × 2 bytes), dos workers ya no caben en una GPU L4 de 24 GB. La cuenta completa, con la memoria que pide [[cuda|CUDA]] en cada proceso, está en la sección extra de «Programa, proceso e hilo». Para un modelo grande, la salida es un servidor con una sola copia que arme batches adentro.

### Por qué C01 corre un solo proceso por pod

C01 corre **un solo worker de uvicorn por contenedor** y escala con más pods: el HPA (*Horizontal Pod Autoscaler*), la regla de Kubernetes que agrega o quita pods según su CPU, los mueve entre 3 y 12. La Ronda (M05) da las razones: varios workers en un pod esconden cuánta CPU usa cada proceso, multiplican la memoria, complican las métricas (los números que el servicio publica para vigilarlo) y pueden dejar un pod «sano» con un worker colgado.

Así, la concurrencia de C01 se reparte en capas. En cada pod, el loop encima las esperas y 2 hilos hacen las cuentas. Entre pods, Kubernetes reparte los núcleos. Y Triton, escrito en C++ y sin GIL, junta las fotos de muchas requests en un batch para la GPU.

:::diagrama async-pod
Toca cada caja para ver por qué está ahí, o usa «Recorrer» para seguir una request normal, la hora pico y la trampa del decode en el loop.
:::

:::profundo Cómo nace un proceso: fork, spawn y forkserver
Hay tres maneras de arrancar un proceso de Python desde otro. Con **fork**, el sistema operativo copia al proceso padre tal como está, memoria incluida; es rápido, pero copia también lo que no debería, como un candado que otro hilo tenía tomado (el hijo solo hereda el hilo que hizo el fork, así que nadie lo suelta) o una conexión abierta. Con **spawn**, arranca un intérprete nuevo desde cero, que vuelve a leer tu archivo: más lento y más seguro, y por eso pide el `if __name__ == "__main__":`. **forkserver** arranca primero un proceso limpio y de ahí hace fork de cada hijo. macOS y Windows usan spawn por omisión, y uvicorn arranca sus workers con spawn. Linux usaba fork y, desde Python 3.14, usa forkserver. Con [[cuda|CUDA]], fork da problemas: los hijos heredan un contexto de GPU que no pueden usar. Por eso los servidores de modelos arrancan sus procesos con spawn, o cargan el modelo después de crearlos.
:::

## La Ley de Little: cuánta concurrencia hace falta {Little's law: how much concurrency you need}

Falta una pregunta: ¿cuántas cosas a la vez? ¿Cuántas requests en vuelo, cuántos hilos, cuántas conexiones? La respuesta es una multiplicación.

**L = λ × W.** Lo que hay adentro, en promedio, es lo que llega por unidad de tiempo por lo que tarda cada uno adentro. Es la **[[ley-little|Ley de Little]]** (*Little's law*), que John Little demostró en 1961:

- **L**: cuántas hay adentro en promedio. En un servidor, las requests **en vuelo**: ya llegaron y todavía no terminan.
- **λ** (la letra griega lambda): la [[tasa]] de llegada, en requests por segundo.
- **W**: cuánto pasa cada una adentro, en promedio: su [[latencia]].

El ejemplo de todos los días: a un restaurante llegan 100 clientes por hora y cada uno se queda media hora. Adentro hay, en promedio, 100 × 0.5 = 50. No importa el menú ni a qué hora llegó cada quien.

:::figura async-little
Una request llega cada 10 ms (λ = 100 por segundo) y cada una tarda 50 ms (W). Cada barra es una request, de que llega a que sale. La línea punteada, a los 75 ms, corta 5 barras: hay 5 en vuelo, L = 100 × 0.05. Entre los 50 y los 100 ms, cualquier otra línea también corta 5.
:::

Vale para cualquier cosa con entradas y salidas. En C01 sirve para cuatro cosas:

:::cuenta Little en el gateway de C01, en el pico de diseño (M03)
Requests en vuelo en todo el servicio // 500 por segundo, 50 ms cada una | 500 × 0.05 s | 25
Por pod // con 5 pods | 25 ÷ 5 | 5
Llamadas a Triton abiertas a la vez // ≈ 10 ms de ida y vuelta | 500 × 0.010 s | 5
vCPU ocupados en el preproceso // Little aplicado a la CPU: cada request que calcula ocupa un vCPU ≈ 6 ms | 500 × 0.006 s | 3
= 25 requests en vuelo, 5 por pod, que entre todas ocupan 3 vCPU: el resto de su vida esperan. Es la primera mitad de la respuesta de la lección.
:::

### Dónde se pone el límite

Cada request en vuelo ocupa algo: memoria para su foto, una conexión, un lugar en el loop. Por eso el gateway de C01 tiene un tope, `MAX_INFLIGHT = 16` por pod: la request 17 recibe al instante un 503, un error que dice «estoy saturado, reintenta», y rechazarla cuesta microsegundos. ¿Por qué 16? Por Little al revés: a 100 por segundo, con 20 en vuelo cada request tardaría en promedio 20 ÷ 100 = 0.2 s, justo la promesa de 200 ms de C01, y con más, ni el promedio la cumpliría. Se baja a 16 por memoria: 16 fotos de hasta 10 MB son 160 MB, que caben en el 1 GiB del pod junto con los 2 decodes.

Little también dice qué pasa cuando algo se frena. El gateway espera a Triton como máximo 150 ms: es su [[timeout]], su tiempo máximo de espera. Si Triton tarda hasta ese límite, las llamadas abiertas pasan de 5 a 500 × 0.15 = **75**, ≈ 15 por pod. Con un timeout de 5 s serían 500 × 5 = **2,500** colgadas, ≈ 500 por pod, cada una con su memoria y su conexión, para respuestas que nadie espera: quien llamó, el *backend* del marketplace (el programa que pidió la categoría), se va a los 300 ms. Los timeouts acotan W y, con W, la concurrencia.

### La trampa: Little habla de promedios

L es un promedio. En un instante dado puede haber muchas más, porque las requests llegan al azar: en una hora simulada de un pod, con 5 en promedio, hubo un momento con 19. Por eso un tope como el de C01 deja margen sobre el promedio. Con 16, el pod casi nunca rechaza en condiciones normales, y si rechaza seguido, algo va lento.

Lo que no se hace es multiplicar la tasa por el p99 para sacar «la concurrencia en el peor caso». La Ronda (M03) es tajante: «es una cuenta sin significado». Piensa en el restaurante: si el cliente más lento de cada 100 se queda 2 horas (un supuesto), 100 × 2 = 200 supondría que **todos** se quedan 2 horas; adentro sigue habiendo 50 en promedio. Cuántos hay en el peor momento depende de cuántos llegan juntos, y eso lo dicen una simulación o una prueba de carga.

:::profundo Verlo en una simulación: el promedio y los picos
Esta simulación manda una hora de tráfico a un pod (100 por segundo y 50 ms en promedio, todo al azar) y cuenta cuántas hay adentro en cada instante:

```python
import random
from collections import Counter
random.seed(7)

lam, W = 100, 0.050                     # un pod de C01: 100 requests por segundo, 50 ms en promedio
eventos, t = [], 0.0
for _ in range(360_000):                # una hora de tráfico
    t += random.expovariate(lam)        # llegadas al azar, 100 por segundo en promedio
    dura = random.expovariate(1 / W)    # cada una tarda distinto: 50 ms en promedio
    eventos += [(t, +1), (t + dura, -1)]

tiempo, adentro, antes = Counter(), 0, 0.0   # tiempo[n]: cuánto duró «n requests en vuelo»
for instante, cambio in sorted(eventos):     # recorre la hora: +1 al llegar, −1 al salir
    tiempo[adentro] += instante - antes
    adentro, antes = adentro + cambio, instante

total = sum(tiempo.values())
# el primer n que, sumando su tiempo y el de todos los de abajo, junta el 99 % de la hora
p99 = next(n for n in sorted(tiempo) if sum(tiempo[k] for k in tiempo if k <= n) >= 0.99 * total)
print(f"Little, λ × W: {lam} × {W} = {lam * W:.1f} en vuelo")
print(f"simulado, en promedio: {sum(n * s for n, s in tiempo.items()) / total:.1f} en vuelo")
print(f"el 99 % del tiempo hubo {p99} o menos; el máximo fue {max(tiempo)}")
print(f"16 o más en vuelo: {100 * sum(s for n, s in tiempo.items() if n >= 16) / total:.3f} % del tiempo")
```

```salida
Little, λ × W: 100 × 0.05 = 5.0 en vuelo
simulado, en promedio: 5.0 en vuelo
el 99 % del tiempo hubo 11 o menos; el máximo fue 19
16 o más en vuelo: 0.005 % del tiempo
```

El promedio sale exactamente el de Little, aunque cada request tardó distinto. Pero menos del 1 % del tiempo hubo 12 o más, en un momento hubo 19, y el tope de 16 se alcanzó el 0.005 % del tiempo.
:::

### Cuándo deja de funcionar

Aplicada a la CPU, Little da los núcleos ocupados: tasa × CPU por request. Ese número tiene un techo, los núcleos que tienes. Si lo pasa, cada segundo llega más trabajo del que se puede hacer y la fila crece sin parar. Y aun en el 100 % justo, la fila no tiene techo: por eso se deja margen, y el HPA de C01 apunta al 60 %.

Pasa más fácil de lo que parece: basta con que suba el tráfico o la CPU de cada request. Una foto web de 12 MP sin draft mode cuesta de 40 a 80 ms de CPU, no 6, y el ejercicio 6 calcula con cuántas así ya no alcanza.

Con esto ya tienes la respuesta completa. Un pod de C01 atiende 100 requests por segundo porque cada una pasa casi toda su vida esperando y el loop las encima: 5 en vuelo con 0.6 vCPU. Deja de funcionar de tres maneras:

1. **Algo bloquea el loop**, y nadie avanza.
2. **La CPU no alcanza**: tasa × CPU por request llega a los núcleos.
3. **W crece**, porque algo de atrás se frena, y la concurrencia crece con ella hasta acabarse la memoria o las conexiones. Por eso los timeouts y los topes.

:::calculadora async-little
Prueba la falla 3: deja todo igual y sube la latencia de 50 a 150 ms. ¿Cuántas quedan en vuelo por pod, y cuánto margen le queda al tope de 16? Si el que se frena es Triton, cada request tarda todavía más: lo calculas en el reto 9.
:::

:::profundo Por qué la Ley de Little siempre se cumple
Dibuja, como en la figura, una barra por cada request: empieza cuando llega y termina cuando sale. Ahora mide el área de todas las barras de dos formas. Por columnas: en cada instante, la altura de la pila es cuántas hay adentro; sumada a lo largo de T segundos, da L × T. Por barras: en T segundos llegaron λ × T requests, cada una de largo W en promedio, así que el área es λ × T × W. Es la misma área, así que L × T = λ × T × W, y L = λ × W.

No se supuso nada sobre cómo llegan ni cuánto tardan: por eso vale con cualquier tráfico. Lo único que pide es que el sistema no se esté llenando sin parar. Si la fila crece sin fin, no hay un promedio estable que medir.
:::

## Async a fondo: varias llamadas a la vez, tiempos límite y cancelar {Async in depth: fan-out, timeouts and cancellation} [extra]

Async no solo encima requests distintas. Dentro de una misma request, encima las llamadas que no dependen una de otra. Y como cada await espera algo de afuera, cada uno necesita un tiempo límite.

### Llamar a varios a la vez: la suma se vuelve el máximo

Si una request llama en serie a tres servicios, las latencias se suman. Si las llamadas no dependen entre sí, `asyncio.gather` las lanza juntas y la request espera solo a la más lenta. La Ronda (M03) lo llama «paralelizar lo independiente»: «La suma se vuelve el máximo».

El precio es el [[fan-out]] de la lección de probabilidad: si esperas a todos, basta con que uno tenga un mal momento. Con 10 servicios que superan su p99 el 1 % de las veces, casi 10 % de tus requests (1 − 0.99¹⁰ = 9.6 %) toca el p99 de al menos uno.

### Un tiempo límite en cada await

Un await sin límite puede esperar para siempre. `asyncio.wait_for(llamada, timeout=…)` espera como máximo ese tiempo y, si vence, **cancela** la llamada y lanza un error, `TimeoutError`, que tu código atrapa con `try` y `except`. C01 lo usa con Triton, y le da lo que quede del presupuesto: quien llama espera 300 ms, el gateway se da 250 en total, a Triton le da 150, y la fila de Triton rechaza a los 100. Cada salto espera menos que el de antes: «300 → 250 → 150 → 100 ms» (M15).

```python
import asyncio, time

async def servicio(nombre, ms):            # una llamada por la red que tarda ms milisegundos
    await asyncio.sleep(ms / 1000)
    return f"{nombre} ({ms} ms)"

async def con_limite(nombre, ms, limite_ms):
    try:
        return await asyncio.wait_for(servicio(nombre, ms), timeout=limite_ms / 1000)
    except TimeoutError:                   # wait_for ya canceló la llamada (TimeoutError desde Python 3.11)
        return f"{nombre}: cancelado a los {limite_ms} ms"

async def main():
    llamadas = [("features", 40), ("modelo", 90), ("re-ranker", 400)]
    t0 = time.perf_counter()
    respuestas = await asyncio.gather(*(con_limite(n, ms, 150) for n, ms in llamadas))
    reloj = time.perf_counter() - t0
    for r in respuestas:
        print(r)
    print(f"a la vez y con límite: {round(reloj * 20) * 50} ms · en fila y sin límite: {sum(ms for _, ms in llamadas)} ms")

asyncio.run(main())
```

```salida
features (40 ms)
modelo (90 ms)
re-ranker: cancelado a los 150 ms
a la vez y con límite: 150 ms · en fila y sin límite: 530 ms
```

La request responde a los 150 ms con lo que tiene, en vez de esperar 530. Qué hace con el re-ranker que faltó (el modelo que reordena los resultados) es decisión del diseño: en C11, si no llega a tiempo, la Ronda usa el orden que ya traía la búsqueda.

### Cancelar lo que ya nadie espera

Cancelar en async es barato: la corrutina recibe un aviso en el await donde está y deja de correr. Es lo que hace C10, el LLM de la Ronda: si el cliente cierra la conexión, el gateway cierra la suya con vLLM, el servidor que corre el modelo, y «vLLM aborta la secuencia y libera su KV cache» (el [[kv-cache|KV cache]] es la memoria de la GPU donde el modelo guarda lo que ya calculó de cada token de la conversación). Sin eso, la GPU seguiría generando tokens para nadie.

### Acotar cuántas a la vez

`asyncio.Semaphore(n)` es un contador de lugares: deja pasar a n corrutinas a la vez y pone a esperar a las demás, con await, sin bloquear el loop. El gateway de C01 pone uno de 2 lugares frente al threadpool, aunque el pool de FastAPI tiene 40 hilos. ¿Por qué tan pocos? Por memoria. Un PNG de 40 MP ocupa ≈ 320 MB al decodificarse, y el pod tiene 1 GiB. Con 2 lugares, el peor caso es 2 × 320 MB, más ≈ 80 MB de Python y ≈ 160 MB de requests en vuelo: ≈ 880 MB, el 82 % del límite (la cuenta completa está en «Programa, proceso e hilo»). Con 40 serían 12.8 GB, y el pod moriría por falta de memoria ([[oom|OOM]]).

Esperar un lugar tiene además un tiempo máximo: si una request espera más de 50 ms, recibe un 503, un error que dice «estoy saturado, reintenta». Esperar más ya no cumpliría la promesa de 200 ms, y rechazar cuesta microsegundos.

`asyncio.Queue(maxsize=…)` es lo mismo para una fila: si se llena, quien quiere meter algo espera o recibe un error. Sin tope, la fila crece en silencio, como verás con C13 en «En la vida real».

### Tu propio batching

M07 cuenta cómo armar *dynamic batching* (juntar en un batch las requests que llegan casi al mismo tiempo) en Python: una `asyncio.Queue`, una tarea que junta hasta N requests o espera T milisegundos, una sola llamada al modelo con todo el batch y un *future* por request (una promesa de resultado que se cumple después) para regresarle a cada una lo suyo. El esqueleto es corto; lo difícil son los bordes. Un ítem corrupto no debe tumbar a los demás, un cliente que ya canceló no debe ocupar lugar, y la fila necesita tope. Triton hace todo eso en C++, fuera del GIL, y por eso C01 lo usa en vez de escribirlo.

## Errores comunes {Common mistakes}

### 1. Llamar algo bloqueante dentro de async def

`time.sleep`, `requests.get`, un decode de Pillow o `model(x)` dentro de una ruta `async def` congelan el loop: ninguna request avanza, ni los health checks.

**Cómo evitarlo:** para el I/O, las versiones que se esperan con await (`asyncio.sleep`, `httpx.AsyncClient`, `tritonclient.http.aio`). Lo bloqueante y la CPU, a un hilo con `run_in_threadpool` o `asyncio.to_thread`, o la ruta escrita con `def`. Y una métrica aparte para el preproceso.

### 2. Creer que async hace más rápida cada request

Async no acelera a nadie: deja que, mientras una espera, otras avancen. Una request sola tarda lo mismo, y a un trabajo CPU-bound no le ayuda en nada.

**Cómo evitarlo:** pregunta primero dónde se va el tiempo. Si es espera, async o hilos. Si es CPU, procesos, más máquinas o calcular menos.

### 3. Usar hilos para acelerar Python puro

Por el GIL, cuatro hilos que calculan Python puro usan un núcleo, no cuatro.

**Cómo evitarlo:** procesos o más pods, o mover la cuenta a código que suelte el GIL (NumPy, Pillow, PyTorch).

### 4. Pools y filas sin tope

Un pool de 40 hilos que decodifica 40 fotos de 40 MP pide 12.8 GB en un pod de 1 GiB. Una fila sin tope (`asyncio.Queue()`) nunca falla: solo crece, y la latencia con ella.

**Cómo evitarlo:** un tope por recurso (los 2 lugares de CPU de C01, `MAX_INFLIGHT = 16`, filas con `maxsize`) y rechazar rápido lo que no cabe: un 503 cuesta microsegundos.

### 5. Varios workers con el modelo adentro

`uvicorn --workers 4` son 4 procesos y 4 copias del modelo, sin batching entre ellos. Con Llama 3 8B, ni dos copias caben en una L4.

**Cómo evitarlo:** un proceso por contenedor y más pods para la CPU; para el modelo, un servidor con una sola copia que arme batches, como Triton o vLLM.

### 6. Calcular la concurrencia con el p99

λ × p99 no es el peor caso: es una cuenta sin significado, porque Little habla de promedios.

**Cómo evitarlo:** L = λ × W con la latencia promedio, y λ del pico, no del promedio del día. El peor caso lo acota el timeout (500 × 0.15 = 75), y el margen se mide con una prueba de carga.

### 7. Un await sin timeout

La Ronda (M03) lo dice así: «Un servicio lento es peor que uno caído». Por Little, cada segundo de más que tarda suma λ requests colgadas: a 500 por segundo, 500 más.

**Cómo evitarlo:** un timeout en cada llamada por la red, más corto que el de quien te llama, y pasarle a cada salto (cada servicio por el que pasa la request) lo que queda del presupuesto.

## En la vida real {In real life} [extra]

### C01: de un proceso que hacía todo a dos piezas que hacen cada una lo suyo

El primer servicio de C01, el MVP (la versión mínima para probar la idea), era lo más simple posible: una máquina con GPU, un proceso de FastAPI con PyTorch adentro, y una foto a la vez. Atendía al 10 % de los vendedores, ≈ 35 requests por segundo en el pico. La Ronda cuenta por qué no crece: PyTorch así da del orden de 100 imágenes por segundo por proceso, y «el GIL y la falta de batching hacen que agregar threads no ayude».

El diseño final separa el trabajo según su tipo. El gateway, en máquinas sin GPU, encima las esperas con su loop y hace el decode en 2 hilos, en 3 a 12 pods. Triton, en la GPU, junta las fotos en batches desde C++; con TensorRT en FP16, la Ronda cuenta con ≈ 1,200 imágenes por segundo por T4, un número que se mide antes de producción.

Aun con ese diseño, los vCPU se cuentan con el pico. La Ronda (M03) cuenta qué pasa si se dimensiona con el tráfico promedio del día: a 116 requests por segundo, el gateway ocupa 116 × 6 ms ≈ 0.7 vCPU, y le dan 1. A las 8 de la noche llegan 350 por segundo, que piden ≈ 2.1: «el threadpool se satura y el p99 explota».

### C10: cientos de conversaciones abiertas

El gateway del LLM de C10 casi no calcula: revisa la llave de acceso, la cuota y el tamaño de cada request en unos milisegundos, y después espera a vLLM mientras reenvía cada token apenas llega. Cada request dura segundos, así que hay muchas abiertas a la vez:

:::cuenta Little en el gateway de C10 (Ronda)
Requests por segundo en el pico | — | 60
Lo que dura cada una // generando la respuesta | — | ≈ 10.5 s
Conversaciones abiertas a la vez | 60 × 10.5 s | ≈ 630
Por réplica del gateway // con 4 réplicas | 630 ÷ 4 | ≈ 158
Tope por réplica // 16 réplicas de vLLM × 72 en vuelo cada una, lo más que aguantan cumpliendo su promesa, ÷ 4 gateways | — | 288
= 630 conversaciones son ≈ 55 % de lo que el gateway acepta. Con un hilo por conversación serían cientos de hilos esperando; con un event loop, son corrutinas.
:::

### C13: la fila que crece en silencio

En C13, los subtítulos en vivo de una reunión, el audio llega en pedazos de 160 ms. La Ronda cuenta una trampa: una `asyncio.Queue()` sin tope entre la conexión y el modelo. Si la GPU tarda 200 ms en procesar cada pedazo, la fila nunca falla, pero cada pedazo agrega 40 ms de atraso: en 10 minutos llegan 3,750 pedazos y salen 3,000, y los 750 que esperan son 2 minutos de audio. La sesión va dos minutos atrasada, sin un error ni un log. La regla que pone la Ronda: saltarse resultados intermedios mientras alcance y, si el atraso pasa de ≈ 2 s, cerrar la sesión para que se abra en una GPU con lugar.

### M02: workers de una cola

El OCR de un PDF de 200 páginas, a ≈ 1 s por página, tarda ≈ 200 s con un worker y ≈ 10 s con 20. Little funciona igual con jobs: si llegan 50 por segundo y cada uno vive ≈ 200 s, hay ≈ 10,000 activos a la vez.

:::ojo «Asíncrono» quiere decir dos cosas en la Ronda
En el **código**, async es un hilo que no se bloquea mientras espera. En la **arquitectura**, M02 llama **patrón asíncrono** a otra cosa: la API pone el trabajo en una cola, responde «recibido» de inmediato y unos [[worker|workers]] lo procesan después. C01 es síncrono en su arquitectura (Ana espera su respuesta, a lo más 300 ms) y async en el código de su gateway.
:::

### En el Dojo

La estación 1 copia las fotos que hay que etiquetar: baja cada una de S3, le quita los metadatos y la vuelve a subir. Lo hace con `ThreadPoolExecutor(16)`, 16 hilos a la vez. Funciona a pesar del GIL porque casi todo es esperar a la red, y lo que calcula, Pillow, suelta el GIL.

### Fuera de ML: el navegador

Cada página web corre su JavaScript en un solo hilo con un event loop. Un script que calcula mucho tiempo congela la página: los clics no responden y el navegador puede ofrecer detenerla. Por eso a cualquier tarea que ocupe ese hilo 50 ms o más se le llama *long task* y se vigila. Node.js llevó el mismo modelo a los servidores en 2009.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de capacidad se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] ¿CPU-bound o I/O-bound? (a) Descargar 1,000 fotos de S3. (b) Redimensionar 1,000 fotos que ya están en memoria. (c) Pedirle una respuesta a la API de un LLM. (d) Tokenizar 10,000 textos con un ciclo de Python. (e) Escribir una línea de log por request.
- (a) **I/O-bound**: casi todo es esperar a la red.
- (b) **CPU-bound**: cuentas sobre millones de píxeles.
- (c) **I/O-bound**: tu programa espera segundos; el que calcula es el servidor del LLM.
- (d) **CPU-bound**: un ciclo de Python que no espera nada.
- (e) **I/O-bound**: escribir al disco o a la red. Por eso C01 escribe cada línea a la salida del programa (*stdout*) y otro programa la lleva a S3: la respuesta no espera al log.
? [facil] Un servidor con un solo hilo bloquea mientras espera, y cada request tarda 25 ms. ¿Cuántas atiende por segundo? ¿Y con 4 hilos, si casi todo es espera?
- De una en una: 1 ÷ 0.025 s = **40 por segundo**.
- Con 4 hilos, 4 requests en curso a la vez: 4 × 40 = **160 por segundo**, mientras la CPU alcance. Como casi todo es espera, los hilos sueltan el GIL y se enciman.
? [facil] A un servicio le llegan 200 requests por segundo y cada una tarda 80 ms en promedio. ¿Cuántas hay en vuelo? ¿Y si la latencia sube a 400 ms?
- Little: L = 200 × 0.08 s = **16** en vuelo.
- Con 400 ms: 200 × 0.4 = **80**. Cinco veces la latencia son cinco veces los hilos, las conexiones y la memoria.
? [facil] Una ruta `async def` hace `time.sleep(1)` y llegan 5 requests al mismo tiempo. ¿Cuándo termina la última? ¿Y si fuera `await asyncio.sleep(1)`?
- `time.sleep(1)` bloquea el loop: las 5 se atienden en fila, y la última termina a los **5 s**.
- `await asyncio.sleep(1)` suelta el turno: las 5 esperas se enciman, y todas terminan a los **≈ 1 s**.
? [medio] Un script de Python puro procesa 4 archivos, y cada uno pide 2 s de CPU. ¿Cuánto tarda con 1 hilo, con 4 hilos y con 4 procesos, en una máquina de 4 núcleos?
- 1 hilo: 4 × 2 s = **8 s**.
- 4 hilos: también **≈ 8 s**. El GIL deja correr Python a un hilo a la vez: los cuatro se turnan el mismo núcleo.
- 4 procesos: **≈ 2 s** más lo que tardan en arrancar, porque cada uno tiene su GIL y su núcleo.
- Si el trabajo fuera esperar a la red, los 4 hilos sí tardarían lo de uno.
? [medio] Un pod de C01 recibe 100 requests por segundo con ≈ 6 ms de CPU cada una. ¿Qué parte de su núcleo usa? Ahora 1 de cada 10 fotos llega de 12 MP sin draft mode y cuesta 60 ms. ¿Y ahora? ¿Desde qué fracción de fotos grandes deja de alcanzar?
- Al principio: 100 × 6 ms = 600 ms de CPU por segundo: **60 %** del núcleo.
- Con 10 % de fotos grandes: 0.9 × 6 + 0.1 × 60 = **11.4 ms** en promedio, y 100 × 11.4 ms = 1.14 s de CPU por segundo: **114 %**. No alcanza: la fila crece sin parar.
- El límite es 10 ms en promedio, porque 100 × 10 ms = 1 s: 6 + f × (60 − 6) = 10, así que f = 4 ÷ 54 ≈ **7.4 %**.
- Arreglos: draft mode, rechazar las fotos demasiado grandes, más pods. El tráfico no subió; subió la CPU por request.
? [medio] Una request necesita features del vendedor (40 ms), la predicción del modelo (90 ms) y un re-ranker (60 ms). ¿Cuánto tarda en serie? ¿Y con `asyncio.gather`, si son independientes? ¿Y si el re-ranker necesita la predicción?
- En serie: 40 + 90 + 60 = **190 ms**.
- Las tres a la vez: lo que tarda la más lenta, **90 ms**.
- Si el re-ranker espera al modelo: las features van en paralelo con la cadena modelo → re-ranker, que suma 90 + 60 = 150. El total es el máximo: max(40, 150) = **150 ms**.
? [medio] Tienes una L4 de 24 GB y un modelo que, con su contexto de CUDA, ocupa 7 GB por proceso. ¿Cuántos workers de uvicorn caben? ¿Por qué no es buena idea, y qué harías?
- Caben 24 ÷ 7 = 3.4, o sea **3 workers**, con 3 GB libres.
- Pero son 3 copias del mismo modelo turnándose la GPU con batch 1: la memoria se triplica y no se arman batches entre ellas.
- Mejor **un solo servidor** con una copia del modelo que reciba la concurrencia y arme batches (Triton, o vLLM si es un LLM), y en el gateway, procesos sin modelo.
? [reto] C01 en el pico de diseño: 500 requests por segundo, 5 pods, 50 ms en promedio, de los que ≈ 10 son la llamada a Triton. Triton se frena y tarda hasta su timeout de 150 ms. (a) ¿Cuántas llamadas a Triton quedan abiertas por pod? (b) ¿Cuántas requests en vuelo por pod, contando todo? (c) ¿Qué hace `MAX_INFLIGHT = 16`? (d) ¿Y si el timeout fuera de 5 s?
- (a) 500 × 0.15 = 75 llamadas abiertas: **15 por pod**.
- (b) Cada request tarda ahora 50 − 10 + 150 = 190 ms. L = 500 × 0.19 = 95: **19 por pod**.
- (c) 19 no cabe en 16: el pod rechaza con un 503 inmediato lo que pasa del tope. Falla rápido, en microsegundos, en vez de encolar trabajo que se va a vencer.
- (d) Con 5 s, 500 × 5 = 2,500 colgadas, ≈ 500 por pod, para respuestas que quien llamó abandonó a los 300 ms; sin el tope, se acaba la memoria. Por eso cada salto lleva timeout, y el gateway, tope.
? [reto] En C13 el audio llega en pedazos de 160 ms. Ahora la GPU tarda 180 ms en procesar cada uno, con una `asyncio.Queue()` sin tope en medio. (a) ¿Qué utilización implica? (b) ¿Cuánto atraso hay después de 30 minutos? (c) ¿Desde qué tiempo por pedazo deja de crecer el atraso, y qué regla pondrías mientras tanto?
- (a) 180 ÷ 160 = **1.125**, es decir 112.5 %. Con más de 100 %, la fila no tiene techo.
- (b) En 1,800 s llegan 1,800 ÷ 0.16 = 11,250 pedazos y salen 1,800 ÷ 0.18 = 10,000. Esperan 1,250 × 0.16 s = **200 s: 3 minutos y 20 segundos** de atraso. Es lo mismo que 20 ms de atraso por cada uno de los 10,000 pedazos procesados.
- (c) Deja de crecer cuando cada pedazo se procesa en **menos de 160 ms**, lo que tarda en llegar el siguiente. Mientras tanto, una fila con tope y una regla para cuando no alcanza, como la de la Ronda: saltarse resultados intermedios y, si el atraso pasa de ≈ 2 s, cerrar la sesión para que se reabra en una GPU con lugar.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M02 · Patrones de inferencia** abre con el patrón síncrono y su trampa: un JPEG decodificado dentro de un `async def` frena todo el proceso, health checks incluidos. Después arma el patrón asíncrono con cola y workers, y le aplica Little a los jobs.
- **M03 · Latencia y capacidad** separa latencia, throughput y concurrencia («25 = 500 × 0.05»), usa Little para el tope de requests en vuelo y el pool de conexiones a Triton, y cuenta cómo un threadpool saturado hace explotar el p99.
- **M07 · Servidores de modelos** parte de FastAPI con PyTorch: el modelo dentro de un `async def`, el GIL, `uvicorn --workers 4` y el batching que Triton ya hace en C++.
- También **M05** (un proceso por contenedor), **M06** (escalar por requests en vuelo, con un objetivo que sale de Little) y **M14** (en un LLM, la capacidad se cuenta en respuestas que se generan a la vez).

**En el Dojo:** cuando abra la estación 6, «Código de serving», ahí vas a escribir el gateway de C01 con estas piezas. La estación 7, «Empaquetado», ya mete un gateway y un servidor de modelo en contenedores, cada uno con uvicorn como único proceso.

**En Sensei:** la fase siguiente, «La red y la web», abre lo que aquí fue «esperar a la red»: cómo viaja un mensaje, HTTP y sus códigos (el 503 y el 504), los timeouts y los reintentos. Y «Qué tan rápido y cuánto: latencia y throughput» lleva la Ley de Little a las filas y a la utilización.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
io bloqueo cpu-bound io-bound async event-loop corrutina gil threadpool multiproceso worker ley-little
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué una request del gateway de C01 pasa casi todo su tiempo esperando?
Porque casi todo lo que hace es I/O: recibir la foto y esperar ≈ 10 ms a Triton, además de esperar su turno. La CPU trabaja ≈ 6 a 7 ms, casi todo en el decode.
? ¿Qué hace `await`, y por qué un `await` solo no encima nada?
Marca un punto de espera y le regresa el turno al event loop, que corre otra tarea lista. Para encimar hacen falta varias tareas: `asyncio.gather` o, en un servidor, una por request.
? ¿Qué pasa si decodificas un JPEG dentro de una ruta `async def`?
El loop se detiene mientras dura el decode: nada avanza, ni el health check. El p99 crece con la concurrencia sin que la CPU esté llena. Arreglo: `run_in_threadpool` o `asyncio.to_thread`.
? ¿Por qué en Python los hilos sirven para esperar y no para calcular?
Por el GIL: solo el hilo que lo tiene ejecuta Python. Los que esperan lo sueltan y se enciman; los que calculan Python puro se turnan un núcleo. Pillow o PyTorch, que lo sueltan, sí aprovechan varios hilos.
? ¿Por qué C01 corre un solo worker de uvicorn por pod?
Porque varios workers multiplican la memoria, esconden la CPU de cada proceso, complican las métricas y pueden dejar uno colgado en un pod «sano». La CPU se escala con más pods.
? En el pico de diseño de C01, ¿cuántas requests hay en vuelo? ¿Qué no debes hacer con el p99?
500 × 0.05 s = 25, ≈ 5 por pod. No multipliques la tasa por el p99: Little habla de promedios. El peor caso lo acota el timeout.
:::
