---
titulo: Entrenamiento y experimentos
en: Training and experiments
subtitulo: La estación 3 de Alba de principio a fin: entrenar el modelo del mes en una GPU que se prende y se apaga, sobrevivir a una caída sin empezar de cero, dejar cada corrida registrada y saber si una diferencia de 0.2 puntos es una regresión o es ruido.
pregunta: El día 1 de cada mes, Alba entrena un modelo nuevo durante unas horas. ¿Cómo se hace para que esa corrida no se pierda si se cae la máquina, para que dentro de un año alguien pueda decir con qué se entrenó, y para saber si salió peor de verdad o solo por azar?
requisitos: aprender, pytorch, e02-versionado, maquinas, ruido
---

:::idea
Entrenar en producción no es correr un script: es un trabajo que se lanza solo, en una máquina que existe unas horas, que guarda su avance para sobrevivir a una caída y que deja anotado todo lo que hace falta para contestar «¿con qué se entrenó?». Al final no sale un modelo «mejor»: sale un candidato con su corrida registrada, y una regla escrita para saber si una diferencia es real o es ruido.
:::

Alba es la empresa que seguimos en todo el curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y le sugiere a quien vende la categoría de cada foto entre 500 posibles. La sugerencia la da una [[resnet|ResNet-50]] de ≈ 24.5 millones de [[parametro|parámetros]], servida en 2 [[gpu|GPUs]] T4. El equipo de ML son 5 personas, y el modelo se reentrena cada mes.

Las piezas de esta lección ya las conoces de otras. Aquí solo se recuerdan:

- Entrenar es repetir un [[paso]]: tomar un [[batch]] de fotos, medir la [[loss|pérdida]] (qué tan mal va el modelo), calcular el [[gradiente]] y mover los pesos un poco. Una [[epoch|época]] es una pasada por todas las fotos. Lo ves en «Cómo aprende un modelo».
- Un [[checkpoint]] es un archivo con todo el estado del entrenamiento en un momento: pesos, estado del optimizador, paso y azar. En Alba pesa ≈ 294 MB.
- El [[snapshot]] del mes es la lista fija de qué fotos y con qué etiqueta se entrena. Lo arma la estación anterior, «Versionado y linaje», con su id y su huella: un [[hash-criptografico|hash]] SHA-256 de todas sus filas, un código que cambia si cambia una sola fila.
- Una [[reproducibilidad|corrida reproducible]] depende de cinco ingredientes: código, datos, configuración, entorno y azar.

A cada paso del sistema que arma un modelo le decimos **estación**, como en una línea de producción. Esta es la tercera: recibe el snapshot y entrega un modelo candidato. Vas a ver qué entra, qué sale, cada decisión con su número, cómo se comprueba que salió bien y qué se rompe cuando sale mal.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

El 1 de octubre de 2026, a las 03:00 [[utc|UTC]], el [[orquestador-pipelines|orquestador]] de Alba arranca el [[pipeline]] del mes. Es Argo Workflows, un programa que lanza los pasos en orden. Corre en el cluster de Kubernetes de Alba: el grupo de máquinas donde viven sus programas, y Kubernetes es el sistema que decide en cuál corre cada uno. Ese día arma `ds-2026-09-01`, el snapshot de septiembre, y entrena con él el modelo `resnet50-2026-10-01`. El pipeline completo tiene ocho pasos:

> validar datos → armar snapshot → **fine-tune** → evaluar → gate → engine → paridad → registrar

Los cinco últimos vienen después de esta estación: «evaluar» mide al candidato en el examen fijo, el «gate» decide si es seguro probarlo, «engine» lo convierte a la versión rápida que corre en la T4, «paridad» comprueba que esa versión responda igual y «registrar» lo anota en el catálogo de modelos.

Esta estación es el tercero, el *fine-tune*: el [[fine-tuning|ajuste fino]] de una red que ya sabe ver fotos para que aprenda las 500 categorías de Alba. Es, con mucho, el paso más largo: ≈ 3–4 horas de las ≈ 4–5 que tarda todo.

### Lo que entra

- **El id del snapshot**, `ds-2026-09-01`, como parámetro. Con él vienen su huella (`rows_sha256`, el hash de sus filas) y sus 1,932,628 filas: 1,840,211 fotos de entrenamiento ([[train-set|train]]) y 92,417 de [[validation-set|validación]]. La estación no elige datos: lee los que le dicen.
- **El código**, en un [[commit]] exacto del repositorio `ml-catalogo`: en el ejemplo, `c3f2fc2`.
- **La receta**: el archivo de configuración con los [[hiperparametro|hiperparámetros]]. Lo verás en la sección siguiente.
- **La imagen de entrenamiento**, por su [[digest-imagen|digest]]. Aquí «imagen» no es una foto: es la imagen de un [[contenedor]], el paquete con Python, PyTorch, [[cuda|CUDA]] y todas sus versiones exactas. El digest es su huella SHA-256 (en el ejemplo, `sha256:b71e04d2…`, de juguete).
- **Los pesos de partida**: los de una ResNet-50 entrenada con ImageNet, una colección pública de millones de fotos. No los del modelo actual; la razón también va en la sección siguiente.

### Lo que sale

- **Un checkpoint candidato**: los pesos finales, guardados en S3, el [[object-storage|almacén de archivos]] de la nube de Amazon (AWS) que usa Alba.
- **Una corrida registrada** en MLflow, la herramienta donde Alba anota cada entrenamiento: sus parámetros, sus métricas época por época, sus archivos y sus punteros (los ids exactos del snapshot, el commit y la imagen con que se entrenó). Es la [[corrida]] de la sección 6.

La estación **no despliega nada**. Su salida es un candidato. Si es mejor que el modelo actual lo decide la estación siguiente, «Gate de evaluación y registry»; esta solo entrega algo que vale la pena examinar.

### Lo que se decide

:::pasos
1. Con qué receta y desde qué código
La configuración vive en el repositorio y el código debe estar limpio, sin cambios a medias.
2. Si el código está sano antes de gastar GPU
Una prueba de un minuto que corre en cada commit.
3. Dónde corre y cuánto cuesta
Una GPU que se crea para la corrida y se apaga al terminar.
4. Qué hacer si se cae
Cada cuánto guardar, cuántas veces reintentar y qué debe traer el checkpoint para seguir donde iba.
5. Qué se anota
Lo que hace falta para contestar dentro de un año «¿con qué se entrenó?».
6. Cuándo una diferencia es real
La regla para leer dos corridas sin confundir ruido con regresión.
:::

Nadie aprieta un botón. El orquestador lanza todo; una persona del equipo mira la pantalla de MLflow al día siguiente, o recibe el aviso de «pipeline fallido» si algo se rompió.

:::diagrama e03-entrenamiento-estacion
La estación 3 completa. Toca cada caja para ver por qué está ahí; el recorrido sigue la corrida del 1 de octubre.
:::

## La receta, el commit limpio y desde dónde se arranca {The recipe, the clean commit and where to start}

### La receta: una configuración versionada

La [[receta-entrenamiento|receta de entrenamiento]] (*training recipe*) son todos los números y decisiones que no aprende el modelo, sino que se le dan: el optimizador, el [[learning-rate|learning rate]], el tamaño del batch, cuántas épocas, la [[semilla]], la [[precision-mixta|precisión mixta]], las [[augmentation|variaciones al azar]] de las fotos, cuántos procesos cargan datos.

La de Alba es fija:

| Ingrediente | Valor | Qué controla |
|---|---|---|
| Optimizador | [[adam\|Adam]] | cómo se usa el gradiente para mover cada peso |
| Learning rate | 3e-4 (0.0003) | qué tan grande es cada paso |
| Batch | 64 fotos | cuántas fotos ve en cada paso |
| Épocas | 8 | cuántas pasadas por las 1,840,211 fotos |
| Semilla | 17 | con qué número arranca el azar |
| Precisión | mixta (FP16 y FP32) | qué cuentas van en 16 bits para ir más rápido |
| Workers del [[dataloader\|DataLoader]] | 8 | cuántos procesos leen y preparan fotos a la vez |

De ahí sale el tamaño del trabajo: 1,840,211 ÷ 64 = 28,753.3, que se redondea hacia arriba a **28,754 pasos por época** (el último batch va incompleto). Por 8 épocas: **230,032 pasos**, y 1,840,211 × 8 = **14,721,688 fotos** procesadas.

¿Por qué es un archivo y no unos números escritos en el código, o tecleados al lanzar? Porque la receta es **parte del modelo**. Si dentro de seis meses el modelo de octubre tiene un problema, la primera pregunta es «¿con qué se entrenó?», y «lr 3e-4, creo» no es respuesta. Un archivo en el repositorio tiene tres ventajas:

- **Vive en el mismo commit que el código.** Un commit fija los dos a la vez.
- **Un cambio pasa por revisión.** Subir el learning rate es un cambio de código como cualquier otro, con su autor, su fecha y su motivo.
- **Se copia completo a la corrida.** Cada número de la receta queda también como parámetro en MLflow, para buscarlo y comparar sin abrir el repositorio.

Así se ve, como **ilustración**, en un archivo [[yaml|YAML]] (el nombre del archivo y sus claves son de ejemplo):

```yaml
# ml-catalogo/model/receta.yaml — cambia solo con un pull request
optimizador: adam
lr: 3.0e-4
batch: 64
epocas: 8
semilla: 17
precision: mixta          # FP16 donde se puede, FP32 donde hace falta
dataloader_workers: 8
augmentations: [recorte_aleatorio, volteo_horizontal]
pesos_iniciales: imagenet  # no el modelo actual: ver «Desde dónde se arranca»
preproceso: "1.4.0"        # el mismo de la evaluación y del servicio
```

La última línea importa. Antes de entrar al modelo, cada foto se gira según su [[exif|EXIF]], se achica a 256 píxeles, se recorta a 224 × 224 y se normaliza: es el [[preprocesamiento]]. Alba tiene **un solo** archivo que lo hace, en la versión 1.4.0, y lo importan el entrenamiento, la evaluación y el servicio. Si el entrenamiento achicara las fotos de otra forma que el servicio, el modelo vería en producción fotos un poco distintas de las que aprendió, sin un solo error en los logs. Es el [[training-serving-skew|training-serving skew]] de «Una foto, vista por un modelo».

### El árbol limpio

El commit dice qué código había **guardado** en el repositorio. Pero el programa corre lo que hay **en el disco** en ese momento. Si alguien editó un archivo y no hizo commit, los dos no coinciden.

A eso se le llama tener el árbol de trabajo «sucio». El [[arbol-limpio|árbol limpio]] (*clean working tree*) es lo contrario: cada archivo en el disco es idéntico al del commit. `git status --porcelain` lo dice en una línea: si no imprime nada, el árbol está limpio.

La trampa es que MLflow, al registrar una corrida que se lanza desde un repositorio de Git, anota el commit **aunque haya cambios sin commit**, y no avisa. La corrida dirá `c3f2fc2`, pero el código que corrió no es el de `c3f2fc2`. El ejemplo de abajo lo muestra con un cambio de una línea, de los que se olvidan: un filtro que alguien puso para probar algo y nunca quitó, `df = df[df.label != 17]`, que saca del entrenamiento todas las fotos de una categoría.

```python
import hashlib, json

def huella(texto):                          # SHA-256 del contenido, recortada a 12 caracteres
    return hashlib.sha256(texto.encode()).hexdigest()[:12]

guardado = "df = cargar('ds-2026-09-01')\nentrenar(df, receta)\n"     # lo que tiene el commit c3f2fc2
en_disco = "df = cargar('ds-2026-09-01')\ndf = df[df.label != 17]\nentrenar(df, receta)\n"
receta = {"optimizador": "adam", "lr": 3e-4, "batch": 64, "epocas": 8, "semilla": 17}

etiqueta_mlflow = {"git_commit": "c3f2fc2"}              # lo único que anota sobre el código
sucio = huella(guardado) != huella(en_disco)             # lo que diría git status --porcelain
print("commit anotado:", etiqueta_mlflow["git_commit"])
print("código del commit:", huella(guardado), "· código que corrió:", huella(en_disco))
print("árbol limpio:", not sucio, "→", "falla el paso" if sucio else "entrena")
print("huella de la receta:", huella(json.dumps(receta, sort_keys=True)))
```

```salida
commit anotado: c3f2fc2
código del commit: 09a19471fc3c · código que corrió: b441e4068f81
árbol limpio: False → falla el paso
huella de la receta: 27b7548a3770
```

La corrida diría «`c3f2fc2`» y nadie sospecharía. Dentro de un año, alguien vuelve a entrenar desde `c3f2fc2` y le sale otro modelo, con una categoría que sí sabe reconocer.

La regla de Alba tiene dos partes:

- **Las candidatas se entrenan solo desde el pipeline.** El pipeline descarga una copia nueva del repositorio en el commit pedido, así que no puede tener cambios a medias.
- **Y aun así lo comprueba.** El primer comando del paso es `git status --porcelain`; si no sale vacío, el paso falla antes de prender la GPU.

Las pruebas a mano, desde la laptop o desde un [[notebook]], siguen existiendo. Sirven para explorar. Pero nada que salga de ahí llega a ser candidato: para eso hay que hacer commit y dejar que el pipeline lo entrene.

### Desde dónde se arranca

Hay dos formas de empezar el fine-tune del mes:

- **Desde ImageNet**, cada vez. La red empieza con los pesos que aprendió de las fotos públicas (formas, texturas, bordes) y una [[cabeza]] nueva de 500 salidas. Aprende las categorías de Alba desde ahí, con el snapshot del mes completo.
- **Desde el modelo actual**, el que está en producción. A eso se le llama [[warm-start|arranque desde el champion]] (*warm start*): «champion» es el modelo que hoy atiende a la gente, y se arranca con sus pesos para afinarlo con los datos nuevos.

Arrancar del champion suele ser más barato: el modelo ya sabe casi todo y bastan menos épocas. ¿Por qué Alba no lo hace? Por el [[linaje]]: la cadena de qué salió de qué.

- **Desde ImageNet**, el modelo de octubre depende de tres cosas: su snapshot, su commit y su imagen. Para repetirlo basta con esas tres.
- **Desde el champion**, el de octubre depende además del de septiembre, que dependía del de agosto, y así hasta el primero. Para repetir el de octubre necesitas toda la cadena. Y si el de junio aprendió algo mal (por ejemplo, de una tanda de etiquetas que luego se supo que estaban mal), ese error sigue adentro de todos los que vinieron después.

Hay un tercer motivo, más práctico: una corrida de Alba cuesta unos pocos dólares (la cuenta va en la sección 4). Ahorrar la mitad de eso no vale encadenar los meses. El arranque desde el champion tiene sentido cuando entrenar desde el principio cuesta días o miles de dólares, o cuando el modelo debe actualizarse cada hora; no es el caso de Alba.

:::ojo
No confundas arrancar desde el champion con reanudar. Alba arranca cada mes desde ImageNet. Lo que sí se carga a media corrida es el checkpoint **de la misma corrida**, para seguir después de una caída (sección 5).
:::

## Antes de gastar GPU: sobreajustar un batch {Before spending GPU: overfit one batch}

Un error en el código de entrenamiento puede tardar horas en notarse. Imagina que alguien desconecta sin querer el optimizador de los pesos: el programa corre, imprime números, gasta las 4 horas y al final el modelo no aprendió nada. O que las fotos y sus etiquetas se desalinean al cargar: el modelo aprende ruido.

La defensa es una [[prueba-humo|prueba de humo]] muy específica: [[prueba-humo-entrenamiento|sobreajustar un batch]] (*overfit one batch*). Tomas un solo batch, 32 fotos, y entrenas con él una y otra vez. Un modelo sano, con millones de parámetros y solo 32 fotos, **tiene que memorizarlas**: la pérdida debe bajar casi a cero y acertar las 32. Es lo que en otro momento sería un problema (el [[overfitting]]), usado a propósito como prueba.

Si no las memoriza, algo está roto: el optimizador no recibe los pesos, el gradiente no llega, el learning rate es cero, las etiquetas no corresponden a sus fotos. Ninguno de esos errores tira el programa. Todos se ven en un minuto.

Hay una segunda revisión gratis, en el primer paso: la pérdida al inicio. Si la cabeza del modelo empieza sin saber nada, reparte la probabilidad casi igual entre todas las categorías, y la [[entropia-cruzada|entropía cruzada]] de una foto es menos el logaritmo de la probabilidad que le dio a la correcta:

:::formula Pérdida al empezar, sin saber nada
L_0 ≈ −ln(frac{1}{K}) = ln(K)
- K: cuántas categorías hay
- L_0: la pérdida promedio en el primer paso, en nats (la unidad del logaritmo natural)
:::

Con las 500 categorías de Alba, \(L_0\) ≈ ln 500 ≈ 6.21. Si el primer paso da 0.5, el modelo «sabe» demasiado para no haber aprendido nada: quizás la etiqueta se coló entre los datos de entrada. Si da 40, algo está mal en la escala de los [[logit|logits]] (los puntajes crudos por categoría) o en la cabeza. Es un número aproximado, no una regla exacta: sirve para atrapar errores grandes.

