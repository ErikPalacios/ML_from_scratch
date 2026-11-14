---
titulo: Código de serving
en: Serving code
subtitulo: El sexto paso del sistema de Alba de principio a fin: el programa que recibe la foto, la revisa, la prepara, le pide la respuesta a Triton con un plazo, contesta con el código correcto y deja su rastro, más la carpeta con que Triton carga el modelo.
pregunta: El modelo ya está compilado y registrado. ¿Qué programa lo pone a responder fotos de verdad, por la red, cientos de veces por segundo, sin caerse cuando llega una foto rara, cuando sube el tráfico o cuando la GPU se traba?
requisitos: http, apis, fallas-red, latencia, async, balanceo, imagenes, config, pruebas-ci, e05-export
---

:::idea
Servir un modelo no es llamarlo: es protegerlo. El gateway recibe cada foto, la rechaza en cuanto puede si viene mal, la prepara en la CPU con topes de memoria y de concurrencia, le da a la GPU un plazo que nunca pasa del que le queda, y responde siempre con un código que dice qué pasó. Triton, del otro lado, solo convierte tensores en tensores, con la configuración que dice su `config.pbtxt`.
:::

Alba es la empresa que seguimos en todo el curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y sugiere la categoría de cada foto entre 500. Contando las fotos que le piden otros equipos, responde ≈ 10 millones al día y diseña para un pico de 500 por segundo. El modelo es una [[resnet|ResNet-50]] que corre en **Triton**, un programa para servir modelos, sobre 2 GPUs NVIDIA T4, una en cada una de las dos [[zona-disponibilidad|zonas]] de AWS en Virginia (us-east-1); una zona es un centro de datos separado de los demás. Delante de Triton está el **gateway**, la puerta de entrada: un programa en Python con FastAPI que corre en 3 a 12 copias iguales, que solo usan CPU. Ana sube la foto de unos tenis y, en ≈ 20 ms del lado de Alba, recibe «Calzado › Tenis» con 94 %.

La estación anterior, «Export, engine y paridad», dejó listo el modelo: un [[engine-tensorrt|engine de TensorRT]] en [[fp16|FP16]] (números de 16 bits), `model.plan`, compilado para la T4 y registrado como `challenger` (la versión candidata, que todavía no atiende a la gente). Fijó también el contrato: una entrada `input` de números FP32 (de 32 bits: 4 B cada uno) con forma `[3, 224, 224]` por foto, una salida `logits` de 500 números y batches de hasta 32 fotos.

Esta lección es una **estación**: un paso del sistema contado como trabajo de ingeniería completo. Vas a seguir la foto de Ana por el código, línea por línea de decisiones: qué entra, qué sale, cada número con su cuenta, cómo se comprueba y qué se rompe cuando falta.

## Lo que entra, lo que sale y dónde se corta {In, out and where the system splits}

### Lo que entra

- **El engine y su contrato**, de la estación 5, «Export, engine y paridad»: `model.plan` (≈ 50 a 150 MB), con `input` FP32 `[3, 224, 224]` y `logits` FP32 `[500]`, hasta 32 fotos por batch.
- **`labels.json`**: las 500 categorías, en el orden de las salidas del modelo. La posición 0 de los logits es la categoría 0 de la lista. Viaja con el modelo: un [[configmap|ConfigMap]] por versión (`classifier-labels-14` para `resnet50-2026-10-01`), que Kubernetes, el programa que arranca y vigila las copias de Alba en sus máquinas, pone como archivo en `/etc/classifier/labels.json` dentro de cada copia.
- **El [[preprocesamiento|paquete de preprocesamiento]] 1.4.0**, el mismo código que se usó al entrenar. Si el gateway preparara la foto de otra forma, el modelo vería fotos distintas de las que aprendió: es el [[training-serving-skew|training-serving skew]] de «Una foto, vista por un modelo».
- **El contrato con quien llama**: `POST /v1/classify?top_k=5` (`top_k=5` pide las 5 categorías más probables), con los bytes de la foto como [[body]] y `Content-Type: image/jpeg`, `image/png` o `image/webp`. La app espera 300 ms; si no llega respuesta, muestra el selector manual de categorías.

### Lo que sale

- **El código del gateway**, en la carpeta `gateway/` del repositorio `classifier`: `app/main.py` (el servidor y sus rutas), `app/preprocess.py` (decodificar y redimensionar), `tests/` (26 pruebas), `requirements.txt` (37 dependencias fijadas) y el [[dockerfile|`Dockerfile`]], la receta de su [[imagen-contenedor|imagen de contenedor]]: el paquete con el programa y todo lo que necesita para correr, que arma «Empaquetado con Docker».
- **El [[model-repository|model repository]] de Triton**: la carpeta `classifier/` con su `config.pbtxt` y, adentro de `1/`, el `model.plan`.
- **Cuatro rutas**: `POST /v1/classify`, `GET /healthz`, `GET /readyz` y `GET /metrics`. Solo la primera se puede llamar desde fuera del clúster (el grupo de máquinas de Alba que maneja Kubernetes); las otras tres son para Kubernetes y para el programa que junta las métricas.
- **El rastro de cada request**: una línea de log en JSON y las métricas, con nombres fijos, porque de ellos dependen las alertas.

### Lo que se decide

:::pasos
1. Dónde se corta
Qué hace el gateway en la CPU y qué hace Triton en la GPU.
2. En qué orden se revisa la foto
De lo más barato a lo más caro, con el código HTTP de cada rechazo.
3. Cuánto se deja entrar
Cuántas fotos se decodifican a la vez, cuántas requests caben adentro y cuánta memoria pide cada copia.
4. Cuánto se espera
El plazo de cada eslabón, de la app a la fila de Triton.
5. Qué se contesta y qué se anota
La respuesta, el código de cada falla, el log y las métricas.
6. Cómo carga Triton el modelo
El `config.pbtxt`: batching, fila, copias del modelo y warmup.
:::

Lo que esta estación **no** decide: cómo se arma la imagen de contenedor (lo cuenta «Empaquetado con Docker»), cómo se construye y se publica (es de «CI/CD y registro de imágenes»), cuántas copias corren y cómo las vigila Kubernetes (estaciones posteriores), ni cómo se prueba el modelo nuevo con tráfico real.

Antes del gateway hay una pieza más. La foto llega primero al [[alb|ALB]] (*Application Load Balancer*), el balanceador de AWS: recibe las requests de internet, verifica el token de quien llama y las reparte entre las copias del gateway. Cada copia corre en un [[pod]], la unidad que Kubernetes arranca, reinicia y reparte entre sus máquinas; Triton corre en otro.

:::diagrama e06-serving-estacion
La estación 6 completa: la foto entra por el ALB, el gateway la revisa y la prepara en la CPU, y Triton corre el modelo en la GPU. Toca cada caja; los recorridos siguen la foto de Ana, una GPU trabada y una foto demasiado grande.
:::

### El corte: un servidor de modelos detrás de un gateway

Un [[servidor-modelos|servidor de modelos]] (*model server*) es un programa que tiene el modelo cargado y convierte tensores en tensores lo más barato posible. Carga versiones, junta requests en batches, reparte el trabajo entre copias del modelo y publica su salud y sus métricas. No sabe de vendedoras, categorías ni cuotas (cuántas fotos puede pedir cada quien). El de Alba es [[triton|Triton]], de NVIDIA: un servidor escrito en C++ que lee los modelos de una carpeta, los corre con el motor que toque (TensorRT, ONNX Runtime, PyTorch…) y habla el [[protocolo-inferencia|protocolo de inferencia v2]], un formato estándar para pedirle una inferencia a un servidor de modelos, por HTTP y por gRPC.

Todo lo que sabe del producto o de quien llama se queda en el **gateway**:

| En el gateway (CPU) | En Triton (GPU) |
|---|---|
| Revisar los bytes que llegan, que pueden ser hostiles | Cargar el engine y su versión |
| Decodificar y preparar la foto | La fila y el batching |
| El plazo de cada request | Las copias del modelo en la GPU |
| Softmax, top-k y los nombres de las categorías | Correr el modelo |
| El contrato `/v1`, los códigos, el log y las métricas del producto | Su propia salud y sus métricas de GPU |

¿Por qué no un solo programa? Por cuatro razones, cada una con su número:

- **Escalan con recursos distintos.** El gateway gasta CPU: en el pico de diseño, 500 fotos por segundo × ≈ 0.006 s de preproceso cada una = 3 segundos de CPU en cada segundo: ≈ 3 [[vcpu|vCPU]] ocupadas todo el tiempo. Triton gasta GPU. Si fueran un solo programa, cada copia nueva traería una T4 de US$0.526 la hora aunque solo faltara CPU.
- **Cambian a ritmos distintos.** El código del producto cambia cada semana; el engine, una vez al mes. Separados, un cambio en el top-k no obliga a reconstruir la imagen de contenedor de Triton, de ≈ 9 GB.
- **Los bytes hostiles no tocan la GPU.** Una foto armada para tumbar el decode ([[decodificar|decodificar]]: convertir el archivo comprimido en la cuadrícula de píxeles) revienta una copia de CPU barata y reemplazable, no el proceso que tiene la GPU.
- **Triton es reemplazable.** Como el gateway habla el protocolo estándar v2, cambiar de servidor de modelos no cambia el contrato con quien llama.

