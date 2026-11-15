---
titulo: La request en vivo
en: The live request
subtitulo: El undécimo paso del sistema de Alba de principio a fin: seguir una foto real por todo el camino y ver los tres rastros que deja, una línea de log, unas sumas en las métricas y, a veces, una traza, y cómo cada uno llega a donde alguien lo puede leer.
pregunta: La versión 14 ya atiende el 100 % del tráfico. Cuando Ana sube la foto de sus tenis, ¿qué queda escrito de esa request, dónde, con qué reloj, y cómo se entera alguien de que algo va mal sin leer diez millones de líneas al día?
requisitos: percentiles, tiempo-hash, formatos, terminal, e06-serving, e09-kubernetes, e10-rollout
---

:::idea
Cada request deja tres rastros. Una **línea de log** con todo lo que pasó con esa foto; unas **sumas** en los contadores del servicio, que dicen cuántas y qué tan rápido sin decir cuáles; y, en una de cada cien, una **traza** con el tiempo de cada tramo. Los tres comparten el mismo `request_id`, y ninguno puede frenar la respuesta.
:::

Ana sube la foto de sus tenis. En unos 20 milisegundos recibe «Calzado › Tenis» con 94 %, y para ella eso es todo. Para el sistema, en cambio, apenas empieza: esa request tiene que quedar contada, medida y guardada, de modo que mañana alguien pueda saber si fue rápida, qué contestó el modelo y con qué versión. Esta estación sigue esa foto de punta a punta y mira cada rastro que deja.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

Alba es la empresa del curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día y sugiere la categoría de cada foto entre 500. Con las fotos que piden otros equipos son ≈ 10 millones de [[request|requests]] al día, una foto por request: ≈ 116 por segundo en promedio, ≈ 350 en el pico del día y 500 en el pico para el que se diseñó. Contesta una ResNet-50 compilada para la GPU y servida por [[triton|Triton]] en GPUs T4, dentro de Kubernetes, en AWS. Delante de Triton está el **gateway**, el programa en Python que recibe la foto, la revisa, la prepara y le pide la respuesta a Triton. La promesa de Alba, su [[slo|SLO]] (*service level objective*, la meta medible del servicio), es un [[p99]] de 200 ms o menos, medido del lado del servidor: de cada 100 requests, a lo más 1 puede tardar más de 200 ms.

### Lo que entra

- **La release 14 al 100 %.** Una [[release-par|release]] es el par que sale junto: el gateway de una versión y el Triton de esa versión. La estación anterior, «Rollout seguro», terminó de pasarle todo el tráfico a la 14: el Rollout `gateway` (el objeto que cambia de versión al gateway por pasos) y el [[deployment-k8s|Deployment]] `triton-v14`, con su [[service-k8s|Service]] del mismo nombre, atienden todo. El modelo es `resnet50-2026-10-01`, con el alias `champion`.
- **Las copias.** Un [[pod]] es una copia de un programa corriendo en una máquina del clúster, y un Service es el nombre fijo que reparte las llamadas entre esas copias. Hay 2 pods de Triton, uno por [[zona-disponibilidad|zona]] (un centro de datos aparte dentro de la región), cada uno en su T4; [[keda|KEDA]] puede subirlos hasta 4. Del gateway hay de 3 a 12 pods (3 en promedio, 4 en la hora pico).
- **Tráfico real**: ≈ 10 millones de fotos al día, de tres programas que llaman al gateway, los *callers*: el backend de publicaciones, moderación y búsqueda.

### Lo que sale

Por cada request:

- **La respuesta**, con el header `X-Request-ID`.
- **Una línea de log** de ≈ 300 bytes en la salida estándar del pod, que termina en S3, el almacén de objetos de AWS, primero tal cual y al día siguiente en [[parquet|Parquet]].
- **Sus sumas en las métricas**: unos contadores en la memoria del pod que [[prometheus|Prometheus]] lee cada 15 segundos.
- **Una traza**, solo en ≈ 1 % de las requests.

### Lo que se decide

Esta estación no entrena ni despliega nada. Decide **qué queda escrito** de cada request:

:::pasos
1. Qué se mide y con qué reloj
Cuánto tardó cada tramo y desde dónde cuenta el SLO.
2. Qué va al log y qué a las métricas
El log, una fila por request con todo; las métricas, sumas partidas por pocas etiquetas.
3. Qué puede ser etiqueta de una métrica
Solo lo que tiene pocos valores: un id por request haría crecer sin techo la memoria de Prometheus.
4. Qué pasa si el camino del rastro falla
Nunca frena la request: se pierde rastro y se avisa, pero Ana recibe su respuesta.
5. Qué no ve el gateway
Lo que contesta el balanceador sin preguntarle, y quién lo mide.
:::

Lo que sale de aquí es la materia prima de la última estación, «Monitoreo, drift y reentrenamiento», que convierte estos rastros en [[alerta|alertas]] y en decisiones.

## El viaje de la foto de Ana, tramo por tramo {Ana's photo, leg by leg}

### El camino

La app de Ana no le habla al clasificador. Le habla al **backend de publicaciones**, el programa que arma la publicación, y él es quien llama al gateway con su propio token. El camino completo es este:

:::diagrama e11-request-camino
El camino de la foto de Ana, de la app a la respuesta, y lo que deja en el pod al final. Toca cada caja; el recorrido la sigue paso a paso.
:::

En palabras, parada por parada:

- **El backend** manda `POST /v1/classify?top_k=5` con los bytes del JPEG y un [[jwt|JWT]], un token firmado que dice quién llama y que dura 15 minutos.
- **El [[alb|ALB]]**, el balanceador de AWS, termina el [[tls|TLS]] (descifra la conexión) y revisa el token: firma, emisor, caducidad y a quién va dirigido. Si algo falla, contesta **401** él mismo.
- **Un pod del gateway**, en el puerto 8080, revisa el permiso (`classify`; si no, 403) y la cuota del caller (429). Luego revisa la foto de lo barato a lo caro: bytes, formato y píxeles (413, 415 o 400). La decodifica y la prepara.
- **`triton-v14` de su misma zona** recibe el [[tensor]]. La foto espera a lo más 2 ms en la fila de Triton, donde Triton reúne las que llegan casi al mismo tiempo para calcularlas en un solo [[batching-dinamico|batch]], y la T4 calcula en ≈ 4 ms. Que la llamada se quede en su zona no es un detalle: AWS cobra cada GB que cruza de una zona a otra. Sin ese ruteo cruzaría la mitad de los ≈ 304 millones de tensores del mes (≈ 0.6 MB cada uno): a ≈ US$0.02 por GB, ≈ US$1,830 al mes.
- **De vuelta en el gateway**: el [[softmax]] convierte los 500 [[logit|logits]] en probabilidades, se toman las 5 más altas y [[labels-json|`labels.json`]], el archivo que dice qué categoría es cada salida del modelo, les pone nombre.
- **La respuesta** sale con `X-Request-ID` al backend, y de ahí a la app de Ana.
- **Al final**, en un bloque `finally` que corre pase lo que pase, el gateway escribe su línea de log y suma lo que toca en sus métricas.

### Los milisegundos de su línea

La línea de log de Ana trae el campo `ms`: `{"pre": 6, "triton": 10, "post": 1, "total": 20}`. ¿Por qué 6 + 10 + 1 da 17 y no 20? Porque el total empieza a contar antes de que llegue todo el [[body]] (el cuerpo de la request: aquí, los bytes de la foto). El equipo de Alba desglosa así una request típica con poco tráfico: 3 + 0 + 6 + 3 + 2 + 4 + 1 + 1 = 20 ms.

| Tramo | ms | En la línea |
|---|---|---|
| Subir el body del ALB al gateway | 3 | solo en `total` |
| Esperar turno de CPU para decodificar (lo regula un [[semaforo\|semáforo]]) | 0 | dentro de `pre` |
| Decodificar y preparar la foto | 6 | `pre` |
| Ida a Triton | 3 | `triton` |
| Fila de Triton | 2 | `triton` |
| Cálculo en la T4 | 4 | `triton` |
| Vuelta | 1 | `triton` |
| Softmax, top-5 y respuesta | 1 | `post` |

:::formula El reloj del gateway
t_{gw} = t_{sub} + t_{pre} + t_{tr} + t_{post}
- t_{sub}: subir el body de la request del ALB al gateway, en ms
- t_{pre}: el preproceso, `ms.pre`: esperar lugar de CPU, decodificar y preparar, en ms
- t_{tr}: la llamada a Triton, `ms.triton`: ida, fila, cálculo y vuelta, en ms
- t_{post}: el softmax, el top-5 y armar la respuesta, `ms.post`, en ms
- t_{gw}: lo que mide el gateway, `ms.total`, en ms
:::

:::cuenta Los 20 ms de Ana
Preproceso, \(t_{pre}\) // `ms.pre` de su línea: 0 de espera + 6 de decodificar | 0 + 6 | 6 ms
Triton, \(t_{tr}\) // `ms.triton`: ida 3 + fila 2 + T4 4 + vuelta 1 | 3 + 2 + 4 + 1 | 10 ms
Respuesta, \(t_{post}\) // `ms.post` | — | 1 ms
Lo que suman los tres campos | 6 + 10 + 1 | 17 ms
Total del gateway, \(t_{gw}\) // `ms.total` de su línea | — | 20 ms
Subida, \(t_{sub}\) // lo que falta: el total menos los tres campos | 20 − 17 | 3 ms
= Los 3 ms que no aparecen en ningún campo son la subida del body: el gateway ya está midiendo, pero todavía no tiene la foto completa.
:::

Con tráfico alto los números cambian, pero lo que importa aquí es que cada tramo **se mide aparte**. Si mañana el total sube, el desglose dice si fue la CPU del gateway, la fila de Triton o la GPU.

