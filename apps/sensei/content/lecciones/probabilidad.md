---
titulo: Probabilidad para sistemas que fallan
en: Probability for systems that fail
subtitulo: Por qué un sistema hecho de piezas muy confiables falla más seguido que cada una, cómo se cuentan los nueves y los minutos caídos, cuánto protege una réplica de repuesto y cuándo dejan de valer esas cuentas.
pregunta: Si cada pieza de mi sistema funciona el 99.9 % del tiempo, ¿qué tan seguido falla el sistema completo, y qué hago para que falle menos?
requisitos: percentiles
---

:::idea
En producción, una probabilidad se lee como una frecuencia, y con millones de requests al día un «1 %» es muchísimo. Si un request necesita **todas** sus piezas, se multiplican sus probabilidades de funcionar y el conjunto falla más que cada pieza; si basta con **una** de varias copias, se multiplican las de fallar y falla mucho menos, siempre que las fallas sean independientes, que es justo lo que más se rompe en la práctica.
:::

## Probabilidad: un número y una frecuencia {Probability: a number and a frequency}

En «Qué es un modelo» viste la [[probabilidad]] como lo que sale de un [[softmax]]: un número de 0 a 1 que dice qué tan seguro está el modelo. Aquí vamos a usar la misma idea desde el otro lado. No para decir qué cree un modelo, sino **qué tan seguido le pasa algo a un sistema**: que un request tarde de más, que un servidor se caiga, que un pago sea fraude.

A cada cosa que puede pasar o no se le llama **evento**. Su probabilidad se escribe con una P: P(lento) = 0.01 se lee «la probabilidad de que un request sea lento es 0.01». Hay tres formas de decir lo mismo, y conviene pasar de una a otra sin pensar:

| Número | Porcentaje | En palabras |
|---|---|---|
| 0.5 | 50 % | 1 de cada 2 |
| 0.01 | 1 % | 1 de cada 100 |
| 0.001 | 0.1 % | 1 de cada 1,000 |
| 0.000001 | 0.0001 % | 1 de cada millón |

### La probabilidad como frecuencia

En producción, la forma más útil de pensar una probabilidad es como una **frecuencia**: si repites algo muchas veces, la fracción de veces que pasa se acerca a su probabilidad. Lanza una moneda 10 veces y puede salir sol 7 veces: 70 %, lejos de 50 %. Lánzala 10,000 veces y vas a quedar muy cerca de 50 %. Con pocas repeticiones manda la suerte; con muchas, la probabilidad.

Un sistema en producción repite muchísimas veces. C01 recibe ≈ 10 millones de fotos al día (≈ 2.5 M publicaciones nuevas con ≈ 3 fotos cada una, más lo que piden otros equipos), y cada foto es un [[request]]. Con ese volumen, las probabilidades dejan de ser abstractas y se vuelven conteos:

:::cuenta Lo que una probabilidad por request significa en C01
1 % // por ejemplo, los requests que tardan de más | 10,000,000 × 0.01 | 100,000 al día
0.1 % | 10,000,000 × 0.001 | 10,000 al día
0.01 % | 10,000,000 × 0.0001 | 1,000 al día
Uno en un millón | 10,000,000 × 0.000001 | 10 al día
= Algo de «uno en un millón» le pasa a C01 **diez veces al día**. En producción no existe «casi nunca»: existe «cuántas veces al día».
:::

Por eso un equipo de producción casi nunca discute si algo va a pasar. Discute cuántas veces va a pasar y qué hace el sistema cuando pase.

### También del tiempo

La probabilidad también describe **tiempo**. Si un servidor estuvo caído 43 minutos en un mes de 30 días (43,200 minutos), estuvo arriba 43,157 de 43,200: el 99.9 % del tiempo. Dicho como probabilidad: si eliges un instante al azar del mes, la probabilidad de encontrarlo caído es 0.1 %. Esa fracción del tiempo en que algo funciona es su [[disponibilidad]], y tiene su propia sección más adelante.

¿De dónde salen estos números? Hay dos fuentes. Se **miden**: cuentas en los registros (*logs*) cuántos requests tardaron de más y lo divides entre el total. O se **suponen** para diseñar, y entonces se dicen como supuesto. En la Ronda, casi todas las disponibilidades de cada pieza son ilustrativas: en tu sistema se miden.

:::ojo
**Di siempre «1 % de qué».** «1 % de los requests», «1 % del tiempo» y «1 % de probabilidad de que se caiga este mes» son tres cosas distintas. Un servicio puede responder bien el 99.9 % de sus requests y aun así haber estado caído 3 horas un domingo de madrugada, cuando casi nadie lo usaba. Mezclar esas unidades es la fuente número uno de cuentas sin sentido.
:::

### Las dos reglas de siempre

1. Una probabilidad va de 0 (no pasa nunca) a 1 (pasa siempre).
2. Si unas opciones cubren todos los casos y no pueden pasar a la vez, sus probabilidades suman 1. Un request es lento o no lo es: P(lento) + P(no lento) = 0.01 + 0.99 = 1.

La segunda regla parece obvia, pero de ella sale el truco más útil de la lección. Lo ves en la siguiente sección.

## Independencia: la regla del producto y el complemento {Independence: the product rule and the complement}

Imagina un request que necesita a dos servicios, A y B. Cada uno, de vez en cuando, tarda de más. Para que el dibujo se vea, supongamos que cada uno es lento 1 de cada 10 veces. En un sistema real sería mucho menos, pero la cuenta es la misma.

### Independientes: uno no te dice nada del otro

Dos eventos son **independientes** si saber que pasó uno no cambia la probabilidad del otro. A esa propiedad se le llama [[independencia]]. Si A y B corren en máquinas distintas y se atoran por razones distintas, cada uno por su propio disco o su propia memoria, que A haya sido lento no te dice nada de B: B sigue siendo lento 1 de cada 10 veces.

Son independientes dos lanzamientos de una moneda, dos dados o dos servidores en edificios distintos que fallan por su propio hardware. **No** lo son «llueve» y «hay tráfico», ni dos servidores que recibieron la misma versión con el mismo error. Si sabes que llovió, el tráfico es más probable. Si sabes que uno de esos servidores falló, el otro casi seguro también.

En el caso C08 de «Qué es un modelo» apareció la notación P(contacto | click): la probabilidad de que alguien contacte al vendedor **sabiendo** que hizo clic. La barra se lee «dado». Con ella, la independencia se escribe corto: A y B son independientes cuando P(B | A) = P(B). Saber A no mueve nada.

### La regla del producto

Si A y B son independientes, la probabilidad de que pasen **los dos** es el producto de sus probabilidades. Es la [[regla-producto|regla del producto]]:

P(A y B) = P(A) × P(B)

¿Por qué multiplicar? Piensa en 100 requests. A es rápido en 90. De esos 90, B es rápido en 9 de cada 10, o sea en 81. Los dos rápidos: 81 de 100, que es 0.9 × 0.9 = 0.81. Multiplicar es tomar una fracción de una fracción.

En general, P(A y B) = P(A) × P(B | A): primero la fracción en que pasa A, y luego, dentro de esos casos, la fracción en que también pasa B. La independencia es justo lo que permite cambiar P(B | A) por P(B), un número que puedes medir por separado.

:::figura probabilidad-cuadricula
Cada cuadrito es un request. Las filas dicen cómo le fue al servicio A y las columnas, al B. Como son independientes, la fila de «A lento» tiene la misma proporción de «B lento» que cualquier otra fila.
:::

### El complemento: lo que no pasa

La probabilidad de que algo **no** pase es 1 menos la probabilidad de que pase. Es el [[complemento]]: P(no A) = 1 − P(A). Sale directo de la segunda regla de la sección anterior: «pasa» y «no pasa» cubren todo y suman 1.

Su gran uso es contestar preguntas de «**al menos uno**». ¿Qué probabilidad hay de que al menos uno de los dos servicios sea lento? Contar todas las formas en que eso pasa es engorroso: A lento, B lento, o los dos. Su contrario, en cambio, es una sola cosa: los dos rápidos. Entonces:

P(al menos uno lento) = 1 − P(los dos rápidos) = 1 − 0.81 = 0.19

:::cuenta Dos servicios independientes, cada uno lento 1 de cada 10 veces
Los dos rápidos // regla del producto | 0.9 × 0.9 | 0.81
Los dos lentos | 0.1 × 0.1 | 0.01
Solo uno lento // A lento y B rápido, o al revés | 0.1 × 0.9 + 0.9 × 0.1 | 0.18
Al menos uno lento // el complemento de «los dos rápidos» | 1 − 0.81 | **0.19**
= Las tres primeras filas cubren todos los casos y suman 0.81 + 0.01 + 0.18 = 1. «Al menos uno lento» es 0.18 + 0.01 = 0.19: lo mismo que dio el complemento con una sola resta.
:::