El corte cuesta. Cada foto cruza la red dos veces: llega como un JPEG de ≈ 200 KB y sale hacia Triton como un tensor de 602,112 B, 3 veces más. A 500 por segundo son ≈ 2.4 Gb/s, como contaste en «APIs: REST, JSON, gRPC y streaming». Por eso cada gateway le habla a la Triton de su misma zona ([[ruteo-por-zona|ruteo por zona]]): cruzar de zona cobra por byte. Y es un componente más que puede fallar.

El gateway es un [[servicio-sin-estado|servicio sin estado]]: no guarda nada de una request para la siguiente. Cualquier copia atiende cualquier foto, y crecer es agregar copias. Por eso corre **un solo proceso por copia**: la capacidad se suma con copias, no con procesos adentro de cada una.

:::analogia El mesero y la cocina
El gateway es el mesero: recibe la orden, revisa que tenga sentido, la escribe como la cocina la entiende, avisa si se tarda y le lleva el plato al cliente. Triton es la cocina: no habla con los clientes, solo cocina, y le conviene juntar órdenes iguales para hacerlas de una vez. Contratas meseros y cocineros por separado porque se ocupan de cosas distintas.

Se rompe en que la cocina de Alba no improvisa nada: si una orden lleva 100 ms esperando, la tira, aunque el cliente siga sentado. Y en que el mesero de Alba no recuerda a nadie de una visita a otra.
:::

## El esqueleto: FastAPI, uvicorn, el arranque y la salud {The skeleton: FastAPI, uvicorn, startup and health}

El gateway son tres capas, de afuera hacia adentro:

- **[[uvicorn]]** es el servidor: el programa que abre el [[puerto]] 8080, acepta conexiones, lee los bytes de HTTP y corre el [[event-loop|event loop]].
- **[[asgi|ASGI]]** (*Asynchronous Server Gateway Interface*, la interfaz asíncrona entre servidor y aplicación) es el contrato entre los dos: una función `async` que recibe la request y manda la respuesta por pedazos. Gracias a él, uvicorn puede correr cualquier aplicación que lo cumpla.
- **[[fastapi|FastAPI]]** es el *framework*, el armazón de código ya hecho donde tú solo escribes tus funciones: conecta cada ruta con su función, revisa los parámetros con [[pydantic]] y arma las respuestas en JSON.

### Los flags de uvicorn

El comando con que arranca cada copia es este. Cada flag es una decisión:

`uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 75 --timeout-graceful-shutdown 20 --no-access-log`

- `app.main:app`: el objeto `app` del archivo `app/main.py`.
- `--host 0.0.0.0 --port 8080`: escucha en el puerto 8080 en todas las direcciones de red de la copia. Con `127.0.0.1` solo la oiría ella misma, y el ALB no llegaría.
- `--workers 1`: **un proceso** con un event loop. La concurrencia sale del loop y del [[threadpool]], como en «Hacer varias cosas a la vez: async, event loop y GIL»; la capacidad, de más copias.
- `--timeout-keep-alive 75`: deja abierta una conexión sin uso ([[keep-alive]]) 75 s, más que los 60 s del ALB, para que **el ALB cierre primero**. Al revés, el gateway cerraría una conexión justo cuando el ALB le manda una request, y esa request recibiría un 502 («el de atrás dio una mala respuesta»). Lo viste en «HTTP: requests, respuestas y códigos».
- `--timeout-graceful-shutdown 20`: al recibir la [[senal|señal]] de apagarse, le da 20 s a las requests en curso para terminar.
- `--no-access-log`: uvicorn no escribe su propia línea por request. La escribe el código, con más campos.

### El lifespan: lo que se crea antes de atender

El [[lifespan]] es la función que corre **una vez al arrancar**, antes de la primera request, y una vez al apagarse. En el gateway de Alba hace cuatro cosas, en este orden:

1. Lee `labels.json`, revisa su [[hash-criptografico|huella SHA-256]] contra la que llega por [[variable-entorno|variable de entorno]] y que sean 500.
2. Crea **un solo** cliente de Triton para todo el proceso, con su [[pool-conexiones|pool de conexiones]].
3. Le pregunta a Triton cuántos logits da el modelo y revisa que sean tantos como labels: 500 = 500.
4. Crea el semáforo de 2 decodes y el contador de requests en vuelo (los explica la sección «Topes»).

Si algo falla, el proceso sale con error y la copia no recibe tráfico. Es mejor no arrancar que arrancar con las categorías en otro orden: un `labels.json` desordenado da respuestas equivocadas con buena confianza, y todas con código 200.

:::profundo El lifespan y la ruta en código
¿Por qué ahí y no al principio del archivo? Porque el cliente de Triton es asíncrono y necesita un event loop corriendo, y cuando Python lee el archivo por primera vez (al importarlo) todavía no lo hay.

Este es un fragmento del `main.py`, como **ilustración**: necesita FastAPI y `tritonclient`, que no vienen con Python.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    labels = leer_labels(LABELS_PATH, esperado=LABELS_SHA256)        # falla si la huella no coincide
    triton = InferenceServerClient(url=TRITON_URL, conn_limit=64)    # uno por proceso
    meta = await triton.get_model_metadata(MODEL_NAME)
    if meta["outputs"][0]["shape"][-1] != len(labels):               # 500 logits = 500 labels
        raise RuntimeError("labels.json no corresponde al modelo")
    app.state.labels, app.state.triton = labels, triton
    app.state.cpu = asyncio.Semaphore(PREPROCESS_CONCURRENCY)       # 2 decodes a la vez
    app.state.en_vuelo = 0
    yield                                                            # aquí atiende requests
    await triton.close()                                             # al apagarse: cierra el pool

app = FastAPI(lifespan=lifespan)

@app.post("/v1/classify")
async def classify(request: Request, top_k: int = Query(5, ge=1, le=20)):
    ...                                                              # las cuatro secciones que siguen
```
:::

En la ruta, `top_k: int = Query(5, ge=1, le=20)` es la regla del contrato: `top_k` vale 5 si no viene y debe estar entre 1 y 20. Si alguien manda `top_k=50`, FastAPI responde **422** («los datos no cumplen las reglas») sin entrar a `classify`.

### Vivo y listo: /healthz y /readyz

Kubernetes le pregunta a cada copia dos cosas distintas, como viste en «Balanceadores, proxies y gateways». Los dos [[endpoint-salud|endpoints de salud]] del gateway las contestan:

- **`/healthz`: «¿sigues vivo?».** Responde `{"status": "ok"}` si el proceso y su event loop responden. **No le pregunta a nadie más.** Si falla tres veces seguidas (cada 10 s, con 2 s para contestar), Kubernetes reinicia la copia.
- **`/readyz`: «¿te mando tráfico?».** Le pregunta a Triton si `classifier` está listo, con un tope de 0.5 s, y responde 200 o 503. Si falla, la copia sale del reparto **sin reiniciarse**.

¿Por qué `/healthz` no pregunta por Triton? Si lo hiciera, una caída de Triton haría fallar el `/healthz` de **todas** las copias, Kubernetes las reiniciaría todas, y reiniciarlas no arregla a Triton. Además, al volver Triton, todas estarían arrancando a la vez.

:::diagrama e06-serving-salud
Quién pregunta qué. Kubernetes pregunta a `/healthz` y a `/readyz`; solo `/readyz` le pregunta a Triton. Usa «Recorrer» para ver el arranque, una caída de Triton y un event loop congelado.
:::

:::profundo Cuando Triton cae en las dos zonas
Cuando Triton cae en las dos zonas, todas las copias del gateway quedan «no listas». En Alba, el ALB manda las fotos directo a la IP de cada copia, y la pieza de Kubernetes que lo configura (el controlador del balanceador de AWS) saca de su lista a cada copia que falla su `/readyz`. Con todas fuera, la lista queda vacía y el ALB contesta el 503 él mismo. La app recibe el 503 y muestra el selector manual. Ese 503 **no pasa por el gateway ni aparece en sus métricas**: quien vigila el servicio tiene que mirar también las del ALB. El ALB solo [[fail-open|falla abierto]] (manda tráfico a todos igual) cuando sus destinos siguen en la lista pero fallan el chequeo del propio ALB, y eso aquí no pasa.
:::

## La foto de Ana entra: revisar de lo barato a lo caro {Ana's photo comes in: checking from cheap to expensive}

La request de Ana llega con su foto de 214,836 B, de 768 × 1,024 píxeles. Lo primero que hace `classify` no tiene que ver con la foto:

- Toma el [[request-id|request_id]] del header `X-Request-ID` si la app lo manda; si no, genera uno nuevo (un [[uuid|UUID]]). Viaja en el log, en la respuesta y a Triton.
- Lee `X-Client-Source`: `mobile`, `web`, `internal` u `other`. Lo escribe quien llama, así que solo sirve para partir las métricas, **nunca** para permisos ni cuotas. Quién llama de verdad sale del token que el ALB ya verificó (un [[jwt|JWT]], la credencial firmada que trae cada request): su `client_id`, como cuenta «Autenticación y permisos».

### El orden de la revisión

Cada revisión cuesta más que la anterior, así que van en orden. Una foto que falla la primera no gasta nada en las demás. MP son megapíxeles: millones de píxeles, ancho × alto ÷ 1,000,000.

| Paso | Qué mira | Cuánto cuesta | Si falla |
|---|---|---|---|
| 1. Tipo | `Content-Type` es JPEG, PNG o WebP | Comparar un texto | **415** |
| 2. Tamaño anunciado | `Content-Length` > 10 MB | Leer un header | **413**, sin leer el body |
| 3. Tamaño real | Lee el body en pedazos y corta a los 10 MB | Leer hasta 10 MB | **413** |
| 4. Vacío | El body tiene 0 bytes | Nada | **400** |
| 5. Píxeles | Ancho × alto > 40 MP | Leer el encabezado de la imagen | **413** |
| 6. Forma | Lado largo > 8 × lado corto | Una multiplicación | **400** |
| 7. Decode | El archivo está corrupto o cortado | Decodificar: ≈ 6 ms; una de 40 MP, cientos de ms | **400** |

`Content-Length` es el header donde quien llama dice cuántos bytes trae el body. El paso 3 existe porque el paso 2 confía en ese dato: puede mentir o no venir. Leer en pedazos y cortar a los 10 MB es lo que de verdad protege la memoria. En el código el tope es 10 × 1,024 × 1,024 = 10,485,760 B (10 [[prefijo-binario|MiB]], ≈ 10.5 MB); en las cuentas de memoria lo redondeamos a 10 MB.

El paso 5 es barato por un detalle de Pillow, la biblioteca que decodifica las fotos: `Image.open` lee solo el **encabezado** del archivo, donde vienen el ancho y el alto, sin decodificar los píxeles. Por eso se puede rechazar un PNG de 48 MP que pesa 2 MB antes de gastar la memoria del decode. Es la defensa contra la [[bomba-descompresion|bomba de descompresión]] de «Una foto, vista por un modelo».

:::profundo La red propia de Pillow
Pillow además trae su propia red: `Image.MAX_IMAGE_PIXELS`, que el gateway pone en 40 M. Con ese valor Pillow solo avisa arriba de 40 MP y se niega a abrir arriba del doble, 80 MP: es un respaldo, no el corte de 40 MP, que lo hace el código del paso 5.
:::

¿Y el 1:8 del paso 6? Una tira de 1 × 4,000 píxeles pesa menos de 200 B. Pero el preprocesamiento lleva el lado corto a 256 píxeles y estira el largo en la misma proporción: 4,000 × 256 = 1,024,000. La tira quedaría de 256 × 1,024,000 = 262,144,000 píxeles, más de 6 veces el tope de 40 MP. Ninguna foto de un producto es así de alargada.

El programa de abajo es la misma revisión con siete requests de juguete. Las cifras de cada foto las inventamos para el ejemplo, salvo la de Ana:

```python
MAX_BYTES, MAX_PIXELS = 10 * 1024 * 1024, 40_000_000
TIPOS = {"image/jpeg", "image/png", "image/webp"}

