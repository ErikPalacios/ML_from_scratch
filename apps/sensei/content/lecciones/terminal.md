---
titulo: La terminal y la shell
en: The terminal and the shell
subtitulo: Qué es la pantalla negra donde se escriben comandos, cómo los lee la shell, qué hereda cada programa que lanzas y cómo se encadenan comandos chicos para encontrar una aguja en un log de 3 GB.
pregunta: Cuando un ML engineer entra a la máquina donde corre el gateway de C01, ¿qué es esa pantalla donde escribe, qué pasa entre que teclea `kubectl logs gateway-7f9c` y ve las líneas, y cómo junta comandos chicos para encontrar los errores de una sola request?
requisitos: programa-proceso, sistema-operativo
---

:::idea
La terminal es solo la ventana; la shell es el programa que lee lo que escribes, lo parte en palabras, busca el programa y lo lanza como un proceso nuevo. Ese proceso hereda tu carpeta, tus variables y tres flujos de texto. Desviar esos flujos a archivos o a otros programas es lo que convierte comandos chicos en una herramienta para buscar en cualquier log.
:::

Son las 3 de la mañana y suena una alerta: el gateway de C01 está respondiendo más errores 504 que de costumbre. Ana, que está de guardia, no abre una página web ni una app con botones. Abre una ventana con fondo oscuro y escribe:

```bash
kubectl logs -n classifier gateway-7f9c --since=10m | grep '"status":504' | wc -l
```

Un segundo después aparece un número: 37. En diez minutos, 37 requests de ese pod (una de las copias del gateway que corren en Kubernetes) terminaron en 504. (Esta línea necesita un cluster de Kubernetes, así que aquí no se corre: el 37 es de ejemplo.) Con otra línea encuentra la request `9f2c41d0` que un usuario reportó y lee qué le pasó.

Para quien no lo ha visto, eso parece magia o un idioma secreto. No es ninguna de las dos. Son cuatro ideas: una ventana, un programa que lee lo que escribes, unos programas chicos que hacen una sola cosa y unos tubos que los conectan. Al terminar esta lección vas a poder leer esa línea palabra por palabra, y escribir las tuyas.

## La terminal y la shell {The terminal and the shell}

En la lección «Qué es un programa y qué es un proceso» viste que una terminal es una de esas ventanas donde se escriben comandos en vez de usar el mouse. Aquí la abrimos por dentro, porque en realidad son dos programas distintos que trabajan juntos.

### La ventana: la terminal

La [[terminal]] (*terminal*, o *terminal emulator*) es el programa que dibuja la ventana. Hace dos cosas: manda a otro programa lo que tecleas y dibuja en pantalla el texto que ese programa le regresa. Nada más. No sabe qué es `ls` ni qué es un archivo.

Cada sistema trae la suya:

- **macOS** trae la app **Terminal**; mucha gente usa también iTerm2 o la terminal de su editor de código.
- **Windows 11** trae **Windows Terminal** (en Windows 10 se instala aparte, desde la Microsoft Store). Para tener un Linux de verdad dentro de Windows existe **WSL2** (*Windows Subsystem for Linux*): corre un kernel de Linux en una máquina virtual ligera, y su terminal se ve igual que la de un servidor.
- **Linux** trae varias, como GNOME Terminal.

Se llama «emulador» porque imita a las terminales de los años setenta: un teclado con pantalla, conectado por cable a una computadora grande.

### El programa que lee: la shell

La [[shell]] (*shell*, «concha») es el programa que corre dentro de la ventana. Lee la línea que escribes, la interpreta y lanza los programas que pediste. Se llama así porque es la capa de afuera del [[sistema-operativo|sistema operativo]]: la que tocas tú, alrededor del [[kernel]].

Hay varias, y casi todas entienden lo mismo:

| Shell | Dónde la vas a ver |
|---|---|
| **bash** | La de casi todos los servidores Linux y la de las imágenes de Debian y Ubuntu, como la `python:3.13-slim` del gateway de C01 |
| **zsh** | La de macOS desde Catalina (2019), en las cuentas nuevas. Entiende casi todo lo de bash, con algunas diferencias que verás aquí |
| **sh** | La más básica, la que exige POSIX, el estándar que comparten los sistemas tipo Unix, como Linux y macOS. En los contenedores chicos (Alpine, o los que solo traen BusyBox, un solo programa que imita a cientos de comandos) a veces es la única |

Hay imágenes que no traen ninguna: la Ronda avisa que una imagen *distroless* no trae shell, así que no hay dónde escribir comandos adentro.

:::figura terminal-capas
Tres programas distintos. La terminal dibuja letras y pasa lo que tecleas. La shell lee la línea, la parte en palabras, encuentra el programa, lo lanza y espera a que termine. Los procesos que lanza heredan la carpeta, las variables y los tres flujos.
:::

### El prompt y el ciclo

Cuando la shell está lista para recibir algo, escribe el **prompt** (*prompt*, «invitación»): un texto corto al principio de la línea, como `ana@laptop ~ %` en zsh o `ana@gw-node:~$` en bash. Casi siempre dice quién eres, en qué máquina estás y en qué carpeta (`~` es tu carpeta personal). Léelo siempre: es la forma más rápida de saber si estás en tu laptop o en un servidor de producción. Para un usuario normal termina en `$` en bash y en `%` en zsh; si eres [[root]], en `#`.

Desde ahí, la shell repite el mismo ciclo para cada línea:

:::pasos
1. Lee
Espera a que aprietes Enter y lee la línea completa.
2. Parte y expande
Corta la línea en palabras y reemplaza lo que haya que reemplazar: variables, comodines, `~`. Lo ves en la siguiente sección.
3. Busca
Toma la primera palabra y averigua qué es: algo que ella misma sabe hacer o un programa en el disco.
4. Lanza
Si es un programa, crea un [[proceso]] nuevo con `fork` y `exec`, como viste en la lección de procesos, y le pasa las demás palabras.
5. Espera
Se queda esperando a que ese proceso termine, guarda su [[codigo-salida|código de salida]] y vuelve a escribir el prompt.
:::

### El comando: un programa o algo de la shell

Un [[comando]] (*command*) es lo que escribes en una línea para pedir algo: una palabra con un significado, seguida de lo que le quieras pasar. En `ls /models`, el comando es `ls` (lista una carpeta) y `/models` es lo que le pasas.

La primera palabra puede ser dos cosas:

- **Un programa** en el disco, un [[binario-ejecutable]] o un script. `ls`, `grep`, `python3` y `kubectl` son archivos que viven en alguna carpeta, como `/usr/bin/ls`.
- **Un builtin** (*builtin*, «integrado»): algo que la shell hace por sí misma, sin lanzar ningún proceso. `cd`, `export`, `echo` (imprime lo que le pases) y `type` son builtins.

¿Por qué `cd` no puede ser un programa aparte? Porque cambia la carpeta del proceso que lo corre. Si fuera un programa, cambiaría la carpeta de un hijo que muere un instante después, y la shell seguiría donde estaba.

Para saber qué es cada palabra hay dos comandos. `type` es un builtin que te dice cómo la va a entender la shell: `type cd` responde `cd is a shell builtin`, y `type ls`, `ls is /usr/bin/ls`. `which ls` responde solo la ruta del programa. En bash, `which` es un programa aparte que no sabe de builtins; en zsh viene integrado.

## Cómo lee la shell una línea {How the shell reads a line}

Antes de lanzar nada, la shell convierte tu línea en una lista de palabras. Entender ese paso evita la mitad de los sustos de la terminal.

### Argumentos y opciones

Todo lo que va después del comando son sus [[argumento-cli|argumentos]] (*arguments*). La shell los separa por los espacios y se los entrega al programa como una lista de textos. El programa decide qué significa cada uno. Por costumbre hay dos clases:

- **Opciones** o *flags*: empiezan con guion y cambian cómo trabaja el programa. Las **cortas** llevan un guion y una letra, `-n`; las **largas**, dos guiones y una palabra, `--lines`. Son la misma opción: `tail -n 20 gateway.log` y `tail --lines=20 gateway.log` muestran las últimas 20 líneas. Muchas cortas se pueden juntar: `ls -la` es `ls -l -a` (lista larga, con permisos y tamaños, y con los archivos ocultos).
- **Argumentos posicionales**: lo demás, casi siempre los archivos o las cosas sobre las que trabaja. En `tail -n 20 gateway.log`, el `20` es el valor de `-n` y `gateway.log` es el posicional.

Las opciones largas son, sobre todo, cosa de los programas de GNU, los que trae Linux. Los de macOS vienen de BSD, otra familia, y muchas veces solo entienden las cortas: en una Mac (macOS 26), `wc --lines gateway.log` (`wc` cuenta; con `-l`, las líneas) falla con `illegal option`, aunque `wc -l gateway.log` funciona. Algunos, como `head` y `tail`, ya aceptan `--lines`: no adivines, pregúntale al programa. Para saber qué acepta un programa, casi todos responden a `--help`, y `man tail` abre su manual. La hoja de referencia de comandos de la Ronda lo dice claro: no memorices los flags de `docker run`, `--help` existe.

### Las comillas: un espacio es un separador

Como el espacio separa argumentos, un nombre con espacios se parte. Si tienes un archivo que se llama `mis fotos` y escribes `rm mis fotos`, el programa `rm` (borra archivos) recibe dos argumentos, `mis` y `fotos`, y trata de borrar dos archivos que no son el tuyo. Si existen, los borra. Para que un texto con espacios sea un solo argumento, va entre comillas.

