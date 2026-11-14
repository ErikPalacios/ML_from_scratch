---
titulo: Export, engine y paridad
en: Export, engine and parity
subtitulo: El quinto paso del sistema de Alba de principio a fin: convertir el modelo aprobado en un archivo que cualquiera lee, compilarlo para la GPU que lo va a servir, comprobar que sigue siendo el mismo modelo y que no se volvió más lento, y dejar sus huellas en el registry.
pregunta: El gate ya dijo que el modelo nuevo es bueno. Pero lo que se va a servir no es ese modelo: es otro archivo, en otro formato, con otros números por dentro. ¿Cómo se fabrica ese archivo y cómo sabes que responde lo mismo que el que aprobaste?
requisitos: numeros-maquina, pytorch, cpu-gpu, formatos, pruebas-ci, e04-gate
---

:::idea
El modelo que aprobó el gate no es el archivo que se sirve. Esta estación lo exporta a un formato neutral, lo compila para la GPU exacta de producción y luego lo examina dos veces: que responda lo mismo que el original (paridad) y que no sea más lento que el modelo actual (latencia). Solo con las dos en verde se registra, con las huellas de todo lo que se usó para fabricarlo.
:::

Alba es la empresa que seguimos en todo el curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y le sugiere a quien vende la categoría de cada foto entre 500 posibles. La sugerencia la da una [[resnet|ResNet-50]] de ≈ 24.5 millones de parámetros, servida con Triton (el servidor de modelos de NVIDIA) en 2 GPUs T4, y se reentrena cada mes. Ana, por ejemplo, sube la foto de unos tenis y recibe «Calzado › Tenis».

Esta lección es una **estación**: un paso del sistema que arma cada modelo nuevo, contado como trabajo de ingeniería completo. Recibe algo, lo trabaja y se lo pasa a la siguiente. La anterior, «Gate de evaluación y registry», comparó el modelo nuevo contra el actual en las 50,000 fotos del [[golden-set|golden set]] y lo aprobó: no es peor en más de 0.3 puntos, ni en las categorías grandes, ni en los pedazos difíciles. Ese modelo aprobado es un [[checkpoint]]: el archivo de PyTorch que guardó el entrenamiento, con sus pesos en [[float32|FP32]].

El problema es que Alba no sirve ese archivo. Sirve un **engine**: el mismo modelo, compilado para la T4 (traducido a las instrucciones exactas de ese chip) y con casi todas sus cuentas en [[fp16|FP16]]. Es más rápido, pero sus números por dentro son otros. La lección «Cómo guarda números una computadora» explica por qué cambiar de formato mueve cada número un poco; aquí vas a ver cómo se fabrica ese engine, paso a paso, y cómo se demuestra que sigue siendo el modelo que se aprobó.

:::analogia La prueba de imprenta
Una editorial aprueba el texto de un libro en un archivo. La imprenta no imprime el archivo: hace placas para **su** prensa, con sus tintas y su papel. Antes del tiraje, la editorial pide una prueba impresa y la compara con el original, página por página. Si una página salió corrida, no se imprime nada. El archivo aprobado es el checkpoint; las placas son el engine; la prueba es la paridad; y que la prensa no sea más lenta que la de siempre es el gate de latencia.

Dónde se rompe: una prueba de imprenta se revisa a ojo y se espera que salga **idéntica**. La paridad de un modelo no espera eso: los números del engine sí cambian, y lo que se revisa es que cambien poco y que casi ninguna respuesta cambie. Por eso se mide con números y con umbrales, no a ojo.
:::

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

### Lo que entra

- **El checkpoint aprobado.** El archivo de PyTorch que el gate aprobó, el de `resnet50-2026-10-01`, entrenado el 1 de octubre de 2026. El archivo pesa ≈ 294 MB porque también trae el estado del entrenamiento (los momentos de Adam, el paso, las semillas); de él solo importan los pesos: ≈ 98 MB en FP32.
- **Unas ≈ 10,000 fotos del golden set**, un subconjunto de las 50,000, ya pasadas por el preprocesamiento 1.4.0 (los pasos que llevan la foto a 224 × 224 píxeles y normalizan sus colores), el mismo paquete que usa el gateway (el programa que recibe la foto de Ana y la prepara para el modelo).
- **Los números del champion.** El [[champion-challenger|champion]] es el modelo que hoy atiende a la gente. De él se necesita cuánto tarda, medido igual que se va a medir al nuevo.

### Lo que sale

- **`model.onnx`**: el modelo como un archivo [[onnx|ONNX]], ≈ 98 MB. Es la entrega: lo que cualquier herramienta puede leer.
- **`model.plan`**: el [[engine-tensorrt|engine de TensorRT]] en FP16, ≈ 49 MB de pesos (el archivo completo, de ≈ 50 a 150 MB). Es lo que de verdad corre en la T4.
- **Una [[imagen-contenedor|imagen]] de Triton con el engine adentro**: un paquete con el servidor y todo lo que necesita para correr, listo para arrancar en cualquier máquina. Su tag (su nombre) es la versión del modelo. Cómo se arma lo cuenta «Empaquetado con Docker».
- **Dos reportes** (paridad y latencia) y las **huellas** del build: la huella SHA-256 de cada archivo (un número que sale del contenido exacto del archivo; lo ves en «Huellas y registro»), la GPU y las versiones del software con que se construyó.
- **Una versión nueva en el [[registro-modelos|registry]] de modelos**, el catálogo donde cada modelo guarda sus versiones numeradas. Es la versión 14, `resnet50-2026-10-01`, y recibe el [[alias-modelo|alias]] `challenger`: un nombre que señala a una versión y se puede mover (es el ejemplo de octubre; en noviembre, la misma estación registra la versión 15, como la viste en la lección anterior). «Gate de evaluación y registry» lo explica a fondo; aquí se completa ese registro.

### Lo que se decide

La estación responde **dos** preguntas, y nada más:

1. ¿El archivo que se va a servir es **el mismo modelo** que se evaluó? Eso es la [[paridad-engine|paridad del engine]].
2. ¿**Cabe en el tiempo**? Que no sea más de 10 % más lento que el champion. Eso es el gate de latencia.

Si cualquiera de las dos falla, el paso termina con error, no se registra nada y el champion sigue atendiendo. Lo que la estación **no** decide: si el modelo es bueno (ya lo decidió el gate), ni cómo se sirve ni cómo se despliega (las estaciones 6 a 10).

### Los siete pasos

La estación es un pedazo del [[pipeline]] mensual de Alba, el que corre su [[orquestador-pipelines|orquestador]] el día 1 de cada mes. Corre en un [[runner-ci|runner]] de [[ci|CI]] propio (CI es la integración continua: el sistema que corre pruebas y builds automáticos con cada cambio). Es una máquina `g4dn.xlarge` de AWS con una T4, que se prende para el trabajo y se apaga al terminar, por menos de US$10 al mes. La estación tarda ≈ 20–30 min:

:::pasos
1. Exportar a ONNX, en CPU
El modelo de PyTorch se convierte en un archivo ONNX y se revisa ahí mismo, con tres chequeos.
2. Paridad en CPU
ONNX Runtime, un programa que corre archivos ONNX, lo corre en CPU y lo compara con PyTorch. Es FP32 contra FP32: deben coincidir casi en todo.
3. Construir el engine, en la T4
TensorRT, el compilador de modelos de NVIDIA, lee el ONNX y lo compila para esa GPU, en FP16.
4. Poner el engine dentro de la imagen de Triton
El archivo `classifier/1/model.plan` queda dentro de la imagen que se va a servir.
5. Paridad del engine
Con esa imagen corriendo en la T4, el engine responde las ≈ 10,000 fotos y se compara con PyTorch en FP32.
6. Gate de latencia
`perf_analyzer`, la herramienta de NVIDIA que mide el servidor como lo haría un cliente, le manda peticiones a 250 y a 500 por segundo y compara su [[p99]] con el del champion.
7. Huellas y registro
Las huellas van al registry y la versión queda como `challenger`.
:::

:::diagrama e05-export-estacion
La estación 5 completa, del checkpoint aprobado a la versión `challenger`. Toca cada caja. El primer recorrido sigue el modelo de octubre; el segundo, un engine que no pasa la paridad.
:::

¿Por qué tanto trabajo, si PyTorch ya sabe correr el modelo? Por tres razones. Un engine FP16 de TensorRT suele ser varias veces más rápido que PyTorch en FP32 en la misma GPU: con él, una T4 llega a ≈ 1,200 fotos por segundo. El archivo de PyTorch es un [[pickle]], y abrir un pickle puede correr código (lo ves en «Archivos y formatos»). Y el servidor no necesita Python ni el código de entrenamiento: necesita un archivo que diga qué cuentas hacer.

## ONNX: el modelo como un archivo que se entrega {ONNX: the model as a handoff file}

Entrenar y servir son dos mundos. Entrenar pasa en PyTorch, con Python, en una A10G (la GPU con que Alba entrena). Servir pasa en Triton, un programa escrito en C++ (otro lenguaje, más rápido y sin Python), en una T4. Entre los dos hace falta un **formato de entrega** que no dependa de ninguno.

