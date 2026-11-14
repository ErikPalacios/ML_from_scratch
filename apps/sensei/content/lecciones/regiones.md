---
titulo: Regiones, zonas y disponibilidad
en: Regions, zones and availability
subtitulo: Dónde está físicamente la nube, qué pasa cuando un centro de datos se apaga, cuánto protege repartir las réplicas en zonas y cuándo vale la pena pagar una segunda región.
pregunta: Alba, el marketplace que sigue el curso, corre su modelo en «us-east-1, en dos zonas». ¿Qué es eso, por qué dos y no una, qué pasa si una se cae, y por qué no hace falta una segunda región?
requisitos: probabilidad, red, latencia, nube
---

:::idea
La nube tiene dirección. Sus centros de datos se agrupan en **regiones** (un área del mapa) y cada región se parte en **zonas** aisladas entre sí. Repartir tus réplicas en dos o tres zonas es barato y te protege del centro de datos que se apaga. Una segunda región es cara y solo se justifica cuando sabes dos números: cuántos datos puedes perder y cuánto puedes tardar en volver.
:::

En la lección de la nube viste que «la nube» son computadoras de alguien más, en un [[centro-de-datos|centro de datos]] que no ves, rentadas por hora. Pero esas computadoras están en algún lugar. Tienen un edificio, un enchufe, un cable que sale a la calle. Y un edificio se puede quedar sin luz, se puede inundar o se puede quedar sin red.

Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Su modelo contesta ≈ 10 millones de fotos al día, con un pico de diseño de 500 por segundo. Su diseño dice: «AWS, región `us-east-1`, dos zonas, `us-east-1a` y `us-east-1b`». Cada parte de esa frase es una decisión. La región decide qué tan lejos queda el modelo de quien lo llama, qué leyes aplican y qué máquinas hay. Las dos zonas deciden qué pasa el día que un edificio completo se apaga.

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

Cada uno de los tres grandes (AWS, Google Cloud y Azure) tiene decenas de regiones repartidas por el mundo, y abren nuevas cada año.

Lo importante es que las regiones están **separadas a propósito**. Una máquina que creas en `us-east-1` no existe en `us-west-2`. Un [[bucket-objetos|bucket]] vive en una región y sus bytes no salen de ahí si tú no los mandas. Cuando le hablas a la [[api-nube|API de la nube]], le hablas a la de una región. Esa separación es la que permite que un problema en Virginia no tumbe a Oregón.

Por eso «¿en qué región?» es de las primeras preguntas de un diseño. La región cambia cinco cosas:

- **La distancia** a tus usuarios y a los sistemas que te llaman, que se convierte en latencia.
- **El catálogo.** No todas las regiones tienen todas las máquinas ni todos los servicios. Una [[gpu|GPU]] nueva llega primero a unas pocas.
- **El precio.** La misma máquina cuesta distinto en cada región.
- **La ley.** Los datos guardados en una región están físicamente en ese país, y les aplican sus leyes.
- **Tus límites.** Tu [[cuota-servicio|cuota]] (cuántas máquinas te deja prender el proveedor) se cuenta por región.

Cuando hay que elegir, esas cosas se revisan en orden. Primero la ley: si un contrato exige que ciertos datos no salgan del país (la [[residencia-datos|residencia de datos]]), las regiones de fuera quedan descartadas sin mirar nada más. Luego el catálogo: ¿tiene la GPU que necesitas? Luego la distancia a quien te llama. Y al final, el precio. La sección «Cómo elegir región» lo desarrolla.

:::figura regiones-mapa
Una región es un grupo de zonas cercanas entre sí, unidas por fibra propia (`us-east-1` tiene seis; aquí se dibujan tres). Otra región queda a cientos o miles de kilómetros. La distancia se nota en los milisegundos.
:::

:::analogia Una cadena de supermercados
Piensa en una cadena de supermercados. En cada ciudad grande tiene varias sucursales: esa ciudad es la **región** y cada sucursal es una **zona**. Si una sucursal cierra por una fuga de agua, vas a otra de la misma ciudad y casi no pierdes tiempo. Si toda la ciudad se queda sin luz, la sucursal más cercana está en otra ciudad, a horas de camino. Y los precios y lo que hay en los estantes cambian de una ciudad a otra.

**Dónde se rompe:** en el súper tú caminas a otra sucursal. En la nube, tu programa no se muda solo: alguien tuvo que haber puesto una copia en la otra zona **antes** de la falla. Y lo que guardaste en una sucursal (un disco) no aparece en la otra por arte de magia.
:::

### La distancia es latencia

En la lección de red viste el [[rtt|RTT]] (*round-trip time*): lo que tarda un mensaje en ir y volver. Hay una parte del RTT que ningún ingeniero puede bajar, porque es física.

Entre ciudades, los datos viajan por **fibra óptica**: hilos de vidrio muy delgados por los que van pulsos de luz. En el vacío, la luz recorre ≈ 300,000 km por segundo. Dentro del vidrio de la fibra va a unos dos tercios de eso: ≈ 200,000 km por segundo, o **≈ 200 km por milisegundo**. Entonces 100 km de ida toman 0.5 ms, y la ida y vuelta, 1 ms. De ahí la regla práctica: **al menos 1 ms de RTT por cada 100 km**.

Con letras, la cuenta completa queda así:

:::formula RTT por distancia
RTT_{min} = frac{2 × d}{v}
RTT ≈ f × RTT_{min}
t_{red} = k × RTT
text{parte de la meta} = frac{t_{red}}{S}
- d: la distancia en línea recta entre quien llama y la región, en km
- v: lo que recorre la luz en la fibra: ≈ 200 km por ms
- RTT_{min}: el RTT mínimo que permite la física, en ms
- RTT: el RTT real, el que se mide, en ms
- f: el factor de la ruta real: cuántas veces el mínimo tarda de verdad (≈ 2, la tabla de abajo dice por qué)
- k: cuántas idas y vueltas hace una request: 1 con la conexión ya abierta, ≈ 3 si abre una nueva
- t_{red}: el tiempo que la request pasa en la red, en ms
- S: la meta de latencia, en ms
:::

:::cuenta De la Ciudad de México al norte de Virginia
Distancia \(d\) // en línea recta, sobre la superficie de la Tierra | — | ≈ 3,000 km
Solo de ida // a \(v\) = 200 km por ms | \(d ÷ v\) = 3,000 ÷ 200 | 15 ms
RTT mínimo \(RTT_{min}\) // ida y vuelta | \(2 × d ÷ v\) = 2 × 15 | **30 ms**
RTT real // los cables no van en línea recta y hay equipos en medio: \(f\) ≈ 2 | \(f × RTT_{min}\) = 2 × 30 | **≈ 60 ms**
Tiempo en la red \(t_{red}\) // con la conexión ya abierta, \(k\) = 1 | \(k × RTT\) = 1 × 60 | 60 ms
Lo que se va solo en el viaje // de una meta \(S\) = 300 ms, la del [[slo\|SLO]] de Alba | \(t_{red} ÷ S\) = 60 ÷ 300 | 20 %
= Antes de que el modelo haga nada, una quinta parte del tiempo ya se gastó en kilómetros.
:::

El «doble» sale de comparar la física con lo medido. Estos son rangos típicos:

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

Dos cosas hacen que la distancia pese más de lo que parece:

- **Una conexión nueva da varias vueltas.** Antes de mandar la foto hay que abrir la conexión (el saludo inicial, o [[handshake]]) y acordar el cifrado de [[https|HTTPS]]. Son \(k\) ≈ 3 idas y vueltas: \(t_{red} = k × RTT\) = 3 × 60 = 180 ms antes de empezar. Por eso se reusan las conexiones abiertas ([[keep-alive]]).
- **Lo que importa es quién te llama, no dónde está el usuario final.** Al modelo de Alba no lo llama el teléfono de Ana, una vendedora de la Ciudad de México que publica la foto de sus tenis: lo llama el *backend* de publicación (el programa de Alba que recibe la publicación), que vive en la misma región. Esa llamada viaja metros, no miles de kilómetros. Los 60 ms entre el teléfono de Ana y Virginia se gastan antes, cuando la app le habla al backend, y no entran en el presupuesto de 300 ms del modelo.

