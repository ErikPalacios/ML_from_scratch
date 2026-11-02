# PROMPT para la otra sesión (copia TODO este archivo y pégalo)

---

Estoy armando una cheat sheet de Docker para ML serving. Quiero que **agregues a mi cheat sheet** el laboratorio completo que describo abajo, **paso por paso, código por código y comando por comando, con explicación breve de cada línea importante**.

## Cómo quiero el resultado

- Español neutro latinoamericano, tuteo; los términos técnicos en inglés (layer, build context, healthcheck, etc.). Directo y con el *porqué* de cada cosa. Si sirve, usa analogías de cocina (lista del súper = requirements.in, ticket = requirements.txt, alacena = .venv/imagen).
- Adapta el formato a mi cheat sheet existente. **Si no ves mi cheat sheet o no sabes su formato/ubicación, pregúntame antes de escribir.**
- Cada paso debe tener: **qué hace**, **el código/archivo completo**, **el comando exacto**, **qué salida esperar** y **un error típico** (los que realmente me pasaron están en la sección 12).
- Marca claramente cada paso como `✅ probado` o `🟡 borrador sin probar`. **No inventes salidas de comandos que no estén aquí.**
- El código fuente está en el repo; **léelo y cópialo tal cual, no lo reescribas**:
  `~/Documents/ProyectosPortafolio/Caso1/.claude/worktrees/classification-docker-setup-1528ea/iris-lab/`
  (commit `b706a8d` en la rama `claude/classification-docker-setup-1528ea`). Si no puedes leer esa ruta, dímelo y te pego los archivos.

---

## 0. Qué es el proyecto

Clasificador de Iris (3 especies, 4 medidas en cm) servido con **dos servicios** para practicar el ciclo completo de Docker: dependencias fijadas → Dockerfiles → build → caché → push → run → Compose → romperlo → AWS.

```
cliente ──JSON──▶ gateway (FastAPI :8080) ──HTTP v2──▶ model server (FastAPI + onnxruntime :8000) ──▶ model.onnx
                  valida, arma el tensor,               carga el modelo una vez al arrancar,
                  traduce índice → etiqueta             forward en CPU
```

- El **model server** habla el protocolo KServe v2 (el mismo de Triton). Por eso el gateway no cambia si luego se reemplaza por Triton: solo cambia `MODEL_SERVER_URL` y la imagen.
- Triton se descartó en local: la imagen arm64 pesa ~10 GB comprimida y ~30 GB en el pico del pull; llenó el disco de la Mac.
- Máquina: MacBook Air M4 (arm64), Docker Desktop. Todo corre local; nada en la nube todavía.

Estructura:

```
iris-lab/
├── training/train.py                  # entrena el MLP y exporta ONNX
├── model_repository/iris/1/model.onnx # 1.3 KB (se versiona: .gitignore tiene excepción)
├── model_server/
│   ├── server.py
│   ├── requirements.in / requirements.txt
│   ├── Dockerfile                     # variante A: modelo DENTRO de la imagen (contexto = iris-lab/)
│   ├── Dockerfile.dockerignore
│   ├── Dockerfile.volume              # variante B: modelo FUERA (volumen) (contexto = model_server/)
│   └── .dockerignore                  # para la variante B
├── gateway/
│   ├── app.py
│   ├── requirements.in / requirements.txt
│   ├── Dockerfile
│   └── .dockerignore
└── scripts/smoke.sh                   # prueba end-to-end
```

---

## 1. Entrenar y exportar el modelo ✅ probado

Archivo: `training/train.py` (cópialo del repo). Comando, desde `iris-lab/`:

```bash
uv run --no-project --python 3.13 --with torch --with scikit-learn --with onnx python training/train.py
```

Salida esperada: `accuracy test: 1.000 (n=30)` y `exportado: .../model_repository/iris/1/model.onnx`.