### Qué hay dentro de un ONNX

[[onnx|ONNX]] (*Open Neural Network Exchange*) es un formato de archivo para modelos que leen muchas herramientas, no solo PyTorch. Un archivo ONNX guarda tres cosas:

- **El [[grafo-modelo|grafo del modelo]].** La lista de operaciones de la red, en orden, y cómo se conectan: la salida de esta convolución entra a esta ReLU, que entra a esta suma. A cada operación se le llama **operador** (*operator*): `Conv`, `Relu`, `Add`, `GlobalAveragePool` (el promedio de cada canal) y `Gemm` (una multiplicación de matrices). No hay código de Python: solo operadores con nombre.
- **Los pesos.** Los ≈ 24.5 millones de números que aprendió el modelo, guardados en FP32: ≈ 24.5 millones × 4 bytes ≈ 98 MB. No son exactamente los 24,532,532 parámetros: el exportador de Alba mete cada [[batchnorm|BatchNorm]] dentro de la convolución que la precede (sus cuentas se pueden juntar), y el archivo queda con 24,505,972 números. Casi lo mismo.
- **La firma.** Cómo se llaman la entrada y la salida, de qué tipo son y qué forma tienen. En Alba: la entrada se llama `input`, es FP32 con forma `[batch, 3, 224, 224]` (cuántas fotos van juntas, 3 colores y 224 × 224 píxeles), y la salida se llama `logits`, FP32 con forma `[batch, 500]`.

Por dentro, el archivo es un mensaje de [[protobuf]], el formato binario de Google para datos con esquema. Lo que importa es que es **solo datos**: abrirlo no corre código, a diferencia de un pickle.

:::figura e05-export-onnx
Lo que hay dentro del `model.onnx` de Alba: la firma, el grafo de operadores con sus pesos, y el opset que dice qué versión de cada operador se usó.
:::

### El opset: la versión de los operadores

Los operadores cambian con el tiempo. Una versión nueva de `Resize` acepta otra opción; una de `Softmax` cambia sobre qué eje opera por omisión. Por eso cada archivo ONNX declara su [[opset]]: el número de versión del conjunto de operadores que usó. El de Alba es **opset 17**.

El opset es parte del contrato. Quien lee el archivo (ONNX Runtime, TensorRT) tiene que conocer ese opset. Si exportas con un opset que tu versión de TensorRT todavía no entiende, el build falla; si el opset cambia sin que nadie lo pida, el mismo operador puede significar otra cosa. Por eso Alba **fija** el opset y, como vas a ver, lo **lee del archivo** después de exportar.

### La forma variable: el eje de batch dinámico

El modelo de Alba recibe a veces 1 foto y a veces varias juntas: Triton junta las que llegan casi al mismo tiempo en un [[batch]] (lo ves en «Qué tan rápido y cuánto: latencia y throughput»). La firma tiene que decir que la primera dimensión cambia. A eso se le llama [[eje-batch-dinamico|eje de batch dinámico]]: la dimensión 0 de `input` y de `logits` se declara con un nombre, `batch`, en vez de un número.

No lo confundas con el [[batching-dinamico|batching dinámico]] de Triton. Uno es una propiedad del archivo (acepta batches de cualquier tamaño); el otro es lo que hace el servidor (juntar peticiones). Sin el primero, el segundo no sirve: un archivo que solo acepta batch 1 no puede recibir 4 fotos juntas.

### El script de export

Alba exporta con un script, `export_onnx.py`, que vive en el repositorio del modelo. Lo esencial cabe en unas líneas. Es una **ilustración**: necesita PyTorch y torchvision (la biblioteca de PyTorch con las redes de visión ya armadas), que aquí no están instalados.

```python
import torch, torchvision

modelo = torchvision.models.resnet50(weights=None, num_classes=500)  # la red vacía, con 500 salidas
ckpt = torch.load("final.pt", map_location="cpu", weights_only=True)  # pesos y estado, sin correr código
modelo.load_state_dict(ckpt["model"], strict=True)  # solo los pesos, cada uno en su lugar
modelo.eval()                                       # BatchNorm con sus estadísticas guardadas

ejemplo = torch.randn(2, 3, 224, 224)               # batch 2, para que el 1 no quede fijo
torch.onnx.export(modelo, (ejemplo,), "model.onnx", dynamo=False, opset_version=17,
                  input_names=["input"], output_names=["logits"],
                  dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
                  do_constant_folding=True)
```

Cada argumento es una decisión:

- **`weights_only=True` y `strict=True`.** El primero carga solo tensores y datos simples (diccionarios, listas, números), sin dejar que el archivo corra código. Del checkpoint, que también trae el estado del entrenamiento, se toman solo los pesos: `ckpt["model"]`. El segundo exige que cada peso del checkpoint tenga su lugar en la red y que no falte ninguno: si alguien cambió la cabeza a 501 clases sin avisar, falla aquí y no en producción.
- **`modelo.eval()`.** Pone la BatchNorm a usar las estadísticas que guardó al entrenar, en vez de las del batch que le llega. El exportador que usa Alba lo haría solo, pero el nuevo no (lo ves en el recuadro de abajo), así que Alba lo escribe siempre.
- **Un ejemplo de batch 2.** El exportador corre el modelo una vez con ese ejemplo y graba lo que pasó. Con batch 1, algunas herramientas tratan el 1 como constante; con 2 no hay duda de que es la dimensión que cambia.
- **`dynamo=False`, opset 17.** Usa el exportador clásico: corre el modelo una vez y graba las operaciones que pasaron, con [[torchscript|TorchScript]] (a eso se le llama trazar). Desde PyTorch 2.9 el exportador por omisión es otro; Alba lo deja para un cambio aparte, con su propia paridad.
- **`dynamic_axes`.** Declara el eje 0 como `batch`, en la entrada y en la salida.
- **`do_constant_folding=True`.** Si una parte del grafo da siempre el mismo resultado (porque solo depende de pesos), el exportador la calcula una vez y guarda el resultado, en vez de dejar esa cuenta para cada foto.

Al terminar, el script imprime una línea que se queda en el log del pipeline: `[export] opset=17 input=input[batch,3,224,224] output=logits`.

### Los tres chequeos del export

Un export puede salir mal **sin dar error**. Por eso el mismo script revisa el archivo antes de soltarlo, y si algo no cuadra imprime `FALLÓ la verificación` y sale con error:

:::pasos
1. El archivo está bien formado
`onnx.checker` con `full_check=True` revisa que el grafo sea válido: que cada operador exista en el opset, que cada entrada de cada nodo (cada operación del grafo) venga de algún lado y que las formas cuadren de punta a punta.
2. El opset es el que se pidió
Lee el opset escrito **en el archivo** y lo compara con 17. Parece redundante, pero no lo es: con el exportador nuevo, pedir opset 17 puede dejarte un archivo en 18 sin ningún error, a lo más con un aviso en el log.
3. ONNX Runtime contra PyTorch
Corre las mismas 512 fotos en los dos, en batch 1 y en batch 32: mismo top-1 en todas, y una diferencia máxima de logits del orden de 0.0001.
:::

[[onnx-runtime|ONNX Runtime]] (ORT) es un programa que carga un ONNX y lo corre, en CPU o en GPU. Por dentro reparte los nodos del grafo entre sus proveedores de ejecución (*execution providers*), los motores que hacen las cuentas: el de CPU, el de CUDA (para GPUs de NVIDIA), el de TensorRT y otros. Aquí Alba usa solo el de CPU, a propósito: este chequeo no necesita GPU, así que corre en cualquier máquina y en un minuto.

¿Por qué batch 1 **y** 32? Porque son las orillas del rango que promete la firma. Si el eje de batch quedó fijo por error, el batch 1 pasa y el 32 truena. Y es FP32 contra FP32: las dos versiones hacen las mismas cuentas, en otro orden, así que solo deben diferir en el último decimal. Si aquí sale una diferencia de 0.01, el export está mal, aunque el top-1 coincida.

:::profundo El exportador nuevo y sus trampas
Desde PyTorch 2.9, `torch.onnx.export` usa por omisión otro exportador, el que parte de `torch.export` (`dynamo=True`). Alba tiene anotado pasarse a él como un cambio aparte, porque trae trampas como estas dos (la tercera, el opset, la atrapa el chequeo 2).

**Sin `eval()`, otro modelo.** El exportador clásico pone el modelo en eval mientras exporta (su opción `training` vale `EVAL` por omisión). El nuevo no: captura el modelo tal como está, y en modo train la BatchNorm se queda con el comportamiento de entrenamiento. Con la ResNet-50 de Alba capturada así, el top-1 coincidió con el original en 0 % de las fotos (lo cuenta «PyTorch en lo que toca a producción»).

**El ONNX que pesa 0.3 MB.** El exportador nuevo guarda los pesos aparte: un `model.onnx` de ≈ 0.3 MB con el grafo y un `model.onnx.data` de ≈ 98 MB con los pesos, salvo que le pidas lo contrario. Si un paso del pipeline copia solo el `.onnx`, el siguiente no encuentra los pesos y falla, a veces mucho después. Alba, con `dynamo=False`, saca un solo archivo; si migra, el chequeo 3 lo atraparía, porque corre el archivo que de verdad se va a entregar.

