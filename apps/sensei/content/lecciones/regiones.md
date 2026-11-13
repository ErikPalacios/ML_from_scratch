---
titulo: Regiones, zonas y disponibilidad
en: Regions, zones and availability
subtitulo: Dónde está físicamente la nube, qué pasa cuando un centro de datos se apaga, cuánto protege repartir las réplicas en zonas y cuándo vale la pena pagar una segunda región.
pregunta: C01 corre en «us-east-1, en dos zonas». ¿Qué es eso, por qué dos y no una, qué pasa si una se cae, y por qué no hace falta una segunda región?
requisitos: probabilidad, red, latencia, nube
---

:::idea
La nube tiene dirección. Sus centros de datos se agrupan en **regiones** (un área del mapa) y cada región se parte en **zonas** aisladas entre sí. Repartir tus réplicas en dos o tres zonas es barato y te protege del centro de datos que se apaga. Una segunda región es cara y solo se justifica cuando sabes dos números: cuántos datos puedes perder y cuánto puedes tardar en volver.
:::

En la lección de la nube viste que «la nube» son computadoras de alguien más, en un [[centro-de-datos|centro de datos]] que no ves, rentadas por hora. Pero esas computadoras están en algún lugar. Tienen un edificio, un enchufe, un cable que sale a la calle. Y un edificio se puede quedar sin luz, se puede inundar o se puede quedar sin red.

El caso C01, el marketplace que sugiere la categoría de una foto, dice en su diseño: «AWS, región `us-east-1`, dos zonas, `us-east-1a` y `us-east-1b`». Cada parte de esa frase es una decisión. La región decide qué tan lejos queda el modelo de quien lo llama, qué leyes aplican y qué máquinas hay. Las dos zonas deciden qué pasa el día que un edificio completo se apaga.

En la lección de probabilidad ya hiciste las cuentas: los [[nueves]], las piezas en serie y la [[redundancia]]. Aquí vas a ver **el terreno** donde esas cuentas se aplican: qué es exactamente una región y una zona, cuánta [[latencia]] cuesta cada kilómetro, qué promete de verdad el proveedor y qué hacer el día que no alcanza con una región.

## Regiones: la nube tiene dirección y distancia {Regions: the cloud has an address and a distance}

### Qué es una región

Una **[[region|región]]** (*region*) es un área geográfica donde un [[proveedor-nube|proveedor de nube]] tiene un grupo de centros de datos y los opera como una unidad separada de las demás. Cada una tiene un nombre en código:

| Proveedor | Nombre | Dónde está |
|---|---|---|
| AWS | `us-east-1` | Norte de Virginia, Estados Unidos |
| AWS | `us-west-2` | Oregón, Estados Unidos |
| AWS | `sa-east-1` | São Paulo, Brasil |
| AWS | `mx-central-1` | Centro de México (Querétaro) |
| Google Cloud | `us-central1` | Iowa, Estados Unidos |
| Google Cloud | `northamerica-south1` | Querétaro, México |
| Azure | `eastus` | Virginia, Estados Unidos |
| Azure | `mexicocentral` | Querétaro, México |

Cada uno de los tres grandes tiene decenas de regiones repartidas por el mundo, y abren nuevas cada año.

Lo importante es que las regiones están **separadas a propósito**. Una máquina que creas en `us-east-1` no existe en `us-west-2`. Un [[bucket-objetos|bucket]] vive en una región y sus bytes no salen de ahí si tú no los mandas. Cuando le hablas a la [[api-nube|API de la nube]], le hablas a la de una región. Esa separación es la que permite que un problema en Virginia no tumbe a Oregón.

Por eso «¿en qué región?» es de las primeras preguntas de un diseño. La región cambia cinco cosas:

- **La distancia** a tus usuarios y a los sistemas que te llaman, que se convierte en latencia.
- **El catálogo.** No todas las regiones tienen todas las máquinas ni todos los servicios. Una [[gpu|GPU]] nueva llega primero a unas pocas.
- **El precio.** La misma máquina cuesta distinto en cada región.
- **La ley.** Los datos guardados en una región están físicamente en ese país.
- **Tus límites.** Tu [[cuota-servicio|cuota]] (cuántas máquinas te deja prender el proveedor) se cuenta por región.

:::figura regiones-mapa
Una región es un grupo de zonas cercanas entre sí, unidas por fibra propia. Otra región queda a cientos o miles de kilómetros. La distancia se nota en los milisegundos.
:::

:::analogia Una cadena de supermercados
Piensa en una cadena de supermercados. En cada ciudad grande tiene varias sucursales: esa ciudad es la **región** y cada sucursal es una **zona**. Si una sucursal cierra por una fuga de agua, vas a otra de la misma ciudad y casi no pierdes tiempo. Si toda la ciudad se queda sin luz, la sucursal más cercana está en otra ciudad, a horas de camino. Y los precios y lo que hay en los estantes cambian de una ciudad a otra.

**Dónde se rompe:** en el súper tú caminas a otra sucursal. En la nube, tu programa no se muda solo: alguien tuvo que haber puesto una copia en la otra zona **antes** de la falla. Y lo que guardaste en una sucursal (un disco) no aparece en la otra por arte de magia.
:::

### La distancia es latencia

En la lección de red viste el [[rtt|RTT]] (*round-trip time*): lo que tarda un mensaje en ir y volver. Hay una parte del RTT que ningún ingeniero puede bajar, porque es física.

Los datos viajan como luz dentro de fibra óptica. En el vacío, la luz recorre ≈ 300,000 km por segundo. Dentro del vidrio de la fibra va a unos dos tercios de eso: ≈ 200,000 km por segundo, o **≈ 200 km por milisegundo**. Como el RTT es ida y vuelta, la regla práctica es: **al menos 1 ms de RTT por cada 100 km**.

:::cuenta De la Ciudad de México al norte de Virginia
Distancia en línea recta // sobre la superficie de la Tierra | — | ≈ 3,000 km
Solo de ida // a 200 km por ms | 3,000 ÷ 200 | 15 ms
Ida y vuelta: el RTT mínimo posible | 2 × 15 | **30 ms**
RTT real // los cables no van en línea recta y hay equipos en medio: ≈ el doble | ≈ 2 × 30 | **≈ 60 ms**
De un SLO de 300 ms, lo que se va solo en el viaje | 60 ÷ 300 | 20 %
= Antes de que el modelo haga nada, una quinta parte del tiempo ya se gastó en kilómetros.
:::

El «doble» sale de comparar la física con lo medido. La Ronda da estos rangos:

| De dónde a dónde | Distancia | Mínimo físico | RTT típico |
|---|---|---|---|
| Dos máquinas en la misma zona | metros | ≈ 0 | ≈ 0.1–0.5 ms |
| Dos zonas de la misma región | decenas de km | < 1 ms | ≈ 0.4–2.5 ms |
| Dos regiones vecinas | ≈ 500 km | ≥ 5 ms | ≈ 10–15 ms |
| Costa a costa de Estados Unidos | ≈ 3,500 km | ≥ 35 ms | ≈ 60–80 ms |
| Entre continentes | miles de km | decenas de ms | ≈ 70–250 ms |

:::profundo Calcularlo para cualquier ciudad
El programa calcula la distancia entre dos puntos del planeta con sus coordenadas (latitud y longitud) y de ahí el RTT mínimo. Las coordenadas son aproximadas: sirven para el orden de magnitud.

```python
from math import radians, sin, cos, asin, sqrt

def km(a, b):                      # distancia sobre la esfera (fórmula del haversine)
    la1, lo1, la2, lo2 = map(radians, (*a, *b))
    h = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * asin(sqrt(h))

cdmx = (19.43, -99.13)
regiones = {"Querétaro": (20.59, -100.39), "Norte de Virginia": (39.04, -77.49),
            "Oregón": (45.84, -119.70), "São Paulo": (-23.55, -46.63),
            "Fráncfort": (50.11, 8.68), "Tokio": (35.68, 139.69)}

print(f"{'desde CDMX a':<20}{'km':>7}{'RTT mínimo':>12}{'≈ real (×2)':>13}")
for nombre, punto in regiones.items():
    d = km(cdmx, punto)
    rtt = 2 * d / 200              # ida y vuelta, a 200 km por milisegundo
    print(f"{nombre:<20}{d:>7,.0f}{rtt:>9.1f} ms{2 * rtt:>10.0f} ms")
```