- **Comillas dobles** `"…"`: juntan todo en un argumento, pero la shell todavía reemplaza las variables de adentro.
- **Comillas simples** `'…'`: juntan todo y no reemplazan nada. Lo que escribes llega tal cual.

Una variable de la shell es un nombre que guarda un texto: `nombre="mis fotos"` la crea y `$nombre` la lee. La sección que sigue las cuenta a fondo.

El programa `printf '[%s]\n'` imprime cada argumento que recibe entre corchetes, en su propia línea. Es la forma más honesta de ver qué palabras armó la shell. Este bloque, y todos los de la lección, corre en un contenedor de Linux con bash 5, en una carpeta vacía:

```bash
touch "mis fotos" mis fotos      # touch crea archivos vacíos: aquí, tres
ls
printf '[%s]\n' mis fotos        # sin comillas: dos argumentos
printf '[%s]\n' "mis fotos"      # con comillas: uno
rm mis fotos                     # borra «mis» y «fotos»…
ls                               # …y deja «mis fotos»
nombre="mis fotos"
printf '[%s]\n' $nombre "$nombre" '$nombre'
```

```salida
fotos
mis
mis fotos
[mis]
[fotos]
[mis fotos]
mis fotos
[mis]
[fotos]
[mis fotos]
[$nombre]
```

La última línea es la regla de oro: una variable sin comillas se parte en los espacios que traiga. **Escribe siempre `"$variable"`, entre comillas dobles.** El `#` empieza un comentario: lo que sigue hasta el final de la línea, la shell lo ignora.

:::figura terminal-palabras
La misma idea cuatro veces. Arriba, las comillas deciden si «mis fotos» es uno o dos argumentos. Abajo, la shell reemplaza *.log por los nombres que coinciden antes de lanzar ls; entre comillas, el patrón llega tal cual.
:::

### Una línea larga, partida

Los comandos de la Ronda a veces no caben en una línea, y se parten con una diagonal invertida `\` al final:

```bash
docker run --rm --gpus all mi-servicio:3f9c2ab \
  python -c "import torch; print(torch.cuda.is_available())"
```

La `\` le dice a la shell «la línea sigue abajo». Tiene que ser lo último de la línea: si después de ella queda un espacio invisible, la `\` protege ese espacio en vez del salto de línea, el comando termina ahí y la línea de abajo se vuelve otro comando. Este de arriba es una ilustración (lanza un contenedor y le pregunta a PyTorch si ve la GPU): necesita Docker y una GPU.

### Comodines: la shell completa los nombres

Un [[comodin|comodín]] (*wildcard*, y al proceso se le dice *globbing*) es un carácter que la shell reemplaza por los nombres de archivo que coinciden con un patrón:

- `*` coincide con cualquier texto, incluso vacío: `*.log` son todos los nombres que terminan en `.log`.
- `?` coincide con exactamente un carácter: `gateway-?.log`.
- `[12]` coincide con uno de los caracteres de la lista: `gateway-[12].log`.

Lo importante: **el reemplazo lo hace la shell, antes de lanzar el programa.** `ls` nunca ve el asterisco: recibe la lista de nombres ya hecha. Por eso `ls *.log` y `ls "*.log"` no son lo mismo: con comillas, la shell no toca el patrón y `ls` busca un archivo que se llame literalmente `*.log`.

```bash
touch gateway-1.log gateway-2.log triton.log notas.txt
echo *.log
echo gateway-?.log
echo "*.log"
printf '[%s]\n' *.log
ls *.csv
echo "código: $?"
```

```salida
gateway-1.log gateway-2.log triton.log
gateway-1.log gateway-2.log
*.log
[gateway-1.log]
[gateway-2.log]
[triton.log]
ls: cannot access '*.csv': No such file or directory
código: 2
```

Fíjate en el `*.csv`: no había ningún archivo así, y bash le pasó el patrón tal cual a `ls`, que no encontró un archivo con ese nombre. zsh, la shell de la Mac, se porta distinto: con un patrón que no coincide con nada, ni siquiera lanza el comando y responde `zsh: no matches found: *.csv`. Los mensajes de error salen en inglés porque así viene configurado el contenedor; `$?` es el código de salida del último comando, que verás de nuevo más adelante.

## Lo que hereda cada proceso: carpeta, variables y PATH {What every process inherits: folder, variables and PATH}

Cada vez que la shell lanza un programa, el proceso nuevo nace con tres cosas copiadas de ella: la carpeta donde está parada, sus variables de entorno y los tres flujos de texto. Esta sección cuenta las dos primeras; la que sigue, los flujos.

### La carpeta donde estás

En la lección del sistema operativo viste la carpeta de trabajo de un proceso: desde ahí se leen las [[ruta|rutas]] relativas, las que no empiezan con `/`. En la terminal se le dice [[directorio-trabajo|directorio de trabajo]] (*working directory*), y la shell lo cambia por ti:

- `pwd` (*print working directory*) imprime dónde estás.
- `cd carpeta` (*change directory*) te mueve. `cd ..` sube una; `cd` solo te lleva a tu carpeta personal, `~`; `cd -` te regresa a donde estabas.
- `ls` lista lo que hay; `mkdir -p a/b` crea carpetas, con todo y las de en medio.

Cada programa que lances arranca en esa carpeta. Si `python3 entrenar.py` abre `datos/train.csv`, lo busca dentro de la carpeta donde estabas al lanzarlo, no junto al archivo `entrenar.py`. Y como cada proceso tiene la suya, un `cd` dentro de un hijo no mueve al padre. Los paréntesis lanzan una copia de la shell, una *subshell*:

```bash
pwd
mkdir -p proyecto/datos
cd proyecto/datos
pwd
cd ../..
(cd /tmp && pwd)
pwd
```

```salida
/home/ana/trabajo
/home/ana/trabajo/proyecto/datos
/tmp
/home/ana/trabajo
```

`/tmp` es la carpeta de archivos temporales. El `&&` encadena dos comandos: el de la derecha corre solo si el de la izquierda salió bien, con código 0.

### Variables de entorno: un diccionario que se hereda

La lección del sistema operativo te presentó `PYTHONUNBUFFERED=1` como «un ajuste que el proceso recibe al arrancar». Aquí está el mecanismo completo. Una [[variable-entorno|variable de entorno]] (*environment variable*) es un par nombre-valor, los dos de texto, que cada proceso lleva consigo y **hereda de su padre** al nacer. Juntas forman un diccionario: `HOME=/home/ana`, `USER=ana`, `LANG=C.UTF-8`.

La shell distingue dos clases de variables:

- **Variable de la shell:** `MODELO=resnet50`, sin espacios junto al `=`. Vive solo en esa shell. Los hijos no la ven.
- **Variable exportada**, o de entorno: `export MODELO` la marca para que la hereden todos los hijos que se lancen después. `export MODELO=resnet50` hace las dos cosas de una vez.

Para leer una variable se le pone `$` adelante: `echo "$HOME"`. Para ver todas las de entorno está `env`. Y si escribes una variable justo antes de un comando, `INFER_TIMEOUT_S=0.15 python3 app.py`, ese valor entra al entorno de ese proceso y de nadie más.

```bash
MODELO=resnet50
bash -c 'echo "el hijo ve: [$MODELO]"'
export MODELO
bash -c 'echo "el hijo ve: [$MODELO]"'
python3 -c 'import os; print("Python ve:", os.environ["MODELO"])'
INFER_TIMEOUT_S=0.15 bash -c 'echo "solo este: [$INFER_TIMEOUT_S]"'
bash -c 'echo "el siguiente: [$INFER_TIMEOUT_S]"'
LINEAS=$(printf 'a\nb\nc\n' | wc -l)
echo "el comando dio $LINEAS líneas · HOME es $HOME"
```

```salida
el hijo ve: []
el hijo ve: [resnet50]
Python ve: resnet50
solo este: [0.15]
el siguiente: []
el comando dio 3 líneas · HOME es /home/ana
```

`bash -c '…'` lanza una bash hija que corre ese texto: es la forma más corta de preguntar «¿qué ve un hijo?». El `$( … )` de la penúltima línea es la **sustitución de comando**: la shell corre lo de adentro y pone en su lugar lo que imprimió. La Ronda lo usa todo el tiempo, por ejemplo `TAG=$(git rev-parse --short=7 HEAD)` para guardar el id del último cambio del código en una variable.

La herencia va en una sola dirección: de padre a hijo, como una copia al nacer. Un hijo que cambia su variable no cambia la del padre, y un padre que la cambia después no cambia la de un hijo que ya nació. Por eso, si cambias una variable de un servidor que ya está corriendo, hay que reiniciarlo para que la vea.

### PATH: dónde busca la shell los programas

Cuando escribes `kubectl`, ¿cómo sabe la shell en qué carpeta está ese programa? Lee una variable de entorno especial, [[path-shell|PATH]]: una lista de carpetas separadas por `:`, que la shell revisa **en orden**. El primer archivo ejecutable que se llame `kubectl` es el que corre. Si recorre la lista y no lo encuentra, se rinde con `command not found` y el código 127, el que ya viste en la lección de procesos.

:::ojo
PATH no es lo mismo que una [[ruta]]. Una ruta, como `/usr/bin/ls`, es la dirección de un archivo. PATH es una lista de carpetas donde buscar programas. En inglés las dos se dicen *path*, y por eso se confunden.
:::

Si la primera palabra trae una `/`, como `./bin/saluda` o `/usr/bin/ls`, la shell no busca en PATH: va directo a esa ruta. Por eso un script de la carpeta actual se corre con `./`.

```bash
mkdir bin
printf '#!/bin/sh\necho "hola desde saluda"\n' > bin/saluda
chmod +x bin/saluda
saluda
echo "código: $?"
./bin/saluda
PATH="$HOME/trabajo/bin:$PATH"
type saluda
saluda
echo "$PATH" | tr ':' '\n' | head -n 3
```

```salida
bash: line 4: saluda: command not found
código: 127
hola desde saluda
saluda is /home/ana/trabajo/bin/saluda
hola desde saluda
/home/ana/trabajo/bin
/usr/local/bin
/usr/local/sbin
```

Las líneas 2 y 3 del bloque fabrican un programa de una línea y le dan el permiso `x`, el de ejecución de la lección del sistema operativo. El `>` escribe en el archivo lo que imprime `printf` (lo ves en la sección que sigue), y la primera línea del programa, `#!/bin/sh`, dice con qué se corre (la sección de scripts lo explica). La línea de `PATH=` pone la carpeta nueva **al principio** de la lista: así gana sobre cualquier otro `saluda` del sistema. En la última, cada `|` le pasa lo que imprime un comando al siguiente (las tuberías tienen su sección): `tr` cambia cada `:` por un salto de línea y `head -n 3` deja las tres primeras. El mensaje de error dice `line 4` porque el bloque corre como script; en una terminal normal, bash dice `bash: saluda: command not found` y zsh, `zsh: command not found: saluda`.

