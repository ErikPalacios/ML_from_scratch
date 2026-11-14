---
titulo: Empaquetado con Docker
en: Packaging with Docker
subtitulo: El séptimo paso del sistema de Alba de principio a fin: convertir el código del gateway y el engine del modelo en dos imágenes que corren igual en cualquier máquina, con capas en el orden correcto, un nombre que no se mueve y una prueba local de los dos juntos.
pregunta: El gateway de Alba ya tiene su código y Triton ya tiene su engine. ¿Cómo se convierten en dos paquetes que corren idénticos en una laptop, en CI y en producción, y por qué uno pesa 87 MB y el otro 9.2 GB?
requisitos: sistema-operativo, python-ecosistema, programa-proceso, config, e05-export, e06-serving
---

:::idea
Una imagen es el paquete congelado del que nace cada contenedor: capas de archivos apiladas, identificadas por la huella de su contenido. Esta estación escribe la receta de las dos imágenes de Alba, ordena sus capas para que un cambio de código no rehaga lo caro, mete el engine en la última capa de la imagen de [[triton|Triton]] y prueba las dos juntas en una sola máquina. Lo que sale se llama por su digest (la huella de todo su contenido), y ese nombre no se mueve.
:::

Alba es la empresa del curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y sugiere la categoría de cada foto entre 500. La sugerencia la hace una ResNet-50 (una red neuronal para fotos) servida con [[triton|Triton]]: un programa que tiene el modelo cargado en la GPU y contesta cada petición con su predicción. Corre en 2 GPUs T4 de NVIDIA, rentadas en AWS, la nube de Amazon. Delante de Triton está el **gateway**, un programa en Python escrito con FastAPI (una librería para hacer servicios web) que corre en 3 a 12 copias en máquinas sin GPU: recibe la foto, la valida, la prepara y le pide la respuesta a Triton.

Las máquinas de Alba forman un **clúster** (*cluster*): un grupo de máquinas que trabajan juntas. Cada máquina del clúster es un [[nodo]]. Quien decide qué programa corre en qué nodo es Kubernetes, un sistema que reparte los programas entre las máquinas y los vuelve a levantar si se caen. Esta lección no lo necesita a fondo: lo ves en «Kubernetes».

Las dos estaciones anteriores dejaron las piezas listas. «Export, engine y paridad» construyó el [[engine-tensorrt|engine de TensorRT]] del modelo `resnet50-2026-10-01`: el modelo convertido en un archivo, `model.plan`, de ≈ 50–150 MB, optimizado para una GPU concreta. Solo carga en una T4 y con la versión 24.08 del software de NVIDIA. Esa estación también lo registró como `challenger`, el [[alias-modelo|alias]] del candidato que todavía no atiende a todos. «Código de serving» escribió el código del gateway, su `requirements.txt` con las 37 [[dependencia|dependencias]] fijadas y el [[config-pbtxt|`config.pbtxt`]], el archivo que le dice a Triton cómo servir el modelo.

Lo que falta es empacarlos. Un [[contenedor]] es un [[proceso]] (un programa que está corriendo) al que el [[kernel]], el corazón del sistema operativo, le limita lo que ve y lo que gasta, y le da su propio árbol de archivos. Lo viste en «El sistema operativo». Esta lección arma ese árbol: la **imagen**.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

### Lo que entra

Todo vive en el repositorio `classifier`:

- **El código del gateway**, en la carpeta `gateway/`: `app/main.py`, `app/preprocess.py` y el resto de la carpeta `app/` (≈ 48 KB en total), `requirements.txt` con las 37 dependencias fijadas con `==`, que quiere decir «exactamente esta versión» (9 que pidió el equipo y 28 que llegaron con ellas), y las 26 pruebas en `tests/`.
- **El [[model-repository|repositorio de modelos]] de Triton**, `triton/model_repository/classifier/`: la carpeta con la forma que Triton espera. Trae el `config.pbtxt` (está en Git) y `1/model.plan`, el engine. El engine no está en Git: el proceso automático que arma la imagen lo baja del [[registro-modelos|registro de modelos]] (el catálogo de Alba con cada versión del modelo) y verifica su huella SHA-256, que se explica más abajo.
- **Dos recetas**, una por imagen: `gateway/Dockerfile` y `triton/Dockerfile`.

### Lo que sale

Dos imágenes y una prueba:

- `classifier-gateway:3f9c2ab`: el gateway, ≈ 87 MB comprimida (las imágenes se guardan y viajan por la red comprimidas; todos los tamaños de esta lección son así, salvo que diga «en disco»). El nombre lleva los 7 primeros caracteres del [[commit]] de Git que la produjo.
- `classifier-triton:resnet50-2026-10-01`: Triton con el engine adentro, ≈ 9.2 GB comprimida. El nombre lleva la versión del modelo, la 14 del registro de modelos.
- Un `docker-compose.yml` que levanta las dos en una máquina con GPU, para probarlas juntas antes de que lleguen al clúster.

Las dos imágenes son ≈ 100 veces distintas en tamaño: 9.2 GB ÷ 0.087 GB ≈ 106. Esa diferencia decide casi todo lo que viene.

### Lo que se decide

:::pasos
1. La base de cada imagen
Una imagen chica de Python para el gateway; la de NVIDIA con Triton para el modelo. Con su versión fija.
2. El orden de las capas
Lo que cambia poco arriba, lo que cambia en cada commit abajo, y el engine al final.
3. Qué viaja a la construcción (*build*) y qué se queda en la imagen final
El `.dockerignore` y las dos etapas del gateway.
4. Con qué usuario y cómo arranca
Un usuario sin privilegios con número fijo, un solo proceso que recibe las señales.
5. Dónde viven los pesos
Dentro de la imagen de Triton, en su última capa.
6. Cómo se prueba
Con un chequeo de salud en la imagen y los dos servicios juntos en compose.
:::

Lo que esta estación **no** hace: publicar las imágenes en el registro de Alba y ponerles su nombre definitivo en [[ci|CI]] (las máquinas que prueban y construyen cada cambio en automático) es de «CI/CD y registro de imágenes»; correrlas en el clúster, con sus límites y sus chequeos, es de «Kubernetes».

:::diagrama e07-empaquetado-estacion
La estación 7: de lo que hay en el repositorio a las dos imágenes probadas. Toca cada caja; hay un recorrido por imagen.
:::

## Una imagen por dentro: capas, manifest y digest {Inside an image: layers, manifest and digest}

### Qué es una imagen

Una [[imagen-contenedor|imagen de contenedor]] (*container image*) es la plantilla de solo lectura de la que nace cada contenedor. Trae los archivos que el proceso verá como su disco (un Debian mínimo, que es una versión de Linux; Python 3.13; las librerías; tu código) y una pequeña configuración: qué comando correr, con qué usuario, en qué carpeta, con qué [[variable-entorno|variables de entorno]].

La imagen no corre: es un archivo quieto. El contenedor es un proceso vivo que la usa como su `/`, la raíz de su árbol de archivos, con una capa escribible encima que se tira cuando el contenedor termina. De una imagen salen cuantos contenedores quieras: los 3 a 12 del gateway de Alba salen de la misma.

:::analogia Un guisado congelado
La receta es el Dockerfile, que verás en un momento. Cocinarla una vez da un lote de porciones congeladas idénticas: la imagen. Cada vez que calientas una porción y la sirves tienes un contenedor. Lo que le agregues al plato servido no cambia las porciones del congelador.

Dónde se rompe: una porción servida ya no está en el congelador, y de una imagen sacas cuantos contenedores quieras sin que se gaste.
:::

### Capas

Una imagen no es un solo bloque. Es una pila de [[capa-imagen|capas]] (*layers*). Cada capa es un archivo comprimido (un `.tar.gz`, un paquete de archivos comprimido, parecido a un `.zip`) con **los cambios** respecto a la de abajo: archivos nuevos, archivos modificados y marcas de archivos borrados. Cuando el contenedor arranca, el kernel las [[montaje|monta]] una encima de otra y el proceso ve un solo árbol, como contaba la sección de montajes de «El sistema operativo».

La imagen del gateway tiene, en lo que pesa, tres capas:

| Capa | Qué trae | Comprimida |
|---|---|---|
| Base | Debian mínimo y Python 3.13: la imagen `python:3.13-slim` | ≈ 43 MB |
| Dependencias | El [[entorno-virtual\|entorno virtual]] `/opt/venv`, la carpeta aislada con los 37 paquetes (≈ 160 MB en disco) | ≈ 44 MB |
| Código | La carpeta `app/` | ≈ 0.048 MB |

Suman 43 + 44 + 0.048 ≈ 87 MB. Hay otras capas casi vacías (crear el usuario, la carpeta de trabajo) que pesan unos KB.

:::figura e07-empaquetado-capas
Las dos imágenes de Alba como pilas de capas. No están a escala: el gateway entero cabría ≈ 50 veces en la capa más grande de Triton.
:::

:::analogia Acetatos en un proyector
Una capa es como una hoja de acetato transparente: dibujas en ella solo lo nuevo y la pones encima de las otras. El proyector muestra una sola imagen, la suma de todas. Para «borrar» algo de una hoja de abajo, pones encima una hoja con un parche que lo tapa.

