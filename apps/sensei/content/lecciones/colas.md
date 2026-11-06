---
titulo: Colas y streams: mensajes que esperan
en: Queues and streams: messages that wait
subtitulo: Cómo se deja un trabajo en espera sin perderlo, cómo se reparte entre muchos workers, qué pasa cuando uno se cae a la mitad y por qué un registro de eventos que solo crece deja que muchos sistemas lean lo mismo, cada uno a su ritmo.
pregunta: Cuando algo no tiene que contestarse en el momento (reentrenar, avisar a un vendedor, guardar el log de cada predicción, leer un PDF largo), ¿cómo lo dejo esperando sin perderlo, cómo lo reparto entre muchos workers y qué pasa si uno se cae a la mitad?
requisitos: apis, fallas-red, latencia
---

:::idea
Una cola guarda el trabajo hasta que alguien lo termina y lo confirma: si el que lo tomó se cae, el trabajo vuelve. Por eso lo normal es que un mensaje llegue **al menos una vez**, y el que lo procesa tiene que aguantar repetidos. Un stream es otra cosa: un registro que solo crece, que muchos leen a su ritmo, cada uno con su marcador.
:::

Ana publica sus tenis y, en menos de un segundo, la app le sugiere «Tenis». Eso tiene que pasar mientras ella mira la pantalla. Pero alrededor de esa respuesta hay mucho trabajo que **nadie espera**:

- Guardar una línea de log con la predicción, para el monitoreo.
- Avisarle a Ana, horas después, que su publicación tiene 20 vistas.
- Clasificar de una vez los ≈ 200 millones de fotos viejas del catálogo.
- Reentrenar el modelo cada mes con las fotos que se etiquetaron.

Si todo eso se hiciera dentro de la request de Ana, ella esperaría minutos. Y si una máquina se apaga a la mitad, el trabajo se perdería sin que nadie lo note.

Esta lección responde tres preguntas sobre ese trabajo que puede esperar: cómo se guarda sin perderlo, cómo se reparte entre muchas máquinas y qué pasa cuando una se cae a la mitad. Las respuestas son las colas y los streams. Son de las piezas que más vas a dibujar en la Ronda.

## Trabajo que puede esperar: productor, broker y consumidor {Work that can wait: producer, broker and consumer}

La primera pregunta de diseño de la Ronda (M01) es: **¿alguien espera la respuesta antes de continuar?** Si sí, la request es síncrona: el que pide se queda esperando. Si no, casi siempre es más barato y más simple hacerlo después, en segundo plano.

| Trabajo | ¿Alguien espera? | Cómo se hace |
|---|---|---|
| La categoría de los tenis de Ana | Sí: ella sigue en el formulario | Síncrono, en milisegundos |
| El log de esa predicción | No | Se escribe aparte, sin sumar latencia |
| Leer un PDF de 200 páginas | Sí, pero minutos, no milisegundos | Asíncrono, con cola |
| Clasificar 200 M de fotos viejas | No: nadie las está mirando | Un trabajo por lotes ([[batch]]) |

En la lección de APIs viste el patrón: la API **acepta** el trabajo en milisegundos, lo mete en una cola, responde **202 Accepted** con un `job_id`, y un [[worker]] lo **hace** después. Ahí la cola era una caja negra. Ahora la abrimos.

### Tres papeles

Una [[cola-mensajes|cola de mensajes]] (*message queue*) es un servicio que guarda mensajes en fila hasta que alguien los toma, los procesa y confirma que terminó. Alrededor de ella hay tres papeles:

- El [[productor]] (*producer*): el programa que mete mensajes. En el ejemplo del PDF de la lección de APIs, es la API que recibió el `POST /v1/jobs`.
- El [[consumidor]] (*consumer*): el programa que los saca y hace el trabajo. Casi siempre son varios workers iguales, copias del mismo programa.
- El [[broker]]: el servicio que guarda los mensajes en medio. Ejemplos: Amazon SQS (*Simple Queue Service*, el de AWS, la nube de Amazon), RabbitMQ (un programa libre que instalas en tus máquinas) y Google Pub/Sub (el de la nube de Google).

Un **mensaje** es un paquete chico de datos, casi siempre un [[json|JSON]]: `{"job_id": "8f3a", "pdf": "uploads/8f3a.pdf"}`. Lleva **la referencia** al archivo, no el archivo: el PDF vive en el almacén, y el mensaje solo dice dónde buscarlo. Los brokers limitan el tamaño de cada mensaje: SQS acepta hasta 1 [[prefijo-binario|MiB]] desde agosto de 2025 (antes, 256 KiB), y Kafka 4.2 (Kafka es el registro de eventos que verás más adelante en esta lección) trae por omisión un tope de ≈ 1 MB (`message.max.bytes`, 1,048,588 bytes). Mover fotos de 10 MB por una cola sería caro y lento.

A ese truco se le llama *claim check*, como la ficha de un guardarropa: dejas el abrigo en el mostrador y te quedas con una ficha chica. El productor primero sube el archivo al almacén (el [[object-storage|object storage]] de la lección de almacenamiento) y después mete en la cola un mensaje con su dirección. El worker usa esa dirección para bajarlo. Así la cola mueve unos cientos de bytes por trabajo. La analogía se rompe en un punto: en el guardarropa, al entregar la ficha te llevas el abrigo; aquí el archivo se queda en el almacén. Si el mismo mensaje llega dos veces (ya verás que pasa), el worker baja dos veces el mismo archivo y en el almacén no se duplica nada.

### Qué gana cada uno

El productor **no espera** al consumidor: deja el mensaje y sigue. El consumidor trabaja **a su ritmo**: si está ocupado, el mensaje espera en la fila. Y ninguno de los dos necesita saber dónde vive el otro, cuántos son ni si están prendidos: los dos solo hablan con el broker. Si los consumidores se apagan diez minutos para instalar una versión nueva, los mensajes esperan en el broker hasta que vuelvan, y el productor ni se entera.

Cuando hay varios consumidores leyendo de la misma cola, **compiten** por los mensajes: cada mensaje se lo lleva uno solo. Para procesar más rápido, se agregan consumidores. El PDF de 200 páginas, a ≈ 1 s por página, tarda ≈ 200 s con un worker. Si cada página es un mensaje y hay 20 workers, tarda ≈ 10 s (M02).

### Por qué el broker es un servicio aparte

¿No bastaría con una lista en la memoria del programa? Python trae una: `queue.Queue`, una fila segura para que varios [[hilo|hilos]] metan y saquen cosas a la vez. Aquí hay un productor que encola 12 trabajos y 4 consumidores que los reparten:

```python
import queue, threading, time

cola = queue.Queue()                    # la fila, en la memoria de este proceso
hechos = []                             # lo que terminaron los consumidores
candado = threading.Lock()              # para que dos hilos no escriban a la vez

def consumidor():
    while True:
        trabajo = cola.get()            # espera hasta que haya un mensaje
        if trabajo is None:             # la señal de «ya no hay más»
            break
        time.sleep(0.1)                 # «procesar»: 0.1 s por trabajo
        with candado:
            hechos.append(trabajo["job_id"])
        cola.task_done()                # avisa a la fila: este ya quedó

inicio = time.perf_counter()
hilos = [threading.Thread(target=consumidor) for _ in range(4)]
for h in hilos:
    h.start()
for n in range(12):                     # el productor: 12 trabajos, sin esperar a nadie
    cola.put({"job_id": n, "pdf": f"uploads/{n}.pdf"})
print("el productor ya terminó; los consumidores siguen")
cola.join()                             # espera a que los 12 tengan su task_done
duracion = time.perf_counter() - inicio
for h in hilos:
    cola.put(None)                      # una señal de salida por consumidor
for h in hilos:
    h.join()

print("hechos:", len(hechos), "· repetidos:", len(hechos) - len(set(hechos)), "· perdidos:", 12 - len(set(hechos)))
print(f"en serie serían 1.2 s; con 4 consumidores, ≈ {round(1.2 / duracion)} veces más rápido")
```

```salida
el productor ya terminó; los consumidores siguen
hechos: 12 · repetidos: 0 · perdidos: 0
en serie serían 1.2 s; con 4 consumidores, ≈ 4 veces más rápido
```

Qué consumidor tomó cada trabajo cambia en cada corrida; los totales no. Funciona, pero tiene un límite serio: **la fila vive en la [[ram|RAM]] de un [[proceso]]**. Si ese proceso se reinicia, los mensajes que esperaban desaparecen. Y solo la pueden leer los hilos de ese proceso, no los workers de otras máquinas.