def revisar(tipo, content_length, leidos, ancho, alto):
    if tipo not in TIPOS:                                   return 415
    if content_length is not None and content_length > MAX_BYTES: return 413   # sin leer el body
    if leidos > MAX_BYTES:                                  return 413   # se corta al leer
    if leidos == 0:                                         return 400
    if ancho * alto > MAX_PIXELS:                           return 413   # del encabezado
    if max(ancho, alto) > 8 * min(ancho, alto):             return 400   # más que 1:8
    return 200                                              # sigue el decode

fotos = [("Ana, tenis", "image/jpeg", 214_836, 214_836, 768, 1024),
         ("un PDF", "application/pdf", 90_000, 90_000, 0, 0),
         ("foto de 12 MB", "image/jpeg", 12_582_912, 0, 0, 0),
         ("sin Content-Length", "image/png", None, 10_485_761, 0, 0),
         ("body vacío", "image/webp", 0, 0, 0, 0),
         ("PNG de 48 MP", "image/png", 1_900_000, 1_900_000, 8000, 6000),
         ("tira de 1 × 4,000", "image/png", 180, 180, 1, 4000)]
for nombre, *datos in fotos:
    print(f"{nombre:<19} → {revisar(*datos)}")
```

```salida
Ana, tenis          → 200
un PDF              → 415
foto de 12 MB       → 413
sin Content-Length  → 413
body vacío          → 400
PNG de 48 MP        → 413
tira de 1 × 4,000   → 400
```

La de 12 MB nunca se lee: el header la delata. La que no dice su tamaño se lee hasta el byte 10,485,761 y ahí se corta. Y el PNG de 48 MP pesa lo que ≈ 9 fotos de la app (1.9 MB contra ≈ 215 KB cada una), pero decodificado ocuparía cientos de MB.

:::figura e06-serving-embudo
El embudo de la revisión: cada paso cuesta más que el anterior y deja pasar menos. La foto de Ana cruza los siete; las demás salen en cuanto fallan, con su código.
:::

## Topes: dos decodes, dieciséis en vuelo y un GiB {Limits: two decodes, sixteen in flight and one GiB}

La foto de Ana pasó la revisión barata. Ahora viene lo caro: decodificarla en la CPU. Cada copia del gateway tiene 1 [[vcpu|vCPU]] y 1 GiB de memoria, y en el pico de diseño atiende ≈ 100 fotos por segundo (500 entre las 5 copias que corren en el pico). Dos topes evitan que una ráfaga la tumbe.

### El semáforo: dos decodes a la vez

Un [[semaforo|semáforo]] es un contador de lugares: deja pasar a tantas tareas como lugares tiene y pone a esperar a las demás. El del gateway tiene **2 lugares**. Una request toma un lugar, decodifica en un hilo del pool con `run_in_threadpool` (para no congelar el event loop, como viste en «Hacer varias cosas a la vez») y lo suelta.

Si una request espera un lugar más de **50 ms**, no sigue esperando: recibe **503** con el header [[retry-after|`Retry-After: 1`]], «intenta en un segundo». Una fila de CPU que crece sin tope solo produce respuestas que llegan después de los 300 ms, cuando la app ya mostró el selector manual.

¿Por qué 2 y no los 40 hilos que trae por omisión el pool de FastAPI? Por la memoria. Un PNG de 40 MP decodificado ocupa ≈ 160 MB: Pillow guarda cada píxel RGB en 4 bytes (tres de color y uno de relleno), y 40,000,000 × 4 B = 160 MB. Girarlo según la orientación que anota su EXIF y convertirlo a RGB hace otra copia: ≈ **320 MB** en el peor momento. Con 40 decodes a la vez serían ≈ 13 GB, en un pod de 1 GiB.

### El tope de requests en vuelo: dieciséis

Una request está **en vuelo** desde que llega hasta que sale su respuesta. El [[requests-en-vuelo|tope de requests en vuelo]] del gateway es `MAX_INFLIGHT = 16` por copia: si ya hay 16, la 17 recibe 503 **al instante**, antes de leer su body. Ese rechazo cuesta microsegundos; es el [[load-shedding|load shedding]] de «Timeouts, reintentos e idempotencia».

¿De dónde sale el 16? De la [[ley-little|Ley de Little]] de «Hacer varias cosas a la vez»: en vuelo = llegadas por segundo × tiempo de cada una. Una copia que recibe ≈ 100 por segundo tiene adentro, con requests de ≈ 50 ms, unas 100 × 0.05 = 5. Si las requests se alargan a ≈ 200 ms, serían 100 × 0.2 = 20. Para no rechazar nunca ese caso lento harían falta 20 lugares, pero el tope se recorta a 16 por la memoria: cada request en vuelo puede traer un body de hasta 10 MB, y con 16 el peor momento todavía cabe en 1 GiB (la cuenta de abajo).

### La memoria del pod en el peor momento

Con los dos topes se puede calcular cuánta memoria pide una copia en el peor momento posible: el tope lleno de bodies grandes y los dos decodes con fotos de 40 MP.

:::formula Memoria de una copia en el peor momento
M = M_0 + I × F + k × D
u = frac{M}{M_{lim}}
- M: la memoria de la copia en el peor momento, en MB
- M_0: lo que ocupa sin trabajar: Python, FastAPI, Pillow y el cliente, en MB
- I: el tope de requests en vuelo, en requests
- F: el body más grande que se acepta, en MB
- k: los decodes que corren a la vez, los lugares del semáforo, en decodes (no es el `top_k` del contrato)
- D: la memoria de un decode en su peor momento, en MB
- M_{lim}: el límite de memoria de la copia, en MB
- u: la fracción del límite que se usa
:::

:::cuenta El peor momento de una copia del gateway
Base, \(M_0\) // medida por el equipo de Alba | — | ≈ 80 MB
Bodies en vuelo, \(I × F\) // el tope de 16, con fotos de 10 MB | 16 × 10 MB | 160 MB
Decodes, \(k × D\) // el semáforo de 2, con PNG de 40 MP | 2 × 320 MB | 640 MB
Peor momento, \(M\) | 80 + 160 + 640 | 880 MB
Límite, \(M_{lim}\) // 1 GiB = 1,073,741,824 B | 1,073,741,824 ÷ 1,000,000 | ≈ 1,074 MB
Fracción, \(u = M ÷ M_{lim}\) | 880 ÷ 1,074 | ≈ 82 %
= En el peor momento la copia usa ≈ 82 % de su GiB. Sobran ≈ 190 MB para lo que no se midió. Con \(k\) = 4 decodes serían 80 + 160 + 1,280 = 1,520 MB: más que el límite, y Kubernetes mataría el proceso por falta de memoria ([[oom|OOM]]).
:::

Fíjate en qué término domina: \(k × D\), 640 de 880 MB. Por eso subir el semáforo es la decisión cara: cada lugar más son 320 MB. Para \(k\) = 4 habría que pedir 2 GiB por copia, y con los 40 hilos del pool, 40 × 320 MB ≈ 13 GB, no alcanzaría ninguna copia razonable (es la cuenta de «Ataques y cadena de suministro»).

:::calculadora e06-serving-memoria
Empieza con la copia de Alba. Sube \(k\) a 3: \(u\) pasa del 100 % y el pod moriría por OOM en la peor ráfaga. Regrésalo a 2 y sube \(F\) a 25 MB: los 16 bodies en vuelo ya pesan 400 MB, más que un decode entero.
:::

## La llamada a Triton, con plazo {The call to Triton, with a deadline}

La foto de Ana ya es un [[tensor]] de 3 × 224 × 224 = 150,528 números FP32, de 4 B cada uno: 602,112 B. Falta mandárselo a Triton.

### El cliente: uno por proceso

El [[cliente-triton|cliente de Triton]] es la biblioteca `tritonclient`, en su versión asíncrona para HTTP. El gateway crea **uno** en el lifespan y lo reusa en cada request. Adentro tiene un pool de hasta 64 conexiones abiertas con [[keep-alive]], así que, pasadas las primeras, casi ninguna request paga abrir una conexión nueva.

:::profundo ¿Alcanzan 64 conexiones?
¿Alcanzan 64? Con la Ley de Little: llamadas abiertas = llamadas por segundo × lo que dura cada una. En el pico, 500 por segundo × ≈ 10 ms = 5 llamadas abiertas en todo el gateway. Si Triton se traba y cada llamada dura su tope de 150 ms: 500 × 0.15 = 75, ≈ 15 por copia con 5 copias. Caben de sobra en 64.
:::

### La extensión binaria

El cuerpo de la llamada sigue el [[protocolo-inferencia|protocolo de inferencia v2]] de «APIs: REST, JSON, gRPC y streaming», con la [[extension-binaria|extensión binaria]] de Triton: un JSON corto que dice el nombre, la forma y el tipo del tensor, y detrás los 602,112 bytes crudos. Un header, `Inference-Header-Content-Length`, dice dónde termina el JSON. Con los 150,528 números escritos en JSON, a ≈ 20 B cada uno con sus cifras y su coma, serían ≈ 3.07 MB, 5 veces más, y se gastaría CPU en escribirlos y leerlos.

:::profundo Por qué HTTP y no gRPC: el problema con el reparto
¿Por qué HTTP y no [[grpc|gRPC]]? Dentro del clúster la diferencia de velocidad es chica, y HTTP se prueba con `curl`, el programa de terminal que hace requests a mano.

gRPC usa una sola conexión larga para muchas llamadas, y el [[service-k8s|Service de Kubernetes]] reparte **conexiones**, no llamadas: todas las llamadas de un gateway acabarían en la misma Triton. Con una T4 por zona da igual, pero cuando el [[autoscaling|autoscaler]] (el programa que agrega copias cuando sube el tráfico) agrega otra en la misma zona, el reparto entre ellas quedaría disparejo: cada gateway carga entera a la que le tocó, y la nueva puede quedarse casi ociosa.
:::

### El plazo: nunca más de lo que queda

La app espera 300 ms. El gateway se da 250 ms en total para cada request (`REQUEST_DEADLINE_S`), y a la llamada a Triton le da 150 ms (`INFER_TIMEOUT_S`). Adentro, Triton tira lo que lleve 100 ms en su fila. Cada eslabón es menor que el de afuera, para que el de adentro se rinda primero y el de afuera aún pueda responder: es la cadena de [[deadline|deadlines]] de «Timeouts, reintentos e idempotencia».

En el código, la regla es una sola: la llamada a Triton recibe **lo menor** entre su tope y lo que le queda a la request.

:::formula Plazo de la llamada a Triton
R = P − g
T_e = min(T, R)
- P: el plazo total del gateway para la request: 250 ms
- g: lo que la request ya gastó al llegar a la llamada, en ms: \(g = g_s + g_c + g_p\), subir el body (\(g_s\)), esperar lugar de CPU (\(g_c\)) y decodificar (\(g_p\))
- R: lo que le queda a la request, en ms
- T: el tope propio de la llamada a Triton: 150 ms
- T_e: el plazo que de verdad recibe la llamada, en ms; si \(R\) ya es 0 o menos, no se llama a Triton y la request sale con 504
- t_{Tr}: lo que tarda Triton de verdad, en ms: si pasa de \(T_e\), la llamada se corta y la request sale con 504
:::

:::cuenta Dos requests en la misma copia
Ana: gastado, \(g\) // subir 3 ms + esperar lugar 0 + decodificar 6 | 3 + 0 + 6 | 9 ms
Ana: queda, \(R = P − g\) | 250 − 9 | 241 ms
Ana: plazo de Triton, \(T_e = min(T, R)\) | min(150, 241) | 150 ms
Ana: Triton tarda, \(t_{Tr}\) // ida 3 + fila 2 + GPU 4 + vuelta 1; cabe en los 150 de \(T_e\) | 3 + 2 + 4 + 1 | 10 ms → 200
Ana: total // gastado \(g\) + Triton \(t_{Tr}\) + responder 1 | 9 + 10 + 1 | 20 ms
Subida lenta: gastado, \(g\) // una red celular mala tarda 200 ms en subir la foto | 200 + 0 + 6 | 206 ms
Subida lenta: plazo de Triton, \(T_e\) | min(150, 250 − 206) = min(150, 44) | 44 ms
Subida lenta, Triton trabado // \(t_{Tr}\) > 44: la llamada se corta a los 44 ms | \(g + T_e\) = 206 + 44 | 504 a los 250 ms
= A Ana le sobra plazo. La de la subida lenta recibe solo 44 ms: si Triton responde en 10, sale bien; si Triton está trabado, recibe 504 a los 250 ms, a tiempo para que la app la vea antes de sus 300 ms. Con un tope fijo de 150 ms habría esperado hasta los 356 ms, cuando la app ya se había rendido.
:::

:::figura e06-serving-plazos
Los cuatro plazos, uno dentro del otro: 300, 250, 150 y 100 ms. Abajo, la foto de Ana usa 20 ms; la de la subida lenta llega a Triton con solo 44 ms de plazo.
:::

:::calculadora e06-serving-plazo
Empieza con la request de Ana. Sube la subida, \(g_s\), a 200 ms: \(R\) baja a 44 y \(T_e\) ya no es 150. Luego sube lo que tarda Triton, \(t_{Tr}\), a 60 ms: el margen se vuelve negativo y esa request sale con 504.
:::

### Qué hace el gateway con cada falla de Triton

| Lo que pasa | Lo que ve el código | Lo que contesta |
|---|---|---|
| Triton no contesta a tiempo | `TimeoutError` del plazo | **504** |
| No hay conexión con Triton | `aiohttp.ClientError` (de aiohttp, la biblioteca de HTTP que el cliente usa por dentro) | **503** + `Retry-After: 1` |
| Triton contesta con error, o su fila rechazó la foto | `InferenceServerException` | **503** |

:::profundo El `timeout` de `infer()` no es el plazo
El plazo se pone con `asyncio.wait_for` alrededor de la llamada, y no con el parámetro `timeout` de `infer()`. Ese parámetro **no es un plazo del cliente**: son microsegundos que se le mandan a Triton para su fila. Si solo se usara ese, una red cortada dejaría la llamada esperando hasta el tope general del cliente, 60 s por omisión.
:::

**Sin reintentos.** Un segundo intento tardaría otros ≈ 80 ms en el caso malo, según estima el equipo de Alba, y con la GPU sobrecargada sumaría trabajo justo cuando ya sobra, como la [[tormenta-reintentos|tormenta de reintentos]] de «Timeouts, reintentos e idempotencia». La app ya tiene su plan B: el selector manual.

## La respuesta, el log y el código de cada falla {The response, the log and the code for each failure}

Triton devuelve 500 logits. El gateway los convierte en la respuesta.

### Softmax, top-k y una guardia

Tres pasos: el [[softmax]] convierte los logits en probabilidades, el [[top-k]] se queda con las `top_k` más altas, y `labels.json` les pone nombre. El softmax se calcula **estable**: antes de sacar la exponencial, a todos los logits se les resta el más grande. El resultado es el mismo y ninguna exponencial se desborda (se pasa del número más grande que la computadora puede guardar).

Y una guardia: si algún logit no es un número finito (`NaN`, «no es un número», lo que sale de cuentas como 0 ÷ 0, o infinito; por ejemplo con un engine roto), el gateway responde **500** y lo anota. Sin la guardia, el error saldría al convertir la respuesta en JSON, **después** de escribir el log: el log diría 200 y la app vería un 500.

:::profundo Verlo en Python: el softmax estable y la guardia
El programa de abajo lo hace con 6 categorías de juguete en vez de 500; los logits los elegimos para que salga el 94 % de Ana:

```python
import json, math