Dónde se rompe: el parche tapa, pero la hoja de abajo sigue en la pila y sigue pesando. En una imagen pasa igual: borrar un archivo en una capa posterior no achica la imagen, y quien la descargue puede leer la capa de abajo. La sección extra vuelve sobre esto.
:::

### La huella de cada capa y el digest

Cada capa se identifica por la [[hash-criptografico|huella SHA-256]] de sus bytes: un número de 64 caracteres hexadecimales (con los dígitos 0–9 y las letras a–f) que cambia por completo si cambia un solo byte. La imagen entera se describe con un documento chico en [[json|JSON]] (texto con nombres y valores), el **manifest de la imagen** (no es el manifest de un dataset de «Versionado y linaje», aunque se llame igual): la huella de la configuración y la lista de las huellas de las capas, en orden.

El [[digest-imagen|digest]] de la imagen es la huella SHA-256 de ese manifest. Como el manifest lista las huellas de todo, el digest identifica **el contenido exacto**: si cambia una capa, cambia su huella, cambia el manifest y cambia el digest. Dos imágenes con el mismo digest son la misma imagen, byte por byte.

El código de abajo lo hace en chico, con bytes de juguete en vez de capas reales: tres capas, la versión 2 cambia solo el código.

```python
import hashlib, json

def sha(datos):                      # la huella de unos bytes, como la escribe Docker
    return "sha256:" + hashlib.sha256(datos).hexdigest()

def digest(capas, config):           # el manifest lista la config y las capas, por su huella
    manifest = {"config": sha(config), "layers": [sha(c) for c in capas]}
    return sha(json.dumps(manifest, sort_keys=True).encode())

config = b'{"User": "10001", "Cmd": ["uvicorn", "app.main:app"]}'
v1 = [b"debian + python 3.13 (base slim)", b"/opt/venv: 37 paquetes", b"app/main.py v1"]
v2 = v1[:2] + [b"app/main.py v2"]    # solo cambia una línea del código

for a, b in zip(v1, v2):
    print(sha(a)[:19], "igual" if a == b else "-> " + sha(b)[:19])
d1, d2 = digest(v1, config), digest(v2, config)
print("digest v1:", d1[:19], "· v2:", d2[:19])

tags = {"classifier-gateway:dev": d1}
tags["classifier-gateway:dev"] = d2  # un tag se puede mover; un digest no
print("dev apunta a:", tags["classifier-gateway:dev"][:19], "· v1 sigue siendo", d1[:19])
```

```salida
sha256:365f15a433d8 igual
sha256:4b7d6960e1c9 igual
sha256:0f5a3de073dd -> sha256:adf76099f204
digest v1: sha256:b05722bd65b4 · v2: sha256:b510ea0e0e8f
dev apunta a: sha256:b510ea0e0e8f · v1 sigue siendo sha256:b05722bd65b4
```

Dos capas de tres quedaron iguales, con la misma huella. Eso es lo que hace barato todo lo demás: un nodo (una máquina del clúster) que ya tiene la capa `sha256:4b7d…` no la vuelve a bajar, y diez imágenes construidas sobre la misma base la guardan una sola vez. Pero el digest de la imagen sí cambió entero: es otra imagen.

### Tag y digest

Escribir `sha256:b05722bd65b4…` con sus 64 caracteres no es práctico. Por eso las imágenes también llevan un [[tag-imagen|tag]] (etiqueta): un nombre legible después de los dos puntos, como el `3f9c2ab` de `classifier-gateway:3f9c2ab`. El tag es un **apuntador**. El [[registro-imagenes|registro]] (el servidor donde se guardan las imágenes y de donde se bajan) guarda «este tag señala este digest», y ese apuntador se puede mover a otro digest, como el `dev` del código.

| | Tag | Digest |
|---|---|---|
| Cómo se ve | `classifier-gateway:3f9c2ab` | `classifier-gateway@sha256:b057…` (64 caracteres) |
| Quién lo pone | Quien construye o sube la imagen | Nadie: se calcula del contenido |
| Se puede mover | Sí, salvo que el registro lo prohíba | No: otro contenido es otro digest |
| Para qué sirve | Para que lo lea una persona | Para pedir exactamente esa imagen |

El tag más famoso es `latest`, y engaña: no significa «la más nueva». Es solo el tag que Docker pone cuando no escribes otro, y señala lo último que alguien subió con ese nombre. Cada máquina que la bajó en otro momento puede tener otra, y no hay forma de volver a «la `latest` de ayer». Alba no lo usa en nada que corra.

Cuando subes una imagen al registro, `docker push` termina imprimiendo una línea `digest: sha256:…`, y `docker image inspect` lo muestra después. Alba usa los dos: el tag para que lo lean las personas y el digest para que las máquinas pidan exactamente esa imagen. Cómo viaja el digest del build al despliegue lo cuenta «CI/CD y registro de imágenes».

## El Dockerfile del gateway, línea por línea {The gateway's Dockerfile, line by line}

Un [[dockerfile|Dockerfile]] es la receta de una imagen: un archivo de texto con una instrucción por línea, que `docker build` lee de arriba abajo. Cada `FROM` empieza desde una imagen existente; cada `RUN`, `COPY` o `ADD` agrega una capa; el resto (`ENV`, `USER`, `CMD`, `EXPOSE`, `HEALTHCHECK`) solo cambia la configuración, y `WORKDIR` además crea la carpeta si no existe (una capa de unos KB). El comando que lo convierte en imagen es `docker build -t classifier-gateway:3f9c2ab gateway/`: `-t` le pone el nombre y `gateway/` es la carpeta con los archivos, que se explica más abajo. A esa construcción se le dice *build*.

Este es el del gateway de Alba, como **ilustración**. El `…` evita escribir los 64 caracteres del digest.

```dockerfile
# syntax=docker/dockerfile:1

# ---- Etapa 1, builder: instala las dependencias en un entorno aparte
FROM python:3.13-slim@sha256:… AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /build
COPY requirements.txt .
RUN pip install --only-binary=:all: -r requirements.txt

# ---- Etapa 2, runtime: lo único que se publica
FROM python:3.13-slim@sha256:… AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH"
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /srv
COPY --from=builder /opt/venv /opt/venv
COPY app/ ./app/
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=2s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=1)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", \
     "--timeout-keep-alive", "75", "--timeout-graceful-shutdown", "20", "--no-access-log"]
```

### La base y las dos etapas

`FROM python:3.13-slim@sha256:…` elige la [[imagen-base|imagen base]] (*base image*): la imagen de la que parte todo, aquí la variante `slim` de la imagen oficial de Python, un Debian recortado (Debian 13 en nov. de 2026) con Python 3.13 adentro. Alba la escribe con tag **y** digest: el tag dice cuál es, el digest garantiza que sea esa. Cuando sale una base nueva (con parches de seguridad, por ejemplo), un bot (un programa que trabaja solo) abre un [[pull-request|pull request]] que cambia el digest, y pasa por CI como cualquier cambio.

Hay dos `FROM`: es un [[multi-stage|build en varias etapas]] (*multi-stage build*). La etapa `builder` crea el entorno `/opt/venv` e instala las 37 dependencias. La etapa `runtime` empieza otra vez desde una base limpia y copia **solo** la carpeta `/opt/venv` con `COPY --from=builder`. Lo que se instaló o se ensució en la primera fuera de `/opt/venv` (la caché de [[pip]], cualquier [[compilar|compilador]], archivos temporales) no llega a la imagen final: solo se publica la última etapa. Pip sí llega: viene en la base `slim` y dentro del propio entorno.

En el gateway la ganancia es chica, porque todos los paquetes llegan como [[wheel|wheels]], paquetes ya compilados. Paga mucho cuando el builder necesita compiladores o una base de varios GB con las herramientas de [[cuda|CUDA]], el software de NVIDIA para programar la GPU: la etapa final no los lleva.

:::profundo La primera línea y los detalles de pip
La primera línea, `# syntax=docker/dockerfile:1`, le pide a BuildKit (el motor que hace los builds de Docker) la versión estable de la sintaxis del Dockerfile.

`--only-binary=:all:` hace que pip solo acepte wheels. Si un día falta el wheel de alguna dependencia para Linux, el build **falla**, en vez de intentar compilarla en silencio (y, en una imagen `slim` sin compiladores, fallar de forma más confusa). Las variables `PIP_NO_CACHE_DIR` y `PIP_DISABLE_PIP_VERSION_CHECK` apagan la caché de pip, que dentro de una imagen solo ocupa espacio, y el aviso de versión nueva.
:::

### Las variables, el usuario y el código

`ENV` deja [[variable-entorno|variables de entorno]] de fábrica, como contó «Configuración». `PYTHONUNBUFFERED=1` hace que cada línea de log salga al instante: sin ella, Python junta las líneas en memoria y, si el proceso muere, las últimas se pierden, que son justo las que explican por qué murió.