Un broker resuelve las dos cosas. Guarda cada mensaje en [[disco]], casi siempre con copias en varias máquinas, antes de decirle al productor «lo tengo». Y lo atiende por la red a cualquier consumidor, esté donde esté. Es la diferencia entre una fila para trabajar dentro de un programa y una fila en la que se puede confiar entre programas.

## Desacoplar: la cola aplana los picos {Decoupling: the queue flattens the peaks}

Que el productor no espere al consumidor se llama **desacoplar** (*decoupling*): cada lado tiene su propia velocidad. Su efecto más útil se ve con números.

En la lección de unidades calculaste el tráfico de C01: ≈ 10 millones de fotos al día, ≈ 116 por segundo en promedio. Con un [[factor-pico|factor de pico]] de 3, la hora pico, a las 20 h, trae ≈ 350 fotos por segundo.

Ahora un supuesto, para el ejemplo: C01 agrega una **revisión después de publicar**, un segundo modelo que busca fotos prohibidas. Nadie espera su respuesta: si encuentra algo, se baja la publicación unos minutos después. ¿Cuántos workers compras?

Si fuera síncrona, tendrías que cubrir el pico: 350 fotos por segundo. Con workers de 20 fotos por segundo cada uno (un supuesto), son 350 ÷ 20 = 17.5, o sea 18 workers. Con una cola, puedes comprar 10 y dejar que la fila absorba la hora pico:

:::cuenta Una hora pico contra workers para 200 fotos por segundo
Llegan en la hora pico // el factor de pico de 3 de la lección de unidades | 116 × 3 | ≈ 350 por segundo
Procesan los workers // un supuesto: 10 workers de 20 fotos por segundo | 10 × 20 | 200 por segundo
Lo que crece la fila | 350 − 200 | 150 por segundo
Fila al terminar la hora | 150 × 3,600 s | 540,000 fotos
Espera de la última // lo que hay delante, entre lo que sale por segundo | 540,000 ÷ 200 | 2,700 s = 45 min
Vaciado, si después llegan 116 por segundo | 540,000 ÷ (200 − 116) | ≈ 6,400 s ≈ 1.8 h
= Con 10 workers en vez de 18, ninguna foto se pierde; la peor espera 45 minutos, y antes de la medianoche la fila está vacía.
:::

La espera de la última foto sale de dividir lo que tiene delante entre lo que sale por segundo. Es la [[ley-little|ley de Little]] despejada para el tiempo, W = L ÷ λ, con λ como el ritmo de salida. Es el [[tiempo-en-cola|tiempo en cola]] de la lección de latencia, ahora en minutos en vez de milisegundos.

:::figura colas-pico
La hora pico de C01 contra workers para 200 fotos por segundo. Arriba, lo que llega y lo que sale. Abajo, la fila: crece mientras llega más de lo que sale, y se vacía cuando el tráfico baja.
:::

La cuenta dice la regla: **con una cola, la capacidad se compra para el promedio con margen, no para el pico**, siempre que el negocio aguante la espera. Si la revisión tuviera que terminar en 5 minutos, 45 no sirven, y habría que comprar más workers o escalarlos con la fila (lo verás en la sección del lag).

Una condición no se negocia: **en promedio, los workers tienen que procesar más de lo que llega**. Si llegan 116 por segundo todo el día y procesan 100, la fila crece 16 por segundo para siempre: ≈ 1.4 millones de fotos atrasadas al día. Una cola esconde un pico; no esconde que falta capacidad.

:::calculadora colas-pico
Prueba una capacidad de 350: la fila nunca crece y la espera es cero, pero pagas 75 % más workers. Prueba 120: al final del pico esperan 828,000 fotos, la fila se vacía a 4 por segundo y tarda más de dos días.
:::

### Una cola no es lo mismo que una fila con tope

En la lección de latencia viste otra fila: la del batcher de Triton, que junta fotos durante 2 ms para hacer un batch, y la [[cola-acotada|cola acotada]] del gateway, que rechaza lo que no cabe. Las dos son filas **en la memoria de un proceso**, como `queue.Queue`. Si Triton se reinicia, las fotos que esperaban se pierden, y está bien: quien pidió ya recibió un error y cae a su [[fallback]].

Allá la fila debe ser corta, porque la request de Ana tiene 300 ms de vida, y por eso se rechaza rápido con [[backpressure]]. Aquí la fila puede ser larga, porque nadie mira el reloj, y lo que importa es **no perder nada**. Por eso esta fila vive en un broker.

Una cola de mensajes también tiene tope: la retención. SQS guarda un mensaje hasta 4 días por omisión y hasta 14 como máximo; después lo borra, aunque nadie lo haya procesado. Y una fila que crece sin parar es un aviso: la presión hacia atrás aquí no es un 503, sino una alerta y más workers.

## Recibir no es borrar: visibility timeout, ack y DLQ {Receiving is not deleting: visibility timeout, ack and DLQ}

Ahora la tercera pregunta: ¿qué pasa si un worker se cae a la mitad?

Si el broker borrara el mensaje en cuanto lo entrega, el trabajo se perdería con el worker. Por eso no lo borra. Lo **esconde**.

:::pasos
1. Recibir
El worker pide un mensaje. El broker se lo da y lo marca **en vuelo** (*in flight*): sigue en la cola, pero nadie más lo ve.
2. Esconderlo un rato
El mensaje queda invisible durante el [[visibility-timeout|visibility timeout]] (tiempo de invisibilidad): 30 s por omisión en SQS. Es el plazo que tiene el worker para terminar.
3. Confirmar
Si el worker termina, avisa: es la **confirmación** o *ack* (de *acknowledge*, «acusar recibo»). En SQS, el ack es literalmente borrar el mensaje.
4. Si no confirma, vuelve
Si vence el plazo sin ack, porque el worker se cayó, se colgó o tardó de más, el mensaje vuelve a ser visible y otro worker lo toma.
:::

:::figura colas-visibilidad
Un mensaje en el tiempo. El worker 1 lo recibe y se cae a los 10 s. El mensaje sigue escondido hasta los 30 s, cuando vence su visibility timeout; reaparece, lo toma el worker 2, termina y confirma. Solo entonces se borra.
:::

Con este truco, un worker que se cae no pierde nada: el trabajo vuelve solo. Cada broker lo llama distinto: en Pub/Sub es el *ack deadline* (10 s por omisión, hasta 600 s); en RabbitMQ, el mensaje se reencola si se cierra el canal del consumidor sin ack, y en sus versiones actuales el broker lo cierra solo tras 30 minutos sin ack (`consumer_timeout`). La idea es la misma.

### El plazo correcto

El plazo tiene que ser mayor que lo que tarda el trabajo. ¿Qué pasa si no?

:::cuenta Un video de 10 minutos con el plazo por omisión de SQS (M02)
Lo que tarda el trabajo | dato | 600 s
Visibility timeout | por omisión | 30 s
A los 30 s // el primer worker sigue trabajando, pero no ha confirmado | — | el mensaje reaparece
Copias empezadas antes de que termine la primera // una cada 30 s, si hay workers libres | 600 ÷ 30 | 20
= Veinte workers procesando el mismo video. Nada falla, pero la cuenta de GPU sale 20 veces más alta y la cola nunca baja.
:::

La regla de la Ronda: **visibility timeout mayor que el [[p99]] del tiempo de proceso, con margen**, por ejemplo el doble. Si el p99 de un trabajo es de 4 minutos, un plazo de 8.

Para trabajos largos o muy variables, subir el plazo a horas tiene un costo: si el worker se muere de verdad, el mensaje tarda horas en volver. La salida es un **latido** (*heartbeat*): el worker vivo renueva su plazo cada tanto (en SQS, con `ChangeMessageVisibility`, más o menos a la mitad del plazo). Con un plazo de 2 minutos renovado cada minuto, un worker vivo conserva el mensaje lo que haga falta, y uno muerto lo libera en 2 minutos como mucho. SQS pone un techo de 12 horas contadas desde la primera recepción, y renovar el plazo no lo reinicia.

