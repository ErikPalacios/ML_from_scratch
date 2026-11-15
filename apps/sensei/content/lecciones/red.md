---
titulo: Cómo viaja un mensaje: IP, puertos y DNS
en: How a message travels: IP, ports and DNS
subtitulo: Qué pasa entre el «publicar» de Ana y el gateway de Alba: la foto partida en paquetes, la dirección de cada máquina, el puerto de cada programa, la conexión que no pierde nada, el tiempo que cobra la luz y el directorio que convierte nombres en direcciones.
pregunta: Cuando Ana toca «publicar», ¿cómo llega su foto del celular al gateway de Alba, y cómo sabe la red a qué máquina y a qué programa ir?
requisitos: camino-completo, programa-proceso
---

:::idea
Un mensaje viaja por la red partido en paquetes, y cada paquete lleva escritas dos cosas: la dirección IP de la máquina a la que va y el puerto del programa que lo espera. TCP los junta en orden y reenvía los que se pierden; el DNS convierte los nombres en direcciones. Todo eso cuesta idas y vueltas, y ninguna puede ser más rápida que la luz.
:::

Ana vende en Alba, la empresa que seguimos en todo el curso: un marketplace que recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Ana está en la Ciudad de México y toca «publicar». La foto de sus tenis pesa ≈ 3 MB en su celular; la app la achica a ≈ 200 KB, la manda y, poco después, le sugiere «Tenis». En medio, la foto cruzó unos 3,000 km hasta el norte de Virginia, en Estados Unidos, donde viven las máquinas de Alba: las del marketplace y las del clasificador, el servicio que le pone categoría a la foto. El programa del clasificador que recibe la foto y la prepara para el modelo se llama **gateway**.

En «El camino completo» seguiste ese viaje desde arriba: la request entra, el modelo responde. Aquí vas a abrir la parte que se dio por hecha: **la red**. Tres preguntas guían la lección:

- **¿A qué máquina va?** Hay miles de millones de aparatos conectados. ¿Cómo encuentra la foto el correcto?
- **¿A qué programa?** En una máquina corren muchos [[proceso|procesos]]. ¿Cómo llega la foto al gateway y no a otro?
- **¿Cómo no se pierde nada?** La red pierde y desordena pedazos. ¿Cómo llega la foto completa y en orden?

Al final vas a poder seguir la foto salto por salto, con los números del sistema de Alba, y vas a entender por qué un servidor que «corre bien» en un contenedor a veces no contesta.

## Protocolos y paquetes: la foto viaja en pedazos {Protocols and packets: the photo travels in pieces}

### Un protocolo es un acuerdo

Para que dos computadoras se entiendan, las dos tienen que seguir las mismas reglas: qué se manda primero, cómo se escribe cada dato, qué se contesta y qué se hace si algo falla. Ese acuerdo se llama [[protocolo]] (*protocol*).

Es como una llamada por teléfono. Quien contesta dice «¿bueno?», quien llamó dice quién es, hablan por turnos y se despiden antes de colgar. Nadie lo escribió en un contrato, pero si alguien no lo sigue, la llamada se vuelve confusa. La analogía se rompe en un punto: las personas improvisan y aun así se entienden. En la red el acuerdo está escrito, en documentos públicos que se llaman RFC (*Request for Comments*), y cada programa lo sigue al pie de la letra: un byte fuera de lugar y el otro lado ya no entiende.

En esta lección vas a conocer cuatro protocolos: **IP**, que lleva cada pedazo a la máquina correcta; **TCP** y **UDP**, que lo llevan al programa correcto; y el **DNS**, que traduce nombres en direcciones. Arriba de ellos va [[http|HTTP]], el protocolo de las páginas web y de las APIs, que es el tema de la siguiente lección.

### Un paquete: encabezado y carga

La red no manda la foto de una sola pieza. La parte en pedazos, y cada pedazo viaja por su cuenta dentro de un [[paquete-red|paquete]] (*packet*). Un paquete tiene dos partes:

- **El encabezado** (*header*): unos bytes al principio con los datos del viaje. De dónde viene, a dónde va, qué número de pedazo es.
- **La carga** (*payload*): el pedazo de foto.

¿Por qué en pedazos? Por tres razones. Una foto de 3 MB ocuparía el cable un buen rato y nadie más podría usarlo; en pedazos, los paquetes de muchas personas se turnan. Si se daña un pedazo, se reenvía solo ese, no la foto completa. Y cada pedazo puede tomar el camino que esté libre.

¿De qué tamaño? En casi todas las redes, un paquete lleva como máximo **1,500 bytes**. Ese tope se llama MTU (*maximum transmission unit*). Del total, 40 bytes son encabezados (20 del protocolo IP y 20 del protocolo TCP, que vas a conocer en las siguientes secciones), así que de foto caben **1,460 bytes** por paquete.

Para saber cuántos paquetes ocupa algo, divide su tamaño entre lo que cabe de datos en cada paquete:

:::formula Paquetes de un archivo
D = M − E
P = ⌈frac{S}{D}⌉
H = P × E
- S: el tamaño de lo que se manda, en bytes
- M: el tope de un paquete, el MTU: 1,500 bytes
- E: los encabezados de cada paquete: 40 bytes (20 de IP y 20 de TCP)
- D: los bytes de datos que caben en cada paquete: 1,500 − 40 = 1,460
- P: los paquetes. ⌈ ⌉ quiere decir «redondea hacia arriba»: el pedazo que sobra también ocupa un paquete
- H: los bytes de encabezados que viajan en total, en bytes
:::

Haz la cuenta con el original de la foto de Ana, los 3 MB que guarda su celular. Así llegan las fotos que los vendedores suben desde la computadora, sin achicar:

:::cuenta La foto original de Ana, en paquetes
Foto original del celular, \(S\) | — | 3,000,000 bytes
Datos por paquete, \(D\) // 1,500 de tope menos 40 de encabezados | \(D = M − E\) = 1,500 − 40 | 1,460 bytes
Paquetes, \(P\) | \(P = ⌈S/D⌉\) = ⌈3,000,000 ÷ 1,460⌉ = ⌈2,054.8⌉ | 2,055
El último paquete // lo que sobra después de 2,054 llenos | 3,000,000 − 2,054 × 1,460 | 1,160 bytes
Encabezados en total, \(H\) | \(H = P × E\) = 2,055 × 40 | 82,200 bytes
Parte que son encabezados // \(H\) entre todo lo que viaja, \(S + H\) | 82,200 ÷ 3,082,200 | ≈ 2.7 %
= Una sola foto original son 2,055 paquetes, y ≈ 2.7 % de lo que viaja son encabezados. El JPEG de ≈ 200 KB que de verdad manda la app de Ana, ya achicado, son ⌈200,000 ÷ 1,460⌉ = 137.
:::

:::figura red-paquetes
La foto original partida en paquetes. Cada uno lleva su encabezado, con su número y su destino, y un pedazo de foto. En el camino, cada router lee solo el encabezado.
:::

### Los routers: reenviar sin abrir

Entre el celular de Ana y Virginia hay una o dos decenas de aparatos que se pasan los paquetes de mano en mano. Cada uno es un **router** (enrutador): una computadora especializada que recibe un paquete, lee a dónde va y lo manda al siguiente aparato que lo acerca a su destino. A cada paso de un router al siguiente se le dice **salto** (*hop*).

El router no abre la carga ni le importa que sea una foto. Lee el destino en el encabezado, lo busca en su tabla y lo reenvía, en millonésimas de segundo. Por eso internet aguanta tanto tráfico: nadie en el camino entiende el mensaje completo; solo los dos extremos.

Esto tiene una consecuencia que vas a ver toda la lección. Como cada paquete viaja solo, **pueden llegar en otro orden, llegar repetidos o no llegar**: un router saturado tira los que no le caben. Alguien tiene que juntarlos, ordenarlos y pedir los que faltan. Eso lo hace TCP, más abajo.

## Direcciones IP: a qué máquina va {IP addresses: which machine it goes to}

### Una dirección de 32 bits

Para que el router sepa a dónde mandar un paquete, cada aparato conectado tiene un número que lo identifica en la red: su [[direccion-ip|dirección IP]] (*IP address*). IP es el *Internet Protocol*, el protocolo que lleva cada paquete de máquina en máquina.

En la versión 4 del protocolo, **IPv4**, la dirección es un número de **32 [[bit|bits]]**: 4 [[byte|bytes]]. Para que las personas la lean, se escribe cada byte en decimal, del 0 al 255, separado por puntos: `192.168.1.20`. Son los mismos 4 bytes de la lección «Cómo guarda números una computadora», escritos de otra manera.

Con 32 bits hay 2³² = **4,294,967,296** direcciones: unos 4.3 mil millones. Parecían muchísimas en 1981, cuando se diseñó IPv4. Hoy hay más personas que eso en el mundo, y cada una trae celular, computadora y tele. Las direcciones libres se acabaron: el organismo que las reparte entregó sus últimos bloques en 2011.

La salida de fondo es **IPv6**, con direcciones de **128 bits**: 2¹²⁸ ≈ 3.4 × 10³⁸, suficientes para no acabarse nunca. Las dos versiones conviven, y en esta lección usamos IPv4, que es la que vas a ver en casi todos los ejemplos.

:::profundo Cómo se ve una dirección IPv6
Las direcciones IPv6 se escriben en hexadecimal (con los símbolos del 0 al 9 y de la a a la f, como viste en «El sistema operativo»), en 8 grupos de 4 símbolos, y los ceros se pueden abreviar: `2001:db8::1`. Casi todo internet habla IPv4, y cada vez más también IPv6. En 2026, según las mediciones de Google, cerca de la mitad de sus usuarios ya llega por IPv6.
:::

