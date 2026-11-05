---
titulo: El sistema operativo: Linux, archivos y permisos
en: The operating system: Linux, files and permissions
subtitulo: Qué hace el kernel por cada programa, cómo se ordenan los archivos y quién puede tocarlos, por qué una imagen hecha en una Mac no corre en un servidor y qué es de verdad un contenedor: un proceso con lentes y con límites.
pregunta: ¿Qué es Linux, qué hace el kernel por cada programa y qué es de verdad un contenedor?
requisitos: programa-proceso, memoria, cpu-gpu
---

:::idea
Un programa nunca toca la máquina: le pide todo al kernel, el corazón del sistema operativo, que reparte la CPU y la memoria, guarda los archivos y revisa los permisos. Linux es ese kernel en casi todos los servidores. Y un contenedor no es una máquina aparte: es un proceso normal al que el kernel le enseña solo su pedazo del sistema y le pone límites.
:::

Cuando Ana sube la foto de sus tenis, la atienden dos programas de C01: el gateway, que la decodifica, y Triton, que corre el modelo. En la lección «Programa, proceso e hilo» viste que cada uno es un [[proceso]]: un programa que está corriendo. Los dos viven en máquinas con Linux en la nube, y antes de la primera foto esas máquinas ya respondieron muchas preguntas. ¿Dónde está el archivo del modelo? ¿Quién lo puede leer? ¿Cuánta memoria puede usar el gateway antes de que lo maten? ¿Para qué CPU se compiló cada programa?

Todas las responde el sistema operativo. En la Ronda, M05 lo dice en una frase: «Un contenedor no es una VM: todos los contenedores del nodo comparten el kernel del host». Al terminar esta lección vas a entender cada palabra.

## El sistema operativo y el kernel {The operating system and the kernel}

Mientras lees esto, tu computadora corre cientos de procesos: el navegador, la música, los avisos del correo. Todos comparten unos cuantos [[nucleo|núcleos]] de [[cpu|CPU]], una sola memoria y un solo [[disco]]. Alguien tiene que repartir. Ese alguien es el [[sistema-operativo|sistema operativo]] (*operating system*, OS): Linux, Windows, macOS o Android.

Hace tres trabajos:

- **Reparte.** Le presta la CPU a cada proceso por turnos de milisegundos (cada cambio de turno es un [[cambio-contexto|cambio de contexto]]) y le da a cada uno su pedazo de [[ram|memoria]].
- **Esconde los detalles.** Triton pide «abre /models/classifier/1/model.plan», el archivo de su modelo, sin saber si está en el disco de su máquina, en uno de otra máquina que le llega por la red o en memoria.
- **Protege.** Un proceso no puede, sin permiso, leer la memoria de otro ni abrir un archivo que no le toca.

### El kernel y el espacio de usuario

El corazón del sistema operativo es el [[kernel]] (en español, «núcleo», aunque no tiene nada que ver con los núcleos de la CPU): el único programa que toca el hardware directamente. Todo lo demás vive en el **espacio de usuario** (*user space*): tus programas, Python, las bibliotecas que usan y los comandos como `ls`.

La separación la hace cumplir la propia CPU, que tiene dos modos. En **modo kernel** puede todo: cualquier dirección de memoria, cualquier dispositivo. En **modo usuario**, no. Tu código de Python corre en modo usuario. Si intentara leer memoria que no es suya o hablarle directo al disco, la CPU no lo dejaría: le pasaría el control al kernel, y el kernel mataría el proceso con la señal SIGSEGV. Es el famoso *Segmentation fault*.

:::analogia Una biblioteca de estantería cerrada
En algunas bibliotecas no entras a los estantes: pides el libro en el mostrador, alguien revisa tu credencial y te lo trae. Los programas son los lectores, el kernel es el personal y los estantes son el hardware. Como nadie más entra, nadie desordena ni se lleva lo que no le toca.

**Dónde se rompe:** el personal de la biblioteca espera a que le pidas algo. El kernel, además, te quita la silla: cada pocos milisegundos interrumpe al proceso que usa la CPU para dársela a otro, sin que nadie se lo pida.
:::

### Las llamadas al sistema: la única puerta

Si un programa no puede tocar el hardware, ¿cómo lee un archivo? Se lo pide al kernel con una [[syscall|llamada al sistema]] (*system call*, o *syscall*). La CPU pasa a modo kernel, el kernel revisa que la petición se pueda (¿existe el archivo?, ¿tienes permiso?), hace el trabajo y regresa a modo usuario con el resultado.

Linux tiene más de 300. Estas son las que vas a oír:

| Syscall | Qué le pides al kernel |
|---|---|
| `openat`, `read`, `write`, `close` | Abrir un archivo (`openat` es la versión actual de `open`), leerlo, escribirlo y cerrarlo |
| `mmap` | Ver un archivo como si fuera memoria (el [[mmap]] de la lección de memoria): así se pueden cargar los pesos en safetensors, un formato de archivo para pesos |
| `clone`, `execve` | Crear un proceso nuevo, copia del que lo pide (`clone`), y cambiar su programa por otro (`execve`): así arranca cada comando que escribes |
| `kill` | Mandarle una [[senal\|señal]] a otro proceso |
| `socket`, `connect`, `accept` | Hablar por la red |
| `exit` | Terminar, con un [[codigo-salida\|código de salida]] |

Hasta un `print("hola")` termina en una syscall: `write(1, "hola\n", 5)`, «escribe estos 5 bytes (las 4 letras y `\n`, el salto de línea) en el archivo número 1». El kernel numera los archivos que tiene abiertos cada proceso, y a cada número le dice **descriptor**; el 1 es la salida del programa, lo que ves en la terminal o en los logs. Python no hace la syscall solo: se la encarga a la **biblioteca de C**, unas funciones para pedirle cosas al kernel que usan casi todos los programas (la sección que sigue la presenta).

El diagrama sigue a Triton cuando abre su engine, el modelo de C01 ya convertido por TensorRT para la T4.

:::diagrama sistema-operativo-syscall
Fíjate en que Triton nunca toca el disco: su petición cruza al kernel por una sola puerta, la syscall. Usa «Recorrer» para seguir la lectura del engine y dos maneras de fallar.
:::

Cuando el kernel dice que no, regresa un número de error (*errno*) con un significado fijo. Python lo convierte en una excepción que trae el número y el mensaje. Estos números son los mismos en Linux y en macOS:

| errno | Mensaje | Qué pasó | En Python |
|---|---|---|---|
| 2 | No such file or directory | La ruta no existe | `FileNotFoundError` |
| 13 | Permission denied | No tienes permiso | `PermissionError` |
| 30 | Read-only file system | Esa parte del árbol de archivos solo se puede leer (sección 5) | `OSError` |
| 28 | No space left on device | El disco se llenó | `OSError` |
| 8 | Exec format error | El programa no es para esta CPU | `OSError` |

Los vas a leer en los logs una y otra vez. Esta lección explica de dónde sale cada uno.

:::ojo
El kernel de esta lección no es el [[kernel-gpu|kernel de GPU]] de «CPU y GPU», una función que corre en la GPU, ni el [[filtro]] de una convolución, que en inglés también se llama *kernel*. Y el *kernel* de un notebook de Jupyter (un documento donde corres Python por pedazos, las celdas) es el proceso de Python que las corre. El contexto dice cuál es.
:::

:::profundo Cuántas syscalls hace un print
Cada syscall cuesta poco: de décimas de microsegundo a unos microsegundos, según cuál y según la máquina. Pero un millón pueden sumar segundos. Por eso Python no hace una syscall por cada `write` que le pides: junta lo que escribes en un **buffer**, un pedazo de memoria, y lo manda al kernel cuando se llena. El código cuenta las llamadas reales con una clase que se monta sobre la capa más baja de Python, la que habla con el kernel:

```python
import io, os, tempfile

class Contador(io.FileIO):         # FileIO es la capa más baja: cada write es una syscall
    llamadas = 0
    def write(self, datos):
        Contador.llamadas += 1
        return super().write(datos)

ruta = os.path.join(tempfile.mkdtemp(), "log.txt")
for buffer in (0, 8192):
    Contador.llamadas = 0
    crudo = Contador(ruta, "w")
    f = crudo if buffer == 0 else io.BufferedWriter(crudo, buffer_size=buffer)
    for i in range(1000):
        f.write(b"foto procesada\n")       # 15 bytes por línea
    f.close()
    print(f"buffer de {buffer:>5} bytes: {Contador.llamadas:>5} llamadas a write para {os.path.getsize(ruta):,} bytes")
```

```salida
buffer de     0 bytes:  1000 llamadas a write para 15,000 bytes
buffer de  8192 bytes:     2 llamadas a write para 15,000 bytes
```

El buffer tiene un costo: lo que está ahí todavía no llegó al kernel. Si el proceso muere de golpe, se pierde. Por eso el gateway de C01 arranca con `PYTHONUNBUFFERED=1`, una variable de entorno (un ajuste que el proceso recibe al arrancar) que le pide a Python no usar buffer en lo que imprime: cada línea de log sale al instante, con más syscalls, pero sin perder las últimas líneas cuando el proceso cae.
:::

## Linux y sus distribuciones {Linux and its distributions}

En 1991, Linus Torvalds, un estudiante de 21 años en Helsinki, anunció en un foro de internet que escribía un sistema operativo «solo como pasatiempo». Lo publicó con su código abierto: cualquiera podía leerlo, cambiarlo y usarlo gratis. Hoy [[linux|Linux]] corre en la mayoría de los servidores de internet (el conteo de W3Techs lo encuentra en ≈ 63 % de los sitios web cuyo sistema operativo se conoce, en 2026), en las 500 supercomputadoras más rápidas del mundo (en todas, desde 2017), en cada teléfono Android y en los Jetson, las computadoras chicas con GPU de NVIDIA.