:::profundo El caso lento
El equipo de Alba estima un caso lento sumando el p99 de cada paso: 40 ms de red y entrada, 52 de preproceso, 27 del modelo, 3 de la respuesta y 30 del propio programa (organizarse y esperar turno). Son 40 + 52 + 27 + 3 + 30 = 152 ms: quedan 200 − 152 = 48 ms de margen. Ese reparto es el presupuesto de latencia que cuenta «El camino completo», en «El presupuesto de 200 milisegundos».
:::

### Tres relojes para la misma request

¿Cuánto tardó la request de Ana? Depende de quién mida. Hay tres relojes, uno dentro del otro, y cada uno empieza y termina en un lugar distinto:

- **El gateway** mide desde que su código recibe la request (ya llegaron los headers; el body todavía viene en camino) hasta que manda la respuesta: `ms.total` en el log y, en las métricas, el histograma `classifier_request_latency_seconds` («latencia de la request del clasificador, en segundos»). Es la [[latencia-lado-servidor|latencia del lado del servidor]], la que promete el SLO.
- **El ALB** mide `TargetResponseTime` («tiempo de respuesta del destino»): desde que la request sale del ALB hacia el pod hasta que el pod empieza a mandar los headers de su respuesta. Suma la red entre el ALB y el pod.
- **El backend** mide todo lo que esperó, contra su [[timeout]] de 300 ms: suma además lo que tarda el ALB en sus propias cuentas (TLS, revisar el token) y la red entre el backend y el ALB.

:::formula Tres relojes, uno dentro del otro
t_{alb} = t_{gw} + t_{red}
t_{bk} = t_{alb} + t_{ent}
- t_{gw}: el reloj del gateway, en ms (la fórmula de arriba)
- t_{red}: la red entre el ALB y el pod, ida y vuelta, en ms
- t_{alb}: lo que mide el ALB, `TargetResponseTime`, en ms
- t_{ent}: la entrada: lo que tarda el propio ALB en sus cuentas (TLS, revisar el token) más la red entre el backend y el ALB, ida y vuelta, en ms
- t_{bk}: lo que espera el backend, en ms
:::

Con \(t_{red}\) ≈ 1 ms y \(t_{ent}\) ≈ 2 ms (supuestos del ejemplo, para una red dentro de la misma región), la request de Ana mide \(t_{gw}\) = 20 ms en el gateway, \(t_{alb}\) = 20 + 1 ≈ 21 ms en el ALB y \(t_{bk}\) = 21 + 2 ≈ 23 ms en el backend. Ninguno miente: miden cosas distintas. La trampa es compararlos como si fueran el mismo. Si el backend se queja de 280 ms y el gateway dice 20, el tiempo se fue **fuera** del gateway: en el ALB, en la red o en el propio backend.

:::figura e11-request-relojes
Los tres relojes de la request de Ana, uno dentro del otro. Abajo, los tramos del gateway: 3 de subida, 6 de preproceso, 10 de Triton y 1 de respuesta.
:::

Ninguno de los tres incluye la subida desde el celular de Ana hasta AWS, que con una red celular puede pasar de 60 ms. Por eso el SLO dice «del lado del servidor»: promete solo lo que Alba controla.

## El `request_id`, de punta a punta {The request_id, end to end}

Los tramos dicen cuánto tardó. Falta saber **cuál** request fue, y juntar lo que dejó en cada lugar. Para eso cada request lleva un nombre único: su [[request-id|`request_id`]].

### Dónde nace

La regla del gateway tiene dos casos. Si el caller manda el header `X-Request-ID`, el gateway usa ese. Si no lo manda, genera uno nuevo con un [[uuid|UUID]] versión 4: 122 bits al azar, tantos que dos programas pueden inventar ids al mismo tiempo sin chocar y sin preguntarle a nadie. Por qué no chocan, y por qué un contador 1, 2, 3 no serviría, lo cuenta «Tiempo, hashes e identificadores» en «UUID y request ID». La línea de Ana trae `5a1e07c3`, un id corto de ejemplo; uno de verdad tiene 36 caracteres.

Respetar el id del caller tiene un motivo: así el backend y el gateway hablan de la misma request con el mismo nombre. Si el backend ya anotó `5a1e07c3` en su propio log, el del gateway dice lo mismo.

### Por dónde viaja

El mismo id aparece en cinco lugares:

| Lugar | Para qué |
|---|---|
| La respuesta, en el header `X-Request-ID` | Que el backend sepa qué id le tocó a esa foto |
| La línea de log del gateway | Encontrar la request y unirla con lo demás |
| La llamada a Triton | Que un error de Triton se pueda ligar a la request |
| El borrador de la publicación, en el backend | Unir la foto con la publicación de Ana |
| Los eventos que anota el backend: `suggestion_shown` (se mostraron las sugerencias) y `category_selected` (se eligió una categoría) | Saber si Ana vio las sugerencias y cuál eligió |

Y, cuando la request tiene traza (el registro de tiempos que ves más abajo), el id va guardado dentro de ella como un dato más.

### Para qué sirve: unir

El log dice qué sugirió el modelo; el evento `category_selected` dice qué eligió Ana. Juntos dicen si el modelo acertó. Esa unión es un [[join]] por `request_id` (juntar las filas de dos tablas que traen el mismo id), la [[log-prediccion|llave de unión]] que presenta «Datos y etiquetas» en «Unir el log con la publicación». Sin el id habría que adivinar por la hora y el usuario, y eso falla con 116 fotos por segundo.

:::ejemplo Marta busca una request
Un reporte de soporte trae el id `5a1e07c3`: «la sugerencia tardó mucho». Marta, la persona de [[guardia]] (a quien le toca atender los problemas del servicio esa semana), no necesita saber en qué pod cayó ni a qué hora exacta. Busca el id en el log del día y encuentra la línea: `status` 200, `ms.total` 20. El gateway contestó rápido; el tiempo se fue en otro lado. Con el mismo id busca en el log del backend y encuentra la espera. Sin un nombre común, serían dos montones de líneas imposibles de casar.
:::

:::ojo
El `request_id` es un dato de cada request. Va en el log y en la traza, **nunca** como etiqueta de una métrica. La sección de cardinalidad dice por qué con números.
:::

## Tres maneras de mirar: métricas, logs y trazas {Three ways to look: metrics, logs and traces}

Un sistema que sirve millones de requests no se puede mirar leyendo cada una. Se mira con tres herramientas, y cada una contesta una pregunta distinta. A tener las tres, bien hechas y unidas, se le llama [[observabilidad]] (*observability*): poder entender qué pasa adentro del sistema mirando lo que sale de él, sin tener que meterle código nuevo cada vez que surge una duda.

- **Métricas.** Una [[metrica|métrica]] es un número con nombre que el servicio lleva y que se lee a intervalos fijos: cuántas requests van, cuántas con error, cuántas tardaron menos de 200 ms. Son **sumas**: no recuerdan ninguna request en particular. Contestan «¿cuánto?» y «¿desde cuándo?»: la tasa de errores subió a las 14:05. Son baratas, porque su tamaño no crece con el tráfico, y por eso de ellas salen las alertas.
- **Logs.** Una línea por request, con todos sus datos. Contestan «¿qué pasó con **esta**?»: qué contestó el modelo en la request `5a1e07c3`. Crecen con el tráfico: ≈ 3 GB al día en Alba. Sirven para buscar, para unir con otros datos y para sacar las etiquetas de entrenamiento del mes (la categoría correcta de cada foto).
- **Trazas.** Una [[traza-distribuida|traza]] es el recorrido de **una** request por todos los programas que tocó, con el tiempo de cada tramo. Contesta «¿dónde se fue el tiempo?» en una request lenta concreta. Son caras, así que Alba guarda solo ≈ 1 %.

:::figura e11-request-tres-miradas
La misma hora de tráfico vista de tres maneras: la métrica como una curva en el tiempo, el log como filas con todos sus campos y la traza como barras de tiempo de una sola request.
:::

Una manera de verlo: las métricas son el tablero de un auto (velocidad, temperatura, gasolina), los logs son la bitácora de cada viaje y la traza es el video de un viaje en particular. El tablero avisa que el motor se calienta; la bitácora dice en qué viajes pasó; el video muestra en qué subida. Donde se rompe: un auto hace un viaje a la vez, y Alba atiende cientos de requests por segundo; por eso el video se graba solo de unas cuantas.

Se usan en otro orden que el de la lista: métrica, traza y log. Una métrica avisa: «el p99 pasó de 200 ms». La traza de una request lenta muestra qué tramo creció. El log dice cuántas requests se parecen a esa y qué tienen en común. Lo que las une es el `request_id`: está en el log, está en la traza y, como verás en la sección de trazas, también se puede llegar a él desde la métrica.

Para un modelo hay además una diferencia de fondo. Las métricas ven las fallas ruidosas: errores 5xx, latencia alta. Una falla callada, un 200 con una sugerencia mala, no se ve en ninguna métrica de servicio; se ve solo en el log, uniendo cada predicción con lo que eligió la persona. Por eso Alba guarda el log del 100 % de las requests y no una muestra. Esa [[falla-silenciosa|falla silenciosa]] es el tema de la última estación.

## La línea de log y su camino a S3 {The log line and its way to S3}

### La línea, en dos frases

Los campos de la línea ya los conoces de «Código de serving», en «La respuesta, el log y el código de cada falla»: `request_id`, `caller` (el `client_id` del token, como `backend-publicaciones`), `source` (de dónde dice venir la foto: `mobile`, `web` o `internal`), `model_version`, `top5`, `ms`, `bytes`, el principio del `sha256` (la huella de la foto) y `status`, más `error` en las fallas. Es una línea de [[json-lines|JSON Lines]] de ≈ 300 bytes, sin la foto, sin su [[exif|EXIF]] (los datos que la cámara esconde en el archivo, como el lugar) y sin el id de la vendedora («Datos personales y la ley» dice por qué).

Le falta algo que parecería obvio: **la hora**. La línea no la trae. La pone quien la guarda.

### De la salida estándar al archivo del nodo

El gateway escribe la línea en su [[flujos-estandar|salida estándar]] (*stdout*), como si la imprimiera en una terminal. No abre archivos, no conoce S3 y no espera a nadie. Lo demás lo hacen otros:

:::pasos
1. El runtime la guarda con su hora
El runtime del contenedor, el programa del nodo que arranca y vigila los contenedores, lee el stdout del gateway y escribe cada línea en un archivo del disco del nodo, con la hora en que la recibió, en [[utc|UTC]]. Es la hora que muestra `kubectl logs --timestamps`.
2. Fluent Bit lo lee
En cada nodo corre un pod de [[fluent-bit|Fluent Bit]], un programa chico que lee archivos de log mientras crecen. Sigue el archivo del gateway, separa la hora de la línea y la lleva como hora del registro.
3. Lo junta y lo sube
Cada ≈ 5 minutos sube a S3 lo que juntó, comprimido con gzip, en `s3://ml-datos/logs/crudo/AAAA/MM/DD/HH/`. Es un archivo por nodo cada 5 minutos: 86,400 segundos del día ÷ 300 s = 288 archivos al día por nodo.
4. Al día siguiente, Parquet
A la 01:00 UTC, el job `monitoreo-diario`, un programa que corre a esa hora, hace su trabajo y termina, lee los archivos crudos del día anterior y los reescribe en Parquet, en `s3://ml-datos/logs/predicciones/dt=AAAA-MM-DD/model_version=…/`: ≈ 0.5 GB al día en 4 archivos de ≈ 125 MB.
:::

Un pod de Fluent Bit en cada nodo, ni más ni menos, se pide con un [[daemonset|DaemonSet]]: un objeto de Kubernetes que pone una copia de un pod en cada nodo que cumple una condición, y una más en cada nodo nuevo que llega. Con un Deployment de 3 réplicas, dos nodos podrían quedarse sin quien lea sus logs. Todo este recorrido se llama el [[pipeline-logs|camino del log]] (*log pipeline*).

:::diagrama e11-request-log
El camino de la línea de Ana desde el stdout del gateway hasta el Parquet del día siguiente, con el buffer del nodo y la alerta que avisa si se atora.
:::

Fluent Bit sube con un [[rol-iam|rol de AWS]] (un juego de permisos con nombre) que **solo** puede escribir en el prefijo `logs/`: no puede leer las fotos ni el modelo. La partición por fecha, `dt=…`, es la de «Object storage, data lakes y warehouses» en «Data lake y particiones por fecha»: una consulta de un día lee solo esa carpeta.

:::profundo La configuración y los permisos de Fluent Bit
Así se ve, como **ilustración**, la configuración de Fluent Bit (los nombres de las opciones son de su formato clásico; los valores son los de Alba):

```ini
[INPUT]
    Name              tail
    Path              /var/log/containers/gateway-*_classifier_*.log
    multiline.parser  cri
    DB                /var/fluent-bit/tail.db

[OUTPUT]
    Name                  s3
    bucket                ml-datos
    region                us-east-1
    s3_key_format         /logs/crudo/%Y/%m/%d/%H/$UUID.gz
    compression           gzip
    use_put_object        On
    upload_timeout        5m
    store_dir             /var/fluent-bit/s3
    store_dir_limit_size  1G
```

`tail` sigue los archivos del gateway; `cri` es el formato en que el runtime escribe cada línea (hora, flujo, una marca de línea completa o partida, y el texto); `DB` anota hasta dónde leyó cada archivo, para seguir ahí si Fluent Bit se reinicia. `upload_timeout 5m` sube cada 5 minutos aunque el archivo no se haya llenado: el otro tope, `total_file_size` (100 MB por omisión), queda muy lejos de los ≈ 5 MB que junta un nodo en ese rato. `store_dir` es el buffer en disco de la salida a S3, en una carpeta del propio nodo para que sobreviva si el pod se reinicia, y `store_dir_limit_size 1G` es su tope: 1 GB, porque para Fluent Bit `1G` son 10⁹ bytes. La opción general de buffer, `storage.total_limit_size`, no sirve aquí: la salida a S3 lleva su propio buffer.

`use_put_object On` sube cada archivo con una sola operación (un `PutObject`), no por partes. S3 cifra cada archivo con una llave de [[kms|KMS]], el servicio de llaves de AWS: subir por partes exigiría también el permiso de descifrar con esa llave, y subir de una vez no. Así el rol de Fluent Bit escribe sin poder leer.
:::

### Nunca bloquear la request

¿Qué pasa si S3 no contesta, o si Fluent Bit se cae? **El gateway no se entera.** Escribe en stdout y sigue. Entre él y S3 hay un archivo en el disco del nodo y un buffer en disco de Fluent Bit: aunque la subida esté atorada, la escritura del gateway termina en microsegundos. Fluent Bit guarda lo que no pudo subir hasta ≈ 1 GB por nodo y lo reintenta. Si el buffer se llena, se pierden líneas. Si el que se cae es Fluent Bit, el colchón es más chico: solo los archivos del nodo.

:::profundo Si el que se cae es Fluent Bit
Los archivos del nodo los rota el kubelet, el agente de Kubernetes en cada nodo: cuando uno se llena, empieza otro y borra el más viejo. Por omisión guarda 5 archivos de 10 MiB (≈ 10.5 MB) por contenedor, del orden de una hora de un pod del gateway, menos en el pico. Al volver, Fluent Bit sigue donde se quedó, pero lo que el kubelet ya rotó en ese rato se puede perder.
:::

Es una decisión a propósito: **se degrada el monitoreo del modelo, no el servicio.** Ana recibe su sugerencia aunque su línea de log se pierda. Lo contrario, un gateway que espera a que S3 confirme cada línea, convertiría cualquier lentitud de S3 en lentitud para todos los usuarios.

Perder líneas en silencio también sería malo: mañana faltarían filas en el join con las publicaciones y las etiquetas de entrenamiento del mes saldrían chuecas. Por eso existe la alerta `LogsStale` («logs viejos»): si en 30 minutos no llega ningún archivo nuevo a `s3://ml-datos/logs/crudo/`, avisa al canal del equipo.

### Cuánto pesa y cuánto cuesta

Los ≈ 3 GB diarios y ≈ 270 GB ya los contaste en «Archivos y formatos: JSON, CSV, Parquet y YAML», con \(N\), \(b\) y \(d\); aquí cambian las letras porque se suman costo y buffer:

:::formula Volumen, costo y aguante del log
V_d = R_d × w_l
A = V_d × D
C = A × u
L = frac{G × N_n × 24}{V_d}
- R_d: requests al día, en requests (una línea por request)
- w_l: el tamaño de una línea, en bytes por línea
- V_d: lo que se escribe en un día, en GB por día (10⁹ bytes = 1 GB)
- D: los días que se guarda, en días
- A: lo que está guardado en un momento dado, en GB
- u: el precio de guardar, en US$ por GB al mes
- C: lo que cuesta guardarlo, en US$ al mes
- G: el buffer en disco de Fluent Bit en un nodo, en GB
- N_n: los nodos del gateway, que se reparten las líneas, sin unidad
- L: lo que aguanta el buffer de un nodo sin subir nada, en horas; el 24 pasa de días a horas
:::

:::cuenta El log de Alba
Requests al día, \(R_d\) // el tráfico de Alba | — | 10,000,000
Tamaño de una línea, \(w_l\) // la de Ana mide 306 B; la ficha redondea | — | ≈ 300 B
Al día, \(V_d = R_d × w_l\) | 10,000,000 × 300 B = 3,000,000,000 B | ≈ 3 GB
Retención, \(D\) // el log se guarda 90 días | — | 90 días
Guardado, \(A = V_d × D\) | 3 × 90 | 270 GB
Precio, \(u\) // S3 Standard en us-east-1, noviembre de 2026 | — | US$0.023 por GB-mes
Costo, \(C = A × u\) // sin contar la compresión de gzip, que lo baja | 270 × 0.023 | ≈ US$6 al mes
Buffer de un nodo, \(G\) // el `1G` de su configuración: para Fluent Bit son 10⁹ B | — | 1 GB
Nodos del gateway, \(N_n\) // dos máquinas c6i.xlarge (un tamaño de máquina de AWS), una por zona: cada uno escribe ≈ 1.5 GB al día | — | 2
Aguante, \(L = G × N_n × 24 ÷ V_d\) // con el tráfico parejo del día; 24 horas por día | 1 × 2 × 24 ÷ 3 | 16 h
= Guardar 90 días de log cuesta ≈ US$6 al mes, y cada nodo aguanta ≈ 16 horas de S3 caído antes de perder una línea (menos si la caída es en el pico). Los 30 minutos de `LogsStale` llegan con mucho margen.
:::

Seis dólares al mes, contra ≈ US$1.8k al mes de toda la infraestructura del clasificador. Logs, métricas y S3 juntos suman ≈ US$100 al mes. La línea guarda el principio del `sha256` de la foto, no la foto: si de verdad hace falta encontrarla, el backend la tiene.

:::profundo Medir la línea de Ana, y por qué no se guarda la foto
La tentación es guardar de más: «guardemos también la foto, por si acaso». Con fotos de ≈ 200 KB serían 10 M × 200 KB ≈ 2 TB al día, ≈ 61 TB al mes y 61,000 GB × US$0.023 ≈ US$1,400 **más cada mes**, acumulándose, además del problema de privacidad. Este programa mide la línea de Ana y hace las dos cuentas:

```python
import json

ana = {"request_id": "5a1e07c3", "caller": "backend-publicaciones", "source": "mobile",
       "model_version": "resnet50-2026-10-01",
       "top5": [[17, 0.94], [41, 0.03], [12, 0.02], [63, 0.01], [205, 0.0]],
       "ms": {"pre": 6, "triton": 10, "post": 1, "total": 20},
       "bytes": 214836, "sha256": "3b7e0c51a9d2", "status": 200}

w_l = len((json.dumps(ana) + "\n").encode("utf-8"))   # bytes de la línea, con su salto
R_d = 10_000_000                                      # requests al día
V_d = R_d * w_l / 1e9                                 # GB al día
A = V_d * 90                                          # 90 días de retención
print(f"la línea de Ana: {w_l} B")
print(f"al día: {V_d:.2f} GB · en 90 días: {A:.0f} GB")
print(f"a US$0.023 por GB-mes: US${A * 0.023:.2f} al mes")
print(f"si guardara la foto (200 KB): {R_d * 200e3 / 1e12:.0f} TB al día")
```

