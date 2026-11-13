---
titulo: Balanceadores, proxies y gateways
en: Load balancers, proxies and gateways
subtitulo: Quién decide a qué copia va cada request, quién la deja entrar y qué pasa cuando una copia se cae: balanceadores L4 y L7 y sus algoritmos, proxies inversos, API gateways, health checks, rate limits y el reparto dentro de Kubernetes.
pregunta: C01 tiene varios pods del gateway y de Triton. ¿Quién decide a cuál va cada request, quién la deja entrar y qué pasa si un pod se cae?
requisitos: http
---

:::idea
Entre quien pide y quien responde casi siempre hay intermediarios. Un balanceador reparte las requests entre las copias sanas de un servicio; un proxy inverso da la cara por los servidores, y un API gateway, además, revisa quién llama y cuánto puede pedir. Cada uno ve una parte distinta de la request, y lo que ve decide lo que puede hacer.
:::

Ana sube la foto de sus tenis. La app se la pasa al *backend* del marketplace, el programa que arma la publicación, y el backend le pide la categoría a C01 con una [[request]] [[http|HTTP]]. Esa request va a **una sola dirección**. Detrás de esa dirección, sin embargo, no hay una máquina: en el pico de diseño de 500 requests por segundo hay 5 copias del gateway (el programa que prepara la foto) y 2 de Triton (el servidor que corre la ResNet-50 en una [[gpu|GPU]]). En Kubernetes, el [[orquestacion|orquestador]] que corre C01 («El camino completo»), cada copia es un *pod*: uno o varios [[contenedor|contenedores]] que viven juntos en una máquina.

Eso abre tres preguntas. ¿Quién decide a qué copia va cada request? ¿Quién la deja entrar, y cuántas le acepta a cada quien? ¿Qué pasa si una copia se cae a media tarde?

Las responden unas piezas que casi nunca salen en un diagrama de ML, pero que están en el camino de cada request: el **balanceador**, el **proxy inverso**, el **API gateway** y, dentro de Kubernetes, el **Service** y el **Ingress**. Vas a ver qué hace cada una, qué ve de la request y por qué importa: con un algoritmo ingenuo, las requests hacen fila detrás de una copia ocupada mientras otra está libre.

## Muchas copias, una puerta: el balanceador {Many copies, one door: the load balancer}

¿Por qué hay varias copias? En «Hacer varias cosas a la vez» viste que un pod del gateway de C01 aguanta ≈ 100 requests por segundo: para 500 hacen falta 5. Y en «Probabilidad para sistemas que fallan», que aunque una copia bastara se pone otra en otra [[zona-disponibilidad|zona]], por si una se cae. Además, las copias cambian todo el tiempo: el autoscaler (la regla que agrega o quita pods según su CPU) mueve el gateway entre 3 y 12 pods, y cada versión nueva reemplaza pods.

Cada pod tiene su propia [[direccion-ip|dirección IP]], y el que lo reemplaza tiene otra. El backend del marketplace no puede llevar esa lista al día, ni debería.

Para eso existe el [[balanceador]] de carga (*load balancer*): un programa, o un servicio de la nube, que recibe las requests en **una dirección fija** y las reparte entre varias copias del servicio. Hace tres trabajos:

- **Reparte.** Lleva una lista de destinos (en AWS, un *target group*, un grupo de destinos) y elige uno para cada conexión o para cada request, según una regla: su algoritmo.
- **Esconde.** Quien llama ve una sola dirección, con un nombre que resuelve el [[dns|DNS]]. Puedes pasar de 3 a 12 copias, o cambiarlas todas por una versión nueva, sin avisarle a nadie.
- **Vigila.** Pregunta seguido a cada destino si está sano, y deja de mandarle tráfico al que no contesta. Lo ves en la sección de health checks.

En C01, la puerta es un **ALB** (*Application Load Balancer*), el balanceador de AWS que entiende HTTP. No es una máquina que tú administras: AWS lo corre en varias máquinas, con presencia en las dos zonas de C01, y lo cobra por hora y por tráfico. Cuesta poco tiempo: la Ronda (M03) le pone de 1 a 3 ms a la request típica (el [[percentil|p50]]), con las conexiones ya abiertas. Y conviene aun con una sola copia detrás: da el cifrado en un solo lugar, los health checks y un punto estable para cambiar lo de atrás sin tocar a quien llama.

:::diagrama balanceo-alba
La entrada de C01, de afuera hacia adentro. Toca cada caja para ver por qué está ahí y usa «Recorrer» para seguir una request normal, un pod que se cuelga y un cliente que se pasa de su cuota.
:::

Ojo con la «puerta única»: el balanceador está **en serie** con todo lo demás. Si falla, falla todo, aunque haya 12 gateways sanos detrás. Por eso un balanceador serio nunca es una sola máquina. Y aun así, en «Probabilidad para sistemas que fallan» viste que pone 4 de los 5 minutos de falla que se esperan al mes en toda la cadena de C01: su 99.99 % es la única pieza que entra a la cuenta sin una copia en paralelo.

### L4 y L7: lo que ve cada balanceador

En «Cómo viaja un mensaje» viste que un mensaje viaja en [[capas-red|capas]], como un sobre dentro de otro, y que las capas se numeran del 1 al 7 según un modelo de referencia. Aquí importan tres:

- **Capas 3 y 4, red y transporte.** Las direcciones IP de origen y de destino (capa 3), el [[puerto]] y la conexión [[tcp|TCP]] o [[udp|UDP]] (capa 4). Dicen **a qué máquina y a qué programa** va el mensaje.
- **Capa 7, aplicación.** El mensaje mismo: en HTTP, el [[metodo-http|método]], la [[url|URL]], los [[header|headers]] y el [[body]]. Dice **qué se pide**.

Un balanceador se llama L4 o L7 (de *layer*, capa) según la capa más alta que lee: hasta dónde abre el sobre.

:::figura balanceo-capas
La misma request de C01, por capas. Un balanceador L4 lee solo las dos de afuera: direcciones y puertos. Un L7 descifra el HTTPS y lee la request completa: el método, la ruta, los headers y el tamaño del body.
:::

Un balanceador **L4** decide una vez por conexión. Ve llegar una conexión nueva, elige un destino y, desde ese momento, pasa todos los bytes de esa conexión al mismo destino. No sabe si por ahí viajan una request o diez mil. No puede leer la ruta ni los headers, y si el tráfico es [[https|HTTPS]], ni siquiera podría: va cifrado.

A cambio, es rápido y barato, y sirve para cualquier protocolo: HTTP, una base de datos, el video por UDP de una cámara. En AWS es el **NLB** (*Network Load Balancer*), que elige el destino de cada conexión con un *hash* de sus direcciones y sus puertos. Un hash es una cuenta que convierte unos datos en un número y que siempre da el mismo número para los mismos datos: la misma conexión, el mismo destino. El reparto dentro de Kubernetes, que hace un programa llamado kube-proxy, también es L4, y eso va a importar.

Un balanceador **L7** decide en cada request. Termina la conexión con el cliente, lee cada request HTTP completa y elige un destino **request por request**. Como la lee, puede hacer mucho más:

- Rutear por contenido: `/v1/classify` a un grupo, `/v2/classify` a otro; un header `X-Model-Arm: canary` a la versión nueva del modelo (el *canary*, que ves más adelante).
- Agregar o quitar headers, como el id de la request para seguirla en los logs.
- Contestar él mismo cuando nadie puede: un 503 si no hay destinos, un 502 si el destino cortó la conexión.
- Medir cada request: cuántas, cuánto tardó cada destino, qué [[codigo-estado|códigos]] devolvió.

Para leer HTTPS tiene que descifrarlo: tener el certificado (el archivo con el que un servidor demuestra quién es) y hacer el trabajo del cifrado. Eso se llama **terminar TLS** ([[tls|TLS]] es el cifrado de HTTPS, y tiene su lección en la fase de seguridad), y lo ves en la sección de proxies. En AWS, el L7 es el ALB; fuera de la nube, programas de código abierto que instalas tú, como NGINX, HAProxy y Envoy.

| | L4 | L7 |
|---|---|---|
| Lee | IPs, puertos, la conexión | La request HTTP completa |
| Decide | Una vez por conexión | En cada request |
| Puede rutear por | Puerto y dirección | Ruta, host, headers, cookies |
| Protocolos | Cualquiera sobre TCP o UDP | HTTP, HTTP/2, gRPC, WebSocket |
| Costo | Muy poco por byte | Más CPU por request: termina TLS y lee |
| Ejemplos | NLB de AWS, kube-proxy | ALB de AWS, NGINX, Envoy |