### Una dirección también dice en qué red está

Una dirección IP tiene dos partes, como un número de teléfono con su lada: los primeros bits dicen **en qué red** está la máquina y los últimos, **qué máquina** es dentro de esa red. Una red se escribe con su primera dirección y, después de una diagonal, cuántos bits quedan fijos: `10.0.0.0/8` son todas las direcciones que empiezan con el byte 10. Quedan 24 bits libres: 2²⁴ = 16,777,216 direcciones. `192.168.1.0/24` deja fijos 3 bytes y libre el último: 256 direcciones. A diferencia de la lada, el corte entre red y máquina no se adivina viendo el número: lo dice la diagonal.

A los routers les sirve muchísimo: no guardan una fila por cada máquina del mundo, sino una por red. «Todo lo que empiece con 10.0 va por la puerta 2».

### IP privada y pública

No todas las direcciones salen a internet. Tres rangos están apartados para redes internas, y cualquiera puede usarlos adentro sin pedirle permiso a nadie:

| Rango | Va de | Direcciones |
|---|---|---|
| `10.0.0.0/8` | 10.0.0.0 a 10.255.255.255 | 16,777,216 |
| `172.16.0.0/12` | 172.16.0.0 a 172.31.255.255 | 1,048,576 |
| `192.168.0.0/16` | 192.168.0.0 a 192.168.255.255 | 65,536 |

Una dirección de esos rangos es una [[ip-privada|IP privada]]: vale solo dentro de su red, y la misma `192.168.1.20` existe en millones de casas a la vez. Todas las demás son **IP públicas**: únicas en el mundo y alcanzables desde internet.

Tu casa es el ejemplo. Tu router le da a cada aparato una IP privada, `192.168.1.x`, y él tiene una sola IP pública que le dio tu proveedor. Cuando tu celular sale a internet, el router cambia en cada paquete la dirección privada por la pública y anota el cambio, para saber a quién devolver la respuesta. Esa traducción se llama [[nat|NAT]] (*network address translation*). Así, una IP pública alcanza para toda la casa. Las compañías de celulares hacen lo mismo en grande: en IPv4, el celular de Ana casi seguro tiene una IP privada, y miles de celulares salen por la misma pública.

En la nube pasa igual. Las máquinas de Alba viven en una red privada de AWS (*Amazon Web Services*, la nube de Amazon) con direcciones como `10.0.3.15`, y desde internet no se pueden alcanzar: solo la puerta de entrada tiene IP pública. Esa red privada en la nube se llama [[vpc|VPC]], y la vas a armar en la lección «Redes en la nube: VPC, subredes y egress». En Kubernetes, además, cada *pod* (cada copia de un programa) recibe su propia IP privada al nacer y la pierde al morir: la siguiente copia tendrá otra.

:::profundo Las direcciones, en Python
El módulo `ipaddress` de la biblioteca estándar lee direcciones, las muestra en binario y dice de qué tipo son:

```python
import ipaddress

for texto in ("192.168.1.20", "10.0.3.15", "172.20.0.7", "8.8.8.8", "127.0.0.1"):
    ip = ipaddress.ip_address(texto)
    bits = ".".join(f"{b:08b}" for b in ip.packed)        # los 4 bytes, en binario
    tipo = "loopback" if ip.is_loopback else "privada" if ip.is_private else "pública"
    print(f"{texto:>12} → {bits}  {tipo}")

print("direcciones IPv4:", f"{2**32:,}")
print("direcciones IPv6:", f"{2**128:.2e}")
red = ipaddress.ip_network("10.0.0.0/8")
print("en 10.0.0.0/8 caben", f"{red.num_addresses:,}")
print("¿10.0.3.15 está en 10.0.0.0/8?", ipaddress.ip_address("10.0.3.15") in red)
```

```salida
192.168.1.20 → 11000000.10101000.00000001.00010100  privada
   10.0.3.15 → 00001010.00000000.00000011.00001111  privada
  172.20.0.7 → 10101100.00010100.00000000.00000111  privada
     8.8.8.8 → 00001000.00001000.00001000.00001000  pública
   127.0.0.1 → 01111111.00000000.00000000.00000001  loopback
direcciones IPv4: 4,294,967,296
direcciones IPv6: 3.40e+38
en 10.0.0.0/8 caben 16,777,216
¿10.0.3.15 está en 10.0.0.0/8? True
```

El 8.8.8.8 es un servidor público de DNS de Google, que verás más adelante. El 127.0.0.1 es especial: no es ni de tu casa ni de internet, es la máquina misma. (El `is_private` de Python cuenta como privados otros rangos reservados además de los tres de la tabla; por eso el código pregunta primero por loopback.)
:::

## Puertos y sockets: a qué programa va {Ports and sockets: which program it goes to}

### El puerto: un número para cada programa

La IP lleva el paquete a la máquina. Pero en la máquina de un pod del gateway corren varios procesos, y en la de Triton, el servidor que corre el modelo, también. ¿Cuál recibe el paquete?

Lo dice el [[puerto]] (*port*): un número de **16 bits**, del 0 al 65,535, que va en el encabezado junto a la IP. Cada programa que quiere recibir conexiones **se apunta en un puerto**, y el [[kernel]] le entrega lo que llegue a ese número. Si la IP es la dirección de un edificio, el puerto es el número del departamento.

Algunos puertos son famosos, porque cada protocolo tiene uno acordado:

| Puerto | Quién lo usa |
|---|---|
| 22 | SSH, para entrar a otra máquina a escribir comandos |
| 53 | DNS |
| 80 | HTTP, la web sin cifrar |
| 443 | HTTPS, la web cifrada: casi todo internet |
| 8000 | uvicorn, si no le dices otro; y el HTTP de Triton |
| 8001 · 8002 | Triton: gRPC (otra manera de pedirle predicciones, que verás en la lección de APIs) y métricas |
| 8080 | El gateway de Alba |

Los puertos del 0 al 1023 están reservados para los protocolos más conocidos, y en Linux solo [[root]] puede apuntarse en ellos, como viste en «El sistema operativo». (Docker y containerd 2.0, dos de los programas que arrancan contenedores, quitan esa regla dentro de ellos, pero la costumbre se quedó.) Por eso los programas propios, como el gateway con su 8080, usan puertos altos. Triton escucha en tres a la vez (el 8002 es para que Prometheus, el programa que junta las métricas de todos, las lea), así que **un programa puede tener varios puertos**; lo que no puede pasar, salvo con opciones especiales que aquí no hacen falta, es que dos programas de la misma máquina se apunten en el mismo puerto de la misma IP.

### El socket: la puerta que abre un proceso

Para hablar por la red, un proceso le pide al kernel un [[socket]]: un objeto del sistema operativo por donde entran y salen los bytes, igual que un archivo abierto. Se pide con [[syscall|syscalls]], las peticiones de un programa al kernel: `socket` para crearlo, `bind` para apuntarlo en una IP y un puerto, `listen` para esperar conexiones, `accept` para aceptar una y `connect` para conectarse a otro.

Con esas syscalls se ven los dos papeles de cualquier conversación por la red:

- El [[servidor]] llega primero y espera: hace `bind` en su puerto, `listen` y se queda en `accept`.
- El [[cliente]] (*client*) es quien **abre** la conexión: hace `connect` a la IP y al puerto del servidor.

Ser cliente o servidor no es un tipo de máquina: es un papel en una conexión. El gateway de Alba es servidor cuando le llega la foto y cliente cuando le habla a Triton.

El cliente también necesita un puerto, para que la respuesta tenga a dónde volver. No lo elige: el kernel le presta uno libre de un rango alto, un **puerto efímero** (*ephemeral port*), que dura lo que dure la conexión. En Linux, por omisión, sale del 32,768 al 60,999. (El organismo que reparte los números, la IANA, recomienda otro rango, del 49,152 al 65,535, y Windows usa ese.)

Así, una conexión queda identificada por **cuatro números**: IP y puerto del cliente, IP y puerto del servidor. Por eso un solo puerto 8080 atiende miles de conexiones a la vez: todas llegan al mismo puerto del servidor, pero cada una viene de una IP o de un puerto de cliente distinto.

:::profundo Un servidor y un cliente en Python
Así se ve con el módulo `socket`, con un servidor y un cliente en la misma máquina. El cliente se conecta, manda unos bytes y recibe la respuesta:

```python
import socket, threading

servidor = socket.socket(socket.AF_INET, socket.SOCK_STREAM)   # IPv4 y TCP
servidor.bind(("127.0.0.1", 0))      # 0: que el sistema elija un puerto libre
servidor.listen()                    # ya es un servidor: espera conexiones
ip, puerto = servidor.getsockname()

def atender():
    conexion, (ip_cliente, puerto_cliente) = servidor.accept()
    with conexion:
        pedido = conexion.recv(1024)                  # lee lo que llegó
        print("servidor: recibí", pedido, "desde", ip_cliente)
        print("servidor: el cliente usa otro puerto:", puerto_cliente != puerto)
        conexion.sendall(b"categoria=tenis")

hilo = threading.Thread(target=atender)
hilo.start()

with socket.create_connection((ip, puerto)) as cliente:   # el handshake pasa aquí
    cliente.sendall(b"foto de Ana")
    print("cliente: me respondieron", cliente.recv(1024))
hilo.join()
servidor.close()
```

