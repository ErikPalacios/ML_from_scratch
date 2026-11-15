---
titulo: Kubernetes
en: Kubernetes
subtitulo: El noveno paso del sistema de Alba de principio a fin: convertir las dos imágenes en pods que corren en el clúster, con lo que pide cada uno, sus chequeos, su GPU, su zona, su cambio de versión y cómo crecen solos.
pregunta: Argo CD ya tiene el digest de las dos imágenes de Alba. ¿Qué tiene que decirle el equipo a Kubernetes para que siempre haya dos Tritons con su T4, uno por zona, y de 3 a 12 gateways que crezcan solos, y qué se rompe cuando lo dice mal?
requisitos: maquinas, sistema-operativo, programa-proceso, balanceo, regiones, gestionados, config, e06-serving, e07-empaquetado, e08-cicd
---


:::idea
Kubernetes no corre lo que le ordenas: corre lo que le **describes**. El equipo de Alba escribe en un manifiesto cómo debe verse cada [[pod]], la unidad en que Kubernetes corre un programa (qué pide, cuándo está listo, en qué máquina cabe, cómo cambia de versión y cuándo crece), y unos programas del clúster comparan, sin parar, ese estado deseado con el real y corrigen la diferencia. Esta estación escribe esa descripción para el gateway y para Triton, y explica cada número.
:::

Alba es la empresa del curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día y sugiere la categoría de cada foto entre 500. Eso son ≈ 10 millones de [[request|requests]] (pedidos al servidor) al día, una foto por request: ≈ 116 por segundo en promedio, ≈ 350 en el pico de un día normal y 500 en el pico de diseño, el número para el que se compran las máquinas. La sugerencia la da una ResNet-50 (una red neuronal para fotos) convertida en un [[engine-tensorrt|engine de TensorRT]] y servida por [[triton|Triton]], el servidor de modelos de NVIDIA. Corre en 2 GPUs T4, cada una en una máquina `g4dn.xlarge` rentada en AWS (Amazon Web Services, la [[nube]] de Amazon) a US$0.526 la hora, una en cada [[zona-disponibilidad|zona]] de la [[region|región]] us-east-1 (1a y 1b). Delante de Triton está el **gateway**, un programa en Python que recibe la foto, la valida, la prepara y le pide la respuesta a Triton; corre en 3 a 12 copias en máquinas sin GPU.

La estación 7, «Empaquetado con Docker», metió cada programa en una [[imagen-contenedor|imagen]]: `classifier-gateway:3f9c2ab` (≈ 87 MB) y `classifier-triton:resnet50-2026-10-01` (≈ 9.2 GB, con el engine adentro). La 8, «CI/CD y registro de imágenes», escribió su [[digest-imagen|digest]] (la huella exacta de su contenido) en el [[repositorio]] de despliegue, `alba/despliegue`, de donde [[argo-cd|Argo CD]], un programa dentro del clúster, lo aplica en ≤ 3 minutos. Falta que esas imágenes corran, en las máquinas correctas y en la cantidad correcta: eso es Kubernetes.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

### Lo que entra

- **Dos imágenes por digest**, en Amazon ECR (el registro de imágenes de AWS): la del gateway y la de Triton. El clúster las baja por su huella, `…@sha256:…`, no por su nombre corto.
- **Los manifiestos** en `alba/despliegue`: los archivos que describen cada pieza en el clúster; esta lección los lee campo por campo.
- **Un clúster**: EKS (*Elastic Kubernetes Service*), el Kubernetes que opera AWS ([[kubernetes-gestionado]]), con Kubernetes 1.35 en noviembre de 2026. AWS cobra ≈ US$73 al mes por la parte que lo dirige, el [[plano-de-control|plano de control]] (US$0.10 la hora × 730 horas); las máquinas se pagan aparte.

:::profundo Cuándo sube el precio del clúster
Los US$73 al mes valen mientras la versión está en el soporte normal de AWS, que para la 1.35 dura hasta marzo de 2027. Después pasa a soporte extendido, a US$0.60 la hora (≈ US$438 al mes).
:::

### Lo que sale

En el *namespace* `classifier` (el apartado de producción dentro del clúster):

- **2 pods de Triton**, cada uno con una T4 entera, uno por zona. Los maneja el [[deployment-k8s|Deployment]] `triton-v14`, que sirve la versión 14 del modelo, `resnet50-2026-10-01`. Pueden subir a 4 si crece la fila de fotos que esperan la GPU.
- **De 3 a 12 pods del gateway**, en 2 máquinas `c6i.xlarge` (4 vCPU cada una) en operación normal y hasta 4 en el máximo. En promedio corren 3, 4 en la hora pico y 5 en el pico de diseño.
- **Pods que reciben tráfico solo cuando están listos**: detrás del [[alb|ALB]] (*Application Load Balancer*) interno, el balanceador de AWS que reparte las requests entre los gateways.

### Lo que se decide

:::pasos
1. Qué pide cada pod
Cuánta CPU, memoria y GPU se le reserva, y cuál es su techo.
2. Cuándo está listo y cuándo está muerto
Tres preguntas periódicas: ¿ya arrancó?, ¿le mando tráfico?, ¿lo reinicio?
3. Dónde cae
Triton en una T4, una por zona; el gateway, nunca en una T4.
4. Cómo cambia de versión
Sin bajar nunca de 2 Tritons listos.
5. Cómo crece
El gateway por CPU, Triton por la espera en su fila, y las máquinas cuando los pods ya no caben.
6. Qué lo protege del mantenimiento
Un mínimo de pods que nadie saca a propósito.
:::

Lo que esta estación **no** hace: mandar el 5 % del tráfico a una versión nueva del modelo, compararla y decidir si se queda: eso lo cuenta la estación siguiente, «Rollout seguro».

:::diagrama e09-kubernetes-estacion
La estación 9: del repositorio de despliegue a los pods listos detrás del ALB. Toca cada caja; hay un recorrido para un despliegue normal y otro para un pod que no cabe.
:::

## Del manifiesto al pod: el lazo de Kubernetes {From manifest to pod: the Kubernetes loop}

### Describir, no ordenar

Kubernetes es un sistema de [[orquestacion|orquestación]]: reparte programas entre las máquinas de un clúster (cada máquina es un [[nodo]]) y los vuelve a levantar si se caen.

No le dices «arranca un Triton en la máquina 2». Le das un [[manifiesto-k8s|manifiesto]]: un archivo de texto en [[yaml|YAML]] que describe el estado que quieres, por ejemplo «quiero pods de Triton con esta imagen, una GPU cada uno, uno por zona». El manifiesto llega al **API server**, el programa central del clúster que guarda el estado deseado de todo. Luego unos programas llamados **controladores** miran, sin parar, ese estado deseado y el real, y corrigen la diferencia: si faltan pods, los crean; si sobran, los borran; si uno muere, lo reemplazan.

:::analogia El pizarrón de una cocina
En una cocina grande, el pizarrón dice «mesa 4: dos sopas, un pescado». Nadie le dice a cada cocinero qué hacer en cada segundo: cada uno mira el pizarrón, mira lo que ya salió y prepara lo que falta. Si un plato se cae al piso, alguien lo vuelve a hacer, porque el pizarrón todavía dice dos sopas.

Dónde se rompe: en la cocina, si alguien hace una sopa de más, se la come el personal. En Kubernetes, un pod de más que nadie pidió se **borra**: el controlador corrige en las dos direcciones. Por eso, si cambias algo a mano en el clúster y el manifiesto dice otra cosa, gana el manifiesto.
:::

En Alba nadie le da manifiestos al API server con la mano. Lo hace Argo CD: lee la rama `main` de `alba/despliegue` y aplica lo que no coincide. Es [[gitops|GitOps]]: el repositorio es la verdad, y cada cambio al clúster es un [[pull-request|pull request]] (una propuesta de cambio que otra persona revisa) con autor y fecha.

### Pod, ReplicaSet y Deployment

Tres objetos, uno dentro del otro:

- El [[pod]] es lo más chico que Kubernetes agenda en un nodo: uno o más [[contenedor|contenedores]] que comparten la misma IP y los mismos discos, y que viven y mueren juntos. Es **efímero**: si muere, no se revive; se crea otro, con otro nombre y otra IP. En Alba, un pod de Triton es un contenedor de Triton con su T4; un pod del gateway es un proceso de [[uvicorn]] con 1 vCPU.
- Un [[replicaset|ReplicaSet]] cuida que existan **N copias** de una plantilla de pod (el *template*). Si hay menos, crea; si hay más, borra.
- Un [[deployment-k8s|Deployment]] maneja ReplicaSets para **cambiar de versión**. Cuando cambias la plantilla (otra imagen, otros recursos), crea un ReplicaSet nuevo y pasa las copias del viejo al nuevo, poco a poco.

Por eso los pods se llaman como `triton-v14-7d9f8c6b5-x2kqp`: el Deployment, una huella de la plantilla que identifica al ReplicaSet y un sufijo al azar. Cambia la plantilla y cambia la huella del medio.

El gateway de Alba no usa un Deployment, sino un **Rollout** de [[argo-rollouts|Argo Rollouts]]: la misma plantilla de pod, más los pasos para mandar primero una parte chica del tráfico a la versión nueva. Aquí importa su plantilla; los pasos son de «Rollout seguro».

### Quién hace qué

Cuando aparece un pod nuevo, entran dos programas más:

- El **scheduler** (el agendador) le elige nodo. Revisa los nodos uno por uno: ¿le alcanza lo que el pod pide?, ¿el pod acepta las restricciones del nodo?, ¿lo pide en esa zona? Escoge uno y escribe la decisión en el API server. Si ninguno sirve, el pod se queda **Pending** (pendiente), sin nodo.
- El **kubelet** es el agente que corre en cada nodo. Ve que le asignaron un pod, baja la imagen si no la tiene, arranca el contenedor y le hace las preguntas de salud que verás más adelante.

### Namespaces y `kubectl`

Un [[namespace-k8s|namespace]] es un apartado con nombre dentro del clúster: dos objetos pueden llamarse igual si viven en namespaces distintos, y los permisos se dan por namespace. Alba tiene cuatro: `classifier` (producción), `classifier-staging` (staging, la copia de prueba, con su propia T4), `monitoring` (el programa que junta las métricas) y `argo` (Argo CD, Argo Workflows y Argo Rollouts). No es el *namespace* de Linux de «El sistema operativo», que aísla lo que ve un proceso: este es solo un nombre para agrupar.

[[kubectl|`kubectl`]] es el programa de la terminal que le habla al API server: `kubectl get pods` lista los pods, `kubectl describe` cuenta la historia de uno, `kubectl logs` muestra lo que escribió. En Alba se usa para **mirar** y depurar; los cambios entran por Git.