**Por qué importa «por conexión».** Con [[keep-alive]], una conexión TCP lleva muchas requests, una tras otra. Con [[http2|HTTP/2]] y [[grpc|gRPC]], muchas a la vez sobre la misma conexión, durante horas. Un L4 manda **todas** esas requests al destino que eligió cuando se abrió la conexión. Si hay pocas conexiones y muy largas, el reparto puede quedar muy chueco, y ningún algoritmo L4 lo arregla: el L4 no ve las requests. Es el problema de la sección de Kubernetes.

¿Cuándo eliges L4, entonces? Cuando el protocolo no es HTTP, cuando importa el costo por conexión, o cuando el cifrado debe llegar intacto hasta el servidor.

## Algoritmos: a quién le toca cada request {Algorithms: whose turn is each request}

Un [[algoritmo-balanceo|algoritmo de balanceo]] es la regla con la que el balanceador elige el destino de cada request, o de cada conexión. Los más comunes:

- **Round-robin (por turnos).** Al primero, al segundo, al tercero, y otra vez al primero. Sin memoria y sin cuentas. Es el que usan por omisión el ALB, NGINX, HAProxy y Envoy.
- **Por peso** (*weighted round-robin*). Por turnos, pero un destino con peso 3 recibe 3 requests por cada una del de peso 1. Sirve cuando las máquinas no son iguales.
- **Al azar** (*random*). Se elige un destino al azar. No necesita guardar ni un turno, y por eso lo pueden aplicar muchas máquinas a la vez sin ponerse de acuerdo. Es lo que hace kube-proxy en su modo más común.
- **Menos conexiones** (*least-connections*) o **menos requests pendientes** (*least outstanding requests*). Al destino con menos trabajo en vuelo en ese momento: requests que ya recibió y todavía no contesta. El ALB lo ofrece con ese nombre, *least outstanding requests*, como opción en vez de su round-robin (tiene un tercero, al azar con pesos, *weighted random*).
- **Dos opciones al azar** (*power of two choices*). Elige dos destinos al azar y manda la request al menos ocupado de los dos.
- **Por hash.** Una cuenta con algo de la request, como el id del usuario, que siempre da el mismo destino para el mismo valor. Es para la afinidad, y está en su propia sección.

### Por qué round-robin falla

Round-robin reparte **requests**, no **trabajo**. Si todas tardan lo mismo, es perfecto. Pero en C01 una foto de 200 KB del celular y una de 10 MB de la web no cuestan lo mismo, y en un [[llm|LLM]] una respuesta de 50 [[token|tokens]] y una de 2,000 tardan ≈ 40 veces distinto (2,000 ÷ 50), porque el modelo escribe un token tras otro. Round-robin no lo sabe, y sigue mandando su turno a la copia que se quedó atorada con la pesada.

:::cuenta Dos pods, una request pesada: round-robin contra least-connections
Llegadas // una cada 10 ms; cada pod atiende de una en una | R1 a R10, en 0, 10, … 90 ms | 10
Lo que tardan // la primera es pesada | R1: 100 ms · las otras 9: 8 ms | —
Round-robin: el pod A // le tocan las impares: la R3, R5, R7 y R9 esperan detrás de la R1 | R3 llega a los 20 y empieza a los 100 | 80 ms
Round-robin: las demás de A // cada una espera a la anterior | R5, R7 y R9 | 68, 56 y 44 ms
Round-robin: el pod B // le tocan las pares, y nunca espera | 5 × 8 ms de trabajo en 100 ms | 40 % ocupado
Least-connections // A tiene 1 en vuelo y B tiene 0: la R2 a la R10 van a B | 9 × 8 ms, al llegar | 0 ms de espera
= Con round-robin, 4 de las 9 requests ligeras esperan entre 44 y 80 ms en fila detrás de la pesada, mientras B pasa ocioso más de la mitad del tiempo. Con least-connections, ninguna espera.
:::

:::figura balanceo-rr-lc
La cuenta de arriba en el tiempo. Arriba, round-robin: la R3, la R5, la R7 y la R9 hacen fila en A (lo gris) mientras B tiene huecos. Abajo, least-connections: todo lo ligero se va a B y nadie espera.
:::

Least-connections no adivina cuánto va a tardar cada request: solo cuenta cuántas tiene cada destino sin contestar. Es suficiente, porque un destino atorado acumula requests en vuelo y deja de recibir.

:::analogia Las filas del súper
Round-robin es el súper con una fila por caja, donde a cada cliente le asignan la siguiente caja por turno. Si a la caja 1 le toca un carrito lleno, los que van detrás esperan aunque la caja 2 esté vacía. Least-connections se parece al banco con fila única: el siguiente pasa a la primera ventanilla que se libera.

**Dónde se rompe:** en el súper ves los carritos y sabes cuánto va a tardar cada quien; el balanceador no ve el tamaño del trabajo, solo cuántas requests tiene cada copia. Y una persona puede cambiarse de fila; una request ya asignada, no.
:::

:::profundo Por qué existen las dos opciones al azar
Least-connections necesita saber, en cada instante, cuántas requests tiene cada destino. Un solo balanceador que ve todo el tráfico lo sabe. Pero muchas veces son varios: cada pod del gateway reparte por su cuenta sus llamadas a Triton, y cada uno solo ve las suyas. Si todos eligen «el menos ocupado» con datos un poco viejos, todos eligen **el mismo** al mismo tiempo, y lo inundan: es el efecto manada (*herd effect*).

Las dos opciones al azar evitan la manada: cada uno sortea dos candidatos distintos y se queda con el más libre de los dos. Con muy poca información, casi nunca elige a uno atorado. La idea la estudió Michael Mitzenmacher en su tesis doctoral de 1996: con solo dos candidatos en vez de uno, la fila más larga se acorta muchísimo, y un tercer candidato ya ayuda poco más. Es lo que usa Envoy en su algoritmo *least request*: si nadie lo cambia y todos los destinos pesan igual, sortea dos.
:::

¿Y con muchas requests, no solo diez? Una simulación con 100,000 requests en 4 pods, con 1 de cada 10 pesada, mide cuánto espera cada request en fila. El [[p99]] de esa espera queda en ≈ 332 ms con round-robin, ≈ 436 ms al azar, ≈ 136 ms con least-connections y ≈ 186 ms con dos opciones al azar. Least-connections lo baja a menos de la mitad, y dos opciones queda cerca con mucha menos información.

La razón es la idea de M03: mandar cada request al menos ocupado se porta casi como **una sola fila compartida**, la del banco. Con dos servidores ocupados al 80 % y 10 ms por request (otra carga, no la de esta simulación), la espera promedio baja de 40 ms, cada uno con su fila, a ≈ 18 ms con una fila compartida. «Qué tan rápido y cuánto» explica por qué.

:::profundo La simulación, en código
Las requests llegan a 150 por segundo y al azar, como llegan las reales ([[poisson]]); 1 de cada 10 tarda 100 ms y el resto, 10. En promedio, una request tarda 0.1 × 100 + 0.9 × 10 = 19 ms, así que a 150 por segundo hay 150 × 0.019 = 2.85 pods ocupados de 4: ≈ 71 % del tiempo. El programa mide cuánto espera cada request en fila antes de que la atiendan:

```python
import random

def simular(politica, pods=4, tasa=150, n=100_000):
    rng = random.Random(7)                                # semilla: siempre la misma corrida
    libre, fines, t, esperas = [0.0] * pods, [[] for _ in range(pods)], 0.0, []
    for i in range(n):
        t += rng.expovariate(tasa)                        # 150 requests por segundo, al azar
        dur = 0.100 if rng.random() < 0.10 else 0.010     # 1 de cada 10 tarda 100 ms; el resto, 10
        vuelo = [sum(f > t for f in fines[p]) for p in range(pods)]   # requests en vuelo por pod
        if politica == "round-robin":   p = i % pods
        elif politica == "al azar":     p = rng.randrange(pods)
        elif politica == "least-conn":  p = vuelo.index(min(vuelo))
        else:                                             # dos opciones: dos al azar, el más libre
            a, b = rng.sample(range(pods), 2)
            p = a if vuelo[a] <= vuelo[b] else b
        inicio = max(t, libre[p])                         # cada pod atiende de una en una
        libre[p] = inicio + dur
        fines[p] = [f for f in fines[p] if f > t] + [libre[p]]
        esperas.append(inicio - t)
    return sorted(esperas)

for politica in ("round-robin", "al azar", "least-conn", "dos opciones"):
    e = simular(politica)
    print(f"{politica:<13} espera en fila: p50 {e[len(e)//2]*1000:4.1f} ms · p99 {e[int(len(e)*0.99)]*1000:5.1f} ms")
```

