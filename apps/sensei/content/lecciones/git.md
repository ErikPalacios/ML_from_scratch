---
titulo: Git: versiones del código
en: Git: versioning your code
subtitulo: Cómo guarda Git cada versión de un proyecto con un nombre que no se puede falsificar, cómo trabajan varias personas en el mismo código sin pisarse y cómo se vuelve a la versión de ayer cuando la de hoy truena.
pregunta: El modelo de Alba que está en producción salió de cierto código; ¿cómo sé exactamente cuál era, cómo trabajamos cinco personas en el mismo gateway sin pisarnos y cómo regreso a la versión de ayer si la de hoy falla?
requisitos: terminal, tiempo-hash
---

:::idea
Git guarda fotos completas de un proyecto, una tras otra, y nombra cada foto con el hash de todo lo que contiene, incluido el nombre de la foto anterior. Por eso un id corto como `3f9c2ab` dice exactamente qué código corre en producción, las ramas dejan trabajar a cinco personas a la vez sin pisarse, y volver a ayer es pedirle a Git una foto que ya tiene.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. El modelo corre en Triton, un servidor de modelos, y delante tiene un gateway: un programa en Python que recibe los bytes de la foto que manda la app, los convierte en un tensor de 602,112 bytes y se lo manda a Triton. Lo mantienen las cinco personas del equipo de ML de Alba, y cada semana cambia algo: un [[timeout]] (cuánto espera a Triton antes de rendirse), un límite, una línea de log.

Un martes a las 11 de la noche, la versión nueva empieza a responder errores. Para arreglarlo hay que contestar tres preguntas, y rápido. ¿Qué código exacto está corriendo? ¿Qué cambió desde ayer, y quién lo cambió? ¿Cómo vuelvo a lo de ayer sin perder lo de hoy?

Sin una herramienta, la respuesta es una carpeta llena de copias: `gateway_final.py`, `gateway_final2.py`, `gateway_ahora_si.py`. Nadie sabe cuál está en el servidor ni en qué se distinguen. La herramienta que usa casi todo el mundo para no llegar ahí se llama Git.

En esta lección vas a armar repositorios desde cero, con comandos que puedes copiar a tu [[terminal]]: guardar versiones, crear ramas, unirlas, chocar con un conflicto y resolverlo, subir a un servidor, marcar una versión y deshacer un error. Al final vas a poder seguir el hilo del sistema de Alba de punta a punta: del modelo que está en producción al commit exacto que lo produjo.

## Qué es Git y qué guarda un repositorio {What Git is and what a repository holds}

[[git|Git]] es un programa que guarda la historia de un proyecto. Cada vez que se lo pides, toma una foto completa de todos sus archivos y la agrega a la lista, con quién la tomó, cuándo y por qué. Lo escribió Linus Torvalds, el creador de Linux, en abril de 2005 para el código de Linux, y hoy es, por mucho, el más usado.

Dos ideas lo distinguen:

- **Guarda fotos, no diferencias.** Cada versión es el proyecto entero, tal como estaba. Si un archivo no cambió, la foto nueva no lo vuelve a copiar: apunta al mismo contenido de antes. Por eso mil versiones no ocupan mil veces el espacio.
- **Es distribuido** (*distributed*). Cada persona tiene en su computadora la historia completa, no solo la última versión. Puede ver versiones viejas, compararlas y guardar nuevas sin internet. El servidor (GitHub, por ejemplo, un sitio que guarda proyectos en internet) es una copia más: la que el equipo acuerda usar para juntar su trabajo.

«Foto» es una manera de decirlo, y se rompe en dos puntos. No es una imagen: son los bytes de cada archivo, tal como estaban. Y una foto de verdad se puede retocar; en Git, como vas a ver en la sección 2, retocar una foto vieja le cambia el nombre a ella y a todas las que siguen.

### El repositorio y sus tres lugares

Un [[repositorio]] (*repository*, o *repo*) es la carpeta de un proyecto que Git vigila. Se reconoce porque adentro tiene una carpeta oculta llamada `.git`: en la lección del sistema operativo viste que los nombres que empiezan con punto no aparecen en un `ls` normal. Ahí vive toda la historia. Si borras `.git`, tus archivos se quedan, pero la historia desaparece.

Un cambio del repositorio pasa por tres lugares:

1. **El área de trabajo** (*working tree*): los archivos que ves y editas, como en cualquier carpeta. No la confundas con el [[directorio-trabajo|directorio de trabajo]] de la terminal, que es la carpeta donde estás parado.
2. **El staging** (*staging area*, también llamado *index*): una zona de preparación con lo que va a entrar en la próxima foto. Se llena con `git add`.
3. **El historial** (*history*): las fotos ya guardadas, dentro de `.git`. Cada foto nueva se toma con `git commit`.

¿Para qué el paso de en medio? Porque casi nunca quieres guardar todo lo que cambiaste. Arreglaste un bug y, de paso, dejaste un `print` para depurar: con el staging metes el arreglo a la foto y dejas el `print` fuera. Así cada foto tiene un solo propósito, y es fácil de leer y de deshacer.

:::figura git-tres-lugares
Los tres lugares de un cambio. Editas en el área de trabajo, eliges con `git add` lo que va a la próxima foto y la tomas con `git commit`. Las dos letras de `git status --short` dicen dónde está cada archivo.
:::

### Tu primer repositorio

Antes de usar Git en tu computadora, dile quién eres: ese nombre y ese correo van en cada foto que tomes. `--global` quiere decir «para todos los repositorios de esta computadora». La tercera línea pide que la primera rama de cada repositorio nuevo se llame `main` (en la sección 3 ves qué es una rama). Sin ella, Git la llama `master` y los bloques de esta lección que dicen `main` fallan en tu máquina. Es una ilustración, sin salida, y se hace una sola vez:

```bash
git config --global user.name "Ana"
git config --global user.email "ana@ejemplo.mx"
git config --global init.defaultBranch main
```

Ahora arma un repositorio con un archivo de configuración del gateway. `git status --short` dice en qué lugar está cada archivo con dos letras: la primera habla del staging y la segunda, del área de trabajo.

```bash
git init -q gateway && cd gateway          # una carpeta nueva, con su .git adentro
echo 'INFER_TIMEOUT_S = 0.15' > config.py  # el primer archivo del proyecto
echo "1) archivo nuevo:";   git status --short
git add config.py
echo "2) en el staging:";   git status --short
git commit -q -m "Agrega el timeout"
echo "3) en el historial:"; git status --short
echo 'INFER_TIMEOUT_S = 0.20' > config.py
echo "4) cambiado:";        git status --short
git add config.py
echo "5) en el staging:";   git status --short
git commit -q -m "Sube el timeout a 0.20 s"
git log --oneline
```

```salida
1) archivo nuevo:
?? config.py
2) en el staging:
A  config.py
3) en el historial:
4) cambiado:
 M config.py
5) en el staging:
M  config.py
139f652 Sube el timeout a 0.20 s
1e53ceb Agrega el timeout
```

Cómo se lee:

- `??`: Git ve el archivo, pero no lo sigue (*untracked*). Todavía no es parte del proyecto.
- `A` en la primera columna: el archivo nuevo ya está en el staging, listo para la foto.
- Nada: todo lo del área de trabajo ya está en el historial. Se dice que el árbol está **limpio** (*clean*).
- `M` en la segunda columna: cambiaste un archivo que Git ya seguía, pero el cambio no está en el staging.
- `M` en la primera columna: el cambio ya está en el staging.

`git log --oneline` lista las fotos de la más nueva a la más vieja: un id de 7 caracteres y el mensaje. La opción `-q` (*quiet*) solo calla los avisos. Sin `--short`, `git status` dice lo mismo en frases completas, en inglés, como todos los mensajes de Git.

:::nota Los ids de estos bloques
Cada bloque de la lección corre en un Linux nuevo, con Git 2.47, con `init.defaultBranch` en `main` y con un autor y una fecha fijos: Ana, el 6 de noviembre de 2026 a las 12:00, hora del centro de México. Por eso sus ids salen iguales cada vez que se corren. En tu máquina van a salir otros, porque llevan tu nombre y tu hora. La sección siguiente explica por qué.
:::

## El commit: una foto con nombre de hash {The commit: a snapshot named by its hash}

Cada foto del historial es un [[commit]], del inglés *to commit*, comprometerse: «esto queda así». Un commit guarda cinco cosas:

1. **El árbol** (*tree*): la lista de archivos de esa versión, cada uno con el id de su contenido.
2. **El padre** (*parent*): el id del commit anterior. El primero de un repositorio no tiene.
3. **El autor**, con su correo y la fecha.
4. **Quién lo guardó** (*committer*): casi siempre, el mismo autor a la misma hora.
5. **El mensaje**: una línea que dice qué cambió, y de preferencia por qué.

Git te deja ver un commit tal como lo guarda. Este bloque repite los dos commits de la sección anterior y abre el último. (`-am` es `-a`, «mete al staging lo que cambió en archivos que ya sigues», más `-m`, el mensaje.)

```bash
git init -q gateway && cd gateway
echo 'INFER_TIMEOUT_S = 0.15' > config.py && git add . && git commit -q -m "Agrega el timeout"
echo 'INFER_TIMEOUT_S = 0.20' > config.py && git commit -q -am "Sube el timeout a 0.20 s"
git cat-file -p HEAD                 # el commit, tal como Git lo guarda
echo ---
git cat-file -p 'HEAD^{tree}'        # su árbol: la lista de archivos
git hash-object config.py            # el id que Git le da a ese contenido
```