Así funciona también un entorno de Python: activarlo pone su carpeta `bin` al principio de PATH, y por eso `python3` pasa a ser el de ese entorno. El gateway de C01 tiene el suyo en `/opt/venv`. Lo verás en «Python, paquetes y entornos».

## Tres flujos y cómo desviarlos {Three streams and how to redirect them}

### stdin, stdout y stderr

En la lección del sistema operativo viste que el kernel numera los archivos que tiene abiertos cada proceso, y que a cada número le dice **descriptor**; que el 1 es la salida del programa, y que hasta un `print` termina en `write(1, …)`. Todo proceso nace con tres descriptores ya abiertos, que hereda de su padre. Son los [[flujos-estandar|flujos estándar]] (*standard streams*):

| Descriptor | Nombre | Para qué | En una terminal, va a |
|---|---|---|---|
| 0 | stdin (*standard input*) | Lo que el programa lee | El teclado |
| 1 | stdout (*standard output*) | Los resultados | La pantalla |
| 2 | stderr (*standard error*) | Los errores y los avisos | La pantalla |

¿Por qué dos salidas, si las dos van a la pantalla? Para poder separarlas. Si guardas los resultados de un programa en un archivo, quieres que los errores sigan apareciendo frente a ti y no se mezclen con los datos. Un buen programa escribe su resultado en stdout y todo lo demás, el progreso, los avisos, los errores, en stderr.

El programa no sabe a dónde van sus flujos. Escribe en el 1 y ya. Que el 1 sea la pantalla, un archivo o la entrada de otro programa lo decide quien lo lanzó. En un contenedor, el 1 y el 2 los captura el *runtime* (el programa que corre los contenedores en la máquina) y los guarda en un archivo de log: por eso `docker logs` y `kubectl logs` muestran los dos. Un **log** (*log*, «bitácora») es eso: el registro, línea por línea, de lo que un programa va contando. C01 escribe una línea JSON por request a stdout y otro programa, Fluent Bit, la recoge y la manda a S3, el [[object-storage|almacenamiento de objetos]] de AWS.

:::nota El buffer de stdout
La lección del sistema operativo contó que Python junta en un *buffer* lo que imprime antes de hacer el `write`. Cuando stdout es una terminal, vacía el buffer en cada línea; cuando es un archivo o un tubo, lo hace cada varios KB. Por eso el gateway de C01 arranca con `PYTHONUNBUFFERED=1`: en el contenedor, stdout no es una terminal, y sin esa variable las líneas tardarían en salir y las últimas se perderían si el proceso muere de golpe.
:::

:::profundo Lo mismo desde Python
Python muestra los tres flujos con su módulo `subprocess`, que lanza un programa hijo como lo haría la shell y captura sus flujos por separado. `sys.executable` es la ruta del mismo Python que corre el código, `-I` lo aísla (no carga módulos de tu carpeta ni lee las variables `PYTHON…`), y `repr` muestra el texto con sus `\n` a la vista:

```python
import subprocess, sys

hijo = """
import os, sys
print("top1: Tenis 0.83")                             # stdout: el flujo 1
print("aviso: Triton tardó 152 ms", file=sys.stderr)  # stderr: el flujo 2
print("versión:", os.environ.get("MODEL_VERSION"))
sys.exit(3)
"""
r = subprocess.run([sys.executable, "-I", "-c", hijo], capture_output=True, text=True,
                   env={"MODEL_VERSION": "resnet50-2026-10-01"})
print("stdout:", repr(r.stdout))
print("stderr:", repr(r.stderr))
print("código de salida:", r.returncode)

r = subprocess.run("printf 'b\\na\\nb\\n' | sort | uniq -c", shell=True,
                   capture_output=True, text=True)
print("la tubería por /bin/sh:", r.stdout.split())
```

```salida
stdout: 'top1: Tenis 0.83\nversión: resnet50-2026-10-01\n'
stderr: 'aviso: Triton tardó 152 ms\n'
código de salida: 3
la tubería por /bin/sh: ['1', 'a', '2', 'b']
```

Tres cosas salen por tres caminos distintos: los resultados, el aviso y el código. Y el `env=` muestra la herencia: el hijo ve exactamente el entorno que le dio su padre. La última parte, con `shell=True`, le pasa el texto a `/bin/sh`, y es la shell la que arma la tubería que verás en la sección que sigue.
:::

### Redirección: mandar un flujo a otro lado

La [[redireccion|redirección]] (*redirection*) le pide a la shell que, antes de lanzar el programa, conecte uno de sus descriptores a un archivo en vez de a la terminal:

| Escribes | Qué hace |
|---|---|
| `cmd > salida.txt` | stdout va al archivo. Si ya existía, **lo vacía primero** |
| `cmd >> salida.txt` | stdout se agrega al final del archivo |
| `cmd < datos.txt` | stdin sale del archivo en vez del teclado |
| `cmd 2> errores.txt` | stderr va al archivo |
| `cmd > todo.txt 2>&1` | stdout va al archivo y stderr va a donde vaya stdout: los dos al archivo |
| `cmd 2> /dev/null` | stderr se tira. `/dev/null` es un archivo especial que se traga todo |

El `2>&1` se lee «que el 2 apunte a donde apunta el 1 **en este momento**». Y ahí está la trampa: la shell aplica las redirecciones de izquierda a derecha, así que el orden importa.

:::figura terminal-redireccion
Los descriptores de un proceso son flechas: el 1 es stdout y el 2, stderr. A la izquierda, primero el 1 apunta al archivo y después el 2 copia esa flecha: los dos terminan en el archivo. A la derecha, el 2 copia la flecha del 1 cuando todavía apuntaba a la pantalla, y solo después el 1 cambia: los errores siguen saliendo en la pantalla.
:::

Aquí `ls` lista un archivo que existe y otro que no, así que escribe en sus dos salidas:

```bash
touch existe.txt
ls existe.txt noexiste.txt > salida.txt
echo "--- salida.txt:"; cat salida.txt
ls existe.txt noexiste.txt > todo.txt 2>&1
echo "--- todo.txt:"; cat todo.txt
ls existe.txt noexiste.txt 2>&1 > alreves.txt
echo "--- alreves.txt:"; cat alreves.txt
ls existe.txt noexiste.txt 2> /dev/null
echo "uno" > a.txt
echo "dos" >> a.txt
wc -l < a.txt
echo "tres" > a.txt
cat a.txt
```

```salida
ls: cannot access 'noexiste.txt': No such file or directory
--- salida.txt:
existe.txt
--- todo.txt:
ls: cannot access 'noexiste.txt': No such file or directory
existe.txt
ls: cannot access 'noexiste.txt': No such file or directory
--- alreves.txt:
existe.txt
existe.txt
2
tres
```

`cat` imprime el contenido de un archivo, `wc -l` cuenta líneas y el `;` separa dos comandos en la misma línea. Con `>` solo, el error no entró al archivo: salió en la pantalla. Con `> todo.txt 2>&1`, los dos entraron. Con el orden al revés, el error volvió a la pantalla. Y la última línea muestra lo peligroso de `>`: el archivo perdió el «uno» y el «dos» sin preguntar. bash tiene un atajo, `&> todo.txt`, que manda los dos flujos al archivo sin pensar en el orden.

## Tuberías: comandos chicos que se encadenan {Pipes: small commands chained together}

### El tubo

Una [[pipe|tubería]] (*pipe*) conecta el stdout de un programa con el stdin del siguiente. Se escribe con una barra vertical: `cmd1 | cmd2`. Lo que `cmd1` imprime no aparece en la pantalla; entra a `cmd2` como si lo estuvieras tecleando.