```salida
round-robin   espera en fila: p50  9.7 ms · p99 331.5 ms
al azar       espera en fila: p50 27.6 ms · p99 436.0 ms
least-conn    espera en fila: p50  0.0 ms · p99 136.2 ms
dos opciones  espera en fila: p50  3.0 ms · p99 185.8 ms
```

El tiempo es simulado, así que la salida es la misma en cualquier computadora. Al azar es lo peor porque a veces le manda varias seguidas al mismo pod, pesadas incluidas; round-robin, al menos, le da el mismo número a cada uno. Fíjate también en el p50: con least-connections, al menos la mitad de las requests no espera nada.
:::

## Proxy, proxy inverso y API gateway {Proxy, reverse proxy and API gateway}

Un [[proxy]] es un intermediario: recibe tu request y la hace por ti. La pregunta que lo define es **a nombre de quién trabaja**.

:::figura balanceo-proxys
Dos intermediarios que se ven igual y trabajan para lados distintos. El proxy, del lado de los clientes: el servidor ve al proxy y no a cada persona. El proxy inverso, del lado de los servidores: el cliente ve una sola dirección y no sabe cuántos servidores hay detrás.
:::

### El proxy, a nombre de los clientes

Un proxy «de ida» (*forward proxy*) se pone del lado de los clientes. Las computadoras de una empresa, por ejemplo, salen a internet a través de uno: el proxy decide qué sitios se permiten, guarda un registro y, a veces, una copia de lo que se pide seguido. El servidor de afuera ve la dirección del proxy, no la de cada empleado.

En ML lo vas a ver en la salida de un clúster hacia un proveedor externo de LLMs: un proxy revisa a dónde va cada request antes de que salga. Esa salida se llama [[egress]], y tiene su lección en la fase de la nube.

### El proxy inverso, a nombre de los servidores

Un [[proxy-inverso|proxy inverso]] (*reverse proxy*) se pone del lado de los servidores. Los clientes creen que hablan con el servidor, pero hablan con el proxy, que pasa cada request a alguno de los de atrás. Un balanceador L7 es un proxy inverso cuyo trabajo principal es repartir. Pero un proxy inverso hace más cosas:

- **Terminar TLS.** Es descifrar en el proxy: el certificado vive en un solo lugar y los servidores de atrás reciben HTTP simple dentro de la red privada, o cifrado otra vez si la red no es de confianza. El precio: el proxy ve todo en claro, así que es parte de lo que hay que proteger.
- **Poner límites.** Tamaño máximo del body, tiempo máximo de espera ([[timeout]]), número de conexiones.
- **Juntar la request completa** (*buffering*) antes de pasarla, para que un cliente lento no tenga ocupado al servidor. Y guardar copias de lo que se repite (*cache*).

Los más usados son NGINX, HAProxy y Envoy; los de la nube, como el ALB, hacen lo mismo como servicio.

:::ojo
El *buffering* ayuda con las fotos y estorba con el [[streaming]]. Muchos proxies inversos, si nadie lo cambia, juntan la respuesta en un buffer antes de mandarla (en NGINX, `proxy_buffering` viene encendido). Con un LLM que manda cada token apenas sale, el streaming se pierde: el usuario ve el texto a pedazos grandes, o todo de golpe al final. La Ronda (M14) lo marca como una causa típica de un [[ttft|TTFT]] malo en producción.
:::

Terminar TLS cuesta: una conexión cifrada nueva pide una o dos [[rtt|idas y vueltas]] más por la red que la de TCP, según la versión de TLS, y cuentas de criptografía. La Ronda (M03) le pone al ALB, con TLS, de 5 a 10 ms en el p99; con las conexiones ya abiertas y reutilizadas, la request típica (el p50) paga de 1 a 3 ms. Por eso los clientes mantienen sus conexiones abiertas en un [[pool-conexiones|pool de conexiones]].

### El API gateway: un proxy inverso con reglas

Un [[api-gateway|API gateway]] es un proxy inverso que conoce las reglas de la [[api]]. Antes de pasar una request, revisa:

- **Quién llama** (autenticación): una llave de la API ([[api-key]]) o un token firmado ([[jwt|JWT]]), que tienen su lección en la fase de identidad.
- **Qué puede hacer** (autorización): esta ruta, este modelo, esta versión.
- **Cuánto puede pedir**: un rate limit por cliente, en la sección que sigue.
- **A dónde va**: por ruta, por versión o por un alias, como `chat-default` → la revisión actual del modelo.
- **Cuánto usó**: cuenta requests o tokens por cliente, para cobrar o para repartir costos.

Sin un gateway, cada servicio reimplementa la autenticación y el rate limit, y cada uno a su manera. Con uno, se hace en un lugar.

### Los dos «gateway» de C01

Aquí la palabra se presta a confusión. En C01, «el gateway» es el programa en Python que recibe la foto, la valida, la decodifica, la redimensiona, la normaliza y llama a Triton. Eso no es un proxy: es un servicio con lógica de ML, el preprocesamiento. Pero ese mismo programa **también** hace trabajo de API gateway: aplica la cuota de cada cliente, rechaza bodies de más de 10 MB leyendo el header `Content-Length` antes de recibirlos y pone el límite de tiempo de toda la request.

| Pieza de C01 | Qué hace | ¿Es un API gateway? |
|---|---|---|
| ALB | Termina TLS, verifica el token, reparte con pesos | En parte: entrada, autenticación y ruteo |
| Gateway, como puerta | Cuota por cliente, tope de 10 MB, límite de tiempo | Sí: reglas de la API |
| Gateway, como preprocesador | Decodifica, redimensiona, normaliza, llama a Triton | No: es lógica de ML |
| Triton | Corre el modelo | No |

Lo de «verifica el token» lo hace el propio ALB: desde noviembre de 2025 puede revisar un token [[jwt|JWT]] (su firma, su vencimiento y lo que dice) antes de pasar la request, sin código en el gateway. Lo que el ALB no hace es contar cuánto pide cada cliente: eso queda en el gateway.

En la Ronda, cuando leas «gateway» en C01, piensa en las dos cosas. Cuando leas «API gateway» en general, piensa en la puerta: productos como Kong, Envoy Gateway o el API Gateway de AWS. Y en C10, el caso de la Ronda de un LLM que sirve a varios equipos de una empresa, el «llm-gateway» es una puerta pura: no prepara nada, pero revisa la llave de cada equipo, cobra su cuota en tokens y elige la réplica del modelo.

## Health checks: saber quién está sano {Health checks: knowing who is healthy}

El balanceador solo debe mandar tráfico a destinos que puedan contestar. Para saberlo, usa [[health-check|health checks]] (revisiones de salud), de dos tipos:

- **Activos.** El balanceador pregunta cada cierto tiempo, por ejemplo con un `GET /readyz` cada 5 s, y espera un 200 en menos de un límite. Si falla N veces seguidas, marca al destino como no sano y deja de mandarle requests. Si vuelve a contestar bien M veces seguidas, lo regresa.
- **Pasivos.** El balanceador mira las respuestas de verdad. Si un destino devuelve 5 errores seguidos, o se le vencen varias requests, lo saca un rato aunque sus preguntas de salud digan que está bien. En Envoy se llama *outlier detection* (detección del que se sale de lo normal), y 5 errores 5xx seguidos (los códigos del 500 al 599, que dicen «falló el servidor») es su umbral si nadie lo cambia.

Los dos se complementan. Un pod cuyo programa se murió, en una máquina que sigue viva, rechaza las conexiones al instante, y el chequeo pasivo lo nota en milisegundos. Uno que se **cuelga** (acepta la conexión, pero no contesta) es peor: cada request espera hasta su timeout, y el chequeo activo tarda varios periodos en sacarlo.

:::cuenta Un pod del gateway que se cuelga en el pico
Lo que le toca a cada pod // 500 requests por segundo entre 5 pods | 500 ÷ 5 | 100 por s
Tiempo para sacarlo // supón una pregunta cada 5 s y 3 fallas seguidas | 5 s × 3 | 15 s
Requests que le llegan mientras // todas se quedan colgadas hasta que quien llamó se rinde, a los 300 ms | 100 × 15 | ≈ 1,500
Con los valores por omisión de Kubernetes // cada 10 s, 3 fallas | 100 × 10 × 3 | ≈ 3,000
Parte del [[error-budget\|presupuesto de errores]] del mes // el SLO de C01 permite ≈ 300,000 requests fallidas en 30 días | 1,500 ÷ 300,000 | 0.5 %
= Un pod colgado se come 1,500 requests antes de salir, más lo que tarde la baja en llegar a cada balanceador. Un chequeo pasivo lo saca después de unos pocos errores.
:::