```salida
desde CDMX a             km  RTT mínimo  ≈ real (×2)
Querétaro               184      1.8 ms         4 ms
Norte de Virginia     3,011     30.1 ms        60 ms
Oregón                3,489     34.9 ms        70 ms
São Paulo             7,432     74.3 ms       149 ms
Fráncfort             9,560     95.6 ms       191 ms
Tokio                11,307    113.1 ms       226 ms
```

Fíjate en São Paulo: está en Latinoamérica, pero queda más del doble de lejos de la Ciudad de México que Virginia.
:::

Un dato que sorprende: desde la Ciudad de México, São Paulo queda a ≈ 7,400 km y Virginia a ≈ 3,000. «La región de mi continente» no siempre es la más cercana.

:::calculadora regiones-distancia
Arranca con la cuenta de arriba: 3,000 km, el doble de la física y una sola ida y vuelta. Sube las idas y vueltas a 3 para ver lo que cuesta abrir una conexión nueva desde lejos.
:::

Dos cosas hacen que la distancia pese más de lo que parece:

- **Una conexión nueva da varias vueltas.** Antes de mandar la foto hay que abrir la conexión ([[handshake]]) y acordar el cifrado. Son ≈ 3 idas y vueltas: con 60 ms cada una, 180 ms antes de empezar. Por eso se reusan las conexiones ([[keep-alive]]).
- **Lo que importa es quién te llama, no dónde está el usuario final.** A C01 no lo llama el teléfono de Ana: lo llama el *backend* de publicación (el programa del marketplace que recibe la publicación), que vive en la misma región. Esa llamada viaja metros, no miles de kilómetros. Los 60 ms de Ana hasta Virginia los paga el backend, y no entran al presupuesto de 300 ms del modelo.

De ahí sale una regla de diseño: **pon el modelo junto a quien lo llama y junto a sus datos**. Si el backend y las fotos están en `us-east-1`, el modelo va en `us-east-1`.

## Zonas y dominios de falla {Zones and failure domains}

### Qué es una zona

Dentro de una región, los centros de datos no están todos en el mismo edificio. Se agrupan en **[[zona-disponibilidad|zonas de disponibilidad]]** (*availability zones*; en el trabajo se dice **AZ** o «zona» a secas). Una zona es uno o más centros de datos con su propia electricidad, su propio enfriamiento y su propia red, **aislados** de las otras zonas de la región.

- **Están separadas** por kilómetros, para que un incendio, una inundación o un apagón no les pegue a dos a la vez. En AWS, según su documentación, quedan a menos de 100 km unas de otras.
- **Están unidas** por fibra del propio proveedor. Por eso el RTT entre dos zonas es de ≈ 1 ms: lo bastante cerca para trabajar como si fueran una sola red.
- **Se nombran** con el nombre de la región y una letra: `us-east-1a`, `us-east-1b`. En Google Cloud, `us-central1-a`. En Azure se numeran: zona 1, 2 y 3.
- **Casi todas las regiones tienen tres o más.** `us-east-1` tiene seis. Un diseño usa dos o tres: C01 usa dos y C10, el asistente con un LLM, usa tres.

### Lo que vive en una zona y lo que vive en la región

No todo lo que rentas está repartido. Hay recursos **zonales**, que existen en una sola zona, y recursos **regionales**, que el proveedor reparte por ti entre varias.

| Recurso | Dónde vive | Si cae su zona |
|---|---|---|
| Una máquina virtual ([[instancia]]) | Una zona | Se cae con ella |
| Un disco de red ([[almacenamiento-bloques\|EBS]]) | Una zona | No se puede conectar a una máquina de otra zona |
| Una [[subred]] (un pedazo de tu red privada) | Una zona | Queda sin máquinas |
| El [[object-storage\|object storage]] (S3 Standard) | La región: copias en al menos 3 zonas | Sigue respondiendo |
| El [[balanceador]] (ALB) | Las zonas que tú elijas | Atiende desde las demás |
| El [[plano-de-control\|plano de control]] de Kubernetes gestionado | La región | Sigue respondiendo |

La consecuencia práctica: **las máquinas son tuyas de repartir**. El proveedor reparte S3 por ti, pero si pones tus dos servidores en `us-east-1a`, los dos se caen juntos, y nadie te avisa al crearlos.

:::profundo Tu «us-east-1a» no es la mía
En las regiones más viejas de AWS, la letra de la zona se asigna **por cuenta**. Tu `us-east-1a` y la de otra empresa pueden ser edificios distintos. AWS lo hizo para que no todo el mundo eligiera la «a» y la llenara. El nombre que sí es igual para todos es el **id de zona**, como `use1-az4`.

Así se ve en la terminal de alguien que pregunta qué zonas tiene su región, con los dos nombres. Es una ilustración: necesita una [[cuenta-nube|cuenta]] de AWS y su herramienta de línea de comandos.

```bash
aws ec2 describe-availability-zones --region us-east-1 \
  --query "AvailabilityZones[].[ZoneName, ZoneId, State]" --output text
# us-east-1a   use1-az4   available
# us-east-1b   use1-az6   available
# us-east-1c   use1-az1   available
```
 Importa cuando dos cuentas quieren estar en la misma zona física, para que su tráfico no cruce de zona, o cuando un aviso de falla dice «afectada: `use1-az4`» y tienes que saber cuál de tus letras es.
:::

### Dominios de falla

Un **[[dominio-falla|dominio de falla]]** (*failure domain*) es todo lo que se cae junto cuando falla una sola cosa. Una máquina es un dominio de falla: si se quema su fuente de poder, se cae todo lo que corre en ella. Una zona es otro, más grande: si se queda sin luz, se caen todas sus máquinas.

Los dominios van uno dentro de otro, como muñecas rusas.

:::figura regiones-dominios
Cuatro dominios de falla, uno dentro de otro. Los de adentro fallan seguido y se llevan poco. Los de afuera fallan rara vez y se llevan todo lo que contienen.
:::

La Ronda (M06) los ordena así. Un **pod** es la unidad en la que Kubernetes, el [[orquestacion|orquestador]], corre tu programa; un **[[nodo]]** es una de las máquinas del grupo.

| Qué falla | Qué tan seguido | Qué se lleva | La defensa |
|---|---|---|---|
| Un pod (tu programa se cuelga) | Común | Una réplica | Kubernetes lo reinicia solo |
| Un nodo (la máquina) | Ocasional | Todas las réplicas de esa máquina | Una réplica de más en otra máquina |
| Una GPU (errores de hardware) | Ocasional | Lo que corría en esa GPU | Sacar ese nodo y reemplazarlo |
| Una zona | Rara, pero pasa | Todo lo zonal de esa zona | Réplicas en otra zona |
| Una región | Muy rara | Todo | Otra región |
| Mantenimiento planeado | Frecuente | Los nodos que se actualizan | Actualizar de a uno, con un mínimo siempre arriba |

De la tabla salen dos ideas.

**Tus réplicas tienen que estar en dominios distintos del tamaño que quieres sobrevivir.** Dos réplicas en la misma máquina no sobreviven a la máquina. Dos réplicas en máquinas distintas de la misma zona no sobreviven a la zona. En la lección de probabilidad lo viste con números: la redundancia solo suma contra fallas [[independencia|independientes]], y compartir un dominio de falla es la forma más común de no serlo.

**Cada dominio más grande cuesta más de cubrir.** Reiniciar un pod es gratis. Una máquina de más cuesta una máquina. Otra zona cuesta un poco de red. Otra región cuesta, como vas a ver, cerca de un tercio de toda la infraestructura. Por eso no se cubre «todo»: se decide hasta qué dominio.

:::profundo Las fallas grises
Una zona casi nunca falla como en las películas, con todo apagado. Lo normal es una falla **parcial**: la red de la zona pierde paquetes, o no se pueden crear máquinas nuevas, o un servicio contesta lento. Tus réplicas de esa zona siguen «vivas» pero funcionan mal. Por eso la defensa no es «detectar que la zona murió», sino [[health-check|health checks]] que saquen a cada réplica que deja de contestar bien, sea cual sea la causa.
:::

