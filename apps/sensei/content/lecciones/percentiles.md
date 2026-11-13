---
titulo: Promedios, medianas y percentiles
en: Means, medians and percentiles
subtitulo: Por qué Alba promete «p99 ≤ 200 ms» y no un promedio: cómo se calculan el promedio, la mediana y los percentiles, por qué no se suman ni se promedian, y cómo un sistema de monitoreo los estima con buckets para revisar esa promesa.
pregunta: ¿Qué quiere decir exactamente «p99 ≤ 200 ms», cómo se calcula y por qué no basta con el promedio?
requisitos: unidades
---

:::idea
Miles de requests no caben en un solo número. El promedio se deja jalar por unas cuantas requests lentísimas; la mediana dice cómo le va a la request típica; el p99 dice cómo les va a las más lentas, que son las que vencen el timeout y las que la gente recuerda. Por eso una promesa de latencia se escribe como percentil, se mide con un histograma de buckets y nunca se promedia ni se suma.
:::

## El promedio, la mediana y la forma de los datos {Mean, median and the shape of data}

Alba, la empresa que seguimos en todo el curso, es un marketplace: cuando alguien publica algo para vender, le sugiere la categoría de cada foto, entre 500 posibles. ¿Cuánto tarda en sugerirla? Suena a pregunta sencilla, pero no tiene una sola respuesta. La foto de los tenis de Ana tardó 38 [[ms]]; la siguiente, 45; una foto enorme subida desde la web, 160. Alba responde unos 10 millones de fotos al día (≈ 2.5 millones de publicaciones con ≈ 3 fotos cada una, más las que le piden otros equipos) y cada una tiene su propia [[latencia]]. Para hablar de 10 millones de números hay que resumirlos, y cada resumen contesta una pregunta distinta.

### El promedio

El [[promedio]] (*mean* o *average*) es el resumen que ya conoces: sumas todos los valores y divides entre cuántos son. Si tienes \(N\) valores y los llamas \(x_1, x_2, …, x_N\), el promedio es \((x_1 + x_2 + … + x_N) ÷ N\). Cinco requests que tardaron 30, 32, 35, 38 y 45 ms (\(N\) = 5) suman 180 ms; su promedio es 180 ÷ 5 = **36 ms**.

Quiere decir: si el tiempo total se repartiera parejo, a cada request le tocarían 36 ms. Por eso el promedio es el número correcto para un **total**: con el promedio y la cantidad, sabes el total. En ML ya lo usaste: la [[loss]] de un [[batch]] es un promedio, y hasta la [[accuracy]] es un promedio de unos y ceros (1 si el modelo acertó, 0 si no). El ≈ 85 % de [[top-k|top-1]] del modelo de Alba es el promedio de 50,000 unos y ceros, uno por foto de su [[golden-set|golden set]].

### La mediana

La [[mediana]] (*median*) es el valor de en medio cuando los ordenas. Con los valores ya ordenados de menor a mayor (ahora \(x_1\) es el más chico y \(x_N\) el más grande), la mediana es \(x_{(N+1)/2}\) si \(N\) es impar, y \((x_{N/2} + x_{N/2+1}) ÷ 2\) si es par. Con 30, 32, 35, 38 y 45 ms, \(N\) = 5 y la de en medio es \(x_3\), la tercera: **35 ms**. Si la cantidad es par, hay dos de en medio y se promedian: con 30, 32, 35, 38, 45 y 60, \(N\) = 6 y la mediana es \((x_3 + x_4) ÷ 2\) = (35 + 38) ÷ 2 = **36.5 ms**.

Quiere decir: la mitad de las requests tardó menos y la otra mitad, más. Es la request típica.

### Cuando un valor se va muy lejos

Con datos parejos, el promedio y la mediana salen casi iguales. La diferencia aparece cuando un valor se va muy lejos. Un ejemplo fuera de las computadoras, con sueldos inventados:

:::cuenta La fonda y el millonario
9 personas comen en una fonda // ganan de 9 a 16 mil pesos al mes | 9 + 10 + 11 + 12 + 12 + 13 + 14 + 15 + 16 (miles) | 112,000 pesos
Promedio de las 9 // la suma entre \(N\) = 9 | 112,000 ÷ 9 | ≈ 12,444 pesos
Mediana de las 9 // \(N\) = 9 es impar: \(x_{(9+1)/2} = x_5\), la 5.ª | 9, 10, 11, 12, **12**, 13, 14, 15, 16 (miles) | 12,000 pesos
Entra alguien que gana 900,000 al mes | 112,000 + 900,000 | 1,012,000 pesos
Promedio de las 10 // la suma entre \(N\) = 10 | 1,012,000 ÷ 10 | 101,200 pesos
Mediana de las 10 // \(N\) = 10 es par: \((x_5 + x_6) ÷ 2\) | (12,000 + 13,000) ÷ 2 | 12,500 pesos
= Una sola persona multiplicó el promedio por 8; la mediana subió 500 pesos. Nadie en la fonda gana 101,200: el promedio ya no describe a nadie.
:::

¿Por qué la mediana casi no se movió? Porque solo mira el **orden**. Le da igual si el millonario gana 900 mil o 17 mil: en los dos casos está «arriba». El promedio, en cambio, usa el valor completo de cada uno. Por eso se dice que la mediana es **resistente**: para moverla mucho tendrías que cambiar la mitad de los datos; para mover el promedio basta uno.

:::analogia El promedio es el punto de equilibrio
Pon cada valor como una moneda sobre una regla larga, en la marca de su número. El promedio es donde apoyarías la regla con un dedo para que no se caiga. Una moneda muy lejos, como el millonario, obliga a mover mucho el dedo hacia ella, aunque sea una sola.

**Dónde se rompe:** la regla solo explica el promedio. La mediana no equilibra nada: solo cuenta cuántas monedas hay de cada lado, y por eso no le importa qué tan lejos esté la de la orilla.
:::

### La forma de los datos

Dos listas pueden tener el mismo promedio y parecerse muy poco. Cien requests que tardan 50 ms cada una tienen promedio de 50 ms. Noventa de 30 ms y diez de 230 ms también: (90 × 30 + 10 × 230) ÷ 100 = (2,700 + 2,300) ÷ 100 = 50 ms. En la segunda lista, 10 de cada 100 personas esperaron más de 200 ms, y el promedio no lo ve.

Lo que distingue a las dos listas es su [[distribucion|distribución]] (*distribution*): qué valores aparecen y qué tan seguido. Para verla se dibuja un [[histograma]] (*histogram*): partes el rango en intervalos del mismo ancho, por ejemplo de 10 en 10 ms, cuentas cuántos valores caen en cada uno y dibujas una barra por intervalo, tan alta como su cuenta. A cada intervalo se le llama [[bucket]] (también *bin*, «cajón»).

:::figura percentiles-histograma
1,000 requests de juguete de un minuto malo. La mayoría tarda entre 20 y 60 ms; unas cuantas se van hasta casi 700 ms. Las tres barras de la derecha juntan intervalos más anchos para que la cola quepa: de 150 a 300, de 300 a 500 y de 500 a 700 ms.
:::

Fíjate en la forma. Hay un montículo a la izquierda, y a la derecha la gráfica no termina de golpe: se estira, baja y larga, con unas pocas requests en 300, 500 y casi 700 ms. Esa parte larga y delgada es la [[cola-distribucion|cola]] de la distribución (*tail*). Las latencias casi siempre tienen la cola a la derecha: hay un piso, porque leer la foto y correr el modelo cuesta un mínimo, pero no hay techo, porque una pausa del programa, un reintento o una fila de espera siempre pueden sumar más.

La cola jala al promedio. En la figura, la mediana es 38 ms y el promedio, 51 ms: el 81 % de las requests tardó menos que el promedio. Y el p99, que verás en la siguiente sección, está allá lejos, en 488 ms.

Un [[valor-atipico|valor atípico]] (*outlier*) es uno que queda muy lejos de los demás, como el millonario o la request de 693 ms. Si es un error de medición (una latencia de −5 ms por un reloj que se movió), se corrige o se descarta. Si es real, en latencia **no se borra**: alguien de verdad esperó 693 ms, y esa es la cola que Alba prometió controlar.

:::ojo
No confundas la cola de una distribución con la [[long-tail|long tail]] de «Datos, ejemplos, features y etiquetas». Allá eran muchas categorías con pocas fotos cada una; aquí son pocas requests con valores muy grandes. Comparten el nombre porque las dos gráficas terminan en una parte baja y larga.
:::

## Percentiles: contar desde abajo {Percentiles: counting from the bottom}

La mediana deja abajo a la mitad de los valores. ¿Y si quieres el valor que deja abajo al 90 %, o al 99 %? Eso es un [[percentil]] (*percentile*): el percentil \(q\) es el valor que deja en él o abajo de él al \(q\) % de los datos (o a un poco más, si no sale exacto). La mediana es el percentil 50.

