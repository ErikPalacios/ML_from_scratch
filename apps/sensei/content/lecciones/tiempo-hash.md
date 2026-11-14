---
titulo: Tiempo, hashes e identificadores
en: Time, hashes and identifiers
subtitulo: Cómo se escribe una hora para que nadie la malinterprete, por qué un modelo no puede entrenar con datos del futuro y cómo un número que sale de un texto reparte usuarios, máquinas y experimentos, siempre igual.
pregunta: Cada predicción del clasificador de fotos de Alba lleva una hora y un identificador. ¿Cómo se escribe una hora para que no se confunda entre países y máquinas, por qué no se puede entrenar con datos «del futuro» y cómo un hash decide, siempre igual, a qué grupo de un A/B o a qué máquina va cada usuario?
requisitos: numeros-maquina, bases-de-datos, colas
---

:::idea
Una hora se guarda como un número que todos cuentan igual (segundos desde 1970, en UTC) y se escribe en un formato que no deja dudas (ISO 8601, con su zona). Un hash convierte cualquier cosa en un número de tamaño fijo, siempre el mismo: sirve de huella para reconocer contenido y de sorteo repetible para repartir usuarios y datos sin guardar ninguna tabla. Y un identificador por request une todo lo que pasó con ella.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y, con un modelo, le sugiere a quien vende la categoría de cada foto, entre 500 posibles. En total clasifica ≈ 10 millones de fotos al día.

Ana sube la foto de sus tenis a las 8:03 de la mañana, en la Ciudad de México. El gateway de Alba, el servicio que recibe la foto y se la pasa al modelo, la clasifica y deja una línea en su *log*, el registro de texto donde un programa anota lo que hace:

```json
{"ts": "2026-11-06T14:03:05.412Z",
 "request_id": "9f2c41d0",
 "seller_id": "vend-00024", "brazo": "A",
 "sha256": "8f0be2119c3d…",
 "model_version": "resnet50-2026-10-01", "top1": "tenis", "latency_ms": 41}
```

Es una versión corta: la línea completa, con el top-5 y los milisegundos de cada paso, está en la lección de formatos. La hora la pone quien guarda el log, y el vendedor y el brazo del A/B los anota el backend. Casi cada campo de esa línea es esta lección. La hora dice 14:03, no 8:03, y termina en una Z: ¿por qué? El `request_id` es un nombre que nadie más tiene: ¿quién lo inventó sin preguntarle a nadie? El `sha256` es una huella de la foto. Y el brazo «A» del [[ab-test|experimento A/B]] salió de otra huella, la del vendedor.

Con esas piezas vas a responder tres preguntas que salen todo el tiempo al diseñar un sistema de ML: qué hora es «la hora» de algo, cómo armar un dataset sin colarle el futuro y cómo repartir al azar, pero siempre igual.

## Escribir la hora: tiempo Unix, UTC e ISO 8601 {Writing the time: Unix time, UTC and ISO 8601}

### Un instante como número

Un [[timestamp]] (marca de tiempo) es la hora en que pasó algo, guardada junto con ese algo: cuándo se subió una foto, cuándo se calculó una predicción, cuándo llegó una etiqueta. Para que una computadora compare y reste horas, lo más cómodo es guardarlas como un solo número.

El número que casi todas usan es el [[tiempo-unix|tiempo Unix]] (*Unix time* o *epoch time*): los segundos que han pasado desde el 1 de enero de 1970 a las 00:00:00, en UTC (en un momento ves qué es UTC). Ese instante de partida se llama el *epoch* de Unix. Nada que ver con la [[epoch|época]] de entrenamiento: es la misma palabra en inglés para otra cosa.

Así, el instante en que Ana subió su foto es el número **1,793,973,785**. Restar dos tiempos Unix da los segundos entre ellos, sin pensar en meses, años bisiestos ni horarios. Un día tiene 86,400 segundos, así que 1,793,973,785 ÷ 86,400 ≈ 20,764 días desde 1970: casi 57 años.

El mismo instante se escribe a veces en **milisegundos** (1,793,973,785,000: lo que da `Date.now()` en JavaScript, el lenguaje de las páginas web, y lo que usan muchos sistemas de eventos, como la hora de cada mensaje de Kafka, el registro de eventos de la lección de colas) o en **microsegundos**, con tres ceros más. En Python, `time.time()` da segundos con decimales, un [[punto-flotante|float]].

:::ojo
Un número así no dice en qué unidad está. 1,793,973,785 leído como milisegundos es el 21 de enero de 1970. Si dos sistemas se pasan timestamps, el contrato tiene que decir la unidad, o mejor, viajar en un formato de texto que no deje dudas, como el de abajo.
:::

¿En qué tipo de dato se guarda? Si es un [[entero]] de 32 bits con signo (un *int32*), el tope es 2³¹ − 1 = 2,147,483,647, y llega antes de lo que parece.

:::cuenta El problema del año 2038
El int32 más grande | 2³¹ − 1 | 2,147,483,647 s
En años // un año tiene 365.25 × 86,400 = 31,557,600 s | 2,147,483,647 ÷ 31,557,600 | ≈ 68 años
Desde 1970 | 1970 + 68 | 2038
El instante exacto // a las 03:14:07 UTC | 1970-01-01 + 2,147,483,647 s | 19 de enero de 2038
Un segundo después // un [[overflow]]: el int32 más negativo, el 13 de diciembre de 1901 | −2,147,483,648 s | 1901
= Un contador int32 de segundos salta de 2038 a 1901. Con int64, el tope queda a ≈ 292,000 millones de años: por eso los sistemas nuevos guardan el tiempo en 64 bits.
:::

```python
from datetime import datetime, timezone

t = 1_793_973_785                      # un tiempo Unix: segundos desde 1970, en UTC
print(datetime.fromtimestamp(0, tz=timezone.utc))
print(datetime.fromtimestamp(t, tz=timezone.utc))
print("en milisegundos:", t * 1000, "· en microsegundos:", t * 1_000_000)

tope = 2**31 - 1                       # el int32 más grande
print("el int32 se llena el", datetime.fromtimestamp(tope, tz=timezone.utc))
print("y da la vuelta al", datetime.fromtimestamp(-2**31, tz=timezone.utc))
```

```salida
1970-01-01 00:00:00+00:00
2026-11-06 14:03:05+00:00
en milisegundos: 1793973785000 · en microsegundos: 1793973785000000
el int32 se llena el 2038-01-19 03:14:07+00:00
y da la vuelta al 1901-12-13 20:45:52+00:00
```

### UTC: la hora de referencia

El tiempo Unix cuenta desde una hora fija del planeta, no desde la de un país. Esa referencia es [[utc|UTC]] (*Coordinated Universal Time*, tiempo universal coordinado): la hora que sale de los relojes atómicos y que heredó el papel de «la hora de Greenwich» (GMT). Cada zona horaria se describe por su diferencia con UTC, el *offset*:

- La Ciudad de México está en **UTC−6** todo el año: a las 14:03 UTC son las 8:03 de Ana.
- Cancún, en UTC−5. Madrid, en UTC+1 en invierno y UTC+2 en verano.
- Tijuana, en UTC−8 en invierno y UTC−7 en verano.

Ese «en verano» es el **horario de verano** (*daylight saving time*): adelantar el reloj una hora en primavera y regresarla en otoño. México lo quitó con la Ley de los Husos Horarios de 2022 (el último cambio general fue el 30 de octubre de ese año), pero los municipios de la franja fronteriza del norte, entre ellos todo Baja California, lo conservan para ir al parejo de Estados Unidos. Por eso Tijuana cambia y la Ciudad de México no. Las reglas de cada zona, con todos sus cambios históricos, viven en una base de datos pública, la *tz database*, que traen el sistema operativo y Python (`zoneinfo`). Sus zonas tienen nombres como `America/Mexico_City`.

Esto lleva a la regla de oro: **guarda en UTC y muestra en la hora local**. Las horas de los logs, de las bases de datos y de los datasets van en UTC; la conversión a la hora de cada persona se hace una sola vez, en la pantalla. Una hora sin zona se llama *naive* (ingenua): `2026-11-06 08:03:05` no dice si es de CDMX, de Tijuana o de Madrid. Dicho corto: un timestamp sin zona es la hora local «de quién sabe dónde».

### La hora que no existe y la que se repite

Donde sí hay horario de verano pasan dos cosas raras, una vez al año cada una:

:::figura tiempo-hash-cambio-horario
Tijuana en 2026. En marzo, el reloj local brinca de 1:59 a 3:00: las 2:30 de ese día no existen. En noviembre, regresa de 1:59 a 1:00: la 1:30 pasa dos veces, y en UTC son dos instantes distintos. Abajo, en UTC, cada hora llega una vez y en orden.
:::

- El 8 de marzo de 2026, en Tijuana, el reloj pasa de 1:59:59 a 3:00:00. Las **2:30 no existen**: ese día dura 23 horas.
- El 1 de noviembre, pasa de 1:59:59 a 1:00:00. La **1:30 ocurre dos veces**, una en UTC−7 y otra en UTC−8. Ese día dura 25.

Un job programado «a las 2:30, hora local» se puede saltar en marzo, y uno «a la 1:30» puede correr dos veces en noviembre; qué pasa exactamente depende del programa que los lanza. Un conteo «por hora local» tiene una hora que junta dos. En UTC nada de esto pasa.

:::profundo Las zonas en Python, con zoneinfo
El mismo instante en cuatro zonas, una hora sin zona y las dos horas raras de Tijuana:

```python
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ahora = datetime(2026, 11, 6, 14, 3, 5, tzinfo=timezone.utc)   # un instante, en UTC
for zona in ("America/Mexico_City", "America/Tijuana", "America/Cancun", "Europe/Madrid"):
    print(f"{zona:<20}", ahora.astimezone(ZoneInfo(zona)).isoformat())

ingenua = datetime(2026, 11, 6, 8, 3, 5)          # sin zona: ¿de dónde?
print("sin zona:", ingenua.isoformat(), "· tzinfo =", ingenua.tzinfo)

tj = ZoneInfo("America/Tijuana")
no_existe = datetime(2026, 3, 8, 2, 30, tzinfo=tj)  # ese día el reloj salta de 2:00 a 3:00
print("ida y vuelta de las 2:30:", no_existe.astimezone(timezone.utc).astimezone(tj).time())
primera = datetime(2026, 11, 1, 1, 30, tzinfo=tj)            # ese día, la 1:30 pasa dos veces
segunda = datetime(2026, 11, 1, 1, 30, fold=1, tzinfo=tj)
print("la 1:30 de dos maneras:", primera.astimezone(timezone.utc).time(), "y",
      segunda.astimezone(timezone.utc).time(), "en UTC")
```

