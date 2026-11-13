---
titulo: Servicios gestionados, serverless y permisos
en: Managed services, serverless and permissions
subtitulo: Cuánto de tu sistema opera el proveedor y cuánto tú, cuánto cuesta esa diferencia, cuándo conviene que algo se apague solo y cómo decide la nube quién puede tocar qué.
pregunta: ¿Por qué C01 corre su modelo en sus propias máquinas y no en un servicio que lo opere por él, cuándo sí conviene pagarle a la nube para que se encargue, y cómo sabe S3 que un programa tiene permiso de leer los pesos del modelo?
requisitos: nube, maquinas, config
---

:::idea
En la nube puedes rentar una máquina y operarla tú, o pagar más por unidad para que el proveedor opere una parte o todo. Esa decisión se gana casi siempre con una pregunta: ¿quién lo va a operar? Y todo lo que corre en la nube, tuyo o del proveedor, necesita permiso para cada cosa que toca: lo mejor es que cada programa tenga solo el suyo y con llaves que caducan solas.
:::

En la lección de la nube viste que puedes rentar una [[maquina-virtual|máquina virtual]] por hora y que la nube ordena sus servicios en una escalera: máquinas que rentas, plataformas y productos ([[iaas-paas-saas|IaaS, PaaS y SaaS]]). En la de máquinas viste cuánto cuesta una `g4dn.xlarge` con su T4: ≈ US$0.526 por hora en us-east-1 (noviembre de 2026), ≈ US$384 al mes.

C01 corre su modelo en dos de esas máquinas, una por zona, dentro de Kubernetes. Alguien tiene que instalar los drivers de la GPU, actualizar el sistema operativo, decidir cuántas copias del modelo correr y despertarse a las 3 de la mañana si un nodo se cae. AWS podría hacer casi todo eso por ti, y te cobraría más. ¿Vale la pena?

Esta lección responde tres preguntas. Primero, qué cambia cuando el proveedor opera una pieza y cuándo conviene pagarlo, con la cuenta completa. Segundo, qué es *serverless*, por qué ahorra tanto en unos casos y por qué en otros es lo más caro, y qué es el arranque en frío. Tercero, cómo decide la nube quién puede hacer qué: IAM, roles, políticas y la identidad de un programa sin contraseñas guardadas.

## Quién opera qué: el servicio gestionado {Who runs what: managed services}

Un **[[servicio-gestionado|servicio gestionado]]** (*managed service*) es uno donde el proveedor de la nube opera una parte de la pila por ti: la instala, la actualiza, la repara, la escala y la vigila. Tú usas el resultado por su [[api-nube|API]] y pagas por usarlo.

«Operar» es todo lo que hay que hacer para que algo siga funcionando después de instalarlo. Para el servidor de modelos de C01, eso incluye:

- Actualizar el sistema operativo y los drivers de la GPU cuando sale un parche de seguridad.
- Cambiar una máquina que se descompuso.
- Agregar copias cuando sube el tráfico y quitarlas cuando baja.
- Mirar las alertas y contestar el teléfono cuando algo falla, de día o de noche.

Ninguna de esas tareas hace que el modelo sea mejor. Pero si nadie las hace, el sistema se cae.

### La escalera de C01

Para clasificar la foto de Ana hay cuatro maneras, de más a menos trabajo tuyo:

:::figura gestionados-escalera
Cuatro formas de servir un modelo, de izquierda a derecha. En cada columna, las capas que operas tú (en naranja) y las que opera el proveedor (en azul). Mientras más a la derecha, menos operas y menos controlas.
:::

1. **Máquinas solas (EC2).** Rentas [[instancia|instancias]] con GPU y haces todo lo demás: el sistema operativo, los drivers, el programa que sirve el modelo, cuántas copias correr y cómo repartir el tráfico.
2. **Kubernetes gestionado (EKS).** AWS opera el «cerebro» del cluster, y tú operas las máquinas que hacen el trabajo. Es lo que usa C01.
3. **Un endpoint de una plataforma de ML (SageMaker AI).** Le das el modelo y un [[contenedor]]; AWS prende las máquinas, las cambia si se caen y agrega copias. Tú no ves ningún nodo.
4. **Un producto listo (como Textract, el OCR de AWS).** Ni siquiera traes el modelo: mandas un documento y te regresa el texto. Pagas por página.

Cada escalón te quita trabajo y te quita control. En el primero puedes ajustar cualquier cosa; en el cuarto, solo lo que la API deja. Y cada escalón cobra más por unidad de trabajo: el proveedor te cobra su gente, su software y su margen dentro del precio.

:::analogia Cocinar, pedir comida o ir al restaurante
Rentar una máquina es comprar los ingredientes y cocinar: barato por plato, pero tú lavas los trastes. Un servicio gestionado es pedir comida a domicilio: pagas más por plato y no lavas nada. Un producto listo es ir al restaurante: eliges del menú, no de la despensa.

Dónde se rompe: en la cocina de tu casa nadie te cobra por cada gramo que entra a la olla. Algunos servicios gestionados sí cobran por cada GB que les mandas, y con mucho tráfico ese cobro pesa más que el precio del plato.
:::

### El escalón de en medio: Kubernetes gestionado

Kubernetes es el [[orquestacion|orquestador]] de C01: el sistema que decide en qué máquina corre cada copia de cada programa y que levanta otra si una se cae. Tiene dos partes.

El **[[plano-de-control|plano de control]]** (*control plane*) es el cerebro. Guarda el **estado deseado** del cluster («quiero 2 copias de Triton y 2 del gateway») y unos programas comparan, sin parar, lo que hay contra lo que se pidió. Si falta una copia, mandan crearla. Todo lo que le pides a Kubernetes pasa por su API.

Los **[[nodo|nodos]]** son las máquinas que hacen el trabajo: ahí corren los [[pod|pods]], los grupos de contenedores de tus programas.

Operar un plano de control a mano es delicado: su base de datos guarda todo el cluster, y si se corrompe, Kubernetes ya no sabe qué debería existir. Por eso las tres nubes venden **[[kubernetes-gestionado|Kubernetes gestionado]]**: EKS en AWS, GKE en Google Cloud y AKS en Azure. El proveedor opera el plano de control, en varias zonas; tú operas los grupos de nodos.

:::cuenta El plano de control de EKS
Precio por hora del cluster // us-east-1, noviembre de 2026 | US$0.10 × 730 h | ≈ US$73 al mes
Si dejas la versión de Kubernetes vieja // «soporte extendido» | US$0.60 × 730 h | ≈ US$438 al mes
Lo que promete el SLA // 99.95 % del mes | 0.05 % × 30 días × 1,440 min | ≈ 21.6 min caído al mes
= Pagas ≈ US$73 al mes por no operar el cerebro. Su promesa cubre la API del cluster, no tus pods.
:::

Ese último renglón es una trampa común. El [[sla|SLA]] de EKS dice que el endpoint de la API de Kubernetes contesta el 99.95 % del tiempo. No dice nada de tus pods: si tu nodo con la T4 se queda sin memoria, o tu imagen trae un error, AWS cumplió su promesa y tu servicio está caído. La [[disponibilidad]] de C01 la sigues construyendo tú, con dos réplicas en dos zonas ([[n-mas-uno|N+1]]).

## Gestionado contra propio: cuatro preguntas y una cuenta {Managed vs self-hosted: four questions and one calculation}

La decisión de **[[gestionado-vs-propio|gestionado contra propio]]** (*managed vs self-hosted*) aparece en cada diseño. La Ronda la resume en cuatro preguntas, en orden:

1. **¿Quién lo opera?** Si no hay un equipo que sepa operar GPUs, drivers y autoscaling, la respuesta suele ser gestionado, sin más cuentas.
2. **¿Cuánto volumen y qué tamaño tiene cada request?** Muchos GB o millones de llamadas al mes hacen que los cobros por unidad crezcan.
3. **¿Qué tan especial es lo que corre?** Un engine de TensorRT armado para una T4 concreta, o un servidor con batching propio, pueden no caber en el contenedor que acepta la plataforma.
4. **¿Qué tan rápido hay que salir, y qué piden los datos?** Un prototipo para la próxima semana pide gestionado. Datos que no pueden salir de cierto lugar pueden prohibirlo.