Se escriben con una p: **p50**, **p90**, **p95**, **p99**. El [[p99]] deja abajo al 99 % de las requests: solo 1 de cada 100 tarda más. Las herramientas de monitoreo a veces los llaman **cuantiles** (*quantiles*) y los escriben como fracción: el cuantil 0.99 es el p99.

### El método del rango más cercano

Hay varias formas de calcular un percentil. La más fácil de seguir con lápiz es la del **rango más cercano** (*nearest rank*). Estas son sus letras:

:::formula Percentil por el rango más cercano
r = frac{q}{100} × N
p = x_{⌈r⌉}
- q: el percentil que buscas, como número: 99 para el p99, 50 para el p50
- N: cuántos valores hay
- r: el **rango**: la posición del valor que buscas, contando desde el más rápido. Puede salir con decimales
- ⌈r⌉: \(r\) redondeado hacia arriba: 19.8 se vuelve 20, y 19 se queda en 19
- x_{⌈r⌉}: el valor que está en esa posición, con la lista ya ordenada de menor a mayor
- p: el percentil, en ms
:::

:::pasos
1. Ordena de menor a mayor
Cada valor queda con su posición: \(x_1\) el más rápido, \(x_N\) el más lento.
2. Calcula el rango
\(r = q/100 × N\), y redondea hacia arriba (lo que en «Números grandes, unidades y estimaciones» se llama [[ceil]]).
3. Toma el valor de esa posición
\(p = x_{⌈r⌉}\) es el percentil. Por cómo se redondea, al menos el \(q\) % de los valores queda en él o abajo.
:::

Probémoslo con 20 requests de Alba en un rato tranquilo, con números de ejemplo (\(N\) = 20). Llegaron en este orden, en milisegundos: 38, 45, 31, 900, 36, 42, 33, 160, 40, 35, 50, 28, 65, 47, 30, 70, 39, 54, 43 y 34. Ordenadas quedan así:

:::figura percentiles-rangos
Las 20 requests ordenadas, con su rango arriba de cada caja. Cada percentil es la caja de una posición.
:::

:::cuenta Los percentiles de 20 requests
p50 // la mediana, por rango: \(q\) = 50 | \(r\) = 0.50 × 20 = 10 → \(x_{10}\), la 10.ª | 40 ms
p90 // \(q\) = 90 | \(r\) = 0.90 × 20 = 18 → \(x_{18}\), la 18.ª | 70 ms
p95 // \(q\) = 95 | \(r\) = 0.95 × 20 = 19 → \(x_{19}\), la 19.ª | 160 ms
p99 // \(q\) = 99 | \(r\) = 0.99 × 20 = 19.8 → hacia arriba, \(x_{20}\), la 20.ª | 900 ms
Promedio // la suma de las 20 latencias, entre \(N\) = 20 | 1,820 ÷ 20 | 91 ms
= El promedio, 91 ms, queda arriba de 18 de las 20 requests. Y el p99 es la más lenta de todas: con 20 requests no hay más.
:::

Léelo así: «p95 = 160 ms» quiere decir que 19 de las 20 tardaron 160 ms o menos. Cada percentil tiene su traducción:

- **p50**: la request típica. La mitad tarda menos.
- **p95**: 1 de cada 20 tarda más.
- **p99**: 1 de cada 100 tarda más.
- **p99.9**: 1 de cada 1,000 tarda más.

:::nota ¿La mediana es 40 o 41?
Con la regla de la sección anterior, la mediana de 20 valores promedia los dos de en medio: (40 + 42) ÷ 2 = 41 ms. El rango más cercano toma la 10.ª y da 40. Son dos convenciones para la misma idea, y con miles de requests la diferencia desaparece. Hay más métodos, y este mismo cálculo en Python; están en la sección extra «Cómo se calcula y se vigila en la práctica».
:::

:::calculadora percentiles-lista
Empieza con las primeras 10 requests de la lista. Sube la de 900 ms a 3,000: el promedio se dispara y la mediana ni se mueve. Bájala a 50: la más lenta ahora es la de 160, y el p99 baja a 160.
:::

## Por qué la promesa es un p99 {Why the promise is a p99}

En «El camino completo» viste el ejemplo que empezó todo. Ahora cada número tiene nombre:

:::cuenta 98 rápidas y 2 lentas
98 requests de 30 ms | 98 × 30 | 2,940 ms
2 requests de 3 s | 2 × 3,000 | 6,000 ms
Promedio | (2,940 + 6,000) ÷ 100 | 89.4 ms
p50 // \(N\) = 100 | \(r\) = 0.50 × 100 = 50 → \(x_{50}\), la 50.ª | 30 ms
p99 // las lentas son la 99.ª y la 100.ª | \(r\) = 0.99 × 100 = 99 → \(x_{99}\), la 99.ª | 3,000 ms
= El promedio dice 89 ms y cumple de sobra; el p99 dice 3 segundos y rompe la promesa de 200 ms.
:::

Ahora cambia una sola cosa: que solo **una** de las 100 sea lenta. El promedio baja a (99 × 30 + 3,000) ÷ 100 = 59.7 ms. Y el p99 baja a… 30 ms: la 99.ª ya es rápida y la lenta es la 100.ª. ¿El p99 se perdió la request lenta?

Sí, y a propósito. «p99 ≤ 200 ms» no promete que ninguna request tarde más de 200 ms. Promete que **a lo más 1 de cada 100** tarda más. Conviene tener las dos frases juntas, porque dicen lo mismo:

> p99 ≤ 200 ms quiere decir que al menos el 99 % de las requests tarda 200 ms o menos.

Con una lenta de cada 100, se cumple; con dos, no. El p99 es un umbral sobre una **fracción**, y por eso brinca de golpe cuando la fracción de lentas cruza el 1 %. El promedio se mueve poquito con cada request y nunca te dice cuántas personas esperaron de más.

:::calculadora percentiles-promedio-p99
Empieza en el ejemplo de «El camino completo»: 2 % de lentas, de 3 s. Baja las lentas a 1 %: el p99 cae a 30 ms, porque la promesa permite 1 de cada 100. Súbelas a 5.5 %: ahora hasta el p95 dice 3 s, aunque el promedio, 193 ms, todavía «cumple» los 200.
:::

### Por qué importa la cola

- **Es lo que la gente vive y recuerda.** Nadie siente el promedio. Ana siente su request, y si se trabó, eso es lo que cuenta de la app.
- **Ahí vence el timeout.** Los servidores del marketplace esperan 300 ms y después muestran el selector de categorías, el [[fallback]]. Cada request de la cola que pasa de 300 ms es una sugerencia perdida.
- **El 1 % no es poco.** Con 10 millones de requests al día, el 1 % son 100,000 requests lentas cada día.
- **El 1 % de las requests no es el 1 % de las personas.** Quien publica 10 artículos con 3 fotos cada uno hace 30 requests. Si cada una tiene 1 % de probabilidad de caer en la cola, sin importar las demás, la probabilidad de que las 30 salgan rápidas es 0.99 multiplicado 30 veces: \(0.99^{30}\) ≈ 0.74. Lo que falta para 1, \(1 − 0.99^{30}\) ≈ 0.26, o ≈ 26 %, es la probabilidad de que al menos una le toque: una de cada cuatro personas así.
- **La cola avisa primero.** Cuando una fila de espera empieza a crecer, el p99 sube aunque el p50 casi no se mueva.

El promedio no se tira: sigue siendo el número de los totales. Para dimensionar y para pagar, el promedio; para prometerle algo a una persona, los percentiles.

## Los percentiles no se suman ni se promedian {Percentiles don't add up or average}

El promedio tiene una propiedad muy cómoda: se suma y se promedia. Si una request pasa por un tramo A de 10.9 ms en promedio y luego por un tramo B de 10.9 ms en promedio, la request completa tarda 21.8 ms en promedio, exacto. Los percentiles no, y eso engaña en tres lugares: los tramos de una request, las copias de un servicio y las ventanas de tiempo.

### Tramos en serie: A y luego B

:::figura percentiles-suma
100 requests que pasan por el tramo A y luego por el B. Cada tramo tiene una sola request lenta, pero no es la misma.
:::

:::cuenta El p99 que no se suma
Tramo A // 99 de 10 ms; la request 7, de 100 ms | la 99.ª, ordenadas | p99 = 10 ms
Tramo B // 99 de 10 ms; la request 42, de 100 ms | la 99.ª, ordenadas | p99 = 10 ms
Suma de los p99 | 10 + 10 | 20 ms
A + B, request por request // 98 de 20 ms; la 7 y la 42, de 110 ms | 2 lentas de 100: la 99.ª es lenta | p99 = 110 ms
Los promedios, para comparar | 10.9 + 10.9 | 21.8 ms, exacto
= Sumar los p99 dijo 20 ms; el p99 de verdad es 110 ms. Los promedios sí se sumaron.
:::

