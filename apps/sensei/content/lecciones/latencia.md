---
titulo: Qué tan rápido y cuánto: latencia y throughput
en: How fast and how much: latency and throughput
subtitulo: Por qué la misma foto pasa 8 ms en un pod del gateway un martes en la tarde y 60 en un pico: dónde se va el tiempo de una request, cómo crece la fila cuando un servidor se llena, cuánta capacidad se compra, cómo se le pone tope a una fila y cómo se mide todo sin engañarte.
pregunta: ¿Por qué el gateway de Alba contesta rápido con poco tráfico y lento cerca del pico, si cada request hace el mismo trabajo?
requisitos: percentiles, async, fallas-red
---

:::idea
La latencia de una request es viajar, esperar y trabajar. El trabajo casi no cambia con el tráfico; la espera sí: en una fila crece como 1 ÷ (1 − ρ), donde ρ es la fracción del tiempo en que el servidor está ocupado, y se dispara cerca del 100 %. Por eso se planea con margen, se le pone tope a cada fila y la capacidad se mide con pruebas de carga, como el throughput más alto que todavía cumple la promesa.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Su **gateway**, el programa que recibe cada foto, la prepara y se la pasa al modelo, contesta ≈ 10 millones de fotos al día: ≈ 116 por segundo en promedio y 500 en el pico de diseño, el tráfico para el que se compran las máquinas. Cada foto pide el mismo trabajo: ≈ 6 [[ms]] de CPU para decodificarla y prepararla, y unos milisegundos de GPU para el modelo. Un martes a las 4 de la tarde, la foto pasa ≈ 8 ms en el *pod* (cada copia del gateway en Kubernetes). En un pico que llega antes de que haya más pods, pasa 60, y su [[p99]] supera los 250. Nadie cambió el código, la foto ni la máquina.

Ya tienes las piezas sueltas. La [[latencia]] es cuánto tarda una request; el [[throughput]], cuántas termina el sistema por segundo, y los [[qps|QPS]], cuántas llegan. La [[ley-little|Ley de Little]] dice cuántas hay adentro a la vez; el p99 y el [[slo|SLO]], cómo se escribe la promesa, y los [[timeout|timeouts]], cuándo rendirse.

Esta lección las junta. Vas a desarmar la latencia en sus partes, ver por qué la espera explota cuando un servidor se llena, decidir cuántas máquinas comprar, ponerle tope a una fila y medir todo sin que la prueba te mienta.

## Dónde se va el tiempo: la latencia de punta a punta {Where the time goes: end-to-end latency}

La [[latencia-punta-a-punta|latencia de punta a punta]] (*end-to-end latency*) es el tiempo total de una request entre dos puntos que tú nombras, sumando todo lo que pasa en medio. «Punta a punta» no dice nada si no dices cuáles puntas.

En Alba están escritas en su SLO, p99 ≤ 200 ms, como viste en la lección de percentiles: el reloj arranca cuando el [[balanceador]] de carga (la puerta que reparte las requests entre los pods) tiene la request completa y para cuando sale la respuesta. Es una medida del lado del servidor (*server-side*). La subida de la foto desde el celular de Ana, por 4G, queda fuera: depende de su señal, no del servicio.

### Tres maneras de gastar el tiempo

Entre esas dos puntas, la request da varios saltos: del balanceador al gateway, del gateway a Triton (el servidor que corre el modelo en la GPU) y de vuelta. En cada salto, el tiempo se va en una de tres cosas:

- **Viajar.** Los bytes cruzan la red. Cada mensaje viaja en [[paquete-red|paquetes]], y una ida y vuelta, el [[rtt|RTT]] (*round-trip time*), cuesta poco dentro de la misma *zona* y mucho más a otra ciudad. Una zona es un centro de datos de la nube, o un grupo de ellos muy cercanos, con su propia luz y su propia red; lo verás a fondo en la lección de regiones. Abrir una conexión nueva cuesta un [[handshake]], un saludo de idas y vueltas antes del primer byte útil; por eso el gateway de Alba reusa conexiones abiertas ([[keep-alive]]). Lo viste en las lecciones de red y de HTTP.
- **Esperar.** La request ya llegó, pero el recurso que necesita está ocupado con otras. Espera su turno en una fila.
- **Trabajar.** Un recurso le dedica su tiempo: la CPU decodifica la foto, la GPU corre la ResNet-50.

El equipo de Alba estima el camino típico tramo por tramo. Esta es una request ilustrativa, dentro de sus rangos, a una hora tranquila:

:::cuenta La foto de Ana con poco tráfico, salto por salto
Entrada // viajar: el balanceador y leer los ≈ 200 KB de la foto | red | 3 ms
Fila del gateway // esperar un lugar de CPU: está libre | fila | 0 ms
Preproceso // trabajar: decode, resize, crop, normalizar | CPU | 6 ms
Viaje a Triton // viajar: el tensor de 602 KB, a la GPU de su misma zona | red | 3 ms
Fila de Triton // Triton espera hasta 2 ms por otras fotos para correrlas juntas en un [[batch]]: casi nunca llega nadie | fila | 2 ms
Modelo // trabajar: la ResNet-50 en la T4 | GPU | 4 ms
Vuelta // viajar: los logits de regreso al gateway | red | 1 ms
Salida // trabajar: softmax, top-5 y el JSON de la respuesta | CPU | 1 ms
Por tipo // viajar: entrada + viaje + vuelta = 3 + 3 + 1 = 7 · esperar: fila del gateway + fila de Triton = 0 + 2 = 2 · trabajar: preproceso + modelo + salida = 6 + 4 + 1 = 11 | 7 + 2 + 11 | 20 ms
= Con poco tráfico, casi todo es viaje y trabajo, y la única espera es esa ventana de 2 ms (la sección de batching la explica). El modelo en la GPU son 4 de 20 ms; la CPU trabaja 6 + 1 = 7, casi todo en el decode. Son los 18 a 20 ms de una request típica que viste en la lección de async.
:::

:::diagrama latencia-alba
Toca cada caja para ver qué tiempo gasta ahí la request, o usa «Recorrer» para seguir la misma foto con poco tráfico y cerca del pico.
:::

:::profundo La red también tiene cola
Casi siempre, la red de adentro del centro de datos aporta poco y parejo. Pero tiene sus sorpresas. Si un paquete se pierde y los acuses que sí llegan no delatan el hueco, [[tcp|TCP]] espera su tiempo de reenvío antes de volver a mandarlo, y en Linux ese tiempo es de 200 ms como mínimo (lo viste en la lección de red): una request de 30 ms se vuelve de 230 sin que nadie haya hecho nada mal. Una conexión nueva paga su handshake. Y un salto a otra zona suma ida y vuelta. Son pocas requests, y justo por eso viven en la [[cola-distribucion|cola de la distribución]], donde mira el p99.
:::

### Medir cada tramo

La regla práctica: mide cada tramo por separado. El gateway de Alba lleva un histograma para el preproceso y otro para la llamada a Triton. Si la latencia sube y solo crece uno, ya sabes dónde buscar. La suma de los p99 de los tramos sirve para repartir el presupuesto, pero no da el p99 total: eso se mide de punta a punta, como viste en la lección de percentiles.

Fíjate en la columna que casi no aparece. Con poco tráfico, «esperar» vale solo la ventana de Triton. Cerca del pico es la única que crece. La siguiente sección la abre.

## Esperar turno: tiempo de servicio y tiempo en cola {Waiting your turn: service time and queueing time}

El tiempo que un recurso trabaja de verdad en una request es su [[tiempo-servicio|tiempo de servicio]] (*service time*), que en las fórmulas se escribe **S**. En el gateway de Alba, ≈ 6 ms de CPU por foto (con el ≈ 1 ms de armar la respuesta son 7, pero el equipo de Alba redondea a 6 en sus cuentas de capacidad, y aquí también); en la T4, de 3 a 6 ms por batch chico. Se baja con mejor hardware o con menos trabajo: el *draft mode* de JPEG (decodificar la foto ya achicada), un modelo en FP16, mandar menos bytes.

El tiempo que la request pasa esperando a que ese recurso se desocupe es su [[tiempo-en-cola|tiempo en cola]] (*queueing time* o *queueing delay*). No se baja optimizando el código: se baja con más capacidad o con llegadas más parejas.

Su suma es lo que la request vive en ese tramo: \(W = W_q + S\), donde \(W_q\) es la espera en la fila (la *q* es de *queue*, fila). Es la misma \(W\) de la Ley de Little: el tiempo que pasa adentro.

### Una fila, a mano

Un pod con un solo núcleo y 6 ms de CPU por foto. Le llegan 5 fotos en 30 ms. Primero, llegan parejas, una cada 7.5 ms: cuando llega cada una, la anterior ya terminó. Nadie espera, y las cinco tardan 6 ms.

Ahora llegan las mismas cinco, pero tres casi juntas. La regla de una fila es simple: cada request empieza cuando llega o cuando el núcleo se desocupa, lo que pase **después**. Con letras:

:::formula La regla de una fila
b_i = max(a_i, f_{i−1})
f_i = b_i + S
W_i = f_i − a_i = (b_i − a_i) + S
- i: el número de la request, en orden de llegada (A es la 1, B la 2…)
- a_i: cuándo llega la request \(i\), en ms
- b_i: cuándo el núcleo empieza a trabajarla, en ms: cuando llega o cuando el núcleo se desocupa, lo que pase después
- f_i: cuándo termina, en ms; \(f_{i−1}\) es cuándo termina la anterior
- S: el tiempo de servicio, igual para todas: 6 ms
- W_i: la latencia de la request \(i\): su espera \(b_i − a_i\) más su servicio
:::