En sentido estricto, Linux es solo el kernel. Lo que se instala es una **distribución** (*distro*): el kernel más un espacio de usuario completo. Ese espacio trae la biblioteca de C, la *shell* (el programa que lee los comandos que escribes en la terminal, la ventana de texto de los programadores), los comandos como `ls` (lista una carpeta) y `cp` (copia archivos) y un **gestor de paquetes**, el programa que instala más programas, como `apt` en Ubuntu y Debian. Hay cientos. Estas son las que vas a ver en ML:

| Distribución | Dónde la vas a ver |
|---|---|
| Ubuntu | Laptops, servidores y la imagen de Triton de C01 (Ubuntu 22.04, la versión de abril de 2022) |
| Debian | La base de las imágenes `python:3.13-slim`, como la del gateway de C01 |
| Alpine | Imágenes diminutas; usa otra biblioteca de C, musl, y para ML no sirve |
| Amazon Linux 2023 | Los nodos con GPU de C01, que arrancan con la AMI acelerada de EKS |
| Bottlerocket | Un sistema mínimo de AWS hecho solo para correr contenedores |
| Jetson Linux (L4T) | Los Jetson; viene en JetPack, el software de NVIDIA para esos equipos, y en JetPack 6.2 está basado en Ubuntu 22.04 |

Unas palabras de la tabla. Una **imagen** es el paquete de archivos del que nace un [[contenedor]]. Un **nodo** es cada máquina donde Kubernetes, el [[orquestacion|orquestador]] de C01, corre contenedores. Y una AMI (*Amazon Machine Image*) es la imagen de disco con la que arranca una máquina de AWS; la de EKS, el Kubernetes de AWS, ya trae lo necesario para la GPU.

### La biblioteca de C: la que hace las syscalls

Casi ningún programa hace syscalls a mano. Usa la **biblioteca de C** (*C library*; está escrita en C, el lenguaje de Linux), que trae funciones como `open()` y, por dentro, hace las syscalls. La de casi todas las distribuciones es **glibc**; Alpine usa **musl**, más chica. Hacen lo mismo, pero un programa [[compilar|compilado]] contra una no siempre corre con la otra. Por eso Alpine no sirve para ML: torch y buena parte de las librerías de ML publican sus versiones compiladas para glibc y no para musl (M05).

### Por qué una imagen de Ubuntu corre en un nodo de Amazon Linux

Linux tiene una regla que Torvalds defiende sin concesiones: un cambio en el kernel no puede romper a los programas que ya funcionan. Cada syscall se pide con un número fijo, y las de hace veinte años siguen ahí, con el mismo número y el mismo comportamiento. Gracias a eso, el espacio de usuario de Ubuntu 22.04 que trae la imagen de Triton habla sin problema con el kernel de Amazon Linux 2023 del nodo. Esa regla es la base de que los contenedores funcionen.

### ¿Y tu Mac?

macOS no es Linux: tiene su propio kernel, igual que Windows. Un contenedor de Linux necesita un kernel Linux, así que Docker Desktop, la app de Docker para Mac y Windows, corre en tu Mac una pequeña **máquina virtual** con Linux, escondida: una computadora simulada por software, con su propio sistema operativo (la sección 7 la explica). En Windows usa WSL 2, que es la misma idea. Cuando haces `docker run` en la Mac, el contenedor corre dentro de esa máquina virtual.

## El sistema de archivos: un árbol desde / {The file system: a tree from /}

Un disco, por dentro, es una fila enorme de bloques de bytes numerados: en «Memoria, caché y disco» viste que son de 512 bytes o de 4 KiB. No tiene nombres ni carpetas. El [[sistema-archivos|sistema de archivos]] (*file system*) es el índice que el sistema operativo escribe en el mismo disco: qué bloques forman cada archivo, cómo se llama, cuánto mide, quién es su dueño y quién puede leerlo. En Linux los más comunes se llaman ext4 y XFS; en la Mac, APFS; en Windows, NTFS.

### Un solo árbol

En Windows, cada disco tiene su letra: C:, D:. En Linux no: todo cuelga de un solo árbol que empieza en la **raíz**, que se escribe `/`. Un disco nuevo no aparece como «D:», sino como una carpeta más del árbol (cómo se pega, en la sección de [[montaje]]).

La dirección de un archivo en el árbol es su [[ruta]] (*path*): las carpetas desde la raíz, separadas por `/`. El engine de C01 vive en `/models/classifier/1/model.plan`: en la carpeta `models` de la raíz, dentro de `classifier`, dentro de `1`.

### Rutas absolutas y relativas

- Una ruta **absoluta** empieza con `/`. Es el camino completo desde la raíz y significa lo mismo desde cualquier lugar.
- Una ruta **relativa** no empieza con `/`. Se lee desde la **carpeta de trabajo** (*working directory*) del proceso: la carpeta donde arrancó, si nadie la cambió después, y la que muestra el comando `pwd`.

Cada proceso tiene la suya y la hereda de quien lo lanzó. El comando `cd` cambia la de la shell (con la syscall `chdir`), y los programas que lances desde ahí arrancan en esa carpeta. En una imagen, la fija la línea `WORKDIR` de su Dockerfile, la receta con la que se arma: el gateway de C01 arranca en `/srv`.

Dos nombres especiales sirven para moverse: `.` es la carpeta donde estás y `..` es la de arriba. Parado en `/opt/tritonserver`, la ruta `../../models/classifier/1/model.plan` sube a `/opt`, sube a `/` y baja hasta el engine. Hay un tercero, `~`, tu carpeta personal, pero ese lo traduce la shell y no el kernel: en Python, `open("~/x")` no lo entiende.

:::figura sistema-operativo-arbol
El árbol del contenedor de Triton en C01. Sigue las dos rutas al engine: la absoluta empieza en / y baja; la relativa, para un proceso parado en /opt/tritonserver, sube dos veces con .. hasta la raíz y después baja por el mismo camino.
:::

Una diferencia que muerde: en Linux, `Model.plan` y `model.plan` son dos archivos distintos. En una Mac con la configuración de fábrica, o en Windows, son el mismo, porque su disco no distingue mayúsculas de minúsculas. Un programa que abre `Model.plan` cuando el archivo se llama `model.plan` funciona en tu Mac y falla en el contenedor.

:::profundo Pruébalo en Python
El código resuelve rutas como lo hace el kernel, para un proceso parado en `/opt/tritonserver`, y revisa si tu disco distingue mayúsculas:

```python
import os, posixpath, tempfile
from pathlib import PurePosixPath

aqui = PurePosixPath("/opt/tritonserver")         # la carpeta de trabajo del proceso
rutas = ("bin/tritonserver", "../../models/classifier/1/model.plan",
         "./config/../labels.json", "/etc/hosts")
for ruta in rutas:
    p = PurePosixPath(ruta)
    completa = p if p.is_absolute() else aqui / p  # una relativa se pega a la carpeta de trabajo
    limpia = posixpath.normpath(completa)          # resuelve los . y los ..
    print(f"{ruta} → {limpia} ({'absoluta' if p.is_absolute() else 'relativa'})")

with tempfile.TemporaryDirectory() as carpeta:     # ¿este disco distingue mayúsculas?
    open(os.path.join(carpeta, "Model.plan"), "w").close()
    print("Creé Model.plan. ¿Existe model.plan?", os.path.exists(os.path.join(carpeta, "model.plan")))
```

```salida
bin/tritonserver → /opt/tritonserver/bin/tritonserver (relativa)
../../models/classifier/1/model.plan → /models/classifier/1/model.plan (relativa)
./config/../labels.json → /opt/tritonserver/labels.json (relativa)
/etc/hosts → /etc/hosts (absoluta)
Creé Model.plan. ¿Existe model.plan? True
```

La última línea depende de dónde lo corras: en una Mac imprime `True`; en Linux, `False`.
:::

### Las carpetas que importan

| Carpeta | Qué guarda |
|---|---|
| `/etc` | La configuración del sistema: `/etc/passwd` (los usuarios), `/etc/hosts` (nombres de máquinas) |
| `/usr` | Los programas y las bibliotecas instaladas: `/usr/bin/python3`, `/usr/lib` |
| `/opt` | Programas que se instalan aparte: `/opt/tritonserver`, o el entorno de Python del gateway (su propia carpeta de librerías) en `/opt/venv` |
| `/home`, `/root` | La carpeta personal de cada usuario, y la de root, el superusuario (sección 4) |
| `/var` | Lo que cambia mientras la máquina corre: los logs (`/var/log`), las imágenes de Docker (`/var/lib/docker`) |
| `/tmp` | Temporales: cualquiera escribe y se puede borrar al reiniciar |
| `/proc` | No está en ningún disco: el kernel lo inventa al vuelo para mostrar los procesos (`/proc/1/status` es el estado del PID 1) y la máquina (`/proc/meminfo`) |
| `/sys` | Lo mismo, para los dispositivos y los límites de cada contenedor (sección 7): `/sys/fs/cgroup` |
| `/dev` | Los dispositivos, como archivos: el disco (`/dev/nvme0n1`), la GPU (`/dev/nvidia0`) y la memoria compartida (`/dev/shm`), donde varios procesos se pasan datos sin copiarlos |

### Casi todo es un archivo

