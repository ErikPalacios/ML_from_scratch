---
titulo: Redes en la nube: VPC, subredes y egress
en: Cloud networking: VPCs, subnets and egress
subtitulo: Cómo se arma la red privada donde viven las máquinas de C01, por qué cada caja tiene la salida que tiene y cómo se convierte cada GB que se mueve en una línea de la factura.
pregunta: Las máquinas de C01 viven en una red privada dentro de AWS. ¿Cómo se arma esa red, por dónde sale cada byte y por qué la red puede costar más que las GPUs?
requisitos: red, balanceo, almacenamiento, regiones
---

:::idea
En la nube, tus máquinas viven en una red privada que tú dibujas: la VPC, partida en subredes por zona. Cada byte que se mueve tiene un camino, y cada camino tiene precio: dentro de la zona es gratis, cruzar de zona cuesta, salir por el NAT o a internet cuesta más. La red no se ve en el diagrama de arquitectura, pero puede costar más que las GPUs.
:::

Cuando Ana sube la foto de sus tenis, la foto hace un viaje que ya conoces: entra por el balanceador, pasa al gateway y llega a Triton, que corre el modelo en una GPU. En la lección de red viste cómo viaja cada paquete. En la de regiones viste que C01 vive en `us-east-1`, repartido en dos zonas, `us-east-1a` y `us-east-1b`.

Falta una pregunta: **¿dónde, exactamente, viven esas máquinas?** No están sueltas en internet. Viven en una red privada que la empresa arma dentro de AWS, con direcciones como `10.0.37.9`. Esa red tiene paredes (quién puede entrar), puertas (por dónde se sale) y atajos (caminos privados a S3). Y cada vez que un byte cruza una de esas puertas, alguien anota un cargo.

Esto importa por dos razones.

- **Seguridad.** El servidor de Triton no debería poder recibir una conexión de cualquier computadora del mundo. La red decide quién puede hablar con quién.
- **Dinero.** En la nube se cobra por mover datos. Con las fotos de C01, una decisión de red mal tomada suma ≈ US$1.8k al mes, más de lo que cuestan las dos GPUs juntas (≈ US$768).

En esta lección vas a armar la red de C01 pieza por pieza: la VPC, las subredes, las tablas de rutas, los grupos de seguridad, el NAT y los endpoints. Después vas a ponerle precio a cada camino y, al final, vas a recorrer cada byte de C01 para escribir su factura de red.

Todos los precios son de AWS en `us-east-1`, tomados de la Ronda, con «≈» porque cambian. Las ideas valen igual en Google Cloud y Azure: cambian los nombres, no el diseño.

## La VPC: tu red privada dentro de la nube {The VPC: your private network inside the cloud}

Piensa en tu casa. Tu router le da a cada aparato una [[ip-privada|IP privada]], `192.168.1.x`, que solo vale adentro. Desde internet nadie puede llegar directo a tu laptop: solo el router tiene una IP pública. Lo viste en la lección de red.

En la nube pasa lo mismo, pero la red la dibujas tú. Se llama **[[vpc|VPC]]** (*Virtual Private Cloud*, nube privada virtual): una red privada, aislada de las de los demás clientes, dentro de una [[region|región]] del proveedor. Tus máquinas, tus balanceadores y tus bases de datos viven adentro, cada uno con su IP privada.

¿Por qué «virtual»? Porque no hay cables tuyos. Las máquinas de miles de clientes comparten los mismos edificios, los mismos *switches* (los aparatos que conectan entre sí las máquinas de un edificio) y las mismas fibras. El proveedor separa el tráfico con software: cada paquete lleva la marca de su VPC, y la red física solo lo entrega a máquinas de esa misma VPC. Para ti, es como tener tu propia red.

:::analogia Un edificio de oficinas
La región es un edificio enorme de oficinas. Cada empresa renta un piso: su VPC. Los pasillos del piso son suyos, las puertas internas las pone ella y nadie de otro piso entra sin permiso. El edificio pone el elevador, la luz y la vigilancia de la entrada.

Dónde se rompe: en un edificio real, los pisos están uno encima del otro y la pared es física. En la nube, tu «piso» y el del vecino pueden estar en la misma máquina, y la pared es una regla de software que el proveedor cumple en cada paquete.
:::

### El rango de la VPC: la notación CIDR

Lo primero que decides al crear una VPC es su rango de direcciones: qué IPs privadas van a existir adentro. Se escribe así: `10.0.0.0/16`.

Ya viste esta notación en la lección de red. Se llama **[[cidr|CIDR]]** (*Classless Inter-Domain Routing*). Los números antes de la diagonal son la primera dirección del rango. El número después de la diagonal dice cuántos [[bit|bits]], contando desde la izquierda, quedan fijos: son iguales en todas las direcciones del rango. Los demás bits pueden valer lo que sea, y cada combinación es una dirección. Una dirección IPv4 tiene 32 bits, así que:

- `/16` deja fijos 16 bits (los dos primeros bytes, `10.0`) y libres 32 − 16 = 16 bits: 2¹⁶ = **65,536** direcciones, de `10.0.0.0` a `10.0.255.255`.
- `/20` deja libres 12 bits: 2¹² = **4,096** direcciones.
- `/24` deja libre el último byte: 2⁸ = **256** direcciones.

Cada bit de más en la diagonal parte el rango a la mitad. Un `/17` es la mitad de un `/16`; un `/18`, un cuarto.

¿Por qué importa el rango? Por dos razones. Primero, no se puede encoger después: si te quedas sin direcciones, agregar otro rango es trabajo y a veces implica mover máquinas. Segundo, si un día conectas tu VPC con otra (la de otro equipo, o la red de la oficina), los rangos **no pueden encimarse**: si las dos usan `10.0.0.0/16`, una dirección como `10.0.3.15` existiría en las dos redes y nadie sabría a cuál mandar el paquete. Por eso las empresas reparten los rangos con un plan: `10.0.0.0/16` para producción, `10.1.0.0/16` para pruebas, y así.

En AWS, una VPC acepta rangos de `/16` (la más grande) a `/28` (16 direcciones). Para C01 se usa `10.0.0.0/16`: 65,536 direcciones, muchas más de las que hacen falta, y es justo lo que quieres.

### Subredes: la VPC partida por zona

Una VPC vive en una región entera, pero una máquina vive en **una zona**. Para decidir en qué zona cae cada máquina, la VPC se parte en **[[subred|subredes]]** (*subnets*): pedazos del rango, cada uno dentro de una sola [[zona-disponibilidad|zona de disponibilidad]].

Cuando creas una máquina, eliges su subred. Con eso eliges dos cosas a la vez: su zona y el rango del que sale su IP. Si la subred `10.0.32.0/20` está en `us-east-1a`, toda máquina que pongas ahí vive en `1a` y tiene una IP entre `10.0.32.0` y `10.0.47.255`.

Las subredes de una VPC no se enciman entre sí, y cada una cabe completa dentro del rango de la VPC. En AWS, además, cada subred aparta **5 direcciones** que no puedes usar: las 4 primeras (la de la red, que nombra a la subred entera; la del router de la VPC; la del DNS, y una reservada) y la última.

El código parte la VPC de C01 en bloques `/20`. Corre tal cual con Python, sin instalar nada:

```python
import ipaddress
vpc = ipaddress.ip_network("10.0.0.0/16")
print("VPC", vpc, "→", f"{vpc.num_addresses:,}", "direcciones")
cortes = list(vpc.subnets(new_prefix=20))        # partir la VPC en bloques /20
print("caben", len(cortes), "subredes /20 de", f"{cortes[0].num_addresses:,}", "direcciones")
plan = {"publica-1a": cortes[0], "publica-1b": cortes[1],
        "privada-1a": cortes[2], "privada-1b": cortes[3]}
for nombre, red in plan.items():
    usables = red.num_addresses - 5              # AWS aparta 5 en cada subred
    print(f"{nombre:10}  {str(red):14} {red[0]} a {red[-1]}  usables: {usables:,}")
ip = ipaddress.ip_address("10.0.37.9")
print(ip, "vive en", [n for n, r in plan.items() if ip in r])
```

```salida
VPC 10.0.0.0/16 → 65,536 direcciones
caben 16 subredes /20 de 4,096 direcciones
publica-1a  10.0.0.0/20    10.0.0.0 a 10.0.15.255  usables: 4,091
publica-1b  10.0.16.0/20   10.0.16.0 a 10.0.31.255  usables: 4,091
privada-1a  10.0.32.0/20   10.0.32.0 a 10.0.47.255  usables: 4,091
privada-1b  10.0.48.0/20   10.0.48.0 a 10.0.63.255  usables: 4,091
10.0.37.9 vive en ['privada-1a']
```

C01 usa 4 de los 16 bloques. Los otros 12 quedan libres para crecer: una tercera zona, o subredes para otra cosa.