De ahí sale una regla de diseño: **pon el modelo junto a quien lo llama y junto a sus datos**. Si el backend y las fotos están en `us-east-1`, el modelo va en `us-east-1`.

:::calculadora regiones-distancia
Arranca con la cuenta de arriba: 3,000 km, el doble de la física y una sola ida y vuelta. Sube las idas y vueltas a 3 para ver lo que cuesta abrir una conexión nueva desde lejos.
:::

## Zonas y dominios de falla {Zones and failure domains}

### Qué es una zona

Dentro de una región, los centros de datos no están todos en el mismo edificio. Se agrupan en **[[zona-disponibilidad|zonas de disponibilidad]]** (*availability zones*; en el trabajo se dice **AZ** o «zona» a secas). Una zona es uno o más centros de datos con su propia electricidad, su propio enfriamiento y su propia red, **aislados** de las otras zonas de la región.

- **Están separadas** por kilómetros, para que un incendio, una inundación o un apagón no les pegue a dos a la vez. En AWS, según su documentación, quedan a menos de 100 km unas de otras.
- **Están unidas** por fibra del propio proveedor. Por eso el RTT entre dos zonas es de ≈ 1 ms: lo bastante cerca para trabajar como si fueran una sola red.
- **Se nombran** con el nombre de la región y una letra: `us-east-1a`, `us-east-1b`. En Google Cloud, `us-central1-a`. En Azure se numeran: zona 1, 2 y 3.
- **En AWS y en Google Cloud, cada región tiene tres o más.** `us-east-1` tiene seis. En Azure no todas: varias regiones no tienen zonas, y hay que revisarlo antes de elegir una. Un diseño usa dos o tres: Alba usa dos, y un servicio que sirve su propio modelo grande de lenguaje ([[llm|LLM]]), como el de «En la vida real», usa tres.

### Lo que vive en una zona y lo que vive en la región

No todo lo que rentas está repartido. Hay recursos **zonales**, que existen en una sola zona, y recursos **regionales**, que el proveedor reparte por ti entre varias.

| Recurso | Dónde vive | Si cae su zona |
|---|---|---|
| Una máquina virtual ([[instancia]]) | Una zona | Se cae con ella |
| Un disco de red ([[almacenamiento-bloques\|EBS]], en AWS) | Una zona | Se queda atrapado: no se puede conectar a una máquina de otra zona |
| Una [[subred]] (un pedazo de tu red privada) | Una zona | Queda sin máquinas |
| El [[object-storage\|object storage]] (S3 Standard, en AWS) | La región: copias en al menos 3 zonas | Sigue respondiendo |
| El [[balanceador]] (el ALB, en AWS) | Las zonas que tú elijas | Atiende desde las demás |
| El [[plano-de-control\|plano de control]] de Kubernetes gestionado | La región | Sigue respondiendo |

En la última fila, el **plano de control** es la parte de Kubernetes que recibe tus órdenes y decide en qué máquina corre cada cosa. Es **gestionado** cuando lo opera el proveedor por ti: en AWS ese servicio se llama EKS, y AWS reparte el plano de control entre varias zonas.

La consecuencia práctica: **repartir las máquinas te toca a ti**. El proveedor reparte S3 por ti, pero si pones tus dos servidores en `us-east-1a`, los dos se caen juntos, y nadie te avisa al crearlos.

:::profundo Tu «us-east-1a» no es la mía
En nueve regiones viejas de AWS, `us-east-1` entre ellas, la letra de la zona se asignó **por cuenta**. Tu `us-east-1a` y la de otra empresa pueden ser edificios distintos. AWS lo hizo para que no todo el mundo eligiera la «a» y la llenara. Las regiones abiertas después de 2012 usan las mismas letras para todos, y en esas nueve las cuentas creadas desde noviembre de 2025 también. El nombre que sí es igual para todos es el **id de zona**, como `use1-az4`.

Así se ve en la terminal de alguien que pregunta qué zonas tiene su región, con los dos nombres. Es una ilustración: necesita una [[cuenta-nube|cuenta]] de AWS y su programa para la [[terminal]], el `aws`.

```bash
aws ec2 describe-availability-zones --region us-east-1 \
  --query "AvailabilityZones[].[ZoneName, ZoneId, State]" --output text
# us-east-1a   use1-az4   available
# us-east-1b   use1-az6   available
# us-east-1c   use1-az1   available
# … y tres líneas más: us-east-1 tiene seis zonas
```

El id de zona importa cuando dos cuentas quieren estar en la misma zona física, para que su tráfico no cruce de zona, o cuando un aviso de falla dice «afectada: `use1-az4`» y tienes que saber cuál de tus letras es.
:::

### Dominios de falla

Un **[[dominio-falla|dominio de falla]]** (*failure domain*) es todo lo que se cae junto cuando falla una sola cosa. Una máquina es un dominio de falla: si se quema su fuente de poder, se cae todo lo que corre en ella. Una zona es otro, más grande: si se queda sin luz, se caen todas sus máquinas.

Los dominios van uno dentro de otro, como muñecas rusas: la región guarda zonas, cada zona guarda máquinas y cada máquina corre pods. La comparación sirve para el acomodo, no para la falla: una muñeca rota deja sanas a las de adentro, pero cuando falla un dominio se cae todo lo que lleva adentro.

:::figura regiones-dominios
Cuatro dominios de falla, uno dentro de otro. Los de adentro fallan seguido y se llevan poco. Los de afuera fallan rara vez y se llevan todo lo que contienen.
:::

La tabla los ordena del más chico al más grande. Un **pod** es la unidad en la que Kubernetes, el [[orquestacion|orquestador]], corre tu programa; un **[[nodo]]** es una de las máquinas del grupo.

| Qué falla | Qué tan seguido | Qué se lleva | La defensa |
|---|---|---|---|
| Un pod (tu programa se cuelga) | Común | Una réplica | Kubernetes lo reinicia solo |
| Un nodo (la máquina) | Ocasional | Todas las réplicas de esa máquina | Una réplica de más en otra máquina |
| Una GPU (errores de hardware) | Ocasional | Lo que corría en esa GPU | Sacar ese nodo y reemplazarlo |
| Una zona | Rara, pero pasa | Todo lo zonal de esa zona | Réplicas en otra zona |
| Una región | Muy rara | Todo | Otra región |
| Mantenimiento planeado | Frecuente | Los nodos que se actualizan | Actualizar uno por uno, con un mínimo siempre arriba |

De la tabla salen dos ideas.

**Tus réplicas tienen que estar en dominios distintos del tamaño que quieres sobrevivir.** Dos réplicas en la misma máquina no sobreviven a la máquina. Dos réplicas en máquinas distintas de la misma zona no sobreviven a la zona. En la lección de probabilidad lo viste con números: la redundancia solo suma contra fallas [[independencia|independientes]], y compartir un dominio de falla es la forma más común de no serlo.

**Cada dominio más grande cuesta más de cubrir.** Reiniciar un pod es gratis. Una máquina de más cuesta una máquina. Poner esa máquina de más en otra zona cuesta lo mismo, más un poco de red. Otra región cuesta, como vas a ver, cerca de un tercio de toda la infraestructura. Por eso no se cubre «todo»: se decide hasta qué dominio.

:::profundo Las fallas grises
Una zona casi nunca falla como en las películas, con todo apagado. Lo normal es una falla **parcial**: la red de la zona pierde paquetes, o no se pueden crear máquinas nuevas, o un servicio contesta lento. Tus réplicas de esa zona siguen «vivas» pero funcionan mal. Por eso la defensa no es «detectar que la zona murió», sino [[health-check|health checks]] que saquen a cada réplica que deja de contestar bien, sea cual sea la causa.
:::