Por dentro, la shell le pide al kernel un tubo, un pedacito de memoria con dos extremos (en Linux, de 64 KiB), lanza los dos procesos y conecta el descriptor 1 del primero a un extremo y el 0 del segundo al otro. Los dos procesos **corren al mismo tiempo**. El primero escribe mientras el segundo lee; si el tubo se llena, el que escribe espera, y si se vacía, el que lee espera. Ninguno guarda la salida completa en un archivo intermedio, así que una tubería puede procesar un archivo mucho más grande que la memoria.

Así se trabaja en la terminal desde los años setenta: programas chicos que hacen una sola cosa, unidos por tubos. Los de uso diario:

| Comando | Qué hace con las líneas que le llegan |
|---|---|
| `grep patrón` | Deja pasar solo las que contienen el patrón. `-c` las cuenta; `-v` deja pasar las que **no** lo contienen; `-o` imprime solo el pedazo que coincidió |
| `sort` | Las ordena. `-n` como números; `-r` al revés |
| `uniq -c` | Junta las líneas iguales **que vienen seguidas** y dice cuántas eran. Por eso casi siempre va después de `sort` |
| `wc -l` | Cuenta las líneas |
| `head -n 5`, `tail -n 5` | Deja pasar las primeras o las últimas 5. `tail -f` se queda esperando las nuevas |
| `cut -d: -f2` | Corta cada línea en el carácter `:` y deja el campo 2 |
| `awk` | Un lenguaje chico para hacer cuentas por columnas: `awk '{s += $1} END {print s}'` suma la primera columna |
| `jq` | Entiende [[json\|JSON]]: `jq -r .status` saca el campo `status` de cada línea |

### El ejemplo central: los códigos de estado de C01

El gateway de C01 escribe una línea [[json-lines|JSON Lines]] por request, con su [[codigo-estado|código de estado]] HTTP. Aquí va una versión chica y simplificada: el log real trae más campos y ≈ 300 bytes por línea, y este agrega una línea con `"level":"error"` cuando algo falla. El comando `cat > gateway.log <<'FIN'` escribe en el archivo las líneas que siguen, hasta la palabra `FIN` (a eso se le dice *heredoc*).

```bash
cat > gateway.log <<'FIN'
{"request_id":"a71e09b2","level":"info","status":200,"ms":41}
{"request_id":"c3d58f10","level":"info","status":200,"ms":38}
{"request_id":"5b90e7aa","level":"info","status":413,"ms":2}
{"request_id":"e4f1c2d9","level":"info","status":200,"ms":44}
{"request_id":"9f2c41d0","level":"error","msg":"Triton no respondió en 0.15 s"}
{"request_id":"9f2c41d0","level":"info","status":504,"ms":152}
{"request_id":"77ab3e01","level":"info","status":200,"ms":40}
{"request_id":"0d6e9b44","level":"info","status":400,"ms":5}
{"request_id":"b18f6c27","level":"info","status":200,"ms":43}
{"request_id":"2c7a0f93","level":"error","msg":"Triton no respondió en 0.15 s"}
{"request_id":"2c7a0f93","level":"info","status":504,"ms":151}
{"request_id":"f05d3a6e","level":"info","status":200,"ms":39}
FIN
wc -l < gateway.log
grep -o '"status":[0-9]*' gateway.log | cut -d: -f2 | sort | uniq -c | sort -rn
grep 9f2c41d0 gateway.log
grep 9f2c41d0 gateway.log | grep -c '"level":"error"'
jq -r 'select(.status) | .status' gateway.log | sort | uniq -c | sort -rn | head -n 2
```

```salida
12
      6 200
      2 504
      1 413
      1 400
{"request_id":"9f2c41d0","level":"error","msg":"Triton no respondió en 0.15 s"}
{"request_id":"9f2c41d0","level":"info","status":504,"ms":152}
1
      6 200
      2 504
```

Lee la tubería de la segunda línea de izquierda a derecha, como una línea de ensamble:

1. `grep -o '"status":[0-9]*'` saca de cada línea solo el pedazo `"status":200`. El `[0-9]*` del patrón quiere decir «cualquier cantidad de dígitos». Las líneas de error no tienen `status` y no dejan nada.
2. `cut -d: -f2` corta en los dos puntos y deja `200`.
3. `sort` pone juntos los iguales: los 200, después los 400…
4. `uniq -c` cuenta cada grupo: `6 200`.
5. `sort -rn` ordena por ese conteo, del mayor al menor.

La versión con `jq` hace lo mismo, pero leyendo el JSON de verdad: `select(.status)` se queda con las líneas que tienen ese campo y `.status` lo saca. Es más segura, porque `grep` busca texto exacto: si el log escribiera `"status": 200`, con un espacio, el patrón de `grep` no encontraría nada, y `jq` seguiría funcionando.

:::diagrama terminal-tuberia
Cinco procesos, uno por comando, corriendo a la vez. Usa «Recorrer» para seguir las líneas por los tubos, y para ver por qué sort es el único que tiene que esperar.
:::

### De 12 líneas a 3 GB

Con 12 líneas cualquier cosa funciona. El log de verdad es otra historia:

:::cuenta El log de un día de C01
Requests al día // una línea por foto | — | ≈ 10,000,000
Bytes por línea | — | ≈ 300 B
Tamaño del día | 10⁷ × 300 B | ≈ 3 GB
Líneas de la request 9f2c41d0 // en el log simplificado; en el real, una | — | 2
Fracción que deja pasar `grep 9f2c41d0` | 2 ÷ 10⁷ | 0.00002 %
Tiempo de leerlo // suponiendo que el disco y grep leen ≈ 500 MB/s | 3 GB ÷ 500 MB/s | ≈ 6 s
= Para encontrar 2 líneas, grep lee los 10 millones. No hay atajo: el log no tiene índice. Pero 6 segundos es poco, y la memoria que usa es poca: lee el archivo de a pedacitos, unas cuantas líneas a la vez.
:::

Dos reglas salen de esa cuenta. Primero, **filtra lo antes posible**: `grep` al principio de la tubería, para que a `sort` (el único que necesita ver todo antes de soltar algo) le lleguen 2 líneas y no 10 millones. Segundo, **corre el comando donde están los datos**: lo ves en la sección de `ssh`.

:::calculadora terminal-log
Prueba un mes completo: 30 veces el día. Y baja la red a 20 Mb/s, la de un café: ¿cuánto tardaría en llegar el log a tu laptop?
:::

:::profundo Qué pasa cuando head se cansa
En `jq … | sort | uniq -c | sort -rn | head -n 2`, `head` imprime dos líneas y termina. El tubo que lo une con el `sort` de su izquierda queda sin nadie que lea. La siguiente vez que ese `sort` intenta escribir, el kernel le manda la [[senal|señal]] SIGPIPE, que lo termina sin ruido. Así, `head` puede cortar una tubería larga sin que nadie tenga que leer el resto. Es también por qué, en un script con `pipefail` (en la sección siguiente), una tubería que termina en `head` puede dar un código distinto de 0 aunque todo haya salido bien: el que murió por SIGPIPE sale con 128 + 13 = 141.
:::

## Scripts: shebang, permisos y set -euo pipefail {Scripts: shebang, permissions and set -euo pipefail} [extra]

### Un archivo con comandos

Un [[script-shell|script de shell]] (*shell script*) es un archivo de texto con comandos, uno por línea, que la shell corre de arriba abajo como si los fueras tecleando. Sirve para no repetir a mano una receta de diez comandos y para que otra persona, o un pipeline de [[ci|CI]] (la máquina que corre las pruebas en cada cambio del código), la corra igual. En C01, `bash model/build_engine.sh` construye el [[engine-tensorrt|engine de TensorRT]] (el modelo compilado para una GPU concreta) en una T4; en la Ronda, un script de publicación (*release*) firma la imagen y la sube.

Dentro de un script se usan las mismas cosas de la terminal, más un par de piezas:

- `"$@"` son todos los argumentos que recibió el script, cada uno respetado, y `$1`, `$2`… cada uno por separado.
- `for x in …; do …; done` repite algo para cada elemento, e `if comando; then …; fi` decide según el código de salida de un comando: 0 es «sí».

### El shebang: con qué se corre

La primera línea de un script suele ser algo como `#!/usr/bin/env bash`. Es el [[shebang]] (de *sharp*, `#`, y *bang*, `!`). Cuando le pides al kernel que ejecute un archivo de texto, el kernel lee esos dos primeros caracteres, toma el resto de la línea como el programa que debe leer el archivo y lo lanza con el script como argumento.

- `#!/bin/bash` pide la bash de `/bin/bash`, exactamente esa. En una Mac, esa ruta tiene una bash muy vieja, de la serie 3.2.
- `#!/usr/bin/env bash` le pide al programa `env` que busque `bash` en el PATH. Corre la primera bash que encuentre, la que tú instalaste si está antes en la lista. Es la forma más portátil, y la más común.
- `#!/bin/sh` pide la shell básica. Si usas cosas que solo tiene bash, en Debian falla, porque ahí `sh` es otra shell, más chica (`dash`).

Para que el kernel acepte ejecutarlo, el archivo necesita el permiso `x`, el de ejecución que viste en la lección de [[permisos]]: `chmod +x script.sh`. Sin él, `./script.sh` da `Permission denied` y el código 126. Siempre puedes saltarte el shebang y el permiso escribiendo `bash script.sh`: así el programa que corres es bash, y el script es solo un archivo que lee.