¿Para qué 4,091 direcciones por subred, si C01 tiene 4 máquinas? Porque en Kubernetes en AWS cada [[pod|pod]] recibe, por omisión, su propia IP **de la subred**. Un pod es lo que Kubernetes arranca y mueve como una unidad: uno o varios contenedores que corren juntos, por ejemplo una copia del gateway (lo ves a fondo en la estación de Kubernetes). Un [[nodo]] con 30 pods gasta al menos 31 direcciones: una suya y una por pod. Una subred `/24` (251 usables) se acaba antes del noveno nodo así (8 × 31 = 248), y a partir de ahí los pods nuevos no arrancan. Por eso las subredes de los nodos se hacen grandes.

:::profundo Por qué en la práctica se gastan más
El plugin de red de AWS (el programa que le asigna su IP a cada pod) aparta IPs de reserva en cada nodo, para que un pod nuevo arranque sin esperar a que le consigan una. Esas IPs de reserva también salen de la subred, aunque ningún pod las use todavía. Por eso un nodo con 30 pods gasta más de 31 direcciones, y la `/24` se acaba aún antes.
:::

### Subredes públicas y privadas

Las cuatro subredes de C01 se llaman «pública» y «privada», y esa es la diferencia más importante de toda la red.

Una **subred pública** es la que tiene un camino directo a internet: lo que pongas ahí puede tener una IP pública y recibir conexiones desde fuera. Una **[[subred-privada|subred privada]]** no tiene ese camino: lo que vive ahí no se alcanza desde internet, aunque quisieras. Lo que hace a una subred pública o privada no es su nombre ni su rango: es su **tabla de rutas**, que ves en la siguiente sección.

La regla es simple: **en la subred pública va solo lo que tiene que recibir tráfico de internet.** En C01 eso es el balanceador ([[alb|ALB]]) y los NAT gateways, que ves más adelante. Todo lo demás, los nodos del gateway y de Triton, va en las subredes privadas. Así, aunque alguien encuentre una falla de seguridad en Triton, no puede llegar a él desde fuera: no hay camino.

:::figura redes-nube-vpc
La VPC de C01: un rango `10.0.0.0/16` en la región `us-east-1`, partido en cuatro subredes, una pública y una privada en cada zona. Lo único que da a internet (el balanceador y los NAT) vive en las públicas.
:::

### La IP pública cuesta

Una máquina en una subred pública puede tener una **[[ip-publica|IP pública]]**: una dirección IPv4 única en el mundo, alcanzable desde internet. Las direcciones IPv4 son escasas (2³² ≈ 4,300 millones para todo el planeta), y desde febrero de 2024 AWS cobra cada IPv4 pública: ≈ US$0.005 por hora, ≈ US$3.65 al mes cada una, la uses o no.

Parece poco, y lo es, hasta que alguien crea los nodos de un cluster con IP pública «por si acaso». Cien nodos con IP pública son ≈ US$365 al mes por algo que, además, los expone. Los nodos de C01 no tienen IP pública: no la necesitan para nada.

## Tablas de rutas y grupos de seguridad: por dónde y quién {Route tables and security groups: which way and who}

Una red necesita responder dos preguntas por cada paquete. **¿Por dónde va?** Eso lo decide la tabla de rutas. **¿Tiene permiso?** Eso lo decide el grupo de seguridad. Son dos mecanismos distintos, y confundirlos causa muchísimos errores.

### La tabla de rutas: el letrero en cada cruce

Una **[[tabla-rutas|tabla de rutas]]** (*route table*) es una lista de reglas que dice, para cada destino, a dónde mandar el paquete. Cada subred tiene asociada una. Cada regla tiene dos partes: un rango de destino, en notación CIDR, y un «siguiente salto» (*target*): a quién se le entrega el paquete.

La tabla de una subred privada de C01 se ve así:

| Destino | Siguiente salto | Qué significa |
|---|---|---|
| `10.0.0.0/16` | `local` | Todo lo que está dentro de la VPC: se entrega directo. |
| rangos de S3 | el endpoint de S3 | Las IPs de S3 van por un atajo privado (lo ves más adelante). |
| `0.0.0.0/0` | el NAT gateway de su zona | Todo lo demás: internet, por la puerta de salida. |

`0.0.0.0/0` es el rango que lo contiene todo: deja fijos 0 bits, así que cualquier IP cabe. Es la «ruta por omisión».

Pero si `0.0.0.0/0` lo contiene todo, `10.0.37.9` cabe en dos reglas: en `10.0.0.0/16` y en `0.0.0.0/0`. ¿Cuál gana? **La más específica**: la que deja más bits fijos, es decir, el número más grande después de la diagonal. Tiene lógica: más bits fijos describen un grupo más chico y preciso, como «calle Juárez 12» contra «toda la ciudad». Se llama «coincidencia del prefijo más largo» (*longest prefix match*), y es lo que hace cada router de internet con cada paquete.

El código hace lo mismo que el router de la VPC. El rango de S3 es un ejemplo (S3 usa muchos rangos, y AWS los guarda en una lista que mete en la tabla por ti):

```python
import ipaddress
tabla = [("10.0.0.0/16", "local (dentro de la VPC)"),
         ("52.216.0.0/15", "vpce-s3 (gateway endpoint)"),   # un rango de ejemplo de S3
         ("0.0.0.0/0", "nat-1a (NAT gateway)")]

def ruta(destino):
    ip = ipaddress.ip_address(destino)
    candidatas = [(ipaddress.ip_network(red), salto) for red, salto in tabla
                  if ip in ipaddress.ip_network(red)]
    red, salto = max(candidatas, key=lambda c: c[0].prefixlen)   # la más específica gana
    return f"{destino:12} → {salto}  (coincide con {red}, /{red.prefixlen})"

for d in ("10.0.37.9", "52.217.3.4", "8.8.8.8"):
    print(ruta(d))
```

```salida
10.0.37.9    → local (dentro de la VPC)  (coincide con 10.0.0.0/16, /16)
52.217.3.4   → vpce-s3 (gateway endpoint)  (coincide con 52.216.0.0/15, /15)
8.8.8.8      → nat-1a (NAT gateway)  (coincide con 0.0.0.0/0, /0)
```

Las tres IPs caben en `0.0.0.0/0`, pero solo `8.8.8.8` termina ahí: las otras dos tienen una regla más específica. Esa es la razón por la que agregar el endpoint de S3 cambia el camino de las descargas **sin tocar ningún programa**: el programa sigue pidiendo lo mismo a la misma dirección, y la tabla manda los paquetes por otro lado.

### El internet gateway: lo que hace pública a una subred

Ahora sí: ¿qué hace pública a una subred? Que su tabla de rutas tenga la regla `0.0.0.0/0 → internet gateway`.

El **[[internet-gateway|internet gateway]]** es la puerta de la VPC hacia internet. Se pega a la VPC entera (no a una zona), no cobra por hora ni por GB, y traduce entre la IP privada de una máquina y su IP pública. Una máquina de la subred pública con IP pública sale y entra por él directo.

:::nota Muchos «gateways»
En AWS, «gateway» (puerta) aparece en varios nombres: internet gateway, NAT gateway, gateway endpoint. Ninguno es el gateway de C01, el programa que recibe la foto y arma el tensor. Aquí, «el gateway» a secas siempre es el de C01.
:::

Una subred privada no tiene esa regla. Su `0.0.0.0/0` apunta al NAT, o a nada. Sin ruta, el paquete no tiene a dónde ir: la máquina simplemente no llega a internet, y desde internet nadie llega a ella.

:::ojo
«Pública» y «privada» no son etiquetas que pones al crear la subred. Si alguien agrega `0.0.0.0/0 → internet gateway` a la tabla de una subred «privada», acaba de volverla pública, aunque se siga llamando `privada-1a`. Revisa la tabla, no el nombre.
:::

### El grupo de seguridad: la lista de invitados

La tabla de rutas dice **por dónde** puede ir un paquete. No dice **si debe** llegar. Dentro de la VPC, la regla `local` hace que cualquier máquina pueda mandarle paquetes a cualquier otra. Sin nada más, una máquina de pruebas que alguien olvidó en la VPC podría conectarse a Triton.

Para eso está el **[[grupo-seguridad|grupo de seguridad]]** (*security group*): un *firewall* (un filtro que decide qué conexiones dejar pasar) pegado a cada máquina. Más exactamente, a su tarjeta de red: la pieza (aquí, virtual) por la que la máquina se conecta a la red. Tiene una lista de qué conexiones se aceptan. Funciona así:

- **Solo hay reglas de «permitir».** Lo que no está en la lista, no entra. Un grupo nuevo no acepta ninguna conexión de entrada y deja salir todo.
- **Cada regla dice** un [[protocolo]], un [[puerto]] o rango de puertos y un origen. El origen puede ser un rango CIDR, como `10.0.0.0/16`, o **otro grupo de seguridad**: «acepta conexiones de cualquier máquina que lleve el grupo `gateway`».
- **Recuerda las conexiones** (en inglés, *stateful*). Si dejas entrar una conexión, sus respuestas salen sin necesidad de otra regla. Si una máquina abre una conexión hacia fuera, las respuestas entran.

