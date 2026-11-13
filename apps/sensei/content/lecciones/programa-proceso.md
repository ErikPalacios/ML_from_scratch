---
titulo: Programa, proceso e hilo
en: Program, process and thread
subtitulo: Qué corre de verdad dentro de una máquina cuando «corre» el gateway o Triton: procesos con su propia memoria, hilos que se turnan los núcleos, señales para pedirles que terminen y los números con los que mueren, como el 137 de un OOMKilled.
pregunta: ¿Qué pasa dentro de la máquina cuando «corre» el gateway de Alba o Triton, y por qué a veces un pod se reinicia solo?
requisitos: camino-completo
---

:::idea
Un programa es un archivo; un proceso es ese programa corriendo, con su propia memoria, su número (PID) y uno o más hilos que el sistema operativo turna en los núcleos de la CPU. Casi todo lo que ves en producción, del [[throughput]] de un servidor a un pod que se reinicia solo, se explica con cómo viven, cómo se avisan y cómo mueren los procesos.
:::

En cualquier sistema de ML en producción vas a leer frases como «el gateway corre en 3 pods», «`uvicorn --workers 4` son 4 procesos» u «OOMKilled (exit code 137)». Parecen jerga, pero cada una describe algo concreto que pasa dentro de una máquina.

Un ejemplo. Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Su servicio corre en dos programas: el *gateway*, que recibe cada foto y la prepara, y Triton, que corre el modelo en la GPU. Un *pod* es la unidad que arranca Kubernetes, el [[orquestacion|orquestador]] de Alba: uno o más [[contenedor|contenedores]] que corren juntos en la misma máquina. Una mañana le pides a Kubernetes la lista de pods de Alba (el comando es `kubectl get pods`) y ves esto:

```text
NAME                      READY   STATUS    RESTARTS     AGE
gateway-6c9f7d8b5-4xkqp   1/1     Running   3 (2m ago)   5h
gateway-6c9f7d8b5-9hd2s   1/1     Running   0            5h
gateway-6c9f7d8b5-tq8wz   1/1     Running   0            5h
triton-7b6d9c4f8-q2m7z    1/1     Running   0            2d
triton-7b6d9c4f8-x5bnc    1/1     Running   0            2d
```

Nadie [[deploy|desplegó]] nada, y uno de los gateways se reinició 3 veces (la columna RESTARTS) en las 5 horas que lleva vivo su pod (AGE), la última hace 2 minutos. En sus *logs*, los mensajes que va dejando el programa sobre lo que hace, no hay un solo error. Al terminar esta lección vas a poder explicar qué se reinició, quién lo mató, por qué no dejó rastro y qué número dejó al morir. Para eso hace falta separar tres palabras que se usan como si fueran lo mismo: programa, proceso e hilo.

## Programa y proceso {Program and process}

Un [[programa]] (*program*) es un archivo, o un grupo de archivos, con instrucciones para una computadora. El gateway de Alba es una carpeta con archivos de Python; Triton, el servidor que corre el modelo en la GPU, es un archivo llamado `tritonserver`. En el disco no hacen nada, como una receta guardada en un cajón.

Un [[proceso]] (*process*) es un programa **corriendo**. Quien lo arranca es el [[kernel]], el corazón del [[sistema-operativo|sistema operativo]] (Windows, macOS o Linux, el de los servidores de Alba): la parte que manda sobre la máquina. Al arrancar un programa, el kernel le arma un lugar para trabajar:

- **Memoria propia.** Un pedazo de la [[ram|RAM]] (la memoria principal, donde viven los datos mientras se usan) que ningún otro proceso puede tocar. Ahí van su código, sus datos y, en el gateway, cada foto mientras se decodifica.
- **Un número: el PID.** El [[pid|PID]] (*process ID*) identifica al proceso mientras vive. Con ese número se le habla; por ejemplo, para pedirle que termine.
- **Al menos un hilo.** Un [[hilo]] (*thread*) es una línea de ejecución: el punto del código por donde va el programa. Todo proceso nace con uno y puede crear más.
- **Archivos abiertos.** Todo lo que lee y escribe, que el kernel maneja igual que a un archivo: sus logs, el puerto por donde le llegan las requests (un número que dice a qué programa de la máquina va cada una; en el gateway, el 8080) y su conexión con Triton.
- **Su entorno.** Las variables de entorno, ajustes que recibe al arrancar (en el gateway, `PREPROCESS_CONCURRENCY=2`: cuántas fotos decodifica a la vez), y el usuario a nombre del cual corre, que decide qué archivos puede tocar.

:::figura programa-proceso-anatomia
El proceso del gateway de Alba, por dentro, con tres de sus hilos. Su memoria es solo suya. Los hilos comparten casi todo; cada uno tiene su propia pila, donde anota en qué va.
:::

Del mismo programa pueden correr muchos procesos a la vez. Si abres dos terminales (las ventanas donde se escriben comandos en vez de usar el mouse) y en cada una corres `python3`, hay dos procesos de un solo programa. El gateway de Alba corre de 3 a 12 copias, según el tráfico, y cada copia es un proceso aparte: una foto que decodifica una copia no existe para las demás.

Este código arranca el mismo programa tres veces. Cada corrida da otros PIDs, así que no los imprime: solo los compara.

```python
import os, subprocess, sys

yo = os.getpid()                         # el PID de este proceso: cambia en cada corrida
hijo = "import os; print(os.getpid(), os.getppid())"   # un programa que dice su PID y el de su padre

pids = []
for vez in (1, 2, 3):                    # el mismo programa, arrancado 3 veces
    salida = subprocess.run([sys.executable, "-c", hijo], capture_output=True, text=True).stdout
    pid, padre = map(int, salida.split())
    pids.append(pid)
    print(f"proceso {vez}: ¿su padre soy yo? {padre == yo} · ¿tiene mi PID? {pid == yo}")

print("¿los tres tienen PIDs distintos?", len(set(pids)) == 3)
```

```salida
proceso 1: ¿su padre soy yo? True · ¿tiene mi PID? False
proceso 2: ¿su padre soy yo? True · ¿tiene mi PID? False
proceso 3: ¿su padre soy yo? True · ¿tiene mi PID? False
¿los tres tienen PIDs distintos? True
```

`subprocess.run` arranca otro programa y espera a que termine; `sys.executable` es el programa de Python que estás usando, y `-c` le pasa el código como texto. Cada vuelta crea un proceso nuevo, con su propio PID, cuyo padre es el proceso que lo arrancó.

:::analogia La receta y la cocina
El programa es la receta escrita. El proceso es cocinarla ahora, en una cocina con su mesa (la memoria), sus ingredientes (los datos) y su número de orden (el PID). Tres cocinas con la misma receta son tres procesos del mismo programa: lo que pase en la mesa de una no toca a las otras. Los hilos son varios cocineros en la misma cocina, que comparten la mesa.

**Dónde se rompe:** una cocina no desaparece al terminar el platillo; un proceso sí. Cuando termina, el kernel recupera toda su memoria en un instante y nada de lo que había en la mesa sobrevive. Por eso lo que importa no se deja solo en la memoria de un proceso: un pod puede desaparecer en cualquier momento, y con él, todo lo que tenía.
:::

### El PID, el padre y el PID 1

El kernel reparte los PIDs en orden; al llegar al tope vuelve a empezar desde abajo y reusa los de procesos que ya terminaron. Todo proceso tiene un padre, el que lo arrancó, y conoce su número (el PPID, *parent process ID*). Así, los procesos forman un árbol, como uno genealógico. En la raíz está el **PID 1**, el primer proceso que arranca la máquina: en Linux suele ser `systemd`; en una Mac, `launchd`. Un contenedor tiene su propia numeración: adentro, el programa principal (el servidor) es el PID 1, aunque por fuera la máquina le dé otro número. Ese lugar tiene reglas especiales con las señales (sección 6).

Para verlos, en una terminal están `ps` y `top`; en una Mac, el Monitor de Actividad; en Windows, el Administrador de tareas. En la laptop donde se escribió esta lección (una Apple M4 con 10 [[nucleo|núcleos]]) corrían ≈ 440 procesos con ≈ 2,800 hilos.

:::profundo Cómo nace un proceso: fork y exec
En Linux y en macOS, un proceso nuevo nace en dos pasos. Primero, el padre se copia a sí mismo con `fork`: sale un hijo idéntico, con otro PID. Después, el hijo cambia su programa por otro con `exec`: carga el archivo nuevo y empieza desde su primera instrucción, con el mismo PID. Así arranca cada comando que escribes en la terminal. La copia de `fork` es barata, porque la memoria no se copia de verdad hasta que uno de los dos la cambia (*copy-on-write*, «copiar al escribir»). Windows lo hace en un solo paso, con `CreateProcess`.
:::

## Compilar o interpretar {Compiling or interpreting}

La CPU no entiende Python ni C++, dos lenguajes de programación. Entiende **instrucciones de máquina**: números que codifican órdenes muy simples, como «suma estos dos números», «trae este dato de la memoria» o «salta a otra instrucción si esto es cero». Cada familia de procesadores tiene su propio juego de instrucciones, su [[arquitectura-cpu|arquitectura]]: x86-64 en los Intel y AMD de la mayoría de los servidores (como las máquinas c6i de AWS donde corre el gateway), y arm64 en las Mac con chip M, en los teléfonos y en los procesadores Graviton de AWS.

Hay dos formas de llevar un programa, escrito por una persona, hasta esas instrucciones.

### Compilar: traducir antes de correr

[[compilar|Compilar]] (*compile*) es traducir el programa completo a instrucciones de máquina **antes** de correrlo, una sola vez, con otro programa llamado compilador. Lo que sale es un [[binario-ejecutable|binario ejecutable]]: un archivo de instrucciones que el kernel puede cargar y arrancar directo. Se le dice binario porque no es texto para personas, sino los bits que lee la CPU.