```salida
la línea de Ana: 306 B
al día: 3.06 GB · en 90 días: 275 GB
a US$0.023 por GB-mes: US$6.33 al mes
si guardara la foto (200 KB): 2 TB al día
```
:::

:::calculadora e11-request-log
Empieza con Alba. Sube \(w_l\) a 450 B, lo que mide una línea con nombres de campo largos: el costo sube ≈ US$3, de 6 a 9 al mes, y sigue siendo poco. Luego baja el buffer \(G\) a 0.1 GB: el aguante cae a menos de 2 horas.
:::

## Lo que suma cada request: contador, gauge e histograma {What each request adds: counter, gauge and histogram}

El log se escribe una vez y se va. Las métricas, en cambio, viven en la memoria del pod: son unos números que cada request modifica y que alguien lee de vez en cuando. Prometheus, el programa que los lee en Alba, conoce cuatro tipos. Tres importan aquí.

### Contador: solo sube

Un [[contador-prometheus|contador]] (*counter*) es un número que empieza en 0 y solo sube. `classifier_requests_total` («total de requests del clasificador») es uno: cada request le suma 1 a la cuenta de su combinación de `status`, `source` y `model_version`. Hay una cuenta aparte por cada combinación; más abajo verás que cada una se llama serie. Su valor solo, «957,980», no dice nada útil: es lo que lleva contado desde que arrancó el proceso. Lo que sirve es **cuánto subió** en un rato: de ahí sale la tasa en requests por segundo.

Si el proceso se reinicia, el contador vuelve a 0. Eso no es un error: es la regla. Quien lo lee sabe que un contador nunca baja, así que si lo ve bajar, entiende que hubo un reinicio.

### Gauge: sube y baja

Un [[gauge-prometheus|gauge]] (se pronuncia «geich», medidor) es un número que sube y baja y cuyo valor **sí** significa algo en cada momento: las requests en vuelo del pod, las que está atendiendo en ese instante (de 0 a 16, su tope), las réplicas de Triton, la memoria usada, la temperatura de la GPU. Del gauge se lee el valor, no cuánto subió. La última estación usa gauges para publicar el resultado del job diario, como el [[psi|PSI]] del día, un número que dice cuánto cambiaron las fotos que llegan.

### Histograma: cuenta por buckets

Un [[histograma-prometheus|histograma de Prometheus]] es un grupo de contadores, uno por [[bucket]]. «Promedios, medianas y percentiles» lo cuenta a fondo en «Buckets: percentiles sin guardar cada número». En dos frases: un bucket es un intervalo de tiempo con su contador, y su borde es el límite de arriba; cada request suma 1 a todos los buckets cuyo borde es mayor o igual a su latencia, así que los conteos son acumulados y el borde va en la etiqueta `le` (*less or equal*, «menor o igual»). De esos conteos se estima el p99 sin guardar cada latencia. Aquí basta lo que cada request suma. La de Ana, con 20 ms = 0.020 s, suma:

- 1 a los buckets `le` de 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0, 2.5 y `+Inf` (no al de 0.01: tardó más);
- 1 a `_count`, el total de observaciones;
- 0.020 a `_sum`, la suma de todas las latencias, de donde sale el promedio si alguien lo quiere.

El cuarto tipo, el *Summary*, calcula los percentiles dentro de cada pod, y esos no se pueden juntar entre pods: el p99 de todo el gateway no es el promedio de los p99 de cada pod. Por eso Alba no lo usa. El cliente de Prometheus para Python ni siquiera calcula percentiles en su Summary: solo lleva la cuenta y la suma.

### Lo que hace el `finally`

En el gateway, todo esto pasa en el mismo `finally` que escribe la línea de log. Los nombres dicen lo que miden: el total de requests, la latencia de la request, los segundos de preproceso, los de inferencia, el score top-1 y los bytes de la imagen. Por cada request:

| Métrica | Tipo | Qué le suma la request de Ana |
|---|---|---|
| `classifier_requests_total{status, source, model_version}` | contador | 1 a `{200, mobile, resnet50-2026-10-01}` |
| `classifier_request_latency_seconds{source, model_version}` | histograma | 0.020 s |
| `classifier_preprocess_seconds{model_version}` | histograma | 0.006 s |
| `classifier_inference_seconds{model_version}` | histograma | 0.010 s |
| `classifier_top1_score{model_version}` | histograma | 0.94 |
| `classifier_image_bytes{source}` | histograma | 214,836 B |

Tres reglas. Los 4xx no entran a la latencia: un 415 tarda microsegundos y bajaría el p99 sin que nadie respondiera más rápido. Los nombres no se cambian, porque las alertas los buscan por nombre: renombrar una métrica apaga su alerta sin que nadie se entere. Y la inferencia **se anota también en los 503 y 504** (Triton no disponible o fuera de tiempo): un timeout de Triton es la inferencia más lenta, no una que falta.

El score top-1 es la [[confianza]] del modelo: la probabilidad de su primera sugerencia (0.94 en la foto de Ana). Su histograma tiene un borde en 0.3, el umbral de baja confianza de Alba: abajo de 0.3, la sugerencia se considera dudosa. Con ese borde, la última estación cuenta qué fracción de fotos sale dudosa sin leer el log.

### El texto de `/metrics`

Las métricas no se mandan a ningún lado. El gateway las **expone** en una ruta, `GET /metrics`, como texto, y quien quiera las lee. Cada línea es un nombre, unas [[etiqueta-metrica|etiquetas de la métrica]] entre llaves (*labels*, pares nombre = valor que parten la métrica) y un número. Esta, por ejemplo, dice que el pod lleva 957,980 requests con 200, que llegaron de `mobile` y las contestó la versión 14:

```text
classifier_requests_total{status="200",source="mobile",model_version="resnet50-2026-10-01"} 957980.0
```

`/metrics` solo se contesta dentro del clúster: el ALB no la publica.

:::profundo Un pedazo de `/metrics`, línea por línea
Así se ve un pedazo más largo, como **ilustración** (las líneas de verdad son muchas más):

```text
# TYPE classifier_requests_total counter
classifier_requests_total{status="200",source="mobile",model_version="resnet50-2026-10-01"} 957980.0
# TYPE classifier_requests_created gauge
classifier_requests_created{status="200",source="mobile",model_version="resnet50-2026-10-01"} 1.7939232e+09
# TYPE classifier_request_latency_seconds histogram
classifier_request_latency_seconds_bucket{source="mobile",model_version="resnet50-2026-10-01",le="0.01"} 41.0
classifier_request_latency_seconds_bucket{source="mobile",model_version="resnet50-2026-10-01",le="0.025"} 612904.0
classifier_request_latency_seconds_bucket{source="mobile",model_version="resnet50-2026-10-01",le="0.2"} 955377.0
classifier_request_latency_seconds_bucket{source="mobile",model_version="resnet50-2026-10-01",le="+Inf"} 958601.0
classifier_request_latency_seconds_sum{source="mobile",model_version="resnet50-2026-10-01"} 36712.4
classifier_request_latency_seconds_count{source="mobile",model_version="resnet50-2026-10-01"} 958601.0
```

`_created` es la hora en que nació la serie, en [[tiempo-unix|tiempo Unix]], los segundos desde el 1 de enero de 1970: `1.7939232e+09` es 1.7939232 × 10⁹ s, el 6 de noviembre de 2026 a las 00:00 UTC. Ayuda a distinguir un reinicio. Los acumulados se ven: `le="+Inf"` y `_count` valen lo mismo. Y `_count` (958,601) pasa un poco al contador de 200 (957,980), como debe: la latencia cuenta también los 5xx de `mobile`, aquí 621. El cliente de Python escribe cada número con decimales (`957980.0`) y pone `_created` aparte, como un gauge propio.

El gateway corre **un solo [[proceso]]** de [[uvicorn]], el servidor que corre su código, por pod, a propósito: con varios procesos, cada uno tendría sus propios contadores y el cliente de Python necesitaría un modo especial, con archivos compartidos, para juntarlos.
:::

### La tasa: cuánto subió el contador

:::formula Tasa de un contador, con reinicios
δ_i = c_i − c_{i−1}   text{si} c_i ≥ c_{i−1}
δ_i = c_i   text{si} c_i < c_{i−1}
r = frac{sum_{i=2}^{n} δ_i}{Δt}
- c_i: el valor del contador en la muestra número \(i\), en requests
- n: cuántas muestras hay en la ventana
- δ_i: lo que subió entre la muestra \(i − 1\) y la \(i\), en requests. Si el contador bajó, hubo un reinicio: volvió a 0 y contó \(c_i\) desde ahí
- Δt: el tiempo entre la primera y la última muestra, en segundos
- r: la tasa, en requests por segundo
:::

Toma el contador de las requests con 200 de un pod, leído cada 15 segundos durante un minuto. Entre la tercera y la cuarta lectura, el contenedor se reinicia dentro del mismo pod (por ejemplo, porque falló su probe de [[liveness]], la revisión que pregunta si sigue vivo):

:::cuenta La tasa de un contador que se reinicia
Muestras \(c_1\) a \(c_5\) // cada 15 s | 1,000,000 · 1,000,540 · 1,001,080 · 120 · 660 | \(n\) = 5
Ventana, \(Δt\) // la primera a los 0 s; la quinta, 4 lecturas después, a los 4 × 15 = 60 s | 60 − 0 | 60 s
Resta ingenua // \((c_5 − c_1) ÷ Δt\), como si nada hubiera pasado | (660 − 1,000,000) ÷ 60 | ≈ −16,656 por segundo
\(δ_2\) y \(δ_3\) // suben normal | 1,000,540 − 1,000,000 · 1,001,080 − 1,000,540 | 540 · 540
\(δ_4\) // \(c_4\) = 120 < \(c_3\): reinicio, cuenta \(c_4\) | — | 120
\(δ_5\) | 660 − 120 | 540
Suma de los aumentos | 540 + 540 + 120 + 540 | 1,740
Tasa, \(r\) | 1,740 ÷ 60 | 29 por segundo
= La resta ingenua da una tasa negativa, que no existe. Sumando aumentos y leyendo la bajada como reinicio sale 29 requests por segundo. Lo normal eran 36 (540 ÷ 15): las que el proceso viejo contó entre la última lectura y su caída se perdieron con él.
:::