Y una más, que no es del exportador. **El provider que se apaga solo.** Alba corre ONNX Runtime solo en CPU, pero hay servicios que lo usan en GPU. Si corre con el provider de CUDA y un operador no está soportado ahí, ese nodo **cae a la CPU sin error**: el modelo responde bien, solo que más lento, y lo único que lo delata es la latencia. Por eso un servicio con ORT en GPU revisa qué provider tomó cada nodo, y por eso la latencia se mide con el artefacto final.
:::

## TensorRT: del ONNX al engine {TensorRT: from ONNX to engine}

El ONNX dice **qué** cuentas hacer. No dice **cómo** hacerlas rápido en una T4. Eso es lo que hace [[tensorrt|TensorRT]], el compilador de modelos de NVIDIA. Un compilador es un programa que traduce una descripción (aquí, el grafo) a instrucciones que un chip ejecuta directo. TensorRT recibe el ONNX y produce un [[engine-tensorrt|engine]], un archivo `.plan` con el modelo listo para correr en una GPU concreta. A la parte de TensorRT que hace ese trabajo se le llama **builder**.

### Lo que hace el builder

:::pasos
1. Lee el grafo
Carga el ONNX y revisa que cada operador sea uno que sabe compilar.
2. Lo simplifica
Quita lo que no hace nada (una operación que copia su entrada tal cual) y precalcula lo que es constante.
3. Junta operaciones: la fusión
Una convolución, su BatchNorm, su ReLU y la suma de la conexión residual se vuelven un solo kernel (un programa que corre en la GPU).
4. Elige la precisión de cada capa
Con `--fp16`, usa FP16 donde puede; si una capa no tiene versión en FP16 o es más rápida en FP32, la deja en FP32.
5. Cronometra tácticas
Una táctica es una forma concreta de hacer la cuenta de una capa. Para cada capa prueba varias en **esta** GPU y se queda con la más rápida.
6. Guarda el engine
Escribe todo, con los pesos ya en FP16, en el archivo `.plan`.
:::

La [[fusion-capas|fusión de capas]] es la que más se nota. La lección «CPU y GPU» la cuenta: en PyTorch, sin fusionar, la ResNet-50 son 174 operaciones por batch, cada una un [[kernel-gpu|kernel]] que la CPU tiene que lanzar; fusionadas, quedan ≈ 56. (Una parte la adelanta el export, que ya mete cada BatchNorm en su convolución; TensorRT junta el resto.) Menos kernels son menos lanzamientos, y además el resultado intermedio no tiene que ir y volver de la memoria de la GPU entre una operación y la siguiente.

Las **tácticas** explican por qué el engine depende de la GPU. Para una convolución de cierto tamaño hay decenas de formas de repartir el trabajo entre los núcleos. Cuál es la más rápida depende del chip, de su memoria y hasta del tamaño del batch. TensorRT no lo adivina: las prueba, las mide y escribe la ganadora en el engine.

:::diagrama e05-export-builder
Dentro del builder de TensorRT, del ONNX al `.plan`. Toca cada caja; el recorrido sigue el engine de Alba en la T4.
:::

### El perfil de optimización: qué batches acepta

El ONNX dice que el batch es variable. El engine necesita saber **entre qué valores**, porque las tácticas se eligen para tamaños concretos. Eso es el [[perfil-optimizacion|perfil de optimización]] (*optimization profile*): tres formas de entrada.

- **Mínima**: el batch más chico que acepta. En Alba, 1.
- **Óptima**: la forma para la que se cronometran las tácticas. En Alba, 16.
- **Máxima**: la más grande que acepta. En Alba, 32, igual que el `max_batch_size` de Triton. Un batch de 33 no entra.

Aquí hay una tensión. En la hora pico, los batches que de verdad llegan a la T4 son de ≈ 1 a 3 fotos. Triton espera a lo más 2 ms para juntar fotos, y en ese tiempo no llegan más. El engine funciona con esos batches, porque están dentro del rango, pero sus tácticas se eligieron pensando en 16. Por eso el 16 es un punto de partida, no un dato: lo correcto es construir también un engine con óptima 4, medir los dos con el tráfico real (de 250 a 500 peticiones por segundo) y quedarse con el que dé mejor p99.

### trtexec: construir y medir

[[trtexec|`trtexec`]] es la herramienta de línea de comandos de TensorRT. Construye el engine y lo mide. El paso 3 de la estación es, en esencia, esta línea. Es una **ilustración**: necesita una GPU de NVIDIA y la imagen de TensorRT.

```bash
trtexec --onnx=model.onnx --saveEngine=model.plan --fp16 \
        --minShapes=input:1x3x224x224 --optShapes=input:16x3x224x224 \
        --maxShapes=input:32x3x224x224 --shapes=input:16x3x224x224
```

Las tres primeras opciones de forma son el perfil. La última, `--shapes`, es el tamaño con que `trtexec` hace una medición rápida de velocidad al final (un *benchmark*), para tener un número de control: si sale diez veces más lento que el mes pasado, algo raro pasó. En la T4 de Alba el build tarda ≈ 2–5 min.

:::ojo
**El número de `trtexec` no decide nada.** Mide el engine solo, con batches que él mismo arma y con la GPU para él: sin la fila de Triton, sin la red y sin el gateway. Y si lo corres en batch 32, mide un caso que casi nunca llega con el tráfico de la gente. Sirve para saber que el engine no está roto; el número que decide si el modelo cabe sale de `perf_analyzer`, contra Triton, con el tráfico de verdad.
:::

## Un engine para una GPU y una versión {One engine for one GPU and one version}

Un engine no es portable. Por omisión viene atado a dos cosas, y si cambia cualquiera hay que construirlo otra vez.

### Atado a la GPU: la compute capability

Cada generación de GPUs entiende sus propias instrucciones, y NVIDIA le pone un número, la [[compute-capability|compute capability]]: 7.5 para la T4 (se escribe sm_75), 8.6 para la A10G, 8.9 para la L4, 8.0 para la A100 y 9.0 para la H100. «CPU y GPU» lo explica en «La arquitectura de la GPU». Los kernels que eligió el builder están compilados para sm_75 y las tácticas se cronometraron en una T4. En una L4 ese engine no carga.

### Atado a la versión: la release de NGC

El formato del `.plan` cambia entre versiones de TensorRT. Un engine construido con TensorRT 10.3 lo debe cargar TensorRT 10.3. (TensorRT tiene modos de compatibilidad entre versiones y entre GPUs, que se piden al construir y pueden costar velocidad; el de GPUs no cubre la T4. Alba no los usa.) ¿Cómo se garantiza eso?

NVIDIA publica sus programas en [[contenedor|contenedores]] listos (paquetes con el programa y todo lo que necesita para correr), en su catálogo NGC, con una [[release-ngc|release]] cada mes que se nombra por año y mes: 24.08 es la de agosto de 2024. Los contenedores de una misma release comparten la base: la misma CUDA y, los que la traen, la misma TensorRT. Alba construye el engine con la imagen `nvcr.io/nvidia/tensorrt:24.08-py3` (TensorRT 10.3) y lo sirve con `tritonserver:24.08-py3`, de la misma release (Ubuntu 22.04, CUDA 12.6). **Misma release en el build y en el servidor**: esa es la regla.

:::nota Por qué no la release más nueva
En noviembre de 2026 hay releases mucho más nuevas. Subir de release cambia TensorRT, CUDA y Triton a la vez: Alba lo trata como un cambio aparte, con su engine, su paridad y su latencia.
:::

### La guardia del build

El script que construye el engine, `build_engine.sh`, tiene dos variables fijas: `NGC_RELEASE=24.08` y `EXPECTED_GPU=T4`. Antes de construir, le pregunta a `nvidia-smi` (el programa que reporta qué GPU tiene la máquina) qué GPU hay. Si no dice T4, **aborta**. Al terminar imprime la GPU, la release y la huella SHA-256 del ONNX y del plan, que se vuelven parte de las [[huella-build|huellas del build]].

¿Por qué una guardia, si el runner siempre tiene una T4? Porque «siempre» dura hasta que alguien cambia el tipo de máquina del runner, o corre el script en su laptop. Sin la guardia, el engine se construye, pasa todo en esa máquina… y no carga en producción.

:::figura e05-export-portable
Un mismo ONNX, tres builds. Solo el engine construido en una T4 con TensorRT 10.3 carga en el Triton de Alba; el de una L4 y el de otra versión de TensorRT fallan al arrancar.
:::

### En CI, nunca al arrancar el servidor

Hay herramientas que construyen el engine al vuelo, cuando el servidor arranca: ONNX Runtime con su provider de TensorRT, por ejemplo. Alba no lo hace, por tres razones:

- **Tarda.** El build son minutos, y un [[pod]] nuevo de Triton (una copia más del servidor, que Kubernetes arranca en otra máquina cuando sube el tráfico) ya tarda ≈ 5–13 min en estar listo. Cada réplica nueva, en plena subida de tráfico, sumaría otros minutos sin servir.
- **No es el que se probó.** Las tácticas se eligen cronometrando, y el cronómetro tiene ruido. Dos builds del mismo ONNX en dos T4 pueden elegir tácticas distintas. El engine que pasó la paridad es **ese archivo**, con esa huella; uno construido al arrancar es otro, sin examen.
- **Falla tarde.** Si el build falla en CI, falla un paso del pipeline y nadie se entera afuera. Si falla al arrancar, falla en producción.

Por eso el engine se construye una vez, en el runner de CI con la T4, y se **hornea** en la imagen de Triton: el archivo `classifier/1/model.plan` queda dentro de la imagen, cuyo tag es la versión del modelo. El `.plan` no se guarda en git. Volver al modelo anterior es volver a la imagen anterior, que ya trae su engine. Un engine no se «reconstruye rápido» en un incidente.

Si aun así un engine de otra GPU o de otra versión llega a producción, Triton no lo puede cargar, y el despliegue se detiene sin afectar a nadie. El recuadro cuenta cómo.

:::profundo Qué se rompe cuando se rompe
Si un engine de otra GPU o de otra versión llega a producción, Triton no lo puede cargar. Alba arranca Triton para que se detenga ante cualquier error al cargar un modelo: el pod falla, Kubernetes (el sistema que arranca y vigila los servidores de Alba) lo reinicia, vuelve a fallar, y el despliegue, que no quita ningún pod viejo hasta que el nuevo esté listo, se detiene. **Los pods viejos siguen sirviendo.** Es la mejor falla posible: ruidosa, temprana y sin afectar a nadie. Los detalles son de «Kubernetes» y «Rollout seguro».

Si algún día Alba tuviera T4 y L4, serían dos engines, dos imágenes y una regla de Kubernetes para mandar cada una a su tipo de máquina.
:::

## La paridad del engine {Engine parity}

El engine ya existe y carga en Triton. Ahora la pregunta central: ¿responde lo mismo que el checkpoint que aprobó el gate?

La [[paridad-engine|paridad del engine]] compara el [[artefacto]] que se va a servir con el modelo que se evaluó, foto por foto. No mide si el modelo es bueno: mide si es **el mismo**. No la confundas con la [[prueba-paridad|prueba de paridad]] del preprocesamiento, que revisa que la foto llegue al modelo con los mismos números en el entrenamiento y en el servicio. Son dos exámenes distintos, con el mismo apellido.

### Tres números

La referencia es PyTorch en FP32: el checkpoint aprobado, en `eval()`. El candidato es el engine FP16 corriendo en Triton. Los dos reciben las mismas \(N\) fotos y cada uno da 500 [[logit|logits]] por foto. Con eso se calculan tres números:

:::formula Paridad del engine
a_1 = frac{N_{igual}}{N}
o_5 = frac{1}{N} × sum_{i=1}^{N} frac{|R_i ∩ Q_i|}{5}
d = max_{i,k} |u_{ik} − v_{ik}|
- N: fotos del examen (en Alba, ≈ 10,000 del golden set)
- N_{igual}: fotos en que la referencia y el engine dan la misma categoría top-1
- a_1: el **acuerdo top-1**, la fracción de fotos con la misma primera sugerencia (de 0 a 1)
- R_i, Q_i: las 5 categorías de logit más alto de la foto \(i\), en la referencia y en el engine
- |R_i ∩ Q_i|: cuántas de esas 5 aparecen en las dos listas (de 0 a 5)
- o_5: el **solapamiento top-5**, la fracción promedio de las 5 sugerencias que coinciden (de 0 a 1)
- u_{ik}, v_{ik}: el logit de la categoría \(k\) en la foto \(i\), de la referencia y del engine (sin unidad)
- d: la **diferencia máxima de logits**, la más grande de todas las fotos y categorías (sin unidad)
:::

Y los umbrales de Alba: \(a_1\) ≥ 99.5 %, \(o_5\) ≥ 99 % y \(d\) ≤ 0.5.

El [[acuerdo-top1|acuerdo top-1]] y la [[diferencia-logits|diferencia máxima de logits]] ya los viste en «Cómo guarda números una computadora», en su sección «Cuantizar a fondo: punto cero, INT4, FP8 y el examen»: el primero es lo que ve Ana; el segundo delata un bug antes de que cambie una respuesta (FP32 contra FP32 da ≈ 0.0001, un FP16 sano ≈ 0.01 y uno roto 1 o más, así que el tope de 0.5 no da falsas alarmas). Lo nuevo es \(o_5\): mide las 5 sugerencias que la pantalla le muestra a Ana, no solo la primera.

### La paridad, en chiquito

El código de abajo hace el examen con 40 fotos y 10 categorías. La referencia son logits al azar con [[semilla]] fija. El «engine» son esos logits con un poco de ruido y redondeados a FP16 con `struct`, el módulo de Python que convierte números a bytes (su formato `"e"` es un número de 16 bits). El «roto» es un engine con una capa que se desbordó: sus números pasaron de ≈ 65,504, el máximo que cabe en FP16, y echaron a perder las salidas. Aquí lo simulamos con mucho ruido. La foto 7 está casi empatada a propósito, entre Tenis y Botas.

```python
import random, struct

random.seed(5)
CATS = ["Tenis", "Botas", "Sandalias", "Mochilas", "Bolsas", "Lámparas",
        "Bicicletas", "Relojes", "Gorras", "Playeras"]
fp32 = [[random.gauss(0, 2) for _ in CATS] for _ in range(40)]   # 40 fotos × 10 logits
fp32[7][0], fp32[7][1] = 2.301, 2.300                              # una foto casi empatada

def a_fp16(x):                                  # redondea a 16 bits, como guarda un engine FP16
    return struct.unpack("e", struct.pack("e", x))[0]

engine = [[a_fp16(z + random.gauss(0, 0.004)) for z in foto] for foto in fp32]
roto = [[z + random.gauss(0, 1.0) for z in foto] for foto in fp32]   # una capa que se desbordó

def top(foto, k):
    return sorted(range(len(foto)), key=lambda c: -foto[c])[:k]

def paridad(nombre, ref, otro):
    N = len(ref)
    a1 = sum(top(r, 1) == top(o, 1) for r, o in zip(ref, otro)) / N
    o5 = sum(len(set(top(r, 5)) & set(top(o, 5))) / 5 for r, o in zip(ref, otro)) / N
    d = max(abs(zr - zo) for r, o in zip(ref, otro) for zr, zo in zip(r, o))
    pasa = a1 >= 0.995 and o5 >= 0.99 and d <= 0.5
    print(f"{nombre:<7} a1 = {a1:.1%} · o5 = {o5:.1%} · d = {d:.4f} · ¿pasa? {pasa}")

paridad("engine", fp32, engine)
paridad("roto", fp32, roto)
print("foto 7:", [round(z, 4) for z in fp32[7][:2]], "→", [round(z, 4) for z in engine[7][:2]])
```

```salida
engine  a1 = 100.0% · o5 = 100.0% · d = 0.0121 · ¿pasa? True
roto    a1 = 70.0% · o5 = 84.5% · d = 2.8273 · ¿pasa? False
foto 7: [2.301, 2.3] → [2.3047, 2.3047]
```

El engine sano da \(d\) ≈ 0.012, del orden de 0.01, y coincide en todo. El roto cambia 12 de las 40 primeras sugerencias y su \(d\) pasa de 2.8: lo atrapan los tres números a la vez. Y mira la foto 7. En FP16, entre 2 y 4 los números van de 0.002 en 0.002, así que un empate de 0.001 desaparece: los dos logits quedaron en 2.3047. Aquí ganó Tenis porque, en un empate, `top` se queda con la primera categoría; un engine de verdad puede resolverlo al revés. Esa es la clase de foto que cambia de respuesta en un engine sano.

### ¿Cuántas fotos necesita el examen?

Con 40 fotos, una sola foto casi empatada que cambie da \(a_1\) = 39 ÷ 40 = 97.5 % y tumba el examen. Por eso el examen de verdad es grande. Con ≈ 10,000 fotos y el umbral de 99.5 %, tienen que coincidir 9,950, así que pueden cambiar a lo más 50 (la lección «Cómo guarda números una computadora» lo cuenta en «El examen de un modelo convertido»). Aquí la pregunta es otra: **cuánto ruido tiene el examen mismo**.

La respuesta corta: miles. Un engine FP16 sano sí cambia unas cuantas fotos casi empatadas, así que el examen necesita lugar para ellas sin confundirlas con un bug. Con 10,000 fotos caben 50 cambios, y un engine sano cambia muchas menos; con 512 caben solo 2, y el examen se vuelve un volado: a veces reprueba a un engine sano y a veces deja pasar uno roto. El recuadro de abajo hace la cuenta.

:::profundo El examen también tiene ruido
Supón que un engine sano cambia de verdad el top-1 de una fracción \(f\) de las fotos (las casi empatadas). Cuántas cambian en un examen de \(N\) fotos es un volado cargado repetido \(N\) veces: sale alrededor de \(N × f\), a veces más y a veces menos.

