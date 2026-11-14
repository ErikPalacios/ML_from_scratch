---
titulo: Object storage, data lakes y warehouses
en: Object storage, data lakes and warehouses
subtitulo: Dónde viven las fotos, los datasets, los pesos y los logs de un sistema de ML, cuánto cuesta guardarlos un año y cómo los encuentra después un analista o un job de entrenamiento.
pregunta: Alba, un marketplace, guarda millones de fotos, el dataset para reentrenar, los pesos del modelo y un log de cada predicción. ¿Dónde va cada cosa, cuánto cuesta guardarla un año y cómo la encuentra después quien la necesita?
requisitos: formatos, bases-de-datos
---

:::idea
Casi todo lo que guarda un sistema de ML termina como objetos en un *object storage*: bytes con una llave, baratos y casi imposibles de perder. Encima se organizan el data lake (archivos por fecha), el warehouse (SQL para analizar) y el lakehouse (tablas con versiones). Lo que cuesta no es solo cuántos GB guardas: también cuántas requests haces y cuánto tiempo decides conservarlo.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día, con ≈ 3 fotos cada una, y a quien vende le sugiere la categoría de cada foto, entre 500 posibles. Su servicio de clasificación, el clasificador, responde ≈ 10 millones de fotos al día: 2.5 M × 3 = 7.5 millones de las publicaciones, más ≈ 2.5 millones que le piden otros equipos, de ≈ 200 KB cada una: 10 M × 200 KB = 2 TB al día. Cada mes se reentrena con un [[dataset]] nuevo. Cada versión del modelo deja un archivo de pesos de ≈ 98 MB. Y cada predicción deja una línea de **log** (*log*: el registro de lo que pasó, como qué foto llegó, qué categoría salió y a qué hora) de ≈ 300 bytes: 10 M × 300 B = 3 GB al día.

Son cuatro cosas muy distintas. Unas son enormes y se leen poco; otras son chiquitas y se escriben millones de veces. Unas tienen que durar años; otras conviene borrarlas a los 90 días, porque traen datos de personas.

En la lección de formatos viste cómo se escribe cada archivo por dentro ([[json-lines]], [[parquet]]). En la de bases de datos, cómo se guardan filas que cambian. Aquí vas a ver **dónde** se guardan los archivos cuando son millones, quién puede entrar, qué pasa si se rompe un disco, cuánto cuesta y cómo se organizan para que un analista o un *job* de entrenamiento (un programa que arranca, hace su tarea y termina) lea un día sin tener que leer el año.

## Object storage: objetos, llaves y buckets {Object storage: objects, keys and buckets}

El disco de tu computadora guarda archivos en carpetas, con un [[sistema-archivos]]. Funciona muy bien para una máquina. Para 3,650 millones de fotos al año, que leen cientos de máquinas a la vez, se usa otra cosa: un **[[object-storage|object storage]]** (almacenamiento de objetos).

Los más conocidos son de la nube, las computadoras que se rentan por hora o por GB: **S3** (*Simple Storage Service*) de AWS, la nube de Amazon; **Cloud Storage** (GCS) de Google, y **Blob Storage** de Microsoft Azure. También hay versiones que una empresa instala en sus propias máquinas, como MinIO o Ceph.

### Un objeto: bytes, llave y metadatos

Un **objeto** tiene tres partes:

- **Los bytes**: el contenido, sea un JPEG, un Parquet o un archivo de pesos. A S3 le da igual qué son.
- **La llave** (*key*): el nombre con el que lo guardas y lo pides, como `fotos/2026/11/06/ana-tenis.jpg`.
- **Los metadatos** (*metadata*): datos sobre el objeto, como su tamaño, su tipo (`image/jpeg`), la fecha en que se guardó y una huella de su contenido.

No hay que instalar nada para usarlo: se le habla por [[http|HTTP]], con los [[metodo-http|métodos]] que ya conoces. `PUT` guarda un objeto, `GET` lo lee, `DELETE` lo borra y `HEAD` lee solo sus metadatos. Además hay `LIST`, que lista llaves. Cada una de esas operaciones es una [[request]], y se cobra aparte de los GB guardados.

### Se reemplaza entero

Un objeto **no se edita a la mitad**. Para cambiar un byte de una foto, la bajas completa, la cambias y la vuelves a subir: un `PUT` a la misma llave reemplaza al objeto viejo entero. Tampoco se le agregan líneas al final, como a un log en tu disco. Sí se puede leer solo un pedazo, con el [[header]] `Range` de un `GET` («dame del byte 1,000 al 5,000»): así un lector de Parquet lee solo las columnas que necesita.

¿Por qué tan limitado? Porque esa sencillez es lo que lo deja crecer sin tope. Si nadie edita a la mitad, no hay que coordinar a dos máquinas que escriben el mismo archivo. Cada objeto es independiente, y S3 puede repartir billones de ellos entre miles de discos. A cambio, tú organizas tus datos en objetos que se escriben una vez y se leen muchas.

Si dos programas hacen `PUT` a la misma llave casi al mismo tiempo, no se mezclan: gana el último, entero, y el otro se pierde sin aviso. Si no quieres que nadie pise una llave, desde agosto de 2024 S3 acepta escrituras condicionales: con el header `If-None-Match: *` («solo si no hay nada con esa llave»), el `PUT` falla con el [[codigo-estado|código]] 412 si la llave ya existe. Y un `GET` justo después de un `PUT` ya ve el objeto nuevo: S3 lo garantiza desde diciembre de 2020. Antes, al reemplazar un objeto, un `GET` podía devolver el viejo durante un rato, la [[consistencia-eventual|consistencia eventual]] de la lección de bases de datos.

:::profundo Objetos grandes: la subida en partes
Un solo `PUT` sube hasta 5 GB. Para algo más grande, como un [[checkpoint]] de un [[llm|LLM]] (los pesos guardados a mitad del entrenamiento), se usa la **subida en partes** (*multipart upload*): el archivo se corta en pedazos, por ejemplo de 100 MB, que suben en paralelo y se reintentan uno por uno si falla la red. Al final, una request le dice a S3 «junta las partes», y el objeto aparece completo de golpe. Antes de eso, nadie lo ve a medias. Se aceptan hasta 10,000 partes, y así un objeto llega a 50 TB (desde diciembre de 2025; antes, el tope era 5 TB).
:::

### El bucket

Los objetos viven dentro de un **bucket**. Ojo: en la lección de percentiles, un [[bucket]] era el intervalo de un histograma. Aquí es otra cosa, y en el glosario se llama [[bucket-objetos|bucket de objetos]]: el contenedor donde guardas objetos.

En S3, cada bucket tiene, por omisión, un nombre único en el mundo: si alguien ya usó `ml-datos`, tú no puedes (desde marzo de 2026 también se puede crear con un sufijo que lleva tu número de cuenta y la región, y ese nombre es solo tuyo). El bucket vive en una [[region|región]], un grupo de centros de datos en un lugar, como el norte de Virginia, y lleva sus reglas: quién puede leer y escribir (su *bucket policy*), cuánto dura cada cosa y si guarda versiones viejas.

La dirección completa de un objeto junta las dos cosas: en `s3://ml-datos/logs/dt=2026-11-06/part-0001.parquet`, el bucket es `ml-datos` y la llave es todo lo que sigue.

### Las carpetas no existen

La llave es solo un texto, de hasta 1,024 bytes, y puede llevar «/». La consola de S3 te enseña «carpetas», pero dentro hay una lista plana de llaves, ordenada. Lo que parece una carpeta es un **prefijo** (*prefix*): el principio que varias llaves comparten.

:::figura almacenamiento-llaves
Arriba, lo que enseña la consola: carpetas. Abajo, lo que de verdad hay: una lista plana de llaves ordenadas. Pedir «la carpeta del día 6» es un LIST con el prefijo `fotos/2026/11/06/`.
:::

Esto tiene consecuencias. Listar con un prefijo es rápido, porque las llaves están ordenadas, y S3 te las da de 1,000 en 1,000. Pero «renombrar una carpeta» no existe: hay que copiar cada objeto a su llave nueva y borrar el viejo. Con un millón de objetos son dos millones de requests.

:::profundo Cuántas requests aguanta un prefijo
El prefijo también reparte la carga. Según AWS, S3 aguanta al menos 3,500 escrituras y 5,500 lecturas por segundo por prefijo, y escala de a poco: mientras crece, puede responder 503 (*Slow Down*, «más despacio»), y el cliente reintenta. Alba diseña su sistema para un pico de 500 requests por segundo: aunque cada una pidiera una foto, esos 500 `GET` por segundo quedan lejos de ese techo.
:::

El juguete de abajo es un object storage hecho con un diccionario de Python: las llaves son texto y no hay carpetas. Fíjate en cuántas requests cuesta cambiar un byte y mover dos fotos.

```python
from collections import Counter
objetos, requests = {}, Counter()        # un object storage de juguete: llave → bytes

def put(llave, datos):
    requests["PUT"] += 1
    objetos[llave] = bytes(datos)        # si la llave ya existía, lo reemplaza entero
def get(llave):
    requests["GET"] += 1
    return objetos[llave]
def listar(prefijo):
    requests["LIST"] += 1
    return sorted(k for k in objetos if k.startswith(prefijo))

for llave, kb in (("fotos/2026/11/06/ana-tenis.jpg", 200), ("fotos/2026/11/06/beto-bici.jpg", 150),
                  ("fotos/2026/11/07/caro-lampara.jpg", 180)):
    put(llave, b"\xff" * kb * 1000)
print(listar("fotos/2026/11/06/"))

foto = bytearray(get("fotos/2026/11/06/ana-tenis.jpg"))   # para cambiar un byte...
foto[10] = 0
put("fotos/2026/11/06/ana-tenis.jpg", foto)                # ...se sube entera otra vez

for k in listar("fotos/2026/11/06/"):                       # «renombrar la carpeta» del día 6
    put(k.replace("/06/", "/06-revisadas/"), get(k))
    del objetos[k]; requests["DELETE"] += 1
print(listar("fotos/"))
print(dict(requests))
```