La primera casi siempre gana. «Gestionado cobra más por unidad y te ahorra gente», dice la Ronda. Una persona de ingeniería en Estados Unidos cuesta varios miles de dólares al mes: si un servicio gestionado te ahorra un cuarto de su tiempo, puede costar más en la factura y salir más barato en total.

### La cuenta de C05: Textract contra un OCR propio

C05 lee documentos (facturas, recibos) y extrae sus campos. El primer paso es un **OCR** (*optical character recognition*), un modelo que convierte la imagen de una página en texto. Puede usar Textract, el OCR gestionado de AWS, o servir uno propio.

:::cuenta Textract contra OCR propio, al mes
Textract, solo texto // US$1.50 por 1,000 páginas (noviembre de 2026) | 186,000 × 1.50 ÷ 1,000 | ≈ US$279
OCR propio en GPU // 2 × g4dn.xlarge, una por zona | 2 × 0.526 × 730 | ≈ US$768
Punto de equilibrio, solo factura // páginas donde cuestan lo mismo | 768 ÷ 1.50 × 1,000 | ≈ 512,000 páginas
Con ¼ de persona operándolo // ≈ US$2,500 al mes; arriba de 1 M de páginas Textract baja a US$0.60 | 1 M + (3,268 − 1,500) ÷ 0.60 × 1,000 | ≈ 3.9 M páginas
= C05 tendría que procesar ≈ 21 veces su volumen para que el OCR propio salga más barato.
:::

El OCR propio solo gana por factura arriba de ≈ 512,000 páginas al mes, casi 2.75 veces el volumen de C05. Y en cuanto cuentas a la persona que lo opera, el punto de equilibrio se va a ≈ 3.9 millones de páginas. Además, el OCR es ≈ 3 % del costo de C05; las personas son ≈ 80–90 %. Ahorrar en el 3 % complicando la vida del 80 % es mal negocio.

:::profundo La misma cuenta en Python
Así se ve la tabla con unos cuantos volúmenes. Cópialo y córrelo:

```python
def textract(paginas):                    # US$1.50 por 1,000 hasta 1 M; US$0.60 después
    return min(paginas, 1_000_000) * 1.50 / 1000 + max(paginas - 1_000_000, 0) * 0.60 / 1000

def propio(personas):                     # 2 × g4dn.xlarge ≈ US$768 + la gente que lo opera
    return 768 + personas

print(f"{'páginas/mes':>12} {'Textract':>9} {'propio sin gente':>17} {'propio + ¼ persona':>19}")
for paginas in (186_000, 512_000, 1_000_000, 2_000_000, 4_000_000):
    print(f"{paginas:>12,} {textract(paginas):>9,.0f} {propio(0):>17,.0f} {propio(2_500):>19,.0f}")
```

```salida
 páginas/mes  Textract  propio sin gente  propio + ¼ persona
     186,000       279               768               3,268
     512,000       768               768               3,268
   1,000,000     1,500               768               3,268
   2,000,000     2,100               768               3,268
   4,000,000     3,300               768               3,268
```

La columna del medio miente: nadie opera dos GPUs gratis. La última es la que se compara.
:::

:::calculadora gestionados-equilibrio
Empieza con los valores de C05. Sube el costo de la gente a cero y mira cómo el punto de equilibrio baja a ≈ 512,000 páginas; súbelo a una persona completa y mira cómo se aleja.
:::

### Y luego, lo que no está en la factura

Que algo sea gestionado no quiere decir que no te cueste nada fuera de la factura:

- **[[dependencia-proveedor|Dependencia del proveedor]]** (*lock-in*): un sistema escrito contra la API de Textract no se mueve a Google Cloud cambiando una línea.
- **Límites**: cada servicio pone topes de tamaño, de tiempo y de requests por segundo. C05 tuvo que pedir un aumento de [[cuota-servicio|cuota]] de requests por segundo del OCR y programar [[reintento|reintentos]] con [[backoff-exponencial|backoff]].
- **Menos visibilidad**: cuando algo falla, ves los logs que el proveedor publica, no la máquina.

Y «equivalente» no es «idéntico»: la tabla de equivalencias de la lección de la nube junta servicios que se parecen, pero cada uno tiene sus límites. Cloud Run no es Fargate, y Pub/Sub no es Kafka.

## Plataformas de ML y endpoints gestionados {Managed ML platforms and endpoints}

Las tres nubes venden una **[[plataforma-ml|plataforma de ML gestionada]]**: **Amazon SageMaker AI**, **Agent Platform** de Google Cloud (antes Vertex AI) y **Azure Machine Learning**. Las tres venden lo mismo: entrenar, servir y registrar modelos sin operar servidores.

No son un solo producto, sino una caja de piezas. Nadie usa todas:

| Pieza | Qué resuelve | En SageMaker AI |
|---|---|---|
| Entrenamiento | Correr un job de entrenamiento en máquinas que se prenden y se apagan solas | Training jobs |
| Serving en tiempo real | Un modelo que contesta cada request en milisegundos | Real-time endpoints |
| Asíncrono | Requests grandes o lentas que contestan en minutos | Asynchronous Inference |
| Serverless | Pagar solo por request, sin GPU | Serverless Inference |
| Batch | Pasar un archivo enorme por el modelo de una vez | Batch Transform |
| Pipelines | Encadenar pasos: preparar datos, entrenar, evaluar | Pipelines |
| Registro | Guardar cada versión del modelo y quién la aprobó | Model Registry |
| Feature store | Guardar las features para entrenar y para servir | Feature Store |
| Monitoreo | Vigilar si los datos que llegan cambian | Model Monitor |

Agent Platform y Azure ML tienen casi todas las mismas piezas con otros nombres. El [[registro-modelos|registro de modelos]], el [[pipeline]] y el [[feature-store|feature store]] los verás a fondo en las estaciones del Dojo.

### Para entrenar casi siempre conviene

Entrenar es un trabajo que arranca y termina. Un job gestionado prende las máquinas, corre tu código, guarda el modelo en S3 y **apaga las máquinas solo**. Cobra por segundo. Si usas máquinas [[spot]] (las sobrantes, con descuento, que te pueden quitar), el job guarda [[checkpoint|checkpoints]] y retoma donde se quedó.

El fine-tune mensual de C01 cuesta ≈ US$10–50 como job gestionado. Nadie tiene que acordarse de apagar una GPU un viernes en la noche. Por eso la Ronda lo marca como «elegido»: es la parte de las plataformas que casi siempre conviene.

### El endpoint gestionado

Un **[[endpoint-gestionado|endpoint gestionado]]** (*managed endpoint*) es la pieza de serving: una dirección a la que mandas una [[request]] con los datos y te contesta la predicción. Detrás hay máquinas, pero no las ves. La plataforma las prende, las reparte por zona, las cambia si se caen, agrega copias según el tráfico y hace [[canary|canaries]] de versiones nuevas.

A cambio pides tres cosas:

- **Un sobreprecio por hora.** Una `ml.g4dn.xlarge` (la misma T4 dentro de SageMaker AI) cuesta ≈ US$0.736 por hora contra ≈ US$0.526 la `g4dn.xlarge` normal, en us-east-1 (noviembre de 2026): ≈ 40 % más. En CPU, ≈ 20 % más.
- **Un cobro por cada GB.** SageMaker AI cobra ≈ US$0.016 por GB que entra al endpoint y por GB que sale ([[cargo-datos-procesados|datos procesados]]). Azure ML es la excepción: dice no cobrar nada aparte de las máquinas.
- **Un contrato.** Tu contenedor escucha en el puerto 8080 y contesta `POST /invocations` (la predicción) y `GET /ping` (si está vivo), acepta conexiones en 250 ms y responde en 60 s. El cuerpo de cada request mide como máximo 6 MiB (6,291,456 bytes).