```salida
America/Mexico_City  2026-11-06T08:03:05-06:00
America/Tijuana      2026-11-06T06:03:05-08:00
America/Cancun       2026-11-06T09:03:05-05:00
Europe/Madrid        2026-11-06T15:03:05+01:00
sin zona: 2026-11-06T08:03:05 · tzinfo = None
ida y vuelta de las 2:30: 03:30:00
la 1:30 de dos maneras: 08:30:00 y 09:30:00 en UTC
```

Python no se queja de las 2:30 que no existen: les pone una zona y, de ida y vuelta, se vuelven las 3:30. Y para la 1:30 repetida necesita que le digas cuál de las dos, con `fold`.
:::

### ISO 8601: escribir la hora sin dudas

¿Qué día es 03/04/2026? En México, el 3 de abril; en Estados Unidos, el 4 de marzo. Para no adivinar existe [[iso-8601|ISO 8601]], el estándar internacional para escribir fechas y horas como texto:

**`2026-11-06T14:03:05Z`**

De lo grande a lo chico: año, mes, día, una T que separa la fecha de la hora, horas, minutos, segundos y la zona. La **Z** significa UTC (los aviadores la leen *Zulu*). En vez de la Z puede ir el offset: `2026-11-06T08:03:05-06:00` es **el mismo instante**, escrito con la hora de CDMX. Los decimales de segundo van después de un punto: `14:03:05.412Z` (ISO 8601 también acepta coma).

:::profundo ISO 8601 y RFC 3339
ISO 8601 permite muchas formas, incluso horas sin zona. Por eso los protocolos de internet usan un perfil más estricto, el **RFC 3339** (de 2002; un RFC es uno de los documentos en los que la IETF publica los estándares de internet): la zona es obligatoria (la Z o un offset), el año lleva 4 cifras y los decimales van con punto. Cuando una API o un log dicen «ISO 8601», casi siempre quieren decir esta forma.
:::

Ese orden de lo grande a lo chico tiene un premio: **si todas las horas están en UTC y con el mismo formato, ordenarlas como texto las ordena en el tiempo**. «2026-10-31T23:59:59Z» va antes que «2026-11-06T09:30:00Z» letra por letra. Por eso los nombres de archivos, de carpetas y de [[snapshot|snapshots]] llevan la fecha así, como el `ds-2026-09-01` con que Alba nombra su dataset de septiembre. Con el formato día/mes/año no funciona: «01/01/2027» empieza con 01 y «06/11/2026» con 06, así que el 1 de enero de 2027 quedaría antes que el 6 de noviembre de 2026.

:::profundo Los segundos intercalares
La Tierra no gira con la regularidad de un reloj atómico: se frena un poco y a destiempo. Para que UTC no se separe del Sol, desde 1972 se han agregado 27 **segundos intercalares** (*leap seconds*): un 23:59:60 al final de algunos días, el último el 31 de diciembre de 2016. El tiempo Unix hace como si no existieran: cada día tiene exactamente 86,400 segundos, y en un segundo intercalar el reloj repite un segundo o lo reparte en pedacitos a lo largo del día (*leap smear*). En 2022, la Conferencia General de Pesas y Medidas acordó dejar de agregarlos a más tardar en 2035, y en octubre de 2026 fijó la fecha: desde el 20 de mayo de 2027, UTC corre sin segundos intercalares, y su diferencia con la hora que marca el giro de la Tierra puede crecer hasta una hora. Para casi todo en ML no importan; importa saber que «restar tiempos Unix» puede equivocarse por un segundo cuando pasa uno.
:::

## Dos relojes en cada máquina, y máquinas que no coinciden {Wall clock, monotonic clock and clock skew}

### El reloj de pared y el monotónico

Cada computadora tiene, en realidad, dos relojes que le sirven a un programa.

El **reloj de pared** (*wall clock*) es la hora del calendario, la que sale en la esquina de la pantalla. En Python es `time.time()`. Sirve para poner timestamps. Pero **puede brincar**: si el sistema descubre que iba adelantado, lo corrige y la hora retrocede; si alguien la cambia a mano, salta; si una máquina virtual se pausa y despierta, avanza de golpe.

El [[reloj-monotonico|reloj monotónico]] (*monotonic clock*, también «monótono») solo avanza. Cuenta desde un punto arbitrario, por ejemplo desde que se prendió la máquina, así que su valor no dice qué hora es. Lo que sí dice bien es **cuánto pasó** entre dos lecturas. En Python es `time.monotonic()`.

La regla: **los timestamps, con el de pared; las duraciones, con el monotónico.** Si mides una latencia restando dos `time.time()` y en medio el sistema atrasa el reloj 300 ms, una request de 40 ms sale de 40 − 300 = −260 ms. Los [[timeout|timeouts]] y los deadlines de la lección de fallas de red se miden igual, con el monotónico: un timeout de 150 ms no puede durar 0 ni 2 segundos porque alguien movió la hora.

:::profundo Los relojes en Python
Python te dice qué promete cada reloj, y así se mide una duración:

```python
import time

for nombre in ("time", "monotonic"):
    info = time.get_clock_info(nombre)
    print(f"time.{nombre}(): ¿lo pueden mover? {info.adjustable} · ¿solo avanza? {info.monotonic}")

inicio = time.monotonic()          # un punto de partida, no una hora
time.sleep(0.3)                    # lo que quieres medir
duracion = time.monotonic() - inicio
print(f"tardó ≈ {duracion:.1f} s")
```

```salida
time.time(): ¿lo pueden mover? True · ¿solo avanza? False
time.monotonic(): ¿lo pueden mover? False · ¿solo avanza? True
tardó ≈ 0.3 s
```

La duración exacta cambia un poco en cada máquina y en cada corrida; por eso se imprime redondeada.

`time.perf_counter()` también es monotónico y tiene la mejor resolución que da la máquina: es el que usan los programas que miden código, como `timeit`. `time.time_ns()` y `time.monotonic_ns()` (desde Python 3.7) dan lo mismo que sus hermanos, pero como un entero de nanosegundos, sin el redondeo de un float. Ojo con lo que cada uno hace mientras la computadora duerme: según el sistema operativo, el monotónico puede pausarse o seguir contando.
:::

### Dos máquinas nunca marcan lo mismo

El reloj de una computadora es un cristal de cuarzo que vibra, y ningún cristal vibra exacto: se adelanta o se atrasa unas partes por millón. Con un error de 20 partes por millón, el reloj se corre 20 ÷ 1,000,000 × 86,400 s ≈ 1.7 segundos al día. Sin corregirlo, en un mes van casi 52 segundos.

Para corregirlo, cada máquina le pregunta la hora a un servidor de referencia con **NTP** (*Network Time Protocol*) y ajusta la suya poco a poco. Aun así, la red tarda en llevar la respuesta y ese tiempo varía, así que dos máquinas sincronizadas quedan con una diferencia: del orden de decenas de milisegundos si el servidor de hora está al otro lado de internet, y menos de un milisegundo, en buenas condiciones, si está en la misma red local. Esa diferencia es el [[desfase-reloj|desfase de relojes]] (*clock skew*).

:::profundo El reloj en la nube
Las nubes ponen un servidor de hora dentro de su propia red. En AWS, el Amazon Time Sync Service atiende a cada máquina virtual (instancia EC2) en la dirección 169.254.169.123, sin salir a internet, y desde noviembre de 2023, en los tipos de instancia compatibles, la sincroniza con un reloj de hardware hasta un error del orden de microsegundos. Aun así, el desfase nunca es cero.
:::

Unos milisegundos parecen nada, pero bastan para mentir:

:::figura tiempo-hash-desfase
Arriba, lo que pasó: el backend manda la request a las 14:03:05.100 y el gateway la recibe 30 ms después. Abajo, lo que dicen los logs, cada uno con su reloj: el del gateway va 80 ms atrás y anota 05.050. Ordenados por hora, la request llega antes de salir.
:::

De ahí salen tres consecuencias:

- **No ordenes eventos de dos máquinas por su hora.** Si los milisegundos importan, el orden lo da quién llamó a quién. Para seguir una request por varios saltos se usa su identificador, que ves en la sección de UUID.
- **No midas una latencia restando horas de dos máquinas.** Cada máquina mide su parte con su monotónico. Por eso, entre máquinas, un deadline viaja como «te quedan 190 ms» y no como «termina a las 14:03:05.290».
- **Vigila el desfase.** Un sistema de video que vigila con cámaras unos centros de distribución, por ejemplo, corre NTP en cada caja de cómputo de sus sitios y compara su hora con la del servidor en cada latido (*heartbeat*); si se separan más de 2 segundos, lo registra. Un reloj corrido por días rompe hasta las conexiones cifradas ([[tls|TLS]], en la lección de cifrado), porque revisan que el certificado del otro lado no esté vencido.

## Cuándo pasó y cuándo llegó: event time, ventanas y watermark {Event time, windows and watermarks}

### Varias horas para la misma foto

La foto de Ana tiene varias horas, y no son la misma:

1. **Cuándo se tomó.** El teléfono la anota en los metadatos [[exif|EXIF]] del JPEG, en hora local. La zona va en otro campo (`OffsetTimeOriginal`, que existe desde la versión 2.31 de EXIF, de 2016), y muchas cámaras y programas no lo llenan o lo borran: no cuentes con él.
2. **Cuándo se subió.** El backend la recibe a las 14:03:05 UTC.
3. **Cuándo se procesó.** El gateway y Triton la clasifican unos milisegundos después. Si hubiera pasado por una [[cola-mensajes|cola]], podrían ser minutos.
4. **Cuándo llegó su etiqueta.** Ana elige la categoría final un par de minutos más tarde; un moderador podría corregirla días después.

La hora en que algo pasó en el mundo es su [[event-time|event time]] (tiempo del evento). La hora en que un sistema lo procesa es su *processing time* (tiempo de procesamiento). Casi siempre van juntas, pero no siempre. El ejemplo clásico: un celular sin señal en el metro registra un pago a las 10:00:05, y el evento llega al sistema a las 10:07. Pasó a las 10:00; llegó siete minutos tarde.