¿Por qué no preguntar cada segundo y sacar al primer error? Porque un chequeo demasiado sensible saca pods sanos que tuvieron un mal segundo. Los que quedan reciben más tráfico, se frenan también, fallan su chequeo… y el sistema se apaga solo, en cascada. Los umbrales son un equilibrio entre tardar en sacar a uno muerto y sacar por error a uno vivo.

### Readiness y liveness: dos preguntas distintas

Kubernetes hace sus propias preguntas a cada pod, las *probes*, y en «Programa, proceso e hilo» viste la de liveness. Son tres, y cada una tiene una consecuencia distinta:

| Probe | La pregunta | Si falla |
|---|---|---|
| Startup | «¿Ya terminaste de arrancar?» | Si nunca termina, reinicia el [[contenedor]] |
| Liveness | «¿Sigues vivo?» | Reinicia el contenedor |
| Readiness | «¿Te mando tráfico?» | Saca al pod del reparto, **sin reiniciarlo** |

La readiness es el health check del balanceo: un pod que no está listo sale de la lista de destinos y sigue vivo, esperando. C01 las separa en dos rutas. `/healthz` es la liveness: solo dice si el proceso responde y no pregunta por nadie más. `/readyz` es la readiness: da 200 solo si el modelo está cargado y listo en Triton. Y Triton, que tarda en cargar su *engine* (el modelo ya convertido para correr rápido en la T4, que viste en «CPU y GPU»), tiene una startup probe que le da hasta 5 minutos (60 intentos, cada 5 s).

El ALB, además, tiene sus propios health checks, que no son los de Kubernetes: son dos jueces distintos, con sus propios tiempos. Si nadie los cambia, el ALB pregunta cada 30 s y saca al destino tras 2 fallas, hasta un minuto; el controlador de AWS que lo arma desde Kubernetes (un programa dentro del clúster que crea y ajusta el ALB; lo ves con el Ingress) pone, por omisión, cada 15 s y 2 fallas. En C01 manda el que avise primero: si el chequeo del ALB falla, el ALB deja de mandarle; si falla la readiness, el controlador de AWS da de baja al pod en el ALB. Y ninguno dice que las respuestas sean buenas. La readiness pregunta «¿el proceso está vivo y cargó el modelo?», no «¿las predicciones son buenas?» (M11).

:::profundo Cuando todos fallan: el balanceador falla abierto
Una readiness que pregunta por una dependencia es un arma de doble filo, dice la Ronda. Si Triton se cae, **todos** los gateways fallan su `/readyz` a la vez. ¿Qué hace un balanceador sin ningún destino sano? El ALB, en ese caso, se porta de forma **abierta** ([[fail-open]]): manda el tráfico a todos los destinos de todos modos. Parece raro, pero tiene lógica: si el chequeo está mal (por ejemplo, depende de algo que se cayó para todos), apagar todo convertiría una falla parcial en una total. La lección que sigue desarrolla cuándo conviene fallar abierto y cuándo cerrado.
:::

## Rate limiting con un token bucket {Rate limiting with a token bucket}

C01 no solo atiende al backend del marketplace. También lo llaman otros equipos: moderación, por ejemplo, que revisa publicaciones en tandas. Si un programa de moderación con un error manda 3,000 requests por segundo, se come la GPU de todos, y Ana espera.

Un [[rate-limit|rate limit]] (límite de ritmo) es un tope de cuántas requests acepta el sistema de cada cliente por unidad de tiempo. Lo que pase del tope recibe al instante un **429** (*Too Many Requests*, «demasiadas requests»), con un header [[retry-after|`Retry-After`]] que dice en cuántos segundos vale la pena volver a intentar.

:::ojo
429 y 503 no son lo mismo. **429** dice «tú te pasaste de tu cuota; yo estoy bien». **503** dice «yo estoy saturado o me falta algo». Si respondes 503 cuando un cliente se pasa de su cuota, disparas tu propia alarma de disponibilidad por culpa de otro.
:::

:::profundo La ventana fija y su orilla
La manera más simple de limitar es un contador por minuto: «3,000 requests por minuto», y el contador vuelve a 0 al empezar cada minuto. Tiene un hueco en la orilla: un cliente puede mandar 3,000 a las 12:00:59 y otras 3,000 a las 12:01:00. Son 6,000 en 2 segundos, 60 veces el ritmo de 50 por segundo que esa cuota parecía prometer (M15). Un límite por minuto protege la factura del mes, no la GPU en esos dos segundos.
:::

### El token bucket

Un [[token-bucket|token bucket]] (balde de fichas) separa las dos preguntas que de verdad importan: **qué ritmo sostenido** le das a un cliente y **cuánto de golpe** le toleras.

:::pasos
1. Un balde con capacidad B
Cada cliente tiene un balde que guarda hasta B fichas. Empieza lleno.
2. Se rellena a ritmo r
Cada segundo caen r fichas nuevas, hasta que el balde se llena. Lo que sobra se tira.
3. Cada request gasta una ficha
Si hay ficha, la request pasa. Si el balde está vacío, recibe 429, y el `Retry-After` dice cuánto falta para la siguiente ficha.
:::

Así, un cliente que manda menos de r por segundo nunca recibe un 429. Uno que estuvo tranquilo puede mandar una ráfaga (*burst*) de hasta B de golpe. Y nadie sostiene más de r por segundo.

:::cuenta El equipo de moderación: 50 por segundo, con ráfagas de 100
Ritmo y balde // el ejemplo de la Ronda (M15); el balde empieza lleno | r = 50 por s · B = 100 | 100 fichas
Llega una ráfaga // un programa con un error | 300 requests en 1 s | —
Pasan con las fichas del balde | — | 100
Pasan con las que caen en ese segundo | 50 por s × 1 s | 50
Reciben 429 | 300 − 100 − 50 | ≈ 150
Tiempo para volver a llenar el balde // si se calma | 100 ÷ 50 por s | 2 s
= De 300, pasan ≈ 150 y ≈ 150 reciben 429. Ningún cliente pasa de B + r en un segundo, ni de r sostenido.
:::

:::figura balanceo-balde
Las fichas del balde de moderación durante 3 segundos. En el primero llega la ráfaga: se gastan 300 fichas por segundo y caen 50, así que el balde baja 250 por segundo y se vacía en 100 ÷ 250 = 0.4 s. De ahí en adelante, solo pasan las 50 por segundo que caen. Cuando la ráfaga para, el balde se rellena en 2 s.
:::

En código cabe en unas líneas. El balde no necesita un reloj que lo rellene: cada vez que llega una request, suma las fichas que cayeron desde la última.

```python
import math

class TokenBucket:
    def __init__(self, ritmo, capacidad):
        self.r, self.B = ritmo, capacidad        # fichas por segundo y tamaño del balde
        self.fichas, self.t = capacidad, 0.0     # empieza lleno

    def pedir(self, ahora):
        self.fichas = min(self.B, self.fichas + (ahora - self.t) * self.r)   # recarga lo que pasó
        self.t = ahora
        if self.fichas >= 1:
            self.fichas -= 1
            return 200, None                     # pasa
        falta = (1 - self.fichas) / self.r       # segundos para la siguiente ficha
        return 429, math.ceil(falta)             # Retry-After va en segundos enteros

moderacion = TokenBucket(ritmo=50, capacidad=100)
codigos = [moderacion.pedir(i / 300) for i in range(300)]          # 300 requests en 1 s
print("en el primer segundo:", sum(c == 200 for c, _ in codigos), "pasan,",
      sum(c == 429 for c, _ in codigos), "reciben 429 · Retry-After:", codigos[-1][1], "s")
codigos = [moderacion.pedir(1 + i / 50) for i in range(50)]        # luego, 50 por segundo
print("al ritmo pactado:", sum(c == 200 for c, _ in codigos), "de 50 pasan")
print("fichas tras 3 s sin pedir nada:", round(min(100, moderacion.fichas + 3 * 50)))
```

```salida
en el primer segundo: 149 pasan, 151 reciben 429 · Retry-After: 1 s
al ritmo pactado: 50 de 50 pasan
fichas tras 3 s sin pedir nada: 100
```

Salen 149 y no 150 porque la última request llega a los 0.997 s, un poquito antes de que caiga la ficha 50 de ese segundo.