El gateway de C01 ya escucha en el 8080, pero sus rutas son `/v1/classify`, `/healthz` y `/readyz`. Habría que agregar dos rutas. Y algunas fotos de las publicaciones pesan hasta 10 MB: no caben en 6 MiB tal cual. Nada de esto es difícil. Es el tipo de detalle que convierte «lo subo a SageMaker» en una semana de trabajo que nadie estimó.

### La cuenta de C01 en un endpoint gestionado

C01 recibe ≈ 10 millones de fotos al día: ≈ 304 millones de requests al mes. Para no castigar al lado gestionado, la Ronda supone que el gateway manda la imagen ya preparada, en enteros de un byte (UINT8): 3 × 224 × 224 = 150,528 bytes por request.

:::cuenta El tier de GPU de C01, propio contra gestionado
Propio: 2 × g4dn.xlarge // ≈ US$0.526/h × 730 h | 2 × 0.526 × 730 | ≈ US$768
Gestionado: 2 × ml.g4dn.xlarge // ≈ US$0.736/h | 2 × 0.736 × 730 | ≈ US$1,075
GB que entran al endpoint // 304 M requests de 150,528 B | 304 M × 150,528 B | ≈ 45,760 GB
Datos procesados // entrada más ≈ 304 GB de respuestas, a US$0.016/GB | (45,760 + 304) × 0.016 | ≈ US$737
El camino privado hasta SageMaker AI // [[privatelink\|endpoint de interfaz]]: US$0.01/GB más su hora en 2 zonas | 46,064 × 0.01 + 2 × 0.01 × 730 | ≈ US$475
= Gestionado: 1,075 + 737 + 475 ≈ US$2,287 contra ≈ US$768. Con el resto de la infraestructura (≈ US$924), ≈ US$3.2k contra ≈ US$1.7k: ≈ 1.9 veces.
:::

Fíjate de dónde sale la diferencia: el sobreprecio de las máquinas son ≈ US$307 al mes. Los dos cobros por GB, ≈ US$1,212. Con imágenes, lo que pesa es lo que se cobra por byte. Si el gateway mandara el tensor en FP32 (4 bytes por número, 602,112 bytes por request), solo los datos procesados serían ≈ US$2.9k al mes.

:::diagrama gestionados-c01
Sigue «Una request» y luego «Lo que se cobra por GB». Toca cada caja para ver quién la opera.
:::

¿Entonces SageMaker AI está mal para C01? No por sí solo. La diferencia es de ≈ US$1.5k al mes. Para un equipo de 3 personas sin Kubernetes, eso es una fracción de lo que costaría una persona operando EKS. La Ronda lo dice directo: «sin plataforma de Kubernetes y con un equipo chico, SageMaker sería la respuesta pragmática». C01 corre su propio Triton porque la empresa **ya** opera EKS (la primera pregunta) y porque su payload es grande (la segunda).

:::ojo
«La plataforma gestionada siempre tiene GPUs.» No: las máquinas `ml.*` salen de la misma capacidad física que las de EC2. Un endpoint gestionado no te salva de un [[error-capacidad|error de capacidad]] cuando la zona se queda sin T4. Y SageMaker AI tiene **sus propias** cuotas, separadas de las de EC2 y muchas en 0 al abrir la cuenta: pídelas antes del día que las necesitas.
:::

:::profundo Los descuentos también son otros
Los Savings Plans de EC2, los descuentos por comprometer un gasto por hora durante uno o tres años que viste en la lección de máquinas, **no** aplican a las máquinas `ml.*`. SageMaker AI tiene sus propios Savings Plans, que AWS anuncia con descuentos «de hasta 64 %». Si mueves un modelo de EKS a SageMaker AI, el compromiso que ya firmaste para EC2 no te sigue.
:::

## Inferencia asíncrona: requests grandes y respuestas en minutos {Asynchronous inference} [extra]

Hay modelos que no caben en el contrato de un endpoint de tiempo real: el archivo pesa cientos de MB, o la predicción tarda 10 minutos. C04, por ejemplo, analiza láminas de microscopio enteras; cada una pesa cientos de MB y su promesa ([[slo|SLO]]) es entregar el resultado en 60 minutos.

Para eso existe la **[[inferencia-asincrona|inferencia asíncrona gestionada]]** (*asynchronous inference*). En SageMaker AI funciona así:

:::pasos
1. Subes el archivo
Lo pones en un bucket de S3, no en el cuerpo de la request. Puede pesar hasta 1 GB.
2. Pides la predicción
Llamas al endpoint con la dirección del archivo. Te contesta de inmediato con un número de trabajo y la dirección donde quedará el resultado.
3. La plataforma lo forma en una fila
Si las máquinas están ocupadas, el trabajo espera en una [[cola-mensajes|cola]] interna. Cada uno puede tardar hasta 1 hora.
4. El resultado aparece en S3
Cuando termina, escribe la respuesta en S3 y, si lo pediste, te avisa con una notificación.
:::

Lo mejor: cuando la cola está vacía, el endpoint puede bajar a **0 máquinas**, y no pagas GPU. Cuando llega un trabajo, prende una. Esa primera tarda minutos, pero con un SLO de 60 minutos no importa. La Ronda lo dice de C04: un arranque en frío de 3 a 5 minutos «no es problema con un SLO de 60 min; en uno síncrono sería inaceptable».

Agent Platform y Azure ML no tienen un modo asíncrono igual (la Ronda no conoce uno): ahí se arma con una cola y workers, o con su modo batch. Ese patrón, cola más [[worker|workers]] que escalan a cero, es justo el que C04 corre en su propio cluster.

### El primo: batch

Si no hay requests sueltas sino un archivo enorme, como «clasifica las 200 millones de fotos del catálogo», la pieza es **batch** (Batch Transform en SageMaker AI). Le das la carpeta de S3 con las entradas; la plataforma prende las máquinas, reparte los archivos, escribe los resultados en otra carpeta y apaga todo al terminar. Es un job, como el entrenamiento: no hay endpoint esperando.

La diferencia con la asíncrona es quién manda el trabajo. En la asíncrona llegan trabajos sueltos a lo largo del día, y el endpoint vive (a veces con cero máquinas) esperando el siguiente. En batch, tú decides cuándo empieza y todo el trabajo existe desde el principio. El backfill del catálogo de C01 es batch; los estudios que llegan de uno en uno a un hospital son asíncronos.

## Serverless: pagar solo lo que corre {Serverless: pay only for what runs}

**[[serverless|Serverless]]** quiere decir «sin servidores»… que no es cierto: sí hay servidores, pero no los ves, no los eliges y no pagas cuando no hacen nada. Tiene dos rasgos:

- **Pagas por uso**: por segundo de ejecución o por request, no por hora de máquina prendida.
- **El proveedor escala por ti**, de cero a cientos de copias y de regreso, a veces hasta **cero**.

Es el extremo del [[pago-por-uso|pago por uso]] que viste en la lección de la nube. Hay dos formas.

### Funciones: el código suelto

Una **[[funcion-serverless|función serverless]]** es un pedazo de código que el proveedor corre cada vez que llega un evento: una request, un archivo nuevo en S3, un mensaje en una cola. La más conocida es **AWS Lambda**. Escribes una función de Python, la subes y AWS la corre cuando hace falta.

Sus límites deciden para qué sirve:

| Límite de Lambda | Valor | Qué quiere decir para ML |
|---|---|---|
| GPU | No tiene | Solo modelos que corren bien en CPU |
| Memoria | Hasta 10,240 MB | Modelos chicos |
| Tiempo por llamada | 15 min | Nada de entrenamientos largos |
| Imagen de contenedor | Hasta 10 GB sin comprimir | Cabe un modelo mediano con sus bibliotecas |
| Payload síncrono | 6 MB | Las fotos de 10 MB de C01 no caben |