```salida
['fotos/2026/11/06/ana-tenis.jpg', 'fotos/2026/11/06/beto-bici.jpg']
['fotos/2026/11/06-revisadas/ana-tenis.jpg', 'fotos/2026/11/06-revisadas/beto-bici.jpg', 'fotos/2026/11/07/caro-lampara.jpg']
{'PUT': 6, 'LIST': 3, 'GET': 3, 'DELETE': 2}
```

Seis PUT para tres fotos guardadas: una para cambiar un byte y dos para «mover» dos fotos. En S3 de verdad, la copia se hace sin bajar los bytes (una request `COPY`), pero se cobra igual que un PUT.

## Bloques y archivos: los otros dos almacenes {Block and file storage: the other two} [extra]

El object storage no es la única manera de guardar en la nube. Hay otras dos, y cada una se parece a algo que ya conoces.

### Almacenamiento de bloques: un disco de red

Un disco, por dentro, es una fila larguísima de **bloques** numerados, pedazos de tamaño fijo. El sistema operativo pone encima su sistema de archivos y decide qué bloques forman cada archivo. Eso es el [[almacenamiento-bloques|almacenamiento de bloques]] (*block storage*): te dan un disco en crudo, y tu máquina lo usa como suyo.

En AWS se llama **EBS** (*Elastic Block Store*). En la lección de memoria lo viste: es un disco que vive en otra parte del centro de datos, se conecta por la red y sobrevive si la máquina se apaga. El más común, **gp3**, da de base 3,000 operaciones por segundo (IOPS) y 125 MiB/s.

Lo bueno: puedes cambiar un byte a la mitad de un archivo, como en tu laptop, con latencias de milisegundos o menos. Por eso ahí van el disco con el que arranca la máquina y las bases de datos. Lo malo: normalmente lo usa **una sola máquina** a la vez, vive en una sola [[zona-disponibilidad|zona de disponibilidad]] (un centro de datos dentro de la región) y pagas los GB que reservas, los uses o no. Si reservas 500 GB y usas 50, pagas 500.

Algunas máquinas traen además un [[ssd|SSD]] conectado directo a ellas (*instance store*; casi siempre NVMe, la conexión más rápida para un SSD), todavía más rápido que EBS porque no pasa por la red. Pero es de esa máquina: si se apaga o se reemplaza, lo que tenía se pierde. Sirve como caché, para los pesos que se bajaron de S3, nunca como único lugar de algo.

### Almacenamiento de archivos: una carpeta compartida

El tercero es una carpeta compartida por la red, que muchas máquinas montan a la vez y ven como un disco suyo. Habla NFS, un protocolo de los años ochenta para compartir archivos. En AWS se llama **EFS** (*Elastic File System*); en Google, Filestore. Tiene carpetas de verdad, renombrar es instantáneo y se puede editar a la mitad. Cuesta bastante más por GB.

| | Bloques (EBS) | Archivos (EFS) | Objetos (S3) |
|---|---|---|---|
| Cómo se ve | Un disco | Una carpeta compartida | Llaves y objetos, por HTTP |
| Quién lo usa a la vez | Una máquina | Muchas | Cualquiera con permiso |
| Editar a la mitad | Sí | Sí | No: se reemplaza entero |
| Latencia típica | Menos de 1 ms a pocos ms | ≈ 1 ms al leer, ≈ 3 ms al escribir | ≈ 100 a 200 ms por request, según AWS |
| Precio aproximado (us-east-1, 2026) | ≈ US$0.08 por GB-mes reservado (gp3) | ≈ US$0.30 por GB-mes (Standard) | ≈ US$0.023 por GB-mes (Standard) |
| En Alba | El disco de cada nodo | — | Fotos, logs, datasets y pesos |

Con 100 GB al mes: ≈ US$8 en EBS, ≈ US$30 en EFS y ≈ US$2.30 en S3. Por eso la regla es sencilla: lo que vive con una máquina va en su disco; lo que se comparte o tiene que durar va al object storage. Un servicio de búsqueda por foto guarda sus vectores ([[embedding|embeddings]]) en un disco gp3 porque los lee el [[page-cache|page cache]] de una sola máquina; un servicio que sirve su propio LLM baja sus pesos de S3 al disco local de cada máquina nueva.

:::ojo
EBS también tiene *snapshots*: una copia del disco, guardada por dentro en S3. Es la misma idea que el [[snapshot]] de datos de la sección 7, una foto fija de un momento, pero de otra cosa: los bloques de un disco, no las filas de una tabla.
:::

## La URL prefirmada: un permiso de un rato, dentro de la dirección {Presigned URLs: a short-lived permission inside the address}

Ana toca «publicar», y la foto de 200 KB tiene que quedar guardada en un bucket del marketplace, para mostrarla en la publicación. Cómo la sube la app de Alba no está fijado: lo que sigue es el diseño más común, como supuesto, porque explica bien la idea. Hay dos caminos malos.

- **Que pase por tu API.** La foto cruza tu [[balanceador]] y tus servidores solo para que ellos la vuelvan a subir a S3. A 500 fotos por segundo, eso son ≈ 100 MB/s de bytes que no necesitabas mover.
- **Darle a la app las credenciales de S3**, la clave secreta que da permiso de entrar al bucket. Cualquiera que abra la app podría sacarlas y leer o borrar todo el bucket. Nunca.

El camino bueno es una **[[url-prefirmada|URL prefirmada]]** (*presigned URL*; en Google se llama *signed URL*, URL firmada).

### Quién firma, qué permite y cuánto dura

Tu servidor sí tiene permiso de escribir en el bucket. Con su clave secreta calcula una **firma**: un número que solo se puede producir con esa clave, y que depende de exactamente qué se permite (la cuenta se llama [[hmac|HMAC]], y la verás en la lección de cifrado). Mete la firma en la dirección, en la query (la parte de la URL después del `?`, en pares `nombre=valor`), y se la da a la app. Firmar es una cuenta local: el servidor no tiene que llamar a AWS.

La URL de una subida trae, entre otras, estas partes:

- El bucket y la llave: `alba-subidas.s3.amazonaws.com` y `/fotos/8f3a.jpg`.
- `X-Amz-Credential`: quién firmó, sin su secreto. Puede ser un usuario o un **rol** (una identidad de AWS con sus permisos, que usa un programa en vez de una persona).
- `X-Amz-Date` y `X-Amz-Expires=900`: cuándo se firmó y cuántos segundos vale.
- `X-Amz-Signature`: la firma.

Cuando llega el `PUT`, S3 recalcula la firma. Si alguien cambió la llave, el método o la hora, no coincide y responde 403. Si coincide, revisa que no haya vencido y que quien firmó **todavía** tenga permiso de hacer eso. Como el permiso viaja en la URL, esa request no lleva header `Authorization`.

Lo que permite una URL prefirmada es **una operación** (un `PUT` o un `GET`) **sobre una llave**, **durante un rato** que elige quien firma: en este ejemplo, 15 minutos, lo mismo que usa el sistema de video con cámaras del final de la lección para subir sus clips. En S3, como mucho 7 días, y menos si se firmó con credenciales temporales (las que caducan solas, como las de un rol), porque vence cuando ellas vencen.

:::profundo Lo que una firma puede amarrar, y lo que no
Quien firma puede amarrar más cosas. En un sistema de video con varias cámaras, como el del final de la lección, la firma también cubre el tipo del archivo (`Content-Type: video/mp4`): si la «caja», la computadora del sitio conectada a las cámaras, manda otro, S3 lo rechaza. Lo que una URL de `PUT` no limita es un tamaño máximo (solo se puede firmar uno exacto); para eso hay otra variante, un formulario firmado (`POST` con una *policy*) que sí pone un máximo de bytes.
:::

:::ejemplo La subida de Ana, en cuatro requests
1. La app manda a la API un `POST` chiquito: «quiero subir una foto JPEG». La API revisa que Ana inició sesión, inventa una llave nueva (`fotos/8f3a.jpg`) y responde con la URL firmada, que vale 15 minutos. Son unos cientos de bytes.
2. La app hace `PUT` de los 200 KB directo a esa URL. S3 revisa la firma y responde 200. La API no vio ni un byte de la foto.
3. La app manda a la API la publicación, con la llave de la foto.
4. Si Ana tarda 20 minutos en el paso 2, la URL ya venció y S3 responde 403: la app pide una nueva y vuelve a empezar.
:::

:::diagrama almacenamiento-subida
La foto de Ana va directo de su app al bucket, con un permiso de 15 minutos que firmó la API. Después, el clasificador de Alba recibe solo la llave y lee la foto con su propio permiso. Esa última parte es una variante para ahorrar: en el diseño base de Alba, el gateway (la puerta de entrada del clasificador) recibe los bytes de la foto, como viste en la lección de HTTP. Usa «Recorrer» para seguir la subida y la clasificación.
:::

Sirve igual para bajar. Así se entregan los trabajos largos, los que no se responden en la misma request: el resultado (un JSON enorme, una máscara, un PDF) se guarda en el bucket, y el cliente lo baja con una URL prefirmada de `GET` que vence en minutos.

:::ojo
Una URL prefirmada es como un boleto: **quien la tenga, entra**. No pregunta quién eres. Si se filtra en un log, en un correo o en un chat, sirve hasta que vence. Y es peor que un boleto: no se rompe al usarla, así que sirve muchas veces mientras no venza. Por eso se firma para una sola llave, con vencimiento corto, y no se escribe completa en los logs.
:::

## Durabilidad y clases de almacenamiento {Durability and storage classes}

Guardaste la foto de Ana. ¿Qué tan seguro es que siga ahí dentro de un año?

### Once nueves