:::calculadora balanceo-balde
Prueba una ráfaga de 300 en 3 segundos en vez de en 1: el ritmo de llegada baja a 100 por segundo y ya pasan 250. ¿Con qué B pasarían todas?
:::

El balde va por **identidad verificada**, no por dirección IP: muchos clientes pueden salir por la misma IP, y uno solo puede usar muchas. En C01, la identidad sale del token que el ALB ya verificó.

:::profundo Dónde vive el balde
Un balde por cliente, ¿pero en qué máquina? Si cada uno de los 5 pods del gateway tiene su propio balde, el cliente recibe en la práctica 5 veces su cuota. Hay dos salidas: dividir la cuota entre los pods, o guardar los baldes en un almacén compartido y rápido, como Redis, que es lo que hace C10. La otra opción de C01 es una regla del filtro de tráfico de AWS (WAF, *web application firewall*) junto al ALB, que cuenta las requests de cada cliente en ventanas gruesas, los últimos 1, 2, 5 o 10 minutos, y revisa la cuenta cada ≈ 10 s: protege la factura, no el segundo.

Lo de la IP compartida pasa, por ejemplo, detrás de un [[nat|NAT]], la pieza que comparte una dirección pública entre muchas máquinas. Y en C10 la cuota se cuenta en **tokens del LLM por minuto**, no en requests, porque una request de 50 tokens y una de 5,000 no cuestan lo mismo.
:::

## Dentro de Kubernetes: Service, Ingress y Gateway API {Inside Kubernetes: Service, Ingress and Gateway API}

Kubernetes, el programa de [[orquestacion|orquestación]] de C01, corre los contenedores en *pods* repartidos por un clúster: el grupo de máquinas que maneja. Cada pod recibe su propia IP, y la pierde cuando muere. ¿Cómo encuentra el gateway a Triton, si los pods de Triton van y vienen?

### El Service: una IP que no cambia

Un [[service-k8s|Service]] es un objeto de Kubernetes que le da a un grupo de pods **un nombre y una IP estables**. El gateway de C01 llama a `triton`, y el DNS del clúster lo traduce a una IP virtual, la *ClusterIP*, que no pertenece a ningún pod. El Service elige sus pods por sus etiquetas (por ejemplo, `app: triton`) y guarda la lista de sus pods, con una marca de cuáles están **listos** (los que pasan su readiness), en unos objetos llamados *EndpointSlices*. Un pod que falla su readiness queda marcado como no listo, y el reparto lo salta.

¿Quién reparte? **kube-proxy**, un programa que corre en cada máquina del clúster. No recibe las requests: le escribe al [[kernel]] de Linux unas reglas para que, cada vez que alguien abre una conexión a la ClusterIP, el kernel la reescriba hacia la IP de uno de los pods listos. En su modo más común, el de iptables (el sistema de reglas de red del kernel), elige **al azar**. Y elige **por conexión**: es L4. Nunca ve una request HTTP.

:::profundo Los otros modos de kube-proxy
kube-proxy tiene otros dos modos. El de nftables, el sucesor de iptables, es estable desde Kubernetes 1.33 (abril de 2025) y también elige al azar; el de IPVS reparte por turnos y quedó en desuso desde la 1.35. Algunos clústeres reemplazan a kube-proxy por otro programa, como Cilium. En todos los casos, el reparto de un Service sigue siendo por conexión.
:::

### Conexiones pegadas

Ahora junta las piezas. Con gRPC, cada pod del gateway abriría **una** conexión HTTP/2 a Triton y la usaría para miles de requests, durante horas. kube-proxy elige el pod de Triton una sola vez, al abrir la conexión, y ahí se queda.

:::cuenta Cinco gateways con una conexión cada uno y dos Tritons
Cada conexión elige un Triton al azar | 2 opciones por conexión, 5 conexiones: 2⁵ | 32 combinaciones
Reparto 3 y 2 // 60 % y 40 % del tráfico | 20 de 32 | 62.5 %
Reparto 4 y 1 // 80 % y 20 % | 10 de 32 | 31.25 %
Reparto 5 y 0 // un Triton con todo y el otro sin nada | 2 de 32 | 6.25 %
Llega un tercer Triton // lo acaba de crear el autoscaler porque la fila creció | conexiones nuevas: ninguna | 0 %
= El reparto queda como cayeron cinco volados, y el pod nuevo no recibe nada hasta que alguna conexión se cierre y se vuelva a abrir. La fila sigue alta, y el autoscaler pide todavía más pods que tampoco reciben tráfico.
:::

:::figura balanceo-pegadas
Arriba, el Service reparte por conexión: tres conexiones largas de los gateways caen en los dos primeros Tritons, y el tercero, recién creado, queda ocioso. Abajo, un balanceo por request: cada request elige su destino, y el tercero recibe su parte desde la primera.
:::

C01 usa HTTP entre el gateway y Triton, con un pool de varias conexiones que se renuevan, y ahí el efecto existe pero es menor. Por eso la Ronda dice que gRPC solo entra si se mide una ganancia clara, y con alguna de estas salidas:

- **Un Service *headless*** (sin cabeza: sin ClusterIP). El DNS devuelve las IPs de todos los pods, y el cliente de gRPC reparte él mismo, request por request.
- **Un balanceo L7 entre servicios**, que es lo que da un service mesh: la sección extra.
- **Una vida máxima para cada conexión** en el servidor: cada pocos minutos la cierra, y el cliente se reconecta y vuelve a sortear.

### Ingress y Gateway API: la entrada desde afuera

El Service conecta pods con pods. Para que el tráfico de **afuera** entre al clúster existe el [[ingress|Ingress]]: un objeto de Kubernetes con reglas HTTP de entrada, como «lo que llegue a `api.ejemplo.com/v1/classify`, mándalo al Service del gateway». El Ingress es solo la regla escrita. Lo aplica un **controlador** de Ingress, que es un proxy inverso de verdad, como NGINX, o un programa que configura uno de la nube. En C01, el controlador de AWS lee el Ingress del gateway y arma el ALB. Con `target-type: ip`, el ALB manda cada request directo a la IP de un pod del gateway: reparte él, por request, y kube-proxy no interviene en esa entrada.

Su sucesor es **Gateway API**, estable desde octubre de 2023, con pesos y condiciones por header ya incluidos. La documentación de Kubernetes y la Ronda (M06) dicen lo mismo: Ingress sigue funcionando, pero su API está congelada (no recibe funciones nuevas), y los diseños nuevos van con Gateway API.

:::profundo Por qué Ingress se quedó corto
El Ingress no sabe de pesos, de headers ni de otros protocolos, y cada controlador lo extendía con sus propias anotaciones (notas de configuración pegadas al objeto), distintas en cada uno. Gateway API lo reparte en varios objetos: un `Gateway` para la puerta, que maneja el equipo de la plataforma, y unas rutas, como `HTTPRoute`, que maneja cada equipo, con pesos y condiciones escritas igual para cualquier controlador. Además, el controlador comunitario ingress-nginx, uno de los más usados, se retiró: Kubernetes lo anunció en noviembre de 2025, y desde marzo de 2026 no recibe versiones nuevas ni parches de seguridad. Las instalaciones que ya existían siguen funcionando, pero sin arreglos.
:::

| Tramo de C01 | Quién reparte | Cómo |
|---|---|---|
| De afuera del clúster al gateway | El ALB, configurado por el Ingress | L7, por request, directo a las IPs de los pods |
| Gateway → Triton | kube-proxy, por el Service `triton` | L4, por conexión, al azar |
| Dentro de Triton | Su propia fila | Junta las requests en [[batch\|batches]] para la GPU |

## Ruteo por peso: el 5 % de un canary {Weighted routing: a canary's 5 %}

Hasta aquí, el balanceador trata igual a todas las copias. A veces no quieres eso: quieres mandar una parte exacta del tráfico a una versión.

Cuando sale una versión nueva del modelo, C01 no se la da a todo el mundo de golpe. Primero le manda una parte chica del tráfico, el 5 %, y vigila sus errores: es un [[canary]], y tiene su lección en la fase de despliegue. Para eso hace falta [[ruteo-por-peso|ruteo por peso]]: repartir el tráfico entre versiones según porcentajes fijados en la configuración. En el ALB, cada target group lleva un peso de 0 a 999, y cada request cae en uno u otro en proporción.