:::profundo Las otras dos variables
`PYTHONDONTWRITEBYTECODE=1` evita que Python intente escribir archivos `.pyc` (la versión ya traducida de cada módulo, que guarda para arrancar más rápido): en el clúster, la raíz del contenedor del gateway es de solo lectura (`readOnlyRootFilesystem`, como contó «El sistema operativo»). El [[path-shell|`PATH`]] es la lista de carpetas donde se buscan los programas; con `/opt/venv/bin` primero, `python` y `uvicorn` salen del entorno, sin correr el script `activate`.
:::

`groupadd` y `useradd` crean el usuario `app` con el número fijo **10001**, y `USER 10001` hace que todo lo que siga, y el proceso final, corra con ese usuario y no como [[root]], el administrador con todos los permisos. Es el [[usuario-no-root|usuario sin privilegios]] de la imagen. Va con número y no con nombre porque Kubernetes, con su regla «no corras como root», revisa el número: root siempre es el usuario 0, y con un nombre Kubernetes no puede saber si detrás está el 0. Y la trampa clásica: crear el usuario y olvidar la línea `USER` deja la imagen corriendo como root sin que nada avise.

`COPY app/ ./app/` copia el código con dueño root. El usuario 10001 puede leerlo pero no modificarlo: si alguien tomara el proceso, no podría reescribir el programa.

`EXPOSE 8080` solo **documenta** el [[puerto]] (el número que distingue a cada programa que escucha en una máquina) donde escucha el gateway; no abre nada. Abrirlo hacia afuera lo hace quien corre el contenedor, con `docker run -p 8080:8080` o con Kubernetes.

### Cómo arranca

La última línea dice qué proceso corre: [[uvicorn]], el servidor que recibe las conexiones y corre el código de FastAPI. Lleva las opciones que «Código de serving» explicó: un proceso por contenedor, 75 s de [[keep-alive]] (dejar abierta la conexión para la siguiente request) y 20 s para terminar lo pendiente al apagarse. Dos detalles son de esta estación.

El primero: `--host 0.0.0.0` hace que escuche en todas las interfaces de red del contenedor, la de adentro y la que da hacia afuera. Con `127.0.0.1` ([[localhost]], la propia máquina), solo aceptaría conexiones desde adentro del propio contenedor: el error clásico de «corre, pero no contesta».

El segundo: está en [[forma-exec|forma exec]], una lista JSON entre corchetes. Así Docker arranca uvicorn directo, y uvicorn es el [[pid|PID]] 1 del contenedor: el primer proceso, el que recibe los avisos de Docker. Al apagar, Docker le manda la [[senal|señal]] SIGTERM («termina lo que haces y sal»). Uvicorn la recibe, acaba las requests pendientes y sale.

En **forma shell** (`CMD uvicorn app.main:app …`, sin corchetes), Docker arranca primero un shell, `/bin/sh -c "…"`, y el shell arranca a uvicorn. Según el shell y el comando, el shell puede quedarse como PID 1, y entonces no le pasa el SIGTERM a uvicorn. Uvicorn nunca se entera de que tiene que apagarse, y a los 10 s (el plazo por omisión de `docker stop`) Docker lo mata con SIGKILL, la señal que no se puede atender ([[codigo-salida|código de salida]] 137), con las requests a medias. Lo viste con detalle en «Programa, proceso e hilo».

:::profundo ¿El shell siempre se queda como PID 1?
No siempre, y por eso el error es traicionero. El `sh` de Debian (dash) se reemplaza por el último comando cuando puede: con la línea de arriba, uvicorn sí quedaría como PID 1 y todo funcionaría. Pero basta un detalle, como un tubo (`… | tee app.log`, que pasa la salida de un comando a otro) o un script de arranque en bash sin `exec`, para que el PID 1 sea el shell y la señal se pierda. La forma exec no depende de esa suerte.
:::

### El chequeo de salud

`HEALTHCHECK` es el [[healthcheck-docker|chequeo de salud de la imagen]]: un comando que Docker corre dentro del contenedor cada cierto tiempo. Si sale con código 0, el contenedor está sano (*healthy*); si falla varias veces seguidas, enfermo (*unhealthy*). El del gateway le pregunta a su propio `/healthz` (el [[endpoint-salud|endpoint de salud]], la dirección que solo contesta «el proceso vive», sin consultar a nadie) cada 10 s, espera hasta 2 s cada respuesta, no cuenta las fallas de los primeros 10 s y lo da por enfermo tras 3 fallas seguidas.

Usa Python y no `curl` (un programa de terminal que manda [[request|requests]] HTTP) porque la imagen `slim` no trae `curl`: un chequeo con `curl` fallaría siempre y el contenedor nunca saldría sano.

Y una cosa que confunde: **Kubernetes ignora el `HEALTHCHECK`**. Lo usan `docker run` y compose, la herramienta para probar varios contenedores juntos que verás más abajo. En el clúster mandan los chequeos que se escriben en la configuración del [[pod]] (el paquete de uno o más contenedores que Kubernetes corre como unidad), que verás en «Kubernetes».

:::profundo Un # que no es comentario
Un `#` después de una instrucción no es comentario: `RUN pip install -r requirements.txt  # deps` le pasa `#` y `deps` al shell, que aquí sí lo trata como comentario, pero en `COPY app/ ./app/  # código` Docker toma `#` como otro archivo que copiar y `código` como la carpeta de destino: el build falla porque no hay ningún archivo `#`. Los comentarios van en su propia línea, empezando con `#`.
:::

## El orden de las capas y la caché {Layer order and the build cache}

### Cómo decide Docker qué rehacer

Construir la imagen del gateway desde cero tarda ≈ 30–60 s, casi todo en el `pip install` de las 37 dependencias. Repetirlo en cada cambio de una línea sería lento en una laptop y caro en CI. La [[cache-build|caché de build]] (*build cache*) lo evita: Docker guarda cada capa que construye junto con una **llave de caché**, un resumen de todo lo que produjo esa capa, y en el build siguiente reusa la capa si la llave es la misma.

La llave de cada paso depende de la llave del paso anterior, del texto de la instrucción y, en un `COPY`, de **los bytes** de los archivos que copia. Tres consecuencias:

- Docker compara bytes, no significado. Agregar un comentario a `requirements.txt` cambia sus bytes: el `pip install` se rehace aunque las dependencias sean las mismas.
- En un `RUN`, Docker solo mira el texto. `RUN apt-get update` (el comando de Debian que actualiza la lista de programas que se pueden instalar) se reusa mientras el texto y los pasos de arriba no cambien (y la capa siga en la caché), aunque haya parches nuevos afuera.
- La caché se rompe **hacia abajo**: si un paso cambia, todos los que siguen se rehacen, porque su llave incluye la de él.

La regla que sale de ahí: **lo que cambia poco va arriba; lo que cambia en cada commit, abajo.** El Dockerfile del gateway copia `requirements.txt`, instala, y solo al final copia el código.

:::formula Tiempo y capas nuevas de un build con caché
T = t_0 + sum_{k=j}^{K} t_k
Z = sum_{k=j}^{K} z_k
- K: el número de pasos que agregan capa, contados de arriba abajo (1 es el primero); en las cuentas solo se cuentan los que pesan o cambian (los `COPY` y el `pip install`), porque los demás salen siempre de la caché
- j: el primer paso cuya llave cambió; de \(j\) a \(K\) se rehace todo
- t_k: lo que tarda en construirse el paso \(k\), en segundos
- t_0: lo fijo de cada build, aunque todo salga de la caché (mandar los archivos y armar la imagen), en segundos
- T: lo que tarda el build, en segundos
- z_k: lo que pesa en disco la capa del paso \(k\), en MB
- Z: los MB de capas nuevas que deja el build (y que habría que subir al registro)
:::

Toma el caso más común: cambias una línea de `app/main.py`. Las capas del gateway tardan \(t_k\) ≈ 0.1 s para cada `COPY` y ≈ 40 s para el `pip install` (supuesto del ejemplo, dentro de los 30–60 s del build desde cero), con \(t_0\) ≈ 3 s. Compara el orden de Alba con el atajo de copiar todo de una vez con `COPY . .` antes de instalar:

:::cuenta Cambiar una línea de main.py, en los dos órdenes
Orden de Alba: paso que cambia, \(j\) // solo el último COPY lee main.py | `COPY app/`, el último: \(j = K\) | 3
Tiempo, \(T\) | \(t_0 + t_K\) = 3 + 0.1 | ≈ 3 s
Capas nuevas, \(Z\) // solo la capa del código | \(z_K\) | ≈ 0.048 MB
Con `COPY . .` antes de instalar: paso que cambia, \(j\) // ese COPY lee todo, main.py incluido | `COPY . .`, el primero de 2 | 1
Tiempo, \(T\) | \(t_0 + t_1 + t_2\) = 3 + 0.1 + 40 | ≈ 43 s
Capas nuevas, \(Z\) // \(z_1\): `requirements.txt` (≈ 4 KB) y el código (≈ 48 KB); \(z_2\): el entorno entero | \(z_1 + z_2\) = (0.004 + 0.048) + 160 | ≈ 160 MB
= Con el orden de Alba, un cambio de código cuesta ≈ 3 s (Alba mide ≈ 2–5 s) y una capa de ≈ 48 KB. Con el atajo, cada cambio cuesta ≈ 30–60 s y ≈ 160 MB nuevos en disco, que también habría que subir y que cada nodo tendría que volver a bajar.
:::