## Multi-AZ, N+1 y ruteo por zona {Multi-AZ, N+1 and zone-aware routing}

### Repartir en zonas

**[[multi-az|Multi-AZ]]** quiere decir que cada pieza de tu sistema tiene réplicas en dos o más zonas de la misma región, y que cualquiera de las zonas puede atender sola. Es la protección contra el dominio «zona», y casi siempre se quiere, por tres razones:

- **Es barato.** Las zonas están a ≈ 1 ms: no hay que cambiar el diseño. Las máquinas cuestan lo mismo en una zona que en otra.
- **Es casi automático.** El balanceador y Kubernetes ya saben de zonas: basta con decirles que repartan.
- **Cubre la falla grande más probable.** Una zona caída es rara; una región entera, mucho más rara.

Así queda C01:

:::diagrama regiones-c01
C01 en una región y dos zonas. Toca cada caja para ver por qué está ahí, y usa «Recorrer» para ver un día normal, la caída de una zona y lo que pasa si las requests cruzan de zona.
:::

:::profundo Cómo se pide en Kubernetes
Es una ilustración (no la vas a correr aquí). La primera parte le dice a Kubernetes que la diferencia de réplicas entre zonas sea de 1 como máximo; la segunda, que cada llamada prefiera una réplica de su misma zona.

```yaml
# En el Deployment de Triton: una réplica por zona
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone   # la etiqueta que dice en qué zona está cada nodo
    whenUnsatisfiable: DoNotSchedule
---
# En el Service de Triton: preferir la misma zona
spec:
  trafficDistribution: PreferSameZone
```
:::

### N+1, contado por zona

En la lección de probabilidad viste la regla **[[n-mas-uno|N+1]]**: N réplicas para atender el tráfico y una de repuesto, para que perder una no se note. C01 necesita una sola T4 (su GPU) para su pico de diseño de 500 fotos por segundo, y tiene dos, una por zona.

Cuando el dominio que quieres sobrevivir es la zona, el «+1» no es una máquina: es **una zona entera de capacidad**. La regla queda así:

> Si cae una zona, las que quedan tienen que aguantar el pico completo.

Con dos zonas, cada una tiene que poder con el 100 % del pico: pagas el **doble** de lo que el tráfico pide. Con tres zonas, al caer una quedan dos, así que cada una necesita la mitad del pico: pagas **1.5 veces**. En general, con Z zonas pagas Z ÷ (Z − 1).

El día normal de C01 no enseña la diferencia, porque una T4 por zona sobra. Míralo en el Hot Sale, la campaña de ventas en línea de cada año en México, cuando el tráfico se multiplica por 5:

:::cuenta El Hot Sale de C01: 2,500 fotos por segundo
Lo que aguanta una T4 al máximo // medido en la Ronda | — | ≈ 1,200 por segundo
Tope que aceptamos en emergencia // con una zona caída, sin pasar de 70 % | 0.70 × 1,200 | 840 por segundo
T4 para aguantar el pico sin una zona | 2,500 ÷ 840 = 2.98, hacia arriba | 3
Con dos zonas: 3 en cada una | 3 × 2 | **6 T4**
Uso en un día normal del Hot Sale | 2,500 ÷ (6 × 1,200) | ≈ 35 %
Uso si cae una zona // quedan 3 | 2,500 ÷ (3 × 1,200) | ≈ 69 %
Costo de las 6 // ≈ US$384 al mes cada una | 6 × 384 | ≈ US$2,304 al mes
= La mitad de esas GPUs, ≈ US$1,152 al mes, existe solo para el día que cae una zona.
:::

Los US$384 salen del precio de una `g4dn.xlarge` en `us-east-1`: ≈ US$0.526 por hora (noviembre de 2026) × 730 horas.

¿Y con tres zonas? Depende del tamaño. Con pocas réplicas, el redondeo manda: con 500 fotos por segundo, tres zonas cuestan **más** (3 T4 contra 2). Con muchas, gana la regla: a 12,000 por segundo, tres zonas piden 24 T4 y dos zonas piden 30. Seis GPUs de diferencia son ≈ US$2,300 al mes.

:::profundo La misma cuenta, en un programa
El programa hace la cuenta para dos y tres zonas, con tres tamaños de pico:

```python
from math import ceil

def n_mas_uno(pico, por_replica, zonas, tope=0.70):
    """Réplicas por zona para que, si cae una zona, las demás aguanten el pico sin pasar del tope."""
    por_zona = ceil(pico / ((zonas - 1) * por_replica * tope))
    total = por_zona * zonas
    minimo = ceil(pico / (por_replica * tope))        # sin pensar en zonas
    normal = pico / (total * por_replica)
    con_caida = pico / ((total - por_zona) * por_replica)
    return por_zona, total, minimo, normal, con_caida

print("pico   zonas  por zona  total  sin N+1  normal  si cae una")
for pico in (500, 2_500, 12_000):
    for zonas in (2, 3):
        z, t, m, u, c = n_mas_uno(pico, 1_200, zonas)
        print(f"{pico:>6,}{zonas:>6}{z:>9}{t:>8}{m:>8}{u:>9.0%}{c:>10.0%}")
```

```salida
pico   zonas  por zona  total  sin N+1  normal  si cae una
   500     2        1       2       1      21%       42%
   500     3        1       3       1      14%       21%
 2,500     2        3       6       3      35%       69%
 2,500     3        2       6       3      35%       52%
12,000     2       15      30      15      33%       67%
12,000     3        8      24      15      42%       62%
```

La columna «sin N+1» es lo que pediría el tráfico solo, y las dos últimas, el uso de cada GPU en un día normal y con una zona caída.
:::

:::calculadora regiones-zonas
Arranca con el Hot Sale de C01. Baja el pico a 500 para ver el día normal (una T4 por zona), o súbelo a 12,000 y cambia de 2 a 3 zonas para ver cómo baja el sobrecosto.
:::

### Por qué el repuesto tiene que estar encendido

Podrías pensar: «no pago el repuesto; cuando caiga una zona, prendo máquinas en la otra». No alcanza el tiempo. Esto pasa cuando una zona deja de contestar:

:::pasos
1. Segundos
Los health checks del balanceador fallan dos o tres veces seguidas y deja de mandar tráfico a esa zona. Todo el tráfico cae sobre la zona sana.
2. Hasta 5 minutos
Kubernetes espera antes de dar por perdidos los pods de un nodo que no contesta: por omisión, 300 segundos. Recién entonces intenta crearlos en otro lado.
3. De 5 a 13 minutos más
Si en la zona sana no hay una máquina libre, hay que pedirla. Un nodo con GPU tarda ≈ 5–13 minutos en servir su primera request, según la Ronda: arranca la máquina, baja la imagen del contenedor, carga el modelo en la GPU y lo calienta. Es el [[cold-start|arranque en frío]].
4. O nunca
En una falla de zona, **todos** los clientes de esa zona piden máquinas en las otras al mismo tiempo. Puede que no haya de tu tipo: es el [[error-capacidad|error de capacidad]], que ves en la lección de máquinas.
:::

Sumado, son de 10 a 18 minutos sin capacidad, de un presupuesto de 43 minutos al mes. Por eso el repuesto no se «prende cuando haga falta»: ya está corriendo y atendiendo tráfico. El [[autoscaling]] sirve para el crecimiento de la tarde, no para la zona que se cayó.

### Ruteo por zona

C01 tiene un *gateway* (el programa que recibe la foto y la prepara) y un Triton (el servidor que corre el modelo) en cada zona. Cuando el gateway de la zona `1a` llama a Triton, ¿a cuál le toca? Sin decir nada, el [[service-k8s|Service]] de Kubernetes reparte entre todos: la mitad de las llamadas se queda en `1a` y la otra mitad cruza a `1b`.

Cruzar de zona tiene dos costos. Uno es tiempo: ≈ 1 ms más por salto. El otro es dinero: la nube cobra cada GB que cruza de una zona a otra, ≈ US$0.01 por GB en cada sentido. Con las fotos de C01 serían ≈ 90 TB al mes cruzando: ≈ **US$1,800 al mes**, casi tanto como toda la infraestructura. Esa factura es de la lección de redes en la nube ([[transferencia-entre-zonas]]); aquí importa el remedio.