El programa de abajo hace las dos revisiones con un modelo de juguete: 32 «fotos» de 40 números cada una y \(K\) = 4 categorías, entrenadas con [[softmax]] y descenso de gradiente. Primero con el código sano; luego con el learning rate en cero, que es lo que pasa cuando el optimizador no recibe los pesos.

```python
import math, random
rnd = random.Random(17)
K, D = 4, 40                                     # 4 categorías de juguete, 40 números por «foto»
fotos = [[rnd.gauss(0, 1) for _ in range(D)] for _ in range(32)]   # un solo batch de 32
labels = [rnd.randrange(K) for _ in range(32)]

def entrenar(lr, pasos=300):
    W = [[0.0] * D for _ in range(K)]            # pesos en cero: al inicio, las 4 iguales
    for paso in range(pasos + 1):
        perdida, aciertos, grad = 0.0, 0, [[0.0] * D for _ in range(K)]
        for x, y in zip(fotos, labels):
            z = [sum(w * xi for w, xi in zip(W[k], x)) for k in range(K)]       # logits
            m = max(z); e = [math.exp(zk - m) for zk in z]; prob = [ek / sum(e) for ek in e]
            perdida -= math.log(prob[y]) / 32; aciertos += prob.index(max(prob)) == y
            for k in range(K):
                for j in range(D):
                    grad[k][j] += (prob[k] - (k == y)) * x[j] / 32
        if paso in (0, pasos):
            print(f"  lr {lr}: paso {paso:3} · pérdida {perdida:.3f} · aciertos {aciertos}/32")
        W = [[W[k][j] - lr * grad[k][j] for j in range(D)] for k in range(K)]

print("ln K =", round(math.log(K), 3))
entrenar(lr=0.5)                                 # el código sano memoriza el batch
entrenar(lr=0.0)                                 # un optimizador que no recibe los pesos
```

```salida
ln K = 1.386
  lr 0.5: paso   0 · pérdida 1.386 · aciertos 6/32
  lr 0.5: paso 300 · pérdida 0.010 · aciertos 32/32
  lr 0.0: paso   0 · pérdida 1.386 · aciertos 6/32
  lr 0.0: paso 300 · pérdida 1.386 · aciertos 6/32
```

El paso 0 da exactamente ln 4 = 1.386, porque los pesos en cero reparten 1/4 a cada categoría. (Los 6 aciertos del inicio son las fotos de la categoría 0: con un empate, el programa elige la primera.) El código sano llega a 0.010 y acierta las 32. El roto no se mueve en 300 pasos, y no da ningún error.

En Alba, la prueba corre en el [[runner-ci|runner]] de [[ci|CI]] (la máquina que corre las pruebas en cada cambio), con la ResNet-50 de verdad y 32 fotos fijas: pide que la pérdida baje a casi cero en menos de un minuto. Corre en **cada commit** que toca el código de entrenamiento. Un minuto de CI contra 4 horas de GPU tiradas: es la prueba más barata de toda la estación.

:::nota Lo que no atrapa
Sobreajustar un batch prueba que el código **puede** aprender. No prueba que aprenda **bien**: un preprocesamiento distinto del servicio, una augmentation exagerada o una mala receta pasan esta prueba sin problema. Eso lo ven la curva de la sección 6 y el gate de la estación siguiente.
:::

## El job: una GPU que se prende y se apaga {The job: a GPU that turns on and off}

### Dónde corre

El fine-tune corre como un [[job-entrenamiento|job de entrenamiento]] (*training job*): un programa que arranca, hace su trabajo y termina, en una máquina que existe solo mientras dura. En Alba es un [[pod]] de Kubernetes: un contenedor corriendo en una máquina del cluster.

La máquina es una **g5.xlarge** de AWS: una GPU NVIDIA A10G con 24 GB de [[vram|VRAM]] (la memoria de la GPU), 4 [[vcpu|vCPU]] y 16 GiB de RAM, rentada [[on-demand]] (por hora, sin compromiso) a ≈ US$1.006 la hora. Cuando el orquestador lanza el paso, el cluster pide un [[nodo]] g5.xlarge, el pod corre ahí y, al terminar, el nodo se apaga. Nadie deja una GPU prendida «por si acaso».

¿Por qué no entrena en una de las T4 que sirven a la gente? Por dos razones:

- **Las T4 de producción tienen trabajo.** Atienden ≈ 10 millones de fotos al día: las ≈ 7.5 millones de las publicaciones nuevas más las que piden otros equipos. Meterles un entrenamiento les quita memoria y tiempo justo a lo que no puede esperar.
- **La T4 es lenta para entrenar.** El equipo de Alba estima ≈ 400 fotos por segundo en una T4: 14,721,688 fotos ÷ 400 ≈ 36,800 s, unas **10 horas**. Para la A10G, con precisión mixta, estima ≈ 1,000–1,400 fotos por segundo (1,022 y 1,363 en la cuenta de abajo): las mismas fotos en 3–4 horas. Son estimados del ejemplo, no mediciones: AWS anuncia para esta GPU hasta 3.3 veces la velocidad de entrenamiento de la T4, que es lo que da pasar de 400 a ≈ 1,300, y con solo 4 vCPU leyendo y preparando fotos, la carga de datos puede frenar antes que la GPU. El número real se mide en la primera corrida.

¿Y la memoria? Entrenar la ResNet-50 con batch de 64 ocupa ≈ 3.4 GB de VRAM: ≈ 392 MB fijos (pesos, gradientes y Adam) más ≈ 3 GB de activaciones, lo que cada capa guarda para el [[backpropagation|backpropagation]] (la cuenta está en «Cómo aprende un modelo»). Cabe de sobra en los 24 GB de la A10G: no hace falta repartir el entrenamiento entre varias GPUs.

### Cuánto tarda y cuánto cuesta

:::formula Tiempo y costo de una corrida
t_f = frac{N × E}{3600 × v}
C = (t_f + t_e) × p
- N: fotos de entrenamiento del snapshot
- E: épocas de la receta
- v: fotos que la GPU procesa por segundo al entrenar, en fotos/s
- t_f: horas del fine-tune (3,600 segundos en una hora)
- t_e: horas del paso de evaluar, que corre en la misma GPU después del fine-tune
- p: precio de la máquina por hora, en US$/h
- C: costo de GPU de una corrida, en US$
:::

:::cuenta Una corrida de Alba en la A10G
Fotos de train, \(N\) // del snapshot `ds-2026-09-01` | | 1,840,211
Épocas, \(E\) // de la receta | | 8
Fotos procesadas, \(N × E\) | 1,840,211 × 8 | 14,721,688
Velocidad, \(v\) // estimado del equipo para la A10G, de 1,000 a 1,400 fotos/s; dos extremos | lenta · rápida | ≈ 1,022 · ≈ 1,363 fotos/s
Fine-tune, \(t_f\) // \(N × E ÷ (3,600 × v)\) | 14,721,688 ÷ (3,600 × 1,022) · ÷ (3,600 × 1,363) | ≈ 4 h · ≈ 3 h
Evaluar, \(t_e\) // el paso «evaluar» del pipeline, en la misma A10G | ≈ 15 min | 0.25 h
Precio, \(p\) // g5.xlarge on-demand | | US$1.006/h
Costo, \(C\) // \((t_f + t_e) × p\) | (3 + 0.25) × 1.006 · (4 + 0.25) × 1.006 | ≈ US$3.3 · ≈ US$4.3
= Una corrida cuesta ≈ US$3.3 a 4.3 de GPU: unos US$4. Al mes, Alba corre la candidata y entre ≈ 2 y 10 corridas de prueba (cambios de receta, la prueba de reproducibilidad, reintentos), así que entre 3 y 11 corridas: ≈ US$10 a 50 al mes (3 × 3.27 ≈ 9.8 y 11 × 4.28 ≈ 47).
:::

Pon esa cifra junto a otras de Alba. Las 2 T4 que sirven cuestan ≈ US$768 al mes (US$0.526 la hora cada una, todo el mes); las ≈ 5,000 fotos al mes que se pagan por etiquetar, ≈ US$275–550 al mes. **Entrenar es lo más barato del sistema.** Lo caro de esta estación no es la GPU: es una persona revisando una corrida rara, y un modelo malo que llega a producción.

:::calculadora e03-entrenamiento-costo
Empieza con la corrida de la cuenta, en el caso lento. Baja \(v\) a 400 (la T4 de producción): \(t_f\) pasa de 4 a ≈ 10 horas. Luego sube \(N\) a 20 millones: así se vería el entrenamiento con diez veces más fotos.
:::