El código de abajo simula la caché con esa llave: cada paso tiene su texto, los archivos que copia, sus segundos y sus MB. Construye una vez para llenar la caché, cambia `main.py` y vuelve a construir.

```python
import hashlib

def build(receta, archivos, cache, t0=3):     # t0: mandar el contexto y exportar, ≈ 3 s
    llave, segundos, mb, rehechas = "", t0, 0, []
    for paso, usa, t, z in receta:             # paso, archivos que copia, segundos, MB en disco
        contenido = "".join(archivos[a] for a in usa)
        llave = hashlib.sha256((llave + paso + contenido).encode()).hexdigest()
        if llave not in cache:                 # caché rota: se rehace esta capa
            cache.add(llave); segundos += t; mb += z; rehechas.append(paso)
    return segundos, mb, rehechas

bien = [("COPY requirements.txt", ["requirements.txt"], 0.1, 0.004),
        ("RUN pip install", [], 40, 160), ("COPY app/", ["app/main.py"], 0.1, 0.048)]
mal = [("COPY . .", ["requirements.txt", "app/main.py"], 0.1, 0.052),
       ("RUN pip install", [], 40, 160)]

for nombre, receta in [("bien", bien), ("mal", mal)]:
    archivos = {"requirements.txt": "fastapi==… (37 paquetes)", "app/main.py": "v1"}
    cache = set()
    build(receta, archivos, cache)             # el primer build llena la caché
    archivos["app/main.py"] = "v2"             # cambias una línea de main.py
    s, mb, rehechas = build(receta, archivos, cache)
    print(f"{nombre}: {s:.1f} s, {mb:.3f} MB nuevos, rehace {rehechas}")
```

```salida
bien: 3.1 s, 0.048 MB nuevos, rehace ['COPY app/']
mal: 43.1 s, 160.052 MB nuevos, rehace ['COPY . .', 'RUN pip install']
```

Fíjate en la línea `llave = …`: la llave nueva lleva dentro la anterior. Por eso, en el orden malo, el `pip install` se rehace aunque su texto no cambió: cambió la llave de arriba.

:::figura e07-empaquetado-cache
El mismo cambio de una línea en `main.py`, con los dos órdenes. A la izquierda se rehace solo la última capa; a la derecha, desde el `COPY . .` hacia abajo.
:::

:::calculadora e07-empaquetado-cache
La calculadora suma la ecuación de arriba sobre un día: \(n\) es cuántos builds hace una persona en el día y \(f\) es el porcentaje de esos builds que cambian `requirements.txt`. Empieza con \(n\) = 30 y \(f\) = 5 % (supuestos del ejemplo). Sube \(f\) a 100 %: los dos órdenes cuestan lo mismo, porque cambiar las dependencias rehace la capa cara en los dos.
:::

### El contexto de build y el .dockerignore

`docker build … gateway/` tiene un último argumento: la carpeta `gateway/`. Es el [[contexto-build|contexto de build]] (*build context*): los archivos que el cliente de Docker (el comando `docker` que escribes en la terminal) le manda al motor que construye, y los únicos que un `COPY` puede ver. Todo lo que está en esa carpeta viaja, aunque el Dockerfile no lo use, y un `COPY . .` lo mete todo en la imagen.

El [[dockerignore|`.dockerignore`]] es la lista de lo que no viaja, con la misma forma que un [[gitignore|`.gitignore`]]. El del gateway de Alba tiene 19 patrones, en cinco grupos: pruebas, basura de Python y del editor, Git, secretos, y fotos y modelos. Los secretos son los más graves: un [[archivo-env|.env]] con una contraseña que entra a una capa queda ahí para quien baje la imagen, como contó «Configuración».

:::profundo Los 19 patrones, uno por uno
- **Pruebas**: `tests/`, `pytest.ini`, `requirements-dev.txt`. Las 26 pruebas corren en CI, fuera de la imagen; meterlas solo agrega archivos y herramientas que producción no usa.
- **Basura de Python y del editor**: `__pycache__`, `*.pyc`, `.pytest_cache`, `.venv/`, `venv/`, `.vscode/`, `.idea/`.
- **Git**: `.git/` y `.gitignore`. La carpeta `.git` trae toda la historia, que puede pesar más que el código.
- **Secretos**: `.env` y `*.pem` (archivos de certificados y llaves privadas).
- **Fotos y modelos**: `**/*.jpg`, `**/*.jpeg`, `**/*.png`, `**/*.onnx`, `**/*.plan`. Las fotos de prueba y cualquier modelo que alguien dejó en la carpeta. El gateway no necesita el modelo: vive en Triton.
:::

Un `.dockerignore` que falta no da ningún error: solo vuelve lento el build, rompe la caché (un `.pyc` nuevo cambia los bytes de un `COPY . .`) y puede meter un [[checkpoint]] de varios GB o un [[secreto]] en la imagen. Por eso conviene revisar de vez en cuando cuánto pesa lo que se manda: Docker lo imprime al empezar el build.

## La imagen de Triton y los pesos horneados {The Triton image and baked-in weights}

### Una base de 9.2 GB

La imagen de Triton parte de otra base: `nvcr.io/nvidia/tritonserver:24.08-py3`, de NGC, el catálogo de software de NVIDIA. Trae Ubuntu 22.04 (otra versión de Linux), CUDA 12.6, [[tensorrt|TensorRT]] 10.3 (la librería de NVIDIA que construye y corre los engines) y el propio Triton, y pesa ≈ 9.2 GB comprimida; su capa más grande, ≈ 4.3 GB.

:::profundo ¿Y una base de Triton más chica?
NVIDIA no publica una versión `slim` lista para servir. Se puede armar una más chica, solo con los *backends* que usas (los módulos que saben correr cada tipo de modelo: uno para TensorRT, otro para PyTorch…), con una herramienta que trae Triton, `compose.py`; pero las librerías de CUDA y de TensorRT siguen pesando varios GB. Alba usa la de NGC tal cual.
:::

Lo que importa de la base no es el tamaño, es la versión. Un engine de TensorRT, construido como el de Alba, solo carga con la misma versión de TensorRT con que se construyó (TensorRT tiene un modo de compatibilidad entre versiones, que Alba no usa). Por eso NVIDIA publica su software en [[release-ngc|releases de NGC]]: paquetes con un número año.mes, como `24.08`, en los que cada versión de CUDA, TensorRT y Triton ya viene emparejada. «Export, engine y paridad» lo contó a fondo. El engine de Alba se construyó con `nvcr.io/nvidia/tensorrt:24.08-py3`, así que Triton tiene que ser `tritonserver:24.08-py3`, la misma release `24.08`. Un `25.xx` traería otro TensorRT, y el engine no cargaría.

Y una regla de una línea sobre la GPU: la imagen trae las librerías de [[cuda|CUDA]], pero el [[driver]] de NVIDIA (el programa del sistema que maneja la GPU) lo pone el nodo, y ese driver tiene que soportar el CUDA de la imagen (aquí, 12.6). La imagen garantiza todo lo que vive en archivos; no garantiza el kernel, el driver, la GPU ni el tipo de CPU de la máquina donde corra.

### El Dockerfile de Triton

Es corto. Otra vez es una **ilustración**:

```dockerfile
# syntax=docker/dockerfile:1
# La misma release de NGC que construyó el engine (tensorrt:24.08-py3): TensorRT 10.3
FROM nvcr.io/nvidia/tritonserver:24.08-py3@sha256:…
COPY model_repository /models
RUN test -f /models/classifier/1/model.plan
EXPOSE 8000 8001 8002
CMD ["tritonserver", "--model-repository=/models", "--model-control-mode=none", \
     "--disable-auto-complete-config", "--exit-on-error=true", \
     "--strict-readiness=true", "--exit-timeout-secs=30"]
```

- `COPY model_repository /models` mete el repositorio de modelos completo: `classifier/config.pbtxt` y `classifier/1/model.plan`. Es la **última capa que pesa**, a propósito: lo que cambia con cada modelo va al final, igual que el código del gateway.
- `RUN test -f /models/classifier/1/model.plan` revisa que el engine esté. Si el pipeline olvidó bajarlo, `test` sale con código 1 y **el build falla**. Es mejor aquí, en un build, que en un pod que arranca, no encuentra su modelo y se reinicia una y otra vez en producción.
- `EXPOSE` documenta los tres puertos de Triton: 8000 para [[http|HTTP]] (por donde le habla el gateway), 8001 para [[grpc|gRPC]] (otra forma de pedirle predicciones) y 8002 para las métricas, los contadores de requests y tiempos que lee el monitoreo.
- El `CMD` en forma exec, con las opciones que explicó «Código de serving»: cargar solo lo que hay en `/models` al arrancar, no inventar configuración, salir con error si un modelo no carga y no decirse listo hasta que todo cargó.

La base de NGC corre como root. Alba no agrega `USER` en esta imagen: el usuario sin privilegios lo fija el pod en el clúster («Kubernetes» lo escribe). Es una decisión, no un olvido, y conviene saber cuál de los dos lugares, la imagen o el pod, te protege.

### Los pesos, horneados