La [[durabilidad]] (*durability*) es la probabilidad de que un objeto que guardaste siga ahí, intacto, después de un año. S3 está diseñado para 99.999999999 % al año: once nueves. Dicho al revés, la probabilidad de perder un objeto dado en un año es 0.000000001 %, es decir, 10⁻¹¹.

Es un número tan chico que conviene traducirlo a objetos. Si guardas \(N\) objetos y cada uno se pierde en un año con probabilidad \(P\), esperas perder \(N × P\) objetos al año: uno cada \(1 ÷ (N × P)\) años.

:::cuenta Cuántos objetos perderías al año con once nueves
Perder un objeto dado en un año, \(P\) // una en cien mil millones | \(P\) = 1 − 0.99999999999 | 10⁻¹¹
Perdidos al año con \(N\) = 10 millones // el ejemplo de AWS | \(N × P\) = 10⁷ × 10⁻¹¹ | 0.0001 al año
Cada cuánto se pierde uno | \(1 ÷ (N × P)\) = 1 ÷ 0.0001 | 1 cada 10,000 años
Perdidos al año con las fotos de un año del marketplace // \(N\) = 10 M al día × 365 = 3.65 × 10⁹ | \(N × P\) = 3.65 × 10⁹ × 10⁻¹¹ | 0.0365 al año
Cada cuánto se pierde una | \(1 ÷ (N × P)\) = 1 ÷ 0.0365 | ≈ 1 cada 27 años
= Con 3,650 millones de fotos, esperarías perder una cada ≈ 27 años por culpa del almacenamiento. Por culpa de un `DELETE` equivocado se pierden muchas más.
:::

¿Cómo se logra? En S3 Standard (y en las demás clases de la tabla de abajo), cada objeto se guarda repartido en muchos discos, en al menos tres zonas de disponibilidad (centros de datos separados por kilómetros) de la región. Cada pedazo lleva una huella para detectar si un bit se dañó. Y cuando un disco muere, el sistema rehace sus pedazos con los demás antes de que muera otro.

:::profundo Por qué tres copias dan tantos nueves
Con números de juguete: un disco pierde sus datos con probabilidad \(f\) = 1 % = 10⁻² al año, y una copia perdida se rehace en un día. Que otro disco muera justo en ese día tiene probabilidad \(f ÷ 365\). Con \(n\) copias, perder el objeto pide que la primera muera en el año y que cada una de las otras \(n − 1\) muera ese mismo día:

:::formula Probabilidad de perder un objeto con n copias
P_n ≈ f × (frac{f}{365})^{n − 1}
- f: la probabilidad de que un disco pierda sus datos en un año (aquí, 10⁻²)
- n: cuántas copias hay, cada una en un disco distinto
- 365: los días del año; una copia perdida se rehace en un día
- P_n: la probabilidad de perder el objeto en un año, la \(P\) de la cuenta de arriba
:::

- **Una copia:** \(P_1 = f\): pierdes 1 de cada 100 objetos al año, 10⁻².
- **Dos copias:** la segunda tiene que morir el mismo día que la primera: \(P_2\) ≈ 10⁻² × (10⁻² ÷ 365) ≈ 2.7 × 10⁻⁷.
- **Tres copias:** además, la tercera, ese mismo día: \(P_3\) ≈ 10⁻² × (10⁻² ÷ 365)² ≈ 7.5 × 10⁻¹².

Ignorando factores de 2 o 3, eso ya son ≈ 11 nueves. Las copias tienen que fallar **por separado**: tres discos en el mismo estante, con la misma fuente de luz, no cuentan como tres (en la lección de probabilidad lo viste como falla correlacionada). S3 no guarda tres copias completas, sino pedazos con información extra (*erasure coding*), que dan la misma protección con menos bytes.
:::

### Durabilidad no es disponibilidad

En la lección de probabilidad viste la [[disponibilidad]] y los [[nueves]]: qué fracción del tiempo un servicio **contesta**. Son cosas distintas:

- **Disponibilidad:** ¿S3 me responde ahora? S3 Standard está diseñado para 99.99 % (≈ 53 minutos al año en que una request puede fallar). En su contrato (el *SLA*), AWS promete menos: 99.9 % cada mes, y si no lo cumple devuelve una parte del cobro.
- **Durabilidad:** ¿mi objeto sigue existiendo? Once nueves.

Un bucket puede no contestar un rato sin perder nada: reintentas y ahí está. Y al revés, con disponibilidad perfecta, un `DELETE` tuyo borra la foto para siempre. La durabilidad te protege del hardware, no de ti. Para lo segundo hay **versionado** del bucket (cada `PUT` o `DELETE` guarda la versión anterior), **Object Lock** (una versión que nadie puede borrar antes de una fecha) y copias en otra cuenta o región.

### Clases de almacenamiento

No todo se lee igual de seguido. La foto de una publicación activa se ve cientos de veces; la de una que se vendió hace un año, casi nunca. Por eso S3 tiene **clases de almacenamiento** ([[clase-almacenamiento|*storage classes*]]): la misma foto, con la misma durabilidad, guardada más barato a cambio de que leerla cueste más o tarde más. Los nombres son de S3: IA quiere decir *Infrequent Access* (acceso poco frecuente), y Glacier (glaciar) es la familia de las clases para archivo.

:::figura almacenamiento-clases
Las clases de S3, de la más cara de guardar a la más barata. La barra es el precio por GB al mes; debajo, lo que cuesta leer y cuánto hay que esperar. Todas tienen la misma durabilidad.
:::

| Clase | Guardar, US$ por GB-mes | Leer | Mínimo que te cobran | Para qué |
|---|---|---|---|---|
| Standard | 0.023 | Al instante, sin cargo por GB | — | Lo que se lee seguido |
| Standard-IA | 0.0125 | Al instante, + US$0.01 por GB | 30 días y 128 KB por objeto | Se lee poco, pero hay que tenerlo a la mano |
| Glacier Instant Retrieval | 0.004 | Al instante, + US$0.03 por GB | 90 días y 128 KB por objeto | Se lee una vez por trimestre |
| Glacier Flexible Retrieval | 0.0036 | De minutos a horas | 90 días | Archivo que casi no se lee |
| Glacier Deep Archive | ≈ 0.001 | Hasta 12 h, o 48 h barato | 180 días | Lo que se guarda por ley |

Son precios de lista de la región del norte de Virginia (`us-east-1`), revisados en noviembre de 2026; cambian por región y con el tiempo. Standard baja un poco con volúmenes muy grandes: US$0.022 pasados los primeros 50 TB y US$0.021 pasados 500 TB.

Fíjate en la columna del mínimo. Si guardas algo en Standard-IA y lo borras a los 10 días, te cobran 30. Un objeto de 10 KB en Standard-IA paga como si pesara 128 KB. En Flexible Retrieval y Deep Archive, cada objeto paga además ≈ 40 KB de metadatos: con millones de objetos chicos, se nota. Y lo que se guarda en Glacier Deep Archive no se puede abrir al momento: primero pides que lo «restauren», y esperas horas. Google tiene la misma escalera con otros nombres: Standard, Nearline (30 días), Coldline (90) y Archive (365).

Elegir clase a mano para millones de objetos es imposible. Para eso existen las reglas de la sección siguiente.

## Ciclo de vida, retención y lo que cuesta {Lifecycle, retention and what it costs}

### Reglas de ciclo de vida

Una **regla de ciclo de vida** ([[ciclo-vida|*lifecycle rule*]]) le dice al bucket qué hacer con los objetos según su edad, sin que ningún programa tuyo lo haga. Tiene dos tipos de acción:

- **Mover** (*transition*): «a los 30 días, pasa a Glacier Instant Retrieval».
- **Borrar** (*expiration*): «a los 365 días, bórralo».

Cada regla aplica a un prefijo (o a los objetos con cierta etiqueta), así que distintas partes del bucket pueden tener reglas distintas. S3 la revisa por su cuenta, más o menos una vez al día. Así se ve una, en el JSON que recibe S3 (ilustración):

```json
{"Rules": [{"ID": "fotos-viejas", "Status": "Enabled", "Filter": {"Prefix": "fotos/"},
            "Transitions": [{"Days": 30, "StorageClass": "GLACIER_IR"}],
            "Expiration": {"Days": 365}}]}
```

### Retención: cuánto guardar y por qué

Antes de escribir la regla hay que decidir la [[retencion|retención]] (*retention*): cuánto tiempo se conserva cada cosa. La deciden tres fuerzas, y casi siempre tiran en direcciones distintas.

- **El costo.** Cada GB se paga cada mes que sigue ahí. Lo que nunca se borra crece sin parar.
- **La ley y la privacidad.** Las fotos y los logs traen datos de personas: caras, placas, ubicaciones en el [[exif|EXIF]] (los datos que la cámara esconde dentro del JPEG). Las leyes de datos personales piden guardar solo lo necesario y borrar cuando alguien lo pide. Cuanto más guardas, más puedes filtrar.
- **El ML.** Para reentrenar, buscar [[drift]] y comparar modelos de meses distintos hace falta historia.

Alba las reparte así: los logs de predicción duran 90 días; las copias de fotos que van a etiquetar, también 90; los agregados diarios (cuántas predicciones por categoría, por ejemplo) se guardan para siempre, porque no traen datos de nadie. El [[golden-set|golden set]] (las fotos fijas, bien etiquetadas, con las que se examina cada modelo) y los snapshots de entrenamiento (la lista exacta de datos con que se entrenó cada modelo, en la sección 7) no caducan: si el golden set se borrara a los 90 días, ya no podrías comparar el modelo de marzo con el de octubre sobre las mismas fotos. Pero cuando alguien pide que borren su foto, se busca por su huella en todos ellos.

:::nota La retención real
Es la del artefacto que más dura. Si el bucket borra a los 90 días pero la foto también está en un snapshot de marzo, en una copia de respaldo en otra región y en un CSV que alguien bajó a su laptop, la foto sigue existiendo. Un dataset no puede ser la puerta trasera de la retención.
:::