### Por qué no se suman

La tentación es sumar: 10 % + 10 % = 20 %. Está mal, y el dibujo dice por qué: el cuadrito naranja, donde los dos son lentos, se cuenta dos veces, una en la fila de A y otra en la columna de B. La suma correcta le resta lo que contó doble: 0.1 + 0.1 − 0.01 = 0.19.

Sumar probabilidades solo es correcto cuando los eventos **no pueden pasar a la vez**. Se llaman **excluyentes**: «el request tardó menos de 100 ms» y «tardó entre 100 y 200 ms» se suman sin problema. Para «al menos uno» de varios eventos que sí pueden coincidir, usa el complemento.

Con probabilidades chicas la suma casi atina. Con 1 % cada uno: 1 − 0.99 × 0.99 = 1.99 %, contra el 2 % de la suma. Por eso el error se esconde: con dos piezas «funciona», y con cien se vuelve un disparate. Con cien piezas de 1 %, la suma diría 100 %, y la cuenta correcta, 1 − 0.99¹⁰⁰, da ≈ 63 %: lo ves a fondo en la siguiente sección.

:::ojo
**Independiente no es lo mismo que excluyente.** Excluyentes: no pueden pasar juntos, como que un request sea rápido y lento. Independientes: uno no cambia la probabilidad del otro, como dos dados. De hecho, dos eventos excluyentes que sí pueden pasar nunca son independientes: si pasó uno, el otro ya tiene probabilidad 0.
:::

## Fan-out: un request que espera a muchos {Fan-out: one request that waits for many} [extra]

Muchos sistemas parten un request en pedazos. Un buscador con un índice que no cabe en una máquina lo reparte en 100 pedazos, y cada búsqueda les pregunta a los 100 a la vez. Una página de inicio arma 30 bloques, cada uno pedido a otro servicio. En C11, el asistente con documentos de la Ronda, cada pregunta busca por palabras y por significado al mismo tiempo. A esto se le llama [[fan-out]]: un request se abre en abanico hacia N servicios y **espera a todos**.

Esperar a todos tiene una consecuencia: el request es tan lento como el más lento de sus N servicios. Basta con que uno tarde para que el request tarde. En la lección de percentiles lo viste de pasada; aquí va de dónde sale la cuenta y qué se hace con ella.

### La cuenta

En la lección de percentiles viste el [[p99]]: el valor bajo el cual queda el 99 % de las mediciones. Por definición, cada servicio tarda más que su propio p99 en ≈ 1 de cada 100 requests. Llamemos «lento» a eso, y supongamos que cada servicio es lento por su cuenta, sin depender de los demás. Entonces:

- Un servicio es rápido con probabilidad 0.99.
- Los N son rápidos a la vez con probabilidad 0.99 × 0.99 × … × 0.99 = 0.99^N, por la regla del producto.
- El request es lento si **al menos uno** es lento: 1 − 0.99^N, por el complemento.

:::cuenta El request toca la cola: 1 − 0.99^N
N = 1 | 1 − 0.99 | 1 %
N = 10 | 1 − 0.99¹⁰ = 1 − 0.904 | ≈ 9.6 %
N = 100 | 1 − 0.99¹⁰⁰ = 1 − 0.366 | ≈ 63.4 %
= Con 100 servicios, casi dos de cada tres requests tocan la [[cola-distribucion|cola]] de alguno: el p99 de cada pieza se vuelve la latencia **típica** del conjunto. Es el argumento central de Jeffrey Dean y Luiz André Barroso en *The Tail at Scale* (2013).
:::

:::figura probabilidad-fanout
La curva naranja es 1 − 0.99^N: con 69 servicios ya es la mitad. La verde es lo mismo si cada servicio cumple su p99.9 en vez de su p99. La punteada es la cuenta equivocada: sumar 1 % por servicio.
:::

Fíjate en la línea punteada. Con N chica, sumar casi atina: con 10 servicios la suma da 10 % y la cuenta correcta, 9.6 %. De ahí el atajo «con pocas piezas, P(lento) ≈ N × p». Pero la suma crece sin freno y llega a 100 % con 100 servicios, lo cual es imposible (siempre hay requests con suerte). La curva de verdad se dobla y nunca llega a 100 %.

:::calculadora probabilidad-fanout
Prueba también p = 5 % con N = 20: la suma ya dice 100 %, y la cuenta correcta, ≈ 64 %.
:::

### Verlo funcionar

La fórmula se puede comprobar sin fórmulas: simulas muchos requests, a cada uno le sorteas sus N servicios y cuentas cuántos salieron lentos. Python trae un sorteador, `random.random()`, que da un número al azar entre 0 y 1: si sale menor que 0.01, ese servicio fue lento, cosa que pasa 1 de cada 100 veces. `random.seed(7)` fija la [[semilla]], para que el sorteo salga igual cada vez que lo corras.

```python
import random

random.seed(7)
p_lento = 0.01        # cada servicio tarda de más el 1 % de las veces
requests = 100_000    # cuántos requests simulamos

for n in (1, 10, 100):
    lentos = 0
    for _ in range(requests):
        # el request es lento si AL MENOS UNO de sus n servicios es lento
        if any(random.random() < p_lento for _ in range(n)):
            lentos += 1
    simulado = 100 * lentos / requests
    formula = 100 * (1 - (1 - p_lento) ** n)
    print(f"N = {n:3}   simulado: {simulado:5.2f} %   fórmula: {formula:5.2f} %")
```

```salida
N =   1   simulado:  1.02 %   fórmula:  1.00 %
N =  10   simulado:  9.62 %   fórmula:  9.56 %
N = 100   simulado: 63.40 %   fórmula: 63.40 %
```

La simulación no sabe nada de fórmulas: solo sortea y cuenta. Aun así, sus números difieren de los de la fórmula en menos de 0.1: 9.62 contra 9.56, por ejemplo. Lo que queda de diferencia es el ruido de sortear 100,000 veces y no infinitas: es la probabilidad vista como frecuencia.

### Al revés: qué le pides a cada servicio

En un diseño la pregunta suele ir al revés: si quiero que 99 de cada 100 requests sean rápidos, ¿qué tiene que cumplir cada servicio? Necesitas que q^N = 0.99, donde q es la probabilidad de que un servicio sea rápido. Despejando, q = 0.99^(1/N), que es casi exactamente 1 − 0.01 ÷ N.

- Con N = 10: q ≈ 1 − 0.001 = 0.999. Cada servicio tiene que cumplir su **p99.9**.
- Con N = 100: q ≈ 0.9999. Cada servicio tiene que cumplir su **p99.99**.

Por eso en sistemas con mucho fan-out no basta con vigilar el p99 de cada pieza: se vigila su p99.9 o su p99.99. La curva verde de la figura muestra la diferencia: con 100 servicios que cumplen su p99.9, solo 9.5 % de los requests es lento, en vez de 63.4 %.

Las otras salidas son preguntar a menos servicios, recortar la cola de cada uno, contestar con lo que llegó a tiempo (en la Ronda, el buscador de C07 responde con 3 de sus 4 pedazos si uno no llega, y marca la respuesta como parcial) o mandar una copia del request a otra réplica, otra copia del mismo servidor, cuando tarda. Esto último lo ves al final de esta sección.

:::profundo Por qué los p99 de dos tramos no se suman
El fan-out espera piezas en paralelo. Con piezas en serie, una detrás de otra, la regla del producto también sorprende. Dos tramos independientes, A y B, tardan cada uno 10 ms el 98 % de las veces y 100 ms el 2 % restante. Como solo el 98 % cae en 10 ms, el p99 de cada tramo es 100 ms, y la suma de los dos p99 da 200 ms. Pero el p99 del request completo es otro:

:::cuenta Dos tramos independientes con p99 = 100 ms cada uno
Los dos rápidos | 0.98 × 0.98 | 96.04 % → 20 ms
Uno lento // A lento y B rápido, o al revés | 2 × 0.98 × 0.02 | 3.92 % → 110 ms
Los dos lentos | 0.02 × 0.02 | 0.04 % → 200 ms
p99 del request // el 99 % de los requests cae dentro de 96.04 % + 3.92 % | 96.04 % < 99 % ≤ 99.96 % | **110 ms**
= Sumar los p99 da 200 ms, pero el real es 110 ms: es raro que los dos tramos tengan su peor caso en el mismo request. Si los dos tramos fueran lentos siempre en los mismos requests (la misma foto gigante hace lento cada tramo), la suma sería exacta.
:::

La Ronda (M03) saca la conclusión práctica: la suma de los p99 sirve para **repartir** el presupuesto de latencia entre los tramos, pero el cumplimiento se **mide** de punta a punta, con el [[histograma]] del request completo.
:::