El remedio es el **[[ruteo-por-zona|ruteo por zona]]** (*zone-aware routing*): cada llamada prefiere una réplica de su propia zona, y solo cruza si en la suya no hay ninguna lista. En Kubernetes es una línea en el Service: `trafficDistribution: PreferSameZone`.

Lo valioso es el «solo si»: si el Triton de `1b` se cuelga, el gateway de `1b` no devuelve error. Manda sus llamadas al Triton de `1a`, paga el cruce un rato y sigue atendiendo. **Degrada, no se cae.**

:::ojo
El ruteo por zona supone que el tráfico llega parejo a las zonas y que cada zona tiene capacidad parecida. Si en `1a` hay tres gateways y un Triton, y en `1b` un gateway y tres Tritons, el Triton de `1a` se satura mientras los de `1b` descansan. Reparte las dos capas igual.
:::

## El SLA y la cuenta de disponibilidad {The SLA and the availability math}

### Qué es un SLA

En la lección de percentiles viste el [[sli|SLI]] (lo que mides) y el [[slo|SLO]] (la meta que te pones). Falta la tercera sigla.

Un **[[sla|SLA]]** (*service level agreement*, acuerdo de nivel de servicio) es un **contrato**: lo que un proveedor le promete a su cliente, y lo que le debe si no cumple. Los servicios de la nube publican el suyo. Todos tienen las mismas cuatro partes:

- **Qué se mide.** Normalmente, el porcentaje del mes en que el servicio estuvo disponible, según la definición del propio contrato.
- **El umbral.** Por ejemplo, 99.99 % para los balanceadores de AWS o 99.95 % para el Kubernetes gestionado (EKS).
- **Las exclusiones.** Lo que no cuenta: mantenimientos anunciados, fallas por tu configuración, cosas fuera de su control.
- **La compensación.** Casi siempre, **créditos**: un descuento en la factura de ese servicio, que además tienes que reclamar tú.

### El SLA no es tu disponibilidad

Hay tres razones, y las tres salen en entrevistas.

**Uno: promete créditos, no minutos.** El SLA no impide que el servicio se caiga. Dice cuánto te descuentan después.

:::cuenta El balanceador de C01 se cae 2 horas en un mes
Minutos del mes // 30 días | 30 × 24 × 60 | 43,200
Disponibilidad del balanceador ese mes | 1 − 120 ÷ 43,200 | ≈ 99.72 %
¿Cumplió su SLA de 99.99 %? | 99.72 < 99.99 | No
Crédito // supón 10 % de lo pagado por ese servicio: ≈ US$500 al mes | 0.10 × 500 | **US$50**
Presupuesto de error de C01 // 99.9 % en 30 días | 0.001 × 43,200 | 43.2 min
Lo que se gastó | 120 ÷ 43.2 | ≈ 2.8 presupuestos
= El proveedor te devuelve US$50. Tú gastaste en una tarde el presupuesto de error de casi tres meses.
:::

**Dos: cubre su pieza, no tu cadena.** El SLA de 99.95 % de EKS cubre el *endpoint* de la API de Kubernetes, la «oficina» que recibe órdenes. No cubre tus pods, ni tus máquinas, ni tu modelo. Si tu Triton se cuelga, EKS cumplió su SLA perfectamente. Y tu sistema es una cadena de piezas en serie, que multiplica las [[disponibilidad|disponibilidades]]: el conjunto siempre queda por debajo de su peor pieza.

**Tres: suele pedir que tú hagas tu parte.** Muchos SLA solo aplican si repartiste en dos o más zonas. Con todo en una zona, el contrato del proveedor te cubre mucho menos, o nada.

### La cuenta, con zonas

La disponibilidad real se calcula, pieza por pieza, con las reglas de la lección de probabilidad. Estos son los números de la Ronda para Triton, la pieza más frágil de C01. Los porcentajes de cada pieza son supuestos para diseñar; en tu sistema se miden.

| Cómo está Triton | Cuenta | Disponibilidad | Caído al mes |
|---|---|---|---|
| En una sola zona | — | 99.5 % | ≈ 216 min |
| En dos zonas independientes | 1 − 0.005² | 99.9975 % | ≈ 1 min |
| Dos zonas, con una causa común el 0.1 % del tiempo | 0.999975 × 0.999 | ≈ 99.90 % | ≈ 44 min |

Y para la cadena completa (balanceador, gateway y Triton), en dos zonas: ≈ 99.99 %, unos 5 minutos al mes, si las fallas son independientes; ≈ 99.89 %, unos 49 minutos, con esa causa común.

Lee la tabla como un mapa de qué compra cada cosa:

- La segunda zona compra **215 minutos al mes**. Es la mejor compra de toda la lección.
- Una tercera zona compraría segundos. Ya no es por disponibilidad: es por costo, como viste en el N+1.
- Los 43 minutos de la causa común, casi siempre un [[deploy]] malo que llega a las dos zonas, no los toca ninguna zona. Es la [[falla-correlacionada|falla correlacionada]], y se ataca cambiando de versión de a poco.

¿Y una segunda región? Compra los minutos de las caídas de región, que son muy pocos al año, a un precio muy alto. Eso sigue.

## Multi-región y failover {Multi-region and failover}

### Lo que dos zonas no cubren

Multi-AZ te protege del edificio que se apaga. Hay cuatro cosas de las que no:

- **Se cae la región entera**, o un servicio regional del que todo depende. Pasa poco, pero pasa, y dura horas.
- **Alguien borra los datos.** Un script con un error borra un bucket. S3 obedece en las tres zonas a la vez: la redundancia de zonas replica también los errores.
- **Roban la cuenta.** Si un atacante entra con permisos de administrador, puede apagar todo en todas las zonas.
- **La ley o los usuarios lo piden.** Usuarios en dos continentes, o datos que por contrato deben estar en dos países.

Para eso existe **[[multi-region|multi-región]]**: tener el sistema, o al menos sus datos, en dos o más regiones.

### Por qué es caro

Entre zonas hay 1 ms y la misma red. Entre regiones hay decenas de milisegundos y casi nada se comparte. Según la Ronda, una segunda región te cobra cuatro cosas:

- **Cuota y capacidad, otra vez.** Tu cuota es por región: en la segunda empiezas con la que tengas ahí, que puede ser cero para GPUs. Y que el tipo de GPU exista allá no está garantizado.
- **Datos replicados.** Cada GB que copias a la otra región paga transferencia, ≈ US$0.02 por GB desde `us-east-1`, y luego paga almacenamiento allá.
- **Artefactos que coincidan.** La imagen del contenedor y los pesos tienen que estar en las dos. Y hay sorpresas: un *engine* de TensorRT (el modelo ya optimizado para una GPU concreta) solo sirve en el mismo modelo de GPU. Si en la otra región consigues una GPU distinta, hay que volver a generarlo.
- **Operación doble.** Dos despliegues, dos juegos de alertas, dos redes, dos lugares donde algo puede quedar desactualizado.

### Failover: mover el tráfico

**[[failover|Failover]]** (conmutación por falla) es pasar el tráfico de la copia que falló a la que sigue viva. Entre zonas lo hace el balanceador en segundos y no te enteras. Entre regiones hay que decidir cómo se mueve el tráfico. Hay tres maneras: por [[dns|DNS]], que cambia a dónde apunta el nombre y tarda uno o dos minutos; por una dirección IP que la red lleva sola a la región sana, en segundos; o a mano, cuando una persona de guardia lo ordena.

:::profundo Las tres maneras, con sus tiempos
- **Por DNS.** El nombre `api.tienda.com` apunta a la región A. Un [[health-check|health check]] la vigila; si falla, el [[dns|DNS]] empieza a contestar con la dirección de la región B. El detalle es el [[ttl|TTL]]: cada cliente guarda la respuesta vieja durante ese tiempo. Con un health check cada 30 segundos, 3 fallas seguidas para declarar la caída y un TTL de 60 segundos, pasan hasta 90 + 60 = 150 segundos antes de que el último cliente cambie.
- **Por IP *anycast*.** La misma [[direccion-ip|dirección IP]] se anuncia desde varias regiones, y la red lleva cada paquete a la más cercana que esté sana. No depende del TTL: cambia en segundos. Se paga como un servicio aparte.
- **A mano, con un botón.** Una persona de guardia revisa y decide. Suena anticuado, pero la guía de AWS sobre el tema pide cautela con el failover automático entre regiones: un health check que se equivoca puede mandar todo el tráfico a una región que no estaba lista, y convertir un problema chico en uno grande.