¿Por qué importa? Porque las preguntas son sobre el mundo, no sobre tu sistema. «¿Cuántos pagos hizo esta tarjeta entre las 10:00 y las 10:05?» se responde con el event time. Por processing time, el pago del metro caería en la cuenta de 10:05 a 10:10, y un retraso de la red cambiaría tus features.

### Ventanas: contar por pedazos de tiempo

Muchas features son conteos o sumas sobre un rato: pagos de la tarjeta en 10 minutos, fotos del vendedor en 24 horas, errores del servicio en 5 minutos. Ese rato es una [[ventana-tiempo|ventana de tiempo]] (*time window*), y hay de varios tipos:

- **Fijas** (*tumbling*): pedazos pegados que no se enciman: 10:00–10:05, 10:05–10:10. Cada evento cae en una sola.
- **Deslizantes** (*sliding* o *hopping*): ventanas de cierto largo que avanzan a pasos más cortos: «la última hora, recalculada cada 5 minutos». Se enciman, y cada evento cae en varias: con 1 hora cada 5 minutos, en 12.
- **De sesión** (*session*): se cierran cuando hay un hueco sin actividad, por ejemplo de 30 minutos. Sirven para «lo que hizo una persona en una visita».

:::figura tiempo-hash-ventanas
Los pagos de una tarjeta sobre el eje del event time. Las ventanas fijas de 5 minutos cuentan 3, 2 y 1. Las deslizantes de 10 minutos, cada 5, se enciman: cuentan 5 y 3. El watermark llega a las 10:05:50 y cierra la primera ventana fija con 2 pagos; el del metro, de las 10:00:05, llega después: tarde.
:::

Una ventana «de 24 horas» en una feature de fraude no es «el día de hoy». Un sistema de detección de fraude con tarjetas la define anclada al evento: los pagos con event time entre t − 24 h y t, con t la hora del pago que se está decidiendo, sin contar ese pago.

### El watermark: cuánto esperar a los que llegan tarde

Un programa que cuenta en ventanas mientras llegan los eventos (un *job de streaming*, que lee un [[stream-eventos|stream de eventos]] de la lección de colas) tiene un problema: ¿cuándo da por cerrada la ventana de 10:00 a 10:05? Si la cierra a las 10:05 en punto, el pago del metro no entra. Si espera una hora, sus features llegan una hora tarde.

El [[watermark]] es la respuesta: una hora de event time que dice «ya creo haber recibido todo lo anterior a esto». Lo más común es calcularlo como el event time más nuevo que se ha visto, \(t_{max}\), menos un margen \(m\): \(W = t_{max} − m\), con \(W\) el watermark. Cuando el watermark pasa el final de una ventana, la ventana se cierra y emite su resultado.

:::cuenta El pago del metro, con un margen de 1 minuto
Event time más nuevo, \(t_{max}\) // el de un pago que llega a tiempo | — | 10:06:50
Watermark \(W\) // con un margen \(m\) de 1 min | \(W = t_{max} − m\) = 10:06:50 − 1 min | 10:05:50
¿Cierra la ventana de 10:00 a 10:05? // se cierra cuando \(W\) pasa su final | \(W\) = 10:05:50 > 10:05 | sí: emite 2 pagos
Llega el pago del metro // a las 10:07, con event time 10:00:05 | 10:00:05 < \(W\) = 10:05:50 | tarde
= Con 1 minuto de margen, el pago del metro llega tarde y la ventana dijo 2, no 3. Con 10 minutos de margen habría entrado, pero cada ventana tardaría 10 minutos en dar su cuenta.
:::

Ese es el trato: **un margen más grande da cuentas más completas y features más viejas**. Lo que llega tarde se tira, se manda a una salida aparte para corregir o se cuenta en el cálculo de entrenamiento, que corre después, con todo ya llegado. El diagrama sigue los dos pagos por el sistema de fraude.

:::profundo El watermark en Flink
En Apache Flink, uno de los programas de streaming más usados, el margen se elige con `WatermarkStrategy.forBoundedOutOfOrderness`, el «desorden máximo» que esperas: el watermark es el event time más nuevo visto menos ese margen (y un milisegundo). Una ventana se dispara cuando el watermark pasa su final; con `allowedLateness` puede seguir aceptando tardíos un rato y corregir su resultado, y lo que llega después de eso puede mandarse a una salida aparte (*side output*).
:::

:::diagrama tiempo-hash-ventanas
Un pago a tiempo y uno que llega tarde, del celular a la feature que lee el modelo de fraude. Toca cada caja o usa «Recorrer».
:::

## Point-in-time: entrenar sin ver el futuro {Point-in-time correctness}

### El problema: el dataset se arma después

Un modelo de fraude decide en el momento del pago. Su dataset de entrenamiento se arma semanas después, cuando ya se sabe qué pagos fueron fraude. Para cada pago viejo hay que poner sus features: «pagos de la tarjeta en la última hora», «monto promedio en 30 días»… Y aquí está la trampa: **¿con qué valor?**

Si pones el valor que la feature tiene hoy, le das al modelo información que no existía cuando se tomó la decisión. Es [[leakage]]: el modelo aprende con el futuro, sale buenísimo en la validación y se cae en producción, donde el futuro no está. Es el mismo error que repartir train y validación sin respetar el tiempo, el [[split-temporal]] de la lección de ejemplos, pero dentro de cada fila.

La regla se llama [[point-in-time|point-in-time correctness]] (corrección al instante): **cada fila lleva el valor que cada feature tenía en el momento de la predicción, no el de hoy**. La herramienta es un [[join]] *as-of* («a la fecha de»), una unión de dos tablas por hora: para cada evento, el último valor de la feature con timestamp menor o igual al del evento.

:::cuenta Un join as-of, con horas de ejemplo
Valores de «pagos en 1 h» // de ejemplo, calculados a las 09:00, 10:00, 10:30 y 11:00 | — | 2, 3, 7 y 4
Decisión de las 10:10 // el último con hora ≤ 10:10 es el de las 10:00 | as-of(10:10) | 3
Decisión de las 10:35 // el último con hora ≤ 10:35 es el de las 10:30 | as-of(10:35) | 7
Con «el valor de hoy» // para las dos decisiones | el de las 11:00 | 4 y 4
= El join as-of da 3 y 7: lo que el modelo vio. El de hoy da 4 a las dos: un número que a las 10:10 no existía.
:::

:::figura tiempo-hash-asof
Arriba, la feature como escalera: vale 2 desde las 9:00, 3 desde las 10:00, 7 desde las 10:30 y 4 desde las 11:00. Cada decisión toma el escalón donde cae. Abajo, un acercamiento: el valor de las 10:30 tarda 2 minutos en llegar al servicio, y la decisión de las 10:31 todavía vio el 3.
:::

### La hora que importa: cuándo estuvo disponible

Hay un detalle más fino: el timestamp que importa no es cuándo terminó la ventana, sino **cuándo el valor estuvo disponible para el servicio**. Si el valor de las 10:30 tarda 2 minutos en llegar a la base de datos que lee el modelo, una decisión de las 10:31 todavía vio el de las 10:00. Un join as-of con la hora de cálculo le daría 7; el correcto, con la hora de disponibilidad, le da 3.

En pandas, la biblioteca de tablas de Python, la misma operación es `pd.merge_asof`, con un `tolerance` que pone un límite de antigüedad: por ejemplo, con 2 horas, ningún valor más viejo que eso cuenta.

:::profundo El join as-of en código
Las dos cuentas de arriba, con la biblioteca estándar:

```python
import bisect

# La feature «pagos de la tarjeta en la última hora», tal como se calculó cada vez
feature_ts = ["09:00", "10:00", "10:30", "11:00"]     # cuándo se calculó cada valor
valores    = [2,       3,       7,       4]
eventos    = ["10:10", "10:35"]                       # cuándo se tomó cada decisión

def as_of(t):
    i = bisect.bisect_right(feature_ts, t) - 1        # el último valor con hora ≤ t
    return (feature_ts[i], valores[i]) if i >= 0 else (None, None)

for t in eventos:
    print(f"decisión de las {t}: as-of → {as_of(t)} · el de hoy → {valores[-1]}")

# Si el valor tarda 2 minutos en estar disponible para el servicio:
disponible = ["09:02", "10:02", "10:32", "11:02"]
i = bisect.bisect_right(disponible, "10:31") - 1
print("a las 10:31, el servicio todavía veía el valor de las", feature_ts[i], "=", valores[i])
```

```salida
decisión de las 10:10: as-of → ('10:00', 3) · el de hoy → 4
decisión de las 10:35: as-of → ('10:30', 7) · el de hoy → 4
a las 10:31, el servicio todavía veía el valor de las 10:00 = 3
```

`bisect` busca en una lista ordenada dónde caería un valor. Aquí compara las horas como texto, y funciona porque «09:00» lleva su cero: el mismo truco de ISO 8601.
:::

### Tres reglas para no colar el futuro

- **Las etiquetas también tienen fecha.** Un contracargo (cuando el dueño de la tarjeta desconoce un cargo) llega semanas después del pago. Un sistema de fraude guarda las dos fechas, la del pago y la de llegada, y una feature como «contracargos de la tarjeta en 90 días» solo cuenta los que ya habían **llegado** antes de t.
- **Nada de `now()` dentro de una feature.** «Compras de los últimos 30 días» calculada con la hora actual funciona en la corrida diaria y está mal en cualquier [[backfill]], el recálculo de días pasados. La fecha de referencia llega como parámetro.
- **Guarda lo que el modelo vio.** Un sistema de recomendación escribe, con el `request_id` de cada recomendación, las features exactas que leyó el modelo, y el training set las une por ese id: entrenar y servir ven lo mismo. Un [[feature-store]], el almacén de features de la lección de almacenamiento, hace el join as-of por ti.

:::profundo El join as-of en Feast
En Feast, un feature store de código abierto, le das la tabla de eventos con su hora y `get_historical_features` busca, para cada fila, el último valor de cada feature con hora menor o igual, sin pasar del `ttl` de la feature: el mismo límite de antigüedad de `tolerance`. Ojo: Feast usa la hora del evento de la feature, no la de disponibilidad; si el valor tarda en llegar al servicio, ese retraso lo tienes que modelar tú.
:::

## Funciones hash: una huella de tamaño fijo {Hash functions: a fixed-size fingerprint}

### Qué es

Ya usaste hashes en varias lecciones: para repartir vendedores entre train y validación, para quitar fotos repetidas, para mandar los valores de una feature a un número fijo de casillas, para que un balanceador mande la misma conexión al mismo destino, para revisar los pesos de un modelo. Siempre con la misma idea: una cuenta que convierte unos datos en un número, siempre el mismo para los mismos datos. Aquí va la definición completa.