labels = ["Calzado › Tenis", "Calzado › Zapatos de vestir", "Calzado › Botas",
          "Calzado › Sandalias", "Bolsas › Mochilas", "Accesorios › Gorras"]

def responder(logits, top_k):
    if not all(math.isfinite(z) for z in logits):
        return 500, {"error": "logits no finitos"}          # nunca un 200 con basura
    m = max(logits)
    e = [math.exp(z - m) for z in logits]                    # restar el máximo: nada se desborda
    p = [x / sum(e) for x in e]
    orden = sorted(range(len(p)), key=lambda i: p[i], reverse=True)[:top_k]
    return 200, {"model_version": "resnet50-2026-10-01",
                 "predictions": [{"label": labels[i], "score": round(p[i], 4)} for i in orden]}

ana = [9.0, 5.6, 5.1, 4.4, 2.0, 1.5]
for logits, k in [(ana, 3), ([z + 1000 for z in ana], 1), ([float("nan")] + ana[1:], 3)]:
    codigo, cuerpo = responder(logits, k)
    print(codigo, json.dumps(cuerpo, ensure_ascii=False))
try:
    math.exp(1009.0)
except OverflowError as err:
    print("sin restar el máximo:", err)
```

```salida
200 {"model_version": "resnet50-2026-10-01", "predictions": [{"label": "Calzado › Tenis", "score": 0.9389}, {"label": "Calzado › Zapatos de vestir", "score": 0.0313}, {"label": "Calzado › Botas", "score": 0.019}]}
200 {"model_version": "resnet50-2026-10-01", "predictions": [{"label": "Calzado › Tenis", "score": 0.9389}]}
500 {"error": "logits no finitos"}
sin restar el máximo: math range error
```

Sumarle 1,000 a todos los logits no cambia nada: el softmax solo mira las diferencias. Pero sin restar el máximo, \(e^{1009}\) no cabe en un número de 64 bits ([[dtype]] `float64`, el de Python) y el programa truena.
:::

La respuesta de verdad trae tres campos: `model_version` (qué modelo contestó), `predictions` (las `top_k` con su `label` y su `score`, con 4 decimales) y `latency_ms`. Y el header `X-Request-ID`, en cada respuesta, también en los errores. Se versiona el contrato (`/v1`), no el modelo: cambiar de modelo no cambia la ruta, pero cada respuesta dice cuál contestó.

### Una línea de log por request

Al final de `classify`, en un bloque `finally` que corre pase lo que pase, el gateway escribe **una línea de JSON** en la [[flujos-estandar|salida estándar]] (*stdout*, la salida de texto del programa, la que verías en la terminal). Otro programa la recoge y la guarda. Es un [[log-estructurado|log estructurado]]: un registro por request con campos fijos, que una máquina puede filtrar y contar sin adivinar el formato. Es la misma línea de [[json-lines|JSON Lines]] que viste en «Archivos y formatos: JSON, CSV, Parquet y YAML». Esta es la de Ana, como **ilustración**, partida para que se lea (en el log va en una sola línea; los números de categoría y el hash son de juguete):

```json
{"request_id": "5a1e07c3", "caller": "backend-publicaciones", "source": "mobile",
 "model_version": "resnet50-2026-10-01",
 "top5": [[17, 0.94], [41, 0.03], [12, 0.02], [63, 0.01], [205, 0.0]],
 "ms": {"pre": 6, "triton": 10, "post": 1, "total": 20},
 "bytes": 214836, "sha256": "3b7e0c51a9d2", "status": 200}