### Los objetos de Alba

En `classifier` viven dos programas, pero más de dos objetos: cada pieza del comportamiento (cuántos, por dónde entra el tráfico, cómo crece, qué se protege) es un objeto aparte.

:::profundo La lista completa
| Objeto | Nombre | Qué hace |
|---|---|---|
| Deployment | `triton-v14` | Los pods de Triton de la versión 14 del modelo |
| [[service-k8s\|Service]] | `triton-v14` | Un nombre y una IP fijos para esos pods: puertos 8000 (HTTP), 8001 (gRPC) y 8002 (métricas) |
| Rollout | `gateway` | Los pods del gateway, con los pasos de la versión nueva |
| Service | `gateway-stable`, `gateway-canary` | La versión vigente y la nueva del gateway |
| [[ingress\|Ingress]] | `gateway` | La regla que arma el ALB interno: solo la ruta `/v1/classify` |
| HPA | `gateway` | Cuántos gateways, según su CPU |
| ScaledObject | `triton-v14` | Cuántos Tritons, según su fila (lo lee KEDA) |
| PodDisruptionBudget | `triton-v14` | Cuántos Tritons nadie puede sacar a la vez |
| [[configmap\|ConfigMap]] | `classifier-labels-14` | El `labels.json` de la versión 14, que monta el gateway |

Cada versión del modelo tiene su par: el Triton `triton-v14` con su Service, y el gateway que apunta a él con `TRITON_URL=triton-v14.classifier.svc.cluster.local:8000`. Cuando en otras lecciones lees «el Service `triton`», es el nombre corto de ese par.
:::

### El manifiesto de Triton

El manifiesto de Triton junta todo lo que sigue en esta lección; va entero, plegado, abajo.

:::profundo El manifiesto de Triton, recortado
Es ilustración: necesita un clúster, no la vas a correr aquí.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: triton-v14
  namespace: classifier
spec:                                  # sin "replicas": las decide KEDA, de 2 a 4
  selector:
    matchLabels: {app.kubernetes.io/name: triton, app.kubernetes.io/version: "14"}
  strategy:
    rollingUpdate: {maxSurge: 1, maxUnavailable: 0}
  progressDeadlineSeconds: 900
  revisionHistoryLimit: 5
  template:
    metadata:
      labels: {app.kubernetes.io/name: triton, app.kubernetes.io/version: "14"}
    spec:
      nodeSelector: {workload: gpu-t4}
      tolerations:
        - {key: nvidia.com/gpu, operator: Equal, value: present, effect: NoSchedule}
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector: {matchLabels: {app.kubernetes.io/name: triton, app.kubernetes.io/version: "14"}}
      terminationGracePeriodSeconds: 60
      containers:
        - name: triton
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/classifier-triton:resnet50-2026-10-01@sha256:…
          resources:
            requests: {cpu: "2", memory: 6Gi, nvidia.com/gpu: 1}
            limits: {memory: 6Gi, nvidia.com/gpu: 1}
          startupProbe: {httpGet: {path: /v2/health/ready, port: 8000}, periodSeconds: 5, failureThreshold: 60}
          readinessProbe: {httpGet: {path: /v2/health/ready, port: 8000}, periodSeconds: 5, timeoutSeconds: 2, failureThreshold: 2}
          livenessProbe: {httpGet: {path: /v2/health/live, port: 8000}, periodSeconds: 10, timeoutSeconds: 2, failureThreshold: 3}
          lifecycle:
            preStop: {exec: {command: ["sleep", "10"]}}
          volumeMounts: [{name: shm, mountPath: /dev/shm}]
      volumes:
        - {name: shm, emptyDir: {medium: Memory, sizeLimit: 1Gi}}
```
:::

Fíjate en lo que el manifiesto **no** dice: `replicas`. Si el manifiesto en Git dijera «2», cada vez que Argo CD lo aplicara regresaría el número a 2, aunque el autoscaler (el programa que ajusta solo cuántas copias hay; lo ves en «Crecer solos») acabara de subirlo a 4 por un pico: los dos pelearían. El número lo decide el autoscaler, y en Git solo se escriben sus topes.

## Lo que pide cada pod: requests, limits y throttling {What each pod asks for: requests, limits and throttling}

### Reserva y techo

Cada contenedor declara dos números por recurso, sus [[resources-requests-limits|requests y limits]]:

- El **request** es una **reserva**. El scheduler solo pone un pod en un nodo si la suma de los requests ya puestos, más el nuevo, cabe en lo que el nodo ofrece. No dice cuánto usa el pod: dice cuánto se le aparta.
- El **limit** es un **techo**. Lo hace cumplir el [[kernel]] del nodo con un [[cgroup]], el mecanismo de Linux que limita lo que gasta un grupo de procesos.

Los dos se miden igual: la CPU en núcleos (`"1"` es un núcleo, una [[vcpu|vCPU]] en AWS; `500m`, 500 milinúcleos, es medio) y la memoria en bytes (`1Gi` es un gibibyte, 1,073,741,824 bytes).

Pasarse del techo no hace lo mismo en los dos recursos, porque uno se puede comprimir y el otro no:

- **CPU de más: espera.** El kernel deja de darle CPU al contenedor hasta el siguiente turno. El programa sigue vivo, pero se frena: eso es el *throttling*.
- **Memoria de más: muere.** La memoria no se puede «prestar después». El kernel mata al proceso: es el [[oom|OOM]], y Kubernetes lo reporta como `OOMKilled` con [[codigo-salida|código de salida]] 137 = 128 + 9, porque lo mató la [[senal|señal]] número 9, SIGKILL.

### El throttling, por dentro

El límite que causa el [[throttling-cpu|throttling de CPU]] no se aplica segundo a segundo, sino en **periodos** de 100 ms. Un límite de 1 núcleo quiere decir «100 ms de CPU por cada periodo de 100 ms», **sumando todos los hilos del proceso**. Hay dos relojes: los ms **de CPU** suman lo que trabajó cada hilo; los ms **de reloj** son el tiempo que de verdad pasa. Si cuatro [[hilo|hilos]] corren a la vez en cuatro núcleos, gastan esos 100 ms de CPU en 25 ms de reloj, y el contenedor se queda congelado los 75 ms que faltan para el siguiente periodo.

:::formula Duración de un trabajo con límite de CPU
W = k × c
Q = L × T
j = ⌈W ÷ Q⌉ − 1
D = j × T + frac{W − j × Q}{k}
- k: cuántos hilos trabajan a la vez (aquí, decodes de fotos), cada uno en su núcleo
- c: la CPU que necesita cada uno, en ms
- W: el trabajo total, en ms de CPU
- L: el limit de CPU del contenedor, en núcleos
- T: el periodo con que el kernel renueva la cuota, en ms (100 ms en Linux, si nadie lo cambia)
- Q: la cuota de CPU por periodo, en ms de CPU
- j: cuántos periodos se agotan antes del último (en esos, el contenedor se congela); [[ceil|⌈ ⌉]] redondea hacia arriba
- D: lo que tarda en terminar, en ms de reloj
:::

Un ejemplo con números de juguete: un pod con límite de 1 núcleo que decodifica 4 fotos grandes a la vez (convierte cada JPEG en sus píxeles), de 40 ms de CPU cada una.

:::cuenta Cuatro decodes con límite de 1 CPU
Trabajo total, \(W\) // \(W = k × c\): 4 decodes de 40 ms | 4 × 40 | 160 ms de CPU
Cuota por periodo, \(Q\) // \(Q = L × T\): límite de 1 núcleo, periodo de 100 ms | 1 × 100 | 100 ms de CPU
Periodos agotados, \(j\) // \(⌈W ÷ Q⌉ − 1\): 160 ÷ 100 = 1.6, hacia arriba es 2 | 2 − 1 | 1
Primer periodo, \(T\) // los 4 hilos gastan la cuota en \(Q ÷ k\) = 100 ÷ 4 = 25 ms y se congelan 75 ms | 25 + 75 | 100 ms de reloj
Último periodo // falta \(W − j × Q\) = 160 − 100 = 60 ms de CPU, entre los \(k\) = 4 hilos | 60 ÷ 4 | 15 ms de reloj
Duración, \(D\) // \(D = j × T + (W − j × Q)/k\) | 1 × 100 + 60 ÷ 4 | **115 ms**
Sin límite, \(D\) // cada decode en su núcleo, en paralelo: \(D = c\) | 40 | 40 ms
= Cada foto tarda 115 ms en vez de 40, casi 3 veces más, sin que la CPU del nodo esté llena: el nodo tenía núcleos libres, pero el contenedor ya había gastado su cuota.
:::

:::figura e09-kubernetes-throttling
Los mismos cuatro decodes, sin límite y con límite de 1 CPU. Con límite, la cuota del periodo se acaba a los 25 ms y el contenedor espera congelado hasta los 100 ms.
:::

El código lo simula milisegundo a milisegundo, sin la fórmula: cada hilo avanza 1 ms si al periodo todavía le queda cuota.

```python
def decodes(k, c, L, T=100):
    """k decodes a la vez, c ms de CPU cada uno, límite L núcleos, periodo T ms."""
    falta = [c] * k                  # CPU que le falta a cada decode, en ms
    Q = L * T                        # cuota de CPU por periodo, en ms
    gastado, ms = 0, 0
    while any(f > 0 for f in falta):
        if ms % T == 0:
            gastado = 0              # empieza un periodo: la cuota se renueva
        for i in range(k):           # cada decode corre en su núcleo, 1 ms
            if falta[i] > 0 and gastado < Q:
                falta[i] -= 1
                gastado += 1
        ms += 1
    return ms