```bash
cat > contar.sh <<'FIN'
#!/usr/bin/env bash
# Cuenta las líneas de cada archivo que le pasen.
for archivo in "$@"; do
  echo "$archivo: $(wc -l < "$archivo") líneas"
done
FIN
printf 'a\nb\nc\n' > tres.txt
printf 'x\ny\n' > dos.txt
./contar.sh tres.txt
echo "código: $?"
bash contar.sh tres.txt
chmod +x contar.sh
./contar.sh tres.txt dos.txt
ls -l contar.sh | cut -c1-10
```

```salida
bash: line 10: ./contar.sh: Permission denied
código: 126
tres.txt: 3 líneas
tres.txt: 3 líneas
dos.txt: 2 líneas
-rwxr-xr-x
```

El primer intento dio 126 porque el archivo no tenía la `x`; `bash contar.sh` funcionó igual. Ya con `chmod +x`, `./contar.sh` corre, y la última línea deja los primeros 10 caracteres de `ls -l` (eso hace `cut -c1-10`): los permisos, ahora con sus `x`.

### set -euo pipefail: que el script se detenga al fallar

Por omisión, un script de bash es optimista: si un comando falla, imprime el error y **sigue con el siguiente**, como si nada. En un script que borra el modelo viejo después de copiar el nuevo, «seguir como si nada» es una catástrofe. Por eso casi todo script serio empieza, justo después del shebang, con `set -euo pipefail`. Cada letra apaga una forma de fallar en silencio:

| Opción | Qué hace |
|---|---|
| `-e` | Si un comando sale con un código distinto de 0, el script se detiene ahí, con ese código |
| `-u` | Usar una variable que no existe es un error. Sin esto, si `CARPETA` no existe (basta un error de dedo en su nombre), `rm -rf "$CARPETA"/*` se vuelve `rm -rf /*`: borrar todo lo que se pueda |
| `-o pipefail` | El código de una tubería es el del último comando que falló, no solo el del último comando. Sin esto, `grep … \| wc -l` «sale bien» aunque `grep` no haya encontrado el archivo, porque `wc` sí terminó bien |

```bash
cat > sin.sh <<'FIN'
grep 9f2c41d0 no-existe.log | wc -l
echo "sigo, como si nada"
FIN
cat > con.sh <<'FIN'
set -euo pipefail
grep 9f2c41d0 no-existe.log | wc -l
echo "esto ya no se imprime"
FIN
bash sin.sh; echo "código de sin.sh: $?"
bash con.sh; echo "código de con.sh: $?"
bash -c 'false | true; echo "sin pipefail: $?"'
bash -c 'set -o pipefail; false | true; echo "con pipefail: $?"'
```

```salida
grep: no-existe.log: No such file or directory
0
sigo, como si nada
código de sin.sh: 0
grep: no-existe.log: No such file or directory
0
código de con.sh: 2
sin pipefail: 0
con pipefail: 1
```

`false` es un comando que no hace nada y sale con 1; `true`, con 0. Y `bash sin.sh; echo …` corre el script y, al terminar, imprime su código. `sin.sh` falló y terminó con 0: un pipeline de CI lo habría dado por bueno. `con.sh` se detuvo y salió con el 2 de `grep`.

Para revisar que un script no tenga errores de escritura sin correrlo está `bash -n script.sh`. La Ronda lo usó con el script del engine de C01: «solo pasó `bash -n`», porque sin GPU no se podía correr.

:::profundo Las trampas de set -e
`-e` ayuda, pero no es una red completa. Tres casos donde no hace lo que esperas:

- **Dentro de una condición no cuenta.** En `if grep -q x log; then …`, que `grep` falle es una respuesta («no»), no un error. Lo mismo con lo que va antes de `&&` o de `||`.
- **grep sin coincidencias es un fallo.** `grep` sale con 1 cuando no encuentra nada. Con `-e` y `pipefail`, `errores=$(grep ERROR app.log | wc -l)` mata el script justo el día que no hubo errores. Si «nada» es una respuesta válida, escribe `{ grep ERROR app.log || true; } | wc -l`.
- **`local x=$(cmd)` se traga el error.** Dentro de una función (un bloque de comandos con nombre), `local` crea una variable que solo vive ahí, y sale con 0 aunque `cmd` haya fallado. Se escribe en dos líneas: `local x`, y abajo `x=$(cmd)`.

Y `-u` tampoco es completa: solo detecta las variables que **no existen**. Una que existe pero está vacía (`CARPETA=""`) pasa sin aviso. Para exigir que traiga algo se escribe `"${CARPETA:?}"`: si está vacía o no existe, el script se detiene con un error.

Hay una herramienta, ShellCheck, que revisa scripts y encuentra estas trampas, y muchas más.
:::

## Entrar al servidor: ssh, sudo y kubectl logs {Getting into the server: ssh, sudo and kubectl logs}

### ssh: una terminal en otra máquina

[[ssh]] (*secure shell*) te da una shell en otra computadora a través de la red, con todo cifrado. Escribes `ssh ana@gw-node` y, si te deja entrar, el prompt cambia: lo que tecleas ahora lo lee una shell en `gw-node`, y los procesos que lances corren allá. Tu terminal solo dibuja lo que esa shell le manda. Por omisión usa el [[puerto]] 22.

Para probar quién eres, en vez de una contraseña se usa casi siempre un **par de llaves**: dos archivos que se crean juntos con `ssh-keygen`. La **llave privada** se queda en tu laptop (por ejemplo, `~/.ssh/id_ed25519`) y nunca se comparte; es la que la lección del sistema operativo pidió guardar con permisos 600. La **llave pública** se copia al servidor. Con ellas, tu laptop demuestra que tiene la privada sin mandarla nunca por la red. Cómo funciona eso por dentro es tema de la fase de seguridad.

:::profundo Las llaves y los permisos que exige ssh
Ed25519 es el tipo de llave que `ssh-keygen` crea por omisión desde OpenSSH 9.5, de 2023. Los permisos 600 no son un consejo: si otros usuarios pueden leer tu llave privada, ssh se niega a usarla y avisa `UNPROTECTED PRIVATE KEY FILE!`. Del lado del servidor, la carpeta `~/.ssh` y el archivo `authorized_keys` (la lista de llaves públicas que dejan entrar) no deben poder escribirlos otros, o el servidor ignora tus llaves.
:::

Tres usos que vas a ver:

- `ssh ana@gw-node` abre una shell allá.
- `ssh ana@gw-node 'grep 9f2c41d0 /var/log/gateway.log'` corre un solo comando allá y te trae su salida. Las comillas simples importan: con ellas, la tubería o el comodín los resuelve la shell de allá; sin ellas, tu shell local se los come primero.
- `ssh -L 8000:localhost:8000 ana@gw-node` abre un **túnel**: lo que tu laptop mande a su propio puerto 8000 viaja por ssh y sale en el puerto 8000 de `gw-node`. Así puedes hacer `curl localhost:8000` (`curl` hace una request HTTP desde la terminal) desde tu laptop y llegarle a un servicio que no está expuesto a internet. `kubectl port-forward`, de la Ronda, hace lo mismo para un pod de Kubernetes.

:::cuenta Llevar el comando a los datos
El log del día | — | ≈ 3 GB
Bajarlo a tu laptop // con una red de 100 Mb/s; un byte son 8 bits | 3 × 10⁹ × 8 ÷ 10⁸ | ≈ 240 s = 4 min
Buscar allá con grep // a ≈ 500 MB/s, la suposición de antes | 3 GB ÷ 500 MB/s | ≈ 6 s
Lo que viaja de vuelta | 2 líneas de ≈ 300 B | ≈ 600 B
= Correr el grep en el servidor es ≈ 40 veces más rápido que bajar el archivo, y por la red viajan 600 bytes en vez de 3 GB.
:::

### sudo: un comando como root

En la lección del sistema operativo conociste a [[root]], el usuario que puede todo. Entrar como root a un servidor es mala idea: cualquier error de dedo tiene poder total. Lo normal es entrar como tu usuario y, solo para el comando que lo necesita, pedir permiso con [[sudo]] (*superuser do*): `sudo systemctl restart docker` reinicia el servicio de Docker como root (`systemctl` arranca y detiene los servicios de Linux, los programas que corren en el fondo). `sudo` te pide **tu** contraseña, revisa en una lista si tienes permiso y anota quién hizo qué.

Dentro de un contenedor casi nunca hay `sudo`, y no hace falta. La imagen se arma con lo que necesita, y el proceso corre como el usuario que dice su receta, el [[dockerfile|Dockerfile]]: root, si no dice otra cosa, o un usuario sin privilegios, que es lo recomendado. Agregar `sudo` a una imagen solo le da a un atacante un camino para subir de privilegios. Si escribes `sudo` en el contenedor de esta lección, la respuesta es `bash: sudo: command not found`, con el código 127.

### Qué pasa cuando tecleas kubectl logs gateway-7f9c

Ahora junta todo. En C01, el gateway corre como varios [[pod|pods]] (el pod es la unidad que Kubernetes arranca: uno o más contenedores juntos, en una máquina del cluster) dentro del *namespace* `classifier`, un espacio de nombres para separar las cosas de cada equipo. `kubectl` es el programa de la línea de comandos para hablar con Kubernetes, el sistema de [[orquestacion|orquestación]] de C01. Ana escribe `kubectl logs -n classifier gateway-7f9c` (el nombre real de un pod es más largo, algo como `gateway-7f9c…-x2kq4`; aquí va acortado).