:::cuenta Cinco fotos que llegan en ráfaga (S = 6 ms)
A llega en \(a_1\) = 0 ms // el núcleo está libre | \(b_1\) = 0 → \(f_1\) = 0 + 6 = 6 · \(W_1\) = (0 − 0) + 6 | 6 ms
B llega en \(a_2\) = 2 ms // el núcleo está con A hasta \(f_1\) = 6 | \(b_2\) = max(2, 6) = 6 → \(f_2\) = 12 · \(W_2\) = (6 − 2) + 6 | 10 ms
C llega en \(a_3\) = 4 ms // detrás de A y de B | \(b_3\) = max(4, 12) = 12 → \(f_3\) = 18 · \(W_3\) = (12 − 4) + 6 | 14 ms
D llega en \(a_4\) = 14 ms // C ocupa el núcleo hasta \(f_3\) = 18 | \(b_4\) = max(14, 18) = 18 → \(f_4\) = 24 · \(W_4\) = (18 − 14) + 6 | 10 ms
E llega en \(a_5\) = 30 ms // el núcleo descansa desde \(f_4\) = 24 | \(b_5\) = max(30, 24) = 30 → \(f_5\) = 36 · \(W_5\) = (30 − 30) + 6 | 6 ms
Promedio \(W\) // \((W_1 + W_2 + W_3 + W_4 + W_5) ÷ 5\) | (6 + 10 + 14 + 10 + 6) ÷ 5 = 46 ÷ 5 | 9.2 ms
= Cada latencia es espera + servicio. El mismo trabajo para las cinco, 6 ms, y latencias de 6 a 14 ms: la diferencia es pura espera, porque llegaron juntas.
:::

:::figura latencia-fila
Las mismas cinco fotos y el mismo núcleo, que en los dos casos trabaja 30 de los 36 ms. Arriba llegan parejas y nadie espera. Abajo llegan en ráfaga: B, C y D esperan, y C tarda más del doble que A.
:::

En la vida real nadie se pone de acuerdo para llegar parejo. Las requests llegan al azar, como viste con [[poisson|Poisson]] en la lección de probabilidad: en ventanas de 10 ms con 5 llegadas en promedio, ≈ 3 % de las ventanas trae 10 o más. **Siempre hay ráfagas**, y cada ráfaga deja una fila. Por eso aparece la espera aunque el servidor no esté lleno.

:::analogia La caja del súper
La cajera es el servidor. Cobrar tus cosas es el tiempo de servicio; la fila, el tiempo en cola. Si llegan tres carritos juntos, el tercero espera a los otros dos, aunque la cajera cobre igual de rápido. Y si la cajera pasa la mitad del día sin nadie, cualquier fila se deshace pronto; si nunca descansa, la fila de las 6 de la tarde sigue ahí a las 7.

**Dónde se rompe:** en el súper ves la fila y te cambias de caja; una request no ve nada y espera donde la mandaron. Una cajera se apura cuando la fila es larga; un núcleo no. Y la request tiene prisa de verdad: si espera demasiado, quien la pidió ya se fue por su [[timeout]], y todo el trabajo que se le haga es para nadie.
:::

Dicho en una frase: el mismo modelo, en el mismo hardware, puede responder en 10 ms o en 200 ms según qué tan cargado esté. El servicio no cambió. Cambió la fila. ¿Cuánto crece? Depende de una sola cantidad.

## Utilización: la curva que explota cerca del 100 % {Utilization: the curve that explodes near 100 %}

La [[utilizacion|utilización]] (*utilization*) es la fracción del tiempo en que un servidor está ocupado. Se escribe ρ (la letra griega rho) y se calcula con lo que llega y lo que tarda cada una:

:::formula Utilización
ρ = frac{λ × S}{c}
- ρ: la utilización: la fracción del tiempo en que cada servidor está ocupado (0.6 = 60 %)
- λ: la letra griega lambda: la [[tasa]] de llegada, en requests por segundo
- S: el tiempo de servicio de cada request, en segundos (6 ms = 0.006 s), para que \(λ × S\) quede sin unidades
- c: cuántos servidores atienden la misma fila (núcleos, GPUs, réplicas)
:::

Es una cuenta de horas de trabajo: cada segundo llegan \(λ × S\) segundos de trabajo, para \(c\) servidores.

- Un pod del gateway en el pico de diseño: \(λ\) = 500 ÷ 5 pods = 100 requests por segundo, \(S\) = 0.006 s y \(c\) = 1 [[vcpu|vCPU]] (el que tiene reservado cada pod). \(ρ\) = 100 × 0.006 ÷ 1 = **0.6**: ese vCPU trabaja 60 % del tiempo.
- Los 5 pods juntos: \(λ\) = 500 y \(c\) = 5, así que \(ρ\) = 500 × 0.006 ÷ 5 = 0.6 también. Son 500 × 0.006 = 3 vCPU ocupados de 5.
- Una T4: \(λ\) = 500 fotos por segundo ÷ 2 GPUs = 250, y \(c\) = 1. Una prueba de carga midió que procesa hasta ≈ 1,200 fotos por segundo antes de que su latencia se dispare (la sección de capacidad lo explica). Es como si cada foto le costara \(S\) = 1 ÷ 1,200 de segundo, así que \(ρ\) = 250 × (1 ÷ 1,200) = 250 ÷ 1,200 ≈ **21 %**.

:::ojo
Esta utilización no es la que muestra `nvidia-smi`. La [[utilizacion-gpu|utilización de GPU]] mide el tiempo con *algún* [[kernel-gpu|kernel]] corriendo, y puede marcar 30 % con batches de 1 cuando la GPU daría varias veces más (lección «CPU y GPU»). La ρ de las colas es trabajo que llega contra capacidad: es la que decide cuánto se espera.
:::

Si ρ llega a 1, llega tanto trabajo como el servidor puede hacer. Si lo pasa, la fila crece sin fin: lo viste en la lección de async, con los pedazos de audio de un servicio de voz a texto en tiempo real (subtítulos en vivo), que se atrasaban dos minutos en diez. Pero la sorpresa no está en el 100 %: está antes.

### La teoría de colas, en una fórmula

La [[teoria-colas|teoría de colas]] (*queueing theory*) es la parte de las matemáticas que calcula cuánto se espera en una fila. Su modelo más simple se llama **M/M/1**: llegadas al azar (Poisson), tiempos de servicio al azar (la mayoría cortos y unos pocos largos), **un** servidor y una fila en orden de llegada. El nombre se lee por partes: la primera letra dice cómo llegan las requests, la segunda cómo es el servicio y el número cuántos servidores hay. La M (de Markov, un matemático ruso) quiere decir «al azar y sin memoria»: lo que tardó la anterior no dice nada de la siguiente. Con esos supuestos, el tiempo promedio que pasa cada request en el sistema, la espera en la fila y el p99 salen así:

:::formula Fila M/M/1
W = frac{S}{1 − ρ}
W_q = W − S = frac{ρ × S}{1 − ρ}
text{p99} ≈ W × ln(100) ≈ 4.6 × W
- S: el tiempo de servicio promedio de cada request, en ms
- ρ: la utilización del servidor, \(λ × S\) (aquí \(c\) = 1); tiene que ser menor que 1
- W: el tiempo promedio que pasa cada request en el sistema, fila más servicio, en ms
- W_q: la espera promedio en la fila, en ms: lo que no es trabajo
- text{p99}: el p99 del tiempo en el sistema, en ms; ln es el [[logaritmo]] natural (el párrafo bajo la tabla dice de dónde sale)
:::

El divisor es la clave: \(1 − ρ\) es el tiempo **libre** del servidor. Cuando se acerca a cero, la espera se dispara.

Con \(S\) = 6 ms, el del gateway:

| Utilización \(ρ\) | Tiempo libre \(1 − ρ\) | \(W = 6 ÷ (1 − ρ)\) | Espera \(W_q = W − 6\) | p99 ≈ 4.6 × \(W\) |
|---|---|---|---|---|
| 50 % | 50 % | 6 ÷ 0.5 = 12 ms | 6 ms | ≈ 55 ms |
| 80 % | 20 % | 6 ÷ 0.2 = 30 ms | 24 ms | ≈ 138 ms |
| 90 % | 10 % | 6 ÷ 0.1 = 60 ms | 54 ms | ≈ 276 ms |
| 95 % | 5 % | 6 ÷ 0.05 = 120 ms | 114 ms | ≈ 553 ms |
| 99 % | 1 % | 6 ÷ 0.01 = 600 ms | 594 ms | ≈ 2,763 ms |

De 50 a 90 % la espera se multiplica por 9 (de 6 a 54 ms), aunque la carga solo subió 80 %. De 90 a 99 %, por 11 más. La intuición dice «al 90 % todavía queda 10 % libre»; la fórmula dice que ese 10 % no alcanza para deshacer las ráfagas.

¿Y el p99? En M/M/1, el tiempo en el sistema sigue una distribución exponencial, y su p99 es W × ln(100) ≈ 4.6 × W (ln es el [[logaritmo]] natural). No hace falta recordar por qué: basta saber que la cola de la distribución crece igual que el promedio, multiplicada por casi 5.

:::figura latencia-codo
La misma fórmula, dibujada. En azul, el tiempo promedio en el pod; en naranja, su p99. Las dos curvas casi no se mueven hasta el 50 % y después suben como palo de hockey. La línea punteada es la promesa completa de 200 ms: el p99 del pod la cruza cerca del 86 %. La banda verde, de 50 a 70 %, es donde se planea un servicio online.
:::

### Por qué se dobla la curva

Con ρ = 0.5, el servidor pasa la mitad del tiempo libre. Cuando llega una ráfaga, tiene tiempo de sobra para vaciar la fila antes de la siguiente. Con ρ = 0.9 solo tiene 10 %: cada ráfaga deja una fila que tarda en vaciarse, y la siguiente llega antes de que termine. Dicho de otro modo: la espera no la causa la carga promedio, sino **la variabilidad combinada con poco tiempo libre** para absorberla.

Ahora sí, la respuesta de la lección. El HPA, la regla de Kubernetes que agrega o quita pods, mantiene al gateway cerca de 60 % de CPU. Pero el HPA reacciona en decenas de segundos o minutos: por omisión revisa las métricas cada 15 s, y después hay que decidir y arrancar los pods nuevos. Un pico llega en segundos:

:::cuenta Un pod del gateway (S = 6 ms) a cuatro horas distintas
Martes en la tarde // 116 req/s, el promedio del día, en 3 pods: \(λ\) = 116 ÷ 3 ≈ 39 por pod | \(ρ\) = 39 × 0.006 ≈ 0.23 → \(W\) = 6 ÷ 0.77 ≈ 7.8 ms → p99 ≈ 4.6 × 7.8 | ≈ 36 ms
Hora pico del día // 350 req/s en 4 pods: \(λ\) = 350 ÷ 4 = 87.5 por pod | \(ρ\) = 87.5 × 0.006 ≈ 0.53 → \(W\) = 6 ÷ 0.475 ≈ 12.6 ms → p99 ≈ 4.6 × 12.6 | ≈ 58 ms
Pico de diseño // 500 req/s en 5 pods: \(λ\) = 500 ÷ 5 = 100 por pod | \(ρ\) = 100 × 0.006 = 0.6 → \(W\) = 6 ÷ 0.4 = 15 ms → p99 ≈ 4.6 × 15 | ≈ 69 ms
Pico de 750, sin HPA todavía // 1.5 veces el de diseño, con los mismos 5 pods: \(λ\) = 750 ÷ 5 = 150 por pod | \(ρ\) = 150 × 0.006 = 0.9 → \(W\) = 6 ÷ 0.1 = 60 ms → p99 ≈ 4.6 × 60 | ≈ 276 ms
Ya con 8 pods // el HPA pide ⌈pods × CPU medida ÷ objetivo⌉, hacia arriba: ⌈5 × 90 % (la fila de arriba) ÷ 60 %⌉ = ⌈7.5⌉ = 8 | \(λ\) = 750 ÷ 8 = 93.75 → \(ρ\) = 93.75 × 0.006 ≈ 0.56 → \(W\) = 6 ÷ 0.4375 ≈ 13.7 ms → p99 ≈ 4.6 × 13.7 | ≈ 63 ms
= El trabajo fue el mismo, 6 ms, en las cinco filas. Lo que cambió fue el tiempo libre del núcleo, y con él la espera: el p99 del pod se multiplicó por 7.7 entre la tarde tranquila y el pico.
:::

Son números del modelo, no mediciones, y solo de la parte del pod. Pero cuentan la historia completa: la misma request, el mismo código, otra fila.

:::calculadora latencia-mm1
Empieza en el pico de diseño de un pod. Sube las llegadas de 100 a 150: el núcleo pasa de 60 a 90 % y el p99 se cuadruplica. Sube a 167: ρ pasa del 100 %, la fila ya no tiene fondo y W, la espera y el p99 dejan de existir (salen como «—»).
:::

### Compruébalo con una simulación

La fórmula sale de supuestos. Este programa no supone nada: genera 200,000 requests al azar (con [[semilla]], para que salga igual siempre) y aplica la regla de la fila a mano de la sección anterior, una por una. La espera de cada request es la de la anterior, más lo que trabajó la anterior, menos el hueco entre las dos llegadas, y nunca menos de cero.

```python
import math, random

def simular(rho, S=6.0, n=200_000, semilla=3):
    azar = random.Random(semilla)
    espera, servicio_anterior, tiempos = 0.0, 0.0, []
    for _ in range(n):
        hueco = azar.expovariate(rho / S)           # ms desde la llegada anterior
        espera = max(0.0, espera + servicio_anterior - hueco)
        servicio = azar.expovariate(1 / S)          # ms de CPU de esta request
        tiempos.append(espera + servicio)
        servicio_anterior = servicio
    tiempos.sort()
    return sum(tiempos) / n, tiempos[math.ceil(0.99 * n) - 1]

print("  ρ   W simulado  W fórmula   p99 simulado  p99 fórmula")
for rho in (0.5, 0.8, 0.9, 0.95):
    w, p99 = simular(rho)
    formula = 6.0 / (1 - rho)
    print(f"{rho:>4}  {w:7.1f} ms  {formula:7.1f} ms  {p99:8.0f} ms  {formula * math.log(100):8.0f} ms")
```

```salida
  ρ   W simulado  W fórmula   p99 simulado  p99 fórmula
 0.5     12.0 ms     12.0 ms        56 ms        55 ms
 0.8     30.4 ms     30.0 ms       140 ms       138 ms
 0.9     61.4 ms     60.0 ms       275 ms       276 ms
0.95    118.9 ms    120.0 ms       512 ms       553 ms
```

`expovariate(t)` genera tiempos al azar con promedio 1 ÷ t: huecos de S ÷ ρ entre llegadas (12 ms a 50 %) y servicios de 6 ms en promedio. Es la «M» de M/M/1. La simulación y la fórmula coinciden de cerca: los promedios, por menos de 3 %; el p99 a 95 %, por ≈ 7 % (512 contra 553). Cambia la semilla y verás otra cosa que importa: a 50 % el p99 sale casi igual con cualquiera; a 95 %, entre semillas brinca de ≈ 460 a ≈ 930 ms. Cerca del 100 %, hasta **medir** se vuelve ruidoso: unas cuantas ráfagas largas deciden el resultado.

### Un modelo, no una ley

Tus llegadas no son exactamente Poisson. El servicio de una GPU que corre siempre el mismo engine de TensorRT es mucho más parejo que una exponencial, y Triton con batching no es una fila simple. Lo que se conserva en la práctica es la **forma**: plana hasta cierto punto y después, el palo de hockey. La fórmula sirve para argumentar y para estimar; para dimensionar, se mide el codo con una prueba de carga.

:::profundo De dónde sale W = S ÷ (1 − ρ)
En M/M/1 se puede calcular la probabilidad de encontrar \(n\) requests en el sistema: \(P_n = (1 − ρ) × ρ^n\). Con \(ρ\) = 0.6, el sistema está vacío el 40 % del tiempo, con una el 24 %, con dos el 14.4 %, y así, cada vez 0.6 veces menos. El promedio de esa lista son las requests adentro, \(L = ρ ÷ (1 − ρ)\): con \(ρ\) = 0.6, 0.6 ÷ 0.4 = 1.5 requests.

Ahora entra la Ley de Little: \(L = λ × W\), así que \(W = L ÷ λ = ρ ÷ (λ × (1 − ρ))\). Como \(ρ = λ × S\), eso es \(S ÷ (1 − ρ)\). En el pod: 1.5 ÷ 100 por segundo = 0.015 s = 15 ms, lo mismo que la tabla.

Y el p99: en M/M/1, la probabilidad de que una request tarde más de un tiempo \(t\) es \(e^{−t/W}\), con \(e\) ≈ 2.718. Para que sea 1 %, \(e^{−t/W} = 0.01\), y \(t = W × ln(100) ≈ 4.6 × W\).
:::

## Saturación, cuello de botella y headroom {Saturation, bottlenecks and headroom}

Un recurso está en [[saturacion|saturación]] (*saturation*) cuando ya no tiene tiempo libre: su utilización llega cerca del 100 % y lo que sigue llegando se va a la fila. Se reconoce por dos síntomas juntos: la fila crece y el throughput deja de subir aunque llegue más. La saturación es una de las cuatro **señales doradas** (*golden signals*) que Alba vigila por cada parte del sistema, junto con la latencia, el tráfico y los errores. El nombre y la lista vienen del libro de SRE de Google (*Site Reliability Engineering*, 2016); SRE es el oficio de mantener servicios funcionando.

### Manda el recurso más lleno

Una request de Alba pasa por varios recursos en fila: la red del gateway, su CPU, la red hacia Triton, la GPU. Cada uno tiene su capacidad y su utilización. El que se satura primero es el [[cuello-botella|cuello de botella]] (*bottleneck*): fija el throughput máximo de toda la cadena, y su fila es la que domina la latencia.

Es como una cadena de tubos: el agua que sale por segundo la decide el tubo más angosto. Ensanchar los otros no cambia nada.

En Alba, en el pico de diseño, cada recurso va a su propio porcentaje, con la misma \(ρ\):

| Recurso | Cuenta | Utilización |
|---|---|---|
| Red de cada nodo (máquina) del gateway | (2.4 Gb/s de tensores ÷ 2 nodos) ÷ 1.56 Gb/s sostenidos = 1.2 ÷ 1.56 | ≈ 77 % |
| CPU de cada pod | \(ρ\) = 100 × 0.006 ÷ 1 núcleo | 60 % |
| Cada T4 | 250 ÷ 1,200 fotos por segundo | ≈ 21 % |

Las cuentas de red son las de la lección de unidades: 500 tensores de 602 KB por segundo son 500 × 602 KB × 8 bits ≈ 2.4 Gb/s, repartidos entre los 2 nodos del gateway. La pieza más cara, la GPU, es la más desocupada. El cuello de botella está en la red del gateway, y luego en su CPU. Por eso el equipo de Alba anota como mejora mandar el tensor en uint8, 4 veces menos bytes, y no comprar otra GPU.

¿Cómo se encuentra en producción? Mirando **qué fila crece**. Si sube el tiempo en la fila de Triton, falta GPU. Si sube el histograma del preproceso, falta CPU en el gateway. Si las dos están planas y la latencia sube, busca en la red o en las conexiones.

### Capacidad: lo que aguanta cumpliendo la promesa

La [[capacidad]] (*capacity*) de un servidor es el throughput más alto que sostiene **cumpliendo su presupuesto de latencia**. No es el máximo que alcanza a procesar: pasado cierto punto todavía procesa más, pero tarde. La capacidad de una T4 de Alba, ≈ 1,200 fotos por segundo, es el último escalón de la prueba de carga donde su p99 todavía es chico, ≈ 28 ms; un escalón más arriba salta a ≈ 130 ms (la rampa de la sección de pruebas de carga). Esos 28 ms son el p99 de la T4 en la prueba de carga, empujada a 1,200 fotos por segundo. No son los 27 ms del **presupuesto del paso del modelo** de Alba, lo más que debe tardar ese paso en una request lenta (10 de viaje, 2 de fila y 15 de GPU): ese presupuesto es para la carga real, 250 fotos por segundo por T4 en el pico de diseño: 1,200 ÷ 250 ≈ 4.8 veces menos que en la prueba. Los 150 ms del timeout del gateway son otra cosa: cuándo rendirse, no cuánto debería tardar.

### Headroom: el margen que se compra a propósito

El [[headroom]] es la distancia entre la capacidad y la carga que planeas: la parte que dejas libre a propósito. No hay un número oficial; la regla práctica es que un servicio online se planea a ≈ 50–70 % de la capacidad medida; un job offline, que nadie espera, puede trabajar cerca del 100 %. Y conviene repetirlo: el headroom es protección, no desperdicio. Paga cuatro cosas a la vez:

1. **La p99.** Lejos del codo, una ráfaga no se convierte en fila.
2. **La caída de una réplica o de una [[zona-disponibilidad|zona]].** Su carga se reparte en las demás.
3. **El tiempo de reacción del autoscaler.** Un nodo con GPU tarda minutos en estar listo; un pico dura segundos.
4. **El error de tu medición.** El máximo de la prueba no es el de producción: otra mezcla de fotos, relojes más bajos con calor.

Con la capacidad medida y la utilización objetivo se cuentan las máquinas:

:::formula Cuántas máquinas comprar
m_0 = ⌈frac{λ_{pico}}{K × ρ_{obj}}⌉
m = m_0 + R
ρ_{pico} = frac{λ_{pico}}{m × K}
ρ_{caída} = frac{λ_{pico}}{(m − 1) × K}
- λ_{pico}: el pico de diseño, en requests por segundo
- K: la capacidad medida de una máquina, en requests por segundo (el codo de la prueba de carga)
- ρ_{obj}: la utilización objetivo: la fracción de \(K\) que planeas usar (0.5 = 50 %)
- ⌈ ⌉: redondear hacia arriba: media máquina no se compra
- m_0: las máquinas que pide el throughput
- R: las máquinas de repuesto (1 = N+1)
- m: las máquinas en total
- ρ_{pico}: la carga de cada una en el pico, con todas vivas, contra su máximo medido
- ρ_{caída}: la carga de cada una en el pico si cae una
:::

:::cuenta Cuántas T4 compra Alba
Capacidad medida por T4, \(K\) // con perf_analyzer, la herramienta de NVIDIA para medir Triton | medida | ≈ 1,200 fotos/s
Capacidad planeada, \(K × ρ_{obj}\) // utilización objetivo \(ρ_{obj}\) = 50 % | 1,200 × 0.5 | 600 fotos/s
Por throughput, \(m_0\) // \(λ_{pico}\) = 500, el pico de diseño | ⌈500 ÷ 600⌉ = ⌈0.83⌉ | 1 T4
Con repuesto, \(m = m_0 + R\) // N+1: \(R\) = 1, una más, en otra zona | 1 + 1 | 2 T4
Cada una en el pico, \(ρ_{pico}\) // con las dos vivas | 500 ÷ (2 × 1,200) = 250 ÷ 1,200 | ≈ 21 %
Si cae una, \(ρ_{caída}\) | 500 ÷ (1 × 1,200) | ≈ 42 %
En promedio // 116 req/s, el promedio del día, entre las dos | (116 ÷ 2) ÷ 1,200 = 58 ÷ 1,200 | ≈ 5 %
= Ni en la peor hora con una GPU caída la T4 que queda sale de la parte plana de la curva. El precio: ≈ US$768 al mes (2 g4dn.xlarge × US$0.526 la hora × 730 horas del mes, precio de lista on demand en us-east-1, el de la lección de unidades) por dos GPUs que trabajan al 5 % en promedio. «Pagas capacidad para el pico las 24 horas».
:::

:::calculadora latencia-capacidad
Arranca con Alba: \(λ_{pico}\) = 500, \(K\) = 1,200, \(ρ_{obj}\) = 50 % y \(R\) = 1. Sube la utilización objetivo a 90 %: siguen siendo 2, porque la segunda la compra el repuesto. Ahora pon el pico en 1,670, el minuto de Hot Sale: al 50 % pide 4 T4; al 90 %, 3, y si cae una, las otras dos trabajan a ≈ 70 % de su máximo.
:::

:::profundo El minuto de Hot Sale, recurso por recurso
En la lección de unidades viste un minuto con ≈ 1,670 requests por segundo, 4.8 veces el pico de un día normal. Recorre los recursos con esa tasa:

- **GPUs:** 1,670 ÷ (2 × 1,200) = 1,670 ÷ 2,400 ≈ 70 % del máximo de las dos. Aguantan, en la parte que ya empieza a doblarse.
- **CPU del gateway:** \(λ × S\) = 1,670 × 0.006 s ≈ 10 vCPU de trabajo, contra los 8 vCPU de sus dos nodos (4 cada uno): 10 ÷ 8 ≈ 125 %. Saturada.
- **Red del gateway:** 1,670 × 602 KB × 8 bits ≈ 8 Gb/s contra 2 nodos × 1.56 ≈ 3.1 Gb/s sostenidos: 8 ÷ 3.1, más de 250 %. Saturada, y primero.

Con dos recursos arriba de 100 %, la fila del gateway crece sin fondo. La GPU no puede ayudar: ni le llegan las fotos. Las salidas son preparar el evento (más nodos antes de que empiece, fotos en uint8) y, para lo que sobre, una fila con tope, que es la sección que sigue a la de batching.
:::

## Batching dinámico: más throughput a cambio de latencia {Dynamic batching: throughput in exchange for latency}

Una GPU corre un [[batch]] de 8 fotos en mucho menos que 8 veces lo que tarda una. Parte del costo es fijo por cada ejecución: lanzar los kernels, leer los pesos de la memoria, sincronizar. Con una sola foto, además, casi todos sus núcleos se quedan sin trabajo. Juntar fotos reparte ese costo fijo.

El [[batching-dinamico|batching dinámico]] (*dynamic batching*) hace eso en el servidor, con las requests que van llegando: las junta en una fila y manda el batch a la GPU cuando se llena (el tamaño máximo) o cuando vence una espera máxima, lo que pase primero. En Alba, Triton espera como máximo 2 ms (`max_queue_delay_microseconds: 2000`) y junta hasta 32 fotos.

Esta es una tabla ilustrativa, con forma realista, para una T4:

| Batch | La GPU tarda | Fotos por segundo, como máximo | Latencia extra contra batch 1 | Throughput contra batch 1 |
|---|---|---|---|---|
| 1 | 4 ms | 250 | — | 1× |
| 4 | 6 ms | ≈ 670 | +2 ms | ≈ 2.7× |
| 8 | 9 ms | ≈ 890 | +5 ms | ≈ 3.6× |
| 16 | 15 ms | ≈ 1,070 | +11 ms | ≈ 4.3× |
| 32 | 27 ms | ≈ 1,190 | +23 ms | ≈ 4.7× |

La cuenta de cada fila es fotos por segundo = tamaño del batch ÷ lo que tarda la GPU: 8 fotos en 9 ms son 8 ÷ 0.009 ≈ 890 por segundo. El throughput sube mucho al principio y luego se aplana: de 1 a 8 se multiplica por 3.6, y de 8 a 32 solo por 1.3, mientras el batch tarda el triple. Rendimientos decrecientes.

:::figura latencia-batch
Cada fila es un tamaño de batch. La barra azul es cuántas fotos por segundo da la T4; la naranja, cuánto tarda cada batch. Al principio la azul crece mucho más que la naranja; al final, al revés.
:::

### El batch que se forma depende de lo que llega

32 es un techo, no lo que pasa. El tamaño real depende de cuántas requests llegan mientras el batcher espera y mientras la GPU está ocupada con el batch anterior:

:::cuenta El batch real de Alba, en el pico de diseño
Llegadas a cada T4, \(λ\) // el pico de diseño entre las 2 T4 | 500 ÷ 2 | 250 por segundo
En la ventana de 2 ms // llegadas = \(λ\) × tiempo | 250 × 0.002 s | 0.5 requests
Mientras la GPU corre el batch anterior // ≈ 5 ms, lo que tarda un batch chico en la T4 (de 3 a 6 ms) | 250 × 0.005 s | ≈ 1.25 requests
Batch promedio // la que abrió la ventana y las que se juntaron | — | ≈ 1 a 3
Para llenar un batch de 32 // tiempo = fotos ÷ \(λ\) | 32 ÷ 250 por segundo = 0.128 s | 128 ms
= A la carga de Alba, el batching casi no junta nada, y por eso cuesta a lo mucho la ventana de 2 ms. Esperar a llenar 32 se comería casi todo el presupuesto: para eso existe la espera máxima.
:::

¿Entonces para qué se activa? Para los malos ratos. Si cae una GPU, la otra recibe 500 por segundo y los batches crecen solos a ≈ 2–4: la GPU absorbe la carga extra sin escalar. En la lección de probabilidad viste la misma idea con Poisson: a 250 por segundo llegan 0.5 en cada ventana de 2 ms, y la probabilidad de que no llegue nadie es \(e^{−0.5}\) ≈ 0.61: ≈ 61 % de las ventanas no recibe a nadie.

:::ojo
«Activo batching y la latencia baja.» Solo pasa en un caso: el sistema estaba saturado, y el batching, al subir la capacidad, vació la fila. En un sistema con holgura, el batching **siempre suma** latencia a cada request: la ventana y un batch más lento. El trato completo es más throughput por GPU a cambio de unos milisegundos.
:::

Throughput contra latencia es la perilla de todo serving. Un job offline, como el *backfill* (clasificar de una vez todo lo que ya existía) de las ≈ 200 millones de fotos viejas, usa batches llenos de 32 todo el tiempo: nadie espera cada foto. En los LLMs la versión es el batching continuo de la lección de LLMs: las secuencias entran y salen del batch en cada token, y la perilla mueve el [[ttft|TTFT]] y el [[tpot|TPOT]].

## Backpressure: una fila con tope {Backpressure: a queue with a limit}

Una fila sin límite nunca falla. Ese es el problema.

Imagina que a una T4 de Alba le ofrecen 1,400 fotos por segundo y solo procesa ≈ 1,210, su máximo absoluto (un poco más que los 1,200 del codo, su capacidad). Sobran 1,400 − 1,210 = 190 cada segundo, y se van a la fila. A los 10 segundos esperan 190 × 10 = 1,900, y la última tardará 1,900 ÷ 1,210 ≈ 1.6 s solo en esperar. El gateway le da a Triton 150 ms antes de rendirse. Todas las requests llegan tarde: la GPU trabaja al máximo, el throughput es 1,210 por segundo, y **ninguna respuesta le sirve a nadie**. Y no hay un solo error en los logs hasta que empiezan los timeouts.

### Una fila con tope