:::

Si la segunda región solo espera, el esquema es **activo/pasivo**. Si las dos atienden tráfico todo el tiempo, es **activo/activo**: no hay nada que «prender», pero los datos tienen que escribirse en dos lugares a decenas de milisegundos de distancia, y eso complica todo lo que guarda estado.

:::ojo
Una segunda región no te salva de un deploy malo. Si publicas la versión rota en las dos regiones el mismo día, caen las dos: es la misma causa común de antes, ahora más cara. Multi-región solo suma si las regiones reciben los cambios **de a una**.
:::

### C01 no lo necesita

La respuesta de la Ronda para C01 es quedarse en una región, y decirlo es señal de experiencia, no de flojera. El razonamiento:

- El SLO es 99.9 %, y dos zonas lo cumplen.
- Hay un [[fallback]] que no depende de nada de la región: si el modelo no contesta, la vendedora elige la categoría a mano. Nadie deja de publicar.
- Lo que se protege es una sugerencia, no un pago.

Si la región se cae un día entero, ese mes C01 no cumple su SLO, y el negocio lo aceptó de antemano. La frase que la Ronda propone para la entrevista: *«the seller picks the category manually; we would redeploy from IaC if the outage were long»*. **IaC** (*infrastructure as code*) son archivos que describen todas las máquinas y redes, de modo que se pueden volver a crear en otra región con un comando.

Cambiaría la respuesta si no hubiera fallback, si se pidiera 99.99 %, o si los usuarios estuvieran en varios continentes.

## Recuperación ante desastres: RPO y RTO {Disaster recovery: RPO and RTO}

La **[[recuperacion-desastres|recuperación ante desastres]]** (*disaster recovery*, DR) es el plan para el día en que se pierde algo grande: una región, una cuenta, una base de datos borrada. La pregunta útil no es «¿somos multi-región?». Son dos preguntas:

- **¿Cuánto puedes perder?** Eso es el **[[rpo|RPO]]** (*recovery point objective*, objetivo de punto de recuperación): cuántos datos, medidos en tiempo, aceptas perder. Un RPO de 1 hora dice: «al volver, puede faltar hasta la última hora de datos».
- **¿Cuánto puedes tardar?** Eso es el **[[rto|RTO]]** (*recovery time objective*, objetivo de tiempo de recuperación): cuánto tiempo aceptas estar caído hasta volver a atender.

:::figura regiones-rpo-rto
El RPO mira hacia atrás desde el desastre: lo que se había escrito desde la última copia se pierde. El RTO mira hacia adelante: el tiempo hasta volver a atender.
:::

:::analogia El punto de guardado de un videojuego
Juegas dos horas y se va la luz. Al volver, cargas el último punto de guardado. Lo que habías avanzado desde ese guardado se perdió: eso es el **RPO**. Lo que tardas en prender la consola, cargar el juego y llegar a donde ibas es el **RTO**. Guardar más seguido baja el RPO. Tener la consola ya prendida baja el RTO. Son dos perillas distintas.

**Dónde se rompe:** en el juego hay un solo archivo guardado. Un sistema tiene muchas cosas, cada una con su propio «guardado», y hay que traerlas todas a un punto en el que cuadren entre sí.
:::

### Por artefacto, no por sistema

Un sistema no tiene «un» RPO. Cada cosa que guarda tiene el suyo, porque no todo vale lo mismo ni cuesta lo mismo rehacerlo.

| Qué | Si se pierde… | RPO razonable |
|---|---|---|
| C01 · pesos del modelo y su engine | Se vuelven a generar desde el entrenamiento, en horas | Horas |
| C01 · log de predicciones | Se pierde un pedazo del historial para reentrenar | Horas |
| C01 · el código y la configuración | Están en [[git]], fuera de la región | ≈ 0, sin hacer nada |
| C04 · resultados del modelo sobre biopsias | Se recalculan corriendo el modelo otra vez | Horas (RTO ≈ 1 día) |
| C04 · anotaciones de patólogos | Trabajo experto que nadie va a repetir: ≈ US$4,000 al mes | ≈ 0 |
| C05 · documentos de identidad ya aceptados | Habría que pedírselos otra vez a cada cliente | ≈ 0 |

La regla que deja la tabla: **lo que se puede recalcular aguanta un RPO flojo; lo que escribió una persona, no.**

El RPO lo fija cada cuánto copias. Si el desastre llega justo antes de la siguiente copia, pierdes el intervalo entero: ese es el peor caso. En promedio pierdes la mitad. **El RPO se promete con el peor caso.**

:::profundo Simular el desastre
El programa simula un desastre en un minuto al azar, con un sistema que recibe 600 registros por hora y distintas frecuencias de copia:

```python
import random
random.seed(8)

def perdida(cada_min, por_hora, ensayos=100_000):
    """Desastre en un minuto al azar: ¿cuántos registros había desde la última copia?"""
    perdidos = [random.uniform(0, cada_min) / 60 * por_hora for _ in range(ensayos)]
    return sum(perdidos) / ensayos, max(perdidos)

print("copia cada      promedio perdido   peor caso (RPO)")
for nombre, minutos in (("24 horas", 1440), ("1 hora", 60), ("15 minutos", 15), ("1 minuto", 1)):
    medio, peor = perdida(minutos, 600)
    print(f"{nombre:<14}{medio:>12,.0f} reg.{peor:>14,.0f} reg.")
```

```salida
copia cada      promedio perdido   peor caso (RPO)
24 horas             7,173 reg.        14,400 reg.
1 hora                 299 reg.           600 reg.
15 minutos              75 reg.           150 reg.
1 minuto                 5 reg.            10 reg.
```

El peor caso es el intervalo entero y el promedio, la mitad.
:::

### Las cuatro estrategias

La guía de AWS sobre recuperación ordena los planes en cuatro **[[estrategia-dr|estrategias de DR]]**, de la más barata y lenta a la más cara y rápida. La columna de costo es la cuenta de la Ronda para C01, cuya infraestructura cuesta ≈ US$1,750 al mes.

| Estrategia | Qué hay en la segunda región | RTO típico | Costo para C01 |
|---|---|---|---|
| **Copia y restauración** (*backup and restore*) | Solo copias de los datos y los artefactos | Horas | Decenas de US$ al mes |
| **Llama piloto** (*pilot light*) | Los datos replicados y lo mínimo creado, pero **apagado** | Decenas de minutos | ≈ US$200 al mes |
| **Espera tibia** (*warm standby*) | Una versión chica del sistema, **encendida** | Minutos | ≈ US$600 al mes |
| **Activo/activo** (*multi-site active/active*) | Todo, atendiendo tráfico | Casi cero | ≈ +US$1,750 al mes |

La diferencia entre las dos del medio es la que más se pregunta: con *pilot light*, la segunda región **no puede atender** sin que antes prendas las máquinas. Con *warm standby* ya atiende, a capacidad reducida, y solo hay que agrandarla.

:::cuenta Un warm standby para C01
Una T4 encendida // ≈ US$0.526 por hora × 730 | 0.526 × 730 | ≈ US$384
Un gateway // la mitad de los ≈ US$248 de los dos | 248 ÷ 2 | ≈ US$124
El plano de control de Kubernetes // US$0.10 por hora | 0.10 × 730 | ≈ US$73
Un balanceador casi sin tráfico | — | ≈ US$16
Total al mes | 384 + 124 + 73 + 16 | **≈ US$600**
Contra la infraestructura de C01 | 600 ÷ 1,750 | ≈ 34 %
= Un tercio más de factura, todos los meses, para proteger una sugerencia que tiene un plan B gratis.
:::

Por eso el plan de C01 es el primero de la tabla, y casi gratis: los pesos y las imágenes copiados a otra región, el código en git y la infraestructura descrita en archivos. Si la región muere por mucho tiempo, se reconstruye en horas. Mientras tanto, Ana elige la categoría a mano.