:::profundo Spot: la cuenta antes de venderlo
Una máquina [[spot]] es capacidad sobrante que la nube renta con descuento y puede quitarte con un [[aviso-interrupcion|aviso]] de 2 minutos en AWS. «Máquinas, GPUs y cómo se cobran» explica qué cabe en spot: lo que se puede repetir por pedazos, como un entrenamiento con checkpoints. El [[spot-checkpoint|entrenamiento en spot con checkpoints]] es justo eso.

:::formula Costo en spot
C_{spot} = C × (1 − d) × r
- C: el costo on-demand de la corrida, en US$
- d: el descuento de spot, como fracción (0.49 = 49 % menos)
- r: horas pagadas entre horas de trabajo: lo que se repite por las interrupciones (1 si no hay ninguna)
- C_{spot}: el costo de la misma corrida en spot, en US$
:::

Con el caso lento, \(C\) ≈ US$4.3. El descuento de spot de la g5.xlarge anda cerca de la mitad, y cambia por zona y por semana: el asesor de spot de AWS (Spot Instance Advisor) daba ≈ 56 % en us-east-1 (la región de AWS en Virginia) en 2026, y por [[zona-disponibilidad|zona]] los precios iban de ≈ 20 a ≈ 50 % menos. Aquí usamos 49 %, como en la T4 de «Máquinas, GPUs y cómo se cobran». El mismo asesor pone a la g5.xlarge en su rango de interrupciones más alto (más de 20 %). Con checkpoint cada 15 minutos, la simulación de esa lección pagaba ≈ 41 horas por 40 de trabajo: \(r\) ≈ 1.03. Queda \(C_{spot}\) ≈ 4.3 × 0.51 × 1.03 ≈ US$2.3. **El ahorro es de ≈ US$2 por corrida.**

Por ≈ US$2 por corrida (≈ US$22 al mes en el mes con 11 corridas), Alba no usa spot. Tendría que manejar interrupciones a media corrida, máquinas que no aparecen cuando hay poca capacidad sobrante y un pipeline que a veces tarda el doble. Spot queda como palanca guardada: si un día el entrenamiento crece (más fotos, un modelo más grande), la cuenta cambia. Ya se usa donde sí paga: en el [[backfill]] de 200 millones de fotos viejas, repartido en ≈ 2,000 pedazos que se pueden repetir.

La lección general: el «60–70 % menos» que se repite en charlas es un supuesto; mide el descuento real de tu tipo de máquina, multiplícalo por lo que cuesta una corrida y compáralo con lo que cuesta la complejidad.
:::

## Reintentar sin empezar de cero {Retrying without starting over}

En 4 horas pueden pasar cosas: el nodo se cae, la nube lo reemplaza, el pod se queda sin memoria, una lectura de S3 (el almacén de archivos) falla una vez. El orquestador de Alba sabe [[reintento|reintentar]] un paso: si el fine-tune falla, espera 120 segundos y lo lanza otra vez, **hasta 3 veces** (3 reintentos: 4 intentos en total, contando el primero). Si también falla el tercer reintento, el pipeline termina en rojo, avisa a la persona de guardia (la del equipo que esa semana atiende las alarmas) y el modelo actual sigue atendiendo como si nada.

Pero un reintento que empieza de cero tira las horas ya hechas. Lo que convierte un reintento en una continuación es el checkpoint.

### Qué guarda el checkpoint

Cada 15 minutos, el paso escribe un checkpoint en `s3://ml-datos/checkpoints/resnet50-2026-10-01/`. Lleva todo lo que hace falta para que [[reanudar-entrenamiento|reanudar]] sea **seguir**, no empezar otra corrida parecida:

| Pieza | Por qué hace falta |
|---|---|
| Los pesos, los dos promedios de Adam por peso, la época y el paso, y el estado del [[scheduler-lr\|scheduler]] del learning rate | lo explica «Cómo aprende un modelo» |
| El GradScaler de la precisión mixta: multiplica la pérdida por una escala para que los gradientes chicos no se vuelvan cero en FP16 | su escala ya se ajustó; si vuelve a su valor inicial, 65,536, puede saltarse pasos mientras se reajusta |
| El estado de los generadores de azar (Python, PyTorch, DataLoader) | para que el orden de las fotos y las augmentations sigan igual |

Los pesos son ≈ 98 MB (24.5 millones de parámetros × 4 bytes); los dos promedios de Adam, ≈ 196 MB más. Total ≈ 294 MB, como en «Cómo aprende un modelo», que explica por qué cada pieza es necesaria. Aquí importa qué hace el sistema con ellas.

El reintento arranca, busca el checkpoint más reciente de **su** corrida en esa carpeta, lo carga completo y sigue desde el paso siguiente. Para eso la ruta lleva el nombre de la corrida: un reintento del fine-tune de octubre no puede encontrar por error el checkpoint de septiembre.

El programa de abajo es un entrenamiento de juguete de 10 pasos, con un peso, un promedio como el de Adam y un generador de azar con semilla 17. Corre tres veces: sin caída; cayéndose en el paso 6 y reanudando con todo; y reanudando solo con el peso.

```python
import random

def paso(estado):                       # un paso de juguete: azar, momento y peso
    ruido = estado["rng"].gauss(0, 1)   # como el orden de las fotos y la augmentation
    grad = (estado["peso"] - 3.0) + 0.5 * ruido
    estado["m"] = 0.9 * estado["m"] + 0.1 * grad      # promedio de los gradientes, como en Adam
    estado["peso"] -= 0.2 * estado["m"]
    estado["paso"] += 1

def nuevo():
    return {"peso": 0.0, "m": 0.0, "paso": 0, "rng": random.Random(17)}

def copia(e):                            # el checkpoint: todo, incluso el estado del azar
    c = dict(e); c["rng"] = random.Random(); c["rng"].setstate(e["rng"].getstate()); return c

seguida = nuevo()
for _ in range(10): paso(seguida)

a = nuevo()
for _ in range(6): paso(a)
ckpt = copia(a)                          # se guarda en el paso 6 y el nodo se cae

completa = copia(ckpt)                   # reanuda con todo
solo_pesos = {"peso": ckpt["peso"], "m": 0.0, "paso": 0, "rng": random.Random(17)}
for e in (completa, solo_pesos):
    while e["paso"] < 10: paso(e)        # el que no sabe su paso repite 10 desde cero
print(f"sin caída:          peso = {seguida['peso']:.6f}")
print(f"reanuda con todo:   peso = {completa['peso']:.6f}")
print(f"reanuda solo pesos: peso = {solo_pesos['peso']:.6f}")
```

```salida
sin caída:          peso = 2.194600
reanuda con todo:   peso = 2.194600
reanuda solo pesos: peso = 2.524867
```

Reanudar con todo da **el mismo número, hasta el último dígito**: es la misma corrida. Reanudar solo con el peso da otra: el promedio empezó en cero, el azar volvió a empezar y, como no sabía su paso, dio 10 pasos más en vez de 4. Nada falla; solo sale un modelo distinto del que la corrida dice ser. (En una GPU de verdad, «el mismo número hasta el último dígito» casi nunca pasa, ni sin caída: lo ves en la sección 8. Lo que el checkpoint completo garantiza es que reanudar no agrega diferencias propias.)

:::diagrama e03-entrenamiento-reintento
Una caída a media corrida: qué hace el orquestador, de dónde lee el pod nuevo y qué termina anotado en la corrida. Sigue el recorrido.
:::

### Cada cuánto guardar

Guardar cuesta tiempo: mientras escribe, el entrenamiento espera. No guardar cuesta repetir trabajo. Las dos cosas se calculan.

:::formula El precio de guardar y el de no guardar
w = frac{M}{u}
n_c = frac{T}{I}
f = frac{w}{60 × I}
- M: el tamaño del checkpoint, en MB
- u: la velocidad de escritura a S3, en MB/s
- w: los segundos que tarda en escribirse un checkpoint
- T: la duración del fine-tune, en minutos (es \(t_f\) × 60)
- I: los minutos entre checkpoints
- n_c: cuántos checkpoints se escriben en una corrida
- f: la fracción del tiempo que se va en escribir (60 segundos en un minuto)
:::

Lo que se pierde por una caída es, como mucho, \(I\): el trabajo desde el último checkpoint. En promedio, la mitad.