:::figura e11-request-contador
El contador de un pod en un minuto: sube 540 cada 15 s, cae a 0 en el reinicio y vuelve a subir. Abajo, la tasa que sale de sumar los aumentos.
:::

Eso es lo que hace la función `rate()` de Prometheus, con un detalle más: estima lo que pasó entre el borde de la ventana y la primera y la última muestra, así que su resultado puede tener decimales aunque los contadores sean enteros.

:::profundo La tasa en Python
Este programa hace la versión simple:

```python
# Las muestras que Prometheus leyó de un contador, cada 15 s: (segundo, valor)
muestras = [(0, 1_000_000), (15, 1_000_540), (30, 1_001_080),
            (45, 120), (60, 660)]      # entre 30 y 45 el contenedor se reinició

def aumento(c_antes, c_ahora):
    if c_ahora >= c_antes:
        return c_ahora - c_antes       # lo normal: solo sube
    return c_ahora                     # bajó: volvió a 0 y contó c_ahora desde ahí

dt = muestras[-1][0] - muestras[0][0]
ingenua = (muestras[-1][1] - muestras[0][1]) / dt
total = sum(aumento(a[1], b[1]) for a, b in zip(muestras, muestras[1:]))
print(f"ventana: {dt} s")
print(f"(último - primero) / dt: {ingenua:,.1f} requests/s")
print(f"aumentos sumados: {total:,} requests")
print(f"tasa con el reinicio: {total / dt:.1f} requests/s")
```

```salida
ventana: 60 s
(último - primero) / dt: -16,655.7 requests/s
aumentos sumados: 1,740 requests
tasa con el reinicio: 29.0 requests/s
```
:::

Si el pod entero se reemplaza por otro, con otro nombre, no hay reinicio: hay una serie nueva, porque el nombre del pod también es una etiqueta. La vieja deja de recibir muestras y la nueva empieza en 0.

## Prometheus: scrape, series y PromQL {Prometheus: scraping, series and PromQL}

### Leer, no recibir

[[prometheus|Prometheus]] es el programa que junta y guarda las métricas de Alba. Trabaja **por pull** (jalando): cada 15 segundos le pide `/metrics` a cada pod que conoce, lee el texto y guarda cada número con la hora. Esa lectura se llama [[scrape]]. Al revés, *push*, cada servicio mandaría sus números; Prometheus prefiere jalar por una razón práctica: si un pod no contesta, se nota. Por cada pod que intenta leer, Prometheus guarda además un número propio, `up` («arriba»): vale 1 si la lectura salió bien y 0 si no. Con push, un servicio muerto simplemente se calla, y el silencio se parece mucho a «no pasó nada».

En Alba, Prometheus vive en el [[namespace-k8s|namespace]] `monitoring`, un apartado con nombre dentro del clúster, instalado con kube-prometheus-stack, un paquete que trae, entre otras piezas, Prometheus, el Prometheus Operator (un programa que lo configura a partir de objetos de Kubernetes) y Grafana, el programa de los [[dashboard|dashboards]]. Guarda 15 días; lo que se quiera para siempre se guarda aparte, ya resumido.

### El ServiceMonitor: decirle qué leer

¿Cómo sabe Prometheus qué pods leer? Con un [[servicemonitor|ServiceMonitor]]: un objeto de Kubernetes, inventado por el Prometheus Operator, que dice «lee los pods detrás de este Service, en este puerto, en esta ruta, cada tanto». Alba tiene uno para Triton: el Service `triton-v14`, en su puerto de métricas, el 8002.

El gateway tiene una trampa. Su Rollout tiene dos Services, `gateway-stable` y `gateway-canary`. Durante un [[canary]], la versión nueva atiende una parte chica del tráfico: `gateway-canary` apunta a sus pods y `gateway-stable` a los de la versión vieja. Fuera de un canary, los dos apuntan a los mismos pods. Un ServiceMonitor que eligiera los dos leería cada pod dos veces, y cada suma saldría al doble. Por eso el gateway usa el primo del ServiceMonitor, el **PodMonitor**, que elige los pods por sus etiquetas de pod (las de Kubernetes, no las de una métrica), sin pasar por ningún Service: cada pod se lee una vez, sea estable o canary (puerto `http`, el 8080, ruta `/metrics`, cada 15 s).

:::profundo El PodMonitor del gateway
Así se ve, como **ilustración**:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: gateway
  namespace: monitoring
  labels:
    release: kube-prometheus-stack     # tiene que coincidir con lo que busca Prometheus
spec:
  namespaceSelector:
    matchNames: [classifier]
  selector:
    matchLabels:
      app.kubernetes.io/name: gateway  # los pods del Rollout, estables y canary
  podMetricsEndpoints:
    - port: http                       # el nombre del puerto 8080 del contenedor
      path: /metrics
      interval: 15s
```
:::

Cada uno de estos objetos lleva una etiqueta `release` con la que Prometheus lo encuentra. Si falta el objeto, o si su `release` no es la que Prometheus busca, **nada truena**. Prometheus simplemente no lee ese servicio. Sin el del gateway, las alertas que dependen de él evalúan sobre nada y no disparan. Sin el de Triton, la consulta con que [[keda|KEDA]], el que prende y apaga pods de Triton según su fila, decide cuántos prender regresa vacía; KEDA, por omisión, no da error y la lee como cero, así que Triton se queda en 2 réplicas aunque suba el tráfico. Es una falla silenciosa de libro: se descubre el día que algo se rompe y ninguna alerta suena. Por eso lo primero que se revisa después de un cambio de monitoreo es que `up` exista y valga 1 para cada pod.

### Series de tiempo

Prometheus no guarda «la métrica». Guarda una [[serie-tiempo|serie de tiempo]] por cada combinación distinta de nombre y etiquetas: una lista de pares (hora, valor), uno cada 15 segundos. `classifier_requests_total{status="200", source="mobile", model_version="resnet50-2026-10-01", pod="gateway-…-x2kq4"}` es una serie; con `status="503"`, otra. Prometheus agrega por su cuenta etiquetas como `pod` y `namespace` al leer.

Con un scrape cada 15 s, cada serie junta 86,400 ÷ 15 = 5,760 muestras al día. Por eso el número de series es lo que hay que cuidar, como verás en la sección siguiente.

### PromQL: preguntar

[[promql|PromQL]] es el lenguaje con que se le pregunta a Prometheus. Dos piezas bastan para casi todo: `rate(serie[5m])`, la tasa por segundo de un contador en los últimos 5 minutos (con los reinicios bien contados), y `sum by (etiquetas)`, que suma series y deja separadas solo las etiquetas que nombres. El orden importa: **primero `rate`, después `sum`**. Si se suman primero los contadores de todos los pods, la suma baja de golpe cuando uno solo se reinicia; `rate()` lo leería como un reinicio de todos y contaría la suma entera como requests nuevas: un pico falso enorme.

La primera pregunta de todos los días: ¿qué fracción de las requests falló por culpa de Alba?

:::formula Fracción de errores del servidor
e = frac{r_5}{r_t − r_4}
- r_t: todas las requests por segundo, en req/s
- r_4: las requests con código 4xx por segundo, en req/s. Son culpa de quien llama; el 499 (el cliente se fue) cuenta aquí
- r_5: las requests con código 5xx por segundo, en req/s
- e: la fracción de errores del servidor, sin unidad (0.001 = 0.1 %)
:::

Los 4xx no van arriba porque no son errores de Alba, y se restan de abajo porque tampoco son requests que Alba pudiera atender bien. Si un caller manda mil fotos de 20 MB por segundo, cada una recibe un 413; con los 4xx en el denominador, la fracción de 5xx bajaría sin que nada mejorara. En PromQL, como **ilustración**:

```promql
# fracción de 5xx sobre las requests sin 4xx, en 5 minutos
sum(rate(classifier_requests_total{status=~"5.."}[5m]))
  /
sum(rate(classifier_requests_total{status!~"4.."}[5m]))

# p99 de la latencia por versión del modelo
histogram_quantile(0.99,
  sum by (le, model_version) (rate(classifier_request_latency_seconds_bucket[5m])))