Triton está escrito en C++ y se compila al binario `tritonserver`; NVIDIA lo entrega ya compilado en su imagen de contenedor (el paquete del que se arranca cada contenedor), y la imagen de Alba se arma encima de ella. Docker y Kubernetes están escritos en Go, otro lenguaje que se compila, y el propio Python, en C: también son binarios.

Un binario sirve para una arquitectura y un sistema operativo. Uno de Linux para x86-64 no corre en un nodo arm64 (un *nodo* es cada máquina donde Kubernetes corre pods), ni uno para arm64 en un nodo x86-64: el contenedor muere con `exec format error`. Suele pasar así: alguien construye la imagen en su Mac con chip M, que es arm64, y la sube a nodos x86-64. «El sistema operativo» lo abre a fondo.

### Interpretar: leer y ejecutar al mismo tiempo

Python, normalmente, no se compila a instrucciones de máquina. Lo corre un [[interprete|intérprete]] (*interpreter*): un programa que lee tu código y lo va ejecutando. El más usado es CPython, el que se instala desde python.org. CPython primero traduce cada archivo `.py` a **bytecode**: instrucciones sencillas inventadas para el propio intérprete, no para la CPU. Después las ejecuta una por una, con un ciclo escrito en C que repite «toma la siguiente instrucción y hazla». Para no traducir de nuevo en cada arranque, guarda el bytecode de los módulos que importa (los archivos que trae con `import`) en una carpeta `__pycache__`, si puede escribir ahí. El módulo `dis` te deja ver ese bytecode:

```python
import dis, time

def precio_con_iva(precio):
    return precio * 1.16

dis.dis(precio_con_iva)                  # el bytecode que ejecuta CPython

inicio = time.perf_counter()             # un cronómetro: anota el momento en que empieza
total = 0
for i in range(5_000_000):               # cada vuelta son varias instrucciones de bytecode
    total += i
con_for = time.perf_counter() - inicio

inicio = time.perf_counter()
total_c = sum(range(5_000_000))          # lo mismo, pero el ciclo corre en código de C
con_sum = time.perf_counter() - inicio
print("¿mismo total?", total == total_c, "· ¿sum() terminó antes?", con_sum < con_for)
```

```salida
  3           RESUME                   0

  4           LOAD_FAST_BORROW         0 (precio)
              LOAD_CONST               0 (1.16)
              BINARY_OP                5 (*)
              RETURN_VALUE
¿mismo total? True · ¿sum() terminó antes? True
```

`RESUME` marca que empieza la función, `LOAD_FAST_BORROW` trae la variable `precio`, `LOAD_CONST` trae el 1.16, `BINARY_OP 5` multiplica y `RETURN_VALUE` regresa el resultado. Los números de la izquierda son las líneas del archivo: la 3 es el `def` y la 4, el `return`. Es la salida de Python 3.14: en otra versión, algunos nombres cambian. La última línea compara un `for` de Python con `sum()`, que suma con un ciclo escrito en C.

Ir instrucción por instrucción es el precio de interpretar: por cada instrucción de bytecode, el ciclo del intérprete ejecuta muchas instrucciones de máquina. Un `for` de Python puro suele ser decenas de veces más lento que el mismo ciclo compilado en C. Por eso el trabajo pesado de ML no lo hace Python: lo hacen librerías compiladas, como NumPy, PyTorch y Pillow, a las que Python solo les da órdenes.

Ya puedes responder la primera mitad de la pregunta de la lección. Cuando «corre el gateway», el proceso que existe es `python`, el binario del intérprete, ejecutando el bytecode de uvicorn (el servidor web de Python que recibe las requests) y de `app.py`, el código del gateway. Cuando corre Triton, el proceso es el binario `tritonserver`. En la lista de procesos, nada se llama «gateway».

:::diagrama programa-proceso-arranque
Toca cada caja para ver qué es, o usa «Recorrer» para seguir a Triton, que se compila antes, y al gateway, que se interpreta al correr.
:::

:::profundo Por qué la lista dice `python` y no `uvicorn`
El gateway arranca con el comando `uvicorn app:app`, pero `uvicorn` no es un binario: es un archivo de texto cuya primera línea (`#!` y la [[ruta]] de `python`, su dirección en el disco) le dice al kernel con qué programa abrirlo. Por eso `ps aux` y `docker top` (que lista los procesos de un contenedor) muestran al gateway como `python …/uvicorn app:app`.
:::

:::profundo Compilar mientras corre, y compilar modelos
Desde la 3.13, CPython trae además un *JIT* (*just-in-time*, «justo a tiempo») experimental, apagado por omisión, que traduce partes del bytecode a instrucciones de máquina mientras el programa corre.

La palabra se usa también con modelos. TensorRT, la herramienta de NVIDIA, «compila» el modelo de Alba en un *engine*: un archivo hecho para un tipo de GPU (la T4) y una versión de TensorRT. Si no coinciden, Triton no puede cargarlo y termina al arrancar (sección 8). `torch.compile` hace algo parecido con un modelo de PyTorch, mientras el programa corre.
:::

## Hilos y turnos {Threads and turns}

Un hilo, la línea de ejecución de la sección 1, tiene dos cosas propias: **el punto del código por donde va** y su **pila** (*stack*), una libreta donde anota en qué función está y las variables de esa función. Todo lo demás lo comparte con los otros hilos de su proceso: el resto de la memoria, los archivos abiertos y el PID.

¿Para qué varios hilos? Para hacer varias cosas a la vez sin copiar la memoria. El gateway de Alba tiene un hilo que atiende las requests que llegan y un [[threadpool]] (un grupo fijo de hilos que esperan trabajo) que decodifica fotos, dos a la vez. Triton, por dentro, tiene hilos que reciben requests, hilos que arman los [[batch|batches]] y hilos que corren el modelo.

Este código hace la misma tarea en un hilo y en un proceso hijo. La tarea agrega una foto a una lista:

```python
import threading, multiprocessing

fotos = []                               # una lista en la memoria de este proceso

def decodificar(nombre):
    fotos.append(nombre)                 # escribe en la lista que tiene a la mano

# Sin este if, el hijo volvería a correr lo de abajo: para armarlo, Python vuelve
# a leer este archivo (en Windows, en macOS y, desde Python 3.14, también en Linux).
if __name__ == "__main__":
    hilo = threading.Thread(target=decodificar, args=("tenis.jpg",))
    hilo.start(); hilo.join()            # arranca el hilo y espera a que termine
    print("después del hilo:", fotos)

    hijo = multiprocessing.Process(target=decodificar, args=("botas.jpg",))
    hijo.start(); hijo.join()            # lo mismo, en un proceso aparte
    print("después del proceso hijo:", fotos)
    print("código de salida del hijo:", hijo.exitcode)
```

```salida
después del hilo: ['tenis.jpg']
después del proceso hijo: ['tenis.jpg']
código de salida del hijo: 0
```

El hilo escribió en la misma memoria que el programa principal, y la lista lo muestra. El proceso hijo escribió en **su** copia, y la lista del padre ni se enteró. El código de salida es el número con el que terminó el hijo: 0 quiere decir que todo salió bien (sección 7).

### El planificador reparte los turnos

En una máquina hay muchos más hilos que núcleos. Un [[nucleo|núcleo]] (*core*) es una de las unidades de la CPU que ejecutan instrucciones, y cada uno corre un hilo a la vez (muchos de servidor corren dos: lo verás en «CPU y GPU»). En la laptop de la sección 1 había ≈ 2,800 hilos para 10 núcleos: 280 por núcleo.

Quien decide qué hilo corre en cada núcleo, y por cuánto tiempo, es el **planificador** (*scheduler*) del kernel. Cada hilo está en uno de tres estados:

- **Corriendo:** en un núcleo, ejecutando instrucciones.
- **Listo:** podría correr, y espera su turno.
- **Bloqueado:** espera algo que no es la CPU, como una respuesta por la red, un dato del disco o el final de un `sleep` (una pausa que pide el propio programa). No gasta CPU.

Casi todos los 2,800 hilos estaban bloqueados: esperando una tecla, un mensaje o un reloj.

Cuando el planificador cambia de hilo en un núcleo, hace un [[cambio-contexto|cambio de contexto]] (*context switch*). Guarda el estado del hilo que sale: en qué instrucción iba y los valores que tenía a la mano en sus **registros** (unas cuantas casillas de memoria rapidísima dentro de cada núcleo). Después carga el estado del que entra. Pasa cuando se acaba el turno de un hilo, cuando se bloquea o cuando despierta otro más urgente. Cada cambio toma del orden de microsegundos: es poco, pero miles por segundo se notan.

:::profundo Cuánto cuesta cambiar de hilo
:::cuenta Lo que cuesta cambiar de hilo
Un cambio de contexto // del orden de microsegundos | supuesto | ≈ 3 µs
Supón un núcleo con 1,000 cambios por segundo | 1,000 × 3 µs | 3 ms por segundo
En proporción | 3 ms ÷ 1,000 ms | 0.3 % del núcleo
Con 20,000 cambios por segundo // miles de hilos que despiertan y se duermen | 20,000 × 3 µs | 60 ms: el 6 %
= Cada cambio es diminuto, pero miles por segundo se notan. Además, el hilo que entra encuentra la [[cache-cpu|caché]] (la memoria rapidísima junto a cada núcleo) con los datos del anterior, y llenarla de nuevo puede costar más que el cambio mismo.
:::
:::

### Compartir memoria tiene un precio

Compartir memoria es rápido, pero dos hilos pueden pisarse. Supón que dos hilos cuentan las fotos que procesan en la misma variable, con `contador += 1`. Parece una sola orden, y son tres pasos: leer el contador, sumarle 1 y escribirlo. Si el planificador cambia de hilo a la mitad:

| Paso | Hilo A | Hilo B | El contador queda en |
|---|---|---|---|
| 1 | lee 41 | | 41 |
| 2 | | lee 41 | 41 |
| 3 | escribe 41 + 1 | | 42 |
| 4 | | escribe 41 + 1 | 42 |

Pasaron dos fotos, y el contador subió una. Es una **condición de carrera** (*race condition*): el resultado depende de quién llega primero, y casi nunca falla en las pruebas, porque el cambio de hilo tiene que caer justo entre la lectura y la escritura. La defensa es un **candado** (*lock*): solo el hilo que lo tiene puede tocar el contador, y los demás esperan, bloqueados. En Python, `threading.Lock()`.

Los procesos no tienen ese problema entre ellos, porque no comparten memoria. Lo pagan de otra forma: si necesitan los mismos datos, cada uno carga su copia. La sección extra 5 lo cuenta con un modelo en la GPU.

## Concurrencia y paralelismo {Concurrency and parallelism}

Dos palabras que se confunden mucho, y que vas a oír todo el tiempo:

- **[[concurrencia|Concurrencia]]** (*concurrency*): varias tareas **en curso** al mismo tiempo. Ya empezaron y no han terminado, aunque en cada instante avance solo una.
- **[[paralelismo|Paralelismo]]** (*parallelism*): varias tareas **avanzando en el mismo instante**, cada una en su propio núcleo. Necesita hardware: con un solo núcleo, dos tareas nunca avanzan en el mismo instante.

Rob Pike, uno de los creadores del lenguaje Go, lo resumió en una charla de 2012: la concurrencia es lidiar con muchas cosas a la vez; el paralelismo, hacer muchas cosas a la vez.

### Cuatro fotos, uno o cuatro núcleos

Supón cuatro fotos que piden 40 ms de CPU cada una para decodificarse. Es trabajo de pura CPU: no esperan nada.

:::figura programa-proceso-turnos
Las mismas cuatro fotos de tres maneras. Arriba, un núcleo las hace una tras otra. En medio, un núcleo las turna cada 10 ms, y cada raya es un cambio de contexto. Abajo, cuatro núcleos las hacen al mismo tiempo.
:::

:::cuenta Cuándo sale cada foto, en promedio
Un núcleo, una tras otra | (40 + 80 + 120 + 160) ÷ 4 | 100 ms
Un núcleo, por turnos de 10 ms // concurrencia: A acaba su cuarto turno a los 130 ms, B a los 140… | (130 + 140 + 150 + 160) ÷ 4 | 145 ms
Cuatro núcleos // paralelismo | (40 + 40 + 40 + 40) ÷ 4 | 40 ms
= Con trabajo de pura CPU, turnarse no acelera nada: la última foto sale igual a los 160 ms, y el promedio empeora. Solo más núcleos bajan el tiempo.
:::

### Cuando hay esperas, la concurrencia sí ayuda

Ahora una request del gateway: ≈ 6 ms de CPU para preparar la foto, que llamamos \(c\), y ≈ 10 ms esperando la respuesta de Triton, que llamamos \(w\) (un número redondo: en Alba, ese tramo va de ≈ 5 a 12 ms). Mientras espera, el hilo está bloqueado y el núcleo queda libre. Sola, de principio a fin, una request tarda \(t = c + w\) ms.

:::figura programa-proceso-esperas
Cuatro requests del gateway en un solo núcleo. Arriba, una tras otra: el núcleo pasa casi todo el tiempo esperando. Abajo, concurrentes: mientras una espera a Triton, la siguiente usa la CPU.
:::

Una tras otra, cada request ocupa \(t = c + w\) = 6 + 10 = 16 ms, y la cuarta sale a los 4 × \(t\) = 4 × 16 = 64 ms. Concurrentes, el núcleo prepara una cada \(c\) = 6 ms y cada una sale \(w\) = 10 ms después de terminar su parte de CPU: la request número \(i\) sale a los \(i × c + w\) ms: la primera a los 1 × 6 + 10 = 16 ms, y las otras a los 22, 28 y 34 ms, con el mismo núcleo. Es una idea que vas a encontrar en todo el curso: **la concurrencia aprovecha las esperas; el paralelismo, los núcleos.** [[io|*I/O*]] (de *input/output*, entrada y salida) es todo lo que entra y sale de un programa: la red, el disco. Al trabajo que pasa casi todo el tiempo esperando I/O se le dice [[io-bound|I/O-bound]], y al que pasa casi todo el tiempo calculando, [[cpu-bound|CPU-bound]].

El mismo experimento en Python, con cuatro tareas que esperan y cuatro que calculan, una tras otra y en 4 hilos. Los tiempos cambian según la máquina, así que el código solo imprime cuántas veces más rápido fue con hilos.

```python
import threading, time

def esperar():                           # como esperar la respuesta de Triton: el hilo se bloquea
    time.sleep(0.2)

def calcular():                          # pura CPU, en Python
    total = 0
    for i in range(2_000_000):
        total += i * i

def medir(tarea, en_hilos):              # el mejor de 3 intentos, por si la máquina está ocupada
    mejor = float("inf")
    for _ in range(3):
        inicio = time.perf_counter()
        if en_hilos:
            grupo = [threading.Thread(target=tarea) for _ in range(4)]
            for h in grupo: h.start()
            for h in grupo: h.join()
        else:
            for _ in range(4): tarea()
        mejor = min(mejor, time.perf_counter() - inicio)
    return mejor

for tarea in (esperar, calcular):
    rapidez = medir(tarea, False) / medir(tarea, True)
    print(f"{tarea.__name__:<9} rapidez con 4 hilos: ×{rapidez:.0f}")
```

```salida
esperar   rapidez con 4 hilos: ×4
calcular  rapidez con 4 hilos: ×1
```

Esperar en 4 hilos fue 4 veces más rápido. Calcular, igual que una tras otra, aunque la laptop donde se corrió tiene 10 núcleos. La razón es el [[gil|GIL]] (*global interpreter lock*): un candado de CPython que deja ejecutar Python a un solo hilo a la vez. Un hilo bloqueado lo suelta, por eso esperar no estorba. NumPy, PyTorch y Pillow también lo sueltan en buena parte de su trabajo en C, y por eso los dos hilos del gateway sí decodifican en paralelo. Desde Python 3.13 existe una versión sin GIL (*free-threaded*), todavía opcional; con ella, el segundo número sube. La lección «Hacer varias cosas a la vez» cuenta el GIL a fondo.

¿Cuántas requests por segundo salen, entonces? Hay dos topes, y manda el más bajo. Uno lo ponen las requests en vuelo: cada una ocupa \(t\) ms, así que \(n\) en vuelo dan \(n × 1,000/t\) por segundo (un segundo son 1,000 ms). El otro lo pone la CPU: cada núcleo prepara una request cada \(c\) ms.

:::formula Requests por segundo con n en vuelo
t = c + w
X = min(frac{n × 1,000}{t}, frac{k × 1,000}{c})
T = frac{n × 1,000}{X}
n_{lleno} = frac{k × t}{c}
- c: los ms de CPU de cada request (en el gateway, ≈ 6)
- w: los ms que espera cada request sin usar la CPU (la respuesta de Triton, ≈ 10)
- t: lo que tarda una request sola, de principio a fin, en ms
- n: requests **en vuelo** a la vez: ya empezaron y no han terminado
- k: los núcleos de CPU que puede usar el proceso
- X: requests por segundo que salen: el menor de los dos topes
- T: lo que tarda cada request, en ms, contando lo que espera su turno en la CPU
- n_{lleno}: cuántas en vuelo hacen falta para llenar los núcleos (si sale con decimales, sube al siguiente entero)
:::

:::calculadora programa-proceso-concurrencia
Arranca con una sola request en vuelo: el núcleo pasa 10 de cada 16 ms esperando. Sube las requests en vuelo a 3 y después a 8: ¿qué pasa con las requests por segundo y con lo que tarda cada una?
:::

Con \(n\) = 1 en vuelo, el tope de las requests en vuelo es 1 × 1,000 ÷ 16 = 62.5 requests por segundo, y el de la CPU, \(k × 1,000/c\) = 1 × 1,000 ÷ 6 ≈ 167: manda el más bajo, \(X\) = 62.5. Con 3, el primero daría 3 × 1,000 ÷ 16 = 187.5, pero la CPU no da más de ≈ 167: ahora \(X\) ≈ 167. Para llenar el núcleo bastan \(n_{lleno}\) = 1 × 16 ÷ 6 ≈ 2.7, o sea 3 en vuelo. Con 8 ya no salen más, y las de sobra esperan turno: \(T = n × 1,000/X\) = 8 × 1,000 ÷ 167 ≈ 48 ms en vez de 16. Pasado el tope, solo más núcleos suben el número.

## Procesos o hilos para servir un modelo {Processes or threads to serve a model} [extra]

Un servidor de modelos puede atender varias requests a la vez de dos maneras: con varios hilos dentro de un proceso o con varios procesos. Por fuera se parecen; en memoria cuestan muy distinto.

### `uvicorn --workers`: cada worker es un proceso

Uvicorn tiene la opción `--workers`. Cada [[worker]] es una copia completa del servidor en un proceso aparte, con su propia memoria, y un proceso padre los vigila y reemplaza al que muere. Si la app carga un modelo en la GPU, cada worker carga **su** copia de los pesos y abre su propio contexto de [[cuda|CUDA]] (CUDA es la plataforma de NVIDIA para programar sus GPUs, y el contexto, lo que cada proceso prepara para usarla, que ocupa su propio pedazo de la memoria de la GPU).

Cada worker carga sus pesos y su contexto, así que la memoria de la GPU que usan entre todos es \(M = W × (P + C_{cuda})\): \(W\) workers, cada uno con \(P\) GB de pesos (parámetros × bytes por parámetro) y \(C_{cuda}\) GB de contexto de CUDA.