```salida
tree 06f54d93eba2a182c98eedd0a401b6af0deb0763
parent 1e53cebd92b55f3f6e95e4b929fc481844a9e5d5
author Ana <ana@ejemplo.mx> 1793988000 -0600
committer Ana <ana@ejemplo.mx> 1793988000 -0600

Sube el timeout a 0.20 s
---
100644 blob 6f61d2c5f6c20d3b99d7e5e6fa317328c9a8a07c	config.py
6f61d2c5f6c20d3b99d7e5e6fa317328c9a8a07c
```

El commit entero son unas cuantas líneas de texto. La fecha va en tiempo Unix, los segundos desde 1970 de la lección de tiempo y hashes: `1793988000` es el 6 de noviembre de 2026 a las 12:00, y `-0600` dice la zona. `HEAD` es «el commit donde estás»; lo ves a fondo en la sección siguiente. El árbol tiene una sola línea: `config.py`, con el id de su contenido (`100644` dice que es un archivo normal, que no se ejecuta). A ese contenido, los bytes del archivo sin su nombre, Git le dice **blob** (un nombre que viene de las bases de datos, donde *blob* es *binary large object*, un objeto binario grande).

### El id es la huella de todo lo anterior

¿De dónde sale el id? Git junta el tipo de objeto, su tamaño en bytes y su contenido, y les calcula un [[hash-criptografico|hash criptográfico]], la huella de la lección de tiempo y hashes: \(text{id} = text{SHA-1}(text{encabezado} + text{contenido})\), donde el encabezado es el tipo, un espacio, el tamaño y un byte en cero. Por omisión usa SHA-1, de 160 bits, que se escribe con 40 caracteres hexadecimales (cada uno, del 0 al 9 o de la a a la f, vale 4 bits). Si cambia un solo byte, cambia toda la huella.

Lo puedes comprobar sin Git, con `hashlib`, que viene con Python:

```python
import hashlib

def id_git(tipo, contenido):              # así nombra Git cada objeto que guarda
    encabezado = f"{tipo} {len(contenido)}\0".encode()   # texto → bytes; \0 es un byte en cero
    return hashlib.sha1(encabezado + contenido).hexdigest()

archivo = b"INFER_TIMEOUT_S = 0.20\n"     # b"…" son bytes; \n, el salto de línea del final
print("blob   ", id_git("blob", archivo))

commit = (b"tree 06f54d93eba2a182c98eedd0a401b6af0deb0763\n"
          b"parent 1e53cebd92b55f3f6e95e4b929fc481844a9e5d5\n"
          b"author Ana <ana@ejemplo.mx> 1793988000 -0600\n"
          b"committer Ana <ana@ejemplo.mx> 1793988000 -0600\n"
          b"\n"
          b"Sube el timeout a 0.20 s\n")
print("commit ", id_git("commit", commit)[:7], f"({len(commit)} bytes)")
otro = commit.replace(b"0.20 s", b"0.2 s")        # un solo carácter menos en el mensaje
print("otro   ", id_git("commit", otro)[:7])
```

```salida
blob    6f61d2c5f6c20d3b99d7e5e6fa317328c9a8a07c
commit  139f652 (213 bytes)
otro    c27a81e
```

El blob coincide con el de `git hash-object`, y el commit, con el `139f652` de la sección 1: el id de un commit es el SHA-1 de esos 213 bytes, precedidos por `commit 213` y un byte en cero (`\0`). Con un carácter menos en el mensaje, el id es otro.

De aquí sale la propiedad más importante de Git. Dentro de cada commit va el id de su padre; el padre lleva el del abuelo, y así hasta el primero. **Cambiar cualquier cosa del pasado cambia el id de ese commit y el de todos los que vienen después.** Mira dos historias con los mismos archivos, que solo difieren en el mensaje del primer commit:

```bash
historia() {    # una función: arma el mismo proyecto; $1 es la carpeta y $2 el primer mensaje
  git init -q "$1" && cd "$1"
  echo 'INFER_TIMEOUT_S = 0.15' > config.py && git add . && git commit -q -m "$2"
  echo 'PREPROCESS_CONCURRENCY = 2' >> config.py && git commit -q -am "Limita el preprocesamiento"
  echo 'TOP_K = 5' >> config.py && git commit -q -am "Regresa el top-5"
  git log --oneline && cd ..
}
historia original "Agrega el timeout"
echo ---
historia corregida "Agrega el timeout de Triton"
echo ---
cmp original/config.py corregida/config.py && echo "config.py es idéntico en las dos"
```

```salida
19fc2c8 Regresa el top-5
811804c Limita el preprocesamiento
1e53ceb Agrega el timeout
---
68c0bfe Regresa el top-5
529d5c3 Limita el preprocesamiento
c4d6f12 Agrega el timeout de Triton
---
config.py es idéntico en las dos
```

`historia` es una función de bash: un nombre para un grupo de comandos, que aquí se usa dos veces; `$1` y `$2` son los argumentos con que se llama. `>>` agrega una línea al final del archivo, y `cmp` compara dos archivos byte por byte.

:::figura git-cadena
Cada commit guarda el id de su padre. Si cambias el mensaje del primero, cambia su id; el segundo guarda ese id nuevo y también cambia, y así hasta el último. Los archivos son idénticos en las dos historias.
:::

Fíjate en otra cosa: «Agrega el timeout» se llama `1e53ceb` aquí y en la sección 1. Mismo archivo, mismo autor, misma fecha, mismo mensaje y ningún padre: es el mismo commit. El id no es un número de turno que alguien reparte; es la huella del contenido. Por eso dos personas en dos países pueden crear commits sin preguntarle a nadie, y por eso un id dice sin ambigüedad de qué código hablas. Nadie puede cambiar el código de `3f9c2ab` y conservar el nombre.

:::ojo Tres «commits» distintos
En la lección de bases de datos, `COMMIT` cierra una [[transaccion|transacción]]: «estas escrituras pasan todas juntas». En la de colas, hacer *commit* de un [[offset]] es avisar «ya procesé hasta aquí». Un commit de Git es otra cosa: una foto del proyecto con su historia. Comparten la palabra porque las tres dicen «esto queda firme».
:::

### El hash corto

Nadie escribe 40 caracteres. Git acepta el principio del id mientras ningún otro objeto empiece igual, y casi siempre muestra 7: `1e53ceb`. El gateway de Alba usa esos 7 caracteres como nombre de su imagen (el paquete del que nacen sus contenedores, de la lección del sistema operativo): se llama `classifier-gateway:3f9c2ab`.

:::cuenta ¿Cuántos ids caben en 7 caracteres?
Un carácter hexadecimal // del 0 al 9 y de la a a la f | 16 valores | 4 bits
Bits de \(k\) = 7 caracteres // \(k\): los caracteres del id corto | \(4 × k\) = 7 × 4 bits | 28 bits
Combinaciones \(M\) // los prefijos distintos que caben en \(k\) caracteres | \(M = 16^k\) = 16⁷ | 268,435,456
El id completo // 40 caracteres | 16⁴⁰ = 2¹⁶⁰ | ≈ 1.5 × 10⁴⁸
= Con 7 caracteres caben ≈ 268 millones de prefijos distintos. Parece muchísimo, pero en un proyecto grande dos objetos empiezan igual antes de lo que crees: lo ves en el bloque de abajo.
:::

:::profundo ¿Cuándo dejan de alcanzar 7 caracteres?
Es el problema del cumpleaños: en un salón de 23 personas, la probabilidad de que dos cumplan el mismo día ya pasa de 50 %, porque lo que crece rápido es el número de **parejas**. Con \(n\) objetos hay \(P\) parejas, y cada pareja empieza igual con probabilidad \(1/M\). La probabilidad de que alguna pareja choque es, muy aproximadamente:

:::formula Probabilidad de que dos ids cortos empiecen igual
M = 16^k
P = frac{n × (n − 1)}{2}
Pr ≈ 1 − e^{−P/M}
- k: los caracteres del id corto (7 casi siempre)
- M: los prefijos distintos que caben en \(k\) caracteres
- n: los objetos del repositorio (commits, árboles y blobs)
- P: las parejas de objetos que se pueden formar
- Pr: la probabilidad de que al menos una pareja empiece igual, de 0 a 1
- e: el número 2.718…, la base de los logaritmos naturales
:::

Con \(n\) = 10,000 objetos y \(k\) = 7: \(P\) = 10,000 × 9,999 ÷ 2 = 49,995,000 parejas; \(P/M\) = 49,995,000 ÷ 268,435,456 ≈ 0.186, y \(Pr ≈ 1 − e^{−0.186}\) ≈ **17 %**. Con 50,000 objetos, ≈ **99 %** (el ejercicio de los 50,000 objetos lo hace paso a paso). Y los objetos no son solo commits: cada versión de cada archivo es un blob y cada carpeta de cada commit es un árbol, así que un proyecto con unos miles de commits ya tiene decenas de miles.

Cuando dos objetos empiezan igual, Git alarga el id de esos dos lo necesario. Además, desde la versión 2.11 elige solo cuántos caracteres mostrar según el tamaño del repositorio: en uno enorme, como el de Linux, muestra unos 12. Por eso `git rev-parse --short=7 HEAD`, el comando con el que Alba nombra sus imágenes, da 7 caracteres, o más si otro objeto empieza igual. (CI es el sistema que prueba y empaqueta solo cada cambio; lo ves en la lección siguiente.)