:::cuenta Checkpoints cada 15 minutos
Tamaño, \(M\) // pesos + Adam | 98 + 196 | 294 MB
Velocidad, \(u\) // escritura a S3 desde un nodo, de 100 a 200 MB/s | lenta · rápida | 100 · 200 MB/s
Escribir uno, \(w = M ÷ u\) | 294 ÷ 100 · 294 ÷ 200 | ≈ 2.9 s · ≈ 1.5 s
Duración, \(T\) // el caso lento | 4 h × 60 | 240 min
Intervalo, \(I\) | | 15 min
Checkpoints, \(n_c = T ÷ I\) | 240 ÷ 15 | 16
Tiempo escribiendo, \(n_c × w\) | 16 × 2.9 · 16 × 1.5 | ≈ 47 s · ≈ 24 s
Fracción, \(f = w ÷ (60 × I)\) | 2.9 ÷ (60 × 15) · 1.5 ÷ (60 × 15) | ≈ 0.33 % · ≈ 0.16 %
Peor pérdida por una caída // igual a \(I\) | | 15 min
= Guardar cuesta menos de un minuto en toda la corrida, menos de 1 % del tiempo. Una caída cuesta como mucho 15 minutos, en vez de hasta 4 horas.
:::

Por eso 15 minutos. Guardar cada minuto costaría \(f\) ≈ 2.9 ÷ 60 ≈ 5 % del tiempo y ahorraría, en el peor caso, 14 minutos por caída, con caídas que no pasan todos los meses. Guardar cada hora pondría en riesgo una hora de GPU por caída para ahorrar segundos.

Los checkpoints intermedios se borran solos a los 30 días con una [[ciclo-vida|regla de ciclo de vida]] del [[bucket-objetos|bucket]] (la carpeta de S3 con sus propias reglas): después de un mes nadie va a reanudar esa corrida. El checkpoint **final** no se borra: se sube a la corrida en MLflow, como [[artefacto]] (un archivo guardado junto a la corrida).

:::ojo
Un paso que se reintenta debe poder correr dos veces sin dañar nada: es la [[idempotencia]] de «Timeouts, reintentos e idempotencia». Aquí significa dos cosas. Escribir cada checkpoint con el número de su paso en el nombre (`paso-115016.pt`), nunca encima de «el último». Y **reanudar la misma corrida de MLflow**, no abrir una nueva: si cada intento abre la suya, el mes de octubre termina con tres corridas a medias y nadie sabe cuál es la buena.
:::

## La corrida: qué anota MLflow {The run: what MLflow records}

### Por qué anotar cada corrida

Seis meses después, una persona del equipo pregunta: «¿el modelo de octubre se entrenó con el preproceso nuevo o con el viejo?». Sin anotaciones, la respuesta es arqueología: revisar el historial del repositorio, preguntar en el chat, adivinar por las fechas. El [[seguimiento-experimentos|seguimiento de experimentos]] (*experiment tracking*) es anotar **cada** entrenamiento automáticamente, en un lugar compartido, con todo lo necesario para contestar «¿con qué?» sin preguntarle a nadie.

La unidad es la [[corrida]] (*run*): un entrenamiento, con lo que entró, lo que pasó y lo que salió. Las corridas se agrupan en **experimentos**: un experimento es una carpeta con corridas que vale la pena comparar entre sí.

### MLflow

[[mlflow|MLflow]] es la herramienta de código abierto que usa Alba para esto. Hace dos cosas: el seguimiento de corridas, que es lo de esta lección, y el [[registro-modelos|registro de modelos]], que es el catálogo de los modelos aprobados y lo cuenta «Gate de evaluación y registry».

Alba lo corre como un servidor propio dentro de su cluster: una página web para mirar corridas y una [[rest|API REST]] para que los programas anoten. Detrás tiene dos almacenes, porque guarda dos tipos de cosa muy distintos. A los dos juntos les decimos el [[almacen-artefactos|almacén de artefactos y metadatos]]:

- **Los metadatos**, en una [[base-datos|base de datos]] Postgres (PostgreSQL, de código abierto; AWS la instala, la respalda y la actualiza): números y textos chicos, muchos, que se buscan y se comparan. «Todas las corridas con lr 3e-4 y `val_top1` mayor que 85».
- **Los artefactos**, en S3, en `s3://ml-datos/mlflow/`: los archivos grandes, como el checkpoint de 294 MB. Se guardan y se bajan enteros; nadie busca adentro de ellos.

El equipo de ML lo opera: lo actualiza, lo respalda y responde si se cae. Es un costo real para 5 personas, pero los datos son suyos y no dependen de un servicio externo que pueda cambiar de precio o cerrar.

### Qué anota una corrida de Alba

El experimento se llama `classifier-mensual`. Cada corrida del pipeline lleva el nombre del modelo que produce, `resnet50-2026-10-01`; las de prueba, el sufijo `-prueba-N`. Cada corrida guarda cuatro tipos de cosa:

| Tipo | Qué es | En Alba |
|---|---|---|
| **Parámetros** | lo que se decidió antes de empezar; no cambian | lr, épocas, batch, augmentations, semilla, id del snapshot y su `rows_sha256` |
| **Métricas** | números que se miden; pueden tener un valor por paso | pérdida y `val_top1` por época; al final, [[top-k\|top-1 y top-5]], [[recall]] por clase y [[ece\|ECE]] en validación |
| **Tags** | etiquetas de texto para encontrar y explicar | commit (lo pone MLflow solo), digest de la imagen, preproceso 1.4.0, snapshot |
| **Artefactos** | archivos | checkpoint final, `labels.json`, [[matriz-confusion\|matriz de confusión]], reporte por [[slice]] |

`val_top1` es el [[accuracy|accuracy]] top-1 en las 92,417 fotos de validación: el porcentaje de fotos donde la primera sugerencia es la correcta. `labels.json` es la lista de las 500 categorías **en el orden** de las salidas del modelo: la salida 17 es «Calzado › Tenis» solo si `labels.json` lo dice. Un reporte por slice es la misma métrica partida por grupos (fotos de celular contra web, con poca luz, chicas).

Fíjate en lo que **no** está: el resultado en el [[golden-set|golden set]], las 50,000 fotos del examen de Alba. Ese número no lo anota la corrida: lo calcula el paso de evaluar sobre el checkpoint y lo juzga el gate de la estación siguiente. Cuando más abajo se comparan corridas «en el golden set», es ese número.

:::figura e03-entrenamiento-corrida
La corrida `resnet50-2026-10-01` en MLflow, con sus cuatro tipos de cosa. Los parámetros y los tags van a Postgres; los artefactos, a S3.
:::

Así se ve el código que anota, como **ilustración** con la API de Python de MLflow (no tiene salida: necesita un servidor de MLflow y PyTorch, que aquí no están):

```python
import mlflow

mlflow.set_tracking_uri("http://mlflow.ml.svc:5000")      # el servidor dentro del cluster
mlflow.set_experiment("classifier-mensual")
with mlflow.start_run(run_name="resnet50-2026-10-01"):
    mlflow.log_params({"lr": 3e-4, "epocas": 8, "batch": 64, "semilla": 17,
                       "snapshot": "ds-2026-09-01", "rows_sha256": rows_sha256})
    mlflow.set_tags({"image_digest": "sha256:b71e04d2…", "preproceso": "1.4.0"})
    for epoca in range(1, 9):
        perdida, val_top1 = entrenar_una_epoca(), evaluar_validacion()
        mlflow.log_metrics({"loss": perdida, "val_top1": val_top1}, step=epoca)
    mlflow.log_artifact("labels.json")
    mlflow.log_artifact("checkpoints/final.pt")
```

### Leer la curva por época

Un número final («85.4 %») no dice cómo se llegó a él. Por eso la corrida guarda la [[curva-por-epoca|curva por época]]: la pérdida y `val_top1` al final de cada una de las 8 épocas. Es la [[curva-aprendizaje|curva de aprendizaje]] de «¿Aprendió de verdad?», anotada en cada corrida para poder ponerla junto a la del mes anterior.

Tres formas se repiten y cada una dice algo distinto:

- **Sana.** La pérdida de entrenamiento baja; `val_top1` sube rápido al principio y se aplana al final. Si la de octubre y la de septiembre se enciman, la receta se comporta igual con datos nuevos.
- **[[overfitting|Overfitting]].** La pérdida de entrenamiento sigue bajando, pero `val_top1` sube hasta una época y luego **baja**. El modelo empezó a memorizar las fotos de train. El número final engaña: es peor que el de una época anterior.
- **Learning rate roto.** La pérdida no baja de ≈ 6.21 (el ln 500 de la sección 3), o sube, o aparece `NaN` (*not a number*, lo que da una cuenta que se desbordó). Con un lr demasiado grande, cada paso brinca más allá del punto más bajo de la pérdida; con uno de cero, nada se mueve.

:::figura e03-entrenamiento-curvas
Las tres curvas de `val_top1` por época, con números ilustrativos. Solo la primera merece ir al gate; la segunda da un número final que esconde su mejor época.
:::