```

Campo por campo: quién llamó (`caller`, el `client_id` del token) y de dónde dice venir (`source`); la versión del modelo; las cinco categorías más probables, con su número en `labels.json` y su score; los milisegundos de cada paso (el `total` incluye los 3 ms de subida); el tamaño, el principio de la huella SHA-256 y el código HTTP. Las líneas de error llevan además `error`.

Son ≈ 300 B por línea: 285 B sin `source` y unos 20 B más con él. No lleva la foto, ni su [[exif|EXIF]], ni el id de la vendedora: solo los primeros 12 caracteres de la huella de la foto, que sirven para encontrarla si hace falta. De este log sale lo que la estación 1, «Datos y etiquetas», convierte en etiquetas: el `request_id` es la [[log-prediccion|llave de unión]] con la publicación.

:::profundo Las métricas, un contrato con las alertas
Además del log, el gateway lleva contadores que Prometheus, el programa que junta los números de los servicios de Alba, lee en `/metrics`: las requests por código, fuente y versión del modelo (`classifier_requests_total`), [[histograma|histogramas]] de latencia total, de preproceso y de inferencia, el del score top-1 (la probabilidad de la primera sugerencia, para avisar si el modelo duda demasiado) y el del tamaño de la foto.

Dos reglas. Los nombres no se cambian, porque las alertas los buscan por nombre: renombrar una métrica apaga una alerta sin que nadie se entere. Y los 4xx **no entran** al histograma de latencia: un 415 tarda microsegundos, y contarlo bajaría el [[p99]] sin que nadie respondiera más rápido.
:::

### El código de cada falla

Con todo junto, cada falla tiene su código. Los 4xx (los códigos que empiezan con 4) son culpa de quien llama y no cuentan contra la promesa de Alba, su [[slo|SLO]] de 99.9 % de requests sin error; los 5xx son de Alba y sí cuentan:

| Lo que pasó | Código | Quién lo decide |
|---|---|---|
| Foto de Ana, todo bien | **200** | `classify` |
| Foto vacía, corrupta, cortada o más alargada que 1:8 | **400** | `classify` |
| Método equivocado, como `GET /v1/classify` | **405** | FastAPI |
| Más de 10 MB o más de 40 MP | **413** | `classify` |
| No es JPEG, PNG ni WebP | **415** | `classify` |
| `top_k` fuera de 1 a 20 | **422** | FastAPI, antes de `classify` |
| La app cerró la conexión a media subida | **499** | `classify` |
| Logits no finitos o un error del propio código | **500** | `classify` |
| La 17 en vuelo, sin lugar de CPU en 50 ms, o Triton caído | **503** | `classify` |
| Triton no contestó a tiempo, o se acabó el plazo de 250 ms | **504** | `classify` |

Dos filas necesitan un [[manejador-errores|manejador de errores]], una función que FastAPI llama cuando algo falla antes o fuera de la ruta. El **422** ocurre antes de `classify`: sin un manejador propio, no dejaría línea de log ni métrica, y un *caller* (un programa que llama al gateway) mandando `top_k=50` sería invisible. El **499** no es un código del estándar HTTP: lo inventó nginx, un servidor web muy usado, para «el cliente se fue», y el gateway lo copia para que una subida cortada no se cuente como 5xx ni dispare la alerta de errores.

:::profundo Lo que pone el ALB y no ve el gateway
Antes del gateway hay otros que contestan. El ALB pone 401 si no hay token válido y 400 si los headers pasan de 64 KB. El gateway pone 403 si el token no trae permiso para clasificar, y 429 con `Retry-After` cuando un caller pasa su cuota (lo cuenta «Autenticación y permisos»). Ninguno de los del ALB llega a `classifier_requests_total`.
:::

## El model repository y el config.pbtxt, campo por campo {The model repository and config.pbtxt, field by field}

Del otro lado de la llamada, Triton tiene que saber qué modelo cargar y cómo atenderlo.

### La carpeta

El [[model-repository|model repository]] es una carpeta con una subcarpeta por modelo. La de Alba tiene uno, `classifier`:

- `classifier/config.pbtxt`: la configuración del modelo.
- `classifier/1/model.plan`: el engine. El `1` es la versión dentro de Triton, no la del [[registro-modelos|registro de modelos]]: la versión de verdad, `resnet50-2026-10-01`, es el tag (la etiqueta con que se nombra) de la imagen de contenedor.

Triton arranca con `--model-control-mode=none`: carga lo que hay en la carpeta al arrancar y no deja cargar ni quitar modelos con el servidor andando. Para cambiar de modelo se cambia la imagen completa. Es lo que permite saber, en todo momento, qué modelo corre.

### El config.pbtxt

El [[config-pbtxt|`config.pbtxt`]] está escrito en el formato de texto de [[protobuf]]. Este es el de Alba, como **ilustración**:

```text
name: "classifier"
platform: "tensorrt_plan"
max_batch_size: 32
version_policy: { latest { num_versions: 1 } }
input  [ { name: "input"  data_type: TYPE_FP32 dims: [ 3, 224, 224 ] } ]
output [ { name: "logits" data_type: TYPE_FP32 dims: [ 500 ] } ]
dynamic_batching {
  preferred_batch_size: [ 16, 32 ]
  max_queue_delay_microseconds: 2000
  default_queue_policy { timeout_action: REJECT  default_timeout_microseconds: 100000 }
}
instance_group [ { count: 2  kind: KIND_GPU } ]
model_warmup [ { name: "ceros"  batch_size: 32  count: 3
  inputs { key: "input"  value: { data_type: TYPE_FP32  dims: [ 3, 224, 224 ]  zero_data: true } } } ]