Una [[cola-acotada|cola acotada]] (*bounded queue*) es una fila con un límite: por cuántas caben o por cuánto pueden esperar. Si está llena, la request nueva se rechaza en el momento. Alba pone topes en cada salto:

- **En el pod del gateway:** `MAX_INFLIGHT = 16` requests en vuelo (ya aceptadas y todavía sin respuesta), y solo 2 decodes a la vez, con 50 ms como máximo de espera por un lugar (lección de async).
- **En Triton:** la fila del batcher rechaza lo que ya esperó 100 ms (en su configuración, `default_queue_policy` con REJECT), el último eslabón de la cadena 300 → 250 → 150 → 100 ms de la lección anterior: el backend espera 300, el gateway se da 250, a Triton le da 150 y su fila rechaza a los 100.

Un tope por número también acota el tiempo, por Little, \(W = L ÷ λ\): con \(L\) = 16 lugares como mucho en un pod que termina \(λ\) = 100 por segundo, el tiempo promedio adentro no pasa de ≈ 16 ÷ 100 = 0.16 s, aunque se llene.

### Que la presión llegue hasta atrás

[[backpressure|Backpressure]] (contrapresión) es la señal que viaja hacia atrás y dice «no me mandes más, no puedo». Puede ser un 503, el [[codigo-estado|código de estado]] de «no disponible», con un [[retry-after|Retry-After]] (un [[header]] de la respuesta que dice «vuelve en tantos segundos»), una fila que no deja meter nada hasta que haya lugar, o una conexión que no acepta más bytes. Con ella, el que produce se frena al ritmo del que consume, en vez de llenarle una fila sin fondo.

En Alba la cadena es corta: Triton rechaza, el gateway contesta un 503 en microsegundos y el backend del marketplace le muestra a Ana el selector de categorías: su [[fallback]]. Rechazar a propósito lo que no cabe, para salvar lo demás, es [[load-shedding]], de la lección anterior. Una cola acotada es su forma más simple.

:::cuenta 1,400 fotos por segundo contra una T4, con tope y sin tope
Lo que procesa la GPU // saturada, su máximo absoluto | medido | ≈ 1,210/s
Sin tope: lo que crece la fila // ofrecidas − procesadas | 1,400 − 1,210 | 190/s
Sin tope, a los 10 s // lo que espera ÷ lo que sale por segundo | (190 × 10) ÷ 1,210 = 1,900 ÷ 1,210 | ≈ 1.6 s de espera
Sin tope: las que llegan a tiempo // todas pasan los 150 ms del gateway | — | ≈ 0
Con tope de 100 ms: rechazadas // (ofrecidas − procesadas) ÷ ofrecidas | (1,400 − 1,210) ÷ 1,400 = 190 ÷ 1,400 | ≈ 14 %
Con tope: las demás // esperan cuando mucho 100 ms y un batch: salen antes del timeout | — | ≈ 1,210/s
= Con tope, 14 % recibe un error rápido y el 86 % se contesta antes del timeout. Sin tope, el 100 % se atiende y el 100 % llega tarde.
:::

:::diagrama latencia-tope
Toca cada caja para ver qué tope pone. Usa «Recorrer» para comparar la carga normal, una sobrecarga con topes y la misma sobrecarga sin topes.
:::

¿Dónde va cada tope? Donde se rompe la promesa, no donde se acaba la memoria. Una fila que deja esperar más de lo que queda del presupuesto solo guarda requests que ya perdieron. La regla: si esperó tanto que ya no va a llegar a tiempo, es mejor rechazarla que gastar GPU en ella.

## Medir de verdad: pruebas de carga y goodput {Measuring for real: load tests and goodput}

Todos los números de esta lección que dicen «medido» salen de una [[prueba-carga|prueba de carga]] (*load test*): un programa que le manda tráfico sintético al servicio, cada vez más, y anota el throughput y los percentiles de latencia en cada escalón. En una entrevista, decir cómo lo medirías vale tanto como el número.

### La rampa y su codo

La prueba básica es una **rampa**: subir por escalones la carga ofrecida, lo que el generador manda. Mientras hay capacidad, el throughput sigue a la carga y la latencia casi no cambia. Pasado el **codo** (*knee*), el throughput se aplana y la latencia se dispara, porque todo lo que sobra se va a la fila. Una rampa ilustrativa contra una T4 de Alba:

| Carga ofrecida | Throughput logrado | p50 | p99 | Lectura |
|---|---|---|---|---|
| 300 fotos/s | 300 | 6 ms | 11 ms | Plano |
| 600 fotos/s | 600 | 7 ms | 13 ms | Plano: aquí planea Alba |
| 900 fotos/s | 900 | 9 ms | 17 ms | Empieza a doblarse |
| 1,200 fotos/s | ≈ 1,190 | 14 ms | 28 ms | **El codo**: el último escalón antes del salto |
| 1,300 fotos/s | ≈ 1,210 | ≈ 110 ms | ≈ 130 ms | Saturada: la fila llega a su tope y ≈ 7 % se rechaza |
| 1,400 fotos/s | ≈ 1,210 | ≈ 110 ms | ≈ 130 ms | ≈ 14 % de rechazos |

La capacidad es el codo, 1,200, no el 1,210 del final. Y fíjate en las dos últimas filas: con la fila acotada de Triton, la latencia se queda cerca del tope y lo que sube son los rechazos.

:::profundo Cuatro pruebas, y cómo hacer que predigan producción
La rampa es una de cuatro pruebas. El **soak** sostiene el pico de diseño por horas (500 por segundo durante 4 a 8 h en Alba) y encuentra lo que solo sale con el tiempo: fugas de memoria, GPUs que bajan su reloj por calor. El **spike** salta de la carga normal a 3–5 veces en segundos, para ver si los topes y el autoscaler responden. El **failover** apaga un nodo con GPU en medio del pico, para ver si N+1 aguanta de verdad.

Para que la prueba prediga producción: descarta los primeros minutos (el arranque calienta cachés y conexiones), usa fotos reales (en Alba, ≈ 85 % de celular de ≈ 200 KB y ≈ 15 % de la web, de varios MB), el mismo hardware y la misma configuración, y vigila que el generador no sea el que se satura.
:::

### Carga abierta y carga cerrada

Hay dos maneras de generar el tráfico, y no miden lo mismo:

- **Carga cerrada** (*closed-loop*): N usuarios virtuales; cada uno manda su siguiente request cuando le llega la respuesta de la anterior.
- **[[carga-abierta|Carga abierta]]** (*open-loop*): las requests llegan a una tasa fija, pase lo que pase con las respuestas.

Tus usuarios reales se parecen a la abierta: un vendedor en Monterrey no espera a que termine la foto de otro para subir la suya. La cerrada tiene una trampa: cuando el servidor se frena, el generador también se frena, y manda menos requests justo cuando el servidor está lento. Los peores momentos casi no se miden, y el p99 sale mejor que la realidad. La regla: para medir latencia a una tasa dada, carga abierta; para encontrar el máximo, sirve la cerrada. Los números y las herramientas, en la sección extra.

### Goodput: el throughput que sí cuenta

El throughput cuenta todo lo que el servidor termina. Pero una respuesta que llega después del timeout, o un error, no le sirve a nadie. El [[goodput]] es el throughput **útil**: las requests por segundo que terminan bien y dentro de su SLO. En una prueba de carga, la carga máxima a la que todavía se cumple el SLO.

En la cuenta de la sección anterior, la T4 sin tope tenía un throughput de 1,210 por segundo y un goodput de casi cero. Con tope, los dos valían ≈ 1,210. El goodput es el número que separa un servidor ocupado de un servidor que sirve.

En los LLMs el goodput manda todavía más, porque cada respuesta trae dos promesas: el bloque que sigue lo cuenta.

:::profundo Goodput en los LLMs: el barrido de un LLM propio
En los LLMs, el goodput es el número con el que se compra la flota. El artículo de DistServe (OSDI 2024, un congreso de sistemas) lo definió así para el serving de LLMs: la tasa más alta de requests por segundo, por GPU, a la que todavía se cumple el SLO en la fracción que pediste, por ejemplo el 90 % de las requests. Cada respuesta tiene dos promesas, el TTFT (cuánto tarda el primer token) y el TPOT (cuánto tarda cada token después). Al subir la concurrencia, los tokens por segundo siguen subiendo un rato, pero el TTFT se rompe primero, porque la fila crece antes de que cada paso se vuelva lento. En un servicio que sirve su propio LLM a varios equipos, como el del ejemplo, el goodput de una réplica es ≈ 6 requests por segundo, y se planea al 70 %: 6 × 0.7 ≈ 4.2.

Este es un barrido ilustrativo de una réplica de ese servicio. Las promesas: TTFT p95 ≤ 1 s y TPOT p95 ≤ 50 ms.

| Requests a la vez | TTFT p95 | TPOT p95 | Requests/s | ¿Cumple? |
|---|---|---|---|---|
| 16 | 0.31 s | 27 ms | ≈ 2.6 | Sí, con GPU de sobra |
| 48 | 0.66 s | 42 ms | ≈ 4.9 | Sí |
| 72 | 0.97 s | 49.6 ms | ≈ 6.06 | Sí, en el límite: el goodput |
| 80 | 1.34 s | 53.8 ms | ≈ 6.19 | No: rompe las dos |
| 96 | 2.4 s | 64 ms | ≈ 6.38 | No |

De 72 a 96 a la vez, el throughput sube 5 % y el TTFT se multiplica por ≈ 2.5. Quien vende «nuestra réplica hace 1,600 tokens por segundo» habla de la última fila, donde nadie recibe su primer token a tiempo. Las requests por segundo salen de Little al revés, \(λ = L ÷ W\): concurrencia ÷ latencia **promedio** de cada respuesta completa (no la p95 de la tabla, que daría menos).
:::

## Colas a fondo: varios servidores, menos variabilidad y pruebas que mienten {Queues in depth: many servers, less variability and lying load tests} [extra]

M/M/1 tiene un servidor. Los sistemas reales tienen varios, sus tiempos de servicio son más parejos que una exponencial, y se miden con generadores que a veces mienten. Tres ideas para la segunda pasada.

### Una fila para varios servidores