La suma se quedó corta porque las lentas cayeron en requests distintas: cada tramo tenía 1 % de lentas, pero la request completa tiene 2 %. Si cada tramo tuviera 2 lentas, en requests distintas, cada p99 valdría 100 ms y la suma 200, mientras que el p99 de verdad sería 110: ahora la suma se pasaría.

**La suma de los p99 puede quedar arriba o abajo.** Suele pasarse, porque rara vez todos los tramos tienen su mal momento en la misma request; se queda corta cuando cada tramo tiene tan pocas lentas que su propio p99 no las ve, como en la figura, pero juntas pasan del 1 %. Da exacto cuando los tramos son lentos justo en las mismas requests. Alba lo anota en el presupuesto de latencia de su sistema: los percentiles no se suman, y tampoco las medianas. El presupuesto por tramo de «El camino completo» sirve para repartir; el p99 de verdad se **mide de punta a punta**.

### Copias de un servicio: no promedies los p99

Un servicio corre en varias copias detrás del balanceador de carga (en Kubernetes, cada copia es un *pod*). Un ejemplo con números inventados: en 5 minutos, el pod A atendió 9,900 requests con un p99 de 80 ms; el pod B, frenado por un vecino ruidoso (otro programa en su misma máquina que le quitaba la CPU), atendió 200 requests, todas en ≈ 2 s.

:::cuenta Tres formas de «calcular» el p99 de dos pods
Promedio de los p99 // no describe a ningún pod | (80 + 2,000) ÷ 2 | 1,040 ms
Promedio pesado por tráfico // dice que todo está bien | (9,900 × 80 + 200 × 2,000) ÷ 10,100 | ≈ 118 ms
Fracción de requests en ≈ 2 s // las 200 del pod B entre las 9,900 + 200 = 10,100 de los dos | 200 ÷ 10,100 | ≈ 2 %
p99 de verdad // más del 1 % tardó ≈ 2 s | \(r\) = 0.99 × 10,100 = 9,999 → \(x_{9,999}\), la 9,999.ª | ≈ 2 s
= Ninguno de los dos promedios es el p99. Para saberlo hay que contar cuántas requests, de todas, fueron lentas.
:::

El promedio pesado parece más listo, pero mezcla latencias, y lo que decide el p99 es una cuenta de requests. Lo correcto es juntar las distribuciones **antes** de calcular: sumar, bucket por bucket, lo que contó cada pod, y sacar el percentil al final.

:::diagrama percentiles-agregar
Usa «Recorrer» para ver la forma correcta y la trampa, con los dos pods del ejemplo.
:::

### Ventanas de tiempo

Lo mismo pasa en el tiempo: el p99 del día no es el promedio de los 24 p99 horarios. La hora pico tiene muchas más requests, y ni pesando cada hora por su tráfico sale bien, igual que con los pods. Se calcula con las requests de todo el día, sumando los buckets de las 24 horas. Lo practicas en los ejercicios. Y hay un caso en el que la cola hasta **crece** al juntar piezas, el [[fan-out]]; lo ves en la sección extra «La cola de cerca».

## Buckets: percentiles sin guardar cada número {Buckets: percentiles without keeping every number}

Para un p99 exacto necesitas todas las latencias, ordenadas. Alba recibe unos 10 millones de requests al día, repartidas en varias copias. Guardarlas todas, ordenarlas de nuevo cada minuto y juntar las de todas las copias sería caro y lento. Y un percentil ya calculado dentro de cada copia, ya viste, no se puede combinar.

La salida es un histograma de **buckets fijos**. Cada copia del servicio lleva un contador por bucket, y cada request suma 1 al contador del bucket donde cayó. Nada más: la latencia exacta no se guarda. Los contadores sí se pueden sumar, entre copias y entre ventanas de tiempo, y con ellos se estima el percentil.

El servicio de Alba usa estos bordes, en milisegundos: 10, 25, 50, 75, 100, 150, 200, 300, 500, 1,000 y 2,500, más un último bucket para todo lo que pase de 2.5 s. Fíjate en 150, 200 y 300: rodean la promesa de 200 ms, con un borde justo en ella. Ahí es donde importa la precisión; arriba de 300 los buckets se abren mucho. Prometheus, el programa que junta en Alba los números del servicio (sus métricas), lee esos contadores de cada copia cada 15 segundos.

### Del conteo al percentil

Con los conteos de los buckets se estima el percentil en cuatro pasos. Primero, las letras que vas a usar:

:::formula Percentil estimado desde buckets
r = frac{q}{100} × N
p ≈ L + (U − L) × frac{r − C}{n}
- q: el percentil que buscas, como número: 99 para el p99, 50 para el p50
- N: el total de requests en la ventana (la suma de todos los buckets)
- r: el **rango**: la posición de la request que buscas, contando desde la más rápida. Para el p99 de 10,000 requests, la número 9,900
- L, U: el borde de abajo (*lower*) y el de arriba (*upper*) del bucket donde cae la request \(r\), en ms
- C: cuántas requests hay **antes** de ese bucket: el acumulado de todos los buckets más rápidos
- n: cuántas requests hay **dentro** de ese bucket
- p: el percentil estimado, en ms
:::

:::pasos
1. Cuenta el total
Suma todos los buckets: \(N\) son todas las requests de la ventana.
2. Calcula el rango
\(r = q/100 × N\), sin redondear. Para el p99 de 10,000 requests, \(r = 0.99 × 10,000 = 9,900\).
3. Busca el bucket
Ve acumulando los conteos de los buckets, del más rápido al más lento. El primero cuyo acumulado llega a \(r\) es donde cae la request \(r\). De ahí salen \(L\), \(U\), \(C\) y \(n\).
4. Interpola adentro
Supón que las \(n\) requests del bucket están repartidas parejo entre \(L\) y \(U\). La request \(r\) es la número \(r − C\) dentro del bucket, así que está a la fracción \((r − C)/n\) del camino. Esa fracción del ancho \(U − L\), sumada a \(L\), es el estimado \(p\).
:::

Toma una ventana de 5 minutos con 10,000 requests (unas 33 por segundo, un rato tranquilo), con los buckets que aquí no importan juntos:

:::cuenta El p99 desde los buckets
Hasta 50 ms | 6,200 requests | 6,200 acumuladas
50 a 100 ms | 3,100 requests | 9,300 acumuladas
100 a 150 ms | 520 requests | 9,820 acumuladas
150 a 200 ms // aquí cae la 9,900 | 110 requests | 9,930 acumuladas
Más de 200 ms // 50 de 200 a 300 ms, 15 de 300 a 500 y 5 de más de 500 | 50 + 15 + 5 = 70 requests | 10,000 acumuladas
Total \(N\) // el último acumulado | 6,200 + 3,100 + 520 + 110 + 70 | 10,000
Rango \(r\) // la request que buscas | \(r = 0.99 × 10,000\) | 9,900
Bucket de la request 9,900 // el primero cuyo acumulado llega a 9,900 | 9,820 < 9,900 ≤ 9,930 | 150 a 200 ms
Bordes \(L\) y \(U\) | los del bucket de 150 a 200 ms | \(L\) = 150 · \(U\) = 200
Antes, \(C\) // el acumulado del bucket anterior | acumulado hasta 150 ms | 9,820
Dentro, \(n\) | requests entre 150 y 200 ms | 110
Ancho \(U − L\) | 200 − 150 | 50 ms
Fracción recorrida \((r − C)/n\) | (9,900 − 9,820) ÷ 110 = 80 ÷ 110 | ≈ 0.727
p99 estimado | \(p ≈ L + (U − L) × (r − C)/n\) = 150 + 50 × 0.727 | ≈ 186 ms
En 200 ms o menos // exacto: hay un borde en 200 | 9,930 ÷ 10,000 | 99.3 %
= El p99 estimado es ≈ 186 ms: se cumple la promesa. El de verdad está en algún lugar entre \(L\) = 150 y \(U\) = 200 ms, porque la interpolación supone que las 110 están repartidas parejo. La fracción en 200 ms o menos, en cambio, no se estima: se cuenta.
:::

:::figura percentiles-buckets
Los mismos buckets: dónde cae la request 9,900 y cómo se interpola adentro del bucket de 150 a 200 ms.
:::

:::calculadora percentiles-buckets
Empieza con la ventana de la cuenta. Pasa 100 requests del bucket de 50 a 100 al de 200 a 300 (3,000 y 150): el p99 cruza los 200 ms y la fracción baja de 99 %. Luego cambia \(q\) en el último control: 50 te da el p50 y 99.9 el p99.9 de la misma ventana.
:::

## SLI y SLO: la promesa en números {SLIs and SLOs: the promise in numbers}

«El camino completo» dijo que a una promesa con número y con lugar de medición se le llama [[slo|SLO]]. Ahora puedes desarmarla en sus piezas:

- El [[sli|SLI]] (*service level indicator*, «indicador del nivel de servicio») es el número que mides. Por ejemplo, el p99 de los últimos 5 minutos, o la fracción de requests que respondieron en 200 ms o menos.
- El **SLO** (*service level objective*, «objetivo del nivel de servicio») es la meta que ese número tiene que cumplir: «p99 ≤ 200 ms», o «al menos 99 % de las requests en 200 ms o menos».
- Si además hay un contrato con multas cuando no se cumple, se llama SLA (*service level agreement*).

Un SLO completo dice **qué** se mide, **dónde**, **cuánto** y **en qué ventana**. El de latencia de Alba mide el tiempo de respuesta del lado del servidor (*server-side*), desde que el balanceador tiene la request completa hasta que sale la respuesta; pide p99 ≤ 200 ms; y se vigila en ventanas de 5 minutos, para avisar rápido, y de 30 días, para llevar la cuenta.

### Dos formas de escribir la misma promesa

«p99 ≤ 200 ms» y «al menos el 99 % de las requests en 200 ms o menos» son lo mismo. Si la request en la posición del p99 tardó 200 ms o menos, también las que están antes que ella: al menos el 99 %. Y al revés. En la práctica se prefiere la segunda forma, por tres razones:

- Es un **conteo**: se suma entre copias y entre ventanas sin ningún truco.
- Con un bucket justo en 200 ms, es **exacta**: no hay que interpolar.
- Dice cuánto **margen** queda. «99.3 %» quiere decir que sobran 0.3 [[punto-porcentual|puntos porcentuales]] antes de romper la promesa.

Ese 1 % de requests que pueden ser lentas es un presupuesto que se gasta: el [[error-budget]] (presupuesto de error), que la lección de probabilidad desarrolla. Con 10 millones de requests al día, son 100,000 lentas permitidas al día, o 3 millones en 30 días. Un deploy malo puede gastarse una buena parte en una tarde; lo calculas en los ejercicios. Cómo se vigila todo esto, del contador a la alerta, está en la sección extra que sigue.

## Cómo se calcula y se vigila en la práctica {How it is computed and watched in practice} [extra]

### El rango más cercano en Python

Este programa calcula el promedio, la mediana y los percentiles con las reglas de la sección de percentiles, sin bibliotecas especiales. Al final compara con el módulo `statistics`, que ya viene con Python.

```python
import math
import statistics

# 20 requests de Alba, en milisegundos, en el orden en que llegaron
latencias = [38, 45, 31, 900, 36, 42, 33, 160, 40, 35,
             50, 28, 65, 47, 30, 70, 39, 54, 43, 34]

def mediana(xs):
    s = sorted(xs)
    mitad = len(s) // 2
    if len(s) % 2 == 1:
        return s[mitad]                     # impar: el de en medio
    return (s[mitad - 1] + s[mitad]) / 2    # par: promedio de los dos de en medio

def percentil(xs, p):
    s = sorted(xs)
    rango = math.ceil(p * len(s) / 100)     # rango más cercano, contando desde 1
    return s[rango - 1]                     # Python cuenta desde 0

print(f"promedio: {sum(latencias) / len(latencias)} ms")
print(f"mediana:  {mediana(latencias)} ms")
for p in (50, 90, 95, 99):
    print(f"p{p}:      {percentil(latencias, p)} ms")
print("con statistics:", statistics.mean(latencias), statistics.median(latencias))
```

```salida
promedio: 91.0 ms
mediana:  41.0 ms
p50:      40 ms
p90:      70 ms
p95:      160 ms
p99:      900 ms
con statistics: 91 41.0
```

`math.ceil` es el redondeo hacia arriba del paso 2 del rango más cercano, y `s[rango - 1]` resta 1 porque Python cuenta las posiciones desde 0.

### Otros métodos para un percentil

El rango más cercano siempre devuelve un valor que de verdad se midió. Otros métodos **interpolan**: si la posición cae entre dos valores, toman un punto intermedio. El más común es el que NumPy usa si no le pides otro; también es el de la función PERCENTIL.INC de Excel y el de Python con `method="inclusive"`. Calcula una posición \(h\) que puede caer entre dos valores y avanza en línea recta entre los dos vecinos. Con las mismas letras de antes:

:::formula Percentil lineal (interpolado)
h = 1 + frac{q}{100} × (N − 1)
p = x_j + (h − j) × (x_{j+1} − x_j)
- q, N: el percentil que buscas y cuántos valores hay, como en el rango más cercano
- h: la posición del percentil en la lista ordenada; puede tener decimales
- j: la parte entera de \(h\) (de 19.05, el 19)
- x_j, x_{j+1}: los dos vecinos: el valor en la posición \(j\) y el siguiente
- h − j: qué fracción del camino entre los dos vecinos hay que avanzar
- p: el percentil, en ms
:::

Con las 20 requests, el p95 cae en \(h\) = 1 + 0.95 × 19 = 19.05, así que \(j\) = 19: entre \(x_{19}\) = 160 ms y \(x_{20}\) = 900 ms, al 0.05 del camino. Sale \(p\) = 160 + 0.05 × (900 − 160) = 160 + 0.05 × 740 = **197 ms**, no 160.

| Método | p50 | p90 | p95 | p99 |
|---|---|---|---|---|
| Rango más cercano | 40 | 70 | 160 | 900 |
| Lineal (NumPy, Excel, `inclusive`) | 41 | 79 | 197 | 759.4 |
| `exclusive` (el que Python usa si no le dices) | 41 | 151 | 863 | 1,484.6 |

```python
import statistics

latencias = [28, 30, 31, 33, 34, 35, 36, 38, 39, 40,
             42, 43, 45, 47, 50, 54, 65, 70, 160, 900]

lineal = statistics.quantiles(latencias, n=100, method="inclusive")
omision = statistics.quantiles(latencias, n=100)   # method="exclusive"

print("cuartiles:", statistics.quantiles(latencias, n=4, method="inclusive"))
print("p95 y p99, lineal:   ", lineal[94], lineal[98])
print("p95 y p99, exclusive:", omision[94], omision[98])
```

```salida
cuartiles: [34.75, 41.0, 51.0]
p95 y p99, lineal:    197.0 759.4
p95 y p99, exclusive: 863.0 1484.6
```

`statistics.quantiles(…, n=100)` devuelve los 99 cortes del p1 al p99, así que el p95 está en la posición 94 de la lista y el p99 en la 98. La última línea es la sorpresa: un p99 de 1,484.6 ms, **más que la request más lenta que mediste**. El método `exclusive` calcula la posición como \(h = q/100 × (N + 1)\). Para el p99 da \(h\) = 0.99 × 21 = 20.79, que se sale de la lista de 20; entonces sigue la recta de los dos últimos valores más allá de la lista: 900 + 0.79 × (900 − 160) = 900 + 0.79 × 740 = 1,484.6 ms. Con pocos datos, el método cambia mucho la cola; con miles, las diferencias se vuelven chicas. Por eso importa usar siempre el mismo método, no cuál.

Un detalle si lo programas tú: en la función `percentil` de arriba, `p * len(s) / 100` multiplica antes de dividir. Al revés, con 100 requests, el p7 saldría de 7 / 100 × 100, que en la computadora da 7.000000000000001, y `ceil` lo subiría a la posición 8. Por qué pasa eso lo ves en «Cómo guarda números una computadora».

### Dónde poner los bordes

Dos detalles deciden si el estimado de los buckets sirve: dónde están los bordes y si hay uno justo en el umbral de la promesa. La interpolación dentro de un bucket es tan buena como sus bordes. Toma las mismas 10,000 requests de la cuenta de los buckets, pero con bordes solo en 100, 500 y 1,000 ms:

:::cuenta Los mismos datos con buckets gruesos
Hasta 100 ms | 6,200 + 3,100 | 9,300 acumuladas
100 a 500 ms // aquí cae la 9,900; junta los de 100 a 150, 150 a 200, 200 a 300 y 300 a 500 | 520 + 110 + 50 + 15 = 695 | 9,995 acumuladas
Más de 500 ms | 5 | 10,000 acumuladas
Rango \(r\) // el mismo de antes | \(r = 0.99 × 10,000\) | 9,900
Bordes \(L\) y \(U\) | los del bucket de 100 a 500 ms | \(L\) = 100 · \(U\) = 500
Antes, \(C\) // el acumulado del bucket anterior | acumulado hasta 100 ms | 9,300
Dentro, \(n\) | requests entre 100 y 500 ms | 695
Ancho \(U − L\) | 500 − 100 | 400 ms
Fracción recorrida \((r − C)/n\) | (9,900 − 9,300) ÷ 695 = 600 ÷ 695 | ≈ 0.863
p99 estimado | \(p ≈ L + (U − L) × (r − C)/n\) = 100 + 400 × 0.863 | ≈ 445 ms
= Con los mismos datos, el estimado dice 445 ms: una alarma falsa. Y no hay forma de saber cuántas pasaron de 200 ms, porque no hay borde en 200.
:::