Lambda es buenísima para el pegamento: redimensionar una foto cuando llega a S3, mandar una notificación, validar un archivo. No es para servir una ResNet-50 en GPU.

### Contenedores: la imagen completa, y ahora con GPU

Un **[[contenedor-serverless|contenedor serverless]]** corre tu [[imagen-contenedor|imagen de contenedor]] completa, con un servidor web adentro, y el proveedor la escala según las requests. Los principales son **Cloud Run** de Google Cloud y **Azure Container Apps**. Y estos sí tienen GPU:

| Servicio | GPU | Detalles | ¿Baja a cero? |
|---|---|---|---|
| Google Cloud Run | L4 (24 GB) y RTX PRO 6000 (96 GB), una por instancia | Regiones limitadas; con L4, mínimo 4 vCPU y 16 GiB | Sí |
| Azure Container Apps | T4 y A100, una por réplica | Cuota y regiones limitadas | Sí |
| SageMaker Serverless Inference | No | 1–6 GB de memoria, payload de 4 MB | Sí |

Tener GPU no basta. Son dos preguntas separadas: ¿tiene la GPU que necesito? ¿Y el modo de cobrar y de arrancar encaja con mi tráfico?

### La cuenta: horas de GPU al día

Una L4 en Cloud Run cuesta ≈ US$1.05 por hora mientras atiende, según la Ronda. La misma L4 en una máquina dedicada (`g6.xlarge`) cuesta ≈ US$0.80 por hora en us-east-1 (noviembre de 2026), pero la pagas las 24 horas. Cloud Run cobra ≈ 30 % más por hora, y solo las horas que trabaja.

:::cuenta Una herramienta interna de moderación
Lo que hace // 20,000 imágenes al día, ≈ 2 h de GPU activa | — | —
En Cloud Run // ≈ US$1.05 por hora activa, 30.4 días | 1.05 × 2 × 30.4 | ≈ US$64 al mes
Una L4 dedicada // ≈ US$0.805 × 730 h | 0.805 × 730 | ≈ US$588 al mes
Punto de equilibrio // horas activas al día que cuestan lo mismo | 24 × 0.805 ÷ 1.05 | ≈ 18.4 h
= Con menos de ≈ 18 horas de GPU activa al día, serverless sale más barato.
:::

:::figura gestionados-horas
El costo al mes contra las horas de GPU activa al día. La dedicada es una línea plana: la pagas la uses o no. Serverless sube con las horas y la cruza cerca de las 18.
:::

C01 está en el otro extremo: su tráfico nunca baja de decenas de requests por segundo, ni de noche, así que su GPU trabaja las 24 horas. Una instancia de Cloud Run siempre prendida costaría ≈ US$766 al mes, ≈ 30 % más que la misma L4 dedicada (≈ US$588). La Ronda lo llama la señal *senior*: **el perfil de carga (horas de GPU al día) decide el costo**. C01 pierde esa cuenta.

:::calculadora gestionados-serverless
Empieza con la herramienta de moderación: 2 horas al día. Sube las horas hasta que serverless cueste lo mismo que la dedicada.
:::

## Escalar a cero, arranque en frío y autoscaling {Scale to zero, cold starts and autoscaling}

La otra pregunta de serverless es la del primer request. Para entenderla hacen falta tres ideas.

### Autoscaling: dos lazos de distinta velocidad

El **[[autoscaling]]** es ajustar solo cuánta capacidad corre según la carga. En Kubernetes son dos lazos, uno dentro del otro:

- **Réplicas, en segundos.** Una regla mira una métrica (uso de GPU, requests por segundo, mensajes en una cola) y agrega o quita copias del programa. En Kubernetes, el HPA o KEDA.
- **Nodos, en minutos.** Si una copia nueva no cabe en ninguna máquina, otro programa pide una máquina nueva a la nube. En AWS, Karpenter o el Cluster Autoscaler.

La frase de la Ronda: «los pods no escalan más allá de los nodos que existen». Si hay una T4 libre, la copia nueva de Triton arranca en segundos. Si no, espera la máquina.

La mecánica fina (las métricas, cuánto esperar antes de quitar copias) es de la estación 9 del Dojo. Aquí basta con la diferencia de velocidad.

### El arranque en frío

El **[[cold-start|arranque en frío]]** (*cold start*) es el tiempo desde que el sistema decide agregar una copia hasta que esa copia contesta su primera request. Ya lo viste con los pesos de un LLM en la lección de memoria. Para Triton en C01, cuando no hay nodo libre, la Ronda lo parte así:

:::cuenta Un scale-out de Triton sin nodo libre
Detectar que falta capacidad // la métrica tarda en subir | — | 0.5 a 1.5 min
Pedir y arrancar el nodo // una g4dn nueva | — | 2 a 5 min
Bajar la imagen // varios GB desde el registro | — | 2 a 5 min
Cargar el engine en la GPU // — | — | 10 a 60 s
Pasar la prueba de «listo» // readiness | — | 5 a 15 s
= Total: 4.75 a 12.75 min, ≈ 5 a 13 minutos.
:::

Un pico de tráfico dura segundos. El autoscaling tarda minutos. Por eso **el autoscaling no absorbe picos de segundos**: para eso está la capacidad de sobra que ya corre (el *headroom*). Si C01 recibe 500 requests por segundo y tarda 13 minutos en tener una copia más, pasan 500 × 60 × 13 = 390,000 requests antes de que llegue la ayuda.

### Escalar a cero

**[[scale-to-zero|Escalar a cero]]** (*scale to zero*) es dejar que el número de copias baje hasta 0 cuando no hay trabajo. Ahorra la GPU completa durante las horas sin tráfico. El precio: el siguiente request paga un arranque en frío entero.

¿Cuándo conviene? Cuando nadie espera la respuesta en segundos. Los workers del backfill de C01, que reclasifican el catálogo viejo desde una cola, pueden bajar a cero. C04 baja a cero su tier de GPU: «la capa de GPU es desechable y escala a cero; los resultados son durables». El **Triton online de C01 nunca baja a cero**: su [[p99]] tiene que quedar en 200 ms, y un arranque de segundos a minutos no cabe.

:::ojo
«Con serverless no hay arranque en frío porque escala solo.» Es al revés: escalar solo y hasta cero es justo lo que crea el arranque en frío. Lo que lo elimina (en Lambda, la *provisioned concurrency*; en Cloud Run, las instancias mínimas) son copias que se quedan prendidas, y se pagan siempre.
:::

:::profundo Un día con escala a cero, en Python
El juguete de abajo simula un día de una herramienta interna con escala a cero. El servicio guarda la copia prendida unos minutos después de cada request, por si llega otra; si no llega, la apaga. Mira qué pasa con distintos tiempos de espera:

```python
import random
random.seed(7)
# Una herramienta interna: 400 requests entre las 9:00 y las 18:00, y 6 de madrugada
llegadas = sorted([random.uniform(9*60, 18*60) for _ in range(400)] +
                  [random.uniform(0, 6*60) for _ in range(6)])        # en minutos del día

def un_dia(espera_min):                   # minutos que la instancia sigue prendida sin trabajo
    frios, prendida, apagada_en = 0, 0.0, -1.0
    for t in llegadas:
        if t > apagada_en:                # ya se había apagado: arranque en frío
            frios += 1
            prendida += espera_min        # vive hasta 'espera_min' después de esta request
        else:
            prendida += t + espera_min - apagada_en   # alarga su vida
        apagada_en = t + espera_min
    return frios, prendida / 60

for espera in (1, 5, 15, 60):
    frios, horas = un_dia(espera)
    print(f"espera {espera:>2} min: {frios:>3} arranques en frío, {horas:4.1f} h prendida, "
          f"≈ US${horas * 1.05:5.2f} al día")
print(f"dedicada 24 h: ≈ US${24 * 0.8048:5.2f} al día")
```

