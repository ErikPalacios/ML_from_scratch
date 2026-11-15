---
titulo: Rollout seguro
en: Safe rollout
subtitulo: El décimo paso del sistema de Alba de principio a fin: llevar el modelo nuevo de la sombra al 100 % del tráfico por peldaños, con criterios escritos antes, comparando siempre contra el estable y con la versión anterior viva para volver sin levantar nada.
pregunta: El modelo de noviembre ya pasó el gate, la paridad y el pipeline, y su imagen está en el registro. ¿Cómo se pone frente a millones de fotos reales sin que un error llegue a todos, y cómo se decide, sin que nadie lo vigile, si se queda o se va?
requisitos: balanceo, ruido, pruebas-ci, e04-gate, e08-cicd, e09-kubernetes
---

:::idea
Un modelo nuevo se despliega en peldaños. Primero contesta en la sombra, sin que nadie vea su respuesta; después atiende a una parte chica del tráfico real, comparado con la versión que ya atiende y con criterios escritos antes; al final atiende a todos, con la versión anterior todavía prendida. Cada peldaño contesta una pregunta distinta y tiene escrito cómo volver: en los dos primeros, el sistema vuelve solo; en el último, con un revert que aprueba una persona.
:::

Alba es la empresa del curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día y sugiere la categoría de cada foto entre 500. Con las fotos que piden otros equipos, son ≈ 10 millones de [[request|requests]] (pedidos de un programa a otro) al día, una foto por request: ≈ 116 por segundo en promedio y ≈ 350 en el pico del mediodía. La sugerencia la hace una ResNet-50 (una red neuronal para fotos) convertida en un [[engine-tensorrt|engine de TensorRT]] (el modelo compilado para la GPU) y servida por [[triton|Triton]] (el programa que carga el modelo y contesta). Corre en [[gpu|GPUs]] T4 de NVIDIA, cada una en una máquina g4dn.xlarge de AWS (Amazon Web Services, la nube de Amazon) que cuesta US$0.526 por hora. Delante de Triton está el **gateway**, el programa en Python que recibe la foto, la valida, la prepara y le pide la respuesta a Triton.

Las nueve estaciones anteriores dejaron todo listo. El modelo de noviembre, `resnet50-2026-11-01`, es la versión 15 del [[registro-modelos|registro de modelos]], el catálogo de las versiones entrenadas. Lleva el [[alias-modelo|alias]] `challenger` (el candidato) porque pasó dos exámenes: el [[quality-gate|gate]], que lo comparó con el modelo actual en el [[golden-set|golden set]], un examen fijo de fotos con su categoría correcta; y la [[paridad-engine|paridad del engine]], que comprobó que el engine contesta lo mismo que el modelo evaluado. El que atiende hoy, en noviembre de 2026, es la versión 14, `resnet50-2026-10-01`, con el alias `champion`, la etiqueta del modelo en producción.

La imagen de Triton de la versión 15 (el paquete con el programa y el modelo, listo para correr) está en el [[registro-imagenes|registro de imágenes]], nombrada por su [[digest-imagen|digest]], su huella única. El [[pipeline]] la entregó a [[argo-cd|Argo CD]], el programa que copia al clúster lo que dice un repositorio de Git, cuando una persona aprobó el job `produccion`, el único paso que espera a un humano («CI/CD y registro de imágenes»). Y «Kubernetes» dejó corriendo los [[pod|pods]], las copias del programa en el clúster (el grupo de máquinas que Kubernetes administra), con sus probes (preguntas periódicas de «¿estás vivo?» y «¿estás listo?»), su autoscaling (más pods cuando sube el tráfico) y su rolling update.

Esta estación convierte un `challenger` probado en el examen en un `champion` probado con tráfico real.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

### Lo que entra

- **La versión 15**, `resnet50-2026-11-01`, con alias `challenger`, y su imagen `classifier-triton:resnet50-2026-11-01` en ECR (Elastic Container Registry, el registro de imágenes de AWS), por digest.
- **La versión 14**, `resnet50-2026-10-01`, con alias `champion`, sirviendo el 100 % del tráfico con sus dos pods de Triton, uno por [[zona-disponibilidad|zona]] (un centro de datos aparte, con su propia luz y su propia red).
- **El repositorio de despliegue** `alba/despliegue`, que Argo CD aplica al clúster: ahí vive cada [[manifiesto-k8s|manifiesto]] (el archivo que describe qué debe correr) y cada cambio es un [[commit]].

### Lo que sale

- **La versión 15 al 100 %** del tráfico, con el alias `champion` movido a ella en el registro.
- **La versión 14 todavía viva** 24 a 48 horas más, lista para volver en minutos sin levantar nada; después, un [[pull-request|PR]] (*pull request*, una propuesta de cambio que otra persona revisa y aprueba) la quita.
- **El registro de lo que pasó**: el reporte del shadow, cada medición del canary y quién aprobó qué.

### Lo que se decide

El gate de la estación 4 respondió una pregunta: ¿el modelo nuevo es al menos igual de bueno en un examen fijo? Eso no basta, porque el examen no es el mundo. Faltan cuatro preguntas, y cada una tiene su peldaño:

:::pasos
1. ¿Funciona con tráfico real?
Que no truene, que no tarde de más y que conteste parecido al actual con fotos de verdad. Lo responde el **shadow**: el modelo nuevo recibe copias y nadie ve lo que contesta.
2. ¿Es seguro con usuarios reales?
Que sus errores y su [[latencia]] (cuánto tarda en contestar) no empeoren cuando de verdad contesta. Lo responde el **canary**: una parte chica del tráfico, comparada con la versión estable, la que ya atiende.
3. ¿Mejora el producto?
Que la gente acepte más sugerencias. Lo responde una [[ab-test|prueba A/B]] por vendedor: dos grupos al azar, cada uno con una versión, y se mide cuál acepta más. Alba solo la corre para cambios grandes.
4. ¿Podemos volver?
Que la versión anterior siga lista mientras se confirma. Lo da el **bake**: la anterior viva 24 a 48 h.
:::

Juntos forman un [[rollout-seguro|despliegue progresivo]] (*progressive delivery*): la versión nueva gana tráfico en peldaños, y en cada uno se mide algo distinto antes de subir al siguiente.

:::figura e10-rollout-escalera
La escalera de Alba para el modelo de noviembre. Cada peldaño responde una pregunta y dura lo que dice a la derecha. Si algo sale mal, el shadow y el canary regresan solos; el bake, con un revert que aprueba una persona.
:::

### Por qué no basta un rolling update

«Kubernetes» presentó el [[rolling-update|rolling update]]: el [[deployment-k8s|Deployment]] (el objeto que mantiene corriendo N copias iguales de un pod) reemplaza los pods viejos por nuevos de a poco, y solo sigue si cada pod nuevo pasa su probe de [[readiness]], la pregunta periódica «¿ya puedes recibir tráfico?». Suena a despliegue seguro. Para un modelo no lo es, por tres razones.

La primera: la readiness mide **salud, no calidad**. Pregunta «¿el proceso contesta?», y un modelo que confunde tenis con botas contesta perfecto, en 30 ms, con 94 % de [[confianza]]. El rolling update lo daría por bueno y seguiría.

La segunda: no controla el **porcentaje**. Con 2 pods de Triton y `maxSurge: 1` (Kubernetes puede prender 1 pod de más mientras dura el cambio), hay 3 pods y el primero nuevo ya recibe un tercio del tráfico; en cuanto sale uno viejo, la mitad.

La tercera: no compara nada. No sabe cómo le iba a la versión anterior, así que no puede notar que la nueva va peor.

Por eso el rolling update se queda para cambios que no tocan lo que contesta el modelo, como la memoria de un pod o los plazos de una probe.

### Qué cambio sube qué peldaños

No todo cambio sube todos los peldaños. En Alba:

| Cambio | Peldaños | Cada cuánto |
|---|---|---|
| Reentrenamiento mensual (la versión 15) | gate → shadow 1–2 días → canary 5 % → 25 % → 100 % → bake | 1 al mes |
| Código del gateway (sin cambiar el modelo) | [[ci\|CI]] (las pruebas automáticas) → canary 5 % por 1 h → 25 % por 1 h → 100 %, sin shadow | varias veces por semana |
| Arquitectura nueva o categorías nuevas | gate → shadow → canary → A/B de 1–2 semanas → 100 % | pocas veces al año |

La regla de fondo: **cada peldaño cuesta tiempo, y se paga solo donde el riesgo lo pide**. Un cambio de código del gateway no cambia lo que contesta el modelo, así que no necesita sombra. Un modelo con otra arquitectura puede cambiar de formas que solo mide la gente: necesita el A/B.

## Shadow: contestar en la sombra {Shadow: answering in the dark}

### Qué es

Un [[shadow]] (despliegue en sombra; también *dark launch*) es correr la versión nueva con copias de requests reales, guardar lo que contesta y **tirarlo**: el usuario solo ve la respuesta de la versión actual. El mecanismo que hace las copias es la [[traffic-mirroring|copia de tráfico]] (*traffic mirroring*).

Mide al modelo nuevo con las fotos de hoy, con su mezcla real de celulares, luz y categorías, sin arriesgar a nadie. Lo que no mide es a la gente: nadie vio esas sugerencias, así que nadie las aceptó ni las rechazó. El shadow responde «¿funciona?», nunca «¿ayuda?».

:::analogia El copiloto con el volante desconectado
Imagina un auto de autoescuela donde el volante del alumno está desconectado: él gira como si manejara, el instructor maneja de verdad, y una cámara graba los dos volantes. Al final del día comparas: ¿dónde giró distinto el alumno?

Dónde se rompe: en el auto, el alumno ve el camino que eligió el instructor, y eso cambia lo que hace después. En el shadow cada foto es independiente: la respuesta del challenger nunca cambia la foto siguiente. Por eso el shadow tampoco ve los efectos que dependen de lo que el usuario hizo con la sugerencia.
:::