### Copias contra la cola: el hedging

Hay un caso en que la independencia suele valer, y se aprovecha. Si un servidor tarda de más por una pausa al azar (el programa se detiene a limpiar su memoria, u otro programa en la misma máquina acapara la CPU), es raro que otra réplica tenga su pausa en el mismo instante. Entonces, si un request no ha respondido cuando ya pasó su p95, se manda una **copia** a otra réplica y se usa la primera respuesta que llegue. Se llama *hedging*. Solo se paga en el ≈ 5 % de los requests que llegan a ese punto: ≈ 5 % más de carga para recortar mucho la cola.

Y solo funciona si la lentitud de las dos réplicas es independiente. Si un request tarda porque su foto es enorme, las dos copias tardan igual. La Ronda (M03) lo recomienda para lecturas baratas que ya tienen réplicas, no para inferencia cara en una GPU cerca de su límite, donde ese 5 % extra cae en la pieza más cara.

## Disponibilidad, los nueves y el presupuesto de error {Availability, the nines and the error budget}

La [[disponibilidad]] (*availability*) es la fracción del tiempo, o de los requests, en que un servicio responde bien. Se mide de dos formas:

- **Por tiempo:** minutos arriba ÷ minutos totales. Es sencilla, pero trata igual un minuto de las 4 de la mañana que uno del pico.
- **Por requests:** requests buenos ÷ requests válidos. Es la que usa C01. Cada respuesta trae un código de tres cifras: los que empiezan con 5, como 500 o 503, son errores del servidor, y los que empiezan con 4, errores de quien llama. Un request bueno no termina en un error del servidor y responde en 300 ms o menos. Válidos son todos menos los que fallan por culpa de quien llama: una foto de 50 MB, que se rechaza por pesada, no cuenta ni como buena ni como mala. Esa medida es un [[sli|SLI]], y la meta que se le pone, 99.9 % en 30 días, es su [[slo|SLO]], como viste en la lección de percentiles. C01 tiene además otro SLO, el de latencia: p99 ≤ 200 ms, medido en su API.

### Los nueves

Las disponibilidades se nombran por sus [[nueves]] (*the nines*): 99.9 % son «tres nueves» y 99.99 %, «cuatro nueves». En la lección de unidades ya los convertiste en tiempo: un mes de 30 días tiene 30 × 24 × 60 = 43,200 minutos, y la caída permitida es el complemento de la disponibilidad por esa ventana, (1 − disponibilidad) × 43,200. Con 99.9 % son **43.2 minutos**; con 99.99 %, **4.32 minutos**; con 99.999 %, ≈ 26 segundos. Cada nueve más divide entre 10 el tiempo que te puedes permitir caído.

:::figura probabilidad-nueves
Las mismas cifras como barras. Las de cuatro y cinco nueves ya son rayas: a esta escala casi no se ven.
:::

Lo que cada nivel suele pedir, según la hoja de números de la Ronda (una regla práctica, no una norma):

| Disponibilidad | Al mes | Al día | Lo que suele hacer falta |
|---|---|---|---|
| 99 % | 7.2 h | 14.4 min | Una réplica que se reinicia sola |
| 99.5 % | 3.6 h | 7.2 min | Dos réplicas; alertas atendidas en horario de oficina |
| 99.9 % | 43.2 min | 1.4 min | Una réplica de repuesto en otra zona, cambios de versión sin cortes, volver a la versión anterior en minutos y alguien de guardia |
| 99.99 % | 4.3 min | 8.6 s | Detectar la falla y cambiar de réplica en automático: nadie arregla nada a mano en 4 minutos |

### 99.9 % no es «casi nunca»

Tres nueves suena a perfección. No lo es: son 43 minutos al mes y, en C01, con 10 millones de requests al día, 0.1 % son **10,000 requests fallidos cada día**. Un SLO de 99.9 % no promete que nada falle: promete que lo que falla cabe en ese número.

### El presupuesto de error

Si el SLO es 99.9 %, el 0.1 % que sobra es el [[error-budget|presupuesto de error]] (*error budget*): lo que se te permite fallar en la ventana. En C01 son 43.2 minutos al mes, medido en tiempo, o 0.001 × 10,000,000 × 30 = **300,000 requests al mes**, ≈ 10,000 al día, medido en requests. Lo viste de pasada en la lección de unidades; aquí va para qué sirve.

La idea viene de la ingeniería de confiabilidad de Google (*site reliability engineering*, SRE): tratarlo como un presupuesto de verdad, que **se gasta**: en lanzar versiones nuevas (cada [[deploy]] arriesga un poco), en experimentos, en mantenimiento. Un presupuesto intacto a fin de mes no es un logro: quiere decir que el equipo pudo moverse más rápido. Uno agotado quiere decir que hay que frenar.

:::cuenta Cuánto presupuesto se come un deploy malo en C01
Presupuesto del mes, en requests | 0.001 × 10,000,000 × 30 | 300,000
Requests por hora, en promedio | 10,000,000 ÷ 24 | ≈ 416,667
Requests que falla un deploy malo // hace fallar el 5 % durante 2 horas | 416,667 × 2 × 0.05 | ≈ 41,667
Parte del presupuesto que se comió | 41,667 ÷ 300,000 | **≈ 14 %**
= Un solo incidente de dos horas se come casi la séptima parte del mes.
:::

:::calculadora probabilidad-presupuesto
Prueba media hora con todo caído: 100 % de los requests durante 0.5 h. Se come ≈ 69 % del mes, lo mismo que 30 de sus 43.2 minutos: medir en requests o en tiempo da igual cuando el tráfico es parejo.
:::

## El presupuesto en la práctica {The error budget in practice} [extra]

Tres cosas que hacen los equipos con estos números: volver rápido cuando algo falla, vigilar qué tan rápido se gasta el presupuesto y decidir de antemano qué hacer cuando se acaba.

### De dónde salen los minutos

Los minutos caídos de un mes son **cuántas veces** falla algo multiplicado por **cuánto tarda** en volver. Los mismos 43 minutos pueden ser una sola caída de 43 minutos o diez de 4.3 minutos. De ahí salen las dos palancas para subir la disponibilidad: fallar menos veces o volver más rápido. Las dos cantidades tienen nombre en inglés: el *MTBF* (*mean time between failures*, el tiempo promedio entre fallas) y el *MTTR* (*mean time to recovery*, el tiempo promedio para recuperarse).

La segunda palanca suele ser la más barata. Si una versión nueva sale mal, regresar a la anterior (*rollback*) en 3 minutos en vez de 30 divide el daño entre 10, sin evitar ni una sola falla. Y explica la última fila de la tabla de los nueves: con 4 minutos al mes, para cuando alguien abre su computadora ya se acabó el presupuesto del mes; la recuperación tiene que ser automática.

### Qué tan rápido se gasta

Vuelve al deploy malo de C01: con 5 % de errores se gasta 50 veces más rápido de lo permitido (5 % ÷ 0.1 %), y a ese ritmo el presupuesto del mes completo dura 14.4 horas. Esa velocidad de gasto se llama *burn rate*, y en la Ronda (M12) las alertas se arman con ella: no esperan a que el presupuesto se acabe, avisan cuando se está gastando demasiado rápido.

### Una política escrita antes

Para que sirva, el presupuesto se convierte en una **política**, acordada con producto y escrita antes de que haya problemas. Un ejemplo (cada equipo pone sus propios cortes):

| Presupuesto que queda | Qué se hace |
|---|---|
| Más de 50 % | Se lanza normal |
| Entre 10 y 50 % | Se lanza con más cuidado: pruebas más largas, nada riesgoso en viernes |
| Menos de 10 % | Se congela todo lo que no sea para mejorar la confiabilidad |

:::nota SLO no es SLA
Un **SLA** (*service level agreement*) es un contrato con consecuencias si no se cumple, como créditos o multas. Se pone más laxo que el SLO interno, para tener margen antes de pagar. Y el SLA de un proveedor de nube es una promesa de **créditos**, no de disponibilidad: el de los balanceadores de AWS te da créditos en la factura si uno repartido en varias zonas baja de 99.99 % en el mes, pero no impide que baje.
:::

## Piezas en serie y réplicas en paralelo {Pieces in series and replicas in parallel}

Un request de C01 pasa por tres piezas, una detrás de otra: el balanceador (ALB), que reparte el tráfico; el gateway, un programa en CPU que abre y prepara la foto, y Triton, el servidor que corre la ResNet-50 en una [[gpu|GPU]] T4. Esas piezas están **en serie**: el request necesita a las tres. Además, el gateway y Triton existen en dos copias, una en cada zona, y esas copias están **en paralelo**: basta con una.

### En serie se multiplican las disponibilidades

Si el request necesita todas las piezas, funciona solo cuando funciona cada una. Con fallas independientes es la regla del producto aplicada a «funciona»:

disponibilidad en serie = a₁ × a₂ × … × aₙ

:::cuenta Tres piezas en serie, con valores ilustrativos
Las tres al 99.9 % // ≈ 130 min al mes | 0.999 × 0.999 × 0.999 | ≈ 99.70 %
Al 99.99 %, 99.95 % y 99.9 % // ≈ 69 min al mes | 0.9999 × 0.9995 × 0.999 | ≈ 99.84 %
Los minutos al mes de cada una, sumados | 4.32 + 21.6 + 43.2 | ≈ 69
= El conjunto es **peor que su peor pieza**, que permite 43 minutos. En serie, cada pieza resta.
:::

La última fila es un atajo útil: con disponibilidades altas, los minutos caídos de las piezas en serie **casi se suman**. Es el «sumar casi atina con probabilidades chicas» de la sección de independencia, ahora a tu favor: 0.0001 + 0.0005 + 0.001 = 0.0016, y la cuenta exacta da 0.0015994.

De aquí salen dos reglas de diseño. Con fallas independientes, **un sistema no puede estar más disponible que el producto de lo que tiene en serie**. Y pase lo que pase, nunca más que su pieza más débil: si tu servicio llama, sin plan B, a una base de datos de 99.95 %, prometer 99.99 % es prometer algo imposible.

### En paralelo se multiplican las indisponibilidades

Si hay k copias de una pieza y **basta con una**, la pieza solo falla cuando fallan todas. Tener copias de sobra se llama [[redundancia]] (*redundancy*), y cada copia es una **réplica**: el mismo programa, corriendo en otra máquina. Si cada réplica está disponible con probabilidad a y fallan por separado, fallan todas con probabilidad (1 − a)^k, y por el complemento:

disponibilidad con k réplicas = 1 − (1 − a)^k

- Dos réplicas al 99 %: 1 − 0.01² = 1 − 0.0001 = **99.99 %**. Dos piezas de dos nueves dan cuatro nueves.
- Dos réplicas al 99.5 %: 1 − 0.005² = 1 − 0.000025 = **99.9975 %**: ≈ 1 minuto al mes, contra 216 de una sola.
- Tres réplicas al 99 %: 1 − 0.01³ = 99.9999 %: ≈ 2.6 segundos al mes.

Cada réplica más multiplica la indisponibilidad por (1 − a): con réplicas de 99 %, cada una agrega dos nueves. Eso, en el papel. La siguiente sección dice por qué la realidad casi nunca da esas cifras.

### N+1: una de sobra

¿Cuántas réplicas? La regla más común se llama **N+1**: N son las que necesitas para atender el tráfico, y la +1 es la de repuesto, para que perder una no se note. En la lección de unidades contaste así las T4 de C01; aquí importa qué le pasa a la que queda:

:::cuenta Por qué C01 tiene dos T4 y no una
Fotos por segundo que se planean por T4 // la mitad de las ≈ 1,200 medidas | 0.5 × 1,200 | 600
GPUs para el tráfico // el pico de diseño es 500 por segundo | 500 ÷ 600 = 0.83, redondeado hacia arriba | 1
N+1, una por zona | 1 + 1 | **2**
Carga de cada una en el pico de diseño // de su máximo | 250 ÷ 1,200 | ≈ 21 %
Si cae una zona // la que queda, de su máximo | 500 ÷ 1,200 | ≈ 42 %
= La segunda GPU no es por el tráfico, es por la disponibilidad: la que queda aguanta sola el pico de diseño.
:::

La de repuesto tiene que estar donde no le pegue lo mismo que a la otra. Por eso C01 pone cada réplica en una **zona de disponibilidad** (*availability zone*, AZ) distinta: un centro de datos, o un grupo de ellos, con su propia electricidad, su enfriamiento y su red, separado de los demás de la misma **región**, que es el grupo de zonas que la nube tiene en una misma área geográfica. Dos réplicas en la misma máquina, o en la misma zona, **no son un N+1 de verdad**: si se va la luz, caen juntas.

:::diagrama probabilidad-c01
Los porcentajes son valores ilustrativos de la Ronda. Toca cada caja para ver por qué está ahí, y usa «Recorrer» para seguir un request normal, la caída de una zona y el plan B.
:::

Con esas cifras, la cadena completa de C01 queda así: el balanceador, que ya vive en las dos zonas, al 99.99 %; el gateway en dos zonas, con 1 − 0.0005² ≈ 99.99998 %, y Triton en dos zonas, con 1 − 0.005² = 99.9975 %. Multiplicadas en serie dan ≈ 99.99 %: unos **5 minutos al mes**, muy por debajo de los 43 que permite el SLO. Y 4 de esos 5 minutos los pone el balanceador, la única pieza que entra a la cuenta sin una réplica en paralelo (su 99.99 % ya incluye sus propias copias).

:::calculadora probabilidad-disponibilidad
Pon 3 piezas en serie con una réplica de 99.9 % cada una: ≈ 130 minutos al mes, como en la cuenta de arriba. Luego dale 2 réplicas a cada pieza y mira los minutos bajar a segundos.
:::

### Un reintento es una réplica en el tiempo

Volver a intentar algo que falló (*retry*) usa la misma cuenta. Si cada intento falla el 1 % de las veces, sin depender del anterior, los dos intentos fallan solo 0.01 × 0.01 = 0.01 % de las veces. «Sin depender del anterior» es la letra chica: si el intento falló porque el servidor está caído, el segundo va a fallar igual.

### Sacar al modelo del camino crítico

Hay algo todavía mejor que tener copias de una pieza: que el producto no la necesite, o sea, sacarla del **camino crítico**, lo que tiene que funcionar para que el producto funcione. En C01, si el modelo no contesta en 300 ms, el backend de publicación (el programa del marketplace que recibe lo que publica Ana) muestra el selector de categorías y Ana elige a mano. Ese [[fallback]] no depende del modelo, así que la disponibilidad del modelo **deja de multiplicarse** con la de publicar: si el modelo falla, publicar sigue funcionando, con un paso más para Ana. Por eso a C01 le basta con 99.9 % en una sola región. Un caso de pagos como C09, donde el modelo decide dentro de cada compra, pide 99.99 %: ≈ 4.3 minutos al mes.

## Cuando la independencia se rompe {When independence breaks}

La cuenta de la redundancia, 1 − (1 − a)^k, esconde una suposición enorme: que las réplicas fallan **cada una por su lado**. Cuando una misma causa las tumba a todas a la vez, se habla de una [[falla-correlacionada|falla correlacionada]], o de causa común. Es lo que de verdad tumba a los sistemas que tienen redundancia.

### De dónde salen las fallas que llegan juntas

- **El mismo error en todas las réplicas.** Una versión con un error, o un cambio de configuración, se aplica a todas a la vez. Las dos zonas quedan perfectamente sanas… corriendo el mismo error.
- **Todo un dominio de falla.** Lo que depende de un mismo punto débil forma un *dominio de falla* (*failure domain*): una máquina, un rack (el mueble donde se apilan varias máquinas), una zona, una región. Dos réplicas en la misma zona caen juntas cuando cae la zona.
- **Una dependencia compartida.** Las dos réplicas leen la misma base de datos, el mismo caché (una copia rápida de datos que se consultan seguido) o el mismo certificado de seguridad (el archivo con el que un servidor demuestra quién es), que vence el mismo día para todas. Hasta el plan B puede depender de lo que falló: la Ronda (M15) da el ejemplo de un plan B que guarda sus respuestas en el mismo servidor de caché que usa el camino principal, en la misma zona. Si ese servidor se cae, caen los dos.
- **La sobrecarga que se contagia.** Si una réplica cae y la otra no aguanta el doble de tráfico, cae también: la segunda falla la causó la primera. Por eso el N+1 se mide con el tráfico **del pico**: la T4 que queda en C01 tiene que aguantar 500 por segundo sola.
- **Reintentos en manada.** Si un servicio se cae y cada cliente reintenta 3 veces, el servicio recibe hasta 4 veces su tráfico justo cuando está más débil. Los reintentos de miles de clientes llegan juntos, no al azar: es una tormenta de reintentos (*retry storm*).

### La causa común manda

Supón que, además de sus fallas propias, de vez en cuando algo tumba a las dos zonas de Triton a la vez: digamos el 0.1 % del tiempo, por un deploy malo o una configuración rota. La cuenta cambia así:

:::cuenta Triton en dos zonas, sin y con una causa común
Dos zonas independientes // cada una al 99.5 %: ≈ 1 min al mes | 1 − 0.005² | 99.9975 %
Con una causa común el 0.1 % del tiempo // funcionan las réplicas y no pasa la causa común: ≈ 44 min al mes | 0.999975 × 0.999 | ≈ 99.90 %
La cadena completa de C01, sin causa común // ≈ 5 min al mes | 0.9999 × 0.99999975 × 0.999975 | ≈ 99.99 %
La misma cadena, con la causa común // ≈ 49 min al mes | 0.9999 × 0.99999975 × 0.999975 × 0.999 | ≈ 99.89 %
= Con la causa común, C01 queda **apenas debajo** de su SLO de 99.9 %. De los 44 minutos de Triton, 43 son de la causa común: la redundancia compra nueves solo contra las fallas independientes.
:::

Fíjate qué pasó. La segunda zona bajó la falla propia de Triton de 216 minutos al mes a ≈ 1, pero no tocó los 43 de la causa común. Una tercera zona tampoco los tocaría. Contra una causa común, más copias de lo mismo no sirven.

:::diagrama probabilidad-causa-comun
Recorre los cuatro casos: una falla propia, dos causas comunes y la defensa.
:::

### Cómo se defiende uno

Contra una causa común no sirve multiplicar réplicas. Sirve que la causa **no llegue a todas a la vez**:

- **Cambiar de a poco.** Una versión nueva entra primero a una parte chica del tráfico, en C01 el 5 %, y a una zona a la vez. A esa primera parte se le llama *canary*, por los canarios que los mineros bajaban a la mina para detectar gases. Si los errores suben, se regresa a la versión anterior en minutos, antes de que llegue a la otra zona. Lo ves en la Ronda, en M11.
- **Un plan B que no comparta nada.** El selector manual de C01 no usa el modelo ni nada de lo que el modelo usa: si se cae todo lo del modelo, sigue ahí. Un plan B que depende de lo mismo que falló no es plan B.
- **Reintentar con medida.** Pocos reintentos, en una sola capa del sistema, con esperas cada vez más largas y solo para lo que es seguro repetir. Lo ves en la lección «Timeouts, reintentos e idempotencia».
- **Ensayarlo.** Apagar una zona a propósito en un ensayo programado (*game day*) para descubrir qué compartían las réplicas sin que nadie lo supiera.

:::analogia Dos despertadores
Para un vuelo muy temprano pones dos despertadores. Si cada uno falla el 5 % de las veces, por su cuenta, los dos fallan a la vez solo 0.05 × 0.05 = 0.25 % de las veces. Pero si los dos son eléctricos y están en el mismo enchufe, un apagón en la madrugada los apaga juntos. Esa noche, tus dos despertadores valen lo mismo que uno.

**Dónde se rompe:** en tu cuarto la causa común se ve, es el enchufe. En un sistema casi nunca se ve: la misma librería, la misma configuración, el mismo certificado que vence el mismo día. Por eso hay que buscarla a propósito.
:::

## Valor esperado: el promedio a la larga {Expected value: the long-run average} [extra]

Hasta aquí contamos **qué tan seguido** pasa algo. Muchas decisiones también necesitan **cuánto cuesta** cuando pasa. La herramienta que junta las dos cosas es el [[valor-esperado|valor esperado]] (*expected value*): multiplicas cada resultado posible por su probabilidad y sumas todo.

valor esperado = resultado₁ × P(resultado₁) + resultado₂ × P(resultado₂) + …

Con un dado, cada cara sale con probabilidad 1/6, así que el valor esperado es (1 + 2 + 3 + 4 + 5 + 6) × 1/6 = 21 ÷ 6 = **3.5**. Nunca sale un 3.5. El valor esperado no es «lo que va a salir»: es **el promedio a la larga**. Si tiras el dado mil veces y promedias, vas a quedar muy cerca de 3.5. Es la misma idea de frecuencia de la primera sección, ahora con valores en vez de conteos.

### Ya lo usaste sin nombrarlo

Varias cuentas de esta lección eran valores esperados:

- **Requests fallidos al día.** Cada request aporta 1 falla con probabilidad 0.001 y 0 con probabilidad 0.999: su valor esperado es 0.001, y el de 10 millones de requests, **10,000**. Con N repeticiones independientes de algo de probabilidad p, se esperan N × p.
- **Minutos caídos al mes.** Cada minuto está caído con probabilidad 1 − a, así que se esperan 43,200 × (1 − a) minutos.

### Decidir con dinero: C09

En «Qué es un modelo» viste el [[umbral]] de C09, el caso de fraude con tarjetas, con la idea de «lo que esperas perder». Eso era un valor esperado. Hagámoslo completo, con las tres acciones del sistema real. Un pago de US$30 llega con una probabilidad de fraude [[calibracion|calibrada]] de 0.05. Los costos que usa la Ronda:

- Aprobar un fraude cuesta el monto más ≈ US$15 de comisión: 30 + 15 = US$45.
- Rechazar a un cliente bueno cuesta ≈ US$5–10, lo que fije el negocio; se usa el punto medio, US$7.5.
- Pedir una verificación extra (*step-up*, como un código en el celular) tiene sus propios riesgos: se supone que ≈ 20 % de los fraudes la pasa igual y que ≈ 15 % de los clientes buenos abandona la compra.

:::cuenta El costo esperado de cada acción, para un pago de US$30 con p = 0.05
Aprobar // solo cuesta si es fraude | 0.05 × 45 | US$2.25
Rechazar // solo cuesta si era bueno | 0.95 × 7.5 | US$7.13
Step-up // el fraude que pasa más el cliente bueno que abandona | 0.05 × 0.20 × 45 + 0.95 × 0.15 × 7.5 = 0.45 + 1.07 | **US$1.52**
= Gana el step-up: es la acción con menor costo **esperado**. No quiere decir que este pago vaya a costar US$1.52: va a costar US$0, US$7.5 o US$45. Quiere decir que, entre muchísimos pagos como este, ese es el promedio.
:::

Para el sistema completo, la cuenta se hace por cada 1,000 pagos. Hoy, con las ≈ 400 reglas que ya tiene, a C09 se le cuelan fraudes en ≈ 0.08 % de los pagos (≈ 8,000 de 10 millones al día), con un monto promedio de ≈ US$45. En cada 1,000 pagos se esperan 0.8 fraudes, y 0.8 × (45 + 15) = **US$48** de pérdida. Es la [[metrica-negocio|métrica de negocio]] del caso: un modelo nuevo se juzga por cuánto baja ese costo por cada 1,000 pagos, contando también a los clientes buenos que rechace, no por su [[accuracy]].

:::ojo
**El valor esperado no lo es todo.** Perder US$100 cada mes y tener 1 probabilidad en 1,000, cada mes, de perder US$100,000 tienen el mismo valor esperado: US$100 al mes. El primero es un gasto; el segundo puede quebrar una empresa. El promedio los iguala, y por eso lo raro y catastrófico (borrar datos, filtrar información) se diseña aparte, con copias en otro lugar, permisos y ensayos de recuperación.
:::

### Tasas: el valor esperado por segundo

Una [[tasa]] (*rate*) es cuántas veces pasa algo por unidad de tiempo: requests por segundo, fallas por día. Es un valor esperado: el número de eventos que se espera en cada segundo. Las [[qps|QPS]] (*queries per second*) de las que se habla en todo diseño son una tasa.

:::cuenta Las tasas de C01
Requests por segundo, en promedio | 10,000,000 ÷ 86,400 s | ≈ 116
Requests por segundo en el pico del día // la Ronda supone 3 veces el promedio | 116 × 3 | ≈ 350
Fallas por segundo, si se gasta justo el presupuesto // el 0.1 % de los requests | 116 × 0.001 | ≈ 0.116
Fallas por minuto | 0.116 × 60 | ≈ 7
Segundos entre dos fallas, en promedio | 1 ÷ 0.116 | ≈ 8.6
= Las tasas se convierten como cualquier unidad: por segundo × 60 = por minuto, y por segundo × 86,400 = por día.
:::

Una tasa dice cuántos llegan **en promedio**. No dice cuántos llegan en cada segundo, y esa diferencia importa mucho para decidir cuántas máquinas poner. Es el tema de la siguiente sección.

## Llegadas al azar: por qué se amontonan {Random arrivals: why they bunch up} [extra]

«10 requests por segundo» no quiere decir que cada segundo lleguen 10. Imagina 1,000 personas con la app abierta. En cada segundo, cada una pide algo con probabilidad 1 %, sin ponerse de acuerdo con las demás. En promedio llegan 1,000 × 0.01 = 10 por segundo, pero cada segundo es un sorteo nuevo:

```python
import random

random.seed(3)
usuarios = 1_000     # gente con la app abierta
p = 0.01             # cada uno pide algo en un segundo dado con probabilidad 1 %
                     # en promedio: 1,000 × 0.01 = 10 requests por segundo

conteos = []
for segundo in range(3_600):                                # una hora
    llegan = sum(random.random() < p for _ in range(usuarios))
    conteos.append(llegan)

print("promedio por segundo:", round(sum(conteos) / len(conteos), 2))
print("los primeros 15 segundos:", conteos[:15])
print("el segundo más tranquilo:", min(conteos), "  el más lleno:", max(conteos))
print("segundos con 15 o más:", sum(c >= 15 for c in conteos), "de", len(conteos))
```