## Multi-AZ, N+1 y ruteo por zona {Multi-AZ, N+1 and zone-aware routing}

### Repartir en zonas

**[[multi-az|Multi-AZ]]** quiere decir que cada pieza de tu sistema tiene réplicas en dos o más zonas de la misma región, y que cualquiera de las zonas puede atender sola. Es la protección contra el dominio «zona», y casi siempre se quiere, por tres razones:

- **Es barato.** Las zonas están a ≈ 1 ms: no hay que cambiar el diseño. Las máquinas cuestan lo mismo en una zona que en otra.
- **Es casi automático.** El balanceador y Kubernetes ya saben de zonas: basta con decirles que repartan.
- **Cubre la falla grande más probable.** Una zona caída es rara; una región entera, mucho más rara.

Así queda el sistema de Alba:

:::diagrama regiones-alba
Toca cada caja para ver por qué está ahí, y usa «Recorrer» para ver un día normal, la caída de una zona y lo que pasa si las requests cruzan de zona.
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

En la lección de probabilidad viste la regla **[[n-mas-uno|N+1]]**: N réplicas para atender el tráfico y una de repuesto, para que perder una no se note. Alba necesita una sola T4 (la GPU donde corre su modelo, que aguanta ≈ 1,200 fotos por segundo) para su pico de diseño de 500 fotos por segundo, y tiene dos, una por zona.

Cuando el dominio que quieres sobrevivir es la zona, el «+1» no es una máquina: es **una zona entera de capacidad**. La regla queda así:

> Si cae una zona, las que quedan tienen que aguantar el pico completo.

Con dos zonas, cada una tiene que poder con el 100 % del pico: pagas el **doble** de lo que el tráfico pide. Con tres zonas, al caer una quedan dos, así que cada una necesita la mitad del pico: tres mitades son **1.5 veces** el pico. En general, con Z zonas, al caer una quedan Z − 1, cada zona carga 1 ÷ (Z − 1) del pico, y las Z juntas suman Z ÷ (Z − 1) veces el pico.

El pico de diseño de Alba (500 fotos por segundo) no enseña la diferencia, porque una T4 por zona sobra. Míralo en una campaña sostenida hipotética, como un Hot Sale (la campaña anual de ventas en línea de México), con el tráfico × 5 durante horas: 5 × 500 = 2,500 fotos por segundo. No es la ráfaga de un minuto que sigue a una notificación masiva: es tráfico alto que se queda. Pediría subir el tope del [[autoscaling|autoscaler]] de Alba de 4 a 6 T4 y su [[cuota-servicio|cuota]] de 28 a ≈ 36 [[vcpu|vCPU]], con la de sobra al desplegar, staging y CI.

Falta una regla para la cuenta: ninguna GPU debe pasar del 70 % de su máximo, ni siquiera con una zona caída. Ese margen ([[headroom]]) existe porque cerca del 100 % las requests empiezan a hacer fila y la latencia se dispara.

Con el tope, la regla queda en tres ecuaciones:

:::formula N+1 por zona
R_z = ⌈ frac{P}{(Z − 1) × c × u} ⌉
R = Z × R_z
ρ_{normal} = frac{P}{R × c}
ρ_{caída} = frac{P}{(R − R_z) × c}
- P: el pico que hay que aguantar, en requests (aquí, fotos) por segundo
- c: lo que aguanta una réplica al máximo, en requests por segundo
- u: el tope de uso que aceptas con una zona caída, como fracción: 0.70 para el 70 %
- Z: cuántas zonas usas
- R_z: las réplicas de cada zona. ⌈ ⌉ quiere decir «redondea hacia arriba»: no existe media réplica
- R: las réplicas en total
- ρ_{normal}, ρ_{caída}: el uso de cada réplica en el pico, con todas las zonas arriba y con una zona caída
:::

:::cuenta Una campaña sostenida en Alba: 2,500 fotos por segundo
Pico \(P\) // 5 × el pico de diseño | 5 × 500 | 2,500 por segundo
Lo que aguanta una T4 al máximo, \(c\) // lo que mide Alba | — | ≈ 1,200 por segundo
Tope en emergencia, \(c × u\) // con una zona caída, sin pasar de \(u\) = 70 % | 0.70 × 1,200 | 840 por segundo
T4 por zona, \(R_z\) // con \(Z\) = 2, la zona que queda carga todo | \(P ÷ ((Z − 1) × c × u)\) = 2,500 ÷ (1 × 840) = 2.98, hacia arriba | 3
T4 en total, \(R\) | \(Z × R_z\) = 2 × 3 | **6 T4**
Uso con las dos zonas arriba, \(ρ_{normal}\) | \(P ÷ (R × c)\) = 2,500 ÷ (6 × 1,200) | ≈ 35 %
Uso si cae una zona, \(ρ_{caída}\) // quedan \(R − R_z\) = 3 | \(P ÷ ((R − R_z) × c)\) = 2,500 ÷ (3 × 1,200) | ≈ 69 %
Costo de las 6 // la `g4dn.xlarge`, con una T4: US$0.526 por hora × 730 horas al mes ≈ US$384 | 6 × 384 | ≈ US$2,304 al mes
= La mitad de esas GPUs, 3 × 384 ≈ US$1,152 al mes, existe solo para el día que cae una zona.
:::

¿Y con tres zonas? Depende del tamaño. Con pocas réplicas, el redondeo manda: no existe media GPU, así que cada zona lleva al menos una. Con 500 fotos por segundo, tres zonas cuestan **más** (3 T4 contra 2). Con muchas, gana la regla: a 12,000 por segundo, tres zonas piden 24 T4 y dos zonas piden 30. Seis GPUs de diferencia son 6 × 384 ≈ US$2,300 al mes.

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

La columna «sin N+1» es lo que pediría el tráfico solo, y las dos últimas, el uso de cada GPU en el pico, con todas las zonas arriba («normal») y con una zona caída.
:::

:::calculadora regiones-zonas
Arranca con la campaña sostenida de Alba (2,500 por segundo). Baja el pico \(P\) a 500 para ver el pico de diseño de Alba (una T4 por zona), o súbelo a 12,000 y cambia \(Z\) de 2 a 3 zonas para ver cómo baja el sobrecosto.
:::

### Por qué el repuesto tiene que estar encendido

Podrías pensar: «no pago el repuesto; cuando caiga una zona, prendo máquinas en la otra». No alcanza el tiempo. Esto pasa cuando una zona deja de contestar:

:::pasos
1. De segundos a un minuto
Los health checks del balanceador fallan varias veces seguidas, y el balanceador deja de mandar tráfico a esa zona. Con los valores por omisión del ALB (un check cada 30 segundos, 2 fallas) es ≈ 1 minuto; ajustados, ≈ 10 segundos. Todo el tráfico cae sobre la zona sana.
2. ≈ 6 minutos
Kubernetes tarda ≈ 50 segundos en marcar como perdido un nodo que no contesta, y luego espera, por omisión, 300 segundos más antes de dar por perdidos sus pods. Solo entonces intenta crearlos en otro lado.
3. De 5 a 13 minutos más
Si en la zona sana no hay una máquina libre, hay que pedirla. Un nodo con GPU tarda ≈ 5–13 minutos en servir su primera request (un rango típico): arranca la máquina, baja la imagen del contenedor, carga el modelo en la GPU y lo calienta ([[warmup-inferencia|warmup]]: unas predicciones de prueba para que las primeras requests reales no salgan lentas). Es el [[cold-start|arranque en frío]].
4. O nunca
En una falla de zona, **todos** los clientes de esa zona piden máquinas en las otras al mismo tiempo. Puede que no haya de tu tipo: es el [[error-capacidad|error de capacidad]], que ves en la lección de máquinas.
:::