:::diagrama terminal-kubectl
Toca cada caja para ver qué hace. Usa «Recorrer» para seguir la línea desde que aprietas Enter hasta que ves los logs, y para ver qué cambia con una tubería a grep.
:::

En palabras: la shell parte la línea, encuentra `kubectl` en el PATH y lo lanza. `kubectl` lee su configuración (el *kubeconfig*, en `~/.kube/config`: a qué cluster hablar y con qué credenciales) y le hace una request [[https|HTTPS]] (HTTP cifrado) al *API server*, la puerta de entrada de Kubernetes. El API server se la pasa al **kubelet**, el programa de Kubernetes que corre en cada máquina del cluster, en la máquina donde vive ese pod. El kubelet lee el archivo donde el runtime fue guardando el stdout y el stderr del contenedor, y la respuesta hace el camino de regreso. `kubectl` escribe las líneas en **su** stdout, que es tu terminal, o el tubo hacia `grep` si pusiste uno.

Las opciones que más se usan: `-f` se queda siguiendo las líneas nuevas (Ctrl+C deja de seguir; el pod sigue igual), `--tail=50` trae solo las últimas 50, `--since=10m` las de los últimos diez minutos, `--previous` las del contenedor anterior, el que murió, y `--timestamps` agrega la hora que anotó el runtime al guardar cada línea.

:::cuenta Cuánta historia trae kubectl logs en el pico
Requests por segundo // el pico de diseño de C01 | — | 500
Pods del gateway // el mínimo del autoescalado (Kubernetes agrega o quita pods según el tráfico), que va de 3 a 12 | — | 3
Líneas por segundo en cada pod | 500 ÷ 3 | ≈ 167
Lo que cubre `--tail=50` | 50 ÷ 167 | ≈ 0.3 s
Lo que cabe en el archivo del pod // al llegar a 10 MiB = 10,485,760 B se rota: se guarda aparte y empieza uno nuevo | 10,485,760 ÷ (167 × 300 B) | ≈ 210 s ≈ 3.5 min
= En el pico, las últimas 50 líneas son 0.3 segundos de tráfico, y el archivo entero del pod, unos 3.5 minutos. Para encontrar algo hay que pedir un rango de tiempo y filtrar con grep. A las 3 de la mañana hay mucho menos tráfico y el archivo alcanza para más: por eso a Ana le sirvió `--since=10m`.
:::

:::calculadora terminal-tail
Sube los pods a 12, el máximo del autoescalado: cada pod recibe menos tráfico y el mismo --tail cubre más tiempo.
:::

Ojo con lo que `kubectl logs` **no** tiene: solo ve lo que sigue guardado en la máquina del pod. El kubelet rota ese archivo cuando crece (por omisión, al llegar a 10 MiB, y guarda hasta 5), `kubectl logs` solo lee el más reciente, y si el pod se borra, sus logs se van con él. Además, cada línea guardada pesa unos 40 bytes más que la original, por la hora y el nombre del flujo que le agrega el runtime: el archivo dura un poco menos de lo que dio la cuenta. Para buscar en el día completo, los ≈ 3 GB, se va a donde Fluent Bit los guardó: en C01, un [[bucket-objetos|bucket]] de S3.

:::profundo Los comandos de la Ronda, leídos
Con lo que ya sabes, los comandos de los módulos de contenedores y de Kubernetes se leen solos: el programa, un verbo, opciones y argumentos. Docker y Kubernetes se presentan a fondo en las estaciones; aquí solo hay que reconocer su forma.

| Comando | Cómo se lee |
|---|---|
| `docker build -t classifier-gateway:3f9c2ab gateway/` | Arma una imagen con la receta de la carpeta `gateway/` y le pone ese nombre |
| `docker run --rm -p 8080:8080 classifier-gateway:3f9c2ab` | Corre un [[contenedor]] de esa imagen, conecta su puerto 8080 al tuyo y lo borra al terminar |
| `docker logs -f gw` · `docker exec -it gw sh` | Sigue el stdout y el stderr del contenedor `gw` · abre una shell `sh` adentro |
| `kubectl get pods -n classifier` | Lista los pods, con su estado y sus reinicios |
| `kubectl describe pod POD` | Todo sobre un pod, con sus eventos y su último código de salida |
| `kubectl apply -f k8s/gateway.yaml` | Le pide a Kubernetes que deje todo como dice ese archivo |
| `kubectl rollout undo deploy/gateway` | Regresa a la versión anterior del gateway |
| `curl -sS localhost:8080/healthz` | Hace una request HTTP. `-s` quita la barra de progreso (y también calla los errores); `-S` vuelve a mostrar los errores |
| `nvidia-smi` | Muestra las GPUs de la máquina: memoria usada, [[utilizacion-gpu\|utilización]] y procesos |
| `grpcurl` | Como `curl`, pero para [[grpc\|gRPC]] |
:::

## Procesos desde la terminal {Processes from the terminal} [extra]

La shell espera a que termine cada comando antes de escribir el prompt. Eso es correrlo en **primer plano** (*foreground*). A veces quieres otra cosa: dejarlo corriendo y seguir escribiendo, pararlo o que sobreviva aunque cierres la ventana.

### Ver y detener

- `ps` lista procesos: `ps aux`, todos los de la máquina, con su [[pid|PID]], su usuario y su comando. `top` los muestra en vivo, ordenados por cuánta CPU usan; se sale con `q`.
- `kill PID` le manda una [[senal|señal]] a un proceso: SIGTERM por omisión, que pide terminar en orden. `kill -9 PID` manda SIGKILL, que no se puede atrapar.
- **Ctrl+C** hace que la terminal le mande SIGINT al proceso de primer plano: «interrumpe lo que haces».
- **Ctrl+Z** le manda SIGTSTP: lo pausa y te devuelve el prompt. `fg` lo regresa al primer plano y `bg` lo deja seguir en segundo plano.

El orden de esas señales es una costumbre que vas a ver en todos lados: primero se pide (SIGTERM, para que el proceso termine lo que traía, vacíe sus buffers y cierre sus archivos) y solo si no obedece se obliga (SIGKILL). `kill -9` de entrada es como desconectar la computadora: funciona, pero lo que estaba a medias se pierde. Kubernetes hace lo mismo al apagar un pod, como viste en la lección de procesos: SIGTERM, un plazo de gracia y, si el proceso sigue vivo, SIGKILL. Para buscar un PID sin leer toda la lista de `ps` está `pgrep`: `pgrep -f uvicorn` imprime el PID de cada proceso cuyo comando contiene `uvicorn`.

### Segundo plano y sesiones que sobreviven

Un `&` al final de la línea lanza el comando en **segundo plano** (*background*): la shell no espera y te devuelve el prompt al instante. `$!` guarda el PID del último que lanzaste así, y `wait` espera a que termine y te da su código.

```bash
sleep 30 &
pid=$!
ps -o comm= -p "$pid"
kill "$pid"
wait "$pid"
echo "sleep terminó con $?"
timeout 1 sleep 5
echo "timeout: $?"
```

```salida
sleep
sleep terminó con 143
timeout: 124
```

`sleep 30` espera 30 segundos sin hacer nada, y `ps -o comm= -p` imprime solo el nombre del programa de ese PID. El `kill` le mandó SIGTERM y salió con 143. `timeout 1 sleep 5` corre un comando con un tiempo límite: al segundo lo detiene, y sale con 124, su forma de decir «se acabó el tiempo».

:::cuenta Los códigos de los procesos que mata una señal
Ctrl+C // SIGINT es la señal 2 | 128 + 2 | 130
kill // SIGTERM es la 15 | 128 + 15 | 143
kill -9 o el OOM killer // SIGKILL es la 9 | 128 + 9 | 137
= Es la regla de la lección de procesos: 128 más el número de la señal. Un pod de C01 que muere con 137 casi siempre se quedó sin memoria.
:::

Hay un problema con `&`: si cierras la terminal o se corta tu `ssh`, los procesos de esa sesión reciben la señal SIGHUP (de *hang up*, «colgar»), y por omisión eso los mata. Dos salidas:

- `nohup comando > salida.log 2>&1 &` lanza el comando ignorando SIGHUP. Sobrevive a que cierres la sesión, y su salida queda en el archivo.
- **tmux** (*terminal multiplexer*) abre sesiones de terminal que viven en el servidor. Te desconectas, te vas a dormir, vuelves a entrar con `ssh` y `tmux attach` te regresa a la misma pantalla, con todo corriendo. Es como se cuida un entrenamiento de 8 horas en una máquina con GPU.

## Errores comunes {Common mistakes}

### 1. Un espacio que parte un argumento

`rm mis fotos`, o un script con `cp $origen $destino` y un archivo que se llama `datos de octubre.csv`. El programa recibe más argumentos de los que creías y trabaja sobre archivos que no eran.

**Cómo evitarlo:** comillas dobles alrededor de toda variable (`"$origen"`) y de todo nombre con espacios. Antes de un `rm`, cambia el `rm` por `printf '[%s]\n'` y mira qué argumentos arma la shell.

### 2. Un comodín que se expande donde no querías

`rm *.log` en la carpeta equivocada borra lo que coincida ahí. Y un patrón que debía llegarle a otro programa, como `find . -name *.log` (`find` busca archivos en una carpeta y todas las de adentro), lo expande antes la shell: si en tu carpeta hay un solo `.log`, `find` busca solo ese nombre.