Lo de `/proc` y `/dev` es una idea central de Linux: casi todo se ve como un archivo. La GPU es `/dev/nvidia0`, la memoria libre se lee en `/proc/meminfo` y el límite de memoria de un contenedor, en `/sys/fs/cgroup/memory.max`. A todos se les aplican las mismas syscalls: se abren con `openat` y se usan con `read` y `write` o, para darle órdenes a un dispositivo, con `ioctl`. Por eso, para darle la GPU a un contenedor, el NVIDIA Container Toolkit de «CPU y GPU» le pone en su árbol (le monta, como verás en la sección 5), entre otras cosas, tres archivos: `/dev/nvidia0`, `/dev/nvidiactl` y `/dev/nvidia-uvm` (M05).

### Archivos ocultos

Los nombres que empiezan con punto son **ocultos**: el comando `ls` no los muestra si no le pides `ls -a`. Vas a ver tres muy seguido: `.env` (ajustes del programa, a veces con contraseñas), `.git` (la historia del código, la que guarda Git) y `.dockerignore` (la lista de lo que Docker no debe copiar a la imagen).

:::profundo Atajos: los enlaces simbólicos
Un **enlace simbólico** (*symlink*) es un archivo que solo guarda otra ruta: abrirlo es abrir el archivo de esa ruta. `ls -l` lo marca con una `l` al principio y una flecha hacia su destino. En casi todas las distribuciones de hoy, `/bin` es un enlace a `/usr/bin`.

El `python` de un entorno virtual (una carpeta con su propio juego de librerías, como el `/opt/venv` del gateway) también es un enlace al Python del sistema: en el gateway, `ls -l` muestra `python -> /usr/local/bin/python`. Por eso el Dockerfile del gateway puede armar el entorno en una primera etapa, con las herramientas para instalar, y copiar solo esa carpeta a la imagen final: como las dos etapas parten de la misma imagen de Python, el enlace encuentra a Python en la misma ruta. Si el destino no existe, el enlace queda roto, y abrirlo da «No such file or directory» aunque `ls` lo muestre.
:::

## Permisos y root {Permissions and root}

Linux, como Unix (el sistema de los años setenta en que se inspiró), se hizo para que muchas personas usaran la misma máquina a la vez, así que cada proceso corre **como alguien**. Ese alguien es un usuario, y el kernel no conoce su nombre: conoce un número, el **UID** (*user id*). El archivo `/etc/passwd` traduce nombres a números. Cada usuario pertenece además a uno o más **grupos**, cada uno con su número, el **GID** (*group id*).

Cada archivo guarda sus [[permisos]] (*permissions*): un dueño (un UID), un grupo (un GID) y 9 bits que dicen qué se puede hacer. Hay tres permisos:

- **r** (*read*): leer el archivo.
- **w** (*write*): cambiarlo.
- **x** (*execute*): correrlo como programa.

Y tres juegos de permisos: uno para el **dueño**, otro para su **grupo** y otro para **los demás**. Así se ven con `ls -l`, el comando que lista una carpeta con detalle:

```text
-rwxr-x---  1 app  app  2048 Nov  5 10:12 arrancar.sh
```

Después de los permisos vienen el número de enlaces (por ahora, ignóralo), el dueño (`app`), el grupo (`app`), el tamaño en bytes, la fecha del último cambio y el nombre.

:::figura sistema-operativo-permisos
Los primeros 10 caracteres de ls -l. El primero dice qué es (un guion es un archivo; una d, una carpeta). Después vienen tres juegos de rwx: dueño, grupo y los demás. Cada juego son 3 bits con valores 4, 2 y 1, y su suma es un dígito: 7, 5 y 0.
:::

El kernel revisa un solo juego. Si el proceso es el dueño, el del dueño; si no, pero está en el grupo, el del grupo; si no, el de los demás.

### En una carpeta, x es «entrar»

En una carpeta, las letras cambian de sentido: **r** deja ver los nombres de adentro, **w** deja crear, borrar y renombrar archivos, y **x** deja entrar y pasar a través de ella. Para abrir `/models/classifier/1/model.plan`, el proceso necesita x en `/`, en `/models`, en `/models/classifier` y en `/models/classifier/1`, y r en el archivo. Si a una sola carpeta del camino le falta x, la respuesta es «Permission denied», aunque el archivo diga que cualquiera lo puede leer.

### Los permisos en octal

Cada juego son 3 bits, y 3 bits son un número del 0 al 7: es el [[binario]] de la lección de números, con posiciones que valen 4, 2 y 1. Por eso r vale 4, w vale 2 y x vale 1, y cada juego se escribe con un solo dígito. Con tres dígitos (dueño, grupo y demás) se dice todo; a esa forma se le llama **octal**, base 8, porque cada dígito va del 0 al 7.

:::cuenta rwxr-x--- en octal
Dueño // rwx: los tres bits prendidos | 4 + 2 + 1 | 7
Grupo // r-x: leer y correr, sin cambiar | 4 + 0 + 1 | 5
Los demás // ---: nada | 0 + 0 + 0 | 0
= rwxr-x--- es 750. Para ponerlo: chmod 750 arrancar.sh.
:::

| Octal | Letras | Para qué |
|---|---|---|
| 644 | rw-r--r-- | Un archivo normal: tú lo cambias, los demás lo leen |
| 755 | rwxr-xr-x | Un programa o una carpeta: todos lo usan, solo tú lo cambias |
| 600 | rw------- | Un secreto, como la llave privada de `ssh` (el archivo que prueba quién eres al entrar a otra máquina): `ssh` no la usa si otros pueden leerla |
| 777 | rwxrwxrwx | Cualquiera hace cualquier cosa: casi siempre es un error |

Se cambian con dos comandos. `chmod` cambia los bits: `chmod 640 config.yaml`, o `chmod +x arrancar.sh` para agregar la x. `chown` cambia el dueño y el grupo (`chown app:app archivo`), y eso solo lo puede hacer root, el superusuario (en un momento). En Python son `os.chmod` y `os.chown`. En el código, `0o` marca un número en octal y `0b`, uno en binario:

```python
import os, stat, tempfile

def letras(modo):                      # 0o750 → rwxr-x---: cada dígito son 3 bits
    texto = ""
    for corrimiento in (6, 3, 0):      # dueño, grupo y los demás
        d = (modo >> corrimiento) & 0b111
        texto += ("r" if d & 4 else "-") + ("w" if d & 2 else "-") + ("x" if d & 1 else "-")
    return texto

for modo in (0o755, 0o644, 0o750, 0o600):
    b = f"{modo:09b}"
    print(f"{modo:o} = {b[:3]} {b[3:6]} {b[6:]} = {letras(modo)}")

with tempfile.TemporaryDirectory() as carpeta:
    for nombre, modo in (("main.py", 0o644), ("arrancar.sh", 0o755), ("token.txt", 0o000)):
        ruta = os.path.join(carpeta, nombre)
        with open(ruta, "w") as f:
            f.write("hola\n")
        os.chmod(ruta, modo)                   # la syscall chmod
        print(stat.filemode(os.stat(ruta).st_mode), nombre)
    try:
        open(os.path.join(carpeta, "token.txt")).read()
    except PermissionError as e:
        print("leer token.txt:", e.strerror, f"(errno {e.errno})")
```

```salida
755 = 111 101 101 = rwxr-xr-x
644 = 110 100 100 = rw-r--r--
750 = 111 101 000 = rwxr-x---
600 = 110 000 000 = rw-------
-rw-r--r-- main.py
-rwxr-xr-x arrancar.sh
---------- token.txt
leer token.txt: Permission denied (errno 13)
```

En Linux y en macOS sale igual, salvo como root: root lee el archivo aunque sus permisos digan `---------`. Es lo que sigue.

### Root: el usuario que se salta las reglas

El usuario con UID 0 se llama [[root]] («raíz», aunque no tiene que ver con la carpeta raíz, `/`): el superusuario. Para él, el kernel se salta casi todas las revisiones: lee y cambia cualquier archivo, mata cualquier proceso, monta discos y carga drivers. Para usar ese poder en un solo comando se escribe `sudo` antes: en un Jetson, cambiar el modo de energía es `sudo nvpmodel`, porque toca el hardware (M04).

¿Por qué no correr todo como root? Porque los programas tienen errores. Si alguien encuentra uno que le deje ejecutar su propio código dentro de tu proceso, obtiene **exactamente los permisos de tu proceso**. El gateway de C01 es justo ese riesgo: decodifica fotos que manda cualquiera, y una foto armada para explotar (aprovechar) un error de Pillow, la librería que lee las imágenes, podría tomar el control. La regla se llama **mínimo privilegio**: cada proceso con lo que necesita y nada más.

En un contenedor pesa más de lo que parece. Si la imagen no dice otra cosa, el proceso corre como root, y ese UID 0 es el mismo root del nodo, solo que encerrado y con menos poderes. (Linux puede darle al contenedor su propia numeración de usuarios, con un root que no es el del nodo, pero en Kubernetes eso es estable apenas desde la versión 1.36, de 2026, y hay que pedirlo para cada *pod*, la unidad con la que Kubernetes corre contenedores.) M05 lo resume: quien tome el control del proceso es root dentro del contenedor, «un paso menos para llegar al nodo».

C01 se defiende en dos lugares:

- **En la imagen.** Su Dockerfile da de alta un usuario sin privilegios con `useradd --uid 10001` y lo usa con `USER 10001`. El código se copia con dueño root y solo lectura para ese usuario: el proceso ni siquiera puede modificarse a sí mismo.
- **En Kubernetes.** Con `runAsNonRoot: true`, Kubernetes se niega a arrancar el contenedor si fuera a correr como root. Para revisarlo necesita un número: no abre el `/etc/passwd` de la imagen, así que con `USER app` no sabría si `app` es el 0 y se negaría a arrancar. El archivo de Kubernetes del gateway, su **manifiesto**, fija además `runAsUser: 10001`.