¿Qué es mejor, dos cajas con una fila cada una o dos cajas con una sola fila? Con una sola fila, nadie espera detrás de una caja ocupada mientras la otra está libre. El modelo es **M/M/c**: c servidores y una fila compartida. Su fórmula se llama **Erlang C**, por Agner Krarup Erlang, un matemático e ingeniero danés de la compañía de teléfonos de Copenhague, que la publicó en 1917 para dimensionar las centrales telefónicas. No hace falta memorizarla; sí saber lo que dice.

:::figura latencia-filas
Arriba, dos servidores con una fila cada uno: una request espera detrás de uno ocupado mientras el otro descansa. Abajo, una fila para los dos: la siguiente request va al primero que se desocupe.
:::

:::formula Erlang C: una fila para c servidores (M/M/c)
Q = frac{(c × ρ)^c}{c! × (1 − ρ)}
P_{espera} = frac{Q}{sum_{j=0}^{c−1} frac{(c × ρ)^j}{j!} + Q}
W_q = P_{espera} × frac{S}{c × (1 − ρ)}
- c: cuántos servidores atienden la fila compartida
- ρ: la utilización de cada servidor, \(λ × S ÷ c\); tiene que ser menor que 1
- c × ρ: cuántos servidores están ocupados, en promedio
- c!: el factorial de \(c\), \(c × (c − 1) × … × 1\): 2! = 2 y 4! = 24; por definición, 0! = 1
- j: el contador de la suma, que va de 0 a \(c − 1\)
- Q: el peso de los momentos en que los \(c\) servidores están ocupados y se forma fila (sin unidades)
- P_{espera}: la probabilidad de que una request que llega encuentre a los \(c\) ocupados y tenga que esperar
- S: el tiempo de servicio de cada request, en ms
- W_q: la espera promedio en la fila, en ms, contando también a las que no esperan nada
:::

Se lee por piezas. La suma de abajo pesa los momentos en que queda algún servidor libre (0, 1, … hasta \(c − 1\) ocupados); \(Q\) pesa los momentos en que todos están ocupados. \(P_{espera}\) es la parte de \(Q\) en el total: qué tan seguido llegas y no hay nadie libre. Y quien sí espera, espera en promedio \(S ÷ (c × (1 − ρ))\): los \(c\) servidores juntos sueltan una request cada \(S ÷ c\), y la fila se vacía más lento cuanto menos tiempo libre, \(1 − ρ\), les queda. Con \(c\) = 1 sale \(P_{espera} = ρ\) y \(W_q = ρ × S ÷ (1 − ρ)\): la espera de M/M/1.

:::cuenta Dos servidores con una fila: c = 2, ρ = 0.8, S = 10 ms
Ocupados en promedio, \(c × ρ\) | 2 × 0.8 | 1.6
Peso de «todos ocupados», \(Q\) // \(Q = (c × ρ)^c ÷ (c! × (1 − ρ))\), con 2! = 2 | 1.6² ÷ (2 × 0.2) = 2.56 ÷ 0.4 | 6.4
Suma de «alguno libre» // \(j\) = 0 y \(j\) = 1: \(1.6^0 ÷ 0!\) + \(1.6^1 ÷ 1!\) | 1 + 1.6 | 2.6
Probabilidad de esperar, \(P_{espera}\) // \(Q ÷ (text{suma} + Q)\) | 6.4 ÷ (2.6 + 6.4) = 6.4 ÷ 9 | ≈ 71 %
Espera promedio, \(W_q\) // \(P_{espera} × S ÷ (c × (1 − ρ))\) | 0.711 × 10 ÷ (2 × 0.2) | ≈ 17.8 ms
= Con una fila para cada uno, cada servidor es un M/M/1: \(W_q\) = 0.8 × 10 ÷ 0.2 = 40 ms. Compartir la fila baja la espera a menos de la mitad, con el mismo trabajo y la misma utilización.
:::

El programa hace esa cuenta para 2, 4 y 8 servidores. En el código, `a` es \(c × ρ\), `cola` es \(Q\) y `p_esperar` es \(P_{espera}\):

```python
import math

def espera_mmc(c, rho, S):          # Erlang C: espera promedio en la fila, en ms
    a = c * rho                     # servidores ocupados, en promedio
    cola = a**c / math.factorial(c) / (1 - rho)
    p_esperar = cola / (sum(a**j / math.factorial(j) for j in range(c)) + cola)
    return p_esperar * S / (c * (1 - rho)), p_esperar

S, rho = 10, 0.8                    # 10 ms de servicio y 80 % de utilización por servidor
print(f"cada servidor con su fila (M/M/1): {rho * S / (1 - rho):.1f} ms de espera")
for c in (2, 4, 8):
    espera, p = espera_mmc(c, rho, S)
    print(f"una fila para {c} (M/M/{c}): {espera:.1f} ms de espera; esperan {p:.0%}")
print(f"servicio constante (M/D/1) al 90 %: {0.9 * S / (2 * 0.1):.0f} ms, contra {0.9 * S / 0.1:.0f} en M/M/1")
```

```salida
cada servidor con su fila (M/M/1): 40.0 ms de espera
una fila para 2 (M/M/2): 17.8 ms de espera; esperan 71%
una fila para 4 (M/M/4): 7.5 ms de espera; esperan 60%
una fila para 8 (M/M/8): 2.9 ms de espera; esperan 46%
servicio constante (M/D/1) al 90 %: 45 ms, contra 90 en M/M/1
```

A la **misma** utilización de 80 %, compartir la fila entre dos baja la espera de 40 a ≈ 18 ms, y entre cuatro a ≈ 7.5 ms. Por eso un grupo grande de réplicas aguanta mejor la misma utilización que uno chico.

En la práctica, «una fila compartida» es un [[balanceador]] que manda cada request a la réplica con menos requests en vuelo (el algoritmo *least outstanding requests*, que el ALB de AWS, el balanceador de Alba, ofrece como opción; el que usa por omisión es round robin). El reparto al azar de un [[service-k8s|Service de Kubernetes]], en el modo iptables de kube-proxy, el más común, se parece más a filas separadas: un pod puede tener fila mientras otro descansa. Lo ves en la lección de balanceadores, con los [[algoritmo-balanceo|algoritmos de balanceo]].

### Menos variabilidad, menos espera

La última línea del programa es la otra palanca. Si el tiempo de servicio es constante (el modelo **M/D/1**, de *determinístico*), la espera promedio es **la mitad** que en M/M/1: \(W_q = ρ × S ÷ (2 × (1 − ρ))\). A 90 % y 10 ms, 0.9 × 10 ÷ (2 × 0.1) = 45 ms en vez de 90.

La regla general es la aproximación de Kingman (John Kingman, 1961):

:::formula Aproximación de Kingman
W_q ≈ frac{ρ}{1 − ρ} × frac{C_a^2 + C_s^2}{2} × S
- W_q, ρ, S: la espera promedio en la fila, la utilización y el tiempo de servicio, como en M/M/1
- C_a: qué tan variables son los huecos entre llegadas: su desviación estándar ÷ su promedio. Vale 1 para llegadas de Poisson
- C_s: lo mismo para el tiempo de servicio: 1 si es exponencial, 0 si es constante
:::

Con todo exponencial, \(C_a^2 = C_s^2 = 1\), el promedio \((1 + 1) ÷ 2\) vale 1 y sale M/M/1 exacto; con llegadas de Poisson y servicio constante, \((1 + 0) ÷ 2\), la mitad. Es una aproximación, y es mejor cuanto más cerca está ρ del 100 %, justo donde importa. Una GPU que corre el mismo engine con el mismo shape se parece al caso constante. Lo que agrega variabilidad (fotos de 200 KB mezcladas con fotos de 12 MP, batches de tamaño variable, pausas del programa) te empuja hacia el peor caso. Por eso Alba limita el tamaño de las fotos y usa *draft mode*: no solo bajan el promedio, emparejan el servicio.

### Coordinated omission: cuando la prueba miente

Gil Tene, ingeniero de Azul Systems (una empresa que hace los programas que corren Java) y autor de wrk2, una herramienta de pruebas de carga, le puso nombre a la trampa de la carga cerrada: *coordinated omission*. El generador se «coordina» con el servidor y omite justo las mediciones que más importan. Se ve con un experimento mental: un servidor que responde en 10 ms, salvo una pausa de 1 s a la mitad de una prueba de 10 s.

:::cuenta Una prueba de 10 s a 1,000 requests por segundo, con una pausa de 1 s
Cerrada: lo que se mide // 10 usuarios de 10 ms: 1,000 por segundo; en la pausa, los 10 se quedan esperando | 9 s × 1,000 + 10 | 9,010
Cerrada: las lentas // una por usuario | 10 ÷ 9,010 | ≈ 0.1 %
Cerrada: p99 // su posición es 0.99 × 9,010 ≈ 8,920: cae entre las 9,000 rápidas, porque las lentas no llegan al 1 % | — | 10 ms
Abierta: lo que se mide // siguen llegando 1,000 por segundo | 10 s × 1,000 | 10,000
Abierta: las lentas // las 1,000 de la pausa esperan de 1 s a 0 | 1,000 ÷ 10,000 | 10 %
Abierta: p99 // su posición es 0.99 × 10,000 = 9,900: la 900.ª más rápida de las 1,000 de la pausa, que tardan de 11 a 1,010 ms | 10 + 900 = 910 ms | ≈ 0.91 s
= El mismo servidor y la misma pausa. La prueba cerrada reporta un p99 de 10 ms; la abierta, de casi un segundo, que es lo que vivirían tus usuarios.
:::

Para simplificar, se supone que al terminar la pausa el servidor despacha de golpe lo acumulado. La cuenta se puede comprobar con las dos listas de latencias:

```python
import math

def p99(latencias):                 # el p99 de la lección de percentiles: contar desde abajo
    orden = sorted(latencias)
    return orden[math.ceil(0.99 * len(orden)) - 1]

cerrada = [10] * 9_000 + [1_010] * 10                      # 10 usuarios atorados 1 s
abierta = [10] * 9_000 + [1_000 - k + 10 for k in range(1_000)]   # llega una por ms en la pausa
print("cerrada:", len(cerrada), "mediciones, p99 =", p99(cerrada), "ms")
print("abierta:", len(abierta), "mediciones, p99 =", p99(abierta), "ms")
```

