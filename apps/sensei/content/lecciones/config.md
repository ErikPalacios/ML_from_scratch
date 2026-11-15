---
titulo: Configuración: YAML, variables de entorno y secretos
en: Configuration: YAML, environment variables and secrets
subtitulo: Dónde vive cada ajuste de un programa, quién gana cuando dos lugares dicen cosas distintas, por qué se revisa todo al arrancar y cómo llega una contraseña al proceso sin quedar en el código, en Git, en la imagen ni en los logs.
pregunta: El mismo gateway corre en mi laptop, en staging y en producción con otra dirección de Triton, otro timeout y otra contraseña. ¿Dónde vive cada valor, quién gana si dos se contradicen y cómo llega la contraseña sin quedar escrita donde no debe?
requisitos: terminal, formatos, git
---

:::idea
La configuración es todo lo que cambia entre ambientes o entre días sin cambiar el código: una dirección, un timeout, un umbral, una contraseña. Vive afuera del código, en capas con un orden claro de quién gana, y se revisa completa al arrancar. Los secretos son la parte de la configuración que da acceso: nunca van en el código, en Git, en la imagen ni en un log, y llegan al proceso al último momento, desde un lugar que controla quién los lee.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Ana sube la foto de sus tenis y el gateway de Alba, el programa que recibe la foto y la prepara, le manda el tensor a Triton, el servidor que corre el modelo. Ese mismo gateway, sin cambiar una letra, corre en tu laptop contra un Triton que contesta lento en la CPU, en staging contra uno de prueba y en producción contra el de verdad. Cada vez con otra dirección, a veces con otro timeout y siempre con otra contraseña.

Si para cambiar el timeout de 0.15 a 0.2 segundos hubiera que editar el código, armar una imagen nueva y desplegar, un ajuste de un minuto tomaría una hora. Y si la contraseña de producción estuviera escrita en el código, la tendría cualquiera que pueda leerlo.

En esta lección vas a ver dónde vive cada valor, cómo se lee en Python, qué pasa cuando dos lugares dicen cosas distintas, por qué el programa debe negarse a arrancar con una configuración mala y cómo viaja un secreto hasta el proceso. Al final, cómo se hace en Kubernetes, que es donde corre el sistema de Alba.

## Configuración: lo que cambia sin tocar el código {Configuration: what changes without touching the code}

Abre el código del gateway y busca la línea que le manda el tensor a Triton. Dice, más o menos: «mándalo a la dirección de Triton y espera, a lo mucho, el timeout». No dice cuál dirección ni cuánto tiempo. Esos dos datos los lee de afuera.

La [[configuracion|configuración]] (*configuration*, o *config*) son los valores que un programa lee para decidir cómo portarse y que pueden cambiar sin tocar una línea de código. El código dice **qué** hacer; la configuración, **con qué valores**.

Este es el inventario del gateway de Alba:

| Valor | Qué decide | En producción | ¿Cambia entre ambientes? |
|---|---|---|---|
| `TRITON_URL` | A qué Triton le manda el tensor | `triton.classifier:8000` | Sí |
| `INFER_TIMEOUT_S` | Cuánto espera a Triton | 0.15 (150 ms) | A veces |
| `PREPROCESS_CONCURRENCY` | Cuántas fotos decodifica a la vez | 2 | Según la máquina |
| `MAX_INFLIGHT` | Cuántas requests atiende a la vez | 16 | Según la máquina |
| Umbral de baja confianza | Qué foto cuenta como dudosa | 0.3 | Con cada modelo |
| `MODEL_VERSION` | Qué modelo espera encontrar | `resnet50-2026-10-01` | Con cada modelo |
| `DB_PASSWORD` | La contraseña de una base de datos | (secreta) | Sí |

`triton.classifier:8000` es el nombre corto de Triton dentro del clúster: el [[service-k8s|Service]] `triton` (la dirección fija que reparte las requests entre las copias de Triton; en producción hay uno por versión del modelo, `triton-v14` hoy, y aquí va el nombre corto) en el *namespace* `classifier` (la carpeta de Kubernetes que agrupa los objetos de un equipo) y su puerto 8000. En la lección de red viste el nombre completo, `triton.classifier.svc.cluster.local`; el DNS del clúster completa el corto con sus terminaciones y los dos llegan al mismo Service. La última fila es un ejemplo de esta lección: supón que el gateway anota en una base de datos cada sugerencia que Ana acepta. Sirve para hablar de contraseñas; en «En la vida real» verás que el gateway de Alba casi no tiene.

### Tres ambientes, un solo código

El gateway corre en tres lugares. Cada uno es un [[ambiente]] (*environment*): una copia del sistema con su propio propósito.

- **Tu laptop** (el ambiente *dev*), para programar. Triton corre a tu lado con docker compose, la herramienta que levanta varios contenedores juntos en una sola máquina, en la CPU, y contesta lento. El gateway lo corres directo desde la terminal y lo encuentra en `localhost:8000`, el puerto que compose publica en tu máquina.
- **Staging**, para probar. Un clúster parecido al de producción, con datos de prueba y sin usuarios.
- **Producción**, la de verdad. Ana y millones más.

:::figura config-ambientes
La misma imagen del gateway en los tres ambientes. Lo único que cambia es la configuración: a qué Triton habla, cuánto lo espera y de dónde saca la contraseña.
:::

El código y la [[imagen-contenedor|imagen]] (el paquete con el programa y todo lo que necesita para correr, que armarás en la lección «Empaquetado con Docker») son los mismos en los tres, byte por byte. Eso es lo valioso: lo que probaste en staging es exactamente lo que llega a producción. Si cada ambiente tuviera su propia versión del código, «funcionó en staging» no diría nada.

### Lo que no es configuración

No todo lo que se puede sacar del código se debe sacar. El tamaño al que se reduce la foto, la normalización y el orden de las 500 categorías no son ajustes del gateway: son el contrato con el modelo. Dicho de otro modo: el orden de las categorías es parte del modelo, no una configuración del gateway. Si una variable pudiera cambiarlo, rompería todas las predicciones sin tocar el código.

La regla para distinguirlos: si un valor puede cambiar solo, sin que nada más tenga que cambiar con él, es configuración. Si obliga a cambiar otra cosa al mismo tiempo, va junto a esa otra cosa: en el código o en el modelo.

### Twelve-factor: la configuración va afuera

En 2011, ingenieros de Heroku, una empresa que corría en la nube las aplicaciones de otros, publicaron doce reglas para construir programas de servidor fáciles de desplegar: [[twelve-factor|*The Twelve-Factor App*]]. La regla III es la de esta lección: **la configuración se guarda en el entorno, estrictamente separada del código**.

Trae una prueba que vale la pena memorizar: **¿podrías hacer público tu repositorio hoy mismo sin filtrar una sola credencial?** Si la respuesta es no, hay configuración, y peor, secretos, metidos en el código.

Twelve-factor proponía guardar toda la configuración en variables de entorno. La primera mitad de la idea sigue intacta: afuera del código. La segunda se matizó con los años, porque una variable de entorno no es el mejor lugar para una contraseña. Lo verás en «Secretos».

## Variables de entorno: la configuración que recibe el proceso {Environment variables: the configuration a process receives}

En la lección de la terminal viste qué es una [[variable-entorno|variable de entorno]] (*environment variable*): un par `NOMBRE=valor` que un [[proceso]] recibe de quien lo arrancó. Es la forma más común de pasarle configuración a un programa, y la que usan Docker y Kubernetes. Tres reglas explican casi todo lo que hacen.

:::pasos
1. Se heredan
Cada proceso hijo recibe una **copia** del entorno de su padre. Si la shell tiene `INFER_TIMEOUT_S=0.15`, el Python que arrancas desde ella también.
2. Se copian al arrancar
Es una copia, no un enlace. Si cambias la variable en la shell después, el proceso que ya corre no se entera. Para que vea el valor nuevo, hay que reiniciarlo.
3. Todo es texto
El 0.15 llega como los cuatro caracteres «0.15». El programa tiene que convertirlo a número y decidir qué hacer si no se puede.
:::

Así se ve en una shell de Linux. `export` convierte una variable de la shell en variable de entorno; sin `export`, se queda en la shell y los hijos no la ven. `env` muestra el entorno, y `env -i` corre un comando con el entorno vacío:

```bash
MODELO=resnet50-2026-10-01          # variable de la shell, sin export
export INFER_TIMEOUT_S=0.15         # variable de entorno: la heredan los hijos
env | grep -E 'INFER|MODELO'
bash -c 'echo "un hijo ve: INFER=$INFER_TIMEOUT_S MODELO=${MODELO:-(nada)}"'
python3 -c 'import os; print("python ve:", os.environ.get("INFER_TIMEOUT_S"))'
PREPROCESS_CONCURRENCY=4 python3 -c 'import os; print("solo este comando:", os.environ["PREPROCESS_CONCURRENCY"])'
echo "después, en la shell: ${PREPROCESS_CONCURRENCY:-(no existe)}"
env -i bash -c 'echo "con env -i: INFER=${INFER_TIMEOUT_S:-(nada)}, variables: $(env | wc -l)"'
```

```salida
INFER_TIMEOUT_S=0.15
un hijo ve: INFER=0.15 MODELO=(nada)
python ve: 0.15
solo este comando: 4
después, en la shell: (no existe)
con env -i: INFER=(nada), variables: 3
```

Fíjate en tres cosas. `MODELO` no aparece en `env` ni la ve el hijo: le faltó `export`. Escribir `NOMBRE=valor` antes de un comando se la pasa solo a ese comando. Y con `env -i` no llega nada: el proceso arranca con las 3 variables que pone la propia bash.

Docker y Kubernetes hacen lo mismo con otra forma. En Docker, `docker run -e INFER_TIMEOUT_S=0.15 …`, o `--env-file` con un archivo. En Kubernetes, la lista `env:` del contenedor. Por eso pasar de docker compose a Kubernetes no cambia el programa: las variables de entorno son las mismas; cambian los valores.

Una imagen también puede traer variables de fábrica: la línea `ENV` del Dockerfile (la receta con la que se arma la imagen, que escribirás en «Empaquetado con Docker»), como el `PYTHONUNBUFFERED=1` del gateway de Alba. Esas son el valor de partida. Lo que pase quien arranca el contenedor, con `-e` en Docker o con `env:` en Kubernetes, las pisa. Es la primera vez que ves una regla de «quién gana», y no será la última.

### Leerlas en Python

