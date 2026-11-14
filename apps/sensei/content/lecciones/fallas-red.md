---
titulo: Timeouts, reintentos e idempotencia
en: Timeouts, retries and idempotency
subtitulo: Cuánto esperar a otro servicio, cuándo volver a intentar y cómo hacerlo sin publicar dos veces ni tumbar todo con reintentos: timeouts, deadlines, backoff con jitter, idempotencia, circuit breakers y degradación, con los números de Alba.
pregunta: Cuando Triton no contesta, ¿cuánto debe esperar el gateway, cuándo vuelve a intentar y cómo evita publicar dos veces o tumbar todo con reintentos?
requisitos: http, probabilidad
---

:::idea
En la red, una llamada puede tardar de más, fallar o perderse a medio camino, y desde afuera no se distingue qué pasó. Por eso cada espera lleva un límite, cada reintento se hace con medida (pocos, en una sola capa, con esperas al azar) y solo se repite lo que es seguro repetir. Cuando una pieza de verdad falla, lo sano es rendirse rápido y dar algo más simple, no insistir hasta tumbar todo.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace en línea: recibe ≈ 2.5 millones de publicaciones al día y, para cada foto, le sugiere a quien vende la categoría, entre 500 posibles. Su sistema de clasificación está diseñado para aguantar picos de 500 requests por segundo.

Ana toca «Publicar» con la foto de sus tenis. El backend de Alba (el programa que recibe lo que ella publica; aquí le diremos el *caller*, «el que llama») le pide la categoría al gateway, el programa del clasificador que recibe la foto. El gateway prepara la foto y se la manda a Triton, el servidor que corre la ResNet-50 en la GPU. Casi siempre, todo eso toma unos 50 ms.

Pero un día Triton se traba: la GPU se queda ocupada, o su máquina se reinicia. En ese momento el gateway tiene que decidir tres cosas, y de ellas depende que el problema se quede en un mal rato o se vuelva una caída de todo el servicio:

- **Cuánto esperar.** ¿Espera a Triton 150 ms, 5 segundos o para siempre?
- **Cuándo volver a intentar.** ¿Reintenta de inmediato, en un rato o nunca?
- **Cómo no empeorar las cosas.** Si reintenta, ¿cómo evita que la publicación de Ana salga dos veces, o que miles de reintentos juntos terminen de tumbar a Triton?

Las piezas ya las tienes: los códigos de HTTP, el await con límite de la lección de async y el reintento como réplica en el tiempo de la de probabilidad. Aquí se juntan.

## Un servicio lento es peor que uno caído: el timeout {A slow service is worse than a dead one: the timeout}

Un servicio caído falla rápido. Si no hay ningún programa escuchando en su [[puerto]], la conexión se rechaza en un milisegundo y el gateway pasa a su plan B. Un servicio **lento** no avisa nada: la request se queda esperando, y mientras espera ocupa cosas. Memoria para la foto, una conexión abierta, uno de los 16 lugares que el gateway de Alba reserva para requests en vuelo, las que ya entraron y todavía no terminan (su `MAX_INFLIGHT`). De ahí la frase que le da título a esta sección: un servicio lento es peor que uno caído.

Un [[timeout]] es el tiempo máximo que un programa espera algo antes de rendirse. Cuando vence, el programa deja de esperar, cancela la operación y la trata como una falla. Sin timeout, la espera no tiene fin. Y no es un caso raro: en Python, la biblioteca `requests` no trae ninguno si no se lo pones, así que una llamada puede quedarse colgada para siempre.

### Tres relojes en una sola llamada

Una llamada por la red pasa por etapas, y cada una se puede trabar de forma distinta. Por eso las bibliotecas suelen tener más de un timeout:

- **Timeout de conexión** (*connect timeout*): cuánto esperar a que la otra máquina acepte la conexión, el saludo inicial de [[tcp|TCP]] que viste como [[handshake]]. Dentro de un mismo centro de datos ese saludo toma menos de un milisegundo, así que este reloj puede ser corto. Si vence, la request nunca llegó.
- **Timeout de lectura** (*read timeout*): ya conectado, cuánto esperar a que llegue el siguiente pedazo de la respuesta. Ojo: en muchas bibliotecas cuenta el silencio **entre** pedazos, no el total. Un servidor que manda un byte cada 9 segundos nunca dispara un timeout de lectura de 10 s.
- **Timeout total**: el tope de la llamada completa, de principio a fin. Es el que le importa a quien espera, y el único que acota de verdad cuánto dura todo.

:::figura fallas-red-relojes
Una llamada del gateway a Triton, de izquierda a derecha en el tiempo. El reloj de conexión solo cuida el saludo; el de lectura se reinicia con cada pedazo que llega; el total cubre todo. Una respuesta que llega a goteo puede burlar al de lectura, pero no al total.
:::

### Lo que cuesta esperar de más

La [[ley-little|Ley de Little]] dice cuántas requests hay adentro en promedio: las que llegan por segundo por lo que tarda cada una. Un timeout acota lo que tarda cada una cuando la pieza de abajo se traba, y con eso acota cuántas se juntan. En la lección de async lo contaste: a 500 por segundo, con Triton trabado, un timeout de 150 ms deja 75 llamadas colgadas, y uno de 5 s, 2,500. Ahora mira qué hace eso con los 16 lugares de cada pod (cada una de las 5 copias del gateway en Kubernetes, en el pico de 500 por segundo). Cuando están llenos, la siguiente request recibe un 503, el código de «estoy saturado». Estas son las cuentas, con sus letras:

:::formula Requests en vuelo en un pod, con Triton trabado
L = λ × W
W = w + t_{llamada}
X = frac{M}{W}
f = 1 − frac{X}{λ}
- λ: la letra griega lambda: las requests por segundo que llegan a lo que estés mirando. Al servicio entero, 500; a cada uno de sus 5 pods, 500 ÷ 5 = 100
- w: lo que tarda el resto del trabajo de la request, sin contar a Triton, en s (≈ 40 ms = 0.04 s)
- t_{llamada}: el timeout de la llamada del gateway a Triton, en s. Con Triton trabado, cada request lo espera completo
- W: lo que dura cada request, en s
- L: cuántas requests hay en vuelo en promedio. Es la Ley de Little
- M: los lugares para requests en vuelo que tiene cada pod (`MAX_INFLIGHT` = 16)
- X: lo más que despacha el pod, en requests por segundo, si cada lugar se libera a los \(W\) segundos
- f: la fracción que se rechaza al instante con un 503, cuando llegan más de las que despacha (\(λ\) mayor que \(X\))
:::

:::cuenta Triton trabado, en uno de los 5 pods del gateway
Requests que le llegan a cada pod, \(λ\) // 500 por segundo entre 5 pods | 500 ÷ 5 | 100/s
Resto del trabajo, \(w\) // los ≈ 50 ms de siempre, menos los ≈ 10 que tarda Triton | 50 − 10 | 40 ms
Con timeout \(t_{llamada}\) = 150 ms, lo que dura cada request, \(W\) | \(W = w + t_{llamada}\) = 40 + 150 | 190 ms
En vuelo por pod, \(L\) // el pod tiene \(M\) = 16 lugares | \(L = λ × W\) = 100 × 0.19 s | 19
Lo más que despacha el pod, \(X\) // cada lugar se libera a los 190 ms | \(X = M ÷ W\) = 16 ÷ 0.19 s | ≈ 84/s
Rechazadas al instante con 503, \(f\) | \(f = 1 − X ÷ λ\) = 1 − 84 ÷ 100 | ≈ 16 %
Con timeout \(t_{llamada}\) = 5 s: \(W\) | \(W = w + t_{llamada}\) = 0.04 + 5 | 5.04 s
En vuelo por pod, \(L\) // pero solo hay 16 lugares | 100 × 5.04 s | 504
Lo más que despacha el pod, \(X\) | 16 ÷ 5.04 s | ≈ 3.2/s
Rechazadas al instante con 503, \(f\) | 1 − 3.2 ÷ 100 | ≈ 97 %
= Con 150 ms, todas reciben su respuesta antes de los 300 ms del caller: 84 de cada 100, un 504 a los ≈ 190 ms, y las otras 16, un 503 al instante. El caller muestra el selector de categorías. Con 5 s, 97 de cada 100 se rechazan y las 3 que entran esperan 5 s una respuesta que nadie va a leer, porque el caller se fue a los 300 ms.
:::

Con 150 ms no caben todas: 19 en vuelo contra 16 lugares, como contaste en la lección de async, y ≈ 16 % recibe un 503. No es una falla del diseño: es el tope haciendo su trabajo, porque cada request recibe su respuesta a tiempo y el caller pasa a su plan B. Sin el tope de 16, con el timeout de 5 s, sería mucho peor: 504 fotos de hasta 10 MB son hasta 5 GB, en un pod de 1 GiB.