Meter el engine dentro de la imagen se llama **hornear los pesos**: [[pesos-horneados|pesos horneados]] (*baked-in weights*). El tag de la imagen es la versión del modelo, `classifier-triton:resnet50-2026-10-01`, y la imagen es, entera, «esta versión del modelo servida así».

¿Quién la hornea? El *workflow* `triton-modelo` (una lista de pasos que CI corre sola) del repositorio `classifier`, en el [[runner-ci|runner]] propio de CI, la máquina con una T4 como la de producción: baja el engine del registro de modelos, verifica su SHA-256, corre `docker build`, prende la imagen para ver que Triton cargue y quede listo, y la sube. Lo dispara el pipeline mensual de entrenamiento cuando registra la versión como `challenger`. Esta lección escribe la receta; «CI/CD y registro de imágenes» cuenta el workflow.

La otra opción es dejar los pesos fuera, en S3 (el almacén de archivos de AWS), y que el servidor los baje cada vez que arranca. La tabla compara las dos.

| | Pesos dentro (Alba) | Pesos fuera |
|---|---|---|
| Qué es la imagen | Un [[artefacto]]: servidor + modelo, que no cambia | Solo el servidor; el modelo se baja al arrancar |
| Versión del modelo | La dice el tag (y el digest) | Va aparte: una variable, una ruta en S3 |
| Volver atrás | Desplegar el digest anterior | Cambiar la ruta y reiniciar |
| Al arrancar | Nada que bajar aparte de la imagen | Bajar los pesos de S3 en cada arranque |
| Lo malo | Una imagen por versión; quien puede bajar la imagen puede leer el modelo | Otra dependencia al arrancar; el mismo tag sirve contenidos distintos |

Para el engine de Alba la cuenta es fácil: ≈ 50–150 MB contra una base de ≈ 9.2 GB, menos del 2 %. Hornearlo no hace notoriamente más pesada la imagen y deja un solo nombre para «qué corre». Una regla práctica (no un estándar) va por tamaño: unos cientos de MB o hasta ≈ 1 GB, dentro y en la última capa; decenas de GB, fuera. El caso del medio depende de cuántas veces se arranca y de cuánto pesa bajar por separado.

:::ojo
Hornear los pesos convierte el permiso de bajar la imagen en permiso de leer el modelo. Si el modelo es valioso o tiene datos sensibles, quién puede bajar del registro es una decisión de seguridad, no de comodidad.
:::

## Cuánto pesa y cuánto tarda en bajar {How much it weighs and how long it takes to pull}

Antes de arrancar un contenedor, el nodo necesita la imagen en su disco. Si no la tiene, la baja del registro: eso es el [[pull-imagen|pull]] (*image pull*), que baja cada capa que falta, la descomprime y la deja lista. Lo que cuenta es el tamaño de lo que **falta**, no el de la imagen entera.

:::formula Tiempo de pull
P = frac{S − S_c}{v}
- S: lo que pesa la imagen comprimida, en GB
- S_c: lo que ya está en el nodo, en capas con la misma huella, en GB
- v: el ritmo efectivo de bajar y descomprimir, en GB/s
- P: el tiempo de pull, en segundos
:::

El equipo de Alba estima \(v\) entre ≈ 0.03 y 0.09 GB/s efectivos: la red entrega más, pero descomprimir y escribir en el disco las capas, una tras otra, frena.

:::cuenta El pull de las dos imágenes en un nodo vacío
Gateway: lo que pesa, \(S\) // nada en el nodo: \(S_c\) = 0 | ≈ 87 MB | 0.087 GB
\(P\) del gateway, ritmo alto // \(v\) = 0.09 GB/s | \((S − S_c)/v\) = 0.087 ÷ 0.09 | ≈ 1 s
\(P\) del gateway, ritmo bajo // \(v\) = 0.03 GB/s | 0.087 ÷ 0.03 | ≈ 3 s
Triton: lo que pesa, \(S\) // nada en el nodo: \(S_c\) = 0 | ≈ 9.2 GB | 9.2 GB
\(P\) de Triton, ritmo alto // \(v\) = 0.09 GB/s | \((S − S_c)/v\) = 9.2 ÷ 0.09 | ≈ 102 s
\(P\) de Triton, ritmo bajo // \(v\) = 0.03 GB/s | 9.2 ÷ 0.03 | ≈ 307 s
= El gateway baja en ≈ 1–3 s; Triton, en ≈ 2–5 min. Es la misma razón de ≈ 100 entre sus tamaños.
:::

Esos 2–5 min son la parte más grande del arranque de un pod nuevo de Triton, que el equipo de Alba estima en ≈ 5–13 min con todo: conseguir una máquina con GPU, bajar la imagen, cargar el engine y calentarlo ([[warmup-inferencia|warmup]]: correr unas predicciones de prueba para que las primeras de verdad no salgan lentas). Por eso, cuando el tráfico sube y hace falta otra T4, la imagen pesada se nota; el gateway, que escala de 3 a 12 copias, casi no. Es el [[cold-start|arranque en frío]] de «Servicios gestionados», con su parte de Docker a la vista.

### Una versión nueva en un nodo que ya tiene la anterior

Aquí paga poner el engine en la última capa. La imagen de noviembre, `resnet50-2026-11-01`, tiene las mismas capas de la base que la de octubre; solo cambia la capa del engine. Un nodo que ya corría la de octubre solo baja esa capa.

```python
capas_base = {"base-1": 4.3, "base-2": 2.1, "base-3": 1.5, "base-4": 0.8, "base-5": 0.5}  # GB
imagen_14 = {**capas_base, "engine-v14": 0.05}     # resnet50-2026-10-01
imagen_15 = {**capas_base, "engine-v15": 0.05}     # resnet50-2026-11-01

def pull(imagen, en_el_nodo, v):                   # v: GB/s efectivos (bajar y descomprimir)
    falta = sum(gb for capa, gb in imagen.items() if capa not in en_el_nodo)
    return falta, falta / v

for caso, nodo in [("nodo vacío", set()), ("nodo con la v14", set(imagen_14))]:
    for v in (0.09, 0.03):
        gb, t = pull(imagen_15, nodo, v)
        print(f"{caso:16} v={v}: baja {gb:.2f} GB en {t:6.1f} s")
```

```salida
nodo vacío       v=0.09: baja 9.25 GB en  102.8 s
nodo vacío       v=0.03: baja 9.25 GB en  308.3 s
nodo con la v14  v=0.09: baja 0.05 GB en    0.6 s
nodo con la v14  v=0.03: baja 0.05 GB en    1.7 s
```

El reparto de la base en cinco capas es de juguete (la de 4.3 GB sí es la más grande de la base real), y el engine de 0.05 GB es el extremo bajo de sus ≈ 50–150 MB. La conclusión no depende de eso: si el engine fuera la **primera** capa, cambiarlo cambiaría la llave de caché de todas las de arriba: se reconstruirían, saldrían con otra huella y cada versión nueva bajaría los ≈ 9.2 GB completos.

:::calculadora e07-empaquetado-pull
Empieza con la imagen de Triton en un nodo vacío, al ritmo del medio, 0.06 GB/s: da \(P\) ≈ 153 s, unos 2.6 min. Pon \(S\) en 9.25 y \(S_c\) en 9.2: es una versión nueva en el nodo que ya tiene la base, y solo baja el engine de 0.05 GB; debe dar \(P\) ≈ 0.8 s. Luego pon \(S\) en 0.087 y \(S_c\) en 0: es el gateway, y debe dar \(P\) ≈ 1.5 s.
:::

:::figura e07-empaquetado-tamanos
Las dos imágenes a la misma escala, con lo que tarda cada una en bajar. Optimizar la imagen del gateway ahorra MB; los GB están en la de Triton.
:::

:::profundo Para que arranque más rápido
Si quieres que la imagen arranque más rápido, trabaja donde están los GB. Quitarle 20 MB al gateway ahorra menos de un segundo; en Triton, lo que ayuda es no bajar la base cada vez: que el nodo ya la tenga desde que nace, o que la versión nueva solo cambie la capa de arriba. «Kubernetes» vuelve sobre esto.
:::

## Probar los dos juntos: compose y el healthcheck {Testing both together: compose and the healthcheck}

### Docker Compose

Probar cada imagen sola no basta: el gateway sin Triton no clasifica nada. [[docker-compose|Docker Compose]] levanta varios contenedores en una sola máquina a partir de un archivo [[yaml|YAML]] (texto con nombres y valores, ordenado por sangría), `docker-compose.yml`, con un comando: `docker compose up --build`. Alba lo usa para desarrollo y para probar los dos juntos en una máquina con GPU NVIDIA. No es para producción: corre en una sola máquina y no cambia de versión poco a poco. Eso lo hace Kubernetes.

Esta es la parte que importa del archivo de Alba (**ilustración**; se omite un servicio de métricas que también trae):