En Python, el entorno está en `os.environ`, que se porta como un diccionario de textos. `os.environ["X"]` da un error si `X` no existe; `os.environ.get("X", "algo")` devuelve un valor por omisión (*default*). La conversión a número la haces tú:

```python
import os

# Como si la terminal hubiera hecho «export INFER_TIMEOUT_S=0.15», etc.
os.environ["INFER_TIMEOUT_S"] = "0.15"
os.environ["PREPROCESS_CONCURRENCY"] = "2"
os.environ["SUGERENCIAS_ACTIVAS"] = "false"
os.environ.pop("TRITON_URL", None)          # que esta no exista

crudo = os.environ["INFER_TIMEOUT_S"]
print(repr(crudo), "es de tipo", type(crudo).__name__)    # todo llega como texto

timeout = float(os.environ.get("INFER_TIMEOUT_S", "0.15"))
concurrencia = int(os.environ.get("PREPROCESS_CONCURRENCY", "2"))
url = os.environ.get("TRITON_URL", "localhost:8000")      # no está: el de la laptop
print(f"{timeout * 1000:.0f} ms · {concurrencia} decodes · {url}")

print("bool('false') da", bool(os.environ["SUGERENCIAS_ACTIVAS"]))   # la trampa
activas = os.environ["SUGERENCIAS_ACTIVAS"].strip().lower() in ("1", "true", "yes", "on")
print("leído con cuidado:", activas)

try:
    int(os.environ["INFER_TIMEOUT_S"])
except ValueError as error:
    print("int('0.15'):", error)
```

```salida
'0.15' es de tipo str
150 ms · 2 decodes · localhost:8000
bool('false') da True
leído con cuidado: False
int('0.15'): invalid literal for int() with base 10: '0.15'
```

La tercera línea es una trampa clásica. En Python, `bool()` de cualquier texto que no esté vacío es verdadero: `bool("false")` da `True`, y `bool("0")` también. Un interruptor leído así no se apaga nunca. La salida es comparar el texto contra una lista de valores que significan «sí».

### La herencia va de padre a hijo, nunca al revés

`os.environ` también se puede escribir, como hizo el ejemplo de arriba. Lo que cambies ahí lo ven los procesos que tu programa arranque **después**, porque reciben una copia de su entorno de ese momento. Nadie más se entera: ni la terminal que arrancó tu programa ni otros procesos que ya corren.

```python
import os, subprocess, sys

os.environ["INFER_TIMEOUT_S"] = "0.2"                  # el padre cambia su entorno
hijo = 'import os; print("el hijo ve:", os.environ["INFER_TIMEOUT_S"])'
subprocess.run([sys.executable, "-c", hijo])           # un hijo nuevo hereda la copia
```

```salida
el hijo ve: 0.2
```

Por eso un script que hace `export` no cambia la terminal desde la que lo corriste: el script es un hijo, y su copia muere con él (salvo que lo cargues con `source script.sh`, que corre sus líneas dentro de tu misma shell en vez de en un hijo). Y por eso, en un contenedor, la única forma de que el proceso principal vea un valor nuevo es arrancarlo otra vez.

### ¿Cuándo poner un valor por omisión?

Un valor por omisión es cómodo, pero puede esconder un error. Si el gateway trae `localhost:8000` como dirección de Triton y en producción alguien olvida la variable, el gateway arranca feliz y falla en cada request, buscando un Triton que no está en su propio contenedor.

La regla: **valor por omisión solo para lo que es igual en todos lados y es seguro**, como `PREPROCESS_CONCURRENCY=2`. Lo que tiene que cambiar entre ambientes, como la dirección de Triton o una contraseña, no lleva valor por omisión: si falta, el programa se niega a arrancar. Y si te apoyas en el valor por omisión de otra herramienta, escríbelo de todos modos, aunque sea el valor que quieres: quien lea el archivo no tiene que saberse los valores de fábrica. Pasa, por ejemplo, con KEDA, la pieza que decide cuántas copias (réplicas) de Triton corren según su fila, y que por omisión baja hasta cero réplicas.

Un detalle de nombres. Las variables van en mayúsculas con guion bajo, y conviene que lleven la unidad: el `_S` de `INFER_TIMEOUT_S` dice «segundos». Sin él, alguien escribe 150 pensando en milisegundos. En «Validar al arrancar» verás lo que pasa.

## Archivos de configuración y quién gana {Configuration files and who wins}

Las variables de entorno funcionan bien para unos cuantos valores sueltos. Cuando son treinta, cuando hay listas o valores anidados, o cuando cada cambio debe revisarlo otra persona, se escriben en un archivo. En ML, casi siempre en [[yaml|YAML]], el formato de la lección de formatos: `nombre: valor`, la indentación manda y se permiten comentarios.

Python no trae un lector de YAML. El más usado es PyYAML, que se instala con `pip install pyyaml`; la salida de abajo es de PyYAML 6.0.3. Este archivo escribe lo común una sola vez y lo reusa en cada ambiente:

```python
import yaml      # PyYAML: no viene con Python (pip install pyyaml)

texto = """
comun: &comun                  # un ancla: este bloque tiene nombre
  infer_timeout_s: 0.15
  preprocess_concurrency: 2
staging:
  <<: *comun                   # copia todo lo de comun...
  triton_url: "triton.classifier-staging:8000"
laptop:
  <<: *comun
  infer_timeout_s: 2.0         # ...y cambia solo lo distinto
  triton_url: "localhost:8000"
"""
config = yaml.safe_load(texto)
for ambiente in ("staging", "laptop"):
    c = config[ambiente]
    print(f"{ambiente}: {c['infer_timeout_s']} s, {c['preprocess_concurrency']} decodes, {c['triton_url']}")
print(type(config["laptop"]["infer_timeout_s"]).__name__,
      type(config["laptop"]["preprocess_concurrency"]).__name__)

peligroso = "!!python/object/apply:os.system ['echo te hackearon']"
try:
    yaml.safe_load(peligroso)
except yaml.YAMLError as error:
    print("safe_load se niega:", type(error).__name__)
```

```salida
staging: 0.15 s, 2 decodes, triton.classifier-staging:8000
laptop: 2.0 s, 2 decodes, localhost:8000
float int
safe_load se niega: ConstructorError
```

Tres cosas del ejemplo. Primero, YAML sí trae tipos: el 0.15 llega como número, no como texto, al revés que una variable de entorno. Segundo, `&comun` le pone nombre a un bloque (un ancla, *anchor*) y `<<: *comun` lo copia; lo que se escribe después pisa lo copiado. Sirve para no repetir, pero un archivo lleno de anclas cuesta leerlo: úsalas poco. Tercero, la última línea. Con el lector inseguro de PyYAML (`yaml.load(texto, Loader=yaml.UnsafeLoader)`, que en versiones de antes de 2019 era lo que hacía `yaml.load` a secas), YAML puede crear objetos de Python desde el texto, hasta llamar a una función del sistema, y con un archivo que no escribiste tú eso es una puerta abierta. Desde PyYAML 6.0, `yaml.load` sin decir qué lector usar ni siquiera corre. **Usa siempre `yaml.safe_load`**, que solo crea textos, números, listas y diccionarios.

Recuerda también la trampa de la lección de formatos: en PyYAML, un `no` sin comillas se lee como falso. Pon entre comillas todo texto que pueda parecer otra cosa.

### La configuración del modelo es un dato con historia

Una parte de la configuración merece trato especial: la que acompaña al modelo. El [[umbral]] de baja confianza (0.3), el top-k que se muestra y la versión del modelo cambian con cada modelo nuevo: un modelo más confiado hace que el mismo 0.3 corte en otro lugar. Por eso no van escritos en el código del gateway ni se editan a mano en el clúster. Van en un archivo del repositorio:

```yaml
# modelo.yaml: cambia con cada modelo, en su propio pull request
model_version: "resnet50-2026-10-01"
umbral_baja_confianza: 0.3     # por debajo, la foto se aparta para etiquetar
top_k: 5
```

Cada cambio queda en un [[commit]] de [[git|Git]], con quién lo hizo, cuándo y por qué. Los umbrales cambian en un PR propio, con su motivo escrito (un [[pull-request|PR]] es la propuesta de cambio que otra persona revisa antes de juntarla). La ventaja: si el umbral nuevo sale mal, volver es revertir ese commit. El orden de las categorías, en cambio, no va aquí: `labels.json` viaja dentro del archivo del modelo con su huella ([[hash-criptografico|hash]]), y el gateway la revisa al arrancar.

### Quién gana: la precedencia

Ahora un valor puede estar en varios lugares: el código, un archivo, el entorno y la línea de comandos. Si dos dicen cosas distintas, hace falta una regla. Esa regla es la [[precedencia-config|precedencia]] (*precedence*), y la más común va así, de la que menos manda a la que más:

:::pasos
1. El valor por omisión del código
El respaldo que escribió el programador. Igual en todos lados.
2. El archivo de configuración
Lo que vale para un ambiente entero: `staging.yaml`, `produccion.yaml`.
3. La variable de entorno
Lo que pone quien arranca el proceso: Docker, Kubernetes o tú en la terminal.
4. El flag de la línea de comandos
Un [[argumento-cli|argumento]] en la línea de comandos, como `--infer-timeout-s 0.5`. Lo más específico: esta corrida, hoy.
:::

La lógica: gana lo más específico. El código es para todos y para siempre; el flag, para esta vez.

:::figura config-precedencia
Cada valor se busca de arriba hacia abajo y gana el primero que aparece. El timeout lo pone el flag; la concurrencia solo la trae el código; la dirección de Triton, el archivo de staging.
:::

:::cuenta Quién gana con INFER_TIMEOUT_S en staging
Código // el respaldo | — | 1.0 s
Archivo // staging.yaml | pisa al código | 0.15 s
Entorno // alguien hizo export INFER_TIMEOUT_S=0.25 | pisa al archivo | 0.25 s
Flag // nadie lo pasó | — | (nada)
Si alguien corre con --infer-timeout-s 0.5 | pisa a todos | 0.5 s
= Sin flag, el gateway usa 0.25 s, aunque el archivo de staging diga 0.15. Si eso te sorprende, el culpable es una variable de entorno que alguien olvidó: por eso conviene imprimir de dónde salió cada valor.
:::

Así se arma la precedencia completa con la [[biblioteca-estandar|biblioteca estándar]], lo que Python trae sin instalar nada. `argparse` lee los flags y `json` lee el archivo (el mismo programa leería YAML con `yaml.safe_load`). Cada valor guarda de dónde salió:

```python
import argparse, json, os

CODIGO = {"infer_timeout_s": 1.0, "preprocess_concurrency": 2, "triton_url": "localhost:8000"}

with open("staging.json", "w") as f:               # el archivo del ambiente
    json.dump({"infer_timeout_s": 0.15, "triton_url": "triton.classifier-staging:8000"}, f)
os.environ["INFER_TIMEOUT_S"] = "0.25"              # alguien la puso en el entorno

def cargar(argv):
    config = {k: (v, "código") for k, v in CODIGO.items()}          # 1. por omisión
    with open("staging.json") as f:                                   # 2. el archivo
        config.update({k: (v, "archivo") for k, v in json.load(f).items()})
    for k in CODIGO:                                                  # 3. el entorno
        if k.upper() in os.environ:
            config[k] = (type(CODIGO[k])(os.environ[k.upper()]), "entorno")
    p = argparse.ArgumentParser()
    for k in CODIGO:
        p.add_argument("--" + k.replace("_", "-"), type=type(CODIGO[k]))
    for k, v in vars(p.parse_args(argv)).items():                     # 4. los flags
        if v is not None:
            config[k] = (v, "flag")
    return config

for argv in ([], ["--infer-timeout-s", "0.5"]):
    print("con", argv or "ningún flag")
    for k, (valor, origen) in cargar(argv).items():
        print(f"  {k} = {valor}  ← {origen}")
```

```salida
con ningún flag
  infer_timeout_s = 0.25  ← entorno
  preprocess_concurrency = 2  ← código
  triton_url = triton.classifier-staging:8000  ← archivo
con ['--infer-timeout-s', '0.5']
  infer_timeout_s = 0.5  ← flag
  preprocess_concurrency = 2  ← código
  triton_url = triton.classifier-staging:8000  ← archivo
```

Imprimir el origen de cada valor al arrancar ahorra horas de preguntarse «¿por qué este [[pod]] (una de las copias del gateway que corren en Kubernetes) tiene otro timeout?». Con una excepción: los secretos se imprimen tapados, como `DB_PASSWORD=****`.

:::profundo Cada herramienta trae su propia precedencia
La regla «gana lo más específico» se repite en todas partes, pero cada herramienta la escribe a su modo, y conviene saber la de las que usas:

- **Docker:** el `ENV` del Dockerfile es lo de fábrica; `-e` o `--env-file` al arrancar lo pisan.
- **Kubernetes** (verás las dos formas en su sección): las variables de la imagen pierden contra las del pod. Dentro del pod, si una llave viene a la vez de un ConfigMap entero (`envFrom`) y de la lista `env:`, gana `env:`.
- **python-dotenv:** `load_dotenv()` lee el archivo `.env`, pero por omisión **no pisa** una variable que ya existe en el entorno. Así, lo que pone Kubernetes le gana a un `.env` olvidado.
- **pydantic-settings**, que verás en la sección siguiente, de más a menos: los argumentos que le pasas a la clase en el código, el entorno, el archivo `.env`, una carpeta de archivos secretos y, al final, los valores por omisión.
- **Helm**, que verás en la sección de Kubernetes, tiene la suya para sus archivos de valores.

Cuando un valor no es el que esperabas, la pregunta casi nunca es «¿qué dice el archivo?», sino «¿qué capa lo pisó?».
:::

## Validar al arrancar {Validate at startup}

Un error de configuración puede aparecer en dos momentos: al arrancar o con tráfico encima. La diferencia es enorme.

Si el gateway revisa su configuración al arrancar y algo está mal, termina con un [[codigo-salida|código de salida]] distinto de 0. En Kubernetes, ese pod nunca queda listo para recibir requests, y una actualización se detiene ahí: los pods viejos siguen atendiendo a Ana. (El Deployment del gateway de Alba, el objeto de Kubernetes que mantiene corriendo las copias del gateway y las cambia por las nuevas, lleva `maxUnavailable: 0`, que prohíbe apagar un pod viejo antes de que el nuevo esté listo.) Si el error aparece hasta la tercera request, el pod ya estaba recibiendo tráfico, y lo falla.

La [[validacion-config|validación de configuración]] (*config validation*) es eso: revisar **toda** la configuración al arrancar, antes de aceptar la primera request. Que no falte nada obligatorio, que cada valor tenga su tipo y que esté en un rango con sentido.

El rango importa tanto como el tipo. Mira lo que pasa si alguien escribe `INFER_TIMEOUT_S=150` pensando en milisegundos. Es un número válido, pero son 150 segundos. Un día normal nadie lo nota, porque Triton contesta en milisegundos. El día que Triton se traba, cada request ocupa uno de los lugares del pod hasta que se cumple el timeout. Estas son las letras de la cuenta:

:::formula Un pod con Triton trabado
λ = frac{R}{P}
μ = frac{m}{t}
T_{lleno} ≈ frac{m}{λ}
- R: requests por segundo que llegan a todo el gateway; en el pico de Alba, 500
- P: pods del gateway; en el pico, 5
- λ: requests por segundo que le llegan a cada pod
- m: lugares por pod, las requests que atiende a la vez (`MAX_INFLIGHT`); en Alba, 16
- t: el timeout hacia Triton (`INFER_TIMEOUT_S`), en segundos
- μ: requests por segundo que un pod despacha si cada una espera el timeout completo
- T_{lleno}: segundos hasta que los \(m\) lugares quedan tomados, cuando \(μ\) es mucho menor que \(λ\)
:::

Si \(μ\) es mayor que \(λ\), los lugares se liberan más rápido de lo que llegan requests, y el pod no se llena.

:::cuenta Un cero de más: 150 segundos en vez de 0.15
Requests por pod \(λ\) // \(R\) = 500 por segundo en el pico, \(P\) = 5 pods | \(λ = R ÷ P\) = 500 ÷ 5 | 100 por segundo
Lugares por pod \(m\) // MAX_INFLIGHT | el tope del gateway | 16
Despacho \(μ\) con \(t\) = 0.15 s // cada lugar se libera a los 150 ms; alcanza, porque es más que \(λ\) | \(μ = m ÷ t\) = 16 ÷ 0.15 | ≈ 107 por segundo
Despacho \(μ\) con \(t\) = 150 s // cada lugar queda tomado dos minutos y medio | \(μ = m ÷ t\) = 16 ÷ 150 | ≈ 0.11 por segundo
Tiempo en llenarse, con 150 s // \(μ\) es casi cero junto a \(λ\) | \(T_{lleno} ≈ m ÷ λ\) = 16 ÷ 100 | 0.16 s
= Con 0.15, cada request recibe en 150 ms un error claro y el gateway sigue de pie. Con 150, en 0.16 s el pod se llena y rechaza todo lo demás con 503 (el código de HTTP para «ahora no puedo atenderte») por lo menos dos minutos y medio, esperando respuestas que nadie quiere: quien llamó, el backend del marketplace, se rinde a los 300 ms (lección de async). Un cero de más convirtió un Triton lento en un gateway caído.
:::

Un validador hecho con la biblioteca estándar. Junta **todos** los errores antes de rendirse, para que quien lo arregle no tenga que arrancar una vez por error. Una `dataclass` es una clase que solo guarda campos, y `frozen=True` impide cambiarlos una vez creada:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Config:
    triton_url: str
    infer_timeout_s: float
    preprocess_concurrency: int

def leer(entorno, nombre, tipo, omision, minimo, maximo, errores):
    try:
        valor = tipo(entorno.get(nombre, omision))
    except ValueError:
        return errores.append(f"{nombre}={entorno[nombre]!r}: no es un {tipo.__name__}")
    if not minimo <= valor <= maximo:
        errores.append(f"{nombre}={valor}: debe ir de {minimo} a {maximo}")
    return valor

def cargar(entorno):
    errores = []
    url = entorno.get("TRITON_URL")
    if not url:
        errores.append("TRITON_URL: falta (no tiene valor por omisión)")
    t = leer(entorno, "INFER_TIMEOUT_S", float, "0.15", 0.01, 2, errores)   # en segundos
    c = leer(entorno, "PREPROCESS_CONCURRENCY", int, "2", 1, 8, errores)
    if errores:                         # todos juntos, no uno por arranque
        raise SystemExit("configuración inválida:\n  " + "\n  ".join(errores))
    return Config(url, t, c)

bueno = {"TRITON_URL": "triton.classifier:8000", "INFER_TIMEOUT_S": "0.15"}
malo = {"INFER_TIMEOUT_S": "150", "PREPROCESS_CONCURRENCY": "dos"}
for entorno in (bueno, malo):
    try:
        print("arranca con", cargar(entorno))
    except SystemExit as error:         # en el gateway, el proceso termina aquí
        print(error)
```

```salida
arranca con Config(triton_url='triton.classifier:8000', infer_timeout_s=0.15, preprocess_concurrency=2)
configuración inválida:
  TRITON_URL: falta (no tiene valor por omisión)
  INFER_TIMEOUT_S=150.0: debe ir de 0.01 a 2
  PREPROCESS_CONCURRENCY='dos': no es un int
```

`SystemExit` es lo que lanza `sys.exit()`: si nadie la atrapa y lleva un texto, como aquí, Python escribe el texto en [[flujos-estandar|stderr]], la salida de errores, y termina con código 1. Así se ve desde la shell, con un programa más corto. `$?` es el código de salida del último comando:

```bash
cat > app.py <<'FIN'
import os, sys
t = float(os.environ.get("INFER_TIMEOUT_S", "0.15"))
if not 0.01 <= t <= 2:
    sys.exit(f"configuración inválida: INFER_TIMEOUT_S={t}, van segundos (0.01 a 2)")
print(f"arrancó con un timeout de {t * 1000:.0f} ms")
FIN
INFER_TIMEOUT_S=0.15 python3 app.py; echo "código de salida: $?"
INFER_TIMEOUT_S=150 python3 app.py; echo "código de salida: $?"
```

```salida
arrancó con un timeout de 150 ms
código de salida: 0
configuración inválida: INFER_TIMEOUT_S=150.0, van segundos (0.01 a 2)
código de salida: 1
```

Escribir el validador a mano está bien para tres valores. Para treinta, se usa una biblioteca. La más común en Python es pydantic-settings, que se apoya en [[pydantic]], la biblioteca que revisa los datos a partir de los tipos que anotas en una clase. Lee el entorno, convierte cada valor y, si algo falla, se detiene con un error que dice qué campo y por qué. Es una ilustración, sin salida: pide `pip install pydantic-settings`.

```python
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Config(BaseSettings):
    model_config = SettingsConfigDict(secrets_dir="/etc/gateway/db")   # una carpeta de secretos
    triton_url: str                                      # obligatoria: sin valor por omisión
    infer_timeout_s: float = Field(0.15, ge=0.01, le=2)  # en segundos, de 0.01 a 2
    preprocess_concurrency: int = Field(2, ge=1, le=8)
    db_password: SecretStr                               # sale del archivo DB_PASSWORD