:::profundo Los timeouts que traen las bibliotecas
Cada biblioteca trae su propio valor por omisión, y casi nunca es el que quieres. Estos son los que documenta cada una en 2026. `requests` no trae ninguno: sin timeout, espera para siempre. `httpx`, otra biblioteca de Python, trae 5 segundos para cada etapa (conectar, mandar, leer cada pedazo). `aiohttp`, otra pensada para async, trae un total de 5 minutos. Un servidor intermedio, como un [[balanceador]], suele cortar las conexiones que pasan cierto tiempo sin actividad: el balanceador de aplicaciones de AWS (ALB, en la nube de Amazon), a los 60 s por omisión. Ninguno de esos números sabe que tu caller se rinde a los 300 ms. Por eso la regla es que cada llamada que sale de tu programa lleve un timeout explícito, escrito en el código o en la configuración (en Alba, `INFER_TIMEOUT_S=0.15`: 150 ms hacia Triton).
:::

## El deadline: el tiempo que queda viaja con la request {The deadline: the time left travels with the request}

Ponerle un timeout a cada llamada no basta: hay que elegirlos bien. Si el caller espera 300 ms y el gateway le da 5 s a Triton, cuando Triton se traba el gateway sigue esperando mucho después de que el caller se fue.

La solución es pensar en un [[deadline]] (fecha límite): el **momento** en que la request entera deja de importar, no una duración por salto. Cada salto calcula cuánto le queda y espera como máximo eso:

:::formula Timeout de una llamada
t_{llamada} = min(t_{tope}, D − g)
- t_{tope}: el tope propio de la llamada, en ms (150 para la llamada a Triton)
- D: el deadline de quien hace la llamada, en ms, contado desde que le llegó la request (250 en el gateway)
- g: lo que la request ya gastó antes de esta llamada, en ms
- D − g: lo que queda del deadline
- t_{llamada}: el timeout que le toca a esta llamada, en ms: el más chico de los dos
:::

Así, ningún salto espera más de lo que le queda a quien lo llamó. Dicho como regla: cada capa se rinde antes que la de arriba.

### La cadena de Alba

En la lección de async viste la cadena de Alba: «300 → 250 → 150 → 100 ms». Ahora puedes leer por qué tiene cada número:

- **300 ms, el caller.** El backend de Alba se rinde a los 300 ms y muestra el selector de categorías. Es el techo de todo lo demás.
- **250 ms, el deadline del gateway.** El gateway se rinde 50 ms antes que el caller. Esos 50 ms le alcanzan para contestar un 504 (*Gateway Timeout*, «se me acabó el tiempo esperando al de atrás») antes de que el caller abandone.
- **150 ms, la llamada a Triton.** Es el tope de esa llamada. Lo que sobra de los 250 se usa para recibir y preparar la foto antes, y para contestar después.
- **100 ms, la fila de Triton.** Triton rechaza lo que lleva más de 100 ms esperando su turno, con su política de fila `REJECT`, porque ya no llegaría a tiempo.

:::diagrama fallas-red-deadline
Toca cada caja para ver su reloj. «Un día normal» recorre la request de Ana en ≈ 50 ms; «Triton se traba» muestra quién se rinde primero y qué ve Ana.
:::

:::cuenta Cuánto le queda a la llamada a Triton
Deadline del gateway, \(D\) // empieza cuando llega la request | — | 250 ms
Tope de la llamada a Triton, \(t_{tope}\) | — | 150 ms
Un día normal: lo ya gastado, \(g\) // recibir y preparar la foto; un supuesto para el ejemplo | — | 20 ms
Lo que queda, \(D − g\) | 250 − 20 | 230 ms
Timeout de la llamada, \(t_{llamada}\) | \(min(t_{tope}, D − g)\) = min(150, 230) | 150 ms
Una foto pesada: lo ya gastado, \(g\) // tardó en subir y decodificar | — | 140 ms
Lo que queda, \(D − g\) | 250 − 140 | 110 ms
Timeout de la llamada, \(t_{llamada}\) | min(150, 110) | 110 ms
Si Triton agotó sus 150 ms y se quisiera reintentar // día normal: \(g\) = 20, más los 150 de la primera llamada | \(D − g − t_{llamada}\) = 250 − 20 − 150 | quedan 80 ms
= El tope de 150 ms se recorta cuando la request ya gastó tiempo. Y después de un timeout, a un segundo intento le quedan ≈ 80 ms, menos de lo que no le alcanzó al primero.
:::

### El trabajo zombi

¿Qué pasa si un salto espera más que el de arriba? Que trabaja para nadie. Si el caller ya se rindió y Triton sigue calculando, la GPU gasta tiempo en una respuesta que nadie va a leer. A eso se le llama **trabajo zombi**, y en una sobrecarga es justo lo que no sobra: cada lugar de la fila ocupado por un zombi es una request viva que no entra.

Por eso, cuando un salto se rinde, conviene que **cancele** hacia abajo: cerrar la conexión o mandar un aviso para que el de atrás deje de trabajar. Es la misma cancelación de `asyncio.wait_for` de la lección de async. En los LLMs importa todavía más: si la cancelación no llega, la GPU sigue generando tokens para nadie.

:::profundo Cómo viaja el deadline de una máquina a otra
Con [[grpc|gRPC]], el deadline viaja solo: la biblioteca lo manda en cada llamada, en un [[header]] llamado `grpc-timeout` (por ejemplo, `grpc-timeout: 190m`, 190 milisegundos), y el servidor sabe cuánto le queda. Con HTTP lo haces tú. Al llegar la request, el gateway anota «termino a más tardar en 250 ms» y, antes de cada llamada, calcula lo que queda.

Un detalle: entre máquinas se manda **lo que queda** (una duración, como «190 ms»), no la hora límite. Los relojes de dos máquinas nunca marcan exactamente lo mismo, y un desfase de unos milisegundos ya rompería un deadline de 250. Dentro de la misma máquina se mide con un reloj monótono, uno que solo avanza (en Python, `time.monotonic()`), no con la hora del día, que puede brincar si el sistema la corrige.
:::

## Reintentar: cuándo sí y cuándo no {Retrying: when yes and when no}

Un [[reintento]] (*retry*) es volver a mandar una request que falló, con la esperanza de que la segunda vez salga bien. Funciona cuando la falla es **pasajera** (*transient*): un pod que se estaba reiniciando, una conexión que se cayó, un servidor saturado unos segundos. No sirve cuando la falla es **permanente**: si la request está mal hecha, repetirla da el mismo error.

En la lección de probabilidad lo contaste como una réplica en el tiempo: si cada intento falla el 1 % de las veces, por su lado, dos fallan juntos el 0.01 × 0.01 = 0.01 %. La letra chica es «por su lado». Si falló porque el servidor está caído o saturado, el segundo intento lo encuentra igual.

### Qué dice cada falla

Cada respuesta HTTP trae un [[codigo-estado|código de estado]] de tres cifras. Los que empiezan con 4 dicen «el problema es tu request»; los que empiezan con 5, «el problema es mío». Eso ya decide mucho:

| Lo que pasó | Qué quiere decir | ¿Reintentar? |
|---|---|---|
| Conexión rechazada | No había nadie escuchando: el pod se reinicia | Sí, mejor contra otra réplica. La request nunca llegó, así que repetirla es seguro |
| 503 *Service Unavailable* | «Estoy saturado o todavía no estoy listo» | Sí, después de esperar, y respetando [[retry-after\|Retry-After]] si viene |
| 429 *Too Many Requests* | «Pasaste tu límite de requests» | Sí, más despacio, respetando Retry-After |
| 500 *Internal Server Error* | Algo se rompió adentro del servidor | Como mucho una vez: a veces es pasajero, a veces un error del código que falla siempre |
| Timeout o 504 | Se acabó el tiempo: casi siempre, el de atrás está lento | Con mucho cuidado: suele ser saturación, y la operación pudo haberse hecho |
| 400, 413, 415, 422 | La request está mal: mal formada, demasiado grande, de un tipo que no acepta o con datos inválidos | Nunca: va a fallar igual |
| 401, 403 | Falta identificarse, o no hay permiso | No, hasta arreglar la credencial |

### El problema del timeout

Fíjate en la fila del timeout. Cuando una llamada vence, desde afuera no sabes cuál de estas tres cosas pasó:

1. La request **nunca llegó**.
2. Llegó y el servidor **sigue trabajando**, lento.
3. El servidor **ya la hizo** y lo que se perdió fue la respuesta.

Las tres se ven igual: silencio. En el caso 3, reintentar repite algo que ya pasó. Si era clasificar una foto, no importa: sale la misma categoría. Si era publicar o cobrar, sale dos veces. Ese problema tiene solución, la idempotencia, y la ves en unas secciones.

Y en el caso 2, el reintento le suma trabajo a un servidor que ya está lento. Dicho sin rodeos: un timeout casi siempre significa «el servidor está lento», no «se perdió un paquete».

### Alba: ningún reintento en el camino interactivo

Por eso Alba decide que, en el camino de Ana, **nadie reintenta**. Tiene tres razones. Un segundo intento tendría ≈ 80 ms (lo que queda de los 250 del gateway, después de ≈ 20 de preparar la foto y los 150 del primer intento), después de que el primero no pudo con 150. Triton probablemente sigue saturado, y el reintento le duplicaría la carga a la pieza más cara. Y el plan B, el selector de categorías, es barato y bueno. Los callers *batch* (programas que mandan miles de fotos sin una persona esperando) sí reintentan una vez, con espera al azar y con un límite de reintentos, como vas a ver ahora.