Aquí hay una trampa. Kubernetes, por sí solo, reparte por pods: si el estable tiene 2 pods de Triton y le agregas 1 del canary, el Service le manda al canary ≈ **1 de cada 3** requests, no el 5 %. Para un 5 % por pods harían falta 19 pods estables por cada canary. El porcentaje lo tiene que poner un proxy: el ALB, Gateway API o un service mesh.

:::cuenta Cuánto ve un canary al 5 %
Tráfico de C01 en el pico de un día normal // de «Números grandes»: 116 por s en promedio, × 3 en la hora pico (el de diseño, 500, lleva margen) | 116 × 3 | ≈ 350 por s
Lo que va al canary | 350 × 5 % | 17.5 por s
En una ventana de 10 minutos | 17.5 × 600 s | 10,500
Al 1 % | 350 × 1 % × 600 | 2,100
Por pods, con 2 estables y 1 canary | 1 ÷ (2 + 1) | ≈ 33 %
= Al 5 %, un modelo malo afecta a 1 de cada 20 requests, y en 10 minutos de pico ya juntas ≈ 10,000 para decidir. Repartir por pods le daría al canary casi siete veces más.
:::

:::calculadora balanceo-canary
Prueba el canary al 5 % en la madrugada, con 20 requests por segundo: ¿cuántos minutos hacen falta para juntar 10,000?
:::

Los pesos reparten **por request**: cada una tira su propio dado. Para vigilar errores y latencia, eso basta. Cuando no basta, se reparte por usuario, y eso abre la sección extra que sigue.

## Afinidad: volver a la misma copia {Affinity: returning to the same copy} [extra]

### Por request o por usuario

Con pesos por request, el mismo vendedor puede recibir una sugerencia del modelo nuevo y, en su siguiente foto, una del viejo. Si lo que mides es si los vendedores aceptan las sugerencias, o si es una conversación con un LLM, quieres que cada quien se quede de un lado. Para eso se reparte con un **hash** de un id estable: una cuenta que convierte el id en un número y que siempre da el mismo número para el mismo id.

```python
import hashlib, random

def brazo(vendedor, porcentaje=5):
    h = int(hashlib.sha256(vendedor.encode()).hexdigest(), 16)   # el mismo id, el mismo número
    return "canary" if h % 100 < porcentaje else "estable"

rng = random.Random(3)
al_azar = ["canary" if rng.random() < 0.05 else "estable" for _ in range(10)]
print("al azar, 10 requests del mismo vendedor:", al_azar.count("canary"), "al canary y",
      al_azar.count("estable"), "al estable")
for v in ("v-1042", "v-1050"):
    print(f"con hash, 10 requests de {v}: todas a", set(brazo(v) for _ in range(10)))
vendedores = [f"v-{i}" for i in range(10_000)]
print(f"de 10,000 vendedores, en el canary: {sum(brazo(v) == 'canary' for v in vendedores) / 100:.1f} %")
```

```salida
al azar, 10 requests del mismo vendedor: 1 al canary y 9 al estable
con hash, 10 requests de v-1042: todas a {'estable'}
con hash, 10 requests de v-1050: todas a {'canary'}
de 10,000 vendedores, en el canary: 5.0 %
```

Se usa `hashlib` y no la función `hash()` de Python a propósito: para textos, `hash()` cambia cada vez que arranca el proceso, y dos pods del gateway mandarían al mismo vendedor a lados distintos.

### Sticky sessions

Una [[sticky-session|sticky session]] (sesión pegajosa), o afinidad, es mandar todas las requests de un mismo cliente o sesión a la misma copia. Hay tres maneras comunes:

- **Una [[cookie]] del balanceador.** En la primera respuesta, el balanceador agrega una cookie que dice a qué destino tocó; el navegador la manda de vuelta y el balanceador la respeta. El ALB lo hace así, con una cookie cifrada que se llama `AWSALB`, y su documentación lo advierte: el cliente tiene que guardar cookies. Pero un programa que llama a otro, como el backend de C01, normalmente no guarda cookies: ahí no sirve.
- **Un hash de la IP de origen.** Simple y frágil: muchos clientes detrás de una misma IP caen juntos.
- **Un hash de un id** que venga en la request: el usuario, la conversación, la cámara.

¿Cuándo vale la pena? Cuando la copia guarda en su memoria algo caro de rehacer. En un LLM, es el [[kv-cache|KV cache]]: lo que el modelo ya calculó de una conversación. Si el siguiente mensaje de esa conversación cae en otra réplica, todo eso se recalcula desde cero. C10 tiene 16 réplicas: repartido al azar, el siguiente mensaje cae en la réplica que ya tiene su prefijo guardado ([[prefix-caching]]) ≈ 1 de cada 16 veces, el 6.25 %. Con afinidad por conversación, casi siempre. En C02, el video en tiempo real de las cámaras de un centro de distribución, cada cámara se asigna a una GPU, porque seguir a una persona de un [[frame]] al siguiente necesita estado: se balancea por stream, no por request.

La afinidad tiene costos. Un cliente pesado pegado a una copia la satura mientras las demás descansan; si esa copia muere, se pierde su estado; y una copia nueva recibe poco, porque todos ya tienen la suya. Por eso C10 usa una regla mixta: afinidad por conversación **si hay lugar**, y si no, la réplica con menos requests en vuelo. Lo mejor, cuando se puede, es no necesitarla: copias sin estado, como el gateway de C01.

## Service mesh, sidecar y CDN {Service mesh, sidecar and CDN} [extra]

### El sidecar: un ayudante en el mismo pod

Un pod puede tener más de un contenedor. Un [[sidecar]] es un contenedor auxiliar que corre junto al principal, en el mismo pod, y comparte su red: los dos se hablan por [[localhost]]. El nombre viene del carrito lateral de una motocicleta. Se usa para lo que no es el trabajo del programa pero tiene que estar a su lado: mandar los logs, renovar certificados, o meter un proxy en medio de todo su tráfico.

### El service mesh: un proxy junto a cada servicio

Un [[service-mesh|service mesh]] (malla de servicios) pone un proxy, casi siempre como sidecar, junto a **cada** pod del sistema. Ese proxy intercepta todo lo que entra al pod y todo lo que sale. Un *plano de control* (en Istio, un programa llamado istiod) le reparte a todos esos proxies su configuración y sus certificados. Los más conocidos son Istio, que usa Envoy como proxy, y Linkerd, que usa uno propio.

Lo valioso es lo que da **sin tocar el código** de los servicios:

- **Cifrado y identidad entre servicios** ([[mtls|mTLS]]: TLS con certificado de los dos lados, en la fase de seguridad). Cada servicio demuestra quién es, y nadie en la red interna puede leer ni hacerse pasar por otro.
- **Balanceo L7 entre servicios.** El sidecar del gateway reparte request por request entre los Tritons, y las conexiones pegadas desaparecen.
- **Reintentos, timeouts y circuit breakers** ([[reintento]] y [[circuit-breaker]], en la lección que sigue), configurados en un lugar.
- **Métricas de cada request** entre cada par de servicios: cuántas, cuánto tardaron, qué códigos.
- **Pesos y copias de tráfico** para canaries y para el *shadow*: mandar una copia de requests reales a la versión nueva y tirar su respuesta.

:::diagrama balanceo-mesh
Dos pods de C01 dentro de una malla. Toca cada caja y usa «Recorrer» para seguir una request entre sidecars y un cambio de pesos que llega desde el plano de control.
:::

El precio es real. Cada llamada pasa por **dos** proxies más (el del que llama y el del que recibe), y cada uno suma un poco de latencia y de CPU. Cada pod carga un contenedor más con su memoria. Y hay una pieza más que entender cuando algo falla: si el mesh hace hasta 3 intentos por llamada y el código también, una falla se vuelve 3 × 3 = 9 llamadas. Istio ofrece además un modo sin sidecars, el *ambient mode*, estable desde Istio 1.24 (noviembre de 2024): un proxy por máquina, ztunnel, para el cifrado, y proxies L7, los *waypoints*, solo donde se piden. Ojo: sin un waypoint, ztunnel trabaja en L4, y el reparto vuelve a ser por conexión.

¿Lo necesita C01? Con dos servicios, un mesh es mucha maquinaria: la Ronda lo pone como una de tres salidas para el balanceo de gRPC, junto al Service headless y la vida máxima de conexión. En un sistema de decenas de servicios y varios equipos, que exige cifrado entre todos, el mesh se paga solo.

### La CDN, de pasada

Una [[cdn|CDN]] (*content delivery network*, red de entrega de contenido) es una red de servidores repartidos por el mundo que guardan copias de contenido y lo entregan desde el más cercano al usuario. Es un proxy inverso con cache, puesto en el borde de internet. Si un archivo vive en Virginia y Ana está en Monterrey, cada ida y vuelta cruza miles de kilómetros; con una copia en una ciudad cercana, el viaje se acorta a una fracción.