```salida
promedio por segundo: 10.03
los primeros 15 segundos: [9, 11, 11, 11, 9, 8, 10, 11, 5, 20, 16, 7, 13, 19, 7]
el segundo más tranquilo: 1   el más lleno: 25
segundos con 15 o más: 289 de 3600
```

:::figura probabilidad-llegadas
El primer minuto de la simulación. El promedio de la hora es 10, pero solo 9 de estos 60 segundos traen exactamente 10, y uno trae el doble.
:::

Con un promedio de 10, un segundo con 15 o más pasa en ≈ 8 % de los segundos: unas 300 veces por hora (en la simulación, 289). Uno con el doble del promedio, 20 o más, ≈ 12 veces por hora. Y si tu sistema solo aguanta 10 por segundo, ≈ 4 de cada 10 segundos traen más de lo que aguanta: unas 1,500 veces por hora, aunque «el promedio quepa».

### El modelo de Poisson

Este patrón tiene nombre. Cuando muchas personas, cada una con una probabilidad chica y sin ponerse de acuerdo, generan eventos a una tasa promedio λ (la letra griega lambda), el número de eventos en cada intervalo sigue una distribución de [[poisson|Poisson]], por el matemático francés Siméon Denis Poisson. Es el modelo estándar de llegadas al azar, y la Ronda lo usa así en M03.

La regla para llevarse: **lo que llega en cada intervalo se aleja del promedio, normalmente, en ≈ √λ**. A esa medida de lo que algo se aleja de su promedio se le llama [[desviacion-estandar|desviación estándar]], y la vas a ver a fondo en la lección siguiente.

| Promedio por intervalo (λ) | Se aleja, normalmente, en (√λ) | Comparado con el promedio |
|---|---|---|
| 0.5 | ≈ 0.7 | 141 % |
| 5 | ≈ 2.2 | 45 % |
| 10 | ≈ 3.2 | 32 % |
| 10,000 | 100 | 1 % |

Dos consecuencias, y las dos están en la Ronda:

- **Mientras más chico el intervalo, más se amontona.** M03: 500 requests por segundo, medidos por minuto, no son 5 requests cada 10 ms. En ventanas de 10 ms llegan 5 en promedio, ± 2.2, y ≈ 3 % de esas ventanas trae 10 o más: el doble de la tasa durante esos 10 ms.
- **Mientras más tráfico, más parejo en proporción.** 10,000 por segundo se mueven ± 1 %; 10 por segundo, ± 32 %. Un sistema chico vive más a saltos.

:::ejemplo El batching de C01
Cada Triton de C01 espera hasta 2 ms a que lleguen compañeros para calcular varias fotos juntas en un [[batch]]. En el pico de diseño cada uno recibe ≈ 250 requests por segundo, así que en 2 ms llegan en promedio 250 × 0.002 = 0.5. Con Poisson, la probabilidad de que no llegue **ninguno** en esa espera es e^(−0.5) ≈ 61 %. A la carga promedio, ≈ 58 por segundo en cada GPU, se esperan 0.116 en 2 ms y la probabilidad de no recibir compañía sube a e^(−0.116) ≈ 89 %. Por eso la Ronda concluye que, con el tráfico normal, el batching casi no ayuda. Se activa igual porque cuesta como mucho 2 ms y, en un pico o si cae una GPU, el batch crece solo.
:::

### Dónde se rompe Poisson

Poisson supone lo mismo que toda la lección: llegadas **independientes**. Cuando no lo son, se amontonan mucho más:

- **Un aviso a millones de personas.** M03 calcula un ejemplo ilustrativo: 5 M personas reciben una notificación y 2 % sube una foto en el minuto siguiente. Es un pico de ≈ 4.8 veces el pico normal del día.
- **Tareas programadas a la hora en punto.** Miles de procesos que corren «cada hora, en el minuto 0» llegan juntos.
- **Reintentos.** Una falla de unos segundos produce una ola de reintentos que llegan juntos.

Lo que no es aleatorio se suma encima de lo aleatorio. Por eso C01 diseña para 500 por segundo y no para su pico de 350: el margen de ≈ 1.4 veces cubre ráfagas y el crecimiento del tráfico. Y por eso sus GPUs se planean al 50 % de su máximo: en «Qué tan rápido y cuánto: latencia y throughput» vas a ver que, cerca del 100 % de uso, la espera en la fila se dispara justo por estas ráfagas.

:::profundo La fórmula de Poisson
Con un promedio de λ eventos por intervalo, la probabilidad de que lleguen exactamente k es:

P(k) = λ^k × e^(−λ) ÷ k!

donde k!, «k factorial», es 1 × 2 × … × k, y 0! = 1. Con λ = 10 sale P(10) ≈ 12.5 % y P(15) ≈ 3.5 %; sumando de 15 en adelante, P(15 o más) ≈ 8.3 %. Con λ = 0.5 y k = 0 queda 0.5⁰ × e^(−0.5) ÷ 0! = e^(−0.5) ≈ 0.61, la cuenta del batching de C01.

¿De dónde sale? De la simulación de arriba: 1,000 personas, cada una con probabilidad 0.01. Si haces crecer la cantidad de personas y achicas la probabilidad de cada una, con el producto fijo en λ, la probabilidad de que pidan exactamente k se acerca a esta fórmula. Por eso Poisson describe bien cualquier cosa hecha de muchos eventos raros e independientes: requests, discos que fallan en una flota grande, clics en un anuncio.
:::

## Errores comunes {Common mistakes}

Casi todos tienen la misma raíz: una cuenta que supone algo (independencia, una sola pieza, el promedio) sin decir que lo supone.

### Sumar lo que se multiplica

**Qué pasa:** «cada uno de los 50 servicios es lento el 1 %, así que el request es lento el 50 %». Sumar solo vale con eventos excluyentes, y aquí pueden coincidir. La cuenta correcta da 1 − 0.99⁵⁰ ≈ 39.5 %. Con 150 servicios, la suma diría 150 %.

**Cómo evitarlo:** para «todos funcionan», multiplica las probabilidades de funcionar. Para «al menos uno falla», usa el complemento: 1 − P(todos funcionan). Si una probabilidad te da más de 1, la cuenta está mal.

### Suponer independencia sin revisarla

**Qué pasa:** se multiplica sin preguntar si las cosas se mueven juntas. Dos tramos de un request son lentos el 2 % de las veces cada uno, y se calcula que los dos son lentos a la vez solo 0.02 × 0.02 = 0.04 %. Pero si a los dos los vuelve lentos la misma foto gigante, pasan juntos casi el 2 % de las veces: 50 veces más.

**Cómo evitarlo:** antes de multiplicar, pregunta si hay una causa que mueva a los dos. Si la hay, no supongas: mide en los datos cuántas veces pasan juntos.

### Olvidar las fallas correlacionadas

**Qué pasa:** se calcula «dos réplicas al 99.5 % dan 99.9975 %» y se promete eso, pero las dos réplicas reciben la misma versión el mismo día, o viven en la misma zona, o leen la misma base. La primera causa común se come los nueves.

**Cómo evitarlo:** para cada par de réplicas, pregunta qué comparten: máquina, zona, versión, configuración, dependencias, el mismo plan B. Cambia de versión de a poco y una zona a la vez, y pon en la cuenta una causa común con su probabilidad, aunque sea estimada.

### Creer que 99.9 % es «casi nunca»

**Qué pasa:** «falla uno de cada mil, eso no es nada». Con 10 millones de requests al día son 10,000 fallas diarias, y como tiempo son 43 minutos al mes.

**Cómo evitarlo:** traduce siempre el porcentaje a conteos y minutos con el volumen real: «0.1 % = 10,000 requests al día = 43 minutos al mes». Y pregunta qué vive la persona en esas 10,000 veces: con plan B es una molestia; sin plan B, alguien que no pudo publicar.

### Prometer más nueves que la cadena

**Qué pasa:** tu servicio depende en serie de un balanceador al 99.99 %, de una base al 99.95 % y del servicio de otro equipo al 99.9 %, y prometes 99.99 %. El producto da ≈ 99.84 %: lo prometido es imposible desde el diseño.

**Cómo evitarlo:** antes de aceptar un SLO, multiplica lo que está en serie. Si no alcanza, las salidas son réplicas en paralelo para lo que se puede copiar, o un plan B que saque del camino crítico a la pieza débil.

### Medir cada pieza y no el conjunto