```salida
servidor: recibí b'foto de Ana' desde 127.0.0.1
servidor: el cliente usa otro puerto: True
cliente: me respondieron b'categoria=tenis'
```

El servidor corre en un [[hilo]] aparte para que el mismo programa pueda hacer de los dos lados. No imprimimos los puertos porque el kernel elige otros en cada corrida; lo que siempre se cumple es que el del cliente es distinto del del servidor. Así trabajan uvicorn y Triton por dentro, con muchas conexiones a la vez.
:::

### localhost y 0.0.0.0: dónde escucha un servidor

Cada máquina tiene una dirección para hablar consigo misma: **127.0.0.1**, que se llama [[localhost]]. Lo que se manda ahí no sale de la máquina: el kernel lo devuelve por dentro, por una puerta de red de mentiras que se llama *loopback*. En IPv6 es `::1`.

Una máquina tiene varias puertas de red, que se llaman **interfaces**: la de loopback, la del Wi-Fi o el cable, a veces más. Cada una tiene su IP. Por eso, al hacer `bind`, el servidor dice **en cuál** escucha:

- `127.0.0.1`: solo en loopback. Solo le pueden hablar los programas de la misma máquina.
- `0.0.0.0`: en **todas** las interfaces de la máquina. Le puede hablar quien llegue por cualquiera.

uvicorn, si no le dices otra cosa, escucha en `127.0.0.1:8000`. En tu laptop está bien, y es a propósito: si escuchara en todas, cualquiera en la red del café podría hablarle a tu programa a medio hacer.

Dentro de un contenedor es una trampa. En «El sistema operativo» viste que un contenedor tiene su propio *namespace* de red: sus propias interfaces y **su propio localhost**. El 127.0.0.1 de adentro no es el de la máquina. Cuando Docker o Kubernetes mandan una request al contenedor, llega por su interfaz de red (en un pod, la de su IP privada, como `10.0.3.15`), no por loopback. Si uvicorn escucha en 127.0.0.1, nadie escucha en esa interfaz, y la conexión se rechaza.

:::figura red-escuchar
Las dos puertas de un contenedor. Escuchando en 127.0.0.1, uvicorn solo atiende la de adentro y la request de afuera se rechaza. Escuchando en 0.0.0.0, atiende las dos.
:::

Es el error clásico de «el contenedor corre, los logs dicen que todo está bien y no contesta». Por eso el gateway de Alba arranca con `uvicorn ... --host 0.0.0.0 --port 8080`.

:::profundo Cuando localhost sí sirve entre contenedores
Un pod de Kubernetes puede tener varios contenedores, y esos sí comparten el mismo namespace de red: entre ellos, localhost funciona. Alba podría usarlo: si el gateway y Triton vivieran en el mismo pod, se hablarían por localhost, sin red de por medio.
:::

## TCP y UDP: con conexión o sin ella {TCP and UDP: with or without a connection}

La IP lleva paquetes sueltos a una máquina, sin prometer nada: pueden perderse, llegar repetidos o desordenados. Sobre ella van dos protocolos que se encargan de llevarlos al programa, y que resuelven el problema de manera opuesta.

### TCP: una conexión confiable

[[tcp|TCP]] (*Transmission Control Protocol*) convierte esos paquetes sueltos en una **conexión**: una tubería entre dos programas por la que los bytes llegan **completos, sin repetirse y en el orden en que salieron**. Para lograrlo usa tres ideas:

:::pasos
1. Numerar
Cada paquete lleva el número de su primer byte dentro de la conversación: el **número de secuencia**. Del otro lado, TCP los acomoda por número, aunque lleguen desordenados, y tira los repetidos.
2. Acusar recibo
El que recibe contesta con un **acuse** (*acknowledgment*, ACK): «ya tengo todo hasta el byte 43,800». Un solo acuse confirma muchos paquetes.
3. Reenviar
Si un acuse no llega a tiempo, el que manda supone que el paquete se perdió y lo **reenvía**. El programa nunca se entera: solo ve los bytes llegar en orden, a veces un poco tarde.
:::

TCP también cuida no ahogar a nadie: si el que recibe va lento, le pide que espere, y si la red empieza a perder paquetes, manda menos. Esa parte está en la sección extra «Dentro de TCP».

### El handshake: tres pasos antes del primer byte

Antes de mandar datos, los dos lados tienen que ponerse de acuerdo: que los dos existen, que los dos escuchan y desde qué número empieza cada uno a contar. Eso se hace con un saludo de tres pasos, el [[handshake]] (*three-way handshake*):

:::pasos
1. SYN
El cliente manda un paquete sin datos con la marca SYN (de *synchronize*) y su número inicial: «¿hablamos? Yo empiezo a contar en tal número».
2. SYN-ACK
El servidor contesta con SYN y ACK a la vez: «recibí tu número; yo empiezo en este otro».
3. ACK
El cliente acusa recibo. La conexión está abierta, y en ese mismo momento el cliente ya puede mandar su request.
:::

:::figura red-handshake
Una conexión nueva, contada en el tiempo, con una ida y vuelta (un [[rtt|RTT]]) de 60 ms, un valor de ejemplo. Mira la columna de la izquierda: el primer RTT se va en el handshake, sin datos; la request sale en el segundo.
:::

Fíjate en el costo. Del SYN a recibir el SYN-ACK pasa una ida y vuelta completa, y en ella no viaja ni un byte de la foto. Esa ida y vuelta tiene nombre, RTT, y es el tema de la siguiente sección. **Una conexión nueva cuesta 1 RTT antes del primer byte.** Por eso los programas serios abren una conexión y la reusan para muchas requests.

:::profundo Cerrar una conexión, y el «connection refused»
Para cerrar, cada lado manda un paquete con la marca FIN («ya no voy a mandar más») y el otro lo acusa. Si un programa se muere sin cerrar, el kernel cierra sus conexiones por él: con FIN, o con un RST (*reset*) si le quedaban datos sin leer. Un RST quiere decir «esta conexión no existe»: es lo que contesta una máquina a un paquete de una conexión que no conoce (por ejemplo, después de reiniciarse) y también lo que recibes cuando nadie escucha en un puerto: el «*connection refused*» de la figura del contenedor.
:::

### UDP: mandar y olvidar

[[udp|UDP]] (*User Datagram Protocol*) hace lo mínimo. Agrega a cada paquete el puerto de origen y el de destino, en un encabezado de 8 bytes, y lo manda. No hay handshake, no hay acuses, no hay reenvíos ni orden. Si un paquete se pierde, se perdió.

¿Para qué querría alguien algo así? Para cuando **llegar tarde es peor que no llegar**:

- **Voz y videollamadas.** Si se pierde un pedazo de voz, reenviarlo no sirve: cuando llegue, la conversación ya va más adelante. Es mejor un microcorte que una pausa. Por eso las llamadas por internet usan UDP siempre que pueden.
- **Juegos en línea.** La posición de un jugador de hace 200 ms ya no importa; importa la de ahora.
- **El DNS.** Una pregunta y su respuesta caben en un paquete cada una. Hacer un handshake para eso costaría más que la pregunta. Si no llega respuesta, se vuelve a preguntar.
- **QUIC.** Un protocolo nuevo que va **encima** de UDP y hace él mismo lo que hacía TCP: numera, acusa y reenvía, pero a su manera. Es la base de HTTP/3. Por qué alguien reconstruiría TCP sobre UDP lo ves en la sección extra.

| | TCP | UDP |
|---|---|---|
| Conexión | Sí: handshake de 1 RTT | No |
| Llega todo | Sí: reenvía lo perdido | No: lo perdido se pierde |
| En orden | Sí | No |
| Encabezado | 20 bytes o más | 8 bytes |
| Lo usan | HTTP/1.1 y HTTP/2, la foto de Ana, el tensor de Alba, las bases de datos | Voz, video en vivo, juegos, DNS, QUIC (y con él, HTTP/3) |

Todo lo que viaja en el sistema de Alba, de la foto al tensor y a la respuesta, va por TCP: una categoría equivocada por un pedazo perdido sería mucho peor que unos milisegundos de espera.

## RTT: lo que tarda la ida y vuelta {RTT: the round trip time}

### Ida y vuelta

El [[rtt|RTT]] (*round-trip time*, tiempo de ida y vuelta) es lo que tarda un paquete en llegar del cliente al servidor más lo que tarda la respuesta en volver. Es la unidad con la que se mide cuánto le cuesta la red a cualquier conversación: el handshake es 1 RTT, una request con su respuesta es otro.

Si juegas en línea, ya lo conoces: el «ping» que muestra el juego, «32 ms», es el RTT entre tu consola y el servidor del juego. El nombre viene de `ping`, un programa que manda un paquete chiquito y mide cuánto tarda en volver.

### El límite de la luz

El RTT tiene un piso que ninguna tecnología puede bajar: la velocidad de la luz. En el vacío, la luz recorre ≈ 300,000 km por segundo; dentro de la fibra óptica, el vidrio la frena a ≈ 200,000 km por segundo: **200 km por milisegundo**. En la lección de unidades viste una regla práctica: ≥ 1 ms de ida y vuelta por cada 100 km. Sale de aquí: 100 km de ida y 100 de vuelta son 200 km, un milisegundo.

:::formula Piso del RTT por la distancia
RTT ≈ frac{2 × d × f}{v}
- d: la distancia en línea recta, en km
- v: la velocidad de la luz en la fibra: ≈ 200 km por ms
- f: cuántas veces más larga es la ruta real que la línea recta, sin unidad: 1 es la línea recta, el mínimo físico; una ruta real suele andar en ≈ 1.5
- RTT: la ida y vuelta, en ms. El 2 es porque el paquete va y la respuesta regresa
:::