## Replicación entre regiones y ensayos {Cross-region replication and game days} [extra]

### Replicar: copiar sin que nadie lo pida

Cualquier estrategia de DR empieza por lo mismo: que los datos ya estén en la otra región. La **[[replicacion-regional|replicación entre regiones]]** (*cross-region replication*) es una regla que le dice a un servicio: «cada cosa nueva que llegue aquí, cópiala allá».

- **En S3**, la regla copia cada objeto nuevo a un bucket de otra región. Es **asíncrona**: tu `PUT` termina primero y la copia viaja después. Normalmente tarda segundos, pero sin garantía. Con la opción *Replication Time Control* (RTC), AWS se compromete a replicar el 99.99 % de los objetos nuevos en menos de 15 minutos.
- **En el registro de imágenes** (ECR, donde viven las imágenes de contenedor), otra regla copia cada imagen nueva. Sin ella, el día del desastre la otra región no tiene qué correr.
- **En una base de datos**, una réplica en otra región recibe los cambios con segundos de atraso. Es la [[replica-lectura|réplica de lectura]] que ya conoces, más lejos.

Que sea asíncrona define tu RPO. Lo que estaba «en camino» cuando cayó la región se pierde.

:::diagrama regiones-dr
Una región primaria y una de respaldo en *warm standby*. Usa «Recorrer» para ver un día normal, el día del desastre y qué cambia con *pilot light*.
:::

:::cuenta C05: cuántos documentos quedan en riesgo con RTC
Documentos al día // en 14 horas hábiles | 5,000 ÷ 14 | ≈ 357 por hora
En la hora pico // el doble | 2 × 357 | ≈ 714 por hora
En 15 minutos // la ventana que promete RTC | 714 ÷ 4 | **≈ 180 documentos**
= En el peor caso, a ≈ 180 clientes habría que pedirles su identificación otra vez. El negocio decide si lo acepta o si escribe en las dos regiones antes de responder.
:::

Replicar cuesta, y la cuenta dice qué vale la pena. Los pesos de C01 son ≈ 98 MB por versión: replicarlos cuesta centavos. Sus fotos son 2 TB al día: ≈ 60 TB al mes × US$0.02 por GB ≈ **US$1,200 al mes** solo de transferencia, más guardarlas dos veces. C01 replica los pesos, no las fotos.

:::ojo
**Replicar no es respaldar.** La replicación copia todo, también los errores. Si un script sobrescribe los pesos con un archivo corrupto, la copia de la otra región queda corrupta segundos después. Contra eso hay que guardar el pasado: versiones del bucket o un [[snapshot]], con su [[retencion|retención]]. Una copia en otra región protege del lugar; las versiones protegen de ti.
:::

### El ensayo: game day

Un plan de DR escrito y nunca probado tiene un problema: nadie sabe si funciona. La Ronda lo dice sin vueltas: *un DR que no se ensayó no existe*.

Un **[[game-day|game day]]** es un ensayo programado: se provoca la falla a propósito, en un día y hora acordados, con el equipo mirando. Se apaga una zona, o se corta el acceso a la región primaria, y se ejecuta el plan de verdad.

:::pasos
1. Se escribe qué se espera
«Al apagar la zona 1b, los errores suben menos de 30 segundos y la T4 de 1a llega a ≈ 42 %.»
2. Se provoca la falla
En un horario de poco tráfico, con un límite de tiempo y una forma de deshacerla.
3. Se mide
Cuánto tardó en notarse, cuánto en recuperarse, qué se perdió. **Ese** es tu RTO real, no el del documento.
4. Se arregla lo que salió
Siempre sale algo: una cuota en cero en la otra región, un permiso que faltaba, un dato que solo existía en la zona apagada, un paso que solo sabía hacer una persona.
:::

El ensayo también descubre las causas comunes escondidas: lo que las dos zonas compartían sin que nadie lo supiera. Y deja un RTO **medido**: si el ensayo tardó 40 minutos, tu RTO es 40 minutos, diga lo que diga el plan.

:::nota Tener los archivos no es tener el plan
Describir la infraestructura en archivos (IaC) ayuda mucho, pero no es un plan de DR. Los archivos crean las máquinas; no traen los datos, ni la cuota de GPUs, ni el engine para la GPU de la otra región. Solo el ensayo dice qué falta.
:::

## Cómo elegir región {How to choose a region}

La Ronda (M13) da cuatro preguntas, **en este orden**. El orden importa: una pregunta de arriba puede dejarte sin opciones antes de llegar a las de abajo.

### 1. ¿Dónde tienen que estar los datos?

La **[[residencia-datos|residencia de datos]]** (*data residency*) es la obligación, por ley o por contrato, de guardar o procesar ciertos datos solo dentro de un país o de una región. Un hospital puede tener prohibido sacar expedientes del país. Un banco puede haber firmado con su regulador en qué región opera.

Esto no lo decide ingeniería: lo decide el área legal. Y va primero porque no se negocia con milisegundos. En C05, que verifica documentos de identidad, el diseño empieza con «cuenta y región aprobadas por legal».

Ojo con lo que cuenta como «dato que sale»: no solo la base de datos. También las copias de respaldo, los logs que traen datos de personas y el [[prompt]] que le mandas a un modelo de lenguaje ([[llm|LLM]]) alojado en otra región.

### 2. ¿Están ahí las máquinas y los servicios que necesitas?

El catálogo cambia por región. Las GPUs nuevas llegan primero a unas pocas, y los servicios de ML, también. La Ronda da un ejemplo: en octubre de 2026, la tabla oficial de GPUs por zona de Google Cloud no listaba su región de Querétaro. Una región cercana y legalmente perfecta puede no tener con qué correr tu modelo.

Lo mismo pasa con los modelos de lenguaje que se rentan por API: cada modelo está disponible en ciertas regiones, y hay que revisarlo antes de prometer que «el prompt no sale del país».

:::profundo Tres razones por las que falta una GPU
Cuando pides una GPU y la nube dice que no, hay tres causas distintas, con remedios distintos. La lección de máquinas las desarrolla:

- **Cuota:** tu cuenta no tiene permiso para tantas en esa región. Es un trámite: se pide el aumento, y tarda. C01 necesita cuota para 28 [[vcpu|vCPU]] de máquinas con GPU, contando pruebas y repuestos.
- **Capacidad:** tienes permiso, pero en esa zona, en este momento, no quedan. Remedio: aceptar más zonas y más tipos de máquina, o reservar ([[reserva-capacidad]]).
- **Catálogo:** esa región no ofrece esa GPU. No hay trámite que lo arregle.
:::

### 3. ¿Qué tan lejos queda de quien te llama?

Con las regiones que pasaron los dos filtros, haz la cuenta de distancia de la primera sección. Recuerda que cuenta quién **llama** a tu servicio y dónde están los datos que lee. Para un agente de voz, donde cada 100 ms se sienten en la conversación, esta pregunta pesa mucho. Para un trabajo por lotes que corre de noche, casi nada.

### 4. ¿Cuánto cuesta ahí?

Al final, el precio. La misma máquina puede costar bastante más en una región que en otra: las de Estados Unidos suelen ser las más baratas de cada proveedor. Y suma la red: si tus datos están en una región y tu cómputo en otra, cada GB que viaja se cobra.

:::ejemplo Una clínica en México
Una empresa mexicana quiere un modelo que revise radiografías. El contrato con los hospitales dice que las imágenes no salen de México.

1. **Residencia:** solo sirven regiones en México. Virginia queda fuera, aunque sea la más barata.
2. **Catálogo:** de las regiones en México, ¿cuál ofrece la GPU que necesita? Se revisa la lista oficial, zona por zona. Si ninguna la tiene, las salidas son otro proveedor, un modelo que corra en CPU, o máquinas propias.
3. **Latencia:** dentro de México, todo queda a pocos milisegundos. No decide.
4. **Precio:** se compara al final, entre lo que quedó.

Si hubieran empezado por el precio, habrían diseñado todo en Virginia y descubierto el contrato en la última junta.
:::

## Errores comunes {Common mistakes}

### «Tenemos dos réplicas, tenemos alta disponibilidad»