```

Campo por campo:

- **`platform: "tensorrt_plan"`**: el motor que corre el archivo.
- **`max_batch_size: 32`**: el batch más grande que Triton arma. No puede pasar del máximo con que se compiló el engine, que también es 32.
- **`dims`** va **sin** el eje del batch: Triton le antepone un `-1` (cualquier tamaño hasta 32). La entrada real es `[-1, 3, 224, 224]`, la del contrato de la estación 5.
- **`version_policy`**: sirve solo la versión más nueva de la carpeta.

:::profundo Los flags con que arranca Triton
Triton arranca con `tritonserver --model-repository=/models --model-control-mode=none` y cuatro flags más, escritos explícitos para que nadie dependa de un valor por omisión que cambie entre versiones. `--disable-auto-complete-config`: no rellena lo que falte en el `config.pbtxt` leyendo el engine. Si al archivo le falta un campo, el modelo no carga, en vez de que Triton lo adivine. `--exit-on-error=true`: si un modelo no carga, Triton termina con error en vez de quedarse prendido sin modelo; Kubernetes lo reintenta y el despliegue nuevo se detiene. `--strict-readiness=true`: Triton dice «listo» solo si todos sus modelos lo están; es la pregunta que hace el `/readyz` del gateway. `--exit-timeout-secs=30`: al apagarse, les da hasta 30 s a las inferencias en curso. Dónde se escriben estos flags (el comando de arranque de la imagen) lo cuenta «Empaquetado con Docker».
:::

### El batching: 2 ms de espera

`max_queue_delay_microseconds: 2000` es el [[batching-dinamico|batching dinámico]] de «Qué tan rápido y cuánto: latencia y throughput»: cuando llega una foto, Triton espera **hasta 2 ms** a que lleguen otras para correrlas juntas.

:::profundo Los tamaños preferidos, 16 y 32
`preferred_batch_size` le dice a Triton qué tamaños prefiere armar, 16 o 32: si junta uno, lo corre en ese momento; si no los junta en 2 ms, corre lo que tenga. La documentación de Triton aconseja no ponerlo salvo que esos tamaños rindan bastante más. Alba lo deja porque no estorba: con su tráfico casi nunca se alcanzan, como muestra la cuenta de abajo.
:::

¿Cuánto junta en 2 ms con el tráfico de Alba? Si las fotos llegan al azar y la primera abre la ventana, las que llegan dentro de la ventana son, en promedio, las llegadas por segundo por lo que dura la ventana. El batch es la primera más esas.

:::formula Batch promedio con una ventana de espera
n_b = 1 + λ_{Tr} × v
- n_b: las fotos de un batch, en promedio
- λ_{Tr}: las fotos por segundo que llegan a una Triton
- v: lo que dura la ventana de espera, en s
:::

:::cuenta Lo que junta una T4 en 2 ms
Llegadas, \(λ_{Tr}\) // 500 por segundo en el pico de diseño, entre 2 Triton | 500 ÷ 2 | 250 por s
Ventana, \(v\) // 2,000 µs | 2,000 ÷ 1,000,000 | 0.002 s
Fotos extra en la ventana, \(λ_{Tr} × v\) | 250 × 0.002 | 0.5
Batch promedio, \(n_b\) | 1 + 0.5 | 1.5 fotos
Con una zona caída, \(λ_{Tr}\) // las 500 a una sola Triton | 1 + 500 × 0.002 | 2 fotos
Para llenar un batch de 16 en la ventana // despeja \(λ_{Tr}\) de \(n_b\) = 16 | (16 − 1) ÷ 0.002 | 7,500 por s
= Con el tráfico de Alba el batch promedio es 1.5 fotos; con una zona caída, 2. Para llenar 16 en 2 ms harían falta 7,500 fotos por segundo a una sola T4, más de 6 veces las ≈ 1,200 por segundo que una T4 procesa como máximo, según midió el equipo de Alba. El tamaño preferido casi nunca se alcanza, y está bien: la ventana cuesta solo 2 ms.
:::

:::profundo Verlo simulado: un minuto de llegadas al azar
La fórmula supone que las fotos llegan al azar y que la primera abre la ventana. El programa de abajo lo simula: llegadas al azar durante un minuto, con [[semilla]] fija, y una ventana de 2 ms que abre cada foto que encuentra la fila vacía.

```python
import random
from collections import Counter

def batches(tasa, ventana=0.002, segundos=60, maximo=32, semilla=7):
    rng, t, llegadas = random.Random(semilla), 0.0, []
    while t < segundos:
        t += rng.expovariate(tasa)                 # llegadas al azar (Poisson)
        llegadas.append(t)
    tamanos, i = [], 0
    while i < len(llegadas):
        j = i
        while j < len(llegadas) and llegadas[j] <= llegadas[i] + ventana and j - i < maximo:
            j += 1                                   # entra todo lo que llega en 2 ms
        tamanos.append(j - i)
        i = j
    return tamanos

for tasa in (250, 500):
    b = batches(tasa)
    c = Counter(b)
    print(f"{tasa} por s: promedio {sum(b) / len(b):.2f} · de 1: {c[1] / len(b):.0%} · "
          f"de 2: {c[2] / len(b):.0%} · el más grande: {max(b)}")
```

```salida
250 por s: promedio 1.51 · de 1: 60% · de 2: 31% · el más grande: 6
500 por s: promedio 2.01 · de 1: 36% · de 2: 37% · el más grande: 7
```

El promedio coincide con la fórmula: 1.51 contra 1.5, y 2.01 contra 2. La simulación no toma en cuenta que la GPU tarda ≈ 4 ms en cada batch; con las 2 copias del modelo, casi siempre hay una libre.
:::

:::figura e06-serving-ventana
Veinte milisegundos de una T4 cerca del pico de diseño: seis fotos que llegan al azar. Cada una que encuentra la fila vacía abre una ventana de 2 ms; dos de las cuatro ventanas atrapan a una segunda foto. Son 6 fotos en 4 batches, 1.5 en promedio, repartidos entre las 2 copias del modelo.
:::

### La fila: rechazar a los 100 ms

`default_queue_policy` es la [[politica-cola|política de la fila]]: si una foto lleva **100 ms** esperando en la fila de Triton sin entrar a la GPU, Triton la saca y contesta con error (`REJECT`). El gateway lo traduce en 503. Es el último eslabón de la cadena: 300 > 250 > 150 > 100.

Parece cruel y es diseño. Una foto que esperó 100 ms en la fila ya gastó buena parte de los 150 de la llamada; correrla gastaría GPU en una respuesta que llegaría tarde. Bajo sobrecarga, Alba prefiere 503 rápidos y el selector manual a una fila que crece y hace lentas a todas.

### Dos copias del modelo en la misma GPU

`instance_group [ { count: 2 kind: KIND_GPU } ]` es el [[instance-group|grupo de instancias]]: Triton carga **2 copias** del engine en la misma T4. Mientras una corre un batch, la otra puede ir recibiendo los datos del siguiente, y la GPU no se queda esperando. Caben de sobra: dos engines de ≈ 50 a 150 MB en 16 GB de memoria de la GPU.

### El warmup

`model_warmup` corre el modelo **3 veces con un batch de 32 fotos en ceros**, en cada una de sus 2 copias, antes de que Triton diga «listo». Es el [[warmup-inferencia|warmup de inferencia]] de «PyTorch en lo que toca a producción»: las primeras corridas pagan una preparación que no se repite (reservar memoria y cargar código en la GPU), y es mejor pagarla antes de atender que en la foto de Ana. Cargar el engine y correr el warmup tarda ≈ 10 a 60 s desde que arranca el contenedor.

## Probarlo sin GPU, y cuándo no hace falta Triton {Testing without a GPU, and when you don't need Triton} [extra]

### Las 26 pruebas y el Triton falso

El gateway tiene **26 pruebas** con [[pytest]] que corren en ≈ 2 minutos en cualquier máquina, sin GPU. El truco es un **Triton falso**: un [[mock]] que tiene los mismos métodos asíncronos y lanza las mismas excepciones que el cliente real, pero contesta lo que la prueba le pida. Además revisa el nombre, el tipo y la forma del tensor que le mandarían a Triton: si alguien cambia el preproceso y sale `[1, 224, 224, 3]` (los colores al final) en vez de `[1, 3, 224, 224]` (los colores primero), la prueba falla.

Las pruebas siguen la tabla de códigos: 200 con varios `top_k` y formatos, el `request_id`, 415, 413 por bytes, sin `Content-Length` y por píxeles, 400 por forma, archivo corrupto, cortado y vacío, 422, 499, 500 con logits NaN, 503 con Triton caído, con error de Triton y con sobrecarga, 504 con Triton lento y con el plazo total, y las tres rutas de salud y métricas. La del 499 llama a la aplicación ASGI directamente, porque el cliente de pruebas de FastAPI siempre entrega el body completo y no sabe cortar una subida a la mitad.

El programa de abajo es la misma idea en miniatura, con la biblioteca estándar: una copia del gateway con sus dos topes y su plazo, y tres Tritons falsos. Aquí el decode es una espera de 6 ms, no trabajo de CPU, así que solo sirve para ver los códigos:

```python
import asyncio
from collections import Counter