El origen «otro grupo» es el truco que lo hace manejable. Las IPs de los pods y de los nodos cambian cada vez que se recrean. Una regla que dice «acepta a quien lleve el grupo `gateway`» sigue valiendo aunque mañana el gateway tenga otras IPs.

Los grupos de C01 quedan así:

| Grupo | Acepta entrada de | Puerto | Por qué |
|---|---|---|---|
| `alb` | `0.0.0.0/0` (cualquiera) | 443 (HTTPS) | Es la puerta de entrada pública. |
| `gateway` | el grupo `alb` | 8080 | Solo el balanceador le habla al gateway. |
| `triton` | el grupo `gateway` | 8000 (HTTP) y 8001 ([[grpc\|gRPC]]) | Solo el gateway le habla a Triton. |

Fíjate en la cadena. Desde internet solo se llega al balanceador, al puerto 443. El balanceador solo puede hablarle al gateway. El gateway, a Triton. Nadie se salta un eslabón.

:::profundo La regla en la práctica: la CLI y Kubernetes
Así se escribe la regla de Triton con la [[api-nube|CLI]] de AWS, el programa `aws` de la terminal que viste en la lección de la nube. Es una ilustración (no la vas a correr aquí, necesitarías una cuenta), y los ids son inventados:

```bash
# Triton acepta en el puerto 8000 solo a las máquinas que llevan el grupo del gateway
aws ec2 authorize-security-group-ingress \
  --group-id sg-0triton1234567890 \
  --protocol tcp --port 8000 \
  --source-group sg-0gateway123456789
```

**Dentro de Kubernetes.** Un grupo de seguridad trabaja a nivel de máquina (o de tarjeta de red). Dentro de Kubernetes, donde muchos pods comparten un nodo, la misma idea se escribe por pod con una *NetworkPolicy*: «Triton solo acepta tráfico de los pods del gateway». La Ronda la menciona en M15, y la vas a escribir en la estación de Kubernetes del Dojo. Las dos capas se usan juntas.
:::

:::profundo La otra lista: las ACL de red
AWS tiene un segundo filtro, la *network ACL*, pegado a la subred entera en lugar de a cada máquina. Se diferencia en dos cosas: acepta reglas de «negar» además de «permitir», y **no recuerda las conexiones** (*stateless*): si dejas entrar una request, tienes que permitir aparte la salida de su respuesta, que va a un puerto alto y cambiante. Por eso casi nadie la toca: la ACL por omisión deja pasar todo, y el control fino se hace con grupos de seguridad. Se usa para bloquear un rango completo de un golpe, como una red que te está atacando.
:::

## Salir a internet: el NAT gateway {Going out: the NAT gateway}

Los nodos de C01 viven en subredes privadas: nadie llega a ellos desde internet. Pero ellos sí necesitan salir de vez en cuando: bajar parches del sistema operativo, instalar un paquete de Python, llamar a la API de un tercero. ¿Cómo sale una máquina que no tiene IP pública ni ruta al internet gateway?

Por el **[[nat|NAT gateway]]**. En la lección de red viste el NAT de tu casa: el router cambia la IP privada de cada paquete por su IP pública, anota el cambio y, cuando llega la respuesta, la regresa al aparato correcto. El NAT gateway hace exactamente eso, como servicio de la nube:

1. Vive en una **subred pública** y tiene una IP pública propia (así es el NAT clásico, el «zonal»; abajo ves la variante regional).
2. La tabla de la subred privada dice `0.0.0.0/0 → NAT gateway`.
3. El nodo manda su paquete; el NAT cambia la IP de origen (`10.0.37.9`) por la suya y lo manda por el internet gateway.
4. La respuesta vuelve al NAT, que la regresa al nodo.

Lo importante es la dirección: **solo deja salir**. Una conexión que nace afuera no tiene a dónde ir, porque el NAT solo sabe regresar respuestas de conexiones que abrió alguien de adentro. Los nodos pueden bajar parches y siguen siendo inalcanzables.

### Cómo cobra el NAT

Aquí empieza el tema de dinero. Un NAT gateway en AWS cobra dos cosas:

- **Por hora**, exista tráfico o no: ≈ US$0.045 por hora, ≈ US$33 al mes cada uno.
- **Por cada GB que pasa por él**, en cualquier dirección: ≈ US$0.045 por GB.

:::analogia La caseta de la salida
El NAT es como la caseta de un fraccionamiento cerrado. Deja salir a los vecinos y les abre cuando regresan, pero no deja entrar a extraños. Y cobra a cada coche que pasa, vaya o venga.

Dónde se rompe: la caseta real cobra por coche, y un coche con un pasajero paga lo mismo que uno lleno. El NAT cobra por GB: lo que importa es cuánto pesa lo que pasa, no cuántas veces pasa.
:::

El cobro por GB tiene nombre: **[[cargo-datos-procesados|cargo por datos procesados]]** (*data processing charge*). Es lo que cobra un servicio gestionado (uno que el proveedor opera por ti, como el NAT) por cada GB que pasa por él, aparte de sus horas. No es lo mismo que el egress (que ves más adelante): es un peaje por usar la caseta, salga o no el dato de la nube. Lo cobran el NAT, los endpoints de interfaz y las plataformas de ML como SageMaker AI.

«En cualquier dirección» es la trampa. Bajar un archivo de 1 GB por el NAT paga 1 GB procesado, aunque meter datos a la nube desde internet no se cobre (lo ves en la sección de egress). La caseta cobra a todos los que pasan, entren o salgan.

Un caso de la Ronda muestra cuánto suma. En la segmentación de imágenes médicas (c04), los nodos bajan de S3 láminas de patología: fotos de microscopio de ≈ 1 GB. Sin endpoint, todas pasan por el NAT.

:::cuenta Las láminas de patología de c04, por el NAT
Lo que baja cada lámina // imagen de microscopio completa (WSI, *whole-slide image*), de la Ronda | — | ≈ 1 GB
Láminas al día | — | 1,200
GB al mes // con 30 días, como en la Ronda | 1,200 × 1 × 30 | 36,000 GB = 36 TB
Cargo del NAT // US$0.045 por GB procesado | 36,000 × 0.045 | **≈ US$1,620 al mes**
Lo que cuestan sus GPUs al mes // de la Ronda | — | ≈ US$441
Lo mismo por un endpoint de S3 // sin cargo por GB | 36,000 × 0 | **US$0**
= Por inercia, la caseta cobra ≈ 3.7 veces lo que cuestan las GPUs. Un cambio en la tabla de rutas lo deja en cero.
:::

¿Por qué pasaría así? Porque el NAT es la salida por omisión. Si nadie piensa en la ruta, todo lo que va fuera de la VPC (S3 incluido, porque S3 tiene IPs públicas) se va por `0.0.0.0/0`, o sea, por el NAT. Y en la factura no aparece bajo «S3», donde lo buscarías: aparece como datos procesados del NAT gateway, que Cost Explorer (la herramienta de AWS que desglosa la factura) mete en el servicio «EC2 - Other».

### Un NAT por zona

El NAT gateway clásico (el «zonal», el que usa C01) vive en **una** zona. Si C01 pone un solo NAT en `1a` para ahorrarse las horas del segundo (≈ US$33 al mes), pasan dos cosas malas:

- Todo lo que sale de `1b` cruza a `1a` para llegar al NAT, y ese cruce se cobra aparte (lo ves más adelante, en «Cruzar de zona y de región»).
- Si cae `1a`, las máquinas de `1b` se quedan sin salida a internet, justo cuando estás en emergencia.

El estándar es **un NAT por zona**, cada subred privada apuntando al de su zona. Es lo que viste en la lección de regiones: no compartas una pieza entre zonas si su caída tumba a las dos.

:::profundo El NAT regional
Desde noviembre de 2025, AWS ofrece también un **NAT gateway regional**: un solo recurso que se extiende a cada zona donde tienes máquinas, sin necesitar subredes públicas para él. Cobra la misma hora por cada zona que cubre y los mismos ≈ US$0.045 por GB. Por dentro sigue siendo un NAT por zona: te ahorra armarlo a mano, no el costo. Mientras no cubre una zona (tarda de minutos a una hora en extenderse a una zona nueva), el tráfico de esa zona sale por otra y paga cruce.
:::

:::nota Lo que sí debe pasar por el NAT
Poco y chico: parches del sistema operativo, la API de un tercero, una consulta a un servicio externo. Lo que **no** debe pasar: lo pesado y repetido. Pesos del modelo, imágenes de contenedor, datasets, fotos y logs van por endpoints privados.
:::

## Endpoints de VPC: atajos privados a S3 y compañía {VPC endpoints: private shortcuts to S3 and friends}

S3 no vive dentro de tu VPC. Es un servicio regional de AWS, con sus propias IPs, compartido por todos los clientes de la región. Lo mismo pasa con ECR (*Elastic Container Registry*), el registro donde guardas las [[imagen-contenedor|imágenes de contenedor]]. Una imagen de contenedor es el paquete con tu programa y todo lo que necesita para correr (el sistema base, las bibliotecas, los archivos), listo para arrancar como contenedor en cualquier máquina; los contenedores los viste en la lección del sistema operativo. Y lo mismo, con CloudWatch (logs y métricas) y con casi todo lo demás que no es una máquina tuya.