```salida
espera  1 min: 200 arranques en frío,  4.8 h prendida, ≈ US$ 5.07 al día
espera  5 min:  15 arranques en frío,  9.3 h prendida, ≈ US$ 9.79 al día
espera 15 min:   6 arranques en frío, 10.5 h prendida, ≈ US$11.04 al día
espera 60 min:   3 arranques en frío, 13.6 h prendida, ≈ US$14.33 al día
dedicada 24 h: ≈ US$19.32 al día
```

Esperar poco ahorra horas pero multiplica los arranques en frío: con 1 minuto, la mitad de las requests encuentra la máquina apagada. Esperar mucho casi los elimina, y se acerca al costo de la dedicada. Es el mismo trueque de siempre, en un número. El modelo es de juguete: los proveedores reales cobran el tiempo prendido de distintas maneras, y aquí no se cobra el arranque mismo.
:::

:::nota KEDA y el número que no escribiste
KEDA, el autoscaler de Kubernetes que escala con la longitud de una cola, tiene `minReplicaCount` en **0** por omisión. Si lo usas para un servicio online y no escribes ese número, tu servicio puede bajar a cero sin que nadie lo decida. En C04, los workers van de 0 a 4 con una meta de 15 mensajes por worker: con 45 mensajes en la cola, corre ⌈45 ÷ 15⌉ = 3.
:::

## IAM: quién puede hacer qué {IAM: who can do what}

Hasta aquí, las piezas: máquinas, endpoints, funciones, buckets. Todas viven en tu [[cuenta-nube|cuenta de la nube]], y cada vez que algo hace una llamada a la API (leer un archivo de S3, prender una máquina, invocar un endpoint) la nube tiene que decidir: ¿esto se permite?

En Linux, los [[permisos]] dicen qué usuario puede leer qué archivo. En la nube, eso lo hace **[[iam|IAM]]** (*Identity and Access Management*, gestión de identidad y acceso): el sistema que decide **quién** puede hacer **qué acción** sobre **qué recurso**. Toda la nube pasa por él: también la consola donde das clic y los servicios gestionados que llaman a otros servicios.

Son dos preguntas distintas que se confunden siempre:

- **Autenticación**: ¿quién eres? Se demuestra con algo que tienes: una contraseña, una llave, un token firmado.
- **Autorización**: ¿qué puedes hacer? Se decide con reglas escritas.

IAM hace las dos para todo lo que pasa dentro de la nube. Cómo se identifica un cliente de fuera ante tu API ([[jwt|JWT]], [[api-key|API keys]]) es de la fase de seguridad.

### La política: el documento que dice qué se puede