### Lo que cuesta: GB-mes y requests

S3 cobra con dos medidores.

- **GB-mes:** guardar 1 GB durante un mes. En Standard, ≈ US$0.023. Guardar 2 GB durante medio mes también es 1 GB-mes.
- **Requests:** en Standard, US$0.005 por cada 1,000 `PUT` (y `COPY` y `LIST`), y US$0.0004 por cada 1,000 `GET`. Los `DELETE` son gratis. Cuando una regla mueve un objeto de clase, eso también es una request (una *transición*): US$0.01 por cada 1,000 objetos hacia Standard-IA, US$0.02 hacia Glacier Instant Retrieval y US$0.05 hacia Deep Archive.

Para pasar de días a meses, las cuentas usan 30.4 días por mes (365 ÷ 12). Juntos, los dos medidores dan la cuenta de todo lo que sigue:

:::formula Lo que cobra S3 al mes
costo = G × c_G + frac{R}{1,000} × c_R
- G: los GB-mes: cuántos GB hay guardados, en promedio, durante el mes
- c_G: el precio por GB-mes de la clase, en US$ (0.023 en Standard)
- R: cuántas requests de un tipo se hacen en el mes; si hay varios tipos (PUT, GET, transiciones), va un término así por cada uno
- c_R: el precio por cada 1,000 requests de ese tipo, en US$ (0.005 los PUT, 0.0004 los GET)
- costo: lo que se paga, en US$ al mes
:::

Una equivalencia para recordar: **un PUT cuesta lo mismo que guardar ≈ 217 KB durante un mes**. Un PUT cuesta \(c_R ÷ 1,000\) = 0.005 ÷ 1,000 = US$0.000005, y eso alcanza para 0.000005 ÷ 0.023 ≈ 0.000217 GB-mes. Con una foto de 200 KB, subirla cuesta como un mes de guardarla. Con un log de 300 bytes, subirlo cuesta como guardarlo 60 años.

Con una regla que mueve cada foto a una clase fría después de unos días y la borra al cumplir la retención, el bucket se llena y cada mes cuesta lo mismo. Las letras \(G\), \(c_G\), \(R\) y \(c_R\) son las de la fórmula de S3; aquí cada una lleva el nombre de su parte:

:::formula Un bucket con ciclo de vida, ya lleno
G_d = F × s
G_S = G_d × D_S
G_F = G_d × (D_R − D_S)
costo = G_S × c_S + G_F × c_F
     + frac{F × 30.4}{1,000} × c_T
- F: fotos que entran al día
- s: el tamaño de cada foto, en GB (200 KB = 0.0002 GB)
- G_d: los GB que entran al día
- D_S: los días que cada foto pasa en Standard antes de moverla
- D_R: la retención: los días hasta borrarla
- G_S, G_F: los GB que hay en Standard y en la clase fría con el bucket lleno
- c_S, c_F: el precio por GB-mes (\(c_G\)) de Standard (US$0.023) y de la clase fría (US$0.004 en Glacier IR)
- c_T: el precio por cada 1,000 fotos que se mueven de clase (el \(c_R\) de las transiciones: US$0.02 hacia Glacier IR); cada mes se mueven las fotos de 30.4 días, \(F × 30.4\)
:::

:::cuenta Un año de fotos del marketplace, con y sin ciclo de vida
GB que entran al día, \(G_d\) // \(F\) = 10 M fotos de \(s\) = 200 KB | \(G_d = F × s\) = 10 M × 200 KB | 2,000 GB = 2 TB
Guardado después de un año, \(G\) // \(D_R\) = 365 días | \(G = G_d × D_R\) = 2 TB × 365 | 730 TB
Todo en Standard, cada mes // ya lleno | \(G × c_S\) = 730,000 GB × 0.023 | ≈ US$16,790
Con ciclo: en Standard, \(G_S\) // los últimos \(D_S\) = 30 días | \(G_S = G_d × D_S\) = 2,000 GB × 30 | 60,000 GB
Guardar en Standard | \(G_S × c_S\) = 60,000 GB × 0.023 | US$1,380
En Glacier IR, \(G_F\) // los 335 días anteriores: \(D_R − D_S\) = 365 − 30 | \(G_F = G_d × (D_R − D_S)\) = 2,000 GB × 335 | 670,000 GB
Guardar en Glacier IR | \(G_F × c_F\) = 670,000 GB × 0.004 | US$2,680
Mover las fotos // una request por foto, \(c_T\) = US$0.02 por 1,000 | \(F × 30.4 ÷ 1,000 × c_T\) = 10 M × 30.4 ÷ 1,000 × 0.02 | US$6,080
Con ciclo, cada mes // Standard + Glacier IR + mover | 1,380 + 2,680 + 6,080 | ≈ US$10,140
= El ciclo de vida ahorra ≈ 40 %, y la línea más cara ya no son los GB: son las 304 millones de transiciones al mes. Con objetos chicos, hasta mover cuesta.
:::

:::profundo El descuento por volumen y los objetos chicos
La cuenta usa US$0.023 para todo. Con el descuento por volumen, «todo en Standard» bajaría a ≈ US$15,900 y el ahorro, a ≈ 36 %: la conclusión no cambia. AWS conoce bien el problema de mover objetos chicos: desde septiembre de 2024, una regla nueva no mueve objetos de menos de 128 KB, a menos que se lo pidas.
:::

Esa cuenta es la del bucket del producto, el del marketplace. El clasificador de Alba no guarda su propia copia de cada foto: la foto ya vive ahí, y el clasificador solo anota su llave. Si la copiara «por si acaso», serían 2 TB × 30 días ≈ 60 TB más cada mes: 60,000 GB × 0.023 ≈ US$1,380 el primer mes, US$2,760 el segundo, y así cada mes más, con datos personales y sin dueño.

:::calculadora almacenamiento-anio
Prueba Deep Archive (precio 0.001, mover 0.05): sale más caro que dejar todo en Standard. Después pon la retención en 90 días: «Todo en Standard» baja de ≈ US$16,790 a ≈ US$4,140, y mover a Glacier ya no conviene. Borrar a tiempo ahorra más que cualquier clase.
:::

Con objetos grandes, el costo son los GB. Con millones de objetos chicos, mandan las requests. El log del clasificador de Alba lo muestra. Si llegan \(r\) registros al día y se juntan de a \(k\) en cada objeto, cada día se suben \(r ÷ k\) objetos, y al mes son \(R = r ÷ k × 30.4\) PUT, uno por objeto. Leer el último mes, objeto por objeto, son otros tantos GET.

:::cuenta El log del clasificador de Alba: un objeto por predicción o un archivo por minuto
GB al día // \(r\) = 10 M predicciones de ≈ 300 B cada una | 10 M × 300 B | 3 GB al día
Guardar 90 días de log, \(G × c_G\) // \(G\) = 3 GB × 90 días = 270 GB | 270 GB × 0.023 | ≈ US$6 al mes
Un objeto por predicción: PUT al mes, \(R\) // \(k\) = 1 | \(R = r ÷ k × 30.4\) = 10 M ÷ 1 × 30.4 | 304 M
Costo de esos PUT // \(c_R\) = US$0.005 por 1,000 | \(R ÷ 1,000 × c_R\) = 304 M ÷ 1,000 × 0.005 | ≈ US$1,520
Leerlo una vez al mes, objeto por objeto // \(R\) = 304 M GET, \(c_R\) = US$0.0004 por 1,000 | \(R ÷ 1,000 × c_R\) = 304 M ÷ 1,000 × 0.0004 | ≈ US$122
Un archivo por minuto: PUT al mes, \(R\) // \(k\) = 10 M ÷ 1,440 minutos ≈ 6,944, así que \(r ÷ k\) = 1,440 archivos al día | \(R = r ÷ k × 30.4\) = 1,440 × 30.4 | 43,776
Costo de esos PUT | \(R ÷ 1,000 × c_R\) = 43,776 ÷ 1,000 × 0.005 | ≈ US$0.22
= Los mismos 3 GB al día cuestan ≈ US$1,650 al mes en objetos sueltos o ≈ US$6 en archivos de un minuto. Por eso el clasificador de Alba solo imprime sus logs, como texto, y otro programa los junta y los sube a S3 en archivos grandes.
:::

:::calculadora almacenamiento-requests
Arranca con un objeto por predicción. Escribe 6944 registros por objeto (un archivo por minuto: 10 M ÷ 1,440 minutos del día) y mira cómo las requests pasan de casi todo a casi nada. Cada archivo de un minuto pesa ≈ 2 MB: ya basta para que las requests casi no cuesten. Para leer rápido conviene juntar todavía más, en archivos de ≈ 100 MB a 1 GB, y eso hace la compactación de la sección siguiente.
:::

## Data lake y particiones por fecha {Data lake and date partitions}

Ya tienes dónde guardar. Ahora falta **organizar**, para que alguien encuentre lo que busca entre millones de archivos.

### Un lago de archivos

Un [[data-lake|data lake]] es un object storage donde llega todo el dato de la empresa como archivos: logs, eventos de la app, etiquetas, copias de tablas. Se guarda tal como llegó y también ya procesado, y lo lee cualquier herramienta: Spark (un programa que reparte el trabajo de leer y transformar datos entre muchas máquinas), DuckDB (una base de datos chiquita para analizar, que corre en tu laptop), Athena (consultas [[sql|SQL]] directo sobre los archivos de S3) o un script de Python.

Se le llama la **fuente de verdad** del [[camino-offline|camino offline]], el que prepara el siguiente modelo sin que nadie espere: todo dataset de entrenamiento y todo recálculo del pasado salen de ahí. Casi siempre se organiza en zonas, cada una con su prefijo:

- **Crudo** (*raw*): tal como llegó, por ejemplo [[json-lines|JSON lines]] del log. No se toca: si un paso posterior tenía un bug, se puede rehacer desde aquí.
- **Procesado** (*processed*): limpio, con tipos correctos, en [[parquet|Parquet]]. Es [[formato-columnar|columnar]] y viene [[compresion|comprimido]]: los 3 GB diarios de log del clasificador de Alba quedan en ≈ 0.3 a 0.6 GB.
- **Curado** (*curated*): tablas listas para usar, como un dataset de entrenamiento o los agregados diarios.

Así se vería el lake de Alba, con un bucket y un prefijo por zona (un ejemplo; cada equipo elige sus nombres):

```text
s3://alba-lake/
  crudo/predicciones/dt=2026-11-06/...        JSON lines, como llegaron
  procesado/predicciones/dt=2026-11-06/...    Parquet, una fila por predicción
  curado/agregados_diarios/dt=2026-11-06/...  conteos por categoría
  curado/datasets/ds-2026-09-01/...           el snapshot de un entrenamiento
```

Un lago no obliga a nada. Cualquiera puede escribir cualquier archivo, y nadie revisa que cumpla el [[esquema-datos|esquema]]: las columnas y sus tipos. El esquema lo descubre quien lee, al leer (*schema on read*). Si el equipo de la app renombró una columna el martes, el job de la noche se entera al fallar, o peor, sin fallar. Por eso los lagos sin reglas se vuelven pantanos, con archivos que nadie sabe qué son. Las capas de la sección siguiente ponen el orden: el warehouse y el lakehouse revisan el esquema al escribir.

### Particionar por fecha

Si todo el log de un año estuviera en un solo prefijo, preguntar «¿cuántas fotos de tenis hubo ayer?» obligaría a leer el año entero. La solución es una [[particion-datos|partición]] (*partition*): dividir la tabla en grupos de archivos según el valor de una columna, casi siempre la fecha, y poner ese valor en la llave:

`logs/predicciones/dt=2026-11-06/part-0000.parquet`

El pedazo `dt=2026-11-06` es una convención (`columna=valor`) que entienden Spark, Athena, DuckDB y los warehouses. `dt` es solo el nombre de la columna, por *date*; en la lección de formatos la viste con el mismo nombre, en las carpetas de los logs. Cuando la consulta dice «solo el 6 de noviembre», el motor lista ese prefijo y no abre nada más. Se llama *partition pruning*: podar las particiones que no sirven.

:::figura almacenamiento-particiones
Un mes de log del clasificador de Alba, una partición por día. La consulta de un día abre 4 archivos; la de una semana, 28; sin particiones, habría que abrir los 120 del mes.
:::

El lake de juguete de abajo tiene un mes de log: 4 archivos Parquet por día, de ≈ 125 MB cada uno. Leer «un día» es listar su prefijo.

```python
import random
random.seed(7)
lake = {}                                  # llave → bytes del archivo: solo importan las llaves
for dia in range(1, 31):                   # noviembre de 2026, 4 archivos Parquet por día
    for parte in range(4):
        llave = f"logs/predicciones/dt=2026-11-{dia:02d}/part-{parte:04d}.parquet"
        lake[llave] = random.randint(100, 150) * 1_000_000

def leer(prefijos):                        # lo que hace un motor de consultas: listar y leer
    llaves = [k for k in lake if any(k.startswith(p) for p in prefijos)]
    return len(llaves), sum(lake[k] for k in llaves)

semana = [f"logs/predicciones/dt=2026-11-{d:02d}/" for d in range(1, 8)]
for nombre, prefijos in (("un día", ["logs/predicciones/dt=2026-11-06/"]),
                         ("una semana", semana), ("el mes entero", ["logs/predicciones/"])):
    n, b = leer(prefijos)
    print(f"{nombre:>13}: {n:>3} archivos · {b / 1e9:5.2f} GB")

particiones = sorted({k.split("/")[2] for k in lake})   # como un LIST con delimitador «/»
print(len(particiones), "particiones:", particiones[0], "…", particiones[-1])
```

```salida
       un día:   4 archivos ·  0.50 GB
   una semana:  28 archivos ·  3.34 GB
el mes entero: 120 archivos · 14.92 GB
30 particiones: dt=2026-11-01 … dt=2026-11-30
```

Leer un día abre 4 de los 120 archivos: un trigésimo del mes. La última línea hace lo que un `LIST` con delimitador «/»: en vez de todas las llaves, S3 devuelve solo los prefijos distintos hasta la siguiente «/», que aquí son las 30 particiones.

Particionar también hace que **cada corrida procese una partición**. El job de cada noche escribe solo `dt=2026-11-06/`. Si tenía un bug, se reescribe esa partición y nada más. Lo contrario, una tabla única que se reescribe entera cada noche, obliga a reprocesar todo para arreglar un día.

Se puede particionar por más de una columna, una dentro de otra. El log de predicciones de Alba va por día y por versión del modelo, `dt=2026-11-06/model_version=resnet50-2026-10-01/`, para que el job que compara la versión nueva con la vieja lea solo las dos que le tocan. La columna que va primero es la que más se filtra.

Tres reglas para que funcione:

- **Partir por lo que se filtra.** La fecha casi siempre, porque casi toda pregunta empieza por «en estos días». Partir por categoría, si nadie filtra por categoría, solo multiplica archivos.
- **Ni muy fino ni muy grueso.** Particionar por hora y además por usuario daría millones de archivos diminutos, y ya viste que los objetos chicos se pagan en requests y en tiempo de listar. Se buscan archivos de ≈ 100 MB a 1 GB. Cuando un [[stream-eventos|stream]] (un flujo de eventos que no para, tema de la lección siguiente) deja muchos archivos chicos, un job de **compactación** los junta cada noche en pocos grandes.
- **¿Qué fecha?** Una predicción de las 23:59 puede llegar al lake a las 00:03. Si la partición usa la hora de llegada, cae en el día siguiente. Para entrenar importa la hora en que pasó, el [[event-time|*event time*]], que verás en la lección de tiempo y hashes.

## Warehouse, lakehouse y snapshots {Warehouses, lakehouses and snapshots}

### Dos maneras de usar datos: OLTP y OLAP

La base de datos del marketplace atiende millones de operaciones chiquitas: guardar una publicación, leer el usuario 42, cambiar un precio. Cada una toca **pocas filas, completas**, y tiene que tardar milisegundos. Eso se llama **OLTP** (*online transaction processing*, procesar transacciones en línea, mientras el usuario espera), y es lo que viste en la lección de bases de datos: [[tabla|tablas]] en una [[base-relacional|base relacional]], con [[transaccion|transacciones]] e [[indice-bd|índices]].

Un analista pregunta otra cosa: «¿cuántas predicciones hubo por categoría en octubre, y cuántas aceptó la gente?». Su consulta toca **millones de filas, pero solo dos o tres columnas**, y puede tardar segundos. Eso es **OLAP** (*online analytical processing*, procesar para analizar).

Son formas tan distintas que piden almacenes distintos. Para OLTP conviene guardar cada fila junta; para OLAP, cada columna junta, como Parquet. La lección de formatos lo explicó: leer dos columnas de treinta en un formato columnar es leer ≈ 2/30 de los bytes (≈ 7 %), y menos con compresión. La [[oltp-olap|diferencia entre OLTP y OLAP]] es la razón de que existan los warehouses.

### Data warehouse

Un [[data-warehouse|data warehouse]] es una base de datos hecha para OLAP: guarda las tablas por columnas, comprimidas, en su propio almacenamiento, y responde [[sql|SQL]] repartiendo cada consulta entre muchas máquinas. Los más usados son **BigQuery** (Google), **Snowflake** y **Redshift** (AWS). Separan el almacenamiento del cálculo: guardas petabytes baratos y rentas máquinas solo mientras corre la consulta.

```sql
SELECT categoria, COUNT(*) AS fotos, AVG(CAST(aceptada AS INT64)) AS tasa_aceptacion
FROM alba.predicciones
WHERE dt BETWEEN '2026-10-01' AND '2026-10-31'
GROUP BY categoria
ORDER BY fotos DESC;
```

Se lee casi en español: de la tabla `alba.predicciones`, toma las filas de octubre (`WHERE`), júntalas por categoría (`GROUP BY`) y, para cada grupo, cuenta las fotos y saca el promedio de `aceptada`, que vale 1 si la persona aceptó la categoría sugerida y 0 si no: ese promedio es la tasa de aceptación. Toca millones de filas, pero solo tres columnas: `categoria`, `aceptada` y `dt`.

BigQuery, en su modo por consulta, cobra por los bytes que lee: US$6.25 por TiB en su precio de lista de 2026, con el primer TiB de cada mes gratis. Ahí las particiones y las columnas se vuelven dinero. Si la consulta leyera el log crudo, como archivos JSON sin particiones, pagaría el año entero: ≈ 1.1 TB, ≈ US$6 por consulta. En Parquet, las tres columnas que usa esa consulta en las particiones de un mes son unos pocos GB: centavos.

¿Lake o warehouse? El lake es barato, guarda cualquier cosa y lo lee cualquier herramienta, pero no tiene transacciones: si un job muere a la mitad de escribir una partición, quien lea en ese momento ve archivos a medias. El warehouse da tablas con transacciones y SQL rápido, pero cuesta más y hay que cargarle los datos. Muchas empresas usan los dos: el lake guarda todo y el warehouse, las tablas que se consultan a diario.

### Lakehouse: tablas encima de los archivos

Un [[lakehouse]] junta lo mejor de los dos: deja los datos como archivos Parquet en el lake y les pone encima un **formato de tabla** que da transacciones. Los tres más usados son **Delta Lake** (de Databricks), **Apache Iceberg** (nació en Netflix) y **Apache Hudi** (nació en Uber).