```salida
cerrada: 9010 mediciones, p99 = 10 ms
abierta: 10000 mediciones, p99 = 910 ms
```

### Las herramientas, y cuál es abierta

Las que más vas a oír:

| Herramienta | Qué carga | Modelo de carga |
|---|---|---|
| `perf_analyzer`, de NVIDIA | Triton directo | Por concurrencia (cerrado) o por tasa (abierto) |
| Locust | El servicio completo, con usuarios escritos en Python | Cerrado por omisión |
| k6 | El servicio completo | Tiene un modo de tasa fija: abierto |
| wrk2 y vegeta | Uno o pocos [[endpoint|endpoints]] HTTP | Tasa constante: abierto |

Las salidas: un generador abierto cuando lo que mides es la latencia, o, con uno cerrado, un timeout más corto que el intervalo entre las requests de cada usuario, para que un servidor lento no frene el ritmo. Y una costumbre que delata el problema: anota la tasa que de verdad mandó el generador. Si pediste 1,000 por segundo y salieron 900, la prueba se coordinó con el servidor.

Hay una prueba más de que importa la forma de generar. Con carga cerrada, Little dice que la tasa que manda el generador es usuarios ÷ latencia: si la latencia se multiplica por 10, la tasa se divide entre 10. El servidor «mejora» solo, porque le llega menos. Con carga abierta no hay ese alivio, y por eso es la que se parece a producción: el día del Hot Sale nadie deja de subir su foto porque el servicio esté lento.

## Errores comunes {Common mistakes}

### 1. Planear al 90 % porque «queda 10 % libre»

En una fila, ese 10 % libre vale poco: la espera ya es 9 veces la del 50 %, y cualquier ráfaga saca al p99 del SLO.

**Cómo evitarlo:** planea a 50–70 % de la capacidad medida en lo online (más cerca de 50 % con tráfico en ráfagas y un SLO apretado), y deja el 100 % para los jobs offline, donde nadie espera.

### 2. Escalar con la señal equivocada

La utilización de `nvidia-smi` marca 30 % con batches de 1 y se queda en 100 % igual con 2 que con 200 en la fila. Y la CPU del pod de Triton sigue al throughput terminado: cuando la GPU se satura, se congela justo cuando más la necesitas.

**Cómo evitarlo:** escala con una señal del recurso que se satura primero. En el gateway, su CPU; en Triton, el tiempo en la fila.

### 3. Una fila sin tope

`asyncio.Queue()` sin `maxsize`, un pool sin límite, un servidor que acepta todo. Nunca falla: solo se atrasa, en silencio, hasta que todas las respuestas llegan tarde.

**Cómo evitarlo:** un tope en cada fila, puesto donde se rompe el presupuesto de latencia, y un rechazo rápido con su fallback del otro lado.

### 4. Creerle al p99 de una prueba cerrada

Locust con 50 usuarios reporta un p99 precioso, porque cuando el servidor se frenó, los usuarios también.

**Cómo evitarlo:** para medir latencia a una tasa, un generador abierto a la tasa de diseño. Y compara siempre la tasa que pediste con la que de verdad se mandó.

### 5. Dimensionar con el throughput máximo o con el promedio

El máximo de una rampa no es la capacidad: pasado el codo, el servidor procesa más, pero tarde. Y el promedio no es la carga. Piensa en el gateway de Alba con 1 [[vcpu|vCPU]] (un núcleo rentado en la nube) para su promedio de 116 requests por segundo: le alcanza, porque el trabajo es \(λ × S\) = 116 × 0.006 s ≈ 0.7 vCPU. A las 8 de la noche, la hora pico, llegan 350, y necesita 350 × 0.006 ≈ 2.1.

**Cómo evitarlo:** capacidad = el codo que cumple el presupuesto, o el goodput; carga = el pico de diseño. Después, el headroom.

### 6. Sumar o promediar lo que no se suma

Sumar los p99 de los tramos, promediar los p99 de los pods o meter un p99 en la Ley de Little («500 × 200 ms = 100 en vuelo en el peor caso»). Little habla de promedios, y de un sistema estable, donde a la larga sale lo mismo que entra: con una fila que crece sin fondo, no hay un W que meter.

**Cómo evitarlo:** reparte el presupuesto por tramo, pero mide el p99 de punta a punta, con histogramas que sí se suman. Para Little, el W promedio.

## En la vida real {In real life} [extra]

### Alba: escalar por la fila, no por la GPU

Triton escala con KEDA, una pieza que conecta el HPA con métricas de Prometheus (el sistema que guarda las métricas), mirando el **tiempo promedio en la fila** de Triton, con un objetivo de 10 ms. Es el síntoma que siente el usuario. Con la misma cuenta del HPA (réplicas × métrica ÷ objetivo, hacia arriba): normalmente la fila marca ≈ 2 ms y KEDA pediría ⌈2 × 2 ÷ 10⌉ = ⌈0.4⌉ = 1 réplica, pero el mínimo es 2, por N+1. Si la GPU se satura y la fila sube a 25 ms, pide ⌈2 × 25 ÷ 10⌉ = 5, y su techo de costo lo deja en 4, que agrega de una por minuto. Además, una alerta avisa si la fila pasa de 20 ms durante 10 minutos.

La señal no es lineal, como predice la curva: casi 0 hasta cerca del codo y después salta. Por eso Alba baja réplicas despacio. Y no confía en el autoscaler para lo rápido: con nodos de GPU que tardan de 5 a 13 minutos en estar listos, el equipo de Alba lo dice claro: «un spike de 30 segundos lo absorbe el margen, no el autoscaler». El headroom de 50 % es su seguro.

El gateway, en cambio, escala por CPU al 60 %, porque ahí la CPU **es** el recurso que se satura: ρ = 0.6 en cada pod, la fila de la sección de utilización.

### Alba: «el p99 pasó de 80 a 400 ms»

Es una pregunta clásica de las entrevistas de diseño de sistemas de ML, y la respuesta es esta lección hecha procedimiento. Primero, ¿desde cuándo? Se cruza con los últimos cambios: del modelo, del gateway, de quien llama. Después, ¿en qué tramo? Se separa el histograma del preproceso, el tiempo en la fila de Triton y el cómputo en la GPU.

- **Si creció la fila:** ¿subió el tráfico, o lo subió un solo cliente? ¿KEDA llegó a su máximo? ¿Se cayó un pod y los demás quedaron más llenos?
- **Si creció el cómputo:** ¿un engine nuevo, otro tamaño de batch promedio, una GPU que bajó su reloj por calor?
- **Si creció el preproceso:** ¿llegan fotos más grandes? ¿El pod se topa con su límite de CPU? ¿Alguien metió una cuenta pesada en el event loop?

Primero se mitiga (regresar a la versión anterior, escalar, limitar al cliente ruidoso) y después se busca la causa. La regla de fondo es la de la primera sección: la latencia se desarma en viajar, esperar y trabajar, tramo por tramo.

### Alba: el job que llenó la fila

Las ≈ 200 millones de fotos viejas del catálogo se clasifican con un job offline: throughput, no latencia, con batches llenos de 32. Si ese job usara el mismo Triton que la app, sería el clásico vecino ruidoso (*noisy neighbor*): sus batches llenan la fila y el p99 de Ana explota, aunque el tráfico de la app no cambió. Por eso corre aparte, en sus propias máquinas. Y en el Triton de la app, la fila tiene dos prioridades (`priority_levels: 2`): la app va primero y cualquier otro cliente detrás. Cuando hay que rechazar, se rechaza primero lo que no tiene a una persona esperando.

### Un LLM propio: el tope de admisión va donde se rompe la promesa

El servicio del barrido de goodput, que sirve su propio LLM a varios equipos, corre 16 réplicas de vLLM, el programa que corre el modelo. Su gateway pone un tope de requests en vuelo hacia toda la flota: una cola acotada por número. ¿Dónde va el tope? Donde se rompe el SLO, no en el plan. El barrido de la sección de goodput dice que cada réplica cumple hasta 72 a la vez, así que el tope es 16 × 72 = 1,152 en vuelo. En el pico de diseño hay ≈ 630: se usa 630 ÷ 1,152 ≈ 55 %, y el resto queda para los picos. Si el tope fuera la carga planeada, ≈ 40 por réplica (16 × 40 = 640 en vuelo, apenas arriba de los ≈ 630 del pico), el gateway contestaría 503 en cuanto el tráfico pasara un poco del pico de diseño, con GPUs de sobra.

Cuando no hay lugar, lo interactivo espera en una fila acotada hasta 0.5 s, porque esperar más ya rompe la promesa de un TTFT de 1 s. De noche, los trabajos batch esperan a propósito detrás de lo interactivo: su TTFT puede ser de minutos, y es correcto. Y el plan al 70 % tampoco es capricho: si se cae un nodo con 4 de las 16 réplicas, quedan 12 × 6 = 72 requests por segundo contra un pico de 60. Es headroom con nombre y apellido.

### Voz a texto en tiempo real: una fila que solo atrasa

En un servicio de subtítulos en vivo, que pasa voz a texto en tiempo real, una fila sin tope convierte cada milisegundo de más por pedazo de audio en atraso acumulado (lección de async). Ahí el tope no es por cantidad sino por edad: si el atraso pasa de ≈ 2 s, la sesión se cierra y se abre en una GPU con lugar. En tiempo real, una respuesta vieja es una respuesta equivocada.

### Fuera de ML: carreteras, bancos y urgencias

Una autopista al 90 % de su capacidad fluye hasta que alguien frena: la ráfaga de frenazos no se deshace, porque no hay tiempo libre. Es el palo de hockey con coches. Muchos bancos y aeropuertos usan una sola fila para varias cajas: es M/M/c, y la espera baja sin contratar a nadie. Y las urgencias de un hospital no atienden en orden de llegada: clasifican por gravedad (*triage*), como las colas con prioridad de Alba y del LLM propio.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de utilización y capacidad se comprueban con las calculadoras.