config = Config()   # lee TRITON_URL, INFER_TIMEOUT_S… del entorno; si algo no cuadra, ValidationError
```

Tres detalles. El nombre del campo `triton_url` se busca en el entorno sin importar mayúsculas, así que encuentra `TRITON_URL`. Con `INFER_TIMEOUT_S=150`, se detiene con `1 validation error for Config` y la razón: `infer_timeout_s`, «Input should be less than or equal to 2» (salida de pydantic-settings 2.16). Y `secrets_dir` le dice que, si un campo no viene en el entorno, lo busque en una carpeta donde cada archivo, con el nombre del campo, es un secreto: justo la forma en que Kubernetes monta un Secret, como verás más adelante. `SecretStr` guarda la contraseña y, si alguien imprime la configuración, muestra `**********` en su lugar.

Los archivos también se validan, y antes de llegar al clúster: el [[ci|CI]], el sistema que corre las pruebas en cada cambio, puede revisar que cada YAML se lea y tenga sus campos. Alba usa `docker compose config -q` así: arma el archivo final de docker compose, con las variables ya puestas, y falla si algo está mal.

## Secretos: lo que da acceso {Secrets: what grants access}

Un [[secreto]] (*secret*) es la parte de la configuración que da acceso. Por ejemplo: la API key de un proveedor, la contraseña de Postgres o la llave de firma de tus tokens. Postgres es una base de datos muy usada. Una [[api-key|API key]] es una contraseña larga que usa un programa para entrar a un servicio; una llave de firma sirve para probar que un mensaje lo escribiste tú.

La diferencia con el resto de la configuración es una sola. Un timeout lo puede leer cualquiera sin daño; un secreto, no. Para la base de datos, quien tiene la contraseña del gateway **es** el gateway.

### Los cuatro lugares donde nunca va

:::pasos
1. En el código
El código lo leen muchas personas, se copia a laptops y servicios, y a veces se hace público.
2. En Git
Git guarda la historia completa. Un secreto que estuvo en un commit sigue ahí aunque lo borres en el siguiente: cualquiera con una copia del repositorio lo recupera. Lo verás funcionando en la sección extra «Gestores de secretos, rotación y escaneo».
3. En la imagen
Lo viste en la lección del sistema operativo: un `COPY .env` deja el archivo en una [[capa-imagen|capa]] de la imagen (cada línea del Dockerfile agrega una capa encima de las anteriores, y las de abajo no se borran), y un `ARG HF_TOKEN` (el token de Hugging Face pasado como argumento al armar la imagen) queda en su historial. Borrarlo en una línea posterior del Dockerfile no lo quita.
4. En los logs
Un `print(config)` al arrancar, o un error que muestra la dirección completa de la base de datos con la contraseña adentro (`postgres://gateway:prod-Xq81@db:5432`), deja el secreto donde lo lee mucha gente. Y los logs de Alba se guardan 90 días.
:::

### El problema de las variables de entorno

Twelve-factor proponía pasar también los secretos como variables de entorno, y se sigue haciendo mucho. Es mejor que escribirlos en el código, pero tienen fugas:

- `docker inspect`, el comando que muestra cómo se arrancó un contenedor, enseña todas sus variables a quien pueda usar Docker en esa máquina.
- En Linux, el entorno con el que arrancó un proceso está en el archivo `/proc/<pid>/environ`, donde `<pid>` es su [[pid]]. Lo pueden leer el mismo usuario y [[root]].
- Lo heredan todos los procesos hijos, aunque no lo necesiten. Y muchos reportes de errores y páginas de depuración vuelcan el entorno completo.

```bash
export DB_PASSWORD=prod-Xq81                # la contraseña, como variable de entorno
sleep 60 &                                  # un proceso cualquiera, hijo de esta shell
tr '\0' '\n' < /proc/$!/environ | grep PASSWORD       # su entorno, leído desde afuera
python3 -c 'import os; print("arrancó con:", {k: v for k, v in os.environ.items() if k.startswith("DB_")})'
kill $!
```

```salida
DB_PASSWORD=prod-Xq81
arrancó con: {'DB_PASSWORD': 'prod-Xq81'}
```

`$!` es el PID del último proceso que la shell mandó al fondo con `&`. Ese archivo separa las variables con un byte cero; `tr '\0' '\n'` cambia cada cero por un salto de línea para que `grep` lo lea. El `sleep` no hace nada con la contraseña, y aun así la tiene. Y la última línea es el error más común de todos: un programa que imprime su configuración al arrancar y se lleva el secreto al log. El archivo `/proc` es cosa de Linux; en macOS no existe, pero la herencia es igual.

Además, cambiar una variable de entorno exige reiniciar el proceso (la regla 2). Por eso hoy se prefiere que el secreto llegue como **archivo**: uno con [[permisos]] de solo lectura para el usuario del proceso, que no se hereda, no sale en `docker inspect` y se puede cambiar sin reiniciar.

### El archivo .env, en tu laptop

En la laptop, lo cómodo es un [[archivo-env|archivo .env]]: un archivo de texto con una línea `NOMBRE=valor` por variable. docker compose lee solo el `.env` de la carpeta del proyecto para llenar las variables de su archivo, y en Python la biblioteca python-dotenv lo carga con una línea, `load_dotenv()`. Ahí vive la contraseña de tu base de datos de prueba.

El peligro: está en la carpeta del proyecto, junto al código, y un `git add .` lo sube. La defensa es el [[gitignore|.gitignore]] de la lección de Git, la lista de lo que Git debe ignorar. `git status --short` marca con `??` lo que Git ve y todavía no guarda:

```bash
git init -q tienda && cd tienda
echo 'DB_PASSWORD=dev-1234' > .env
echo 'print("hola")' > app.py
git status --short                    # Git ve los dos archivos
echo '.env' > .gitignore
git status --short                    # .env desapareció de la lista
git add . && git commit -qm "primer commit"
git ls-files                          # lo que de verdad quedó guardado
```

```salida
?? .env
?? app.py
?? .gitignore
?? app.py
.gitignore
app.py
```

Con `.env` en el `.gitignore`, Git ni lo ve. Lo mismo va en el `.dockerignore`, la lista de lo que Docker no copia a la imagen. Lo que sí se sube es un `.env.example` con los nombres y valores de mentira, para que la siguiente persona sepa qué llenar.

### Dónde vive la contraseña

Estos son los lugares posibles, ordenados de peor a mejor:

:::figura config-fugas
Cinco lugares para la contraseña del gateway, del peor al mejor. Los dos primeros, nunca (el manifiesto es el archivo YAML que le describe a Kubernetes qué crear). La variable de entorno es aceptable. Un archivo que llega desde un gestor de secretos es bueno. Y lo mejor es no tener contraseña.
:::

El último escalón merece una explicación. La mejor forma de manejar un secreto es no tenerlo. En la nube, un pod puede tener su propia identidad, y la nube le da credenciales que duran poco, sin que nadie guarde una llave. Eso lo hace [[iam|IAM]], el sistema de permisos de la nube, que verás en la fase «La nube». Cuando sí hace falta una contraseña, como la de una base de datos, el camino es el de la sección siguiente.

## ConfigMap y Secret de Kubernetes {Kubernetes ConfigMap and Secret}

En producción, el gateway corre en Kubernetes, el [[orquestacion|orquestador]] de Alba. Cada copia del gateway vive en un [[pod]]: la unidad más chica que corre Kubernetes, uno o más contenedores que comparten red y disco (lo verás a fondo en la lección «Kubernetes»). Kubernetes necesita guardar la configuración en algún lugar para dársela a cada pod que crea. Para eso tiene dos objetos.

Un [[configmap|ConfigMap]] guarda configuración como pares nombre-valor dentro del clúster. Un [[secret-k8s|Secret]] tiene la misma forma, pero es para secretos: tiene permisos aparte y se puede guardar cifrado. Así se declaran en YAML, en un manifiesto, el archivo que le describe a Kubernetes qué objetos crear (es una ilustración; los manifiestos completos son de la lección «Kubernetes»):

```yaml
apiVersion: v1
kind: ConfigMap
metadata: {name: gateway-config, namespace: classifier}
data:
  TRITON_URL: "triton.classifier:8000"
  INFER_TIMEOUT_S: "0.15"                 # entre comillas: aquí todo es texto
  PREPROCESS_CONCURRENCY: "2"
---
apiVersion: v1
kind: Secret
metadata: {name: gateway-db, namespace: classifier}
data:
  DB_PASSWORD: cHJvZC1YcTgx               # base64 de prod-Xq81: no está cifrado
```

Y así los usa el pod del gateway: el ConfigMap entero como variables de entorno, y el Secret como archivo, en una carpeta que se le [[montaje|monta]] al contenedor:

```yaml
securityContext: {runAsUser: 10001, fsGroup: 10001}   # el gateway no corre como root
containers:
  - name: gateway
    envFrom:
      - configMapRef: {name: gateway-config}    # cada llave, una variable de entorno
    volumeMounts:
      - {name: db, mountPath: /etc/gateway/db, readOnly: true}
volumes:
  - name: db
    secret: {secretName: gateway-db, defaultMode: 0440}   # solo lectura: el dueño y el grupo
```

Adentro, el gateway encuentra el archivo `/etc/gateway/db/DB_PASSWORD` con la contraseña y lo lee como cualquier archivo. Cada llave del Secret se vuelve un archivo con ese nombre.

Ojo con los permisos. El kubelet, el agente de Kubernetes que corre en cada máquina y arranca sus pods, crea esos archivos con dueño root. El gateway de Alba corre como el usuario 10001 (lección del sistema operativo), así que con un modo `0400`, «solo el dueño lee», no podría abrir su propia contraseña. `fsGroup` le pone al archivo el grupo 10001, que el proceso trae, y `0440` deja leer al dueño y a ese grupo, y a nadie escribir. Un ConfigMap o un Secret guarda, además, a lo mucho 1 MiB (1,048,576 bytes): sirve para valores y archivos chicos, nunca para los pesos de un modelo.