:::cuenta El piso físico entre Ana y Virginia
Distancia en línea recta, \(d\) // de la Ciudad de México a Ashburn, en el norte de Virginia | — | ≈ 3,012 km
Solo la ida, \(d ÷ v\) // a 200 km por milisegundo | 3,012 ÷ 200 | ≈ 15 ms
Ida y vuelta con \(f = 1\): el RTT mínimo | \(RTT = 2 × d ÷ v\) = 2 × 15 | ≈ 30 ms
Una ruta real, con \(f ≈ 1.5\) // la fibra no va en línea recta y cada router suma un poco | 30 × 1.5 | ≈ 45 ms
= Ninguna request de Ana a Virginia puede contestarse en menos de ≈ 30 ms, aunque el servidor responda al instante. Y por 4G, el tramo de radio del celular suma todavía más.
:::

Más [[ancho-banda|ancho de banda]] no baja el RTT. El ancho de banda dice **cuántos** bits caben por segundo en el tubo; el RTT dice **cuánto tarda** un bit en ir y volver. Una carretera de diez carriles deja pasar más coches, pero no hace más corto el viaje de cada uno. Para bajar el RTT solo hay dos caminos: acercarse o hacer menos idas y vueltas.

La tabla usa dos palabras de la nube. Una [[region|región]] es un lugar del mundo donde un proveedor de nube tiene sus centros de datos: la de AWS en el norte de Virginia se llama `us-east-1`, y ahí viven las máquinas de Alba. Una [[zona-disponibilidad|zona]] es uno o varios centros de datos dentro de una región, separados de los demás para que no fallen juntos; Alba usa dos, `us-east-1a` y `us-east-1b`. Las dos tienen su propia lección más adelante.

| Entre | RTT típico |
|---|---|
| Dos programas de la misma máquina, por localhost | Decenas de microsegundos |
| Dos máquinas en la misma zona de la nube | Menos de 1 ms |
| Dos zonas de la misma región de la nube | ≈ 1 a 2 ms |
| Centro de México y Virginia, por cable | ≈ 50 ms (el mínimo físico es 30) |
| El celular y la antena, por 4G | Unas decenas de ms, solo ese tramo |

Son órdenes de magnitud, no promesas: cada red mide distinto, y lo que importa es medir la tuya.

:::profundo De dónde salen los números de la tabla
Dos referencias públicas: AWS dice que las zonas de una región están a menos de 100 km entre sí, que a la velocidad de la luz en fibra es ≈ 1 ms de ida y vuelta, y Azure publica la mediana entre sus regiones: de Querétaro a las de Virginia, 48 a 53 ms (en julio de 2026).
:::

### Cuántas idas y vueltas paga una request

Ahora junta las piezas. Una request por una conexión **nueva** paga 1 RTT de handshake y 1 RTT de la request y su respuesta: **2 RTT**. Si además va cifrada, como casi todo en internet, con [[tls|TLS]] (el protocolo que cifra la conexión para que nadie en el camino pueda leerla), el saludo del cifrado suma, en su versión actual (TLS 1.3), **otro RTT**: 3 en total. La versión anterior, TLS 1.2, que todavía se usa, cobraba 2 de saludo: 4 en total. Por una conexión que ya estaba abierta: 1.

En una fórmula:

:::formula Lo que la red le cobra a una request
T ≈ k × RTT
- RTT: la ida y vuelta entre el cliente y el servidor, en ms
- k: las idas y vueltas que paga la request: 1 por una conexión ya abierta; 2 por una nueva (handshake de TCP y request); 3 por una nueva con TLS 1.3
- T: el tiempo que la red le cobra a la request, en ms, sin contar lo que tarde el servidor en contestar
:::

Con un RTT de 60 ms, un número redondo cerca del de Ana a Virginia (≈ 45 ms de la ruta más lo que sume el 4G), la diferencia se ve así:

:::cuenta Conexión nueva contra conexión abierta, a 60 ms de RTT
Por una conexión ya abierta, \(k = 1\) // solo la request y su respuesta | \(T = k × RTT\) = 1 × 60 ms | 60 ms
Por una conexión nueva, \(k = 2\) // handshake de TCP + request | 2 × 60 ms | 120 ms
Nueva y con TLS, \(k = 3\) // handshake de TCP + saludo de TLS + request | 3 × 60 ms | 180 ms
= Abrir la conexión triplica lo que la red le cobra a la request. Contra una promesa de 200 ms, como el [[slo|SLO]] de Alba (el 99 % de las requests en 200 ms o menos), la diferencia entre 60 y 180 ms es casi todo el presupuesto.
:::

Por eso existe [[keep-alive]]: dejar la conexión abierta después de una request para mandar la siguiente por ahí. Y por eso los programas que hacen muchas requests guardan varias conexiones abiertas listas para usarse, un [[pool-conexiones|pool de conexiones]]. Las dos ideas son de la lección de HTTP.

:::calculadora red-rtt
Pon 184 km, Querétaro, con conexión nueva y TLS: ≈ 5.5 ms. Acercarse vale más que cualquier optimización del código.
:::

En Alba, la regla se cumple en cada salto. El backend del marketplace está en la misma región que el clasificador y llama con conexiones abiertas. El gateway y Triton están en la misma zona y también reusan conexiones: su RTT es una fracción de milisegundo. Lo que no se controla es el tramo de Ana: por eso el [[slo|SLO]] de 200 ms se mide del lado del servidor, desde que la request completa llega al balanceador.

## DNS: del nombre a la dirección {DNS: from name to address}

### Las personas usan nombres; la red, números

Nadie escribe `203.0.113.10` en el navegador: escribe `api.example.com`. Y aunque lo escribiera, las IP cambian: una empresa muda su servicio a otra máquina y la IP vieja deja de servir. Hace falta un directorio que traduzca nombres a direcciones, que cualquiera pueda consultar y que se pueda actualizar. Ese directorio es el [[dns|DNS]] (*Domain Name System*, sistema de nombres de dominio).

Usar el DNS se llama **resolver** un nombre. Antes de abrir cualquier conexión, el programa lo resuelve: le pregunta al DNS «¿qué IP tiene `api.example.com`?» y recibe «203.0.113.10». (El rango `203.0.113.x` está reservado para ejemplos, como `example.com`: no es de nadie.)

### Un árbol de nombres

Un nombre se lee de derecha a izquierda, como una dirección postal que empieza por el país: `api.example.com` es «la máquina `api`, de `example`, dentro de `.com`». Y la información también está repartida así, en un árbol: nadie tiene la lista completa de todos los nombres del mundo.

- Los **servidores raíz** (*root*) saben quién lleva cada terminación: `.com`, `.mx`, `.org`.
- Los servidores de cada terminación (*top-level domain*, TLD) saben quién lleva cada nombre: quién manda en `example.com`.
- El **servidor autoritativo** de `example.com` tiene la respuesta oficial: `api.example.com` es 203.0.113.10.

Tu programa no recorre el árbol. Le pregunta a un **resolver** (así, en inglés: «el que resuelve»), un servidor de DNS que hace el recorrido por él: el de tu proveedor de internet, el de la red de la nube o uno público, como el 8.8.8.8.

:::diagrama red-dns
Toca cada caja para ver qué sabe, o usa «Recorrer» para seguir una búsqueda la primera vez y las siguientes.
:::

### La caché y el TTL

Recorrer el árbol cuesta varias idas y vueltas. Si se hiciera en cada request, el DNS sería lentísimo y los servidores raíz recibirían cada búsqueda del mundo. La solución es guardar las respuestas: una **caché**.

Pero una respuesta guardada puede quedar vieja. Por eso cada respuesta trae su [[ttl|TTL]] (*time to live*, tiempo de vida): cuántos segundos se puede guardar antes de volver a preguntar. Lo decide el dueño del nombre. Un TTL de 300 s quiere decir «guárdala hasta 5 minutos».

El TTL es un trato. Uno corto cuesta más consultas pero los cambios se notan rápido; uno largo ahorra consultas pero un cambio tarda en llegar a todos. Un ejemplo con números: el TTL es de 300 s, tu programa preguntó en t = 0 y la empresa cambia de máquina en t = 150. Tu programa sigue usando la IP vieja hasta t = 300, cuando vence su caché. Si la máquina vieja ya estaba apagada, son 150 segundos de errores. Por eso, antes de mudar un servicio, se baja el TTL con días de anticipación.

:::profundo La caché del DNS, en Python
Esta simulación, con un reloj de mentiras, hace justo eso: la empresa cambia de máquina a los 150 s y nadie se entera hasta que vence la caché.

```python
registro = {"api.example.com": "203.0.113.10"}   # lo que dice el servidor autoritativo
TTL = 300                                        # segundos que se puede guardar la respuesta
cache = {}                                       # nombre → (ip, hasta cuándo vale)
consultas = 0

def resolver(nombre, ahora):
    global consultas
    if nombre in cache and ahora < cache[nombre][1]:
        return cache[nombre][0], "de la caché"
    consultas += 1                               # pregunta de verdad, por la red
    cache[nombre] = (registro[nombre], ahora + TTL)
    return registro[nombre], "preguntó"

for t in (0, 10, 120):
    print(f"t = {t:>3} s:", *resolver("api.example.com", t))
registro["api.example.com"] = "203.0.113.99"     # a los 150 s, la empresa cambia de máquina
for t in (200, 299, 300, 310):
    print(f"t = {t:>3} s:", *resolver("api.example.com", t))
print("consultas de verdad:", consultas, "de 7 búsquedas")
```