Una [[funcion-hash|función hash]] toma una entrada de cualquier tamaño (un texto, los 200 KB de una foto, un archivo de 70 GB) y devuelve un número de tamaño fijo, el *hash* o huella. Tres propiedades la hacen útil:

1. **Determinista.** La misma entrada da siempre el mismo hash, en cualquier máquina y en cualquier año.
2. **Tamaño fijo.** SHA-256 devuelve siempre 256 bits, se le pase una letra o una película. Escritos en hexadecimal, con 4 bits por símbolo, son 64 caracteres.
3. **Revuelve todo.** Un cambio de un solo bit en la entrada cambia, en promedio, la mitad de los bits de la salida. «vend-00024» y «vend-00025» dan huellas que no se parecen en nada. A esto se le llama efecto avalancha.

La tercera es la que convierte un hash en un sorteo: aunque es una cuenta fija, su salida se ve al azar y se reparte pareja.

```python
import hashlib, os, subprocess, sys

for texto in ("vend-00024", "vend-00025", "vend-00024"):
    huella = hashlib.sha256(texto.encode()).hexdigest()
    print(texto, "→", huella[:16], "…", len(huella), "caracteres")

# El hash() de Python, en dos programas distintos: ¿da lo mismo?
codigo = "print(hash('vend-00024'))"
def corrida(semilla):
    entorno = dict(os.environ, PYTHONHASHSEED=semilla)
    return subprocess.run([sys.executable, "-c", codigo], env=entorno,
                          capture_output=True, text=True).stdout
print("hash() con semilla al azar, ¿igual en dos corridas?", corrida("random") == corrida("random"))
print("hash() con PYTHONHASHSEED=0, ¿igual?", corrida("0") == corrida("0"))
print("hash(42) =", hash(42), "· los enteros no cambian")
```

```salida
vend-00024 → a0034b6501dd8870 … 64 caracteres
vend-00025 → 7ca8198c15366a56 … 64 caracteres
vend-00024 → a0034b6501dd8870 … 64 caracteres
hash() con semilla al azar, ¿igual en dos corridas? False
hash() con PYTHONHASHSEED=0, ¿igual? True
hash(42) = 42 · los enteros no cambian
```

La segunda parte muestra una trampa famosa. Python trae su propia función `hash()`, pero para textos y bytes **cambia cada vez que arranca un programa**: desde Python 3.3, le mezcla una semilla al azar que elige al arrancar, para que nadie pueda fabricar a propósito muchos textos que caigan en la misma casilla de un diccionario y hacerlo lento (un diccionario de Python, `dict`, guarda cada llave en la casilla que le indica su hash). La variable de entorno `PYTHONHASHSEED` sirve para fijar esa semilla (con un número) o apagarla (con 0), como hace el código de arriba. Los enteros no llevan semilla: no cambian entre corridas, y el hash de uno chico es el mismo número. Sirve dentro de un programa; para cualquier cosa que se guarde o que dos programas deban calcular igual, se usa `hashlib`.

### Colisiones y la paradoja del cumpleaños

Hay infinitas entradas posibles y solo 2²⁵⁶ huellas, así que tiene que haber entradas distintas con la misma huella: una **colisión**. La pregunta útil es qué tan probable es toparse con una.

Empieza por un grupo de personas. ¿Cuántas hacen falta para que dos cumplan años el mismo día con probabilidad de 50 %? Con 365 días, la intuición dice unas 180. Son **23**. El truco es que no se compara una persona contra las demás, sino cada par: 23 personas forman 253 pares, y cada par tiene su oportunidad. Es la **paradoja del cumpleaños**.

Con hashes pasa igual: cada huella posible es una casilla, como cada día del año. Con huellas de \(b\) bits hay \(K = 2^b\) casillas, y la primera colisión se vuelve probable alrededor de **\(sqrt{K}\)** elementos, no de \(K\). Una huella de 32 bits tiene 4,294,967,296 casillas, pero con ≈ 77,000 elementos ya hay 50 % de que dos choquen. Las cuentas, con sus letras:

:::formula Choques entre huellas (la paradoja del cumpleaños)
text{pares} = frac{n × (n − 1)}{2}
c ≈ frac{text{pares}}{K} ≈ frac{n^2}{2K}
P ≈ 1 − e^{−c}
n_{50} ≈ 1.18 × sqrt{K}
- n: cuántas cosas hasheas (fotos, ids, archivos)
- b: los bits de la huella: 32 en CRC32, 256 en SHA-256
- K: las casillas, es decir, las huellas distintas posibles: \(K = 2^b\)
- c: los choques esperados: cuántos pares de cosas distintas comparten huella
- P: la probabilidad de que haya al menos un choque
- n_{50}: cuántas cosas hacen falta para que \(P\) llegue a 50 %
:::

:::cuenta Si Alba nombrara cada foto con un hash de 32 bits
Fotos al día, \(n\) // las que clasifica Alba | — | 10,000,000
Pares de fotos // cada par puede chocar | \(n × (n − 1) ÷ 2\) = 10⁷ × (10⁷ − 1) ÷ 2 | ≈ 5 × 10¹³
Casillas con 32 bits, \(K\) | \(K = 2^b\) = 2³² | ≈ 4.3 × 10⁹
Choques esperados al día, \(c\) | \(c ≈ text{pares} ÷ K\) = 5 × 10¹³ ÷ 4.3 × 10⁹ | ≈ 11,600
\(c\) con 64 bits // \(K\) = 2⁶⁴ ≈ 1.8 × 10¹⁹ | 5 × 10¹³ ÷ 1.8 × 10¹⁹ | ≈ 0.0000027 al día
\(c\) con SHA-256 // \(K\) = 2²⁵⁶ ≈ 1.2 × 10⁷⁷ | 5 × 10¹³ ÷ 1.2 × 10⁷⁷ | ≈ 4 × 10⁻⁶⁴
= Con 32 bits, cada día ≈ 11,600 pares de fotos distintas tendrían el mismo nombre. Con 256, no pasaría ni una vez en la vida del universo.
:::

:::calculadora tiempo-hash-choques
Prueba 64 bits: con 10 millones de cosas casi no hay choques, pero con 5,000 millones (≈ 500 días de fotos de Alba, a 10 millones por día) ya hay 50 %.
:::

:::profundo De dónde sale la raíz cuadrada
Con \(n\) elementos hay \(n(n − 1)/2\) pares, y cada par choca con probabilidad \(1/K\). Los choques esperados son \(c ≈ n^2/(2K)\). La probabilidad de que no haya ninguno es ≈ \(e^{−c}\), así que la de al menos uno es \(P ≈ 1 − e^{−c}\). Vale 50 % cuando \(e^{−c}\) = 0.5, o sea \(c\) = ln 2 ≈ 0.69, es decir, con \(n ≈ sqrt{2 ln 2} × sqrt{K} ≈ 1.18 × sqrt{K}\). Para los cumpleaños: 1.18 × √365 ≈ 22.5. Para 32 bits: 1.18 × 65,536 ≈ 77,000.
:::

### Dos familias: hashes criptográficos y checksums

Un [[hash-criptografico|hash criptográfico]], como **SHA-256**, promete además que nadie puede ir de la huella a la entrada ni fabricar dos entradas con la misma huella. Por eso sirve de identidad: dos archivos con el mismo SHA-256 son el mismo archivo. Un [[checksum]] (suma de verificación), como **CRC32**, solo promete detectar daños por accidente, como un bit volteado en un cable; es más corto y más rápido, pero cualquiera le fabrica un choque. Las dos familias, con código, están en la sección extra «Hashes a fondo».

:::profundo Otros hashes que vas a ver
Además de SHA-256, `hashlib` trae **BLAKE2** (desde Python 3.6), tan seguro como SHA-256 y más rápido en muchas computadoras, y **SHA-3**, el estándar de 2015 del NIST (el instituto de estándares de Estados Unidos), hecho con una idea distinta por si algún día se rompe la familia SHA-2. Del otro lado están los hashes rápidos sin promesas de seguridad, como **MurmurHash** y **xxHash**: no sirven de huella contra un atacante, pero reparten bien y cuestan poco, y por eso los usan los sistemas que reparten llaves. El cliente de Kafka para Java usa murmur2 para elegir la partición, y Cassandra, una base de datos repartida entre muchas máquinas, Murmur3.
:::

## Repartir con un hash: sharding y asignación de un A/B {Splitting with a hash: sharding and A/B assignment}

### hash(llave) mod N

Cuando los datos no caben en una máquina, o el tráfico es demasiado para una sola, se reparten entre varias. Repartir datos entre máquinas por una llave es [[sharding]], y cada pedazo es un *shard*. La forma más simple de decidir dónde va cada llave:

**shard = hash(llave) mod N**

donde N es el número de máquinas y «mod» es el residuo de dividir (17 mod 5 = 2). Como el hash se ve al azar, los residuos se reparten parejos. Y como es determinista, cualquier programa que quiera leer el listing (la publicación) 8841 calcula el mismo shard sin preguntarle a nadie.

La búsqueda de Alba, que encuentra publicaciones por su significado con [[embedding|embeddings]], reparte su índice de las ≈ 100 millones de publicaciones activas en 4 shards por hash del `listing_id`, y no por rangos (del 1 al millón aquí, del millón al dos millones allá): con el hash, los shards quedan parejos y ninguno se «calienta» (recibe mucho más tráfico que los demás) cuando algo se pone de moda. Es la misma cuenta que reparte los mensajes de un tópico, el registro de mensajes de la lección de colas, entre sus pedazos, cada uno una [[particion-topico|partición]]. El cliente de Kafka para Java, por ejemplo, calcula el hash *murmur2* de la llave y se queda con el residuo entre el número de particiones. Un sistema de fraude con tarjetas usa la tarjeta como llave para que todos los pagos de una tarjeta caigan en la misma partición, en orden.

### El problema: cambiar N

Ahora la búsqueda de Alba crece y pasa de 4 a 5 shards. Con mod N, ¿cuántas llaves cambian de máquina? La respuesta general, que la cuenta de abajo comprueba con 4 y 5:

:::formula Lo que se mueve al pasar de N a N + 1 máquinas, con mod N
f_{mod} = frac{N}{N + 1}
M = f_{mod} × L × v
- N: las máquinas que hay ahora
- f_{mod}: la fracción de las llaves que cambia de máquina
- L: cuántas llaves hay
- v: los bytes que viajan con cada llave
- M: los bytes que se mudan de máquina en total
:::