## Montar: discos, volúmenes y solo lectura {Mounting: disks, volumes and read-only}

Si todo cuelga de un solo árbol, ¿dónde aparece un disco nuevo? Donde tú digas. [[montaje|Montar]] (*mount*) es pegar un sistema de archivos completo en una carpeta del árbol, el **punto de montaje**. Desde ese momento, lo que hay en esa carpeta vive en el otro sistema. Ya lo has visto pasar: cuando conectas una memoria USB a una Mac, aparece como una carpeta dentro de `/Volumes`, porque la Mac la montó ahí.

Un ejemplo de servidor: llega un disco [[ssd|SSD]] nuevo, de tipo NVMe (la conexión de los SSD más rápidos), que aparece como `/dev/nvme1n1`. Se formatea con ext4 (formatear es escribirle un sistema de archivos vacío) y se monta en `/data`. Ahora `/data/pesos/model.safetensors` está en el disco nuevo, y `/data` es solo la puerta. El comando `df -h` lista lo montado, con el espacio que queda en cada uno.

Lo que se monta no siempre es un disco:

- **Un disco de red**, como el EFS (*Elastic File System*) de AWS: los bytes viajan por la red, pero el programa abre los archivos como si fueran locales.
- **Un pedazo de memoria** (*tmpfs*): `/dev/shm` vive en la RAM, así que lo que escribes ahí ocupa memoria, no disco.
- **Un sistema inventado**: `/proc` y `/sys`, que el kernel arma al vuelo.
- **Otra carpeta** (*bind mount*): la misma carpeta, vista desde otro lugar del árbol. Así le pasa Docker una carpeta de tu máquina a un contenedor.

### Solo lectura

Cada montaje es de lectura y escritura (*rw*) o de **solo lectura** (*ro*). En uno de solo lectura, el kernel rechaza cualquier escritura con el error 30, «Read-only file system». Suena a limitación, pero protege: ni un bug ni un atacante pueden cambiar lo que está ahí, y muchos procesos comparten la misma copia sin pisarse. M05 lo propone para los pesos de un modelo grande: bajarlos una vez a un disco compartido que muchos pods montan en solo lectura. Kubernetes puede montar así hasta la raíz del contenedor, con `readOnlyRootFilesystem: true`, y el gateway de C01 lo hace: no necesita escribir nada. Solo le deja escribible `/tmp`, una carpeta vacía de 64 MiB montada aparte (un `emptyDir`, en la tabla de abajo), por si alguna librería necesita temporales.

### El árbol de un contenedor, armado con montajes

El árbol propio de un contenedor se arma montando:

1. **La imagen, como raíz.** Una imagen es una pila de **capas** de archivos de solo lectura: cada paso del Dockerfile que cambia archivos agrega una capa con lo que cambió. Linux las apila con un sistema de archivos hecho para eso, *overlayfs*, y el contenedor las ve como un solo `/`. Encima va una capa vacía de lectura y escritura, la del contenedor, que **se borra con él**.
2. **Lo que llega de afuera, en su carpeta.** A lo que se monta así, desde fuera de la imagen, se le llama **volumen** (*volume*). En Docker, `docker run -v /pesos:/models:ro` monta la carpeta `/pesos` de la máquina en `/models`, en solo lectura. En Kubernetes son dos piezas: `volumes` dice qué se monta y `volumeMounts` dice dónde, con `readOnly: true` para solo lectura.

| Qué se monta | Para qué | En la Ronda |
|---|---|---|
| Un Secret o un ConfigMap (dos objetos de Kubernetes) | Contraseñas y configuración, como archivos | M15 prefiere un secreto montado como archivo a uno guardado en la imagen |
| `emptyDir` | Una carpeta vacía que dura lo que dura el pod, en el disco del nodo o en memoria | C10, el caso del LLM, copia ahí sus 70.6 GB de pesos, sobre el disco NVMe del nodo |
| `/dev/shm` en memoria | Memoria compartida entre procesos | Docker trae 64 MiB; C01 le da 1 GiB a Triton y C10, 16 GiB a vLLM, el programa que sirve su LLM |
| Un disco persistente | Datos que sobreviven al pod | Casi nunca en serving: el modelo no cambia |

Lo importante: lo que un contenedor escribe fuera de un volumen se pierde cuando el contenedor se reemplaza, y en Kubernetes cada reinicio crea un contenedor nuevo, con su capa escribible vacía. Un log o un modelo descargado en la capa del contenedor no sobrevive. Ese error está en «Errores comunes».

## Arquitectura de CPU: x86-64 y ARM64 {CPU architecture: x86-64 and ARM64}

Una CPU solo entiende un idioma: su **juego de instrucciones** (*instruction set*), la lista de operaciones que sabe hacer (sumar, comparar, saltar a otra parte del programa, leer memoria) con el código en bytes de cada una. Un [[binario-ejecutable|programa compilado]] es una fila de esas instrucciones. La [[arquitectura-cpu|arquitectura de la CPU]] dice qué idioma habla.

Dos familias dominan:

| Arquitectura | Otros nombres | Dónde está |
|---|---|---|
| x86-64 | amd64, x64 | La mayoría de los servidores de la nube (como las g4dn de Triton y las c6i del gateway en C01), las PC con Windows y las Mac con chip Intel |
| ARM64 | aarch64, arm64 | Las Mac con Apple Silicon, los chips M de Apple (desde 2020), los Graviton de AWS (más de la mitad de la CPU nueva que instala AWS cada año desde 2023, según AWS), los Jetson y casi todos los teléfonos |

x86-64 lo diseñó AMD como la versión de 64 bits del x86 de Intel (una CPU de 64 bits maneja números y direcciones de memoria de 64 bits); por eso también se llama amd64, aunque hoy lo usan las dos. El mismo programa, compilado para cada familia, queda escrito en bytes distintos. En la figura, cada byte va en **hexadecimal**: dos símbolos, del 0 al 9 y de la A (10) a la F (15).

:::figura sistema-operativo-instruccion
Arriba, la misma orden, «regresa de esta función», en los dos idiomas: un byte en x86-64 y cuatro en ARM64. Abajo, la cabecera (los primeros bytes) de un ejecutable de Linux, que el kernel lee antes de correrlo: los bytes 18 y 19 dicen para qué CPU se compiló.
:::

### «exec format error»

Antes de correr un programa, el kernel lee su **cabecera** (*header*), los primeros bytes del archivo. Un ejecutable de Linux empieza con 4 bytes fijos, `7F 45 4C 46`: una marca y las letras E, L y F, el nombre del formato de los ejecutables de Linux. En los bytes 18 y 19 trae un número que dice para qué CPU se compiló: 62 si es x86-64, 183 si es ARM64. Si no coincide con la CPU de la máquina, el kernel se niega con el error 8: **exec format error**. En un contenedor, el log dice algo como `exec /usr/local/bin/python: exec format error`, y el contenedor muere al arrancar. Un script de arranque (un programa escrito como texto) da el mismo error si le falta su primera línea, la que empieza con `#!` y dice qué intérprete lo corre.

:::profundo Los bytes de la cabecera, uno por uno
En hexadecimal, el primer símbolo de un byte vale 16 veces su número y el segundo, su número: `C3` es 12 × 16 + 3 = 195. Cada letra se guarda como un número (la E es el 69, que es 4 × 16 + 5, o `45`), y por eso Python escribe los 4 bytes del principio como `\x7fELF`. El número de la CPU ocupa dos bytes y va al revés de como lo escribirías: primero el byte que vale menos.

:::cuenta Los bytes 18 y 19, en decimal
Byte 18 en x86-64 // 3E; la E vale 14 | 3 × 16 + 14 | 62
Byte 19 // 00; el segundo byte vale 256 veces su número | 0 × 256 | 0
Número de la CPU | 62 + 0 | 62: x86-64
Byte 18 en ARM64 // B7, con 00 en el byte 19; la B vale 11 | 11 × 16 + 7 | 183: ARM64
= x86-64 trae 3E 00 (62) y ARM64, B7 00 (183). El kernel compara ese número con el de su CPU.
:::

Este código arma los primeros 20 bytes de un ejecutable para cada CPU y hace la misma revisión que el kernel, también con scripts, con y sin su línea `#!`:

```python
import errno, os, struct

def compilado(cpu):                    # los primeros 20 bytes de un ejecutable de Linux
    return b"\x7fELF" + bytes([2, 1, 1]) + bytes(9) + struct.pack("<HH", 3, cpu)

def exec_en(cpu_del_nodo, archivo):    # lo que revisa el kernel antes de correr un archivo
    if archivo[:2] == b"#!":           # un script: corre el intérprete de su primera línea
        return "corre con " + archivo[2:].split(b"\n")[0].decode()
    if archivo[:4] == b"\x7fELF":      # un programa compilado: ¿para esta CPU?
        (cpu,) = struct.unpack_from("<H", archivo, 18)
        if cpu == cpu_del_nodo:
            return "corre"
    return os.strerror(errno.ENOEXEC)

for nombre, archivo in (("ELF para x86-64", compilado(62)), ("ELF para ARM64", compilado(183)),
                        ("script con #!", b"#!/usr/bin/python3\nprint('hola')"), ("script sin #!", b"print('hola')")):
    print(f"{nombre:<16} → en un nodo x86-64: {exec_en(62, archivo)}")
```

```salida
ELF para x86-64  → en un nodo x86-64: corre
ELF para ARM64   → en un nodo x86-64: Exec format error
script con #!    → en un nodo x86-64: corre con /usr/bin/python3
script sin #!    → en un nodo x86-64: Exec format error
```