La interpolación supuso que las 695 requests del bucket ancho están repartidas parejo entre 100 y 500 ms, cuando casi todas están entre 100 y 150. De ahí la regla: **pon bordes donde decides**, uno exactamente en el SLO y varios alrededor. Con un solo bucket de 0.1 a 1 s pasaría lo mismo, peor: el p99 quedaría «entre 100 ms y 1 s», que no sirve para decidir si rompiste los 200 ms.

¿Y si el percentil cae en el último bucket, el que no tiene techo? Prometheus devuelve el borde de arriba del penúltimo: si el p99 de Alba cayera en «más de 2.5 s», respondería 2.5 s. No sabe más.

### Prometheus por dentro

Prometheus guarda los bordes en segundos (0.01 … 2.5) y cada bucket lleva la etiqueta `le` (*less or equal*, «menor o igual»). Sus conteos son **acumulados**: el bucket `le="0.2"` cuenta todas las requests de 200 ms o menos, no solo las de 150 a 200, y el último, `le="+Inf"`, las cuenta todas. Así se pide el p99 de Alba:

```promql
histogram_quantile(0.99,
  sum by (le) (rate(classifier_request_latency_seconds_bucket[5m])))
```

Se lee de adentro hacia afuera:

- `classifier_request_latency_seconds_bucket` son los contadores del servicio de Alba: uno por bucket y por copia.
- `rate(…[5m])` convierte cada contador en requests por segundo, en promedio de los últimos 5 minutos.
- `sum by (le)` suma las copias, bucket por bucket: así se juntan las distribuciones antes de calcular.
- `histogram_quantile(0.99, …)` hace los cuatro pasos de la sección de buckets.

Prometheus tiene otro tipo de métrica, *Summary*, que calcula los percentiles dentro de cada copia. Esos ya no se pueden juntar entre copias: es el error de promediar p99. Para un servicio con varias copias, se usa histograma.

### Del contador a la alerta: cómo vigila Alba su promesa

Con todas las piezas juntas, así se revisa el SLO de latencia de Alba, de la request a la persona que despierta:

:::pasos
1. Medir cada request donde se prometió
El servicio de Alba toma la hora al recibir la request completa y al mandar la respuesta, y suma 1 al bucket donde cae la diferencia.
2. Juntar
Prometheus lee los contadores de todas las copias cada 15 segundos.
3. Calcular el SLI de cada ventana
Suma los buckets de todas las copias y calcula el p99 de los últimos 5 minutos, con \(r = q/100 × N\) y \(p ≈ L + (U − L) × (r − C)/n\), las letras de la sección de buckets.
4. Comparar y avisar
Si el p99 pasa de 200 ms y se queda arriba 10 minutos seguidos, la alerta `ClassifierHighP99Latency` despierta a la persona de guardia (*on-call*). Los 10 minutos evitan que un pico de un minuto, como una pausa del programa o un [[deploy]], despierte a alguien por nada.
5. Llevar la cuenta del mes
Se suman los conteos de 30 días: cuántas requests pasaron de 200 ms y cuánto presupuesto queda. El presupuesto es el 1 % del total: \(0.01 × N\).
:::

:::diagrama percentiles-slo
Usa «Recorrer» para seguir una request, una ventana de 5 minutos, la alerta y la cuenta del mes.
:::

:::cuenta ¿Se cumplió hoy el SLO de Alba?
Requests del día, \(N\) // dato de Alba: ≈ 10 millones al día | un día normal | 10,000,000
En 200 ms o menos // número de ejemplo, del bucket le="0.2" | contadas, no estimadas | 9,935,000
SLI: la fracción buena // en 200 ms o menos, entre \(N\) | 9,935,000 ÷ 10,000,000 | 99.35 %
Lentas | 10,000,000 − 9,935,000 | 65,000
Presupuesto del día // el 1 % que el SLO deja ser lento | \(0.01 × N\) = 0.01 × 10,000,000 | 100,000
Presupuesto gastado | 65,000 ÷ 100,000 | 65 %
= 99.35 % ≥ 99 %: se cumplió, con 0.35 puntos de margen, y se gastó el 65 % del presupuesto del día.
:::

## La cola de cerca: atípicos, fan-out y pocas muestras {The tail up close: outliers, fan-out and small samples} [extra]

### Cuartiles y una regla para marcar atípicos

Algunos percentiles tienen nombre propio. Los **cuartiles** parten los datos en cuatro: el p25 (primer cuartil, Q1), el p50 (la mediana) y el p75 (tercer cuartil, Q3). Los **deciles** los parten en diez: p10, p20, …, p90. Ojo: la palabra también se usa para los grupos que quedan entre esos cortes. El INEGI, por ejemplo, ordena los hogares de México por su ingreso, los parte en diez grupos del mismo tamaño, sus «deciles de hogares», y reporta el ingreso de cada grupo en la ENIGH, la Encuesta Nacional de Ingresos y Gastos de los Hogares.

Con las 20 requests y el rango más cercano, Q1 es la 5.ª (\(r\) = 0.25 × 20 = 5), 34 ms, y Q3 es la 15.ª (\(r\) = 0.75 × 20 = 15), 50 ms. El ancho de esa mitad de en medio, Q3 − Q1 = 50 − 34 = 16 ms, se llama **rango intercuartílico** (*interquartile range*, IQR): mide qué tan desparramados están los datos típicos, sin que la cola lo mueva. El estadístico John Tukey propuso en su libro *Exploratory Data Analysis* (1977) una regla que todavía dibujan los diagramas de caja (*box plots*): un valor es atípico si queda más de 1.5 IQR arriba de Q3, o más de 1.5 IQR abajo de Q1.

:::formula Regla de Tukey para marcar atípicos
IQR = Q_3 − Q_1
text{límite de arriba} = Q_3 + 1.5 × IQR
text{límite de abajo} = Q_1 − 1.5 × IQR
- Q_1, Q_3: el primer cuartil (el p25) y el tercero (el p75), en ms
- IQR: el rango intercuartílico, en ms
:::

Un valor arriba del límite de arriba, o abajo del de abajo, queda marcado como atípico.

:::cuenta La regla de Tukey en las 20 requests
Rango intercuartílico \(IQR\) // \(Q_3\) = 50, \(Q_1\) = 34 | \(IQR = Q_3 − Q_1\) = 50 − 34 | 16 ms
Límite de arriba | \(Q_3 + 1.5 × IQR\) = 50 + 1.5 × 16 | 74 ms
Límite de abajo | \(Q_1 − 1.5 × IQR\) = 34 − 1.5 × 16 | 10 ms
Arriba de 74 ms | la de 160 y la de 900 | 2 atípicas
= La de 70 ms se queda adentro; la de 160 y la de 900 quedan marcadas. Ninguna queda abajo de 10 ms.
:::

Marcar no es borrar. En latencia, que la regla marque una request quiere decir «mira qué le pasó»: una foto gigante, una pausa del programa, un reintento. Donde sí sirve para limpiar es en los datos de entrenamiento: una [[feature]] con «edad = 999» es un error de captura, no una persona de 999 años.

### Fan-out: cuando cada pieza tiene que ser mejor que el todo

Hay un caso en el que la cola **crece** al juntar piezas. Cuando una request se reparte en varias llamadas en paralelo y espera a todas, se dice que hace [[fan-out]]: tarda lo que la más lenta de sus llamadas. «Probabilidad para sistemas que fallan» lo desarrolla a fondo; aquí va la cuenta.

Si una request espera a \(k\) llamadas en paralelo y cada una llega a tiempo el 99 % de las veces, sin importar las demás, la probabilidad de que las \(k\) lleguen a tiempo es 0.99 multiplicado \(k\) veces, y la de que la request toque alguna cola es lo que falta para 1. Es la misma cuenta que la de quien publica 30 fotos:

:::formula Fan-out: requests que tocan alguna cola
P = 1 − a^k
a ≥ (1 − P)^{1/k}
- k: cuántas llamadas en paralelo espera la request
- a: la fracción de veces que cada llamada llega a tiempo, sin importar las demás: 0.99 si cada una pasa de su p99 el 1 % de las veces
- P: la fracción de requests que espera al menos a una llamada lenta
:::

La segunda línea despeja \(a\) de la primera: dice qué tiene que cumplir cada llamada para que solo la fracción \(P\) de las requests sea lenta. La cuenta tiene una consecuencia incómoda:

:::cuenta Requests que tocan alguna cola, y lo que tiene que cumplir cada pieza
1 llamada // \(a\) = 0.99, \(k\) = 1 | \(P = 1 − 0.99\) | 1 %
10 llamadas // \(k\) = 10 | \(P = 1 − 0.99^{10}\) | ≈ 9.6 %
100 llamadas // \(k\) = 100 | \(P = 1 − 0.99^{100}\) | ≈ 63.4 %
20 llamadas // una página que espera a 20 servicios | \(P = 1 − 0.99^{20}\) | ≈ 18 %
Para que solo 1 de cada 100 páginas sea lenta // \(P\) = 0.01, \(k\) = 20 | \(a ≥ (1 − 0.01)^{1/20} = 0.99^{1/20}\) | \(a\) ≥ 0.9995
= Con 100 llamadas, la mayoría de las requests espera a alguna lenta. Y con 20, cada servicio tiene que cumplir su p99.95, no su p99.
:::