**Qué pasa:** las dos réplicas quedaron en la misma zona, o en la misma máquina, porque nadie dijo dónde ponerlas. Cae la zona y caen las dos.

**Cómo evitarlo:** pide el reparto por zona de forma explícita y revísalo: ¿en qué zona está cada réplica **hoy**? Dos réplicas en el mismo dominio de falla no son un N+1.

### Confundir el SLA del proveedor con tu disponibilidad

**Qué pasa:** «AWS promete 99.99 %, así que nosotros tenemos 99.99 %». El SLA es de una pieza, promete créditos y no cuenta tu código, tu configuración ni tus deploys.

**Cómo evitarlo:** calcula tu cadena completa, con tus piezas y una causa común estimada. Y mide tu propio SLI.

### Contar con máquinas que todavía no existen

**Qué pasa:** «el autoscaling llega hasta 20 réplicas, aguantamos cualquier cosa». El máximo del autoscaling es un techo, no capacidad: el día que cae una zona, las máquinas nuevas tardan minutos o no hay.

**Cómo evitarlo:** el N+1 por zona ya tiene que estar encendido. Y revisa que tu cuota alcance para el peor día.

### Multi-región «por si acaso»

**Qué pasa:** se pide una segunda región sin haber dicho un RPO ni un RTO. Se paga un tercio más de factura, nunca se ensaya, y el día del desastre la otra región tiene cuota cero de GPUs o un engine que no corre.

**Cómo evitarlo:** primero las dos preguntas (cuánto puedes perder, cuánto puedes tardar), por artefacto. Luego la estrategia más barata que las cumpla. Luego el ensayo.

### Creer que replicar es respaldar

**Qué pasa:** hay copia en otra región, alguien borra o corrompe el original, y la copia queda igual de borrada.

**Cómo evitarlo:** además de replicar, guarda versiones o snapshots por un tiempo. Y prueba restaurar una.

### Dejar que las llamadas crucen de zona

**Qué pasa:** el sistema está bien repartido en dos zonas, pero cada llamada interna cae en cualquier zona. La mitad del tráfico cruza, y a fin de mes aparece una línea de red más grande que la de las GPUs.

**Cómo evitarlo:** ruteo por zona desde el primer día, con las capas repartidas parejo.

## En la vida real {In real life} [extra]

**C01 · Clasificación de fotos.** Una región (`us-east-1`), dos zonas, una T4 por zona, ruteo por zona desde el día 1 y un fallback manual. Sin segunda región: el *warm standby* costaría ≈ US$600 al mes, 34 % más, para proteger una sugerencia. Su DR es copiar los pesos y reconstruir desde archivos.

**C10 · Asistente con un LLM.** Usa tres zonas de `us-east-1`. Con GPUs grandes, que escasean, más zonas son también más lugares donde puede aparecer una libre. La Ronda advierte que tener cuota no garantiza conseguir esas GPUs el día que las pides.

**C04 · Patología digital.** El mismo sistema, dos RPO. Los resultados del modelo se recalculan: RPO de horas y RTO de un día. Las anotaciones de los patólogos son trabajo experto: RPO ≈ 0, replicadas en cuanto se escriben.

**C05 · Verificación de documentos.** La región la eligió legal antes que ingeniería. Los documentos aceptados no se pueden perder: con replicación de 15 minutos quedan ≈ 180 en riesgo en el peor caso, y ese número se lleva a la mesa.

**C02 · Video en centros de distribución.** Aquí el «dominio de falla» no es una zona de la nube: es cada uno de los 25 centros, con su cámara, su caja de cómputo y su enlace a internet. La meta es 99.5 % de alertas **por sitio**, y el diseño supone que el enlace a la nube se cae: cada sitio tiene que seguir alertando solo.

**Fuera de ML.** En marzo de 2021 se incendió un centro de datos de OVHcloud en Estrasburgo, Francia. Un edificio quedó destruido. Quienes tenían sus servidores **y** sus respaldos en ese mismo sitio perdieron los dos: tenían copias, pero en el mismo dominio de falla.

Y en la vida diaria: un hospital tiene planta de luz propia porque no puede depender de un solo cable de la calle. Guardas una copia de tus fotos fuera de casa, no en otro cajón, porque un robo o un incendio se lleva los dos cajones. Es la misma pregunta de toda la lección: **¿qué comparten mis copias?**

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de distancia y los de N+1 se pueden comprobar con las calculadoras. Usa un mes de 30 días (43,200 minutos) y 200 km por milisegundo.