:::ejercicios
? [facil] A un servicio le llegan 40 requests por segundo y cada una ocupa 20 ms de CPU. ¿Qué utilización tiene con 1 núcleo? ¿Y con 2? ¿Cuántas por segundo aguanta como máximo con 1?
- Con \(ρ = λ × S ÷ c\), \(λ\) = 40 y \(S\) = 0.020 s. Con 1 núcleo: \(ρ\) = 40 × 0.020 ÷ 1 = **0.8**, 80 %.
- Con 2: \(ρ\) = 40 × 0.020 ÷ 2 = **0.4**, 40 %.
- Máximo con 1: un núcleo termina como mucho \(1 ÷ S\) = 1 ÷ 0.020 = **50 por segundo**. Con 40 está a 80 % de ese máximo: es la misma cuenta.
? [facil] Arma la tabla de M/M/1 con S = 10 ms. Calcula W a 50, 70, 80, 90 y 95 %.
- \(W = S ÷ (1 − ρ)\), con \(S\) = 10: 10 ÷ 0.5 = **20 ms**; 10 ÷ 0.3 ≈ **33 ms**; 10 ÷ 0.2 = **50 ms**; 10 ÷ 0.1 = **100 ms**; 10 ÷ 0.05 = **200 ms**.
- De 50 a 95 %, la carga no llega al doble y el tiempo se multiplica por 200 ÷ 20 = 10.
? [facil] Una cadena tiene tres tramos, con números parecidos a los de Alba: la CPU del gateway aguanta 800 por segundo, la red 650 y las GPUs 2,400. ¿Cuál es el throughput máximo de la cadena? ¿Ayuda comprar otra GPU?
- El máximo es el del tramo más angosto, min(800, 650, 2,400) = **650 por segundo**: la red. Es el cuello de botella.
- Otra GPU sube su tramo a 3,600 y la cadena sigue en 650: **no ayuda**. Ayuda mandar menos bytes (uint8) o más red.
? [facil] Con la ventana de 2 ms de Triton, ¿cuántas requests llegan en la ventana a una T4 que recibe 500 por segundo? ¿Cuánto tardaría en llenarse un batch de 32?
- En la ventana: llegadas = \(λ\) × tiempo = 500 × 0.002 s = **1** request en promedio.
- Para llenar 32: tiempo = fotos ÷ \(λ\) = 32 ÷ 500 = 0.064 s = **64 ms**. Por eso la ventana corta a los 2 ms: esperar a llenarlo se comería 64 ÷ 200 ≈ un tercio de los 200 ms de la promesa.
? [medio] El pico de diseño de Alba sube a 650 por segundo. Con la T4 a 1,200 medidas y planeada al 50 %, ¿cuántas compras con N+1? ¿A qué utilización trabaja cada una en el pico? ¿Y si cae una?
- Con «Cuántas máquinas comprar»: \(λ_{pico}\) = 650, \(K\) = 1,200, \(ρ_{obj}\) = 0.5 y \(R\) = 1. Por throughput: \(m_0\) = ⌈650 ÷ (1,200 × 0.5)⌉ = ⌈650 ÷ 600⌉ = ⌈1.08⌉ = 2. Con repuesto: \(m\) = 2 + 1 = **3 T4**.
- Las tres vivas: \(ρ_{pico}\) = 650 ÷ (3 × 1,200) ≈ **18 %**.
- Si cae una: \(ρ_{caída}\) = 650 ÷ (2 × 1,200) ≈ **27 %**. La fracción que pasa de 600 obliga a la segunda GPU: el redondeo hacia arriba compra mucho headroom.
? [medio] Una prueba cerrada usa 100 usuarios virtuales. Con el servidor respondiendo en 50 ms, ¿qué tasa manda? Si el servidor se frena a 500 ms, ¿qué tasa manda ahora? ¿Qué le pasa a lo que mide?
- Es Little al revés, \(λ = L ÷ W\), con \(L\) = 100 usuarios y \(W\) = 0.05 s: 100 ÷ 0.05 = **2,000 por segundo** (cada usuario manda 1 ÷ 0.05 = 20).
- A 500 ms: \(λ\) = 100 ÷ 0.5 = **200 por segundo**, diez veces menos.
- Justo cuando el servidor está lento, la prueba manda menos y mide menos requests lentas. Los usuarios reales seguirían llegando a 2,000: el p99 real sería peor que el medido.
? [medio] En una rampa, el servicio cumple su p99 ≤ 200 ms hasta 900 requests por segundo; a 1,000, el p99 es 260 ms y el throughput 990. ¿Cuál es su capacidad? ¿Su goodput a 1,000? Si planeas al 60 %, ¿cuánto le asignas?
- Capacidad: **900 por segundo**, el último escalón que cumple. No 990: ahí ya no cumple.
- A 1,000 ofrecidas, el SLO se rompe, así que más de 1 % llega tarde. El goodput de la prueba, la carga máxima que cumple, sigue siendo **900**.
- Planeado al 60 %: \(K × ρ_{obj}\) = 900 × 0.6 = **540 por segundo** por réplica.
? [reto] Un pico sube el tráfico de Alba de 500 a 750 por segundo en un minuto. El gateway tiene 5 pods con 1 núcleo y S = 6 ms. Supón que el HPA tarda 3 minutos en tener listos los pods nuevos. (a) ¿Qué ρ, W y p99 tiene cada pod en esos 3 minutos, con M/M/1? (b) ¿Cuántos pods pide el HPA, con su objetivo de 60 %? (c) ¿Qué cambiarías para no depender de esos 3 minutos?
- (a) \(λ\) = 750 ÷ 5 = 150 por pod; \(ρ = λ × S\) = 150 × 0.006 = **0.9**. \(W = S ÷ (1 − ρ)\) = 6 ÷ 0.1 = **60 ms**; p99 ≈ 4.6 × \(W\) = 4.6 × 60 ≈ **276 ms**: solo el pod ya pasa los 200 ms de la promesa. La espera, \(W_q = ρ × S ÷ (1 − ρ)\) = 0.9 × 6 ÷ 0.1 = 54 ms, contra 0.6 × 6 ÷ 0.4 = 9 ms en el pico de diseño: se multiplicó por 54 ÷ 9 = 6 con 1.5 veces la carga.
- (b) El HPA pide ⌈pods × CPU medida ÷ objetivo⌉ = ⌈5 × 90 ÷ 60⌉ = ⌈7.5⌉ = **8 pods**: 750 ÷ 8 ≈ 94 por pod, \(ρ\) = 94 × 0.006 ≈ 0.56.
- (c) Más headroom de base para los picos conocidos (un mínimo de pods más alto antes de un evento), el `MAX_INFLIGHT` que rechaza rápido lo que no cabe, y mandar el tensor en uint8 para aliviar la red, el primer cuello de botella.
? [reto] A una T4 le ofrecen 1,600 fotos por segundo y procesa ≈ 1,210. (a) Sin tope en la fila, ¿cuánto espera la última request que llegó a los 5 s? ¿Cuál es el goodput si el gateway corta a los 150 ms? (b) Con el tope de 100 ms de Triton, ¿qué fracción se rechaza? (c) ¿Por qué la CPU del pod de Triton no le avisaría al HPA?
- (a) Sobran 1,600 − 1,210 = 390 por segundo. A los 5 s esperan 390 × 5 = 1,950, que tardan 1,950 ÷ 1,210 ≈ **1.6 s** en salir. Todas pasan los 150 ms: goodput ≈ **0**.
- (b) Rechazadas = (ofrecidas − procesadas) ÷ ofrecidas = (1,600 − 1,210) ÷ 1,600 = 390 ÷ 1,600 ≈ **24 %**; el 76 % restante sale antes del timeout.
- (c) La CPU de ese pod sigue al throughput **terminado**, que se quedó en 1,210: la señal se congela mientras se rechaza una de cada cuatro. Por eso Alba escala Triton por el tiempo en la fila.
:::

## Lo que sigue {What comes next} [extra]

Esta lección cierra «La red y la web». La fase siguiente, «Datos y almacenamiento», trae «Colas y streams: mensajes que esperan», donde las filas de esta lección se vuelven servicios propios, con mensajes que se guardan en disco. Más adelante, «Regiones, zonas y disponibilidad» explica las zonas donde vive el repuesto N+1. Y cuando el curso llegue a las estaciones del sistema de Alba, «Código de serving» pone en código los topes y los timeouts del gateway, «Kubernetes» arma el HPA, y «La request en vivo» mide la latencia de una request real, tramo por tramo.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
latencia-punta-a-punta tiempo-servicio tiempo-en-cola utilizacion teoria-colas saturacion cuello-botella capacidad headroom prueba-carga carga-abierta backpressure cola-acotada batching-dinamico goodput
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿En qué tres cosas se va el tiempo de una request en cada salto, y cuál crece cerca del pico?
Viajar (la red), esperar (la fila) y trabajar (el tiempo de servicio). Cerca del pico crece la espera. La utilización, \(ρ = λ × S ÷ c\), dice cuánto: un pod con 100 requests por segundo de 6 ms y un núcleo está a 0.6.
? ¿Por qué la espera explota cerca del 100 % aunque todavía quede tiempo libre?
Porque las llegadas vienen en ráfagas y cada ráfaga deja una fila que solo se deshace con tiempo libre. En M/M/1, W = S ÷ (1 − ρ): de 50 a 90 % la espera en la fila se multiplica por 9.
? ¿Qué es el cuello de botella de Alba en el pico de diseño, y qué no lo es?
La red del gateway (≈ 77 %) y luego su CPU (60 %). La GPU, la pieza más cara, va al ≈ 21 %.
? ¿Para qué sirve el headroom?
Para que el p99 no salga de la parte plana de la curva, para aguantar la caída de una réplica o zona, para cubrir los minutos que tarda el autoscaler y para el error de la medición.
? ¿Qué hace una cola acotada que no hace una fila sin tope?
Rechaza rápido lo que no va a llegar a tiempo. Así las demás se contestan a tiempo. Una fila sin tope atiende a todas y todas llegan tarde: throughput al máximo y goodput en cero.
? ¿Por qué una prueba de carga cerrada reporta un p99 mejor que la realidad?
Porque cuando el servidor se frena, los usuarios virtuales esperan y mandan menos requests justo en el peor momento. Es la *coordinated omission*. Para medir latencia, carga abierta a una tasa fija.
:::