Explica estas decisiones del archivo (con el porqué):
- `register_buffer("mean"/"std")`: la normalización vive **dentro** del modelo → anti training/serving skew; se exporta como constante al ONNX.
- Softmax dentro del modelo → el server devuelve probabilidades. Por eso la loss es `NLLLoss` sobre `torch.log(probs + 1e-9)` (con logits se usaría `CrossEntropyLoss`; nota: lo más estable en proyectos serios es entrenar con logits y añadir softmax solo al exportar).
- `stratify=y` en `train_test_split`: conserva la proporción de clases.
- `torch.onnx.export(model, (torch.zeros(1, 4),), ...)`: el segundo argumento es un **input de ejemplo** (tracing), no la forma de la salida. `dynamic_axes` marca el batch como variable. `opset_version=17` es una elección conservadora (versión del "diccionario" de operaciones ONNX; debe soportarla el runtime). `dynamo=False` fuerza el exportador legacy (el nuevo usa `dynamic_shapes`).
- Las dependencias de entrenamiento (`torch`, `scikit-learn`, `onnx`) **no** van en ninguna imagen: el servidor solo necesita `onnxruntime`. Esa es una razón para exportar a ONNX.

---

## 2. Correr los dos servicios SIN Docker ✅ probado

Archivos: `model_server/server.py`, `gateway/app.py`, `scripts/smoke.sh` (cópialos del repo). Explica brevemente:
- Pydantic: `Flower` / `PredictRequest` / `PredictResponse` validan entrada y salida (422 si falla; `response_model` define el contrato de salida).
- `lifespan` + `yield`: antes del `yield` = arranque (abrir `httpx.AsyncClient`, cargar el modelo); después = apagado (`aclose()`).
- `/healthz` (liveness, no depende de nadie) vs `/readyz` (readiness, pregunta al model server `GET /v2/models/iris/ready`).
- Protocolo v2: tensor aplanado + `shape` + `datatype`; `"outputs": [{"name": "probs"}]` pide qué salida devolver (el nombre viene de `output_names` en el export).
- Decodificación en el gateway: `best = max(range(n_classes), key=probs.__getitem__)` es un argmax; `CLASSES` vive en el gateway (si cambia el orden en training, las etiquetas saldrían mal sin error).
- `server.py` usa `def` (no `async def`) en `/infer` porque onnxruntime bloquea; FastAPI lo corre en su threadpool.
- Config por variables de entorno: `MODEL_SERVER_URL` (default `http://localhost:8000`), `MODEL_NAME`, `MODEL_SERVER_TIMEOUT_S`, `MODEL_REPOSITORY`, `MODEL_VERSION`, `MAX_BATCH_SIZE`, `ORT_THREADS`.

Entornos locales (la primera vez, sin versiones fijadas — luego se reemplaza por el paso 3):

```bash
# desde iris-lab/model_server
uv venv --python 3.13 && uv pip install fastapi "uvicorn[standard]" onnxruntime numpy
# desde iris-lab/gateway
uv venv --python 3.13 && uv pip install fastapi "uvicorn[standard]" httpx
```

Arrancar (puerto 9000 porque el 8000 del host lo ocupa otro contenedor mío):

```bash
# desde iris-lab/model_server
.venv/bin/uvicorn server:app --port 9000
# desde iris-lab/gateway  (la variable va en la MISMA línea que el comando)
MODEL_SERVER_URL=http://localhost:9000 .venv/bin/uvicorn app:app --port 8080
# desde iris-lab
./scripts/smoke.sh
```

Salida esperada del smoke: model server `HTTP 200`, metadata, inferencia cruda, gateway `{"status":"ready",...}` y predicción de 3 flores (setosa 1.0, versicolor 0.9996, virginica 1.0).

Comprobaciones manuales con curl (explica `-s`, `-m 3`, `-w`):

```bash
curl -s -m 3 -w ' [%{http_code}]\n' localhost:8080/healthz
curl -s -m 3 -w ' [%{http_code}]\n' localhost:8080/readyz
curl -s -m 3 -w ' [%{http_code}]\n' localhost:9000/v2/health/ready
lsof -nP -iTCP:8080 -iTCP:9000 -sTCP:LISTEN
```

---

## 3. Dependencias fijadas: requirements.in → requirements.txt ✅ probado

Un par por servicio (cada imagen lleva solo lo que usa).

`gateway/requirements.in`
```
fastapi
uvicorn[standard]
httpx
```