## Cuánto esperar: backoff exponencial, jitter y Retry-After {How long to wait: exponential backoff, jitter and Retry-After}

Si vas a reintentar, no lo hagas de inmediato. El servidor que acaba de fallar probablemente sigue en el mismo apuro, y un reintento instantáneo le llega justo cuando menos puede.

### Duplicar la espera

El [[backoff-exponencial|backoff exponencial]] (*exponential backoff*) es esperar cada vez más entre intentos: la espera se duplica en cada reintento, hasta un tope. Con una base de 100 ms, la espera antes del reintento n es 100 × 2ⁿ ms: 200 ms antes del primero, 400 antes del segundo, 800 antes del tercero. Un tope (por ejemplo, 1 s) evita que la espera crezca sin límite.

:::formula Backoff exponencial con tope
e_n = min(c, b × 2^n)
E = e_1 + e_2 + … + e_r
- b: la base, en ms (100 en el ejemplo)
- n: el número del reintento: 1 para el primero, 2 para el segundo…
- c: el tope de cada espera, en ms (1,000 = 1 s en el ejemplo)
- e_n: la espera máxima antes del reintento \(n\), en ms
- r: cuántos reintentos se hacen
- E: la espera máxima, sumando todas, en ms. Con el *full jitter* que viene en un momento, cada espera sale al azar entre 0 y \(e_n\), y en promedio la suma es \(E ÷ 2\)
:::

¿Por qué duplicar? Porque no sabes cuánto va a durar el problema. Si es un tropiezo de un instante, el primer reintento lo resuelve rápido. Si es largo, la espera crece y los intentos se espacian, en vez de martillar al servidor diez veces por segundo.

### El problema de la manada

El backoff tiene un hueco. Imagina que 1,000 clientes fallan **en el mismo instante**, porque el servidor tuvo un tropiezo de medio segundo. Si todos usan el mismo backoff, todos vuelven a los 200 ms. Juntos. Y los que fallen vuelven a los 600 ms, otra vez juntos. Esperar no separó a nadie: solo movió la ola.

La cura es el [[jitter]]: agregarle azar a la espera. La forma más usada se llama *full jitter* (de un artículo de Marc Brooker en el blog de arquitectura de AWS, Amazon Web Services, la nube de Amazon, de 2015): en vez de esperar exactamente 100 × 2ⁿ ms, cada cliente espera un tiempo **al azar entre 0 y** 100 × 2ⁿ ms. Antes del primer reintento, entre 0 y 200 ms; antes del segundo, entre 0 y 400; antes del tercero, entre 0 y 800. En promedio se espera la mitad, y los 1,000 clientes quedan repartidos en el tiempo.

Esta simulación lo muestra. Mil clientes fallan juntos en t = 0. El servidor atiende 50 requests en cada ventana de 10 ms (5,000 por segundo) y rechaza el resto. Cada cliente reintenta hasta 3 veces:

```python
import heapq, random                         # heapq: una fila que siempre saca primero el más chico
from collections import Counter

def simular(jitter, clientes=1000, cupo=50, base=100, reintentos=3):
    rng = random.Random(7)                   # semilla fija: sale igual en cada corrida
    def espera(n):                           # reintento n = 1, 2, 3: tope de 200, 400, 800 ms
        tope = base * 2**n
        return rng.uniform(0, tope) if jitter else tope
    fila = [(espera(1), c, 1) for c in range(clientes)]   # todos fallaron en t = 0
    heapq.heapify(fila)
    llegan = Counter()                       # intentos que llegan en cada ventana de 10 ms
    atendidos = rendidos = 0
    while fila:
        t, c, n = heapq.heappop(fila)        # el siguiente intento en el tiempo
        ventana = int(t // 10)
        llegan[ventana] += 1
        if llegan[ventana] <= cupo:          # el servidor atiende 50 por ventana
            atendidos += 1
        elif n < reintentos:
            heapq.heappush(fila, (t + espera(n + 1), c, n + 1))
        else:
            rendidos += 1
    return atendidos, rendidos, max(llegan.values()), sum(llegan.values())

for jitter in (False, True):
    a, r, pico, total = simular(jitter)
    print(f"{'con' if jitter else 'sin'} jitter: {a} atendidos, {r} se rinden, "
          f"pico de {pico} en 10 ms, {total} intentos")
```

```salida
sin jitter: 150 atendidos, 850 se rinden, pico de 1000 en 10 ms, 2850 intentos
con jitter: 1000 atendidos, 0 se rinden, pico de 61 en 10 ms, 1061 intentos
```

Sin jitter, los 1,000 llegan en la misma ventana: el servidor atiende 50 y rechaza 950. Los 950 vuelven juntos, se atienden 50, y así. Al final, 850 clientes se rinden después de 2,850 intentos. Con jitter, los mismos 1,000 se reparten en unos 200 ms: el pico baja a 61 por ventana, casi todos entran al primer reintento y nadie se rinde. Mismo servidor, mismos clientes; solo cambió el azar en la espera.

:::figura fallas-red-jitter
Los reintentos de la simulación, contados en ventanas de 50 ms. Sin jitter, tres torres de 900 a 1,000 intentos, muy por encima de lo que el servidor atiende. Con jitter, cuatro ventanas cerca del cupo y luego casi nada. (El código cuenta en ventanas de 10 ms: ahí el cupo es 50 y el pico, 61.)
:::

:::calculadora fallas-red-backoff
Arranca con los números del ejemplo (\(b\) = 100 ms, \(c\) = 1 s, \(r\) = 3 reintentos) contra el deadline \(D\) = 300 ms del caller de Alba. Sube a 5 reintentos y mira cómo el tope frena el crecimiento. Después prueba una base de 15,000 ms, un tope de 120,000 y un deadline de 600,000 (10 minutos): son los reintentos al SAT de un servicio que lee facturas, en «En la vida real».
:::

### Retry-After: cuando el servidor dice cuánto esperar

A veces el servidor sabe mejor que tú cuánto esperar. Para eso existe [[retry-after|Retry-After]], un [[header]] de la respuesta que dice cuándo volver a intentar. Viene sobre todo con un 503 o un 429, y trae segundos o una fecha:

```text
HTTP/1.1 429 Too Many Requests
Retry-After: 2
```

Esa respuesta dice «pasaste tu límite; vuelve en 2 segundos». Respetarlo es esperar **al menos** eso antes de reintentar. Ignorarlo es justo lo que el servidor trata de evitar: que todos vuelvan de inmediato y empeoren la saturación.

Respetarlo no quiere decir esperar a ciegas. Si el Retry-After no cabe en tu deadline, no reintentes: ríndete y usa tu plan B. En Alba, en 300 ms no cabe esperar un Retry-After de 1 s, así que el camino de Ana cae al selector. Un caller *batch*, en cambio, sí puede esperar. En un servicio que sirve su propio LLM, por ejemplo, el caller batch ajusta cuántas requests manda a la vez: sube mientras todo sale bien y baja con cada 429 o 503, respetando su Retry-After.

:::profundo Otras recetas de jitter, y el backoff de Kubernetes
*Full jitter* no es la única receta. Con *equal jitter* (jitter a medias), la mitad de la espera es fija y la otra mitad al azar: entre 100 y 200 ms antes del primer reintento, en vez de entre 0 y 200. Así nadie reintenta casi de inmediato, pero las esperas quedan menos repartidas. Con *decorrelated jitter*, cada espera sale al azar entre la base y el triple de la espera anterior, con un tope. En las simulaciones del artículo de Brooker, *full jitter* fue la que menos trabajo total le dio al servidor (*decorrelated jitter* terminó un poco antes, con algo más de trabajo), y por eso es la que más se recomienda.

El backoff exponencial no es solo para requests. Cuando un contenedor se cae una y otra vez al arrancar, Kubernetes lo reinicia con esperas que se duplican (10 s, 20 s, 40 s…) hasta un tope de 5 minutos, y vuelve a empezar de 10 s si el contenedor aguanta 10 minutos sin caerse. Son los valores por omisión que documenta Kubernetes 1.37 (2026); desde la 1.35, cada nodo puede bajar ese tope. El estado se llama `CrashLoopBackOff`: es exactamente esta idea, aplicada a reiniciar.
:::

## La tormenta de reintentos y su presupuesto {The retry storm and the retry budget}

Los reintentos ayudan cuando las fallas son pocas y salteadas. Cuando muchas requests fallan a la vez por falta de capacidad, hacen lo contrario: multiplican la carga justo cuando el sistema tiene menos aire. Eso es una [[tormenta-reintentos|tormenta de reintentos]] (*retry storm*), la que ya viste en la lección de probabilidad como una [[falla-correlacionada|falla que llega junta]].

### Cada capa multiplica

Lo peor pasa cuando varias capas reintentan, cada una por su cuenta. Piensa en una cadena de cuatro piezas: una app llama a una API, la API a un servicio y el servicio al servidor del modelo. Las tres que llaman a otra (la app, la API y el servicio) reintentan 3 veces cada una. Así, cada llamada se vuelve hasta 4 intentos (1 + 3 reintentos), y los intentos se multiplican al bajar:

:::formula Intentos que le llegan al fondo
A = (1 + r)^m
F = λ × A
- m: cuántas capas reintentan, cada una por su cuenta
- r: cuántos reintentos hace cada capa, como en el backoff
- 1 + r: los intentos de cada llamada: el original más los reintentos
- A: los intentos que le llegan al fondo por cada request de arriba, en el peor caso: cuando todo falla
- λ: las requests por segundo que entran, la misma \(λ\) de la Ley de Little
- F: los intentos por segundo que recibe el fondo
- K: lo que aguanta el fondo, en requests por segundo. Si \(F\) pasa de \(K\), el fondo se satura
:::

:::cuenta Tres capas que reintentan 3 veces cada una
Intentos que recibe la API por cada request de la app // \(1 + r\): la app reintenta \(r\) = 3 veces | 1 + 3 | 4
Intentos que recibe el servicio // cada intento de la API hace hasta 4 | 4 × 4 | 16
Intentos que recibe el servidor del modelo, \(A\) // \(m\) = 3 capas | \(A = (1 + r)^m\) = 4 × 4 × 4 = 4³ | 64
Con el pico de Alba, \(F\) // \(λ\) = 500 requests por segundo | \(F = λ × A\) = 500 × 64 | 32,000/s
Lo que aguantan las dos T4, \(K\) // ≈ 1,200 fotos por segundo cada una, medidas | 2 × 1,200 | 2,400/s
Contra lo que aguantan | \(F ÷ K\) = 32,000 ÷ 2,400 | ≈ 13 veces
Con una sola capa y presupuesto de 10 % // \(β\) = 0.10 es el presupuesto; lo ves en un momento | \(λ × (1 + β)\) = 500 × 1.1 | 550/s
= Si el servidor del modelo se frena, cada request de la app puede volverse 64 intentos: 13 veces lo que aguantan las dos GPUs. Con una sola capa que reintenta y un presupuesto, la carga sube a lo mucho 10 %.
:::

:::diagrama fallas-red-tormenta
Arriba, cada capa reintenta por su cuenta y la carga se multiplica al bajar. Abajo, solo una capa reintenta, con presupuesto, y las demás pasan el error hacia arriba. Recorre los dos caminos.
:::

Lo traicionero es que nadie en ninguna capa ve el problema completo. Cada una cree que está siendo resiliente, porque reintentar suena a buena idea. Y la tormenta no se apaga sola: aunque la causa original desaparezca, la carga de los reintentos alcanza para mantener saturado al servidor. Cada intento fallido produce más intentos.

### El presupuesto de reintentos

La primera defensa es poner pocos reintentos en una sola capa. La segunda es un [[presupuesto-reintentos|presupuesto de reintentos]] (*retry budget*): un tope a cuántos reintentos puede mandar un cliente, como fracción de sus requests normales. El libro de SRE de Google (*Site Reliability Engineering*, el libro donde Google cuenta cómo opera sus servicios), en su capítulo sobre sobrecarga, usa dos topes juntos:

- **Por request:** como mucho 3 intentos. Después de eso, la request falla.
- **Por cliente:** los reintentos no pueden pasar de ≈ 10 % de las requests. Si ya se gastó el presupuesto, el cliente no reintenta: falla de una vez.

Mira la diferencia con números. Al presupuesto le diremos \(β\) (la letra griega beta), como fracción: 0.10 para 10 %. El gateway manda \(λ\) = 500 requests por segundo y, de pronto, el 20 % falla. Para reintentarlas todas mandaría 0.2 × 500 = 100 reintentos por segundo; el presupuesto permite \(β × λ\) = 0.1 × 500 = 50, y la carga total queda en a lo más \(λ × (1 + β)\) = 550 por segundo. Si la falla es chica y salteada, 50 alcanzan de sobra. Si es grande, el presupuesto se acaba y la carga extra se queda en 10 %, en vez de multiplicarse.

El 10 % no es una ley: cada herramienta trae su número, y la idea es la misma: si muchas fallan, se deja de reintentar.