Y el SHA-1 de 40 caracteres, ¿no está roto? En la lección de hashes viste que en 2017 se fabricó el primer choque. Git respondió ese mismo año (en la versión 2.13, de mayo de 2017) con una versión de SHA-1 que detecta los choques fabricados así. Además, desde la 2.29 (2020) puede crear repositorios con SHA-256, que desde la 2.42 (2023) ya no se marcan como experimentales; pero los repositorios de SHA-1 y los de SHA-256 todavía no se hablan entre sí, y GitHub aún no los acepta (noviembre de 2026). Git 3.0, que todavía no tiene fecha, planea usar SHA-256 por omisión en los repositorios nuevos. Para que dos commits distintos tengan el mismo id completo por accidente, haría falta una cantidad de objetos que ningún repositorio va a tener.

:::calculadora git-hash-corto
Prueba con 50,000 objetos y sube los caracteres de uno en uno: ¿con cuántos baja la probabilidad de un choque a menos de 1 %?
:::
:::

## Ramas y merge {Branches and merge}

Una [[rama]] (*branch*) es un nombre que apunta a un commit. Nada más. `main` es el nombre que casi todos usan para la primera rama: GitHub lo usa por omisión desde 2020. Git, hasta la versión 2.x, todavía la llama `master` si no le configuras `init.defaultBranch` (por eso la tercera línea de la sección 1), y Git 3.0 planea cambiar a `main`. En repositorios viejos vas a ver `master`. Cuando haces un commit estando en una rama, el nombre avanza solo al commit nuevo: por eso se dice que una rama es una etiqueta que se mueve.

Git guarda cada rama como un archivo de texto dentro de `.git/refs/heads/`, con el id completo de su commit:

:::cuenta Lo que ocupa una rama
El archivo de la rama // en .git/refs/heads/ | 40 caracteres del id + un salto de línea | 41 bytes
HEAD // ref: refs/heads/main | 20 caracteres + un salto de línea | 21 bytes
Cien ramas | 100 × 41 bytes | 4,100 bytes ≈ 4 KB
= Crear una rama es escribir 41 bytes. No copia ni un archivo del proyecto: por eso se crean ramas para cualquier cosa, aunque vivan una hora.
:::

(Cuando hace limpieza, Git junta las ramas en un solo archivo, `.git/packed-refs`. Y Git 3.0 planea guardar las ramas por omisión en un formato nuevo, *reftable*, en archivos binarios. La idea es la misma: una rama es un nombre y un id.)

**HEAD** es como Git sabe dónde estás. Es otro archivo, `.git/HEAD`, que casi siempre dice el nombre de una rama: `ref: refs/heads/main`. El commit al que apunta esa rama es el «actual»: de ahí sale lo que ves en tu área de trabajo, y ahí se cuelga el próximo commit.

`git switch -c top-k` crea la rama `top-k` y te pasa a ella. `git switch` existe desde Git 2.23 (2019); en tutoriales viejos vas a ver `git checkout -b top-k`, que hace lo mismo. Cambiar de rama sí toca tus archivos: Git deja el área de trabajo como está en el commit de esa rama.

### Unir dos ramas

Trabajas en tu rama hasta que el cambio está listo y entonces lo unes a `main`: eso es un [[merge]] (unir, fusionar). Hay dos casos:

- **Fast-forward** («adelantar»): si `main` no se movió desde que saliste, no hay nada que mezclar. Git solo adelanta la etiqueta `main` hasta tu último commit.
- **Commit de merge** (*merge commit*): si `main` avanzó mientras tanto, cada rama tiene commits que la otra no tiene. Git crea un commit nuevo que junta las dos versiones, y ese commit tiene **dos padres**.

```bash
git init -q gateway && cd gateway
echo 'INFER_TIMEOUT_S = 0.15' > config.py && git add . && git commit -q -m "Agrega el timeout"
git switch -c top-k                        # crea la rama y te pasa a ella
echo 'TOP_K = 5' >> config.py && git commit -q -am "Regresa el top-5"
git switch -q main
git merge top-k                            # main no se movió: basta con adelantar su etiqueta
git log --oneline --graph
echo "--- otra vez, pero ahora main avanza mientras tanto"
git switch -q -c logs
echo 'LOG_LEVEL = "info"' > logs.py && git add . && git commit -q -m "Agrega el nivel de log"
git switch -q main
echo 'PREPROCESS_CONCURRENCY = 2' >> config.py && git commit -q -am "Limita el preprocesamiento"
git merge -q -m "Une la rama logs" logs    # aquí sí hace falta un commit que una las dos
git log --oneline --graph
git cat-file -p HEAD | grep parent         # el commit de merge tiene dos padres
```

```salida
Switched to a new branch 'top-k'
Updating 1e53ceb..821910a
Fast-forward
 config.py | 1 +
 1 file changed, 1 insertion(+)
* 821910a Regresa el top-5
* 1e53ceb Agrega el timeout
--- otra vez, pero ahora main avanza mientras tanto
*   9341d8a Une la rama logs
|\
| * 26b7ad8 Agrega el nivel de log
* | 60006fd Limita el preprocesamiento
|/
* 821910a Regresa el top-5
* 1e53ceb Agrega el timeout
parent 60006fd5a144430dbf67599b7dd649b79150c264
parent 26b7ad82f63f926d4144ebc4c244d8a21f69e8ee
```

`--graph` dibuja la historia con letras: cada `*` es un commit y las rayas unen cada commit con sus padres. La primera unión fue un fast-forward («Updating 1e53ceb..821910a», de un commit al otro): no se creó ningún commit, y las dos líneas que siguen dicen que cambió un archivo, con una línea nueva. La segunda creó `9341d8a`, con dos líneas `parent`. `grep parent` se queda solo con las líneas que dicen *parent*.

:::figura git-merge
Arriba, un fast-forward: `main` no se había movido, así que su etiqueta solo avanza al commit de la rama. Abajo, un commit de merge: las dos ramas avanzaron por separado y `9341d8a` las junta con dos padres.
:::

¿Cómo junta Git dos versiones? Busca el último commit que las dos ramas tienen en común, la **base** (aquí, `821910a`), y compara cada rama contra ella. Una rama cambió `config.py` y la otra creó `logs.py`: no se estorban, así que Git toma los dos cambios sin preguntar. Lo mismo si las dos cambian líneas distintas del mismo archivo, siempre que no estén pegadas. El problema llega cuando las dos cambian la misma línea, o dos líneas vecinas: Git no sabe en qué orden ponerlas.

## Conflictos y rebase {Merge conflicts and rebase}

Hay un [[conflicto-merge|conflicto de merge]] (*merge conflict*) cuando las dos ramas cambiaron las mismas líneas del mismo archivo (o líneas pegadas), cada una a su manera, desde la base. Git no adivina cuál quieres. Se detiene, marca el pedazo en disputa dentro del archivo y te deja decidir.

En este bloque, Luis sube el timeout en su rama y Ana lo baja en `main`:

```bash
git init -q gateway && cd gateway
echo 'INFER_TIMEOUT_S = 0.15' > config.py && git add . && git commit -q -m "Agrega el timeout"
git switch -q -c luis                      # Luis sube el timeout en su rama
echo 'INFER_TIMEOUT_S = 0.25' > config.py && git commit -q -am "Sube el timeout a 0.25 s"
git switch -q main                         # y Ana, en main, lo baja
echo 'INFER_TIMEOUT_S = 0.10' > config.py && git commit -q -am "Baja el timeout a 0.10 s"
git merge luis
echo "--- así quedó config.py:"
cat config.py
git status --short                         # UU: los dos lados cambiaron esta línea
echo 'INFER_TIMEOUT_S = 0.15' > config.py  # Ana y Luis lo hablan y deciden
git add config.py && git commit -q --no-edit
git log --oneline --graph
```

```salida
Auto-merging config.py
CONFLICT (content): Merge conflict in config.py
Automatic merge failed; fix conflicts and then commit the result.
--- así quedó config.py:
<<<<<<< HEAD
INFER_TIMEOUT_S = 0.10
=======
INFER_TIMEOUT_S = 0.25
>>>>>>> luis
UU config.py
*   c31841c Merge branch 'luis'
|\
| * f6f8c36 Sube el timeout a 0.25 s
* | 82105c2 Baja el timeout a 0.10 s
|/
* 1e53ceb Agrega el timeout
```

Los marcadores de conflicto (*conflict markers*) parten el pedazo en dos:

- De `<<<<<<< HEAD` a `=======`: tu versión, la de la rama donde estás parado (`main`).
- De `=======` a `>>>>>>> luis`: la versión de la rama que estás uniendo.

Para resolverlo:

:::pasos
1. Decide
Abre el archivo y elige: tu versión, la otra o una tercera, como aquí. Si no sabes, pregunta: un conflicto es una conversación pendiente.
2. Borra los marcadores
Un archivo con `<<<<<<<` adentro no es Python válido. Si llega así a un commit, el gateway ni siquiera arranca.
3. Avisa que ya quedó
`git add config.py` le dice a Git que el archivo está resuelto.
4. Termina el merge
`git commit` crea el commit de merge; con `--no-edit` acepta el mensaje que Git propone. Si te arrepientes antes, `git merge --abort` deja todo como estaba.
:::

Lo difícil de un conflicto casi nunca es Git: es la decisión. Que el gateway espere a Triton 0.10 o 0.25 segundos antes de rendirse es una pregunta de diseño, y se contesta hablando, no eligiendo al azar. Aquí lo dejaron en 0.15, el valor que usa Alba: 150 ms. Y los conflictos se evitan con ramas cortas, cambios chicos y trayendo lo nuevo de `main` seguido: dos ramas que se separan una semana chocan mucho más que dos que se separan una hora.

### Rebase: poner tus commits encima