Es el argumento central de *The Tail at Scale*, un artículo de Jeffrey Dean y Luiz André Barroso, de Google (Communications of the ACM, 2013): a escala, el p99 de cada pieza se vuelve la latencia típica del conjunto. Contra eso hay tres respuestas de diseño:

- **Menos llamadas en el camino de la persona.** Lo que se pueda calcular antes, se calcula antes y se guarda.
- **Recortar la cola de cada llamada.** Un timeout corto con una respuesta parcial. Alba tiene un asistente interno que responde las preguntas de sus empleados con los documentos de la empresa: si su reordenador de resultados no responde en 400 ms, se usa el orden que ya se tenía.
- **Pedir dos veces.** El artículo describe las *hedged requests*: si la primera copia no responde en lo que tarda su p95, se manda la misma petición a otra copia y se usa la que llegue primero. Como solo se repite el 5 % más lento, la carga extra es de ≈ 5 %. En una prueba de Google que cuenta el artículo, que leía 1,000 valores guardados en 100 servidores, mandar la segunda petición a los 10 ms bajó el p99.9 del tiempo para tenerlos todos de 1,800 ms a 74 ms, con apenas 2 % más requests.

### ¿Cuántas muestras necesita un p99?

Un p99 dice algo sobre el 1 % más lento. Si hay pocas requests, ese 1 % son una o ninguna. Por el rango más cercano, arriba del percentil quedan \(N − ⌈r⌉\) requests, con \(r = q/100 × N\):

| Requests en la ventana | Arriba del p99 | Arriba del p99.9 |
|---|---|---|
| 20 | 0: el p99 es la más lenta | 0 |
| 100 | 1 | 0 |
| 1,000 | 10 | 1 |
| 10,000 | 100 | 10 |

Con menos de 100 requests, el p99 es simplemente la más lenta; con 100, la penúltima. Y la más lenta de un puñado brinca muchísimo de una ventana a otra. Este programa lo muestra con un servicio de juguete hecho para que su p99 de verdad sea **180 ms**: el 98 % de sus requests tarda entre 20 y 80 ms, y el 2 %, entre 120 y 240. Abajo de 120 ms queda el 98 %; falta un 1 % más, que es la mitad de las lentas, y la mitad del camino entre 120 y 240 es 180. El programa mide cinco ventanas de cada tamaño:

```python
import math
import random

random.seed(10)

def una_request():
    # servicio de juguete: 98 % entre 20 y 80 ms, 2 % entre 120 y 240 ms
    if random.random() < 0.02:
        return random.uniform(120, 240)
    return random.uniform(20, 80)

def p99(xs):
    s = sorted(xs)
    return s[math.ceil(99 * len(s) / 100) - 1]

for n in (50, 100, 1_000, 100_000):
    ventanas = [p99([una_request() for _ in range(n)]) for _ in range(5)]
    print(f"{n:>7,} requests:", "  ".join(f"{v:4.0f}" for v in ventanas))
```

```salida
     50 requests:  206   184   144   220    79
    100 requests:   80   211    79   221    79
  1,000 requests:  176   200   167   205   155
100,000 requests:  179   175   179   181   181
```

Con ventanas de 50 o de 100 requests, el p99 brinca entre 79 y 221 ms sin que nada cambie en el servicio: a veces es una alarma falsa y a veces una calma falsa. Con 1,000, dos de las cinco ventanas todavía pasan de 200 (la que se ve como 200 es 200.4), porque el p99 de verdad está cerca del límite. Con 100,000, las cinco dicen ≈ 180.

Las requests que mediste son una [[muestra]] de todas las que pudieron pasar; qué tanto puedes confiar en lo que dice una muestra es el tema de «Ruido, muestras y pruebas A/B». Para un SLO, la consecuencia práctica es esta:

- **Reporta cuántas requests hay detrás de cada percentil:** «p99 = 900 ms (N = 20)» se lee muy distinto que «p99 = 900 ms (N = 34,800)», que son 5 minutos de Alba a su ritmo promedio (≈ 116 requests por segundo × 300 s).
- **No alertes con tráfico bajo.** Alba, en el promedio del día, recibe ≈ 116 requests por segundo, unas 116 × 60 = 6,960 por minuto (≈ 70 arriba del p99), pero de madrugada muchas menos. Una protección común: la alerta de errores exige al menos 1 request por segundo, porque con 20 requests de madrugada un solo error sería el 5 %.
- **Pide que dure.** La alerta de p99 de Alba espera 10 minutos seguidos arriba de 200 ms: una ventana ruidosa no despierta a nadie.

## Errores comunes {Common mistakes}

### 1. Reportar el promedio de latencia

«Responde en 51 ms en promedio» puede salir del mismo minuto en el que el p99 fue de 488 ms, como en el histograma de esta lección.

**Cómo evitarlo:** reporta el p50 y el p99 (y el p99.9 si hay tráfico de sobra), con unidad, ventana y lugar de medición: «p99 de 186 ms del lado del servidor, ventana de 5 minutos».

### 2. Promediar percentiles

Promediar los p99 de los pods, o los de cada hora para sacar el del día. El resultado puede salir muy arriba o muy abajo, y no es ningún percentil.

**Cómo evitarlo:** suma los buckets (`sum by (le)`) y calcula el percentil al final, o usa la fracción de requests bajo el umbral, que sí se suma.

### 3. Sumar los p99 de cada tramo

Creer que el p99 de la request completa es la suma de los p99 de sus tramos (o la mediana, la suma de las medianas). Puede quedar arriba o abajo.

**Cómo evitarlo:** usa la suma solo como presupuesto para repartir, y mide la request de punta a punta con su propio histograma.

### 4. Un p99 con muy pocas muestras

Con 50 requests, el «p99» es la más lenta de las 50, y brinca de una ventana a otra.

**Cómo evitarlo:** reporta cuántas requests hay detrás de cada percentil, pide un mínimo de tráfico antes de alertar, alarga la ventana cuando hay poco tráfico, y no le pidas un p99.9 a menos de unos miles de requests.

### 5. Buckets demasiado gruesos o sin borde en el SLO

Con bordes en 100 y 500 ms, el mismo p99 que con los bordes de Alba sale ≈ 186 ms se estima como ≈ 445 ms, una alarma falsa, y nadie puede contar cuántas pasaron de 200.

**Cómo evitarlo:** bordes cerca del SLO y uno exactamente en él, como los 150, 200 y 300 ms de Alba. Si cambias el SLO, cambia los buckets.

### 6. Borrar las requests lentas

Quitar «los atípicos» para que la gráfica se vea limpia borra justo la cola que prometiste controlar. Su primo: no contar las llamadas que vencieron su timeout, y ver un p99 sano justo cuando el servicio está peor.

**Cómo evitarlo:** quita solo errores de medición comprobados. Las lentas reales se investigan (qué foto, qué copia, a qué hora), y las que vencen el timeout también entran al histograma: alguien también las esperó.

### 7. No decir dónde se mide

Tu histograma dice p99 = 120 ms y el equipo de la app ve 900 ms. No hay contradicción: la subida de la foto por 4G no está en tu histograma.

**Cómo evitarlo:** cada número de latencia lleva su punto de medición. El SLO de Alba dice «del lado del servidor», y quien lo llama tiene su propio timeout de 300 ms.

## En la vida real {In real life} [extra]

### Alba: la promesa completa, pieza por pieza

Ya puedes leer todas las piezas del caso. La promesa: p99 ≤ 200 ms del lado del servidor, con un p50 esperado de ≈ 20–50 ms. Quien llama espera 300 ms; si no hay respuesta, Ana ve el selector manual. La medición: un histograma con 11 bordes, de 10 ms a 2.5 s, con uno justo en 200 y vecinos en 150 y 300. La alerta: p99 arriba de 200 ms durante 10 minutos, y alguien despierta.

Hay un detalle más que hace útil al histograma cuando algo falla. Alba no tiene uno solo: tiene otro para el preprocesamiento (leer y preparar la foto, en CPU) y otro para la llamada al modelo (el viaje al servidor con la GPU y de regreso). Cuando el p99 total sube, comparar los dos dice qué tramo creció, y a cuál le hacen falta máquinas. Y la estimación del equipo de Alba para el caso lento, 152 ms (red, preprocesamiento, modelo, respuesta y el propio programa: 40 + 52 + 27 + 3 + 30), deja 200 − 152 = 48 ms, ≈ 50, de margen: es una suma de casos lentos, así que sirve para planear, no para prometer.