`model_server/requirements.in`
```
fastapi
uvicorn[standard]
onnxruntime
numpy
```

Generar el `.txt` (desde cada carpeta):

```bash
uv pip compile requirements.in -o requirements.txt --universal --python-version 3.13
```

- `--universal`: el resultado sirve en Mac **y** Linux (el contenedor es Linux). `--python-version 3.13`: misma versión que `python:3.13-slim`.
- El `.txt` trae comentarios `# via` que dicen quién pidió cada paquete.
- Resultado: gateway 23 paquetes, model server 25. Versiones obtenidas: fastapi 0.162.0, uvicorn 0.54.0, httpx 0.28.1, onnxruntime 1.31.1, numpy 2.5.4.
- Se commitean los dos archivos (`.in` y `.txt`); el `.txt` no se edita a mano.
- Actualizar un paquete: `uv pip compile ... --upgrade-package fastapi`.

Verificar que el `.txt` reproduce el entorno (detén los servidores primero):

```bash
# en cada carpeta; esperado: 23 (gateway) y 25 (model_server)
rm -rf .venv && uv venv --python 3.13 && uv pip sync requirements.txt && uv pip freeze | wc -l
```

- `sync` deja el entorno **exactamente** igual al archivo (instala lo que falta y quita lo que sobra); `install` solo agrega.
- `uv pip freeze | wc -l`: `freeze` lista paquetes (uno por línea), el pipe `|` se los pasa a `wc -l` que cuenta líneas → número de paquetes instalados.

---

## 4. Gateway: Dockerfile, build, caché ✅ probado

`gateway/Dockerfile`
```dockerfile
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

RUN useradd --create-home appuser
USER appuser

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
```

`gateway/.dockerignore` (**guárdalo con contenido**: una vez quedó vacío por no guardar y el build habría mandado el `.venv`)
```
.venv
__pycache__
*.pyc
```

Explica línea por línea: `FROM` (imagen base), `PYTHONUNBUFFERED` (logs al instante), `WORKDIR`, **copiar `requirements.txt` antes que el código** (caché de capas), `--no-cache-dir`, `useradd` + `USER` (no correr como root), `EXPOSE` (solo documenta; no publica), `CMD` en forma exec y **`--host 0.0.0.0`** (con 127.0.0.1 nadie desde fuera del contenedor puede entrar).

Build (desde `iris-lab/gateway/`; el `.` final es el build context):

```bash
docker build --progress=plain -t iris-gateway:0.1 .
docker images iris-gateway
docker history iris-gateway:0.1
```

Números reales: contexto 5.6 kB (con `.dockerignore`), `pip install` ≈ 5.5 s, imagen 274 MB en disco / 59.6 MB comprimida (`DISK USAGE` vs `CONTENT SIZE`: lo comprimido es lo que viaja en push/pull). Capas: `pip install` 56.3 MB, `COPY app.py` 16 kB; el resto es la imagen base.

Experimentos de caché (todos ✅):

```bash
docker build --no-cache --progress=plain -t iris-gateway:0.1 .   # todo se rehace
docker build --progress=plain -t iris-gateway:0.1 .              # todo CACHED (<1 s); mismo manifest sha256
```
- **A.** Agregar un comentario a `app.py` y construir `:0.2` → `pip install` sale `CACHED`; se rehacen `COPY app.py` **y `useradd`** (cuando una capa cambia, todas las de abajo se invalidan aunque su instrucción no cambie).
- **B.** Agregar un comentario a `requirements.txt` y construir `:0.3` → `pip install` se rehace (5.7 s). Docker compara bytes, no significado.
- Revertir con `git restore gateway/app.py gateway/requirements.txt` y limpiar con `docker rmi iris-gateway:0.2 iris-gateway:0.3`.
- Mejora opcional: mover `useradd` antes de instalar dependencias para que solo se rehaga `COPY app.py`.
- Nota: el warning `Running pip as the 'root' user` es normal en el build (los paquetes quedan de root y `appuser` solo puede leerlos, lo cual es bueno).
- Nota: `WORKDIR` salió `CACHED` incluso con `--no-cache` (curiosidad, sin efecto).
- Nota: los wheels se descargan `aarch64` porque Docker Desktop en M4 construye Linux arm64.