:::cuenta uvicorn --workers 4 con el modelo en la GPU
Pesos de la ResNet-50 de Alba en FP32, \(P\) // parámetros × 4 B por número FP32 | 24.5 M × 4 B | ≈ 0.1 GB
Contexto de CUDA por proceso, \(C_{cuda}\) // estimación típica: depende de la GPU y de la versión de CUDA | supuesto | ≈ 0.3 a 1 GB
4 workers en una T4 de 16 GB | \(M = W × (P + C_{cuda})\) = 4 × (0.1 + 0.3 a 1 GB) | ≈ 1.6 a 4.4 GB
Pesos de Llama 3 8B en BF16, \(P\) // BF16 usa 2 B por número | 8.03 mil millones × 2 B | ≈ 16.1 GB
2 workers con ese modelo // sin contar el contexto | \(W × P\) = 2 × 16.06 GB | ≈ 32 GB
= Con la ResNet-50, los workers desperdician memoria, pero caben. Con un LLM de 8B, ni dos copias entran en una L4 de 24 GB. Y en los dos casos, cada worker atiende sus requests por su lado: se turnan la GPU sin juntar batches entre ellos.
:::

Por eso Alba sigue una regla: **un proceso por pod, muchos pods**. El escalado lo hace Kubernetes con réplicas, copias del pod. Varios workers dentro de un pod esconden cuánta CPU usa cada proceso, complican las métricas y pueden dejar un pod «sano» con un worker colgado.

### Triton: un proceso con muchas copias adentro

Triton atiende todo desde un solo proceso de C++. Si le pides dos instancias de un modelo en la misma GPU (`instance_group`), son dos copias del modelo dentro de ese proceso, que corren en paralelo en hilos distintos. La excepción es su *backend* de Python, el que corre código de Python para preparar o terminar una predicción: ahí cada instancia es un proceso aparte, justo para que cada una tenga su propio GIL.

### Más hilos o más procesos: una medición

Una medición de ejemplo: una ResNet-50 en la CPU de una laptop, con 4 núcleos, ONNX Runtime (un programa que corre modelos exportados a ONNX, un formato de archivo para modelos), FP32 y una foto por request:

| Configuración | Fotos por segundo | Cada request tarda |
|---|---|---|
| 1 proceso con 4 hilos | ≈ 61 | ≈ 16.5 ms |
| 2 procesos con 2 hilos | ≈ 72 | ≈ 28 ms |
| 4 procesos con 1 hilo | ≈ 86 | ≈ 46 ms |

Con 4 hilos en un proceso, los 4 núcleos trabajan en la **misma** foto, que sale rápido. Con 4 procesos, cada núcleo trabaja en una foto distinta: salen más fotos por segundo, pero cada una tarda casi el triple. Las dos son paralelismo, dentro de una request o entre requests. Cuál conviene lo decide el presupuesto de latencia, cuánto puede tardar cada request: con margen, más procesos; con el presupuesto justo, más hilos por request.

Las cuentas cuadran con fotos por segundo = procesos × 1,000 ÷ ms por foto: un proceso que tarda 46 ms por foto hace 1,000 ÷ 46 ≈ 21.7 fotos por segundo, y cuatro de ellos, 4 × 1,000 ÷ 46 ≈ 87.

### Varios procesos en una GPU

Una GPU también se reparte entre procesos. Con *time-slicing* (repartir el tiempo en rebanadas), la GPU se turna entre ellos, con cambios de contexto y sin garantías de cuánto le toca a cada uno. Con MPS (*Multi-Process Service*, de NVIDIA), los procesos corren a la vez en la GPU, pero un error fatal de uno puede afectar a los demás.

## Señales: avisarle algo a un proceso {Signals: telling a process something}

Un proceso corre a su ritmo, ocupado en lo suyo. ¿Cómo se le pide que termine? Con una [[senal|señal]] (*signal*): un aviso corto, identificado con un número, que el kernel le entrega a un proceso. La puede pedir otro proceso (la terminal, Docker, Kubernetes) o mandarla el propio kernel.

Al recibir una señal, el proceso tiene tres opciones: correr una función suya para atenderla, su **manejador** (*signal handler*); ignorarla, o dejar que pase la acción por omisión, que casi siempre es terminar. Las que vas a ver:

| Señal | Número | Quién la manda | Qué quiere decir | ¿Se puede atender? |
|---|---|---|---|---|
| SIGINT | 2 | La terminal, cuando aprietas Ctrl+C | «Interrumpe lo que haces» | Sí: Python la convierte en `KeyboardInterrupt` |
| SIGTERM | 15 | `kill`, `docker stop`, Kubernetes | «Por favor, termina»: el aviso amable | Sí |
| SIGKILL | 9 | `kill -9`; Docker y Kubernetes al vencer el plazo; el kernel sin memoria | No es un aviso: el kernel quita al proceso de en medio | **No** |
| SIGSEGV | 11 | El kernel, cuando el proceso toca memoria que no es suya | Un error grave de programación (*bug*), casi siempre en código de C o C++ | Se puede, pero casi nunca para seguir |

SIGKILL ni siquiera le llega al proceso: el kernel lo termina sin preguntarle. No corre ningún manejador, no se cierran las conexiones con cuidado y no se escribe nada más. Lo que estaba a medias se pierde. Por eso hay dos: SIGTERM le da al proceso la oportunidad de cerrar bien, y SIGKILL existe para cuando no la aprovecha.

Desde una terminal se mandan con `kill`: `kill 4821` le manda SIGTERM al proceso con PID 4821; `kill -9 4821`, SIGKILL, y `kill -l` lista todas las señales.

Así se ve un manejador de SIGTERM en Python. El programa se manda la señal a sí mismo, como haría Kubernetes. Usa señales de Unix, la familia de sistemas operativos de la que vienen Linux y macOS: corre en esos dos; en Windows, dentro de WSL (el Linux que Windows puede instalar).

```python
import os, signal, sys

def al_recibir_sigterm(numero, marco):   # el manejador: corre al llegar la señal (marco dice dónde iba; no se usa)
    print(f"llegó la señal {numero}: dejo de aceptar trabajo, termino lo que tengo y salgo")
    sys.exit(0)                          # sale con código 0: todo en orden

signal.signal(signal.SIGTERM, al_recibir_sigterm)   # «si llega SIGTERM, corre esta función»
print("SIGINT es", int(signal.SIGINT), "· SIGKILL es", int(signal.SIGKILL), "· SIGTERM es", int(signal.SIGTERM))
os.kill(os.getpid(), signal.SIGTERM)     # me la mando a mí mismo, como haría Kubernetes
print("esto ya no se imprime")
```

```salida
SIGINT es 2 · SIGKILL es 9 · SIGTERM es 15
llegó la señal 15: dejo de aceptar trabajo, termino lo que tengo y salgo
```

Un servidor bien hecho hace eso al recibir SIGTERM: deja de aceptar requests nuevas, termina las que tiene en curso, cierra sus conexiones (la del gateway con Triton, por ejemplo) y sale. Uvicorn y Triton ya lo traen.

### La regla del PID 1

Dentro de un contenedor, el PID 1 tiene una regla especial: el kernel **no** le aplica la acción por omisión, salvo la de un SIGKILL que llegue de fuera del contenedor. Es una protección: si el PID 1 muere, mueren con él todos los procesos del contenedor. Si el PID 1 no tiene un manejador de SIGTERM, la señal se ignora. Por eso el servidor tiene que ser el PID 1 y manejar SIGTERM, o tener delante un *init*: un programa chiquito que hace de PID 1 y le pasa las señales.

En el Dockerfile (la receta con la que se arma la imagen del contenedor), la línea `CMD` dice qué comando arranca el contenedor. Para que el servidor sea el PID 1, se escribe en *forma exec*, como lista: `CMD ["uvicorn", "app:app"]`. En *forma shell*, `CMD uvicorn app:app`, el PID 1 es `/bin/sh`, una *shell*: el programa que lee comandos escritos como texto, el que trabaja detrás de una terminal. Esa shell no le pasa la señal a uvicorn. La sección extra 9 cuenta qué pasa entonces.

### El apagado ordenado, en cuatro pasos

Cada vez que Alba publica una versión nueva o quita un pod que sobra, Kubernetes lo apaga en orden. Quien hace el trabajo en cada máquina es el **kubelet**, el programa de Kubernetes que arranca, vigila y detiene los contenedores de esa máquina.

:::pasos
1. Sale del balanceo
Kubernetes marca el pod como «terminando» y lo saca del reparto de requests entre los pods: ya no le manda nuevas. Tarda unos segundos en enterarse todo el mundo.
2. Una espera: el preStop
Un `sleep` corto que Kubernetes corre dentro del contenedor antes de avisarle (10 s en Triton, 15 s en el gateway), para atender lo que todavía llegue mientras se propaga la baja.
3. SIGTERM
Le llega al PID 1. El servidor deja de aceptar y termina lo que tiene en curso, a lo que se le dice *drenar*: Triton, en hasta 30 s; el gateway, en hasta 20.
4. SIGKILL, si se pasa del plazo
Si sigue vivo al vencer el plazo de gracia, que se cuenta desde el paso 1 (`terminationGracePeriodSeconds`: 30 s si nadie lo cambia; en Alba, 60 para Triton y 45 para el gateway), el kubelet lo mata con SIGKILL.
:::

## Códigos de salida: cómo termina un proceso {Exit codes: how a process ends}

Cuando un proceso termina, le deja a su padre un número de 0 a 255, que cabe en un [[byte]]: su [[codigo-salida|código de salida]] (*exit code*). Es lo que lee la terminal, Docker o el kubelet para saber cómo le fue.