:::profundo Apagarse sin dejar trabajo a medias
Los workers también se apagan a propósito: Kubernetes quita uno cuando hay menos trabajo, o la nube reclama una máquina barata (*spot*): AWS avisa 2 minutos antes; Google Cloud, por omisión, unos 30 s. En los dos casos, el proceso recibe primero un SIGTERM, la [[senal|señal]] amable de «por favor, termina». Un worker bien hecho, al recibirlo, **termina el mensaje que tiene y no toma otro**. Si en vez de eso se muere a la mitad, el mensaje vuelve al vencer su plazo y otro empieza de cero: no se pierde, pero se paga dos veces.

Kubernetes espera 30 s por omisión entre el SIGTERM y el SIGKILL, el apagado sin aviso. Si un trabajo tarda 10 minutos, ese margen no alcanza: o se sube el margen del pod, la unidad en que Kubernetes corre cada copia (`terminationGracePeriodSeconds`), o el trabajo se parte en pedazos más cortos, o se acepta repetirlo. M06 trae un caso feo: un *autoscaler* (el programa que prende y apaga copias según la carga) que baja de 8 workers a 1 de golpe manda SIGTERM a 7 que estaban a la mitad de su video.
:::

:::profundo Pedir mensajes sin gastar: el long polling
Un worker que pregunta «¿hay algo?» cada 10 ms a una cola vacía gasta CPU y, en SQS, paga cada pregunta. Con *long polling*, la pregunta se queda abierta hasta 20 s: si llega un mensaje en ese rato, el broker contesta en el momento; si no, contesta «nada» al final. Es el polling de la lección de APIs, pero con la espera del lado del broker. SQS lo activa con `WaitTimeSeconds`; un worker normal pide además varios mensajes a la vez (hasta 10 en SQS), para no hacer un viaje de red por mensaje.
:::

### El mensaje venenoso

¿Y si el trabajo no falla por mala suerte, sino porque **siempre** falla? Un PDF corrupto que tumba al worker cada vez que lo abre es un **mensaje venenoso** (*poison message*). Cada vez que vence su plazo, vuelve, tumba a otro worker y vuelve otra vez. Sin un límite, se reentrega para siempre.

La cola cuenta cuántas veces entregó cada mensaje. Con una regla de reenvío (en SQS, la *redrive policy* con `maxReceiveCount`), después de N recepciones sin ack (por ejemplo, 5) el mensaje se mueve a otra cola: la [[dlq|dead-letter queue]] (DLQ, «cola de mensajes muertos»). Ahí ya no estorba. Una persona lo revisa, arregla el bug y lo reenvía a la cola original (*redrive*), o lo marca como fallido con su motivo.

:::cuenta Cuánto tarda un mensaje venenoso en llegar a la DLQ (M02)
Visibility timeout | dato | 15 min
Intentos antes de la DLQ // maxReceiveCount | dato | 5
Tiempo hasta la DLQ // si cada intento se cuelga hasta el plazo | 5 × 15 min | 75 min
= Más de una hora de workers ocupados con un mensaje que nunca iba a salir. Si el worker se cae al instante, el mensaje igual espera su plazo para volver.
:::

La DLQ lleva su propia alerta: **más de 0 mensajes en la DLQ** ya es algo que alguien tiene que mirar. Un detalle de M12: en las colas estándar de SQS, un mensaje conserva su fecha de llegada original cuando pasa a la DLQ y vence contando desde ahí, así que la DLQ necesita una retención más larga que la cola de la que viene.

:::diagrama colas-jobs
Toca cada caja para ver qué hace. Usa «Recorrer» para seguir un trabajo normal, un worker que se cae a la mitad y un mensaje venenoso.
:::

## Al menos una vez, a lo más una vez, exactamente una vez {At least once, at most once, exactly once}

Con el ack aparece una decisión: ¿el worker confirma **antes** o **después** de hacer el trabajo? Cada orden tiene su garantía de entrega.

- **Confirmar antes de trabajar** es [[at-most-once]] (*a lo más una vez*). Si el worker se cae después del ack, el mensaje ya se borró: ese trabajo se perdió. Nunca hay repetidos, pero puede haber huecos. Sirve para lo que se puede perder sin daño, como una métrica más entre millones.
- **Confirmar después de trabajar** es [[at-least-once]] (*al menos una vez*). Si el worker se cae entre terminar y confirmar, el mensaje vuelve y el trabajo se hace otra vez. Nunca se pierde nada, pero puede haber repetidos.
- [[exactly-once]] (*exactamente una vez*) sería lo ideal: ni huecos ni repetidos.

### Por qué lo normal es «al menos una vez»

El problema está en el instante entre hacer el trabajo y confirmarlo. El worker escribió el resultado y se cayó; o mandó el ack y la red lo perdió. El broker no tiene cómo distinguir «no lo hizo» de «lo hizo y no me avisó». Es el mismo [[timeout]] ambiguo de la lección de fallas de red. Ante la duda, el broker reentrega, porque perder un trabajo suele ser peor que repetirlo.

Por eso SQS estándar, Pub/Sub y Kafka, en su forma normal, entregan **al menos una vez**. Y SQS estándar, además, de vez en cuando entrega un mensaje dos veces aunque nadie se haya caído: guarda copias de cada mensaje en varias máquinas, y si una no estaba disponible cuando se recibió o se borró el mensaje, esa copia puede volver a salir.

### Exactamente una vez, en la práctica

Un *exactly-once* de punta a punta, con efectos fuera del broker (un cobro, un correo, una fila en una base), en general no existe (M02). Lo que sí existe es el **efecto** de una sola vez: at-least-once más un consumidor [[idempotencia|idempotente]], que hace lo mismo si procesa un mensaje una vez o diez. Tres maneras, de la lección de fallas de red:

- **Llevar la cuenta de lo hecho.** Cada mensaje trae un id; el consumidor guarda los ids que ya procesó y descarta los repetidos. Es la [[llave-idempotencia|llave de idempotencia]], ahora del lado del consumidor.
- **Escribir en un lugar fijo.** El resultado del trabajo `8f3a` va siempre a `results/8f3a.json`. Si se repite, se sobrescribe con lo mismo.
- **Escribir el valor, no sumar.** «El total de la ventana es 7» se puede repetir; «súmale 1 al total», no. En una base de datos se hace con un [[upsert]]: insertar si no existe, reemplazar si ya existe (lo viste en la lección de bases de datos).

Esta simulación procesa 1,000 mensajes con un consumidor que se cae el 5 % de las veces, y siempre en el peor momento: entre el ack y el trabajo, o entre el trabajo y el ack. Prueba los tres casos: ack antes, ack después y ack después descartando repetidos por id.

```python
import random
from collections import deque

def correr(modo, deduplicar, n=1000, p_caida=0.05, semilla=7):
    random.seed(semilla)
    cola = deque(range(n))              # los ids de n mensajes
    entregas, efectos, descartados = 0, 0, 0
    vistos = set()                      # ids ya procesados (en la vida real, en una base)
    while cola:
        msg = cola.popleft()            # el broker entrega el mensaje
        entregas += 1
        se_cae = random.random() < p_caida
        if modo == "ack antes":         # at-most-once: confirma y luego trabaja
            if not se_cae:
                efectos += 1            # si se cae aquí, el mensaje ya se borró: perdido
            continue
        # at-least-once: trabaja y luego confirma
        if deduplicar and msg in vistos:
            descartados += 1            # repetido: se confirma sin volver a hacerlo
        else:
            efectos += 1
            vistos.add(msg)
        if se_cae:                      # se cayó antes del ack: el mensaje vuelve
            cola.append(msg)
    return entregas, efectos, descartados

for modo, dedup in (("ack antes", False), ("ack después", False), ("ack después", True)):
    e, f, d = correr(modo, dedup)
    etiqueta = modo + (" + dedup por id" if dedup else "")
    print(f"{etiqueta:<26} entregas {e:>5} · efectos {f:>5} · descartados {d:>2} · perdidos {max(0, 1000 - f):>2}")
```

```salida
ack antes                  entregas  1000 · efectos   942 · descartados  0 · perdidos 58
ack después                entregas  1060 · efectos  1060 · descartados  0 · perdidos  0
ack después + dedup por id entregas  1060 · efectos  1000 · descartados 60 · perdidos  0
```

Con ack antes se pierden 58 de 1,000. Con ack después no se pierde nada, pero salen 60 efectos de más (56 trabajos se hicieron dos veces y 2, tres veces): si cada uno mandaba un correo, 58 vendedores reciben el mismo aviso repetido. Descartando por id, salen exactamente 1,000 efectos.