### Quién copia y adónde va la copia

En Alba copia el **gateway** de la versión vigente, la 14. Por cada request decide si es de la muestra, contesta como siempre con su Triton y, aparte, manda la misma foto ya preparada (convertida en el [[tensor]] que espera el modelo) al Triton de la versión 15, que corre en su propia T4. Tres reglas cuidan que la copia nunca afecte al usuario:

- **Va en una tarea aparte**, con su propio plazo (el tiempo máximo que se le espera). La respuesta al usuario no espera a la copia.
- **La cola de copias es acotada**: una fila de espera con lugares fijos: si se llena, la copia se tira. Una sombra lenta nunca frena al camino de verdad.
- **La respuesta del challenger solo va al log**, el archivo donde el gateway anota cada request: una línea con el mismo [[request-id|`request_id`]] (el identificador único de la request), `model_version: resnet50-2026-11-01` y `shadow=true`. Nunca al usuario, nunca a la base de datos.

Qué requests se copian lo decide el [[funcion-hash|hash]] del `request_id`: una cuenta que convierte el texto del id en un número que parece al azar, pero que sale siempre igual para el mismo id. El gateway copia si ese número cae en el 10 % de los valores posibles. Es la [[asignacion-hash|asignación por hash]] de «Tiempo, hashes e identificadores»: la misma request siempre cae del mismo lado, y cualquiera puede repetir la decisión después.

:::diagrama e10-rollout-shadow
El camino de una foto en el shadow de Alba. Toca cada caja; el recorrido sigue una request copiada desde que llega hasta que su par aparece en el reporte diario.
:::

### Cuánto junta

:::formula Pares y desacuerdos del shadow
N_p = R_d × m
N_d = N_p × (1 − a)
- R_d: las requests de un día, en requests
- m: la fracción que se copia, sin unidad (0.10 = 10 %)
- N_p: los pares de un día, en pares; un par es una respuesta del champion y una del challenger para la misma foto
- a: el [[acuerdo-top1|acuerdo top-1]], la fracción de pares en que los dos modelos ponen la misma categoría en primer lugar, sin unidad
- N_d: los desacuerdos de un día, en pares
:::

:::cuenta El shadow de la versión 15, un día
Requests de un día, \(R_d\) // el tráfico de Alba | ≈ 10 M | 10,000,000
Pares de un día, \(N_p = R_d × m\) // \(m\) = 0.10 | 10,000,000 × 0.10 | 1,000,000
Acuerdo top-1, \(a\) // supuesto del ejemplo: dos modelos con un mes de diferencia | — | 0.94
Desacuerdos de un día, \(N_d = N_p × (1 − a)\) // \(1 − a\) = 1 − 0.94 | 1,000,000 × 0.06 | 60,000
Parte de \(N_d\) que revisa una persona // una muestra al azar de 300 a 500 | 300 ÷ 60,000 a 500 ÷ 60,000 | ≈ 0.5–0.8 %
= Un día de sombra da un millón de comparaciones y 60,000 desacuerdos. Nadie los lee todos: se miden en grupo y se revisa a mano una muestra de 300 a 500.
:::

Un millón de pares sobra para medir el acuerdo. Su [[error-estandar|error estándar]] (cuánto se movería si repitieras la medición con otra muestra) es \( sqrt{a × (1 − a) ÷ N_p} \) = \( sqrt{0.94 × 0.06 ÷ 1,000,000} \) ≈ 0.0002: dos centésimas de punto porcentual. ¿Por qué entonces 1 o 2 días y no una hora? Para ver el día completo, con su madrugada, su pico del mediodía y sus fotos de noche, y para que las categorías chicas junten casos.

### Qué se compara, con umbrales escritos antes

El job diario (un programa que corre una vez al día y termina) une las dos líneas de cada `request_id` y mide cuatro cosas. Los umbrales viven en el repositorio desde antes de mirar, igual que los del gate, para que nadie los acomode después de ver los números:

| Medida | Umbral de Alba |
|---|---|
| Acuerdo top-1 con el champion | ≥ 90 % |
| [[p99\|p99]] del challenger (la latencia que solo el 1 % de las requests supera) | ≤ 1.1 × el del champion |
| Caídas (*crashes*) del Triton nuevo: veces que el proceso se muere | cero |
| Acuerdo en las 20 categorías más grandes | ninguna < 85 % |

El acuerdo no es exactitud (la fracción de aciertos): dos modelos pueden coincidir en lo mismo y los dos estar mal. Mide **cuánto cambió** el comportamiento. Un acuerdo de 99.9 % en un reentrenamiento diría que el modelo nuevo casi no aprendió nada; uno de 70 % diría que algo se rompió (unas categorías desordenadas, un preproceso distinto). Los 300 a 500 desacuerdos revisados dicen **en qué** cambió: si el nuevo acierta donde el viejo fallaba, el cambio es bueno.

:::profundo El código: la muestra por hash y los pares
Decide la muestra por hash y une los pares, en chico.

```python
import hashlib

def a_la_sombra(request_id, m=0.10):          # m: la fracción que se copia
    h = int(hashlib.sha256(request_id.encode()).hexdigest()[:8], 16)  # la huella, como número
    return h % 10_000 < m * 10_000             # el mismo id, siempre la misma decisión

ids = [f"r-{i:06d}" for i in range(100_000)]
print("copiadas:", sum(a_la_sombra(r) for r in ids), "de", len(ids))
print("r-000042:", a_la_sombra("r-000042"), "· otra vez:", a_la_sombra("r-000042"))

# El job diario une las dos líneas que comparten request_id
champion   = {"r-001": "Calzado › Tenis", "r-004": "Deportes › Bicis",
              "r-005": "Hogar › Lámparas", "r-006": "Hogar › Lámparas"}
challenger = {"r-001": "Calzado › Tenis", "r-004": "Deportes › Bicis",
              "r-005": "Hogar › Iluminación", "r-006": "Hogar › Lámparas"}
pares = [(champion[r], challenger[r]) for r in champion if r in challenger]
acuerdo = sum(a == b for a, b in pares) / len(pares)
print(f"pares: {len(pares)} · acuerdo top-1: {acuerdo:.0%}")
print("a revisión:", [r for r in champion if champion[r] != challenger.get(r)])
```

```salida
copiadas: 9955 de 100000
r-000042: False · otra vez: False
pares: 4 · acuerdo top-1: 75%
a revisión: ['r-005']
```

De 100,000 ids se copian 9,955, casi exactamente el 10 %, y la misma request da la misma respuesta las dos veces. La foto de la lámpara de Caro, otra vendedora (`r-005`), es el único desacuerdo: el champion dice «Lámparas» y el challenger «Iluminación». Es el tipo de caso que revisa una persona: las dos podrían estar bien.
:::

### Lo que el shadow no debe hacer

El peligro del shadow son los **efectos secundarios**: lo que la copia hace en el mundo además de contestar. Si el challenger guardara su respuesta en la base de datos de publicaciones, la sugerencia de Ana cambiaría sin que nadie lo decidiera. Si mandara un correo, Ana recibiría dos. Si gastara una cuota de un proveedor externo, la pagaría el doble. En Alba es fácil cumplirlo, porque Triton solo calcula: recibe un tensor y devuelve números. Pero la regla vale para cualquier sistema: **la copia lee y calcula; nunca escribe fuera de su log**.

:::ojo
El shadow tampoco debe tocar el [[cache|caché]] del estable, la memoria rápida que guarda respuestas ya calculadas para no repetirlas. Si el challenger guardara su respuesta en un caché compartido, bajo la llave de la foto (el nombre con que se guarda y se busca), la siguiente request de esa foto recibiría la respuesta del challenger, servida al usuario sin canary. Por eso cualquier caché de predicciones lleva la versión del modelo en la llave.
:::

Cuesta poco: una T4 más mientras dura, a US$0.526 por hora, ≈ US$13 por día. Lo que de verdad cuesta es el tiempo: 1 o 2 días antes de que la versión 15 atienda a nadie.

## La release y el canary con Argo Rollouts {The release and the canary with Argo Rollouts}

### Una release es un par

Antes de repartir tráfico hay que saber **qué** se reparte. Una release es una versión publicada del sistema. En Alba, una [[release-par|release]] es un par: el gateway de esa versión más el Triton de esa versión. Cada versión del modelo corre en su propio Deployment, `triton-v15`, con su propio [[service-k8s|Service]] `triton-v15`: un nombre fijo dentro del clúster que reparte las requests entre los pods de ese Deployment. El gateway de la release 15 trae tres cosas que apuntan a su modelo y solo a él:

- `TRITON_URL=triton-v15.classifier.svc.cluster.local:8000`: el nombre de su Triton dentro del clúster, en una [[variable-entorno|variable de entorno]] (un valor que el programa lee al arrancar).
- `MODEL_VERSION=resnet50-2026-11-01`, otra variable de entorno.
- Su [[labels-json|`labels.json`]]: las 500 categorías en el orden de las salidas del modelo. Viene de un [[configmap|ConfigMap]] (un archivo de configuración guardado en el clúster) por versión, `classifier-labels-15`, y su huella SHA-256 va en otra variable de entorno. El gateway la verifica al arrancar: si la huella no coincide o no hay 500 nombres, el proceso termina y el pod nunca llega a estar listo.

¿Por qué tanto cuidado? Porque **nunca debe haber dos modelos detrás del mismo nombre**. Si los pods del gateway de la 15 pudieran caer en el Triton de la 14, la sugerencia de una foto dependería de a qué pod le tocó, y ninguna métrica sabría a qué versión culpar. Con el par, cada request tiene una sola versión, y esa versión va escrita en su log y en sus métricas.

### Quién reparte el tráfico