```salida
t =   0 s: 203.0.113.10 preguntó
t =  10 s: 203.0.113.10 de la caché
t = 120 s: 203.0.113.10 de la caché
t = 200 s: 203.0.113.10 de la caché
t = 299 s: 203.0.113.10 de la caché
t = 300 s: 203.0.113.99 preguntó
t = 310 s: 203.0.113.99 de la caché
consultas de verdad: 2 de 7 búsquedas
```

De los 150 s a los 300, el programa siguió mandando requests a la máquina vieja; de 7 búsquedas, solo 2 salieron a la red.
:::

### Nombres dentro de Kubernetes

Dentro de un clúster de Kubernetes, el grupo de máquinas que maneja los pods de Alba, hay un DNS propio. El problema que resuelve es el de las IP de los pods: cambian cada vez que un pod se reinicia. Así que el gateway no apunta a la IP de un pod de Triton; apunta a un nombre:

`triton.classifier.svc.cluster.local`

Se lee igual, de derecha a izquierda: el dominio del clúster (`cluster.local`), los Services (`svc`), el *namespace* `classifier` y el Service `triton`. En producción cada versión del modelo tiene su Service (`triton-v14` hoy); aquí `triton` es el nombre corto de una sola release (una versión publicada). Ojo: un *namespace* de Kubernetes no es el namespace de red de Linux que viste arriba; es solo una carpeta para agrupar los objetos de un equipo, y `classifier` es la del clasificador de Alba. Un [[service-k8s|Service]] es un objeto de Kubernetes que pone **un nombre y una IP fijos** delante de los pods que hacen el mismo trabajo, y reparte entre ellos. El gateway lee ese nombre de una variable de su configuración, `TRITON_URL=triton.classifier.svc.cluster.local:8000`: el nombre y, después de los dos puntos, el puerto.

:::profundo Por qué un nombre corto cuesta varias consultas en un pod
Dentro de un pod, el archivo `/etc/resolv.conf` le dice al sistema a qué DNS preguntar y qué terminaciones probar. En el namespace `classifier`, la lista de terminaciones (*search*) es `classifier.svc.cluster.local`, `svc.cluster.local` y `cluster.local`, y Kubernetes pone `ndots:5`: si un nombre tiene menos de 5 puntos, se prueba primero con cada terminación. Por eso `triton` a secas funciona dentro del namespace: se vuelve `triton.classifier.svc.cluster.local` al primer intento.

El efecto raro es con nombres de afuera. `api.example.com` tiene 2 puntos, así que el pod pregunta primero por `api.example.com.classifier.svc.cluster.local`, luego por las otras dos terminaciones, y solo al final por el nombre real; y cada intento va dos veces, una por la dirección IPv4 y otra por la IPv6. Son 8 consultas para una respuesta, y más si el nodo agrega sus propias terminaciones a la lista, como hace EKS, el Kubernetes de AWS. Hasta el nombre completo de Triton tiene solo 4 puntos y pasa por lo mismo antes de encontrarse. Se evita con un punto al final del nombre (`api.example.com.`), que quiere decir «este nombre ya está completo», o bajando `ndots`.
:::

## Las capas y el viaje completo de la foto {Layers and the full trip of the photo}

### Cada capa responde una pregunta

Ya tienes todas las piezas. Fíjate en que cada protocolo resuelve **una sola pregunta** y deja las demás a otro:

- **Enlace** (Wi-Fi, o Ethernet, la red por cable): ¿cómo llego al siguiente aparato, el que tengo enfrente? Solo un salto.
- **IP**: ¿a qué máquina va, a través de todos los saltos?
- **TCP o UDP**: ¿a qué programa de esa máquina, y llega completo y en orden?
- **HTTP** (y el resto de los protocolos de los programas): ¿qué se pide y qué se contesta?

A esa pila se le dice [[capas-red|capas de red]] (*network layers*). Cada capa usa la de abajo sin saber cómo funciona: HTTP no sabe de routers, e IP no sabe que lleva una foto. Por eso se puede cambiar una sin tocar las demás: la misma request de HTTP viaja igual por Wi-Fi, por 4G o por fibra.

En el trabajo se nombran con números, que vienen de un modelo de siete capas, el modelo OSI: el enlace es la **capa 2** (L2), IP es la **capa 3** (L3), TCP y UDP son la **capa 4** (L4) y HTTP es la **capa 7** (L7). Las otras casi no se mencionan. Internet, en realidad, se diseñó con un modelo de cuatro capas, el de **TCP/IP** (enlace, internet, transporte y aplicación), que son justo las cuatro de arriba; los números se tomaron prestados del OSI. En los dos, el DNS es de la capa de aplicación, como HTTP.

### Sobres dentro de sobres

Al salir, cada capa envuelve lo que le dio la de arriba en su propio sobre: su encabezado. Al llegar, cada capa quita el suyo y le pasa el resto a la de arriba.

:::figura red-capas
Lo que el gateway le manda a Triton. El tensor va adentro; lo envuelven HTTP, TCP, IP y el enlace, y cada sobre responde su propia pregunta.
:::

:::profundo Lo que pesan los sobres
Cada sobre ocupa bytes que no son datos. En un paquete de TCP sobre IPv4, la cuenta es esta:

:::cuenta Lo que pesan los sobres de un paquete de 1,500 bytes
Encabezado de IP // IPv4, el tamaño más común | — | 20 bytes
Encabezado de TCP // sin opciones extra | — | 20 bytes
Lo que queda para datos, \(D\) | \(D = M − E\) = 1,500 − 20 − 20 | 1,460 bytes
Parte que son sobres // \(E ÷ M\) | 40 ÷ 1,500 | ≈ 2.7 %
Con UDP en vez de TCP // 8 bytes de encabezado | 1,500 − 20 − 8 | 1,472 bytes
= Por eso 1,460 es el número de la primera sección. El enlace agrega su sobre aparte, por fuera de los 1,500, y el de HTTP va solo en el primer paquete de la request.
:::

En la práctica caben un poco menos. Linux le pone a cada paquete de TCP, por omisión, 12 bytes de opciones con la hora de envío (*timestamps*), que le sirven para medir el RTT: quedan 1,448 bytes de datos. La lección redondea con 1,460, la cuenta clásica.
:::

Las capas importan al diseñar un sistema por una razón práctica: **lo que ve una máquina depende de la capa en la que trabaja**. Un router solo lee la capa 3: IP de origen y de destino. Un balanceador (un programa que reparte las requests entre varias copias de un mismo servidor) que trabaja en la capa 4 ve también los puertos, y nada más: reparte **conexiones**, sin saber qué requests van adentro. Uno de capa 7 abre HTTP y ve cada request: su ruta, sus encabezados. El Service de Kubernetes reparte por conexión, en la capa 4, y en la lección [[balanceador|Balanceadores, proxies y gateways]] vas a ver por qué eso le complica la vida a un servidor de modelos.

### El viaje completo

Ahora sí, la respuesta a la pregunta de la lección. Recorre el diagrama paso a paso:

:::diagrama red-viaje
Usa «Recorrer» para seguir la foto de Ana salto por salto, o el recorrido de quién es cliente y quién servidor en cada conexión.
:::

En una frase: la app **resuelve** un nombre con el DNS, abre una conexión **TCP** a la **IP** y al **puerto** 443 del backend, y manda la foto en paquetes que los routers reenvían. El backend hace lo mismo hacia el clasificador. El ALB (*Application Load Balancer*), el balanceador de AWS que es la puerta de entrada del clasificador, pasa la request a la IP privada de un pod del gateway, en el puerto 8080, donde uvicorn escucha en 0.0.0.0. Y el gateway, ahora como cliente, resuelve `triton.classifier.svc.cluster.local` y manda el tensor al puerto 8000 de Triton. Cada salto es una conexión distinta, y en cada una se repite lo mismo: nombre → IP, IP → máquina, puerto → programa, TCP → completo y en orden.

## Dentro de TCP: pérdidas, arranque lento y conexiones caras {Inside TCP: losses, slow start and expensive connections} [extra]

En la sección de TCP viste lo que promete. Aquí va cómo lo cumple sin ahogar a la red, y tres costos que aparecen en producción: el arranque lento, la espera de un paquete perdido y los puertos que se quedan ocupados.

### El arranque lento

TCP no sabe qué tan ancho es el camino. Si mandara todo de golpe, podría saturar un router y perder la mitad. Así que empieza con poco y va subiendo: manda un puñado de paquetes, espera sus acuses y, si llegaron bien, en la siguiente vuelta manda el doble. Esa cantidad que se permite mandar sin acuse es la **ventana de congestión** (*congestion window*), y la fase en la que se duplica en cada RTT se llama **arranque lento** (*slow start*). Hoy casi todos los sistemas empiezan con una ventana de 10 paquetes, ≈ 14.6 KB: la recomendación del RFC 6928, de 2013, que Linux ya usaba desde 2011.

Como la ventana se duplica, en la vuelta 1 salen \(w\) paquetes, en la 2 salen \(2w\), en la 3, \(4w\)… Después de \(r\) vueltas van \(w + 2w + 4w + …\) = \(w × (2^r − 1)\). Los paquetes \(P\) salen de \(P = ⌈S/D⌉\), la fórmula de la primera sección. El envío también tiene que caber en el tubo, y manda el más lento de los dos límites:

:::formula Arranque lento
w × (2^r − 1) ≥ P
t_{arranque} = r × RTT
t_{ancho} = frac{8 × S}{A}
t ≈ max(t_{arranque}, t_{ancho})
- P: los paquetes que hay que mandar
- w: la ventana inicial, en paquetes: 10 hoy
- r: las vueltas del arranque lento, cada una de un RTT: el número más chico que cumple la primera línea
- RTT: la ida y vuelta, en ms
- S: lo que hay que mandar, en bytes; el 8 lo pasa a bits
- A: el ancho de banda, en bits por segundo
- t_{arranque}: lo que pide el arranque lento, en ms
- t_{ancho}: lo que pide el ancho de banda, en segundos (bits ÷ bits por segundo)
- t: lo mínimo que tarda el envío, sin contar el handshake. Antes de comparar, pasa \(t_{arranque}\) y \(t_{ancho}\) a la misma unidad
:::

:::cuenta El JPEG de 200 KB, en una conexión recién abierta
Paquetes que hay que mandar, \(P\) | \(P = ⌈S/D⌉\) = ⌈200,000 ÷ 1,460⌉ | 137
Primera vuelta // la ventana inicial, \(w\) | 10 | llevan 10
Segunda vuelta // el doble | 20 | llevan 30
Tercera vuelta | 40 | llevan 70
Cuarta vuelta // ya pasaron de 137 | 80 | llevan 150
Vueltas, \(r\) // la primera con \(w × (2^r − 1) ≥ P\) | 10 × (2⁴ − 1) = 150 ≥ 137 | 4
Tiempo del arranque, \(t_{arranque}\) // por 4G, con ≈ 60 ms de RTT, como el de Ana a Virginia | \(t_{arranque} = r × RTT\) = 4 × 60 ms | ≈ 240 ms
= Son 4 RTT solo para mandar 200 KB, aunque el tubo fuera enorme. Una foto de 3 MB, de 2,055 paquetes, necesita 8: 10 × (2⁸ − 1) = 2,550 ≥ 2,055.
:::

Con un ancho de banda chico pasa al revés: el que manda es el tubo, no el RTT. 3 MB a 10 Mb/s son \(t_{ancho}\) = 8 × 3,000,000 ÷ 10,000,000 = 2.4 s, se abra la ventana tan rápido como se abra. La calculadora te deja ver cuál de los dos limita.

:::calculadora red-arranque
Pon 602 KB, el tensor que el gateway le manda a Triton, con 0.5 ms de RTT y 5000 Mb/s, como dentro de una zona: 6 vueltas, ≈ 3 ms. Y el tensor ya viaja por conexiones abiertas, con la ventana grande.
:::

Una conexión que ya estaba abierta tiene la ventana grande: la siguiente request no vuelve a arrancar desde 10. Es otra razón para reusar conexiones, además del handshake. (Si la conexión pasa un rato sin usarse, Linux, por omisión, vuelve a empezar con la ventana chica.)

### Cuando se pierde un paquete

Si un acuse no llega, TCP espera un tiempo, el **tiempo de reenvío** (*retransmission timeout*), y reenvía. Ese tiempo se calcula con los RTT medidos y tiene un mínimo: en Linux, 200 ms. Si los acuses que sí llegan muestran un hueco (tres acuses repetidos que dicen «tengo hasta el byte tal», porque los paquetes de después llegaron y el que falta no), reenvía sin esperar. En los dos casos, además, **achica la ventana**: interpreta la pérdida como señal de que la red está saturada.

El peor caso es perder el SYN, el primer paquete del handshake. Todavía no hay RTT medido, así que el cliente espera **1 segundo** antes de reenviarlo, y si se vuelve a perder, 2 más. Por eso en las gráficas de latencia a veces aparecen requests de ≈ 1 s y ≈ 3 s que no tienen nada que ver con tu código: son SYN perdidos. Con un SLO de 200 ms, un solo SYN perdido ya rompe la request.

### Un paquete perdido detiene a todos

TCP entrega en orden. Si se pierde el paquete 5 y llegan del 6 al 40, el programa no recibe ninguno hasta que llegue el 5 reenviado: todos esperan detrás del perdido. Es el **bloqueo por cabeza de fila** (*head-of-line blocking*). Si por esa conexión viajaban varias requests a la vez, una pérdida frena a todas, aunque sus pedazos ya hubieran llegado.

Esto explica QUIC. Para arreglarlo había que cambiar TCP, pero TCP vive dentro del kernel de miles de millones de aparatos, y muchos aparatos del camino que revisan el tráfico, como los *firewalls*, tiran lo que no reconocen: cambiarlo tarda décadas. Así que QUIC se construyó **encima de UDP**, que cualquier programa puede usar, y hace sus propios números, acuses y reenvíos, con varias conversaciones independientes dentro de la misma conexión: una pérdida frena solo a la suya. Además junta el handshake de transporte y el de cifrado en 1 RTT. HTTP/3 es HTTP sobre QUIC, y lo usan muchos navegadores y sitios grandes.

### Los puertos que se quedan ocupados

Al cerrar una conexión, el lado que cierra primero no libera de inmediato sus cuatro números: los deja apartados un rato por si llega tarde algún paquete viejo. Ese estado se llama **TIME_WAIT**, y en Linux dura 60 s. Si el que cierra primero es el cliente, el puerto apartado es uno de sus efímeros, y esos se pueden acabar. El techo sale de repartir los puertos entre lo que dura apartado cada uno: \(R_{max} = N ÷ t_{TW}\), con \(N\) los puertos efímeros, \(t_{TW}\) los segundos que dura TIME_WAIT y \(R_{max}\) las conexiones nuevas por segundo que aguanta el cliente.

:::cuenta Un cliente que abre y cierra una conexión por request
Puertos efímeros de Linux, \(N\) // del 32,768 al 60,999 | 60,999 − 32,768 + 1 | 28,232
Lo que dura cada uno apartado al cerrar, \(t_{TW}\) | — | 60 s
Conexiones nuevas por segundo, como máximo, \(R_{max}\) // hacia la misma IP y el mismo puerto | \(R_{max} = N ÷ t_{TW}\) = 28,232 ÷ 60 | ≈ 470
= Un cliente que abre y cierra una conexión por request no pasa de ≈ 470 requests por segundo hacia el mismo destino. Al pico de diseño de Alba, 500 por segundo, ya no alcanzaría.
:::

Alba no tiene ese problema, porque reparte las 500 requests por segundo entre 5 pods y, sobre todo, porque reusa conexiones. Pero un *job* de prueba que lanza miles de requests con un cliente que abre una conexión cada vez se topa con ese techo y empieza a fallar con «*cannot assign requested address*». La salida no es tocar el kernel: es un [[pool-conexiones|pool de conexiones]].

## Errores comunes {Common mistakes}

### 1. Escuchar en 127.0.0.1 dentro de un contenedor

El servidor arranca, los logs dicen «*running on http://127.0.0.1:8000*» y nadie de afuera puede hablarle. Dentro del contenedor, 127.0.0.1 es su propio localhost, y lo de afuera llega por otra interfaz. El síntoma cambia según por dónde llegues: desde otra máquina, «*connection refused*»; desde tu laptop, con `-p` (la opción de Docker que conecta un puerto de tu laptop con uno del contenedor; la ves en el error siguiente), a veces Docker acepta la conexión y luego la corta, y `curl` dice «*Empty reply from server*» o «*Connection reset by peer*». Es el mismo error.

**Cómo evitarlo:** en un contenedor, escuchar en `0.0.0.0` (`uvicorn --host 0.0.0.0`). En tu laptop, fuera de un contenedor, deja 127.0.0.1: así nadie de tu red le habla a tu programa a medio hacer.

### 2. Confundir el puerto del contenedor con el de la máquina

`docker run -p 8080:8000` quiere decir «el puerto **8080 de la máquina** lleva al **8000 del contenedor**»: primero el de afuera, después el de adentro. Si uvicorn escucha en el 8080 dentro del contenedor, ese `-p` apunta a un puerto donde nadie escucha.

**Cómo evitarlo:** decide el puerto en un solo lugar (una variable de configuración) y revisa que coincidan el `--port` del programa, el `-p` de Docker o el `containerPort` de Kubernetes (el campo de su configuración que dice en qué puerto escucha el contenedor), y el puerto que piden sus clientes.

### 3. Abrir una conexión nueva en cada request

Cada conexión nueva paga 1 RTT de handshake (2 con TLS), empieza mandando poco a poco (el arranque lento de la sección extra «Dentro de TCP») y, al cerrarse, deja su puerto apartado un rato. A 60 ms de RTT y con TLS, una request que costaría 60 ms cuesta 180.

**Cómo evitarlo:** crear el cliente HTTP una vez, al arrancar el programa, y reusarlo: con keep-alive y un pool de conexiones. Nunca crear un cliente nuevo dentro de la función que atiende cada request.

### 4. Apuntar a la IP de un pod

Funciona hasta que el pod se reinicia y nace con otra IP. O hasta que Kubernetes agrega un pod nuevo que nadie conoce.

**Cómo evitarlo:** hablarle a un nombre, el del Service de su Triton (aquí, `triton.classifier.svc.cluster.local`; en producción lleva la versión, `triton-v14.classifier…`), que tiene una IP fija y siempre apunta a los pods vivos. En la nube, lo mismo: nombres de DNS, no IPs escritas en la configuración.

### 5. Olvidar el TTL al mover un servicio

Cambias la IP en el DNS y apagas la máquina vieja de inmediato. Durante lo que dure el TTL, todos los que tenían la respuesta guardada siguen llamando a la vieja. Con un TTL de un día, son hasta 24 horas de errores.