- **0:** todo salió bien.
- **1 a 125:** algo falló, y qué significa cada número lo decide cada programa. Por costumbre, 1 es un error cualquiera (Python sale con 1 si una excepción, su forma de avisar un error, no se atrapa con `try`), y 2, que lo usaron mal.
- **126 y 127:** los pone la shell de la terminal: el archivo no se pudo ejecutar (126) o el comando no existe (127).
- **128 + n:** lo mató la señal n. 130 es Ctrl+C; 137, SIGKILL; 139, SIGSEGV, y 143, SIGTERM. Es una convención: casi ningún programa sale con esos números por su cuenta.

:::figura programa-proceso-salida
Los 256 códigos de salida posibles. La mitad de arriba es de las señales: 137 es 128 + 9. En bits, el primero dice «lo mató una señal» y los otros siete dicen cuál.
:::

:::cuenta Leer un código de salida mayor que 128
Kubernetes dice | Exit Code | 137
Le quitas 128 | 137 − 128 | 9
La señal 9 | `kill -l 9` | SIGKILL
Otro: 143 | 143 − 128 | 15: SIGTERM
Otro: 130 | 130 − 128 | 2: SIGINT
= 137 quiere decir «lo mataron con SIGKILL», no «falló tu código». Quién lo mató se averigua aparte: el kernel por falta de memoria, o el kubelet al vencer un plazo.
:::

El código cabe en un byte, así que da la vuelta, como el [[overflow]] de un uint8 que viste en «Cómo guarda números una computadora»: `sys.exit(256)` sale con 0, y `sys.exit(300)`, con 44 (300 − 256). Por eso los programas usan solo del 0 al 255.

:::profundo Compruébalo en Python y en la terminal
Este código arranca seis programas cortos que terminan de seis maneras distintas y lee el código de cada uno. También usa señales de Unix.

```python
import subprocess, sys

matar = "import os, signal, time; os.kill(os.getpid(), signal.{}); time.sleep(1)"
casos = [
    ("termina bien", "x = 1 + 1"),
    ("excepción sin atrapar", "1 / 0"),
    ("sys.exit(3)", "import sys; sys.exit(3)"),
    ("Ctrl+C (SIGINT)", matar.format("SIGINT")),
    ("SIGTERM sin manejador", matar.format("SIGTERM")),
    ("SIGKILL", matar.format("SIGKILL")),
]
for nombre, codigo in casos:
    rc = subprocess.run([sys.executable, "-c", codigo], capture_output=True).returncode
    terminal = 128 - rc if rc < 0 else rc   # Python da −n si lo mató la señal n; la terminal, 128 + n
    print(f"{nombre:<22} Python: {rc:>3} · terminal: {terminal}")
```

```salida
termina bien           Python:   0 · terminal: 0
excepción sin atrapar  Python:   1 · terminal: 1
sys.exit(3)            Python:   3 · terminal: 3
Ctrl+C (SIGINT)        Python:  -2 · terminal: 130
SIGTERM sin manejador  Python: -15 · terminal: 143
SIGKILL                Python:  -9 · terminal: 137
```

Python dice −9 donde la terminal dice 137: cuando a un proceso hijo lo mata una señal, `subprocess` da el número de la señal en negativo. La terminal, Docker y Kubernetes usan 128 + n. Fíjate en el Ctrl+C: Python convierte el SIGINT en `KeyboardInterrupt` y, si nadie lo atrapa, sale como si la señal lo hubiera matado, para que la terminal vea el 130.

Para verlo tú, en una terminal de Mac o de Linux, `echo $?` muestra el código del último comando. Pruébalo pidiéndole a `ls` (el comando que lista lo que hay en una carpeta) una carpeta que no existe: da 1 en una Mac y 2 en Linux, porque son dos programas `ls` distintos y cada uno decide sus números. En Docker, `docker ps -a` muestra el código junto a cada contenedor que terminó, como «Exited (137)».
:::

:::profundo Quién decide con el código de salida
Mucho software decide con este número. En la integración continua (CI, el sistema que corre las pruebas cada vez que alguien sube código, como GitHub Actions), un paso que sale con algo distinto de 0 marca el trabajo como fallido. Y en Kubernetes, un *Job*, una tarea que corre y termina, como un reentrenamiento, cuenta como exitoso solo si su proceso sale con 0.
:::

### Cómo se ve en Kubernetes

`kubectl describe pod` (el comando que muestra todo sobre un pod) dice cómo terminó la última vez cada contenedor:

```text
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
```

Las combinaciones que más vas a ver:

- **0:** terminó bien; por ejemplo, después de atender un SIGTERM.
- **1:** el programa falló solo, como una excepción al arrancar.
- **137 con Reason OOMKilled:** se pasó de su memoria (la sección que sigue).
- **137 sin OOMKilled:** alguien le mandó SIGKILL; casi siempre, el kubelet al vencer el plazo de gracia.
- **143:** lo terminó un SIGTERM. Puede ser un apagado limpio (con un *init* delante, uvicorn atiende el aviso, cierra en orden y al final sale como si la señal lo hubiera terminado) o un proceso sin manejador que murió en el acto.

## OOM: cuando se acaba la memoria {OOM: when memory runs out}

La RAM de una máquina tiene un tamaño fijo. Si los procesos piden más, el kernel tiene que liberar memoria como sea. Antes intenta otras salidas, que verás en «Memoria, caché y disco»; en Linux, el último recurso es el **OOM killer** (*out of memory*, sin memoria): elige un proceso, casi siempre el que más usa, y lo mata con SIGKILL. A quedarse sin memoria se le dice [[oom|OOM]].

Tres cosas lo hacen traicionero:

1. **No hay excepción.** El proceso no se entera, porque SIGKILL no se puede atender. No hay *traceback*, el mensaje de Python que dice en qué línea falló.
2. **Se pierden los últimos logs.** Si su salida no va a una pantalla, Python junta los mensajes y los escribe de a muchos; con SIGKILL, lo juntado se pierde, justo las líneas que explicaban qué pasó. Por eso los contenedores de Python llevan `PYTHONUNBUFFERED=1`, que los escribe al instante.
3. **El código es 137**, el mismo de cualquier SIGKILL.

### En un contenedor, el límite es tuyo

Un contenedor tiene su propio tope de memoria: en Kubernetes, el `limits.memory` de cada contenedor. El kernel lo hace cumplir con un [[cgroup]] (su mecanismo para ponerle topes de CPU y memoria a un grupo de procesos). Si el proceso pasa su límite, el kernel lo mata **aunque a la máquina le sobre memoria**. Kubernetes lo reporta como **OOMKilled**, código 137, y lo vuelve a arrancar. En Alba, el contenedor de Triton tiene un límite de 6 GiB de RAM (el modelo vive en la GPU), y el del gateway, de 1 GiB.

### Los PNG gigantes del gateway de Alba

Una foto ocupa mucho más decodificada que en el archivo. En el gateway de Alba, un PNG de 40 megapíxeles llega a ≈ 320 MB (medido): Pillow guarda cada píxel en 4 bytes (40 M × 4 B = 160 MB) y hace copias al enderezar la foto y al convertirla a RGB.

La memoria del proceso en su peor momento es la suma de tres partes: lo que ocupa siempre, los archivos que está recibiendo y las fotos que está decodificando.

:::formula Memoria en el peor momento
M = b + a + f × d
f_{max} = frac{L − b − a}{d}
- L: el límite de memoria del contenedor, en MB
- b: la memoria base del proceso (Python, las librerías y el código), en MB
- a: los archivos de las requests en vuelo, en MB
- d: lo que ocupa cada foto mientras se decodifica, en MB
- f: cuántas fotos se decodifican a la vez
- M: la memoria en el peor momento, en MB. Si pasa de \(L\), OOMKilled
- f_{max}: cuántas fotos caben a la vez: el resultado, redondeado hacia abajo
:::

:::cuenta ¿Cuántos PNG de 40 MP caben a la vez en el gateway?
Límite del contenedor, \(L\) // 1 GiB = 1,024 × 1,024 × 1,024 B | 1,073,741,824 B | ≈ 1,074 MB
Memoria base, \(b\) // Python, las librerías y el código | estimación del equipo de Alba | ≈ 80 MB
Archivos en vuelo, \(a\) // acepta hasta 16 requests a la vez, de hasta 10 MB cada una | 16 × 10 MB | 160 MB
Cada foto decodificándose, \(d\) // un PNG de 40 MP, medido | 40 M × 4 B = 160 MB, más copias | ≈ 320 MB
Lo que queda para decodificar | \(L − b − a\) = 1,074 − 80 − 160 | ≈ 834 MB
Fotos a la vez, \(f_{max}\) | \((L − b − a)/d\) = 834 ÷ 320 | 2.6: caben **2**
Con 2 a la vez, \(M\) // 880 ÷ 1,074 ≈ 82 % del límite | \(M = b + a + f × d\) = 80 + 160 + 2 × 320 | 880 MB
Con 3 a la vez // se pasa por 1,200 − 1,074 ≈ 126 MB | 80 + 160 + 3 × 320 | 1,200 MB: no cabe
= Tres PNG gigantes al mismo tiempo, y el kernel mata al gateway: OOMKilled. Por eso Alba limita a 2 los decodes simultáneos por pod (`PREPROCESS_CONCURRENCY=2`) y rechaza las fotos de más de 40 MP antes de abrirlas.
:::

:::calculadora programa-proceso-oom
Arranca con el gateway de Alba: 2 fotos a la vez, 880 MB, el 82 % del límite. Pon 3 para ver el OOM, o sube el límite a 2048 MiB y mira cuántas caben.
:::

### Lo que no es un OOMKilled

Quedarse sin memoria de la GPU no es un OOMKilled. Si la [[vram|VRAM]] no alcanza, PyTorch lanza una excepción (`CUDA out of memory`) dentro del proceso, que el programa ve y puede atrapar. El pod no se reinicia por eso, a menos que el programa termine.

:::profundo MemoryError tampoco es un OOM
`MemoryError`, un error de Python que suena parecido, es otra cosa. Sale cuando pides memoria y el sistema te dice que no en ese momento, así que el programa se entera y puede seguir:

```python
try:
    enorme = bytearray(10**15)           # pedir 1 PB de un jalón: un millón de GB
except MemoryError:
    print("MemoryError: el sistema dijo que no, y Python se enteró a tiempo")
print("el proceso sigue vivo")
```

```salida
MemoryError: el sistema dijo que no, y Python se enteró a tiempo
el proceso sigue vivo
```

El OOM killer actúa en otro momento. Linux casi siempre dice que sí cuando un proceso pide memoria, y la cuenta llega cuando la usa de verdad; si entonces no alcanza, ya no hay a quién avisarle. Detrás de eso está la memoria virtual, que verás en «Memoria, caché y disco».
:::

### Por qué un pod se reinicia solo

Un pod «se reinicia solo» cuando el proceso principal de su contenedor termina y el kubelet lo vuelve a arrancar en el mismo pod: RESTARTS sube 1. La **liveness probe** es una pregunta que el kubelet le hace al proceso cada pocos segundos, «¿sigues vivo?»; si falla varias veces seguidas (3, si nadie lo cambia), lo reinicia. **CrashLoopBackOff** es el estado de un contenedor que se cae una y otra vez, y que el kubelet reintenta esperando cada vez más: 10 s, 20 s, 40 s… hasta 5 minutos.

| Causa | Quién lo termina | Cómo | Código | Lo que ves |
|---|---|---|---|---|
| Se pasó de memoria | El kernel | SIGKILL | 137 | OOMKilled |
| Falló al arrancar, o una excepción | El propio programa | Sale solo | 1, u otro | Error; si se repite, CrashLoopBackOff |
| Se colgó | El kubelet, porque falló la liveness | SIGTERM y, al vencer el plazo, SIGKILL | 137, o 0 si alcanzó a cerrar | Liveness probe failed |
| Una versión nueva | Kubernetes lo reemplaza: no es un reinicio | SIGTERM y apagado ordenado | 0 | Un pod nuevo, con RESTARTS en 0 |

:::diagrama programa-proceso-reinicio
Toca cada caja para ver qué hace, o usa «Recorrer» para seguir cuatro historias: un OOM, un engine que no carga, un proceso colgado y una versión nueva.
:::

¿Y el gateway de la tabla del principio? Tres reinicios en 5 horas, sin deploys ni errores en los logs. `kubectl describe pod` dice OOMKilled y 137: el kernel lo mató por memoria. Lo que se reinició fue el proceso, no el pod: el kubelet arrancó otro `python` en el mismo pod. No dejó rastro porque SIGKILL no se puede atender: ni excepción ni últimos logs. Como los topes de Alba (2 fotos a la vez, de hasta 40 MP) dejan el peor momento en 880 MB, la primera sospecha es una fuga de memoria (*memory leak*): el proceso guarda cosas que nunca suelta y crece hasta pasar el límite, cada tantas horas. La gráfica de memoria del pod lo distingue: una fuga es una rampa que sube sin parar; un pico de fotos gigantes, un salto.

## El apagado ordenado, segundo a segundo {Graceful shutdown, second by second} [extra]

Cada deploy, y cada vez que el *autoscaler* (la pieza que decide cuántos pods correr según la carga) quita pods, se apagan procesos. Si se apagan mal, cada uno corta las requests que tenía a medias. Con 3 a 12 pods del gateway, cada deploy apaga varios procesos, y eso suma.

:::figura programa-proceso-apagado
El apagado de un pod de Triton y de uno del gateway en Alba, y el que trae Kubernetes si nadie lo cambia. Fíjate en que el plazo se cuenta desde el segundo 0, con el preStop adentro. El SIGKILL llega solo si el proceso sigue vivo al final del plazo.
:::

### ¿Por qué esperar antes del SIGTERM?

Sacar un pod del balanceo no es instantáneo. Kubernetes avisa que el pod está terminando, y cada pieza que reparte tráfico tiene que enterarse y actualizar su lista: kube-proxy, el componente que reparte las requests entre pods dentro del clúster (el grupo de máquinas que maneja Kubernetes), y el ALB, el balanceador de AWS que recibe las requests de afuera. Mientras tanto siguen llegando requests, y si el proceso dejara de aceptar de inmediato, se perderían. El `sleep` del preStop lo mantiene atendiendo mientras la baja se propaga. En el gateway es más largo porque el ALB tarda más que kube-proxy.

El plazo de gracia \(G\) tiene que cubrir tres tramos: \(G = p + D + m\), con \(p\) el preStop, \(D\) el drenado más largo y \(m\) un margen, todo en segundos.

:::cuenta Los plazos de gracia de Alba y de un servicio de LLM
Triton en Alba | \(G = p + D + m\) = 10 + 30 + 20 s | 60 s
Gateway en Alba | 15 + 20 + 10 s | 45 s
vLLM, en un servicio que sirve su propio LLM // \(D\) cubre la respuesta más larga: 1,024 tokens × 50 ms ≈ 51 s | 15 + 60 + 15 s | 90 s
Por omisión // nadie lo cambió | lo que trae Kubernetes | 30 s
= La regla: el plazo de gracia cubre el preStop, el drenado más largo y un margen. El tiempo del preStop cuenta dentro del plazo: si no caben, el SIGKILL llega a media respuesta.
:::

### Forma exec contra forma shell

Así se ve cada forma en un Dockerfile, que lleva un solo `CMD` (si hay dos, cuenta el último):

```dockerfile
# Forma exec: uvicorn es el PID 1 y recibe el SIGTERM
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--timeout-graceful-shutdown", "20"]

# Forma shell: el PID 1 es /bin/sh, que no le pasa el SIGTERM a uvicorn
CMD uvicorn app:app --host 0.0.0.0 --port 8080 --timeout-graceful-shutdown 20
```

Con la forma shell, el SIGTERM se pierde. Uvicorn sigue atendiendo como si nada hasta que, a los 45 s, el SIGKILL corta lo que tenga a medias y el contenedor termina con 137. Cada deploy tarda 45 s por pod y corta requests, sin que nadie vea un error en el código.

Si de verdad necesitas un *script* (un archivo de comandos para la shell) como PID 1, por ejemplo para preparar algo antes de arrancar, hay dos salidas. La sencilla: que su última línea sea `exec uvicorn …`, que cambia el script por uvicorn sin cambiar el PID. La otra, un init mínimo como **tini**: un programa chiquito que se queda como PID 1, le pasa las señales a tu proceso y recoge a los procesos hijos que terminan. Docker lo trae con la opción `--init`.

### Cómo probar que tu apagado funciona

En tu máquina, `docker stop` manda SIGTERM y espera 10 s antes del SIGKILL. Con la forma exec, uvicorn cierra en menos de un segundo. Si `docker stop` tarda los 10 s completos, la señal no llegó.

En Kubernetes, borra un pod con `kubectl delete pod` y mira dos cosas: cuánto tarda en desaparecer y con qué código terminó. Un 0 es un apagado limpio (con tini delante, el de uvicorn sale con 143); un 137, que el plazo se acabó. Y mientras tanto, manda tráfico: si el apagado es bueno, ningún cliente ve un error. Si el SIGKILL corta una request a medias, el balanceador ve la conexión cortada y le contesta al cliente con un error: un 502, en HTTP.

### Un worker a mitad de un trabajo largo

Un worker de una cola, un proceso que toma trabajos de una fila y los hace uno por uno, tiene otro problema: sus trabajos pueden durar minutos. Cuando baja la cola, el autoscaler quita pods de workers sin mirar qué están haciendo. Un worker que procesa un video de 10 minutos recibe SIGTERM a los 15 s de empezar. Si muere, el video vuelve a la cola cuando vence el tiempo que la cola le había dado, y otro worker empieza de cero.

Las tres defensas: un plazo de gracia mayor que el trabajo más largo; un worker que, al recibir SIGTERM, termina lo que tiene y ya no toma otro, y trabajos que se puedan repetir sin hacer daño, porque repetirlos va a pasar de todos modos.

## Errores comunes {Common mistakes}

### 1. El SIGTERM que nunca llega

`CMD` en forma shell, o un script propio como PID 1 sin manejador. El pod espera todo el plazo de gracia y muere con SIGKILL, con requests a medias.

**Cómo evitarlo:** forma exec y un servidor que maneje SIGTERM (uvicorn, Triton); si hace falta un script, que acabe con `exec`, o tini. Pruébalo con `docker stop`: el contenedor debe cerrar en segundos, no esperar los 10 s de Docker.

### 2. Un apagado más largo que el plazo

El preStop más el drenado no caben en `terminationGracePeriodSeconds`, y el SIGKILL llega a media respuesta en cada deploy.

**Cómo evitarlo:** plazo = preStop + drenado + margen, como Triton en Alba (60 = 10 + 30 + 20). En los workers de una cola, un plazo mayor que el trabajo más largo.

### 3. Multiplicar procesos sin contar la memoria

`uvicorn --workers 4` arranca 4 procesos, y si la app carga un modelo en la GPU, cada uno carga su copia de los pesos y su contexto de [[cuda|CUDA]] (lo que cada proceso prepara para usar la GPU). Con un modelo grande, ni dos caben.

**Cómo evitarlo:** un proceso por pod, y más pods. La concurrencia va dentro del proceso: un threadpool, o el batching de Triton.

### 4. Más hilos para más cálculo

Agregar hilos a un cálculo en Python puro no lo acelera (el GIL), y pasar de los núcleos que hay tampoco: solo agrega turnos.

**Cómo evitarlo:** pregunta primero si el trabajo espera o calcula. Si espera, concurrencia. Si calcula, núcleos de verdad: procesos aparte, librerías en C que suelten el GIL o más pods.

### 5. Buscar el traceback de un 137