Tu Mac guarda a veces dos idiomas en un solo archivo: el comando `file`, que dice qué tipo de archivo es uno, responde para `/bin/ls` que es un *universal binary* con dos arquitecturas adentro, x86_64 y arm64e (una variante de ARM64 que usa Apple).
:::

### El código de Python no depende de la CPU; sus librerías, sí

Tu archivo `.py` no depende de la CPU: lo lee el [[interprete|intérprete]]. Pero el intérprete mismo (`python3`) es un programa compilado, y también las partes rápidas de torch, NumPy o Pillow, escritas en C y C++. Por eso pip, el programa que instala librerías de Python, baja una versión distinta para cada **plataforma**: cada combinación de sistema operativo y arquitectura. De los 37 paquetes del gateway de C01, los que traen partes compiladas (NumPy, Pillow y otros) se instalan en versión `manylinux x86_64`, para Linux en x86-64; en ARM64 serían las `aarch64`. Los de puro Python sirven en cualquier CPU.

### Las imágenes tienen plataforma

Una imagen de Docker se construye para una plataforma: `linux/amd64` o `linux/arm64`. La trampa clásica, en M05: construyes en una Mac con Apple Silicon, la imagen sale `linux/arm64`, la subes al **registro** (el almacén de imágenes de donde los nodos las bajan) y los nodos de C01, que son x86-64, no la pueden correr. Hay dos salidas:

- **Construir para la plataforma de los nodos**: en CI (las máquinas que construyen y prueban tu código cada vez que lo subes), con `--platform linux/amd64`.
- **Una imagen multi-arquitectura**: un índice que, bajo un solo *tag* (el nombre de una versión de la imagen, como `3f9c2ab`), apunta a una imagen por plataforma. Cada máquina baja la suya. Si el índice no trae la de tu máquina, la descarga falla con «no match for platform».

Docker Desktop puede correr imágenes amd64 en una Mac con Apple Silicon traduciendo sus instrucciones al vuelo (emulación, con Rosetta o con QEMU), pero más lento: sirve para probar, no para servir.

## Qué es de verdad un contenedor {What a container really is}

En la lección «El camino completo», un [[contenedor]] era un paquete con tu programa y todo lo que necesita, para que corra igual en cualquier máquina. Sigue siendo cierto. Ahora puedes ver qué es para el kernel: **un proceso normal**, como cualquier otro del nodo, al que el kernel le hace tres cosas.

:::pasos
1. Le pone lentes: los namespaces
Un **namespace** (espacio de nombres) decide qué ve el proceso, como unos lentes que solo dejan ver una parte; solo que el proceso no se los puede quitar. Con el de procesos, ve una lista que empieza en él: adentro es el [[pid|PID]] 1, aunque en el nodo tenga otro, digamos el 48,213. Con el de red, tiene su propia dirección en la red y sus propios **puertos**, las puertas numeradas por donde un programa recibe conexiones (el gateway escucha en el 8080; la fase 5 abre la red). Con el de montaje, su propio árbol, que empieza en la imagen. Hay otros para el nombre de la máquina, los usuarios, el reloj, la comunicación entre procesos y el propio árbol de cgroups: ocho en total.
2. Le pone límites: los cgroups
Un [[cgroup]] (*control group*) decide cuánto puede usar: cuánta memoria, cuánta CPU, cuántos procesos. Los *limits* de Kubernetes (el tope que el manifiesto le pone a cada contenedor) y el `--memory` de Docker se vuelven números del cgroup.
3. Le da su árbol: los montajes
Las capas de la imagen como su `/`, la capa escribible encima y los volúmenes en sus carpetas, como viste en la sección de montaje.
:::

Además, le quita poderes. El poder de root está partido en unas 40 **capacidades** (*capabilities*), como cambiar el dueño de un archivo o abrir los puertos menores que 1024, y un contenedor arranca solo con algunas. Y un filtro de syscalls, **seccomp**, le bloquea las más peligrosas: la lista que Docker trae por omisión, su perfil, bloquea unas 44 de las más de 300.

Docker, containerd (el programa que arranca los contenedores en cada nodo) y Kubernetes no tienen magia propia: le piden todo esto al kernel con syscalls. Por eso, desde el nodo, el comando `ps`, que lista los procesos, muestra a Triton como uno más.

:::ojo
Kubernetes también tiene *namespaces*: carpetas para agrupar sus objetos, como `monitoring` o `classifier`. No tienen nada que ver con los del kernel: mismo nombre, otra cosa.
:::

### Un kernel para todos

Todos los contenedores de un nodo comparten **el mismo kernel**: el del nodo, al que la Ronda llama el *host* (la máquina anfitriona). Es la frase de M05 con la que empezó la lección, y tiene consecuencias:

- **La imagen no trae kernel.** Trae el espacio de usuario de una distribución. Triton ve Ubuntu 22.04, pero le habla al kernel de Amazon Linux 2023 de su nodo, el mismo que usa el contenedor de al lado: el *device plugin* de NVIDIA, el programa que le anuncia a Kubernetes la GPU del nodo. El gateway, con su Debian, vive en otras máquinas, sin GPU, y le habla al kernel de la suya.
- **El driver de la GPU lo pone el nodo.** El [[driver]] de NVIDIA tiene una parte que vive dentro del kernel (el módulo `nvidia.ko`: una pieza que se le agrega al kernel ya encendido, hecha para esa versión del kernel), así que no puede ir en la imagen. La imagen trae las librerías de [[cuda|CUDA]]; el nodo, el driver.
- **Aísla menos que una máquina virtual**, que viene en un momento. Si alguien encontrara un error del kernel desde un contenedor, tendría el nodo entero, con todos sus contenedores.

:::diagrama sistema-operativo-nodo
Fíjate en la banda del medio: los dos contenedores, cada uno con su propia vista, terminan en el mismo kernel. Usa «Recorrer» para arrancar Triton, ver qué pasa cuando se pasa de memoria y seguir quién pone el kernel.
:::

### La máquina virtual: un kernel por máquina

Una [[contenedor-vs-vm|máquina virtual]] (VM, *virtual machine*) es otra idea. Un programa llamado **hipervisor** (*hypervisor*) parte una computadora física en varias computadoras simuladas, cada una con sus CPU, su memoria y su disco virtuales. En cada VM arranca un sistema operativo completo, **con su propio kernel**.

:::figura sistema-operativo-capas
Arriba, contenedores: los del docker compose de C01, el archivo que, para probar, levanta juntos en una sola máquina con GPU el gateway, Triton y Prometheus, el programa que junta las métricas. Hay un solo kernel, el de la máquina, y cada contenedor trae solo su espacio de usuario: Debian, Ubuntu o BusyBox, uno mínimo. Abajo, máquinas virtuales: el hipervisor reparte el hardware y cada VM arranca su propio kernel y su sistema completo.
:::

| | Contenedor | Máquina virtual |
|---|---|---|
| Qué es | Un proceso con namespaces y cgroups | Una computadora simulada por un hipervisor |
| Kernel | El del nodo, compartido | Uno propio en cada VM |
| Qué trae su imagen | Un espacio de usuario y tu programa | Un sistema operativo completo y tu programa |
| Arranca en | Menos de un segundo si la imagen ya está en el nodo, más lo que tarde su programa | De segundos a minutos: arranca un sistema entero |
| Memoria de más | Casi nada | La de su kernel y su sistema |
| Qué aísla | Lo que ve y cuánto usa | También el kernel: hay que romper el hipervisor |

Las dos se usan juntas. Cada máquina que rentas en EC2, el servicio de AWS que renta computadoras (le dice *instancia*), **es una VM**, como la g4dn.xlarge de C01: el hipervisor de AWS, Nitro, parte un servidor físico entre clientes, y la T4 se le entrega a la VM directo. Dentro de la VM corre Linux, y dentro de Linux, los contenedores. La VM separa a un cliente de AWS de otro; los contenedores, los servicios de un mismo equipo.

### El límite de memoria vive en el cgroup

En «Programa, proceso e hilo» hiciste la cuenta del gateway de C01 en su peor momento: ≈ 80 MB de Python, dos PNG gigantes de ≈ 320 MB decodificándose a la vez y 160 MB de requests en vuelo suman 880 MB, el 82 % de su límite de 1 GiB. Ese límite es un número del cgroup del contenedor, en bytes: 1 GiB = 2³⁰ = 1,073,741,824.

Si los procesos del grupo lo pasan, no hay negociación: el kernel mata al proceso con SIGKILL, y Kubernetes lo reporta como `OOMKilled`, con código de salida 137 (128 + 9): el [[oom|OOM]] de esa lección. Y mata solo ahí: los demás contenedores, cada uno en su cgroup, ni se enteran, aunque a la máquina le sobre RAM. La CPU, en cambio, no mata a nadie: un contenedor con límite de CPU que se acaba su parte se queda congelado unos milisegundos (*throttling*). La sección extra que sigue abre los dos límites con números.

## Los límites por dentro: cuotas de CPU y memoria {Limits up close: CPU quotas and memory} [extra]

Un cgroup, como casi todo en Linux, se ve como archivos. Cada contenedor tiene su carpeta en `/sys/fs/cgroup`, y Kubernetes escribe ahí sus *limits*. Así se ven desde adentro de un contenedor en Linux, con `cat`, el comando que imprime lo que tiene un archivo. Es una ilustración: en tu Mac esos archivos no existen, y la ventana y el congelamiento se explican en un momento.

```bash
cat /sys/fs/cgroup/memory.max      # 1073741824: el límite de 1Gi, en bytes
cat /sys/fs/cgroup/memory.current  # lo que usa ahora, en bytes
cat /sys/fs/cgroup/cpu.max         # «max 100000»: sin límite de CPU; ventana de 100,000 µs
cat /sys/fs/cgroup/cpu.stat        # nr_throttled: cuántas ventanas lo congelaron
```