**Cómo evitarlo:** días antes del cambio, bajar el TTL (a 60 s, por ejemplo), esperar a que venza el viejo, cambiar la IP y dejar la máquina vieja viva hasta que se apague el tráfico. Después, volver a subir el TTL.

### 6. Creer que más ancho de banda arregla la latencia

Si el RTT a otro continente es de 100 ms, ningún plan de internet más rápido lo baja: más Gb/s sirve para mandar más cosas a la vez, no para que cada una llegue antes.

**Cómo evitarlo:** contar idas y vueltas, no solo megas. Acercar las máquinas, reusar conexiones y hacer menos viajes por request.

## En la vida real {In real life} [extra]

### Alba: cada salto, con sus números

Este es el viaje de la foto de Ana con los números del sistema de Alba:

| Salto | Cliente → servidor | Puerto | Lo que viaja |
|---|---|---|---|
| Celular → backend | La app de Ana, por 4G e internet | 443 | El JPEG de ≈ 200 KB, ya achicado: 137 paquetes |
| Backend → ALB | El backend, de servidor a servidor (*server-to-server*), en us-east-1 | 443 | El mismo JPEG: 137 paquetes |
| ALB → gateway | El ALB, a la IP privada de un pod | 8080 | La misma foto, ya sin cifrar |
| Gateway → Triton | El gateway, por el nombre del Service | 8000 | El tensor de 602 KB: 413 paquetes |
| Prometheus → Triton | El que vigila las métricas | 8002 | Las métricas, cada 15 a 60 s, según se configure |

Tres decisiones de Alba salen directo de esta lección.

**Triton no tiene IP pública ni puerta de entrada.** Solo se alcanza desde adentro, y una regla de red de Kubernetes (una *NetworkPolicy*) deja que le hablen únicamente los pods del gateway, y al 8002 solo Prometheus. Si nadie de afuera puede llegar al puerto, nadie de afuera puede abusar de él.

**El gateway habla con el Triton de su misma zona.** Al pico de diseño, el gateway manda 500 tensores de 602 KB por segundo: ≈ 301 MB/s, ≈ 2.4 Gb/s, ≈ 206,500 paquetes por segundo. Dentro de una zona, el RTT es una fracción de milisegundo y el tráfico no se cobra. Entre zonas, el RTT sube un poco y AWS cobra US$0.01 por GB en cada sentido (su precio de 2026 en us-east-1). Si el Service repartiera al azar, la mitad de los tensores cruzaría de zona. En un mes de 30.4 días (el que se usa para costos), con ≈ 10 millones de fotos al día (≈ 3 por publicación, más las que piden otros equipos), los tensores suman 10,000,000 × 602 KB × 30.4 días ≈ 183 TB; la mitad son ≈ 91.5 TB, y a US$0.02 por GB (0.01 de cada lado), ≈ US$1,830 al mes: más del doble de lo que cuestan al mes las dos GPUs del clasificador, ≈ US$768. Alba lo arregla con una línea en el Service de Triton, `trafficDistribution: PreferSameZone` (existe desde Kubernetes 1.34 y es estable desde 1.35): cada gateway prefiere el Triton de su zona y solo cruza si el suyo no está listo.

**Las conexiones se reusan en todo el camino.** El ALB mantiene conexiones abiertas con los pods del gateway, y el equipo de Alba le estima a ese tramo ≈ 1 a 3 ms; el gateway reusa las suyas con Triton, y el tramo completo del tensor, con la conversión a bytes y la red dentro de la nube, se estima en ≈ 2 a 4 ms la mediana y ≈ 5 a 10 ms el p99. Con una conexión nueva por request, cada tramo pagaría el handshake, el arranque lento y un puerto en TIME_WAIT.

Dentro de una red de AWS, además, las máquinas pueden usar paquetes de hasta 9,001 bytes (*jumbo frames*): ahí el tensor de 602 KB son ≈ 68 paquetes en vez de 413. Al salir a internet, el tope vuelve a 1,500.

Y un detalle de costos: en AWS, cada IP pública cuesta US$0.005 por hora desde 2024, ≈ US$3.65 al mes. Darle IP pública a cada máquina «por comodidad» es pagar por exponerlas. Las de Alba viven en subredes privadas.

### Las conexiones largas y el pod que nadie usa

Kubernetes reparte en la capa 4: **conexiones, no requests**. Piensa en un servicio que sirve su propio LLM (un modelo de lenguaje grande, como el de un chatbot): cada respuesta llega token por token (un token es un pedazo de palabra), durante varios segundos por la misma conexión. Un cliente que abre pocas conexiones y las mantiene vivas queda pegado a los mismos pods. Cuando el sistema agrega un pod nuevo porque hay mucha carga, el pod nace, está listo… y no recibe nada hasta que las conexiones viejas se cierran. Hay tres salidas: un balanceador de capa 7, que reparte requests; que el cliente conozca todas las IPs de los pods y reparta él mismo; o un tiempo de vida máximo para cada conexión. Lo vas a ver completo en la lección «Balanceadores, proxies y gateways».

### Voz y videollamadas: UDP a propósito

En una videollamada, la voz y el video viajan casi siempre por UDP. Si se pierde un pedazo, el programa lo tapa como puede (repite el anterior, suaviza) y sigue: reenviarlo llegaría cuando ya no sirve. Lo que sí va por TCP es lo que no puede perderse, como el texto del chat. Un sistema de ML que convierte voz a texto en tiempo real tiene el mismo dilema: para subtítulos en vivo, a veces conviene perder 20 ms de audio antes que atrasarse medio segundo.

### Cuando falla el DNS, falla todo

El 4 de octubre de 2021, Facebook, Instagram y WhatsApp desaparecieron de internet durante unas 6 horas. Una orden de mantenimiento desconectó por error la red que une sus centros de datos, y sus servidores autoritativos de DNS, al quedarse aislados, dejaron de anunciarse a internet: nadie podía resolver `facebook.com`, así que nadie podía conectarse, aunque los servidores de la aplicación estuvieran encendidos. Hasta los empleados tuvieron problemas para entrar a los edificios, porque sus sistemas también dependían de esa red.