El truco es un registro aparte, guardado en el mismo bucket, que dice **qué archivos forman la tabla en cada versión**. Escribir es: subir los Parquet nuevos y, al final, agregar al registro una entrada que diga «la versión 3 son estos archivos». Hasta que esa entrada existe, nadie ve los archivos nuevos. Así cada escritura pasa completa o no pasa, y quien lee nunca ve una tabla a medias.

:::figura almacenamiento-versiones
Un lakehouse no copia datos para cada versión: cada versión es una lista de archivos. Borrar filas reescribe un archivo y la versión nueva deja de apuntar al viejo, pero el viejo sigue ahí, y leer la versión 2 sigue funcionando. Eso es el *time travel*.
:::

Con eso se puede:

- Corregir filas sueltas con un [[upsert]] (actualizar la fila si existe, insertarla si no) o borrarlas, algo que con Parquet solo no se puede, porque un objeto no se edita a la mitad. Hace falta, por ejemplo, para borrar los datos de una persona que lo pidió.
- Agregar columnas sin romper a quien lee (la [[evolucion-esquema|evolución del esquema]] de la lección de formatos).
- Leer la tabla como estaba en una versión o una fecha: el **time travel** (viaje en el tiempo).

### Snapshot: una foto fija para repetir un entrenamiento

Un [[snapshot]] es una foto fija de los datos en un momento: lo que había, y que ya no cambia aunque la tabla siga creciendo. En Iceberg, cada escritura crea uno. Para ML es la pieza que hace **repetible** un entrenamiento: el modelo de octubre guarda con qué snapshot se entrenó, y dentro de seis meses alguien puede volver a leer exactamente esas filas.

Alba lo hace sin copiar fotos. Su snapshot es un **manifest**: un archivo Parquet que lista la llave de cada foto, su etiqueta y una huella de su contenido (un [[hash-criptografico|hash]] SHA-256, que cambia si cambia un solo byte). Vive en un prefijo que no se reescribe, como `datasets/ds-2026-09-01/`, y el modelo guarda la huella del propio manifest. Un manifest pesa megabytes, así que puedes tener uno por mes durante años.

:::profundo El time travel no es para siempre
En Delta Lake, por omisión, el historial dura 30 días y la limpieza (`VACUUM`) puede borrar los archivos viejos pasados 7; en Iceberg, la limpieza de snapshots (`expire_snapshots`) borra por omisión los de más de 5 días. Ninguna de las dos borra sola: corren cuando alguien las programa, y se programan para no pagar archivos viejos para siempre. Un snapshot que tiene que durar (el de un modelo en producción) se marca aparte, con su propia retención.
:::

Llevar la cuenta de qué snapshot, qué código y qué contenedor produjeron cada modelo es el [[versionado-datos|versionado de datos]] y el [[linaje]]: los verás a fondo en la lección «Versionado y linaje», con DVC y lakeFS.

## Feature store y backfill {Feature stores and backfills} [extra]

### El mismo número en dos lugares

Un modelo de detección de fraude en tiempo real usa [[feature|features]] como «cuántas compras hizo esta tarjeta en las últimas 24 horas». Ese número se necesita en dos momentos muy distintos:

- **Para entrenar:** para cada transacción del pasado, el valor que tenía **en ese momento**. Son millones de filas, y se leen de una vez, en horas.
- **Para servir:** para la transacción de ahora, el valor de **ahora**, en un par de milisegundos.

Si cada equipo lo calcula a su manera, con un SQL para entrenar y un código distinto en el servicio, tarde o temprano los dos números se separan. Es el [[training-serving-skew|*training-serving skew*]] que viste en la lección de imágenes: el modelo aprendió con un número y en producción recibe otro.

Un [[feature-store|feature store]] resuelve eso con **una sola definición** de cada feature y dos almacenes:

- **El offline store:** todas las versiones de cada valor, con su hora, en el lake o en el warehouse. Sirve para armar datasets de entrenamiento.
- **El online store:** solo el último valor de cada usuario o tarjeta, en una base [[llave-valor]] como [[redis|Redis]] o DynamoDB (la de AWS), que responde en milisegundos.

Un job copia, cada tanto, los valores nuevos del offline al online. A eso se le llama **materializar**. Herramientas conocidas: Feast (de código abierto), Tecton (desde 2025, parte de Databricks) y los feature stores de Databricks, SageMaker y Vertex AI.

:::diagrama almacenamiento-features
Arriba, el carril lento: el mismo job llena el offline store, y de ahí salen los datasets. Abajo, el rápido: el servicio lee el último valor del online store en ≈ 1 ms. La flecha «materializa» une los dos. Usa «Recorrer» para seguir un entrenamiento, una request y el backfill de una feature nueva.
:::

Al armar un dataset, para cada ejemplo hay que tomar el valor que la feature tenía **justo antes** de ese momento, no el de después. Si no, el modelo aprende con información del futuro, un [[leakage]]. Esa unión se llama *point-in-time join*, y la verás con calma en la lección de tiempo y hashes: [[point-in-time]].

:::ejemplo Una tarjeta, tres valores
El offline store guarda la feature «compras en 24 h» de la tarjeta 77 cada vez que cambió: a las 10:00 valía 2; a las 10:07, 3 (ya contando la de las 10:05); a las 10:30, 9 (alguien la estaba vaciando).

- Una transacción de las 10:05 se entrena con **2**, el último valor de antes de las 10:05.
- Si el job tomara «el valor más nuevo», usaría el 9: el modelo vería un número que en ese momento nadie conocía, y aprendería que la transacción de las 10:05 ya se veía sospechosa. Hasta el 3 sería trampa: ya cuenta la transacción que se quiere juzgar.
- En producción, a las 10:05, el online store tenía el 2. Con el point-in-time, entrenar y servir ven lo mismo.
:::

El online store solo guarda el presente, así que cada llave lleva un tiempo de vida ([[ttl|TTL]]): si una tarjeta no se usa en meses, su fila se borra sola y la memoria no crece sin fin.

¿El clasificador de Alba necesita un feature store? No: en visión pura, una foto entra y una categoría sale, y la feature es la imagen misma. Sí lo necesitan un sistema de recomendación o uno de detección de fraude, donde el modelo vive de la historia de cada usuario.

### Backfill: recalcular el pasado

Inventas una feature nueva: «fotos que subió este vendedor en los últimos 7 días». Hoy empiezas a calcularla, pero para entrenar necesitas su historia, y el log de los últimos 90 días está en el lake. Correr el mismo cálculo sobre los días que ya pasaron es un [[backfill]] (rellenar hacia atrás).

Gracias a las particiones, un backfill es la misma corrida diaria, repetida una vez por cada día viejo.

Con \(d\) particiones (una por día), cada una de \(t_p\) minutos, y \(j\) corridas a la vez, el backfill tarda \(t = d × t_p ÷ j\).

:::cuenta El backfill de una feature nueva, 90 días
Particiones que hay que procesar, \(d\) // una por día | 90 días × 1 | 90 corridas
Tiempo por partición, \(t_p\) // supuesto: lo que tarda la corrida diaria | — | ≈ 20 min
En serie, una tras otra // \(j\) = 1 | \(t = d × t_p\) = 90 × 20 min | 1,800 min = 30 h
Con \(j\) = 10 corridas a la vez | \(t = d × t_p ÷ j\) = 30 h ÷ 10 | ≈ 3 h
= Como cada corrida escribe solo su partición y escribirla dos veces da lo mismo ([[idempotencia]]), si una se cae a la mitad se repite esa y ya.
:::

Dos cuidados. El backfill corre **el mismo código** que la corrida diaria, no un script aparte escrito con prisa: si no, la historia y el presente vuelven a ser números distintos. Y escribe en el offline store, no en el online: a las requests de hoy no les sirve el valor de hace 90 días.

El backfill de Alba es otro: clasificar con el modelo las ≈ 200 millones de fotos que ya había en el catálogo. El equipo de Alba lo parte en ≈ 2,000 pedazos de 100,000 fotos, cada uno con su archivo de salida. Al reanudar, se saltan los pedazos que ya tienen salida. Leer las 200 millones de fotos son \(R\) = 200 millones de `GET`, a \(c_R\) = US$0.0004 por cada 1,000: \(R ÷ 1,000 × c_R\) = 200 M ÷ 1,000 × 0.0004 = **US$80**.

## Errores comunes {Common mistakes}

### 1. Usar el object storage como si fuera un disco

Abrir un objeto para agregarle una línea, editarlo a la mitad o «renombrar una carpeta» con un millón de fotos como si fuera instantáneo. O dos jobs que escriben la misma llave: gana el último, y el otro se pierde sin aviso.

**Cómo evitarlo:** diseñar con objetos que se escriben una vez. Llaves que no se repiten (con la fecha, la versión o el id del job), archivos nuevos en vez de editar los viejos y, si hace falta editar filas, un formato de tabla como Delta o Iceberg.

### 2. Millones de objetos chiquitos

Un objeto por predicción, por evento o por fila. Guardarlos es barato; subirlos, listarlos, moverlos de clase y leerlos, no. El log del clasificador de Alba así cuesta ≈ US$1,650 al mes en vez de ≈ US$6.

**Cómo evitarlo:** juntar en archivos de ≈ 100 MB a 1 GB (Parquet, o pedazos de muchas fotos para entrenar). Y antes de una regla de ciclo de vida, contar los objetos, no solo los GB.

### 3. Creer que once nueves son un respaldo

La durabilidad protege de discos rotos, no de un `DELETE`, de una regla de ciclo de vida mal escrita o de un script con el prefijo equivocado.

**Cómo evitarlo:** versionado del bucket en lo que no se puede perder, Object Lock en lo que nadie debe borrar (el golden set, los snapshots de modelos en producción; y, para que nadie pise una llave, la escritura condicional de «Versionado y linaje») y permisos que no dejen borrar a quien solo necesita leer.

### 4. Hacer público un bucket para «compartir rápido»