### Variable o archivo

| | Como variable de entorno | Como archivo montado |
|---|---|---|
| Cómo lo lee el programa | `os.environ["TRITON_URL"]` | Abre `/etc/gateway/db/DB_PASSWORD` |
| Si cambias el ConfigMap o el Secret | El proceso no se entera: hay que reiniciar el pod | El archivo se actualiza solo, con retraso |
| ¿Lo heredan los hijos? | Sí | No |
| Bueno para | Configuración que cambia con un despliegue | Secretos y archivos completos |

### Un Secret no está cifrado

Lo de `cHJvZC1YcTgx` parece un secreto bien guardado, pero es [[base64]], la forma de escribir bytes con 64 letras de la lección de APIs. Base64 no tiene llave: lo decodifica cualquiera, en una línea.

```python
import base64

dato = "ZGV2LTEyMzQ="                       # lo que dice un Secret en el clúster
print(base64.b64decode(dato).decode())      # cualquiera lo lee: no hay llave
print(base64.b64encode(b"prod-Xq81").decode())
```

```salida
dev-1234
cHJvZC1YcTgx
```

¿Por qué base64, entonces? Para que en el campo `data` quepa cualquier secreto, aunque sean bytes que no son texto, como una llave binaria. Si escribes el manifiesto a mano, el campo `stringData` acepta el texto tal cual y Kubernetes lo convierte.

Dicho sin rodeos: un Secret no es secreto por diseño. Kubernetes guarda todos sus objetos en etcd, su base de datos interna, y por omisión guarda los Secrets ahí sin cifrar. El cifrado en reposo (*encryption at rest*) se activa aparte, casi siempre con una llave de un [[kms|KMS]], el servicio de la nube que guarda llaves de cifrado (lo verás en la fase de seguridad). EKS, el Kubernetes de AWS, lo activa por omisión desde marzo de 2025 en los clústeres con Kubernetes 1.28 o más nuevo, con una llave que administra AWS si no le das una tuya.

Pero el cifrado protege los discos, no a las personas. El control real es quién puede hacer `get secrets`. En Kubernetes eso lo deciden los permisos de cada usuario y programa sobre cada *namespace*, la carpeta que agrupa los objetos. Y ojo con un detalle: quien pueda crear un pod en un namespace puede montarle cualquier Secret de ahí y leerlo.

### Lo que cambia y lo que no llega

Si cambias `INFER_TIMEOUT_S` en el ConfigMap, los pods que ya corren no se enteran: su variable se copió al arrancar. Hay que reiniciarlos, por oleadas, con `kubectl rollout restart deployment/gateway` (`kubectl` es el comando con el que se le habla a Kubernetes; el gateway de Alba es un Rollout de Argo, lo cuenta «Rollout seguro», y ahí el equivalente es `kubectl argo rollouts restart gateway`). Un archivo montado, en cambio, se actualiza solo, con un retraso que suele llegar hasta alrededor de un minuto. Aun así, tu programa tiene que volver a leerlo: si lo leyó una vez al arrancar, sigue con el valor viejo.

:::profundo Por qué tarda, y cuándo no llega nunca
Quien escribe los archivos en el nodo es el kubelet, el agente de Kubernetes que corre en cada máquina y arranca sus pods. No vigila cada cambio al instante: revisa cada cierto tiempo (su periodo de sincronización, por omisión un minuto) y además guarda una copia de los objetos. La documentación de Kubernetes lo dice así: el retraso total puede ser ese periodo más lo que tarde en ponerse al día la copia.

Hay un caso en que el archivo no se actualiza nunca: si se montó con `subPath` (un solo archivo dentro de una carpeta que ya existe). Y si marcas el ConfigMap con `immutable: true`, Kubernetes no deja cambiarlo: para un valor nuevo, se crea otro ConfigMap con otro nombre. Así, cada versión de la configuración tiene nombre propio y volver a la anterior es apuntar al nombre viejo.
:::

:::diagrama config-k8s
De Git y del gestor de secretos hasta el proceso del gateway. Toca cada caja, o usa «Recorrer» para seguir el arranque de un pod, un cambio de timeout y un cambio de contraseña.
:::

### Una configuración por ambiente: Helm

Staging y producción necesitan casi los mismos manifiestos, con otros valores: otro namespace, otro número de réplicas, otra dirección de Triton. Copiar los archivos y editarlos a mano es pedir que se separen con el tiempo.

[[helm|Helm]] resuelve eso. Un *chart* de Helm es un juego de manifiestos con huecos, las plantillas, más un archivo `values.yaml` con los valores. Cada ambiente trae su propio archivo de valores:

```yaml
# templates/configmap.yaml: la plantilla, igual para todos
data:
  TRITON_URL: {{ .Values.tritonUrl | quote }}
  INFER_TIMEOUT_S: {{ .Values.inferTimeoutS | quote }}
---
# values-prod.yaml: lo que cambia en producción
tritonUrl: "triton.classifier:8000"
inferTimeoutS: "0.15"
```

`helm upgrade --install gateway ./chart -f values-prod.yaml` llena los huecos y aplica el resultado al clúster. Helm tiene su propia precedencia: el `values.yaml` del chart, luego cada `-f` en orden (el último gana) y, encima de todo, `--set`. Los archivos de valores van en Git; los secretos, no: llegan del gestor de secretos. Helm es un proyecto graduado de la CNCF, la fundación que también cuida a Kubernetes. La alternativa más usada es kustomize, que viene dentro de `kubectl` desde la versión 1.14 (`kubectl apply -k`) y, en vez de plantillas, aplica parches sobre un manifiesto base.

## Gestores de secretos, rotación y escaneo {Secret managers, rotation and scanning} [extra]

Un Secret de Kubernetes guarda la contraseña en el clúster, pero no responde tres preguntas: ¿quién la leyó?, ¿cuándo la cambiamos?, ¿y si alguien la subió a Git? Para eso hay herramientas aparte.

### El gestor de secretos

Un [[gestor-secretos|gestor de secretos]] (*secret manager*) es un servicio dedicado a guardar secretos. Los más usados son HashiCorp Vault, AWS Secrets Manager, Google Cloud Secret Manager y Azure Key Vault. Hace cuatro cosas que un archivo no hace:

- **Guarda cifrado**, con una llave que nunca sale del servicio; en la nube, casi siempre una del KMS.
- **Decide quién lee**, con permisos por secreto (en la nube, los de IAM): el gateway de producción lee su contraseña y nada más; el de staging, ni esa.
- **Registra cada lectura**: quién, cuándo y desde dónde. Si un secreto se filtra, ese registro dice quién lo tuvo.
- **Guarda versiones**, y varios saben cambiarlas solos, con la rotación que viene abajo.

Vault es el único de la lista que puedes instalar en tus propias máquinas, en cualquier nube o en ninguna; los otros tres viven dentro de su nube. Desde agosto de 2023, Vault ya no es software libre: HashiCorp, su empresa (hoy de IBM), lo pasó a una licencia BSL (*Business Source License*), que deja usarlo pero no ofrecerlo como un servicio que compita con ella. Por eso nació OpenBao, una copia de la última versión libre que mantiene la Linux Foundation.

¿Cómo llega del gestor al pod? Hay dos caminos. **External Secrets Operator** es un programa que corre en el clúster, lee el gestor cada cierto tiempo (por omisión, cada hora) y copia el valor a un Secret de Kubernetes, que el pod monta como siempre. El **Secrets Store CSI Driver** monta el secreto del gestor directo como archivo dentro del pod. Ese archivo montado desde un gestor es el escalón «bueno» de la figura de los cinco lugares.

AWS Secrets Manager cobra por dos cosas: por cada secreto guardado y por cada lectura. Con precios de lista:

:::formula Costo mensual de Secrets Manager
L = S × r × 730
C = 0.40 × S + 0.05 × frac{L}{10,000}
- S: secretos guardados
- r: lecturas por hora de cada secreto, sumando a todos los que lo leen
- L: lecturas al mes; 730 son las horas de un mes (30.4 días × 24)
- C: costo al mes, en US$: US$0.40 por secreto guardado y US$0.05 por cada 10,000 lecturas
:::

:::cuenta Lo que cuesta AWS Secrets Manager (precios de lista, noviembre de 2026)
Guardar // \(S\) = 5 secretos, a US$0.40 cada uno | 0.40 × \(S\) = 0.40 × 5 | US$2.00 al mes
Leer con External Secrets // lee cada secreto una vez por hora: \(r\) = 1 | \(L = S × r × 730\) = 5 × 1 × 730 | 3,650 lecturas
Su costo // US$0.05 por cada 10,000 lecturas | 0.05 × \(L\) ÷ 10,000 = 0.05 × 3,650 ÷ 10,000 | ≈ US$0.02
Si cada pod leyera directo // 12 pods, el máximo del gateway, cada uno 12 veces por hora (cada 5 minutos): \(r\) = 12 × 12 = 144 | \(L\) = 5 × 144 × 730 = 525,600 lecturas; 0.05 × 525,600 ÷ 10,000 | ≈ US$2.63
= \(C\) ≈ 2.00 + 0.02 = US$2.02 al mes con External Secrets, y ≈ 2.00 + 2.63 = US$4.63 si cada pod lee directo: entre US$2 y US$5. Un gestor de secretos es barato; lo que crece es leer de más, y se arregla leyendo cada hora en vez de cada 5 minutos.
:::

### Rotar: cambiar el secreto cada tanto

La [[rotacion-secretos|rotación de secretos]] (*secret rotation*) es cambiar un secreto por uno nuevo y anular el viejo: cada cierto tiempo y, sobre todo, **en cuanto sospechas** que se filtró. La razón: un secreto que nunca rota es un secreto que, si se filtró hace un año, sigue funcionando.

El truco es rotar sin cortar el servicio. Si cambias la contraseña en la base de datos y los pods todavía usan la vieja, todos fallan a la vez. Por eso se rota con un periodo de **dos credenciales válidas**:

:::pasos
1. Crea la nueva
La base de datos acepta la versión 2 sin dejar de aceptar la 1.
2. Guárdala en el gestor
El gestor ahora entrega la versión 2 a quien la pida.
3. Que los clientes la empiecen a usar
Los pods leen el archivo nuevo, o se reinician por oleadas si la tenían en una variable de entorno.
4. Revoca la vieja
Solo cuando nadie usa la versión 1. El registro de lecturas y las conexiones a la base dicen cuándo.
:::