Sirve para lo **público y repetido**: las fotos de las publicaciones que ve todo el mundo, el código de la página, los videos, el archivo de un modelo que se descarga una app. No sirve para la request de clasificación de C01: cada foto es nueva, es privada y su respuesta depende de ella. De paso, la CDN aguanta picos y ataques de tráfico lejos de tus servidores.

## Errores comunes {Common mistakes}

### 1. Creer que el Service reparte requests

El Service de Kubernetes reparte **conexiones**. Con gRPC o con pocas conexiones largas, unos pods se llenan, otros quedan ociosos y los pods nuevos del autoscaler no reciben nada.

**Cómo evitarlo:** mide las requests por pod, no solo el total. Si las conexiones son largas, usa balanceo L7 (un mesh o un proxy), un Service headless con balanceo en el cliente, o una vida máxima de conexión.

### 2. Round-robin con requests que tardan muy distinto

Todos reciben las mismas requests, pero no el mismo trabajo, y la fila crece detrás de la copia que se atoró.

**Cómo evitarlo:** least outstanding requests en el ALB, *least request* en Envoy o dos opciones al azar. En LLMs, nunca round-robin.

### 3. Una liveness que pregunta por otros

Si la liveness del gateway revisa a Triton, cuando Triton cae el kubelet (el agente de Kubernetes en cada máquina) reinicia gateways sanos, que no arreglan nada.

**Cómo evitarlo:** la liveness solo pregunta si el proceso responde. Las dependencias van en la readiness (sabiendo que, si todos fallan a la vez, el ALB falla abierto) o en las respuestas: un 503 con `Retry-After`.

### 4. Un rate limit por pod, por IP o con 503

Cinco pods con su propio balde dan cinco veces la cuota. Una IP compartida castiga a muchos por uno. Un 503 por cuota dispara tu alarma de disponibilidad.

**Cómo evitarlo:** el balde por identidad verificada, en un almacén compartido o dividido entre los pods, y 429 con `Retry-After`.

### 5. Hacer el canary con el número de pods

Uno de tres pods es 33 %, no 5 %.

**Cómo evitarlo:** que el porcentaje lo ponga un proxy con pesos (ALB, Gateway API, mesh), y un canary con su propio Service.

### 6. El keep-alive del servidor más corto que el del balanceador

El ALB cierra las conexiones que pasan 60 s sin tráfico. Si el servidor de atrás las cierra antes, el ALB a veces manda una request por una conexión que el servidor acaba de cerrar, y el cliente recibe un 502 que nadie entiende.

**Cómo evitarlo:** que el servidor espere más que el balanceador, como recomienda AWS. uvicorn, si nadie lo cambia, cierra a los 5 s; el gateway de C01 lo corre con `--timeout-keep-alive 75`, más que los 60 del ALB.

## En la vida real {In real life} [extra]

### C01: la request de Ana, intermediario por intermediario

La request del backend llega al ALB, que termina TLS y verifica el token del cliente. Su regla de pesos decide: el 95 % al gateway estable, el 5 % al canary, si hay uno en curso. Dentro del grupo elegido, el ALB manda la request directo a la IP de un pod del gateway listo. El gateway revisa el balde de ese cliente, el tamaño del body y el tiempo que queda, prepara la foto y llama al Service `triton`, donde kube-proxy ya había elegido un pod cuando se abrió la conexión. Triton junta la foto con otras en un batch y responde. En el camino hubo tres repartos (los pesos del ALB, el ALB entre los gateways y el Service entre los Tritons), cada uno con su propia lista de destinos sanos.

La puerta también se paga, y no es barata. Los precios de abajo son los de AWS en Virginia (us-east-1), consultados en noviembre de 2026; cambian por región y con el tiempo:

:::cuenta Lo que cuesta el ALB de C01 (M13)
Bytes que pasan // ≈ 10 M fotos al día de ≈ 200 KB, durante ≈ 30.4 días | 10 M × 200 KB × 30.4 | ≈ 61 TB
LCU en promedio // el ALB cobra por «LCU» (*Load Balancer Capacity Unit*, unidad de capacidad), y cada hora cuenta la medida más alta (conexiones nuevas, conexiones abiertas, bytes o reglas); con fotos, mandan los bytes: 1 LCU es 1 GB por hora | 61 TB ÷ 730 h ≈ 83 GB por hora | ≈ 83 LCU
Costo de las LCU | 83 × US$0.008 × 730 h | ≈ US$485
Cargo fijo por hora, en un mes | US$0.0225 × 730 h | ≈ US$16
= ≈ US$500 al mes: casi un 30 % de la infraestructura de C01, más que cualquier otra pieza salvo las GPUs. Por el balanceador pasan las fotos completas, y se cobra por byte.
:::

Por eso la Ronda anota una salida: si el p99 lo aguanta, mandar una referencia a la foto (su ubicación en el almacenamiento de archivos) en vez de los bytes.

### C10: un llm-gateway que decide todo

El LLM de C10 sirve a varios equipos de una empresa. Sus 4 réplicas del gateway revisan la llave de cada equipo, cobran su cuota de un token bucket en tokens por minuto (en un almacén compartido, como Redis, para que las 4 vean el mismo balde), separan lo interactivo de los trabajos en tanda y resuelven el alias `chat-default` a la revisión actual del modelo. Después eligen una de las 16 réplicas de vLLM, el programa que sirve el modelo: la que ya tiene esa conversación, si tiene lugar, y si no, la que tiene menos requests en vuelo. Su canary va por hash del usuario, para que una conversación no cambie de modelo a la mitad. Y un equipo que se pasa recibe 429 él solo, sin tumbar a los demás.

### C02 y C13: repartir lo que tiene estado

En C02, cada cámara de un centro de distribución tiene su GPU asignada: seguir a alguien entre frames necesita la memoria de los frames anteriores, así que se reparte por stream. En C13, la transcripción de audio, los trabajos van a workers, y para no mandar todo al mismo en el mismo segundo la Ronda usa dos opciones al azar.

### Fuera de ML