**Cómo evitarlo:** revisa el prompt o `pwd` antes de un comodín peligroso, prueba primero con `echo *.log`, y pon entre comillas los patrones que son para el programa: `find . -name "*.log"`.

### 3. Vaciar el archivo que estás leyendo, o mezclar el orden

`sort gateway.log > gateway.log` deja el archivo vacío: la shell lo vacía al preparar el `>`, antes de que `sort` lo lea. Y `cmd 2>&1 > log` deja los errores en la pantalla.

**Cómo evitarlo:** escribe a un archivo nuevo (`sort gateway.log > ordenado.log`) y renómbralo después. Para juntar los dos flujos, `> log 2>&1`, en ese orden, o `&> log` en bash.

### 4. «command not found» con el programa instalado

El programa está, pero no en una carpeta de PATH: el entorno de Python no está activado, o la imagen no puso `/opt/venv/bin` en PATH. En un contenedor se ve como el error que cita la Ronda: `exec: "uvicorn": executable file not found in $PATH`.

**Cómo evitarlo:** `type programa` para ver qué encuentra la shell, `echo "$PATH"` para ver dónde busca, y en la imagen, una línea que agregue la carpeta del entorno a PATH.

### 5. Un script que falla y sigue

Un paso falla, el script sigue, y el siguiente trabaja sobre lo que quedó a medias: publica un modelo sin terminar de copiarlo o borra la versión vieja sin tener la nueva.

**Cómo evitarlo:** `set -euo pipefail` al principio de todo script, y `bash -n` o ShellCheck antes de usarlo. Si un `grep` sin resultados es normal, dilo explícito con `|| true`.

### 6. Estar en la máquina equivocada

El comando correcto en el lugar equivocado: un `kubectl delete` en el cluster de producción cuando creías estar en el de pruebas, o un `sudo` que pegaste de internet sin leerlo.

**Cómo evitarlo:** lee el prompt antes de cada comando con poder; con Kubernetes, `kubectl config current-context` te dice a qué cluster le hablas. Y nunca corras con `sudo` un comando que no entiendas palabra por palabra.

## En la vida real {In real life} [extra]

### C01: la guardia de las 3 de la mañana

Regresa a Ana y su alerta de 504. Con lo que ya sabes, su noche se lee comando por comando:

:::pasos
1. ¿Están vivos los pods?
`kubectl get pods -n classifier` lista los pods del gateway y de Triton con sus reinicios. Si uno reinició muchas veces, `kubectl describe pod` da su último código: 137 apunta a memoria.
2. ¿Cuántos 504 y desde cuándo?
`kubectl logs -n classifier gateway-7f9c --since=10m | grep '"status":504' | wc -l` da el número. Cambiando el `wc -l` por `jq -r .request_id | head`, saca unos ids para seguir.
3. ¿Qué le pasó a la request del usuario?
El reporte trae el id `9f2c41d0`, que viaja en el header `X-Request-ID`. Esa request es de hace dos horas: ya no está en el archivo del pod, sino en S3, donde Fluent Bit va subiendo el log en pedazos (un archivo nuevo cada pocos minutos, y aquí comprimido con gzip para que ocupe menos). Ana lee el pedazo de esa hora sin bajarlo a disco, en una tubería: `aws s3 cp s3://…/2026/11/06/01/….gz - | gunzip | grep 9f2c41d0`. `aws` es el programa de línea de comandos de AWS, y el `-` le dice que escriba en stdout en vez de en un archivo, y `gunzip` descomprime al vuelo.
4. ¿Y Triton?
`kubectl port-forward -n classifier svc/triton 8002:8002` abre un túnel al puerto de métricas, y `curl -sS localhost:8002/metrics | grep nv_inference_queue` muestra cuánto esperan las requests en la cola de Triton.
:::

La lección de procesos te contó otra historia de C01 que es de shell: el `CMD` del Dockerfile en forma shell deja a `/bin/sh` como PID 1, y `sh` no le pasa el SIGTERM a uvicorn. Ahora sabes qué es esa `sh`: una shell, lanzada solo para leer una línea.

### CI: scripts que corre una máquina

Cada paso `run:` de GitHub Actions, el sistema que corre las pruebas de un repositorio en cada cambio, es un script de shell. En Linux, si no dices otra cosa, lo corre bash con `-e`; si escribes `shell: bash`, le agrega `pipefail`. Ahí `set -euo pipefail` no es estilo: un código distinto de 0 es lo que pone la marca roja y detiene la publicación. La Ronda lo usa en su script de seguridad, donde un escáner de vulnerabilidades sale con `--exit-code 1` para romper el release. Lo verás en «Pruebas y CI/CD».

### Entrenar en una máquina rentada

Mucho del trabajo de entrenar modelos se hace por `ssh` a una máquina con GPU en la nube. El ritual es casi siempre el mismo: `ssh` a la máquina, `tmux` para que el entrenamiento sobreviva si se corta la conexión, `python3 -u entrenar.py 2>&1 | tee entrenar.log` para ver el progreso y guardarlo a la vez (`tee` copia lo que le llega a un archivo y también a su stdout; el `-u` es lo mismo que `PYTHONUNBUFFERED=1`: sin él, como stdout es un tubo, Python juntaría las líneas y el progreso llegaría a saltos), y en otra ventana `nvidia-smi` cada tanto para ver la memoria de la GPU. Cuando un LLM no cabe en la GPU, ahí lo ves primero.

### Explorar datos antes de abrir un notebook

Con un CSV de ventas de 2 GB (el pronóstico de demanda de C14, o las transacciones de fraude de C09), antes de cargarlo en Python o en un notebook (un cuaderno de Jupyter, donde el código se corre por pedazos): `head -n 3 ventas.csv` muestra las columnas, `wc -l` cuenta las filas, y `cut -d, -f4 ventas.csv | sort | uniq -c | sort -rn | head` dice qué tiendas tienen más filas, si la cuarta columna es la tienda. Son segundos, sin llenar la RAM.

### Fuera de ML

La forma de trabajar con programas chicos y tubos viene de Unix, que se empezó a escribir en los Laboratorios Bell en 1969; los tubos los propuso Doug McIlroy y se agregaron en 1973. Medio siglo después, la misma barra vertical conecta los comandos de un administrador de sistemas, de un científico que procesa genomas o de quien mantiene un sitio web. Y `ssh` es como se administran casi todos los servidores del mundo.

## Ejercicios {Exercises}

Intenta cada uno antes de abrir la solución. Los de bash puedes correrlos en una terminal de Linux o en WSL2. En una Mac casi todos funcionan igual, con detalles: el `wc -l` de la Mac pone espacios antes del número, `timeout` no viene instalado y `jq` viene desde macOS 15.