**Qué pasa:** cada uno de los 10 servicios de un [[fan-out]] cumple su p99, y el equipo celebra. Pero ≈ 9.6 % de los requests toca la cola de alguno, y el p99 de lo que vive la persona es mucho peor que el de cualquier pieza.

**Cómo evitarlo:** mide la latencia y la disponibilidad **de punta a punta**, donde las vive quien llama. Y a cada pieza pídele lo que el conjunto necesita: con 10 en paralelo, su p99.9.

### Dimensionar para el promedio

**Qué pasa:** «llegan 10 por segundo y el servidor atiende 10 por segundo: alcanza». Con llegadas al azar, ≈ 8 % de los segundos trae 15 o más, y cada uno forma una fila que tarda en vaciarse. Lo que no es aleatorio, como las notificaciones y los reintentos, lo empeora.

**Cómo evitarlo:** dimensiona para el pico y agrega margen (C01: promedio 116, pico 350 y diseño 500 por segundo), y planea las máquinas lejos del 100 % de uso, por ejemplo al 50 %.

## En la vida real {In real life} [extra]

**C01 · Clasificación de fotos.** Toda la lección en un solo caso. Un SLO de 99.9 % en 30 días: 43.2 minutos, o 300,000 requests fallidos al mes. Dos T4, una por zona, aunque el tráfico pide una sola: N+1, para que la que queda aguante el pico de diseño al ≈ 42 %. El gateway y Triton en dos zonas, y el balanceador en las dos. Un plan B que no comparte nada con el modelo, el selector manual, que lo saca del camino crítico y permite quedarse en una sola región. Y cambios de versión de a poco, 5 % del tráfico primero, porque un deploy malo es la causa común que más minutos le come al presupuesto.

**C11 · Un asistente con documentos ([[rag|RAG]]).** Cada pregunta de un empleado pasa por varios pasos en serie: revisar sus permisos, buscar por palabras y por significado (las dos búsquedas a la vez, un fan-out de dos), reordenar los resultados con otro modelo y, al final, pedirle la respuesta a un [[llm|LLM]]. Son muchas piezas multiplicándose, y por eso cada una tiene un plan B que la saca de la cuenta: si el reordenador no responde a tiempo, se usa el orden que ya traía la búsqueda; si el LLM falla, se muestran solo los resultados de búsqueda. Su meta es 99.5 % para la respuesta generada, y más para la búsqueda sola: cada escalón de plan B cambia calidad por disponibilidad.

**C12 · Un agente de soporte.** Por conversación, el agente hace ≈ 6 llamadas al LLM y ≈ 3.5 llamadas a herramientas, como consultar un pedido o el rastreo de un paquete: ≈ 10 pasos en serie. Si cada paso saliera bien el 99 % de las veces, por su cuenta (un supuesto para el ejemplo), la conversación completa saldría sin tropiezos 0.99¹⁰ ≈ 90 % de las veces. Con 150,000 conversaciones al día, ≈ 14,000 tendrían al menos un paso fallido. Por eso un agente no se diseña como si todo fuera a salir bien: lleva límites (≤ 8 llamadas a herramientas por turno y ≤ 12 llamadas al LLM por conversación), reintentos solo para lo que se puede repetir sin efectos y una salida diseñada para cuando algo falla o se acaba: pasarle la conversación a una persona, con un resumen.

**C09 · Fraude con tarjetas.** El modelo decide dentro de cada pago, así que está en el camino crítico y pide 99.99 %: ≈ 4.3 minutos al mes. Si el modelo no contesta, quien orquesta el pago aprueba o pide verificación según el tipo de comercio y el monto, pero nunca bloquea todo, y la Ronda lo justifica con un valor esperado: el fraude que se espera en unos minutos cuesta menos que rechazar a todos. Sus umbrales también salen de valores esperados: el costo de aprobar, verificar o rechazar cada pago, contra los ≈ US$48 por cada 1,000 pagos que el fraude cuesta hoy.

**C05 · Documentos.** Ya usaste la regla del producto en «Qué es un modelo»: leer bien los 18 dígitos de una CLABE con 99 % por dígito daba 0.99¹⁸ ≈ 0.835. La Ronda la lleva a documentos completos: uno de 10 campos con 99.5 % de acierto por campo sale perfecto con probabilidad 0.995¹⁰ ≈ 95 %, **si** los errores fueran independientes. Cada vez que algo necesita que salgan bien muchas cosas, se multiplica.

**En la vida diaria.** Un viaje con dos escalas son tres vuelos. Si cada uno sale a tiempo 9 de cada 10 veces, los tres salen a tiempo 0.9³ ≈ 73 % de las veces… si los retrasos fueran independientes; con una tormenta, se atrasan todos juntos. Las series de luces navideñas antiguas, conectadas en serie, se apagaban completas si se fundía un solo foco: con 50 focos que, digamos, sobreviven la temporada al 99 % cada uno, la serie llega entera 0.99⁵⁰ ≈ 61 % de las veces. Y un hospital tiene su propia planta de luz porque la red eléctrica es la causa común de todo lo que hay adentro.

:::nota Un problema de 1654
Se cuenta que el caballero de Méré, un jugador francés, apostaba a sacar al menos un 6 en 4 tiros de un dado, y ganaba. Con el complemento: no sacar ningún 6 en 4 tiros es (5/6)⁴ ≈ 0.482, así que «al menos uno» es 1 − 0.482 ≈ 51.8 %, una ventaja pequeña pero real. Luego apostó a sacar al menos un doble 6 en 24 tiros de dos dados, creyendo que era lo mismo, y perdía: 1 − (35/36)²⁴ ≈ 49.1 %. Se lo preguntó a Blaise Pascal, que lo discutió por carta con Pierre de Fermat. Esas cartas se consideran el comienzo de la teoría de la probabilidad.
:::

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los primeros cuatro son directos; los dos últimos piden juntar varias ideas.

:::ejercicios
? [facil] Un servicio responde mal el 0.2 % de los requests y recibe 5 millones al día. ¿Cuántas respuestas malas se esperan al día? ¿Qué probabilidad tiene un request de salir bien?
Respuestas malas esperadas: 5,000,000 × 0.002 = **10,000 al día**. Es un [[valor-esperado|valor esperado]], N × p.

Salir bien es el complemento: 1 − 0.002 = 0.998 = **99.8 %**.
? [facil] Un request necesita a dos servicios en serie, independientes, cada uno con 99.9 % de disponibilidad. ¿Qué disponibilidad tiene el conjunto? ¿Cuántos minutos caído es eso en un mes de 30 días?
Regla del producto: 0.999 × 0.999 = 0.998001 ≈ **99.8 %**.

Caído: (1 − 0.998001) × 43,200 = 0.001999 × 43,200 ≈ **86.4 minutos**. Con el atajo de sumar los minutos de cada pieza: 43.2 + 43.2 = 86.4. El doble de lo que permite cada pieza por separado.
? [facil] ¿Cuánto tiempo caído permite 99.95 % en un mes de 30 días? ¿Y en un día?
Mes: 43,200 × 0.0005 = **21.6 minutos**.

Día: 1,440 minutos × 0.0005 = 0.72 minutos = **43.2 segundos**.
? [facil] Un request hace [[fan-out]] a 5 servicios, cada uno lento el 2 % de las veces, de forma independiente. ¿Qué probabilidad hay de que el request sea lento? ¿Qué diría la suma?
Los 5 rápidos: 0.98⁵ ≈ 0.904. Al menos uno lento: 1 − 0.904 ≈ **9.6 %**.

La suma diría 5 × 2 % = 10 %. Con probabilidades chicas casi atina, pero ya se pasa.
? [medio] Un servicio tiene dos réplicas, cada una con 99 % de disponibilidad, independientes, y basta con una. ¿Qué disponibilidad tiene? ¿Y con tres réplicas? Pásalo a tiempo caído por mes.
Dos réplicas: 1 − 0.01² = 1 − 0.0001 = **99.99 %**, que son 43,200 × 0.0001 = **4.32 minutos** al mes.

Tres réplicas: 1 − 0.01³ = 1 − 0.000001 = **99.9999 %**, que son 43,200 × 0.000001 = 0.0432 minutos ≈ **2.6 segundos** al mes.