Entonces, ¿cómo llega un nodo de una subred privada a S3? Sin nada especial, por el NAT, pagando cada GB. La alternativa es un **[[vpc-endpoint|endpoint de VPC]]** (*VPC endpoint*): un camino privado de tu VPC a un servicio de AWS que no pasa por internet ni por el NAT. Hay dos tipos, y la diferencia vale dinero.

### Gateway endpoint: una regla en la tabla, gratis

El **gateway endpoint** existe solo para dos servicios: **S3 y DynamoDB** (una base de datos de AWS). No es una máquina ni vive en una zona. Es una regla nueva en tus tablas de rutas: «los rangos de S3 van por aquí». Viste esa regla en el código de la sección anterior: la más específica gana, así que todo el tráfico a S3 deja de ir al NAT.

Y lo mejor: **no cobra ni por hora ni por GB**. Es, como dice la Ronda, la línea más barata de toda la factura y la que más se olvida.

Crearlo es un solo comando, y ningún programa cambia: el gateway de C01 sigue pidiendo `s3://...` como antes, y los paquetes ahora toman el atajo.

:::profundo El comando
Así se crea con la CLI, en una ilustración (no la vas a correr aquí; los ids son inventados):

```bash
# Un gateway endpoint de S3, pegado a las tablas de rutas de las dos subredes privadas
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0c01demo \
  --service-name com.amazonaws.us-east-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-0privada1a rtb-0privada1b
```
:::

### Interface endpoint: una tarjeta de red en tu subred, con cobro

Para los demás servicios (ECR, CloudWatch, STS —el que entrega credenciales temporales—, SageMaker AI —la plataforma de ML de AWS— y cientos más) existe el **interface endpoint**. En lugar de una regla en la tabla, AWS pone una **tarjeta de red** dentro de tu subred, con una IP privada tuya, que conecta por dentro con el servicio. El DNS se encarga de que el nombre del servicio, como `api.ecr.us-east-1.amazonaws.com`, apunte a esa IP privada.

La tecnología que lo hace se llama **[[privatelink|PrivateLink]]**. Este sí cobra:

- ≈ US$0.01 por hora **por zona** donde lo pongas (uno por zona, como el NAT).
- ≈ US$0.01 por GB procesado.

Su cobro por GB es menos de una cuarta parte del que cobra el NAT (0.01 ÷ 0.045 ≈ 22 %). Por eso, para un servicio con mucho tráfico, el interface endpoint ahorra. Para uno con poco tráfico, sus horas pueden costar más que lo que ahorra: dos zonas × US$0.01 × 730 h ≈ US$14.60 al mes por endpoint, aunque no pase nada.

:::ojo La trampa de ECR
Para bajar una imagen de contenedor desde una subred privada sin NAT, C01 crea los interface endpoints `ecr.api` y `ecr.dkr`. Y el *pull* (la descarga de la imagen) falla. ¿Por qué? Una imagen se guarda en pedazos llamados [[capa-imagen|capas]]: una con el sistema base, otra con las bibliotecas, otra con tu código. Esos endpoints solo entregan el **manifiesto**, la lista de capas de la imagen. Las capas, los GB de verdad, ECR las guarda **en S3**, y el nodo las baja de S3. Sin el gateway endpoint de S3, esas descargas buscan el NAT; si no hay NAT, fallan, y si hay, pagan US$0.045 por GB. La receta completa: `ecr.api` + `ecr.dkr` + el gateway endpoint de S3.
:::

:::diagrama redes-nube-salidas
Toca cada caja para ver qué hace y cuánto cobra. Usa «Recorrer» para ver una descarga de pesos y un *pull* de imagen, primero por inercia y luego con endpoints.
:::

:::profundo PrivateLink para lo tuyo, y lo mismo en Google Cloud y Azure
PrivateLink sirve también para exponer un servicio **tuyo** a otra VPC (de otro equipo o de un cliente) sin conectar las redes completas.

La idea existe en las tres nubes, con otros nombres. En Google Cloud, *Private Google Access* deja a las máquinas sin IP pública llegar a Cloud Storage y demás APIs de Google, y *Private Service Connect* es su PrivateLink. En Azure, el *Private Endpoint* pone una IP privada de tu red frente a un servicio (la tecnología se llama Private Link). En las tres, la pregunta de diseño es la misma: **¿qué tráfico pesado está pasando por la caseta de salida y podría ir por un atajo privado?**
:::

## Egress y transferencias: lo que sale y lo que cruza {Egress and transfers: what leaves and what crosses}

Hay una asimetría en la nube que conviene saber de memoria: **meter datos es gratis; sacarlos, no.**

Subir fotos, datasets o pesos a AWS desde internet no cuesta nada por GB: se llama *ingress* (entrada). Lo que sale de AWS hacia internet sí se cobra por GB, y se llama **[[egress]]** (salida). En `us-east-1`, la tarifa va por escalones, cada mes:

| Lo que sale en el mes | Precio por GB |
|---|---|
| Los primeros 100 GB | gratis (sumando todos los servicios y regiones de la cuenta) |
| Hasta 10 TB | ≈ US$0.09 |
| Los siguientes 40 TB | ≈ US$0.085 |
| Los siguientes 100 TB | ≈ US$0.07 |
| Más de 150 TB | ≈ US$0.05 |

¿Por qué esa asimetría? Una parte es costo real: la nube paga por conectarse con el resto de internet. La otra es negocio: si meter es gratis y sacar cuesta, una vez que tus datos están adentro, te quedas. Es parte de la [[dependencia-proveedor|dependencia del proveedor]] que viste en la lección de la nube: llevarte 50 TB a otro proveedor tiene precio.

Los escalones se cobran como los impuestos por tramos: cada GB paga el precio de su tramo, no el del último. Si en un mes sacas 12 TB, los primeros 100 GB no pagan, los siguientes 10,000 GB pagan 0.09 (US$900) y solo los 1,900 GB que sobran pagan 0.085 (US$161.50): ≈ US$1,062 en total.

:::profundo Los escalones, en código
El código cobra un mes de egress tramo por tramo (aquí 1 TB = 1,000 GB, para que la cuenta se siga con lápiz; AWS corta los tramos en múltiplos de 1,024 GB, y la diferencia es menor al 1 %):

```python
ESCALONES = [(10_000, 0.09), (40_000, 0.085), (100_000, 0.07), (float("inf"), 0.05)]  # GB, US$/GB

def egress(gb_mes, gratis=100):
    resto, total = max(gb_mes - gratis, 0), 0.0
    for tamano, precio in ESCALONES:
        tramo = min(resto, tamano)       # lo que cae en este escalón
        total += tramo * precio
        resto -= tramo
    return total

for nombre, gb in (("respuestas de C01", 304), ("un dataset de 2 TB", 2_000),
                   ("copiar 50 TB a otra nube", 50_000), ("200 TB al mes", 200_000)):
    print(f"{nombre:25} {gb:>8,} GB → US${egress(gb):>9,.0f}  (US${egress(gb) / gb:.3f} por GB)")
```

```salida
respuestas de C01              304 GB → US$       18  (US$0.060 por GB)
un dataset de 2 TB           2,000 GB → US$      171  (US$0.086 por GB)
copiar 50 TB a otra nube    50,000 GB → US$    4,292  (US$0.086 por GB)
200 TB al mes              200,000 GB → US$   13,795  (US$0.069 por GB)
```
:::

Fíjate en C01: sus respuestas son pequeñas. Cada una es un JSON de ≈ 1 KB con la categoría y su probabilidad. En C01 van al backend, que está en la misma región, así que ni siquiera son egress. Pero aunque todas salieran a internet, serían 304 millones de respuestas al mes × 1 KB ≈ 304 GB, ≈ US$18 al mes (≈ US$27 si no existieran los 100 GB gratis). Lo que entra es grande (fotos de 200 KB); lo que sale, chiquito. **En casi todo sistema de ML que recibe fotos, audio o video, el egress no es el problema.**

:::ojo «El problema es el egress»
En el caso c02 de la Ronda (video de 1,000 cámaras de seguridad), es tentador decir «mandar el video a la nube cuesta mucho de egress». Pero subir video **no** es egress: entrar es gratis. Lo que cuesta es el ancho de banda de internet del sitio, la ingesta y el cómputo. Antes de decir «egress», pregúntate en qué dirección van los bytes.
:::

Donde sí duele el egress es cuando lo grande va **hacia fuera**: servir video o imágenes a usuarios (por eso existen las [[cdn|CDN]], que además cobran menos por GB), entregarle un dataset grande a un cliente, o copiar todo a otra nube.

### Cruzar de zona y de región

Ahora, el cargo que más sorprende. Dentro de tu propia VPC, entre tus propias máquinas, ¿cuánto cuesta mover un GB?

Depende de dónde estén:

- **En la misma zona**, con IPs privadas: **gratis**.
- **En zonas distintas** de la misma región: ≈ US$0.01 por GB **al salir** de una zona y otros ≈ US$0.01 por GB **al entrar** a la otra. Es la **[[transferencia-entre-zonas|transferencia entre zonas]]** (*cross-AZ data transfer*).
- **En regiones distintas**: ≈ US$0.02 por GB desde `us-east-1` a casi cualquier otra región (≈ US$0.01 a `us-east-2`, la de Ohio). Es la **[[transferencia-entre-regiones|transferencia entre regiones]]** (*inter-region transfer*). Lo cobra la región de donde salen los datos.

El cruce de zona tiene una trampa de lectura: la tarifa dice «US$0.01 por GB», pero **cada GB que cruza se cobra dos veces**: una al salir de `1a` y otra al entrar a `1b`, las dos en tu factura. Por eso las cuentas usan **US$0.02 por GB cruzado**.

¿Por qué se cobra, si está «en la misma red»? Porque físicamente no lo está. En la lección de regiones viste que las zonas son edificios distintos, a kilómetros, unidos por fibra que el proveedor tendió y mantiene. Ese tráfico usa esa fibra. Dentro de la zona, el tráfico se queda en el edificio.

**La latencia no es la razón.** Cruzar de zona agrega ≈ 1 ms por salto: el [[rtt|RTT]] (el tiempo de ida y vuelta de un paquete) en la misma zona es ≈ 0.1–0.5 ms y entre zonas ≈ 0.4–2.5 ms. Para C01, con un [[slo|SLO]] de cientos de milisegundos, un milisegundo no importa. **La razón para no cruzar es el costo por GB, no la latencia.** Y el costo depende de cuántos bytes cruzan, que en C01 son muchos.

¿Por qué cruzarían? Entre el gateway y Triton está el [[service-k8s|Service]] de Kubernetes, que reparte cada tensor entre las copias de Triton. Por omisión no mira en qué zona está cada copia: con dos zonas, la mitad de los tensores cae en la otra.

:::cuenta C01 sin ruteo por zona
Bytes de un tensor FP32 // 224 × 224 × 3 números de 4 bytes | 224 × 224 × 3 × 4 | 602,112 B ≈ 602 KB
Requests al mes // 10 millones al día × 30.4 días | 10,000,000 × 30.4 | 304 millones
Tensores al mes, gateway → Triton | 304 M × 602,112 B | ≈ 183 TB
Fracción que cruza de zona // el Service reparte entre 2 zonas sin mirar dónde está | — | ≈ 50 %
TB que cruzan al mes | 183 × 0.5 | ≈ 91.5 TB
Costo // US$0.01 al salir + US$0.01 al entrar | 91,500 GB × 0.02 | **≈ US$1,830 al mes**
Las dos GPUs T4 de C01 // de la lección de máquinas | — | ≈ US$768 al mes
= Mover los tensores de una zona a otra costaría más del doble que las GPUs que los procesan.
:::

El remedio ya lo viste en la lección de regiones: el **[[ruteo-por-zona|ruteo por zona]]**. Cada gateway llama al Triton de su propia zona y solo cruza si el suyo no está listo. Con eso, el cruce casi desaparece. C01 lo activa desde el primer día. Aquí solo le pusiste precio a lo que evita.

Fíjate qué hace grande la cuenta: no son los requests, son los **bytes por request**. Si el gateway mandara el tensor en [[uint8]] (150,528 B, un byte por número, como hace C01 cuando crece), el mismo cruce costaría la cuarta parte. Si mandara solo el JPEG de 200 KB y Triton hiciera el preproceso, un tercio. Por eso la Ronda pide preguntar primero por el *payload*: los bytes que lleva cada request.

**Entre regiones.** Copiar a otra región cuesta ≈ US$0.02 por GB, igual que un GB cruzado entre zonas. La diferencia está en lo que se copia. Entre zonas, el tráfico de cada request. Entre regiones, normalmente, una copia de seguridad o una réplica: en la lección de regiones viste que replicar las fotos de C01 (≈ 61 TB al mes) costaría ≈ US$1,200 al mes solo de transferencia, y por eso C01 replica los pesos, que son centavos, y no las fotos.

:::figura redes-nube-tarifas
Cuánto cuesta mover 1 GB por cada camino, en `us-east-1`. Lo gratis está arriba; lo caro, abajo. Los dos caminos más caros son también los que se toman sin pensar: el NAT y la salida a internet.
:::

:::calculadora redes-nube-flecha
Arranca con los tensores de C01: 602 KB, 10 millones al día y la mitad cruzando de zona. Baja el cruce a 1 % para ver el ruteo por zona, o pon 200 KB para ver lo que costaría mandar el JPEG.
:::

## El balanceador cobra por bytes: ALB y LCU {The load balancer bills by bytes: ALB and LCU}

En la lección de balanceo viste qué hace un [[balanceador]]: recibe las requests y las reparte entre varias copias sanas. En AWS, el que usa C01 es el **[[alb|ALB]]** (*Application Load Balancer*): un balanceador gestionado que entiende HTTP y vive en las subredes públicas de varias zonas a la vez. Además, «termina» el HTTPS: recibe la conexión cifrada y la descifra, para poder leer cada request y decidir a qué máquina pasarla.

Lo que nadie espera es cómo cobra. Además de su hora (≈ US$0.0225, ≈ US$16 al mes), cobra por **[[lcu|LCU]]** (*Load Balancer Capacity Unit*, unidad de capacidad del balanceador): ≈ US$0.008 por LCU-hora (cada LCU usada durante una hora, como el kilowatt-hora de la luz).

Una LCU mide cuánto trabajo hizo el ALB en una hora. Tiene cuatro dimensiones, y AWS cobra **la más alta** de las cuatro. Cada hora mide las cuatro, convierte cada una en LCU y se queda con la mayor. Si en una hora el ALB procesó 83 GB (83 LCU por bytes) y abrió 50 conexiones nuevas por segundo (2 LCU), esa hora cobra 83 LCU, no 85.

| Dimensión | 1 LCU equivale a… |
|---|---|
| Conexiones nuevas | 25 por segundo |
| Conexiones activas | 3,000 por minuto |
| **Bytes procesados** | **1 GB por hora** (hacia tus máquinas) |
| Evaluaciones de reglas | 1,000 por segundo |

Para un sistema que manda fotos en el *body* de la request, casi siempre gana la dimensión de bytes (cuentan los bytes de la request y de la respuesta). Y ahí sale una regla útil: si 1 LCU = 1 GB en una hora y cuesta US$0.008 por hora, entonces **el ALB cobra ≈ US$0.008 por cada GB que pasa**, como otra caseta, más su hora.

:::cuenta El ALB de C01
Fotos que entran al día // 10 millones × 200 KB | 10,000,000 × 200 KB | 2 TB = 2,000 GB
GB por hora, en promedio // GB del mes ÷ horas del mes | 2,000 × 30.4 ÷ 730 | ≈ 83 GB/h
LCUs en promedio // la dimensión de bytes gana | 83 GB/h ÷ 1 GB/h | ≈ 83 LCU
Costo de las LCU al mes | 83.3 × 0.008 × 730 | ≈ US$486.5
Hora fija del ALB | 0.0225 × 730 | ≈ US$16.4
Total | 486.5 + 16.4 | **≈ US$503 al mes**
= Casi el 30 % de la infraestructura de C01 (≈ US$1.75k al mes), por una pieza que la gente estima en «US$30 de load balancer».
:::

El ALB cobra por bytes, no por request, y C01 mueve 61 TB al mes de fotos a través de él. Si el 15 % de las fotos llegara como original de la web (≈ 3 MB en vez de 200 KB), los bytes se triplicarían y el ALB pasaría a ≈ US$1.5k al mes.

:::profundo La palanca: mandar la llave, no los bytes
¿Cómo baja esa línea? Que la foto no pase por el ALB. El backend de publicaciones ya guarda la foto de Ana en S3. En lugar de mandarle a C01 los 200 KB, le manda la **llave** del objeto, `fotos/2026/11/06/ana-tenis.jpg`, unas decenas de bytes. El gateway baja la foto de S3 por el gateway endpoint, gratis.

Según la Ronda, el ALB baja de ≈ US$500 a ≈ US$20 al mes, y aparecen 304 millones de GET a S3, ≈ US$120 al mes. Ahorro neto: ≈ US$360 al mes. Con dos condiciones:

- **Que exista el gateway endpoint de S3.** Sin él, esos 61 TB al mes pasarían por el NAT: ≈ US$2.7k al mes. La palanca se volvería un desastre.
- **Que el GET extra quepa en la latencia.** Un GET de un objeto chico a S3 tarda decenas de milisegundos en la mediana, y más en la cola. Hay que medir el [[p99]] antes de cambiar.

Es un buen ejemplo de cómo funciona el costo de red: cambiar **por dónde** van los bytes mueve cientos de dólares, sin tocar el modelo.
:::

## El ancho de banda de la instancia {Instance network bandwidth} [extra]