### Lo que se reserva y lo que se corta

El manifiesto de cada pod le da a cada contenedor dos números por recurso, en sus partes *requests* y *limits*. Lo que va en *requests* es lo que se **reserva**: Kubernetes solo pone el pod en un nodo donde quede eso libre. Lo que va en *limits* es el **techo**, y termina en el cgroup como `memory.max` y `cpu.max`. La reserva de CPU también llega al cgroup, como un peso (`cpu.weight`) que decide cómo se reparte la CPU cuando no alcanza para todos. En C01, el gateway reserva 1 CPU y 1 GiB, con un techo de memoria de 1 GiB y ninguno de CPU. Cada Triton reserva 2 CPU, 6 GiB y una GPU entera, también con el techo de memoria igual a lo que reserva (M06). Al pasarse del techo, la memoria y la CPU reaccionan muy distinto.

### La memoria: un tope duro

`memory.max` es un tope. Cuando los procesos del grupo llegan a él, el kernel primero intenta liberar lo que no es indispensable, como las copias de archivos que ya leyó (su [[page-cache|page cache]]). Si no alcanza, el **OOM killer** (*out of memory*, sin memoria) mata con SIGKILL a un proceso del grupo; en Kubernetes, desde la versión 1.28, a todos los procesos del contenedor de un jalón. No hay excepción que atrapar ni mensaje de despedida: el proceso desaparece. Por eso C01 pone el límite de memoria igual a lo que reserva: si se pasa, el resultado es un `OOMKilled` claro de ese contenedor, en vez de quitarle al resto del nodo memoria que nadie le reservó (M06).

:::calculadora sistema-operativo-memoria
Es la cuenta del gateway de «Programa, proceso e hilo», con el límite tal como lo guarda el cgroup. Sube las decodificaciones a 3 y mira cómo el margen se vuelve negativo; después sube el límite hasta que quepan con margen.
:::

### La CPU: una cuota por ventana

La CPU no tiene tope duro: tiene **cuota**. Un «ms de CPU» es un milisegundo de trabajo de un núcleo: 4 hilos que corren 1 ms en 4 núcleos gastan 4 ms de CPU. Con un límite de 1 CPU, el grupo puede usar 100 ms de CPU en cada ventana de 100 ms, **sumando todos sus hilos**. Con `500m` (500 milésimas de CPU, medio CPU), 50 ms por ventana. Si el grupo se acaba la cuota antes de que termine la ventana, el kernel lo congela hasta la siguiente. Eso es el *throttling*: el proceso no muere, se vuelve lento a ráfagas.

M06 lo cuenta con el gateway (si leíste la sección extra de «Programa, proceso e hilo», ya viste esta cuenta; aquí va con el mecanismo completo):

:::cuenta Cuatro fotos a la vez con un límite de 1 CPU
Cuota por ventana // límite de 1 CPU, ventana de 100 ms | 1 × 100 ms | 100 ms de CPU
CPU que piden las 4 fotos // 40 ms de CPU cada una, un hilo por foto | 4 × 40 ms | 160 ms de CPU
Cuándo se acaba la cuota // 4 hilos gastan 4 ms de CPU por cada ms de reloj | 100 ÷ 4 | a los 25 ms
Congelado | del ms 25 al 100 | 75 ms sin correr
Lo que falta // a cada foto le faltan 40 − 25 = 15 ms de CPU | 4 × 15 ms ÷ 4 hilos | 15 ms más
= Cada foto tarda 100 + 15 = 115 ms en vez de 40. Y una gráfica que promedia el uso de cada minuto ve poca CPU, porque las ráfagas duran milisegundos. Por eso C01 no le pone límite de CPU al gateway ni a Triton: lo que reservan, con su peso en el cgroup, ya les garantiza su parte.
:::

El mismo cálculo, para más fotos a la vez. Supone que llegan justo al empezar una ventana y que el nodo tiene núcleos de sobra:

```python
def tarda(fotos, ms_de_cpu, limite, ventana=100):
    cuota = limite * ventana          # ms de CPU que el cgroup deja usar en cada ventana
    falta = fotos * ms_de_cpu         # ms de CPU que piden entre todas, un hilo por foto
    reloj = 0
    while falta > cuota:              # se acaba la cuota: congeladas hasta la siguiente ventana
        falta -= cuota
        reloj += ventana
    return reloj + falta / fotos      # en la última ventana, los hilos corren a la vez

for fotos in (1, 2, 4, 8):
    t = tarda(fotos, 40, limite=1)
    print(f"{fotos} a la vez, límite de 1 CPU: {t:g} ms cada una ({t / 40:.1f} veces lo normal)")
print(f"8 a la vez, límite de 4 CPU: {tarda(8, 40, limite=4):g} ms cada una")
```

```salida
1 a la vez, límite de 1 CPU: 40 ms cada una (1.0 veces lo normal)
2 a la vez, límite de 1 CPU: 40 ms cada una (1.0 veces lo normal)
4 a la vez, límite de 1 CPU: 115 ms cada una (2.9 veces lo normal)
8 a la vez, límite de 1 CPU: 302.5 ms cada una (7.6 veces lo normal)
8 a la vez, límite de 4 CPU: 40 ms cada una
```

:::calculadora sistema-operativo-cuota
Prueba 8 fotos con límite de 1 y luego sube el límite hasta que cada foto vuelva a tardar 40 ms.
:::

Resuélvelo con lápiz y compruébalo con la calculadora:

:::ejercicios
? [medio] Un pod tiene un límite de 2 CPU. Llegan 8 fotos a la vez, cada una con 40 ms de CPU y su propio hilo. ¿Cuánto tarda cada una? ¿Y sin límite, con 8 núcleos libres?
- Cuota: 2 × 100 = 200 ms de CPU por ventana. Piden 8 × 40 = 320 ms.
- 8 hilos gastan 8 ms de CPU por ms: la cuota se acaba a los 200 ÷ 8 = 25 ms y quedan 120 ms de CPU.
- Congeladas hasta el ms 100; luego 120 ÷ 8 = 15 ms más. **115 ms** cada una.
- Sin límite: **40 ms**. Con un límite de 4 CPU, la cuota de 400 ms alcanza y también serían 40.
:::

:::nota El nombre CFS
La Ronda llama a esta cuota «la de CFS», el planificador de Linux que la introdujo. Desde la versión 6.6 del kernel (2023) el planificador es otro (EEVDF), pero la cuota funciona igual y las métricas siguen diciendo `cfs`.
:::

### El contenedor no sabe cuántas CPU tiene

Un detalle que muerde: dentro de un contenedor, `os.cpu_count()` de Python, y muchas librerías, cuentan los núcleos **del nodo**, no la cuota del cgroup. En un nodo de 64 núcleos con un límite de 4 CPU, una librería que arma un hilo por núcleo lanza 64 hilos a pelear por 4 CPU de cuota: throttling y un [[p99]] peor. M08 lo pregunta con ONNX Runtime, un programa para correr modelos que se usa mucho en CPU, y la respuesta es fijar el número de hilos a mano, según el límite del pod.

## Errores comunes {Common mistakes}

### 1. Construir en la Mac y desplegar en x86-64

La imagen sale `linux/arm64`, y en los nodos x86-64 el contenedor muere con `exec format error`, o la descarga falla con «no match for platform».

**Cómo evitarlo:** construir en CI con `--platform linux/amd64`, o multi-arquitectura a propósito. Para revisar una imagen: `docker image inspect --format '{{.Architecture}}' <imagen>`.

### 2. Arreglar «Permission denied» con 777 o con root

Funciona, pero abre todo: cualquiera puede cambiar el archivo, o el proceso puede hacer cualquier cosa.

**Cómo evitarlo:** buscar qué falta de verdad (¿la x de una carpeta del camino?, ¿el dueño?) con `ls -l` y con `id`, que dice tu UID y tus grupos, y dar justo eso: `chown` al usuario de la app y 644 o 755. Y el servicio, con un `USER` numérico.

### 3. Rutas relativas que dependen de dónde arrancas

`open("models/model.plan")` funciona desde la carpeta de tu proyecto y falla en el contenedor, que arranca en otra carpeta: `FileNotFoundError`.

**Cómo evitarlo:** rutas absolutas que vienen de la configuración (`MODEL_PATH=/models/classifier/1/model.plan`), o relativas al propio archivo de código con `Path(__file__).parent`: en Python, `__file__` es la ruta del archivo `.py` que está corriendo, así que no depende de dónde arrancaste.

### 4. Mayúsculas que tu Mac perdona

`Model.plan` y `model.plan` son el mismo archivo en tu Mac y dos distintos en Linux.

**Cómo evitarlo:** nombres en minúsculas, y las pruebas de CI dentro del contenedor de Linux, no solo en tu laptop.

### 5. Escribir en el contenedor como si fuera un disco

Logs, cachés o modelos descargados en la capa escribible se pierden cuando Kubernetes reinicia el contenedor, llenan el disco del nodo y, con `readOnlyRootFilesystem`, fallan con «Read-only file system».

**Cómo evitarlo:** los logs, a la salida del programa (*stdout*), donde los recoge el sistema de logs; lo que debe durar, a un volumen o a S3 (el almacén de archivos de AWS); y un `emptyDir` montado en `/tmp` si la app necesita temporales.

### 6. Creer que el contenedor ve sus CPU

`os.cpu_count()` cuenta los núcleos del nodo. Una librería que lanza un hilo por núcleo dentro de un límite de 4 CPU se congela a ráfagas.