Por eso «anota la curva, no solo el número final» es una regla, no un detalle. Con solo el final, el overfitting y una corrida sana con mala suerte se ven igual.

## ¿Regresión o ruido? Comparar dos corridas {Regression or noise? Comparing two runs}

### El problema

La corrida de prueba `resnet50-2026-10-01-prueba-1` repite la receta del mes con otra semilla, y saca 85.1 % en el golden set. Otra con la receta de siempre sacó 85.3 %. ¿La de 85.1 es peor? ¿Hay que detener algo?

[[comparar-corridas|Comparar corridas]] es leer la diferencia entre dos corridas contra lo que ya sabes que varía **sin que nada cambie**. Hay dos fuentes de variación, y son distintas:

- **El ruido del entrenamiento.** La misma receta con otra semilla da otro modelo: otro orden de fotos, otras augmentations, otras sumas en la GPU. Se mide entrenando varias veces.
- **El ruido de la evaluación.** El golden set son 50,000 fotos, una muestra de todas las posibles. Medir con otra muestra daría otro número. Se calcula con un [[intervalo-confianza|intervalo de confianza]].

«Ruido, muestras y pruebas A/B» las separa a fondo en «¿Es real una mejora de 0.2 puntos?». Aquí se usa su resultado.

### La regla de Alba

Para medir el ruido del entrenamiento, Alba entrenó la receta 5 veces con 5 semillas y midió las 5 en el golden set: 85.21, 85.34, 85.12, 85.29 y 85.18 %. Su promedio es 85.23 % y su [[desviacion-estandar|desviación estándar]], σ ≈ 0.088 puntos. La cuenta completa está en «Versionado y linaje». De ahí sale la [[tolerancia-reproduccion|tolerancia de reproducción]]:

:::formula Regresión o ruido
Δ = x_B − x_A
τ = 3 × σ
text{dentro del ruido si } |Δ| ≤ τ
- x_A, x_B: la exactitud top-1 en el golden set de la corrida A (la de referencia) y de la B (la nueva), en %
- Δ: la diferencia, en puntos porcentuales; negativa si B salió más baja
- σ: la desviación estándar de las corridas con la misma receta y distinta semilla, en puntos
- τ: la tolerancia de Alba, en puntos: tres desviaciones
:::

¿Por qué tres? Si el ruido entre semillas tiene forma de [[distribucion-normal|campana]], una corrida que se aleja más de 3σ del promedio de las semillas (85.23 %) lo hace por puro azar en menos de 3 de cada 1,000 casos. Si aparece una, lo más probable es que algo **sí** cambió.

Entre dos corridas sueltas, la diferencia varía un poco más, porque junta el azar de las dos: ≈ 1.4 veces σ (es \(sqrt{2}\) × σ). Así, una diferencia de más de 0.26 puntos sale por azar ≈ 3 de cada 100 veces. Por eso \(τ\) es una regla para decidir dónde mirar, no un veredicto. Y es una convención, no una ley: con solo 5 semillas, σ misma es aproximada.

:::cuenta 85.3 contra 85.1
Referencia, \(x_A\) | la corrida con la receta de siempre | 85.3 %
Nueva, \(x_B\) | la prueba con otra semilla | 85.1 %
Diferencia, \(Δ = x_B − x_A\) | 85.1 − 85.3 | −0.2 puntos
Ruido entre semillas, \(σ\) // de las 5 semillas | | ≈ 0.088 puntos
Tolerancia, \(τ = 3 × σ\) | 3 × 0.088 | ≈ 0.26 puntos
Comparación // \(Δ\) sin el signo, contra \(τ\) | 0.2 ≤ 0.26 | dentro
= −0.2 puntos está dentro de la tolerancia: no es una regresión. Las dos corridas son la misma receta con distinto azar.
:::

Y el ruido de la evaluación dice lo mismo por otro lado. Su margen es \(ε = 1.96 × sqrt{a(1 − a)/G}\): cuánto podría moverse la exactitud medida solo por qué fotos tocaron en el examen, con 95 % de confianza (el 1.96 es el de un [[intervalo-confianza|intervalo de confianza]] de 95 %). Aquí \(a\) = 0.85 es la exactitud como fracción y \(G\) = 50,000 las fotos del golden set: ε ≈ 0.0031 como fracción, ± 0.31 puntos (≈ 0.3). Una diferencia de 0.2 puntos cabe en los dos ruidos.

:::figura e03-entrenamiento-tolerancia
Las corridas en una recta: la banda de ± 0.26 puntos alrededor de 85.23 %, las dos corridas de la cuenta y una repetición que se salió.
:::

:::calculadora e03-entrenamiento-ruido
Empieza con la cuenta. Mueve \(x_B\) a 84.9: \(|Δ|\) pasa de \(τ\). Luego sube \(σ\) a 0.15, como si la receta fuera más inestable: la misma diferencia vuelve a caber. Por último baja \(G\) a 5,000 para ver cuánto crece \(ε\) con un examen chico.
:::

### Qué hacer con la diferencia

- **Si \(|Δ| ≤ τ\)**: es ruido. No se celebra una mejora de 0.2 ni se detiene nada por una caída de 0.2.
- **Si \(|Δ| > τ\) con la misma receta**: algo de los cinco ingredientes cambió. Se comparan los punteros de las dos corridas en MLflow, en orden: snapshot y su huella, commit, digest de la imagen, receta, tipo de GPU. Casi siempre aparece la diferencia.
- **Si cambió la receta a propósito**: la tolerancia dice desde cuándo vale la pena mirar, pero la decisión de si el modelo nuevo es mejor no se toma aquí. La toma el gate, con las predicciones foto por foto de los dos modelos y una [[prueba-pareada|prueba pareada]]: «Gate de evaluación y registry».

:::ojo
\(τ\) se midió con **esta** receta en **este** modelo. Si cambias el batch, el learning rate o la arquitectura, el ruido entre semillas puede cambiar, y hay que volver a medirlo. Cinco corridas cuestan ≈ US$17–21, unos US$20 (≈ US$3–4 cada una): barato para saber qué tan confiable es cada comparación de los meses siguientes.
:::

## Por qué la GPU no repite los bits {Why the GPU does not repeat the bits} [extra]

Con los cinco ingredientes fijos (mismo commit, mismo snapshot, misma receta, misma imagen, semilla 17), dos corridas en la misma A10G casi nunca dan los mismos pesos, bit por bit. Es el [[cuda-no-determinismo|no determinismo de CUDA]]: el resultado cambia un poco aunque nada de lo que controlas haya cambiado.

La raíz la explica «PyTorch en lo que toca a producción», en su sección «autocast y determinismo»: en [[punto-flotante|punto flotante]], el orden de una suma cambia el último dígito; la GPU suma en paralelo, y cuDNN (la biblioteca de NVIDIA que hace las convoluciones) puede elegir otro algoritmo en cada corrida. En un entrenamiento se suman dos fuentes más:

- **Otra GPU u otra versión.** Una T4 y una A10G tienen otros algoritmos rápidos; otra versión de CUDA o de cuDNN, también. Por eso la imagen va por digest y el nodo es siempre una g5.xlarge.
- **La precisión mixta.** Las cuentas en FP16 redondean más, y el GradScaler salta un paso si un gradiente se desborda: una diferencia diminuta puede decidir si un paso se salta o no.

PyTorch tiene un interruptor que obliga a usar solo algoritmos deterministas, con la semilla y los workers del DataLoader fijos; la misma sección de «PyTorch en lo que toca a producción» lo muestra. Con él, dos corridas en la misma GPU y con la misma imagen dan los mismos bits. El precio: el entrenamiento suele ir más lento, a veces mucho, y alguna operación puede negarse a correr.

Por eso Alba **no** lo prende en el pipeline mensual. Su nivel de reproducible es «dentro de tolerancia»: las métricas a ≤ 0.26 puntos, que es exactamente para lo que existe la regla de la sección anterior. El interruptor se prende **para depurar**: si dos corridas difieren más que \(τ\) y no se encuentra por qué, se repiten las dos en modo determinista. Si siguen difiriendo, el cambio está en los ingredientes y no en la GPU.

:::pasos
1. Mismos punteros
Antes de culpar a la GPU, se comparan en MLflow los punteros de las dos corridas: `rows_sha256`, commit, digest, receta y tipo de máquina. Casi siempre la diferencia está aquí.
2. Dos corridas deterministas
Se repiten las dos con el interruptor prendido, en la misma g5.xlarge. Si ahora dan lo mismo, la diferencia original era el azar de la GPU, y cabía en la tolerancia o fue mala suerte.
3. Si siguen distintas
Algún ingrediente es distinto aunque los punteros digan lo mismo: un archivo sin commit, una dependencia que se bajó de internet al arrancar, un dato que se leyó de una carpeta que cambia. Se busca ese.
:::