Un bucket público, o URLs prefirmadas de 7 días pegadas en un chat, con fotos de personas adentro.

**Cómo evitarlo:** el bucket privado siempre. Para compartir, URLs prefirmadas de una sola llave, de minutos, firmadas por un servicio que revisa quién las pide.

### 5. Mover a una clase fría lo que se sigue leyendo

Mandar a Standard-IA el dataset que se lee en cada entrenamiento, o a Deep Archive algo que alguien va a necesitar mañana. Pagas el GB leído, el mínimo de días y, en Deep Archive, horas de espera.

**Cómo evitarlo:** mirar cuántas veces se lee de verdad cada prefijo antes de escribir la regla. Si no lo sabes, Intelligent-Tiering, una clase de S3 que mueve cada objeto sola según su uso, a cambio de una cuota pequeña por objeto.

### 6. Una retención que nadie cumple

El bucket borra a los 90 días, pero las fotos siguen en snapshots, en copias y en laptops.

**Cómo evitarlo:** escribir la retención de cada artefacto al crearlo, no después, y que los snapshots se puedan buscar por la huella de cada foto para borrarla de todos.

## En la vida real {In real life} [extra]

### Alba: dónde va cada cosa

Ya puedes responder la pregunta de la lección. Las cuentas son del equipo de Alba, con precios de S3 Standard.

| Qué | Dónde | Cuánto | Retención | Al mes |
|---|---|---|---|---|
| Fotos de las publicaciones | Bucket del producto, no del clasificador | 2 TB al día | La del producto | La paga el marketplace |
| Log de cada predicción | Lake, Parquet por `dt=` | 3 GB al día crudo | 90 días; agregados para siempre | ≈ US$6 |
| Fotos que van a etiquetar | Bucket restringido, sin EXIF | ≈ 5,000 al mes, ≈ 1 GB | 90 días | Centavos |
| Golden set | Bucket restringido | 50,000 fotos, ≈ 10 GB | Sin caducar, borrado por huella | ≈ US$0.23 |
| Snapshots de entrenamiento | Prefijos fijos, manifest en Parquet | Megabytes cada uno | Sin caducar, borrado por huella | Centavos |
| Pesos de cada versión | Bucket de artefactos, junto al registro de modelos | ≈ 98 MB el ONNX | Las versiones que puedan volver | Centavos |

Todo lo propio del clasificador de Alba cabe en menos de US$10 al mes. Se resume en una frase: el almacenamiento es barato; lo caro es la privacidad de lo que guardas.

Lo que sí se nota son las requests y la red. En el diseño base, el gateway recibe los bytes de cada foto. Una variante para ahorrar es que la request al clasificador lleve la llave de la foto y no sus bytes, si el `GET` extra cabe en su meta de p99 ≤ 200 ms (el p99 es el tiempo en que ya respondió el 99 % de las requests). Con esa variante, el gateway lee cada foto de S3 con un `GET`: 10 M × 30.4 días = 304 millones al mes, y 304 M ÷ 1,000 × 0.0004 ≈ US$122. Pero ojo: si esos `GET` salieran por el [[nat|NAT]] (la puerta que deja a las máquinas privadas llegar a internet, y que cobra por GB, ≈ US$0.045 en us-east-1), los 10 M × 200 KB × 30.4 ≈ 61 TB al mes costarían ≈ 61,000 GB × 0.045 ≈ US$2.7 mil más; por un camino privado hacia S3, nada. Lo verás en la lección «Redes en la nube: VPC, subredes y egress».

Los pesos, además, van horneados (copiados adentro) en la imagen del [[contenedor]] del servicio, y el nombre de versión de la imagen (su *tag*) es la versión del modelo.

### Video con cámaras: clips que suben solos

En un sistema de video en tiempo real con varias cámaras, como el de unos centros de distribución, las cajas de cada sitio (la computadora conectada a sus cámaras) suben fotos y clips de cada evento con una URL prefirmada de 15 minutos, directo a S3: los megabytes de video no cruzan la API. Los clips se guardan 30 días, porque traen personas. Si cada sitio mandara el video continuo de sus 40 cámaras serían ≈ 1.7 TB al día; solo con los clips de eventos, de ≈ 5 MB, son ≈ 10 GB.

### Búsqueda y recomendación: copias para reconstruir y lagos para aprender

Un servicio de búsqueda por foto, con embeddings, guarda en S3 una copia de cada vector que calcula, en Parquet por versión del modelo: ≈ 205 GB por versión, ≈ US$5 al mes. Con ella reconstruye el índice sin volver a usar la GPU. Los vectores que lee en cada búsqueda, en cambio, viven en un disco gp3 de cada máquina.

Un sistema de recomendación guarda en su lake 90 días del log de lo que mostró, de los eventos de la app y de la historia de sus features (su offline store), particionado por día y hora. Solo el log, en Parquet, son ≈ 18 a 36 TB: ≈ US$0.4 a 0.8 mil al mes en Standard. Con los eventos y la historia de features, con supuestos típicos, son ≈ US$0.5 a 1 mil al mes.

### Fraude: el lake que espera 90 días

En la detección de fraude en tiempo real, la etiqueta llega tarde. Cada transacción y la decisión del modelo entran al lake el mismo día, pero solo se sabe si era fraude cuando el dueño de la tarjeta reclama un cargo (un contracargo), y eso puede tardar semanas. Una regla común: si en 90 días no apareció un contracargo, la fila ya es un ejemplo negativo «maduro». Aquí la retención del lake no la pone solo el costo: sin 90 días de historia no hay etiquetas.

El cálculo en vivo de ese sistema de fraude guarda su estado, ≈ 24 GB de contadores (80 millones de tarjetas × ≈ 300 bytes), en el disco local de sus máquinas, y cada tanto deja en S3 un checkpoint: una copia de ese estado de la que puede volver a arrancar (el programa puede subir solo lo que cambió desde el checkpoint anterior). Es el mismo reparto de la sección extra de bloques: el disco para trabajar rápido, el object storage para no perder nada si la máquina muere.

### Moderación: el mismo log en dos servicios

Un sistema de moderación de contenido genera, con supuestos típicos, ≈ 180 GB de logs al día: 180 × 30.4 = 5,472 GB ≈ 5.5 TB al mes. ¿Dónde mandarlos? En CloudWatch Logs, el servicio de logs de AWS, cuesta US$0.50 por GB al recibirlos: 5,472 GB × 0.50 ≈ **US$2,700** al mes. En S3, 5,472 GB × 0.023 ≈ **US$126**. Los mismos bytes, veinte veces de diferencia. Por eso el clasificador de Alba manda a CloudWatch solo los logs del servicio (errores, arranques), y los de cada predicción, a S3.

### Fuera de ML: el archivo que nadie lee

Un banco tiene que guardar sus registros durante años, por ley, y casi nunca los vuelve a abrir. Es el uso típico de Deep Archive con Object Lock: guardar cuesta ≈ US$1 por TB al mes, nadie puede borrar nada antes de la fecha, y si un día un auditor pide un archivo, se espera unas horas. Lo mismo hacen los estudios de cine con sus copias maestras y los hospitales con sus imágenes viejas.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de costo se pueden comprobar con las calculadoras. Usa los precios de S3 Standard de la lección.