:::cuenta De 4 a 5 shards, con mod N
Una llave se queda si su residuo no cambia // con \(h\) el hash de la llave: \(h\) mod 4 = \(h\) mod 5; los dos residuos se repiten cada 4 × 5 = 20 números, y de 0 a 19 solo coinciden en 0, 1, 2 y 3 | 4 de cada 20 | 20 %
Llaves que se mueven | 1 − 0.2 | 80 %
Con la fórmula, \(f_{mod}\) // \(N\) = 4 | \(N ÷ (N + 1)\) = 4 ÷ 5 | 80 %
Publicaciones que se mueven // \(L\) ≈ 100 millones de publicaciones activas en el índice de Alba | \(f_{mod} × L\) = 0.8 × 100,000,000 | 80 millones
Datos que viajan, \(M\) // cada publicación lleva su vector de 512 floats: \(v\) = 512 × 4 bytes = 2,048 B | \(M = f_{mod} × L × v\) = 80 × 10⁶ × 2,048 B | ≈ 164 GB
= Agregar una máquina mueve el 80 % de todo, cuando bastaría mover el 20 %: lo que le toca a la nueva.
:::

Y empeora con N: de 10 a 11 se mueve el 91 %; de 100 a 101, el 99 %. Lo mismo pasa con los tópicos: agregar particiones cambia a qué partición va cada llave, y los pagos de una tarjeta dejan de estar juntos durante el cambio.

### El hashing consistente

El arreglo se llama **hashing consistente** (*consistent hashing*). En vez de dividir entre N, imagina todos los números de hash posibles en un círculo, como las horas de un reloj: después del más grande vuelve a empezar el 0. Cada máquina queda en un punto del círculo, el hash de su nombre. Cada llave queda en el punto de su propio hash y camina en el sentido del reloj hasta la primera máquina que encuentra: esa es su dueña. Al agregar una máquina, solo cambian de dueño las llaves del arco que le toca a ella; todas las demás se quedan donde estaban.

:::figura tiempo-hash-anillo
Cuatro máquinas en el anillo, A, B, C y D, y las llaves como puntos. Cada llave va a la primera máquina en el sentido del reloj. Al agregar E entre A y B, solo las dos llaves del arco naranja cambian de dueño, de B a E. Con mod N, de 4 a 5 máquinas se movería el 80 %.
:::

Con \(N\) máquinas que pasan a \(N + 1\), se mueve en promedio \(f_{anillo} ≈ 1/(N + 1)\) de las llaves: lo justo, la parte que le toca a la nueva. Así reparten sus datos bases de datos distribuidas como Cassandra. El anillo en código, por qué cada máquina va en muchos puntos y una calculadora para comparar están en la sección extra «Hashes a fondo».

### La asignación de un A/B, con la misma cuenta

En «Ruido, muestras y pruebas A/B» viste que Alba reparte a los vendedores de un [[ab-test|A/B]] por vendedor, su [[unidad-aleatorizacion|unidad de aleatorización]], con un hash. Esta es la [[asignacion-hash|asignación con hash]]:

**cubeta = hash(sal + seller_id) mod 100**; la cubeta (*bucket*) es un número de 0 a 99, y las cubetas de 0 a 49 van a A y las de 50 a 99 a B.

La **sal** (*salt*) es un texto que cambia en cada experimento, como «umbral-oct». Por qué así y no con una tabla que diga «vend-00024 → A»:

- **Siempre igual, en todas partes.** El backend, el job que mide los resultados y un analista con Python calculan el mismo brazo para Ana, hoy y en tres semanas, sin consultar nada. Alba lo calcula en el backend y lo manda en un header, `X-Model-Arm`.
- **No hay tabla que guardar ni sincronizar.** Con millones de vendedores, eso es una base de datos y una fuente de errores menos.
- **Las rampas son ordenadas.** Un [[canary]] (mandar primero el modelo nuevo a una parte chica del tráfico) al 5 % son las cubetas de 0 a 4; al subir a 25 %, las de 0 a 24. Quien ya estaba adentro se queda adentro.
- **Cada experimento sortea distinto.** Con otra sal, los vendedores se revuelven. Sin sal, los mismos caerían en el tratamiento de todos los experimentos y arrastrarían efectos de uno al otro.

```python
import hashlib

def cubeta(sal, vendedor):                       # un número de 0 a 99, siempre el mismo
    h = hashlib.sha256(f"{sal}:{vendedor}".encode()).hexdigest()
    return int(h, 16) % 100

def brazo(sal, vendedor):
    return "A" if cubeta(sal, vendedor) < 50 else "B"

print("vend-00024:", cubeta("umbral-oct", "vend-00024"), brazo("umbral-oct", "vend-00024"),
      "· otra vez:", brazo("umbral-oct", "vend-00024"))

vendedores = [f"vend-{i:05d}" for i in range(10_000)]
en_b = [brazo("umbral-oct", v) == "B" for v in vendedores]
print("en B, de 10,000:", sum(en_b))
otro = [brazo("top5-nov", v) == "B" for v in vendedores]       # otro experimento, otra sal
print("en B en los dos experimentos:", sum(a and b for a, b in zip(en_b, otro)))
```

```salida
vend-00024: 58 B · otra vez: B
en B, de 10,000: 5148
en B en los dos experimentos: 2561
```

`int(h, 16)` lee la huella hexadecimal como un número entero, para poder sacarle el residuo. 5,148 de 10,000 no es exactamente la mitad: es un sorteo, y su ruido es el de esa lección. El error estándar de una mitad con 10,000 es √(0.5 × 0.5 ÷ 10,000) = 0.5 puntos, unos 50 vendedores; esta sal cayó ≈ 3 errores estándar arriba, un sorteo con poca suerte (con la sal «top5-nov» salen 5,011). Y en B de los dos experimentos quedan ≈ 2,560, cerca de la cuarta parte: como si se hubiera sorteado dos veces de manera independiente.

## UUID y request ID: nombres únicos sin preguntarle a nadie {UUIDs and request IDs}

### El problema de los nombres

Cada foto, cada request y cada evento necesita un nombre que nadie más tenga. Lo obvio es un contador: 1, 2, 3… Pero un contador vive en un solo lugar, y cada copia del gateway, cada teléfono y cada job tendría que preguntarle «¿qué número sigue?». Con 500 requests por segundo en el pico de diseño de Alba (el tráfico para el que calcula cuántas máquinas necesita), es un cuello de botella que, si se cae, para todo. Lo que se usa es un número tan grande y tan al azar que cada quien lo inventa sin chocar.

### UUID: 128 bits que no se repiten

Un [[uuid|UUID]] (*universally unique identifier*, identificador único universal) es un número de 128 bits escrito en hexadecimal, en 5 grupos con guiones: `f47ac10b-58cc-4372-a567-0e02b2c3d479`. Son 32 símbolos de 4 bits (128 bits) más 4 guiones: 36 caracteres. Hay varias versiones; dos importan.

**La versión 4** es casi toda al azar: de los 128 bits, 6 son fijos (dicen la versión y la variante, la familia de UUID a la que pertenece), y **122** salen al azar. ¿Qué tan seguido chocan? Es la paradoja del cumpleaños otra vez:

:::cuenta ¿Chocarían los UUID v4 de Alba?
Ids al día // uno por foto: Alba clasifica ≈ 10 millones al día | — | 10,000,000
Ids en 100 años, \(n\) | 10⁷ × 365 × 100 | 3.65 × 10¹¹
Casillas, \(K\) // 122 bits al azar | \(K = 2^{122}\) | ≈ 5.3 × 10³⁶
Choques esperados, \(c\) // tan chico que es también la probabilidad de algún choque, \(P\) | \(c ≈ n^2 ÷ (2K)\) = (3.65 × 10¹¹)² ÷ (2 × 5.3 × 10³⁶) | ≈ 1.3 × 10⁻¹⁴
\(c\) con 64 bits al azar // para comparar: \(K\) = 2⁶⁴ ≈ 1.8 × 10¹⁹; con miles de choques esperados, alguno es casi seguro | (3.65 × 10¹¹)² ÷ (2 × 1.8 × 10¹⁹) | ≈ 3,600
= En un siglo al ritmo de Alba, la probabilidad de que dos UUID v4 choquen es de una en 80 billones. Con 64 bits al azar habría miles de choques: por eso un UUID usa 128.
:::

**La versión 7** pone al principio la hora: los primeros 48 bits son el tiempo Unix en milisegundos, y el resto, fuera de los 6 de versión y variante, va al azar o lleva un contador que mantiene el orden dentro del mismo milisegundo. Así, ordenarlos los ordena por fecha de creación. Eso importa en una base de datos: un [[indice-bd|índice]], la estructura con la que una base de datos encuentra rápido una fila, se guarda ordenado, y con UUID v4 cada id nuevo cae en un lugar al azar del índice; con v7, todos caen al final, en la parte que la base de datos ya tiene en memoria. A cambio, delata cuándo se creó cada cosa. La versión 7 se estandarizó en mayo de 2024, en el RFC 9562 (los RFC son los documentos donde se publican los estándares de internet), que reemplazó al RFC 4122 de 2005.

:::profundo Otros ids: uuid5, ULID y Snowflake
Hay una tercera versión útil, la **versión 5**, que no es al azar: sale del hash SHA-1 (un hash más viejo, primo de SHA-256) de un texto y de un *espacio de nombres*, un UUID fijo que dice de qué tipo de texto se trata (por ejemplo, URLs). El mismo texto da siempre el mismo UUID.

Un sistema de video que vigila con cámaras unos centros de distribución usa la versión 5 para el id de cada alerta, hecho con el sitio, la cámara, el objeto, la zona y la ventana de 10 minutos. Si la caja reintenta, manda el mismo id y la nube no crea otra alerta: es una [[llave-idempotencia|llave de idempotencia]] que sale de los datos.

Dos primos de los UUID que vas a ver. **ULID** son 128 bits con la misma idea de v7: 48 bits de milisegundos y 80 al azar, escritos en 26 letras y números que se ordenan como texto. **Snowflake**, el que presentó Twitter en 2010, cabe en 64 bits: uno que siempre vale 0, 41 de milisegundos desde una fecha propia, 10 del número de máquina y 12 de un contador, así que cada máquina puede crear 4,096 ids por milisegundo sin chocar con las demás. Es más corto que un UUID, pero cada máquina necesita su propio número.
:::