:::ojo
El id se tiene que guardar **junto con** el efecto, en la misma operación. Si el consumidor escribe el resultado, se cae y no alcanza a anotar el id, la siguiente entrega lo vuelve a hacer. Por eso lo más sólido es el resultado en una llave fija o el upsert: el efecto mismo es idempotente y no hace falta una lista aparte.
:::

:::profundo Por qué nadie puede prometer «exactamente una vez»
Hay un problema clásico, el de **los dos generales**: dos ejércitos solo ganan si atacan a la vez, y se comunican con mensajeros que pueden ser capturados. El general A manda «atacamos al amanecer». Si no sabe si llegó, no ataca. B contesta «recibido», pero tampoco sabe si su respuesta llegó, así que pide confirmación de la confirmación… Ningún número finito de mensajes da certeza a los dos. Un worker y un broker están igual: el último ack siempre puede perderse.

Lo que sí existe son ayudas dentro de un sistema. SQS FIFO descarta los envíos repetidos con el mismo id durante 5 minutos: evita que un productor que reintenta meta el mismo mensaje dos veces. Kafka tiene productores idempotentes y transacciones (desde la versión 0.11, de 2017), que dan *exactly-once* mientras todo se lea y se escriba dentro de Kafka; Flink, un programa que procesa streams de eventos sin parar, lo usa al escribir de vuelta a Kafka. Pub/Sub lo ofrece en suscripciones de tipo pull (el consumidor pide los mensajes, en vez de que se los empujen), y solo si los consumidores se conectan desde la misma [[region|región]], la zona del mundo donde la nube tiene sus centros de datos. En cuanto el efecto sale del broker (un correo, una base, una API de otro), vuelve la regla: consumidores idempotentes.
:::

## El stream de eventos: un registro que solo crece {The event stream: a log that only grows}

Una cola de trabajos tiene una regla: cuando un mensaje se confirma, **desaparece**. Sirve para repartir trabajos. Pero hay otro problema distinto.

En C07, la búsqueda del marketplace, cada vez que un vendedor publica, cambia un precio o vende algo, se produce un **evento**: un registro de algo que ya pasó, como «listing 42: vendido». Ese mismo evento le importa a tres sistemas: el que actualiza el índice de búsqueda, el que lo guarda en el [[data-lake|data lake]] (el gran almacén de archivos de la lección de almacenamiento) para entrenar, y el monitoreo. Al segundo se le llama *sink* («sumidero»): un consumidor que solo copia los eventos a otro lugar. Con una cola, el primero que lo confirma lo borra y los otros dos nunca lo ven.

Un [[stream-eventos|stream de eventos]] (*event stream*), también llamado log de eventos, resuelve eso. Es un registro **que solo crece** (*append-only*): cada evento nuevo se agrega al final y nada se borra al leerlo. Kafka, Amazon Kinesis y Azure Event Hubs (el de Microsoft) funcionan así.

### El marcador de cada lector

Cada evento tiene su posición en el registro: el primero es el 0, el siguiente el 1, y así. Esa posición es su [[offset]]. Leer no saca nada: cada lector lleva su **propio marcador**, el offset del siguiente evento que le toca, como un separador en un libro.

Después de procesar, el lector guarda su marcador en el broker: es el **commit** del offset, «ya procesé hasta aquí». Si se cae, el que lo reemplaza sigue desde el último offset confirmado. Lo que se procesó después del último commit se vuelve a leer: también aquí la entrega es **al menos una vez**.

:::figura colas-log
Un tópico es un registro que solo crece. Cada evento tiene su offset. El indexador va en el offset 7; el sink al lake, más lento, en el 4. Cada uno lleva su propio marcador; leer no borra nada. Los eventos más viejos que la retención se borran por el principio.
:::

### Tópicos y retención

Los eventos se agrupan por tema en un [[topico|tópico]] (*topic*): `listing-events` para los cambios del catálogo, `txn-events` para los pagos con tarjeta de C09, el caso de fraude. Un tópico es un registro con nombre, al que los productores escriben y del que los consumidores leen.

Como nada se borra al leer, el log se borraría solo por tiempo o por tamaño. Esa es su **retención**: Kafka guarda 7 días por omisión (`log.retention.hours=168`); Kinesis, 24 horas por omisión, ampliable hasta 365 días (pagando más). Lo que pasa de la retención se borra por el principio, se haya leído o no.

Que nada se borre al leer da tres cosas que una cola no da:

- **Varios lectores a su ritmo.** El indexador va al día; el sink al lake va un minuto atrás; el monitoreo lee solo de vez en cuando. Ninguno estorba a los otros.
- **Releer.** Si un bug escribió mal las features de ayer, el consumidor regresa su marcador al offset de ayer y procesa otra vez (*replay*), dentro de la retención.
- **Agregar un lector nuevo sin tocar a nadie.** Un sistema nuevo empieza a leer desde el principio de la retención o desde el final, y el productor ni se entera.

Para reprocesar un año, la retención no alcanza: la fuente de verdad es el data lake, no Kafka (M09). El stream es transporte, no archivo.

:::profundo Cómo un log no pierde lo que ya aceptó
Kafka corre en un grupo de máquinas, un *cluster*; en su vocabulario, cada máquina del grupo es un broker. Cada pedazo del log se guarda en varias: con un **factor de replicación** de 3 (*replication factor*), hay 3 copias, casi siempre en 3 zonas distintas de la nube (centros de datos separados, cerca uno del otro). Una de las copias es la principal y las otras la siguen.

El productor elige cuánto esperar antes de dar un evento por guardado, con su ajuste `acks`. Con `acks=all`, el valor por omisión desde Kafka 3.0, Kafka contesta «lo tengo» solo cuando todas las copias que van al día lo escribieron; y con `min.insync.replicas=2` (por omisión vale 1, así que hay que ponerlo), rechaza la escritura si menos de 2 copias van al día. Así, perder una máquina no pierde ningún evento que el productor dio por guardado. Lo pagas en latencia de escritura y en bytes: en C09, 6 MB/s de eventos son 18 MB/s guardados entre las 3 copias.
:::

### Dos cosas que se llaman streaming

En la lección de APIs, [[streaming]] era mandar una respuesta por pedazos sobre una conexión abierta: los tokens de un LLM que van apareciendo. Aquí «streaming» quiere decir **procesar un flujo continuo de eventos guardados en un log**, sin que nadie esté esperando una respuesta. La Ronda (M02) los separa con una tabla: uno es una conexión entre dos programas; el otro, un registro durable que muchos leen. Cuando en una entrevista alguien diga «streaming», pregunta cuál de los dos.

## Particiones y grupos de consumidores {Partitions and consumer groups}

Un solo registro tiene un límite: vive en una máquina y, para conservar su orden, lo lee un solo consumidor a la vez. Si cada consumidor procesa ≈ 1,500 eventos por segundo y llegan 20,000, uno solo no alcanza. Por eso cada tópico se parte en varios registros independientes: sus **particiones**.

Una [[particion-topico|partición del tópico]] (*topic partition*) es uno de esos registros: un pedazo del tópico, con sus propios offsets, que vive en una de las máquinas en que corre Kafka (con copias en otras). Un tópico con 12 particiones son 12 logs que se escriben y se leen en paralelo.

:::ojo
No la confundas con la [[particion-datos|partición de datos]] de la lección de almacenamiento: partir un dataset en carpetas por fecha (`fecha=2026-11-06/`) para no leerlo completo. Las dos se llaman «partición» y las dos parten algo grande, pero la de un tópico reparte eventos que llegan, y la otra, archivos que ya están guardados.
:::

### La llave decide la partición

¿A qué partición va cada evento? El productor le pone una **llave** (*key*), por ejemplo el id del listing, y la biblioteca con la que el productor habla con Kafka calcula una [[funcion-hash|función hash]] de la llave: una cuenta que convierte cualquier texto en un número, siempre el mismo para el mismo texto (la verás en la lección de tiempo y hashes). El residuo de dividir ese número entre el número de particiones da la partición: si la función diera 10 y hubiera 3 particiones, 10 ÷ 3 da 3 y sobra 1, así que el evento iría a la partición 1. Cada biblioteca puede usar una función distinta: la oficial de Kafka, escrita en el lenguaje Java, usa una llamada murmur2, y la que se usa desde Python (`confluent-kafka`, construida sobre una biblioteca en C) usa por omisión CRC32. Por eso dos productores escritos en lenguajes distintos pueden mandar la misma llave a particiones distintas, a menos que se configuren igual. Aquí, para el ejemplo, `zlib.crc32`, que viene con Python:

```python
import zlib

PARTICIONES = 3
log = [[] for _ in range(PARTICIONES)]  # un tópico: 3 listas que solo crecen

def publicar(llave, evento):
    p = zlib.crc32(llave.encode()) % PARTICIONES   # la llave decide la partición
    log[p].append(evento)
    return p, len(log[p]) - 1                       # partición y offset del evento

eventos = [("listing-42", "alta"), ("listing-7", "alta"), ("listing-42", "precio 900"),
           ("listing-99", "alta"), ("listing-42", "vendido"), ("listing-7", "precio 450")]
for llave, que in eventos:
    p, off = publicar(llave, f"{llave}: {que}")
    print(f"{llave:<11} {que:<11} → partición {p}, offset {off}")

# Dos grupos leen la partición de listing-42, cada uno con su propio offset
p42 = zlib.crc32(b"listing-42") % PARTICIONES
confirmado = {"indexador": 0, "sink-al-lake": 0}
for grupo, cuantos in (("indexador", 3), ("sink-al-lake", 1)):
    leidos = log[p42][confirmado[grupo]:confirmado[grupo] + cuantos]
    confirmado[grupo] += len(leidos)                # commit: «ya procesé hasta aquí»
    print(grupo, "leyó", leidos, "· su siguiente offset:", confirmado[grupo])
```

```salida
listing-42  alta        → partición 2, offset 0
listing-7   alta        → partición 1, offset 0
listing-42  precio 900  → partición 2, offset 1
listing-99  alta        → partición 2, offset 2
listing-42  vendido     → partición 2, offset 3
listing-7   precio 450  → partición 1, offset 1
indexador leyó ['listing-42: alta', 'listing-42: precio 900', 'listing-99: alta'] · su siguiente offset: 3
sink-al-lake leyó ['listing-42: alta'] · su siguiente offset: 1
```

Al final, los dos grupos leyeron la misma partición sin estorbarse: el indexador va en el offset 3 y el sink, más lento, en el 1.

Fíjate en tres cosas. Los tres eventos de `listing-42` cayeron en la misma partición, en orden: alta, precio, vendido. `listing-99` cayó en la misma, por casualidad. Y la partición 0 se quedó vacía: con pocas llaves, el reparto puede salir disparejo.

**El orden solo vale dentro de una partición.** Entre particiones no hay orden: el «precio 450» del listing 7 pudo procesarse antes o después que el «vendido» del 42. Casi nunca hace falta orden global; hace falta **orden por entidad**: que los eventos de un mismo listing, de una misma tarjeta, lleguen en orden. Para eso se elige la llave (M02): `listing_id` en C07, `card_id` en C09.

:::figura colas-particiones
Un tópico de 3 particiones y un grupo de consumidores. Arriba, con 2 consumidores: uno lee dos particiones y el otro una. Abajo, con 4: cada partición tiene el suyo y el cuarto consumidor no tiene nada que leer.
:::

### Grupos de consumidores

¿Cómo se reparte el trabajo de leer? Con un [[grupo-consumidores|grupo de consumidores]] (*consumer group*): varias copias de un mismo consumidor que se reparten las particiones. La regla es simple: **cada partición la lee un solo consumidor del grupo**. Así se conserva el orden de cada partición, y cada evento lo procesa una sola copia.

Dos consecuencias:

- **Más consumidores que particiones no ayuda.** Con 12 particiones y 13 consumidores, uno se queda sin nada. El número de particiones es el techo de paralelismo del grupo.
- **Cada grupo es independiente.** El indexador de C07 es un grupo; el sink al lake, otro. Cada grupo tiene sus propios offsets y recibe **todos** los eventos. Así varios sistemas leen el mismo tópico.

Cuando un consumidor del grupo se cae, o se agrega uno, el broker vuelve a repartir las particiones: es el **rebalanceo** (*rebalance*). El que hereda una partición sigue desde su último offset confirmado.

:::profundo Cuántas particiones
Las particiones se eligen por el paralelismo que vas a necesitar, no por los bytes. En C09 el tráfico es chico (≈ 6 MB/s), y aun así el tópico lleva 48 particiones: es el número de copias de Flink que se quieren poder correr en paralelo, con margen. Tener muchas tampoco es gratis: cada partición son archivos abiertos y copias que el broker mantiene, y un rebalanceo con cientos de particiones tarda más. Y cambiar el número después cambia el residuo del hash: una llave que caía en la partición 2 puede caer en otra, y por un rato los eventos viejos y los nuevos de ese listing viven en particiones distintas, sin orden entre ellas.
:::

### Por qué Kafka no es una buena cola de trabajos

Un consumidor de Kafka no confirma mensaje por mensaje: avanza su offset. Si un evento tarda mucho o es venenoso, **todo lo que viene detrás en esa partición espera** (*head-of-line blocking*, bloqueo en la cabeza de la fila). Por eso, para 50 trabajos de [[ocr|OCR]] por segundo (leer el texto de un documento escaneado), una cola como SQS es más simple y más correcta. Kafka gana cuando varios sistemas leen el mismo flujo o hace falta releerlo (M02).

:::diagrama colas-stream
Toca cada caja. Usa «Recorrer» para seguir un evento de C07 desde que el vendedor marca «vendido», un consumidor que se cae y un grupo nuevo que relee desde un offset.
:::

## Lag del consumidor: cuánto vas atrás {Consumer lag: how far behind you are}

Una cola o un stream que funciona no hace ruido. Uno que se atrasa, tampoco: no hay errores, solo datos cada vez más viejos. Por eso se mide el atraso.

El [[lag-consumidor|lag del consumidor]] (*consumer lag*) es cuánto va atrás un consumidor respecto de lo último que se escribió. En mensajes, es el último offset escrito menos el offset confirmado. Más útil es **en tiempo**: cuántos segundos de eventos le faltan por leer.

:::cuenta Un déficit de 10 % durante 10 minutos (M02)
Eventos que llegan | dato | 20,000 por segundo
Lo que procesa el grupo // 12 particiones, un consumidor cada una | 12 × ≈ 1,500 | 18,000 por segundo
Lo que crece el lag | 20,000 − 18,000 | 2,000 por segundo
Lag tras 10 minutos | 2,000 × 600 s | 1.2 M eventos
Lag en tiempo // lo atrasado entre lo que llega por segundo | 1.2 M ÷ 20,000 | ≈ 60 s
Agregar un consumidor número 13 // no hay partición que darle | — | 0 por segundo más
= El grupo va un minuto atrás, y cada minuto se atrasa 6 s más. Ninguna línea de log dice «error».
:::

En una cola como SQS no hay offsets, y el atraso se mide con la **edad del mensaje más viejo** (en SQS, `ApproximateAgeOfOldestMessage`). La profundidad sola, cuántos mensajes esperan, engaña: 50 mensajes pueden ser 2 minutos o 2 horas de atraso, según lo que tarde cada uno (M12).

### La alerta

Una alerta típica: **lag mayor que ≈ 60 s durante 5 minutos**. El «durante» importa: un lag que sube un momento después de un despliegue y se recupera solo no debería despertar a nadie. El umbral sale de la promesa del sistema: si C07 promete que un listing nuevo se pueda buscar en 5 minutos o menos, un lag de 3 minutos ya se come la mayor parte del margen.

### Escalar con la cola

El lag también sirve para decidir cuántos workers prender. En Kubernetes, el ajuste normal de copias (el HPA de la lección de async) mira la CPU, y la CPU no dice cuántos mensajes esperan. **KEDA** es un complemento que se instala en Kubernetes y escala según una métrica de afuera: la profundidad de una cola de SQS o el lag de Kafka.

:::cuenta Cuántos workers pide KEDA (M06)
Espera que se acepta en la cola // la promesa | dato | 300 s
Lo que tarda cada trabajo | dato | ≈ 20 s
Mensajes por worker // queueLength en KEDA | 300 ÷ 20 | 15
Mensajes en la cola // visibles más en vuelo | dato | 120
Workers que pide | ⌈120 ÷ 15⌉ | 8
= Con 8 workers, el último de 15 mensajes espera 15 × 20 s ≈ 300 s: justo la promesa.
:::

La regla de M12: **escalar por cantidad, alertar por edad**. La cantidad reacciona rápido y prende workers; la edad dice cuándo la promesa está en peligro. Y el techo de workers lo pone tu presupuesto o tu cuota de GPUs, no el autoscaler.