**Cómo evitarlo:** fijar los hilos según el límite (`torch.set_num_threads`, `intra_op_num_threads` en ONNX Runtime) y vigilar el *throttling* con dos métricas que junta Prometheus: `container_cpu_cfs_throttled_periods_total` entre `container_cpu_cfs_periods_total` es la fracción de ventanas de 100 ms en que el cgroup lo congeló (sección 8).

### 7. Un secreto en una capa de la imagen

Copiar el archivo de secretos a la imagen (`COPY .env`) lo deja guardado en una capa, y pasarle al build un token (una contraseña para programas, como el `HF_TOKEN` que deja bajar modelos de Hugging Face) como argumento (`ARG HF_TOKEN`) lo deja en el historial de la imagen. Borrarlo en una línea posterior del Dockerfile no lo quita: la capa de antes sigue ahí, y cualquiera que pueda bajar la imagen lo lee (M15).

**Cómo evitarlo:** que el secreto nunca entre a la imagen (`.env` en `.dockerignore`; si el build lo necesita, `RUN --mount=type=secret`, que no deja rastro en ninguna capa) y que en producción llegue montado como archivo, o que no haga falta porque el pod tiene su propia identidad en la nube, con permisos y sin contraseña.

## En la vida real {In real life} [extra]

### C01: los nodos de punta a punta

Triton corre en una g4dn.xlarge: una VM sobre Nitro, con una CPU x86-64 (un Intel Xeon), 4 [[vcpu|vCPU]], 16 GiB de RAM y una T4 que se le entrega directo. Arranca con Amazon Linux 2023 y la AMI acelerada de EKS, que ya trae el driver de NVIDIA y el Container Toolkit (M06). El gateway vive aparte, en máquinas sin GPU (dos c6i.xlarge), también x86-64. Las dos imágenes son `linux/amd64`:

- **El gateway:** Debian con Python 3.13, UID 10001, raíz de solo lectura (`readOnlyRootFilesystem: true`) con `/tmp` en un `emptyDir`, sin ninguna capacidad de root (`drop: ["ALL"]`), el filtro seccomp por omisión (Docker lo aplica siempre; Kubernetes, solo si el pod lo pide con `seccompProfile: RuntimeDefault`, como aquí), 1 GiB de memoria y sin límite de CPU. Escucha en el puerto 8080, que no pide ningún poder: en Linux, por omisión, abrir un puerto menor que 1024, como el 80, es uno de los poderes de root (Docker, desde 2020, y containerd, desde su versión 2.0, lo permiten dentro de sus contenedores).
- **Triton:** Ubuntu 22.04, con el engine horneado (copiado dentro de la imagen) en `/models/classifier/1/model.plan`, `/dev/nvidia0` montado por el toolkit y 6 GiB de memoria. La imagen de NVIDIA corre como root si nadie dice otra cosa, así que el manifiesto de Kubernetes de C01 la arranca como el UID 1000, el usuario `triton-server` que la imagen ya trae, con `runAsNonRoot: true` y sin capacidades de root.

### C01: ¿y si fuera ARM64?

AWS ofrece la misma T4 en una máquina ARM64 más barata, la g5g.xlarge, con un Graviton2; a su GPU la Ronda la llama T4G. La Ronda la pone junto a la g4dn.xlarge que eligió C01. Un mes son 730 horas (24 × 365 ÷ 12):

:::cuenta Dos T4 al mes: x86-64 contra ARM64
Dos g4dn.xlarge // x86-64 · 16 GiB de RAM | 2 × US$0.526/h × 730 h | ≈ US$768
Dos g5g.xlarge // ARM64 (Graviton2) · la misma T4 · 8 GiB de RAM | 2 × US$0.42/h × 730 h | ≈ US$613
Ahorro // 155 ÷ 768 ≈ 20 % | 768 − 613 | ≈ US$155 al mes
Red sostenida de cada g5g // el dato de AWS que usa la Ronda | — | ≈ 1.25 Gb/s
Lo que recibe cada nodo en el pico // 500 fotos/s, cada una un tensor de 602 KB, repartidas entre dos | 500 × 602 KB × 8 bits ÷ 2 | ≈ 1.2 Gb/s
= Ahorra 20 %, pero cada nodo quedaría en el límite de su red, con la mitad de RAM, y habría que reconstruir la imagen de Triton para arm64 y el engine en la T4G (y la del gateway, si sus máquinas también se mudaran a Graviton). C01 se quedó en x86-64.
:::

### C10: un LLM de 70.6 GB

C10 sirve con vLLM un modelo de ≈ 70,600 millones de parámetros en [[fp8|FP8]], un byte por parámetro: 70.6 GB. Casi todo su arranque es sistema operativo. Un contenedor que corre y termina antes que vLLM copia los pesos de S3 al disco NVMe del nodo, en un `emptyDir`, y revisa cada archivo contra su huella (sha256), un número que cambia si cambia un solo byte. `/dev/shm` va en memoria con 16 GiB, que cuentan contra el límite del contenedor: vLLM corre un proceso por GPU, y esos procesos se coordinan por memoria compartida. Los pesos van en safetensors, que no ejecuta código al cargarse (un *pickle*, el formato que PyTorch usa si no le pides otro, sí puede) y se puede leer con [[mmap]]: el kernel trae del disco cada pedazo cuando se lee.

### C02: una caja con GPU en cada centro de distribución

En C02, cada centro tiene su propia caja con una GPU L4 de NVIDIA que vigila sus cámaras. La contraseña de las cámaras nunca está en el código: el *forwarder*, el programa que le pide a cada cámara sus fotos y arma los eventos, la lee de un secreto montado como archivo. Y el archivo de configuración de DeepStream (el programa de NVIDIA que procesa el video), que solo acepta la contraseña escrita dentro de la dirección de la cámara, se genera en la caja al instalarla, con permisos 0600 (el 0 de adelante solo avisa que el número va en octal): solo su dueño lo puede leer. Antes de activar una imagen nueva, la caja revisa su firma, una marca que solo el equipo puede producir con su llave privada: nada que no salió del equipo llega a correr ahí.

### C03: un Jetson en cada línea de producción

En la planta de C03, cada línea tiene un Jetson Orin NX: ARM64 con Jetson Linux (L4T) sobre Ubuntu 22.04 en JetPack 6.2. Sus imágenes son `linux/arm64` y, regla de M04, usan la misma versión de L4T que el equipo. El engine se construye en un Orin NX igual a los de la línea, con el mismo JetPack, y el modo de energía se fija con `sudo nvpmodel`. Actualizar el JetPack de la flota se hace a distancia (OTA, *over the air*), obliga a reconstruir los engines y lleva un plan para regresar a la versión anterior (M04).

### Fuera de ML

- **Android** usa el kernel Linux y le da a cada app su propio UID. Los permisos de esta lección, los de dueño, grupo y demás, son los que impiden que una app lea los archivos de otra.
- **AWS Lambda**, el servicio que corre una función tuya cada vez que llega una petición, sin que tengas un servidor, corre cada función en una *microVM* de Firecracker, una VM mínima que AWS dice que arranca en ≈ 125 ms con menos de 5 MiB de memoria de más. Como comparte servidores con código de miles de clientes, un contenedor no le basta: quiere el aislamiento de una VM.
- **GitLab, enero de 2017.** Un ingeniero que intentaba arreglar una réplica de la base de datos borró por error, en el servidor equivocado, la carpeta de datos de la base principal: ≈ 300 GB. Los respaldos tampoco servían, y se perdieron unas 6 horas de datos de los usuarios. En Linux, `rm`, el comando que borra, no pregunta ni manda nada a una papelera: lo que tus permisos dejan borrar, se borra. Por eso importa que cada quien tenga solo los permisos que necesita.
- **CrowdStrike, julio de 2024.** Una actualización defectuosa de un programa de seguridad que corre dentro del kernel de Windows tumbó ≈ 8.5 millones de computadoras, con aerolíneas, bancos y hospitales detenidos. Un error en el espacio de usuario mata un programa; un error en el kernel tumba la máquina.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Hay uno más, de la cuota de CPU, en la sección extra «Los límites por dentro», junto a su calculadora.