:::formula ¿Pasa por margen o por suerte?
L = (1 − a_{min}) × N
σ = sqrt{N × f × (1 − f)}
D = frac{L − N × f}{σ}
- N: fotos del examen
- a_{min}: el acuerdo top-1 mínimo que pide el examen (en Alba, 0.995 = 99.5 %)
- L: cuántas fotos pueden cambiar de top-1 sin que el examen falle (en fotos)
- f: la fracción de fotos que el engine cambia de verdad (de 0 a 1)
- N × f: cuántas cambian en promedio (en fotos)
- σ: la desviación estándar de ese número, cuánto se mueve de un examen a otro (en fotos)
- D: el **margen en desviaciones**: cuántas \(σ\) caben entre lo esperado y el límite (sin unidad). Con \(D\) ≥ 3 el examen casi nunca se equivoca; con \(D\) cerca de 0 es un volado
:::

Toma un engine sano que cambia \(f\) = 0.2 % de las fotos (un supuesto del ejemplo: 1 de cada 500, las casi empatadas) y otro con un bug que cambia \(f\) = 1 %:

:::cuenta El examen de 10,000 fotos, sano y roto
Fotos del examen, \(N\) // el subconjunto del golden set | — | 10,000
Cambios permitidos, \(L\) | \(L = (1 − a_{min}) × N\) = 0.005 × 10,000 | 50
Engine sano: cambios esperados, \(N × f\) // \(f\) = 0.002, supuesto | 10,000 × 0.002 | 20
Engine sano: desviación, \(σ\) | \(sqrt{10,000 × 0.002 × 0.998}\) | ≈ 4.5
Engine sano: margen, \(D\) | \((L − N × f) ÷ σ\) = (50 − 20) ÷ 4.5 | ≈ 6.7
Engine roto: cambios esperados, \(N × f\) // \(f\) = 0.01, supuesto | 10,000 × 0.01 | 100
Engine roto: desviación, \(σ\) | \(sqrt{10,000 × 0.01 × 0.99}\) | ≈ 9.9
Engine roto: margen, \(D\) | (50 − 100) ÷ 9.9 | ≈ −5.0
= Con 10,000 fotos, el sano pasa con casi 7 desviaciones de sobra y el roto falla con 5 en contra: el examen separa a los dos sin dudar.
:::

¿Y si el examen fuera de 512 fotos, como el chequeo del export? Entonces \(L\) = 0.005 × 512 = 2.56: a lo más 2 cambios. El sano espera ≈ 1, y con una cuenta exacta (la de la distribución binomial) falla ≈ 8.5 % de las veces sin tener nada malo; el roto espera ≈ 5 y **pasa** ≈ 11 % de las veces. Un examen así falla por mala suerte y deja pasar bugs. Para el export no importa, porque FP32 contra FP32 no cambia ninguna respuesta (\(f\) ≈ 0): ahí se exige el mismo top-1 en **todas** las fotos. Para FP16, hacen falta miles.

:::calculadora e05-export-examen
Empieza con el engine sano y el examen de Alba. Baja \(N\) a 512 y mira cómo el margen \(D\) cae a ≈ 1.5. Luego sube \(f\) a 1 %, el engine roto, con \(N\) en 10,000 y en 512.
:::
:::

### Tres paridades, tres lugares

Alba corre la paridad tres veces, en tres lugares, porque cada una ve cosas que las otras no:

- **En CPU, con ONNX Runtime** (paso 2 de esta estación): FP32 contra FP32. Atrapa un export roto: el modelo sin `eval()`, un eje de batch que quedó fijo, un opset que cambió.
- **El engine en Triton, en la T4** (paso 5): FP16 contra FP32, con las ≈ 10,000 fotos. Atrapa lo que hizo TensorRT: una capa que se desborda en FP16, un engine mal construido. Y como corre contra Triton y no contra el `.plan` suelto, también revisa el contrato con el servidor: que la entrada se llame `input`, sea FP32 con forma `[3, 224, 224]` por foto, y que la salida sean los 500 `logits`.
- **De punta a punta, por el gateway real, antes de staging** (en «CI/CD y registro de imágenes»). Corre en el runner de CI con T4, con el gateway y el Triton de verdad, justo antes de pasar a [[ambiente|staging]] (una copia completa del sistema, sin gente real, para probar antes de producción). Esta paridad manda fotos JPEG reales por el camino de Ana. Atrapa lo que ninguna de las dos anteriores puede ver, porque las dos reciben la foto ya preparada: un preprocesamiento distinto (los colores en otro orden, otra normalización), un [[labels-json|`labels.json`]] en otro orden (la lista que dice qué categoría es cada una de las 500 salidas), un tipo de dato distinto en el gateway.

:::figura e05-export-paridades
Qué bug atrapa cada paridad. Ninguna sola atrapa todos: por eso son tres.
:::

:::profundo Un FP16 con 97 %: dónde buscar el bug
Un engine FP16 con 97 % de acuerdo no es redondeo: es un bug. FP16 cambia unas cuantas fotos casi empatadas, no 300 de 10,000. La forma de buscarlo es partir el camino en dos:

1. **Corre el mismo examen con el ONNX en ONNX Runtime**, en FP32. Si ahí ya da 97 %, el problema está en el export, no en TensorRT: revisa `eval()`, el opset y la versión del exportador.
2. **Si el ONNX da ≈ 100 % y el engine 97 %**, el problema está en el build. Lo más común es una capa que se desborda en FP16: un número que pasa de ≈ 65,504, el máximo de FP16, y se vuelve infinito. Se comparan las salidas intermedias capa por capa hasta encontrar dónde diverge, y esa capa se deja en FP32.

Mientras tanto, nada se registra y el champion sigue atendiendo.
:::

:::ojo
**Paridad no es calidad.** Una paridad de 99.6 % dice que el engine se porta como el checkpoint. No dice que el checkpoint sea bueno: eso lo dijo el gate, por categoría y por pedazo. Juntos sí: el gate aprobó el modelo, y la paridad dice que lo que se sirve **es** ese modelo, así que lo que midió el gate sigue valiendo.
:::

## El gate de latencia {The latency gate}

El engine es el mismo modelo. Falta saber si no se volvió más lento. Cada mes el engine se construye de nuevo, y aunque la red es la misma, el build pudo elegir otras tácticas, o alguien cambió el perfil, o la release.

### Qué se mide y con qué

[[perf-analyzer|`perf_analyzer`]] es la herramienta de NVIDIA para medir un servidor Triton desde afuera, como lo haría un cliente. Le manda peticiones a una **tasa fija** (por ejemplo, 250 por segundo, pase lo que pase: una [[carga-abierta|carga abierta]]) y anota cuánto tarda cada una en volver. Esa latencia incluye todo lo que pasa dentro de Triton: la espera en la fila, los 2 ms que Triton espera para juntar un batch y el cómputo en la GPU. Es lo que el gateway va a vivir.

Alba lo corre con la imagen nueva de Triton en la T4 del runner, a dos tasas:

- **250 peticiones por segundo**: la parte de una T4 en el pico de diseño. Alba diseña para 500 fotos por segundo en su pico, repartidas entre sus 2 T4.
- **500 peticiones por segundo**: lo que le toca a una T4 si se cae la otra zona y una sola atiende todo. Cada T4 vive en una [[zona-disponibilidad|zona]] distinta de AWS: un grupo de centros de datos aparte, con su propia luz y su propia red.

A cada tasa mide el [[p99]] (la latencia que el 99 % de las peticiones no rebasa) del challenger y lo compara con el del champion, **medido igual, en el mismo tipo de máquina**. Comparar contra el champion, y no contra un número fijo, cancela todo lo que no es el modelo: la máquina, la red del runner, la versión de `perf_analyzer`.

:::formula Gate de latencia
t_{lim} = (1 + g) × t_{champ}
t_{nuevo} ≤ t_{lim}
ρ = frac{λ}{X}
- t_{champ}: el p99 del champion a esa tasa, en ms
- g: la holgura permitida, como fracción (en Alba, 0.10: hasta 10 % más lento)
- t_{lim}: el p99 más alto que puede tener el challenger para pasar, en ms
- t_{nuevo}: el p99 del challenger a esa tasa, en ms. La segunda línea es la regla: pasa si se cumple a las dos tasas
- λ: la tasa de la prueba, en peticiones por segundo
- X: el máximo que da una T4 con el engine FP16, en fotos por segundo (en Alba, ≈ 1,200)
- ρ: qué fracción de ese máximo usa la prueba (de 0 a 1)
:::

El reporte guarda, además, el máximo de fotos por segundo que alcanzó, cuánta [[vram|VRAM]] usa el engine y cuánto tarda Triton en cargarlo. Ninguno de esos tres bloquea por sí solo, pero un cambio grande se revisa.

Con números de un mes normal (los p99 son supuestos del ejemplo, del orden de lo que tarda Triton en la T4 de Alba):