:::profundo El mensaje venenoso que no envejece la cola
M12 trae una trampa de SQS. En una cola estándar, un mensaje que se recibió 3 o más veces sin borrarse se mueve al final de la fila y deja de contar en la edad del mensaje más viejo: la métrica pasa a mirar el siguiente. Una imagen corrupta que tumba al worker una y otra vez no hace sonar la alerta de edad, aunque esté ocupando workers. Por eso la DLQ lleva su propia alerta, y por eso también se vigilan los reintentos por mensaje: en un sistema asíncrono, los mensajes en la DLQ y los reintentos por mensaje son lo que el porcentaje de errores 5xx es en uno síncrono.
:::

:::calculadora colas-lag
Prueba 14 consumidores con 12 particiones: no cambia nada. Prueba 1,800 eventos por segundo por consumidor: el grupo procesa 21,600 y el lag deja de crecer.
:::

## Colas a fondo: CDC, outbox y cuál elegir {Queues in depth: CDC, outbox and which one to pick} [extra]

### La escritura doble

Un servicio guarda un listing en su [[base-datos|base de datos]] y, además, quiere publicar el evento «listing 42 creado» en Kafka. Son dos escrituras en dos sistemas, y cualquiera puede fallar sola. Si la base guarda y Kafka no, el índice nunca se entera del listing. Si Kafka recibe y la base falla, el índice tiene un listing que no existe. Es el mismo trabajo huérfano de la lección de APIs.

Hay dos salidas, y las dos se apoyan en la [[transaccion|transacción]] de la base: un grupo de escrituras que se guarda completo o no se guarda (lo viste en la lección de bases de datos).

**El patrón outbox** («buzón de salida»): el servicio escribe el listing y el evento en la **misma** transacción, en una tabla aparte de la base, la *outbox*. Un proceso separado lee esa tabla y publica cada evento en el broker. Si la publicación falla, se reintenta; si se publica dos veces, el consumidor lo aguanta, porque es at-least-once.

**CDC.** El [[cdc|change data capture]] (captura de cambios) va más lejos: no toca el código del servicio. Toda base de datos seria anota cada cambio en su propio registro interno, para no perder nada si se va la luz y para que sus copias se pongan al día (en PostgreSQL es el WAL, *write-ahead log*; en MySQL, el binlog). Una herramienta de CDC, como Debezium, lee ese registro y publica cada inserción, cambio y borrado como un evento en Kafka (M09). Así, el resto del sistema se entera de lo que cambió en la base sin preguntarle cada rato y sin que el servicio publique nada.

| | Outbox | CDC |
|---|---|---|
| Qué se publica | Los eventos que el servicio decide | Cada cambio de cada fila |
| Toca el código del servicio | Sí: escribe en la outbox | No |
| Se usa para | Eventos de negocio: «publicación creada» | Copiar una base a otro lado: el lake, un índice |

### Cuál elegir

| | SQS | Pub/Sub | RabbitMQ | Kafka | Kinesis |
|---|---|---|---|---|---|
| Qué es | Cola administrada de AWS | Cola y stream de Google | Broker que instalas o rentas | Log particionado | Log administrado de AWS |
| ¿Se puede releer? | No: confirmar borra | Sí, si guardas los confirmados | En sus colas, no; en sus *streams*, sí | Sí, desde un offset | Sí, desde una posición |
| Orden | Sin garantía; FIFO por grupo | Opcional, por llave | Por cola, con un consumidor | Por partición | Por partición (*shard*) |
| Retención | 4 días; hasta 14 | 7 días; hasta 31 | En una cola, hasta que se consume | 7 días; configurable | 24 h; hasta 365 días |
| Lo que operas | Casi nada | Casi nada | Las máquinas | Un cluster, o pagas el servicio | Casi nada |

La regla de la Ronda: **cola de trabajos para repartir trabajos; stream cuando varios sistemas leen lo mismo o hace falta releer**. Y no inventes infraestructura: en M01, un sistema de 5 requests por segundo (≈ 430 mil al día) no justifica Kafka, y C01, con su pico de 500, tampoco necesita un sistema de colas para el camino online.

Dos matices que te pueden preguntar. Pub/Sub hace de cola y de stream, pero no tiene particiones que tú controles ni offsets que puedas regresar a cualquier punto (M13). Y Kafka trae los *share groups* (KIP-932, «colas para Kafka»; un KIP es una propuesta formal de cambio a Kafka), con ack por mensaje, conteo de entregas y más consumidores que particiones: llegaron a prueba en Kafka 4.0 (2025) y la versión 4.2 (febrero de 2026) los declaró listos para producción. Kafka empieza a funcionar también como cola de trabajos. Aun así, para 50 trabajos por segundo, una cola administrada sigue siendo más simple.

### Qué lleva un mensaje

Un mensaje es como un sobre: adentro va el contenido (*payload*, la carga) y por fuera unos datos para el que lo recibe. Casi todos los brokers guardan, además del contenido, un id del mensaje, la hora en que llegó, cuántas veces se ha entregado y unos atributos que pone el productor, parecidos a los [[header|headers]] de HTTP. En Kafka, cada evento lleva su llave, su valor, sus headers y su hora.

Tres costumbres que la Ronda da por hechas:

- **Un id propio en el contenido**, como el `job_id` o el id del evento. El del broker cambia si el productor reintenta; el tuyo no, y es el que sirve para descartar repetidos.
- **La hora en que pasó**, no solo la hora en que llegó. Un pago que tardó 30 s en llegar cuenta en el minuto en que se hizo: lo verás en la lección de tiempo y hashes.
- **Un formato con esquema.** C09 escribe sus eventos en [[avro|Avro]], un formato binario con un esquema que dice qué campos lleva cada evento (lo viste en la lección de formatos). Si el productor cambia el formato sin avisar, todos los consumidores se rompen a la vez; con un esquema versionado, se nota antes.

### El orden en una cola

Una cola estándar de SQS no promete orden: reparte los mensajes entre muchas máquinas y los entrega más o menos como llegaron. Casi nunca importa: el PDF 8f3a y el 8f3b no dependen uno del otro. Cuando sí importa, se pide orden **por entidad**, igual que en Kafka: SQS FIFO ordena los mensajes que comparten un `MessageGroupId`, Pub/Sub los que comparten un *ordering key*. En SQS FIFO, mientras un mensaje de un grupo está en vuelo, el siguiente de ese grupo no sale hasta que el anterior se confirme o vuelva a la cola; en Pub/Sub, si un mensaje se reentrega, se reentregan también los que venían detrás con su misma llave. Por eso el orden se paga con menos paralelismo, y una cola FIFO aguanta menos que una estándar: sin su modo de alto rendimiento, 300 llamadas por segundo de cada tipo (enviar, recibir, borrar), o 3,000 mensajes si van en lotes de 10, según la documentación de AWS de 2026.

### Cuando el trabajo tiene varios pasos

Un documento de C05 pasa por varias etapas: revisar la calidad de la foto, leerla con OCR, extraer los campos, consultar al SAT (el servicio de impuestos de México) y, si algo sale dudoso, esperar a que una persona lo revise. Encadenar cinco colas a mano funciona, pero nadie sabe en qué paso va cada documento ni qué reintentar.

Para eso existen los **orquestadores de flujos de trabajo** (*workflow orchestrators*): Step Functions de AWS, Temporal o, para trabajos programados como el reentrenamiento de cada mes, Airflow y Argo Workflows. Guardan el estado de cada trabajo, reintentan cada paso con su propio límite y pueden esperar días a una persona. Por dentro usan colas; por fuera, te dan el trabajo completo como una sola cosa con su historial. La regla de M02: una cola para un paso; un orquestador cuando hay pasos, estados y esperas largas.

:::profundo Celery, Redis y las colas «de mentiras»
En Python es común repartir tareas con Celery, una biblioteca que usa [[redis|Redis]] (la base de datos llave-valor en memoria de la lección de bases de datos) o RabbitMQ como broker. Con Redis, el broker vive en la memoria de un servidor: es rápido, pero si Redis se cae sin haber guardado a disco, los mensajes se pierden. Y Celery con Redis tiene su propio visibility timeout de 1 hora: si las tareas confirman al final (`acks_late`), una que tarda más de una hora se entrega otra vez y corre dos veces. La lección es la de siempre: antes de confiar en una cola, pregunta dónde guarda los mensajes y qué pasa con uno en vuelo cuando el worker se cae.
:::

## Errores comunes {Common mistakes}