```

`=~"5.."` quiere decir «que empiece con 5 y tenga dos caracteres más»; `!~"4.."`, «que no empiece con 4». La segunda consulta es la del p99 de «Promedios, medianas y percentiles», en «Cómo se calcula y se vigila en la práctica», con un cambio: `sum by (le, model_version)` deja separadas las versiones. En un día normal sale una sola; durante un canary salen dos, y así compara el p99 de cada una el [[analisis-canary|análisis]] de «Rollout seguro», la revisión automática que compara la versión nueva con la vieja antes de darle más tráfico. Por eso la latencia lleva la etiqueta `model_version`.

:::profundo Las métricas de Triton
Las métricas de Triton se leen igual. La espera media en su fila sale de dos contadores, el tiempo total en la fila y las requests atendidas: `rate(nv_inference_queue_duration_us[2m]) / rate(nv_inference_request_success[2m])`, en microsegundos (de ahí el `_us` del nombre). Es la que lee KEDA, con un objetivo de 10 ms (10,000 µs); lo normal es de 1 a 3 ms. La NetworkPolicy de Triton, la regla de red que dice quién puede hablarle a sus pods, deja entrar al puerto 8002 solo desde `monitoring`: el gateway no puede leer las métricas de Triton, Prometheus sí.
:::

## Cardinalidad: qué puede ser etiqueta {Cardinality: what can be a label}

### Cada combinación es una serie

Cada combinación de valores de etiquetas es una serie, y cada serie le cuesta a Prometheus memoria, un lugar en su índice (la lista con que encuentra cada serie) y 5,760 muestras al día. El número de series de una métrica se llama su [[cardinalidad]] (*cardinality*). No es la cardinalidad de un join que cuenta «Datos y etiquetas»: aquí es cuántas series nacen.

Un histograma cuesta más que un contador. Con \(b\) bordes tiene \(b\) buckets, más el de `+Inf`, más `_sum`, `_count` y `_created` (la hora en que nació la serie, que el cliente de Python agrega): \(b + 4\) series por cada combinación de etiquetas. Un contador tiene 2: `_total`, la cuenta, y `_created`.

:::formula Series de una métrica
K = v_1 × v_2 × … × v_j
N_s = (b + 4) × K   text{(histograma)}
N_s = 2 × K   text{(contador)}
- j: cuántas etiquetas tiene la métrica
- v_1 … v_j: cuántos valores distintos toma cada una de esas etiquetas
- K: las combinaciones de etiquetas, sin unidad
- b: cuántos bordes tiene el histograma, sin unidad (no confundir con B, de bytes)
- N_s: las series de esa métrica en un pod
- P: los pods del gateway; en todo el gateway hay \(P\) veces las series de un pod
:::

:::cuenta Las series del gateway en un pod
Contador, \(K\) // `status` 11 valores · `source` 4 · `model_version` 1 por pod | 11 × 4 × 1 | 44
Contador, \(N_s = 2 × K\) | 2 × 44 | 88
Latencia, \(N_s\) // \(b\) = los 11 bordes de la lista de arriba; \(K\) = 4 × 1 | (11 + 4) × 4 | 60
Preproceso, \(N_s\) // \(b\) = 8 bordes, de 0.002 a 0.5 s; \(K\) = 1 | (8 + 4) × 1 | 12
Inferencia, \(N_s\) // \(b\) = 9 bordes, de 0.005 a 0.3 s; \(K\) = 1 | (9 + 4) × 1 | 13
Score top-1, \(N_s\) // \(b\) = 10 bordes, de 0.1 a 1.0 (uno en 0.3); \(K\) = 1 | (10 + 4) × 1 | 14
Bytes de la foto, \(N_s\) // \(b\) = 9 bordes, de 10 KB a 10 MB; \(K\) = 4 por `source` | (9 + 4) × 4 | 52
Un pod, la suma de las seis \(N_s\) | 88 + 60 + 12 + 13 + 14 + 52 | 239
Todo el gateway, \(P\) × 239 // \(P\) = 3 pods en promedio y 12 en el tope | 239 × 3 · 239 × 12 | 717 · 2,868
= 239 series por pod en el peor caso, si aparecen todas las combinaciones (sin las del propio proceso, como su memoria, que el cliente de Python agrega solo). Con 3 pods son 717 y con 12, 2,868, que en el resto de la lección se redondean a ≈ 720 y ≈ 2,900: nada para Prometheus.
:::

`model_version` vale una sola cosa en cada pod, porque cada pod sirve una versión; en el clúster vale dos durante un canary. Los 11 valores de `status` son los códigos que el gateway puede contar: 200, 400, 403, 413, 415, 422, 429, 499, 500, 503 y 504.

### Lo que nunca es etiqueta

Ahora pon el `request_id` como etiqueta de la latencia. Cada request tiene uno distinto, así que cada request crea su propia combinación: \(K\) crece con el tráfico. Con \(b + 4\) = 11 + 4 = 15 series por combinación y 10 M requests al día son 15 × 10 M = **150 millones de series nuevas al día**, cada una con una sola observación. Prometheus guarda en memoria las series recientes, y con esa cuenta termina por quedarse sin ella. Es la trampa más común del monitoreo: una etiqueta sin límite.

La regla: **una etiqueta solo puede tener valores de una lista corta y conocida.** Lo que identifica a una request (su id, el hash de la foto, la publicación) va al log.

### `source`: una lista cerrada

`source` es el caso delicado. Sale del header `X-Client-Source`, que escribe el caller a mano: podría traer cualquier texto, `mobile`, `Mobile`, `ios-17.2`, o una cadena distinta en cada request si un caller tiene un bug. Si la etiqueta copiara el header, cada texto nuevo sería una serie nueva. Por eso el gateway la **reduce** a cuatro valores fijos: `mobile`, `web`, `internal` y, para todo lo demás, `other`. El log, en cambio, guarda lo que llegó tal cual (o `unknown` si faltó), porque ahí no cuesta series y sirve para encontrar al caller del bug.

`source` sirve para partir las métricas, y para nada más: como lo escribe el caller, nunca decide permisos ni cuotas. Eso lo decide el `client_id` del token verificado.

:::profundo La cuenta de las series en Python
```python
# Series de cada métrica del gateway en un pod: (bordes b o None si es contador, valores de cada etiqueta)
metricas = {
    "classifier_requests_total":          (None, [11, 4, 1]),  # status, source, model_version
    "classifier_request_latency_seconds": (11,   [4, 1]),      # source, model_version
    "classifier_preprocess_seconds":      (8,    [1]),
    "classifier_inference_seconds":       (9,    [1]),
    "classifier_top1_score":              (10,   [1]),
    "classifier_image_bytes":             (9,    [4]),         # source
}
total = 0
for nombre, (b, valores) in metricas.items():
    K = 1
    for v in valores:
        K *= v                                  # combinaciones de etiquetas
    N_s = 2 * K if b is None else (b + 4) * K   # contador: _total y _created
    total += N_s
    print(f"{nombre:36} K={K:3}  series={N_s:4}")
print(f"un pod: {total}   3 pods: {3 * total}   12 pods: {12 * total:,}")
print(f"con request_id en la latencia: {(11 + 4) * 10_000_000:,} series nuevas al día")
```

```salida
classifier_requests_total            K= 44  series=  88
classifier_request_latency_seconds   K=  4  series=  60
classifier_preprocess_seconds        K=  1  series=  12
classifier_inference_seconds         K=  1  series=  13
classifier_top1_score                K=  1  series=  14
classifier_image_bytes               K=  4  series=  52
un pod: 239   3 pods: 717   12 pods: 2,868
con request_id en la latencia: 150,000,000 series nuevas al día
```
:::

:::calculadora e11-request-cardinalidad
Empieza con las métricas de Alba en 3 pods. Pon 3 en la etiqueta extra, como si la latencia llevara `caller`: crece, pero acotada. Luego escribe 10,000,000, un valor por request: eso es el `request_id`.
:::

## Lo que el gateway no ve: el ALB y los puntos ciegos {What the gateway can't see: the ALB and blind spots} [extra]

Las métricas del gateway cuentan las requests que llegan a su código. Algunas no llegan.

**El 405.** Si alguien pide `GET /v1/classify` en vez de `POST`, FastAPI, la biblioteca con que está hecho el gateway, contesta 405 antes de que corra el código de `classify`. No hay línea de log ni suma en `classifier_requests_total`. Y [[uvicorn]], el servidor que corre el código del gateway, arranca con `--no-access-log` (sin su propio registro de accesos), así que tampoco anota nada por su cuenta. El 405 queda contado en un solo lugar: el ALB.

**El 503 del ALB.** El ALB manda tráfico solo a los pods que pasan su revisión de salud. Si **todos** los pods del gateway fallan su probe de [[readiness]], la revisión que pregunta si el pod está listo para recibir tráfico (por ejemplo, porque Triton está caído y el gateway se declara no listo), salen todos del grupo de destinos del ALB (*target group*, la lista de pods entre los que reparte), y el ALB contesta **503 él mismo**. Esas requests nunca tocan un pod. `classifier_requests_total` no sube; la fracción de 5xx del gateway ni se puede calcular (0 ÷ 0: no hay requests); y la alerta de errores, que mira esa fracción, no ve nada. El peor momento del servicio se ve, en las métricas del gateway, como un rato tranquilo.

¿Quién lo ve? [[cloudwatch|CloudWatch]], el servicio de AWS que guarda las métricas de sus propios productos. El ALB publica ahí, entre otras:

| Métrica de CloudWatch | Qué cuenta |
|---|---|
| `RequestCount` | Las requests para las que el ALB pudo elegir un destino; las que rechaza antes, como el 503 sin destinos, no entran |
| `TargetResponseTime` | El reloj del ALB, de la sección del viaje |
| `HTTPCode_Target_4XX_Count` y `HTTPCode_Target_5XX_Count` | Los códigos que contestaron los pods, el 405 incluido |
| `HTTPCode_ELB_5XX_Count` | Los 5xx que puso el propio ALB, como el 503 sin destinos sanos |

Alba tiene una alarma en CloudWatch, `ALB5xx`: si en 5 minutos los 5xx del propio ALB pasan de 0.5 % de las requests, despierta a la persona de guardia. El total suma `RequestCount` más esos 5xx, porque `RequestCount` no cuenta las que no llegaron a un destino. Las dos fuentes se complementan. El gateway sabe más de cada request (el tramo, la versión, el score); el ALB ve lo que pasa antes del gateway. Comparar `RequestCount` del ALB con la suma de `classifier_requests_total` también sirve: si difieren mucho, algo se pierde entre los dos.

El 401 (sin token válido) y el 400 por headers de más de 64 KB también los pone el ALB. Esos no son culpa de Alba, pero conviene verlos: un caller con el token caducado se nota aquí primero.

:::ojo
Antes de confiar en una alerta, pregunta qué requests **no** cuenta. Una tasa de errores calculada solo con las requests que llegaron al código ve todo menos el caso en que no llega ninguna.
:::

## Trazas y exemplars: del p99 a una request {Traces and exemplars: from the p99 to one request} [extra]

### Spans

El log de Ana dice que Triton tardó 10 ms. No dice cuánto de eso fue red y cuánto fila, ni qué pasó dentro de Triton. Una traza sí. Una traza se arma con [[span|spans]]: un span es un tramo con nombre, una hora de inicio, una duración y el span que lo contiene. En Alba, el gateway abre un span por la request completa y, dentro de él, uno por el preproceso y otro por la llamada a Triton; Triton abre los suyos: uno por el modelo, que marca cuándo la request entró a su fila, y dentro otro por el cálculo. Juntos se dibujan como barras una debajo de otra, y se ve de un golpe qué tramo creció.

Para que los spans de dos programas queden en la misma traza, el gateway le pasa a Triton un id de traza en un header de la llamada. Alba instrumenta con [[opentelemetry|OpenTelemetry]] (OTel), un estándar abierto con bibliotecas para casi todos los lenguajes, que define cómo se arman y se pasan los spans, y que también sirve para métricas y logs. Las trazas se guardan en Grafana Tempo, un almacén de trazas de la misma familia que Grafana, en `monitoring`. El `request_id` va como atributo de la traza (un dato con nombre pegado a ella): con él se pasa de la traza al log y de vuelta.

### Por qué solo el 1 %

Una traza pesa varias veces lo que una línea de log y casi todas son aburridas: 20 ms, todo bien. Alba guarda ≈ 1 %: 10 M × 0.01 = 100 mil trazas al día. Quién entra lo decide el gateway con el hash del `request_id`, como el [[shadow]] de «Rollout seguro» (la copia del tráfico que recibía la versión nueva sin que se usara su respuesta): la misma request siempre cae del mismo lado. Triton no decide por su cuenta: arranca con su muestreo propio apagado (`--trace-config rate=0`) y traza justo las requests que le llegan con un id de traza, y el gateway solo se lo pasa a las que eligió. Así la traza sale completa o no sale: una traza a la que le falta la mitad no sirve.

```python
import hashlib, random