Un OOMKilled no deja excepción ni último log, así que revisar el código buscando el error es perder el tiempo. Confundirlo con un `CUDA out of memory` (VRAM, una excepción) también.

**Cómo evitarlo:** primero `kubectl describe pod`: Last State, Reason y Exit Code. Si dice OOMKilled, mide la memoria en el pico, no en promedio, y limita lo que crece con la carga: decodes simultáneos, tamaño de los archivos, requests en vuelo.

### 6. Datos compartidos sin candado

Un contador o una lista que tocan varios hilos pierde actualizaciones de vez en cuando, sin ningún error. Las pruebas pasan; en producción, con carga, falla.

**Cómo evitarlo:** un `threading.Lock` alrededor, o que cada hilo trabaje con lo suyo y se junte al final.

### 7. Una liveness que pregunta por otros

Si la liveness del gateway revisa que Triton responda, cuando Triton cae el kubelet reinicia en cascada gateways sanos, que no arreglan nada.

**Cómo evitarlo:** la liveness solo pregunta si el proceso responde. Las dependencias van en la *readiness probe*, la pregunta de «¿le mando tráfico?», que solo saca al pod del balanceo.

## En la vida real {In real life} [extra]

### Alba: un límite de CPU que congela

Cada request de Alba pasa por dos procesos en máquinas distintas: `python` con uvicorn en el gateway (≈ 6 ms de CPU por foto, en un hilo del threadpool) y `tritonserver` en el nodo de la T4. En el pico de diseño llegan 500 requests por segundo a todo el servicio y cada una tarda en promedio ≈ 50 ms, así que hay ≈ 25 en vuelo a la vez. Sale de despejar \(n\) en la fórmula de \(T\) de la sección 4: \(n = X × T/1,000\), con \(X\) = 500 requests por segundo y \(T\) = 50 ms, da 500 × 50 ÷ 1,000 = 25. A esta relación se le llama ley de Little. Con 5 pods del gateway en el pico, unas 25 ÷ 5 = 5 por pod.

Alba no le pone límite de CPU al gateway, y esta es la razón. Con un límite de 1 núcleo, el kernel le da 100 ms de CPU por cada ventana de 100 ms; si el contenedor se los acaba antes, lo congela hasta que empieza la siguiente ventana. Un ejemplo: llegan 4 fotos web grandes a la vez, y 4 hilos las decodifican en paralelo (Alba usa 2, pero la idea es la misma), cada una con 40 ms de CPU.

:::formula Cuándo termina el trabajo con un límite de CPU
Q = k × 100
t_Q = frac{Q}{h}
t_{fin} = 100 + (c − t_Q)
- k: los núcleos de CPU que puede usar el proceso; aquí los fija el límite de CPU del contenedor (puede llevar decimales, como 1.5)
- Q: la cuota: los ms de CPU que le tocan por cada ventana de 100 ms
- h: los hilos que trabajan en paralelo; cada uno gasta 1 ms de CPU por cada ms
- c: los ms de CPU que necesita cada foto
- t_Q: el ms de la ventana en el que se acaba la cuota
- t_{fin}: cuándo termina cada foto, en ms. Vale si \(c\) es mayor que \(t_Q\) y lo que falta cabe en la siguiente ventana; si \(c\) no pasa de \(t_Q\), no se congela y termina en \(c\)
:::

:::cuenta Cuatro hilos contra un límite de 1 núcleo
Cuota por ventana, \(Q\) // límite \(k\) = 1 núcleo | \(Q = k × 100\) = 1 × 100 | 100 ms de CPU
Gasto de \(h\) = 4 hilos // en paralelo, 1 ms de CPU por cada ms cada uno | 4 × 1 ms | 4 ms por ms
Se acaba la cuota, \(t_Q\) | \(t_Q = Q/h\) = 100 ÷ 4 | a los 25 ms
Le falta a cada foto // \(c\) = 40 ms de CPU por foto | \(c − t_Q\) = 40 − 25 | 15 ms
Congelado | del ms 25 al ms 100 | 75 ms sin hacer nada
Terminan, \(t_{fin}\) | \(t_{fin} = 100 + (c − t_Q)\) = 100 + 15 | a los 115 ms
= Cada foto tardó 115 ms en vez de 40, y el uso promedio de CPU se ve bajo. Por eso Alba reserva CPU para el gateway, pero no le pone tope.
:::

Otra historia de Alba: si el engine de TensorRT no coincide con la GPU o con la versión, Triton sale al arrancar (`--exit-on-error=true`) y el pod queda en CrashLoopBackOff sin llegar nunca a estar listo. Es una falla ruidosa a propósito, mejor que un servidor «vivo» que no sabe clasificar. Y como Triton tarda en cargar el engine, una *startupProbe*, la pregunta que el kubelet hace solo mientras el proceso arranca, le da hasta 5 minutos (60 intentos, cada 5 s) antes de que la liveness empiece a contar.

### Un LLM propio: minutos para volver

En un servicio que sirve su propio LLM, como el del ejemplo de los plazos de gracia, reiniciar un pod cuesta minutos: cargar 70 GB de pesos (≈ 70 mil millones de parámetros en [[fp8|FP8]], 1 byte cada uno) y preparar la GPU, con una startupProbe de hasta 15 minutos. Por eso su liveness es conservadora, tarda en darlo por muerto: un reinicio por error sale carísimo. Su apagado le da a vLLM, el programa que sirve el modelo, hasta 60 s para terminar las respuestas en curso.

### Voz a texto en tiempo real: esperar el final de la frase

En un servicio que transcribe voz a texto en tiempo real, un worker no se apaga a media frase. Al recibir la orden, deja de aceptar sesiones y espera el final de la frase en curso de cada una antes de pasarlas a otro worker. Una frase dura como mucho ≈ 20.6 s (20 s de voz más 0.6 s para notar que terminó), y en el peor caso son dos: 2 × 20.6 ≈ 41 s. Por eso su plazo de gracia es de 90 s, el triple del que trae Kubernetes.

### Un mensaje venenoso

Un caso clásico de las colas es el mensaje que provoca un OOM cada vez: un PDF corrupto o una imagen que dispara un bug. El worker que lo toma muere sin excepción, el mensaje vuelve a la cola, otro worker lo toma y muere también. Como el proceso nunca alcanza a anotar el fallo, el único que cuenta los intentos es la cola: tras 5, lo manda a una cola aparte, la DLQ (*dead-letter queue*). Sin ese tope, el mismo mensaje tumbaría workers para siempre, y cada intento volvería a cargar el modelo en la GPU.

### La herramienta de pruebas también es un proceso

Para medir cuánto aguanta su servicio, el equipo de Alba usa Locust, un programa de Python que simula usuarios. Un solo proceso de Python puede saturarse antes que el servicio que mide, porque, por el GIL, no pasa de un núcleo: por eso se corre con `--processes 4`.

### Fuera de ML