:::profundo Los UUID en Python
```python
import uuid
from datetime import datetime, timezone

a = uuid.uuid4()                                # 122 bits al azar: cambia en cada corrida
print("versión", a.version, "·", len(str(a)), "caracteres ·", a.int.bit_length() <= 128)

x, y = uuid.uuid7(), uuid.uuid7()               # Python 3.14: la hora va al principio
print("versión", x.version, "· ¿el segundo va después del primero?", y > x)

ejemplo = uuid.UUID("017f22e2-79b0-7cc3-98c4-dc0c0c07398f")   # un UUID v7 de ejemplo del estándar
ms = ejemplo.int >> 80                          # los primeros 48 bits: milisegundos Unix
print("su hora:", ms, "ms →", datetime.fromtimestamp(ms / 1000, timezone.utc))

alerta = uuid.uuid5(uuid.NAMESPACE_URL, "sitio-3/camara-12/track-881/zona-2/14:00")
print("uuid5, siempre el mismo:", alerta)
```

```salida
versión 4 · 36 caracteres · True
versión 7 · ¿el segundo va después del primero? True
su hora: 1645557742000 ms → 2022-02-22 19:22:22+00:00
uuid5, siempre el mismo: 70f32a2c-6f39-5d00-8b9d-ab1b0742a62d
```

Los UUID v4 y v7 cambian en cada corrida; por eso el programa imprime solo su versión, su largo y su orden. `uuid.uuid7` llegó en Python 3.14 (con `uuid6` y `uuid8`); en versiones anteriores no existe. La de Python usa un contador de 42 bits después de la hora, así que dos UUID v7 creados en el mismo milisegundo salen en orden.
:::

### El request ID: el hilo que une los logs

Una request de Alba pasa por la app, el backend, el balanceador, el gateway y Triton. Cada uno escribe su log, con su reloj. Si algo sale mal, ¿cómo encuentras las cinco líneas de **esa** request entre millones?

Con un [[request-id|request ID]]: un identificador que se inventa una sola vez, al entrar, y que viaja con la request en un [[header]], como el `X-Request-ID: 9f2c41d0` de la lección de HTTP. En Alba lo pone el backend, y el gateway lo escribe en cada línea de su log y lo devuelve en la respuesta. Buscar «9f2c41d0» en los logs de todos los saltos da la historia completa.

El mismo id sirve para algo más que buscar fallas. La etiqueta de una foto llega minutos o días después, y se une a su predicción por ese id. Dicho sin rodeos: si no guardaste el id en el momento de la predicción, no hay unión posible.

:::diagrama tiempo-hash-request
El request ID de Alba: nace en el backend, viaja en un header y queda en cada log. Días después, une la predicción con su etiqueta. Toca cada caja o usa «Recorrer».
:::

:::profundo X-Request-ID y traceparent
En los sistemas grandes, esta idea crece hasta el **trazado distribuido** (*distributed tracing*): cada request lleva un *trace ID*, y cada salto anota cuánto tardó su parte y quién lo llamó. Así se dibuja el árbol de llamadas de una request.

`X-Request-ID` no es un estándar, sino una costumbre muy extendida (la «X-» marca un header inventado por fuera de los estándares): cada equipo decide su nombre y su formato, y lo importante es que todas las piezas usen el mismo. Para el trazado distribuido sí hay estándar: el **W3C Trace Context** (recomendación del W3C desde 2020) define el header `traceparent`, que lleva un trace ID de 16 bytes, escrito con 32 caracteres hexadecimales, y el id del salto que llamó. Herramientas como OpenTelemetry lo propagan solas.
:::

No lo confundas con la [[llave-idempotencia|llave de idempotencia]] de la lección de fallas de red. El request ID sirve para seguir una request. La llave de idempotencia sirve para que una operación repetida no se haga dos veces: el cliente la crea una vez por operación y la repite igual en cada reintento. A veces el mismo valor hace las dos cosas.

## Hashes a fondo: el anillo, SHA-256 y CRC32 {Hashes in depth: the ring, SHA-256 and CRC32} [extra]

### El anillo, en código

El hashing consistente lo publicaron David Karger y sus colegas del MIT en 1997, para repartir una [[cache|caché]] de páginas web entre muchas máquinas, y se volvió famoso con Dynamo, el almacén [[llave-valor]] que Amazon describió en 2007 y que inspiró a DynamoDB y a Cassandra. Este programa reparte 100,000 llaves entre 10 máquinas y luego entre 11, de las dos maneras, y cuenta cuántas cambiaron de máquina. Para el anillo, guarda los puntos ordenados y busca con `bisect` el primero a la derecha de cada llave; si no hay ninguno, da la vuelta al principio del círculo.

```python
import hashlib, bisect

def h(texto):                                   # un número grande y estable por texto
    return int(hashlib.sha256(texto.encode()).hexdigest(), 16)

llaves = [f"listing-{i}" for i in range(100_000)]

def con_mod(n):
    return {k: h(k) % n for k in llaves}

def con_anillo(n, virtuales=100):               # cada máquina, en 100 puntos del anillo
    puntos = sorted((h(f"maquina-{m}#{v}"), m) for m in range(n) for v in range(virtuales))
    pos = [p for p, _ in puntos]
    def dueno(k):                               # la primera máquina a la derecha, con vuelta
        return puntos[bisect.bisect(pos, h(k)) % len(puntos)][1]
    return {k: dueno(k) for k in llaves}

for nombre, repartir in (("mod N", con_mod), ("anillo", con_anillo)):
    antes, despues = repartir(10), repartir(11)
    movidas = sum(antes[k] != despues[k] for k in llaves)
    print(f"{nombre:>6}: de 10 a 11 máquinas se mueven {movidas / len(llaves):.1%} de las llaves")
```

```salida
 mod N: de 10 a 11 máquinas se mueven 90.9% de las llaves
anillo: de 10 a 11 máquinas se mueven 8.9% de las llaves
```

El ideal era 1/11 ≈ 9.1 %, y el anillo se acerca.

### Por qué cada máquina va en 100 puntos

Con un solo punto por máquina, los arcos salen de tamaños muy distintos: una máquina puede quedarse con el doble de llaves que otra. Por eso cada máquina se pone en muchos puntos, los **nodos virtuales** (*virtual nodes*): con 100 por máquina, los arcos de cada una suman casi lo mismo. Y una máquina más potente puede llevar más puntos, para recibir más llaves. Otra salida, la de [[redis|Redis]] Cluster, es fijar de una vez muchas casillas (16,384) y repartir casillas, no llaves, entre las máquinas.

:::calculadora tiempo-hash-shards
Sube las máquinas a 100: con mod N, agregar una sola mueve casi todo.
:::

### Lo que promete un hash criptográfico

Un hash criptográfico como SHA-256 cumple tres promesas, de la más fácil a la más difícil:

- **No se puede revertir.** Dada una huella, no hay forma práctica de encontrar una entrada que la produzca: habría que probar ≈ 2²⁵⁶ entradas.
- **No se puede imitar.** Dado un archivo, no se puede fabricar otro distinto con su misma huella.
- **No se pueden fabricar choques.** Nadie puede encontrar dos entradas cualesquiera con la misma huella. Por la paradoja del cumpleaños, esto cuesta ≈ 2¹²⁸ intentos, la raíz de 2²⁵⁶: sigue siendo imposible.

Cuando alguien encuentra la manera de romper la tercera, el hash se considera **roto**. Le pasó a **MD5** (128 bits): en 2004 Xiaoyun Wang y su equipo publicaron el primer choque, y desde 2006 uno nuevo sale en cerca de un minuto en una laptop. Y a **SHA-1** (160 bits): en 2017, investigadores de Google y del CWI de Ámsterdam publicaron dos PDF distintos con la misma huella. Los dos sirven todavía para detectar daños por accidente, pero nunca para algo que un atacante pueda aprovechar.

### Nombrar las cosas por su contenido

La consecuencia más poderosa: **la huella de un archivo puede ser su nombre**. Si el nombre sale del contenido, el mismo contenido tiene siempre el mismo nombre, y otro contenido no puede usarlo. Lo vas a ver por todas partes:

- **Quitar copias.** Fotos con el mismo SHA-256 son la misma foto: Alba deja una sola antes de repartir train y test. Para recortes y recompresiones, que cambian los bytes, hacen falta huellas perceptuales, como las de los [[duplicado-cercano|casi duplicados]].
- **Verificar descargas.** Un servicio que sirve su propio LLM revisa el sha256 de cada archivo de pesos antes de cargarlo. Lo sano es guardar ese hash en el registro de modelos y revisarlo en el servidor.
- **Imágenes de contenedor y commits.** Una imagen de Docker se identifica por su *digest*, `sha256:` seguido de 64 caracteres, y pedirla por digest garantiza que sea byte por byte la que probaste. Git, el programa de versiones del código, nombra cada versión con un hash.
- **Llaves de caché.** Una caché de predicciones arma la llave de un resultado con `sha256(bytes) + model_version`: la misma foto con el mismo modelo da siempre la misma llave.

:::ejemplo ¿Basta con un pedazo de la huella?
Para ahorrar espacio, el log de Alba podría guardar solo los primeros 12 caracteres hexadecimales del sha256 de cada foto. ¿Cuántos bits son, cuántos choques habría y para qué sirve ese prefijo?

- Bits: 4 por carácter hexadecimal, \(b\) = 12 × 4 = **48 bits**, así que \(K = 2^{48}\) ≈ 2.8 × 10¹⁴ casillas.
- Choques en un día, con \(c ≈ n^2/(2K)\): \(n\) = 10 millones de fotos forman ≈ 5 × 10¹³ pares, y 5 × 10¹³ ÷ 2.8 × 10¹⁴ ≈ **0.18 choques**. Casi nunca.
- 50 % de choque con \(n_{50} ≈ 1.18 × sqrt{K}\) = 1.18 × √(2.8 × 10¹⁴) ≈ 1.18 × 1.68 × 10⁷ ≈ **20 millones** de fotos: dos días de Alba.
- En un año, \(n\) = 10⁷ × 365 = 3.65 × 10⁹ fotos: \(c\) ≈ (3.65 × 10⁹)² ÷ (2 × 2.8 × 10¹⁴) ≈ **24,000 choques**, y cada uno haría pasar dos fotos distintas por la misma. Para buscar una foto en los logs, el prefijo basta (y si hay dos candidatas, se revisa el hash completo); para quitar duplicados o nombrar el contenido, **el sha256 completo**.
:::