print("sin límite (L = 4):", decodes(4, 40, 4), "ms")
print("límite 1 CPU:      ", decodes(4, 40, 1), "ms")
print("límite 2 CPU:      ", decodes(4, 40, 2), "ms")
print("límite 1, 2 a la vez:", decodes(2, 40, 1), "ms")
```

```salida
sin límite (L = 4): 40 ms
límite 1 CPU:       115 ms
límite 2 CPU:       40 ms
límite 1, 2 a la vez: 40 ms
```

El gateway de Alba deja correr solo 2 decodes a la vez. Con eso, un límite de 1 CPU no frenaría: \(W\) = 80 ms cabe en \(Q\) = 100 ms. Pero bastaría que en una ráfaga trabajaran más hilos que los que cubre la cuota (por ejemplo, si alguien sube ese tope a 4) para que apareciera el freno, justo cuando más importa la latencia.

:::calculadora e09-kubernetes-throttling
Empieza con los cuatro decodes de la cuenta. Sube \(L\) a 2 y el freno desaparece; bájalo a 0.5 y los mismos decodes tardan ≈ 300 ms.
:::

### Lo que pide Alba

| | Gateway | Triton |
|---|---|---|
| Request de CPU | 1 núcleo | 2 núcleos |
| Limit de CPU | **ninguno** | **ninguno** |
| Memoria (request = limit) | 1 GiB | 6 GiB, con 1 GiB de `/dev/shm` adentro |
| GPU | — | `nvidia.com/gpu: 1` |

**Por qué no hay límite de CPU.** La CPU que el pod no usa queda libre para otros, y la que usa de más solo se toma si está libre en el nodo. Un límite solo agrega frenos como el de la cuenta, en los momentos de más carga. El request sí se escribe, porque con él se agenda el pod y se calcula su escala (lo ves en «Crecer solos»).

**Por qué la memoria sí tiene techo, igual al request.** Porque pasarse de memoria es morir, y es mejor que muera **este** pod, con un error claro, que el nodo entero se quede sin memoria y el kernel elija a quién matar. El gateway, en su peor momento, usa 2 decodes × ≈ 320 MB + ≈ 80 MB de Python y sus bibliotecas + 16 [[requests-en-vuelo|requests en vuelo]] × ≈ 10 MB = ≈ 880 MB, el 82 % de 1 GiB (1 GiB son ≈ 1,074 MB). En Triton, el `/dev/shm` (la carpeta en memoria que usa para pasar datos entre sus partes) cuenta dentro de los 6 GiB.

:::profundo La clase de QoS: a quién saca primero el nodo
Con los requests y los limits, Kubernetes pone a cada pod en una **clase de calidad de servicio** (*QoS class*), que decide a quién saca primero si al nodo se le acaba la memoria:

- **Guaranteed**: en cada contenedor, CPU y memoria con request igual al limit. Es el último en salir.
- **Burstable**: tiene algún request o limit, pero no cumple lo de arriba. El gateway y Triton de Alba son Burstable, por no tener límite de CPU.
- **BestEffort**: ni requests ni limits de CPU ni de memoria. Es el primero en salir.

:::ojo
Un pod que solo pide `nvidia.com/gpu: 1` es **BestEffort**, aunque tenga una GPU de US$0.526 la hora: la clase solo mira CPU y memoria, y sale primero. Escribe siempre los requests de CPU y memoria.
:::
:::

## Las probes y el apagado: los plazos de Alba {Probes and shutdown: Alba's deadlines}

### Tres preguntas, tres consecuencias

En «Balanceadores, proxies y gateways» viste los [[health-check|health checks]] y las tres preguntas que Kubernetes le hace a cada pod: ¿ya arrancaste?, ¿te mando tráfico?, ¿sigues vivo? Aquí van con sus plazos.

Una [[probe]] es una de esas preguntas. La hace el kubelet, cada cierto tiempo, casi siempre con un `GET` HTTP a una ruta del contenedor: si responde con un código del 200 al 399 antes del plazo, pasó. Tres campos la configuran: cada cuánto (`periodSeconds`), cuánto espera la respuesta (`timeoutSeconds`) y cuántas fallas seguidas hacen falta para actuar (`failureThreshold`).

:::formula Cuánto tarda una probe en actuar
τ = Δ × F
- Δ: cada cuánto pregunta la probe (`periodSeconds`), en s
- F: cuántas fallas seguidas hacen falta para actuar (`failureThreshold`)
- τ: el tiempo, desde la primera falla, hasta que Kubernetes actúa, en s (aproximado: más o menos un periodo y el plazo de espera de la última respuesta)
:::

Con ella salen los tres plazos de Triton:

:::cuenta Los plazos de las probes de Triton
Startup: tiempo máximo para arrancar, \(τ = Δ × F\) // pregunta a `/v2/health/ready` cada 5 s, hasta 60 veces | 5 × 60 | 300 s = 5 min
Readiness: tiempo para salir del reparto, \(τ\) // misma ruta, cada 5 s, 2 fallas | 5 × 2 | ≈ 10 s
Liveness: tiempo para reiniciar, \(τ\) // `/v2/health/live` cada 10 s, 3 fallas | 10 × 3 | ≈ 30 s
Lo que tarda en estar listo de verdad // cargar el engine y calentarlo, según el equipo de Alba | — | ≈ 10–60 s
Margen de la startup // contra el arranque más lento | 300 − 60 | 240 s
= Triton tiene 5 minutos para arrancar, sale del reparto en ≈ 10 s si deja de estar listo y se reinicia en ≈ 30 s si su proceso deja de contestar.
:::

### La [[startup-probe|startup]]: ¿ya arrancaste?

Mientras la startup no pasa, las otras dos **no corren**: protege a un programa lento al arrancar. Sin ella, la liveness preguntaría desde el principio, y un Triton que tarda 45 s en cargar el engine fallaría tres veces hacia los ≈ 30 s y lo reiniciarían antes de terminar. Cada intento moriría igual; Kubernetes espera cada vez más entre intentos (10 s, 20 s, 40 s… hasta 5 min) y el pod queda en `CrashLoopBackOff`, «reiniciando en bucle».

Triton usa la misma ruta para la startup y para la readiness, `/v2/health/ready`: «arranqué» quiere decir «ya cargué el modelo». La startup se fija **una vez**; la readiness sigue preguntando toda la vida del pod.

### La [[readiness]]: ¿te mando tráfico?

Si la readiness falla, el pod **sale del reparto sin reiniciarse**: el [[service-k8s|Service]] (el nombre fijo que reparte el tráfico entre los pods listos) lo quita de su lista, y el controlador del ALB (el programa que actualiza los destinos del balanceador) lo saca. Cuando vuelve a pasar, regresa solo.

En el gateway, la readiness llama a `/readyz` cada 5 s, espera la respuesta 2 s y actúa con 2 fallas. A su vez, `/readyz` le pregunta a Triton si está listo y le da 0.5 s para contestar. Así, un gateway que no puede llegar a su Triton deja de recibir fotos en ≈ 10 s.

Si fallan **todos** los gateways a la vez, el ALB se queda sin destinos y contesta él mismo un error 503 («servicio no disponible»), que no aparece en las métricas del gateway. Lo viste en «Balanceadores, proxies y gateways».

### La [[liveness]]: ¿sigues vivo?

Si la liveness falla, el kubelet **mata el contenedor y lo vuelve a arrancar** dentro del mismo pod. Por eso solo debe preguntar por el propio proceso, **nunca por una dependencia**. El `/healthz` del gateway responde 200 si su proceso y su [[event-loop|event loop]] viven, sin preguntar a nadie; cada 10 s, con 2 s de espera, 3 fallas y 5 s de gracia al arrancar (`initialDelaySeconds`). Si preguntara a Triton, una caída de Triton reiniciaría todos los gateways a la vez sin arreglar nada, y cada reinicio les quitaría también la readiness.

:::figura e09-kubernetes-probes
Los primeros segundos de un pod de Triton: la startup falla mientras carga el engine, pasa a los ≈ 45 s y entonces empiezan la readiness y la liveness.
:::

:::nota El HEALTHCHECK de la imagen
La imagen del gateway trae su propio [[healthcheck-docker|`HEALTHCHECK`]], de «Empaquetado con Docker». Kubernetes lo **ignora**: solo usa sus probes. Sirve en la laptop y en compose, no en el clúster.
:::

### El apagado ordenado

Un pod se apaga por muchas razones: un cambio de versión, el autoscaler que quita copias, un nodo que se vacía. Si se apaga mal, las requests que estaba atendiendo se cortan. Kubernetes lo hace en este orden:

:::pasos
1. El pod se marca como terminando
Desde ese instante sale de la lista de pods listos del Service, y el controlador del ALB lo empieza a dar de baja. Pero la noticia tarda unos segundos en llegar a cada balanceador.
2. Corre el `preStop`
Un comando que Kubernetes ejecuta antes de avisarle al programa. En Alba es un `sleep`: esperar sin hacer nada mientras los balanceadores dejan de mandar requests nuevas.
3. Llega SIGTERM
La señal de «termina». El programa deja de aceptar conexiones y acaba las requests que tiene.
4. Si se acaba el plazo, SIGKILL
El plazo total es `terminationGracePeriodSeconds`, y empieza a contar con el paso 1, **incluido** el `preStop`. Al vencer, el kernel mata lo que quede.
:::

:::formula El plazo de gracia
t_{gracia} ≥ t_{pre} + t_{dren} + t_{mar}
- t_{gracia}: el plazo total de gracia (`terminationGracePeriodSeconds`), en s
- t_{pre}: lo que dura el `preStop`, en s
- t_{dren}: lo que el programa se da para acabar sus requests después de SIGTERM, en s
- t_{mar}: un margen, en s
:::

:::profundo Los plazos de apagado de Alba, con números
:::cuenta Los plazos de apagado de Alba
Triton: \(t_{pre}\) // `sleep 10` | — | 10 s
Triton: \(t_{dren}\) // `--exit-timeout-secs=30`: Triton espera hasta 30 s a que terminen sus inferencias | — | 30 s
Triton: \(t_{gracia} = t_{pre} + t_{dren} + t_{mar}\) // con 20 s de margen | 10 + 30 + 20 | 60 s
Gateway: \(t_{pre}\) // `sleep 15`: más largo, porque el ALB tarda más en sacarlo que el Service | — | 15 s
Gateway: \(t_{dren}\) // `--timeout-graceful-shutdown 20` de uvicorn | — | 20 s
Gateway: \(t_{gracia}\) // con 10 s de margen | 15 + 20 + 10 | 45 s
= Triton tiene 60 s y el gateway 45 s. Si alguien sube el drenado de uvicorn a 40 s sin subir \(t_{gracia}\), el gateway recibe SIGKILL a la mitad del drenado.
:::

Hay tres «30 s» distintos en este apagado: el plazo de gracia de Kubernetes si nadie lo escribe, el tiempo que el ALB sigue terminando las conexiones de un destino que se da de baja (el *deregistration delay* de Alba) y el drenado de Triton. No los decide la misma pieza.
:::

En Alba, Triton tiene \(t_{gracia}\) = 60 s (10 de `preStop`, 30 de drenado y 20 de margen) y el gateway 45 s (15 + 20 + 10). El `preStop` del gateway es más largo porque el ALB tarda más en sacarlo de sus destinos que el Service en sacar a Triton.


## Dónde cae cada pod: la GPU, las zonas y el PDB {Where each pod lands: the GPU, zones and the PDB}

### Cómo sabe Kubernetes que hay una GPU

Kubernetes, solo, sabe contar CPU, memoria y disco. Que el nodo tiene una GPU se lo avisa el [[device-plugin-gpu|device plugin]] de NVIDIA: un programa que corre en cada nodo con GPU, le pregunta al [[driver]] cuántas tiene y se lo anuncia al kubelet con el nombre `nvidia.com/gpu`. Desde ahí, el nodo ofrece `nvidia.com/gpu: 1` como ofrece 4 vCPU.

El plugin se instala como un **DaemonSet**: un objeto que pone una copia de un pod en cada nodo que cumpla una condición (aquí, tener GPU). Si falta, el nodo «no tiene GPUs» y todo pod que pida una se queda Pending, aunque la T4 esté ahí.

Una GPU se pide entera (1, no 0.5) y no se comparte: dos pods no pueden recibir la misma T4.

:::profundo Los detalles de pedir una GPU
Se pide en `limits`; si escribes también el request, debe ser igual. El plugin se puede configurar para repartir una GPU por turnos entre varios pods, el *time-slicing*, sin aislar su memoria; Alba no lo usa. Y el driver ya viene en el nodo: los nodos con T4 de Alba arrancan de la imagen de máquina (el disco de arranque con el sistema operativo, distinto de la imagen de un contenedor) que AWS prepara para EKS con GPU.
:::

### Atraer: label y `nodeSelector`

El engine de Alba está compilado para la T4 y no carga en otra GPU. Triton tiene que caer en una `g4dn.xlarge`. Para eso:

- Cada nodo con T4 lleva una **label** (etiqueta): un par llave-valor pegado al nodo, `workload: gpu-t4`.
- El pod de Triton lleva un [[node-selector|`nodeSelector`]] con esa misma etiqueta. El scheduler solo lo pone en nodos que la tengan.

### Repeler: taint y toleration

El `nodeSelector` atrae a Triton, pero no impide que otros pods caigan en la T4. Un gateway de 1 vCPU en una máquina de US$0.526 la hora le quitaría espacio a un Triton y desperdiciaría la GPU. Para eso existe el par [[taint-toleration|taint y toleration]]:

- Un **taint** (mancha) en el nodo dice «aquí no entra nadie que no lo acepte». Los nodos de T4 de Alba llevan `nvidia.com/gpu=present:NoSchedule`.
- Una **toleration** en el pod dice «yo acepto esa mancha». Triton la tiene; el gateway no tiene ni toleration ni `nodeSelector`, así que nunca cae en una T4.

:::analogia La puerta de un estudio de grabación
La label con su `nodeSelector` es la dirección: el músico (Triton) busca el estudio con la etiqueta «gpu-t4». El taint es el guardia de la puerta, y la toleration es el pase. Sin pase, el guardia no deja entrar a nadie, aunque llegue por error.

Dónde se rompe: tener el pase no te lleva al estudio. Un pod con la toleration y sin `nodeSelector` puede caer en cualquier nodo, con o sin guardia. Por eso Triton lleva las dos cosas: la dirección y el pase.
:::

:::figura e09-kubernetes-gpu-nodo
Los cuatro nodos de Alba en sus dos zonas. Triton entra a la T4 por su etiqueta y con su pase; el gateway se queda en las c6i.
:::

### Cuando no cabe: Pending

Si ningún nodo cumple todo lo que pide un pod, el pod se queda **Pending** y sus eventos dicen por qué, nodo por nodo: «no tiene GPU libre», «no tiene la etiqueta», «tiene un taint que no toleras». Hay dos clases de Pending. Si falta una T4 libre, el [[autoscaler-nodos|autoscaler de nodos]] (el programa que pide máquinas nuevas a la nube; lo ves en «Crecer solos») puede traerla. Si el `nodeSelector` pide una etiqueta mal escrita (`gpu-T4` en vez de `gpu-t4`), no existe ninguna máquina que la tenga, y el pod se queda Pending para siempre, en silencio: ningún autoscaler lo arregla.

:::profundo El scheduler en chico, en Python
El código hace en chico lo que hace el scheduler: revisa cada nodo con las reglas en el orden real (el taint, la etiqueta, la GPU libre, la CPU libre) y, si ninguno sirve, junta las razones como en los eventos del pod. Los nodos son de juguete: las dos T4 ya tienen su Triton.

```python
nodos = [  # nombre, labels, taints, GPU libres, vCPU libres
    ("gpu-1a", {"workload": "gpu-t4"}, ["nvidia.com/gpu"], 0, 1.5),
    ("gpu-1b", {"workload": "gpu-t4"}, ["nvidia.com/gpu"], 0, 1.5),
    ("cpu-1a", {}, [], 0, 0.6),
    ("cpu-1b", {}, [], 0, 1.6),
]
def agenda(nombre, selector, tolera, gpu, cpu):
    razones = {}
    for nodo, labels, taints, gpus, cpus in nodos:
        if any(t not in tolera for t in taints):
            r = "node(s) had untolerated taint {nvidia.com/gpu: present}"
        elif any(labels.get(k) != v for k, v in selector.items()):
            r = "node(s) didn't match Pod's node affinity/selector"
        elif gpu > gpus:
            r = "Insufficient nvidia.com/gpu"
        elif cpu > cpus:
            r = "Insufficient cpu"
        else:
            return f"{nombre}: va a {nodo}"
        razones[r] = razones.get(r, 0) + 1
    return f"{nombre}: Pending, 0/4 nodes are available: " + ", ".join(
        f"{n} {r}" for r, n in razones.items())