En el papel, cada réplica de 99 % agrega dos nueves. En la realidad, una causa común se come casi todo eso.
? [medio] El SLO de C01 es 99.9 % en 30 días, con 10 millones de requests al día. Un incidente hace fallar el 50 % de los requests durante 15 minutos. ¿Qué parte del presupuesto del mes se come?
:::cuenta Un incidente corto pero fuerte
Requests por minuto | 10,000,000 ÷ 1,440 | ≈ 6,944
Requests fallidos en el incidente | 6,944 × 15 × 0.5 | ≈ 52,083
Presupuesto del mes | 0.001 × 10,000,000 × 30 | 300,000
Parte que se comió | 52,083 ÷ 300,000 | **≈ 17 %**
= Quince minutos se comen más presupuesto que el deploy de dos horas con 5 % de errores (14 %). Lo que cuenta es cuántos requests fallan, no cuánto dura.
:::
? [medio] Un request hace fan-out a 50 servicios, espera a los 50, y quieres que el 99 % de los requests sean rápidos. ¿Qué percentil tiene que cumplir cada servicio? ¿Y qué fracción de los requests sería lenta si cada uno solo cumpliera su p99?
Si q es la probabilidad de que cada servicio sea rápido, necesitas q⁵⁰ = 0.99, así que q = 0.99^(1/50) ≈ 0.99980.

Con el atajo: 1 − 0.01 ÷ 50 = 1 − 0.0002 = 0.9998.

Cada servicio tiene que cumplir su **p99.98**: ser lento solo 1 de cada 5,000 veces. Si solo cumpliera su p99, serían lentos 1 − 0.99⁵⁰ ≈ **39.5 %** de los requests.
? [medio] Supón que el equipo de C01 hace ≈ 20 deploys al mes y que cada uno tiene 2 % de probabilidad de salir malo (los dos números son supuestos). Sin canary, un deploy malo deja el servicio caído 30 minutos. ¿Cuántos minutos caídos por deploys se esperan al mes? ¿Y si con un canary uno malo solo afecta al 5 % del tráfico durante 10 minutos?
Deploys malos esperados al mes: 20 × 0.02 = 0.4.

**Sin canary:** 0.4 × 30 = **12 minutos** esperados al mes, ≈ 28 % de los 43.2 que permite el SLO, solo por deploys.

**Con canary:** cada deploy malo hace fallar el 5 % de los requests durante 10 minutos. Para el SLI, que cuenta requests, eso pesa lo mismo que 0.05 × 10 = 0.5 minutos con todo caído. Esperado al mes: 0.4 × 0.5 = **0.2 minutos**, menos del 0.5 % del presupuesto.

El canary no hace que los deploys salgan mal menos seguido: hace que cada uno cueste 60 veces menos. Es la misma palanca que el rollback rápido de «El presupuesto en la práctica»: no evita la falla, achica su daño.
? [reto] Las dos zonas de Triton en C01 tienen 99.5 % cada una, y un deploy malo las tumba a la vez el 0.1 % del tiempo. (a) ¿Qué disponibilidad tiene Triton? (b) Con canary y una zona a la vez, esa causa común baja a 0.02 % del tiempo. ¿Qué disponibilidad queda y cuántos minutos al mes se ahorran? (c) ¿Serviría más agregar una tercera zona, sin canary?
**(a)** Réplicas: 1 − 0.005² = 0.999975. Con la causa común: 0.999975 × 0.999 ≈ 0.998975 ≈ **99.90 %**, que son (1 − 0.998975) × 43,200 ≈ **44.3 minutos** al mes.

**(b)** 0.999975 × 0.9998 ≈ 0.999775 ≈ **99.98 %**: ≈ 9.7 minutos al mes. Se ahorran 44.3 − 9.7 ≈ **34.6 minutos**.

**(c)** Tres zonas sin canary: 1 − 0.005³ = 0.999999875, y por la causa común, 0.999999875 × 0.999 ≈ 0.999000 → ≈ 43.2 minutos al mes. Se ahorra ≈ 1 minuto. La tercera zona ataca la falla propia, que ya era chica; el canary ataca la causa común, que era casi todo.
? [reto] (a) Un servicio recibe en promedio 10 requests por segundo, al azar, y puede atender como máximo 15 por segundo. ¿En qué fracción de los segundos llegan más de los que puede atender? (b) ¿Por qué no es lo mismo que el «15 o más» de la lección?
**(a)** «Más de 15» es 16 o más. Con Poisson y λ = 10, P(16 o más) = 1 − P(0 a 15). Sumar 16 términos a mano es largo; en Python:

```python
import math

lam = 10   # promedio por segundo
hasta_15 = sum(lam**k * math.exp(-lam) / math.factorial(k) for k in range(16))
print("P(16 o más):", round(1 - hasta_15, 4))
print("segundos por hora:", round(3600 * (1 - hasta_15)))
```

```salida
P(16 o más): 0.0487
segundos por hora: 175
```

≈ **4.9 %** de los segundos: ≈ 175 por hora en que llega más de lo que el servicio puede atender, y se forma una fila.

**(b)** «15 o más» incluye los segundos con exactamente 15, que el servicio sí alcanza a atender. P(15 exactos) ≈ 3.47 %, y 4.87 % + 3.47 % ≈ 8.3 %, el número de la lección. En una cuenta de capacidad, ese «o más» mueve el resultado de 8.3 % a 4.9 %: lee la pregunta dos veces.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M03 · Latencia y capacidad** calcula el fan-out con 1 − 0.99^N (1 %, ≈ 9.6 % y ≈ 63.4 %), explica por qué los p99 de los tramos no se suman, usa Poisson para las ráfagas en ventanas de 10 ms y recorta la cola con *hedging*.
- **M15 · Seguridad y confiabilidad** define SLI, SLO y SLA, hace la disponibilidad compuesta de C01 en serie y en paralelo, con y sin causa común, y convierte el presupuesto de error en una política.
- **M06 · Orquestación y escalado** lleva el N+1 por zona a Kubernetes: las réplicas repartidas en dos zonas y qué falla cubre cada mecanismo.
- **M02 · Patrones de inferencia** advierte que cada llamada síncrona extra es cola que pagas, y **M11 · Despliegue seguro** explica el canary, la defensa contra el deploy malo.
- La **hoja de números** de la Ronda trae la tabla de nueves completa, por mes, por año y por día.

**En el Dojo:** cuando abran las estaciones 9 (Kubernetes) y 10 (Rollout seguro), vas a repartir las réplicas de C01 en dos zonas y a cambiar de versión de a poco, con las cuentas de esta lección.

**En Sensei:** la siguiente lección, «Ruido, muestras y pruebas A/B», usa la probabilidad para otra pregunta: si una métrica subió, ¿mejoró de verdad o fue suerte? Ahí vas a ver cuántos datos hay que juntar para que una diferencia no sea solo ruido, la misma pregunta que se hace un canary antes de decidir. Más adelante, «Timeouts, reintentos e idempotencia» desarrolla los reintentos que aquí solo contamos; «Qué tan rápido y cuánto: latencia y throughput» explica por qué la fila se dispara cerca del 100 % de uso, y «Regiones, zonas y disponibilidad», qué es exactamente una zona y cuándo vale la pena una segunda región.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
independencia regla-producto complemento fan-out disponibilidad nueves error-budget redundancia falla-correlacionada valor-esperado tasa poisson
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué se multiplican, y no se suman, las probabilidades de que dos servicios independientes funcionen?
Porque «los dos funcionan» es una fracción de una fracción: de los casos en que funciona A, solo en una parte funciona también B. Sumar sirve para eventos excluyentes. Para «al menos uno falla» se usa el complemento: 1 − P(todos funcionan).
? Un request espera a 100 servicios, cada uno lento el 1 % de las veces. ¿Qué fracción de los requests es lenta?
1 − 0.99¹⁰⁰ ≈ 63 %. El p99 de cada pieza se vuelve la latencia típica del conjunto.
? ¿Cuánto es 99.9 % en minutos al mes? ¿Y 99.99 %?
Un mes de 30 días tiene 43,200 minutos: 43.2 minutos y 4.32 minutos. Cada nueve más divide el tiempo entre 10.
? ¿Qué es el presupuesto de error de C01 y para qué sirve?
Es 1 − SLO: 0.1 %, que son 43.2 minutos o 300,000 requests al mes. Se gasta en deploys y experimentos, y una política escrita de antemano dice qué hacer cuando se acaba, como congelar los lanzamientos riesgosos.
? ¿Por qué dos réplicas en la misma zona no son N+1?
Porque comparten lo que falla: si se cae la zona, caen juntas. La cuenta 1 − (1 − a)² supone fallas independientes, y contra una causa común más réplicas iguales no ayudan.
? Llegan 10 requests por segundo en promedio. ¿Por qué no basta con atender 10 por segundo?
Porque las llegadas al azar se amontonan: se alejan del promedio en ≈ √10 ≈ 3, y ≈ 8 % de los segundos trae 15 o más. Se dimensiona para el pico, con margen.
? Un pago de US$30 tiene probabilidad 0.05 de ser fraude, y aprobar un fraude cuesta US$45. ¿Cuál es el costo esperado de aprobarlo y qué significa?
0.05 × 45 = US$2.25. Ningún pago cuesta US$2.25: cada uno cuesta US$0 o US$45. Es lo que se pierde en promedio por pago, entre muchos pagos como ese.
:::