Hasta aquí, la red costaba dinero. También tiene un **límite**: cada [[instancia]] que rentas trae un [[ancho-banda|ancho de banda]] de red máximo, según su tipo. Y es más fácil de rebasar de lo que parece, sobre todo cuando mandas tensores.

AWS da dos números por tipo de máquina. Juntos son el **[[ancho-banda-baseline|ancho de banda sostenido y de ráfaga]]** (*baseline* y *burst*):

- **Sostenido** (*baseline*): lo que la máquina puede mover todo el tiempo.
- **De ráfaga** (*burst*): un tope más alto que aguanta solo por ratos, mientras le quedan «créditos»: según AWS, típicamente de 5 a 60 minutos según el tamaño de la máquina, y sin garantía (la ráfaga es «de mejor esfuerzo»). Cuando se le acaban, baja al sostenido.

Las tablas de AWS suelen anunciar el número grande con un «hasta»: «hasta 12.5 Gb/s». Ese «hasta» es la ráfaga. El que importa para diseñar es el sostenido.

| Instancia | Sostenido | Ráfaga |
|---|---|---|
| `c6i.xlarge` (gateway de C01) | 1.56 Gb/s | hasta 12.5 Gb/s |
| `g4dn.xlarge` (Triton de C01, T4) | 5 Gb/s | hasta 25 Gb/s |
| `g5.xlarge` y `g6.xlarge` | 2.5 Gb/s | hasta 10 Gb/s |

Las unidades son [[bit|bits]] por segundo, no bytes: 1 Gb/s = 125 MB/s. Es el error de conversión más común de esta lección.

El límite vale **por separado** para lo que entra y lo que sale: una máquina de «hasta 10 Gb/s» puede recibir 10 y, al mismo tiempo, mandar 10.

:::figura redes-nube-banda
Sostenido contra ráfaga de las tres instancias. Las líneas a y b marcan lo que tiene que mandar un nodo del gateway de C01: 1.2 Gb/s en un día normal, 2.4 Gb/s si cae una zona.
:::

### El gateway de C01, al límite

En el pico, C01 recibe 500 fotos por segundo. Cada una sale del gateway como un tensor FP32 de 602,112 bytes:

500 × 602,112 × 8 bits ≈ **2.4 Gb/s** entre el gateway y Triton.

Con dos nodos de gateway, uno por zona, cada uno manda ≈ 1.2 Gb/s: el 77 % de su sostenido de 1.56. (Las fotos que le entran, 500 × 200 KB × 8 ≈ 0.8 Gb/s en total, van por el otro sentido y no le restan.) Apretado, pero cabe. Ahora cae una zona: el nodo que queda manda los 2.4 Gb/s solo, el **154 %** de su sostenido. Aguanta mientras dure la ráfaga, de minutos a una hora y sin garantía, y luego empieza a tirar paquetes o a encolarlos. La latencia sube justo durante la emergencia.

Tres salidas, de la Ronda:

1. **Tensores más chicos.** En UINT8 son 150,528 B: la red baja a la cuarta parte, ≈ 0.6 Gb/s en total. Es la que usa C01 al crecer.
2. **Más nodos de gateway**, o uno más grande con más red.
3. **Mandar el JPEG** y que Triton haga el preproceso: 200 KB en vez de 602.

En el sistema de recomendación de la Ronda (el caso c08) pasa lo mismo con una máquina de GPU: una `g6.xlarge` tiene 2.5 Gb/s sostenidos y su pico usa el 100 %. La salida fue subir a `g6.2xlarge` (5 Gb/s) por ≈ US$126 al mes más por nodo. No por la GPU, que era la misma: por la red.

:::calculadora redes-nube-banda
Arranca con el pico de C01 en FP32. El renglón «si cae una zona» ya muestra lo que pasa con un nodo menos. Pon 150 KB para ver UINT8, o sube los nodos a 3 para ver cuánto alivia un nodo extra.
:::

## Recorrer cada byte: la factura de red de C01 {Walking every byte: C01's network bill}

Ya tienes todas las piezas. La Ronda (M13) da una técnica para encontrar los costos de red antes de que lleguen en la factura: **recorre cada byte**. Para cada flecha del diagrama pregúntate tres cosas:

1. **¿Quién lo mueve, y cuántos bytes por request?**
2. **¿Cuántas veces al mes?** Bytes por request × requests al mes.
3. **¿Por dónde pasa?** Misma zona, otra zona, NAT, endpoint, ALB o internet. Cada camino tiene su tarifa.

Multiplica, y tienes la línea de la factura. La señal de alguien con experiencia es preguntar por el payload **antes** que por la GPU: «¿cuántos bytes por request y a dónde van?».

:::diagrama redes-nube-bytes
Toca cada caja para ver qué pasa por ahí. Usa «Recorrer» para seguir la foto de Ana, ver lo que pasa sin ruteo por zona y ver lo que mueve una réplica nueva al arrancar.
:::

El código hace el recorrido completo para un mes de C01 en dos versiones: **por inercia** (sin ruteo por zona y con todo lo de afuera pasando por el NAT) y **bien hecha** (ruteo por zona, endpoints para S3 y ECR, el NAT solo para parches). Supone que con ruteo por zona solo el 1 % de los tensores cruza (cuando una réplica se reinicia o se cae) y unos 20 GB al mes de parches; los demás números son de la Ronda.

```python
MES, GB = 730, 1e9                          # horas en un mes, bytes en un GB
requests = 10_000_000 * 30.4                # fotos al mes
fotos = requests * 200_000 / GB             # GB de fotos que entran al ALB
tensores = requests * 602_112 / GB          # GB de tensores FP32, gateway → Triton
logs, imagenes, parches = 3 * 30.4, 60 * 9.2, 20   # GB al mes

#                    (por inercia,                 bien hecho)
lineas = {
  "ALB (hora + LCU)":   (0.0225*MES + fotos*0.008,   0.0225*MES + fotos*0.008),
  "cruce de zona":      (0.5*tensores*0.02,          0.01*tensores*0.02),  # 50 % o 1 % cruza
  "NAT: horas":         (2*0.045*MES,                2*0.045*MES),
  "NAT: GB procesados": ((logs+imagenes+parches)*0.045, parches*0.045),
  "IPv4 de los NAT":    (2*0.005*MES,                2*0.005*MES),
  "endpoints de ECR":   (0,                          2*2*0.01*MES),        # 2 endpoints × 2 zonas
}
for nombre, (malo, bueno) in lineas.items():
    print(f"{nombre:19} US${malo:6,.0f}   US${bueno:6,.0f}")
total = [sum(v[i] for v in lineas.values()) for i in (0, 1)]
print(f"{'total':19} US${total[0]:6,.0f}   US${total[1]:6,.0f}")
```

```salida
ALB (hora + LCU)    US$   503   US$   503
cruce de zona       US$ 1,830   US$    37
NAT: horas          US$    66   US$    66
NAT: GB procesados  US$    30   US$     1
IPv4 de los NAT     US$     7   US$     7
endpoints de ECR    US$     0   US$    29
total               US$ 2,436   US$   643
```

(El código no cuenta las IPv4 públicas del ALB, una por zona como mínimo: otros ≈ US$7 al mes.)

Lee la tabla con calma, porque enseña tres cosas.

**Una línea manda.** Por inercia, el cruce de zona es tres cuartas partes de la factura de red. Una línea en la configuración del Service de Kubernetes (`trafficDistribution: PreferSameZone`, «prefiere la misma zona») la baja de ≈ US$1,830 a ≈ US$37. Ninguna otra decisión de red de C01 pesa tanto.

**Algunas líneas suben.** Los endpoints de ECR cuestan ≈ US$29 al mes que antes no existían. Aquí valen la pena más por orden que por ahorro: dejan el NAT solo para lo chico. Con imágenes de 9.2 GB, cada arranque por el NAT paga ≈ US$0.41. En C01 la cuenta es casi pareja; con cientos de nodos que arrancan, los endpoints ganan de lejos.

**Lo grande que queda es el ALB.** ≈ US$503 de ≈ US$643. La siguiente palanca es la de la sección del ALB: mandar la llave de S3 en vez de la foto.

En la infraestructura de C01, ≈ US$1.75k al mes, ya van incluidos el NAT y la transferencia **con** ruteo por zona. Sin él, la misma infraestructura subiría ≈ US$1.8k: más de lo que cuestan las dos GPUs.

:::profundo Dónde lo ves en la factura
En AWS Cost Explorer, el NAT aparece dentro del servicio «EC2 - Other» como `NatGateway-Bytes` (y `NatGateway-Hours`), y el cruce de zona como `DataTransfer-Regional-Bytes`. Ninguno dice «S3» ni «Triton». Por eso se encuentran con la cuenta de bytes, con [[etiqueta-costos|etiquetas de costos]] por componente y con presupuestos que avisan cuando una línea crece.
:::

:::profundo Los otros bytes que se mueven sin que nadie los dibuje
El recorrido de arriba solo mira el camino de cada request. Hay más:

- **Logs.** Si cada request escribiera ≈ 5 KB de log de depuración a CloudWatch (≈ US$0.50 por GB que entra), serían 304 M × 5 KB = 1,520 GB al mes, ≈ US$760. La Ronda: «un flag de debug olvidado cuesta 2 T4». C01 manda los logs de predicción a S3 por el gateway endpoint y solo los del servicio a CloudWatch.
- **Réplicas de una cola.** Un Kafka propio con 3 copias en 3 zonas copia cada mensaje de una zona a otra varias veces. En c06, ≈ 5.5 TB al mes de mensajes terminan en ≈ US$438 al mes solo de cruce de zona.
- **Pesos al arrancar.** Un modelo de 141 GB (un LLM grande) por el NAT cuesta ≈ US$6.35 cada vez que arranca una réplica. Con autoscaling que sube y baja diez veces al día, ya son ≈ US$1,930 al mes.

Ninguno aparece en el diagrama de arquitectura. Todos aparecen en la factura.
:::

## Errores comunes {Common mistakes}

### Dejar el NAT como salida de todo

**El error:** las subredes privadas tienen `0.0.0.0/0 → NAT`, nadie agregó endpoints, y S3, ECR y los pesos pasan por ahí. La factura dice «NAT gateway» y nadie lo conecta con las descargas de S3.

**Cómo evitarlo:** crea el gateway endpoint de S3 el mismo día que creas la VPC. Es gratis. Luego pregunta qué más pasa por el NAT: la línea `NatGateway-Bytes` de Cost Explorer te dice cuánto.

### Un solo NAT para todas las zonas

**El error:** para ahorrar ≈ US$33 al mes, un NAT en `1a` atiende a `1b`. Lo de `1b` paga cruce de zona y, si cae `1a`, `1b` se queda sin salida.

**Cómo evitarlo:** un NAT por zona, y la tabla de cada subred privada apuntando al de su zona.

### Leer «US$0.01 por GB» y contar US$0.01

**El error:** estimar el cruce de zona con la mitad de lo que cuesta. Cada GB que cruza se cobra al salir y al entrar.

**Cómo evitarlo:** cuenta US$0.02 por GB cruzado, y pregunta cuántos bytes por request cruzan, no cuántas requests.

### Creer que el ALB cobra por request

**El error:** «el balanceador cuesta US$30». Con fotos en el body, cobra ≈ US$0.008 por GB y en C01 son ≈ US$500 al mes.

**Cómo evitarlo:** calcula las LCU por la dimensión de bytes: GB por hora = LCUs. Si los bytes pesan, considera mandar la llave del objeto en lugar del contenido.

### Crear los endpoints de ECR y olvidar el de S3

**El error:** `ecr.api` y `ecr.dkr` están, el NAT se quitó y los *pulls* fallan, o el NAT sigue y las capas pasan por él.

**Cómo evitarlo:** recuerda que las capas viven en S3. La receta es de tres piezas: `ecr.api`, `ecr.dkr` y el gateway endpoint de S3.

### Confundir la ruta con el permiso

**El error:** «agregué la regla al grupo de seguridad y sigue sin llegar» (falta la ruta), o «la subred es privada, así que está protegida» (pero el grupo deja entrar a cualquiera de la VPC).

**Cómo evitarlo:** son dos preguntas distintas. La tabla de rutas responde «¿hay camino?»; el grupo de seguridad, «¿tiene permiso?». Un paquete necesita las dos.

### Subredes chicas para nodos de Kubernetes

**El error:** subredes `/24` para los nodos. Cada pod gasta una IP de la subred; con unos cuantos nodos llenos, los pods nuevos no arrancan por falta de direcciones.

**Cómo evitarlo:** subredes grandes para los nodos (`/20` o más) y un rango de VPC con espacio para crecer, que no se encime con otras redes de la empresa.

## En la vida real {In real life} [extra]

**C01, el marketplace.** Una VPC `10.0.0.0/16` en `us-east-1`, con una subred pública y una privada en cada una de sus dos zonas. El ALB y los NAT en las públicas; los nodos del gateway y de Triton en las privadas, sin IP pública. Triton no tiene ingress ni balanceador: solo un Service interno y una NetworkPolicy que acepta al gateway. Pesos, engine y logs de predicción por el gateway endpoint de S3; imágenes por los endpoints de ECR más el de S3. Ruteo por zona desde el primer día. La factura de red con todo eso: ≈ US$640 al mes, la mayor parte del ALB.

**Patología digital (c04).** Cada lámina pesa ≈ 1 GB y se procesan 1,200 al día. Por el NAT, ≈ US$1,620 al mes, 3.7 veces sus GPUs. Por el gateway endpoint de S3, cero. El mismo caso tiene otra trampa de «bytes que se mueven»: guardar cada pedazo de la lámina como un objeto aparte serían ≈ 3.6 millones de PUT al día, ≈ US$547 al mes. Se guarda un archivo por lámina.

**Moderación de contenido (c06).** Los eventos viajan por Kafka. Un Kafka propio en 3 zonas copia cada mensaje entre zonas: ≈ US$438 al mes de cruce. Y mandar sus 5,472 GB de logs a CloudWatch costaría ≈ US$2.7k al mes, contra ≈ US$126 en S3.

**Asistentes con LLM propio (c10, c12 y M14 de la Ronda).** Aquí la VPC no es tema de costo sino de privacidad: «los datos no salen de la VPC». Si el modelo corre en tus máquinas, en subredes privadas, el texto del usuario nunca cruza a internet. Si llamas a una API externa, el prompt sale. Ese requisito, por sí solo, decide si se puede usar una API.

**Fuera de ML.** Cualquier empresa que sirve video conoce el egress de memoria: cada GB que mira un usuario es un GB que sale. Por eso existen las CDN, y por eso los proveedores de video negocian el precio del egress antes que el de las máquinas. Y una empresa que quiere cambiarse de nube descubre el otro lado: sacar 50 TB cuesta ≈ US$4.3k por copia.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa los precios de la lección (`us-east-1`), 730 horas y 30.4 días por mes, y 1 GB = 1,000 MB.