:::analogia Diez personas y una cajera
Diez personas suman una lista de mil precios con dos decimales, cada una un pedazo, y le dictan su subtotal a una cajera en el orden en que van terminando. La cajera los va sumando en una calculadora que solo guarda seis cifras, así que cada suma redondea el total acumulado. El total cambia unos centavos según quién terminó primero. Ningún resultado está mal; solo son distintos.

Se rompe en una cosa: en la lista de precios, un centavo es un centavo. En un entrenamiento, una diferencia en el último dígito de un paso cambia el siguiente, y a lo largo de 230,032 pasos se convierte en pesos distintos. No en un modelo peor: en otro modelo igual de bueno.
:::

## Errores comunes {Common mistakes}

1. **Entrenar la candidata desde la laptop.** El commit anotado no es el código que corrió, la imagen no es la del pipeline y nadie más puede repetirlo. *Cómo evitarlo:* las candidatas salen solo del pipeline, que clona el commit y falla si `git status --porcelain` no sale vacío.
2. **Reanudar solo con los pesos.** El reintento termina sin error, pero el modelo es otro: Adam empieza de cero, el lr vuelve al del inicio y el azar repite fotos. *Cómo evitarlo:* checkpoint completo (las seis piezas de la tabla) y una prueba que reanuda una corrida corta y compara contra una sin caída.
3. **Una corrida nueva por cada reintento.** Octubre termina con tres corridas a medias y el gate no sabe cuál leer. *Cómo evitarlo:* el reintento reanuda la misma corrida de MLflow y escribe checkpoints con el número de paso en el nombre.
4. **Anotar solo el número final.** Un modelo que hizo overfitting en la época 5 y uno sano dan números finales parecidos. *Cómo evitarlo:* `val_top1` y la pérdida por época, con su paso, y mirar la curva junto a la del mes anterior.
5. **Llamar «regresión» a 0.2 puntos.** Se detiene un modelo bueno o se persigue un bug que no existe. *Cómo evitarlo:* \(|Δ|\) contra \(τ\) ≈ 0.26 puntos antes de cualquier conclusión; si cambió la receta, que lo decida el gate con la prueba pareada.
6. **«Fijé la semilla, así que es reproducible.»** En GPU no alcanza: la GPU suma en paralelo y en distinto orden, y eso cambia los últimos dígitos (sección 8). *Cómo evitarlo:* define qué tan igual es «igual» (la tolerancia) y guarda el modo determinista para depurar.
7. **Lanzar 4 horas de GPU sin la prueba de humo.** Un optimizador desconectado no da error, solo un modelo que no aprendió. *Cómo evitarlo:* sobreajustar un batch de 32 fotos en CI, en cada commit al código de entrenamiento, y revisar que el primer paso dé ≈ ln 500.

## En la vida real {In real life} [extra]

### Alba: el 1 de octubre, un reintento

A las 03:00 UTC arranca el pipeline. A las ≈ 03:30 empieza el fine-tune en una g5.xlarge recién creada. A las 05:40, con 2 horas y 10 minutos de trabajo, el nodo falla (una falla del hardware de la máquina). El último checkpoint es el de las 05:30, del paso ≈ 115,000. El orquestador espera 120 segundos y lanza el segundo intento; el cluster crea otro nodo, que tarda unos minutos en arrancar y bajar la imagen. El pod nuevo lee el checkpoint de las 05:30, reanuda la misma corrida de MLflow y sigue. Se perdieron 10 minutos de entrenamiento y unos minutos de arranque: centavos de GPU. En la corrida queda anotado que hubo dos intentos.

### Un detector de video que se reentrena cada pocos meses

Una cámara de tienda que detecta productos en el anaquel se ajusta en unas horas con una o dos GPUs. Aquí spot sí paga, si las corridas son muchas: con checkpoints frecuentes, una interrupción cuesta minutos. Lo que cambia es el examen: los cuadros de día y de noche se comportan distinto, y la comparación entre corridas se hace por separado en cada slice, con su propio ruido. Los números son supuestos del ejemplo.

### Un pronóstico de demanda que entrena cada semana

Un modelo que pronostica cuántas unidades se venderán cada semana entrena cada lunes, con una prueba de «origen móvil»: entrena con los datos hasta una fecha y evalúa en las semanas siguientes, varias veces. El primer intento corre en spot; si lo interrumpen, el reintento va en on-demand, para que el pronóstico salga a tiempo. Es un patrón útil siempre que la corrida tenga una hora límite.

### Un LLM propio, donde nada cabe en una GPU

Si Alba ajustara un modelo de lenguaje de ≈ 70 mil millones de parámetros, todo lo de esta lección seguiría igual, pero con otra escala. Con ≈ 16 bytes por parámetro entre pesos, gradientes y los promedios de Adam (la cuenta de «Cómo aprende un modelo»), el estado ronda 1.1 TB: no cabe en una GPU de 80 GB, y hay que repartirlo entre muchas. El checkpoint ya no pesa 294 MB sino cientos de gigas, y escribirlo tarda minutos, así que se escribe en paralelo desde todas las GPUs y en segundo plano. Una caída ya no cuesta centavos: cada hora perdida son decenas de GPUs paradas. Ahí el checkpoint frecuente, reanudar exacto y spot sí cambian la factura. Los números son supuestos del ejemplo.

### Muchos experimentos a la vez

Un equipo que investiga (cientos de corridas al día, barridos de hiperparámetros, gráficas comparando decenas de curvas) suele usar un servicio administrado como Weights & Biases, en vez de operar su propio MLflow. Es más cómodo para explorar; a cambio, en su versión en la nube, los datos de las corridas viven en el servicio de otro (también se puede instalar en casa, pero entonces hay que operarlo). Para un modelo al mes y 5 personas, Alba se queda con su MLflow. Y en cualquier caso, lo que llegó a producción se exporta y se guarda en casa.

### Fuera de ML: la bitácora del laboratorio

En un laboratorio de química, cada experimento se anota en una bitácora con fecha, lote del reactivo, temperatura y resultado, antes de que se olvide. Nadie confía en «creo que usé el lote nuevo». Una corrida de MLflow es esa bitácora, escrita por el propio programa. Y la regla de las 3σ es lo que hace un químico que repite una titulación: si sale distinta dentro de lo que suele variar, no cambió nada; si sale muy lejos, revisa el lote.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(N\), \(E\), \(v\), \(t_f\), \(t_e\), \(p\), \(C\) (tiempo y costo); \(d\), \(r\), \(C_{spot}\) (spot); \(M\), \(u\), \(w\), \(T\), \(I\), \(n_c\), \(f\) (checkpoints); \(x_A\), \(x_B\), \(Δ\), \(σ\), \(τ\) (comparar); \(a\), \(G\), \(ε\) (margen del golden; la lección siguiente lo escribe \(E\), con \(q\) y \(N\)); \(K\), \(L_0\) (pérdida inicial).