:::ojo
Un hash sin llave **no anonimiza**. El mismo email da siempre el mismo hash, y cualquiera con una lista de emails los hashea y los cruza en segundos. Para un seudónimo estable se usa un hash con una llave secreta, el [[hmac|HMAC]], que verás en la lección de cifrado.
:::

### Checksums: detectar el daño, no al atacante

Un checksum es una huella corta y rapidísima para detectar errores por accidente. **CRC32**, de 32 bits, va en cada archivo ZIP y PNG, y en cada paquete de una red Ethernet. Detecta con seguridad cualquier bit volteado y cualquier ráfaga de hasta 32 bits dañados seguidos. Pero no resiste a nadie que lo intente: con 32 bits, la paradoja del cumpleaños da un choque tras ≈ 77,000 intentos, y la estructura de la cuenta permite incluso ajustar un archivo para que dé el CRC que uno quiera.

```python
import hashlib, random, zlib

foto = bytes(range(256)) * 800                  # 204,800 bytes de prueba: «la foto»
danada = bytearray(foto)
danada[1000] ^= 0b0000_0100                     # un solo bit cambia en el camino

for nombre, datos in (("original", foto), ("un bit cambiado", bytes(danada))):
    crc = zlib.crc32(datos)                      # checksum: 32 bits, rapidísimo
    sha = hashlib.sha256(datos).hexdigest()      # hash criptográfico: 256 bits
    print(f"{nombre:<16} crc32 {crc:08x} · sha256 {sha[:12]}…")

rng = random.Random(7)                          # buscar dos archivos con el mismo CRC32
vistos = {}
while True:
    datos = rng.randbytes(16)                    # «archivos» de 16 bytes al azar
    c = zlib.crc32(datos)
    if c in vistos:
        break
    vistos[c] = datos
print(f"dos archivos distintos con el mismo crc32 ({c:08x}) tras probar {len(vistos) + 1:,}")
```

```salida
original         crc32 fa8191cc · sha256 8c6627e25bfb…
un bit cambiado  crc32 13143f88 · sha256 632390b589db…
dos archivos distintos con el mismo crc32 (aa14c1c6) tras probar 113,566
```

Los dos detectan el bit dañado. Pero el choque de CRC32 apareció en una fracción de segundo; uno de SHA-256 no lo ha encontrado nadie. ¿Por qué 113,566 y no 77,000? Porque 77,000 es donde la probabilidad de haber chocado llega a 50 %: es una mediana, no una promesa, y esta corrida tardó un poco más. Con otra semilla sale otro número.

| | Checksum (CRC32) | Hash criptográfico (SHA-256) |
|---|---|---|
| Tamaño | 32 bits | 256 bits |
| Detecta un bit dañado | Sí | Sí |
| Resiste a un atacante | No | Sí |
| Sirve de nombre del contenido | No: choca con ≈ 77,000 | Sí |
| Dónde lo ves | ZIP, PNG, Ethernet, discos | Pesos, imágenes de contenedor, dedupe, Git |

## Errores comunes {Common mistakes}

### 1. Guardar horas sin zona

Un pipeline guarda `2026-11-06 08:03:05` sin zona, y otro lo lee como UTC. Todas las features quedan corridas 6 horas, la diferencia entre CDMX (UTC−6) y UTC: «compras de la mañana» cuenta las de la madrugada.

**Cómo evitarlo:** timestamps con zona en todo el pipeline, en UTC; convertir a la hora local en un solo lugar, al mostrar. Que la validación de datos rechace horas sin zona.

### 2. Medir duraciones con el reloj de pared

`fin − inicio` con `time.time()` da latencias negativas o enormes cuando NTP corrige el reloj a media medición.

**Cómo evitarlo:** duraciones y timeouts con `time.monotonic()`. La hora de pared, solo para poner timestamps.

### 3. Ordenar eventos de varias máquinas por su hora

Con 80 ms de desfase, la respuesta aparece antes que la pregunta, y una latencia medida entre dos máquinas sale negativa.

**Cómo evitarlo:** unir los logs por request ID y ordenar por quién llamó a quién. Medir cada tramo con el reloj de su máquina. Vigilar el desfase con NTP.

### 4. Armar el training set con los valores de hoy

Un join normal entre los eventos y la tabla de features toma el último valor, que es del futuro. La validación sale espectacular; producción, no.

**Cómo evitarlo:** join as-of por la hora en que cada valor estuvo **disponible**, con un límite de antigüedad; etiquetas por fecha de llegada; nada de `now()` dentro de una feature.

### 5. Repartir con el hash() de Python

`hash(seller_id) % 100` reparte distinto en cada corrida: los vendedores brincan entre train y validación, o entre brazos de un A/B.

**Cómo evitarlo:** `hashlib.sha256` (u otro hash fijo) para todo lo que se guarde o lo calcule más de un programa, con una sal por experimento.

### 6. Cambiar el número de shards con mod N

Pasar de 10 a 11 máquinas con `hash mod N` mueve 91 % de los datos, y durante el traslado muchas lecturas fallan o van al lugar equivocado.

**Cómo evitarlo:** hashing consistente, o casillas fijas que se reparten entre máquinas. En un tópico, elegir desde el principio más particiones de las necesarias.

### 7. Ordenar horas como texto con formatos mezclados

Ordenar como texto funciona solo si todas las horas tienen la misma zona y la misma forma. `…T14:03:05Z` queda **después** de `…T14:03:05.5Z`, aunque sea medio segundo antes, porque el punto va antes que la Z. Y una hora con `-06:00` se ordena por su hora local.

**Cómo evitarlo:** normalizar al guardar: todo en UTC, con la Z y con los mismos decimales (por ejemplo, siempre milisegundos). O guardar el timestamp como número o como tipo de fecha de la base de datos, y ordenar por ese.

## En la vida real {In real life} [extra]

### Alba: la línea de cada predicción

La línea del principio es una versión simplificada de la que Alba pide a cada predicción: su `request_id`, la versión del modelo, la huella de la foto, el top-5 y la latencia. El log no guarda la foto, solo su hash, y cuando un vendedor pide borrar sus datos, el borrado se encuentra por `request_id` y por hash. El A/B asigna el brazo con un hash del `seller_id`, y el reparto entre train y validación usa otro: «hash mod 100 < 95 → train». Cada snapshot del dataset se nombra con su fecha, `ds-2026-09-01`, y el puntero a su manifiesto (la lista de sus archivos) lleva el sha256 de esa lista: si alguien la reescribe, la huella ya no coincide. Un detalle: en Alba, la hora de cada línea de log ni siquiera la escribe el programa; la agrega el runtime del contenedor al guardarla.

### Fraude con tarjetas: un pago con dos fechas

En un sistema de detección de fraude con tarjetas, un contracargo llega semanas después del pago: el 3 de agosto alguien paga, y el 17 de septiembre el banco avisa que fue fraude. Se guarda con las dos fechas. Una feature de la tarjeta, calculada el 3 de agosto a las 14:05, vale 1 compra en 24 horas; recalculada con un join descuidado, puede contar las compras de las 14:30 y dar 3. Su exploración (a ≈ 1 % de los pagos que el modelo rechazaría con riesgo medio les pide una verificación extra en vez de rechazarlos, para saber cuántos eran buenos) se decide con un hash de la sal y el `payment_id`, para que un reintento caiga del mismo lado y una auditoría pueda reproducirla. La sal se cambia cada trimestre. Y el email y el teléfono se usan como llaves con un HMAC, no en claro.

### Video en centros de distribución: cajas con reloj propio

Un sistema de video vigila con cámaras varios centros de distribución, y en cada uno tiene cajas de cómputo. Esas cajas corren NTP contra un servidor del sitio, y cada latido compara la hora de la caja con la de la nube. La latencia de punta a punta se mide con la hora del evento en la caja contra la de la alerta en la nube: con el reloj corrido, esa métrica miente. Cada alerta lleva un id uuid5 hecho con el sitio, la cámara, el objeto, la zona y la ventana de 10 minutos, así que una alerta repetida se reconoce sola.

### Recomendación: un watermark de días

Las ventanas y los watermarks no son solo de streaming. Un sistema de recomendación arma su training con las impresiones del día D, de 00:00 a 24:00, y su etiqueta es si hubo contacto en las 24 horas siguientes a cada impresión. Una impresión de las 23:59 del día D puede recibir su contacto hasta el final del día D+1, y se deja una hora de gracia, hasta la 1:00 del día D+2: ≈ 25 horas después del final del día D. El job que cierra el día D corre a las 03:00 del día D+2. Es un watermark de un día y pico, en un job que corre una vez al día. Por eso el modelo que sirve el día D+2 aprendió de datos que terminan ≈ 24 a 48 horas antes.

### La ventana de un límite por minuto

Un cliente tiene un límite de 3,000 requests por minuto: 50 por segundo. Con ventanas fijas de un minuto, puede mandar 3,000 entre las 12:00:59 y las 12:01:00, y otras 3,000 en el segundo siguiente, que ya es otra ventana: 3,000 por segundo, 60 veces el ritmo pactado. Con una ventana deslizante, que siempre mira los últimos 60 segundos, las 3,000 que mandó entre las 12:00:59 y las 12:01:00 siguen dentro de la ventana durante el segundo siguiente, así que casi nada más pasa. La versión que usan muchos limitadores (*sliding window counter*) no guarda la hora de cada request: pondera el conteo del minuto anterior por la parte que todavía cae en la ventana. A las 12:01:01 ya pasó 1 segundo del minuto nuevo, así que la ventana todavía cubre 59 de los 60 segundos del anterior: 3,000 × 59/60 = 2,950, y quedan 50 de cupo: ≈ 3,050 en esos 2 segundos, no 6,000. Por eso el tipo de ventana importa tanto como su largo.

### Shards y semillas

La búsqueda de Alba reparte su índice en 4 shards por hash del `listing_id`. Un sistema de recomendación hace algo curioso: cuando explora con un poco de azar, la semilla del azar es un hash del `request_id`, así que cualquier recomendación se puede reproducir al revisar un reclamo.

### Fuera de ML