def se_traza(request_id, m=0.01):
    h = int(hashlib.sha256(request_id.encode()).hexdigest()[:8], 16)
    return h < m * 2**32               # los primeros 32 bits del hash, como número

random.seed(11)
ids = [f"{random.getrandbits(32):08x}" for _ in range(100_000)]
elegidos = [r for r in ids if se_traza(r)]
print(f"de {len(ids):,} requests se trazan {len(elegidos):,}")
print("la de Ana:", se_traza("5a1e07c3"), "· otra vez:", se_traza("5a1e07c3"))
print("primeras elegidas:", elegidos[:3])
```

```salida
de 100,000 requests se trazan 1,031
la de Ana: False · otra vez: False
primeras elegidas: ['70c6a5b8', '154cd2aa', 'ddd4a054']
```

Salen 1,031 y no exactamente 1,000: es una muestra al azar, y el azar se mueve unas decenas arriba o abajo. La de Ana no entró, y no entrará aunque se pregunte mil veces.

Este muestreo decide al **principio** de la request (*head sampling*), sin saber si será lenta. Tiene un costo: si 0.5 % de las requests pasan de 200 ms, de cada 100,000 solo ≈ 500 son lentas y solo ≈ 5 de ellas tienen traza. Hay muestreo que decide al final (*tail sampling*), guardando todas las lentas y las de error, pero pide juntar los spans de la request completa antes de decidir. Alba empieza con el simple.

:::nota Muestreo no es sampling
En «Modelos de lenguaje», *sampling* es elegir el siguiente token al azar. Aquí «muestreo» es solo quedarse con una parte de las trazas. Mismo nombre en inglés, otra cosa.
:::

### Exemplars

El último eslabón une la métrica con la traza. Un [[exemplar]] es el id de una traza pegado a una observación del histograma: cuando una request trazada suma su latencia a un bucket, el gateway anota junto a ese bucket «una de las que cayeron aquí es la traza tal». Hay dos condiciones: el cliente de Python solo los escribe cuando Prometheus le pide `/metrics` en el formato OpenMetrics, una versión más nueva y estricta del texto de `/metrics`, y Prometheus solo los guarda si se le enciende esa función (`--enable-feature=exemplar-storage`), que viene apagada. Grafana los dibuja como puntos sobre la curva del p99. Marta ve el p99 subir a las 14:05, toca un punto de los lentos y abre la traza de una request que tardó 240 ms: dentro de Triton, el span del modelo dura ≈ 200 ms y el del cálculo solo 4. Casi todo fue fila. Del número agregado a una request concreta en dos clics, sin buscar a ciegas en el log.

## Errores comunes {Common mistakes}

- **Un id como etiqueta de una métrica.** El `request_id`, el hash de la foto o el id de la publicación como etiqueta crean una serie por request: 150 M al día solo en la latencia. *Cómo evitarlo*: cada etiqueta con una lista corta y cerrada de valores (como `source`, reducido a 4); lo que identifica a una request va al log.
- **Un promedio en vez de un histograma.** Un gauge con «la latencia promedio del último minuto» no se puede juntar entre pods ni dice nada del p99. *Cómo evitarlo*: histograma con bordes alrededor del SLO (0.15, 0.2 y 0.3 s) y el percentil calculado al consultar, sumando los buckets de todos los pods.
- **No anotar los timeouts.** Si la inferencia solo se anota cuando Triton contesta a tiempo, las llamadas más lentas desaparecen del histograma y el p99 de inferencia se ve sano justo cuando Triton está trabado. *Cómo evitarlo*: anotar la inferencia también en los 503 y 504, con el tiempo que se esperó.
- **Un log que espera.** Escribir cada línea directo a S3, o a cualquier servicio por la red, desde el código de la request convierte una lentitud de S3 en lentitud para Ana. *Cómo evitarlo*: stdout, y que otro programa (Fluent Bit) suba con su buffer; si se pierde rastro, que avise `LogsStale`.
- **Dividir los 5xx entre todas las requests.** Con los 4xx en el denominador, un caller que manda basura baja la tasa de errores. *Cómo evitarlo*: \(e = r_5 ÷ (r_t − r_4)\), con el 499 entre los 4xx.
- **Sumar y luego sacar la tasa.** `rate(sum(…))` mezcla el reinicio de un pod con los demás: la suma baja, se lee como un reinicio de todos y sale un pico falso. *Cómo evitarlo*: siempre `sum(rate(…))`: primero la tasa de cada serie, luego la suma.
- **Monitoreo que falla en silencio.** Un ServiceMonitor (o PodMonitor) que falta, una etiqueta `release` equivocada o una métrica renombrada no truenan: solo apagan las alertas. *Cómo evitarlo*: revisar que `up` valga 1 para cada pod después de cada cambio, y no renombrar métricas sin cambiar sus alertas en el mismo cambio.

## En la vida real {In real life} [extra]

**En Alba**, los tres rastros de cada request alimentan tres cosas distintas. Las métricas, a la guardia: el p99, la tasa de 5xx y la fila de Triton, con alertas que despiertan a alguien. El log, al equipo de ML: el job diario lo pasa a Parquet, mide el PSI de las categorías y la aceptación, y cada mes de ahí salen las fotos para etiquetar. Las trazas, a quien investiga un caso lento.

**Video en tiempo real.** Un sistema que vigila cámaras no guarda una línea por cuadro, que serían decenas por segundo por cámara: guarda una por evento, como «persona detectada en la zona 2». Y su métrica más importante no la manda la cámara: una cámara muerta no manda nada, así que la nube lleva la hora del último latido (*heartbeat*, un mensaje corto cada tanto que dice «sigo viva») de cada una y avisa si se queda vieja. Es el mismo problema del `up` y de `LogsStale`: el silencio hay que medirlo.

**Patología digital con cola.** Un sistema que analiza laminillas de tejido no tiene requests HTTP: los trabajos llegan por una [[cola-mensajes|cola de mensajes]]. Su latencia no es la de una request sino la **edad del mensaje más viejo** en la cola, un gauge. Su log lleva una fila por laminilla, con `model_version` y el [[digest-imagen|digest]] (la huella única) de la imagen de contenedor que la procesó, es decir, la versión exacta del programa, por la misma razón que el de Alba: poder decir después qué versión contestó qué.

**Un LLM propio.** Un servicio que genera texto mide cosas que una clasificación no tiene: tokens de entrada y de salida, y el [[ttft|tiempo hasta el primer token]] (*time to first token*), que es lo que la persona siente como espera. Su log por request lleva esos números; el texto completo, si se guarda, va muestreado y con cuidado, porque ahí la gente escribe datos personales.

**Cualquier aplicación web.** Una tienda, un banco o una app de mensajes usan el mismo trío, unido por un id que viaja en un header.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(t_{sub}\), \(t_{pre}\), \(t_{tr}\), \(t_{post}\), \(t_{gw}\), \(t_{red}\), \(t_{alb}\), \(t_{ent}\), \(t_{bk}\) (relojes); \(R_d\), \(w_l\), \(V_d\), \(D\), \(A\), \(u\), \(C\), \(G\), \(N_n\), \(L\) (log); \(c_i\), \(n\), \(δ_i\), \(Δt\), \(r\) (tasa); \(r_t\), \(r_4\), \(r_5\), \(e\) (errores); \(b\), \(j\), \(v_1 … v_j\), \(K\), \(N_s\), \(P\) (series; en la calculadora, \(v_x\) es una etiqueta extra).

:::ejercicios
? [facil] Una línea del gateway trae `"ms": {"pre": 9, "triton": 31, "post": 1, "total": 44}`. ¿Cuánto fue la subida, \(t_{sub}\)? Si la T4 tardó 4 ms y la red 4 ms (ida y vuelta), ¿cuánto esperó la foto en la fila de Triton? ¿Es normal?
- \(t_{sub} = t_{gw} − (t_{pre} + t_{tr} + t_{post})\) = 44 − (9 + 31 + 1) = 44 − 41 = **3 ms**.
- Fila = \(t_{tr}\) − T4 − red = 31 − 4 − 4 = **23 ms**.
- No es normal: en un día normal la fila de Alba espera de 1 a 3 ms, y arriba de 10 ms, el objetivo con que KEDA prende más Triton, ya es saturación. Pasa incluso de 20 ms, el umbral con que una alerta de la última estación avisa que la fila creció. Hay que mirar si KEDA ya llegó a su tope de 4 pods de Triton: si llegó, falta GPU.
? [facil] El contador de 200 de un pod se lee en 2,000, 2,450, 2,900, 3,350 y 3,800, cada 15 s. ¿Cuál es la tasa, \(r\)? ¿Y si la cuarta lectura fuera 90 y la quinta 540?
- \(r = (δ_2 + δ_3 + δ_4 + δ_5) ÷ Δt\), con \(Δt\) = 4 × 15 = 60 s.
- Sin reinicio: \(δ_i\) = 450 cada vez; suma 4 × 450 = 1,800; \(r\) = 1,800 ÷ 60 = **30 por segundo**.
- Con reinicio: \(δ_2\) = 450, \(δ_3\) = 450, \(δ_4\) = 90 (bajó: cuenta \(c_4\)), \(δ_5\) = 540 − 90 = 450. Suma 1,440; \(r\) = 1,440 ÷ 60 = **24 por segundo**. Se perdieron las que contó el proceso viejo antes de caerse.
? [medio] En el pico, \(r_t\) = 350 req/s, \(r_4\) = 7 y \(r_5\) = 1.05. Calcula \(e\). Ahora un caller con un bug manda 150 req/s extra de fotos de 20 MB, todas con 413. ¿Cuánto vale \(e\) bien calculada? ¿Y si se divide entre todas las requests?
- \(e = r_5 ÷ (r_t − r_4)\) = 1.05 ÷ (350 − 7) = 1.05 ÷ 343 ≈ **0.31 %**.
- Con el bug: \(r_t\) = 500, \(r_4\) = 157. \(e\) = 1.05 ÷ (500 − 157) = 1.05 ÷ 343 ≈ **0.31 %**: no cambia, como debe ser.
- Dividiendo entre todas: 1.05 ÷ 500 = **0.21 %**. Parece que Alba mejoró justo cuando un caller está roto.
? [medio] S3 deja de contestar a las 20:00, en la hora pico, que lleva 1/8 del tráfico del día. ¿Cuántas horas aguanta el buffer de 1 GB de un nodo del gateway si el pico durara? ¿Llega `LogsStale` a tiempo?
- \(L = G ÷\) (lo que escribe un nodo en una hora de pico) \(= G ÷ (V_d ÷ 8 ÷ N_n)\).
- En la hora pico se escribe \(V_d\) ÷ 8 = 3 ÷ 8 = 0.375 GB en una hora, entre \(N_n\) = 2 nodos: 0.1875 GB por hora en cada uno.
- \(L\) = \(G\) ÷ 0.1875 = 1 ÷ 0.1875 ≈ **5.3 h** si todo el rato fuera de pico (en la práctica, más, porque el tráfico baja después).
- `LogsStale` avisa a los 30 min: quedan casi 5 horas para arreglarlo antes de perder líneas.
? [reto] En 5 minutos llegan 10,000 requests a un Triton trabado: 150 llegan al timeout de 150 ms (504) y el resto tarda menos de 50 ms. Si el gateway **no** anota la inferencia de los 504, ¿dónde cae el p99 de inferencia? ¿Y si sí la anota?
- El p99 es la observación en la posición 0.99 × (cuántas hay), contando desde la más rápida (el rango de «Promedios, medianas y percentiles»).
- Sin anotarlos: el histograma tiene 9,850 observaciones, todas debajo de 0.05 s. El rango del p99 es 0.99 × 9,850 = 9,751.5: cae debajo de 50 ms. **El p99 se ve sano.**
- Anotándolos: 10,000 observaciones; el rango es 0.99 × 10,000 = 9,900. Las primeras 9,850 están debajo de 50 ms, así que la 9,900 es una de las 150 de ≈ 150 ms. **El p99 sale ≈ 150 ms**: se ve el problema.
- Las 150 requests del timeout son el 1.5 % más lento; justo el que un p99 mira.
? [reto] Triton se cae y los 3 pods del gateway fallan su readiness durante 4 minutos, a 116 req/s. Sin ningún pod listo, el ALB contesta 503 él mismo y esas requests no llegan al gateway; la alarma `ALB5xx` de CloudWatch vigila los 5xx que pone el propio ALB. ¿Cuántas requests contesta el ALB con 503? ¿Qué fracción se gasta del presupuesto de errores del mes, las 300,000 requests (0.1 % de ≈ 300 M) que la meta de 99.9 % sin error deja fallar? ¿Qué ve la fracción de 5xx del gateway, y qué alerta suena?
- Requests = tasa × tiempo = 116 req/s × (4 × 60 s) = 116 × 240 = **27,840**, todas con 503 del ALB.
- Del presupuesto: 27,840 ÷ 300,000 ≈ **9.3 %** en 4 minutos.
- El gateway no recibe ninguna: `classifier_requests_total` no sube y su fracción de 5xx no se puede ni calcular (0 ÷ 0). Suena `ALB5xx` en CloudWatch: `HTTPCode_ELB_5XX_Count` sube a ≈ 116 por segundo, casi el 100 % de las requests, muy arriba del 0.5 % (`RequestCount` ni las cuenta: no había destino que elegir).
:::

:::profundo Cinco ejercicios más, para la segunda pasada
:::ejercicios
? [facil] Prometheus lee las 717 series del gateway con 3 pods cada 15 s. ¿Cuántas muestras guarda al día? ¿Y en sus 15 días de retención?
- Muestras por serie al día: 86,400 ÷ 15 = 5,760.
- Al día: 717 × 5,760 = **4,129,920** ≈ 4.1 millones.
- En 15 días: 4,129,920 × 15 ≈ **62 millones**.
? [facil] Di si cada dato va al log, a una etiqueta de una métrica o a los dos: `request_id`, `model_version`, `status`, `sha256`, `source`.
- `request_id` y `sha256`: **solo al log**; uno distinto por request.
- `model_version` y `status`: **a los dos**; pocos valores (1 o 2 versiones, 11 códigos).
- `source`: **a los dos**, distinto: el log guarda el texto que llegó; la etiqueta, uno de 4 valores fijos.
? [medio] La línea crece a 450 B porque alguien pone nombres de campo largos. Calcula \(V_d\), \(A\) y \(C\). ¿Cuánto cambia el costo?
- \(V_d = R_d × w_l\) = 10 M × 450 B = 4.5 GB al día.
- \(A = V_d × D\) = 4.5 × 90 = 405 GB.
- \(C = A × u\) = 405 × 0.023 ≈ **US$9.3 al mes**, ≈ US$3 más. El costo no es la razón para cuidar la línea; sí lo es que cada campo que entra es un contrato con quien la lee.
? [medio] Alguien agrega la etiqueta `caller` (3 valores) a la latencia. ¿Cuántas series tiene ahora esa métrica por pod? ¿Cuántas en total por pod y con 12 pods? ¿Es una mala idea?
- Latencia: \(K\) = 4 × 1 × 3 = 12; \(N_s = (b + 4) × K\) = 15 × 12 = **180**, antes 60.
- Por pod: 239 − 60 + 180 = **359**; con 12 pods, 359 × 12 = **4,308**.
- No es mala idea: crece, pero con un techo conocido. Lo malo es una etiqueta sin techo.
? [reto] En la hora pico, 0.5 % de las requests pasa de 200 ms. Con trazas al 1 % decidido al principio, ¿cuántas requests lentas tienen traza en esa hora? ¿Y si se guardaran todas las lentas además del 1 %?
- Requests en la hora: 350 × 3,600 = 1,260,000; lentas: 1,260,000 × 0.005 = 6,300.
- Con traza al 1 %: 6,300 × 0.01 = **63**. Alcanzan para ver un patrón, pero el muestreo eligió a ciegas.
- Guardando todas las lentas: 6,300 lentas + 1 % del resto (1,253,700 × 0.01 ≈ 12,537) ≈ **18,800** trazas en la hora, contra 12,600 del 1 % solo. Cuesta ≈ 50 % más y da 100 veces más trazas lentas, pero pide juntar cada request completa antes de decidir.
:::
:::

## Lo que sigue {What comes next}

- «Monitoreo, drift y reentrenamiento» toma estos rastros y los vigila: alertas sobre `classifier_requests_total` y la latencia, el burn rate del presupuesto de errores, la baja confianza desde el bucket 0.3 del score, el PSI diario desde el Parquet, la aceptación uniendo por `request_id`, y la decisión de reentrenar que cierra el ciclo y vuelve a la estación 1, «Datos y etiquetas».

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
observabilidad metrica serie-tiempo prometheus scrape servicemonitor contador-prometheus gauge-prometheus histograma-prometheus promql etiqueta-metrica cardinalidad pipeline-logs fluent-bit daemonset traza-distribuida span opentelemetry exemplar cloudwatch latencia-lado-servidor
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué pregunta contesta cada rastro: métricas, logs y trazas?
Métricas: ¿cuánto y desde cuándo? Logs: ¿qué pasó con esta request? Trazas: ¿dónde se fue el tiempo de esta request?
? ¿Por qué el `request_id` nunca es etiqueta de una métrica?
Porque cada request tiene uno distinto y cada combinación de etiquetas es una serie: serían 150 millones de series nuevas al día solo en la latencia.
? ¿Qué pasa con la request de Ana si S3 deja de contestar?
Nada: recibe su respuesta. El gateway escribe en stdout y sigue; Fluent Bit guarda en su buffer hasta ≈ 1 GB por nodo y `LogsStale` avisa a los 30 minutos.
? ¿Por qué Prometheus jala las métricas en vez de recibirlas?
Porque así un pod que no contesta se nota: su serie `up` baja a 0. Con push, un servicio muerto solo se calla.
? ¿Por qué la tasa de errores no lleva los 4xx en el denominador?
Porque no son culpa de Alba: un caller que manda basura bajaría la tasa sin que nada mejorara.
? ¿Qué ve el gateway cuando el ALB contesta 503 porque ningún pod está listo?
Nada: esas requests no llegan a su código. Lo ve CloudWatch con `HTTPCode_ELB_5XX_Count` y la alarma `ALB5xx`.
:::