print(agenda("triton-v14 #3", {"workload": "gpu-t4"}, ["nvidia.com/gpu"], 1, 2))
print(agenda("gateway #4", {}, [], 0, 1))
print(agenda("triton con typo", {"workload": "gpu-T4"}, ["nvidia.com/gpu"], 1, 2))
```

```salida
triton-v14 #3: Pending, 0/4 nodes are available: 2 Insufficient nvidia.com/gpu, 2 node(s) didn't match Pod's node affinity/selector
gateway #4: va a cpu-1b
triton con typo: Pending, 0/4 nodes are available: 4 node(s) didn't match Pod's node affinity/selector
```

El mensaje real agrega al final una parte `preemption:`, sobre si sacar pods de menor prioridad ayudaría. El tercer Triton no cabe porque las T4 están ocupadas: falta un nodo con GPU. El Triton con la etiqueta mal escrita no cabe en **ningún** nodo: los 4 dicen lo mismo, «no coincide con el selector».
:::

### Una por zona: el reparto por zona

Con dos Tritons, perder una zona debe dejar uno vivo. El [[topology-spread|reparto por zona]] (*topology spread constraint*) le dice al scheduler cuánta diferencia acepta entre zonas:

- `maxSkew: 1`: entre la zona con más pods y la que tiene menos, como mucho 1 de diferencia.
- `topologyKey: topology.kubernetes.io/zone`: la etiqueta que trae cada nodo con su zona.
- `whenUnsatisfiable`: qué hacer si no se puede. Triton tiene `DoNotSchedule`: prefiere quedarse Pending a poner dos Tritons en la misma zona. El gateway tiene `ScheduleAnyway`: intenta repartir, pero si no puede, arranca de todos modos.

¿Por qué distinto? Un gateway de más en la zona equivocada cuesta poco; dos Tritons en la misma zona dejarían a Alba sin GPU si esa zona cae. El precio, que el equipo de Alba acepta: si cae una zona, no se pone un segundo Triton en la sana hasta que vuelva, y la T4 que queda carga todo. Alcanza: una T4 aguanta ≈ 1,200 fotos por segundo (lo más que ha medido el equipo), y el pico de diseño, 500, es 500 ÷ 1,200 ≈ 42 % de eso, bajo el tope de 70 % del equipo. La cuenta a fondo está en «Regiones, zonas y disponibilidad».

:::profundo Por qué no se pone un segundo Triton en la zona sana
Las zonas que cuenta el scheduler salen de los nodos registrados, y en una caída de zona sus nodos siguen registrados, solo que marcados como caídos. La zona caída cuenta con 0 Tritons (el de allá, en cuanto Kubernetes lo da por perdido, ya no cuenta), la sana con 1, y un segundo en la sana dejaría una diferencia de 2, más que el `maxSkew` de 1.

Karpenter, el autoscaler de nodos de Alba (lo ves en «Crecer solos»), tampoco ayuda: para él, las zonas son las de su grupo de reglas, 1a y 1b, así que intenta lanzar la T4 nueva en la zona caída. Si los nodos de la zona caída llegaran a borrarse del clúster, el scheduler dejaría de contarla. Por eso el equipo prueba esta combinación en un [[game-day|game day]] (un simulacro de falla planeado) en vez de suponerla.
:::

### El PodDisruptionBudget

Hay apagados que nadie eligió (un nodo que muere) y apagados **voluntarios**: vaciar un nodo para actualizarlo (*drain*), subir de versión el clúster, o que el autoscaler de nodos junte pods para apagar una máquina sobrante. Un [[pdb|PodDisruptionBudget]] (PDB) es un mínimo para los voluntarios: Kubernetes no saca un pod a propósito si eso deja menos del mínimo.

El de Triton es `minAvailable: 1`. Con 2 Tritons, se puede vaciar un nodo a la vez; el segundo espera a que el primero vuelva a estar listo. Lo que el PDB **no** hace: proteger de un nodo que muere o de una zona que cae. Eso no pide permiso.

:::ojo
El mínimo tiene que ser menor que las réplicas. Con `minAvailable: 2` y 2 réplicas, cada drain espera un permiso que nunca llega, y la actualización del clúster se detiene.
:::

## El rolling update: cambiar de versión sin perder capacidad {The rolling update: changing versions without losing capacity}

### Un ReplicaSet que sube y otro que baja

Un **rollout** de un Deployment (sacar una versión nueva; no confundir con el objeto Rollout del gateway) empieza cuando cambia su plantilla de pod: otra imagen, otros recursos, otra probe. Cambiar el número de réplicas no cuenta. El Deployment crea un ReplicaSet nuevo con la plantilla nueva y va pasando las copias: sube uno, baja otro, hasta que el viejo queda en 0. Esa forma de hacerlo es el [[rolling-update|rolling update]] (actualización escalonada), y dos campos dicen qué tan rápido va:

- `maxSurge`: cuántos pods **de más** puede haber, sobre las réplicas deseadas, mientras dura.
- `maxUnavailable`: cuántos pods **de menos** (no listos) se aceptan mientras dura.

Si nadie los escribe, valen 25 % y 25 %. El de más se redondea hacia arriba, con [[ceil|⌈ ⌉]], y el de menos hacia abajo, con ⌊ ⌋.

:::formula Pods durante un rolling update
e = ⌈ text{maxSurge} × R ⌉
a = ⌊ text{maxUnavailable} × R ⌋
R_{máx} = R + e
R_{lis} = R − a
- R: las réplicas deseadas
- text{maxSurge}: el campo de pods de más, como fracción (0.25 para 25 %); si se escribe como número entero, \(e\) es ese número
- text{maxUnavailable}: el campo de pods de menos, igual; si es un entero, \(a\) es ese número
- e: los pods extra, de más, que se permiten
- a: los pods de menos (ausentes) que se permiten
- R_{máx}: los pods que llegan a existir a la vez
- R_{lis}: los pods listos que nunca faltan
:::

### En GPU, un pod de más es una T4 de más

Alba escribe `maxSurge: 1` y `maxUnavailable: 0` en Triton. En un pod de CPU, un pod de más es poca cosa. En Triton, cada pod pide una T4 entera: un pod de más es **una máquina de más**, que puede no estar.

:::cuenta Cuántas T4 pide un rolling update de Triton
Pods a la vez con 2 réplicas, \(R_{máx}\) // \(R_{máx} = R + e\), con \(e\) = 1 escrito | 2 + 1 | 3 T4 a la vez
Listos con 2 réplicas, \(R_{lis}\) // \(R_{lis} = R − a\), con \(a\) = 0 | 2 − 0 | 2 siempre listos
Pods a la vez con 4 réplicas, \(R_{máx}\) // 4 es el tope de KEDA, el autoscaler de Triton | 4 + 1 | 5 T4
Tope de T4 del autoscaler de nodos // las 5, más la de staging, que vive en el mismo clúster | 4 + 1 + 1 | 6 GPU
De menos con 4 réplicas, por omisión, \(a\) // \(a = ⌊0.25 × R⌋\) | ⌊0.25 × 4⌋ | 1 de menos
Costo de la T4 de más // ≈ 15 min = 0.25 h (los ≈ 11 min del pod más lento, que verás abajo, con margen), a US$0.526 la hora | 0.526 × 0.25 | ≈ US$0.13
= Una T4 de más por unos minutos cuesta centavos. Perder un Triton de capacidad en medio de un despliegue, como pasaría con los valores por omisión y 4 réplicas, cuesta el [[n-mas-uno|N+1]]: tener siempre una copia más de las necesarias, para aguantar la caída de una.
:::

Con 2 réplicas, los valores por omisión dan lo mismo que lo que escribe Alba (⌈0.5⌉ = 1, ⌊0.5⌋ = 0). Alba lo escribe para que no dependa del redondeo, que con 4 ya cambia.

¿Y si la T4 de más no llega, porque AWS no tiene `g4dn.xlarge` libres en esa zona (un [[error-capacidad|error de capacidad]])? El pod nuevo se queda Pending, y como `maxUnavailable` es 0, nadie toca a los dos viejos: el despliegue se queda **a medias**, sin perder nada. Es la falla que Alba prefiere.

### Cuánto esperar: `progressDeadlineSeconds`

Kubernetes no sabe cuánto tarda tu pod en estar listo. `progressDeadlineSeconds` le dice cuánto esperar **sin avance** antes de marcar el despliegue como fallido. El valor por omisión es 600 s; Triton tiene 900 s: un pod nuevo que necesita máquina nueva tarda, en el peor caso, ≈ 11 min = 675 s (la máquina, la imagen de ≈ 9.2 GB, el engine y la readiness). Con 600 s, un día lento, Kubernetes declararía fallido un despliegue sano; en 900 s cabe con 225 s de margen.

:::profundo Los 675 s, tramo por tramo
:::cuenta Un pod nuevo de Triton en un rolling update
Detectar que falta capacidad // no aplica: el Deployment crea el pod al instante | — | 0 min
Nodo nuevo // lanzar la `g4dn.xlarge`, que arranque, se una al clúster y anuncie su GPU (estimación del equipo de Alba) | — | ≈ 2–5 min
Bajar la imagen // ≈ 9.2 GB (estimación del equipo de Alba) | — | ≈ 2–5 min
Cargar el engine y calentarlo | ≈ 10–60 s | ≈ 0.17–1 min
Pasar la readiness | ≈ 5–15 s | ≈ 0.08–0.25 min
Total, el más rápido | 2 + 2 + 0.17 + 0.08 | ≈ 4.25 min
Total, el más lento | 5 + 5 + 1 + 0.25 | 11.25 min = 675 s
= Sin el tramo de detectar (el Deployment crea el pod al instante, no espera una métrica), el máximo queda bajo los 13 min de un pod que pide KEDA. Los 675 s caben en 900 s, no en 600.
:::
:::

Cuando el plazo se vence, el Deployment queda con la condición `ProgressDeadlineExceeded`, y nada más: **no regresa solo** a la versión anterior. Alguien tiene que verlo (una alerta) y decidir.

### Volver atrás

El [[rollback]] (volver a la versión anterior) de Alba es un `git revert` en `alba/despliegue`: un commit nuevo que deshace el anterior, y Argo CD aplica el resultado. Lo cuenta «CI/CD y registro de imágenes» en «El rollback, con este diseño». Kubernetes trae su propio botón para volver, pero con GitOps dura poco.

:::profundo El botón de Kubernetes y por qué Alba no lo usa
`revisionHistoryLimit: 5` guarda los 5 ReplicaSets anteriores, en 0 réplicas (el valor por omisión es 10). Con ellos, `kubectl rollout undo deployment/triton-v14` regresa la plantilla anterior en segundos. Pero en Alba eso dura poco: el manifiesto en Git sigue diciendo la versión nueva. Si Argo CD tiene prendida la corrección automática (*self-heal*), la vuelve a aplicar en segundos; si no, en cuanto llegue el siguiente cambio al repositorio.
:::

:::nota Para qué usa Alba el rolling update
Para cambios **dentro** de una release (el par de versiones de Triton y del gateway que se despliega junto): subir la memoria de Triton, cambiar una probe. Un modelo nuevo no entra así: la versión 15 es otra release, con su propio `triton-v15`, y el tráfico se le pasa poco a poco desde el gateway. Un rolling update solo mide salud (¿los pods nuevos están listos?), no calidad (¿predicen bien?). Eso es de «Rollout seguro».
:::

## Crecer solos: el HPA, KEDA y los nodos {Growing by themselves: the HPA, KEDA and the nodes}

### Dos lazos

En «Servicios gestionados, serverless y permisos» viste los dos lazos del [[autoscaling]]: uno agrega **pods** en segundos, si caben; otro agrega **nodos** en minutos, cuando ya no caben. Los pods no escalan más allá de los nodos que existen.

:::diagrama e09-kubernetes-escalado
Los dos lazos de Alba. Arriba, el de pods: el gateway por CPU y Triton por la espera en su fila. Abajo, el de nodos: un pod Pending hace que Karpenter pida una máquina.
:::

### El HPA: una regla de tres con redondeo

El [[hpa|HPA]] (*Horizontal Pod Autoscaler*, el que trae Kubernetes) es un controlador que, cada 15 s, mira una métrica de los pods y calcula cuántos debería haber para que la métrica quede en su objetivo:

:::formula Las réplicas que pide el HPA
n_{des} = ⌈ n × frac{x}{x_{obj}} ⌉
- n: los pods que hay ahora
- x: el valor de la métrica ahora (el promedio por pod, o el valor que le publican), en su unidad
- x_{obj}: el objetivo de la métrica, en la misma unidad
- n_{des}: los pods deseados. Después se recorta al mínimo y al máximo, y no cambia nada si \(x ÷ x_{obj}\) está a 10 % o menos de 1 (la tolerancia)
:::

La idea: si cada pod trabaja al 90 % y quieres 60 %, te faltan pods en proporción 90 ÷ 60 = 1.5. Es una regla de tres, redondeada hacia arriba, porque no hay medio pod.

En el gateway, la métrica es la CPU **como porcentaje del request**. Con un request de 1 núcleo y un objetivo de 60 %, el HPA quiere ≈ 0.6 vCPU por pod. Por eso el request importa aunque no haya límite: sin request, el HPA no tiene contra qué medir.

:::cuenta El HPA del gateway en un pico
Ahora, \(n\) // un pico empuja la CPU | — | 5 pods
Métrica, \(x\) // CPU promedio, como % del request de 1 núcleo | — | 90 %
Objetivo, \(x_{obj}\) // el de Alba | — | 60 %
Razón, \(x ÷ x_{obj}\) // lejos de 1: pasa la tolerancia | 90 ÷ 60 | 1.5
Deseados, \(n_{des}\) // \(⌈n × x ÷ x_{obj}⌉\) | ⌈5 × 1.5⌉ = ⌈7.5⌉ | 8 pods
Ya con 8, la misma carga se reparte // 5 × 90 % = 4.5 vCPU entre 8 pods = 56 %; 56 ÷ 60 ≈ 0.94, a menos de 10 % de 1 | dentro de la tolerancia | se queda en 8
Pasa el pico, \(n_{des}\) // 8 pods al 30 %; el mínimo es 3 | ⌈8 × 30 ÷ 60⌉ | 4 pods
= Sube de 5 a 8 en un paso y se queda quieto con 56 %. Cuando la carga baja, baja a 4, pero despacio: 1 pod por minuto y tras 5 minutos de calma.
:::

:::calculadora e09-kubernetes-hpa
Empieza con el pico de la cuenta. Cambia \(n\) a 8 y \(x\) a 56 y mira la tolerancia; luego pon \(n\) = 2, \(x\) = 25, \(x_{obj}\) = 10, los topes de Triton (2 y 4) y 1 pod por nodo (una T4 cada uno): es la cuenta de KEDA de más abajo.
:::

### Subir rápido, bajar despacio

El HPA sube rápido y baja despacio, a propósito: un pod de menos en un pico cuesta latencia y errores; un pod de más por 5 minutos cuesta centavos.

:::profundo El campo `behavior` del gateway
El campo `behavior` del HPA dice qué tan rápido se mueve. En el gateway de Alba:

- **Sube** hasta +100 % de pods cada 30 s, sin ventana: si el pico pide el doble, en 30 s lo tiene (si caben en los nodos).
- **Baja** 1 pod por minuto, y solo después de una **ventana de estabilización** de 300 s: el HPA usa la recomendación más alta de los últimos 5 minutos. Así, una bajada de un minuto no quita pods que el siguiente minuto vuelve a pedir.

:::

### KEDA para Triton: escalar por la fila, no por la CPU

¿Por qué no escalar Triton por CPU? Porque su trabajo lo hace la GPU. Triton puede tener la T4 saturada con la CPU tranquila, y el HPA por CPU no lo vería nunca. Tampoco sirve el «uso» de la GPU que reporta NVIDIA: dice qué fracción del tiempo la GPU tuvo algo corriendo, no qué tan llena está. Una T4 puede marcar 100 % atendiendo [[batch|batches]] (grupos de fotos que la GPU procesa juntas) de una sola foto.

Lo que sí avisa que falta capacidad es la **fila**. En Triton, cada request espera un poco antes de entrar a la GPU, para juntarse con otras en un batch. Normalmente espera ≈ 1–3 ms (el `max_queue_delay` de Alba es 2 ms). Arriba de 10 ms, la GPU ya no da abasto. A los 100 ms, Triton la rechaza.

[[keda|KEDA]] es un programa que se instala en el clúster para escalar con métricas de fuera de Kubernetes: mensajes en una cola o una consulta a Prometheus. Prometheus es el programa que lee los números de cada servicio (sus métricas) cada 15 s, en el namespace `monitoring`. KEDA lee la métrica, y crea y alimenta un HPA (`keda-hpa-triton-v14`) que aplica la misma regla de tres.

La métrica es la espera **media** en la fila de los últimos 2 minutos. Triton no la publica así: publica dos contadores que solo crecen, el total de microsegundos esperados y el total de requests terminadas. La espera media sale de restar dos lecturas:

:::formula La espera media en la fila de Triton
x = frac{U_2 − U_1}{P_2 − P_1} ÷ 1000
- U_1, U_2: el contador de espera acumulada (`nv_inference_queue_duration_us`) al principio y al final de la ventana, en µs
- P_1, P_2: el contador de requests (peticiones) terminadas (`nv_inference_request_success`) en esos dos momentos
- x: la espera media por request en la ventana, en ms (por eso se divide entre 1,000). Es la misma \(x\) del HPA: la métrica
:::

:::profundo Las dos reglas en Python
El código junta la regla del HPA y la espera media, con los contadores de juguete de la cuenta de KEDA (42,000 requests en 2 minutos).

```python
import math