:::ejercicios
? [facil] En una carpeta con `a.csv`, `b.csv` y `notas.txt`, escribes `ls -l "reportes de octubre" *.csv`. ¿Cuántos argumentos recibe `ls`, y cuáles son?
- La shell parte por los espacios, pero lo que va entre comillas es uno solo: `-l` y `reportes de octubre`.
- El comodín `*.csv` se expande antes de lanzar `ls`: `a.csv` y `b.csv`.
- Recibe **4 argumentos**: `-l`, `reportes de octubre`, `a.csv` y `b.csv`. `ls` nunca ve el asterisco.
? [facil] ¿Quién hace cada cosa, la terminal o la shell? (a) Cambiar el tamaño de las letras. (b) Reemplazar `$HOME` por `/home/ana`. (c) Buscar `kubectl` en las carpetas de PATH. (d) Dibujar en verde el texto que imprime un programa.
- (a) La **terminal**: es la ventana, y dibujar letras es su trabajo.
- (b) La **shell**: expande las variables antes de lanzar el programa.
- (c) La **shell**: busca la primera palabra en PATH.
- (d) La **terminal**. El programa solo manda unos códigos especiales junto con el texto; la terminal los interpreta como colores.
? [facil] ¿Qué imprime `cat a.txt` después de estos tres comandos? `echo "uno" > a.txt`, `echo "dos" >> a.txt` y `echo "tres" > a.txt`. ¿Y si el tercero fuera `>>`?
- `>` vacía el archivo antes de escribir; `>>` agrega al final.
- Después de los tres, el archivo tiene solo **tres**: el último `>` borró lo anterior.
- Con `>>` en el tercero, tiene **uno, dos y tres**, en tres líneas.
? [facil] Escribes `entrenar` y la shell responde `command not found`. Pero el archivo `entrenar` está en la carpeta donde estás y tiene permiso de ejecución. ¿Por qué no lo encuentra, qué código de salida dejó, y cómo lo corres?
- Una palabra sin `/` se busca solo en las carpetas de PATH, y la carpeta actual no está en PATH (por seguridad: así nadie te cuela un `ls` falso en una carpeta).
- El código es **127**, el de «el comando no existe».
- Se corre con una ruta: `./entrenar`. O agregando su carpeta a PATH.
? [medio] Con un log como el de la sección de tuberías, escribe una tubería que diga cuántas requests terminaron en 504 y otra que liste sus `request_id`, sin repetir.
Una forma, con `jq` para leer el JSON:
```bash
printf '%s\n' '{"request_id":"9f2c41d0","level":"error","msg":"timeout"}' \
  '{"request_id":"9f2c41d0","status":504,"ms":152}' '{"request_id":"a71e09b2","status":200,"ms":41}' \
  '{"request_id":"2c7a0f93","status":504,"ms":151}' > gateway.log
jq -r 'select(.status == 504) | .request_id' gateway.log | wc -l
jq -r 'select(.status == 504) | .request_id' gateway.log | sort -u
```
```salida
2
2c7a0f93
9f2c41d0
```
- `select(.status == 504)` deja pasar solo las líneas con ese código, y `.request_id` saca el id.
- `wc -l` cuenta: **2**.
- `sort -u` ordena y quita los repetidos, como `sort | uniq`.
- Con grep también se puede (`grep '"status":504' gateway.log | wc -l`), pero depende de que el log no tenga espacios.
? [medio] Un compañero corre `python3 entrenar.py 2>&1 > entrenar.log` y se queja: «los errores no quedan en el log». ¿Qué pasó y cómo se arregla?
- Las redirecciones se aplican de izquierda a derecha. `2>&1` hizo que el 2 apuntara a donde apuntaba el 1 **en ese momento**: la pantalla.
- Después, `> entrenar.log` movió solo el 1 al archivo. Los errores siguieron en la pantalla.
- Arreglo: `python3 entrenar.py > entrenar.log 2>&1`, o `&> entrenar.log` en bash. Si además quiere verlo en vivo: `python3 -u entrenar.py 2>&1 | tee entrenar.log`, con `-u` para que Python no junte las líneas en el buffer del tubo.
? [medio] De la sección extra de scripts: un script con `set -euo pipefail` tiene la línea `errores=$(grep ERROR app.log | wc -l)`. Un día el log no trae ningún ERROR y el script muere sin imprimir nada útil. ¿Por qué? ¿Cómo lo arreglas?
- `grep` sale con 1 cuando no encuentra nada. Con `pipefail`, la tubería entera sale con 1 aunque `wc` haya contado 0 sin problema.
- Con `-e`, ese 1 detiene el script en esa línea.
- Arreglo: decir que «nada» está bien: `errores=$({ grep ERROR app.log || true; } | wc -l)`. Ojo: `grep -c` no lo arregla, porque también sale con 1 cuando el conteo es 0.
? [medio] En el pico de 500 requests por segundo, el gateway tiene 12 pods. ¿Cuánto tiempo cubren las últimas 200 líneas de un pod (`--tail=200`)? ¿Cuántas líneas trae `--since=5m`, y cuánto pesan a ≈ 300 B cada una?
- Por pod: 500 ÷ 12 ≈ **41.7 líneas por segundo**.
- `--tail=200`: 200 ÷ 41.7 ≈ **4.8 s** de tráfico.
- `--since=5m`: 300 s × 41.7 ≈ **12,500 líneas**, y 12,500 × 300 B ≈ **3.75 MB**. Cabe de sobra en una tubería con `grep`; es demasiado para leerlo a ojo.
? [reto] Con este log, ¿cuál es el promedio de `ms` y cuál es la request más lenta? Hazlo con una tubería y comprueba el promedio a mano.
```bash
printf '%s\n' '{"request_id":"a71e09b2","status":200,"ms":41}' '{"request_id":"9f2c41d0","status":504,"ms":152}' \
  '{"request_id":"e4f1c2d9","status":200,"ms":44}' '{"request_id":"77ab3e01","status":200,"ms":39}' > gateway.log
jq -r '.ms' gateway.log | awk '{ s += $1 } END { printf "promedio: %.1f ms en %d requests\n", s / NR, NR }'
jq -r '[.ms, .request_id] | @tsv' gateway.log | sort -n | tail -n 1
```
```salida
promedio: 69.0 ms en 4 requests
152	9f2c41d0
```
- `jq -r '.ms'` saca un número por línea. `awk` va sumando cada uno en `s`; al final (`END`), `NR` es cuántas líneas leyó.
- A mano: (41 + 152 + 44 + 39) ÷ 4 = 276 ÷ 4 = **69 ms**.
- Para la más lenta, `jq` arma «ms, tabulador, id», `sort -n` ordena por el número y `tail -n 1` deja la última: **9f2c41d0, con 152 ms**. Fíjate en que un solo 504 sube el promedio de ≈ 41 a 69: por eso la latencia se mide con [[percentil|percentiles]].
? [reto] El log del día, ≈ 3 GB, está en una máquina a la que entras por `ssh` como `ana@gw-node`, en `/var/log/gateway/hoy.jsonl`. Estás en un café, con una red de 20 Mb/s. Compara (a) `ssh ana@gw-node 'cat /var/log/gateway/hoy.jsonl' | grep 9f2c41d0` con (b) `ssh ana@gw-node 'grep 9f2c41d0 /var/log/gateway/hoy.jsonl'`. ¿Dónde corre cada `grep`? ¿Cuánto tarda cada uno, aproximadamente, si grep lee 500 MB/s?
- En (a), `cat` corre allá y manda el archivo completo por la red; el `grep` corre en tu laptop. Viajan 3 GB: 3 × 10⁹ × 8 ÷ (2 × 10⁷) = **1,200 s**, 20 minutos.
- En (b), lo que va entre comillas es el comando remoto completo: `grep` corre allá. Lee 3 GB en ≈ **6 s** y por la red viajan un par de líneas.
- (b) es ≈ 200 veces más rápido (1,200 ÷ 6); con la red de 100 Mb/s de la sección de ssh eran ≈ 40. La regla: lleva el comando a los datos, no los datos al comando.
- Cuidado con `ssh ana@gw-node grep 9f2c41d0 /var/log/gateway/hoy.jsonl | wc -l`: el `grep` corre allá, pero el `| wc -l` lo resuelve tu shell local, porque no está entre comillas. Aquí da lo mismo; con un `>` o un comodín, no.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M05 · Contenedores** está escrito en comandos: `docker build`, `docker run` con `\` al final de cada línea, `docker history`, variables como `SHA=$(git rev-parse --short=7 HEAD)`, la forma exec del `CMD` y la `sh` que se vuelve PID 1 en la forma shell.
- **M06 · Orquestación y escalado** usa `kubectl get`, `describe` y `rollout` para mirar y cambiar el cluster, y el código 137 de los pods que se quedan sin memoria.
- **La hoja de referencia «Docker y kubectl»** junta los comandos de los dos módulos (ahí están `kubectl logs --previous`, `apply` y los códigos 137 y 143), con un método para depurar pods: síntoma, comandos y causa típica. Ahora la puedes leer como una lista de tuberías.
- **C01** trae los comandos para probar el gateway: `curl` con una foto, `pytest`, `docker compose up --build` y `bash model/build_engine.sh`.

**En el Dojo:** la estación 7, «Empaquetado (Docker)», se trabaja desde la terminal: construir la imagen del gateway, correrla, leer sus logs y entrar con `docker exec`. La estación 9, «Kubernetes», cuando abra, usa `kubectl` para todo lo que se ve en esta lección.

**En Sensei:** la siguiente lección, «Python, paquetes y entornos», explica qué hace `pip install` y por qué activar un entorno es cambiar PATH. Después, «Git: versiones del código» y «Pruebas y CI/CD» son casi todo comandos, y «Configuración: YAML, variables de entorno y secretos» usa las variables de entorno de esta lección para configurar el gateway de C01.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
terminal shell comando argumento-cli directorio-trabajo variable-entorno path-shell flujos-estandar redireccion pipe comodin script-shell shebang sudo ssh
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuál es la diferencia entre la terminal y la shell?
La terminal es la ventana: pasa lo que tecleas y dibuja el texto que recibe. La shell es el programa que corre adentro: lee la línea, la parte en palabras, busca el programa y lo lanza. bash, zsh y sh son shells.
? ¿Por qué `rm mis fotos` no borra el archivo «mis fotos»?
Porque la shell separa los argumentos por los espacios: `rm` recibe `mis` y `fotos`, dos nombres distintos. Para que sea uno, va entre comillas: `rm "mis fotos"`.
? ¿Qué es PATH y qué pasa si un programa no está en ninguna de sus carpetas?
Una variable de entorno con una lista de carpetas, separadas por `:`, donde la shell busca los programas en orden. Si no lo encuentra en ninguna, responde «command not found» con el código 127.
? Si haces `export MODELO=resnet50` en tu terminal, ¿lo ve un servidor que ya estaba corriendo?
No. Las variables se copian al nacer cada proceso, de padre a hijo. Un proceso que ya existía tiene su propia copia; hay que reiniciarlo para que vea el valor nuevo.
? ¿Qué hace `grep 504 gateway.log | wc -l`, y cuántos procesos corren?
Dos procesos a la vez, unidos por un tubo: `grep` deja pasar las líneas que contienen 504 y `wc -l` las cuenta. Lo que imprime `grep` no sale en la pantalla: entra a `wc`.
? ¿Qué pide cada letra de `set -euo pipefail`?
`-e`: detenerse en el primer comando que falle. `-u`: error si se usa una variable que no existe. `-o pipefail`: que una tubería falle si falla cualquiera de sus comandos, no solo el último.
? ¿Por qué no hay `sudo` dentro de un contenedor?
Porque la imagen ya trae lo que necesita y el proceso corre con el usuario que dice su receta. No hay nada que instalar como root mientras corre, y agregar `sudo` solo le daría a un atacante una forma de subir de privilegios.
:::