Hay otra forma de traer lo nuevo de `main` a tu rama. [[rebase|Rebase]] (cambiar la base) toma tus commits y los vuelve a aplicar, uno por uno, encima del último commit de otra rama. La historia queda en línea recta, como si hubieras empezado tu trabajo hoy. `main..logs` quiere decir «los commits de `logs` que `main` no tiene».

```bash
git init -q gateway && cd gateway
echo 'INFER_TIMEOUT_S = 0.15' > config.py && git add . && git commit -q -m "Agrega el timeout"
git switch -q -c logs
echo 'LOG_LEVEL = "info"' > logs.py && git add . && git commit -q -m "Agrega el nivel de log"
echo 'LOG_FORMAT = "json"' >> logs.py && git commit -q -am "Escribe los logs en JSON"
git switch -q main
echo 'TOP_K = 5' >> config.py && git commit -q -am "Regresa el top-5"
git switch -q logs
echo "antes:";   git log --oneline main..logs
git rebase -q main
echo "después:"; git log --oneline main..logs
git log --oneline --graph
```

```salida
antes:
707221d Escribe los logs en JSON
0750449 Agrega el nivel de log
después:
a8b1758 Escribe los logs en JSON
26b7ad8 Agrega el nivel de log
* a8b1758 Escribe los logs en JSON
* 26b7ad8 Agrega el nivel de log
* 821910a Regresa el top-5
* 1e53ceb Agrega el timeout
```

Mira los ids: los dos commits traen los mismos cambios y los mismos mensajes, pero ids nuevos. Ya sabes por qué: cambió su padre. Rebase no mueve commits. Crea copias nuevas y deja los originales sin ninguna rama que los nombre.

:::figura git-rebase
Antes, la rama `logs` salía de `1e53ceb`. Después del rebase, sus dos commits se rehicieron encima de `821910a`, con ids nuevos. Los originales siguen en `.git` un tiempo, pero ya ninguna rama los nombra.
:::

De ahí sale la regla de oro: **no hagas rebase de commits que otros ya bajaron.** Si Luis tiene `0750449` en su computadora y tú lo reemplazas por `26b7ad8`, ahora hay dos historias con el mismo trabajo. Al juntarlas, los cambios aparecen dos veces y los conflictos se multiplican. En tu rama, antes de compartirla, rebase lo que quieras. En `main`, nunca.

:::profundo ¿Merge o rebase?
Las dos traen lo mismo: el código final es idéntico. Cambia cómo se ve la historia.

- **Merge** conserva lo que pasó de verdad: cuándo se separó cada rama y cuándo volvió. A cambio, en un equipo grande la historia se llena de commits de merge y de rayas cruzadas.
- **Rebase** deja una línea recta, fácil de leer y de recorrer con `git log`. A cambio, reescribe commits, con la regla de oro de arriba.

Muchos equipos combinan: rebase en tu rama para ponerla al día, y al final, al unirla en GitHub con el botón del pull request (la sección siguiente), una de sus tres opciones: un commit de merge, *squash* (todos los commits de la rama se aplastan en uno solo) o rebase. `git rebase -i` (de *interactive*) además te deja reescribir tus commits antes de compartirlos: juntar en uno tres commits de «arreglo un error de dedo» (*typo*) o corregir un mensaje.
:::

## Remotos, pull requests y revisión de código {Remotes, pull requests and code review}

Hasta aquí todo pasó en una sola carpeta. Para que cinco personas trabajen juntas, cada una tiene su copia del repositorio y se ponen de acuerdo en una copia central. Una copia de tu repositorio en otro lugar es un [[remoto-git|remoto]] (*remote*), y por costumbre el principal se llama `origin`. Casi siempre vive en un servicio como GitHub (de Microsoft) o GitLab, que guardan repositorios en internet y les agregan herramientas para trabajar en equipo.

Cuatro comandos mueven commits entre tu copia y el remoto:

| Comando | Qué hace |
|---|---|
| `git clone` | Baja el repositorio completo, con toda su historia, y apunta `origin` a esa dirección |
| `git fetch` | Baja los commits nuevos del remoto sin tocar tus ramas: quedan en `origin/main` |
| `git pull` | Un `fetch` y después une `origin/main` a tu rama. Si tu rama no tiene commits propios, solo la adelanta; si los tiene, el Git de hoy se niega hasta que elijas: `--rebase` o `--no-rebase` (merge) |
| `git push` | Sube tus commits y mueve la rama del remoto |

`push` tiene una protección: solo mueve la rama del remoto **hacia adelante**. Si alguien subió algo que tú no tienes, tu push se rechaza, porque si entrara borraría el trabajo de esa persona. Este bloque arma un GitHub de juguete en la misma máquina, un repositorio sin área de trabajo (*bare*), y dos personas que suben casi a la vez:

```bash
git init -q --bare servidor.git            # hace de GitHub: un repositorio sin área de trabajo
git init -q ana && cd ana
echo 'INFER_TIMEOUT_S = 0.15' > config.py && git add . && git commit -q -m "Agrega el timeout"
git remote add origin ../servidor.git      # «origin» es un apodo para esa dirección
git push -q origin main
cd .. && git clone -q servidor.git luis && cd luis
echo 'TOP_K = 5' > respuesta.py && git add . && git commit -q -m "Regresa el top-5"
git push -q origin main                    # Luis sube primero
cd ../ana
echo 'PREPROCESS_CONCURRENCY = 2' >> config.py && git commit -q -am "Limita el preprocesamiento"
git push origin main                       # a Ana le falta el commit de Luis
echo "--- Ana baja lo nuevo, pone su commit encima y vuelve a subir"
git pull -q --rebase origin main
git push -q origin main
git log --oneline
```

```salida
To ../servidor.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to '../servidor.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
--- Ana baja lo nuevo, pone su commit encima y vuelve a subir
4903ba0 Limita el preprocesamiento
32c5e47 Regresa el top-5
1e53ceb Agrega el timeout
```

El rechazo dice, en resumen: «el remoto tiene trabajo que tú no tienes; bájalo primero». Ana lo baja con `git pull --rebase`, que pone su commit encima del de Luis, y su segundo push entra. El rebase es seguro aquí porque su commit nunca se había subido. Con una dirección de GitHub en lugar de `../servidor.git`, los comandos son los mismos.

Existe `git push --force`, que sobrescribe la rama del remoto aunque se pierdan commits. En una rama que solo usas tú, después de un rebase, a veces hace falta. En `main` borra el trabajo de otros. Si lo necesitas, usa `--force-with-lease`, que se niega si el remoto cambió desde la última vez que lo viste. Y casi todos los equipos **protegen** `main` en GitHub, para que nadie pueda forzarla ni subir directo.

### El pull request

En un equipo, casi nadie hace push directo a `main`. Cada cambio va en su rama, la rama se sube y se abre un [[pull-request|pull request]] (PR): una página en GitHub que dice «quiero unir mi rama a `main`». En GitLab se llama *merge request* (MR), y es lo mismo.

El PR muestra el **diff** (las diferencias: en rojo las líneas que salen y en verde las que entran), los commits, la conversación y el resultado de las pruebas. Si alguien pide cambios, haces más commits en la misma rama y el PR se actualiza solo. Cuando se aprueba, un botón hace el merge.

### La revisión de código

La [[revision-codigo|revisión de código]] (*code review*) es que otra persona lea el cambio antes de unirlo. Lo que se revisa:

- **¿Hace lo que dice?** ¿Hay un caso que lo rompe, como una foto vacía o Triton caído?
- **¿Se entiende?** Quien lo lea en seis meses no va a poder preguntarte.
- **¿Tiene pruebas, y cubren lo que cambió?**
- **¿Mete algo que no debe?** Una contraseña, un archivo de pesos, una [[dependencia]] nueva sin razón.
- **En ML, además:** ¿cambia el preprocesamiento? Si cambia en el gateway y no en el entrenamiento, el modelo recibe entradas distintas de las que vio al aprender: el [[training-serving-skew]].

Lo que puede revisar una máquina, lo revisa una máquina. En cada PR corren solas las pruebas automáticas, la [[ci|integración continua]] (CI) de la lección siguiente; en Alba, las 26 pruebas automáticas (*tests*) del gateway. La persona se concentra en lo que la máquina no ve.

:::diagrama git-camino-cambio
El camino de un cambio en un equipo. Toca cada caja para ver por qué está ahí, o usa «Recorrer» para seguir un cambio que entra y uno que se detiene en la revisión.
:::

:::profundo Las reglas de main
En GitHub, una **regla de protección** (*branch protection rule*) sobre `main` puede pedir que todo entre por PR, que al menos una persona lo apruebe, que CI esté en verde y que nadie haga push con `--force`. Un archivo llamado `CODEOWNERS` dice quién tiene que aprobar los cambios de cada carpeta: por ejemplo, que el equipo de ML apruebe todo lo que toque `preprocess/`.

Y el tamaño importa. Un PR de 50 líneas se lee con calma en minutos; uno de 2,000 se aprueba sin leer de verdad. Los PRs chicos se revisan mejor, chocan menos y son más fáciles de revertir.
:::

## Lo que no entra: .gitignore, secretos y archivos grandes {What stays out: .gitignore, secrets and large files}

No todo lo que hay en la carpeta del proyecto debe entrar al historial. Lo que casi nunca entra:

- **`.venv/`**: el [[entorno-virtual|entorno virtual]] con las librerías instaladas. Se reconstruye en cualquier máquina a partir del [[lock-file|lock file]], que sí se versiona.
- **`__pycache__/`**: archivos que Python genera solo para arrancar más rápido.
- **`.env`**: el [[archivo-env|archivo .env]], con ajustes del programa y muchas veces con contraseñas (la lección de configuración lo presenta).
- **Pesos**: `*.pt` (el formato de PyTorch), `*.onnx` y `model.plan` (el modelo exportado para servirlo: [[onnx|ONNX]] y el [[engine-tensorrt|engine de TensorRT]], de la lección «Export, engine y paridad»). Alba, por ejemplo, no versiona su `model.plan` en Git.
- **Datos**: fotos, CSV, Parquet.