:::cuenta El gate de latencia de octubre
Champion a 250/s, \(t_{champ}\) // medido por perf_analyzer | — | 9.6 ms
Límite a 250/s, \(t_{lim}\) // \(g\) = 0.10 | \((1 + g) × t_{champ}\) = 1.10 × 9.6 | 10.56 ms
Challenger a 250/s, \(t_{nuevo}\) // medido igual: 9.7 ms | \(t_{nuevo} ≤ t_{lim}\): 9.7 ≤ 10.56 | pasa, sobran 0.86 ms
Champion a 500/s, \(t_{champ}\) // medido por perf_analyzer | — | 12.5 ms
Límite a 500/s, \(t_{lim}\) | 1.10 × 12.5 | 13.75 ms
Challenger a 500/s, \(t_{nuevo}\) // medido igual: 13.1 ms | 13.1 ≤ 13.75 | pasa, sobran 0.65 ms
Uso de la T4 a 250/s, \(ρ\) // \(X\) ≈ 1,200 fotos/s | \(λ ÷ X\) = 250 ÷ 1,200 | ≈ 21 %
Uso de la T4 a 500/s, \(ρ\) | 500 ÷ 1,200 | ≈ 42 %
= El challenger pasa a las dos tasas. Incluso con una zona caída, la T4 usa menos de la mitad de lo que puede dar.
:::

¿Y por qué medir a 500 si a 250 ya pasó? Porque la latencia no crece parejo con la carga: cuando la fila se llena, la cola de la distribución (las peticiones más lentas, las que deciden el p99) crece mucho más que el centro (lo ves en «Utilización: la curva que explota cerca del 100 %», en la lección de latencia). Un engine puede empatar con el champion a media carga y quedarse atrás con la carga doble. El código de abajo lo muestra con latencias simuladas: el challenger tiene casi la misma mediana que el champion, pero una cola más gorda a 500 por segundo.

```python
import math, random

random.seed(11)
def medir(mediana, cola, n=5000):  # n latencias en ms; cola más alta = más peticiones muy lentas
    return [mediana * math.exp(random.gauss(0, cola)) for _ in range(n)]

def p99(xs):                                   # rango más cercano: la latencia número ⌈0.99·n⌉
    xs = sorted(xs)
    return xs[math.ceil(0.99 * len(xs)) - 1]

g = 0.10                                       # holgura: hasta 10 % más lento que el champion
corridas = {250: (medir(6.0, 0.20), medir(6.1, 0.20)),       # (champion, challenger)
            500: (medir(7.5, 0.22), medir(7.7, 0.30))}
for tasa, (champ, nuevo) in corridas.items():
    t_c, t_n = p99(champ), p99(nuevo)
    limite = (1 + g) * t_c
    print(f"{tasa} req/s · champion {t_c:.2f} ms · challenger {t_n:.2f} ms · "
          f"límite {limite:.2f} ms · ¿pasa? {t_n <= limite}")
```

```salida
250 req/s · champion 9.56 ms · challenger 9.71 ms · límite 10.52 ms · ¿pasa? True
500 req/s · champion 12.48 ms · challenger 14.99 ms · límite 13.73 ms · ¿pasa? False
```

A 250 pasa, a 500 no: la mediana del challenger es apenas 3 % mayor (7.7 contra 7.5 ms), pero su cola es más ancha y el p99 sube 20 %. Si el gate midiera solo a 250, ese engine habría pasado, y el día que se cayera una zona el gateway lo habría sentido.

:::calculadora e05-export-latencia
Empieza con el gate de octubre a 500 por segundo. Sube \(t_{nuevo}\) a 15 ms, el del código, y mira el margen volverse negativo. Luego sube \(λ\) para ver cuánto le queda a la T4.
:::

:::nota El 10 % es una decisión
La holgura \(g\) = 0.10 no sale de una ley: es una decisión del equipo de Alba. Es lo bastante grande para no fallar por el ruido de una corrida a otra de `perf_analyzer`, y lo bastante chica para que doce meses de «solo un poco más lento» no se acumulen sin que nadie lo vea, como la [[erosion-calidad|erosión de calidad]] que vigila el gate (muchas bajadas chicas que suman una grande). Como todos los umbrales, vive en el repositorio y cambia en un [[pull-request|PR]] propio: una propuesta de cambio que otra persona revisa.
:::

## Huellas y registro: el final de la estación {Fingerprints and registration: closing the station}

Con la paridad y la latencia en verde, falta lo que convierte un archivo suelto en una versión que se puede rastrear: las **huellas** y el **registro**.

### Las huellas del build

Una [[huella-build|huella del build]] es todo lo que se necesita para saber qué archivo es y con qué se fabricó. En Alba son cuatro datos:

- La huella SHA-256 del ONNX.
- La huella SHA-256 del `.plan`.
- La GPU donde se construyó: T4, sm_75.
- La release de NGC: 24.08, con TensorRT 10.3.

Una [[hash-criptografico|huella SHA-256]] es un número de 256 bits que sale del contenido exacto de un archivo: si cambia un solo byte, sale otro número completamente distinto, y en la práctica nadie puede fabricar un archivo distinto con la misma huella. La lección «Tiempo, hashes e identificadores» lo explica a fondo. Aquí se usa para una cosa muy concreta: que el `.plan` que carga Triton sea **el mismo** que pasó la paridad. Antes de usar el archivo, se le saca su huella y se compara con la que quedó en el registry; si no coinciden, no se usa. El código lo hace con dos archivos de juguete.

```python
import hashlib, json

onnx = b"ONNX de juguete: grafo, pesos y firma"       # en Alba, ≈ 98 MB
plan = b"engine de juguete para una T4"              # en Alba, ≈ 50-150 MB

def sha256(datos):
    return hashlib.sha256(datos).hexdigest()

huellas = {"onnx_sha256": sha256(onnx), "plan_sha256": sha256(plan),
           "gpu": "Tesla T4", "compute_capability": "7.5",
           "ngc_release": "24.08", "tensorrt": "10.3"}
for k, v in huellas.items():
    print(f"{k:<19}", v[:16] + "…" if k.endswith("sha256") else v)

def verificar(datos, esperada):                  # lo que corre antes de usar el archivo
    real = sha256(datos)
    if real != esperada:
        raise SystemExit(f"FALLÓ: huella {real[:12]}… ≠ registrada {esperada[:12]}…")
    print("plan verificado:", real[:12] + "…")

verificar(plan, huellas["plan_sha256"])
verificar(plan + b" ", huellas["plan_sha256"])  # un byte de más: otro archivo
```

```salida
onnx_sha256         d2f2bcccd7f0b0ce…
plan_sha256         de7cdd0692942102…
gpu                 Tesla T4
compute_capability  7.5
ngc_release         24.08
tensorrt            10.3
plan verificado: de7cdd069294…
FALLÓ: huella fecbe1e92280… ≠ registrada de7cdd069294…
```

Un espacio de más dio otra huella, y la verificación detuvo el programa. Así se verifican los pesos al cargarlos en Alba: con su SHA-256, contra lo que dice el registry. La GPU y la release no protegen contra un archivo cambiado: sirven para saber, meses después, por qué un engine no carga en una máquina nueva, y para reconstruirlo igual si hiciera falta.

### Lo que guarda la versión

El registro es el último paso. La versión 14 del modelo `classifier` en el registry (en Alba es [[mlflow|MLflow]], un programa de código abierto para registrar experimentos y modelos) queda con:

- El ONNX y el engine, con la GPU (T4, sm_75) y la release (24.08) como etiquetas (*tags*).
- El `labels.json` (las 500 categorías en el orden de las salidas) con su huella, y la versión del preprocesamiento, 1.4.0.
- La firma de entrada y salida.
- El reporte del gate, el de la paridad y el de la latencia.
- Los punteros de la corrida que la entrenó: el [[snapshot]] de datos (la foto fija del dataset con que entrenó), el [[commit]] del código (su versión exacta en git) y el digest de la imagen de entrenamiento (su huella). Todo eso viene de «Versionado y linaje» y de «Entrenamiento y experimentos».

Y recibe el alias `challenger`. A partir de aquí, el modelo nuevo existe para el resto del sistema: las estaciones siguientes lo sirven, lo empaquetan, lo despliegan y lo prueban con tráfico real. El alias `champion` solo se mueve al final del [[canary]] (la prueba con una parte chica del tráfico real), en «Rollout seguro».

¿Cuánto ocupa? Es una cuenta de multiplicar, con los 24,532,532 parámetros del modelo de Alba:

:::formula Peso de los pesos
S = P × w
- P: parámetros del modelo (en Alba, 24,532,532)
- w: bytes por parámetro (4 en FP32, 2 en FP16)
- S: lo que ocupan los pesos, en bytes
:::

:::cuenta Lo que pesa la versión 14
Pesos en FP32, \(S\) // el ONNX; con la BatchNorm fundida guarda casi lo mismo | 24,532,532 × 4 | ≈ 98.1 MB
Pesos en FP16, \(S\) // dentro del engine | 24,532,532 × 2 | ≈ 49.1 MB
Engine completo // los pesos más lo que agrega TensorRT; se mide al construirlo | ≈ 49 MB y más | ≈ 50–150 MB
Versión completa // ONNX más engine | 98 + (50 a 150) | ≈ 150–250 MB
= Cada mes el registry crece ≈ 150–250 MB. En un año, ≈ 1.8–3 GB: poco, y por eso Alba guarda todas las versiones.
:::