El gateway de Alba no es un Deployment: es un **Rollout** de [[argo-rollouts|Argo Rollouts]]. Un Rollout es un objeto que trae el mismo template de pod que un Deployment (la plantilla que dice cómo es cada pod: su imagen, sus variables, sus recursos), más una lista de pasos del canary. Su controlador, un programa que corre dentro del clúster en el [[namespace-k8s|namespace]] `argo` (un apartado del clúster con nombre propio), ejecuta esos pasos. Argo CD lo aplica como cualquier otro manifiesto: lo que cambia en Git es el template del gateway (su `TRITON_URL`, su `MODEL_VERSION`, su ConfigMap de labels), y ese cambio dispara el canary.

Un [[canary]] es mandar una parte chica del tráfico real a la versión nueva, por etapas, y avanzar solo si en cada etapa se ve tan bien como la estable. El nombre viene de los canarios que los mineros bajaban a la mina: si el aire se envenenaba, el canario lo notaba primero.

El porcentaje lo pone el [[alb|ALB]] (*Application Load Balancer*), el balanceador de AWS que recibe el tráfico de Alba: el programa que reparte las requests entre varios destinos. Reparte con pesos, como cuenta «Balanceadores, proxies y gateways»: sus dos destinos son los Services `gateway-stable` y `gateway-canary`, y con pesos 95 y 5, 1 de cada 20 requests va al canary.

¿Quién mueve esos pesos? Argo Rollouts los escribe, cada uno de 0 a 999, en una anotación (una nota de configuración pegada al objeto) del [[ingress|Ingress]] `gateway`, la regla que dice cómo entra el tráfico de afuera al clúster. El AWS Load Balancer Controller, el programa que traduce el Ingress a la configuración del ALB, los aplica. Al 5 % en el pico el canary recibe 350 × 5 ÷ 100 = 17.5 requests por segundo.

El Triton de la 15 se despliega **antes**, sin tráfico: es un Deployment nuevo, con **un solo pod** (la T4 de más), y solo lo llaman los pods canary del gateway. Es el mismo pod que sirvió al shadow, así que el canary no espera los ≈ 5–13 minutos que tarda un pod nuevo de Triton. Un pod basta: al 25 % en el pico recibe 350 × 25 ÷ 100 = 87.5 fotos por segundo, y una T4 contesta ≈ 1,200 por segundo.

### Los pasos

Así se ve la parte del canary en el Rollout del gateway. Es una ilustración, recortada: las reglas del análisis se cuentan en la sección siguiente. Cada línea que empieza con `-` en `steps` es un paso: `setWeight` pone el peso del canary en % y `pause` espera ese tiempo antes del paso siguiente.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: {name: gateway, namespace: classifier}
spec:
  rollbackWindow: {revisions: 3}           # volver a una de las 2 anteriores se salta los pasos
  strategy:
    canary:
      stableService: gateway-stable        # Service que ve solo los pods estables
      canaryService: gateway-canary        # Service que ve solo los pods nuevos
      scaleDownDelaySeconds: 172800        # el gateway anterior sigue prendido 48 h (el bake)
      trafficRouting:
        alb: {ingress: gateway, servicePort: 8080}   # los pesos los aplica el ALB
      analysis:                            # corre de fondo durante todo el canary
        templates: [{templateName: canary-vs-estable}]
      steps:
        - setWeight: 5
        - pause: {duration: 4h}            # cubre el pico del mediodía
        - setWeight: 25
        - pause: {duration: 4h}
        - setWeight: 100
```

Las dos líneas de arriba, `rollbackWindow` y `scaleDownDelaySeconds`, son las del bake, el tiempo en que la versión anterior sigue prendida al final: las explica «Promover, el A/B y el bake». Tres decisiones están en los pasos.

**Por qué 5 %.** Es el tamaño de la apuesta: si la versión 15 está mal, afecta a 1 de cada 20 requests mientras la detectan, no a todas. Y es suficiente para juntar evidencia: 17.5 requests por segundo en el pico.

**Por qué horas, no minutos.** En 10 minutos de pico ya se juntan ≈ 10,500 requests, que bastan para ver un salto de errores. Pero el tráfico cambia con la hora: las fotos de la mañana no son las de la noche, y el pico estresa la latencia como no la estresa la madrugada. Cada paso de 4 horas incluye el pico del mediodía. Un cambio solo de código del gateway usa pasos de 1 hora, porque no cambia lo que contesta el modelo.

**Por qué sin pausa manual.** Los dos `pause` tienen duración: nadie aprieta un botón para pasar de 5 a 25 ni de 25 a 100. La única aprobación humana fue la del job `produccion`, antes de que Argo CD aplicara el cambio. Después, lo automático decide: si el análisis falla, revierte; si no, avanza cuando se cumple el tiempo.

:::profundo Cuando sí espera a una persona
Si una medición sale **inconclusa** (no cumple ni la condición de verde ni la de falla), Argo Rollouts pausa el Rollout hasta que alguien lo reanude o lo aborte.
:::

### Cuánto tarda en juntar la evidencia

Cada decisión del criterio de errores 5xx necesita un mínimo de requests para que su medición diga algo: en Alba, 10,000 requests del canary (el PSI pide 5,000 predicciones). La sección siguiente explica por qué hace falta. Lo que importa aquí es cuánto se tarda en juntarlas, que depende del tráfico de esa hora.

:::formula Minutos para juntar el n mínimo
t_n = frac{n_{min}}{Q × w ÷ 100 × 60}
- n_{min}: las requests del canary que pide el criterio antes de decidir, en requests
- Q: el tráfico total en ese momento, en requests por segundo
- w: el peso del canary, en % (por eso se divide entre 100)
- t_n: el tiempo que tarda en juntar \(n_{min}\), en minutos (el × 60 pasa de requests por segundo a requests por minuto)
:::

:::cuenta Cuánto tarda el canary de la versión 15 en juntar 10,000 requests
Mínimo por decisión, \(n_{min}\) // el de Alba | — | 10,000
Al 5 % en el pico, \(t_n\) // \(Q\) = 350, \(w\) = 5: 17.5 por segundo | 10,000 ÷ (350 × 5 ÷ 100 × 60) | ≈ 9.5 min
Al 5 % en promedio, \(t_n\) // \(Q\) = 116: 5.8 por segundo | 10,000 ÷ (116 × 5 ÷ 100 × 60) | ≈ 29 min
Al 5 % de madrugada, \(t_n\) // \(Q\) ≈ 20, supuesto del curso: 1 por segundo | 10,000 ÷ (20 × 5 ÷ 100 × 60) | ≈ 167 min ≈ 2.8 h
Al 25 % en el pico, \(t_n\) // \(Q\) = 350, \(w\) = 25: 87.5 por segundo | 10,000 ÷ (350 × 25 ÷ 100 × 60) | ≈ 1.9 min
= En el pico, el n mínimo llega en menos de 10 minutos; de madrugada, en casi 3 horas. Un paso de 4 horas que empieza de mañana siempre lo junta.
:::

:::diagrama e10-rollout-canary
El canary de la versión 15 con Argo Rollouts. Toca cada caja; un recorrido sigue la promoción completa y el otro, un aborto.
:::

## Comparar contra el estable, con n mínimo {Compare against the stable version, with a minimum n}

### Los criterios

Un [[criterio-promocion|criterio de promoción]] es la regla, escrita antes de empezar, que dice qué tiene que cumplir el canary para subir al siguiente peldaño. Su espejo es el [[rollback-automatico|rollback automático]]: la regla que, si se rompe, regresa el tráfico al estable sin esperar a nadie.

Alba tiene dos clases de reglas. Las primeras son **topes absolutos**, los mismos de su promesa de servicio: si el canary pasa de 0.5 % de errores 5xx o su p99 pasa de 200 ms, se revierte. Un error 5xx es una respuesta con [[codigo-estado|código de estado]] del 500 al 599: el servidor falló. Las segundas reglas **comparan contra el estable**, y cada una tiene su ventana, el pedazo de tiempo en que se mide:

| Señal | Revierte si | Ventana |
|---|---|---|
| Errores 5xx | ≥ 2 × el estable, con ≥ 10,000 requests del canary | 10 min, o hasta juntar el n mínimo |
| Latencia [[p99\|p99]] | > 1.2 × el estable | 10 min |
| Baja confianza (top-1 < 0.3) | > 1.5 × el estable | 30 min |
| [[psi\|PSI]] de las categorías que predice | > 0.1, con ≥ 5,000 predicciones, sobre ≈ 30 categorías padre | 1 h |

La baja confianza es la parte de fotos en que el modelo duda: la probabilidad de su primera categoría es menor que 0.3. El PSI (*population stability index*, de «Comparar distribuciones: cómo se mide el drift») es un número que mide cuánto cambió una mezcla: aquí, qué fracción de las fotos cae en cada categoría. Vale 0 si las dos mezclas son iguales y crece mientras más se separan. Las categorías padre son los ≈ 30 grupos que juntan a las 500, como «Calzado», que junta «Tenis» y «Botas».

Estas dos son las únicas señales que miran **qué contesta** el modelo, no solo si contesta, y ningún probe las ve. El PSI, además, atrapa al modelo que se equivoca con confianza, que la baja confianza no nota.

:::profundo De dónde salen los números
El análisis los lee de Prometheus, el sistema que junta y guarda cada pocos segundos las métricas de todos los programas. La baja confianza sale del [[histograma]] de la confianza top-1 que el gateway ya publica (cuántas fotos cayeron en cada rango de confianza), separado por `model_version`. El PSI lo calcula cada hora un job que lee el log de cada versión y publica el resultado como métrica.
:::

### Por qué contra el estable, en la misma ventana

El [[analisis-canary|análisis del canary]] compara al canary contra el estable **en la misma ventana de tiempo**, no contra un número fijo ni contra ayer. La razón es el ruido del día.

Imagina que a las 13:00 una campaña llena el marketplace de fotos de bicis. La baja confianza sube en las dos versiones, porque las bicis con accesorios son difíciles. Un umbral fijo («baja confianza > 8 %») dispararía por la campaña, no por el modelo. Comparar contra ayer, igual. Comparar canary contra estable, en los mismos 30 minutos, cancela la campaña: las dos versiones ven la misma mezcla de fotos, porque los pesos reparten al azar por request. Si la razón entre las dos se mueve, es el modelo.

Los topes absolutos se quedan como red: si todo el sistema está mal (las dos versiones con 1 % de errores), la comparación diría «iguales» y el tope frena igual.

### El ruido de una regla sin n mínimo

Una regla relativa con pocas requests es peligrosa al revés: revierte versiones buenas. El [[n-minimo-canary|n mínimo de un criterio]] es cuántas requests (o predicciones) tiene que juntar el canary antes de que esa regla pueda decidir. Para ver por qué hace falta, cuenta cuántos errores 5xx ve un canary **idéntico** al estable.

Supón que el estable falla en el 0.1 % de las requests. No es su tasa normal: es el peor caso que permite la promesa de Alba (99.9 % de requests buenas, así que hasta 0.1 % malas), y con ese supuesto diseña Alba su regla. Si la tasa real es menor, se esperan menos errores y el azar pesa más: lo ves en la calculadora de abajo.

Los errores que caen en \(n\) requests del canary siguen, aproximadamente, una distribución de [[poisson|Poisson]], como las llegadas de «Probabilidad». Es la que describe cuántas veces pasa algo raro cuando hay muchas oportunidades: la probabilidad de que caigan exactamente \(i\) errores cuando se esperan \(λ\) es \(λ^i × e^{−λ} ÷ i!\), donde \(e\) ≈ 2.718 e \(i!\) = 1 × 2 × … × \(i\). La regla «canary ≥ 2 × el estable» dispara cuando caen el doble de los esperados. Al 5 %, el estable tiene 95 ÷ 5 = 19 veces más tráfico, así que su tasa casi no se mueve: el ruido está en el canary.

:::formula Falsa alarma de una regla relativa
n = Q × w ÷ 100 × 60 × v
λ = n × p_0
k = ⌈2 × λ⌉
f = P(X ≥ k)
P(X ≥ k) = 1 − sum_{i=0}^{k−1} frac{λ^i × e^{−λ}}{i!}
J = 60 × t_p ÷ v
F = 1 − (1 − f)^J
- v: la ventana de una decisión, en minutos
- n: las requests del canary en esa ventana, en requests (\(Q\) en requests por segundo y \(w\) en %, como en los minutos del n mínimo; el × 60 pasa de segundos a minutos)
- p_0: la tasa de 5xx del estable, como fracción (0.001 = 0.1 %)
- λ: los errores que se esperan en el canary si es igual al estable, en errores
- k: los errores que hacen disparar la regla «≥ 2 × el estable», en errores; ⌈ ⌉ redondea hacia arriba
- X: los errores que de verdad caen en la ventana, un número al azar
- i: un número de errores posible (0, 1, 2…), el que recorre la suma; \(i!\) = 1 × 2 × … × \(i\), y 0! = 1
- f: la probabilidad de una falsa alarma en una decisión, sin unidad
- t_p: la duración del paso del canary, en horas (el × 60 la pasa a minutos)
- J: las decisiones que se toman en un paso del canary, sin unidad
- F: la probabilidad de al menos un rollback falso en todo el paso, sin unidad
:::

:::cuenta Un paso de 4 horas al 5 %, en tráfico promedio y sin n mínimo
Requests en una ventana, \(n = Q × w ÷ 100 × 60 × v\) // \(Q\) = 116, \(w\) = 5, \(v\) = 10 | 116 × 5 ÷ 100 × 60 × 10 | 3,480
Errores esperados, \(λ = n × p_0\) // \(p_0\) = 0.001 | 3,480 × 0.001 | 3.48
Umbral, \(k = ⌈2 × λ⌉\) | ⌈6.96⌉ | 7 errores
Falsa alarma en una ventana, \(f = P(X ≥ 7)\) // con \(λ\) = 3.48, del código de abajo | 1 − P(X ≤ 6) | ≈ 6.4 %
Decisiones en el paso, \(J = 60 × t_p ÷ v\) // \(t_p\) = 4 h | 60 × 4 ÷ 10 | 24
Al menos un rollback falso, \(F = 1 − (1 − f)^J\) // \(1 − f\) = 1 − 0.064 | 1 − 0.936^24 | ≈ 79 %
= Una versión idéntica al estable se revertiría en 4 de cada 5 pasos. Con el n mínimo de 10,000: \(λ\) = 10, \(k\) = 20, \(f\) ≈ 0.35 % y, con ≈ 8 decisiones en 4 horas de tráfico promedio (\(t_n\) ≈ 29 min cada una), \(F\) ≈ 2.7 %.
:::

:::profundo El código de las tres cuentas
Las tres cuentas a la vez: de madrugada en un paso de 1 hora (como el de un cambio del gateway), en promedio y con el n mínimo.

```python
import math