El archivo [[gitignore|.gitignore]], en la raíz del repositorio, lista patrones de lo que Git debe hacer como que no existe. Una línea que termina en `/` ignora una carpeta entera; con el [[comodin|comodín]] `*`, `*.pyc` ignoraría todo lo que termine en `.pyc`. `git check-ignore -v` dice qué línea ignora a cada archivo.

```bash
git init -q gateway && cd gateway
mkdir -p .venv/bin __pycache__ pesos datos
touch app.py .env .venv/bin/python __pycache__/app.cpython-313.pyc pesos/resnet50.pt datos/fotos.csv
printf '%s\n' '.venv/' '__pycache__/' '.env' 'pesos/' 'datos/' > .gitignore
git status --short --untracked-files=all   # solo aparecen dos archivos
git check-ignore -v .env pesos/resnet50.pt __pycache__/app.cpython-313.pyc
git check-ignore app.py || echo "app.py no se ignora"
echo "--- ignorar no saca lo que ya entró"
echo 'S3_KEY=clave-de-prueba' > llaves.txt
git add . && git commit -q -m "Primer gateway"   # llaves.txt entró por error
echo 'llaves.txt' >> .gitignore
git rm -q --cached llaves.txt && git commit -q -am "Deja de versionar llaves.txt"
git status --short                         # limpio: llaves.txt ya se ignora
git show HEAD~1:llaves.txt                 # pero el commit anterior todavía la tiene
```

```salida
?? .gitignore
?? app.py
.gitignore:3:.env	.env
.gitignore:4:pesos/	pesos/resnet50.pt
.gitignore:2:__pycache__/	__pycache__/app.cpython-313.pyc
app.py no se ignora
--- ignorar no saca lo que ya entró
S3_KEY=clave-de-prueba
```

`touch` crea archivos vacíos, `printf '%s\n'` escribe cada patrón en su línea y `--untracked-files=all` lista cada archivo suelto en vez de solo su carpeta. `S3_KEY` hace de llave de S3, el object storage de Amazon (es de mentira). De los siete archivos (los seis de `touch` y `.gitignore`), `git status` solo muestra dos. Cada línea de `check-ignore -v` dice el archivo `.gitignore`, el número de línea, el patrón y la ruta ignorada. Para `app.py` no hay patrón: `check-ignore` termina con un [[codigo-salida|código de salida]] distinto de 0 y `||` corre el `echo`.

La segunda mitad es la trampa: **ignorar no saca lo que ya entró.** `.gitignore` solo actúa sobre archivos que Git todavía no sigue. `llaves.txt` ya estaba en un commit, así que agregarlo a `.gitignore` no basta: hay que sacarlo con `git rm --cached`, que lo quita del repositorio pero deja el archivo en tu carpeta. Y aun así, `git show HEAD~1:llaves.txt` (el archivo tal como estaba en el padre de HEAD) lo enseña completo.

:::ojo Un secreto en un commit es un secreto publicado
Borrar un archivo en un commit nuevo no lo saca de la historia: cualquiera que clone el repositorio puede ver el commit viejo. Si una contraseña o una llave llegó a un commit que ya se subió, se da por filtrada. Lo primero es cambiarla por otra; después, si hace falta, se reescribe la historia con una herramienta como `git filter-repo`, la que recomienda la documentación de Git. Reescribir no basta solo: las copias que otros ya bajaron siguen teniendo la llave, por eso primero se cambia. La lección de configuración retoma qué es un [[secreto]] y dónde guardarlo para que nunca llegue al repositorio.
:::

### Archivos grandes: por qué los pesos no van en Git

Git guarda cada versión completa de cada archivo, y cada `clone` baja toda la historia. Con código no importa: un archivo de Python pesa kilobytes y se comprime muy bien. Con los pesos de un modelo, sí. Lo que pesa esa historia sale de tres multiplicaciones:

:::formula Lo que pesa la historia de los pesos
s = w × d
V = v × a
H = V × s
- w: los parámetros del modelo
- d: los bytes de cada parámetro (4 en FP32)
- s: lo que pesa una versión de los pesos, en MB
- v: las versiones nuevas por año
- a: los años de historia
- V: las versiones guardadas
- H: lo que pesa el historial de ese archivo, en MB; es también lo que baja cada clone
:::

:::cuenta Los pesos de Alba dentro de Git, dos años
Una versión \(s\) // la ResNet-50 de Alba en FP32: 24.5 millones de parámetros con su capa final de 500 categorías, 4 bytes cada uno | \(s = w × d\) = 24.5 millones × 4 bytes | ≈ 98 MB
Versiones \(V\) // un fine-tune al mes (\(v\) = 12) durante dos años (\(a\) = 2) | \(V = v × a\) = 12 × 2 | 24
El historial \(H\) // los pesos casi no se comprimen: son números que parecen al azar | \(H = V × s\) = 24 × 98 MB | ≈ 2.35 GB
Lo que baja cada clone // una persona nueva, o CI: toda la historia | \(H\) | ≈ 2.35 GB
= Para usar los 98 MB de los pesos de hoy, cada clone baja 24 veces más. Y la historia nunca adelgaza: borrar el archivo no borra sus versiones.
:::

GitHub, además, pone límites (según su documentación, en noviembre de 2026): avisa cuando subes un archivo de más de 50 MiB, rechaza los de más de 100 MiB y recomienda que el repositorio completo pese idealmente menos de 1 GB, y de preferencia menos de 5 GB. Los ≈ 2.35 GB de la cuenta ya se pasan del primero. Un MiB son 1,048,576 bytes (2²⁰), un poco más que un MB (1,000,000), así que los pesos de Alba, \(s\) = 98 MB = 98,000,000 bytes, son 98,000,000 ÷ 1,048,576 ≈ 93.5 MiB: entrarían, con aviso. Los pesos de casi cualquier LLM, no.

[[git-lfs|Git LFS]] (*Large File Storage*, almacén de archivos grandes) es una extensión de Git para estos archivos. El repositorio guarda, en lugar del archivo, un **puntero**: un texto de tres líneas con el hash SHA-256 del archivo y su tamaño. El archivo de verdad vive en un servidor aparte, y Git LFS lo baja solo cuando pides esa versión. Ojo: ese servidor sí guarda todas las versiones, y GitHub las cobra aparte. En noviembre de 2026, el plan gratuito incluye 10 GiB de almacenamiento y 10 GiB de descargas al mes, y cada archivo puede pesar hasta 2 GB (5 GB en el plan más caro).

:::profundo Cómo se ve un puntero de LFS
Así se arma un puntero, con Python:

```python
import hashlib

pesos = bytes(range(256)) * 4096             # 1 MiB de «pesos» de mentira, siempre iguales
puntero = ("version https://git-lfs.github.com/spec/v1\n"
           f"oid sha256:{hashlib.sha256(pesos).hexdigest()}\n"
           f"size {len(pesos)}\n")
print(puntero, end="")
print(f"el archivo: {len(pesos):,} bytes · el puntero: {len(puntero)} bytes")
```

```salida
version https://git-lfs.github.com/spec/v1
oid sha256:fbbab289f7f94b25736c58be46a994c441fd02552cc6022352e3d86d2fab7c83
size 1048576
el archivo: 1,048,576 bytes · el puntero: 132 bytes
```

En un proyecto se activa con tres comandos. Son una ilustración: Git LFS se instala aparte y el contenedor de prueba no lo trae. `git lfs track` escribe la regla en un archivo `.gitattributes`, que sí se versiona:

```bash
git lfs install
git lfs track "*.pt"
git add .gitattributes
```
:::

:::calculadora git-repo-pesos
Prueba con un LLM chico: 16,000 MB (unos 8 mil millones de parámetros en BF16) y una versión al mes. ¿Qué pasa con el límite de GitHub?
:::

LFS resuelve el tamaño, pero en un sistema de ML los datos y los pesos suelen ir mejor en otro lado: en [[object-storage|object storage]] (como S3), en rutas que nunca se reescriben, y en Git solo una referencia con su hash. Dicho corto: Git versiona tu código; nada versiona tus datos a menos que lo diseñes. DVC, por ejemplo, guarda en Git un archivo chico con el hash y deja los datos en S3; lakeFS da ramas y commits sobre el object storage mismo. Cómo se versionan los datos, el [[versionado-datos|versionado de datos]], y cómo se sigue de dónde salió cada cosa, el [[linaje]], lo ves en la lección «Versionado y linaje».

## Tags, revert y la trazabilidad de Alba {Tags, revert and Alba's traceability}

### Tags: un nombre que no se mueve

Una rama se mueve con cada commit. A veces quieres lo contrario: un nombre que se quede para siempre en un commit, como «el gateway que salió el lunes». Eso es un [[tag-git|tag]] (etiqueta). Con `-a` se crea un tag **anotado**: un objeto con autor, fecha y mensaje, como un commit chiquito. Sin `-a`, es solo el nombre.

Los tags de versión suelen seguir la [[version-semantica|versión semántica]] de la lección de Python: en `v1.4.0`, 1 es la versión mayor (cambios que rompen a quien te usa), 4 la menor (algo nuevo que no rompe) y 0 el parche (un arreglo). Ojo: `git push` no sube los tags. Se suben aparte, con `git push origin v1.4.0`.