### 1. Un visibility timeout más corto que el trabajo

El trabajo tarda 10 minutos y el plazo es de 30 segundos: el mensaje reaparece, otro worker lo toma y en 10 minutos hay 20 copias del mismo trabajo. No hay errores, solo una cuenta de GPU enorme.

**Cómo evitarlo:** un plazo mayor que el p99 del trabajo, con margen (el doble), y un latido que lo renueve si el trabajo es largo o variable.

### 2. Suponer que cada mensaje llega una sola vez

Un consumidor que suma 1 por cada mensaje, manda un correo o cobra, procesa los repetidos como si fueran nuevos. Con 5 % de caídas, salen ≈ 60 efectos de más por cada 1,000 trabajos.

**Cómo evitarlo:** consumidores idempotentes: resultado en una llave fija, upsert, o ids procesados guardados junto con el efecto. Escribe «es at-least-once» en el diseño.

### 3. Cola sin DLQ

Un mensaje venenoso tumba workers para siempre, o hasta que vence su retención. Mientras, ocupa la capacidad que necesitan los demás.

**Cómo evitarlo:** un `maxReceiveCount` (por ejemplo, 5), una DLQ con retención más larga que la cola, y una alerta cuando la DLQ tiene más de 0 mensajes, con una persona a cargo de revisarla.

### 4. Más consumidores que particiones

El lag de Kafka crece y se agregan consumidores. Si ya hay uno por partición, los nuevos se quedan sin nada que leer.

**Cómo evitarlo:** elegir el número de particiones por el paralelismo que vas a necesitar, con margen, desde el principio. Para escalar de verdad: consumidores más rápidos o más particiones.

### 5. Vigilar solo la profundidad de la cola

«Hay 50 mensajes» no dice si son 2 minutos o 2 horas de atraso. Y un mensaje venenoso puede quedarse atorado sin que la profundidad cambie.

**Cómo evitarlo:** alertar por la edad del mensaje más viejo, o por el lag en segundos, sostenido unos minutos. Escalar por cantidad está bien; alertar, por edad.

### 6. Usar una cola para algo que alguien está esperando

Meter la request de Ana en una cola agrega latencia, polling y piezas, para un trabajo de milisegundos con un fallback que ya existe. La Ronda lo descarta en C01.

**Cómo evitarlo:** primero la pregunta «¿alguien espera?». Si sí, síncrono con timeout y fallback; la cola es para lo que puede esperar segundos, minutos u horas.

## En la vida real {In real life} [extra]

### C01: la cola está en el backfill, no en el camino de Ana

C01 responde a Ana de forma síncrona: «una cola asíncrona agregaría complejidad sin beneficio para este flujo», dice la Ronda. Pero la misma Ronda dice que **la cola sí es la forma correcta para el backfill** y para los equipos que mandan lotes.

El backfill clasifica ≈ 200 M de fotos viejas, en ≈ 2,000 pedazos (*shards*) de ≈ 100,000 fotos. Cada shard puede ser un mensaje en una cola. Con 4 máquinas de 1,000 fotos por segundo, el total tarda ≈ 200 M ÷ 4,000 ≈ 50,000 s ≈ 14 h, y cada shard ≈ 100 s. Las máquinas son *spot*, más baratas pero reclamables (en AWS, con 2 minutos de aviso): si una desaparece, su shard vuelve a la cola al vencer su plazo (unos minutos, con latido) y otra lo repite. Se pierden, a lo mucho, ≈ 100 s de trabajo por máquina. Como escribir la categoría de una foto es idempotente, repetir un shard no daña nada.

El log de predicciones de C01 no usa un broker: cada línea va a la salida del programa y otro programa la lleva a S3, el [[object-storage|object storage]] de AWS. La respuesta no espera al log. Y el etiquetado es una cola de otro tipo: ≈ 5,000 fotos al mes que esperan a una persona.

### C07: búsqueda que se entera en minutos

Los cambios del catálogo entran a un tópico de Kafka con llave `listing_id`, así los eventos de un mismo listing llegan en orden. Cada versión del índice lee con su propio grupo de consumidores, `embed-worker-v7`; para estrenar la v8, un grupo nuevo relee desde el offset de un [[snapshot]], la foto fija del catálogo con la que se armó el índice nuevo. Una foto que no se puede bajar va a una DLQ con su motivo: un error nunca bloquea la partición. La alerta: lag de más de 3 minutos durante 10, y los workers escalan por lag.

### C09 y C04: el stream chico y la cola que pagina

En C09, cada transacción deja ≈ 3 KB en Kafka entre evento y decisión. En el pico, 2,000 × 3 KB ≈ 6 MB/s, 18 MB/s con 3 copias: Kafka chico, y está bien. Lo eligen porque varios lo leen (Flink, el programa que calcula las features de fraude sobre el stream; el sink al lake; el monitoreo) y porque se puede releer durante 7 días. Flink reprocesa tras una falla (at-least-once) y escribe el valor de cada ventana, no una suma, para que repetir sea inofensivo.

En C04, cada imagen de patología es un mensaje en la cola `slide-jobs`. Después de 3 intentos va a la DLQ, que alerta con más de 0. Y la alerta de atraso no mira cuántos mensajes hay, sino su edad: con 170 imágenes por hora, 85 en la cola son ≈ 30 minutos de espera.

### C05: un documento que nunca se pierde

C05 lee facturas y contratos: ≈ 5,000 documentos al día, ≈ 12,000 páginas, de las que solo ≈ 6,200 necesitan OCR. En el pico son ≈ 0.6 páginas por segundo: cabe en CPU, sin GPUs. Lo difícil no es la capacidad sino la promesa: **ningún documento se pierde**. Cada documento es un flujo de trabajo con su estado, reintentos por etapa, un estado de falla con su motivo y un paso que espera a una persona cuando un campo sale dudoso. Las consultas al SAT se reintentan, y el aviso al cliente es at-least-once.

### C08: el log que entrena al modelo de mañana

C08 recomienda publicaciones en la portada. Cada respuesta deja un registro con las 50 publicaciones que vio el usuario y las features que usó el modelo, ≈ 22 KB. Con ≈ 90 M respuestas al día, 90 M × 22 KB ≈ 2 TB al día por Kafka. Con ese log se entrena el modelo de mañana, así que perderlo es un problema de datos, no de latencia. La respuesta no espera a Kafka: el productor guarda en un buffer en memoria y, si se llena, descarta y **cuenta** lo descartado. La Ronda avisa que esa pérdida es silenciosa y sesgada: pasa en los picos, cuando más tráfico hay. Por eso tiene su alerta: más de 0.1 % de pérdida, o el consumidor que une cada impresión con lo que el usuario hizo después (clicks, contactos) con más de 15 minutos de lag.

### Fuera de ML: la cocina de un restaurante