```yaml
services:
  triton:
    build: ./triton
    ports: ["8000:8000", "8002:8002"]
    shm_size: 1g
    deploy:
      resources:
        reservations:
          devices: [{ driver: nvidia, count: 1, capabilities: [gpu] }]
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/v2/health/ready"]
      interval: 5s
      timeout: 2s
      retries: 3
      start_period: 60s
  gateway:
    build: ./gateway
    ports: ["8080:8080"]
    environment:
      TRITON_URL: "triton:8000"
      MODEL_VERSION: "resnet50-2026-10-01"
      INFER_TIMEOUT_S: "0.15"
    volumes: ["./labels.json:/etc/classifier/labels.json:ro"]
    depends_on:
      triton:
        condition: service_healthy
    restart: unless-stopped
```

Línea por línea, lo nuevo:

- `ports: ["8080:8080"]` **publica** el puerto: lo que llegue al 8080 de la máquina va al 8080 del contenedor. Eso no lo hace `EXPOSE`.
- `shm_size: 1g` le da a Triton 1 GB de memoria compartida (`/dev/shm`): un pedazo de RAM que varios procesos pueden leer y escribir a la vez, y que Triton usa por dentro. Es lo mismo que tiene en el clúster; el valor de fábrica de Docker, 64 MB, es mucho menor.
- `deploy.resources.reservations.devices` le pide a Docker una GPU NVIDIA. Para eso, la máquina necesita el driver de NVIDIA y el NVIDIA Container Toolkit, el programa que le da al contenedor acceso a la GPU.
- `environment` le pasa al gateway sus variables: dónde está Triton, qué versión del modelo espera y el plazo de 0.15 s de cada llamada a Triton. En `TRITON_URL: "triton:8000"`, **el nombre del servicio es su dirección**. El gateway encuentra a Triton por `triton`, no por una [[direccion-ip|dirección IP]]. Desde el gateway, `localhost` sería el propio gateway: poner `localhost:8000` ahí es de los errores más comunes.
- `volumes` monta el [[labels-json|`labels.json`]] (los nombres de las 500 categorías, en el orden de las salidas del modelo) de solo lectura, en la carpeta donde el gateway lo busca al arrancar. En el clúster llega como un [[configmap|ConfigMap]], uno por versión del modelo, que Kubernetes pone como archivo en esa misma carpeta.
- `depends_on … condition: service_healthy`: el gateway **no arranca hasta que el chequeo de Triton pase**. Sin eso, el gateway arrancaría en un segundo, Triton tardaría un minuto en cargar el engine, y las primeras requests saldrían con error 503, el [[codigo-estado|código HTTP]] de «servicio no disponible».
- `restart: unless-stopped`: si el proceso muere, Docker lo vuelve a levantar, salvo que lo hayas parado tú.

La imagen de Triton sí trae `curl`, así que su chequeo lo usa contra `/v2/health/ready`, que responde 200 («todo bien») solo cuando el modelo cargó.

:::diagrama e07-empaquetado-compose
Una máquina con GPU y los dos contenedores, con la foto de prueba entrando por el puerto publicado. El recorrido sigue un `docker compose up` desde cero.
:::

### Las cuentas del chequeo

Un chequeo tiene cuatro números, y cada uno responde una pregunta distinta. Con ellos se calculan dos tiempos: cuánto tarda en notar que un proceso se colgó, y cuánto puede tardar en arrancar antes de que lo den por enfermo.

:::formula Tiempos de un healthcheck
D = r × (i + w)
A = g + r × i
- i: el intervalo entre un chequeo y el siguiente, en segundos (*interval*)
- w: lo más que espera cada chequeo antes de contarlo como falla, en segundos (*timeout*)
- r: cuántas fallas seguidas lo dan por enfermo (*retries*)
- g: la gracia al arrancar: lo que tarda en empezar a contar las fallas, en segundos (*start period*)
- D: lo más que tarda en marcar como enfermo un proceso que se colgó, en segundos
- A: lo más que puede tardar en arrancar sin que lo den por enfermo, en segundos
- L: lo que tarda de verdad el proceso en estar listo, en segundos; sale sano si \(L < A\), y \(A − L\) es el colchón que le sobra
:::

Las dos cuentan distinto por cómo falla el chequeo. Un proceso **colgado** no contesta: cada chequeo se agota esperando sus \(w\) segundos, y el siguiente empieza \(i\) segundos después de que termina el anterior. Un proceso que todavía **arranca**, en cambio, rechaza la conexión o contesta «todavía no» al instante: cada falla dura casi nada, y solo cuentan los \(i\) segundos entre chequeos.

:::cuenta Los dos chequeos de Alba en compose
Gateway: \(i, w, r, g\) // interval, timeout, retries y start-period de su HEALTHCHECK | del Dockerfile | 10 s, 2 s, 3, 10 s
Gateway: detectar que se colgó, \(D\) | 3 × (10 + 2) | ≈ 36 s
Triton: \(i, w, r, g\) // interval, timeout, retries y start_period de su healthcheck | del compose | 5 s, 2 s, 3, 60 s
Triton: detectar que se colgó, \(D\) | 3 × (5 + 2) | ≈ 21 s
Triton: arranque más largo tolerado, \(A\) | 60 + 3 × 5 | ≈ 75 s
Triton: lo que tarda en estar listo, \(L\) // carga el engine y corre el warmup | lo estima el equipo de Alba | ≈ 10–60 s
Triton: colchón en el peor caso, \(A − L\) // con el \(L\) más lento, 60 s | 75 − 60 | ≈ 15 s
= La gracia de Triton, 60 s, cubre su arranque más lento, y le quedan ≈ 15 s de colchón antes de que compose lo dé por enfermo. La del gateway, 10 s, basta para un programa que arranca en un par de segundos.
:::

Si \(g\) fuera de 10 s para Triton, \(A\) = 10 + 3 × 5 = 25 s, y un Triton con \(L\) = 50 s saldría enfermo sin estar roto. Entonces el gateway nunca arrancaría: `depends_on` esperaría un sano que no llega. Una gracia muy larga tiene el problema contrario: tarda en avisar de un arranque que de verdad se rompió.

Cuando todo está sano, la prueba es la misma request que haría Ana, la usuaria del ejemplo del curso, al subir la foto de unos tenis:

`curl -H "Content-Type: image/jpeg" --data-binary @tenis.jpg "localhost:8080/v1/classify?top_k=5"`

`-H` dice que lo que va es un JPEG, `--data-binary @tenis.jpg` manda los bytes del archivo tal cual y `top_k=5` pide las 5 categorías más probables. La respuesta trae las 5 categorías con su confianza y `"model_version": "resnet50-2026-10-01"`, la que dice el tag de la imagen de Triton. Si la versión no coincide, compose levantó otra imagen de la que creías.

## Lo que la imagen no fija sola {What the image doesn't pin by itself} [extra]

Una imagen es reproducible solo en lo que alguien fijó. Tres cosas que se escapan si no las cuidas.

### Para qué máquina: la plataforma

Una imagen se construye para una [[arquitectura-cpu|arquitectura de CPU]]: su **plataforma** (*platform*), como `linux/amd64` (los x86-64 de Intel y AMD) o `linux/arm64` (los ARM). Los wheels del entorno y el propio Python son programas ya compilados para una de las dos. La [[plataforma-imagen|plataforma de la imagen]] de Alba es `linux/amd64`, la de sus nodos: los g4dn (con la T4) y los c6i (solo CPU), dos tipos de máquina de AWS con CPU de Intel.

Una Mac con chip de Apple es arm64, y `docker build` ahí construye arm64 sin preguntar. Esa imagen, en un nodo amd64, no arranca: el contenedor muere con `exec format error`, porque el kernel no sabe ejecutar ese [[binario-ejecutable|binario]], escrito en las instrucciones de otra CPU. Hay dos salidas: construir con `docker buildx build --platform linux/amd64` (más lento en la Mac, porque imita la otra CPU por software) o, mejor, dejar que la construya CI en una máquina amd64, que es lo que hace Alba.

Una imagen también puede ser **multiplataforma**: un índice que lista una imagen por plataforma. Ojo con un detalle: el digest del índice no es el de la imagen amd64 que lista. Si vas a fijar un digest, asegúrate de saber cuál de los dos estás fijando.

### Qué base te tocará en seis meses

`FROM python:3.13-slim` sin digest significa «la que señale ese tag el día del build». Los mantenedores de la imagen oficial la reconstruyen con parches: dentro de seis meses, el mismo Dockerfile, sin cambiar una línea, da otra base. Puede ser mejor (con parches de seguridad) o romper algo. Por eso Alba fija tag y digest, y deja que un bot proponga el cambio de digest como pull request, con sus pruebas. Lo mismo vale para las dependencias: las 37 están fijadas con `==`.

El `RUN apt-get update` tiene la versión opuesta del mismo problema: la caché lo reusa mientras su texto y lo de arriba no cambien, aunque pasen meses. Por eso se escribe en el **mismo** `RUN` que el `apt-get install`: si cambias lo que instalas, se rehacen los dos juntos.

### Lo que se borra no se va

Como en los acetatos, una capa no se puede borrar desde arriba. Si un paso copia un archivo y otro lo borra, la imagen pesa igual y el archivo sigue en la capa de abajo:

- `COPY .env .` seguido de `RUN rm .env`: el [[secreto]] queda en la imagen para siempre, y cualquiera con permiso de bajarla lo saca con un comando.
- `ARG HF_TOKEN` para bajar algo durante el build: `ARG` es una variable que solo existe mientras se construye, aquí con el token (una contraseña larga) de una cuenta de Hugging Face. Su valor puede quedar en el historial de la imagen, que `docker history` muestra a cualquiera que la tenga.
- Bajar un archivo de 2 GB, descomprimirlo y borrar el original en otro `RUN`: los 2 GB se quedan en la capa del primero.

La regla es que lo que no debe estar nunca entre al contexto ni a una capa: el `.dockerignore` lo deja fuera, el multi-stage deja en la etapa del builder lo que solo hacía falta para construir, y los secretos llegan al contenedor cuando corre, no cuando se construye. La cadena de controles que corre sobre la imagen terminada (la [[sbom|lista de todo lo que trae]], el [[escaneo-vulnerabilidades|escaneo de vulnerabilidades]] y la [[firma-imagen|firma]] de su digest) la presentó «Ataques y cadena de suministro»; en qué paso del pipeline corre cada uno lo cuenta «CI/CD y registro de imágenes».

## Errores comunes {Common mistakes}

:::ojo
**Copiar el código antes de instalar.** Un `COPY . .` arriba del `pip install` rehace las dependencias en cada cambio: ≈ 30–60 s y ≈ 160 MB en vez de ≈ 2–5 s y ≈ 48 KB. Evítalo: `requirements.txt`, instalar y, al final, el código.
:::

:::ojo
**Usar `latest` o un tag que se mueve.** No sabes qué corre ni puedes volver a «la de ayer». Evítalo: tags con el commit o la versión del modelo, y el digest para desplegar.
:::

:::ojo
**Crear el usuario y olvidar `USER`.** La imagen sigue corriendo como root, sin aviso. Evítalo: `USER 10001`, con número, y revisa con `docker run --rm <imagen> id` (que arranca la imagen, imprime con qué usuario corre y la borra) que no diga `uid=0`.
:::

:::ojo
**`CMD` en forma shell.** Si el shell queda como PID 1, no le pasa el SIGTERM al programa y el apagado termina en SIGKILL a los 10 s. Evítalo: forma exec, con corchetes, y `exec` al final de cualquier script de arranque.
:::

:::ojo
**Un chequeo con `curl` en una imagen que no lo trae.** El contenedor nunca sale sano, y nada de lo que lo espera con `depends_on` arranca. Evítalo: usa algo que la imagen sí tenga (Python, en el gateway) y prueba el chequeo a mano con `docker exec`, que corre un comando dentro de un contenedor que ya está corriendo.
:::

:::ojo
**Escuchar en `127.0.0.1` o apuntar a `localhost`.** Dentro de un contenedor, `localhost` es el propio contenedor. Evítalo: el servidor escucha en `0.0.0.0` y llama a los otros servicios por su nombre (`triton:8000`).
:::

:::ojo
**Construir en la Mac y desplegar en amd64.** Una Mac con chip de Apple tiene otra CPU (arm64) que los nodos de Alba (amd64), y `docker build` construye para la CPU donde corre: en el nodo, la imagen muere con `exec format error`. Evítalo: `--platform linux/amd64` o, mejor, que la construya CI.
:::

## En la vida real {In real life} [extra]

### En Alba

En un día normal, el equipo de Alba hace ≈ 3–5 merges al gateway, y cada uno produce una imagen nueva de ≈ 87 MB, de la que solo cambian los ≈ 48 KB del código. Una vez al mes, al registrar el modelo nuevo como `challenger`, el workflow `triton-modelo` hornea una imagen de Triton de ≈ 9.2 GB, de la que solo cambia la capa del engine. Nadie en Alba piensa en «instalar Python en el servidor»: los nodos de Kubernetes no tienen nada de Alba instalado, solo bajan imágenes por digest.

### Otros casos

- **Un LLM propio.** El LLM propio de Alba pesa ≈ 70.6 GB en FP8 (un byte por cada número del modelo). Su registro de imágenes, Amazon ECR, acepta capas de hasta 52,000 MiB (mebibytes, de 1,048,576 bytes cada uno), ≈ 54.5 GB (un límite fijo del servicio): el modelo no cabe ni como una sola capa. Los pesos van fuera de la imagen, en S3, y cada copia los baja al arrancar a ≈ 0.2–1 GB/s (supuesto del ejemplo; es más rápido que el pull de una imagen porque son archivos que se bajan en paralelo, sin capas que descomprimir una tras otra): de ≈ 70 s a ≈ 6 min solo en eso. Ahí la regla por tamaño decide sola.
- **Recomendación.** El índice de vectores de la recomendación de Alba pesa ≈ 38 GB (12.8 GB de vectores más 25.6 GB del grafo que los conecta) y se reconstruye seguido, cuando entran productos nuevos (supuesto del ejemplo). Cabría en una capa, pero hornearlo haría una imagen de decenas de GB por cada índice nuevo. Va fuera: la imagen trae el programa, y el índice se baja aparte, con su propia versión.
- **Inspección visual en una fábrica.** Una cámara con su propia GPU en la línea corre el modelo en un contenedor, con compose, porque es una sola máquina. La base tiene que ser de la misma versión que el software de NVIDIA instalado en el aparato, por la misma razón que la release 24.08 de Alba: el engine solo carga con su versión. Y Docker, por sí mismo, no reinicia un contenedor enfermo; hace falta algo que vigile y lo mate para que `restart` lo levante.
- **Entrenar.** El entrenamiento de Alba corre en una imagen propia, fijada por digest (`sha256:b71e04d2…`, de juguete), con versiones exactas de Python, PyTorch, CUDA y Pillow (la librería que abre las fotos). El modelo guarda ese digest junto con la versión de los datos y el commit del código: son los tres punteros de «Versionado y linaje», y este es el que dice con qué programa se entrenó.

### Fuera de ML

Vuelve al guisado congelado del principio: quien lo caliente, en cualquier cocina, obtiene el mismo platillo, porque todo viene adentro. Pero el congelado no trae la estufa: si viene en charola de aluminio y en esa cocina solo hay microondas, no hay platillo. Es la plataforma y el driver: la imagen trae todo lo que vive en archivos, no la máquina.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(T\), \(t_0\), \(t_k\), \(j\), \(K\), \(Z\), \(z_k\) (build con caché); \(P\), \(S\), \(S_c\), \(v\) (pull); \(i\), \(w\), \(r\), \(g\), \(D\), \(A\), \(L\) (healthcheck).