async def classify(pod, t_subida, triton):
    if pod["en_vuelo"] >= 16:
        return 503                                   # la 17: rechazo al instante
    pod["en_vuelo"] += 1
    reloj = asyncio.get_running_loop().time
    inicio = reloj()
    try:
        await asyncio.sleep(t_subida)                # llegan los bytes del body
        try:
            await asyncio.wait_for(pod["cpu"].acquire(), 0.05)
        except TimeoutError:
            return 503                               # 50 ms sin lugar de CPU
        await asyncio.sleep(0.006)                   # el decode (de juguete: solo espera)
        pod["cpu"].release()
        resto = 0.25 - (reloj() - inicio)            # lo que queda del plazo de 250 ms
        try:
            await asyncio.wait_for(triton(), min(0.15, resto))
        except TimeoutError:
            return 504
        except ConnectionError:
            return 503
        return 200
    finally:
        pod["en_vuelo"] -= 1

async def sano():    await asyncio.sleep(0.010)
async def trabado(): await asyncio.sleep(0.300)
async def caido():   raise ConnectionError

async def probar(n, t_subida, triton):
    pod = {"en_vuelo": 0, "cpu": asyncio.Semaphore(2)}
    return Counter(await asyncio.gather(*(classify(pod, t_subida, triton) for _ in range(n))))

for nombre, args in [("20 a la vez", (20, 0.003, sano)), ("Triton trabado", (5, 0.003, trabado)),
                     ("Triton caído", (5, 0.003, caido)), ("subida de 240 ms", (1, 0.240, sano))]:
    print(f"{nombre:<17}", dict(sorted(asyncio.run(probar(*args)).items())))