- **Las facturas en México.** Cada factura electrónica de México (un CFDI), al timbrarse, recibe un folio fiscal que es un UUID: con él se consulta en el sistema del SAT si la factura existe y sigue vigente. Un sistema que procesa documentos con OCR (lectura del texto de una imagen) lo lee del código QR de la factura.
- **El segundo intercalar de 2012.** El 30 de junio de 2012 se agregó un segundo, y un error de Linux al manejarlo dejó varios servidores atorados y con el procesador al máximo; varios sitios grandes reportaron caídas esa noche.
- **Las contraseñas.** Un sitio serio no guarda tu contraseña, sino un hash hecho a propósito lento y con sal, para que robar la base no regale las contraseñas.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de choques y de shards se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Un evento tiene el tiempo Unix 1,793,973,785. ¿Cuántos días han pasado desde 1970? ¿Cómo se escribe ese instante en milisegundos? Si un sistema lo lee como milisegundos por error, ¿qué fecha cree que es, aproximadamente?
- Días: \(d = t ÷ 86,400\), con \(t\) el tiempo Unix en segundos y 86,400 los segundos de un día: 1,793,973,785 ÷ 86,400 ≈ **20,764**. Entre 365.25 días por año, unos 56.8 años: noviembre de 2026.
- En milisegundos: **1,793,973,785,000**, tres ceros más.
- Leído como milisegundos, son 1,793,973,785 ÷ 1,000 ≈ 1,793,973 segundos, y 1,793,973 ÷ 86,400 ≈ 20.8 días después del 1 de enero de 1970: **el 21 de enero de 1970**. Por eso la unidad va en el contrato, o la hora viaja en ISO 8601.
? [facil] Ana sube una foto a las 8:03 en CDMX el 6 de noviembre de 2026. (a) Escríbela en ISO 8601, en UTC y con su offset. (b) ¿Qué hora era en Tijuana? (c) Un programa ordena como texto `2026-11-06T09:30:00Z`, la hora de Ana con su offset y `2026-11-06T14:00:00Z`. ¿Acierta el orden?
- (a) Hora UTC = hora local − offset. CDMX es UTC−6: 8:03 − (−6 h) = 8:03 + 6 h = 14:03 UTC. **`2026-11-06T14:03:00Z`**, o con su offset, **`2026-11-06T08:03:00-06:00`**. Es el mismo instante.
- (b) Tijuana, el 6 de noviembre, ya está en horario de invierno, UTC−8. Hora local = hora UTC + offset: 14:03 + (−8 h) = **6:03**.
- (c) Letra por letra, la de Ana (`…T08:03:00-06:00`) queda primero. Pero en UTC es 14:03: es la **última**. **No acierta**, porque no todas están en UTC: ordenar como texto solo vale con la misma zona y el mismo formato.
? [facil] Un SHA-256 escrito en hexadecimal tiene 64 caracteres. ¿Cuántos bits y cuántos bytes son? ¿Por qué no usas `hash(texto)` de Python para guardar huellas?
- Bits = caracteres × 4, porque cada carácter hexadecimal son 4 bits: 64 × 4 = **256 bits**. Bytes = bits ÷ 8: 256 ÷ 8 = **32 bytes**. Escrito como texto ocupa el doble, 64 bytes.
- `hash()` de textos cambia en cada corrida de Python (salvo que fijes `PYTHONHASHSEED`): una huella guardada hoy no coincidiría mañana. Para huellas, `hashlib`.
? [medio] Una feature se calculó a las 08:00 (vale 5), 08:45 (vale 9), 09:30 (vale 6) y 10:15 (vale 2), y cada valor tarda 3 minutos en estar disponible. ¿Qué valor le toca a decisiones de las 08:46, 09:20 y 09:32? ¿Y a una de las 12:40 si el límite de antigüedad es de 2 horas?
- Hora de disponibilidad = hora de cálculo + 3 min: 08:03, 08:48, 09:33 y 10:18.
- 08:46: el último disponible es el de las 08:03 → **5** (el de las 08:45 todavía no llegaba).
- 09:20: el último es el de las 08:48 → **9**.
- 09:32: el de las 09:30 llega a las 09:33, un minuto tarde → todavía **9**.
- 12:40: el último es el de las 10:15 (disponible desde las 10:18), calculado hace 12:40 − 10:15 = 2 h 25 min: pasa del límite → **ninguno** (un nulo, que el modelo tiene que saber manejar).
? [medio] Un sistema de eventos cuenta en ventanas fijas de 5 minutos, con un watermark igual al event time más nuevo visto menos 2 minutos. Ya vio un evento de las 10:16:30. ¿Qué ventanas están cerradas? Llega un evento con event time 10:12: ¿entra?
- \(W = t_{max} − m\) = 10:16:30 − 2 min = **10:14:30**.
- Cerradas: todas las que terminan antes de 10:14:30, es decir, hasta la de **10:05 a 10:10**. La de 10:10 a 10:15 sigue abierta.
- El evento de las 10:12 cae en la de 10:10 a 10:15, que sigue abierta: **sí entra**. Si hubiera llegado después de que el watermark pasara 10:15, ya sería tarde.
? [medio] Un servicio con 8 shards por `hash mod 8` pasa a 9. Tiene 200 millones de llaves. ¿Cuántas se mueven? ¿Y con hashing consistente?
- Con mod N: \(f_{mod} = N ÷ (N + 1)\) = 8 ÷ 9 ≈ **88.9 %**, y \(f_{mod} × L\) = 0.889 × 200 millones ≈ **178 millones** de llaves.
- Con hashing consistente: \(f_{anillo} ≈ 1 ÷ (N + 1)\) = 1 ÷ 9 ≈ **11.1 %**, y 0.111 × 200 millones ≈ **22 millones**, las que le tocan a la máquina nueva. Ocho veces menos.
? [reto] Alba lanza un modelo nuevo como canary al 5 % de los vendedores y planea subirlo a 25 % y luego a 100 %, como hace con cada versión. Escribe la regla con hash. ¿Quiénes del primer 5 % siguen en el canary al subir? ¿Qué pasaría si a media rampa alguien cambia la sal?
- Regla: cubeta = sha256(sal + ":" + seller_id) mod 100; está en el canary si **cubeta < porcentaje**.
- Al subir de 5 a 25 %, las cubetas 0 a 4 siguen siendo menores que 25: **todos los del 5 % se quedan**, y entran los de las cubetas 5 a 24. Al pasar a 100 %, entran todos los demás. Nadie entra y sale.
- Con otra sal, las cubetas se revuelven: de los vendedores que estaban en el canary al 25 %, solo ≈ 25 % seguiría adentro (cada uno cae en una cubeta nueva al azar, y 25 de las 100 cubetas están adentro), y ≈ 75 % regresaría al modelo viejo de golpe. Vería cambiar sus sugerencias y las métricas mezclarían dos grupos. La sal se fija al empezar el experimento y no se toca.
? [reto] Un equipo propone ids de 64 bits al azar en vez de UUID, «para ahorrar espacio», para los 10 millones de fotos diarias de Alba durante 100 años. ¿Cuántos choques esperas? ¿Y con UUID v4? ¿Qué propones si de verdad quieren 64 bits?
- \(n\) = 10⁷ × 365 × 100 = 3.65 × 10¹¹ ids.
- Con 64 bits: \(c ≈ n^2 ÷ (2K)\), con \(K = 2^{64}\): (3.65 × 10¹¹)² ÷ (2 × 2⁶⁴) ≈ 1.33 × 10²³ ÷ 3.7 × 10¹⁹ ≈ **3,600 choques** esperados. Ya en el primer año, con \(n\) = 3.65 × 10⁹, serían \(c\) ≈ 0.36, y la probabilidad de algún choque, \(P ≈ 1 − e^{−c}\) = \(1 − e^{−0.36}\) ≈ 30 %.
- Con UUID v4, \(K = 2^{122}\): \(c\) ≈ 1.33 × 10²³ ÷ (2 × 5.3 × 10³⁶) ≈ 1.3 × 10⁻¹⁴: nunca.
- Si quieren 64 bits, que no sean al azar: un esquema tipo Snowflake (hora en milisegundos + número de máquina + contador) no choca por construcción, porque cada máquina tiene su número y su contador. El precio es asignar y cuidar esos números de máquina.
:::

## Lo que sigue {What comes next}

- «Datos y etiquetas» usa el sha256 de cada foto de Alba para revisar que ninguna del [[golden-set|golden set]], el examen fijo de 50,000 fotos con que se califica cada modelo, se cuele en las etiquetas.
- «Versionado y linaje» nombra cada versión de los datos por su huella.
- «Monitoreo, drift y reentrenamiento» une cada predicción con su etiqueta por request ID.
- «Git: versiones del código» nombra cada versión con un hash; «Cifrado, llaves y certificados» presenta el HMAC, y «Ataques y cadena de suministro» verifica con hashes lo que descargas.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
timestamp tiempo-unix utc iso-8601 reloj-monotonico desfase-reloj event-time ventana-tiempo watermark point-in-time funcion-hash hash-criptografico checksum sharding asignacion-hash uuid request-id
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué es el tiempo Unix y qué pasa en 2038?
Los segundos desde el 1 de enero de 1970 a las 00:00 UTC. En un int32 llega a su tope el 19 de enero de 2038 y da la vuelta a 1901. En int64, no.
? ¿Por qué se guarda en UTC y no en la hora local?
UTC es la misma para todos y no cambia de horario; la local depende del lugar y tiene horas que no existen o se repiten. Se convierte al mostrar.
? ¿Con qué reloj mides cuánto tardó una request, y por qué?
Con el monotónico (`time.monotonic()`), que solo avanza. El de pared lo puede mover NTP o una persona, y una resta puede dar negativa.
? ¿Qué diferencia hay entre event time y processing time, y qué hace el watermark?
Event time es cuándo pasó; processing time, cuándo lo procesó el sistema. El watermark dice hasta qué event time se cree tener todo; cuando pasa el final de una ventana, la cierra.
? ¿Qué es un join point-in-time?
Unir a cada evento el último valor de cada feature disponible antes de su hora. Así el training set ve lo que vio el modelo, sin futuro.
? ¿Por qué con 32 bits de hash ya hay choques con unas 77,000 cosas, si hay 4,300 millones de casillas?
Por la paradoja del cumpleaños: chocan los pares, y n cosas forman ≈ n²/2 pares. La primera colisión se vuelve probable cerca de la raíz de las casillas.
? ¿Cómo asigna Alba un vendedor a un brazo del A/B, y por qué así?
Con cubeta = hash(sal + seller_id) mod 100: de 0 a 49 a A, de 50 a 99 a B. Es determinista, sin tabla, y con otra sal cada experimento sortea distinto.
:::