:::ejercicios
? [facil] Una VPC tiene el rango `10.20.0.0/16`. ¿Cuántas direcciones tiene? ¿Cuántas subredes `/24` caben? ¿Cuántas IPs usables tiene cada `/24` en AWS?
- La VPC deja libres 32 − 16 = 16 bits: 2¹⁶ = **65,536** direcciones.
- Una `/24` deja libres 8 bits: 256 direcciones. Caben 65,536 ÷ 256 = **256** subredes `/24`.
- AWS aparta 5 en cada subred: 256 − 5 = **251** usables.
? [facil] La tabla de rutas de una subred tiene `10.0.0.0/16 → local` y `0.0.0.0/0 → igw-…` (un internet gateway). ¿Es pública o privada? ¿Y si la segunda regla apuntara a un NAT gateway?
- Con `0.0.0.0/0 → internet gateway`, es **pública**: lo que tenga IP pública puede recibir conexiones de internet.
- Con `0.0.0.0/0 → NAT`, es **privada**: las máquinas pueden salir a internet, pero nadie de afuera puede abrir una conexión hacia ellas.
- El nombre de la subred no importa: lo decide la tabla.
? [facil] Un nodo en una subred privada baja 400 GB al mes de S3. ¿Cuánto paga si va por el NAT? ¿Y por un gateway endpoint? ¿Y si los subiera a S3 en lugar de bajarlos?
- Por el NAT: 400 × 0.045 = **US$18** al mes de datos procesados (más la hora del NAT, que se paga de todos modos).
- Por el gateway endpoint: **US$0**.
- Subiéndolos: igual. El NAT cobra en cualquier dirección: **US$18** por el NAT, **US$0** por el endpoint. Que subir a S3 sea gratis no te salva de la caseta.
? [facil] Un cluster tiene 40 nodos, todos con IPv4 pública «por si acaso». ¿Cuánto cuestan esas IPs al mes? ¿Las necesitan?
- 40 × 0.005 × 730 = **US$146** al mes.
- No. Los nodos van en subredes privadas y salen por el NAT. Además, una IP pública es una puerta más desde internet.
? [medio] Un servicio manda 2 MB por request de una zona a otra, 1 millón de veces al día. ¿Cuánto cuesta al mes el cruce? ¿Y si con ruteo por zona solo cruza el 2 %?
- GB al mes: 2 MB × 1,000,000 × 30.4 = 60,800,000 MB = **60,800 GB**.
- Todo cruzando: 60,800 × 0.02 = **US$1,216** al mes (0.01 al salir + 0.01 al entrar).
- Con 2 % cruzando: 60,800 × 0.02 × 0.02 ≈ **US$24** al mes.
? [medio] Un ALB recibe 500 GB al día de imágenes en el body. ¿Cuántas LCU usa en promedio? ¿Cuánto cuesta al mes? ¿Cuánto si en lugar de imágenes recibiera llaves de 100 bytes, con el mismo número de requests (5 millones al día)?
- GB por hora: 500 × 30.4 ÷ 730 ≈ **20.8 GB/h** → ≈ 20.8 LCU.
- LCU: 20.8 × 0.008 × 730 ≈ US$121.6. Más la hora: 16.4. Total ≈ **US$138** al mes.
- Con llaves: 5,000,000 × 100 B = 0.5 GB al día, ≈ 0.02 GB/h. La dimensión de bytes casi desaparece y manda otra: conexiones nuevas o reglas. Si cada request abre una conexión, 5,000,000 ÷ 86,400 s ≈ 58 conexiones nuevas por segundo; 58 ÷ 25 ≈ 2.3 LCU. LCU: 2.3 × 0.008 × 730 ≈ US$13. Más la hora, 16.4. Total ≈ **US$30** al mes.
? [medio] Quieres bajar de AWS a tu laptop un dataset de 3 TB en un mes en que no sacaste nada más. ¿Cuánto pagas de egress? ¿Y si son 15 TB?
- 3 TB: (3,000 − 100) × 0.09 = **US$261**.
- 15 TB: los primeros 100 GB gratis; 10,000 GB a 0.09 = US$900; los 4,900 restantes a 0.085 = US$416.50. Total ≈ **US$1,317**.
? [medio] El pico de un servicio es 800 requests por segundo y cada una manda 300 KB del gateway al modelo. El gateway corre en 2 × `c6i.xlarge` (1.56 Gb/s sostenidos). ¿Qué porcentaje del sostenido usa cada nodo? ¿Y si cae una zona y queda uno?
- Total: 800 × 300,000 × 8 = 1,920,000,000 bits/s ≈ **1.92 Gb/s**.
- Cada nodo: 0.96 Gb/s ÷ 1.56 ≈ **62 %**.
- Con uno: 1.92 ÷ 1.56 ≈ **123 %**. Aguanta solo mientras dure la ráfaga; hay que tener un tercer nodo, uno más grande o payloads más chicos.
? [reto] Un equipo baja de ECR, por el NAT, una imagen de 6 GB cada vez que arranca un nodo, y arrancan 300 nodos al mes. Evalúa tres opciones: (a) dejarlo así; (b) endpoints `ecr.api` y `ecr.dkr` en 3 zonas más el gateway endpoint de S3; (c) solo los endpoints de ECR, sin el de S3. ¿Cuál conviene?
- (a) 6 × 300 = 1,800 GB × 0.045 = **US$81** al mes.
- (b) Endpoints: 2 × 3 zonas × 0.01 × 730 = US$43.80 al mes. Lo que pasa por ellos es el manifiesto (KB) y la API: ≈ US$0. Las capas, 1,800 GB por el endpoint de S3: US$0. Total ≈ **US$44** al mes. Ahorra ≈ US$37.
- (c) Las capas viven en S3: sin el endpoint de S3, los 1,800 GB siguen yendo por el NAT (US$81) y además pagas los endpoints (US$43.80): ≈ **US$125**, peor que no hacer nada. Si quitaras el NAT, el *pull* fallaría.
- Conviene (b). Con imágenes más chicas o menos arranques, (a) podría ganar: compara siempre las horas de los endpoints contra los GB que dejan de pasar por el NAT.
? [reto] Un LLM de 141 GB se baja de S3 cada vez que arranca una réplica. El autoscaling arranca 8 réplicas al día. Compara el costo al mes por el NAT y por el gateway endpoint. Después, si las réplicas estuvieran en `us-east-1` y el bucket en `us-west-2`, ¿cuánto costaría la transferencia entre regiones?
- Arranques al mes: 8 × 30.4 ≈ 243. GB al mes: 243.2 × 141 ≈ **34,291 GB**.
- Por el NAT: 34,291 × 0.045 ≈ **US$1,543** al mes.
- Por el gateway endpoint: **US$0**.
- Entre regiones: la región de donde salen los datos cobra ≈ 0.02 por GB: 34,291 × 0.02 ≈ **US$686** al mes, aunque haya endpoint. El gateway endpoint de S3 solo sirve para buckets de la misma región, así que esos GB además toman la ruta por omisión: si es el NAT, se suman sus ≈ US$1,543, ≈ **US$2,229** al mes en total. La solución es una copia del modelo en `us-east-1`.
? [reto] Diseña la red de un servicio nuevo en `us-east-1`, con 3 zonas: un ALB público, 6 nodos de API, 3 GPUs, pesos y logs en S3, imágenes en ECR, y una llamada a una API externa de pagos. Di cuántas subredes y de qué tipo, qué va en cada una, qué dice cada tabla de rutas, qué grupos de seguridad hay y qué endpoints creas. ¿Por dónde pasa la llamada a pagos?
- **Subredes:** 6, una pública y una privada por zona. Por ejemplo `/20` cada una dentro de un `10.x.0.0/16` que no se encime con otras redes de la empresa.
- **Públicas:** el ALB y un NAT por zona. Tabla: `local` + `0.0.0.0/0 → internet gateway`.
- **Privadas:** los 6 nodos de API (2 por zona) y las 3 GPUs (1 por zona), sin IP pública. Tabla de cada una: `local` + S3 → gateway endpoint + `0.0.0.0/0 → NAT de su zona`.
- **Grupos de seguridad:** `alb` acepta 443 desde `0.0.0.0/0`; `api` acepta su puerto solo desde el grupo `alb`; `gpu` acepta su puerto solo desde el grupo `api`.
- **Endpoints:** gateway de S3 (gratis; pesos, logs y capas de las imágenes) y `ecr.api` + `ecr.dkr` en las 3 zonas.
- **Pagos:** por el NAT de su zona. Es poco tráfico y tiene que ir a internet: es justo para lo que está el NAT.
- **Y el ruteo por zona** entre la API y las GPUs, para que los payloads no crucen.
:::

## Lo que sigue {What comes next} [extra]

**En la Ronda:**

- **M13 · Costos y nube** es donde vive todo esto: la sección de costos ocultos recorre los bytes de C01 con su diagrama de red, cobra el NAT, los endpoints, el cruce de zona, el ALB y los logs, y compara la red de un endpoint gestionado contra la de Kubernetes propio. Ahora la puedes leer sin atorarte en «subred privada» ni en «gateway endpoint».
- **M06 · Orquestación y escalado** usa el ruteo por zona y explica por qué el cruce de zona se paga en GB.
- **M15 · Seguridad** da por sabido que Triton no se expone: solo un Service interno y una NetworkPolicy.
- **Los casos c10 y c12 y M14** usan «los datos no salen de la VPC» como requisito de privacidad.
- La **hoja de números** trae las tarifas de red, las latencias dentro de la VPC y el ancho de banda de cada instancia.

**En el Dojo:** cuando el Dojo tenga su estación en AWS (está planeada), vas a crear la VPC, las subredes y el gateway endpoint de S3, y vas a mirar en Cost Explorer cuánto pasa por el NAT.

**En Sensei:** la siguiente lección, «Servicios gestionados, serverless y permisos», explica qué opera el proveedor por ti, cuánto cobra por eso (incluido el cargo por datos procesados de SageMaker AI) y cómo se le dan permisos a cada pieza con IAM. Más adelante, la fase de seguridad explica el cifrado que termina el ALB (TLS) y cómo se protege lo que vive dentro de la VPC.

## Palabras que vas a oír {Words you will hear}

:::conceptos
vpc cidr subred subred-privada internet-gateway ip-publica tabla-rutas grupo-seguridad nat cargo-datos-procesados vpc-endpoint privatelink egress transferencia-entre-zonas transferencia-entre-regiones alb lcu ancho-banda-baseline
:::

## Chequeo {Check}

:::chequeo
? ¿Qué es una VPC y por qué se llama «virtual»?
Tu red privada dentro de una región de la nube, aislada de las de otros clientes. Es virtual porque comparte cables y switches con todos: el proveedor separa el tráfico con software.
? ¿Qué hace pública a una subred?
Que su tabla de rutas mande `0.0.0.0/0` a un internet gateway. Una privada no tiene esa ruta; si sale a internet, lo hace por un NAT.
? ¿Qué decide la tabla de rutas y qué decide el grupo de seguridad?
La tabla, por dónde va un paquete. El grupo de seguridad, si una conexión tiene permiso de llegar a una máquina.
? ¿Cuánto cobra el NAT gateway y por qué es una trampa?
≈ US$0.045 por hora y ≈ US$0.045 por GB, en cualquier dirección. Es la salida por omisión, así que S3, imágenes y pesos pasan por él si nadie crea endpoints.
? ¿Qué endpoints necesita un nodo privado para bajar una imagen de ECR sin NAT?
`ecr.api` y `ecr.dkr` para el manifiesto y la API, y el gateway endpoint de S3, porque las capas viven en S3.
? ¿Por qué el cruce de zona se cuenta a US$0.02 por GB si la tarifa dice US$0.01?
Porque cada GB se cobra al salir de una zona y otra vez al entrar a la otra.
? ¿Cómo cobra el ALB cuando las fotos van en el body?
Por LCU, y gana la dimensión de bytes: 1 LCU = 1 GB por hora, así que paga ≈ US$0.008 por GB más su hora. En C01, ≈ US$500 al mes.
:::