Toda la estación tarda ≈ 20–30 min: el paso del engine ≈ 5–10 (el build en sí, ≈ 2–5), la paridad ≈ 10 y el resto unos minutos. El entrenamiento (el *fine-tune*) tardó ≈ 3–4 h.

## Si algún día fuera INT8 {If it were INT8 someday} [extra]

[[int8|INT8]] guarda cada número en un entero de 8 bits con una escala, la mitad de bytes que FP16. «Cómo guarda números una computadora» explica cómo funciona y por qué hay que **calibrar**. Alba no lo usa, y es buena idea entender por qué antes de proponerlo.

Alba responde ≈ 10 millones de fotos al día (las de las publicaciones más las que piden otros equipos): ≈ 116 por segundo en promedio. Repartidas entre las 2 T4 son ≈ 58 fotos por segundo cada una, de las ≈ 1,200 que pueden dar: el ≈ 5 % de su capacidad. Son 2 y no 1 para que, si se cae una zona, la otra siga atendiendo. INT8 haría cada foto más rápida, pero no quitaría ninguna de las dos: no compraría nada.

Cambiaría con ≈ 10 veces el tráfico. A 5,000 peticiones por segundo, el equipo de Alba estima 10 T4 en FP16 contra 6–7 en INT8. A US$0.526 la hora, una T4 cuesta 0.526 × 730 ≈ US$384 al mes (un mes tiene ≈ 730 horas); quitar 3 o 4 son ≈ US$1,150–1,540 al mes. Ahí sí valdría la pena.

Y si un día pasa, la estación cambia así:

- **Entra un dato más**: las fotos de calibración, ≈ 500–1,000 del tráfico reciente, de todos los [[slice|slices]] y con el preprocesamiento del gateway. Son parte de la receta: se versionan y su huella va con las del build.
- **El umbral de paridad se fija con datos.** INT8 cambia más fotos que FP16, y el 99.5 % puede no ser el número correcto.
- **El examen mira la cola larga.** Una cuantización puede pasar la paridad con 99 % y romper las categorías chicas, porque el promedio las esconde. El examen de INT8 se mira por categoría y por slice, como el gate.

:::ojo
`trtexec --int8` sin datos de calibración **corre**, y el engine sale rápido. Pero sin calibrar, TensorRT no sabe qué escala darle a cada capa, y sus respuestas no valen nada. Es exactamente el tipo de engine que la paridad existe para atrapar.
:::

## Errores comunes {Common mistakes}

:::ojo
**Exportar sin `model.eval()`.** Con el exportador nuevo (y con `torch.export`), la BatchNorm queda con el comportamiento de entrenamiento y el modelo exportado responde otra cosa. El viejo lo corrige solo, así que el error suele aparecer justo al migrar. Evítalo: `eval()` en el script, y la paridad en CPU, que lo atrapa por la diferencia de logits aunque el top-1 coincida.
:::

:::ojo
**Creer el opset que pediste.** Con el exportador nuevo, pedir opset 17 puede dejar el archivo en 18 sin ningún error, a lo más con un aviso en el log. Evítalo: lee el opset del archivo después de exportar y compáralo con el que esperabas.
:::

:::ojo
**Construir el engine en otro lado: en tu laptop o al arrancar el servidor.** En la laptop sale para otra GPU y otra versión de TensorRT, y no carga en producción. Al arrancar, cada réplica tarda minutos más y corre un engine que nadie examinó. Evítalo: un solo build en el runner de CI, con la T4, la release 24.08 y la guardia que aborta en otra GPU, horneado en la imagen.
:::

:::ojo
**Decidir la latencia con `trtexec`.** Mide el engine solo, sin la fila de Triton, y casi siempre con batches que el tráfico de la gente no trae. Evítalo: decide el p99 de `perf_analyzer` contra Triton, a 250 y a 500 por segundo, comparado con el del champion.
:::

:::ojo
**Confundir paridad con calidad.** Pasar la paridad no dice que el modelo sea bueno, y pasar el gate no dice que el engine sea ese modelo. Evítalo: los dos exámenes, en ese orden, y el registro solo con los dos en verde.
:::

## En la vida real {In real life} [extra]

### En Alba

El 1 de octubre de 2026, el pipeline mensual entrena `resnet50-2026-10-01` durante ≈ 3–4 h en una A10G, lo evalúa, y el gate lo aprueba. En ese momento arranca esta estación: el orquestador pide un runner con T4 y corre los siete pasos. El script exporta el ONNX en opset 17, ONNX Runtime lo compara con PyTorch en 512 fotos, `build_engine.sh` revisa que la GPU sea T4 y construye el engine con la imagen 24.08, el engine queda horneado en la imagen de Triton, la paridad corre las ≈ 10,000 fotos, `perf_analyzer` mide a 250 y a 500 por segundo, y las huellas se escriben en la versión 14, que queda como `challenger`. Media hora después, el runner se apaga.

Si algo falla, el paso termina en rojo, avisa a la persona de guardia y el champion sigue atendiendo. Un mes sin modelo nuevo no le cuesta nada a Ana; un engine malo en producción, sí.

### Otros sistemas, la misma estación

- **Video en tiempo real.** Un sistema que analiza las cámaras de un centro de distribución corre su detector en una L4, con un engine FP16 construido con `trtexec` en una L4 y con la misma imagen del servidor de video. Su configuración no le dice al servidor dónde está el ONNX, a propósito: si el engine no corresponde, el servidor **falla** en vez de reconstruirlo en silencio.
- **Inspección en el edge.** En una fábrica, un modelo corre en el *edge*, en el propio aparato y no en la nube: un módulo Jetson de NVIDIA (una computadora chica con GPU) junto a la línea. Ahí el engine se construye **en el propio dispositivo**, con el modo de energía fijo (porque cambia la velocidad del chip y, con ella, las tácticas) y para esa versión exacta del software de Jetson, y sus huellas van al registry igual que las de Alba.
- **Un modelo chico en CPU.** Un modelo de fraude o de texto pequeño puede servirse con ONNX Runtime en CPU, sin GPU y sin engine. La estación se acorta a los pasos 1, 2, 6 y 7: el ONNX es lo que se sirve, y su paridad es FP32 contra FP32.
- **Un LLM propio.** Un servicio que sirve su propio modelo de lenguaje en H100 también compila y cuantiza, pero su paridad no puede ser «el mismo top-1»: el modelo escribe texto. Se compara con los golden sets de cada producto, con métricas de texto, contra la versión en BF16.

### Fuera de ML

Un programa en C se compila para una arquitectura: el binario de una laptop con chip x86 no corre en un teléfono con chip ARM. Por eso las tiendas de apps y los instaladores traen un binario por arquitectura, cada uno compilado y probado aparte. Y una traducción de un contrato se revisa con una **retrotraducción**: otra persona traduce de vuelta al idioma original, sin ver el original, y se comparan los dos. Es una paridad: no dice si el contrato es bueno, dice si la traducción dice lo mismo.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(N\), \(N_{igual}\), \(a_1\), \(o_5\), \(R_i\), \(Q_i\), \(u_{ik}\), \(v_{ik}\), \(d\) (paridad); \(a_{min}\), \(L\), \(f\), \(σ\), \(D\) (cuántas fotos); \(t_{champ}\), \(t_{nuevo}\), \(t_{lim}\), \(g\), \(λ\), \(X\), \(ρ\) (latencia); \(P\), \(w\), \(S\) (peso).