El 20 de octubre de 2025, en la región us-east-1 de AWS, la misma de Alba, un error en el sistema que actualiza los registros de DNS de DynamoDB (una base de datos de AWS) dejó su nombre sin ninguna IP. Los programas que la usaban no podían encontrarla. AWS arregló el registro en menos de 3 horas, y aun así cada cliente tardó en recuperarse lo que tardó en vencer la respuesta vacía que tenía en caché: el TTL otra vez. Como muchos otros servicios de AWS dependen de DynamoDB, la falla siguió rebotando entre ellos hasta la tarde: unas 14 horas en total. Entre los ingenieros hay un dicho: «siempre es el DNS». Un sistema puede tener dos zonas, dos GPUs y su plan B; si nadie puede resolver su nombre, nadie llega.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de distancia y de arranque lento se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Un vendedor sube desde la web el original de una foto de 10 MB. ¿Cuántos paquetes de 1,460 bytes de datos son? ¿Cuántos bytes de encabezados de IP y TCP viajan con ellos?
- Con \(P = ⌈S/D⌉\) y \(H = P × E\), donde \(S\) = 10,000,000 bytes, \(D\) = 1,460 y \(E\) = 40.
- Paquetes: \(P\) = ⌈10,000,000 ÷ 1,460⌉ = ⌈6,849.3⌉ = **6,850**.
- Encabezados: \(H\) = 6,850 × 40 bytes = **274,000 bytes**, ≈ 274 KB: 274,000 ÷ 10,274,000 ≈ el 2.7 % de lo que viaja.
? [facil] ¿Cuáles de estas direcciones son privadas? 10.2.3.4, 172.15.0.1, 172.31.255.1, 192.169.0.1 y 127.0.0.1.
- **10.2.3.4: privada.** Empieza con 10: está en `10.0.0.0/8`.
- **172.15.0.1: pública.** El rango privado de 172 va del 172.16 al 172.31; el 15 queda afuera.
- **172.31.255.1: privada.** Es la última parte del rango `172.16.0.0/12`.
- **192.169.0.1: pública.** El rango privado es `192.168.x.x`; 169 no entra.
- **127.0.0.1: ninguna de las dos.** Es loopback, la máquina misma: no sale ni a la red de la casa.
? [facil] Corres `docker run -p 8080:8000 mi-api`. Adentro, uvicorn arranca sin `--host` y en su puerto por omisión. Desde tu laptop, `curl localhost:8080` falla. ¿Por qué, y qué cambias?
- El `-p` lleva el 8080 de tu laptop al 8000 del contenedor: el puerto coincide con el de uvicorn, eso está bien.
- El problema es la dirección: sin `--host`, uvicorn escucha en **127.0.0.1**, el localhost del contenedor. Lo que llega por `-p` entra por la interfaz de red del contenedor, donde nadie escucha.
- Arreglo: `uvicorn app:app --host 0.0.0.0 --port 8000`.
? [facil] Un juego promete un RTT de 40 ms. Si todo fuera fibra en línea recta, ¿a cuántos km puede estar el servidor, como máximo?
- Con fibra en línea recta, \(f = 1\), y \(RTT = 2 × d ÷ v\). Despejando, \(d = RTT × v ÷ 2\).
- \(d\) = 40 × 200 ÷ 2 = **4,000 km**, como máximo: 40 ms de ida y vuelta son 20 ms de ida, y a 200 km por milisegundo dan 4,000 km. En la práctica, menos, porque la ruta no es recta y cada router suma.
? [medio] Un programa hace 3 requests seguidas, cada una esperando a la anterior, a un servidor con 45 ms de RTT y TLS. ¿Cuánto tarda la red si abre una conexión nueva para cada una? ¿Y si abre una y la reusa?
- Con \(T = k × RTT\), sumando las \(k\) de las 3 requests y \(RTT\) = 45 ms.
- Conexión nueva para cada una: 3 RTT por request (TCP, TLS y la request) × 3 requests = 9 RTT = 9 × 45 = **405 ms**.
- Una sola conexión: 2 RTT para abrirla (TCP y TLS) + 3 RTT de las requests = 5 RTT = **225 ms**.
- Reusar ahorra 180 ms. Si la conexión ya estaba abierta de antes, quedan 3 × 45 = 135 ms.
? [medio] El nombre de un servicio tiene un TTL de 86,400 s. El lunes a las 10:00 cambias su IP y apagas la máquina vieja. ¿Hasta cuándo puede haber clientes llamando a la vieja? ¿Cómo lo harías mejor?
- 86,400 s ÷ 3,600 = **24 horas**. Un cliente que guardó la respuesta el lunes a las 9:59 la usa hasta el martes a las 9:59: casi un día de errores para él.
- Mejor: el viernes anterior, bajar el TTL a 60 s. Esperar al menos 24 horas, para que venza todo lo guardado con el TTL viejo. El lunes, cambiar la IP; a los pocos minutos, casi todos usan la nueva. Dejar la vieja encendida hasta que deje de recibir tráfico y luego subir el TTL otra vez.
? [medio] Escribe 10.0.3.15 en binario, byte por byte. ¿Está en la red `10.0.0.0/8`? ¿Y en `10.0.2.0/24`?
- 10 = 0000 1010; 0 = 0000 0000; 3 = 0000 0011; 15 = 0000 1111. Juntos: `00001010.00000000.00000011.00001111`.
- `/8` deja fijos los primeros 8 bits, que en 10.0.0.0 son 00001010. Coinciden: **sí está**.
- `/24` deja fijos los primeros 3 bytes: 10, 0 y 2. El tercer byte de la dirección es 3, no 2: **no está**. Estaría en `10.0.3.0/24`.
? [medio] Por una conexión TCP nueva hay que mandar 1 MB, con 50 ms de RTT y 10 Mb/s de ancho de banda. ¿Cuántas vueltas pide el arranque lento, con ventana inicial de 10? ¿Qué limita más, el RTT o el ancho de banda?
- Con \(P = ⌈S/D⌉\), \(w × (2^r − 1) ≥ P\), \(t_{arranque} = r × RTT\) y \(t_{ancho} = 8 × S ÷ A\), donde \(S\) = 1,000,000 bytes, \(w\) = 10, \(RTT\) = 50 ms y \(A\) = 10,000,000 bits por segundo.
- Paquetes: \(P\) = ⌈1,000,000 ÷ 1,460⌉ = ⌈684.9⌉ = **685**.
- Vueltas: 10, 20, 40, 80, 160, 320 suman 630, menos de 685; falta una más: \(r\) = **7**, porque 10 × (2⁷ − 1) = 1,270 ≥ 685. \(t_{arranque}\) = 7 × 50 = **350 ms**.
- Por ancho de banda: \(t_{ancho}\) = 8 × 1,000,000 = 8,000,000 bits ÷ 10,000,000 bits por segundo = **0.8 s**.
- Limita el ancho de banda: el envío tarda ≈ 800 ms aunque la ventana se abra en 350. Con 100 Mb/s, mandaría el RTT.
? [reto] Un *job* de prueba manda 2,000 requests por segundo a un Triton, desde una sola máquina, y abre y cierra una conexión por request. A los pocos segundos empieza a fallar con «cannot assign requested address». ¿Por qué, y en cuántos segundos? ¿Qué cambias?
- Con \(R_{max} = N ÷ t_{TW}\), \(N\) = 28,232 puertos y \(t_{TW}\) = 60 s. Cada conexión cerrada deja su puerto efímero en TIME_WAIT 60 s. Para sostener 2,000 por segundo harían falta 2,000 × 60 = **120,000** puertos apartados a la vez, y Linux trae 28,232.
- Se acaban en 28,232 ÷ 2,000 ≈ **14 segundos**. Desde ahí, el kernel no tiene puerto que prestarle a la siguiente conexión.
- El techo con conexiones nuevas es \(R_{max}\) = 28,232 ÷ 60 ≈ 470 por segundo hacia ese destino. Arreglo: un pool de conexiones con keep-alive. Con 20 conexiones reusadas, cada una lleva 100 requests por segundo, sin handshakes ni TIME_WAIT.
? [reto] Ana, en la Ciudad de México, sube por 4G a Virginia el original de su foto, de 3 MB, como si la app no la achicara. Supón un RTT de 80 ms (45 de la ruta más 35 del tramo de radio), 10 Mb/s de subida, el nombre ya guardado en caché y una conexión nueva con TLS. Estima lo que tarda la red hasta que la foto llega completa. ¿Por qué el SLO de Alba no mide esto?
- Con \(T = k × RTT\) para los saludos y \(t ≈ max(t_{arranque}, t_{ancho})\) para la foto, con \(RTT\) = 80 ms, \(S\) = 3,000,000 bytes y \(A\) = 10,000,000 bits por segundo.
- DNS: en caché, **0 ms**.
- Handshake de TCP y saludo de TLS: 2 de las \(k = 3\) vueltas de una conexión nueva con TLS (la tercera es la foto misma, que va abajo): 2 × 80 = **160 ms**.
- La foto: son 2,055 paquetes, y el arranque lento pediría \(r\) = 8 vueltas (10 × (2⁸ − 1) = 2,550 ≥ 2,055): \(t_{arranque}\) = 8 × 80 = 640 ms. Pero el ancho de banda pide \(t_{ancho}\) = 8 × 3,000,000 ÷ 10,000,000 = **2.4 s**. Manda el ancho de banda.
- Total: ≈ 160 + 2,400 ≈ **2.6 s**, más lo que tarde en volver la respuesta.
- El SLO de Alba (p99 ≤ 200 ms) se mide del lado del servidor, desde que la request completa llega al balanceador. Estos 2.6 s dependen de la señal de Ana y de su compañía de celular, que nadie en Alba controla. Por eso, además, la app achica la foto antes de subirla: con ≈ 200 KB son 137 paquetes, \(t_{arranque}\) = 4 vueltas × 80 = 320 ms (\(t_{ancho}\) = 8 × 200,000 ÷ 10,000,000 = 0.16 s: solo 160 ms), y con los 160 ms de los saludos, ≈ 480 ms en vez de 2.6 s.
:::

## Lo que sigue {What comes next}

La siguiente lección, «HTTP: requests, respuestas y códigos», abre lo que viaja **dentro** de la conexión TCP: el método, la URL, los encabezados, los códigos como 200 o 503, el keep-alive y el pool de conexiones. Después vienen las APIs, los balanceadores (capa 4 contra capa 7), los timeouts y reintentos, y la latencia de punta a punta. Más adelante, «Redes en la nube: VPC, subredes y egress» arma la VPC, el NAT y la salida a internet de Alba, y «Cifrado, llaves y certificados» explica el cifrado con TLS.

Las lecciones de las estaciones retoman esto: en «Empaquetado con Docker» se publican puertos con `-p` y vuelve el «escuchar en 0.0.0.0»; en «Kubernetes», el gateway encuentra a Triton por el nombre de su Service.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
protocolo paquete-red direccion-ip ip-privada puerto socket localhost cliente tcp udp handshake rtt dns ttl capas-red
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué decide la IP y qué decide el puerto?
La IP, a qué máquina va el paquete; el puerto, a qué programa de esa máquina. El gateway de Alba escucha en el 8080 de la IP de su pod.
? ¿Por qué el original de la foto de Ana, de 3 MB, viajaría en ≈ 2,055 paquetes y no de una pieza?
Un paquete lleva como máximo 1,500 bytes, 1,460 de datos. En pedazos, el cable se comparte y lo dañado se reenvía solo.
? ¿Por qué un servidor que escucha en 127.0.0.1 dentro de un contenedor no recibe nada de afuera?
Porque 127.0.0.1 es el localhost del propio contenedor. Lo de afuera llega por otra interfaz, y ahí nadie escucha. Hay que escuchar en 0.0.0.0, todas las interfaces.
? ¿Cuántas idas y vueltas paga una request por una conexión nueva con TLS, y por una ya abierta?
Tres: el handshake de TCP, el saludo de TLS y la request con su respuesta. Por una ya abierta, una. A 60 ms de RTT, 180 ms contra 60.
? ¿Cuándo conviene UDP en vez de TCP?
Cuando llegar tarde es peor que no llegar (voz, video en vivo, juegos) o cuando el mensaje cabe en un paquete y se puede volver a preguntar (DNS). QUIC usa UDP y hace él mismo lo que hacía TCP.
? ¿Para qué sirve el TTL de una respuesta de DNS, y qué pasa si es muy largo?
Dice cuántos segundos se puede guardar la respuesta. Si el nombre cambia de IP, quien la guardó sigue usando la vieja hasta que venza: con un TTL de un día, hasta 24 horas.
? Un balanceador de capa 4 y uno de capa 7, ¿qué ve cada uno?
El de capa 4 ve IPs y puertos: reparte conexiones. El de capa 7 abre HTTP y ve cada request, con su ruta y sus encabezados. El Service de Kubernetes reparte en capa 4.
:::