def deseadas(n, x, x_obj, n_min, n_max, tol=0.1):
    """La regla del HPA: n_des = ceil(n × x / x_obj), con tolerancia y topes."""
    if abs(x / x_obj - 1) <= tol:
        return n                          # dentro del 10 %: no se mueve
    return min(max(math.ceil(n * x / x_obj), n_min), n_max)

# Gateway: x = uso de CPU en % del request, objetivo 60 %, de 3 a 12 pods
for n, x in [(5, 90), (8, 56), (8, 30)]:
    print(f"gateway: {n} pods al {x} % -> {deseadas(n, x, 60, 3, 12)}")

# Triton: x = espera media en la cola, en ms, desde dos lecturas de los contadores
def espera_ms(antes, ahora):
    us = ahora["queue_us"] - antes["queue_us"]     # µs de espera sumados en la ventana
    ok = ahora["success"] - antes["success"]       # requests terminadas en la ventana
    return us / ok / 1000

antes = {"queue_us": 9_310_000_000, "success": 41_200_000}
for nombre, ahora in [("normal", {"queue_us": 9_394_000_000, "success": 41_242_000}),
                      ("saturada", {"queue_us": 10_360_000_000, "success": 41_242_000})]:
    x = espera_ms(antes, ahora)
    print(f"triton {nombre}: espera {x:.0f} ms -> {deseadas(2, x, 10, 2, 4)} pods")