- **El banco y el súper.** La fila única con «pase a la ventanilla 4» es least-connections hecho con personas; las filas separadas del súper son round-robin.
- **Un conmutador telefónico** reparte las llamadas al agente libre, y si todos están ocupados, te pone en espera: es el balanceador con su fila.
- **La venta de boletos de un concierto** abre una sala de espera virtual que deja pasar a cierto ritmo: un rate limit, para que la página no se caiga.
- **Netflix** pone servidores con copias de su catálogo dentro de las redes de los proveedores de internet: su propia CDN, para que la película viaje lo menos posible.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. El de token bucket y el de canary se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Un balanceador reparte 500 requests por segundo entre dos pods: uno con el doble de CPU que el otro. ¿Cuánto recibe cada uno con round-robin? ¿Y por peso, con pesos 2 y 1?
- Round-robin: **250 y 250**, sin importar el tamaño. El pod chico recibe lo mismo con la mitad de CPU.
- Por peso 2 y 1: el grande recibe 2 de cada 3: 500 × 2/3 ≈ **333**; el chico, 500 × 1/3 ≈ **167**.
- Así, los dos quedan igual de ocupados en proporción a su CPU.
? [facil] ¿L4 o L7? (a) Mandar `/v2/` a la versión nueva. (b) Repartir el video por UDP de unas cámaras. (c) Respetar la cookie de afinidad. (d) Que el cifrado llegue intacto hasta el servidor.
- (a) **L7**: hay que leer la ruta.
- (b) **L4**: no es HTTP; el L4 sirve para cualquier protocolo.
- (c) **L7**: la cookie es un header de la request.
- (d) **L4**: un L7 tendría que descifrar para leer; un L4 pasa los bytes sin abrirlos.
? [facil] ¿Qué probe falla y qué pasa? (a) Triton sigue cargando su engine. (b) El proceso del gateway se trabó y no contesta nada. (c) El gateway está bien, pero Triton no responde.
- (a) La **startup**: Kubernetes espera (hasta 5 minutos en C01) y no le manda tráfico. Si nunca termina, lo reinicia.
- (b) La **liveness**: el kubelet reinicia el contenedor. Mientras tanto, también falla la readiness y sale del reparto.
- (c) Solo la **readiness** del gateway (`/readyz`): sale del reparto sin reiniciarse. Reiniciarlo no arreglaría a Triton.
? [medio] Un token bucket da 20 fichas por segundo y guarda hasta 40. Con el balde lleno llegan 100 requests en medio segundo. ¿Cuántas pasan? ¿Cuánto tarda en llenarse otra vez?
- Pasan las del balde, **40**, más las que caen en medio segundo: 20 × 0.5 = **10**. En total, **≈ 50**; las otras ≈ 50 reciben 429.
- Para llenarse: 40 ÷ 20 = **2 s** sin pedir nada.
- Compruébalo con la calculadora: ritmo 20, balde 40, 100 requests en 0.5 s.
? [medio] El estable de C01 tiene 4 pods de Triton y quieres un canary al 5 % en el pico de diseño de 500 requests por segundo. (a) Si agregas 1 pod canary al mismo Service, ¿qué porcentaje y cuántas requests por segundo recibe? (b) ¿Y con pesos en el ALB? (c) ¿Aguanta un solo pod?
- (a) Por pods: 1 ÷ (4 + 1) = **20 %**: 500 × 0.2 = **100 por segundo**. Cuatro veces lo que querías.
- (b) Con pesos: 500 × 5 % = **25 por segundo**.
- (c) Sí: la Ronda cuenta con ≈ 1,200 imágenes por segundo por T4, y 25 le sobran. Un canary puede tener un solo pod si aguanta su parte con margen.
? [medio] Un pod del gateway, con 100 requests por segundo, se cuelga. Su readiness usa los valores de Kubernetes si nadie los cambia: cada 10 s, 3 fallas. ¿Cuántas requests se pierden antes de que salga? ¿Y con cada 5 s y 2 fallas? ¿Qué arriesgas al bajarlo?
- Por omisión: 10 × 3 = 30 s, y 100 × 30 = **3,000 requests**.
- Con 5 s y 2: 10 s, **1,000 requests**.
- Lo que arriesgas: sacar pods sanos que tuvieron un mal momento, cargar más a los demás y causar una cascada. Por eso se combina con un chequeo pasivo.
? [medio] Tres pods del gateway abren una conexión gRPC cada uno al Service de Triton, que tiene 2 pods. (a) ¿Qué tan probable es que un Triton se quede sin tráfico? (b) El autoscaler agrega un tercero: ¿qué recibe? (c) Con una vida máxima de conexión, cada conexión se cierra y se vuelve a abrir: ¿cuántas conexiones espera tener el nuevo después?
- (a) Cada conexión elige al azar entre 2: hay 2³ = 8 combinaciones, y en 2 de ellas las 3 caen en el mismo. **2 ÷ 8 = 25 %**.
- (b) **Nada**: las conexiones ya están abiertas. Recibe 0 % hasta que alguna se reconecte.
- (c) Cada conexión que se reabre elige entre 3: el nuevo espera 3 × 1/3 = **1 conexión**. Con tan pocas, el reparto sigue chueco; por request, cada uno recibiría un tercio.
? [reto] Un pod del gateway de C01 se cuelga en el pico de diseño. El ALB pregunta cada 10 s y lo saca a las 2 fallas; la readiness de Kubernetes lo marca como no listo a los 15 s. (a) ¿Cuántas requests recibe antes de salir? (b) ¿Qué parte del presupuesto mensual de ≈ 300,000 fallas es? (c) ¿Cuántas requests hay colgadas en ese pod a la vez, si quien llama se rinde a los 300 ms? (d) ¿Qué agregarías?
- (a) Lo saca el primero que se entere. El chequeo del ALB tarda 10 × 2 = 20 s; la readiness, 15 s, y cuando falla, el controlador de AWS da de baja al pod en el ALB. Gana la readiness: 100 × 15 = **≈ 1,500 requests**, más los segundos que tarde la baja en llegar al ALB. Sin la readiness serían 100 × 20 = 2,000.
- (b) 1,500 ÷ 300,000 = **0.5 %** del presupuesto del mes, por un solo pod. Diez incidentes así son 5 %.
- (c) Con la [[ley-little|Ley de Little]]: 100 por segundo × 0.3 s = **30 colgadas a la vez**. Es más que `MAX_INFLIGHT = 16`, el tope que rechazaría la 17 con un 503 si el pod funcionara; pero un pod colgado no corre ni ese código, así que no rechaza nada: todas esperan.
- (d) Un chequeo pasivo: sacar al pod tras unos cuantos errores o timeouts seguidos, que a 100 por segundo se juntan en menos de un segundo. Y timeouts cortos, como los 300 ms de C01, para que ninguna espere más.
? [reto] Un cliente tiene una cuota de 3,000 requests por minuto con una ventana fija. (a) ¿Cuántas puede mandar en 2 segundos, y a qué ritmo, comparado con 50 por segundo? (b) Diseña un token bucket con el mismo ritmo sostenido que no deje pasar más de 250 en esos 2 segundos. (c) ¿Qué mide cada uno?
- (a) 3,000 al final de un minuto y 3,000 al principio del siguiente: **6,000 en 2 s**, 3,000 por segundo: **60 veces** el ritmo de 50 por segundo.
- (b) El ritmo sostenido es 3,000 ÷ 60 = **50 por segundo**. En 2 s pasan B + 50 × 2 = B + 100. Para que no pasen de 250: **B = 150**.
- (c) La ventana fija controla el total de cada minuto, para la factura. El token bucket controla el ritmo instante a instante, para la capacidad: aguanta una ráfaga de 150 y nada más.
:::

## Lo que sigue {What comes next} [extra]

**En la Ronda:**

- **M03 · Latencia y capacidad** le pone de 1 a 3 ms al ALB en el presupuesto de la request y explica por qué *least outstanding requests* se porta como una fila compartida, y el reparto al azar de un Service, como filas separadas.
- **M06 · Orquestación y escalado** usa las probes, el Service, el Ingress y Gateway API, y las conexiones pegadas cuando se agrega un pod de Triton.
- **M11 · Despliegue seguro** reparte el canary con pesos en el ALB, explica por qué un pod de tres no es un 5 % y usa el hash de un id para un A/B por vendedor.
- También: **M07** (gRPC y el balanceo por conexión), **M13** (la factura del ALB), **M14** (el llm-gateway y la afinidad) y **M15** (el token bucket, 429 contra 503).

**En el Dojo:** cuando abran, la estación 6, «Código de serving», escribe `/healthz`, `/readyz` y la cuota del gateway; la 9, «Kubernetes», el Service, el Ingress y las probes, y la 10, «Rollout seguro», el canary con pesos.

**En Sensei:** la siguiente lección, «Timeouts, reintentos e idempotencia», sigue con lo que pasa cuando un destino no contesta: cuánto esperar, cuándo reintentar y cuándo cortar. Después, «Qué tan rápido y cuánto» explica por qué una fila compartida espera menos. Más adelante vienen TLS y mTLS, en la fase de seguridad, y los tokens con los que el gateway sabe quién llama, en la de identidad.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
balanceador algoritmo-balanceo proxy proxy-inverso api-gateway ingress service-k8s health-check rate-limit token-bucket sticky-session service-mesh sidecar cdn ruteo-por-peso
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué diferencia a un balanceador L4 de uno L7?
El L4 ve direcciones y puertos y decide una vez por conexión. El L7 lee cada request HTTP (ruta, headers, body) y decide en cada una; para eso termina TLS.
? ¿Por qué round-robin falla cuando las requests tardan distinto?
Reparte requests, no trabajo: sigue mandando su turno a la copia atorada con una pesada, y la fila crece ahí mientras otra está libre. Least-connections mira cuántas tiene cada una en vuelo.
? ¿En qué se diferencian la readiness y la liveness?
La readiness pregunta «¿te mando tráfico?» y, si falla, saca al pod del reparto sin reiniciarlo. La liveness pregunta «¿sigues vivo?» y, si falla, lo reinicia. Las dependencias van en la readiness.
? Un token bucket da 50 fichas por segundo y guarda 100. ¿Cuántas pasan de 300 requests en un segundo?
≈ 150: las 100 del balde y las 50 que caen en ese segundo. Las otras ≈ 150 reciben 429 con Retry-After.
? ¿Por qué un pod nuevo de Triton puede quedarse sin tráfico detrás de un Service?
Porque el Service reparte por conexión (L4), y con conexiones largas, como las de gRPC, las que ya existen siguen pegadas a los pods viejos hasta que se cierren.
? ¿Por qué un canary con 1 pod junto a 2 estables no recibe el 5 %?
Porque Kubernetes reparte por pods listos: le toca 1 de 3, ≈ 33 %. El 5 % lo pone un proxy con pesos: el ALB, Gateway API o un mesh.
:::