¿Y en qué capa se reintenta? El libro de SRE elige la que está justo arriba de la que falla. Esa capa, si se rinde, devuelve hacia arriba un error que dice «estoy sobrecargado, no reintentes» (*overloaded; don't retry*), para que las capas de arriba no se sumen. En Alba la decisión es todavía más simple: en el camino interactivo no reintenta nadie.

:::profundo Otros presupuestos: Linkerd y gRPC
Linkerd, una [[service-mesh|malla de servicios]], deja por omisión que los reintentos sumen a lo más 20 % de carga, más 10 reintentos «gratis» por segundo para los servicios con poco tráfico. gRPC tiene su propia versión, el *retry throttling*: un contador que baja 1 con cada falla y sube un poco con cada éxito, y que apaga los reintentos cuando cae a la mitad de su máximo.
:::

:::calculadora fallas-red-tormenta
Arranca con el ejemplo de la cuenta: \(m\) = 3 capas, \(r\) = 3 reintentos cada una y \(λ\) = 500 requests por segundo. Baja a 1 reintento, o a 1 sola capa, y compara con lo que deja pasar el presupuesto.
:::

:::profundo Por qué la tormenta no se apaga sola
A una falla que se sostiene sola, aunque su causa ya se fue, se le llama **metaestable** (*metastable failure*). El nombre lo puso un artículo de 2021 (de Nathan Bronson y otros, en el congreso HotOS), y uno de 2022 (de Lexiang Huang y otros, en OSDI) estudió 22 casos reales en 11 organizaciones. La idea: el sistema tiene dos estados estables. En uno, todo va bien y casi nadie reintenta. En el otro, el servidor está saturado, casi todo falla, y los reintentos de esas fallas lo mantienen saturado. Un empujón (un pico, un deploy, una pausa de 2 segundos) lo pasa del primero al segundo, y quitar el empujón no lo regresa.

Para salir hay que **cortar la carga**: apagar los reintentos, rechazar tráfico en la entrada o abrir un circuit breaker (lo ves en dos secciones). Por eso los presupuestos y el jitter se deciden antes del incidente: a media tormenta ya es tarde para ponerlos.
:::

## Idempotencia: repetir sin daño {Idempotency: repeating without harm}

Volvamos al timeout ambiguo. La request de Ana pudo haberse hecho y perdido la respuesta. Si el backend reintenta «publicar», puede haber dos publicaciones de los mismos tenis. Si era un cobro, Ana paga dos veces. La pregunta de fondo es: ¿qué operaciones se pueden repetir sin daño?

Una operación es **idempotente** si hacerla una vez o muchas deja el mismo resultado. Eso es la [[idempotencia]] (*idempotency*). «Pon el volumen en 20» es idempotente: la tercera vez sigue en 20. «Sube el volumen 2 rayitas» no lo es: cada vez queda más alto. En matemáticas se escribe f(f(x)) = f(x). El valor absoluto cumple: |−5| = 5, y |5| sigue siendo 5.

:::analogia El botón del elevador
Si aprietas cinco veces el botón de llamar al elevador, viene un solo elevador. Apretarlo otra vez no cambia nada: ya está pedido. Eso es idempotencia, y por eso nadie se preocupa si alguien lo aprieta de más.

**Dónde se rompe:** el elevador sabe que todos los botonazos son la misma petición, porque es el mismo botón. En la red, el servidor no tiene cómo saber que dos requests iguales son **la misma intención** o dos publicaciones distintas que Ana quiso hacer. Hay que decírselo, y para eso sirve la llave que viene en un momento.
:::

### Los métodos de HTTP prometen algo

En la lección de HTTP viste que cada request lleva un [[metodo-http|método]]. El estándar de HTTP le asigna a cada uno una promesa:

| Método | Qué hace | ¿Idempotente? |
|---|---|---|
| GET | Leer algo | Sí, y además no cambia nada |
| PUT | Dejar algo **así**: «el precio de la publicación 42 es 900» | Sí: la segunda vez el precio ya es 900 |
| DELETE | Borrar algo | Sí: lo borrado sigue borrado, aunque la segunda respuesta diga «no existe» |
| POST | Crear algo o hacer una acción: «publica esto», «cobra esto» | No: cada vez crea otra |

La promesa la cumple, o no, el servidor. Lo que cuenta es lo que hace, no el nombre del método. La inferencia de Triton se pide con un POST, y aun así es idempotente: clasificar la misma foto dos veces da la misma categoría y no cambia nada en el mundo. Publicar y cobrar, en cambio, no lo son.

### La llave de idempotencia

Para que un POST se pueda repetir sin daño, el cliente le pone una [[llave-idempotencia|llave de idempotencia]] (*idempotency key*): un identificador único que genera **una vez por operación**, no una vez por intento, y que manda igual en cada reintento. Casi siempre es un UUID: un identificador de 128 bits, casi todos al azar, que en la práctica nunca se repite. Viaja en un header, normalmente `Idempotency-Key`: es el nombre que usa Stripe, una empresa de pagos en línea, y el que propone la IETF, el grupo que escribe los estándares de internet, en un borrador que en noviembre de 2026 todavía no es estándar.

El servidor guarda cada llave junto con la respuesta que dio. Si le llega una llave que ya vio, no repite la operación: devuelve la misma respuesta de antes. Para el cliente, el reintento se ve exactamente como si el primer intento hubiera funcionado.

:::figura fallas-red-perdida
Arriba, sin llave: el servidor publica, la respuesta se pierde, el cliente reintenta y el servidor publica otra vez. Abajo, con llave: el reintento lleva la misma llave, el servidor la reconoce y devuelve la respuesta que ya tenía.
:::

```python
import uuid

publicaciones = []        # lo que el servidor guardó
ya_hechas = {}            # llave de idempotencia → la respuesta que ya se dio

def publicar(titulo, llave=None):
    if llave in ya_hechas:                 # esta operación ya se hizo
        return ya_hechas[llave]            # devuelve lo mismo, sin publicar otra vez
    publicaciones.append(titulo)
    respuesta = f"publicación #{len(publicaciones)}"
    if llave:
        ya_hechas[llave] = respuesta
    return respuesta

def cliente(titulo, con_llave):
    llave = str(uuid.uuid4()) if con_llave else None   # una por operación, no por intento
    publicar(titulo, llave)                # se publica, pero la respuesta se pierde en la red
    return publicar(titulo, llave)         # el reintento lleva la misma llave

print("sin llave:", cliente("Tenis naranjas", False), "· guardadas:", publicaciones)
publicaciones.clear()
print("con llave:", cliente("Tenis naranjas", True), "· guardadas:", publicaciones)
```

```salida
sin llave: publicación #2 · guardadas: ['Tenis naranjas', 'Tenis naranjas']
con llave: publicación #1 · guardadas: ['Tenis naranjas']
```

El UUID cambia en cada corrida, y por eso el programa no lo imprime. Lo que importa es que el reintento lleva **la misma** llave. Si el cliente generara una nueva en cada intento, el servidor vería dos operaciones distintas y publicaría dos veces: la llave no serviría de nada.

Una advertencia: que algo sea idempotente quiere decir que **puedes** reintentarlo sin efectos raros, no que te **convenga**. La inferencia de Alba es idempotente, y aun así no se reintenta en el camino de Ana: el problema ahí no son los duplicados, sino la carga y el tiempo.

:::profundo Lo que una llave de idempotencia tiene que resolver
- **Dos copias al mismo tiempo.** Si el reintento llega mientras el primer intento todavía corre, el diccionario del ejemplo no basta: los dos verían «no está» y los dos publicarían. Se resuelve guardando la llave **antes** de hacer la operación, con un estado «en curso», en una base de datos (el programa que guarda los datos del servicio) que no acepte la misma llave dos veces. La segunda copia espera, o recibe un error de conflicto (el borrador de la IETF propone un 409, *Conflict*).
- **La misma llave con otros datos.** Si llega la misma llave con otro precio, es un error del cliente. El servidor lo rechaza (el borrador propone un 422), en vez de devolver la respuesta vieja como si fuera de esta.
- **Cuánto guardarla.** Para siempre sería caro. Se guarda unas horas o días: lo que de verdad pueden durar los reintentos. Stripe documenta (en 2026, para su API v1) que cada llave dura al menos 24 horas; después la puede borrar, y la misma llave contaría como una operación nueva.
- **Llaves que salen de los datos.** A veces no hace falta generar nada. Un servicio de segmentación de imágenes médicas o industriales, por ejemplo, usa el hash de la imagen (un resumen corto de sus bytes, que cambia si cambia un solo byte), más la versión del modelo y la configuración: el mismo trabajo da siempre la misma llave. Y un servicio que sirve su propio LLM, con un trabajo nocturno de unos dos millones de ítems, le da a cada ítem un id estable, para que reintentar uno no lo duplique.
:::

## Cuando la dependencia falla: circuit breaker, load shedding, degradación y fail-open {When a dependency fails: circuit breaker, load shedding, degradation and fail-open}

Los timeouts y los reintentos sirven para fallas cortas. Pero, ¿qué hacer cuando Triton se cae entero durante minutos? Seguir llamándolo es doblemente malo. El gateway espera el timeout completo en cada request, y Triton recibe carga justo cuando intenta levantarse.

Aquí «caído» quiere decir que no contesta nada: su máquina se colgó y los mensajes no reciben respuesta, así que cada llamada espera su timeout. Si en cambio la máquina sigue viva y solo el programa murió, la conexión se rechaza al instante y el gateway contesta de inmediato un 503 con Retry-After, como lo hace el de Alba. El breaker sirve sobre todo en el primer caso.

### El circuit breaker

Un [[circuit-breaker|circuit breaker]] («interruptor de circuito»; la idea la popularizó Michael Nygard en su libro *Release It!*, de 2007) es un contador dentro del cliente (en Alba sería una biblioteca dentro del gateway, no un servicio aparte) que vigila las fallas de una dependencia. Si son demasiadas, deja de llamarla un rato y contesta de inmediato con el plan B. Tiene tres estados. Los números son los de un ejemplo típico, un punto de partida y no una receta:

- **Cerrado** (*closed*): todo normal. Deja pasar las llamadas y cuenta las fallas y los timeouts. Si en los últimos 10 s fallan más del 50 %, con al menos 20 llamadas, se abre.
- **Abierto** (*open*): no llama. Cada request recibe el plan B al instante, sin tocar la red. Así se queda 30 s.
- **Semiabierto** (*half-open*): deja pasar unas pocas llamadas de prueba, 5. Si salen bien, se cierra; si fallan, vuelve a abrirse otros 30 s.

El mínimo de 20 llamadas existe para la madrugada: sin él, 2 fallas de 3 requests a las 4 a. m. serían «67 % de fallas» y abrirían el breaker por nada.

:::figura fallas-red-breaker
Los tres estados del breaker y lo que hace pasar de uno a otro, con los números del ejemplo. Cerrado deja pasar todo; abierto contesta el plan B sin llamar; semiabierto prueba con 5.
:::

:::analogia La pastilla de la luz
En el tablero eléctrico de una casa, la pastilla (el *breaker*) corta la corriente cuando pasa demasiada, para que no se quemen los cables. El nombre viene de ahí, y también la confusión: en electricidad, un circuito **cerrado** deja pasar la corriente. Igual aquí: cerrado deja pasar las llamadas y abierto las corta.

**Dónde se rompe:** la pastilla de la casa salta con un solo pico y se queda abajo hasta que alguien la sube. El breaker de software cuenta una tasa con un mínimo de llamadas, y se prueba solo: el estado semiabierto es él mismo subiendo la pastilla con cuidado.
:::

:::cuenta Alba con Triton caído entero, sin y con breaker
Sin breaker: requests esperando a Triton, \(L\) // Little, con \(λ\) = 500 por segundo; aquí solo cuenta la espera a Triton, así que \(W\) es el timeout completo, \(t_{llamada}\) = 0.15 s | \(L = λ × W\) = 500 × 0.15 s | 75
Lo que tarda el caller en saber // un 504 por el timeout | 150 ms + lo del gateway | ≈ 150–160 ms
Con el breaker abierto: en vuelo, \(L\) // cada una dura ≈ 1 ms: \(W\) = 0.001 s | 500 × 0.001 s | 0.5
Lo que tarda el caller en saber // un 503 con el plan B, sin red | — | ≈ 1 ms
Requests que no tocan a Triton en los 30 s que está abierto // las 500 de cada segundo | 500 × 30 | 15,000
Cuánto más rápido llega el plan B | 150 ms ÷ 1 ms | 150 veces
= El breaker no salva ninguna request, porque Triton está caído igual. Pero libera al gateway, le da al caller su plan B 150 veces más rápido y deja a Triton arrancar sin carga.
:::

El sistema de Alba no trae breaker por ahora: lo cubren el timeout y el [[health-check]] del gateway, que lo saca del balanceador cuando Triton cae. Agregarlo es la mejora natural.

### Load shedding: rechazar rápido

Cuando llega más de lo que se puede atender, algo tiene que ceder. Lo peor es **encolar sin límite**: la fila crece, la espera crece con ella y, al final, cada request vence su deadline adentro de la fila. El [[load-shedding|load shedding]] («soltar carga») es lo contrario: rechazar de inmediato lo que no vas a poder atender a tiempo, con un 503. Rechazar al entrar cuesta microsegundos; atender una request que ya no llega a tiempo cuesta todo su trabajo, para nada.

Alba lo hace en dos lugares. El gateway, con `MAX_INFLIGHT = 16` por pod: la request 17 recibe un 503 al instante. Y la fila de Triton, que rechaza lo que esperó más de 100 ms. Es una forma de [[backpressure]], avisar hacia atrás que no das abasto, con una [[cola-acotada|fila con tope]]. Y cuando hay que soltar, se suelta primero lo que no tiene a una persona esperando: los callers batch antes que la app de Ana.

### Degradación: dar menos, pero dar algo

La [[degradacion|degradación]] (*graceful degradation*, degradarse con gracia) es responder con algo más simple cuando la pieza buena falla, en vez de un error. En Alba, sin sugerencia, Ana elige la categoría a mano en el selector: el [[fallback]] de la lección del camino completo. Publicar sigue funcionando, con un paso más.

Un buen plan B tiene dos condiciones: es más barato que el camino normal y no depende de lo que falló. Y se mide: Alba cuenta cada respuesta de plan B por motivo (timeout, 503, foto inválida). Un fallback que se usa en silencio esconde una caída; con su métrica y su alerta, se nota.

### ¿Abierto o cerrado?

Hay piezas que no dan una respuesta, sino un permiso: un revisor de contenido, un limitador de requests. Si el revisor falla, hay que haber decidido antes qué pasa. [[fail-open|Fallar abierto]] (*fail-open*) es dejar pasar; **fallar cerrado** (*fail-closed*), bloquear. Se elige según qué cuesta más: dejar pasar algo malo un rato, o detener todo lo bueno.

En un servicio de moderación de contenido, el que revisa los posts de un sitio antes de publicarlos, si los modelos no contestan a tiempo, el post se publica y se revisa después: bloquear toda publicación porque una GPU tarda sería una caída del producto. En un pago o en un inicio de sesión se elige lo contrario: si no se puede verificar, no pasa.

Ojo con las palabras: en *fail-open*, «abierto» deja pasar; en el breaker, «abierto» no deja pasar. Una es una puerta; el otro, un circuito eléctrico.

:::profundo Fallar abierto, pero con cuidado
Fallar abierto no es apagar la revisión y olvidarse. En la moderación de contenido, lo único que falla cerrado es la comparación contra una lista de imágenes prohibidas conocidas, porque corre dentro del mismo programa y no depende de la red: nunca se apaga. Lo que se publicó sin revisar entra a la revisión de después con prioridad alta, y la tasa de fail-open tiene su métrica y su alerta, como la tasa de fallback de Alba.

Lo mismo pasa con un limitador de requests que guarda sus cuentas en otro servidor. Si ese servidor no contesta en ≈ 5 ms, el gateway no se cae ni deja pasar todo: aplica un límite local, más conservador, y sigue. Es fallar abierto, pero con un tope.
:::

## Hedging: pedir dos veces para recortar la cola {Hedging: asking twice to cut the tail} [extra]

Todo lo anterior trata de fallas. El [[hedging]] trata de otra cosa: de las requests que no fallan, pero tardan muchísimo. En las lecciones de percentiles y de probabilidad viste la idea: si una request no ha respondido cuando ya pasó lo que tarda su p95, mandas una **copia** a otra réplica, te quedas con la primera respuesta que llegue y cancelas la otra. El nombre viene de *to hedge*, cubrirse: como quien le apuesta a dos caballos para no perderlo todo.

Un reintento espera a que algo falle. El hedging no espera: apuesta a que la lentitud es mala suerte de **una** réplica, y que otra, al mismo tiempo, no la tiene.

¿Por qué disparar en el p95 y no antes? Por lo que cuesta. Si mandaras la copia desde el principio, a todas las requests, duplicarías la carga para rescatar a unas pocas. Esperar al p95 quiere decir que solo 5 de cada 100 requests llegan a ese punto sin respuesta, así que solo esas pagan una copia. Disparar en el p99 costaría ≈ 1 % de carga, pero rescataría menos y más tarde. El p95 es un punto medio común, no una ley: se ajusta mirando cuánta carga extra aguanta el servicio.

### Un ejemplo con números

Un ejemplo típico: el 2 % de las requests cae en una réplica que se pausa ≈ 1 s, al azar y por su lado (por ejemplo, porque el programa se detiene a limpiar su memoria). Sin hedging, ese 2 % es más que el 1 % que deja afuera el p99, así que el p99 queda en ≈ 1 s. Con hedging, las cuentas son estas:

:::formula Hedging
P_{lenta} = P_{pausa} × P_{pausa}
t_{rescate} ≤ t_{disparo} + t_{copia}
- P_{pausa}: la fracción de intentos que cae en una pausa, cada uno por su lado (0.02 = 2 %)
- P_{lenta}: la fracción de requests que sigue lenta con hedging: el original y la copia cayeron los dos en pausa (la regla del producto de la lección de probabilidad)
- t_{disparo}: cuándo sale la copia, en ms: lo que tarda el p95
- t_{copia}: lo que tarda la copia, en ms
- t_{rescate}: lo más que tarda una request rescatada, en ms
:::

:::cuenta Hedging a los 45 ms, el p95
Requests que pasan del disparo // \(t_{disparo}\) = 45 ms es el p95: solo 5 de cada 100 lo pasan | 1 − 0.95 | ≈ 5 %
Carga extra // una copia por cada una | — | ≈ +5 %
Siguen lentas, \(P_{lenta}\) // el original y la copia caen en pausa, cada uno por su lado; \(P_{pausa}\) = 0.02 | \(P_{pausa} × P_{pausa}\) = 0.02 × 0.02 | 0.04 %
Lo más que tarda una rescatada, \(t_{rescate}\) // la copia tarda \(t_{copia}\) ≈ 40 ms | \(t_{disparo} + t_{copia}\) = 45 + 40 | ≈ 85 ms
= Con 0.04 % de lentas, menos del 1 %, el p99 ya no cae en una pausa: baja de ≈ 1 s a ≈ 85 ms o menos, por ≈ 5 % más de carga.
:::

Esta simulación lo comprueba con 100,000 requests. Lo normal tarda ≈ 30 ms; el 2 % cae en una pausa de ≈ 1 s:

```python
import random
rng = random.Random(3)

def intento():                        # una llamada a una réplica, en ms
    if rng.random() < 0.02:           # el 2 % cae en una réplica que se pausa ≈ 1 s
        return 1000 + rng.uniform(0, 50)
    return max(10, rng.gauss(30, 8))  # lo normal: ≈ 30 ms

def percentil(datos, p):
    orden = sorted(datos)
    return orden[int(p / 100 * len(orden)) - 1]

N, DISPARO = 100_000, 45              # requests; el hedge sale a los 45 ms
sin, con, copias = [], [], 0
for _ in range(N):
    t = intento()
    sin.append(t)
    if t > DISPARO:                   # no respondió a tiempo: va una copia a otra réplica
        copias += 1
        t = min(t, DISPARO + intento())   # gana la primera que llegue
    con.append(t)

print(f"p95 sin hedging: {percentil(sin, 95):.0f} ms")
print(f"p99 sin hedging: {percentil(sin, 99):.0f} ms · con hedging: {percentil(con, 99):.0f} ms")
print(f"más de 500 ms: {sum(t > 500 for t in sin) / N:.2%} sin · {sum(t > 500 for t in con) / N:.2%} con")
print(f"copias extra: {copias / N:.1%} de las requests")
```

```salida
p95 sin hedging: 45 ms
p99 sin hedging: 1024 ms · con hedging: 75 ms
más de 500 ms: 1.98% sin · 0.04% con
copias extra: 4.9% de las requests
```

El p99 baja de ≈ 1 s a 75 ms, y solo el 0.04 % sigue lento, como dice la cuenta. Sale un poco abajo de los 85 de la cuenta porque aquí la copia tarda ≈ 30 ms, no 40.

### Cuándo no

El hedging funciona por una sola razón: la lentitud de las dos réplicas es **independiente**. Si no lo es, solo agrega carga. Estos son los casos en que no conviene:

- **Inferencia cara en una GPU cerca de su límite.** El 5 % extra cae en la pieza más cara, y si la lentitud viene de saturación, la empeora. Por eso Alba no hace hedging contra Triton.
- **Lentitud compartida.** Si la request tarda porque la foto es enorme, la copia tarda igual.
- **Operaciones que no son idempotentes.** Dos copias que se ejecutan son dos efectos.
- **Sin cancelación.** Si no puedes cancelar la copia que pierde, pagas el trabajo doble.

Donde encaja es en lecturas baratas que ya tienen réplicas: buscar en un índice repartido en varias máquinas o leer de un caché. En el artículo que lo hizo famoso, *The Tail at Scale*, Google lo usó en lecturas así, como viste en la lección de percentiles.

Una búsqueda semántica con embeddings es justo ese caso, como la de Alba entre sus ≈ 100 millones de publicaciones activas. Alba parte su índice de 100 millones de vectores, uno por publicación, en 4 pedazos (*shards*), cada uno con dos copias, y cada búsqueda pregunta a los 4 y espera a todos. Es el [[fan-out]] de la lección de probabilidad: basta con que un pedazo tenga su mala racha para que toda la búsqueda tarde. Por eso, si un pedazo no ha respondido en su p95, la búsqueda le pide lo mismo a su otra copia. Y si de plano no llega a su timeout, contesta con los 3 que sí llegaron: una respuesta parcial, otra forma de degradarse.

## Errores comunes {Common mistakes}

### 1. Una llamada sin timeout, o un timeout de adentro más largo que el de afuera

Una llamada sin límite, o un gateway que le da 5 s a Triton cuando el caller se va a los 300 ms. Las requests se apilan para respuestas que nadie lee, y un servicio lento se vuelve uno caído.

**Cómo evitarlo:** un timeout explícito en cada llamada que sale, y cada salto con min(su tope, lo que queda del deadline). Revisa la cadena completa: cada número más chico que el de arriba.

### 2. Reintentar en todas las capas

Cada capa agrega «sus» 3 reintentos, y tres capas dan 64 intentos por request. Nadie lo ve, porque cada capa por separado se ve razonable.

**Cómo evitarlo:** reintentos en una sola capa, con presupuesto (≈ 10 %), y que esa capa pase hacia arriba un error de «no reintentes». Dibuja la cadena de llamadas y cuenta los intentos al fondo.

### 3. Reintentar sin esperar, o esperar todos lo mismo

Un reintento instantáneo le pega al servidor en el mismo apuro. Un backoff sin jitter mueve la ola en vez de repartirla: mil clientes vuelven en el mismo milisegundo.

**Cómo evitarlo:** backoff exponencial con tope y *full jitter*, y respetar Retry-After cuando viene.

### 4. Reintentar lo que no se puede repetir

Un POST de publicar o de cobrar que se reintenta después de un timeout: el primer intento sí se hizo y solo se perdió la respuesta. Ana paga dos veces.

**Cómo evitarlo:** reintentar solo lo idempotente, o con una llave de idempotencia generada una vez por operación y repetida en cada intento.

### 5. Reintentar errores permanentes

Un 400 o un 422 se reintenta tres veces y falla tres veces. Peor: un trabajo que falla siempre, como una foto corrupta, se reintenta sin fin y ocupa workers.

**Cómo evitarlo:** clasificar la falla antes de reintentar: conexión rechazada, 503 y 429 sí; los demás 4xx, no. Ponerle un tope a los intentos de cada trabajo y apartar los que lo pasan.

### 6. Un plan B que nadie ve, o que nunca se probó

El fallback funciona tan bien que nadie nota que la mitad de las requests lo usa desde hace una semana. O el día que hace falta, descubres que dependía de lo mismo que falló.

**Cómo evitarlo:** contar cada fallback por motivo, con alerta, y ejercitarlo a propósito de vez en cuando.

## En la vida real {In real life} [extra]

### Alba: todas las piezas juntas

El camino de Ana tiene las reglas de esta lección. La cadena de deadlines 300 → 250 → 150 → 100 ms, para que cada salto se rinda antes que el de arriba. Ningún reintento en el camino interactivo, porque el plan B es bueno y barato; los callers batch reintentan una vez, con jitter, respetando Retry-After y con un presupuesto de ≤ 10 % de las requests. Load shedding con `MAX_INFLIGHT = 16` y la fila de Triton con su tope de 100 ms. Y el selector de categorías como degradación, con su métrica. En resumen: sin timeouts, un Triton lento tumba el servicio entero; con timeouts cortos y load shedding, el sistema se degrada, algunas requests reciben 503 y el resto sigue.

### Leer facturas: reintentos al SAT con jitter completo

Un servicio de procesamiento de documentos (OCR, leer el texto de una imagen) lee facturas y verifica cada una contra el SAT, el servicio de impuestos de México, que a veces está lento o caído. Cada factura hace hasta \(r\) = 3 reintentos con jitter completo. Es el backoff de arriba, \(e_n = min(c, b × 2^n)\), con base \(b\) = 15 s y tope \(c\) = 120 s:

:::cuenta Los reintentos al SAT
Esperas máximas, \(e_1\), \(e_2\), \(e_3\) // \(b × 2^n\) con \(b\) = 15 s; ninguna pasa del tope | 15 × 2, 15 × 4, 15 × 8 | 30, 60 y 120 s
Lo más que espera una factura, \(E\) | \(E = e_1 + e_2 + e_3\) = 30 + 60 + 120 s | 210 s ≈ 3.5 min
Lo que espera en promedio // con full jitter, la mitad de cada tope | \(E ÷ 2\) = 210 ÷ 2 | 105 s ≈ 1.75 min
= Después de los 3 reintentos, la factura va a revisión marcada «SAT no verificado». Una persona espera minutos sin problema; por eso aquí sí se reintenta.
:::

Una mejora natural: durante una caída de horas, miles de facturas esperarían sus reintentos una por una. Con un breaker compartido, las nuevas saltarían directo a «no verificado», y el SAT no recibiría una ola de reintentos al volver.

### Un LLM propio: no se reintenta a medio camino

Un servicio que sirve su propio LLM (un modelo de lenguaje grande, como el de un chatbot) lo hace escribir su respuesta token por token, en [[streaming]]. Un solo timeout total no sirve: una respuesta larga y sana puede tardar un minuto (1,024 tokens a ≈ 50 ms cada uno son ≈ 51 s). Por eso usa un timeout por fase: conectar, 2 s; primer evento, 10 s; silencio máximo entre eventos, 30 s; request completa, 120 s.

Y no se reintenta a mitad del stream. Si la falla llega antes del primer byte, todavía se puede convertir en un error limpio o en otro proveedor. Si llega con 120 tokens ya en la pantalla, pegar en silencio una segunda respuesta daría un texto que no tiene sentido. Lo honesto es avisar del error y ofrecer regenerar.

### Un agente: el reembolso que se paga dos veces

Piensa en un agente de soporte: un LLM que, para ayudar, llama herramientas, como «reembolsar este pedido». Si una herramienta da timeout y el orquestador (el programa que lleva los pasos del agente) reintenta sin llave de idempotencia, el reembolso se paga dos veces. Por eso cada herramienta con efectos recibe una llave, y cada una lleva su propio timeout.

### Moderación: publicar aunque el revisor no conteste

Un servicio de moderación de contenido revisa posts y comentarios antes de publicarlos, con modelos en Triton y la promesa de contestar en 150 ms (su p99). Su gateway se da un presupuesto propio de 120 ms: si a esa altura falta la calificación de algún modelo, decide con lo que tiene, falla abierto y publica, y el post queda marcado para revisarse después con prioridad. Así responde a tiempo aunque Triton esté lento. Lo que nunca se apaga es la comparación contra imágenes prohibidas conocidas, que corre dentro del proceso: esa falla cerrado. Y la tasa de fail-open tiene su alerta, porque una que sube en silencio es una moderación que dejó de moderar.

### Fuera de ML: pagar en línea

Cuando una tienda en línea te dice «no presiones dos veces el botón de pagar», está confesando que su cobro no es idempotente. Las pasarelas de pago modernas, como Stripe, aceptan una llave de idempotencia en cada cobro: si la app reintenta con la misma llave, el cobro se hace una sola vez. Es exactamente el ejemplo de esta lección, con dinero de verdad.

Y el backoff con jitter lo inventas tú cada vez que una línea está ocupada. Si mil personas llaman a un programa de radio para ganar boletos y todas vuelven a marcar exactamente al minuto, la línea sigue ocupada para casi todas. Las que esperan un rato al azar, y cada vez un poco más, tienen más suerte.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de backoff y de amplificación se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Para cada caso, ¿reintentarías? (a) Conexión rechazada. (b) Un 422. (c) Un 429 con `Retry-After: 2`, desde un job batch. (d) El mismo 429, en el camino de Ana, que se rinde a los 300 ms. (e) Un 413.
- (a) **Sí**, mejor contra otra réplica: no había nadie escuchando y la request nunca llegó.
- (b) **No**: los datos están mal y van a estar mal la segunda vez.
- (c) **Sí**, después de al menos 2 s, y dentro del presupuesto.
- (d) **No**: 2 s no caben en 300 ms. Se rinde y usa el selector.
- (e) **No**: la request es demasiado grande y lo seguirá siendo.
? [facil] Un backoff exponencial con base de 50 ms y tope de 1 s hace 5 reintentos. ¿Cuál es la espera máxima antes de cada uno? ¿Cuánto espera en total, como máximo y en promedio con *full jitter*?
- Con \(e_n = min(c, b × 2^n)\), \(b\) = 50 ms y \(c\) = 1,000 ms: \(e_1\) = 50 × 2 = 100, \(e_2\) = 50 × 4 = 200, \(e_3\) = 400, \(e_4\) = 800 y \(e_5\) = min(1,000, 1,600) = 1,000. Son **100, 200, 400, 800 y 1,000 ms**: el quinto daría 1,600, pero el tope lo recorta.
- Máximo total: \(E = e_1 + … + e_5\) = 100 + 200 + 400 + 800 + 1,000 = **2,500 ms**.
- Con *full jitter*, cada espera es al azar entre 0 y su tope: en promedio, la mitad. \(E ÷ 2\) = 2,500 ÷ 2 = **1,250 ms**.
? [facil] ¿Cuáles son idempotentes? (a) GET de las categorías. (b) PUT que fija el precio de la publicación 42 en 900. (c) DELETE de la publicación 42. (d) POST que crea una publicación. (e) POST a Triton para clasificar una foto.
- (a) **Sí**: leer no cambia nada.
- (b) **Sí**: la segunda vez el precio ya es 900.
- (c) **Sí**: lo borrado sigue borrado, aunque la segunda respuesta diga que no existe.
- (d) **No**: cada vez crea otra. Hace falta una llave de idempotencia.
- (e) **Sí**, aunque sea un POST: la misma foto da la misma categoría y no cambia nada. Lo que cuenta es el efecto, no el método.
? [facil] ¿Cuántos intentos le llegan al fondo, en el peor caso, con (a) 2 capas que reintentan 2 veces y (b) 4 capas que reintentan 1 vez? ¿Cuántos por segundo con las 500 requests por segundo del pico de Alba?
- Con \(A = (1 + r)^m\) y \(F = λ × A\), con \(λ\) = 500:
- (a) \(r\) = 2 y \(m\) = 2: cada llamada se vuelve 1 + 2 = 3 intentos, \(A\) = 3² = **9**, y \(F\) = 500 × 9 = **4,500 por segundo**.
- (b) \(r\) = 1 y \(m\) = 4: 1 + 1 = 2 por capa, \(A\) = 2⁴ = **16**, y \(F\) = 500 × 16 = **8,000 por segundo**. Un solo reintento por capa parece inofensivo; con 4 capas, multiplica por 16.
? [medio] El deadline del gateway es de 250 ms y el tope de la llamada a Triton, 150 ms. ¿Qué timeout le toca a la llamada si recibir y preparar la foto tomó (a) 70 ms y (b) 160 ms? En (b), ¿quién se rinde primero, el gateway o la fila de Triton, que rechaza a los 100 ms?
- Con \(t_{llamada} = min(t_{tope}, D − g)\), \(D\) = 250 ms y \(t_{tope}\) = 150 ms:
- (a) \(g\) = 70: quedan \(D − g\) = 250 − 70 = 180 ms, y min(150, 180) = **150 ms**.
- (b) \(g\) = 160: quedan 250 − 160 = 90 ms, y min(150, 90) = **90 ms**.
- En (b), el gateway se rinde a los 90 ms, antes que los 100 de la fila. Si la request sigue en la fila, es trabajo zombi, y por eso conviene que el gateway cancele hacia abajo.
? [medio] Alguien sube el timeout del gateway hacia Triton a 400 ms «para dar margen». Triton se traba con las 500 requests por segundo del pico de Alba, repartidas en 5 pods con `MAX_INFLIGHT = 16`, y el resto del trabajo de cada request sigue tomando ≈ 40 ms. ¿Cuántas requests quedan en vuelo por pod? ¿Qué parte se rechaza con 503? ¿Qué ve el caller?
- Con \(W = w + t_{llamada}\), \(L = λ × W\), \(X = M ÷ W\) y \(f = 1 − X ÷ λ\), por pod:
- Llegan \(λ\) = 500 ÷ 5 = 100 por segundo, y cada request dura ahora \(W\) = 40 + 400 = 440 ms. Little: \(L\) = 100 × 0.44 = **44 en vuelo**, pero solo hay \(M\) = 16 lugares.
- Cada lugar se libera a los 440 ms: el pod despacha \(X\) = 16 ÷ 0.44 ≈ 36 por segundo. Se rechazan \(f\) = 1 − 36 ÷ 100 ≈ 0.64: **≈ 64 %**.
- Las que entran esperan ≈ 440 ms, pero el caller se fue a los 300: su respuesta llega cuando nadie la espera. Con 150 ms, todas tenían su respuesta a tiempo. Subir el timeout no dio margen: lo quitó.
? [medio] Triton se cae entero a las 12:00:00, a 500 requests por segundo. El breaker se abre con más de 50 % de fallas en los últimos 10 s (con al menos 20 llamadas); antes de la caída todo iba bien. (a) ¿Cuándo se abre, más o menos? (b) ¿Cuántas requests esperaron sus 150 ms antes de eso? (c) ¿Cuántas no tocan a Triton en los 30 s que está abierto? (d) ¿Qué pasa a las 12:00:35, si Triton sigue caído?
- (a) Las fallas pasan del 50 % de la ventana cuando la mitad de los últimos 10 s ya es de caída: **≈ 5 s** después, a las 12:00:05.
- (b) Llegan 500 por segundo durante esos ≈ 5 s: 500 × 5 = **≈ 2,500 requests**, cada una con su 504 a los ≈ 150 ms.
- (c) Las 500 de cada segundo, durante 30 s: 500 × 30 = **15,000**, cada una con su plan B en ≈ 1 ms.
- (d) A las 12:00:35 pasa a semiabierto y deja pasar 5 llamadas de prueba. Fallan, y se abre otros 30 s.
? [reto] Un servicio de búsqueda tiene réplicas de un índice. El 3 % de sus lecturas cae en una réplica que se pausa ≈ 800 ms, al azar; su p95 es de 50 ms y una copia tarda ≈ 40 ms. (a) Sin hedging, ¿dónde queda su p99? (b) Con hedging en el p95, ¿qué fracción sigue lenta, cuánto tarda a lo más una rescatada y cuánta carga extra cuesta? (c) Otro equipo propone lo mismo para una GPU de inferencia al 90 % de uso. ¿Qué le dices?
- (a) El 3 % lento es más que el 1 % que deja afuera el p99: el p99 cae en una pausa, **≈ 800 ms**.
- (b) Con \(P_{lenta} = P_{pausa} × P_{pausa}\) y \(P_{pausa}\) = 0.03, siguen lentas 0.03 × 0.03 = 0.0009 = **0.09 %**, menos del 1 %. Con \(t_{rescate} ≤ t_{disparo} + t_{copia}\), una rescatada tarda a lo más 50 + 40 = **≈ 90 ms**, y ese es el nuevo p99, más o menos. Cuesta **≈ 5 %** de carga: las que pasan del p95.
- (c) Que no. El 5 % extra la sube a ≈ 0.9 × 1.05 ≈ 94.5 % de uso, más cerca de su límite, en la pieza más cara. Y si su lentitud viene de saturación, la copia es igual de lenta: el hedging solo suma carga.
? [reto] Diseña la herramienta «reembolsar pedido» de un agente de soporte (un LLM que, para ayudar, llama herramientas). El orquestador la llama con un timeout de 5 s y puede reintentar. (a) ¿Quién genera la llave y cuándo? (b) Un reintento llega mientras el primer intento sigue corriendo: ¿qué debe pasar? (c) Llega la misma llave con otro monto: ¿qué respondes? (d) ¿Cuánto tiempo guardas cada llave?
- (a) El orquestador, **una vez por reembolso decidido**, antes del primer intento, y la manda igual en cada reintento. Si generara una por intento, cada reintento sería otro reembolso.
- (b) El servidor guarda la llave **antes** de pagar, con estado «en curso», en una base que no acepta la misma llave dos veces. La segunda copia no paga: espera el resultado o recibe un error de conflicto y vuelve a preguntar.
- (c) Un error: la misma operación no puede traer otro monto. Devolver el resultado viejo escondería un bug del cliente.
- (d) Lo que puedan durar los reintentos, con margen: horas o días. Stripe, por ejemplo, documenta al menos 24 horas. Guardarla para siempre cuesta espacio y no protege de nada más.
:::

## Lo que sigue {What comes next}

La siguiente lección, «Qué tan rápido y cuánto: latencia y throughput», explica por qué la fila se dispara cerca del 100 % de uso: la razón de fondo para rechazar rápido. La lección «Colas y streams: mensajes que esperan» retoma la idempotencia: una cola que entrega cada mensaje [[at-least-once|al menos una vez]] obliga a aguantar duplicados. Y la lección «Código de serving» escribe el gateway de Alba con su timeout hacia Triton y su `MAX_INFLIGHT`.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
timeout deadline reintento backoff-exponencial jitter retry-after tormenta-reintentos presupuesto-reintentos idempotencia llave-idempotencia circuit-breaker degradacion load-shedding hedging fail-open
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué un servicio lento es peor que uno caído?
El caído falla rápido y quien llama pasa a su plan B. El lento retiene memoria, conexiones y lugares en vuelo hasta que todo se atasca. El timeout lo convierte en uno que falla rápido.
? ¿Qué diferencia hay entre un timeout y un deadline?
El timeout es cuánto espera una llamada. El deadline es el momento en que la request entera deja de importar. Cada salto usa min(su tope, lo que queda del deadline), y así nadie espera más que quien lo llamó.
? ¿Por qué el backoff exponencial necesita jitter?
Porque los clientes que fallaron juntos, con el mismo backoff, vuelven juntos. El azar en la espera los reparte en el tiempo, y el servidor recibe una llovizna en vez de una ola.
? Tres capas reintentan 3 veces cada una. ¿Cuántos intentos le llegan al fondo, y cómo se evita?
4³ = 64. Se evita reintentando en una sola capa, con un presupuesto de ≈ 10 % de las requests, y pasando hacia arriba un error de «no reintentes».
? ¿Qué hace un circuit breaker abierto, y para qué sirve si no salva ninguna request?
Contesta el plan B al instante, sin llamar. Libera al cliente, da el plan B mucho más rápido y deja que la dependencia se recupere sin carga.
? En Alba, ¿por qué el camino de Ana no reintenta, si la inferencia es idempotente?
Idempotente quiere decir que se puede, no que convenga. El reintento tendría ≈ 80 ms y le duplicaría la carga a un Triton saturado. El selector es mejor respuesta.
:::