Alba tiene además una segunda promesa, la de disponibilidad: 99.9 % al mes. Su SLI cuenta las requests que respondieron sin error del servidor **y** dentro de 300 ms, entre las requests válidas; su presupuesto, el 0.1 % de ≈ 300 millones de requests en 30 días, son unas 300,000 requests al mes.

Y el promedio también tiene su lugar en el caso, porque es el número de los totales: cuánto cuesta servir un día, o cuántas requests hay adentro del sistema a la vez. Con la ley de Little (requests en curso = requests por segundo × latencia promedio), el equipo de Alba calcula que en su pico de diseño, 500 requests por segundo con 50 ms en promedio, hay 500 × 0.05 = 25 requests adentro del sistema a la vez. Para la promesa, en cambio, se usan percentiles: en los tableros de Alba, la latencia de las requests aparece como p50 y p99, no como promedio.

### El asistente interno: un RAG que promete la mediana

Alba también tiene un asistente interno que responde las preguntas de sus ≈ 8,000 empleados con los documentos de la empresa, un [[rag|RAG]], con ≈ 25 mil preguntas al día. Sus promesas usan tres percentiles distintos:

| Qué se mide | Promesa | Por qué ese percentil |
|---|---|---|
| Buscar y reordenar los documentos | p95 ≤ 700 ms | Es trabajo de servidores; la cola se controla con timeouts |
| Hasta el primer pedazo de respuesta | p95 ≤ 2.5 s | Es lo que la persona espera viendo la pantalla vacía |
| La respuesta completa | p50 ≤ 10 s | La cola la deciden las respuestas largas, no los servidores |

La última es la interesante. Una respuesta típica de ≈ 300 [[token|tokens]], a ≈ 25–40 ms por token, tarda entre 300 × 25 ms = 7.5 s y 300 × 40 ms = 12 s en generarse, más ≈ 1–1.8 s hasta el primer token; una de 600 tokens tarda 15–24 s solo en generarse. Con eso, el equipo de Alba estima un promedio de ≈ 11 s y una mediana de ≈ 10: la mayoría de las respuestas son más cortas que el promedio, y las largas lo jalan hacia arriba, como el millonario de la fonda. La cola de la respuesta completa está hecha de **preguntas que piden respuestas largas**, no de máquinas lentas. Prometer un p95 de 10 s sería prometer respuestas cortas. Por eso el asistente promete la mediana, mantiene la cola corta con instrucciones de brevedad y un tope de 600 tokens, y manda el texto mientras se escribe (*streaming*), para que la persona empiece a leer antes.

Por dentro también hay fan-out: la búsqueda por palabras y la búsqueda por significado corren en paralelo, cada una con un timeout de 300 ms, y el reordenador tiene 400 ms; si no llega, se usa el orden anterior. Cada timeout corta la cola de una pieza para que no se vuelva la cola de todos.

### Voz a texto: subtítulos en vivo y el factor de tiempo real

Un servicio de voz a texto en tiempo real pone subtítulos en vivo en videollamadas. En este ejemplo, el audio llega en fragmentos de 160 ms y el modelo procesa cada fragmento en un paso. La medida clave es el **factor de tiempo real** (*real-time factor*, RTF): tiempo de procesamiento ÷ duración del audio, \(RTF = t_{paso} ÷ t_{audio}\), con los dos tiempos en ms. Abajo de 1, el sistema va más rápido que la voz.

:::cuenta El factor de tiempo real de los subtítulos
Un paso de 80 ms // el doble de rápido que la voz | \(RTF = t_{paso} ÷ t_{audio}\) = 80 ÷ 160 | RTF 0.5
El umbral de la alerta // un paso de 128 ms, medido en el p95 del paso | 128 ÷ 160 | RTF 0.8
Un paso de 200 ms // el texto se atrasa 200 − 160 = 40 ms más en cada fragmento | 200 ÷ 160 | RTF 1.25
= El servicio vigila el p95 del paso, no su promedio: un promedio de 80 ms puede esconder pasos de 200 ms, y cada uno atrasa el texto que la persona lee.
:::

Con RTF = 1 no queda margen: si el paso tarda en promedio lo mismo que el fragmento, cada paso que se alarga atrasa a los que siguen y nunca hay tiempo libre para ponerse al día, así que el atraso se va acumulando. Por eso la alerta suena cuando el p95 del paso pasa de 128 ms, el 80 % del fragmento, durante 5 minutos. Y la promesa al usuario también es un percentil: los subtítulos parciales, en p95 ≤ 500 ms desde que se dice la palabra; la frase final, en p95 ≤ 1.5 s desde que la persona deja de hablar.

### Fuera de ML: el ingreso de un país

Los ingresos tienen una cola larga a la derecha: unas pocas personas ganan muchísimo, como el millonario de la fonda. Por eso el ingreso promedio de un país queda arriba de lo que gana un hogar típico, y las oficinas de estadística reportan también la mediana o los deciles. La Oficina del Censo de Estados Unidos publica cada año el ingreso **mediano** de los hogares; el INEGI, en la ENIGH, que sale cada dos años, el ingreso promedio y cómo se reparte entre los deciles de hogares.