```

```salida
gateway: 5 pods al 90 % -> 8
gateway: 8 pods al 56 % -> 8
gateway: 8 pods al 30 % -> 4
triton normal: espera 2 ms -> 2 pods
triton saturada: espera 25 ms -> 4 pods
```
:::

:::cuenta KEDA con la fila de Triton
Requests, \(P_2 − P_1\) // las que terminan en la ventana: 2 min = 120 s a 350 por segundo, el pico de un día normal | 350 × 120 | 42,000
Espera normal, \(x\) // \((U_2 − U_1) ÷ (P_2 − P_1) ÷ 1000\); en la ventana, el contador de espera subió \(U_2 − U_1\) = 84,000,000 µs (lectura de ejemplo) | 84,000,000 ÷ 42,000 ÷ 1,000 | 2 ms
Deseados, \(n_{des}\) // \(⌈n × x ÷ x_{obj}⌉\), con \(n\) = 2 y \(x_{obj}\) = 10 ms | ⌈2 × 2 ÷ 10⌉ = ⌈0.4⌉ | 1, pero el mínimo es 2
Espera saturada, \(x\) // las mismas requests; el contador subió \(U_2 − U_1\) = 1,050,000,000 µs | 1,050,000,000 ÷ 42,000 ÷ 1,000 | 25 ms
Deseados, \(n_{des}\) // misma regla | ⌈2 × 25 ÷ 10⌉ | 5, pero el máximo es 4
Ritmo de subida // KEDA de Alba: +1 pod por minuto | de 2 a 4 | ≈ 2 min de decisiones
= KEDA pide 4 Tritons en ≈ 2 minutos. Que existan es otra cosa: cada uno nuevo, sin nodo libre, tarda ≈ 5–13 min.
:::

:::ojo
El objetivo de 10 ms de KEDA **no** es el ≈ 10 ms que Triton ocupa en el presupuesto de latencia de Alba, lo que puede tardar cada paso de una request (a Triton le tocan ≈ 5–12 ms: GPU, fila y red). Este es solo la espera en la fila, que normalmente es de 1–3 ms.
:::

El resto del ScaledObject: consulta cada 15 s, baja 1 pod cada 5 minutos y solo después de 10 minutos sin necesitarlo, y `minReplicaCount: 2` **escrito**. KEDA, si no lo escribes, pone 0: el Triton de Alba bajaría a cero de madrugada y la primera foto de la mañana esperaría minutos.

:::profundo Los dos autoscalers en el repositorio de despliegue
Es ilustración, como el manifiesto de Triton. El HPA del gateway apunta al Rollout; el ScaledObject de KEDA, al Deployment `triton-v14`, y trae la consulta a Prometheus con la fórmula de la espera media.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: {name: gateway, namespace: classifier}
spec:
  scaleTargetRef: {apiVersion: argoproj.io/v1alpha1, kind: Rollout, name: gateway}
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource: {name: cpu, target: {type: Utilization, averageUtilization: 60}}
  behavior:
    scaleUp: {stabilizationWindowSeconds: 0, policies: [{type: Percent, value: 100, periodSeconds: 30}]}
    scaleDown: {stabilizationWindowSeconds: 300, policies: [{type: Pods, value: 1, periodSeconds: 60}]}
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: {name: triton-v14, namespace: classifier}
spec:
  scaleTargetRef: {name: triton-v14}
  minReplicaCount: 2                   # sin esta línea, KEDA pondría 0
  maxReplicaCount: 4
  pollingInterval: 15
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp: {stabilizationWindowSeconds: 0, policies: [{type: Pods, value: 1, periodSeconds: 60}]}
        scaleDown: {stabilizationWindowSeconds: 600, policies: [{type: Pods, value: 1, periodSeconds: 300}]}
  triggers:
    - type: prometheus
      metricType: Value
      metadata:
        serverAddress: http://prometheus-operated.monitoring:9090
        threshold: "10"
        ignoreNullValues: "false"      # si la consulta no trae datos, error, no "0 ms"
        query: |
          sum(rate(nv_inference_queue_duration_us{pod=~"triton-v14-.*"}[2m]))
          / sum(rate(nv_inference_request_success{pod=~"triton-v14-.*"}[2m])) / 1000
```
:::

### El lazo de nodos: Karpenter

Cuando un pod nuevo no cabe, se queda Pending. El [[autoscaler-nodos|autoscaler de nodos]] es el programa que ve esos pods y pide máquinas a la nube. Hay dos conocidos: el **Cluster Autoscaler**, que agranda grupos de máquinas ya definidos, y **Karpenter**, que lee lo que pide el pod pendiente (GPU, zona, etiquetas) y lanza directamente la máquina que le sirve. Alba usa Karpenter con dos grupos de reglas, sus *NodePools*:

- `gpu-t4`: solo `g4dn.xlarge` [[on-demand]] (al precio normal, sin riesgo de que AWS te la quite), con la imagen de máquina de EKS para GPU (el disco de arranque, con el driver de NVIDIA), la etiqueta `workload=gpu-t4` y el taint `nvidia.com/gpu=present:NoSchedule`. Tope: 6 GPU (las 4 de KEDA, una de más en un despliegue y la de staging); la [[cuota-servicio|cuota]] de AWS, 28 vCPU, alcanza para esas 6 máquinas de 4 vCPU y la del runner de CI. Apaga un nodo solo cuando queda **vacío**: nunca mueve un Triton de lugar para ahorrar.
- `general`: máquinas `c6i.xlarge` para el gateway y lo demás. En cada una caben 3 gateways de 1 vCPU (de las 4 vCPU, una parte se queda para el sistema y los programas de cada nodo). Con 12 gateways, Karpenter sube a 4 nodos: ⌈12 ÷ 3⌉ = 4.

### Lo que tarda un pod de Triton, del lado del clúster

Si KEDA pide un Triton y hay una T4 libre con la imagen ya bajada, solo falta cargar el engine y pasar la readiness: ≈ 15–75 s. Si no hay T4 libre, el equipo de Alba estima ≈ 5–13 min: detectar la falta (≈ 0.5–1.5 min), el nodo nuevo (≈ 2–5), la imagen (≈ 2–5), el engine y la readiness. La cuenta completa está en «Servicios gestionados, serverless y permisos».

De esos tramos, tres son del clúster: el nodo, la imagen y la readiness. Los dos largos tienen palanca: un **nodo de reserva** (una T4 ya prendida) y una [[imagen-pre-descargada|imagen precargada]], que ya está en el disco del nodo antes de que llegue el pod. Alba **no** precarga la imagen hoy.

:::profundo Las palancas, tramo por tramo
- **El nodo (≈ 2–5 min).** Un nodo de reserva: una T4 prendida sin trabajo, apartada con un pod de relleno de prioridad muy baja que cualquier Triton puede sacar. Cuesta lo que una T4 entera, ≈ US$384 al mes (0.526 × 730).
- **La imagen (≈ 2–5 min).** Una imagen precargada en el nodo: hornear la imagen de Triton en la imagen de máquina o bajarla con un DaemonSet en cuanto el nodo arranca. Con la descarga (el *pull*) a ≈ 0, el pod llega en ≈ 3–8 min en vez de ≈ 5–13. Alba no lo hace hoy: el pull sigue en su arranque.
:::

Lo que Alba sí hace es no depender de esos minutos: 2 Tritons siempre prendidos, uno por zona, cada uno con capacidad para todo el pico de diseño. El autoscaling es para lo que crece en minutos; los picos de segundos se aguantan con el [[headroom]] (la capacidad de sobra) que ya corre y, si no alcanza, con [[load-shedding|load shedding]] (contestar 503 rápido a lo que no cabe).