### Volver a ayer: revert contra reset

En este bloque, alguien escribe 0.015 en vez de 0.15: el gateway le da a Triton 15 ms en lugar de 150, casi todas las requests se rinden antes de tiempo y la app recibe errores. Hay que volver a lo de ayer.

```bash
git init -q gateway && cd gateway
echo 'INFER_TIMEOUT_S = 0.15' > config.py && git add . && git commit -q -m "Agrega el timeout"
git tag -a v1.4.0 -m "El gateway que salió el lunes"
echo 'INFER_TIMEOUT_S = 0.015' > config.py && git commit -q -am "Ajusta el timeout"
git log --oneline --decorate
git rev-parse --short=7 v1.4.0^{commit}    # a qué commit apunta el tag
echo "--- revert: un commit nuevo que deshace el malo"
git revert --no-edit HEAD > /dev/null
git log --oneline
cat config.py
echo "--- reset: la rama vuelve atrás y lo de después ya no está en ella"
git reset -q --hard v1.4.0
git log --oneline
```

```salida
6dcfb7f (HEAD -> main) Ajusta el timeout
1e53ceb (tag: v1.4.0) Agrega el timeout
1e53ceb
--- revert: un commit nuevo que deshace el malo
d895046 Revert "Ajusta el timeout"
6dcfb7f Ajusta el timeout
1e53ceb Agrega el timeout
INFER_TIMEOUT_S = 0.15
--- reset: la rama vuelve atrás y lo de después ya no está en ella
1e53ceb Agrega el timeout
```

`--decorate` muestra qué nombres apuntan a cada commit, y `> /dev/null` tira lo que imprime `revert`. Las dos maneras de volver son muy distintas:

| | `git revert` | `git reset --hard` |
|---|---|---|
| Qué hace | Crea un commit **nuevo** que hace lo contrario de otro | Mueve la rama hacia atrás y deja el área de trabajo igual que ese commit |
| La historia | Crece: queda escrito que hubo un error y que se deshizo | Se acorta: los commits de después ya no están en la rama |
| Lo que no habías guardado | No lo toca: Git se niega a revertir si tienes cambios a medias en esos archivos | Se pierde |
| En una rama compartida | Seguro: es un commit más, que se sube con push normal | Peligroso: subirlo pide `--force` y reescribe la historia de todos |

La regla: **revert para lo que ya se compartió; reset solo para tu trabajo local.** Volver a ayer en `main` es un revert.

:::profundo ¿Se perdió para siempre lo del reset?
Casi nunca de inmediato. Git anota en el **reflog** (*reference log*) cada lugar al que apuntó HEAD, y los commits que quedaron sin rama siguen en `.git` hasta que una limpieza los borra: por omisión, el reflog los recuerda 30 días, y pasado ese plazo la siguiente limpieza (`git gc`, que Git corre solo de vez en cuando) ya puede borrarlos. `git reflog` los lista, y `git branch rescate 6dcfb7f` los recupera con una rama nueva. Lo que sí se pierde para siempre con `reset --hard` son los cambios que nunca entraron a un commit.
:::

### La trazabilidad de Alba

Ahora puedes contestar la primera pregunta de la lección: ¿qué código exacto corre en producción?

En Alba, cada vez que un cambio entra a `main`, CI construye la imagen del gateway (la imagen de un [[contenedor]], el paquete con el programa y todo lo que necesita para correr) y la nombra con el commit: `TAG=$(git rev-parse --short=7 HEAD)` da `3f9c2ab`, y la imagen se llama `classifier-gateway:3f9c2ab`. Nunca `:latest`, que cambia de contenido cada vez que alguien sube otra imagen. Con ese nombre, `git show 3f9c2ab` enseña el código exacto, y `git log 3f9c2ab..8d41e07` (con `8d41e07` como ejemplo de la versión nueva) lista todo lo que cambió entre dos versiones. La imagen tiene además su propia huella, su [[digest-imagen|digest]], que ves en la lección «Empaquetado con Docker».

Con el modelo pasa lo mismo, con más ingredientes. En Alba, cada modelo registrado guarda tres punteros: el snapshot de datos, el commit de código y el digest del contenedor de entrenamiento. El [[snapshot]] es la foto fija de los datos con que se entrenó (por ejemplo, `ds-2026-09-01`); el commit, el código de entrenamiento; el digest, el entorno exacto donde corrió. El lugar donde se guardan los modelos con esos punteros es el [[registro-modelos|registro de modelos]], de la lección «Gate de evaluación y registry». Con los tres, cualquiera puede contestar de dónde salió `resnet50-2026-10-01`, y volver a entrenarlo.

:::diagrama git-trazabilidad
Del modelo que responde en producción hacia atrás, hasta el código, los datos y el entorno que lo produjeron. Usa «Recorrer» para seguir la pregunta «¿de dónde salió?» y la vuelta a la versión de ayer.
:::

Hay una trampa. Herramientas como MLflow, que anotan cada entrenamiento, guardan solas el commit de donde corrió el script. Pero si cambiaste el script y no hiciste commit, anotan el commit de antes: es una falsa tranquilidad, porque el código que produjo ese modelo no existe en Git. La defensa es entrenar solo con el árbol limpio. `git status --porcelain` imprime lo mismo que `--short`, en un formato pensado para programas; si no imprime nada, no hay cambios sin commit:

```bash
git init -q entrenamiento && cd entrenamiento
echo 'lr = 0.001' > train.py && git add . && git commit -q -m "Entrenamiento base"
git status --porcelain; echo "porcelain vacío: árbol limpio, se puede entrenar"
echo 'lr = 0.0005' > train.py              # alguien cambia el script y no hace commit
git status --porcelain
git rev-parse --short HEAD                 # el commit sigue siendo el mismo
test -z "$(git status --porcelain)" || echo "árbol sucio: el pipeline se niega a entrenar"
```

```salida
porcelain vacío: árbol limpio, se puede entrenar
 M train.py
1b1defb
árbol sucio: el pipeline se niega a entrenar
```

`test -z` es verdad si el texto está vacío. El pipeline de Alba hace esa revisión antes de entrenar a un candidato (un modelo nuevo que aspira a producción): si hay cambios sin commit, falla.

## Cómo trabaja un equipo: trunk-based, monorepo y GitOps {How a team works: trunk-based, monorepo and GitOps} [extra]

Git da las piezas. Cómo se usan en un equipo es una decisión, y de estas tres vas a oír en cualquier entrevista.

### Trunk-based contra gitflow

En el [[trunk-based|desarrollo trunk-based]] (*trunk-based development*, «sobre el tronco»), todos integran a `main`, el tronco, seguido: las ramas viven horas o uno o dos días, y cada PR es chico. `main` siempre está lista para publicarse. Lo que aún no se termina entra apagado detrás de una [[feature-flag|feature flag]], un interruptor de la configuración que lo deja oculto hasta que se prende.

**Gitflow**, el modelo que Vincent Driessen publicó en 2010, usa ramas largas: `main` con lo publicado, `develop` con lo que viene, y ramas `feature/`, `release/` y `hotfix/` que salen de ellas y vuelven. Sirve para software que se publica por versiones numeradas, como una app que pasa por la tienda o una librería. El mismo Driessen agregó en 2020 una nota a su artículo: para una app web que se entrega todo el tiempo, recomienda algo más simple. Para un servicio que se despliega varias veces al día, como el gateway de Alba, es pesado: las ramas largas se separan, y cada merge grande trae conflictos grandes.

Alba trabaja trunk-based: ramas cortas, PR con revisión y CI, y `main` siempre desplegable.

### Monorepo contra varios repositorios

Un [[monorepo]] es un solo repositorio con varios proyectos: en Alba serían el gateway, el código de entrenamiento, el preprocesamiento compartido y la infraestructura. La alternativa es un repositorio por proyecto (a veces se le dice *polyrepo*).

| | Monorepo | Un repo por proyecto |
|---|---|---|
| Un cambio que toca dos proyectos | Un solo PR y un solo commit | Un PR en cada repo, en el orden correcto |
| Qué versión va con cuál | Un commit describe todo el sistema | Hay que anotar qué versión de cada uno va junta |
| Lo que cuesta | El repo crece, y CI tiene que correr solo lo que cambió | Cada equipo decide solo, pero coordinar es más trabajo |
| Permisos | Más gruesos: todos ven todo | Cada repo con los suyos |

En ML el monorepo tiene un premio concreto. Alba usa un solo paquete de preprocesamiento, `preprocess.py`, en el entrenamiento y en el gateway. En un monorepo, un cambio al preprocesamiento entra a los dos en el mismo commit, y el training-serving skew no tiene por dónde colarse. Google guarda casi todo su código en un solo repositorio gigante, con un sistema propio en lugar de Git.

### GitOps: el clúster lee el repositorio

Alba corre en Kubernetes, el sistema de [[orquestacion|orquestación]] que decide cuántas copias de cada programa correr y en qué máquinas (lo ves a fondo en la lección «Kubernetes»). Kubernetes se maneja con archivos de texto en [[yaml|YAML]] llamados **manifests**, que describen lo que debe correr: qué imagen, cuántas copias, con qué memoria.

En [[gitops|GitOps]] (el nombre lo puso la empresa Weaveworks en 2017), esos manifests viven en un repositorio, y un programa dentro del clúster, Argo CD o Flux (dos proyectos de la CNCF, la fundación que también cuida Kubernetes), compara sin parar lo que dice el repositorio con lo que corre de verdad y aplica la diferencia. Las consecuencias:

- **Desplegar es un PR** que cambia la imagen (el tag y el digest), y la historia queda en Git. La aprobación humana puede estar en la revisión de ese PR o en el pipeline antes de juntarlo (lo ves en «CI/CD y registro de imágenes»).
- **El rollback es un revert**, que también pasa por PR.
- **La historia del repositorio es la historia de producción**: quién desplegó qué, quién lo pidió y cuándo se aplicó.
- **Un cambio a mano no dura.** Si alguien cambia el clúster sin pasar por Git, el clúster ya no coincide con el repositorio (*configuration drift*, deriva de configuración; no es el [[drift]] de los datos, aunque comparta la palabra). Si además de la sincronización automática está prendida la autorreparación (*self-heal*, apagada por omisión), Argo CD lo regresa solo a lo que dice Git; si no, lo marca como distinto y lo pisa en la siguiente sincronización.

Así se ve, en pequeño, el repositorio de despliegue de Alba (`sed -i` cambia un texto dentro del archivo; en macOS se escribe `sed -i ''`, y `8d41e07` es un commit de ejemplo):

```bash
git init -q despliegue && cd despliegue         # el repo que Argo CD vigila
echo 'image: classifier-gateway:3f9c2ab' > gateway.yaml
git add . && git commit -q -m "Gateway 3f9c2ab"
sed -i 's/3f9c2ab/8d41e07/' gateway.yaml         # el PR del martes: la versión nueva
git commit -q -am "Gateway 8d41e07"
git revert --no-edit HEAD > /dev/null           # truena: el rollback es un revert
git log --oneline
cat gateway.yaml
```

```salida
57ece20 Revert "Gateway 8d41e07"
234cac0 Gateway 8d41e07
df5403a Gateway 3f9c2ab
image: classifier-gateway:3f9c2ab
```

Después del revert, el archivo vuelve a pedir `3f9c2ab`, Argo CD lo nota y el clúster regresa a la imagen de ayer, que ya existía: nadie la reconstruye. Y la historia guarda las tres cosas: la versión vieja, la nueva y la vuelta.

## Errores comunes {Common mistakes}

### 1. Subir un secreto y creer que borrarlo lo arregla

Una llave entra en un commit, alguien la ve en el PR, y la solución parece un commit que la borra. Pero sigue en la historia, en cada clone y en cada copia del remoto.

**Cómo evitarlo:** `.env` y todo lo que traiga llaves va en `.gitignore` desde el primer commit, y las llaves viven fuera del repositorio (la lección de configuración). Si una ya se subió, se cambia por otra de inmediato: se da por filtrada.

### 2. Meter pesos y datos al repositorio

`git add .` con la carpeta `pesos/` adentro, y el repositorio crece 98 MB con cada versión, para siempre. A los meses, clonar tarda minutos y GitHub rechaza el push del primer archivo de más de 100 MiB.

**Cómo evitarlo:** pesos, datos y `.venv/` van en `.gitignore`. Los pesos y los datos viven en object storage, con su versión, y Git guarda solo la referencia y su hash; si de verdad deben ir junto al código, con Git LFS. Revisa `git status` antes de cada commit.

### 3. Reescribir una rama que otros ya bajaron

Un rebase o un `reset` en `main`, seguido de `git push --force`, borra del remoto los commits de los demás. La próxima vez que bajen, su historia y la del remoto no coinciden.

**Cómo evitarlo:** rebase y reset solo en tu rama, antes de compartirla. En lo compartido, `git revert`. Protege `main` para que nadie pueda forzarla, y si alguna vez fuerzas tu propia rama, usa `--force-with-lease`.

### 4. Entrenar con el árbol sucio

El script cambió, nadie hizo commit, y el modelo queda registrado con el commit de antes. Meses después, volver a ese commit no reproduce el modelo, y nadie sabe por qué.

**Cómo evitarlo:** el pipeline revisa `git status --porcelain` y se niega a entrenar si no está vacío. Los candidatos a producción se entrenan desde CI, que parte de un commit limpio, nunca desde una laptop.

### 5. Usar como versión algo que se mueve

«En producción está `main`» o «la imagen es `:latest`»: los dos nombres apuntan mañana a otra cosa. Un rollback a «main» no regresa a ningún lado.

**Cómo evitarlo:** la versión de lo que corre es un id que no cambia: el SHA del commit en el tag de la imagen, o un tag de Git como `v1.4.0`. Y lo que bajas de otros, como un modelo de un repositorio público, se fija en un commit, no en una rama.

### 6. Arreglar producción a mano cuando hay GitOps

A medianoche alguien cambia la imagen directo en el clúster para salir del problema. Git ya no describe lo que corre, nadie revisó el cambio, y la siguiente sincronización lo deshace.

**Cómo evitarlo:** el arreglo también va por Git: un revert en el repositorio de despliegue, con un PR que se aprueba rápido. Si de verdad hubo que tocar el clúster a mano, ese mismo día el cambio se escribe en el repositorio.

## En la vida real {In real life} [extra]

### Alba: la noche del timeout

Así contestaría Alba el martes de la introducción. La historia es un ejemplo armado con las piezas de su sistema, no un incidente real.

A las 23:05 suena la alerta: el gateway responde errores 504 (el [[codigo-estado|código de estado]] de «me cansé de esperar»). La primera pregunta, qué corre, se contesta en el repositorio de despliegue: desde las 22:40 pide `classifier-gateway:8d41e07`, y ayer pedía `3f9c2ab`. La segunda, qué cambió, la contesta `git log 3f9c2ab..8d41e07`: tres commits, y uno se llama «Ajusta el timeout». La tercera, cómo volver: un revert en el repositorio de despliegue, aprobado en dos minutos. Argo CD lo aplica y el clúster vuelve a la imagen de ayer, que ya existía. Rollback primero, investigar después.

A la mañana siguiente, el arreglo de verdad entra por PR al gateway, con una prueba que falla si el timeout queda por debajo de lo que tarda Triton en el [[p99]] (el tiempo que no pasa el 99 % de las requests). Nada se perdió: el commit malo, su revert y el arreglo están en la historia, con autor, hora y quién los aprobó.

### Un LLM propio y los modelos de Hugging Face

Hugging Face, el sitio donde se publican modelos abiertos, guarda cada modelo como un repositorio de Git, con los pesos en archivos grandes fuera del historial normal: primero con Git LFS y, desde 2025, con su propio sistema, Xet, que sigue la misma idea. Su rama `main` puede cambiar: el dueño sube pesos nuevos y el mismo nombre ya es otro modelo. Por eso, quien sirve su propio LLM fija la revisión exacta: el commit del repositorio en Hugging Face, no `main`. Las librerías aceptan una revisión, y un servidor que sirve un LLM a varios equipos carga siempre ese commit.

### Los datos también apuntan al código

En Alba, la tarjeta de un snapshot de datos dice de qué código salió: `"code": {"repo": "ml-catalogo", "commit": "4be1d0a"}`. Si el dataset trae un error, se sabe exactamente qué versión del código que lo armó hay que revisar. Y su primer dataset queda amarrado con un tag de Git, `dataset-v1`: los datos viven en S3, y el tag marca el commit del código que lo armó, cuya tarjeta guarda la huella del manifest.

### Uber, 2016: una llave en un repositorio

En 2016, unos atacantes entraron a un repositorio privado que usaban ingenieros de Uber en GitHub y encontraron credenciales de la nube de Amazon. Con ellas bajaron datos de unos 57 millones de usuarios y conductores. El repositorio era privado: no bastó. Lo que está en un repositorio lo puede leer cualquiera que consiga entrar, hoy o en diez años.

### Git, Linux y GitHub

Linux, el sistema operativo de casi todos los servidores, se coordinaba con un programa comercial llamado BitKeeper, hasta que en 2005 se acabó el permiso para usarlo gratis. Linus Torvalds escribió Git en unas semanas para reemplazarlo, pensando en miles de personas que trabajan en paralelo, sin un servidor central obligatorio, y con ids que nadie pudiera falsificar. GitHub nació en 2008 sobre Git, y en 2018 Microsoft lo compró por US$7,500 millones.

## Ejercicios {Exercises}

Resuélvelos antes de abrir la solución. Los que tienen comandos los puedes comprobar en tu terminal, con un repositorio de prueba.