:::diagrama config-rotacion
Una rotación sin cortar el servicio y una filtración. Usa «Recorrer» para seguir las dos.
:::

¿Cada cuánto? Lo fija cada empresa; muchas políticas piden 90 días o menos para las llaves de los programas. Pero rotar seguido ayuda menos de lo que parece si nadie nota una filtración: lo que más acorta el daño es **detectarla rápido**. La cuenta usa dos números, cada cuánto rotas y cuánto tardas en notar la filtración:

:::formula Cuánto sirve una contraseña robada
w = min(H, D)
w_{prom} = w − frac{w^2}{2 × D}
- D: días entre rotaciones
- H: días que tardas en notar la filtración
- w: el peor caso, en días: la contraseña robada sirve hasta la rotación o hasta que la notas, lo que llegue primero
- w_{prom}: los días que sirve en promedio, si la filtración cae en un momento al azar del periodo
:::

Si nunca la notas (\(H\) mayor o igual que \(D\)), \(w = D\) y el promedio queda en \(D ÷ 2\). Juega con los dos números:

:::calculadora config-rotacion
Prueba a rotar cada 30 días sin detectar nada, contra rotar cada 90 y notar la filtración en 1 día.
:::

### Borrarlo de Git no basta

Si un secreto llegó a un commit, borrarlo en el siguiente no lo desaparece. La historia guarda cada versión de cada archivo:

```bash
git init -q demo && cd demo
echo 'DB_PASSWORD=prod-Xq81' > .env
git add .env && git commit -qm "agrego la config"
git rm -q .env && git commit -qm "quito el .env, ups"
ls -A                                 # en la carpeta ya no está
git log --format='%s'                 # pero la historia guarda los dos commits
git show HEAD~1:.env                  # y cualquiera con el repo lo lee
```

```salida
.git
quito el .env, ups
agrego la config
DB_PASSWORD=prod-Xq81
```

`HEAD~1` es «el commit anterior al último». Se puede reescribir la historia para borrarlo de verdad, con herramientas como `git filter-repo`, pero las copias que ya bajaron otras personas, los *forks* y los respaldos lo siguen teniendo. Y si el repositorio es público, hay programas que revisan cada push en busca de llaves. Por eso la regla es una sola: **un secreto que se filtró se rota**, aunque lo hayas borrado un minuto después. Primero rotar; luego limpiar; luego revisar en el registro del gestor si alguien lo usó.

### Escaneo: atraparlo antes de que salga

El [[escaneo-secretos|escaneo de secretos]] (*secret scanning*) es revisar el código y su historia en busca de cosas que parecen secretos, antes de que salgan. Se hace en tres lugares:

- **En tu máquina, antes del commit**, con un programa como gitleaks puesto como *pre-commit hook*: un script que Git corre antes de cada commit y que puede detenerlo.
- **En el CI**, en cada pull request, para lo que se escapó del primero.
- **En el servidor de Git.** GitHub revisa los repositorios y, con la protección de push (*push protection*), rechaza un push que trae un token con forma conocida. En los repositorios públicos es gratis y viene prendida desde 2024; en los privados es parte de un producto de pago, GitHub Secret Protection.

¿Cómo reconoce un secreto? Muchos tienen forma fija. Una llave de acceso de AWS empieza con `AKIA` y lleva 16 letras mayúsculas o dígitos más; un token clásico de GitHub empieza con `ghp_`. Esas formas se escriben como expresiones regulares (*regular expressions*): patrones de texto que el módulo `re` de Python sabe buscar. Así funciona un escáner chiquito:

```python
import re

REGLAS = {
    "llave de AWS": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "token de GitHub": re.compile(r"\bghp_[A-Za-z0-9]{36}\b"),
    "contraseña escrita": re.compile(r"(?i)(password|secret|token)\w*\s*[:=]\s*['\"]?[^'\"\s]{8,}"),
}

token_falso = "ghp_" + "a1B2" * 9          # 36 caracteres inventados, armados aquí
archivo = f"""\
TRITON_URL=triton.classifier:8000
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
DB_PASSWORD="Xq81-mR2v-9Lp0"
INFER_TIMEOUT_S=0.15
headers = {{"Authorization": "token {token_falso}"}}
"""
for num, linea in enumerate(archivo.splitlines(), start=1):
    for nombre, regla in REGLAS.items():
        if m := regla.search(linea):
            print(f"línea {num}: {nombre} → {m.group(0)[:10]}…")   # nunca el secreto entero
```

```salida
línea 2: llave de AWS → AKIAIOSFOD…
línea 3: contraseña escrita → PASSWORD="…
línea 5: token de GitHub → ghp_a1B2a1…
```

`AKIAIOSFODNN7EXAMPLE` es la llave de ejemplo que AWS usa en su documentación: no abre nada. Fíjate en que el escáner muestra solo el principio de lo que encontró: un reporte de secretos que imprime los secretos completos es otra fuga.

Las herramientas de verdad traen cientos de reglas así (gitleaks, más de 200 en su configuración de 2026) y además miden qué tan «al azar» se ve un texto, porque una llave generada al azar casi no repite letras. A cambio, a veces marcan algo que no es secreto, y esos casos se anotan en una lista de excepciones. Cuando encuentran uno de verdad, el orden ya lo sabes: rotar primero.

## Feature flags: cambiar el comportamiento sin desplegar {Feature flags: changing behavior without deploying} [extra]

Hasta aquí, la configuración se lee al arrancar y cambia con un despliegue. Un [[feature-flag|*feature flag*]] (bandera de función; ojo, no es el flag de la línea de comandos de la precedencia) es configuración que se consulta **mientras el programa corre**. Dicho con precisión: es una condición en el código que se evalúa en tiempo de ejecución contra una configuración remota. En el código se ve así: «si el flag `sugerencias-v2` está prendido para este vendedor, usa el modelo nuevo; si no, el de siempre».

La idea grande es separar dos cosas que parecían una. **Desplegar** es poner el código nuevo en los servidores. **Activar** es que la gente lo use. Con un flag, el código llega apagado y se enciende después: para el equipo interno, luego para el 10 % de los vendedores, luego para todos. La primera versión del sistema de Alba (su MVP, *minimum viable product*) hace exactamente eso: solo un 10 % de los vendedores ve las sugerencias.

### El interruptor de emergencia

Un flag que apaga una función entera es un *kill switch*. Si el modelo nuevo empieza a sugerir tonterías, apagarlo es cambiar un valor en el servicio de flags, sin construir nada ni reiniciar nada. Es el rollback más rápido que existe, comparado con un [[rollback]] normal, que vuelve a desplegar la versión anterior. ¿Cuánto más rápido? Depende de cuántos pods hay y de cuánto tardan en arrancar:

:::formula Cuánto tarda en llegar un cambio
o = ⌈P ÷ b⌉
T_{reinicio} = o × a
- P: pods del gateway, como en la cuenta del cero de más
- b: pods que se reinician a la vez
- o: oleadas de reinicio; ⌈ ⌉ redondea hacia arriba
- a: segundos que tarda un pod en arrancar y quedar listo
- T_{reinicio}: segundos hasta que el último pod tiene el valor nuevo, si llega como variable de entorno
- k: cada cuántos segundos revisa el kubelet los archivos montados; un archivo tarda, a lo mucho, \(k\)
- f: cada cuántos segundos refresca el programa las reglas de los flags; un flag tarda, a lo mucho, \(f\)
:::

:::calculadora config-propagacion
Sube los pods \(P\) a 12, el máximo del gateway de Alba, y mira cómo crece el reinicio: de uno en uno (\(b\) = 1) son \(o\) = 12 oleadas, y \(T_{reinicio}\) = 12 × 30 = 360 s. El flag no cambia.
:::

### El mismo vendedor, siempre del mismo lado

Para prender el flag a un porcentaje, el servicio de flags tiene que decidir quién está adentro. Tirar un dado en cada request sería un desastre: Ana vería sugerencias en una foto y en la siguiente no. La decisión tiene que ser **estable**: el mismo vendedor, siempre del mismo lado.

Se logra con una [[funcion-hash|función hash]], la de la lección de tiempo y hash: el mismo texto da siempre el mismo número. Se calcula el hash del id del vendedor junto con una «sal», un texto fijo y distinto para cada flag. Los primeros 8 caracteres del hash se leen como un número, y el residuo de dividirlo entre 100 da una cubeta del 0 al 99: \( text{cubeta} = text{número del hash} mod 100 \). Con el flag al \(x\) %, entra quien cumple \( text{cubeta} < x \):

```python
import hashlib

def ve_el_modelo_nuevo(seller_id, porcentaje, sal="sugerencias-v2"):
    h = hashlib.sha256(f"{sal}:{seller_id}".encode()).hexdigest()
    return int(h[:8], 16) % 100 < porcentaje      # una cubeta de 0 a 99, siempre la misma

vendedores = [f"seller-{i}" for i in range(10_000)]
al_10 = {v for v in vendedores if ve_el_modelo_nuevo(v, 10)}
al_20 = {v for v in vendedores if ve_el_modelo_nuevo(v, 20)}
print("al 10 %:", len(al_10), "vendedores")
print("al 20 %:", len(al_20), "vendedores")
print("los del 10 % siguen dentro al 20 %:", al_10 <= al_20)
print("seller-9, dos veces:", ve_el_modelo_nuevo("seller-9", 10), ve_el_modelo_nuevo("seller-9", 10))
otra = {v for v in vendedores if ve_el_modelo_nuevo(v, 10, sal="otro-experimento")}
print("con otra sal, repiten:", len(al_10 & otra), "de", len(al_10))
```

```salida
al 10 %: 995 vendedores
al 20 %: 2000 vendedores
los del 10 % siguen dentro al 20 %: True
seller-9, dos veces: True True
con otra sal, repiten: 97 de 995
```

Tres propiedades salen de ahí. El porcentaje se cumple casi exacto: 995 de 10,000. Al subir del 10 % al 20 %, los que ya estaban adentro se quedan, porque sus cubetas siguen debajo de la línea. Y con otra sal, otro flag elige a otros vendedores: solo repiten ≈ 10 % de los del primero, lo que daría el azar. Así, dos experimentos no caen siempre sobre las mismas personas.