---

## 5. Usuario no-root: qué es y qué no es ✅ probado

Comprobación:

```bash
docker run --rm iris-gateway:0.1 id                                   # uid=1000(appuser)
docker run --rm --user root iris-gateway:0.1 id                       # uid=0(root)
docker run --rm iris-gateway:0.1 sh -c 'touch /etc/prueba && echo SI || echo NO'              # NO (Permission denied)
docker run --rm --user root iris-gateway:0.1 sh -c 'touch /etc/prueba && echo SI || echo NO'  # SI
```

Explica el modelo mental: **nadie hace login en un contenedor**. `USER` es con qué identidad corre el proceso. El riesgo no es un login, es una vulnerabilidad (en tu código o en una librería) que deja ejecutar comandos a través de un request; el atacante hereda los permisos del proceso. Por eso `USER` limita el daño. Solo es alcanzable lo que publicas con `-p`.

Versión endurecida (la usa el model server):

```dockerfile
RUN groupadd --system --gid 10001 app && \
    useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
USER 10001:10001
```
- `--system` cuenta de servicio, `--no-create-home` sin carpeta personal, `--shell /usr/sbin/nologin` sin shell interactivo, `&& \` una sola capa.
- UID alto y numérico: Kubernetes `runAsNonRoot` necesita un UID numérico para verificarlo, y evita coincidir con usuarios reales del host. El número es convención, no regla.

---

## 6. Model server: Dockerfile, DOS caminos para los pesos

### Variante A — pesos DENTRO de la imagen ✅ probado en carpeta temporal

Problema: `model_repository/` está **fuera** de `model_server/` y Docker solo copia lo que está dentro del build context → el contexto es `iris-lab/` y se indica el Dockerfile con `-f`.

`model_server/Dockerfile`
```dockerfile
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    MODEL_REPOSITORY=/models

WORKDIR /app

RUN groupadd --system --gid 10001 app && \
    useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY model_server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY model_repository/ /models/
COPY model_server/server.py .