def p_al_menos(k, lam):                      # P(X ≥ k) si X sigue una Poisson(λ)
    return 1 - sum(math.exp(-lam) * lam**i / math.factorial(i) for i in range(k))

p0 = 0.001                                   # 5xx del estable: 0.1 % (supuesto)
for caso, n, J in [("madrugada, 10 min", 600, 6),
                   ("promedio, 10 min", 3_480, 24),
                   ("con n mínimo", 10_000, 8)]:
    lam = n * p0                             # errores esperados si el canary es igual
    k = math.ceil(2 * lam)                   # la regla: canary ≥ 2 × el estable
    f = p_al_menos(k, lam)                   # falsa alarma en una decisión
    F = 1 - (1 - f) ** J                     # al menos una en J decisiones
    print(f"{caso:17} n={n:>6} λ={lam:5.2f} k={k:>2} f={f:6.2%} F={F:5.1%}")
```

```salida
madrugada, 10 min n=   600 λ= 0.60 k= 2 f=12.19% F=54.2%
promedio, 10 min  n=  3480 λ= 3.48 k= 7 f= 6.38% F=79.4%
con n mínimo      n= 10000 λ=10.00 k=20 f= 0.35% F= 2.7%
```
:::

De madrugada (\(Q\) ≈ 20), una ventana de 10 minutos junta solo \(n\) = 600 requests: \(λ\) = 0.6, y bastan \(k\) = 2 errores para disparar. En un paso de 1 hora, con 6 decisiones, la versión buena se revierte más de la mitad de las veces (\(F\) ≈ 54 %). Por eso la ventana de Alba no es «10 minutos» a secas: es «10 minutos, o lo que tarde en juntar 10,000». De madrugada, una decisión tarda horas; en el pico, menos de 10 minutos.

:::calculadora e10-rollout-falsa-alarma
Arranca con el paso de 4 horas al 5 % en tráfico promedio, sin n mínimo: \(F\) ≈ 79 %. Sube la ventana \(v\) a 29 min, la primera en que \(n\) pasa de 10,000 (da 10,092): \(f\) cae a ≈ 0.18 % y \(F\) a ≈ 1.4 %, con solo 8 decisiones \(J\).

Luego baja \(p_0\) a 0.05 %. Con menos errores de base, la misma ventana de 29 min vuelve a dar falsas alarmas (\(f\) ≈ 1.5 % y \(F\) ≈ 11 %): hace falta todavía más \(n\).
:::

:::profundo De dónde sale el 10,000
Con el estable 19 veces más grande que el canary, la cuenta de «Diseñar el A/B» en «Ruido, muestras y pruebas A/B» se adapta a dos grupos de distinto tamaño. Dos palabras de esa lección: la [[significancia]] \(α\) es la probabilidad que aceptas de ver un salto que no existe, y la [[potencia]] \(1 − β\) es la probabilidad de ver un salto que sí existe. Para detectar que la tasa del canary sube de \(p_0\) a \(p_1\), el canary necesita:

:::formula Requests del canary para detectar un salto de errores
g_α = z_α × sqrt{p_{comb}(1 − p_{comb})(1 + 1/r)}
g_β = z_β × sqrt{p_1(1 − p_1) + p_0(1 − p_0)/r}
n_{min} ≈ frac{(g_α + g_β)^2}{(p_1 − p_0)^2}
- p_0, p_1: la tasa del estable y la del canary que se quiere detectar, como fracciones (aquí \(p_0\) es la del estable, no la tasa combinada que esa lección llama así)
- r: cuántas veces más tráfico tiene el estable (19 al 5 %)
- p_{comb}: la tasa combinada de los dos grupos, \((p_1 + r × p_0)/(1 + r)\)
- z_α: 1.96, para una significancia de 0.05 en dos colas
- z_β: 0.84, para una potencia de 0.8
- g_α, g_β: las dos partes del numerador, sin unidad
- n_{min}: las requests del canary que hacen falta para ver el salto, en requests
:::

Con \(p_0\) = 0.1 %: para ver un salto a 0.5 %, el tope absoluto, bastan \(n_{min}\) ≈ 1,040, un minuto de pico al 5 % (17.5 × 60 = 1,050). Para ver que se **duplica**, a 0.2 %, hacen falta \(n_{min}\) ≈ 10,650: de ahí el n mínimo de 10,000. Y si el estable anda en 0.05 %, duplicarse a 0.1 % pide \(n_{min}\) ≈ 21,300: el n mínimo de un criterio se diseña con la tasa real, y se revisa cuando esa tasa cambia.
:::

## El PSI del canary y su piso de ruido {The canary's PSI and its noise floor} [extra]

### Una señal que mira las respuestas

El PSI del canary compara la mezcla de categorías que predice el canary contra la del estable, en la misma hora. Si la versión 15 empieza a mandar a «Calzado» fotos que la 14 mandaba a «Deportes», la mezcla cambia y el PSI sube. Es la señal que atrapa un `labels.json` desordenado: las respuestas siguen saliendo con buena confianza, pero en las categorías equivocadas.

El problema es que el PSI **nunca vale 0 con muestras finitas**, aunque las dos versiones sean idénticas. Cada categoría tiene su ruido, y el PSI suma lo que aporta cada una. Con muchas categorías y pocas predicciones, la suma del puro ruido pasa el umbral.

:::formula Piso de ruido del PSI
ψ_0 ≈ (K − 1) × (frac{1}{n} + frac{1}{n_e})
- K: el número de categorías del PSI (sus *bins*), sin unidad; es una K mayúscula, distinta de la \(k\) de los errores
- n: las predicciones del canary en la ventana, en predicciones (una por request: es la misma \(n\) de la falsa alarma, ahora en una ventana de 1 h)
- n_e: las predicciones del estable en la misma ventana, en predicciones
- ψ_0: el PSI que se espera por puro azar entre dos versiones idénticas, sin unidad
:::

La fórmula sale de que cada categoría aporta, en promedio, su varianza de muestreo (cuánto se mueve su proporción por puro azar), y las \(K\) categorías suman \(K − 1\) de esas varianzas: una se pierde porque las proporciones suman 1, y conociendo \(K − 1\) la última ya está decidida. Es una aproximación: falla cuando muchas categorías tienen conteos de 0 o 1.

Con las 500 categorías y una hora de madrugada al 5 % (\(Q\) ≈ 20, así que \(n\) = 20 × 5 ÷ 100 × 3,600 s = 3,600 y \(n_e\) = 19 × 3,600 = 68,400): \(ψ_0\) ≈ 499 × (1/3,600 + 1/68,400) ≈ 0.146. Más que el umbral de 0.1: el canary se revertiría **de noche, por azar**. Por eso Alba agrupa las 500 en ≈ 30 categorías padre (\(K\) = 30) y exige ≥ 5,000 predicciones del canary (\(n_e\) = 19 × 5,000 = 95,000): \(ψ_0\) ≈ 29 × (1/5,000 + 1/95,000) ≈ 0.006, dieciséis veces abajo del umbral.

El código lo comprueba con 20 horas simuladas de un canary y un estable idénticos, sacados de la misma mezcla.

```python
import math, random
from collections import Counter