:::ejercicios
? [facil] Con la receta de Alba (batch de 64, 8 épocas) y un snapshot de 2,000,000 fotos de train, ¿cuántos pasos da el fine-tune? ¿Cuántas fotos procesa?
- Pasos por época = fotos ÷ batch, redondeado hacia arriba: 2,000,000 ÷ 64 = 31,250 exactos, así que **31,250 pasos** por época (aquí no sobra batch incompleto).
- Total: 31,250 × 8 = **250,000 pasos**.
- Fotos procesadas, \(N × E\) = 2,000,000 × 8 = **16,000,000**.
? [facil] El primer paso de un fine-tune nuevo, con la cabeza de 500 salidas recién creada, da una pérdida de 0.4. ¿Qué esperabas y qué sospechas?
- \(L_0 ≈ ln(K)\) = ln 500 ≈ **6.21**.
- 0.4 es muchísimo menos: el modelo «sabe» la respuesta antes de aprender. Sospecha que la etiqueta se coló en los datos de entrada (por ejemplo, una columna con el `label_id` que entra como dato), o que la cabeza no es nueva y trae pesos de otro modelo. Se revisa antes de lanzar la corrida.
? [facil] ¿Qué cuatro tipos de cosa anota una corrida en MLflow? Clasifica: el id del snapshot, la matriz de confusión, `val_top1` de la época 3, el digest de la imagen.
- Parámetros, métricas, tags y artefactos.
- El id del snapshot: **parámetro** (también va como tag, para buscar).
- La matriz de confusión: **artefacto** (un archivo).
- `val_top1` de la época 3: **métrica**, con paso 3.
- El digest de la imagen: **tag**.
? [medio] Un snapshot crece a 3,000,000 fotos de train. Con \(v\) = 1,022 fotos/s, \(t_e\) = 0.25 h y \(p\) = US$1.006/h, ¿cuánto tarda y cuánto cuesta la corrida? ¿Y en la T4 de producción, a 400 fotos/s y US$0.526/h?
- A10G: \(t_f = N × E ÷ (3,600 × v)\) = 3,000,000 × 8 ÷ (3,600 × 1,022) = 24,000,000 ÷ 3,679,200 ≈ **6.5 h**.
- \(C = (t_f + t_e) × p\) = (6.52 + 0.25) × 1.006 ≈ **US$6.8**.
- T4: \(t_f\) = 24,000,000 ÷ (3,600 × 400) = 24,000,000 ÷ 1,440,000 ≈ **16.7 h**; \(C\) = (16.67 + 0.25) × 0.526 ≈ **US$8.9** (suponiendo que evaluar también tarda 15 min).
- La T4 es más barata por hora pero más cara por corrida, y tarda casi 17 horas: el pipeline ya no cabe en una noche.
? [medio] El checkpoint de un modelo más grande pesa \(M\) = 1,500 MB y se escribe a \(u\) = 150 MB/s. Con \(I\) = 15 min y una corrida de \(T\) = 6 h, ¿cuántos checkpoints, cuánto tiempo escribiendo y qué fracción?
- \(w = M ÷ u\) = 1,500 ÷ 150 = **10 s**.
- \(T\) = 6 × 60 = 360 min, y \(n_c = T ÷ I\) = 360 ÷ 15 = **24**.
- Tiempo escribiendo: 24 × 10 = **240 s**, 4 minutos.
- \(f = w ÷ (60 × I)\) = 10 ÷ 900 ≈ **1.1 %**. Ya pasa del 1 %: con modelos así se escribe el checkpoint en segundo plano, mientras el entrenamiento sigue, o se guarda cada 30 minutos.
? [medio] El fine-tune se cae a las 2 h 50 min. El último checkpoint es de las 2 h 45 min, y arrancar un nodo nuevo y cargar el checkpoint tarda 8 minutos. Con \(p\) = US$1.006/h, ¿cuánto costó la caída? ¿Y sin checkpoints?
- Costo de la caída = minutos de máquina pagados ÷ 60 × \(p\). Los minutos pagados son el trabajo que se repite más el arranque del nodo nuevo. La espera de 120 s del orquestador no se paga: en ese rato no hay nodo.
- Con checkpoints se repiten los 5 minutos desde el último, más 8 de arranque: 13 minutos de máquina = 13 ÷ 60 × 1.006 ≈ **US$0.22**.
- Sin checkpoints, se repiten las 2 h 50 min (170 minutos) más los 8 de arranque: 178 minutos ≈ 2.97 h × 1.006 ≈ **US$3.0**, y el pipeline termina casi 3 horas tarde.
- La diferencia en dinero es chica; la de tiempo, no: con 3 caídas seguidas sin checkpoint, el modelo del mes no sale ese día.
? [medio] Un reintento reanuda con pesos, Adam, época y paso, pero sin el estado del scheduler. El scheduler baja el lr de 3e-4 a 3e-5 a la mitad de la corrida, y la caída fue en el paso 150,000 de 230,032. ¿Qué lr usa el reintento y qué le pasa al modelo?
- La mitad es el paso 230,032 ÷ 2 = 115,016. La caída fue en el 150,000, después de la mitad: ya iba en 3e-5.
- Sin el estado, el scheduler arranca de nuevo con **3e-4**: diez veces más grande.
- Los pasos siguientes son demasiado grandes para un modelo casi terminado: la pérdida sube, se pierde parte de lo ganado y la corrida termina con otro modelo, posiblemente peor. Sin ningún error.
? [reto] Una ingeniera repite `resnet50-2026-10-01` desde los mismos punteros y obtiene 85.71 %, contra 85.23 % del promedio de las semillas, con \(τ\) ≈ 0.26 puntos. (a) ¿Se reprodujo? (b) La repite en modo determinista dos veces y las dos dan 85.71 %. ¿Qué descartaste y qué revisas?
- (a) \(Δ\) = 85.71 − 85.23 = +0.48 puntos; \(τ\) ≈ 0.26. \(|Δ| > τ\): **no se reprodujo**. Que salga mejor no importa: algo cambió.
- (b) Dos corridas deterministas iguales descartan el azar de la GPU como explicación: con los mismos ingredientes, el modo determinista da los mismos bits. Las dos dan 85.71 y no 85.23, así que **algún ingrediente es distinto** del de la corrida original.
- Revisa en orden, comparando en MLflow: el `rows_sha256` del snapshot (¿se leyó otro?), el commit y si el árbol estaba limpio, el digest de la imagen, la receta y el tipo de GPU. Un candidato típico: un filtro de datos que la corrida original tenía sin commit.
? [reto] Alba considera spot. El descuento \(d\) es 0.49, \(C\) = US$4.3 y, con checkpoint cada 15 min, \(r\) ≈ 1.03. (a) ¿Cuánto ahorra al mes con 11 corridas? (b) ¿Desde cuántas corridas al mes valdría la pena, si mantener el manejo de interrupciones le cuesta al equipo ≈ 2 horas de una persona al mes, a US$50 la hora?
- (a) \(C_{spot} = C × (1 − d) × r\) = 4.3 × 0.51 × 1.03 ≈ US$2.26. Ahorro por corrida: 4.3 − 2.26 ≈ US$2.04. Con 11: 11 × 2.04 ≈ **US$22 al mes**.
- (b) El costo de la complejidad es 2 × 50 = US$100 al mes. Corridas para igualarlo: 100 ÷ 2.04 ≈ **49 corridas al mes**.
- Con 1 candidata y hasta 10 pruebas, Alba está lejos. Spot pagaría con barridos de hiperparámetros de decenas de corridas, o con un modelo diez veces más caro de entrenar.
:::

## Lo que sigue {What comes next}

- «Gate de evaluación y registry» toma el checkpoint candidato y su corrida, lo mide en el golden set foto por foto contra el modelo actual y contra el de hace 3 meses, y decide si es seguro probarlo. Usa la tolerancia de esta lección para no confundir ruido con regresión.
- «Export, engine y paridad» convierte el checkpoint aprobado al formato que sirve la T4 y comprueba que responda lo mismo.
- «Monitoreo, drift y reentrenamiento» decide cuándo adelantar esta estación: una categoría nueva o una caída de la aceptación.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
seguimiento-experimentos mlflow corrida curva-por-epoca almacen-artefactos arbol-limpio receta-entrenamiento comparar-corridas tolerancia-reproduccion cuda-no-determinismo warm-start job-entrenamiento reanudar-entrenamiento spot-checkpoint prueba-humo-entrenamiento
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué entra a la estación 3 de Alba y qué sale?
Entran el id del snapshot, el commit, la receta, la imagen por digest y los pesos de ImageNet. Sale un checkpoint candidato con su corrida registrada en MLflow. No despliega nada.
? ¿Por qué Alba arranca desde ImageNet y no desde el modelo actual?
Para que cada modelo dependa solo de su snapshot, su commit y su imagen, sin encadenar los meses ni heredar errores. Arrancar del champion ahorraría unos dólares, que en Alba no compensan.
? ¿Qué prueba la de sobreajustar un batch, y qué no?
Que el código puede aprender: si no memoriza 32 fotos, algo está roto. No prueba que aprenda bien: una mala receta o un preproceso distinto la pasan.
? ¿Por qué el checkpoint lleva el estado de Adam, del scheduler, del GradScaler y del azar?
Porque sin ellos el reintento es otra corrida: pasos de otro tamaño, otro lr, otras fotos. Con todo, reanudar es seguir.
? ¿Cuánto cuesta una corrida y por qué Alba no usa spot?
≈ US$3.3–4.3 en una A10G on-demand. Spot ahorraría ≈ US$2 por corrida, menos que lo que cuesta manejar las interrupciones.
? ¿Qué trampa tiene el commit que anota MLflow?
Se anota aunque haya cambios sin commit, sin avisar. Por eso las candidatas salen del pipeline y el paso falla si el árbol no está limpio.
? Dos corridas dan 85.3 y 85.1 %. ¿Regresión?
No: \(|Δ|\) = 0.2 ≤ \(τ\) ≈ 0.26 puntos, tres desviaciones del ruido entre semillas. Es la misma receta con distinto azar.
:::