:::ejercicios
? [facil] Un proceso está parado en `/opt/tritonserver`. (a) ¿A qué ruta absoluta lleva `../../models/classifier/1/model.plan`? (b) ¿Y `bin/tritonserver`? (c) De `models/x`, `/models/x` y `./models/x`, ¿cuál es absoluta?
- (a) El primer `..` sube a `/opt` y el segundo, a `/`. Desde ahí baja: **`/models/classifier/1/model.plan`**.
- (b) Es relativa, así que se pega a la carpeta de trabajo: **`/opt/tritonserver/bin/tritonserver`**.
- (c) Solo **`/models/x`**, la que empieza con `/`. Las otras dos son la misma ruta relativa: `/opt/tritonserver/models/x`.
? [facil] (a) Escribe `rw-r-----` en octal. (b) Escribe 755 en letras. (c) ¿Quién puede leer un archivo con permisos 600?
- (a) `rw-` = 4 + 2 + 0 = 6; `r--` = 4; `---` = 0. **640**.
- (b) 7 = rwx y 5 = r-x: **rwxr-xr-x**.
- (c) **Solo su dueño**, y root, que se salta los permisos.
? [facil] ¿Qué pasó en cada caso? (a) `PermissionError: [Errno 13] Permission denied: '/models/classifier/1/model.plan'`. (b) `FileNotFoundError: [Errno 2] No such file or directory: 'models/model.plan'`. (c) `OSError: [Errno 30] Read-only file system: '/srv/app/cache.json'`. (d) `exec /usr/local/bin/python: exec format error`.
- (a) El kernel revisó los permisos y el UID del proceso no puede leer el archivo, o no puede entrar a alguna carpeta del camino.
- (b) La ruta no existe. Como es relativa, lo más probable es que el proceso arrancó en otra carpeta.
- (c) Esa carpeta está montada en solo lectura, por ejemplo con `readOnlyRootFilesystem`.
- (d) El programa es de otra arquitectura (una imagen arm64 en un nodo x86-64), o es un script sin la línea `#!`.
? [facil] ¿Qué viaja dentro de la imagen de Triton y qué pone el nodo? Python 3.10, glibc, el kernel, `nvidia.ko`, las librerías de CUDA, la T4 y el engine.
- **En la imagen:** Python 3.10 y glibc (son el espacio de usuario de Ubuntu 22.04), las librerías de CUDA y el engine, que va horneado.
- **Del nodo:** el kernel, `nvidia.ko` (el módulo del driver vive en el kernel) y la T4. Las librerías del driver también son del nodo: el toolkit las monta al arrancar.
? [medio] El engine tiene permisos 644 y dueño root. La carpeta `/models/classifier/1` tiene 700 y dueño root. Triton corre como el UID 1000. ¿Puede leer el engine? ¿Cómo lo arreglas?
- Para llegar al archivo, el kernel pide x en cada carpeta del camino. La carpeta tiene 700 (rwx------): el UID 1000 cae en «los demás», que tienen 0. **No puede entrar** y recibe «Permission denied», aunque el archivo diga r para todos.
- Arreglo: `chmod 755 /models/classifier/1`, o hacer dueño de la carpeta al UID 1000. Nunca 777: Triton solo necesita leer.
? [medio] Dentro del contenedor de Triton, `ps` muestra a tritonserver como el PID 1. Desde el nodo, el mismo programa aparece como el PID 48,213. ¿Son dos procesos? ¿Qué pasa si desde el nodo le mandas `kill -9 48213`?
- **Es uno solo**, con dos números: el namespace de procesos le da su propia numeración, que adentro empieza en 1.
- `kill -9` manda SIGKILL: el proceso muere, el contenedor termina con código 137 (128 + 9) y Kubernetes lo vuelve a arrancar.
- Al revés no se puede: desde adentro, el contenedor ni siquiera ve los procesos del nodo.
? [medio] Un servidor de modelos tiene tres cosas en su contenedor: (a) su log, en `/var/log/app.log`, en la capa escribible; (b) los pesos, en un volumen montado en `/models` con `readOnly: true`; (c) 512 MiB de datos que sus procesos se pasan entre sí, en `/dev/shm`. Kubernetes reinicia el contenedor: ¿qué pasa con (a) y con (b)? ¿Y si el programa intenta escribir en `/models`? ¿Contra qué cuentan los 512 MiB de (c)?
- (a) **Se pierde**: cada reinicio crea un contenedor nuevo, con la capa escribible vacía. Por eso los logs van a *stdout*.
- (b) **Sigue ahí.** El volumen no es parte del contenedor: se vuelve a montar en el nuevo. Escribir en `/models` falla con el error 30, «Read-only file system»: el kernel rechaza la escritura y nadie puede corromper los pesos.
- (c) `/dev/shm` vive en la RAM, así que sus 512 MiB **cuentan contra el límite de memoria del contenedor**, como el de Triton y el de C10. Si el proceso ya usa 5.7 GiB y el límite es de 6 GiB, esos 0.5 GiB lo pasan del tope (5.7 + 0.5 = 6.2): `OOMKilled`, código 137.
? [reto] Construyes la imagen del gateway en tu MacBook con un chip M3 y la subes. En los nodos de C01, el pod muere al arrancar. (a) ¿Qué pasó y qué dice el log? (b) Da dos arreglos. (c) Si C01 se mudara a máquinas con Graviton, ¿qué cambiaría?
- (a) Docker construyó para la plataforma de tu Mac: `linux/arm64`. Los nodos de C01, las c6i del gateway y las g4dn de Triton, son x86-64. Al arrancar, el kernel lee la cabecera de `python`, ve el 183 de ARM64 en vez del 62 y se niega: **`exec format error`**. Si el registro guardó un índice sin amd64, ni siquiera baja: «no match for platform».
- (b) Construir en CI con `--platform linux/amd64`. O una imagen multi-arquitectura con las dos plataformas bajo el mismo tag. Y revisar con `docker image inspect` antes de desplegar.
- (c) En nodos ARM64 esa imagen sí correría: el gateway en máquinas de CPU con Graviton y Triton en las g5g, las máquinas ARM64 de AWS con la misma T4 (la T4G). Pero harían falta una imagen arm64 de Triton, un engine construido en la T4G y las librerías del gateway en `aarch64`, y aceptar en las g5g la mitad de RAM y una red justa para el pico («En la vida real» trae la cuenta).
? [reto] El gateway de C01 lleva `USER 10001` en su Dockerfile y esto en Kubernetes: `runAsNonRoot: true`, `readOnlyRootFilesystem: true` y `capabilities: drop: ["ALL"]`. Explica qué protege cada línea. Un día alguien agrega código que guarda un caché (una copia de resultados, para no recalcularlos) en `/srv/app/cache.json`: ¿qué pasa y cómo se arregla sin quitar nada?
- `USER 10001`: el proceso corre como un usuario sin privilegios. Si una foto maliciosa explota un error de Pillow, el atacante tiene los permisos del UID 10001, no los de root.
- `runAsNonRoot: true`: Kubernetes se niega a arrancar el contenedor si fuera a correr como root; con el UID numérico lo puede verificar.
- `readOnlyRootFilesystem: true`: la raíz se monta en solo lectura. Nadie puede cambiar el código ni dejar herramientas instaladas.
- `drop: ["ALL"]`: aunque algo corriera como root, no tendría sus poderes especiales. El gateway no necesita ninguno: escucha en el 8080.
- El caché falla con «Read-only file system» (errno 30): `/srv/app` es parte de la raíz, que está en solo lectura. Arreglo: escribirlo en `/tmp`, el `emptyDir` de 64 MiB que C01 ya monta (escribible, y se borra con el pod), o montar otro `emptyDir` solo para el caché. Lo demás sigue en solo lectura.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M05 · Contenedores** es esta lección aplicada: qué viaja en la imagen y qué no (el kernel y el driver son del nodo), el usuario no root con UID numérico, la trampa de construir en la Mac y las capas de solo lectura con una escribible encima.
- **M06 · Orquestación y escalado** convierte lo que reserva y lo que limita cada pod en números del cgroup (la cuota de 100 ms, el `OOMKilled` con código 137) y usa los volúmenes, los Secrets montados como archivos y las AMI de los nodos con GPU.
- **M15 · Seguridad y confiabilidad** usa el mínimo privilegio en cada componente, los secretos que no van en una capa de la imagen y los pesos en safetensors en vez de pickles.
- **También:** M04 (Jetson con ARM64, L4T y `sudo nvpmodel`) y M08 (los hilos de ONNX Runtime contra el límite del pod).

**En el Dojo:** la estación 7, «Empaquetado (Docker)», ya está abierta. Ahí el model server corre como `USER 10001:10001`, te topas con la diferencia entre la imagen arm64 de tu Mac y la amd64 de un servidor, y montas el modelo en un volumen de solo lectura (`:ro`). La estación 9, «Kubernetes», todavía no abre.

**En Sensei:** la siguiente lección, «Hacer varias cosas a la vez: async, event loop y GIL», empieza donde terminan las syscalls: qué hace un programa mientras espera a que el kernel le traiga un archivo o una respuesta de la red, sin quedarse [[bloqueo|bloqueado]]. La fase 5, con «Cómo viaja un mensaje: IP, puertos y DNS», abre la red. Más adelante, «La terminal y la shell» practica `ls`, `cd` y `chmod` con las manos, y «Empaquetado con Docker» arma las imágenes de C01 capa por capa.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
sistema-operativo kernel syscall linux sistema-archivos ruta permisos root montaje arquitectura-cpu contenedor-vs-vm cgroup
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué diferencia hay entre el kernel y el sistema operativo?
El kernel es el núcleo: el único programa que toca el hardware, reparte la CPU y la memoria y revisa los permisos. El sistema operativo es el kernel más el espacio de usuario: la biblioteca de C, la shell y los comandos. Una imagen trae solo el espacio de usuario; el kernel lo pone el nodo.
? ¿Qué es una syscall y por qué existe?
La forma en que un programa le pide algo al kernel: abrir un archivo, usar la red, crear un proceso. Existe porque la CPU no deja que un programa en modo usuario toque el hardware ni la memoria de otros: lo pide, y el kernel revisa antes.
? Parado en /opt/tritonserver, ¿qué diferencia hay entre ../../models y /models?
Las dos llevan a /models. La primera es relativa: sube dos veces desde la carpeta de trabajo, así que depende de dónde estás. La segunda es absoluta y significa lo mismo desde cualquier lugar.
? ¿Por qué no correr un servicio como root dentro de un contenedor?
Porque quien explote un error del servicio obtiene sus permisos, y ese UID 0 es el mismo root del nodo: queda a un paso de la máquina. Se usa un USER numérico y runAsNonRoot.
? ¿Qué es de verdad un contenedor y en qué se diferencia de una VM?
Un proceso normal del nodo con namespaces (qué ve), cgroups (cuánto usa) y su propio árbol montado desde la imagen; todos comparten el kernel del nodo. Una VM simula una computadora completa sobre un hipervisor y arranca su propio kernel: aísla más, pero pesa y tarda más.
? ¿Qué significa «exec format error» en un contenedor que no arranca?
Que el kernel leyó la cabecera del programa y no es para su CPU: casi siempre, una imagen arm64 hecha en una Mac en un nodo x86-64. También pasa con un script sin la línea #!.
:::