```

```salida
20 a la vez       {200: 16, 503: 4}
Triton trabado    {504: 5}
Triton caído      {503: 5}
subida de 240 ms  {504: 1}
```

De 20 a la vez, entran 16 y las 4 sobrantes reciben 503 sin esperar. Las 16 caben en el semáforo de 2: 8 turnos de 6 ms son 48 ms, y la última espera ≈ 42 ms, menos que los 50. Con Triton trabado, todas salen con 504 a los ≈ 150 ms. La de la subida de 240 ms llega a Triton con ≈ 4 ms de plazo y sale con 504, aunque Triton esté sano.

:::profundo ¿Y si Triton hiciera también el preproceso?
Triton puede encadenar modelos: un *ensemble* corre un paso de preproceso y después la red, todo adentro del servidor, y su backend de Python (llamado BLS cuando un modelo llama a otros) deja escribir lógica propia. Así el gateway mandaría el JPEG de ≈ 200 KB en vez del tensor de 602 KB, y la red bajaría a un tercio. Alba no lo hace por tres razones. El decode es trabajo de CPU, ≈ 3 vCPU en el pico, y en el pod de la GPU competiría con la máquina cara. Los bytes hostiles llegarían al proceso que tiene la GPU. Y cambiar el preproceso obligaría a reconstruir la imagen de ≈ 9 GB. Se volvería a pensar si la red entre zonas costara más que esas tres cosas juntas.
:::

### Cuándo no hace falta Triton

El gateway de Alba no empezó así. La primera versión era **un solo proceso de FastAPI con el modelo de PyTorch adentro**, en una máquina con GPU, que atendía a ≈ 35 fotos por segundo para una parte de los vendedores. Se rompió primero por throughput (cada foto corría sola en la GPU, sin batches) y después por los despliegues: cada cambio de código reiniciaba el proceso y recargaba el modelo. Ahí la inferencia se fue a Triton y FastAPI se quedó de gateway.

Triton no siempre vale lo que cuesta. Un modelo chico en CPU a unas decenas de requests por segundo cabe en el mismo proceso que la API. Un [[llm|LLM]] (modelo grande de lenguaje), que genera texto palabra por palabra, se sirve mejor con servidores hechos para eso, como vLLM. Y un servidor que nadie del equipo sabe depurar a las 3 de la mañana es un riesgo, no una mejora. Hay también frameworks como Ray Serve o BentoML, donde el batching se activa en tu propio código de Python con un decorador; Alba no los usa.

## Errores comunes {Common mistakes}

**Decodificar dentro de `async def` sin mandarlo a un hilo.** El event loop se congela mientras dura el decode y el p99 sube con la concurrencia sin que la CPU esté llena. *Cómo evitarlo:* `await run_in_threadpool(...)` dentro del semáforo, y un histograma aparte para el preproceso.

**Escalar con `uvicorn --workers 4`.** Cuatro procesos esconden cuánta CPU usa cada uno, multiplican la memoria y complican las métricas. Si el modelo estuviera adentro, serían cuatro copias en la GPU sin batches entre ellas. *Cómo evitarlo:* un proceso por copia y más copias.

**Confundir los dos batchings.** Juntar fotos en el gateway antes de mandarlas agrega espera y no ayuda: Triton ya junta las de todos los gateways. *Cómo evitarlo:* una foto por llamada, y el batching solo en el `config.pbtxt`.

**Creer que el `timeout` de `infer()` es el plazo de la llamada.** Son microsegundos para la fila de Triton. *Cómo evitarlo:* `asyncio.wait_for(..., min(T, R))` alrededor de la llamada.

**Poner a Triton en el `/healthz`.** Una caída de Triton reinicia todos los gateways sanos, y al volver arrancan todos juntos. *Cómo evitarlo:* `/healthz` sin dependencias; Triton solo en `/readyz`.

**Dejar que el error salga después del log.** Con logits NaN, la respuesta truena al convertirse en JSON, después del `finally`: el log dice 200 y la app ve 500. *Cómo evitarlo:* la guardia de números finitos antes de armar la respuesta.

**Contar los 4xx en el histograma de latencia.** Un 415 tarda microsegundos y baja el p99 sin que nadie responda más rápido. *Cómo evitarlo:* el histograma solo con lo que de verdad pasó por el modelo.

## En la vida real {In real life} [extra]

**En Alba.** La foto de Ana cruza el código en ≈ 20 ms: 3 de subida, 6 de decode, 10 de Triton y 1 de respuesta. El trabajo del gateway no es ese camino, que casi siempre sale bien, sino los demás: la foto de 48 MP que se rechaza leyendo un encabezado, la ráfaga que choca con el tope de 16, la GPU trabada que se convierte en un 504 a tiempo. Todo cabe en un archivo de unos cientos de líneas y en 26 pruebas.

**Moderación de publicaciones**, otro sistema de Alba, valida su configuración al arrancar: con una inválida, el proceso termina antes de servir y Kubernetes no sigue con el despliegue. Es la misma idea del lifespan: mejor no arrancar que arrancar mal.

**Un LLM propio.** Cargar un modelo de 70 GB tarda minutos, así que su servidor tiene un periodo de arranque de hasta 15 minutos antes de que nadie pregunte si está vivo, y una revisión de vida muy tolerante: reiniciar cuesta minutos de GPU cara. Los números son un supuesto del ejemplo.

**Fraude con un almacén de features.** Un servicio que lee datos de un [[redis|Redis]] (una base de datos en memoria, muy rápida) no pone a Redis en su revisión de «listo», su `/readyz`: si Redis cae, sacaría a todas las copias y perdería también su plan B (responder con reglas simples). Es el mismo error del `/healthz` de Alba, una capa más afuera.

**Búsqueda por similitud**, también de Alba, le pide a este mismo gateway la categoría de las fotos que indexa. Es un caller más, con su `client_id` y su cuota: si un día manda ráfagas de miles de fotos, el tope de 16 en vuelo protege a cada copia, y la cuota por caller protege a los demás callers. Sin cuota, una reindexación nocturna podría llenar los topes y dejar a las vendedoras con 503.

**Fuera de ML.** Un servidor de pagos hace lo mismo con otros nombres: revisa la tarjeta antes de llamar al banco, pone un plazo a cada llamada, rechaza cuando está lleno y anota cada intento con un id.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(M\), \(M_0\), \(I\), \(F\), \(k\), \(D\), \(M_{lim}\), \(u\) (memoria); \(P\), \(g\), \(R\), \(T\), \(T_e\) (plazo); \(n_b\), \(λ_{Tr}\), \(v\) (batching).

:::ejercicios
? [facil] Llegan tres requests: (a) un `Content-Type: image/gif` de 50 KB; (b) un JPEG con `Content-Length` de 11,000,000; (c) un PNG de 3 MB y 9,000 × 6,000 píxeles. ¿Qué código recibe cada una y en qué paso de la revisión se detiene?
- (a) GIF no está en la lista: **415** en el paso 1, sin leer nada más.
- (b) 11,000,000 B > 10,485,760 B: **413** en el paso 2, por el header, sin leer el body.
- (c) 9,000 × 6,000 = 54,000,000 píxeles > 40,000,000: **413** en el paso 5, con solo leer el encabezado. Sus 3 MB pasan los pasos 2 y 3.
? [facil] Una copia del gateway tiene 16 requests en vuelo y llega otra. ¿Qué recibe, cuánto tarda en recibirlo y por qué no la ponen a esperar?
- Recibe **503** con `Retry-After: 1`, al instante: el rechazo se decide con un contador, antes de leer el body. Cuesta microsegundos.
- Ponerla a esperar llenaría memoria (hasta 10 MB de body cada una) y produciría respuestas que llegarían después de los 300 ms de la app, cuando ya mostró el selector manual.
? [facil] Con la ecuación del plazo, la request de Beto gasta 30 ms en subir, 10 ms en esperar lugar de CPU y 8 ms en decodificar. ¿Qué plazo recibe su llamada a Triton?
- \(g = g_s + g_c + g_p\) = 30 + 10 + 8 = **48 ms**.
- \(R = P − g\) = 250 − 48 = **202 ms**.
- \(T_e = min(T, R)\) = min(150, 202) = **150 ms**. Le queda más que el tope, así que recibe el tope.
? [medio] Con la fórmula de la memoria, alguien propone subir el body máximo \(F\) a 20 MB «para fotos profesionales», sin tocar lo demás. ¿Cuánto da \(M\) y \(u\)? ¿Qué cambiarías para que quepa en 1 GiB con al menos 10 % libre?
- \(M = M_0 + I × F + k × D\) = 80 + 16 × 20 + 2 × 320 = 80 + 320 + 640 = **1,040 MB**.
- \(u\) = 1,040 ÷ 1,074 ≈ **97 %**. Cabe, pero sin margen para lo que no se midió.
- Con 10 % libre, \(M\) ≤ 0.9 × 1,074 ≈ 966 MB. Bajar \(I\) a 12: 80 + 12 × 20 + 640 = **960 MB** ≈ 89 %. O dejar \(F\) en 10 MB y pedir que la app reduzca la foto antes de subirla, que es lo que hace hoy (≈ 200 KB).
? [medio] Una request tarda 120 ms en subir su foto, espera 40 ms un lugar de CPU y decodifica en 50 ms. Triton está lento y tarda 70 ms (\(t_{Tr}\)). ¿Qué plazo recibe la llamada, qué código sale y a los cuántos milisegundos?
- \(g = g_s + g_c + g_p\) = 120 + 40 + 50 = **210 ms**. \(R = P − g\) = 250 − 210 = **40 ms**.
- \(T_e = min(T, R)\) = min(150, 40) = **40 ms**. Triton tarda \(t_{Tr}\) = 70 > 40: la llamada se corta.
- Sale **504** a los 210 + 40 = **250 ms**, a tiempo para los 300 de la app. Con un tope fijo de 150 ms habría contestado 200 a los 280 ms: también a tiempo, pero sin ningún margen para la vuelta por la red.
? [medio] Con la fórmula del batching: en el Hot Sale (la temporada de ofertas en línea de México), una ráfaga manda ≈ 1,670 fotos por segundo durante un minuto, repartidas en 4 T4 (el tope del autoscaler). ¿Qué batch promedio arma cada una con la ventana de 2 ms? ¿Y si se subiera la ventana a 5 ms?
- La ecuación es \(n_b = 1 + λ_{Tr} × v\). Primero las llegadas a cada T4: \(λ_{Tr}\) = 1,670 ÷ 4 ≈ **417.5 por s**.
- Con \(v\) = 2 ms = 0.002 s: \(n_b\) = 1 + 417.5 × 0.002 ≈ **1.8 fotos**.
- Con \(v\) = 0.005 s: 1 + 417.5 × 0.005 ≈ **3.1 fotos**, a cambio de que cada foto pueda esperar hasta 5 ms en la fila, 3 más que ahora. Ninguna llega a 16: la ventana no es la que da capacidad, son las T4.
? [medio] El equipo cambia `/healthz` para que le pregunte a Triton «y así detectar más fallas». Triton cae 3 minutos en una zona. Cuenta qué pasa con las copias del gateway de esa zona y cuándo vuelven a atender.
- Supón que Kubernetes pregunta `/healthz` cada 10 s y reinicia la copia a los 3 fallos seguidos (es la *liveness probe*; sus plazos reales, en «Kubernetes»): a los 3 × 10 = ≈ 30 s, cada copia se reinicia.
- La copia reiniciada vuelve a fallar mientras Triton siga caído: se reinicia otra vez, y otra, durante los 3 minutos.
- Cuando Triton vuelve, todas las copias de la zona están arrancando a la vez: el lifespan corre, cada una pregunta por Triton, y la zona tarda más en volver que si nadie se hubiera reiniciado. Con `/healthz` sin dependencias, habrían esperado vivas fuera del reparto y vuelto en cuanto `/readyz` diera 200.
? [reto] Búsqueda por similitud, otro sistema de Alba que le pide categorías al gateway, empieza a mandar fotos de 4 MB en promedio, y algunas de 10 MB. Una copia del gateway sigue recibiendo 100 fotos por segundo, ahora la mitad de búsqueda, y sus requests tardan ≈ 60 ms porque los bodies son más grandes. Con la Ley de Little, ¿cuántas requests hay en vuelo en promedio, y alcanza el tope de 16? Con la fórmula de la memoria, ¿cambia el peor momento? ¿Qué sí cambia?
- Ley de Little: en vuelo = llegadas por segundo × tiempo de cada una = 100 × 0.06 s = **6**. El tope de 16 deja 16 ÷ 6 ≈ **2.7 veces** de margen para ráfagas: alcanza.
- Peor momento: \(M = M_0 + I × F + k × D\) = 80 + 16 × 10 + 2 × 320 = **880 MB**, igual que antes, porque \(F\) ya era 10 MB. El tamaño promedio no entra en la fórmula: el peor momento se calcula con el máximo.
- Lo que sí cambia es la red: 50 fotos por segundo × 4 MB = **200 MB/s** de bodies que suben a la copia, contra 50 × 0.2 MB = 10 MB/s si fueran de la app. Eso no lo protege el tope de memoria: lo protege la cuota por caller.
? [reto] El `labels.json` de la versión 15 llega con dos categorías intercambiadas, pero con su huella correcta en el registro (alguien lo armó mal y lo registró así). ¿Qué revisión del lifespan lo atrapa? ¿Qué ve Ana? ¿Qué número lo delataría?
- **Ninguna** del lifespan: la huella coincide con la registrada y siguen siendo 500. El lifespan revisa que el archivo sea el que se registró y que tenga el tamaño correcto, no que su orden sea el bueno.
- Ana sube sus tenis y quizá ve otra categoría con 94 %: todo sale con 200, buena confianza y latencia normal.
- Lo delata lo que mira la respuesta de punta a punta: la paridad que pasa por el gateway y el Triton reales, en el runner con T4, antes de staging («CI/CD y registro de imágenes») o, ya en producción, la caída de la aceptación de sugerencias. Por eso hay paridad por el gateway y no solo del engine.
:::

## Lo que sigue {What comes next}

- «Empaquetado con Docker» mete este gateway en una imagen de ≈ 87 MB y a Triton, con su `model.plan`, en una de ≈ 9.2 GB, y escribe sus comandos de arranque.
- «CI/CD y registro de imágenes» corre las 26 pruebas en cada cambio, publica las dos imágenes y hace la paridad de punta a punta por el gateway.
- Las estaciones de Kubernetes y de despliegue deciden cuántas copias corren, cómo se usan `/healthz` y `/readyz` y cómo entra el `challenger` con tráfico real.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
servidor-modelos triton servicio-sin-estado fastapi uvicorn asgi lifespan endpoint-salud semaforo requests-en-vuelo cliente-triton extension-binaria log-estructurado manejador-errores model-repository config-pbtxt instance-group politica-cola
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué se queda en el gateway y qué en Triton, y por qué no es un solo programa?
El gateway revisa bytes, decodifica, pone plazos, arma el top-k con los nombres y deja log y métricas; Triton carga el engine, junta batches y corre el modelo. Se separan porque escalan con recursos distintos (CPU y GPU), cambian a ritmos distintos, los bytes hostiles no deben tocar la GPU y así Triton es reemplazable.
? ¿Por qué se revisa el `Content-Length` y además se corta al leer?
Porque el header lo escribe quien llama: puede mentir o no venir. El header rechaza barato a los honestos; cortar a los 10 MB al leer protege la memoria de todos.
? ¿De dónde salen los 880 MB del peor momento y qué término domina?
80 MB de base + 16 × 10 MB de bodies + 2 × 320 MB de decodes. Dominan los decodes, 640 MB: por eso el semáforo tiene 2 lugares.
? ¿Qué plazo recibe la llamada a Triton y por qué no siempre 150 ms?
\(T_e = min(150, 250 − g)\): lo menor entre su tope y lo que le queda a la request. Si la request ya gastó mucho, darle 150 ms haría que la respuesta llegara después de que la app se rindiera.
? ¿Qué dice la línea `max_queue_delay_microseconds: 2000` y cuánto junta con el tráfico de Alba?
Triton espera hasta 2 ms por más fotos para correrlas juntas. Con 250 fotos por segundo por T4 junta, en promedio, 1 + 250 × 0.002 = 1.5 fotos.
? ¿Por qué un 422 necesita un manejador de errores propio?
Porque FastAPI lo responde antes de entrar a `classify`: sin manejador, no deja línea de log ni métrica, y un caller que manda `top_k` inválido sería invisible.
:::