## Cuando algo cae, y `kubectl` para mirar {When something fails, and kubectl to look} [extra]

### Qué pasa con cada falla

| Lo que cae | Qué hace Kubernetes solo | Qué pasa en Alba |
|---|---|---|
| El proceso de un pod | El kubelet lo reinicia en el mismo pod; si sigue muriendo, cada vez espera más (`CrashLoopBackOff`) | El otro Triton atiende mientras tanto |
| Un nodo con T4 | Tras ≈ 6 min sin noticias del nodo (≈ 50 s + 300 s de espera), saca sus pods y los recrea; Karpenter trae otro nodo | El otro Triton carga el 100 %, ≈ 42 % de su T4 en el pico de diseño |
| Una T4 que da errores pero sigue «viva» | Poco: ante ciertos errores graves (los *Xid* críticos), el device plugin deja de ofrecerla a pods nuevos, pero el Triton que ya la usa sigue; otros errores no los ve | Hace falta una alerta y una persona que aísle el nodo (*cordon*) y lo vacíe (*drain*) |
| Una zona entera | El ALB deja de mandar a esa zona; el HPA agrega gateways en la sana, pero ≈ 6 min después, cuando Kubernetes da por perdidos los de la zona caída (antes los cuenta sin métrica) | Con `DoNotSchedule`, no hay segundo Triton hasta que vuelva la zona; si no alcanza, load shedding |
| Triton en las dos zonas | — | El gateway contesta 503 con [[retry-after\|`Retry-After`]], y la app le muestra a quien publica el selector manual de categoría |

### `kubectl` para depurar

Estos son los comandos de la persona de guardia (la que atiende las alertas; en Alba, Marta) cuando un pod no arranca. Son ilustración: necesitan acceso al clúster, y la salida del final es un ejemplo, no algo que corrimos.

```bash
kubectl get pods -n classifier -o wide        # cada pod, su estado y su nodo
kubectl describe pod triton-v14-7d9f8c6b5-q8wzl -n classifier   # al final, sus eventos: por qué no arranca
kubectl logs triton-v14-7d9f8c6b5-x2kqp -n classifier --previous  # lo que escribió antes de su último reinicio
kubectl get events -n classifier --sort-by=.lastTimestamp
kubectl rollout status deployment/triton-v14 -n classifier
kubectl top pods -n classifier                # CPU y memoria que usan de verdad
# Ejemplo de lo que imprime el primero (ilustrativo, sin las dos últimas columnas):
# NAME                         READY   STATUS    RESTARTS   AGE   IP            NODE
# triton-v14-7d9f8c6b5-x2kqp   1/1     Running   0          3d    10.0.17.103   ip-10-0-17-42.ec2.internal
# triton-v14-7d9f8c6b5-q8wzl   0/1     Pending   0          2m    <none>        <none>
```

La columna `READY` dice cuántos contenedores pasan su readiness; `RESTARTS`, cuántas veces los reinició el kubelet. Un pod con `0/1` y `Running` está vivo pero fuera del reparto. Un pod Pending no tiene nodo, y la razón está en sus eventos.

Dos alertas que nadie debería quitar: **pods Pending por más de unos minutos** y **un autoscaler en su máximo**. Las dos dicen lo mismo: el lazo ya no puede corregir solo.

:::profundo Lo que el clúster necesita instalado
Los manifiestos de Alba suponen que en el clúster ya corren: el device plugin de NVIDIA; el controlador del balanceador de AWS, que lee el Ingress y arma el ALB; KEDA; Prometheus; Karpenter; Argo CD y Argo Rollouts; y una red que haga cumplir las **NetworkPolicy**, las reglas de quién puede hablar con quién. La de Triton (`triton-ingress`) deja entrar solo a los gateways al puerto 8000 y solo al namespace `monitoring` al 8002, el de las métricas. Cada pod, además, corre con un usuario sin privilegios (10001 el gateway, 1000 Triton) y sin los permisos especiales del kernel (*capabilities*), como se preparó en «Empaquetado con Docker».
:::

## Errores comunes {Common mistakes}

:::ojo
**Poner límite de CPU al gateway «por orden».** Con 4 decodes a la vez y límite de 1 núcleo, cada foto tarda 115 ms en vez de 40, con el nodo medio vacío. Evítalo: request de CPU sí, límite no; el techo va en la memoria.
:::

:::ojo
**Una dependencia en la liveness.** Si `/healthz` pregunta a Triton, una caída de Triton reinicia todos los gateways a la vez y nada se arregla. Evítalo: la liveness mira solo el propio proceso; las dependencias van en la readiness.
:::

:::ojo
**Sin startup probe en un programa que tarda en arrancar.** La liveness mata a Triton mientras carga el engine, y el pod queda en `CrashLoopBackOff`. Evítalo: una startup que cubra el arranque más lento con margen (Alba: 5 min contra ≈ 10–60 s).
:::

:::ojo
**Escalar por CPU un servicio de GPU.** La CPU de Triton puede estar tranquila con la T4 saturada. Evítalo: una señal que suba cuando falta capacidad, como la espera en la fila (KEDA, objetivo 10 ms).
:::

:::ojo
**Olvidar `minReplicaCount` en KEDA.** Por omisión es 0, y el servicio baja a cero sin que nadie lo decida. Evítalo: escríbelo siempre.
:::

:::ojo
**`replicas` en el manifiesto de algo que escala solo.** Cada sincronización de Argo CD regresa el número y pelea con el autoscaler. Evítalo: en Git, solo los topes del autoscaler.
:::

:::ojo
**Un PDB igual a las réplicas.** `minAvailable: 2` con 2 réplicas traba todo drain y toda actualización de nodos. Evítalo: el mínimo menor que las réplicas (Alba: 1 de 2).
:::

## En la vida real {In real life} [extra]

### En Alba

En noviembre de 2026, el clúster de Alba corre 2 Tritons de la versión 14, uno por zona, y de 3 a 5 gateways casi todo el día. En un día normal KEDA no se mueve (la fila espera ≈ 1–3 ms; el objetivo es 10) y el HPA del gateway sube a 4 pods en la hora pico. Un cambio de recursos de Triton pide una T4 de más unos minutos; un modelo nuevo entra como release aparte.

### Otros casos

- **Workers de OCR desde una cola.** Un servicio que lee documentos escaneados con OCR (reconocimiento de texto) toma trabajos de una cola. Si cada trabajo tarda ≈ 20 s y se aceptan ≈ 300 s de espera, cada worker puede tener 300 ÷ 20 = 15 mensajes por delante (supuestos del ejemplo). KEDA lee la cola: con 120 mensajes, ⌈120 ÷ 15⌉ = 8 workers, y puede bajar a 0 de noche, porque nadie espera la respuesta en segundos.
- **Un LLM propio.** Con decenas de GB de pesos, el arranque de un pod lo domina bajar y cargar los pesos, no el nodo. La señal para escalar tampoco es la CPU: son las requests que esperan y la memoria que ocupan las conversaciones en curso en la GPU.
- **GPUs fragmentadas.** Dos máquinas de 4 GPUs con 3 ocupadas en cada una tienen 2 GPUs libres, pero un pod que pide 2 no cabe: las necesita en el mismo nodo. Es acomodar cajas en cajones (*bin packing*), y por eso Alba usa máquinas de una sola T4.
- **Inspección en una fábrica.** Una cámara con su propia GPU en la línea de producción no tiene clúster: un solo aparato, sin balanceador, autoscaler ni Kubernetes que lo reinicie. Volver a la versión anterior es cambiar un archivo en el aparato.

### Fuera de ML

Un hospital reparte camas así. La reserva de una cama para un paciente programado es el request: se aparta aunque el paciente no haya llegado. Las camas de terapia intensiva tienen un letrero de «solo con orden de terapia» (el taint) y los pacientes con esa orden pueden entrar (la toleration). Y cuando las camas se llenan, se abre otro piso: tarda horas, como un nodo nuevo tarda minutos. Dónde se rompe: una cama reservada y vacía no la usa nadie; la CPU reservada que un pod no usa sí la pueden usar otros.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(k\), \(c\), \(W\), \(L\), \(T\), \(Q\), \(j\), \(D\) (throttling); \(Δ\), \(F\), \(τ\) (probes); \(t_{gracia}\), \(t_{pre}\), \(t_{dren}\), \(t_{mar}\) (apagado); \(R\), \(e\), \(a\), \(R_{máx}\), \(R_{lis}\) (rolling update); \(n\), \(x\), \(x_{obj}\), \(n_{des}\) (HPA); \(U\), \(P\) (contadores de Triton).