:::ejercicios
? [facil] En `us-east-1b` y en `us-central1-a`, ¿cuál es la región y cuál la zona? De estas cuatro cosas, ¿cuáles viven en una sola zona y cuáles en la región: una máquina virtual, un disco de red, un bucket de S3 Standard, una subred?
- `us-east-1b`: región `us-east-1` (AWS, norte de Virginia), zona «b». `us-central1-a`: región `us-central1` (Google Cloud, Iowa), zona «a».
- En **una zona**: la máquina virtual, el disco de red y la subred.
- En **la región**: el bucket, que guarda copias en al menos tres zonas.
- Por eso las máquinas las repartes tú, y el bucket ya viene repartido.
? [facil] Tus usuarios están en Bogotá y la región queda a 4,000 km. ¿Cuál es el RTT mínimo físico? ¿Y un RTT realista? Si cada usuario abre una conexión nueva (≈ 3 idas y vueltas antes de mandar nada), ¿cuánto espera antes de que salga su request?
- Ida: 4,000 ÷ 200 = 20 ms. RTT mínimo: 2 × 20 = **40 ms**.
- Realista, cerca del doble: **≈ 80 ms**.
- Conexión nueva: 3 × 80 = **≈ 240 ms** antes de empezar. Reusar la conexión lo baja a una sola vuelta.
? [facil] Una zona estuvo caída 3 horas en todo un año, y tu servicio vivía solo en ella. ¿Qué disponibilidad tuvo en el año? ¿Y en el mes de la caída? ¿Cuántos presupuestos de error de un SLO de 99.9 % mensual se gastó?
- Año: 1 − 3 ÷ 8,760 ≈ **99.966 %**. Suena bien.
- Mes de la caída: 1 − 180 ÷ 43,200 ≈ **99.58 %**. No cumple 99.9 %.
- Presupuesto: 180 ÷ 43.2 ≈ **4.2 presupuestos** en una tarde.
- La misma caída se ve muy distinta según la ventana. Di siempre en cuánto tiempo se mide.
? [facil] Un sistema copia su base de datos cada noche a las 02:00. Un martes a las 17:00 se pierde la base. Restaurar la copia tarda 3 horas. ¿Cuántas horas de datos se perdieron? ¿Qué RPO puede prometer este esquema? ¿Y qué RTO, como mínimo?
- Se perdió lo escrito entre las 02:00 y las 17:00: **15 horas** de datos.
- El RPO se promete con el peor caso: un desastre a la 01:59 pierde casi **24 horas**.
- RTO: al menos **3 horas**, más lo que se tarde en notar la falla y decidir restaurar.
? [medio] Un servicio tiene un pico de 3,000 requests por segundo. Cada réplica aguanta 400 al máximo, y no quieres pasar de 70 % ni con una zona caída. ¿Cuántas réplicas necesitas con 2 zonas? ¿Y con 3? Si cada réplica cuesta US$124 al mes, ¿cuánto ahorra la tercera zona?
- Cada réplica, al tope: 0.70 × 400 = 280 por segundo.
- Dos zonas: una sola tiene que aguantar todo. 3,000 ÷ 280 = 10.7 → 11 por zona, **22 en total**.
- Tres zonas: las dos que quedan aguantan todo. 3,000 ÷ (2 × 280) = 5.4 → 6 por zona, **18 en total**.
- Ahorro: (22 − 18) × 124 = **US$496 al mes**. Sin pensar en zonas bastarían 11.
? [medio] Un failover por DNS: el health check corre cada 10 segundos y declara la caída a las 3 fallas; el TTL es de 60 segundos. La región de respaldo es un *warm standby* que tarda 4 minutos en crecer hasta aguantar todo el tráfico. ¿Cuánto pasa hasta que el último cliente llega a la región nueva? ¿Cuál es el RTO aproximado? Si esto pasa una vez en un mes, ¿qué disponibilidad queda?
- Detección: 3 × 10 = 30 s. Más el TTL: 30 + 60 = **90 segundos** para el último cliente.
- Hasta atender todo el tráfico: 90 s + 240 s = 330 s ≈ **5.5 minutos** de RTO.
- Disponibilidad del mes: 1 − 5.5 ÷ 43,200 ≈ **99.987 %**. Cumple 99.9 %, no 99.99 %.
- Para 99.99 % (4.3 minutos) habría que tener la segunda región ya a tamaño completo: activo/activo.
? [medio] Un sistema escribe 500 GB nuevos al día y los replica a otra región, donde los guarda 30 días. La transferencia cuesta US$0.02 por GB y guardar, US$0.023 por GB al mes. ¿Cuánto cuesta al mes? Si la replicación garantiza 15 minutos, ¿cuántos GB quedan en riesgo, suponiendo que se escribe parejo todo el día?
- Al mes: 500 × 30 = 15,000 GB.
- Transferencia: 15,000 × 0.02 = **US$300**.
- Guardado en la segunda región: 15,000 × 0.023 = **US$345**.
- Total: ≈ **US$645 al mes**.
- En riesgo: 500 ÷ 24 ÷ 4 ≈ **5.2 GB**, lo de 15 minutos.
? [reto] Un equipo etiqueta 2,000 imágenes al día, en 8 horas, a US$0.50 cada una. Las etiquetas viven en una base de datos. Compara tres planes: (a) una copia cada 24 horas, gratis; (b) una copia cada hora, gratis; (c) replicación continua a otra región, US$40 al mes. Supón un desastre cada 5 años. Para cada plan: el peor caso, la pérdida promedio por desastre y la pérdida esperada al año. ¿Cuál eliges? ¿Qué cambiaría si quienes etiquetan fueran patólogos?
- (a) Peor caso: un día, 2,000 × 0.50 = US$1,000. Promedio: la mitad, US$500. Esperado al año: 500 × 1⁄5 = **US$100**.
- (b) En una hora se etiquetan 2,000 ÷ 8 = 250. Peor caso: 250 × 0.50 = US$125. Promedio: US$62.50. Esperado al año: **US$12.50**.
- (c) Pérdida ≈ 0, pero cuesta 40 × 12 = **US$480 al año**.
- Gana **(b)**: casi toda la protección, sin costo. La replicación cuesta 38 veces más de lo que ahorra respecto a (b).
- Con patólogos cambia el precio de rehacer (trabajo experto, que además retrasa a pacientes) y deja de ser una cuenta de promedios: ahí se justifica (c), un RPO ≈ 0.
? [reto] La cadena de C01 en dos zonas pierde ≈ 5 minutos al mes por fallas independientes y ≈ 43 por deploys malos que llegan a las dos zonas. Supón además que la región se cae 6 horas una vez cada 4 años. (a) ¿Cuántos minutos al mes pone la región, en promedio? (b) ¿Cuánto suma todo, y cumple 99.9 %? (c) Tienes dinero para una sola mejora: un *warm standby* (US$600 al mes) o cambiar de versión de a poco, que evita 9 de cada 10 deploys malos. ¿Cuál eliges?
- (a) 360 minutos ÷ 48 meses = **7.5 minutos al mes** en promedio.
- (b) 5 + 43 + 7.5 = **≈ 56 minutos**. No cumple: el presupuesto es 43.2.
- (c) El *warm standby* quita, cuando mucho, los 7.5 de la región: quedan ≈ 48, y sigue sin cumplir. Los cambios de a poco bajan los 43 a ≈ 4: quedan 5 + 4 + 7.5 ≈ **17 minutos**. Cumple, y cuesta mucho menos.
- La región es el dominio que más asusta, pero aquí es el que menos minutos pone. Ataca primero la fuente más grande.
? [reto] Diseña la ubicación de un agente de voz para un banco mexicano. Datos: los audios traen datos personales y el contrato exige que se procesen en México; el modelo necesita una GPU; en una conversación, cada 100 ms de más se notan. Tienes tres opciones: una región en México, `us-east-1` (≈ 60 ms de RTT desde la Ciudad de México) y São Paulo (≈ 150 ms). Decide con las cuatro preguntas en orden y di qué tendrías que verificar antes de comprometerte.
- **Residencia:** el contrato deja solo la región en México. `us-east-1` y São Paulo quedan fuera en la primera pregunta, sin mirar latencia ni precio.
- **Catálogo:** hay que verificar, en la lista oficial y zona por zona, que la región en México ofrezca la GPU, y pedir la cuota **antes** de prometer fechas. Si no la ofrece: otro proveedor con GPUs en el país, máquinas propias, o renegociar el contrato con legal. No es decisión de ingeniería.
- **Latencia:** dentro de México, ≈ 4 ms de RTT. De sobra. São Paulo, además de no cumplir el contrato, era la peor: 150 ms por vuelta.
- **Precio:** se acepta el que haya.
- **Zonas:** dos o tres dentro de esa región, con N+1 por zona. Una segunda región en México puede no existir: el plan de DR se discute con el banco, con un RPO y un RTO escritos.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M06 · Orquestación y escalado** usa todo esto en Kubernetes: la tabla de dominios de falla, las réplicas repartidas por zona, el ruteo por zona y por qué el autoscaling no cubre la zona que se cae.
- **M13 · Costos y nube** hace las cuatro preguntas para elegir región, explica las tres razones por las que falta una GPU y cobra el tráfico que cruza de zona.
- **M15 · Seguridad y confiabilidad** define SLI, SLO y SLA, calcula la disponibilidad de C01 con y sin causa común, y desarrolla RPO, RTO y las cuatro estrategias de DR con su costo.
- La **hoja de números** trae la tabla de latencias por distancia y la de nueves.

**En el Dojo:** cuando abra la estación 9 (Kubernetes), vas a repartir las réplicas de C01 en dos zonas, apagar una y ver qué le pasa a la otra: tu primer *game day*.

**En Sensei:** la siguiente lección, «Máquinas, GPUs y cómo se cobran», explica qué es exactamente una `g4dn.xlarge`, cómo se cobra y por qué a veces no hay. Después, «Redes en la nube» le pone precio a cada GB que cruza de zona o de región, y «Servicios gestionados, serverless y permisos» explica qué opera el proveedor por ti y qué cubre de verdad el SLA de cada servicio.

## Palabras que vas a oír {Words you will hear}

:::conceptos
region zona-disponibilidad sla dominio-falla multi-az multi-region n-mas-uno ruteo-por-zona failover recuperacion-desastres rpo rto estrategia-dr residencia-datos replicacion-regional game-day
:::

## Chequeo {Check}

:::chequeo
? ¿Qué diferencia hay entre una región y una zona?
Una región es un área geográfica con un grupo de centros de datos, separada de las demás regiones. Una zona es uno o más centros de datos dentro de la región, aislados de las otras zonas pero a ≈ 1 ms de ellas.
? ¿Cuánto RTT pone, como mínimo, cada 100 km de distancia? ¿Por qué?
Al menos 1 ms, ida y vuelta: la luz en la fibra recorre ≈ 200 km por milisegundo. El RTT real suele ser cerca del doble.
? C01 necesita una sola T4 para su tráfico. ¿Por qué tiene dos, y por qué en zonas distintas?
Por disponibilidad: es un N+1 por zona. Si cae una zona, la otra aguanta el pico sola, al ≈ 42 % de su máximo. En la misma zona caerían juntas.
? ¿Qué promete un SLA del proveedor?
Créditos en la factura si un servicio suyo baja de cierto porcentaje. No promete que no se caiga, y no cubre tu cadena completa.
? ¿Qué preguntan el RPO y el RTO?
RPO: cuántos datos, en tiempo, aceptas perder. RTO: cuánto tiempo aceptas estar caído hasta volver a atender.
? ¿Por qué C01 no usa una segunda región?
Porque su SLO de 99.9 % se cumple con dos zonas y tiene un fallback manual que no depende de la región. Un *warm standby* costaría ≈ 34 % más para proteger una sugerencia.
? ¿En qué orden se elige una región?
Residencia de datos, catálogo (GPUs y servicios), latencia a quien llama y, al final, precio.
:::