Una regla más: el valor del flag **se registra con cada predicción**. Si una métrica cambia, tienes que poder separar las predicciones del modelo nuevo de las del viejo. Un flag no es lo mismo que un [[canary]], que verás en la lección «Rollout seguro»: el canary reparte el tráfico entre dos versiones desplegadas; el flag reparte usuarios dentro del mismo código.

### La deuda de los flags

Hay servicios hechos para esto, como LaunchDarkly, Unleash, Flagsmith o AWS AppConfig. Y está OpenFeature, un estándar abierto para hablar con cualquiera de ellos: tu código pregunta siempre igual («¿está prendido `sugerencias-v2` para este vendedor?») y cambiar de servicio es cambiar una pieza, no reescribir cada `if`. Es un proyecto de la CNCF, en incubación desde diciembre de 2023.

El programa no les pregunta en cada request, porque eso le sumaría una llamada de red a cada foto. Guarda las reglas en memoria y las mantiene al día: unos las vuelven a pedir cada tantos segundos (Unleash, por omisión, cada 15) y otros dejan una conexión abierta por la que el servicio avisa cada cambio al momento (LaunchDarkly). Si el servicio de flags se cae, el programa sigue con las últimas reglas que tenía, o con el valor por omisión de cada flag: por eso ese valor debe ser el seguro, casi siempre «apagado».

El costo está en el código: cada flag es una rama de código. Cada `if` de un flag es un camino más que probar, y un flag que ya está al 100 % desde hace meses se borra, junto con el camino viejo. En «En la vida real» está la historia de un flag viejo que costó cientos de millones de dólares en 45 minutos.

## Errores comunes {Common mistakes}

### 1. El secreto que entró al repositorio «solo un momento»

Alguien sube el `.env` por un `git add .`, se da cuenta y lo borra en el commit siguiente. Ya es tarde: la historia lo guarda, y cualquier copia del repositorio también.

**Cómo evitarlo:** `.env` en el `.gitignore` y en el `.dockerignore` desde el primer día, y un escáner de secretos antes de cada commit y en el CI. Si se escapa uno, se **rota** primero y se limpia después.

### 2. Un valor por omisión que esconde una variable olvidada

El gateway trae `localhost:8000` como dirección de Triton por omisión. En producción alguien olvida la variable: arranca sin quejarse y falla en cada request.

**Cómo evitarlo:** sin valor por omisión para lo que cambia entre ambientes; si falta, el programa no arranca. Y escribe los valores por omisión de otras herramientas aunque coincidan con los tuyos.

### 3. Leer mal el texto de una variable

`bool("false")` es verdadero, `int("0.15")` da un error y un `150` en una variable de segundos son dos minutos y medio. Todo llega como texto, y la conversión es tuya.

**Cómo evitarlo:** convertir a propósito (con una lista de valores que significan «sí»), poner la unidad en el nombre (`_S`, `_MS`) y validar tipo y rango al arrancar, con todos los errores juntos.

### 4. Cambiar el ConfigMap y esperar que el pod se entere

Cambias el timeout en el ConfigMap y nada pasa: los pods leyeron sus variables de entorno al arrancar. O peor: la mitad se reinició por otra razón y ahora hay pods con dos timeouts distintos.

**Cómo evitarlo:** después de cambiar un ConfigMap que llega como variable, reiniciar el Deployment completo (`kubectl rollout restart`). Con Helm, el truco común es poner en el pod una anotación (una etiqueta de texto libre) con el hash del ConfigMap: si la configuración cambia, el hash cambia, y Kubernetes reemplaza los pods solo.

### 5. Creer que un Secret de Kubernetes está cifrado

Un Secret es base64, y base64 se lee en una línea. Si etcd no está cifrado y alguien obtiene un respaldo del clúster, tiene todas las contraseñas.

**Cómo evitarlo:** cifrado en reposo con una llave del KMS, permisos estrictos para `get secrets` y para crear pods y, para lo importante, un gestor de secretos.

### 6. Imprimir la configuración completa en el log

«Arrancó con: …» y la lista de variables, contraseña incluida. O un error de conexión que muestra la dirección de la base con la contraseña adentro.

**Cómo evitarlo:** imprimir la configuración con los secretos tapados (`DB_PASSWORD=****`) y no armar direcciones con la contraseña adentro para mostrarlas. Si ya pasó, el log es una filtración: se rota.

## En la vida real {In real life} [extra]

### Alba: dónde vive cada cosa

Así queda la configuración del gateway de Alba, juntando todo lo de la lección:

| Qué | Dónde vive | Cómo llega |
|---|---|---|
| `TRITON_URL`, `INFER_TIMEOUT_S=0.15`, `PREPROCESS_CONCURRENCY=2`, `MAX_INFLIGHT` | Los manifiestos, en Git | Un ConfigMap, como variables de entorno |
| `PYTHONUNBUFFERED=1` y el entorno de Python en `/opt/venv` | El Dockerfile | Dentro de la imagen: es igual en todos los ambientes |
| `MODEL_VERSION` | Los manifiestos, en Git, y cambia con cada modelo | Una variable de entorno; el gateway la compara con la versión del modelo al arrancar y en cada revisión de salud |
| `labels.json` con su hash | El artefacto del modelo, en el registro de modelos | Viaja con el modelo, nunca suelto |
| Umbral 0.3 y top-k | Un archivo versionado en Git | Cambia en su propio PR, con motivo |
| Sugerencias para el 10 % de los vendedores | El servicio de flags | Se consulta mientras corre y se anota en el log |
| Acceso a S3, el object storage de AWS | En ningún lado: no hay llave | La identidad del pod en la nube (IRSA, *IAM Roles for Service Accounts*, en EKS) |

Fíjate en la última fila y en lo que no está. El gateway de Alba casi no tiene secretos: a S3 entra con la identidad del pod, y a quien le llama lo reconoce con un [[jwt|JWT]] (un token firmado que dice quién llama), revisado en el balanceador antes de llegar al gateway. La mejor contraseña es la que no existe.

Fíjate también en `PYTHONUNBUFFERED=1`: va en la imagen porque no cambia entre ambientes. Una variable de entorno no es automáticamente configuración. Y en el escalado de Triton, Alba escribe en el YAML de KEDA todo lo que importa, aunque coincida con el valor por omisión, como `cooldownPeriod: 300`; nunca deja `minReplicaCount` en su 0 de fábrica, sino que lo fija en 2; y cambia uno peligroso: `ignoreNullValues: "false"`, para que, si la consulta de métricas que KEDA le hace a Prometheus no devuelve nada, sea un error visible y no un 0 silencioso.

### Knight Capital: un flag viejo que nadie borró

El 1 de agosto de 2012, Knight Capital, una de las firmas que más acciones compraba y vendía en Estados Unidos, desplegó código nuevo en sus 8 servidores de órdenes. El código reusaba un flag que años antes encendía una función vieja, que ya no se usaba pero seguía en el código. Uno de los servidores no recibió el código nuevo: cuando el flag se prendió, ese servidor despertó la función vieja.

En unos 45 minutos mandó más de 4 millones de órdenes que nadie quería, todo para atender 212 órdenes chicas de clientes, y la empresa perdió más de US$460 millones, según la investigación de la SEC, el regulador de la bolsa en Estados Unidos (Knight calculó ≈ 440 al día siguiente): unos 10 millones por minuto. La SEC la multó además con US$12 millones. Knight no sobrevivió sola: tuvo que pedir dinero de emergencia a otros inversionistas esa misma semana, y meses después se fusionó con otra firma, Getco. Ahí están juntos tres errores de esta lección: un flag que nunca se borró, un nombre de flag reusado para otra cosa y un despliegue que nadie verificó en todos los servidores.

### Uber, 2016: la llave en el repositorio

En 2016, unos atacantes entraron a un repositorio privado de GitHub que usaban ingenieros de Uber y encontraron ahí credenciales de AWS. Con ellas bajaron datos de ≈ 57 millones de usuarios y conductores. El repositorio era privado, y no bastó: un secreto en Git está a una contraseña robada de distancia de cualquiera.

### Las API keys de los LLMs

En los sistemas que usan LLMs, como un asistente que responde con los documentos internos de una empresa o un agente con herramientas, el secreto más común es la API key de un proveedor de modelos. Una llave filtrada no abre datos: gasta tu dinero, a la velocidad que alguien quiera. Por eso se reparten llaves por equipo, cada una con su presupuesto y su límite de requests, guardadas en un gestor de secretos, y se rotan en cuanto aparece una en un lugar raro.

### Fuera de ML: las apps de tu teléfono

Cuando una app de tu teléfono estrena un botón solo para algunas personas, casi siempre es un feature flag: el código ya llegó con la última actualización y el servidor decide si lo ves. Y tu router sigue las mismas reglas de esta lección: su contraseña de wifi se cambia sin cambiar el programa y, si se filtra, se cambia aunque nadie sepa si alguien la usó.

## Ejercicios {Exercises}

Resuélvelos antes de abrir la solución. Los de rotación y reinicios se pueden comprobar con las calculadoras de las secciones extra.