Las comandas que el mesero cuelga en la ventanilla son una cola: el mesero no espera al cocinero, varios cocineros toman comandas, y una comanda que nadie terminó sigue colgada. El ticket de la caja, en cambio, es un log: la cocina, la contabilidad y el inventario leen el mismo registro, cada uno a su ritmo.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de picos y lag se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Para cada trabajo di si lo harías síncrono, con una cola de trabajos o con un stream de eventos: (a) la categoría de los tenis de Ana; (b) transcribir un audio de una hora; (c) que el índice, el data lake y el monitoreo se enteren de cada venta; (d) mandarle a un vendedor el correo «tu publicación tiene 20 vistas».
- (a) **Síncrono**: Ana está esperando en el formulario.
- (b) **Cola de trabajos**: tarda minutos y nadie mira la pantalla. La API responde 202 y un worker lo hace.
- (c) **Stream**: tres sistemas leen el mismo evento, cada uno a su ritmo. Con una cola, el primero que confirma lo borra.
- (d) **Cola de trabajos**: un trabajo por correo, que se reparte entre workers. Con un consumidor idempotente, para no mandar el correo dos veces.
? [facil] Un worker recibe un mensaje y confirma **antes** de procesarlo. Se cae a la mitad. ¿Qué garantía de entrega es y qué le pasó al trabajo? ¿Y si confirma después?
- Ack antes es **at-most-once**: el mensaje ya se borró, así que el trabajo **se perdió**.
- Ack después es **at-least-once**: el mensaje vuelve al vencer su plazo y otro worker lo hace. No se pierde, pero puede repetirse si el primero alcanzó a terminar.
? [facil] Un tópico tiene 12 particiones. Un grupo de consumidores tiene 20 copias. ¿Cuántas leen algo? Y si otro grupo lee el mismo tópico, ¿qué eventos recibe?
- Cada partición la lee un solo consumidor del grupo: **12 leen, 8 se quedan sin nada**.
- El otro grupo tiene sus propios offsets y recibe **todos** los eventos del tópico, sin estorbar al primero.
? [facil] En la cola de C04 llegan 170 imágenes por hora y hay 85 esperando. ¿Cuánto espera, más o menos, la que acaba de llegar? ¿Qué ley usaste?
- La ley de Little: tiempo = lo que hay adentro ÷ lo que sale por unidad de tiempo. Si en equilibrio sale lo mismo que entra, 85 ÷ 170 por hora = **0.5 h ≈ 30 min**.
? [medio] Un trabajo de OCR tarda en su p99 4 minutos. La cola tiene el plazo por omisión de SQS, 30 s. ¿Qué pasa? ¿Qué plazo pondrías? Si a veces tarda 40 minutos, ¿qué cambias?
- A los 30 s el mensaje reaparece aunque el worker siga trabajando: otro lo toma, y a los 60 s otro más. Hasta **8 copias** en 4 minutos (240 ÷ 30).
- Plazo: el doble del p99, **8 minutos**.
- Si a veces tarda 40, un plazo de 80 minutos haría que un worker muerto tarde 80 en liberar el mensaje. Mejor un **latido**: plazo de unos minutos, renovado a la mitad mientras el worker vive.
? [medio] Los workers de una cola estuvieron caídos 20 minutos mientras entraban 50 trabajos por segundo. ¿Cuántos se juntaron? Si al volver procesan 200 por segundo, ¿en cuánto se vacía la fila? ¿Y si solo procesan 60?
- Se juntaron 50 × 1,200 s = **60,000**.
- Mientras se vacía siguen llegando 50: el ritmo neto es 200 − 50 = 150 por segundo. 60,000 ÷ 150 = **400 s ≈ 7 min**.
- Con 60: neto 10 por segundo. 60,000 ÷ 10 = **6,000 s = 100 min**. La capacidad de sobra es lo que vacía una fila.
? [medio] Con KEDA, `queueLength` en 15 (cada trabajo tarda ≈ 20 s) y un máximo de 8 workers, llegan de golpe 400 mensajes. ¿Cuántos workers pediría KEDA sin máximo? ¿Cuánto espera el último con 8? ¿Se cumple una promesa de 300 s?
- Sin máximo: ⌈400 ÷ 15⌉ = **27 workers**.
- Con 8: a cada worker le tocan 400 ÷ 8 = 50 mensajes, y el último espera ≈ 50 × 20 s = **1,000 s ≈ 17 min**.
- **No se cumple** la promesa de 300 s. El techo de 8 es una decisión de costo: o se sube, o se acepta el atraso y se avisa con la alerta de edad.
? [medio] Un mensaje venenoso vive en una cola con visibility timeout de 15 minutos y `maxReceiveCount` de 5. ¿Cuánto tarda en llegar a la DLQ si cada intento se cuelga hasta el plazo? ¿Y con un plazo de 3 minutos renovado por latido mientras el worker vive, si el worker se cae al abrir el archivo?
- 5 × 15 min = **75 minutos** de workers ocupados.
- Con latido, el worker muerto deja de renovar y el mensaje vuelve a los 3 minutos como mucho: 5 × 3 = **15 minutos**. El latido ayuda también aquí.
? [reto] El grupo de la sección del lag procesa 18,000 eventos por segundo con 12 particiones, y llegan 20,000. Lleva 10 minutos atrasado (1.2 M eventos). Compara dos arreglos: (a) un consumidor más rápido, de 1,800 por segundo; (b) un tópico de 24 particiones con 24 consumidores de 1,500. ¿En cuánto recupera cada uno el atraso?
- (a) 12 × 1,800 = 21,600 por segundo. Sobran 1,600: 1.2 M ÷ 1,600 = **750 s ≈ 12.5 min**.
- (b) 24 × 1,500 = 36,000. Sobran 16,000: 1.2 M ÷ 16,000 = **75 s**.
- (b) recupera 10 veces más rápido, pero cambiar las particiones de un tópico que ya existe mueve qué llave cae en qué partición, y con eso el orden por llave durante el cambio. Por eso se eligen con margen desde el principio.
? [reto] El sink de C09 lee pagos de Kafka y suma 1 al contador «pagos de esta tarjeta en la última hora». Después de un rebalanceo, el contador de una tarjeta marca 9 cuando hubo 6 pagos, y el modelo de fraude la bloquea. ¿Qué pasó y cómo lo arreglas?
- Un consumidor procesó 3 pagos, se cayó antes de hacer commit de su offset, y el que heredó la partición los **releyó**: at-least-once. Cada relectura sumó 1 otra vez.
- Arreglo 1: **escribir el valor, no sumar**. El sink calcula el conteo de la ventana a partir de los eventos y escribe «6» con un upsert por (tarjeta, ventana). Repetirlo deja 6.
- Arreglo 2: **descartar por id de evento** antes de contar, guardando el id junto con el cambio.
- Lo que no arregla: «confirmar antes». Eso cambia repetidos por huecos, y en fraude un pago perdido es un ataque que no se ve.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M02 · Patrones de inferencia** dedica dos secciones a esta lección: «Asíncrona con colas» (el 202, el visibility timeout, la tabla de qué cola usar, el backlog de 60,000) y «Entrega, reintentos e idempotencia» (at-least-once, la DLQ, el orden por llave). Y «Streaming» trae el lag de 60 s.
- **M06 · Orquestación y escalado** escala los workers con KEDA por la profundidad de SQS o el lag de Kafka, y explica el SIGTERM que termina el mensaje actual.
- **M12 · Monitoreo** alerta por la edad del mensaje más viejo y por la DLQ, y muestra el mensaje venenoso que no envejece la cola.
- **Los casos.** C01 (backfill en shards), C04 (cola de imágenes con DLQ), C07 (Kafka por listing y grupos por versión) y C09 (Kafka chico con Flink).

**En el Dojo:** la estación 12, «Monitoreo y reentrenamiento», junta las fotos nuevas y las etiquetas para el siguiente entrenamiento, el trabajo que puede esperar por excelencia. Cuando abra, ahí lo vas a practicar.

**En Sensei:** la siguiente lección, «Tiempo, hashes e identificadores», explica la función hash que decide la partición, los ids únicos que sirven para descartar repetidos y por qué un evento que llega tarde cuenta en la hora en que pasó.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
cola-mensajes productor consumidor broker stream-eventos topico particion-topico offset grupo-consumidores at-least-once at-most-once exactly-once visibility-timeout dlq lag-consumidor cdc
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué gana un sistema al poner una cola entre el productor y el consumidor?
Que el productor no espera: deja el mensaje y sigue. El consumidor trabaja a su ritmo, se reparte entre varios workers y, si se cae, el trabajo no se pierde. La cola absorbe los picos, siempre que en promedio se procese más de lo que llega.
? ¿Por qué un broker no borra un mensaje en cuanto lo entrega?
Porque el worker puede caerse a la mitad. Lo esconde durante el visibility timeout; si llega el ack, lo borra, y si no, el mensaje vuelve a la cola para otro worker.
? ¿Por qué «al menos una vez» es la entrega normal, y cómo se logra el efecto de «exactamente una vez»?
Porque el broker no distingue «no lo hizo» de «lo hizo y no avisó», y ante la duda reentrega. El efecto de una vez sale de at-least-once con un consumidor idempotente: resultado en una llave fija, upsert, o ids descartados.
? ¿Qué es una DLQ y para qué sirve?
La cola a la que van los mensajes que fallaron N veces (maxReceiveCount). Saca al mensaje venenoso del camino para que no tumbe workers para siempre, y tiene su propia alerta.
? ¿En qué se diferencia un stream de eventos de una cola de trabajos?
En la cola, confirmar borra el mensaje y cada uno lo procesa un solo worker. En el stream, leer no borra nada: cada grupo lleva su offset, varios sistemas leen todo a su ritmo y se puede releer dentro de la retención.
? Un tópico tiene 8 particiones y el lag crece. ¿Sirve poner 16 consumidores en el grupo?
No: cada partición la lee un solo consumidor del grupo, así que 8 se quedarían sin nada. Hay que hacer más rápido a cada consumidor o tener más particiones.
:::