:::ejercicios
? [facil] En `s3://ml-datos/logs/dt=2026-11-06/part-0003.parquet`, ¿cuál es el bucket y cuál la llave? ¿Qué devuelve un LIST con el prefijo `logs/dt=2026-11-0`? Alguien quiere «renombrar la carpeta» `logs/` a `predicciones/` y tiene 50,000 objetos: ¿cuántas requests hace y cuánto cuestan?
- Bucket: `ml-datos`. Llave: `logs/dt=2026-11-06/part-0003.parquet`, todo lo que sigue.
- El LIST devuelve las llaves de los días 1 al 9 de noviembre de 2026: un prefijo no tiene que terminar en «/».
- Renombrar no existe: 50,000 `COPY` y 50,000 `DELETE`, más 50 LIST de 1,000 llaves. Son ≈ **100,050 requests**.
- Costo: \(R ÷ 1,000 × c_R\). Las COPY y los LIST se cobran como PUT, \(c_R\) = US$0.005: \(R\) = 50,000 + 50 = 50,050, y 50,050 ÷ 1,000 × 0.005 ≈ **US$0.25**. Los DELETE son gratis. Barato, pero no instantáneo, y quien lea a la mitad ve una parte en cada lado.
? [facil] Un equipo guarda mil millones de objetos en S3, con once nueves de durabilidad. ¿Cuántos esperaría perder al año? Y si el servicio tiene 99.99 % de disponibilidad, ¿cuántos minutos al año puede no contestar? ¿Se pierde algo en esos minutos?
- Durabilidad: perdidos al año = \(N × P\) = 10⁹ × 10⁻¹¹ = **0.01 objetos al año**: uno cada \(1 ÷ (N × P)\) = 100 años.
- Disponibilidad: minutos sin contestar = (1 − 0.9999) × minutos del año = 0.0001 × 525,600 ≈ **53 minutos al año** (un año son 365 × 24 × 60 = 525,600 minutos).
- En esos minutos no se pierde nada: las requests fallan, se reintenta y los objetos siguen ahí. Son dos medidas distintas.
? [facil] Un millón de registros de 1 KB: ¿cuánto cuesta guardarlos un mes y cuánto subirlos, si cada uno es un objeto? ¿Y si los juntas en un solo archivo de 1 GB?
- Con la fórmula de S3, \(costo = G × c_G + R ÷ 1,000 × c_R\). Guardar: \(G\) = 10⁶ × 1 KB = 1 GB, y \(G × c_G\) = 1 × 0.023 = **US$0.023** en los dos casos.
- Subir un millón de objetos: \(R\) = 10⁶ PUT, y \(R ÷ 1,000 × c_R\) = 10⁶ ÷ 1,000 × 0.005 = **US$5**: 5 ÷ 0.023 ≈ 217 veces lo que cuesta guardarlos un mes.
- Un solo archivo: un PUT (en la práctica, unas pocas partes), ≈ **US$0.000005**.
? [facil] La API de un sistema de video con cámaras firma una URL de `PUT` para la llave `sitio-07/clips/e-31.mp4`, válida 15 minutos. ¿Qué puede hacer quien la tenga? ¿Puede leer otros clips, o subir uno a otra llave? ¿Y a los 20 minutos?
- Puede subir un archivo a **esa llave**, una o varias veces, durante 15 minutos (900 segundos). Si sube dos veces, el segundo reemplaza al primero.
- No puede leer nada (la firma es para `PUT`), ni escribir en otra llave: cambiar la llave rompe la firma y S3 responde 403.
- A los 20 minutos ya venció: 403. La caja (la computadora del sitio) pide una URL nueva.
- Ojo: cualquiera que la copie puede hacer lo mismo durante esos 15 minutos. Por eso no se escribe en los logs.
? [medio] Guardas 1 TB de datos temporales que vas a borrar a los 10 días. ¿Sale más barato en Standard o en Standard-IA? ¿Y si los guardaras 60 días?
- Guardar \(G\) GB durante unos días cuesta \(G × c_G × días ÷ 30.4\), porque \(c_G\) es por mes. Aquí \(G\) = 1,000 GB.
- Standard, 10 días: 1,000 × 0.023 × 10 ÷ 30.4 ≈ **US$7.57**.
- Standard-IA cobra mínimo 30 días, aunque lo borres a los 10: 1,000 × 0.0125 × 30 ÷ 30.4 ≈ **US$12.34**. Sale más caro, aunque su precio por GB es casi la mitad.
- A 60 días: Standard, 1,000 × 0.023 × 60 ÷ 30.4 ≈ US$45.39; IA, 1,000 × 0.0125 × 60 ÷ 30.4 ≈ **US$24.67**, si no se lee. Leerlo todo una vez sumaría 1,000 GB × US$0.01 = US$10, y todavía gana IA.
? [medio] El log del clasificador de Alba en Parquet pesa ≈ 0.5 GB al día. Un analista corre cada mañana una consulta sobre los últimos 7 días. ¿Cuántos GB lee con particiones por día? ¿Y si la tabla no tuviera particiones y guardara un año? ¿Cuántas veces más?
- Lo que se lee es \(d\) × 0.5 GB, con \(d\) los días (las particiones) que abre la consulta.
- Con particiones, \(d\) = 7: 7 × 0.5 = **3.5 GB**.
- Sin particiones, el motor no sabe dónde está cada fecha y abre todo el año, \(d\) = 365: 365 × 0.5 = **182.5 GB**.
- 182.5 ÷ 3.5 ≈ **52 veces más**, cada mañana. En BigQuery, que cobra por bytes leídos, es ≈ 52 veces el precio.
? [medio] Un servicio de búsqueda por foto guarda una copia de sus vectores en S3: ≈ 205 GB por versión del modelo. Quiere conservar las últimas 6 versiones. ¿Cuánto cuesta al mes en Standard y en Glacier Instant Retrieval? ¿Cuánto cuesta leer una versión completa desde Glacier IR para reconstruir un índice?
- Guardar cuesta \(G × c_G\); leer desde Glacier IR, los GB leídos × US$0.03.
- \(G\) = 6 × 205 = 1,230 GB.
- Standard, \(c_G\) = 0.023: 1,230 × 0.023 ≈ **US$28** al mes.
- Glacier IR, \(c_G\) = 0.004: 1,230 × 0.004 ≈ **US$4.92** al mes.
- Leer una versión desde Glacier IR: 205 GB × 0.03 ≈ **US$6.15**. Si las versiones viejas se leen menos de una vez al mes, conviene: deja la actual en Standard y las otras 5 en Glacier IR.
? [reto] Diseña el almacenamiento del log del clasificador de Alba para un año, con sus reglas: filas crudas 90 días, agregados para siempre. El log son 10 millones de predicciones al día, de ≈ 300 bytes. Compara: (a) un objeto por predicción, en Standard; (b) un archivo por minuto. Para cada uno: GB guardados, costo de guardar, de los PUT y de leerlo una vez al mes. ¿Qué regla de ciclo de vida escribes?
- Las ecuaciones: \(G\) = 3 GB al día × 90 días; \(R = r ÷ k × 30.4\) PUT al mes, y otros tantos GET si se lee una vez; cada parte cuesta \(G × c_G\) o \(R ÷ 1,000 × c_R\).
- Guardado en los dos: \(G\) = 3 GB × 90 = 270 GB, y 270 × 0.023 ≈ **US$6.2** al mes.
- (a) \(k\) = 1: \(R\) = 10 M × 30.4 = 304 M. PUT: 304 M ÷ 1,000 × 0.005 ≈ **US$1,520** al mes. Leer un mes: 304 M ÷ 1,000 × 0.0004 ≈ **US$122**. Total ≈ US$1,650.
- (b) \(k\) ≈ 6,944, un archivo por minuto: \(R\) = 1,440 × 30.4 = 43,776 al mes. PUT: 43,776 ÷ 1,000 × 0.005 ≈ **US$0.22**. Leer un mes, 43,776 GET: 43,776 ÷ 1,000 × 0.0004 ≈ US$0.02. Total ≈ US$6.4.
- La regla: borrar a los 90 días el prefijo de las filas crudas (`Expiration`, 90 días) y ninguna regla sobre el de los agregados. No vale la pena mover el log a una clase fría: pesa poco y se lee para cada reentrenamiento.
- En Parquet serían ≈ 0.3–0.6 GB al día: \(G\) bajaría a 90 × 0.3 = 27 a 90 × 0.6 = 54 GB, ≈ US$1 al mes.
? [reto] El backfill del catálogo de Alba: 200 millones de fotos, partidas en 2,000 pedazos iguales. Cada GPU T4 clasifica ≈ 1,000 fotos por segundo, y hay 4. (a) ¿Cuántas fotos lleva cada pedazo? (b) ¿Cuánto tarda todo? (c) ¿Cuánto cuestan los GET? (d) El pedazo 1,234 se cae a la mitad: ¿qué se repite, y qué tiene que cumplir cada pedazo para que repetirlo no haga daño?
- Las ecuaciones, con \(C\) = 200 M fotos del catálogo, \(g\) = 4 GPUs y \(v\) = 1,000 fotos por segundo cada una: fotos por pedazo = \(C ÷ 2,000\); tiempo \(t = C ÷ (g × v)\); GET: \(R ÷ 1,000 × c_R\), con \(R = C\).
- (a) 200,000,000 ÷ 2,000 = **100,000 fotos** por pedazo.
- (b) \(t\) = 200 M ÷ (4 × 1,000 por segundo) = 50,000 s; 50,000 ÷ 3,600 ≈ **14 horas**.
- (c) 200 M ÷ 1,000 × 0.0004 = **US$80**.
- (d) Solo el pedazo 1,234: el job ve que no tiene archivo de salida y lo vuelve a correr. Para que eso sea seguro, cada pedazo escribe su salida en una llave fija, como `.../shard-01234.parquet`, y solo al terminar: si se repite, reescribe el mismo objeto con lo mismo. Es idempotente.
:::

## Lo que sigue {What comes next}

- La siguiente lección, «Colas y streams», cuenta cómo llegan los eventos al lake, y «Tiempo, hashes e identificadores» explica las huellas de los manifests, el *event time* y el point-in-time join.
- Más adelante, «Regiones, zonas y disponibilidad» y «Redes en la nube: VPC, subredes y egress» explican por qué cuesta sacar datos de una región y por qué los pesos se leen de S3 por un camino privado y no por internet.
- «Datos y etiquetas» copia, sin EXIF, a un bucket restringido las fotos de Alba que hay que etiquetar, y «Versionado y linaje» arma los snapshots con manifest, los ata a cada modelo y cuenta cuándo convienen herramientas como DVC o lakeFS.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
object-storage bucket-objetos url-prefirmada durabilidad clase-almacenamiento ciclo-vida almacenamiento-bloques data-lake data-warehouse oltp-olap lakehouse particion-datos snapshot retencion feature-store backfill
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué no se puede «editar a la mitad» un objeto de S3, y qué haces si necesitas cambiarlo?
Porque solo guarda objetos enteros: un PUT a la misma llave reemplaza todo, y esa sencillez le deja repartir billones de objetos sin coordinar escrituras. Lo bajas, lo cambias y lo subes entero; para editar filas, Delta o Iceberg.
? ¿Qué permite una URL prefirmada y quién la firma?
Una operación (PUT o GET) sobre una llave, por un rato. La firma con su clave secreta un servidor con permiso, y quien tenga la URL la usa hasta que vence.
? Once nueves de durabilidad, ¿quieren decir que tus datos están a salvo?
De los discos rotos, sí: perderías uno de 10 millones cada 10,000 años. De un DELETE, una regla mal escrita o un prefijo equivocado, no: para eso, versionado, Object Lock y permisos.
? ¿Por qué un ciclo de vida que mueve millones de fotos chicas a una clase fría puede ahorrar poco?
Porque cada transición se cobra por objeto: mover 304 millones de fotos al mes a Glacier IR cuesta ≈ US$6,080, casi la mitad del ahorro en GB; a Deep Archive, más que todo el ahorro.
? ¿Para qué sirve particionar un log por `dt=`?
Para leer solo los días necesarios: una semana son 3.5 GB en vez de los 182.5 del año. Y para que cada corrida reescriba solo su día si algo sale mal.
? ¿Qué le agrega un lakehouse a un data lake?
Un registro de qué archivos forman la tabla en cada versión. Con él, cada escritura pasa completa o no pasa, se corrigen filas y se lee una versión vieja (time travel), sin copiar datos.
:::