def psi(a, e, K, na, ne):                    # PSI entre dos conteos, con medio conteo de colchón
    s = 0.0
    for i in range(K):
        pa, pe = (a[i] + 0.5) / (na + 0.5 * K), (e[i] + 0.5) / (ne + 0.5 * K)
        s += (pa - pe) * math.log(pa / pe)
    return s

random.seed(7)
for K in (500, 30):                          # 500 categorías o ≈ 30 padres
    pesos = [1 / (i + 1) for i in range(K)]  # unas pocas grandes y una cola larga
    n, ne = 3_600, 19 * 3_600                # 1 h de canary de madrugada y su estable
    vals = [psi(Counter(random.choices(range(K), pesos, k=n)),
                Counter(random.choices(range(K), pesos, k=ne)), K, n, ne)
            for _ in range(20)]
    piso = (K - 1) * (1 / n + 1 / ne)
    print(f"K={K:3}: PSI medio {sum(vals)/20:.3f} · máx {max(vals):.3f} · fórmula {piso:.3f}")
```

```salida
K=500: PSI medio 0.123 · máx 0.140 · fórmula 0.146
K= 30: PSI medio 0.009 · máx 0.016 · fórmula 0.008
```

Con 500 categorías, las 20 horas de dos versiones idénticas dan un PSI de 0.11 a 0.14 (el mínimo, 0.108, no sale impreso): todas pasan el umbral de 0.1. La fórmula da un poco más que la simulación porque muchas categorías tienen conteos de 0 o 1, donde la aproximación falla, y el medio conteo de colchón (que evita dividir entre 0) achica el PSI. Con 30, ninguna hora se acerca. La mezcla de juguete, con pesos 1, 1/2, 1/3…, imita la forma de la de Alba: pocas categorías grandes y una cola larga.

:::calculadora e10-rollout-psi
Empieza con las 500 categorías de madrugada: \(ψ_0\) ≈ 0.146, arriba del umbral. Baja \(K\) a 30 y mira cómo cae. Luego sube \(Q\) a 350, el pico: con más predicciones, hasta 500 categorías quedan debajo de 0.1.
:::

## Promover, el A/B y el bake {Promote, the A/B test and the bake}

### Quién mueve `champion`

Al 100 %, con el análisis siempre verde, la versión 15 atiende a todos. Falta que el registro lo diga. Lo hace el job `promover` del pipeline: espera a que el Rollout esté sano al 100 % y mueve el alias `champion` a la versión 15 en el registro de modelos. Le pone dos etiquetas: el run (el registro del entrenamiento que produjo el modelo) y el digest de la imagen. No hay una segunda aprobación: vale la de la persona que aprobó el job `produccion` antes de que todo empezara.

«Gate de evaluación y registry» explicó por qué ningún servidor lee el alias: el pipeline lo leyó una vez y metió esa versión en la imagen. Aquí se cierra el ciclo: el alias se mueve **al final**, cuando ya es verdad. Si el canary se revierte, `champion` nunca se movió y sigue en la 14.

La regla de fondo: **lo automático revierte, una persona autoriza**. Revertir tiene que ser instantáneo y no puede esperar a que alguien despierte. Avanzar puede esperar, y por eso la persona aprueba una vez, antes de que Argo CD aplique el cambio.

### Cuando el cambio es grande: el canary por request y el A/B por vendedor

El canary reparte **por request**: cada foto tira su propio dado. Eso basta para medir salud (errores, latencia, confianza), porque cada request es independiente. No basta para medir si la gente acepta más las sugerencias: Ana vería la versión 15 en una foto y la 14 en la siguiente, y no hay forma de saber cuál la convenció.

Para eso está la [[ab-test|prueba A/B]] de «Ruido, muestras y pruebas A/B», con el vendedor como [[unidad-aleatorizacion|unidad de aleatorización]]: lo que se sortea entre los dos grupos (llamados brazos) es cada vendedor, no cada foto. Ana queda del mismo lado siempre, y se puede medir si acepta más sugerencias con una versión que con la otra. Dura de 1 a 2 semanas completas.

Alba solo lo corre para cambios grandes (arquitectura nueva o categorías nuevas). En esos, el canary sube a 5 % y a 25 % para confirmar la salud, y ahí se detiene: el A/B toma el reparto. El reentrenamiento de cada mes no lleva A/B; lleva gate, shadow y canary.

:::profundo El A/B de Alba por dentro
Con una aceptación base de ≈ 70 % y un efecto mínimo de 1 punto, hacen falta ≈ 33,000 publicaciones por brazo: por eso dura semanas completas.

El sorteo por vendedor, `hash(sal + seller_id) mod 100`, lo cuenta «Ruido, muestras y pruebas A/B». El backend de publicación (el programa que guarda las publicaciones) manda el brazo en un [[header]] (una línea de datos que viaja con la request), `X-Model-Arm`. Una regla del ALB que mira ese header lleva la request a la release de su brazo, y el gateway escribe el brazo en el log junto al `request_id`.
:::

### El bake: la anterior, viva

Llegar al 100 % no es el final. Algunos problemas solo aparecen con todo el tráfico o con el tiempo: una categoría chica que la versión 15 confunde y que en un canary del 5 % juntó pocos casos, o una fuga de memoria (un programa que pide memoria y nunca la suelta) que tarda un día en llenar el pod. Por eso existe el [[bake|bake]] (*bake time*, el tiempo de horneado): la release anterior, su gateway y su `triton-v14`, sigue prendida 24 a 48 horas después de llegar al 100 %.

El bake convierte el rollback en un **cambio de ruteo**: volver es mandar el tráfico a algo que ya está prendido, caliente y con su engine cargado. Sin bake, volver es levantar pods nuevos de Triton, que tardan minutos.

Eso es, en el fondo, un [[blue-green|blue/green]]: dos entornos completos, uno viejo (*blue*) y uno nuevo (*green*), y un switch que manda todo el tráfico a uno o al otro. Alba no hace un blue/green puro, con el salto de 0 a 100 % de golpe; hace el canary para subir, y deja el blue vivo después, como red.

:::figura e10-rollout-mecanismos
Tres formas de poner una versión nueva frente al tráfico. En el shadow, las requests van al estable y una copia va al nuevo; en el canary, cada request va a uno o al otro según el peso; en el blue/green, todas van a uno, y el switch cambia todas de golpe.
:::

Con Argo Rollouts, el bake hay que pedirlo, porque por omisión hace dos cosas que lo rompen. Apaga el gateway viejo 30 segundos después de llegar al 100 %. Y volver a él corre otra vez todos los pasos, con su 5 % por 4 horas. Dos líneas del Rollout de Alba cambian eso: `scaleDownDelaySeconds: 172800` deja el gateway viejo prendido 48 h, y `rollbackWindow: {revisions: 3}` hace que volver a una versión reciente se salte los pasos. `triton-v14` no depende de esas líneas: es un Deployment aparte, y sigue prendido hasta que un PR lo quita.

:::profundo Lo que Argo Rollouts hace por omisión
Argo Rollouts también tiene una estrategia blue/green, y ahí `scaleDownDelaySeconds` (lo que espera para apagar la versión vieja después del switch) vale **30 segundos** por omisión: si tu plan de rollback cuenta con el blue un día, a los 30 s ya no existe. Hay que ponerla a mano, en segundos que sumen horas, y pagar esas horas. En el canary con pesos en el balanceador pasa lo mismo: el [[replicaset|ReplicaSet]] viejo del gateway (el grupo de pods de la versión anterior) se apaga 30 s después de llegar al 100 %.

Abortar a medio canary, cuando el estable todavía es la 14, regresa el tráfico de inmediato. Pasado el canary, la 15 ya es el estable y volver a la 14 es otro cambio del template. `rollbackWindow: {revisions: 3}` cubre la actual y las 2 anteriores: volver a una de las 2 anteriores va directo al 100 %.
:::

### Cuánto cuesta la escalera

La sombra, el canary y el bake comparten un costo: una T4 de más mientras duran. En la sombra es la T4 del Triton de la 15, que todavía no atiende. En el canary, la misma. En el bake, la que se queda con la 14: la 15 pasa a sus 2 T4 de siempre, una por zona, y `triton-v14` se queda con un solo pod. Mientras un Triton tiene un solo pod (la 15 en la sombra y el canary, la 14 en el bake), su [[pdb|PDB]] va en `minAvailable: 0`: con 1 de 1, ningún *drain* (vaciar un nodo para darle mantenimiento) podría sacarlo. Al terminar el bake, un PR quita la 14. Una T4 sola carga el pico de 350 requests por segundo, porque contesta ≈ 1,200 fotos por segundo; lo que pierde la 14 en el bake es la segunda zona, no la capacidad.

:::profundo Quién cambia los pods al llegar al 100 %
Cuando el Rollout llega al 100 % sano, el job `promover` mueve `champion`, y la [[github-app|GitHub App]] (la cuenta automática del repositorio de despliegue) abre y junta un PR con dos cambios. Pone a `triton-v15` en su ScaledObject de [[keda|KEDA]] (el autoscaling de Triton) con 2 a 4 pods, uno por zona como mínimo, y deja a `triton-v14` con un solo pod para el bake. El mismo PR pone el PDB de `triton-v14` en 0 y regresa el de `triton-v15` a 1.
:::

:::formula Costo de GPU de la escalera
C = u × (t_{sh} + t_{can} + t_{bk})
- u: el precio por hora de una T4 (una g4dn.xlarge), en US$/h
- t_{sh}: el tiempo de shadow, en horas
- t_{can}: el tiempo de canary, en horas
- t_{bk}: el tiempo de bake, en horas
- C: el costo de la T4 extra en toda la escalera, en US$
:::

:::cuenta La escalera de la versión 15
Precio de una T4, \(u\) // g4dn.xlarge en noviembre de 2026 | — | US$0.526/h
Horas de shadow, \(t_{sh}\) // 1 a 2 días | 24 a 48 | 24–48 h
Horas de canary, \(t_{can}\) // 4 h al 5 % + 4 h al 25 % | 4 + 4 | 8 h
Horas de bake, \(t_{bk}\) // 24 a 48 h | 24 a 48 | 24–48 h
Escalera corta, \(C = u × (t_{sh} + t_{can} + t_{bk})\) // los tres tiempos cortos | 0.526 × (24 + 8 + 24) = 0.526 × 56 | ≈ US$29
Escalera larga, \(C\) // los tres tiempos largos | 0.526 × (48 + 8 + 48) = 0.526 × 104 | ≈ US$55
\(C\) contra el presupuesto del mes // el presupuesto de infraestructura de Alba: ≈ US$3,000 al mes | 29 ÷ 3,000 a 55 ÷ 3,000 | ≈ 1.0–1.8 %
= Una release completa cuesta entre US$29 y US$55 de GPU: menos del 2 % de un mes. El seguro sale barato; lo caro es el tiempo, de 2.3 a 4.3 días desde que empieza la sombra hasta que se apaga la anterior.
:::

:::figura e10-rollout-linea
La release 15 en el tiempo: cuántas T4 están prendidas en cada fase y cuánto tarda volver si algo sale mal en ella.
:::

## Volver: el rollback según la fase y el runbook {Going back: rollback by phase and the runbook}

### Cuánto tarda volver depende de cuándo

«Pruebas y CI/CD» dejó la regla: **primero revertir, después investigar**. Esta estación agrega el cómo, que cambia con la fase:

| Fase | Qué pasa al revertir | Cuánto tarda |
|---|---|---|
| Shadow | se apaga la copia; el usuario nunca vio nada | nada que revertir |
| Canary (5 % o 25 %) | Argo Rollouts aborta y devuelve el 100 % del peso al estable | segundos |
| Bake (24–48 h) | un `git revert` del cambio del template, en un PR que aprueba una persona; Argo CD lo aplica y, con `rollbackWindow`, el Rollout se salta los pasos y manda el tráfico a la release 14, que sigue prendida | minutos: lo que tarde la aprobación del PR, hasta 3 min de Argo CD y segundos de switch |
| Pasado el bake | el mismo `git revert`, más el del PR que quitó `triton-v14`, que hay que levantar otra vez: nodo con GPU, imagen de ≈ 9.2 GB, engine | ≈ 5–20 min |

:::profundo Lo que pasa en Git después de revertir
En el canary, el controlador aborta solo, sin Git. Pero Git sigue pidiendo la versión 15, así que el Rollout queda abortado y Argo CD lo marca como degradado hasta que alguien revierte el commit en `alba/despliegue` («CI/CD y registro de imágenes», «El rollback, con este diseño»). Ese revert es un PR que aprueba una persona: no hay prisa, porque el tráfico ya volvió.

No se usa `kubectl argo rollouts undo`, el comando que regresa un Rollout a su revisión anterior (el `kubectl rollout undo` de «Kubernetes» es para Deployments). Con [[gitops|GitOps]] (Git manda sobre el clúster), un cambio a mano en el clúster no queda en Git: si Argo CD tiene prendida la corrección automática (*self-heal*), lo regresa a lo que dice Git en cuanto lo compara; si no, lo marca fuera de sincronía y el siguiente *sync* (cuando Argo CD vuelve a copiar Git al clúster) lo borra. El rollback de verdad es el revert.
:::

### Cuánto daño hace un modelo malo según la fase

Un modelo malo que contesta 200 OK (el código de «todo salió bien») no se ve en los errores. Se ve en la baja confianza o en el PSI, con su ventana de 30 minutos a 1 hora. Lo que cambia entre fases es a cuántos les toca mientras tanto.

:::formula Requests servidas por una versión mala
N_m = Q × frac{w}{100} × 60 × (t_{det} + t_r)
- Q: el tráfico total, en requests por segundo
- w: el peso de la versión mala, en %
- t_{det}: el tiempo hasta detectar, en minutos
- t_r: el tiempo hasta revertir, en minutos
- N_m: las requests que contestó la versión mala, en requests
:::

En el pico, con \(Q\) = 350 y \(t_{det}\) = 30 minutos (la ventana de la baja confianza):

- **En el canary al 5 %**, \(t_r\) ≈ 0.1 min (segundos): \(N_m\) = 350 × 5 ÷ 100 × 60 × (30 + 0.1) ≈ 31,600 requests.
- **En el bake, al 100 %**, con la meta de \(t_r\) ≤ 5 min: \(N_m\) = 350 × 100 ÷ 100 × 60 × (30 + 5) = 735,000.
- **Pasado el bake**, \(t_r\) ≈ 20 min: \(N_m\) = 350 × 100 ÷ 100 × 60 × (30 + 20) = 1,050,000.

El canary al 5 % expone a 23 veces menos fotos que el mismo error en el bake (735,000 ÷ 31,600 ≈ 23). Y no son errores 5xx: son sugerencias peores que Ana puede corregir a mano. El daño es real pero acotado, y por eso existe el peldaño chico.

### El kill switch

Hay un rollback todavía más rápido: no volver a la versión anterior, sino **apagar la función**. Un [[kill-switch|kill switch]] es un [[feature-flag|feature flag]] (un interruptor en la configuración, de «Configuración: YAML, variables de entorno y secretos») que apaga una función completa mientras el programa corre, sin desplegar nada. En Alba, apagar las sugerencias hace que Ana vea el selector de categorías normal, como si el modelo no existiera.

Es la palanca para cuando el problema no es la versión: si **las dos** sugieren tonterías porque cambió algo de afuera (como el preproceso de las fotos en la app), volver a la 14 no arregla nada. Apagar sí.

### El runbook

Un [[runbook-rollback|runbook de rollback]] es la receta escrita, paso a paso, de qué hace la persona de guardia (la que atiende las alertas en su turno) cuando algo sale mal en un despliegue. Se escribe en calma para usarse con prisa, a las 3 de la mañana, por alguien que no hizo el cambio. En Alba, la de guardia es Marta, y el runbook dice:

:::pasos
1. Detectar
Lo hace la máquina: el análisis del canary o una alerta. Marta recibe el aviso con la versión, la señal que falló y el enlace a la gráfica.
2. Revertir sin diagnosticar
Meta: ≤ 5 minutos. Si fue en el canary, ya se revirtió solo. Si fue en el bake, revierte el commit en `alba/despliegue`, pide la aprobación del PR y regresa el alias `champion` a la versión 14, porque el job `promover` ya lo había movido. No se busca la causa antes.
3. Confirmar
En 15 a 30 minutos, las métricas de la 14 tienen que volver a su nivel. Si no vuelven, el problema no era la versión, y toca el kill switch o buscar otra causa.
4. Congelar
Nadie despliega otra versión del modelo hasta entender qué pasó.
5. Comunicar
Un mensaje corto a los equipos que usan las sugerencias: qué se vio, qué se hizo, qué sigue.
6. Investigar
Con calma, con el log de cada request (que dice su `model_version`) y un análisis escrito de qué falló y qué se cambia.
:::

Un runbook que nunca se ensayó no es un plan. Alba lo practica en staging, una copia del sistema sin usuarios reales (el namespace `classifier-staging`): un canary con un modelo roto a propósito, para ver que el análisis lo atrapa y que el aborto funciona.

## Dos versiones vivas a la vez {Two versions alive at once} [extra]

### Lo que se rompe cuando conviven

Durante el canary y el bake, la 14 y la 15 contestan a la vez, y eso rompe lo que suponga una sola:

- **Los logs y las métricas.** Si una línea de log no dice qué versión contestó, el análisis no puede comparar. En Alba, cada línea lleva `model_version`, y la métrica de requests (`classifier_requests_total`) la lleva como etiqueta.
- **El caché.** Su llave lleva la huella de la foto **más** la versión del modelo; sin la versión, el canary serviría respuestas del estable y viceversa.
- **Los labels.** El `labels.json` viaja con su modelo, nunca con la imagen del gateway: con los de otra versión, el gateway contestaría con buena confianza en las categorías equivocadas.

### Los tres contratos


| Contrato | Qué es | Cómo se cuida |
|---|---|---|
| La API pública | `POST /v1/classify` (la ruta que recibe la foto) y su respuesta | La respuesta trae el **nombre** de la categoría, nunca su posición en la salida del modelo |
| La entrada del modelo | un tensor de 3 × 224 × 224 en FP32 (números de 32 bits), con su preproceso | Versión del preproceso registrada con el modelo |
| La salida del modelo | 500 [[logit\|logits]] (un puntaje por categoría), en el orden de `labels.json` | La huella de `labels.json` en el registro, verificada al arrancar |

La primera regla es la que más protege: si la respuesta trajera «categoría 213», un cambio de orden en el modelo cambiaría lo que ven todos los clientes sin que nada fallara.

### Expand and contract: de 500 a 501

Cuando el negocio agrega una categoría, por ejemplo «bolsas», el modelo pasa de 500 a 501 salidas. Si todo cambiara de golpe, durante el canary convivirían clientes que conocen 500 nombres y un modelo que contesta con 501. La técnica para cambiar un contrato sin romper a nadie es [[expand-contract|expand and contract]] (expandir y contraer), en tres pasos:

:::pasos
1. Expandir los consumidores
Primero, quien usa la respuesta aprende el nombre nuevo: el backend de publicación y la app aceptan «Bolsas» aunque todavía nadie lo mande.
2. Cambiar el productor
Después, la release con el modelo de 501 sale por su escalera (con A/B, porque cambian las categorías). Los dos modelos conviven sin problema: los clientes ya entienden los dos.
3. Contraer
Al final, cuando la versión vieja ya no existe, se borra lo que solo servía para ella.
:::

El orden es lo importante: **nadie produce algo que su consumidor todavía no entiende**.

## Errores comunes {Common mistakes}

:::ojo
**Usar el rolling update como despliegue de un modelo.** La readiness dice que el proceso contesta, no que contesta bien. Evítalo: un cambio de modelo va por canary, con análisis de lo que contesta (baja confianza, PSI).
:::

:::ojo
**Un umbral absoluto para todo.** «Baja confianza > 8 %» dispara con la primera campaña de bicicletas. Evítalo: compara canary contra estable en la misma ventana, y deja los topes absolutos solo como red.
:::

:::ojo
**Un criterio sin n mínimo.** De madrugada, 2 errores en 600 requests revierten una versión buena, y con 500 categorías el PSI pasa 0.1 por azar. Evítalo: cada criterio dice cuántas requests necesita, y la ventana se alarga hasta juntarlas.
:::

:::ojo
**Un shadow que escribe en el mundo.** Una copia que guarda en la base de datos, manda un correo o comparte el caché sirve su respuesta a alguien. Evítalo: la copia solo calcula y escribe en su log, con `shadow=true`.
:::

:::ojo
**Repartir el canary por pods.** Con 2 pods estables y 1 nuevo, el «canary» recibe ≈ 33 %. Evítalo: el porcentaje lo pone el ALB con pesos, que Argo Rollouts mueve.
:::

:::ojo
**Confiar en una versión anterior que ya se apagó.** Argo Rollouts apaga la versión vieja 30 s después del switch si no lo cambias. Evítalo: decide cuánto dura el bake, ponlo en el manifiesto y págalo.
:::

:::ojo
**Diagnosticar antes de revertir.** Cada minuto buscando la causa es un minuto de fotos con la versión mala. Evítalo: el runbook revierte primero, en ≤ 5 minutos, y entiende después.
:::

## En la vida real {In real life} [extra]

### En Alba

Una vez al mes, el día 1, el pipeline entrena el modelo nuevo, y en los días siguientes sube la escalera: hasta dos días de sombra, 8 horas de canary y hasta dos días de bake. Nadie del equipo de 5 personas mira un tablero para promoverlo: la máquina avanza y revierte. Las personas aprueban el job `produccion` y revisan a mano los 300 a 500 desacuerdos del shadow. Los cambios del gateway, varias veces por semana, solo hacen el canary corto, de 1 hora por paso.

En el Hot Sale, la campaña donde el tráfico de Alba se multiplica, el equipo congela los despliegues: ningún canary corre esa semana. Antes suben los mínimos de pods, como cuenta «Kubernetes».

### Otros casos

- **Video en tiempo real.** Un detector nuevo para cámaras de seguridad corre en sombra en 10 cámaras de 2 sitios (supuesto del ejemplo): procesa el mismo video y guarda sus alertas sin mandarlas a nadie. La sombra dura semanas, porque los eventos raros (un intruso) llegan pocas veces. Y el rollback es local: cada sitio guarda las dos versiones, y volver es cambiar a cuál apunta un enlace.
- **Inspección en una fábrica.** Una cámara con GPU revisa piezas en la línea. El modelo nuevo corre en sombra un turno completo, después de que el actual decidió: ≈ 57,600 piezas con ≈ 99.8 % de acuerdo dan ≈ 115 desacuerdos para revisar (supuesto del ejemplo). Cada aparato guarda dos engines: volver tarda minutos, sin la nube.
- **Predicciones en lote.** Un modelo que calcula cada noche una tabla de predicciones no tiene canary: escribe la tabla nueva al lado (`predicciones_v2`), se compara contra la vieja, y el cambio es mover el puntero que leen los demás. Es un blue/green sobre datos.
- **Búsqueda y recomendación.** La pregunta casi siempre es «¿mejora?», y manda el A/B, que dura semanas. El canary solo confirma que el sistema nuevo no truena.
- **Servicios gestionados.** SageMaker, el servicio de modelos de AWS, ofrece «guardrails» de despliegue: un blue/green que mueve el tráfico de golpe, en dos pasos (*canary*) o en varios iguales (*linear*), con un tiempo de espera (*baking period*) y rollback automático por alarmas de CloudWatch, su sistema de métricas. KServe, sobre Kubernetes, pone un porcentaje de canary en su manifiesto. Otros nombres, la misma escalera.

### Fuera de ML

Un restaurante que cambia su receta de mole no la sirve a todos el lunes. Primero la prueba la cocina (el gate), luego una mesa de confianza la come junto al mole de siempre (la sombra), luego la ofrece en una de cada veinte mesas (el canary), y una semana guarda la receta vieja en el refrigerador (el bake). Si alguien se queja, el mesero no investiga: saca el mole de siempre.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(R_d\), \(m\), \(N_p\), \(a\), \(N_d\) (shadow); \(n_{min}\), \(Q\), \(w\), \(t_n\) (n mínimo); \(v\), \(n\), \(p_0\), \(λ\), \(k\), \(i\), \(f\), \(t_p\), \(J\), \(F\) (falsa alarma); \(K\), \(n_e\), \(ψ_0\) (PSI); \(u\), \(t_{sh}\), \(t_{can}\), \(t_{bk}\), \(C\) (costo); \(N_m\), \(t_{det}\), \(t_r\) (daño).

:::ejercicios
? [facil] El shadow de la versión 15 copia el 5 % en vez del 10 % durante 2 días, con un acuerdo \(a\) de 0.94. ¿Cuántos pares y desacuerdos junta en total? ¿Alcanza para revisar 400 a mano?
- \(N_p = R_d × m\) = 10,000,000 × 0.05 = 500,000 pares al día; en 2 días, **1,000,000**.
- \(N_d = N_p × (1 − a)\) = 1,000,000 × 0.06 = **60,000** desacuerdos.
- Sobra: 400 es menos del 1 % de 60,000. Lo que se pierde son casos de las categorías chicas.
? [facil] Di qué peldaños sube cada cambio en Alba: (a) el reentrenamiento de diciembre; (b) un arreglo en el código que decodifica las fotos en el gateway; (c) un modelo con otra arquitectura y 501 categorías.
- (a) Gate, shadow de 1–2 días, canary de 5 % → 25 % → 100 % con pasos de 4 h y bake de 24–48 h. Sin A/B.
- (b) CI y canary con pasos de 1 h, sin shadow. Ojo: decodificar distinto **sí** puede cambiar lo que contesta el modelo; la baja confianza y el PSI del canary lo tienen que ver.
- (c) Todos: gate, shadow, canary hasta 25 % y A/B de 1 a 2 semanas por vendedor, con expand and contract para la categoría nueva.
? [facil] Con \(n_{min}\) = 10,000, ¿cuánto tarda en juntarse el n mínimo al 25 % en tráfico promedio (\(Q\) = 116)? ¿Y al 1 % en el pico?
- \(t_n = n_{min} ÷ (Q × w ÷ 100 × 60)\).
- Al 25 % en promedio: 116 × 25 ÷ 100 = 29 por segundo; 10,000 ÷ (29 × 60) ≈ **5.7 min**.
- Al 1 % en el pico: 350 × 1 ÷ 100 = 3.5 por segundo; 10,000 ÷ (3.5 × 60) ≈ **48 min**. Arriesga menos, pero tarda más en saber.
? [medio] Un cambio del gateway hace su paso al 5 % por 1 h a las 3 de la mañana, con \(Q\) ≈ 20 y la regla de 5xx «≥ 2 × el estable» cada 10 minutos y sin n mínimo. Con \(p_0\) = 0.001, calcula \(n\), \(λ\), \(k\), \(f\) y \(F\).
- \(n = Q × w ÷ 100 × 60 × v\) = 20 × 5 ÷ 100 × 60 × 10 = **600** requests en 10 min.
- \(λ = n × p_0\) = 600 × 0.001 = **0.6**; \(k = ⌈2 × 0.6⌉\) = ⌈1.2⌉ = **2**: bastan 2 errores.
- \(f = P(X ≥ 2)\) = \(1 − e^{−0.6} × (1 + 0.6)\) ≈ 1 − 0.549 × 1.6 ≈ 0.122.
- \(J = 60 × t_p ÷ v\) = 60 × 1 ÷ 10 = 6; \(F = 1 − (1 − 0.122)^6\) ≈ 1 − 0.458 ≈ **54 %**: más de la mitad de los cambios buenos se revertiría.
? [medio] El análisis del canary de la versión 15 mide, en 30 minutos de pico: estable con 6.0 % de baja confianza y canary con 8.4 %. A la misma hora, una campaña de bicicletas subió la baja confianza de las dos. ¿Qué decide la regla relativa? ¿Y un umbral fijo de «> 8 %»?
- Razón = baja confianza del canary ÷ la del estable = 8.4 ÷ 6.0 = **1.4**, menos que 1.5: la regla relativa **sigue**.
- El umbral fijo de 8 % revertiría: lo empujó la campaña, no el modelo.
- Un 1.4 está cerca del límite: vale la pena que una persona mire las categorías de esa media hora, sin detener nada.
? [medio] La versión 15 sugiere mal en el bake, al 100 %, y la baja confianza tarda \(t_{det}\) = 30 min en verlo. Compara \(N_m\) en el pico si el runbook revierte en \(t_r\) = 5 min (con la 14 viva) contra 20 min (pasado el bake). ¿Cuánto ahorra el bake?
- \(N_m = Q × w/100 × 60 × (t_{det} + t_r)\).
- Con bake: 350 × 1 × 60 × (30 + 5) = **735,000**.
- Sin bake: 350 × 60 × (30 + 20) = **1,050,000**.
- El bake ahorra 315,000 fotos con sugerencias malas en un incidente, por ≈ US$13–25 de una T4. Aun así, lo que más pesa son los 30 minutos de detección.
? [reto] Alguien propone quitar el n mínimo y bajar la ventana de 5xx a 1 minuto «para detectar más rápido». En el pico al 5 %, con \(p_0\) = 0.001, calcula \(n\), \(λ\) y \(k\) por minuto. ¿Por qué esto es peor, aunque en el pico \(f\) sea parecido al de la madrugada con 10 minutos?
- \(n = Q × w ÷ 100 × 60 × v\) = 350 × 5 ÷ 100 × 60 × 1 = **1,050** en un minuto; \(λ = n × p_0\) = 1.05; \(k = ⌈2 × λ⌉\) = ⌈2.1⌉ = **3** errores.
- \(f = P(X ≥ 3)\) con \(λ\) = 1.05: \(1 − e^{−1.05} × (1 + 1.05 + 0.551)\) ≈ 1 − 0.350 × 2.601 ≈ **0.09**.
- Lo grave es \(J\): en un paso de 4 horas, \(J = 60 × t_p ÷ v\) = 60 × 4 ÷ 1 = 240 decisiones. \(F = 1 − (1 − f)^J\) = 1 − 0.91^240 ≈ **100 %**: el canary nunca termina un paso.
- Para saltos grandes ya está el tope absoluto (0.5 %), que con \(n\) ≈ 1,050 los ve en un minuto. La regla relativa existe para saltos chicos, y esos necesitan \(n\).
? [reto] Diseña el canary de un cambio de código del gateway que se despliega a cualquier hora. Pasos de 1 h al 5 % y 25 %, y quieres \(F\) ≤ 5 % para la regla de 5xx en cada paso. ¿Qué n mínimo pides? ¿Y de madrugada?
- \(F = 1 − (1 − f)^J\), con \(J\) = las decisiones que caben en el paso de 1 h = 60 ÷ \(t_n\).
- Con \(n_{min}\) = 10,000: \(f\) ≈ 0.35 %. En el pico al 5 %, \(t_n\) ≈ 9.5 min, así que caben ≈ 6 decisiones por hora: \(F\) ≈ 1 − 0.9965^6 ≈ 2.1 %, debajo de 5 %.
- Al 25 % en el pico, \(t_n\) ≈ 1.9 min y caben ≈ 31 decisiones: \(F\) ≈ 1 − 0.9965^31 ≈ 10 %. Para bajarlo, sube \(n_{min}\) al 25 % (con 50,000, \(λ\) = 50, \(k\) = 100 y \(f\) es casi 0) o decide una sola vez al final del paso.
- De madrugada al 5 % (\(Q\) ≈ 20), una decisión pide 2.8 h: el paso de 1 h termina sin decidir. O el paso no avanza hasta juntar el n mínimo («inconcluso no es verde»), o no se despliega de madrugada. Alba hace las dos.
:::

:::profundo Cuatro ejercicios más, para la segunda pasada
:::ejercicios
? [facil] ¿Cuánto cuesta la T4 extra de una release con shadow de 2 días, canary de 8 h y bake de 24 h, con \(u\) = US$0.526/h?
- \(C = u × (t_{sh} + t_{can} + t_{bk})\) = 0.526 × (48 + 8 + 24) = 0.526 × 80 ≈ **US$42**.
- Contra US$3,000 al mes: ≈ 1.4 %.
? [medio] Con las 500 categorías, ¿cuántas predicciones del canary harían falta en una hora para que el piso de ruido \(ψ_0\) quede en 0.05, la mitad del umbral? Toma \(n_e = 19 × n\). ¿Cuántas con 30 categorías?
- \(ψ_0 ≈ (K − 1) × (1/n + 1/n_e) = (K − 1) × (1/n) × (1 + 1/19)\).
- Despeja: \(n = (K − 1) × (1 + 1/19) ÷ ψ_0\).
- Con \(K\) = 500: 499 × 1.0526 ÷ 0.05 ≈ **10,500** predicciones en la hora: 2.9 por segundo al canary, \(Q\) ≈ 58 al 5 %. De madrugada no llega.
- Con \(K\) = 30: 29 × 1.0526 ÷ 0.05 ≈ **610**. Agrupar en padres baja el n necesario ≈ 17 veces.
? [medio] El gateway de la 15 arranca con el `labels.json` de la 14 por un error en el repositorio de despliegue. ¿Qué lo detiene primero: el arranque del gateway, el shadow o el canary? ¿Y si el error fuera solo el orden de dos categorías, con el mismo número de nombres?
- Primero el arranque del gateway: verifica la huella de `labels.json` contra la esperada para `resnet50-2026-11-01`. No coincide, el proceso termina, el pod nunca llega a estar listo ni entra al Service `gateway-canary`, y el Rollout no avanza.
- Si se desordenaran dos categorías **y** la huella esperada tuviera el mismo error, el arranque pasaría. Lo atrapa el PSI del canary: las fotos de esas dos categorías cambian de lugar y la mezcla de padres se mueve. Si las dos son del mismo padre, el PSI no lo ve; queda el shadow, donde el acuerdo en esas dos categorías se desploma.
? [reto] El canary al 25 % se aborta por la baja confianza, a las 15:00. Escribe, en orden, lo que pasa en el clúster, en Git y en el registro, y quién hace cada cosa.
- **Clúster**: el análisis mide 1.6 × el estable (el límite es 1.5 ×) y Argo Rollouts aborta: el peso del ALB vuelve a 100 % en `gateway-stable` en segundos. Los pods canary del gateway bajan; `triton-v15` sigue prendido.
- **Guardia**: Marta recibe el aviso. Ya se revirtió solo: confirma en 15–30 minutos que la baja confianza de la 14 sigue en su nivel.
- **Git**: Argo CD ve el Rollout degradado, porque el repositorio todavía pide la 15. Marta abre el revert del commit en `alba/despliegue`, otra persona lo aprueba y Argo CD lo aplica. Otro PR quita `triton-v15`.
- **Registro**: nada. `champion` sigue en la 14, y la 15 queda como `challenger` hasta entender qué pasó.
:::
:::

## Lo que sigue {What comes next}

- «La request en vivo» sigue una request por todo el camino, con su línea de log y sus métricas: las mismas `model_version` y `classifier_requests_total` que consulta el análisis del canary.
- «Monitoreo, drift y reentrenamiento» vigila al `champion` cuando ya no hay canary que lo compare: la baja confianza contra su promedio de 7 días, el PSI contra las 4 semanas previas, las alertas de la guardia y el disparador que manda a entrenar el modelo siguiente, que volverá a subir esta escalera.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
rollout-seguro shadow traffic-mirroring release-par canary argo-rollouts criterio-promocion rollback-automatico analisis-canary n-minimo-canary bake blue-green kill-switch runbook-rollback expand-contract
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué pregunta responde el shadow, y cuál no puede responder?
«¿Funciona con tráfico real?»: errores, latencia y cuánto cambió lo que contesta. No responde «¿ayuda?», porque nadie vio sus sugerencias.
? ¿Por qué un rolling update no es un despliegue seguro de un modelo?
Porque la readiness mide salud, no calidad, y porque no controla el porcentaje ni compara contra el estable.
? ¿Por qué el canary se compara contra el estable en la misma ventana y no contra un umbral fijo?
Porque las dos ven la misma mezcla de fotos al mismo tiempo: el ruido del día (una campaña, la madrugada) se cancela y queda la diferencia del modelo.
? ¿Para qué sirve el n mínimo de un criterio?
Para que el azar no dispare una regla con pocas requests. Sin él, de madrugada, 2 errores en 600 requests revierten una versión buena.
? ¿Qué convierte el rollback en un cambio de ruteo?
El bake: la release anterior sigue prendida 24 a 48 horas, con su Triton caliente. Volver es mandar el tráfico ahí: unos minutos (el PR del revert y Argo CD), en vez de ≈ 5–20 min levantando Triton.
? ¿Quién mueve `champion` en Alba, y cuándo?
El job `promover` del pipeline, cuando el Rollout llega al 100 % sano. Si el canary se aborta, nunca se mueve.
? ¿Por qué la respuesta de la API trae el nombre de la categoría y no su posición?
Porque la posición depende del orden de `labels.json` de cada modelo. Con el nombre, un cambio de orden entre versiones no cambia lo que ven los clientes.
:::