:::ejercicios
? [facil] La startup de Triton pregunta cada \(Δ\) = 5 s y aguanta \(F\) = 60 fallas. ¿Cuánto tiempo tiene para arrancar? Si un día el engine tarda 6 min en cargar, ¿qué pasa? Propón un \(F\) que tolere 6 min con 1 min de margen.
- \(τ = Δ × F\) = 5 × 60 = **300 s** = 5 min.
- Con 6 min = 360 s > 300 s, la startup falla 60 veces y el kubelet reinicia el contenedor. El siguiente intento vuelve a tardar 6 min y vuelve a morir: el pod queda en `CrashLoopBackOff` y nunca atiende.
- Para 6 min + 1 min = 420 s: \(F = τ ÷ Δ\) = 420 ÷ 5 = **84**.
? [facil] El HPA del gateway ve \(n\) = 6 pods con la CPU al 75 % del request, objetivo 60 %. ¿Cuántos pide? ¿Y si la CPU está al 63 %?
- \(n_{des} = ⌈n × x ÷ x_{obj}⌉\) = ⌈6 × 75 ÷ 60⌉ = ⌈7.5⌉ = **8**.
- Con 63 %: \(x ÷ x_{obj}\) = 63 ÷ 60 = 1.05, a 5 % de 1. Está dentro de la tolerancia de 10 %: **se queda en 6**.
? [facil] Con los valores por omisión (25 % y 25 %), ¿cuántos pods de más y de menos permite un rolling update con \(R\) = 2? ¿Y con \(R\) = 4? ¿Qué cambia con lo que escribe Alba en Triton?
- \(R\) = 2: \(e = ⌈0.25 × 2⌉ = ⌈0.5⌉\) = **1**; \(a = ⌊0.5⌋\) = **0**. Igual que Alba.
- \(R\) = 4: \(e = ⌈1⌉\) = 1; \(a = ⌊1⌋\) = **1**: \(R_{lis}\) = 4 − 1 = 3 listos. Durante el despliegue se pierde un Triton de capacidad.
- Con lo de Alba (\(e\) = 1, \(a\) = 0): \(R_{máx}\) = 5 T4 a la vez y \(R_{lis}\) = 4: nunca falta capacidad, a cambio de una T4 de más un rato.
? [medio] Con un límite de CPU \(L\) = 1 y \(T\) = 100 ms, ¿cuánto tardan 3 decodes a la vez de \(c\) = 40 ms cada uno? ¿Y 2 decodes con \(L\) = 0.5?
- 3 decodes: \(W = k × c\) = 3 × 40 = 120 ms; \(Q = L × T\) = 100 ms; \(j = ⌈120 ÷ 100⌉ − 1\) = 2 − 1 = 1.
- \(D = j × T + (W − j × Q)/k\) = 100 + (120 − 100) ÷ 3 = 100 + 6.7 ≈ **106.7 ms**, contra 40 sin límite.
- 2 decodes con \(L\) = 0.5: \(W\) = 80, \(Q\) = 50, \(j = ⌈1.6⌉ − 1\) = 1; \(D\) = 100 + (80 − 50) ÷ 2 = **115 ms**. Medio núcleo con 2 hilos frena igual que un núcleo con 4.
? [medio] Un pod nuevo de Triton muestra en sus eventos: `0/6 nodes are available: 2 Insufficient nvidia.com/gpu, 4 node(s) didn't match Pod's node affinity/selector`. ¿Qué quiere decir, y lo puede resolver Karpenter?
- Hay 6 nodos. 4 no tienen la etiqueta `workload: gpu-t4` (son de CPU): el `nodeSelector` los descarta, como debe ser.
- Los 2 con T4 tienen la etiqueta, pero su GPU ya está ocupada.
- Sí: falta un nodo con T4, y el NodePool `gpu-t4` lo puede lanzar si no llegó a su tope de 6 GPU y AWS tiene `g4dn.xlarge` en esa zona. Si el mensaje dijera «6 node(s) didn't match…», sería una etiqueta mal escrita, y nadie lo resolvería solo.
? [reto] En el pico de diseño (500 req/s) corren 5 gateways, 3 en la zona 1b y 2 en la 1a, y los 5 juntos usan ≈ 3 vCPU. Cae la zona 1a. ¿A cuánto llega la CPU de cada gateway que queda, cuántos pide el HPA y dónde los pone? ¿Qué pasaría si el gateway tuviera límite de 1 CPU?
- \(x\) = CPU total ÷ gateways que quedan: los 3 de la 1b cargan los ≈ 3 vCPU, 3 ÷ 3 = 1 vCPU cada uno, **100 %** de su request de 1 núcleo.
- \(n_{des} = ⌈3 × 100 ÷ 60⌉ = ⌈5⌉\) = **5**. Ojo con el cuándo: mientras los 2 gateways de la 1a sigan en la lista sin métrica, el HPA los cuenta como si usaran 0 % al subir: (3 × 100 + 2 × 0) ÷ 5 = 60 %, justo el objetivo, y no se mueve. Pide los 5 cuando Kubernetes da por perdidos esos pods, ≈ 6 min después.
- En la 1b hay una `c6i.xlarge` con 3 gateways: ya no caben más. Los 2 nuevos quedan Pending y Karpenter trae otra `c6i.xlarge` en la 1b: minutos. Mientras, los 3 aguantan porque no tienen límite y la máquina tiene 4 vCPU.
- Con límite de 1 CPU, cada uno estaría justo en su techo, con throttling en cada ráfaga: la latencia subiría justo cuando ya se perdió una zona.
:::

:::profundo Cinco ejercicios más, para la segunda pasada
:::ejercicios
? [medio] KEDA ve 3 Tritons con una espera media de 12 ms. ¿Cuántos pide? ¿Y con 10.8 ms? ¿Qué pasaría con un HPA por CPU en el mismo momento?
- 12 ms: \(n_{des} = ⌈3 × 12 ÷ 10⌉ = ⌈3.6⌉\) = **4**, el máximo.
- 10.8 ms: 10.8 ÷ 10 = 1.08, dentro de la tolerancia: **se queda en 3**.
- Un HPA por CPU no vería nada: la CPU de Triton no sube cuando la T4 está llena. Seguiría en 3 mientras la fila crece hasta los 100 ms de rechazo.
? [facil] Di la clase de QoS de cada pod: (a) el gateway de Alba; (b) un pod con CPU `1`/`1` y memoria `1Gi`/`1Gi` (request/limit); (c) un pod que solo pide `nvidia.com/gpu: 1`.
- (a) **Burstable**: tiene requests, pero no tiene límite de CPU.
- (b) **Guaranteed**: CPU y memoria con request igual al limit.
- (c) **BestEffort**: la clase solo mira CPU y memoria, y no pide ninguna. Es el primero en salir si el nodo se queda sin memoria.
? [medio] Alguien sube el drenado de uvicorn en el gateway a \(t_{dren}\) = 40 s y deja \(t_{gracia}\) = 45 s. ¿Qué pasa en cada apagado? ¿Qué \(t_{gracia}\) hace falta?
- El plazo cuenta desde el principio, incluido el `preStop`: a uvicorn le quedan \(t_{gracia} − t_{pre}\) = 45 − 15 = 30 s de los 40 que se dio. A los 45 s llega SIGKILL y las requests largas se cortan.
- \(t_{gracia} ≥ t_{pre} + t_{dren} + t_{mar}\) = 15 + 40 + 10 = **65 s**.
? [reto] Un rolling update de Triton (2 réplicas, \(e\) = 1, \(a\) = 0) necesita una T4 más, y AWS no tiene `g4dn.xlarge` en ninguna zona. ¿Qué pasa a los 900 s? ¿Qué habría pasado con `maxUnavailable: 1`, y por qué Alba no lo quiere?
- El pod nuevo se queda Pending. Los 2 viejos siguen listos (\(R_{lis}\) = 2): nadie pierde servicio.
- A los 900 s, el Deployment queda en `ProgressDeadlineExceeded`. No regresa solo: el ReplicaSet nuevo se queda con su pod Pending y el viejo con 2, hasta que alguien decida (o llegue la T4).
- Con `maxUnavailable: 1`, Kubernetes habría quitado primero un Triton viejo; su T4 queda libre y el pod nuevo cabe ahí. El despliegue avanza sin GPU de más.
- Pero mientras dura, queda un solo Triton: sin N+1. Si en ese rato cae su zona, Alba se queda sin GPU. Alba prefiere un despliegue trabado a uno que arriesga todo el servicio.
? [reto] Una campaña sostenida hipotética lleva el tráfico a 1,750 req/s (5 × 350, el pico del día; «Regiones, zonas y disponibilidad» parte de 5 × 500 y llega a las mismas 6 T4) durante horas. Con ≈ 3 vCPU por cada 500 req/s en el gateway, una T4 que aguanta ≈ 1,200 fotos/s y el tope de 70 % con una zona caída, ¿alcanzan los topes de Alba? ¿Qué cambiarías y cuándo?
- Gateway: CPU = tráfico × 3 ÷ 500 = 1,750 × 3 ÷ 500 = 10.5 vCPU. Pods = CPU ÷ (0.6 × 1 núcleo de request) = 10.5 ÷ 0.6 = 17.5 → **18 pods**, más que el máximo de 12. Y 18 ÷ 3 = 6 nodos `c6i.xlarge`.
- Triton: T4 por zona = ⌈tráfico ÷ (0.7 × 1,200)⌉, porque con una zona caída la sana carga todo: 1,750 ÷ (0.7 × 1,200) = 1,750 ÷ 840 ≈ 2.08 → 3 T4 por zona, **6 en total**, más que el máximo de KEDA (4).
- NodePool de T4: 6 + 1 de despliegue + 1 de staging = **8**; cuota: con la T4 del runner de CI, 9 máquinas × 4 = **36 vCPU**, más que 28.
- Cambios: `maxReplicas` del gateway a ≥ 18, `maxReplicaCount` de KEDA a 6, NodePool a 8 y pedir a AWS la cuota de 36 vCPU, con días de anticipación. Y subir los **mínimos** el día anterior: cada Triton nuevo tarda ≈ 5–13 min, demasiado para esperar a que la fila crezca.
:::
:::

## Lo que sigue {What comes next}

- «Rollout seguro» usa estos pods para desplegar la versión 15 del modelo: su `triton-v15`, la copia del tráfico, el 5 % y el 25 % por peso en el ALB y el regreso en segundos durante el canary. Del rolling update solo recuerda que mide salud, no calidad.
- El monitoreo de las estaciones siguientes lee las métricas que KEDA ya usa (`nv_*` de Triton, la CPU del gateway) y convierte en alertas las dos de esta lección: pods Pending y autoscalers en su máximo.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
pod deployment-k8s replicaset manifiesto-k8s kubectl namespace-k8s resources-requests-limits throttling-cpu probe startup-probe readiness liveness rolling-update device-plugin-gpu node-selector taint-toleration topology-spread pdb hpa keda autoscaler-nodos imagen-pre-descargada
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué diferencia hay entre un request y un limit?
El request es una reserva: decide en qué nodo cabe el pod y es la base de su escala. El limit es un techo: pasarse de CPU frena (throttling); pasarse de memoria mata (OOMKilled, 137).
? ¿Por qué el gateway de Alba no tiene límite de CPU?
Porque el límite se cobra en periodos de 100 ms, sumando todos los hilos: en una ráfaga frena aunque el nodo tenga CPU libre (4 decodes: 115 ms en vez de 40).
? ¿Qué hace Kubernetes si falla la readiness, y qué si falla la liveness?
Readiness: saca al pod del reparto sin reiniciarlo (Triton, en ≈ 10 s). Liveness: mata el contenedor y lo vuelve a arrancar (Triton, en ≈ 30 s). Por eso la liveness nunca pregunta por una dependencia.
? ¿Para qué sirven juntos el `nodeSelector` y el taint de los nodos de T4?
El `nodeSelector` lleva a Triton a una T4, la única GPU donde carga su engine. El taint saca de ahí a todo lo que no lo tolere, como el gateway. Uno atrae y el otro repele.
? ¿Por qué Triton escala con KEDA por la espera en su fila y no con el HPA por CPU?
Porque su trabajo lo hace la GPU: la CPU no sube cuando la T4 se llena. La espera en la fila sí (normal ≈ 1–3 ms; saturada, > 10 ms).
? En un rolling update de Triton, ¿por qué `maxSurge: 1` y `maxUnavailable: 0`?
Para no quedarse nunca con menos de 2 Tritons listos (N+1 por zona). El costo es una T4 de más mientras dura; si no llega, el despliegue se traba sin perder nada.
? ¿Qué protege un PodDisruptionBudget y qué no?
Protege de los apagados voluntarios (vaciar un nodo, actualizar el clúster): no deja bajar de 1 Triton. No protege de un nodo que muere ni de una zona que cae.
:::