USER 10001:10001

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
```

`model_server/Dockerfile.dockerignore` (BuildKit: aplica solo a ese Dockerfile; en `.dockerignore` los patrones son relativos a la raíz del contexto, por eso `**/`)
```
**/.venv
**/__pycache__
**/*.pyc
gateway
training
scripts
README.md
```

Build **desde `iris-lab/`** (el `.` es `iris-lab/`):

```bash
docker build --progress=plain -f model_server/Dockerfile -t iris-model-server:0.1 .
```

Resultados de la prueba: contexto ≈ 8 kB, imagen 453 MB (≈180 MB más que el gateway por onnxruntime y sus dependencias), `id` → `uid=10001(app)`, `/health/ready` → `{"ready":true}`, inferencia correcta. Orden de capas: usuario → dependencias → modelo → código (de lo que menos cambia a lo que más).

### Variante B — pesos FUERA de la imagen (volumen) ✅ probado en carpeta temporal

`model_server/Dockerfile.volume` (igual, pero sin `COPY model_repository` y con contexto `model_server/`)
```dockerfile
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    MODEL_REPOSITORY=/models

WORKDIR /app

RUN groupadd --system --gid 10001 app && \
    useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

USER 10001:10001

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
```

`model_server/.dockerignore`
```
.venv
__pycache__
*.pyc
Dockerfile*
```

```bash
# desde iris-lab/model_server
docker build -f Dockerfile.volume -t iris-model-server:vol .
# desde iris-lab  (-v origen:destino:ro → solo lectura)
docker run --rm -p 9000:8000 -v "$PWD/model_repository:/models:ro" iris-model-server:vol
```

- Sin `-v` el contenedor **muere al arrancar**: `NoSuchFile: Load model from /models/iris/1/model.onnx failed` + `Application startup failed. Exiting.` → *fail fast* (el orquestador lo ve de inmediato).
- Tamaño igual (453 MB) porque el modelo pesa 1.3 KB.

### Cuándo cuál (incluir tabla)

| | Pesos dentro | Pesos fuera |
|---|---|---|
| Qué es la imagen | paquete cerrado código+modelo | solo código; el modelo llega al arrancar |
| Versión del modelo | = tag de la imagen | se lleva aparte; riesgo de desincronizar código y modelo |
| Rollback | cambias de tag | revertir imagen **y** modelo |
| Modelos de varios GB | cada versión = imagen enorme, push/pull lentos | imagen chica, el modelo se actualiza sin rebuild |

Regla: modelo chico → dentro (reproducible); modelo pesado o que cambia seguido → fuera. Frase de entrevista: *"I copy the dependency manifest and install before copying the source, so code changes reuse the cached dependency layer."*

---

## 7. Correr los dos contenedores y conectarlos 🟡 borrador sin probar (paso 5 pendiente)

Idea clave: dentro de un contenedor `localhost` es el propio contenedor. El gateway debe llegar al model server por **nombre** en una red de Docker, pasando `MODEL_SERVER_URL` con `-e`. El puerto 8000 del host está ocupado por mi contenedor `plant_pathology_zero_model-api-1` → publicar el model server como 9000.

### 7a. Con `docker run` (variante A)

```bash
docker network create iris-net
docker run -d --rm --name model-server --network iris-net -p 9000:8000 iris-model-server:0.1
docker run -d --rm --name gateway --network iris-net -p 8080:8080 \
  -e MODEL_SERVER_URL=http://model-server:8000 iris-gateway:0.1
./scripts/smoke.sh
docker logs gateway
docker stop gateway model-server && docker network rm iris-net
```

### 7b. Con Docker Compose (variante A) — `iris-lab/compose.yaml`

```yaml
services:
  model-server:
    build:
      context: .
      dockerfile: model_server/Dockerfile
    image: iris-model-server:0.1
    ports:
      - "9000:8000"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/v2/health/ready')"]
      interval: 5s
      timeout: 3s
      retries: 10

  gateway:
    build: ./gateway
    image: iris-gateway:0.1
    ports:
      - "8080:8080"
    environment:
      MODEL_SERVER_URL: http://model-server:8000
    depends_on:
      model-server:
        condition: service_healthy
```

```bash
docker compose up --build
docker compose ps
./scripts/smoke.sh
docker compose down
```

(`slim` no trae `curl`; por eso el healthcheck usa Python.)

### 7c. Compose con pesos fuera (variante B)

Cambia solo el servicio `model-server`:

```yaml
  model-server:
    build:
      context: ./model_server
      dockerfile: Dockerfile.volume
    image: iris-model-server:vol
    volumes:
      - ./model_repository:/models:ro
    ports:
      - "9000:8000"
    healthcheck: # igual que arriba
```

---

## 8. Subir las imágenes (push) 🟡 borrador sin probar

Aún no se decidió a qué registry. Documenta las dos opciones.

**Registry local** (no sale de la Mac):
```bash
docker run -d -p 5000:5000 --name registry registry:2
docker tag iris-gateway:0.1 localhost:5000/iris-gateway:0.1
docker push localhost:5000/iris-gateway:0.1
docker rmi localhost:5000/iris-gateway:0.1 iris-gateway:0.1
docker pull localhost:5000/iris-gateway:0.1
```

**Docker Hub** (requiere cuenta propia; sale de la Mac):
```bash
docker login
docker tag iris-gateway:0.1 TU_USUARIO/iris-gateway:0.1
docker push TU_USUARIO/iris-gateway:0.1
```

Explica: nombre completo de una imagen = `registry/usuario/repo:tag`; lo que viaja son las capas comprimidas (≈60 MB el gateway); las capas ya existentes en el registry no se vuelven a subir.

---

## 9. Romperlo (experimentos) 🟡 pendientes, salvo los marcados ✅

Para cada uno: qué esperas → qué pasa → por qué → cómo se arregla.
1. ✅ Arrancar el gateway con la variable en una **línea aparte** (`MODEL_SERVER_URL=...` y luego el comando): el gateway usó el default `localhost:8000` y `/readyz` dio 503 `RemoteProtocolError` (en ese puerto contestaba mi otro contenedor). La variable debe ir en la misma línea que el comando.
2. ✅ `.dockerignore` vacío (0 bytes, sin guardar): el build habría mandado el `.venv`.
3. ✅ Correr la variante B sin `-v`: el contenedor muere al arrancar (fail fast).
4. Gateway en contenedor **sin** `-e MODEL_SERVER_URL`: usa `localhost:8000` → 503 en `/readyz`.
5. Cambiar `--host 0.0.0.0` por `127.0.0.1` en el `CMD`: el contenedor corre pero el `-p` no llega (connection reset/empty reply).
6. Puerto del host ocupado (`-p 8000:8000` con mi otro contenedor): error `port is already allocated`.
7. `docker stop` y SIGTERM: ver en los logs el apagado limpio (código tras el `yield`) vs `docker kill`.
8. `requirements.in` sin fijar versiones vs `.txt`: mostrar la deriva.
9. Correr como root vs `appuser` (ya en el paso 5).
10. Plataforma: construir con `--platform linux/amd64` y compararlo con arm64.
11. Reemplazar el model server por Triton (solo cambiar la imagen/URL): requiere `config.pbtxt` (borrado del repo; ver abajo).

`config.pbtxt` que se usó para Triton (guárdalo como referencia; **no se corrió** porque no cabía en el disco):
```
name: "iris"
backend: "onnxruntime"
max_batch_size: 64
input [ { name: "input", data_type: TYPE_FP32, dims: [ 4 ] } ]
output [ { name: "probs", data_type: TYPE_FP32, dims: [ 3 ] } ]
instance_group [ { kind: KIND_CPU, count: 1 } ]
dynamic_batching { }
```
Triton ya trae los endpoints v2 (`/v2/health/ready`, `/v2/models/iris/ready`, `/infer`) y métricas Prometheus en el puerto 8002; el model server propio los implementa a mano.

---

## 10. AWS 🟡 PLAN, NO PROBADO (marca cada comando como "verificar con la doc oficial")

Contexto: no tengo cuenta todavía. Las cuentas nuevas reciben créditos ($100 + hasta $100 por actividades) y un plan gratuito de máximo 6 meses; no se pudo confirmar si piden tarjeta al registrarse. Costos aproximados: ECR centavos; Fargate ≈ $0.04 por vCPU-hora (un contenedor de 0.25 vCPU / 0.5 GB ≈ $9/mes encendido 24/7; no verificado contra la página oficial); el balanceador de carga (ALB) es probablemente lo más caro y **su precio no está verificado**. Recomendaciones: alerta de presupuesto desde el inicio, no usar ALB al principio (exponer el gateway con un security group limitado a mi IP) y **borrar todo al terminar**.

Qué cambia respecto a local (tabla): requirements/Dockerfiles/caché/usuario/`0.0.0.0`/env vars **no cambian**; cambian la arquitectura (M4 = arm64), el registry (ECR), dónde corre (ECS Fargate), cómo se encuentran los servicios y cómo llega el modelo si va fuera de la imagen.

Pasos (esqueleto; la persona dueña de la cuenta crea las credenciales y configura el acceso, **no pegar claves en el chat**):

1. Crear cuenta, alerta de presupuesto, instalar CLI (`brew install awscli`), configurar acceso (`aws configure sso` o `aws configure`), comprobar con `aws sts get-caller-identity`.
2. Arquitectura. Opción 1: Fargate en x86 → construir `docker buildx build --platform linux/amd64 -t ... --load .` (en la Mac se emula y es más lento). Opción 2: Fargate en ARM64 (Graviton, más barato) → sirve la imagen arm64 tal cual; en la task definition se indica `cpuArchitecture: ARM64`. El `requirements.txt` universal sirve en ambas.
3. ECR:
```bash
aws ecr create-repository --repository-name iris-gateway --region us-east-1
aws ecr create-repository --repository-name iris-model-server --region us-east-1
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
docker tag iris-gateway:0.1 ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/iris-gateway:0.1
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/iris-gateway:0.1
```
(igual para `iris-model-server`).
4. Correr en ECS con Fargate: cluster, task definition (los dos contenedores, `MODEL_SERVER_URL`, logs a CloudWatch), servicio. Cómo se encuentran: dos contenedores en la **misma task** se hablan por `localhost` (entonces `MODEL_SERVER_URL=http://localhost:8000`), o en tasks separadas con service discovery / Service Connect. Explica ambas opciones y la diferencia con el `localhost` del contenedor en local.
5. Health checks: `/readyz` del gateway se usa como health check del balanceador / del contenedor.
6. Red: el model server **privado**, solo el gateway accesible desde fuera.
7. Logs: stdout → CloudWatch (por eso `PYTHONUNBUFFERED=1`).
8. **Limpieza obligatoria**: eliminar servicio, cluster, repositorios ECR y cualquier balanceador.

### Pesos dentro de la imagen en AWS
No cambia nada: se sube la imagen variante A a ECR y el modelo viaja con ella.

### Pesos fuera de la imagen en AWS (el `-v` de la Mac no existe)
Opciones a documentar: (a) bajar el modelo de **S3** al arrancar (script de entrada o un contenedor init que copie a un volumen compartido; el rol de la task necesita permiso de lectura al bucket); (b) montar un volumen **EFS** en la task definition en `/models`; (c) en Kubernetes, un volumen persistente o un init container. Indica que `server.py` ya falla rápido si el modelo no está, lo cual es deseable.

Argumento de diseño: separar gateway y model server permite reemplazar el segundo por Triton (en una instancia con GPU o con disco suficiente) cambiando solo la imagen y `MODEL_SERVER_URL`.

---

## 11. Comandos de inspección y limpieza (referencia rápida) ✅

```bash
docker images
docker ps -a
docker history IMAGEN:TAG
docker logs NOMBRE
docker exec -it NOMBRE sh
docker system df
docker rmi IMAGEN:TAG
docker image prune -af
docker builder prune -af
df -h /
```

---

## 12. Errores reales que me pasaron (incluirlos como "trampas")

1. **Disco lleno al bajar Triton** (≈10 GB comprimida, ≈30 GB de pico con el containerd store): Docker Desktop se cayó (`Docker Desktop is unable to start`) y hasta Claude Code dejó de poder crear archivos temporales. Antes de bajar imágenes grandes: `df -h /` y `docker system df`. Recuperación: liberar espacio (`uv cache prune`), matar y reabrir Docker Desktop, `docker image prune -af`.
2. **El puerto 8000 del host ocupado** por otro contenedor → el gateway "conectaba" ahí y daba `RemoteProtocolError`. Diagnóstico: `lsof -nP -iTCP:8000 -sTCP:LISTEN` y `docker ps`.
3. **La variable de entorno en una línea aparte** no se la pasa al programa.
4. **`.dockerignore` vacío por no guardar** el archivo (`wc -c` lo delata).
5. **Carpetas ocultas en macOS**: `.claude` no se ve en Finder → `Cmd+Shift+.` o `Cmd+Shift+G` y pegar la ruta, o `code RUTA` desde la terminal.
6. **Todo `CACHED` en el "primer" build** porque una prueba previa con los mismos archivos dejó el caché: el caché se basa en el **contenido**, no en el nombre de la imagen; usar `--no-cache` para ver el build real.
7. **`.gitignore` raíz ignora `*.onnx`**: el modelo no entraba al commit → excepción en `iris-lab/.gitignore` (`!model_repository/**/*.onnx`).
8. **Pegar una plantilla sobre `pyproject.toml`** (otro proyecto, Caso1) desincronizó el lock: el lock se deriva del archivo de dependencias, nunca al revés.

---

## Resumen de estado para marcar en la cheat sheet

| Paso | Estado |
|---|---|
| 1 Entrenar/exportar | ✅ |
| 2 Correr sin Docker | ✅ |
| 3 requirements fijados | ✅ |
| 4 Dockerfile gateway + build + caché | ✅ |
| 5 Usuario no-root | ✅ |
| 6 Dockerfile model server (A y B) | ✅ probado en carpeta temporal; falta crearlo y construirlo en el repo |
| 7 Run/Compose | 🟡 pendiente |
| 8 Push | 🟡 pendiente |
| 9 Romperlo | 🟡 parcial |
| 10 AWS | 🟡 plan, no probado |