:::ejercicios
? [facil] `git status --short` imprime tres líneas: `?? notas.txt`, ` M app.py` y `M  config.py`. ¿En qué lugar está cada cambio? Si haces `git commit -m "..."` ahora mismo, ¿qué entra a la foto?
- `?? notas.txt`: Git no lo sigue. Está solo en el área de trabajo.
- ` M app.py` (la M en la segunda columna): cambió en el área de trabajo, pero no está en el staging.
- `M  config.py` (la M en la primera columna): el cambio está en el staging.
- El commit lleva **solo `config.py`**, porque `git commit` guarda lo que hay en el staging. Para meter `app.py`, primero `git add app.py` (o `git commit -a`). `notas.txt` no entra con ninguno de los dos: un archivo nuevo necesita su `git add`.
? [facil] Un compañero no quiere crear una rama para probar una idea, «porque el proyecto pesa 300 MB y se me va a llenar el disco». ¿Tiene razón? ¿Cuánto ocupa una rama?
- No. Una rama es un archivo en `.git/refs/heads/` con el id de un commit: 40 caracteres y un salto de línea, **41 bytes**.
- Crear la rama no copia ningún archivo. Cambiarse a ella solo reescribe en el área de trabajo los archivos que son distintos entre las dos ramas.
- Lo que sí ocupa espacio son los commits nuevos, y solo por el contenido que cambió.
? [facil] ¿Qué de esta lista va en el `.gitignore` del gateway, y qué sí se versiona? `app.py`, `.env`, `.venv/`, `uv.lock`, `tests/test_app.py`, `__pycache__/`, `pesos/resnet50.pt`, `Dockerfile`.
- **Se ignora:** `.env` (ajustes y llaves), `.venv/` (se reconstruye), `__pycache__/` (Python lo genera) y `pesos/resnet50.pt` (va en object storage o en Git LFS).
- **Se versiona:** `app.py`, `tests/test_app.py`, `Dockerfile` y `uv.lock`. El lock file es justo lo que permite reconstruir `.venv/` igualito en otra máquina: si se ignora, cada quien instala versiones distintas.
? [facil] En cada caso, ¿el merge es fast-forward o crea un commit de merge? (a) Sacas la rama `fix` de `main`, haces dos commits y nadie tocó `main`. (b) Igual, pero mientras tanto Luis unió un PR a `main`. (c) Después de (b), haces rebase de `fix` sobre `main` y luego el merge.
- (a) **Fast-forward**: `main` sigue donde la dejaste, solo se adelanta su etiqueta.
- (b) **Commit de merge**: cada rama tiene commits que la otra no; el commit nuevo tiene dos padres.
- (c) **Fast-forward** otra vez, con `git merge` en tu terminal: después del rebase, tus commits quedaron encima del último de `main`, como si hubieras empezado hoy. Por eso muchos equipos hacen rebase antes de unir. (El botón «Create a merge commit» de GitHub crea un commit de merge siempre, aunque se pudiera adelantar.)
? [medio] Un archivo `respuesta.py` contiene una sola línea, `TOP_K = 5`, con su salto de línea al final. ¿Qué bytes exactos le pasa Git a SHA-1 para calcular su id? Comprueba el id con Python.
- La regla de la sección 2: \(text{id} = text{SHA-1}(text{encabezado} + text{contenido})\), con el encabezado `blob`, un espacio, el tamaño y un byte en cero.
- El contenido son 10 bytes: los 9 caracteres de `TOP_K = 5` más el salto de línea.
- Git calcula el SHA-1 de `blob 10`, un byte en cero y los 10 bytes: `b"blob 10\0TOP_K = 5\n"`.
- Con la función `id_git` de la sección 2, `id_git("blob", b"TOP_K = 5\n")` da `1e0b1ade696068e087656f8ae5e859fe92aef3b8`, lo mismo que `git hash-object respuesta.py`.
- Fíjate en que el nombre del archivo no entra en la cuenta: otro archivo con el mismo contenido tiene el mismo id, y Git lo guarda una sola vez.
? [medio] Al unir dos ramas, `config.py` queda así: `<<<<<<< HEAD`, `TOP_K = 5`, `=======`, `TOP_K = 10`, `>>>>>>> nueva-ui`, cada uno en su línea. El equipo decide que 5 siga siendo el valor por omisión y que quien llama al gateway pueda pedir otro. ¿Qué escribes y qué comandos corres?
- `HEAD` es tu rama (dice 5) y `nueva-ui` la que unes (dice 10). La decisión no es ninguna de las dos al pie de la letra: el valor por omisión es 5, y quien llama puede pedir otro.
- Dejas el archivo con `TOP_K = 5`, **sin ningún marcador**. Lo de aceptar el `top_k` de la request es un cambio del código del gateway, en otro commit.
- `git add config.py` para marcarlo resuelto y `git commit` para terminar el merge.
- Antes de subir, corre las pruebas: un merge resuelto a mano es código nuevo que nadie ha probado.
? [medio] Un repositorio tiene 50,000 objetos (commits, árboles y blobs). Con prefijos de 7 caracteres, ¿qué tan probable es que al menos dos empiecen igual? ¿Y con 8?
- Las fórmulas de la sección 2: \(M = 16^k\), \(P = n × (n − 1)/2\) y \(Pr ≈ 1 − e^{−P/M}\), con \(n\) = 50,000.
- Parejas: \(P\) = 50,000 × 49,999 ÷ 2 = **1,249,975,000**.
- 7 caracteres: \(M\) = 16⁷ = 268,435,456. \(P/M\) = 1,249,975,000 ÷ 268,435,456 ≈ 4.66, y \(Pr ≈ 1 − e^{−4.66}\) ≈ **99 %**: es casi seguro que hay un choque.
- 8 caracteres: \(M\) = 16⁸ = 4,294,967,296. \(P/M\) = 1,249,975,000 ÷ 4,294,967,296 ≈ 0.291, y \(Pr ≈ 1 − e^{−0.291}\) ≈ **25 %**.
- Por eso Git alarga solo los ids que chocan, y en repositorios grandes muestra más de 7. Un script que corta siempre a 7 puede dar un id ambiguo; `git rev-parse --short=7` da 7 **o más**, los que hagan falta.
? [reto] Son las 23:00. El repositorio de despliegue de Alba (con GitOps) tiene, del más nuevo al más viejo: `b41c` «Gateway 8d41e07», `a7e2` «Sube las réplicas a 6» (las copias del gateway que corren a la vez) y `9d03` «Gateway 3f9c2ab». Desde `b41c`, los errores 504 se dispararon. Una persona propone `git reset --hard 9d03` y `git push --force`. ¿Qué haces tú, y por qué?
- El problema llegó con `b41c`, la imagen nueva del gateway. `a7e2`, las réplicas, es un cambio aparte que funcionaba.
- `reset --hard 9d03` se llevaría también `a7e2`, y el push con `--force` reescribiría `main` del repositorio de despliegue: los demás quedan con una historia que ya no existe, y se pierde el registro de qué pasó.
- Lo correcto es **`git revert b41c`** en un PR, aprobado rápido. Deshace solo la imagen nueva, conserva las 6 réplicas, deja escrito el rollback y se sube con un push normal.
- Argo CD ve el cambio y regresa el clúster a `3f9c2ab`, que ya existe en el [[registro-imagenes|registro de imágenes]], el almacén de imágenes que ves en la lección «CI/CD y registro de imágenes». Al día siguiente: `git log 3f9c2ab..8d41e07` en el gateway para encontrar la causa, y un PR con el arreglo y una prueba.
? [reto] MLflow dice que el modelo `resnet50-2026-10-01` salió del commit `c3f2fc2`. Lo reentrenas desde ese commit con el mismo snapshot de datos y la misma imagen, y el resultado es distinto: el [[top-k-accuracy|top-1]] en el [[golden-set|golden set]] baja 2 puntos. (a) ¿Cuál es la causa más probable que tiene que ver con Git? (b) ¿Cómo lo confirmas? (c) ¿Qué cambias para que no vuelva a pasar?
- (a) Que el modelo original se entrenó con **cambios sin commit**: el script estaba modificado y MLflow anotó el commit de antes, `c3f2fc2`. El código que lo produjo no existe en Git.
- (b) Busca en MLflow si la corrida guardó algo más que el commit (los parámetros, la configuración, una copia del script) y compáralo con `git show c3f2fc2:train.py`. Si el learning rate o el número de [[epoch|epochs]] no coinciden, ahí está. Descarta también lo que no es Git: la [[semilla]], y las variaciones normales de la GPU.
- (c) El pipeline revisa `git status --porcelain` antes de entrenar y se niega si no está vacío. Los candidatos se entrenan desde CI, que parte de un commit limpio. Y el modelo registrado guarda sus tres punteros: commit, snapshot y digest de la imagen de entrenamiento.
:::

## Lo que sigue {What comes next}

La siguiente lección, «Pruebas y CI/CD», es lo que corre en cada PR: las pruebas, la integración continua y el despliegue. Después, «Configuración: YAML, variables de entorno y secretos» explica dónde va lo que no entra al repositorio.

Más adelante, «Versionado y linaje» amarra cada snapshot de datos al commit que lo armó, y «Rollout seguro» despliega con GitOps y vuelve atrás con un revert.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
git repositorio commit rama merge conflicto-merge rebase remoto-git pull-request revision-codigo gitignore tag-git git-lfs trunk-based monorepo gitops
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuáles son los tres lugares de un cambio en un repositorio, y qué comando lo mueve de uno al siguiente?
El área de trabajo (lo que editas), el staging (lo que va en la próxima foto) y el historial (las fotos guardadas en `.git`). `git add` pasa del área de trabajo al staging, y `git commit`, del staging al historial.
? ¿Por qué cambiar el mensaje de un commit viejo cambia el id de todos los que vienen después?
Porque el id de un commit es el SHA-1 de todo su contenido, y ese contenido incluye el id de su padre. Cambia el viejo, cambia su id; el siguiente guarda ese id nuevo y cambia también, y así hasta el último.
? ¿Qué es una rama, y por qué crearla no ocupa espacio?
Un nombre que apunta a un commit y avanza con cada commit nuevo: un archivo de 41 bytes con el id. No copia archivos.
? ¿Cuándo un merge es fast-forward y cuándo crea un commit de merge?
Fast-forward cuando la rama de destino no avanzó desde que saliste: solo se adelanta su etiqueta. Si avanzó, Git crea un commit nuevo con dos padres.
? ¿Cuál es la regla de oro del rebase?
No reescribir commits que otros ya bajaron: rebase en tu rama antes de compartirla, nunca en `main`.
? ¿Revert o reset para deshacer un error que ya está en `main`?
Revert: crea un commit nuevo que lo deshace, sin reescribir la historia, y se sube con un push normal. Reset es para tu trabajo local.
? ¿Qué tres punteros guarda cada modelo registrado de Alba?
El snapshot de datos, el commit del código y el digest del contenedor de entrenamiento. Con ellos se sabe de dónde salió y se puede volver a entrenar.
:::