Sumado, son de 11 a 19 minutos sin capacidad suficiente (≈ 6 del paso 2 más 5 a 13 del paso 3): la zona sana recibe todo el tráfico con la mitad de las máquinas, y las requests que no caben fallan. Un SLO de 99.9 % deja estar caído 0.001 × 43,200 ≈ 43 minutos al mes de 30 días (su [[error-budget|presupuesto de error]]): una sola falla de zona se comería entre 11 ÷ 43 ≈ un cuarto y 19 ÷ 43 ≈ casi la mitad. Por eso el repuesto no se «prende cuando haga falta»: ya está corriendo y atendiendo tráfico. El [[autoscaling]] (agregar o quitar máquinas según la carga) sirve para el crecimiento de la tarde, no para la zona que se cayó.

### Ruteo por zona

Alba tiene un *gateway* (el programa que recibe la foto y la prepara) y un Triton (el servidor que corre el modelo) en cada zona. Cuando el gateway de la zona `1a` llama a Triton, ¿a cuál le toca? Si no le dices nada, el [[service-k8s|Service]] de Kubernetes reparte entre todos: la mitad de las llamadas se queda en `1a` y la otra mitad cruza a `1b`.

Cruzar de zona tiene dos costos. Uno es tiempo: ≈ 1 ms más por salto. El otro es dinero: la nube cobra cada GB que cruza de una zona a otra, ≈ US$0.01 al salir de una zona y otro US$0.01 al entrar a la otra, o sea US$0.02 por GB. El gateway de Alba le manda a Triton la foto ya convertida en números, un [[tensor]] de 602 KB. Con ≈ 10 millones de fotos al día, eso suma 10,000,000 × 602 KB × 30 días ≈ 180 TB al mes. Si la mitad cruza, son 180 ÷ 2 ≈ 90 TB, o 90,000 GB × US$0.02 ≈ **US$1,800 al mes**, casi tanto como toda la infraestructura de Alba (≈ US$1.8k al mes). Esa factura se desarma en la lección de redes en la nube ([[transferencia-entre-zonas]]); aquí importa el remedio.

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

:::cuenta El balanceador de Alba se cae 2 horas en un mes
Minutos del mes, \(M\) // 30 días | 30 × 24 × 60 | 43,200
Minutos caído, \(t_{caído}\) // 2 horas | 2 × 60 | 120
Disponibilidad del balanceador ese mes, \(A\) | \(1 − t_{caído} ÷ M\) = 1 − 120 ÷ 43,200 | ≈ 99.72 %
¿Cumplió su SLA de 99.99 %? | 99.72 < 99.99 | No
Crédito // entre 99.0 % y 99.99 %, el SLA del balanceador devuelve 10 % de lo pagado por él: Alba paga ≈ US$500 al mes | 0.10 × 500 | **US$50**
Presupuesto de error de Alba, \(E\) // su SLO de 99.9 % en 30 días | \((1 − 0.999) × M\) = 0.001 × 43,200 | 43.2 min
Lo que se gastó | \(t_{caído} ÷ E\) = 120 ÷ 43.2 | ≈ 2.8 presupuestos
= El proveedor te devuelve US$50. Tú gastaste en una tarde el presupuesto de error de casi tres meses.
:::

**Dos: cubre su pieza, no tu cadena.** El SLA de 99.95 % de EKS cubre el *endpoint* de la API de Kubernetes, la «oficina» que recibe órdenes. No cubre tus pods, ni tus máquinas, ni tu modelo. Si tu Triton se cuelga, EKS cumplió su SLA perfectamente. Y tu sistema es una cadena de piezas en serie, que multiplica las [[disponibilidad|disponibilidades]], \(A = p_1 × p_2 × p_3\): el conjunto siempre queda por debajo de su peor pieza. Tres piezas de 99.9 % en serie dan 0.999 × 0.999 × 0.999 ≈ 99.7 %.

**Tres: suele pedir que tú hagas tu parte.** Muchos SLA solo aplican si repartiste en dos o más zonas. Con todo en una zona, el contrato del proveedor te cubre mucho menos, o nada: el 99.99 % del balanceador de AWS es para uno repartido en dos o más zonas; en una sola, promete 99.9 %.

### La cuenta, con zonas

La disponibilidad real se calcula, pieza por pieza, con las reglas de la lección de probabilidad. Estos son los números que usa Alba: el balanceador, 99.99 %; el gateway, 99.95 % en cada zona; y Triton, la pieza más frágil, 99.5 % en cada zona. Los porcentajes de cada pieza son supuestos para diseñar; en tu sistema se miden.

Con Triton en dos zonas independientes, el servicio solo se cae si fallan las dos a la vez: 0.005 × 0.005 = 0.005². Una **causa común** tumba las dos zonas al mismo tiempo, como una versión rota que llega a ambas. Mientras dura, la segunda zona no ayuda, así que entra como otra pieza en serie: activa el 0.1 % del tiempo, multiplica por 0.999.

:::formula Disponibilidad con zonas
A_{2z} = 1 − (1 − p)^2
A ≈ A_{2z} × (1 − h)
text{minutos caídos} = (1 − A) × M
- p: la disponibilidad de una pieza en una zona, como fracción (Triton: 0.995)
- A_{2z}: la de esa pieza en dos zonas independientes: solo se cae si fallan las dos a la vez
- h: la fracción del tiempo en que una causa común tumba las dos zonas juntas (0.001 = 0.1 %)
- A: la disponibilidad que queda
- M: los minutos del mes: 43,200 en 30 días
:::

| Cómo está Triton | Cuenta | Disponibilidad \(A\) | Caído al mes, \((1 − A) × M\) |
|---|---|---|---|
| En una sola zona | \(p\) = 0.995 | 99.5 % | 0.005 × 43,200 ≈ 216 min |
| En dos zonas independientes | \(1 − (1 − p)^2\) = 1 − 0.005² | 99.9975 % | 0.000025 × 43,200 ≈ 1 min |
| Dos zonas, con una causa común el 0.1 % del tiempo | \(A_{2z} × (1 − h)\) = 0.999975 × 0.999 | ≈ 99.90 % | 0.001025 × 43,200 ≈ 44 min |

Y para la cadena completa, en dos zonas, se multiplican las tres piezas en serie: el balanceador (0.9999), el gateway en dos zonas (1 − 0.0005²) y Triton en dos zonas (1 − 0.005²). Da ≈ 99.99 %, unos 5 minutos al mes, si las fallas son independientes; multiplicado por 0.999, ≈ 99.89 %, unos 49 minutos, con esa causa común.

Lee la tabla como un mapa de qué compra cada cosa:

- La segunda zona compra 216 − 1 = **215 minutos al mes**. Es la mejor compra de toda la lección.
- Una tercera zona compraría segundos. Ya no es por disponibilidad: es por costo, como viste en el N+1.
- Los 0.001 × 43,200 ≈ 43 minutos de la causa común, casi siempre un [[deploy]] malo que llega a las dos zonas, no los toca ninguna zona. Es la [[falla-correlacionada|falla correlacionada]], y se ataca cambiando de versión poco a poco: primero en una parte chica del tráfico o en una sola zona, y en el resto solo si ahí salió bien.

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

Entre zonas hay 1 ms y la misma red. Entre regiones hay decenas de milisegundos y casi nada se comparte. Una segunda región te cobra cuatro cosas:

- **Cuota y capacidad, otra vez.** Tu cuota es por región: en la segunda empiezas con la que tengas ahí, que puede ser cero para GPUs. Y que el tipo de GPU exista allá no está garantizado.
- **Datos replicados.** Cada GB que copias a la otra región paga transferencia, ≈ US$0.02 por GB desde `us-east-1`, y luego paga almacenamiento allá.
- **Artefactos que coincidan.** Los artefactos son los archivos que tu sistema necesita para correr: la imagen del contenedor y los pesos del modelo. Tienen que estar en las dos regiones. Y hay sorpresas: un *engine* de TensorRT (el modelo ya optimizado para una GPU concreta) solo sirve en el mismo modelo de GPU. Si en la otra región consigues una GPU distinta, hay que volver a generarlo.
- **Operación doble.** Dos despliegues, dos juegos de alertas, dos redes, dos lugares donde algo puede quedar desactualizado.

### Failover: mover el tráfico

**[[failover|Failover]]** (conmutación por falla) es pasar el tráfico de la copia que falló a la que sigue viva. Entre zonas lo hace el balanceador solo, en segundos o en un minuto según sus health checks, y no te enteras. Entre regiones hay que decidir cómo se mueve el tráfico. Hay tres maneras: por [[dns|DNS]], que cambia a dónde apunta el nombre y tarda de uno a pocos minutos; por una dirección IP que la red lleva sola a la región sana, en segundos; o a mano, cuando lo ordena la persona de guardia (la del equipo a la que le toca atender las emergencias esa semana).

:::profundo Las tres maneras, con sus tiempos
- **Por DNS.** El nombre `api.tienda.com` apunta a la región A. Un [[health-check|health check]] la vigila; si falla, el [[dns|DNS]] empieza a contestar con la dirección de la región B. El detalle es el [[ttl|TTL]]: cada cliente guarda la respuesta vieja durante ese tiempo. Con un health check cada 30 segundos, 3 fallas seguidas para declarar la caída y un TTL de 60 segundos, pasan hasta 90 + 60 = 150 segundos antes de que el último cliente cambie.
- **Por IP *anycast*.** La misma [[direccion-ip|dirección IP]] se anuncia desde varias regiones, y la red lleva cada paquete a la más cercana que esté sana. No depende del TTL: cambia en segundos. Se paga como un servicio aparte.
- **A mano, con un botón.** Una persona de guardia revisa y decide. Suena anticuado, pero la guía de AWS sobre el tema pide cautela con el failover automático entre regiones: un health check que se equivoca puede mandar todo el tráfico a una región que no estaba lista, y convertir un problema chico en uno grande.

:::

Si la segunda región solo espera, el esquema es **activo/pasivo**. Si las dos atienden tráfico todo el tiempo, es **activo/activo**: no hay nada que «prender», pero los datos tienen que escribirse en dos lugares a decenas de milisegundos de distancia, y eso complica todo lo que guarda **estado** (datos que cambian y que hay que recordar, como una base de datos): si las dos regiones aceptan cambios, hay que decidir qué pasa cuando se contradicen.

:::ojo
Una segunda región no te salva de un deploy malo. Si publicas la versión rota en las dos regiones el mismo día, caen las dos: es la misma causa común de antes, ahora más cara. Multi-región solo suma si las regiones reciben los cambios **una por una**.
:::

### Alba no lo necesita

La respuesta de Alba es quedarse en una región, y decirlo es señal de experiencia, no de flojera. El razonamiento:

- El SLO es 99.9 %, y dos zonas lo cumplen.
- Hay un [[fallback]] que no depende de nada de la región: si el modelo no contesta, la vendedora elige la categoría a mano. Nadie deja de publicar.
- Lo que se protege es una sugerencia, no un pago.

Si la región se cae un día entero, ese mes Alba no cumple su SLO, y el negocio lo aceptó de antemano. **IaC** (*infrastructure as code*, infraestructura como código) son archivos que describen todas las máquinas y redes, de modo que se pueden volver a crear en otra región con un comando. En una entrevista de diseño, la frase que lo resume: *«the seller picks the category manually; we would redeploy from IaC if the outage were long»* («la vendedora elige la categoría a mano; si la caída fuera larga, volveríamos a crear todo desde IaC»).

Cambiaría la respuesta si no hubiera fallback, si se pidiera 99.99 %, o si los usuarios estuvieran en varios continentes.

## Recuperación ante desastres: RPO y RTO {Disaster recovery: RPO and RTO}

La **[[recuperacion-desastres|recuperación ante desastres]]** (*disaster recovery*, DR) es el plan para el día en que se pierde algo grande: una región, una cuenta, una base de datos borrada. La pregunta útil no es «¿somos multi-región?». Son dos preguntas:

- **¿Cuánto puedes perder?** Eso es el **[[rpo|RPO]]** (*recovery point objective*, objetivo de punto de recuperación): cuántos datos, medidos en tiempo, aceptas perder. Un RPO de 1 hora dice: «al volver, puede faltar hasta la última hora de datos».
- **¿Cuánto puedes tardar?** Eso es el **[[rto|RTO]]** (*recovery time objective*, objetivo de tiempo de recuperación): cuánto tiempo aceptas estar caído hasta volver a atender.

:::figura regiones-rpo-rto
El RPO mira hacia atrás desde el desastre: lo que se había escrito desde la última copia se pierde. El RTO mira hacia adelante: el tiempo hasta volver a atender. Este desastre perdió 12 horas, pero con una copia cada noche el peor caso es casi 24: ese peor caso es el RPO que puedes prometer.
:::

:::analogia El punto de guardado de un videojuego
Juegas dos horas y se va la luz. Al volver, cargas el último punto de guardado. Lo que habías avanzado desde ese guardado se perdió: eso es el **RPO**. Lo que tardas en prender la consola, cargar el juego y llegar a donde ibas es el **RTO**. Guardar más seguido baja el RPO. Tener la consola ya prendida baja el RTO. Son dos perillas distintas.

**Dónde se rompe:** en el juego hay un solo archivo guardado. Un sistema tiene muchas cosas, cada una con su propio «guardado», y hay que traerlas todas a un punto en el que cuadren entre sí.
:::

### Por artefacto, no por sistema

Un sistema no tiene «un» RPO. Cada cosa que guarda tiene el suyo, porque no todo vale lo mismo ni cuesta lo mismo rehacerlo.

La tabla usa a Alba y dos ejemplos más: un modelo de imágenes médicas que revisa biopsias junto con médicos patólogos, y un servicio que verifica documentos de identidad.

| Qué | Si se pierde… | RPO razonable |
|---|---|---|
| Alba · pesos del modelo y su engine | Se vuelven a generar desde el entrenamiento, en horas | Horas |
| Alba · log de predicciones (cada foto con la categoría que se sugirió) | Se pierde un pedazo del historial para reentrenar | Horas |
| Alba · el código y la configuración | Están en [[git]], fuera de la región | ≈ 0, sin hacer nada |
| Biopsias · resultados del modelo | Se recalculan corriendo el modelo otra vez | Horas (RTO ≈ 1 día) |
| Biopsias · anotaciones de patólogos (lo que marcan a mano en cada imagen) | Trabajo experto que nadie va a repetir: ≈ US$4,000 al mes (supuesto del ejemplo) | ≈ 0 |
| Identidad · documentos ya aceptados | Habría que pedírselos otra vez a cada cliente | ≈ 0 |

La regla que deja la tabla: **lo que se puede recalcular aguanta un RPO flojo; lo que escribió una persona, no.**

El RPO lo fija cada cuánto copias. Si el desastre llega justo antes de la siguiente copia, pierdes el intervalo entero: ese es el peor caso. En promedio pierdes la mitad. **El RPO se promete con el peor caso.**

:::formula Datos en riesgo entre copias
text{peor caso} = r × I
text{promedio} = frac{r × I}{2}
- I: el intervalo entre una copia y la siguiente, en horas
- r: cuánto se escribe por hora: registros, documentos o GB
:::

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

La guía de AWS sobre recuperación ordena los planes en cuatro **[[estrategia-dr|estrategias de DR]]**, de la más barata y lenta a la más cara y rápida. La columna de costo es la cuenta del equipo de Alba para su sistema, cuya infraestructura cuesta ≈ US$1.8k al mes.