Una **[[politica-permisos|política de permisos]]** (*policy*) es un documento con reglas. Cada regla tiene tres partes: un **efecto** (`Allow` o `Deny`), unas **acciones** (como `s3:GetObject`, «leer un objeto de S3») y unos **recursos** (qué bucket, qué prefijo). En AWS se escribe en JSON. Esta es una ilustración, la política del Triton de C01 (los nombres de bucket son inventados):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::c01-artefactos/triton/*" },
    { "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::c01-artefactos",
      "Condition": { "StringLike": { "s3:prefix": "triton/*" } } }
  ]
}
```

Se lee así: Triton puede **leer** objetos cuya llave empieza con `triton/` en el bucket `c01-artefactos`, y **listar** solo ese prefijo. No puede escribir, ni borrar, ni ver otro bucket. El `arn:aws:s3:::…` es un ARN (*Amazon Resource Name*): el nombre completo y único de un recurso en AWS. Y la `Version` es la versión del lenguaje de políticas, no una fecha que tú elijas.

Para decidir, AWS sigue tres reglas, en este orden:

1. **Por omisión, todo se niega.** Si ninguna regla lo permite, no se puede.
2. **Un `Allow` lo permite**, si la acción y el recurso coinciden.
3. **Un `Deny` explícito gana siempre**, aunque otra regla diga `Allow`.

(Hay más capas, como reglas de toda la organización y políticas del propio bucket, pero estas tres son el corazón.)

:::profundo Las otras capas que también deciden
Una request a S3 no la decide solo la política del rol. En AWS pueden opinar más documentos, y la regla del `Deny` vale en todos:

- **La política del bucket** (*bucket policy*), pegada al recurso y no a quien llama. Sirve, por ejemplo, para negar todo lo que no llegue por el camino privado de la VPC, o para dejar entrar a un rol de otra cuenta.
- **Las reglas de la organización** (SCP, *service control policies*). Una empresa con muchas cuentas pone topes que ningún rol de adentro puede pasar, como «nadie crea máquinas fuera de us-east-1».
- **Los límites de permisos** (*permissions boundaries*): un techo para los roles que crean otros equipos.

Para que algo se permita, ninguna capa puede negarlo y la que corresponde tiene que permitirlo. Por eso, cuando un permiso «está bien escrito y no funciona», el problema suele estar en otra capa. Las herramientas de la nube que simulan una política te dicen cuál negó.
:::

### El rol: un conjunto de permisos que se presta

Un **[[rol-iam|rol de IAM]]** (*IAM role*) es una identidad con políticas pegadas, que no pertenece a nadie en particular: se **asume**. Quien lo asume recibe sus permisos por un rato. Un usuario es una persona con su contraseña; un rol es un gafete que se presta y se devuelve.

C05 tiene un rol por componente. Así se ve la regla de los tres pasos con un evaluador de juguete:

```python
from fnmatch import fnmatch

politicas = {   # rol → lista de (efecto, acción, recurso); * vale «cualquier cosa»
    "docs-api":   [("Allow", "s3:PutObject", "docs/raw/*")],
    "doc-worker": [("Allow", "s3:GetObject", "docs/raw/*"),
                   ("Allow", "s3:PutObject", "docs/derivados/*"),
                   ("Deny",  "s3:PutObject", "docs/raw/*")],
    "rol-de-todo": [("Allow", "s3:*", "*")],
}

def decide(rol, accion, recurso):
    efectos = [e for e, a, r in politicas[rol] if fnmatch(accion, a) and fnmatch(recurso, r)]
    if "Deny" in efectos:  return "DENEGADO (un Deny explícito gana)"
    if "Allow" in efectos: return "permitido"
    return "DENEGADO (nadie lo permitió)"

for rol, accion, recurso in [("docs-api", "s3:PutObject", "docs/raw/f-881.pdf"),
                             ("docs-api", "s3:GetObject", "docs/derivados/f-881.json"),
                             ("doc-worker", "s3:GetObject", "docs/raw/f-881.pdf"),
                             ("doc-worker", "s3:PutObject", "docs/raw/f-881.pdf"),
                             ("rol-de-todo", "s3:DeleteObject", "docs/raw/f-881.pdf")]:
    print(f"{rol:<11} {accion:<16} {recurso:<26} → {decide(rol, accion, recurso)}")
```

```salida
docs-api    s3:PutObject     docs/raw/f-881.pdf         → permitido
docs-api    s3:GetObject     docs/derivados/f-881.json  → DENEGADO (nadie lo permitió)
doc-worker  s3:GetObject     docs/raw/f-881.pdf         → permitido
doc-worker  s3:PutObject     docs/raw/f-881.pdf         → DENEGADO (un Deny explícito gana)
rol-de-todo s3:DeleteObject  docs/raw/f-881.pdf         → permitido
```

La API de documentos escribe los originales y no lee los resultados. El worker lee los originales, escribe los resultados y, por si alguien le agrega un permiso de más, tiene prohibido escribir en los originales. El último renglón es el peligro: un rol con `s3:*` sobre `*` puede borrar cualquier cosa.

### Mínimo privilegio

**[[minimo-privilegio|Mínimo privilegio]]** (*least privilege*) es la regla de dar a cada componente solo los permisos que necesita, sobre solo los recursos que necesita. No evita que te ataquen: limita el daño cuando pasa.

:::figura gestionados-radio
Arriba, un rol para todo: si un atacante entra a un solo pod, alcanza todos los buckets. Abajo, un rol por componente: el mismo ataque solo alcanza lo que ese pod podía tocar, y el gateway no podía tocar nada de S3.
:::

Piensa en un pod comprometido: alguien encontró un error en una biblioteca y ya corre su código adentro. Si todos los pods usan el mismo rol, o el rol de la máquina, con `s3:*` sobre `*`, el atacante hereda todos los buckets: las fotos, los logs, los documentos de C05 con datos personales. Si cada componente tiene su rol acotado por prefijo, solo ve lo que ese pod veía.

¿Cuánto cuesta hacerlo bien? La Ronda: «un rol por componente, acotado por prefijo, cuesta una tarde de infraestructura como código». La **infraestructura como código** (IaC) es escribir los recursos de la nube, roles incluidos, en archivos que viven en Git, con herramientas como Terraform. Así los permisos se revisan como cualquier cambio de código.

## La identidad de un programa: sin llaves guardadas {A program's identity: no stored keys}

Ya sabes qué permisos tiene el rol de Triton. Falta lo más delicado: ¿cómo demuestra el pod de Triton, al llamar a S3, que **es** Triton?

### La cuenta de servicio

Una persona entra con su usuario. Un programa no debería usar el usuario de una persona: si Ana se va de la empresa y se borra su usuario, el servicio se cae; y si el programa se compromete, el atacante actúa como Ana. Un programa tiene su propia identidad: una **[[cuenta-servicio|cuenta de servicio]]** (*service account*).

En Kubernetes, una cuenta de servicio es un objeto con nombre, como `triton` en el *namespace* `classifier`. Cada pod corre con una, y Kubernetes le da al pod un token firmado que dice «soy `classifier/triton`». En Google Cloud también se llaman cuentas de servicio; en AWS, ese papel lo hace un rol.

### La llave que caduca sola

La forma ingenua de darle permisos a Triton es crear una llave de acceso (un identificador y una clave secreta que no caducan) y meterla en un [[secret-k8s|Secret]]. Funciona. Pero esa llave es una **credencial estática**: vale hasta que alguien la borre. Si se filtra, por un log, por un repositorio o por una laptop robada, sirve meses después, desde cualquier lugar.

Las **[[credenciales-temporales|credenciales temporales]]** (*temporary credentials*) son lo contrario. AWS las entrega a quien asume un rol, y caducan solas, normalmente en una hora. El programa pide unas nuevas antes de que venzan, sin que nadie haga nada. Si alguien se roba unas, le sirven minutos.

En la lección de configuración viste la escalera de dónde guardar un [[secreto]], de peor a mejor: en la imagen o en el repositorio (nunca), en una [[variable-entorno|variable de entorno]] (aceptable), en un archivo que llega de un [[gestor-secretos|gestor de secretos]] (bueno) y, en el escalón más alto, **no tenerlo**. «La mejor forma de manejar un secreto es no tenerlo», dice la Ronda. Este es ese escalón.

### La identidad del workload: IRSA y Pod Identity

La **[[identidad-workload|identidad del workload]]** (*workload identity*) conecta las dos ideas: la cuenta de servicio del pod se cambia por credenciales temporales de un rol de IAM. Nadie guarda ninguna llave. En EKS hay dos formas, **IRSA** (*IAM Roles for Service Accounts*) y la más nueva, **EKS Pod Identity**. En Google Cloud se llama Workload Identity Federation; en Azure, Entra Workload ID. Todas hacen lo mismo:

:::diagrama gestionados-irsa
Sigue «El pod pide permiso» y luego «Una hora después». Al final, «Si alguien roba las credenciales» muestra por qué esto es mejor que una llave guardada.
:::

Con IRSA, la conexión se declara en la cuenta de servicio. Una ilustración en YAML (el número de cuenta es inventado):

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: triton
  namespace: classifier
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::111122223333:role/c01-triton
```

Y del lado de AWS, el rol `c01-triton` dice en su **política de confianza** quién puede asumirlo: solo los tokens de la cuenta de servicio `classifier/triton` de ese cluster. Un pod de otro *namespace*, con otra cuenta de servicio, no puede asumirlo aunque conozca el nombre del rol.

En el código de Triton o del gateway no cambia nada: el SDK de AWS (la biblioteca que usa el programa para hablarle a la nube) encuentra las credenciales solo y las renueva solo.

:::profundo IRSA contra Pod Identity
Las dos llegan al mismo lugar por caminos distintos. Con **IRSA**, el cluster tiene su propio emisor de tokens, que hay que registrar en IAM, y cada rol escribe en su política de confianza qué cuenta de servicio de qué cluster lo puede asumir. Si tienes diez clusters, cada rol tiene que nombrar a los diez.

Con **EKS Pod Identity**, la conexión se declara del lado de EKS: «la cuenta de servicio `classifier/triton` de este cluster usa el rol `c01-triton`». Un agente que corre en cada nodo entrega las credenciales al pod. El rol solo dice que confía en el servicio de Pod Identity, y el mismo rol sirve en varios clusters sin cambiarlo.

Para quien escribe el programa, da igual: el SDK encuentra las credenciales en los dos casos. La diferencia es para quien administra los permisos.
:::

:::profundo Cuando sí hace falta un secreto
La identidad del workload funciona para hablar con la propia nube: S3, SageMaker AI, un gestor de secretos. Para la contraseña de una base de datos de otro proveedor, o la API key de un servicio externo, sigue haciendo falta un secreto. Entonces el pod usa su identidad para leer ese secreto de un gestor de secretos: AWS Secrets Manager cobra ≈ US$0.40 por secreto al mes más US$0.05 por cada 10,000 lecturas (noviembre de 2026). Diez secretos, ≈ US$4 al mes. El secreto vive en un solo lugar, se [[rotacion-secretos|rota]] ahí, y cada lectura queda registrada.
:::

La misma idea llega más allá de Kubernetes. Un job de [[ci|CI]] que hace [[deploy]] en la nube puede recibir credenciales de corta vida por OIDC, un estándar para que un sistema le demuestre a otro quién es con un token firmado, en vez de guardar una llave de AWS en la configuración del repositorio. La Ronda lo resume como «sin llaves guardadas».

## Errores comunes {Common mistakes}

### 1. Comparar solo el precio por hora

«SageMaker AI cuesta 40 % más por hora, así que es 40 % más caro.» En C01, el sobreprecio de las máquinas son ≈ US$307 al mes; los cobros por GB, ≈ US$1,212.

**Cómo evitarlo:** sumar todas las líneas: máquinas, datos procesados, el camino privado de red, y el costo de la gente que lo opera en cada lado.

### 2. Olvidar quién lo va a operar

Elegir el lado propio porque la factura es menor, en un equipo de tres personas sin nadie que sepa de Kubernetes. O elegir gestionado en una empresa que ya tiene un equipo de plataforma que opera EKS para todos.

**Cómo evitarlo:** contestar primero la pregunta «¿quién lo opera?», con nombres. Si nadie, gestionado.

### 3. Usar escala a cero en un servicio con latencia estricta

Poner el modelo online en Cloud Run con mínimo 0 instancias, o dejar KEDA con su `minReplicaCount` por omisión. La primera request de la mañana espera segundos o minutos.

**Cómo evitarlo:** escala a cero solo donde el SLO es de minutos (backfill, colas, herramientas internas). En lo online, un mínimo explícito de réplicas, escrito en el manifiesto.

### 4. Confiar en el autoscaling para los picos

«El autoscaling llega a 20 réplicas, aguantamos cualquier pico.» Con nodos de GPU, una réplica nueva tarda ≈ 5–13 minutos; el pico ya pasó.

**Cómo evitarlo:** capacidad de sobra ya prendida para los picos de segundos; el autoscaling para los cambios que duran horas.

### 5. Un rol para todo

Todos los pods con el rol de la máquina, o un rol con `s3:*` sobre `*` porque «así no falla nada». Un pod comprometido hereda todo.

**Cómo evitarlo:** un rol por componente, con las acciones exactas y acotado por prefijo, escrito como infraestructura como código. Revisa cada `*` como si fuera un bug.

### 6. Llaves de acceso guardadas

Una llave de AWS en una variable de entorno, en el repositorio o en la imagen del contenedor, porque era lo más rápido para la demo. No caduca, y nadie se acuerda de que existe.

**Cómo evitarlo:** identidad del workload en Kubernetes, OIDC en CI y credenciales temporales en todo lo demás. Si encuentras una llave estática, rótala y bórrala.

## En la vida real {In real life} [extra]

### C01: qué es gestionado y qué no

| Pieza | Quién la opera | Por qué |
|---|---|---|
| Plano de control de Kubernetes | AWS (EKS) | ≈ US$73 al mes por no operar el cerebro del cluster |
| Nodos con T4 y Triton | El equipo de C01 | La empresa ya opera EKS y el payload es grande: el endpoint gestionado costaría ≈ 1.9× |
| Fine-tune mensual | AWS (job de SageMaker AI) | ≈ US$10–50 al mes, se apaga solo |
| Workers del backfill | El equipo, con KEDA | Bajan a cero: nadie espera su respuesta en segundos |
| Permisos | IAM, con IRSA o Pod Identity | Triton lee sus pesos de S3, Fluent Bit escribe los logs en su prefijo y el job de etiquetado lee las fotos seleccionadas; nadie guarda llaves |

Al ALB, la puerta de entrada, le llega un token firmado del backend que llama ([[jwt|JWT]]), y lo verifica. El gateway usa el cliente que viene en ese token verificado, nunca un dato que el cliente escribe en un header. Y Triton no tiene entrada desde afuera del cluster: solo lo llama el gateway.

### C05: comprar el OCR y separar los roles

C05 usa Textract: ≈ US$279 al mes, contra ≈ US$768 en GPU más la gente. Y separa cuatro roles: la API de documentos (escribe los originales, no lee los resultados), el worker (lee los originales, escribe resultados, no puede escribir en los originales), la herramienta de revisión (solo los recortes de los campos de las tareas asignadas a cada persona) y el job de entrenamiento (lee una copia en otra cuenta). Si un pedazo cae, el daño queda en su carril.

### C04: la GPU desechable

C04 analiza láminas de microscopio con una promesa de 60 minutos. Sus workers leen trabajos de una cola y escalan con KEDA de 0 a 4. La Ronda lo resume así: la capa de GPU es desechable y escala a cero; los resultados son durables. Si un worker muere a la mitad, el trabajo vuelve a la cola y otro lo toma. De noche no corre ninguna GPU y la factura de GPU es cero. El precio es un arranque de 3 a 5 minutos para el primer trabajo de la mañana, que cabe de sobra en 60 minutos.

### Los LLM: alquilar el modelo completo

C10, C11 y C12 usan modelos de lenguaje. La pregunta gestionado contra propio aparece en grande: correr el modelo propio en EKS con vLLM (un servidor de LLMs) o pagar una API por token. Entre los dos extremos hay servicios como Bedrock en AWS, que sirve modelos abiertos totalmente gestionados. Las mismas cuatro preguntas deciden; el volumen de tokens hace la cuenta.

### C06: cuando la gente pesa más que las GPUs

En el caso de moderación, la Ronda dice que el costo de las personas es mucho mayor que el de las GPUs. Ahí, una plataforma de ML gestionada ni se discute: cada hora que el equipo no pasa operando nodos es una hora que pasa en el modelo.

### Fuera de ML: la lavandería

Tener lavadora en casa conviene si lavas todos los días: la máquina es tuya, la usas cuando quieres y por carga sale barata. Si lavas una vez al mes, la lavandería de la esquina cobra más por carga y te ahorra comprar, instalar y reparar una lavadora. Es la cuenta de las horas activas al día, con ropa en vez de GPUs.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa los precios de la lección (us-east-1, noviembre de 2026) y 730 horas al mes.

:::ejercicios
? [facil] Una `g5.xlarge` cuesta ≈ US$1.006 por hora y la `ml.g5.xlarge` de SageMaker AI ≈ US$1.408. ¿Cuánto más cuesta por hora, en porcentaje? ¿Cuánto más al mes, una máquina prendida todo el mes?
- Porcentaje: 1.408 ÷ 1.006 ≈ 1.40: **≈ 40 % más**.
- Al mes: 1.006 × 730 ≈ US$734; 1.408 × 730 ≈ US$1,028.
- Diferencia: (1.408 − 1.006) × 730 ≈ **US$293 al mes** por máquina, antes de los cobros por GB.
? [facil] El SLA de EKS promete 99.95 %. ¿Cuántos minutos puede estar caído en un mes de 30 días? Si en esos minutos tus pods siguen corriendo, ¿qué deja de funcionar y qué no?
- 0.05 % × 30 × 1,440 = **21.6 minutos al mes**.
- Lo que cubre es la API de Kubernetes: mientras está caída no puedes desplegar, escalar ni ver el estado del cluster.
- Los pods que ya corren siguen atendiendo; los nodos no se apagan. Pero si un pod se cae en ese rato, nadie crea otro hasta que la API vuelva. Tu disponibilidad no es la de ese SLA.
? [facil] Alguien propone servir el modelo de C01 en AWS Lambda «para no operar nada». Da tres razones de la tabla de límites por las que no funciona.
- **Sin GPU**: la ResNet-50 en CPU tardaría mucho más y necesitaría muchas más copias para 10 M de fotos al día.
- **Payload síncrono de 6 MB**: algunas fotos pesan hasta 10 MB.
- **Tráfico 24/7**: Lambda brilla cuando hay ratos sin tráfico; C01 nunca baja de decenas de requests por segundo, así que paga por uso todo el día.
- (Además, cada copia nueva paga su arranque en frío, y el p99 de C01 es de 200 ms.)
? [facil] Fluent Bit, el programa que junta los logs de C01, escribe los archivos de logs de predicciones en el prefijo `predicciones/` del bucket `c01-logs`. Escribe su permiso como (efecto, acción, recurso). ¿Debería poder leer o borrar?
- (`Allow`, `s3:PutObject`, `arn:aws:s3:::c01-logs/predicciones/*`).
- No necesita leer ni borrar: solo escribe archivos nuevos. Darle `s3:GetObject` o `s3:DeleteObject` solo aumenta el daño si alguien lo compromete.
? [medio] El OCR propio de C05 en CPU cuesta ≈ US$248 al mes (2 × `c6i.xlarge`). ¿Cuál es el punto de equilibrio contra Textract (US$1.50 por 1,000 páginas) solo por factura? ¿Y si sumas ≈ US$2,500 de ingeniería, sabiendo que arriba de 1 M de páginas Textract cobra US$0.60 por 1,000?
- Solo factura: 248 ÷ 1.50 × 1,000 ≈ **165,000 páginas**. C05 procesa 186,000: por factura, ya ganaría el OCR propio en CPU.
- Con la gente: 2,748 al mes. El primer millón de páginas cuesta 1,500 en Textract; faltan 1,248, a 0.60 por 1,000: 1,248 ÷ 0.60 × 1,000 = 2.08 M.
- Equilibrio: 1 M + 2.08 M ≈ **3.08 M páginas**, ≈ 16.6 veces el volumen de C05. Con la gente contada, Textract sigue ganando.
? [medio] La herramienta de moderación crece a 6 horas de GPU activa al día. ¿Cuánto cuesta en Cloud Run al mes? ¿Y a 20 horas? ¿En qué momento cambiarías a una L4 dedicada?
- 6 h: 1.05 × 6 × 30.4 ≈ **US$192 al mes**, contra ≈ US$588 de la dedicada. Sigue ganando Cloud Run.
- 20 h: 1.05 × 20 × 30.4 ≈ **US$638 al mes**: ya cuesta más que la dedicada.
- El cruce está en 24 × 0.805 ÷ 1.05 ≈ **18.4 horas activas al día**. Antes de cambiar, revisa también el arranque en frío: si con la dedicada ya no lo tienes, eso también cuenta.
? [medio] Los workers de C04 escalan con KEDA: meta de 15 mensajes por worker, mínimo 0 y máximo 4. ¿Cuántos workers corren con 0, 10, 45 y 200 mensajes en la cola? ¿Qué pasa con el primer mensaje después de una noche vacía?
- 0 mensajes: **0 workers**. 10: ⌈10 ÷ 15⌉ = **1**. 45: ⌈45 ÷ 15⌉ = **3**. 200: ⌈200 ÷ 15⌉ = 14, pero el tope es **4**.
- Con 200 la cola tarda más en vaciarse: el máximo es una decisión de costo.
- El primer mensaje de la mañana espera un arranque en frío completo, de ≈ 3–5 minutos en C04. Con un SLO de 60 minutos, no importa.
? [medio] C01 recibe 500 requests por segundo en su pico. Un scale-out de Triton sin nodo libre tarda de 5 a 13 minutos. ¿Cuántas requests pasan antes de que llegue la copia nueva, en cada extremo? ¿Qué conclusión sacas?
- 5 min: 500 × 60 × 5 = **150,000 requests**. 13 min: 500 × 60 × 13 = **390,000**.
- Todas las atienden las réplicas que ya estaban prendidas. Si no les sobraba capacidad, esas requests se encolan, se tardan o fallan.
- Conclusión: los picos de segundos o de pocos minutos se cubren con capacidad de sobra ya corriendo; el autoscaling es para lo que dura horas.
? [reto] Repite la cuenta del tier de GPU de C01 en SageMaker AI, pero con el tensor en FP32: 3 × 224 × 224 números de 4 bytes. ¿Cuánto pesa cada request? ¿Cuánto cuestan solo los datos procesados de entrada? ¿Cuántas veces el costo de las dos T4 propias?
- Por request: 3 × 224 × 224 × 4 = **602,112 bytes**, 4 veces el UINT8.
- Al mes: 304 M × 602,112 B ≈ 183,000 GB. Por 0.016 ≈ **US$2,929**.
- Contra las dos T4 propias (≈ US$768): ≈ **3.8 veces**, solo en esa línea. Y el endpoint de interfaz también cobra por GB: subiría a ≈ US$1,848.
- Lección: con payloads grandes y mucho tráfico, el tipo de dato del tensor puede decidir el diseño.
? [reto] Diseña los roles de C01 con mínimo privilegio para cuatro componentes: Triton (lee los pesos), el gateway, Fluent Bit (escribe logs) y el job de etiquetado (lee las fotos seleccionadas y escribe etiquetas). Para cada uno, las acciones y los recursos. Luego: un atacante entra al pod del gateway. ¿Qué puede leer en S3 con tu diseño, y qué podría leer con un `s3:*` sobre `*`?
- Triton: `s3:GetObject` sobre `c01-artefactos/triton/*` y `s3:ListBucket` con ese prefijo.
- Gateway: **ningún permiso de S3**. En el diseño base recibe los bytes de la foto en la request. Que un componente no tenga rol también es una respuesta válida.
- Fluent Bit: `s3:PutObject` sobre `c01-logs/predicciones/*`.
- Etiquetado: `s3:GetObject` sobre `c01-etiquetado/seleccionadas/*` y `s3:PutObject` sobre `c01-etiquetado/etiquetas/*`.
- Con tu diseño, el atacante en el gateway **no lee nada de S3**. Con `s3:*` sobre `*`, leería los pesos, todos los logs y las fotos para etiquetar, y además podría borrarlos.
? [reto] Un hospital quiere segmentar tomografías: cada estudio pesa ≈ 400 MB, la promesa es entregar en 2 horas y llegan ≈ 30 estudios al día, casi todos de 8:00 a 16:00. Cada estudio tarda ≈ 70 minutos en una GPU. ¿Endpoint de tiempo real, inferencia asíncrona gestionada o workers propios con cola? Justifica con los límites de la lección.
- Tiempo real: no. 400 MB ≫ 6 MiB de payload, y 70 minutos ≫ 60 s de respuesta.
- Asíncrona gestionada: el payload cabe (≤ 1 GB), pero **70 minutos > 1 hora** de tiempo máximo por trabajo. Tal como está, no cabe.
- Workers propios con cola y escala a cero: encaja. Nadie espera en segundos, hay horas sin tráfico (de noche) y la promesa de 2 horas deja lugar a un arranque en frío de minutos.
- Alternativa: si el modelo se acelera para bajar de 1 hora, la inferencia asíncrona gestionada vuelve a ser opción, sin operar workers. Primero, la pregunta de siempre: ¿quién opera la cola y los workers?
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M13 · Nube** es esta lección hecha diseño: las plataformas de ML de las tres nubes pieza por pieza, el contrato del contenedor, la cuenta de C01 en SageMaker AI (≈ 1.9×) y la de Textract contra OCR propio, con las cuatro preguntas.
- **M06 · Orquestación y escalado** desarma los dos lazos del autoscaling (HPA, KEDA, Karpenter), el arranque en frío de Triton etapa por etapa y la tabla de serverless con GPU.
- **M15 · Seguridad** usa los roles por componente, la tabla de C05, la identidad del workload y el orden de preferencia de los secretos.

**En el Dojo:** la estación 9, «Kubernetes», arma el autoscaling con HPA y KEDA y las cuentas de servicio de cada pod. La estación 7 ya construye la imagen que correría en cualquiera de los escalones de esta lección.

**En Sensei:** con esta lección termina «La nube». La fase de seguridad sigue donde se queda IAM: cómo se identifica un cliente de fuera (JWT, API keys), cómo se cifran los datos con KMS y qué es un IDOR.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
servicio-gestionado gestionado-vs-propio kubernetes-gestionado plano-de-control plataforma-ml endpoint-gestionado inferencia-asincrona serverless funcion-serverless contenedor-serverless autoscaling cold-start scale-to-zero iam politica-permisos rol-iam minimo-privilegio cuenta-servicio credenciales-temporales identidad-workload
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuál de las cuatro preguntas de gestionado contra propio suele ganar, y por qué?
«¿Quién lo opera?» Porque la gente cuesta más que casi cualquier diferencia de factura: si nadie sabe operarlo, el lado propio sale caro aunque la factura sea menor.
? ¿Qué cubre el SLA de EKS y qué no?
Cubre la API del plano de control de Kubernetes. No cubre tus pods ni tus nodos: tu disponibilidad la construyes tú.
? En C01, ¿de dónde sale casi toda la diferencia entre SageMaker AI y el Triton propio?
De los cobros por GB (datos procesados y el endpoint de interfaz), ≈ US$1,212 al mes; el sobreprecio de las máquinas son ≈ US$307.
? ¿Qué número decide si serverless con GPU sale más barato que una GPU dedicada?
Las horas de GPU activa al día. Con la L4 de la lección, el cruce está en ≈ 18 horas.
? ¿Por qué el autoscaling no absorbe un pico de segundos?
Porque una réplica nueva sin nodo libre tarda ≈ 5–13 minutos en contestar (nodo, imagen, engine). Los picos se cubren con capacidad de sobra ya prendida.
? ¿Por qué un Deny explícito gana sobre un Allow?
Para poder prohibir algo con seguridad aunque otra regla, escrita después o por otra persona, dé un permiso de más.
? ¿Qué ganas con la identidad del workload frente a una llave en un Secret?
Que no hay llave que guardar ni que se filtre: el pod recibe credenciales temporales que caducan solas, y solo los pods con esa cuenta de servicio pueden asumir el rol.
:::