:::ejercicios
? [facil] ¿Cuánto pesan los pesos del modelo de Alba en FP16? ¿Y en INT8, con 1 byte por parámetro? ¿Por qué el engine completo puede pesar más que eso?
- \(S = P × w\), con \(P\) = 24,532,532.
- FP16: 24,532,532 × 2 = 49,065,064 B ≈ **49.1 MB**.
- INT8: 24,532,532 × 1 ≈ **24.5 MB**. Un archivo INT8 real pesa un poco más, porque guarda escalas y deja algunas partes en más bits: Alba lo estima en ≈ 25.1 MB.
- El engine guarda, además de los pesos, los kernels elegidos, el perfil, y a veces pesos repetidos en el formato que pide cada táctica. Por eso Alba lo estima en ≈ 50–150 MB y lo mide al construirlo.
? [facil] ¿Qué paridad atrapa cada bug: (a) el gateway pasa la foto con los colores en orden BGR (azul, verde, rojo) en vez de RGB (rojo, verde, azul); (b) el ONNX quedó con el batch fijo en 2; (c) una capa del engine se desborda en FP16?
- (a) Solo la de **punta a punta, por el gateway**: las otras dos reciben la foto ya preparada con el preprocesamiento correcto.
- (b) La de **CPU con ONNX Runtime**: el chequeo corre batch 1 y 32, y los dos fallan con un batch fijo en 2.
- (c) La del **engine en Triton**: el ONNX en FP32 está bien, así que la de CPU pasa; el engine FP16 es el que se rompe.
? [medio] En noviembre, el champion da \(t_{champ}\) = 12.5 ms de p99 a 500 por segundo y el challenger, \(t_{nuevo}\) = 13.9 ms. A 250 por segundo los dos dan 9.6 ms. Con la holgura \(g\) = 0.10, ¿pasa el gate? ¿Qué revisarías primero? Y si una T4 da \(X\) ≈ 1,200 fotos por segundo, ¿qué fracción de ella usa la prueba de 500, y cuál el promedio real de Alba, ≈ 58 por segundo por T4?
- \(t_{lim} = (1 + g) × t_{champ}\) = 1.10 × 12.5 = 13.75 ms.
- 13.9 > 13.75: **falla a 500**, aunque a 250 empate. No se registra y sigue el champion.
- Primero, si cambió algo del build: el perfil (¿óptima 16 o 4?), la release, la imagen. Luego, repetir la medición: si la segunda da 13.2, era ruido de la prueba, y ajustar la holgura o cuántas peticiones se miden va en un PR propio.
- \(ρ = λ ÷ X\): 500 ÷ 1,200 ≈ **42 %**; el promedio, 58 ÷ 1,200 ≈ **5 %**. Por eso INT8 no compra nada hoy: las T4 sobran.
? [facil] Dos fotos, tres categorías. Referencia: foto 1 con logits (4.10, 1.20, 0.50), foto 2 con (2.00, 1.99, −1.00). Engine: foto 1 con (4.11, 1.19, 0.50), foto 2 con (1.99, 2.00, −1.01). Calcula \(a_1\) y \(d\). ¿Qué pasaría con estos números en el examen de Alba?
- \(a_1 = N_{igual} ÷ N\) y \(d = max |u_{ik} − v_{ik}|\), con \(N\) = 2.
- Foto 1: top-1 en las dos es la categoría 1 (4.10 y 4.11). Foto 2: la referencia da la 1 (2.00), el engine la 2 (2.00 contra 1.99): **cambió**. Así, \(N_{igual}\) = 1.
- \(a_1\) = 1 ÷ 2 = **50 %**.
- \(d\) = la mayor de |4.10 − 4.11| = 0.01, |1.20 − 1.19| = 0.01, 0, |2.00 − 1.99| = 0.01, |1.99 − 2.00| = 0.01 y |−1.00 − (−1.01)| = 0.01: **0.01**, normal para FP16.
- Con 2 fotos, un empate tumba el \(a_1\). En el examen de 10,000, esa foto sería 1 de las 50 permitidas, y \(d\) = 0.01 está muy por debajo de 0.5: pasaría.
? [medio] En una foto, la referencia sugiere (Tenis, Botas, Sandalias, Mocasines, Pantuflas) y el engine (Tenis, Botas, Mocasines, Sandalias, Zapatos de vestir). ¿Cuánto aporta esa foto a \(o_5\)? Si de 10,000 fotos 9,900 coinciden en sus 5 y 100 son como esta, ¿cuánto vale \(o_5\)?
- \(o_5 = frac{1}{N} × sum |R_i ∩ Q_i| ÷ 5\): cada foto aporta la fracción de sus 5 sugerencias que coinciden.
- \(R_i ∩ Q_i\) = {Tenis, Botas, Sandalias, Mocasines}: 4 de 5. El orden no importa para \(o_5\). Aporta 4/5 = **0.8**.
- \(o_5\) = (9,900 × 1 + 100 × 0.8) ÷ 10,000 = (9,900 + 80) ÷ 10,000 = **99.8 %**, arriba del 99 %.
? [medio] El equipo de plataforma actualiza la imagen de Triton de producción a una release más nueva, con otra versión de TensorRT, y no reconstruye el engine. ¿Qué pasa al desplegar? ¿Qué debió pasar antes?
- El engine de TensorRT 10.3 no carga en la versión nueva: Triton se detiene al arrancar, el pod nuevo queda reiniciándose y el despliegue (el *rollout*) se detiene. Los pods viejos siguen sirviendo, así que nadie lo nota afuera.
- Antes: subir de release es un cambio del modelo, no solo del servidor. Se cambia `NGC_RELEASE` en el build, se construye un engine nuevo en la T4 con esa release, y pasa su paridad y su latencia como cualquier mes.
? [reto] Con la fórmula de \(D\), compara un examen de 2,000 fotos con el de 10,000 para el engine sano (\(f\) = 0.2 %). ¿Cuál es más confiable y por qué el de Alba es de 10,000?
- \(L = (1 − a_{min}) × N\), \(σ = sqrt{N × f × (1 − f)}\) y \(D = (L − N × f) ÷ σ\), con \(a_{min}\) = 0.995 y \(f\) = 0.002.
- Con 2,000: \(L\) = 0.005 × 2,000 = 10; esperadas \(N × f\) = 2,000 × 0.002 = 4; \(σ\) = \(sqrt{2,000 × 0.002 × 0.998}\) ≈ 2.0; \(D\) = (10 − 4) ÷ 2.0 ≈ **3.0**.
- Con 10,000: \(D\) ≈ **6.7** (la cuenta de la lección).
- Las dos pasan casi siempre al engine sano, pero el de 2,000 queda justo en el borde de las 3 desviaciones: con un engine que cambie un poco más (\(f\) = 0.3 %), \(D\) baja a (10 − 6) ÷ 2.45 ≈ 1.6 (con \(σ\) = \(sqrt{2,000 × 0.003 × 0.997}\) ≈ 2.45) y empieza a fallar por mala suerte. Con 10,000, \(D\) crece con la raíz de \(N\): el examen distingue mejor lo sano de lo roto, y los 10 minutos de paridad son baratos.
? [reto] La paridad del engine da \(a_1\) = 97 % y \(d\) = 3.4. ¿Cómo buscas el bug? Escribe los pasos y qué conclusión sacas de cada resultado posible.
- 97 % son ≈ 300 de 10,000 fotos, y \(d\) = 3.4 es 340 veces lo normal en FP16 (≈ 0.01): es un bug, no redondeo.
- Paso 1: corre el mismo examen con el ONNX en ONNX Runtime, FP32. Si da ≈ 97 % también, el bug está en el **export**: revisa `eval()`, el opset del archivo y si cambió el exportador o su versión.
- Si el ONNX da ≈ 100 % y \(d\) ≈ 0.0001, el bug está en el **build**: compara las salidas de cada capa entre el ONNX y el engine hasta encontrar la primera que diverge; casi siempre es una que pasa del máximo de FP16 (≈ 65,504). Se deja en FP32 y se construye de nuevo.
- En los dos casos, no se registra nada y el champion sigue.
:::

## Lo que sigue {What comes next}

- «Código de serving» toma el contrato que fijó esta estación (`input` FP32 de `[3, 224, 224]` por foto, `logits` de 500, batch hasta 32) y escribe el `config.pbtxt` de Triton y el gateway que lo usa.
- «Empaquetado con Docker» cuenta cómo se arma esa imagen: capas, digest y tag. «CI/CD y registro de imágenes» corre la tercera paridad, de punta a punta por el gateway real, antes de staging.
- «Kubernetes» manda cada imagen al tipo de GPU de su engine, y «Rollout seguro» prueba al `challenger` con tráfico real antes de moverle el alias `champion`.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
onnx opset grafo-modelo eje-batch-dinamico onnx-runtime tensorrt engine-tensorrt fusion-capas perfil-optimizacion trtexec compute-capability release-ngc paridad-engine acuerdo-top1 diferencia-logits perf-analyzer huella-build
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué guarda un archivo ONNX, y por qué Alba lee el opset del archivo después de exportar?
El grafo de operadores, los pesos y la firma (nombres, tipos y formas de la entrada y la salida). Lee el opset porque el exportador puede escribir otro distinto al pedido sin dar error, y el opset es parte del contrato con quien lo lee.
? ¿Por qué el engine de Alba no carga en una L4?
Porque TensorRT eligió y cronometró sus kernels para la T4 (sm_75), y la L4 es otra arquitectura (sm_89). También dejaría de cargar con otra versión de TensorRT.
? ¿Qué mide cada uno de los tres números de la paridad del engine?
\(a_1\): en qué fracción de fotos coincide la primera sugerencia. \(o_5\): qué fracción de las 5 sugerencias coincide, en promedio. \(d\): la diferencia más grande entre un logit del engine y el de PyTorch, que delata un bug antes de que cambie una respuesta.
? ¿Por qué el examen del engine es de ≈ 10,000 fotos y no de 512?
Porque FP16 sí cambia algunas fotos casi empatadas. Con 512 solo caben 2 cambios: un engine sano fallaría por mala suerte y uno roto podría pasar. Con 10,000 caben 50, y el margen entre lo sano y lo roto es de varias desviaciones.
? ¿Por qué el gate de latencia usa `perf_analyzer` y no `trtexec`, y por qué mide a 500 por segundo?
`trtexec` mide el engine solo, sin la fila ni el batching de Triton. `perf_analyzer` mide como un cliente, a tasa fija. A 500 porque es la carga de una T4 con una zona caída, y la cola de la latencia crece más rápido que el centro.
? ¿Cuándo queda registrada la versión como `challenger`, y qué se guarda con ella?
Al final de esta estación, con la paridad y la latencia en verde. Se guardan el ONNX y el engine con sus huellas SHA-256, la GPU y la release, el `labels.json` con su huella, la versión del preprocesamiento, la firma, los reportes y los punteros de la corrida.
:::