:::ejercicios
? [facil] La imagen del gateway pesa 43 + 44 + 0.048 MB comprimida. ¿Cuánto suma, y cuántas veces cabe en la imagen de Triton de ≈ 9.2 GB? ¿Qué parte del gateway es código del equipo?
- El tamaño \(S\) de una imagen es la suma de sus capas: \(S\) = 43 + 44 + 0.048 = 87.048 ≈ **87 MB**.
- Cuántas veces cabe: \(S_{Triton} ÷ S_{gateway}\). Con 9.2 GB = 9,200 MB: 9,200 ÷ 87 ≈ **106**, la razón de ≈ 100.
- El código es 0.048 ÷ 87 ≈ 0.00055, una parte en ≈ 1,800. Casi todo lo que pesa la imagen lo escribió alguien más.
? [facil] Un compañero cambia una línea de `requirements.txt` (sube la versión de un paquete). Con el orden de Alba, ¿qué pasos se rehacen y cuánto tarda el build, con \(t_0\) = 3 s, 0.1 s por cada `COPY` y 40 s el `pip install`?
- La ecuación es \(T = t_0 + sum_{k=j}^{K} t_k\). Los pasos que cuentan son 3 (\(K\) = 3): 1 `COPY requirements.txt`, 2 `pip install` y 3 `COPY app/`.
- \(j\) = 1: el `COPY requirements.txt` es el primero que lee ese archivo. De ahí hacia abajo se rehace todo.
- \(T = t_0 + t_1 + t_2 + t_3\) = 3 + 0.1 + 40 + 0.1 ≈ **43 s**.
- Es lo mismo que el orden malo, y está bien: cambiar las dependencias **sí** obliga a reinstalar. El orden solo ahorra cuando cambia el código.
? [facil] ¿Cuánto tarda el pull de una imagen que el nodo ya tiene completa, con \(S\) = 9.2 GB y \(S_c\) = 9.2 GB? ¿Y por qué una imagen nueva del gateway, en un nodo que ya tenía la anterior, baja en menos de un segundo?
- \(P = (S − S_c)/v\) = (9.2 − 9.2) ÷ \(v\) = **0 s**: no baja nada.
- La imagen nueva del gateway comparte la base y las dependencias con la anterior (mismas huellas). Solo falta la capa del código, ≈ 0.048 MB = 0.000048 GB: a 0.03 GB/s, 0.000048 ÷ 0.03 ≈ 0.002 s. Tarda más preguntarle al registro qué capas hay.
? [medio] Un Dockerfile del gateway termina así: `COPY app/ ./app/` · `RUN pip install -r requirements.txt` · `COPY requirements.txt .`. ¿Qué falla primero, y qué pasa con la caché aunque lo arregles moviendo solo la última línea arriba del `RUN`?
- Falla el build: el `pip install` corre antes de que exista `requirements.txt` en la imagen, y pip sale con error porque no encuentra el archivo.
- Si mueves `COPY requirements.txt .` arriba del `RUN` pero dejas `COPY app/` primero, el build funciona, pero el primer paso que cambia en cada commit es el `COPY app/`: \(j\) = 1, y el `pip install` se rehace siempre. Con \(T = t_0 + sum_{k=j}^{K} t_k\) y los tres pasos (`COPY app/`, `COPY requirements.txt`, `pip install`): \(T\) = 3 + 0.1 + 0.1 + 40 ≈ 43 s por cambio.
- El orden correcto es `COPY requirements.txt .` → `RUN pip install …` → `COPY app/ ./app/`.
? [medio] Con un ritmo de \(v\) = 0.05 GB/s, ¿cuánto tarda el pull de Triton en un nodo vacío? Si el engine fuera la primera capa (debajo de la base), ¿cuánto bajaría una versión nueva del modelo en un nodo que ya tiene la anterior? ¿Y con el engine arriba, de 0.15 GB?
- La ecuación es \(P = (S − S_c)/v\). Nodo vacío, \(S_c\) = 0: \(P\) = 9.2 ÷ 0.05 = **184 s** ≈ 3 min.
- Engine abajo: cambia la primera capa, cambian las llaves de caché de todas las de arriba, se reconstruyen con otra huella y ya no coinciden con las del nodo: \(S_c\) = 0. Baja todo: ≈ **184 s** otra vez.
- Engine arriba: \(S − S_c\) = 0.15 GB; \(P\) = 0.15 ÷ 0.05 = **3 s**.
? [medio] Para el gateway, alguien propone un healthcheck más agresivo: \(i\) = 2 s, \(w\) = 1 s, \(r\) = 2. ¿Cuánto vale \(D\)? ¿Qué ganas y qué arriesgas, si sabes que un momento de mucha CPU puede dejar al gateway sin contestar 2 s?
- \(D = r × (i + w)\) = 2 × (2 + 1) = **6 s**, contra 36 s del de Alba.
- Ganas: un gateway colgado se nota 6 veces antes.
- Arriesgas: con \(w\) = 1 s, una pausa de 2 s cuenta como falla; dos pausas seguidas y queda enfermo sin estarlo. Además el chequeo corre 5 veces más seguido (10 ÷ 2), compitiendo por la misma CPU. Un chequeo debe tolerar lo normal y atrapar lo roto.
? [reto] Un día, Triton tarda \(L\) = 68 s en estar listo porque el disco de la máquina de pruebas es lento. Con el healthcheck de compose de Alba (\(i\) = 5, \(w\) = 2, \(r\) = 3, \(g\) = 60), ¿sale sano? ¿Qué pasa si tarda 90 s? Propón un \(g\) que tolere 90 s con ≈ 20 s de colchón, y di qué pierdes.
- Mientras arranca, cada chequeo falla al instante: \(A = g + r × i\) = 60 + 3 × 5 = **75 s**.
- A los 68 s: después de los 60 s de gracia solo caben una o dos fallas contadas antes de que Triton conteste; el chequeo siguiente pasa y Triton sale **sano**: \(L\) = 68 < \(A\) = 75, con un colchón \(A − L\) ≈ 7 s.
- Con \(L\) = 90 s > \(A\) = 75 s: hacia los ≈ 75 s ya hay 3 fallas seguidas: Triton queda **enfermo**, aunque iba a estar listo, y el gateway no arranca (`depends_on` falla).
- Para tolerar 90 s con ≈ 20 s de colchón: \(A = L + 20\) = 110 s. Despejando de \(A = g + r × i\): \(g = A − r × i\) = 110 − 15 = **95 s**.
- Pierdes rapidez para notar un arranque roto de verdad: la alarma llega a los ≈ 110 s en vez de a los ≈ 75 s. En una máquina de pruebas es aceptable.
? [reto] El equipo de Alba evalúa sacar el engine de la imagen y bajarlo de S3 al arrancar, con una imagen de Triton genérica `classifier-triton:24.08`. Da dos cosas que mejoran y tres que empeoran, con números de la lección donde puedas. ¿Lo harías?
- Mejora: (1) una sola imagen de Triton para todos los modelos, que no se reconstruye cada mes; (2) quien puede bajar la imagen ya no puede leer el modelo.
- Empeora: (1) el tag ya no dice la versión del modelo: `classifier-triton:24.08` serviría `resnet50-2026-10-01` o `-11-01` según una variable; (2) volver atrás ya no es «el digest anterior»: hay que cambiar la variable y que el engine viejo siga en S3; (3) cada arranque baja ≈ 50–150 MB de S3 y depende de que S3 responda.
- Con un engine de ≈ 50–150 MB, menos del 2 % de la imagen, hornear casi no cuesta. Lo razonable es seguir horneando; sacar los pesos paga con modelos de decenas de GB, como el LLM de ≈ 70.6 GB.
:::

:::profundo Dos ejercicios más, para la segunda pasada
:::ejercicios
? [facil] Di si cada cosa la garantiza la imagen del gateway o no: (a) la versión de Python; (b) la versión del kernel; (c) los 37 paquetes; (d) que la CPU sea x86-64; (e) la variable `PYTHONUNBUFFERED=1`.
- (a) **Sí**: viene en la base. (c) **Sí**: en la capa de `/opt/venv`. (e) **Sí**: es configuración de la imagen.
- (b) **No**: el kernel es el del nodo, compartido por todos sus contenedores.
- (d) **No**: la imagen fue construida para amd64, pero corre donde la mandes; en un nodo ARM falla con `exec format error`.
? [medio] El `.dockerignore` del gateway se borra por error. En la carpeta hay, además del código, un `.git/` de 120 MB y un `model.onnx` de 98 MB que alguien dejó para probar. El Dockerfile usa `COPY app/ ./app/`, no `COPY . .`. ¿Qué cambia en la imagen, qué cambia en el build y qué cambiaría con `COPY . .`?
- La imagen **no cambia**: `COPY app/` solo copia esa carpeta, y lo demás no entra.
- El build sí: el contexto crece en ≈ 218 MB (120 + 98) que viajan al motor de build en cada build. Más lento, sin ningún error que avise.
- Con `COPY . .`, los ≈ 218 MB entrarían a una capa: a lo más ≈ 87 + 218 ≈ 305 MB comprimida, algo menos si `.git/` se comprime bien (el `model.onnx`, casi nada). Y el `model.onnx` daría permiso de leer el modelo a quien baje el gateway.
:::
:::

## Lo que sigue {What comes next}

- «CI/CD y registro de imágenes» construye estas dos imágenes una sola vez en CI, en máquinas amd64, las sube al registro de Alba con tags que no se pueden mover y hace que el despliegue pida cada una por su digest. También guarda la caché de capas en una máquina que se borra después de cada job.
- «Kubernetes» corre las imágenes en el clúster: el usuario sin privilegios de Triton, los chequeos del pod (que reemplazan al `HEALTHCHECK`), la memoria compartida y el arranque de ≈ 5–13 min de un pod nuevo de Triton.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
imagen-contenedor capa-imagen digest-imagen tag-imagen dockerfile imagen-base multi-stage usuario-no-root forma-exec healthcheck-docker cache-build contexto-build dockerignore pesos-horneados pull-imagen docker-compose plataforma-imagen
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué diferencia hay entre una imagen y un contenedor?
La imagen es la plantilla quieta, de solo lectura: capas de archivos y una configuración. El contenedor es un proceso que corre sobre ella, con una capa escribible que se tira al terminar.
? ¿Por qué el digest identifica el contenido exacto y el tag no?
El digest es la huella SHA-256 del manifest, que lista las huellas de todas las capas: si cambia un byte, cambia el digest. El tag es un apuntador que alguien puso y que se puede mover a otro digest.
? ¿Por qué el código del gateway se copia después del `pip install`?
Porque la caché se rompe hacia abajo: si el código va antes, cada cambio de código rehace la instalación (≈ 30–60 s y ≈ 160 MB); después, solo una capa de ≈ 48 KB en ≈ 2–5 s.
? ¿Qué gana el gateway con dos etapas?
La imagen final solo lleva la base, el entorno `/opt/venv` y el código, sin la caché de pip ni lo que la primera etapa instaló aparte. En el gateway la ganancia es chica; paga cuando construir necesita compiladores.
? ¿Por qué el engine va en la última capa de la imagen de Triton?
Porque es lo que cambia cada mes. Un nodo con la versión anterior solo baja esa capa (≈ 50–150 MB), no los ≈ 9.2 GB.
? ¿Para qué sirve `depends_on … service_healthy` en el compose de Alba, y por qué la gracia de Triton es de 60 s?
Hace que el gateway espere a que Triton esté listo, y así sus primeras requests no fallan. La gracia de 60 s cubre lo que tarda Triton en cargar y calentar el engine (≈ 10–60 s).
? ¿Qué no garantiza una imagen?
El kernel, el driver de NVIDIA, la GPU y la arquitectura de la CPU: los pone la máquina. Por eso la de Alba es `linux/amd64` y el driver del nodo debe soportar CUDA 12.6.
:::