Chrome corre los sitios en procesos aparte: si una pestaña se cae, ves el error solo en esa y las demás siguen. Android tiene su propio asesino de memoria: cuando falta, cierra sin aviso las apps que llevan rato en segundo plano, y por eso a veces una app «empieza de cero» al volver a ella. Y cada vez que aprietas Ctrl+C en una terminal, le mandas un SIGINT al programa que corre: si sale, deja un 130.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de requests por segundo y de memoria se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] ¿Programa o proceso? (a) El archivo `tritonserver` dentro de la imagen. (b) Las 3 copias del gateway que atienden requests. (c) `app.py`. (d) El PID 1 dentro del contenedor de Triton.
- (a) **Programa:** un binario ejecutable que espera en el disco.
- (b) **Tres procesos** del mismo programa, cada uno con su memoria y su PID.
- (c) **Programa:** código fuente, texto que el intérprete lee al arrancar.
- (d) **Proceso:** `tritonserver` corriendo, con su PID, sus hilos y su memoria.
? [facil] Explica cada código de salida: 0, 1, 130, 137, 139 y 143.
- **0:** todo bien. **1:** el programa falló solo; por ejemplo, una excepción de Python que nadie atrapó.
- **130** = 128 + 2: SIGINT, alguien apretó Ctrl+C.
- **137** = 128 + 9: SIGKILL. En Kubernetes, un OOMKilled o un plazo de gracia vencido.
- **139** = 128 + 11: SIGSEGV, el proceso tocó memoria que no era suya.
- **143** = 128 + 15: lo terminó un SIGTERM. O no tenía manejador, o lo atendió y al final salió como si la señal lo hubiera terminado, como uvicorn detrás de tini.
? [facil] ¿Concurrencia, paralelismo o los dos? (a) Un cajero que atiende tres filas, un cliente de cada una por turnos. (b) Cuatro hilos que decodifican cuatro fotos con Pillow en una máquina de 4 núcleos. (c) Un hilo del gateway que, mientras espera a Triton, atiende otra request.
- (a) **Concurrencia:** tres filas en curso y un solo cajero, que es como un núcleo.
- (b) **Paralelismo:** cuatro núcleos trabajando en el mismo instante. Como las cuatro tareas están en curso a la vez, también es concurrencia: todo paralelismo lo es.
- (c) **Concurrencia:** aprovecha la espera, no otro núcleo.
? [facil] Un proceso recibe SIGTERM y lo ignora. ¿Qué pasa en Kubernetes si nadie cambió el plazo de gracia? ¿Y si recibe SIGKILL?
- Con SIGTERM ignorado, el kubelet espera los **30 s** del plazo por omisión y después manda SIGKILL. Las requests a medias se cortan, y el contenedor termina con **137**.
- SIGKILL no se puede atender ni ignorar: el kernel lo termina en el acto, también con **137**.
? [medio] Cuatro tareas de 30 ms de CPU cada una en 2 núcleos. (a) Si cada núcleo hace dos, una tras otra, ¿cuándo termina cada una y cuál es el promedio? (b) ¿Y si las cuatro se turnan en los 2 núcleos cada 10 ms?
- (a) Núcleo 1: A de 0 a 30 y C de 30 a 60. Núcleo 2: B de 0 a 30 y D de 30 a 60. Terminan a los 30, 30, 60 y 60 ms. El promedio es la suma de los momentos en que termina cada una, entre cuántas son: (30 + 30 + 60 + 60) ÷ 4 = **45 ms**.
- (b) En cada turno de 10 ms corren dos: A y B de 0 a 10, C y D de 10 a 20, y así. A y B completan sus 30 ms a los **50 ms**; C y D, a los **60 ms**. Promedio: (50 + 50 + 60 + 60) ÷ 4 = **55 ms**.
- La última termina igual a los 60 ms: con trabajo de pura CPU, turnarse no acelera; solo reparte la espera.
? [medio] El gateway gasta 6 ms de CPU y espera 12 ms a Triton por request, en un solo núcleo. ¿Cuántas requests por segundo da con 1 en vuelo? ¿Con 2? ¿Cuántas en vuelo hacen falta para llenar el núcleo?
- Usa las fórmulas de la sección 4, con \(c\) = 6, \(w\) = 12 y \(k\) = 1: \(t = c + w\), \(X = min(n × 1,000/t, k × 1,000/c)\) y \(n_{lleno} = k × t/c\).
- Cada request tarda \(t\) = 6 + 12 = 18 ms. El tope de la CPU es \(k × 1,000/c\) = 1 × 1,000 ÷ 6 ≈ 166.7.
- Con \(n\) = 1: 1 × 1,000 ÷ 18 ≈ 55.6, menos que 166.7, así que \(X\) ≈ **55.6** requests por segundo. La CPU trabaja \(X × c\) = 55.6 × 6 ≈ 333 ms de cada 1,000: ≈ 33 %.
- Con \(n\) = 2: 2 × 1,000 ÷ 18 ≈ **111.1**, todavía abajo del tope.
- Para llenar el núcleo: \(n_{lleno}\) = 1 × 18 ÷ 6 = **3** en vuelo, que dan 3 × 1,000 ÷ 18 ≈ 166.7, justo el tope.
? [medio] Un contenedor con 2 GiB de límite corre un proceso que usa 300 MB de base, sin otros archivos en memoria, y cada PNG de 40 MP ocupa 320 MB al decodificarse. ¿Cuántos decodes caben a la vez? ¿Qué pasa con uno más?
- Usa \(f_{max} = (L − b − a)/d\) y \(M = b + a + f × d\), con \(b\) = 300 MB, \(a\) = 0 (no hay archivos) y \(d\) = 320 MB.
- \(L\) = 2 GiB = 2 × 1,024 × 1,024 × 1,024 B = 2,147,483,648 B ≈ 2,147 MB.
- \(f_{max}\) = (2,147 − 300 − 0) ÷ 320 = 1,847 ÷ 320 ≈ 5.8: caben **5**.
- Con 5: \(M\) = 300 + 0 + 5 × 320 = 1,900 MB; 1,900 ÷ 2,147 ≈ 88 % del límite.
- Con 6: \(M\) = 300 + 0 + 6 × 320 = 2,220 MB, más que 2,147. El kernel mata al proceso: **OOMKilled**, código 137, y el kubelet lo reinicia.
? [medio] Un pod tiene un preStop de 5 s, su servidor tarda hasta 25 s en drenar y nadie cambió el plazo de gracia. ¿Alcanza? ¿Qué cambias?
- Usa \(G = p + D + m\). El plazo por omisión es \(G\) = 30 s, con \(p\) = 5 y \(D\) = 25: \(m\) = 30 − 5 − 25 = **0**, sin margen. Si un día el drenado tarda 26 s, el SIGKILL llega a media respuesta.
- Sube `terminationGracePeriodSeconds` a \(G = p + D + m\) con un margen de, por ejemplo, 10 s: 5 + 25 + 10 = **40 s** o más, como los 45 s del gateway de Alba.
? [reto] Un contenedor tiene un límite de CPU de 1.5 núcleos: 150 ms de CPU por cada ventana de 100 ms, y si se los acaba antes, se congela hasta la siguiente ventana. Llegan 4 fotos a la vez y 4 hilos las decodifican en paralelo, con 40 ms de CPU cada una. ¿Cuándo termina cada foto? ¿Y con un límite de 2 núcleos?
- Usa las fórmulas del límite de CPU: \(Q = k × 100\), \(t_Q = Q/h\) y \(t_{fin} = 100 + (c − t_Q)\), con \(h\) = 4 hilos y \(c\) = 40 ms.
- Con \(k\) = 1.5: \(Q\) = 1.5 × 100 = 150 ms de CPU. Los 4 hilos gastan 4 ms de CPU por cada ms, así que \(t_Q\) = 150 ÷ 4 = **37.5 ms**. Cada foto lleva 37.5 ms; le faltan \(c − t_Q\) = 40 − 37.5 = 2.5 ms.
- El contenedor queda congelado hasta el ms 100. Ahí terminan: \(t_{fin}\) = 100 + 2.5 = **102.5 ms**. Les faltaba 2.5 ÷ 40 ≈ 6 % del trabajo y tardaron 102.5 ÷ 40 ≈ 2.6 veces lo necesario.
- Con \(k\) = 2: \(Q\) = 2 × 100 = 200 ms, y \(t_Q\) = 200 ÷ 4 = 50 ms, más que los \(c\) = 40 ms de cada foto (las cuatro juntas gastan 4 × 40 = 160 ms, menos que 200): cabe. Terminan a los **40 ms**, sin congelarse.
- La lección: el límite de CPU es un precipicio. O no pasa nada, o pagas el resto de la ventana.
? [reto] Cada deploy del gateway tarda 45 s por pod, y durante los deploys los clientes ven errores. Los pods viejos terminan con Exit Code 137, sin OOMKilled, y en sus logs no aparece el mensaje de apagado de uvicorn. ¿Qué pasa? ¿Cómo lo confirmas y cómo lo arreglas?
- 137 sin OOMKilled es un SIGKILL del kubelet: el proceso seguía vivo al vencer el plazo de **45 s**. Eso explica los 45 s por pod.
- Uvicorn sabe apagarse en orden con SIGTERM y no lo hizo: no le llegó. La sospecha principal es un `CMD` en forma shell, con `/bin/sh` como PID 1, que no reenvía la señal.
- Para confirmarlo: `docker top` muestra qué es el PID 1 del contenedor (o, desde adentro, `cat /proc/1/cmdline`, si la imagen no trae `ps`), y `docker stop` en tu máquina tarda los 10 s completos en vez de cerrar al instante.
- El arreglo: `CMD` en forma exec, para que uvicorn sea el PID 1. Si hace falta un script, que acabe con `exec`, o tini. Después, el deploy tarda lo que el preStop y el drenado, y no se corta nada.
:::

## Lo que sigue {What comes next}

En Sensei siguen «Memoria, caché y disco», que abre la RAM donde viven los procesos y la memoria virtual, y «CPU y GPU», que cuenta los núcleos, las vCPU y CUDA. «El sistema operativo» explica el kernel, los cgroups que ponen los límites y cómo un proceso le pide cosas al kernel. «Hacer varias cosas a la vez» sigue con el event loop, el GIL y los threadpools. Más adelante, «Colas y streams» vuelve a los workers y al mensaje venenoso, «Empaquetado con Docker» al PID 1, la forma exec y tini, y «Kubernetes» a las probes, el OOMKilled y el plazo de gracia.

Dos avisos para lo que viene: en las GPUs, *kernel* es otra cosa, una función que corre en la GPU ([[kernel-gpu]]); y *scheduler* también nombra a la pieza de Kubernetes que decide en qué máquina corre cada pod y a la de Triton que junta requests en batches.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
programa proceso hilo pid binario-ejecutable compilar interprete concurrencia paralelismo senal codigo-salida oom cambio-contexto
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuál es la diferencia entre un programa y un proceso?
El programa es un archivo con instrucciones, quieto en el disco. El proceso es ese programa corriendo, con memoria propia, un PID, al menos un hilo y sus archivos abiertos. Del mismo programa corren muchos procesos, como los pods del gateway de Alba.
? Cuando «corre el gateway» de Alba, ¿qué programa está corriendo de verdad?
El binario `python`, el intérprete, que ejecuta el bytecode de uvicorn y de la app. Triton, en cambio, es un binario ya compilado desde C++: `tritonserver`.
? ¿Qué comparten dos hilos del mismo proceso, y qué tiene cada uno?
Comparten la memoria, los archivos abiertos y el PID. Cada uno tiene su lugar en el código y su pila. Por compartir memoria, dos hilos pueden pisarse (una condición de carrera), y por eso existen los candados.
? Si tu trabajo es pura CPU y tienes un solo núcleo, ¿turnarlo en varios hilos lo acelera?
No. La última tarea termina igual y el promedio empeora: cuatro fotos de 40 ms salen en promedio a los 100 ms una tras otra y a los 145 ms por turnos. La concurrencia ayuda cuando hay esperas; con pura CPU, solo ayudan más núcleos.
? ¿Por qué un servidor maneja SIGTERM, y qué pasa si no lo hace?
SIGTERM es el aviso amable para que termine lo que tiene en curso y salga. Sin un manejador, o muere al instante (143) o, si es el PID 1 de un contenedor, la señal se ignora y al vencer el plazo de gracia llega SIGKILL (137). En los dos casos, las requests a medias se cortan.
? ¿Qué te dice un 137 con OOMKilled, y en qué se distingue de un `CUDA out of memory`?
Que el contenedor pasó su límite de RAM y el kernel lo mató con SIGKILL (128 + 9): sin excepción, sin traceback y sin los últimos logs. `CUDA out of memory` es otra cosa: la VRAM de la GPU no alcanzó, y es una excepción dentro del proceso, que el programa ve y puede atrapar.
:::