:::ejercicios
? [facil] Clasifica cada cosa como configuración, secreto, código o parte del modelo: (a) `TRITON_URL`; (b) la contraseña de la base de datos; (c) la función que hace el softmax; (d) el umbral de baja confianza 0.3; (e) el orden de las 500 categorías en `labels.json`; (f) `PREPROCESS_CONCURRENCY`.
- (a) **Configuración**: cambia entre ambientes y nada más cambia con ella.
- (b) **Secreto**: es configuración, pero da acceso. Nunca en el código, en Git, en la imagen ni en un log.
- (c) **Código**: si cambia, cambia lo que hace el programa.
- (d) **Configuración del modelo**: cambia con cada modelo, en un archivo versionado y en su propio PR.
- (e) **Parte del modelo**: si cambia el orden, todas las respuestas apuntan a otra categoría. Viaja con el modelo y con su hash.
- (f) **Configuración**: depende de la máquina, no del código.
? [facil] El entorno trae `INFER_TIMEOUT_S=0.15` y `CACHE_ACTIVA=0`. ¿Qué da `os.environ["INFER_TIMEOUT_S"] * 2`? ¿Y `bool(os.environ["CACHE_ACTIVA"])`? ¿Cómo lees bien los dos?
- `"0.15" * 2` repite el texto: da **`"0.150.15"`**. Las variables llegan como texto.
- `bool("0")` es **`True`**: cualquier texto que no esté vacío es verdadero.
- Bien leídos: `float(os.environ["INFER_TIMEOUT_S"]) * 2` da 0.3, y `os.environ["CACHE_ACTIVA"].strip().lower() in ("1", "true", "yes", "on")` da `False`.
? [facil] El código dice que `PREPROCESS_CONCURRENCY` vale 2, `produccion.yaml` dice 3 y Kubernetes pone la variable de entorno en 4. ¿Con cuánto arranca el gateway? ¿Y si además alguien lo corre con `--preprocess-concurrency 1`?
- La precedencia va código < archivo < entorno < flag. Sin flag, gana el entorno: **4**.
- Con el flag, gana el flag: **1**.
- Si el gateway imprime el origen de cada valor al arrancar, la respuesta está en su primera línea de log.
? [facil] Un compañero dice que el Secret del clúster está protegido porque el manifiesto muestra `DB_PASSWORD: ZGV2LTEyMzQ=`. ¿Qué le contestas?
- Eso es base64, no cifrado. `base64.b64decode("ZGV2LTEyMzQ=")` da **`dev-1234`**, sin ninguna llave.
- Lo que protege un Secret es quién puede leerlo (`get secrets` y crear pods en el namespace) y, si está activo, el cifrado en reposo de etcd. Y ese manifiesto, con el valor adentro, no debería estar en Git.
? [medio] Alguien pone `INFER_TIMEOUT_S=200` pensando en milisegundos. El pico es de 500 requests por segundo en 5 pods, con 16 lugares por pod. Si Triton se traba, ¿cuántas requests por segundo puede despachar cada pod? ¿Cuánto tarda en llenarse? ¿Qué lo habría evitado?
- Usa las letras de «Un pod con Triton trabado»: \(μ = m ÷ t\), \(λ = R ÷ P\) y \(T_{lleno} ≈ m ÷ λ\).
- Cada lugar queda tomado \(t\) = 200 s: \(μ\) = 16 ÷ 200 = **0.08 requests por segundo** por pod.
- Le llegan \(λ\) = 500 ÷ 5 = 100 por segundo: los 16 lugares se llenan en \(T_{lleno}\) ≈ 16 ÷ 100 = **0.16 s**. Todo lo demás recibe 503 por lo menos 3 minutos y pico, lo que tarda en soltarse cada lugar.
- Con \(t\) = 0.2 s, lo que quería, serían \(μ\) = 16 ÷ 0.2 = 80 por segundo: no alcanza para 100, pero el pod despacha 80 errores claros por segundo y se recupera en cuanto Triton vuelve.
- Lo habría evitado validar el rango al arrancar (de 0.01 a 2 segundos) y leer bien el nombre: `_S` es segundos.
? [medio] Cambias `INFER_TIMEOUT_S` de 0.15 a 0.2 en el ConfigMap del gateway, que llega como variable de entorno. Pasan 10 minutos y los pods siguen con 0.15. ¿Por qué? ¿Qué haces? ¿Qué cambiaría si llegara como archivo montado?
- Una variable de entorno se copia **al arrancar** el contenedor. Los pods que ya corrían no se enteran.
- Hay que reiniciarlos: `kubectl rollout restart deployment/gateway` (con el Rollout de Argo de Alba, `kubectl argo rollouts restart gateway`). Kubernetes los cambia por oleadas y cada pod nuevo arranca con 0.2.
- Como archivo, el kubelet lo actualizaría solo, en alrededor de un minuto. Pero el gateway tendría que volver a leer el archivo: si lo leyó una vez al arrancar, seguiría con 0.15.
? [medio] Un desarrollador sube por error el `.env` con la contraseña de staging, se da cuenta y lo borra en el commit siguiente, dos minutos después. El repositorio es privado. ¿Ya está? Escribe los pasos en orden.
- No. La historia de Git guarda el commit anterior (`git show HEAD~1:.env` lo muestra), y cada copia del repositorio lo tiene. Que sea privado no ayuda si alguien roba un acceso, como en Uber.
- 1) **Rotar**: crear una contraseña nueva, ponerla en el gestor, que los pods la usen y revocar la vieja.
- 2) Revisar el registro del gestor y de la base: ¿alguien usó la vieja?
- 3) Si se quiere, limpiar la historia (`git filter-repo`) y avisar a quien tenga copias.
- 4) Agregar `.env` al `.gitignore` y un escáner antes del commit, para que no se repita.
? [medio] El flag `sugerencias-v2` está al 10 % de los vendedores y el pico es de 500 requests por segundo. Si las requests se reparten parejo entre vendedores, ¿cuántas van al modelo nuevo? Subes al 20 %: ¿cuántas, y qué pasa con los vendedores que ya lo veían? ¿Qué tiene que llevar cada línea del log?
- Van al modelo nuevo \(R × x ÷ 100\), con \(R\) = 500 requests por segundo y \(x\) el porcentaje del flag. Al 10 %: 500 × 10 ÷ 100 = **≈ 50 por segundo**. Al 20 %: 500 × 20 ÷ 100 = **≈ 100 por segundo**.
- Los que ya lo veían **se quedan**: su cubeta (el hash de la sal y su id, entre 0 y 99) era menor que 10, y sigue siendo menor que 20. Solo entran los de las cubetas 10 a 19.
- Cada línea del log lleva el valor del flag junto a la `model_version`, para comparar las dos poblaciones.
? [reto] Rotas la contraseña de la base cada 90 días. (a) Si nadie nota nunca una filtración, ¿cuántos días sirve una contraseña robada, en promedio y en el peor caso? (b) ¿Y si un escáner la nota en 1 día? (c) ¿Qué te conviene más: rotar cada 30 días sin escáner, o cada 90 con escáner?
- Usa las letras de «Cuánto sirve una contraseña robada»: \(w = min(H, D)\) y \(w_{prom} = w − w^2 ÷ (2 × D)\), con \(D\) = 90.
- (a) La filtración cae en un momento al azar del periodo, así que lo que falta para la siguiente rotación va de 0 a 90 días, parejo. Sin detección, \(w = D\): peor caso, **90 días**; promedio, 90 − 90² ÷ (2 × 90) = 90 − 45 = **45 días**, la mitad.
- (b) Se rota en cuanto se nota: con \(H\) = 1, \(w\) = min(1, 90) = **1 día**. El promedio: 1 − 1² ÷ (2 × 90) = 1 − 0.0056 ≈ **0.99 días**.
- (c) Cada 30 sin escáner: \(w\) = 30 y \(w_{prom}\) = 30 − 30² ÷ (2 × 30) = 30 − 15 = 15 días. Cada 90 con escáner: ≈ 1 día. **Gana detectar**, por mucho. Lo ideal son las dos cosas, más una credencial que dure horas en vez de meses.
? [reto] Diseña la configuración de un servicio nuevo de Alba que lee de una base de datos. Necesita la dirección de la base, su contraseña, un timeout, el número de conexiones y un interruptor para apagar una función nueva. Hay laptop, staging y producción en Kubernetes. Di dónde vive cada valor, cómo llega al proceso y qué se valida al arrancar.
- **Dirección de la base**: un archivo de valores por ambiente en Git (con Helm), que se vuelve un ConfigMap y llega como variable de entorno. Sin valor por omisión: si falta, no arranca.
- **Contraseña**: en un gestor de secretos, distinta en cada ambiente. Llega como archivo montado (External Secrets o el CSI Driver), de solo lectura. En la laptop, en un `.env` que está en el `.gitignore`. Se rota con dos credenciales válidas. Mejor aún, si la base lo permite: la identidad del pod, sin contraseña.
- **Timeout y conexiones**: valores por omisión sensatos en el código, porque son casi iguales en todos lados, que el archivo de un ambiente puede pisar. Con la unidad en el nombre.
- **Interruptor**: un feature flag, que se consulta mientras corre y se registra con cada request. Se borra cuando llegue al 100 %.
- **Al arrancar**: que estén la dirección y el archivo de la contraseña, que el timeout esté en su rango y que las conexiones sean un entero positivo. Y se imprime todo con su origen, con la contraseña tapada.
:::

## Lo que sigue {What comes next}

- Esta es la última lección de «Herramientas del oficio». La fase siguiente, «La nube», presenta IAM y la identidad de un programa en «Servicios gestionados, serverless y permisos». La de seguridad abre el KMS, los certificados y los tokens en «Cifrado, llaves y certificados» y «Autenticación y permisos».
- Más adelante, el gateway de Alba usa todo esto: «Empaquetado con Docker» pone `ENV` y el `.dockerignore` en su imagen, «CI/CD y registro de imágenes» escanea secretos en cada cambio y «Kubernetes» arma su ConfigMap y su Secret.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
configuracion twelve-factor precedencia-config validacion-config secreto archivo-env configmap secret-k8s helm gestor-secretos rotacion-secretos escaneo-secretos feature-flag
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué es configuración y qué no lo es?
Configuración es lo que cambia entre ambientes o entre días sin cambiar el código: la dirección de Triton, el timeout, el umbral. No lo es lo que obliga a cambiar otra cosa con él: el preprocesamiento o el orden de las categorías son parte del código o del modelo.
? ¿Cuál es la prueba de twelve-factor para saber si separaste bien la configuración?
Preguntarte si podrías hacer público el repositorio hoy sin filtrar una sola credencial. Si no, hay configuración o secretos metidos en el código.
? Código, archivo, variable de entorno y flag dicen valores distintos. ¿Cuál gana?
El flag, luego la variable de entorno, luego el archivo y al final el valor por omisión del código. Gana lo más específico.
? ¿Por qué conviene que el programa falle al arrancar si la configuración está mal?
Porque un pod que no arranca nunca recibe tráfico y la actualización se detiene, mientras los pods viejos siguen atendiendo. Si falla a la tercera request, ya estaba atendiendo usuarios.
? ¿Por qué una variable de entorno no es el mejor lugar para una contraseña?
Se ve en docker inspect y en /proc/<pid>/environ, la heredan los procesos hijos, aparece en volcados de errores y cambiarla exige reiniciar. Un archivo montado desde un gestor de secretos se filtra menos y se puede rotar sin reiniciar.
? Si cambias un ConfigMap, ¿cuándo lo ve el gateway?
Si llega como variable de entorno, solo cuando el pod se reinicia. Si llega como archivo montado, el kubelet lo actualiza en alrededor de un minuto, y el gateway tiene que volver a leerlo.
? Un token se subió a Git y lo borraste un minuto después. ¿Qué haces?
Rotarlo: la historia de Git y sus copias lo siguen teniendo. Después, revisar si alguien lo usó y, si quieres, limpiar la historia.
:::