Un hábito que sirve igual con sueldos que con latencias: cuando leas «el promedio subió», pregunta qué pasó con la mediana. Si el promedio sube y la mediana no, el aumento se lo llevó la cola.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de percentiles de una lista y de buckets se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Siete requests tardaron 35, 38, 40, 41, 44, 47 y 600 ms. Calcula el promedio y la mediana. ¿Cuál describe mejor a la request típica?
- Promedio: \((x_1 + … + x_N) ÷ N\) con \(N\) = 7: (35 + 38 + 40 + 41 + 44 + 47 + 600) ÷ 7 = 845 ÷ 7 ≈ **120.7 ms**.
- Mediana: ya están ordenadas y \(N\) = 7 es impar, así que es \(x_{(7+1)/2} = x_4\), la 4.ª: **41 ms**.
- La mediana: 6 de las 7 tardaron menos de 50 ms. Pero la de 600 ms no se borra: es la que hay que investigar.
? [facil] Diez requests, ya ordenadas: 22, 25, 27, 30, 31, 33, 36, 40, 58 y 210 ms. Con el rango más cercano, ¿cuánto valen el p50, el p90 y el p99?
- Usa \(r = q/100 × N\) y \(p = x_{⌈r⌉}\), con \(N\) = 10.
- p50: \(r\) = 0.50 × 10 = 5 → \(x_5\), **31 ms**.
- p90: \(r\) = 0.90 × 10 = 9 → \(x_9\), **58 ms**.
- p99: \(r\) = 0.99 × 10 = 9.9 → hacia arriba, \(x_{10}\), **210 ms**: con 10 requests, el p99 es la más lenta.
? [facil] De 1,000 requests, 970 tardaron 30 ms y 30 tardaron 500 ms. Calcula el promedio, el p95 y el p99. ¿Se cumple «p99 ≤ 200 ms»?
- Promedio: la suma de todas entre \(N\) = 1,000: (970 × 30 + 30 × 500) ÷ 1,000 = (29,100 + 15,000) ÷ 1,000 = **44.1 ms**.
- p95: \(r\) = 0.95 × 1,000 = 950 → \(x_{950}\), y las primeras 970 son de 30 ms: **30 ms**. p99: \(r\) = 0.99 × 1,000 = 990 → \(x_{990}\), y de la 971 en adelante son de 500 ms: **500 ms**.
- **No se cumple**: el 3 % tardó 500 ms y la promesa permite el 1 %. El promedio, 44 ms, se veía perfecto.
? [facil] En una ventana de 5 minutos llegaron 48,000 requests, y 47,450 tardaron 200 ms o menos. ¿Cuánto vale el SLI como fracción? ¿Se cumple el SLO de latencia de Alba, que pide al menos 99 % de las requests en 200 ms o menos? ¿El p99 quedó arriba o abajo de 200 ms?
- SLI = requests en 200 ms o menos ÷ total = 47,450 ÷ 48,000 ≈ **98.85 %**. El SLO pide al menos 99 %: **no se cumple**, por 0.15 puntos.
- Pasaron de 200 ms 48,000 − 47,450 = 550 requests; 550 ÷ 48,000 ≈ 1.15 %: más del 1 %, así que el p99 quedó **arriba** de 200 ms. Las dos formas de la promesa dicen lo mismo.
? [medio] Tres requests pasan por un tramo A y luego por un tramo B. En A tardan 1, 1 y 10 ms; en B, en el mismo orden, 10, 1 y 1 ms. Calcula la mediana de A, la de B y la de la request completa. ¿Se suman?
- Con \(N\) = 3, la mediana es \(x_{(3+1)/2} = x_2\), la de en medio. Mediana de A: ordenadas, 1, 1, 10 → **1 ms**. Mediana de B: 1, 1, 10 → **1 ms**.
- Request completa: 1 + 10 = 11, 1 + 1 = 2 y 10 + 1 = 11. Ordenadas, 2, 11, 11 → mediana **11 ms**.
- La suma de las medianas da 2 ms y la de verdad es 11: **no se suman**. Los promedios sí: 4 + 4 = 8, y (11 + 2 + 11) ÷ 3 = 8.
? [medio] Tres pods reportan su p99: 90, 110 y 600 ms. Alguien dice que el p99 del servicio es su promedio, ≈ 267 ms. ¿Tiene razón? Después te pasan los conteos: los pods A y B atendieron 5,000 requests cada uno, con 40 de cada uno arriba de 200 ms; el pod C arrancó en frío y atendió 100, todas en ≈ 600 ms. ¿Se cumple «p99 ≤ 200 ms»?
- Sin los conteos **no se puede saber**: el p99 de todo depende de cuánto tráfico atendió cada pod y de la forma de cada distribución.
- Con los conteos: 10,100 requests en total, y 40 + 40 + 100 = 180 arriba de 200 ms.
- Fracción lenta = lentas ÷ total = 180 ÷ 10,100 ≈ **1.8 %**, más del 1 %: **no se cumple**, aunque dos de los tres pods se vean sanos.
? [medio] Una ventana tiene estos conteos por bucket, no acumulados: hasta 50 ms, 4,000; de 50 a 100, 800; de 100 a 200, 150; de 200 a 500, 40; más de 500, 10. Estima el p95 y el p99 como lo hace Prometheus, y calcula la fracción en 200 ms o menos.
- Usa \(r = q/100 × N\) y \(p ≈ L + (U − L) × (r − C)/n\), las letras de la sección de buckets.
- Total \(N\): 4,000 + 800 + 150 + 40 + 10 = 5,000. Acumulados: 4,000; 4,800; 4,950; 4,990; 5,000.
- p95: \(r\) = 0.95 × 5,000 = 4,750, que cae en 50–100 (4,000 < 4,750 ≤ 4,800). Ahí \(L\) = 50, \(U\) = 100, \(C\) = 4,000 y \(n\) = 800: \(p\) ≈ 50 + 50 × (4,750 − 4,000) ÷ 800 = 50 + 50 × 0.9375 ≈ **96.9 ms**.
- p99: \(r\) = 0.99 × 5,000 = 4,950, que cae en 100–200 (4,800 < 4,950 ≤ 4,950), justo en su borde de arriba. Ahí \(L\) = 100, \(U\) = 200, \(C\) = 4,800 y \(n\) = 150: \(p\) ≈ 100 + 100 × (4,950 − 4,800) ÷ 150 = 100 + 100 × 1 = **200 ms**.
- Fracción en 200 ms o menos: el acumulado hasta 200 entre \(N\): 4,950 ÷ 5,000 = **99 %**. Se cumple justo en el límite: una request lenta más y se rompe.
? [medio] Un servicio tuvo 23 horas tranquilas con 1,000 requests cada una y un p99 de 100 ms. En la hora pico atendió 100,000 requests y el 2 % tardó 500 ms. (a) ¿Cuánto da el promedio de los 24 p99 horarios? (b) ¿Cuál es el p99 del día?
- (a) En la hora pico el 2 % pasa del 1 %, así que su p99 es 500 ms. Promedio: (23 × 100 + 500) ÷ 24 ≈ **117 ms**.
- (b) El día tiene 23 × 1,000 + 100,000 = 123,000 requests, y las de 500 ms son 0.02 × 100,000 = 2,000: 2,000 ÷ 123,000 ≈ 1.6 %: más del 1 %. El p99 del día es **500 ms**.
- El promedio de las horas le dio a la hora pico el mismo peso que a las 3 de la mañana, aunque tuvo 100 veces más requests. Pesarlas por tráfico tampoco sirve: (23,000 × 100 + 100,000 × 500) ÷ 123,000 ≈ 425 ms, otro número que no es el p99.
? [reto] Una página espera a 20 servicios llamados en paralelo, y cada uno pasa de 100 ms el 1 % de las veces, sin importar los demás. (a) ¿Qué fracción de las páginas tarda más de 100 ms? (b) Si quieres que solo el 1 % de las páginas pase de 100 ms, ¿qué tendría que cumplir cada servicio?
- Usa la fórmula del fan-out: \(P = 1 − a^k\), con \(a\) = 0.99 y \(k\) = 20.
- (a) La página es lenta si al menos un servicio lo es: \(P = 1 − 0.99^{20}\) ≈ 1 − 0.818 = **18.2 %**, casi 1 de cada 5.
- (b) Con \(P\) = 0.01: \(a ≥ (1 − P)^{1/k} = 0.99^{1/20}\) ≈ 0.9995.
- Cada servicio tendría que responder en 100 ms o menos el **99.95 %** de las veces: su p99.95, no su p99.
? [reto] El SLO de latencia de Alba, «al menos 99 % de las requests en 200 ms o menos», se cuenta en 30 días, con ≈ 10 millones de requests al día. (a) ¿Cuántas requests lentas permite el mes? (b) Un deploy malo hace que el 20 % de las requests pase de 200 ms durante 2 horas de pico, a 350 por segundo. ¿Qué parte del presupuesto del mes se gastó? (c) De madrugada llegan 20 requests por segundo. En una ventana de 1 minuto, ¿cuántas quedan arriba del p99.9?
- (a) Presupuesto = 0.01 × total del mes. El mes: 30 × 10,000,000 = 300,000,000 requests; 0.01 × 300,000,000 = **3,000,000** lentas permitidas.
- (b) Requests = requests por segundo × segundos: 2 horas son 2 × 3,600 = 7,200 s, y 350 × 7,200 = 2,520,000 requests. El 20 % son 0.20 × 2,520,000 = 504,000 lentas. Gastado = lentas ÷ presupuesto = 504,000 ÷ 3,000,000 = **16.8 %** del presupuesto del mes, en una tarde.
- (c) \(N\) = 20 × 60 = 1,200 requests. Rango: \(r\) = 0.999 × 1,200 = 1,198.8 → \(⌈r⌉\) = 1,199, y arriba quedan \(N − ⌈r⌉\) = 1,200 − 1,199 = **una sola**. El «p99.9» de ese minuto sería la penúltima request: puro ruido.
:::

## Lo que sigue {What comes next} [extra]

- La siguiente lección, «Probabilidad para sistemas que fallan», hace a fondo la cuenta del fan-out y del presupuesto de error.
- «Ruido, muestras y pruebas A/B» explica cuánto puedes confiar en un número que sale de una muestra.
- «Comparar distribuciones: cómo se mide el drift» compara dos histogramas con buckets como los de aquí.
- «Qué tan rápido y cuánto: latencia y throughput» explica por qué el p99 sube cuando se llena una fila de espera.
- «La request en vivo» y «Monitoreo, drift y reentrenamiento» arman, sobre el sistema de Alba, el SLO de p99 ≤ 200 ms, el histograma de 11 bordes y la alerta de p99 arriba de 200 ms durante 10 minutos que viste aquí.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
promedio mediana distribucion histograma cola-distribucion valor-atipico percentil p99 bucket sli slo
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Un servicio reporta una latencia promedio de 51 ms. ¿Por qué eso no basta para saber si cumple «p99 ≤ 200 ms»?
Porque el promedio no dice cuántas requests fueron lentas. En el histograma de esta lección, un promedio de 51 ms convivía con un p99 de 488 ms.
? ¿Qué quiere decir «p99 ≤ 200 ms», en una sola frase?
Que al menos el 99 % de las requests tarda 200 ms o menos: a lo más 1 de cada 100 tarda más.
? Con 20 latencias ordenadas, ¿qué posición es el p95 por el rango más cercano? ¿Y el p99?
0.95 × 20 = 19: la 19.ª. El p99 es la 20.ª, la más lenta, porque 0.99 × 20 = 19.8 se redondea hacia arriba.
? ¿Por qué no se pueden promediar los p99 de varios pods?
Porque el p99 de todo depende de cuántas requests atendió cada pod y de cuántas fueron lentas, y eso no está en los p99. Se suman los buckets de todos y el percentil se calcula al final.
? ¿Por qué un sistema de monitoreo guarda buckets y no cada latencia?
Porque los contadores son baratos y se suman entre copias y entre ventanas, y con ellos se estima cualquier percentil interpolando dentro de un bucket. Los percentiles ya calculados no se pueden combinar.
? ¿Cuál es la diferencia entre un SLI y un SLO?
El SLI es lo que mides, por ejemplo la fracción de requests en 200 ms o menos. El SLO es la meta para ese número en una ventana: al menos 99 %.
? En una ventana de 5 minutos de madrugada llegaron 40 requests. ¿Qué es su «p99»?
La más lenta de las 40, porque 0.99 × 40 = 39.6 se redondea a 40. Es casi puro ruido: conviene alargar la ventana o no alertar.
:::