| Estrategia | Qué hay en la segunda región | RTO típico | Costo para Alba |
|---|---|---|---|
| **Copia y restauración** (*backup and restore*) | Solo copias de los datos y los artefactos | Horas | Decenas de US$ al mes |
| **Llama piloto** (*pilot light*) | Los datos replicados y lo mínimo creado, pero **apagado** | Decenas de minutos | ≈ US$200 al mes |
| **Espera tibia** (*warm standby*) | Una versión chica del sistema, **encendida** | Minutos | ≈ US$600 al mes |
| **Activo/activo** (*multi-site active/active*) | Todo, atendiendo tráfico | Casi cero | ≈ +US$1.8k al mes |

El nombre *pilot light* viene del calentador de gas: la llama piloto es la flamita que se queda prendida para encender el quemador en cuanto hace falta. En la nube, lo que se queda «prendido» son los datos replicados y lo mínimo creado; las máquinas que atienden están apagadas, y encenderlas tarda minutos, no un instante como el quemador.

La diferencia entre las dos del medio es la que más se pregunta: con *pilot light*, la segunda región **no puede atender** sin que antes prendas las máquinas. Con *warm standby* ya atiende, a capacidad reducida, y solo hay que agrandarla.

Para Alba, un *warm standby* cuesta ≈ US$600 al mes: 600 ÷ 1,829 ≈ 33 % más de factura, todos los meses, para proteger una sugerencia que tiene un plan B gratis.

:::profundo De dónde salen los US$600 del warm standby
:::cuenta Un warm standby para Alba
Una T4 encendida // US$0.526 por hora × 730 horas al mes | 0.526 × 730 | ≈ US$384
Un gateway // la mitad de los ≈ US$248 que Alba paga por sus dos gateways | 248 ÷ 2 | ≈ US$124
El plano de control de Kubernetes // US$0.10 por hora | 0.10 × 730 | ≈ US$73
Un balanceador casi sin tráfico // solo su cargo fijo por hora: ≈ US$0.0225 × 730 | 0.0225 × 730 | ≈ US$16
Total al mes // las cuatro filas de arriba | 384 + 124 + 73 + 16 | **≈ US$600**
Contra la infraestructura de Alba // ≈ US$1,829 al mes | 600 ÷ 1,829 | ≈ 33 %
= Un tercio más de factura, todos los meses, para proteger una sugerencia que tiene un plan B gratis.
:::
:::

Por eso el plan de Alba es el primero de la tabla, y casi gratis: los pesos y las imágenes de contenedor copiados a otra región, el código en git y la infraestructura descrita en archivos. Si la región muere por mucho tiempo, se reconstruye en horas. Mientras tanto, Ana elige la categoría a mano.

## Replicación entre regiones y ensayos {Cross-region replication and game days} [extra]

### Replicar: copiar sin que nadie lo pida

Cualquier estrategia de DR empieza por lo mismo: que los datos ya estén en la otra región. La **[[replicacion-regional|replicación entre regiones]]** (*cross-region replication*) es una regla que le dice a un servicio: «cada cosa nueva que llegue aquí, cópiala allá».

- **En S3**, la regla copia cada objeto nuevo a un bucket de otra región. Es **asíncrona**: tu `PUT` (la request que sube el objeto) termina primero y la copia viaja después. La mayoría de los objetos llega en menos de 15 minutos, pero sin garantía: uno grande puede tardar horas. Con la opción *Replication Time Control* (RTC), la mayoría llega en segundos; AWS la diseña para replicar el 99.99 % de los objetos nuevos en menos de 15 minutos, y en su SLA se compromete al 99.9 %.
- **En el registro de imágenes** (ECR, donde viven las imágenes de contenedor), otra regla copia cada imagen nueva. Sin ella, el día del desastre la otra región no tiene qué correr.
- **En una base de datos**, una réplica en otra región recibe los cambios con segundos de atraso. Es la [[replica-lectura|réplica de lectura]] que ya conoces, más lejos.

Que sea asíncrona define tu RPO. Lo que estaba «en camino» cuando cayó la región se pierde.

:::diagrama regiones-dr
Una región primaria y una de respaldo en *warm standby*. Usa «Recorrer» para ver un día normal, el día del desastre y qué cambia con *pilot light*.
:::

Toma el servicio que verifica documentos de identidad, el de la tabla de RPO. Replica con RTC. ¿Cuántos documentos puede perder? Es la fórmula de los datos en riesgo, con \(I\) = 15 minutos:

:::cuenta Documentos de identidad: cuántos quedan en riesgo con RTC
Documentos por hora // supuesto del ejemplo: 5,000 al día, en 14 horas hábiles | 5,000 ÷ 14 | ≈ 357 por hora
En la hora pico, \(r\) // el doble | 2 × 357 | ≈ 714 por hora
Intervalo \(I\) // la ventana que promete RTC: 15 minutos | 15 ÷ 60 | 0.25 horas
Peor caso // lo escrito en esa ventana | \(r × I\) = 714 × 0.25 | **≈ 180 documentos**
= En el peor caso, a ≈ 180 clientes habría que pedirles su identificación otra vez. El negocio decide si lo acepta o si escribe en las dos regiones antes de responder.
:::

Replicar cuesta, y la cuenta dice qué vale la pena. Los pesos de Alba son ≈ 98 MB por versión: replicarlos cuesta centavos. Sus fotos son 2 TB al día: 2 × 30.4 días ≈ 61 TB al mes, y 61,000 GB × US$0.02 por GB ≈ **US$1,200 al mes** solo de transferencia, más guardarlas dos veces. Alba replica los pesos, no las fotos.

:::ojo
**Replicar no es respaldar.** La replicación copia todo, también los errores. Si un script sobrescribe los pesos con un archivo corrupto, la copia de la otra región queda corrupta segundos después. Contra eso hay que guardar el pasado: versiones del bucket o un [[snapshot]], con su [[retencion|retención]]. Una copia en otra región protege del lugar; las versiones protegen de ti.
:::

### El ensayo: game day

Un plan de DR escrito y nunca probado tiene un problema: nadie sabe si funciona. Por eso se dice sin vueltas: *un DR que no se ensayó no existe*.

Un **[[game-day|game day]]** es un ensayo programado: se provoca la falla a propósito, en un día y hora acordados, con el equipo mirando. Se apaga una zona, o se corta el acceso a la región primaria, y se ejecuta el plan de verdad.

:::pasos
1. Se escribe qué se espera
«Al apagar la zona 1b, los errores suben durante menos de un minuto y la T4 de 1a llega a ≈ 42 %.» Ese 42 % sale de 500 ÷ 1,200: el pico de diseño de Alba sobre lo que aguanta una T4.
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

## Cómo elegir región {How to choose a region} [extra]

Para elegir región hay cuatro preguntas, **en este orden**. El orden importa: una pregunta de arriba puede dejarte sin opciones antes de llegar a las de abajo.

### 1. ¿Dónde tienen que estar los datos?

La **[[residencia-datos|residencia de datos]]** (*data residency*) es la obligación, por ley o por contrato, de guardar o procesar ciertos datos solo dentro de un país o de una región. Un hospital puede tener prohibido sacar expedientes del país. Un banco puede haber firmado con su regulador en qué región opera.

Esto no lo decide ingeniería: lo decide el área legal. Y va primero porque no se negocia con milisegundos. En un servicio que verifica documentos de identidad, el diseño empieza con «cuenta y región aprobadas por legal».

Ojo con lo que cuenta como «dato que sale»: no solo la base de datos. También las copias de respaldo, los logs que traen datos de personas y el [[prompt]] que le mandas a un modelo de lenguaje ([[llm|LLM]]) alojado en otra región.

### 2. ¿Están ahí las máquinas y los servicios que necesitas?

El catálogo cambia por región. Las GPUs nuevas llegan primero a unas pocas, y los servicios de ML, también. Un ejemplo: en octubre de 2026, la tabla oficial de GPUs por zona de Google Cloud no listaba su región de Querétaro. Una región cercana y legalmente perfecta puede no tener con qué correr tu modelo.

Lo mismo pasa con los modelos de lenguaje que se rentan por API: cada modelo está disponible en ciertas regiones, y hay que revisarlo antes de prometer que «el prompt no sale del país».

:::profundo Tres razones por las que falta una GPU
Cuando pides una GPU y la nube dice que no, hay tres causas distintas, con remedios distintos. La lección de máquinas las desarrolla:

- **Cuota:** tu cuenta no tiene permiso para tantas en esa región. Es un trámite: se pide el aumento, y tarda. Alba necesita cuota para 28 [[vcpu|vCPU]] de máquinas con GPU, contando pruebas y repuestos.
- **Capacidad:** tienes permiso, pero en esa zona, en este momento, no quedan. Remedio: aceptar más zonas y más tipos de máquina, o reservar ([[reserva-capacidad]]).
- **Catálogo:** esa región no ofrece esa GPU. No hay trámite que lo arregle.
:::

### 3. ¿Qué tan lejos queda de quien te llama?

Con las regiones que pasaron los dos filtros, haz la cuenta de distancia de la primera sección. Recuerda que cuenta quién **llama** a tu servicio y dónde están los datos que lee. Para un agente de voz (un programa que platica contigo por teléfono), donde cada 100 ms se sienten en la conversación, esta pregunta pesa mucho. Para un trabajo por lotes (*batch job*) que procesa muchos datos de noche, sin nadie esperando la respuesta, casi nada.

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

**Cómo evitarlo:** además de replicar, guarda versiones o snapshots por un tiempo. Y prueba restaurar uno.

### Dejar que las llamadas crucen de zona

**Qué pasa:** el sistema está bien repartido en dos zonas, pero cada llamada interna cae en cualquier zona. La mitad del tráfico cruza, y a fin de mes aparece una línea de red más grande que la de las GPUs.

**Cómo evitarlo:** ruteo por zona desde el primer día, con las capas repartidas parejo.

## En la vida real {In real life} [extra]

**Alba · Clasificación de fotos.** Una región (`us-east-1`), dos zonas, una T4 por zona, ruteo por zona desde el día 1 y un fallback manual. Sin segunda región: el *warm standby* costaría ≈ US$600 al mes, 33 % más, para proteger una sugerencia. Su DR es copiar los pesos y reconstruir desde archivos.

**Servir un LLM propio.** Un servicio que corre su propio modelo grande de lenguaje usa tres zonas de `us-east-1`. Con GPUs grandes, que escasean, más zonas son también más lugares donde puede aparecer una libre. Y tener cuota no garantiza conseguir esas GPUs el día que las pides.

**Imágenes médicas · Patología digital.** El mismo sistema, dos RPO. Los resultados del modelo se recalculan: RPO de horas y RTO de un día. Las anotaciones de los patólogos son trabajo experto: RPO ≈ 0, replicadas en cuanto se escriben.

**Documentos · Verificación de identidad.** La región la eligió el área legal antes que ingeniería. Los documentos aceptados no se pueden perder: con replicación de 15 minutos quedan ≈ 180 en riesgo en el peor caso, y ese número se lleva a la mesa.

**Video en tiempo real · Cámaras en centros de distribución.** Un sistema que analiza el video de varias cámaras en tiempo real. Aquí el «dominio de falla» no es una zona de la nube: es cada uno de los 25 centros (supuesto del ejemplo), con su cámara, su caja de cómputo y su enlace a internet. La meta es 99.5 % de alertas **por sitio**, y el diseño supone que el enlace a la nube se cae: cada sitio tiene que seguir alertando solo.

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
- Con \(RTT_{min} = 2 × d ÷ v\), \(d\) = 4,000 km y \(v\) = 200 km por ms: ida 4,000 ÷ 200 = 20 ms; RTT mínimo 2 × 20 = **40 ms**.
- Realista, \(RTT ≈ f × RTT_{min}\) con \(f\) ≈ 2: 2 × 40 = **≈ 80 ms**.
- Conexión nueva, \(t_{red} = k × RTT\) con \(k\) = 3: 3 × 80 = **≈ 240 ms** antes de empezar. Reusar la conexión lo baja a una sola vuelta.
? [facil] Una zona estuvo caída 3 horas en todo un año, y tu servicio vivía solo en ella. ¿Qué disponibilidad tuvo en el año? ¿Y en el mes de la caída? ¿Cuántos presupuestos de error de un SLO de 99.9 % mensual se gastó?
- La ecuación: \(A = 1 − t_{caído} ÷ text{tiempo de la ventana}\), los dos en la misma unidad.
- Un año tiene 365 × 24 = 8,760 horas. Año: 1 − 3 ÷ 8,760 ≈ **99.966 %**. Suena bien.
- Mes de la caída, con \(t_{caído}\) = 3 × 60 = 180 minutos y \(M\) = 43,200: 1 − 180 ÷ 43,200 ≈ **99.58 %**. No cumple 99.9 %.
- Presupuesto, \(E = 0.001 × M\) = 43.2 minutos: 180 ÷ 43.2 ≈ **4.2 presupuestos** en una tarde.
- La misma caída se ve muy distinta según la ventana. Di siempre en cuánto tiempo se mide.
? [facil] Un sistema copia su base de datos cada noche a las 02:00. Un martes a las 17:00 se pierde la base. Restaurar la copia tarda 3 horas. ¿Cuántas horas de datos se perdieron? ¿Qué RPO puede prometer este esquema? ¿Y qué RTO, como mínimo?
- Se perdió lo escrito entre las 02:00 y las 17:00: 17 − 2 = **15 horas** de datos.
- El RPO se promete con el peor caso, que es el intervalo \(I\) entero: con \(I\) = 24 horas, un desastre a la 01:59 pierde casi **24 horas**.
- RTO: al menos **3 horas**, más lo que se tarde en notar la falla y decidir restaurar.
? [medio] Un servicio tiene un pico de 3,000 requests por segundo. Cada réplica aguanta 400 al máximo, y no quieres pasar de 70 % ni con una zona caída. ¿Cuántas réplicas necesitas con 2 zonas? ¿Y con 3? Si cada réplica cuesta US$124 al mes, ¿cuánto ahorra la tercera zona?
- La ecuación: \(R_z = ⌈P ÷ ((Z − 1) × c × u)⌉\) y \(R = Z × R_z\), con \(P\) = 3,000, \(c\) = 400 y \(u\) = 0.70.
- Cada réplica, al tope: \(c × u\) = 0.70 × 400 = 280 por segundo.
- Dos zonas (\(Z − 1\) = 1): una sola tiene que aguantar todo. 3,000 ÷ (1 × 280) = 10.7 → 11 por zona; \(R\) = 2 × 11 = **22 en total**.
- Tres zonas (\(Z − 1\) = 2): las dos que quedan aguantan todo. 3,000 ÷ (2 × 280) = 5.4 → 6 por zona; \(R\) = 3 × 6 = **18 en total**.
- Ahorro: (22 − 18) × 124 = **US$496 al mes**. Sin pensar en zonas bastarían 3,000 ÷ 280 = 10.7 → 11.
? [medio] Un failover por DNS: el health check corre cada 10 segundos y declara la caída a las 3 fallas; el TTL es de 60 segundos. La región de respaldo es un *warm standby* que tarda 4 minutos en crecer hasta aguantar todo el tráfico. ¿Cuánto pasa hasta que el último cliente llega a la región nueva? ¿Cuál es el RTO aproximado? Si esto pasa una vez en un mes, ¿qué disponibilidad queda?
- La ecuación: \(t_{cambio} = text{fallas} × text{intervalo del check} + TTL\), lo que tarda el último cliente en cambiar de región.
- Detección: 3 × 10 = 30 s. Más el TTL: 30 + 60 = **90 segundos** para el último cliente.
- Hasta atender todo el tráfico: 90 s + 4 × 60 s = 90 + 240 = 330 s, y 330 ÷ 60 ≈ **5.5 minutos** de RTO.
- Disponibilidad del mes, \(A = 1 − t_{caído} ÷ M\): 1 − 5.5 ÷ 43,200 ≈ **99.987 %**. Cumple 99.9 %, no 99.99 %.
- Un SLO de 99.99 % deja \(E\) = 0.0001 × 43,200 ≈ 4.3 minutos al mes. Para cumplirlo habría que tener la segunda región ya a tamaño completo: activo/activo.
? [medio] Un sistema escribe 500 GB nuevos al día y los replica a otra región, donde los guarda 30 días. La transferencia cuesta US$0.02 por GB y guardar, US$0.023 por GB al mes. ¿Cuánto cuesta al mes? Si la replicación garantiza 15 minutos, ¿cuántos GB quedan en riesgo, suponiendo que se escribe parejo todo el día?
- La ecuación del costo: GB al mes × precio por GB, para la transferencia y para el guardado.
- Al mes: 500 × 30 = 15,000 GB.
- Transferencia: 15,000 × 0.02 = **US$300**.
- Guardado en la segunda región (30 días, así que siempre hay ≈ 15,000 GB guardados): 15,000 × 0.023 = **US$345**.
- Total: 300 + 345 = **US$645 al mes**.
- En riesgo, \(r × I\): por hora se escriben \(r\) = 500 ÷ 24 ≈ 20.8 GB, y \(I\) = 15 minutos = 0.25 horas. Entonces 20.8 × 0.25 ≈ **5.2 GB**.
? [reto] Un equipo etiqueta 2,000 imágenes al día, en 8 horas, a US$0.50 cada una. Las etiquetas viven en una base de datos. Compara tres planes: (a) una copia cada 24 horas, gratis; (b) una copia cada hora, gratis; (c) replicación continua a otra región, US$40 al mes. Supón un desastre cada 5 años. Para cada plan: el peor caso, la pérdida promedio por desastre y la pérdida esperada al año. ¿Cuál eliges? ¿Qué cambiaría si quienes etiquetan fueran patólogos?
- Las ecuaciones: peor caso = lo etiquetado en un intervalo × US$0.50; promedio = la mitad; esperado al año = promedio × desastres por año (1 cada 5 años = 1⁄5).
- (a) Peor caso: un día, 2,000 × 0.50 = US$1,000. Promedio: la mitad, US$500. Esperado al año: 500 × 1⁄5 = **US$100**.
- (b) En una hora se etiquetan \(r\) = 2,000 ÷ 8 = 250. Peor caso: 250 × 0.50 = US$125. Promedio: 125 ÷ 2 = US$62.50. Esperado al año: 62.50 × 1⁄5 = **US$12.50**.
- (c) Pérdida ≈ 0, pero cuesta 40 × 12 = **US$480 al año**.
- Gana **(b)**: casi toda la protección, sin costo. Respecto a (b), la replicación ahorra US$12.50 al año y cuesta US$480: 480 ÷ 12.5 ≈ 38 veces más de lo que ahorra.
- Con patólogos cambia el precio de rehacer (trabajo experto, que además retrasa a pacientes) y deja de ser una cuenta de promedios: ahí se justifica (c), un RPO ≈ 0.
? [reto] La cadena de Alba en dos zonas pierde ≈ 5 minutos al mes por fallas independientes y ≈ 43 por deploys malos que llegan a las dos zonas. Supón además que la región se cae 6 horas una vez cada 4 años. (a) ¿Cuántos minutos al mes pone la región, en promedio? (b) ¿Cuánto suma todo, y cumple 99.9 %? (c) Tienes dinero para una sola mejora: un *warm standby* (US$600 al mes) o cambiar de versión poco a poco, que evita 9 de cada 10 deploys malos. ¿Cuál eliges?
- La ecuación: minutos al mes en promedio = minutos de cada caída ÷ meses entre caídas.
- (a) 6 horas son 6 × 60 = 360 minutos, y 4 años son 4 × 12 = 48 meses: 360 ÷ 48 = **7.5 minutos al mes** en promedio.
- (b) Independientes + deploys + región: 5 + 43 + 7.5 = 55.5 ≈ **56 minutos**. No cumple: el presupuesto es \(E\) = 0.001 × 43,200 = 43.2.
- (c) El *warm standby* quita, cuando mucho, los 7.5 de la región: quedan 5 + 43 = 48, y sigue sin cumplir. Los cambios poco a poco evitan 9 de cada 10 deploys malos, así que los 43 bajan a 43 × 0.1 ≈ 4: quedan 5 + 4 + 7.5 ≈ **17 minutos**. Cumple, y cuesta mucho menos.
- La región es el dominio que más asusta, pero aquí es el que menos minutos pone. Ataca primero la fuente más grande.
? [reto] Diseña la ubicación de un agente de voz para un banco mexicano. Datos: los audios traen datos personales y el contrato exige que se procesen en México; el modelo necesita una GPU; en una conversación, cada 100 ms de más se notan. Tienes tres opciones: una región en México, `us-east-1` (≈ 60 ms de RTT desde la Ciudad de México) y São Paulo (≈ 150 ms). Decide con las cuatro preguntas en orden y di qué tendrías que verificar antes de comprometerte.
- **Residencia:** el contrato deja solo la región en México. `us-east-1` y São Paulo quedan fuera en la primera pregunta, sin mirar latencia ni precio.
- **Catálogo:** hay que verificar, en la lista oficial y zona por zona, que la región en México ofrezca la GPU, y pedir la cuota **antes** de prometer fechas. Si no la ofrece: otro proveedor con GPUs en el país, máquinas propias, o renegociar el contrato con legal. No es decisión de ingeniería.
- **Latencia:** dentro de México, ≈ 4 ms de RTT. De sobra. São Paulo, además de no cumplir el contrato, era la peor: 150 ms por vuelta.
- **Precio:** se acepta el que haya.
- **Zonas:** dos o tres dentro de esa región, con N+1 por zona. Una segunda región en México puede no existir: el plan de DR se discute con el banco, con un RPO y un RTO escritos.
:::

## Lo que sigue {What comes next} [extra]

La siguiente lección, «Máquinas, GPUs y cómo se cobran», explica qué es exactamente una `g4dn.xlarge`, cómo se cobra y por qué a veces no hay. Después, «Redes en la nube» le pone precio a cada GB que cruza de zona o de región, y «Servicios gestionados, serverless y permisos» explica qué opera el proveedor por ti y qué cubre de verdad el SLA de cada servicio.

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
? Alba necesita una sola T4 para su tráfico. ¿Por qué tiene dos, y por qué en zonas distintas?
Por disponibilidad: es un N+1 por zona. Si cae una zona, la otra aguanta el pico de 500 fotos por segundo sola, al 500 ÷ 1,200 ≈ 42 % de su máximo. En la misma zona caerían juntas.
? ¿Qué promete un SLA del proveedor?
Créditos en la factura si un servicio suyo baja de cierto porcentaje. No promete que no se caiga, y no cubre tu cadena completa.
? ¿Qué preguntan el RPO y el RTO?
RPO: cuántos datos, en tiempo, aceptas perder. RTO: cuánto tiempo aceptas estar caído hasta volver a atender.
? ¿Por qué Alba no usa una segunda región?
Porque su SLO de 99.9 % se cumple con dos zonas y tiene un fallback manual que no depende de la región. Un *warm standby* costaría ≈ US$600 al mes, 600 ÷ 1,829 ≈ 33 % más, para proteger una sugerencia.
? ¿En qué orden se elige una región?
Residencia de datos, catálogo (GPUs y servicios), latencia a quien llama y, al final, precio.
:::
