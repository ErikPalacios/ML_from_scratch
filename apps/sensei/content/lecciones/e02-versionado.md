---
titulo: Versionado y linaje
en: Versioning and lineage
subtitulo: Cómo se congela el dataset de cada mes en un manifest que nadie puede pisar, cómo se ata a cada modelo y cómo se contesta, meses después, con qué datos se entrenó y en qué modelos está una foto.
pregunta: El modelo de octubre de Alba se entrenó con casi dos millones de fotos etiquetadas. ¿Cómo guardas exactamente ese conjunto sin copiar 400 GB cada mes, cómo te aseguras de que nadie lo cambie y cómo contestas dentro de un año con qué datos salió ese modelo?
requisitos: almacenamiento, git, tiempo-hash
---

:::idea
Git versiona el código; los datos no se versionan solos. Alba congela el dataset de cada mes en un **snapshot**: un manifest que lista cada foto con su huella, escrito una sola vez en un prefijo que nadie puede pisar. Cada modelo guarda tres punteros (snapshot, commit e imagen de entrenamiento), y con ellos se contesta de dónde salió, se repite y se encuentra cada foto que hay que borrar.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace en línea: recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y sugiere la categoría de cada foto entre 500. Lo hace con un modelo de visión, una red [[resnet|ResNet-50]], que corre en la nube de Amazon (AWS). El modelo se vuelve a entrenar cada mes con las etiquetas nuevas. El [[dataset]] de septiembre, el conjunto de fotos con su etiqueta, tiene 1,932,628 fotos: 1,840,211 para entrenar (el [[train-set|train]], con el que el modelo aprende) y 92,417 para validar (la [[validation-set|validación]], que se guarda aparte para medirlo).

Ahora imagina tres preguntas que llegan meses después. Un analista: «¿con qué datos exactos se entrenó el modelo de octubre?». Una ingeniera, al ver que el modelo nuevo es peor: «¿cambió el código o cambiaron los datos?». Y legal: «Ana pidió borrar sus datos; ¿en qué datasets y en qué modelos están sus fotos?».

Las tres son preguntas de datos, y ninguna se contesta con [[git|Git]]. Git guarda cada versión del código; pero el código de entrenamiento de octubre y el de noviembre pueden ser idénticos y dar modelos distintos, porque cambiaron los datos. Si nadie congeló los datos de octubre, no hay manera de volver a ellos.

Esta lección es el paso del sistema de Alba que hace ese trabajo. Las piezas ya las conoces. El [[snapshot]], de «Object storage, data lakes y warehouses», es una versión fija de los datos de un momento, que ya no cambia. El [[commit]], de «Git: versiones del código», es una versión guardada del código, con un id corto como `c3f2fc2`. La [[hash-criptografico|huella SHA-256]], de «Tiempo, hashes e identificadores», es un resumen de 64 caracteres que se calcula con los bytes de un archivo: el mismo archivo da siempre la misma huella, y si cambia un solo byte, la huella es otra por completo.

## Qué entra y qué sale de la estación {What goes in and what comes out}

El [[versionado-datos|versionado de datos]] es guardar cada versión de un dataset de modo que se pueda volver a leer **exactamente** igual, con un nombre que no cambia. Es lo mismo que Git hace con el código, pero con millones de archivos que no caben en Git.

### Lo que entra

El paso anterior del sistema (la lección «Datos y etiquetas») le entrega a este una sola cosa:

- **Los labels del mes.** Un [[etiqueta|label]] (etiqueta) es la categoría correcta de una foto, la respuesta que el modelo debe aprender. Llegan de dos lados: ≈ 5,000 fotos revisadas por personas, y los labels «débiles», que salen de lo que hace la gente: lo que eligió quien vende, si pasaron 30 días sin que el equipo de moderación de Alba, que revisa publicaciones, lo corrigiera, y las correcciones de moderación. Llegan como **eventos**: una fila nueva por label, con su autor, su hora y su fuente.

Y consulta dos cosas que no cambian cada mes:

- **El [[golden-set|golden set]]** `golden-v3`: 50,000 fotos etiquetadas por dos personas, con cada desacuerdo adjudicado por moderación, y congelado. Sirve para medir; nunca entra al entrenamiento.
- **La guía de etiquetado** con su versión (`guia-v4` en noviembre de 2026): las reglas escritas que dicen qué categoría lleva cada caso dudoso. Cada label dice con qué versión de la guía se hizo.

### Lo que sale

Sale un **snapshot**: una versión congelada del dataset, con nombre propio. Lleva la fecha del primer día del mes que cubre, y lo arma la corrida del día 1 del mes siguiente, cuando ese mes ya terminó. El de septiembre se llama `ds-2026-09-01`, y lo arma la corrida del 1 de octubre con los labels que existían a las 00:00 [[utc|UTC]] de ese día (la hora de referencia mundial, sin horario de verano).

Vive en S3, el [[object-storage|object storage]] de AWS: un almacén donde cada archivo es un objeto que se guarda y se pide por su **llave**, su nombre completo. La dirección es `s3://ml-datos/datasets/ds-2026-09-01/`: el [[bucket-objetos|bucket]] (el almacén con nombre propio donde viven los objetos) se llama `ml-datos`, y `datasets/ds-2026-09-01/` es un **prefijo**, el principio común de las llaves de ese snapshot, que funciona como una carpeta. Ahí hay tres archivos:

- `rows.parquet`: el **manifest**, una fila por foto. Es el snapshot en sí.
- `snapshot.json`: la **tarjeta**, que dice de dónde salió el manifest y su huella.
- `validation.json`: el reporte de los chequeos que pasó antes de publicarse.

Ojo: de ≈ 75 millones de publicaciones al mes, Alba no entrena con todas. El snapshot es el conjunto **acumulado**: todos los labels humanos (≈ 406 mil, 21 %), todas las correcciones de moderación (≈ 135 mil, 7 %) y una muestra de ≈ 1.39 millones de labels maduros de quien vende (72 %), con tope por categoría y por vendedor. Los «labels del mes» son lo que se agrega o se renueva ese mes.

Las fotos no se copian. Siguen donde ya estaban, en el almacenamiento del producto (el bucket donde la app guarda las fotos que sube la gente), y el manifest las cita por su llave y su huella.

### Lo que decide

Este paso toma cinco decisiones, y cada una tiene su sección:

1. **Qué guarda el snapshot y cómo se describe**: el manifest y la tarjeta.
2. **Cómo se impide que alguien lo pise**: la escritura condicional y la publicación al final.
3. **Cómo se reparten las fotos entre train y validación** sin que se muevan de un mes a otro: el split estable.
4. **Con qué herramienta se versiona**: prefijos inmutables, DVC, lakeFS o una tabla con *time travel* (una tabla que deja leer cómo estaba en una fecha pasada).
5. **Qué apunta a qué**: del modelo al snapshot, al commit y a cada foto. Eso es el **linaje**.

:::diagrama e02-versionado-estacion
Arriba, lo que se arma aparte; abajo, lo que ya leen los entrenamientos. Toca cada caja para ver por qué está ahí, y usa «Recorrer» para seguir el snapshot de septiembre y una auditoría que falla.
:::

El principio que ordena todo es corto: **un snapshot se escribe una vez y nunca se edita; un cambio es otro snapshot.** Si en octubre aparece un error en una etiqueta de septiembre, no se corrige `ds-2026-09-01`: la corrección entra a `ds-2026-10-01`. Así, quien lea `ds-2026-09-01` dentro de un año lee lo mismo que leyó el entrenamiento.

## El manifest y la tarjeta {The manifest and the card}

### Una fila por foto

Un [[manifest]] (en español también se dice *manifiesto*) es un archivo que lista los elementos de un conjunto, cada uno con lo necesario para encontrarlo y comprobarlo. El de Alba es un archivo [[parquet|Parquet]], el formato de «Archivos y formatos» que guarda cada columna junta y comprimida. Tiene una fila por foto y estas columnas:

| Columna | Qué guarda | Ejemplo |
|---|---|---|
| `image_key` | la llave de la foto en el almacenamiento del producto | `fotos/2026/08/02/a01.jpg` |
| `image_sha256` | la huella SHA-256 de los bytes de la foto | 64 caracteres hexadecimales (0–9 y a–f) |
| `seller_id` | quién la publicó (decide el split) | `s-104` (un id de juguete) |
| `label_id` | la categoría, de 0 a 499 | 17 |
| `label_source` | de dónde salió el label | `humano`, `moderador` o `vendedor_filtrado` |
| `guia_version` | la guía con que se etiquetó | `guia-v4` |
| `split` | a qué parte va | `train` o `val` |
| `width`, `height` | el tamaño de la foto, en píxeles | 1200, 900 |
| `created_at` | cuándo se publicó, en [[utc\|UTC]] | `2026-08-02T14:31:07Z` |

¿Para qué la huella, si ya está la llave? Porque la llave es un nombre, y un nombre puede apuntar a otra cosa mañana. Si alguien sube otra foto a la misma llave, la llave sigue igual pero la huella ya no coincide. Al leer, el entrenamiento recalcula el SHA-256 de cada foto y lo compara con el del manifest: si no coincide, la foto cambió, y el paso se detiene.

### La huella del manifest entero

El manifest también tiene su huella: el SHA-256 de todo el archivo `rows.parquet`. Se llama `rows_sha256`, se escribe en la tarjeta y cada modelo la guarda. Si alguien cambiara una sola etiqueta de las 1,932,628, la huella sería otra.

El programa de abajo arma un manifest de juguete con 10 fotos y calcula su huella. Para que la huella no dependa del orden en que llegaron las filas, las ordena antes. Usa [[csv|CSV]] (texto con comas) en vez de Parquet para no instalar nada, recorta las huellas a pocos caracteres para que se lean y usa ids de juguete, como `s-104`, para quien vende.

```python
import csv, hashlib, io

filas = [  # image_key, image_sha256 (corto), seller_id, label_id, label_source, split
    ("fotos/2026/08/02/a01.jpg", "9b1e", "s-104", 17, "humano", "train"),
    ("fotos/2026/08/02/a02.jpg", "4c7d", "s-104", 17, "vendedor_filtrado", "train"),
    ("fotos/2026/08/03/b11.jpg", "e2a0", "s-309", 233, "moderador", "val"),
    ("fotos/2026/08/04/c31.jpg", "71f5", "s-318", 233, "vendedor_filtrado", "train"),
    ("fotos/2026/08/05/d07.jpg", "0d93", "s-407", 90, "humano", "train"),
    ("fotos/2026/08/06/e12.jpg", "a4b8", "s-512", 412, "vendedor_filtrado", "train"),
    ("fotos/2026/08/07/f44.jpg", "5e2c", "s-512", 412, "vendedor_filtrado", "train"),
    ("fotos/2026/08/08/g09.jpg", "c81a", "s-633", 5, "vendedor_filtrado", "train"),
    ("fotos/2026/08/09/h20.jpg", "38f6", "s-441", 90, "humano", "val"),
    ("fotos/2026/08/10/i15.jpg", "d1c4", "s-805", 17, "vendedor_filtrado", "train"),
]

def huella(rows):
    buf = io.StringIO()
    csv.writer(buf).writerows(sorted(rows))          # mismo orden siempre
    datos = buf.getvalue().encode()
    return hashlib.sha256(datos).hexdigest()[:12], len(datos)

h, n_bytes = huella(filas)
print("rows_sha256:", h, "·", n_bytes, "bytes ·", round(n_bytes / len(filas)), "B por fila")

otra = list(filas)
otra[3] = otra[3][:3] + (234,) + otra[3][4:]          # una sola etiqueta cambia
print("una etiqueta distinta:", huella(otra)[0])
print("mismas filas, otro orden:", huella(list(reversed(filas)))[0])
```

```salida
rows_sha256: 9c3ec1ab181a · 598 bytes · 60 B por fila
una etiqueta distinta: 4fab4aa4f20b
mismas filas, otro orden: 9c3ec1ab181a
```

Una etiqueta de diez cambió y la huella es otra por completo; el mismo contenido en otro orden da la misma. Aquí cada fila mide ≈ 60 B porque las huellas están recortadas. Con las 10 columnas reales y las huellas completas de 64 caracteres, el equipo de Alba estima ≈ 200 B por fila.

:::figura e02-versionado-manifest
Un snapshot no copia fotos: es una lista. Cada fila cita una foto por su llave y su huella; la huella de toda la lista va en la tarjeta, y el modelo guarda esa huella.
:::

### Cuánto pesa y cuánto ahorra

En «Archivos y formatos» viste que un manifest pesa ≈ 0.1 % de las fotos que cita. Aquí lo ponemos en dólares y con Parquet. Lo que hace barato este diseño es que el manifest cita y no copia. Las dos primeras ecuaciones dicen cuánto pesa cada cosa; las dos últimas, cuánto cuesta guardar un año de snapshots citando las fotos o copiándolas:

:::formula Lo que pesa y cuesta un snapshot
M = N × r
F = N × f
text{costo}_{citar} = k × frac{M}{z} × c
text{costo}_{copiar} = k × F × c
- N: filas del manifest, una por foto
- r: bytes que ocupa cada fila del manifest, sin comprimir, en B
- f: bytes que ocupa cada foto, en B
- M: bytes del manifest, sin comprimir, en B
- F: bytes de las fotos que el manifest cita, en B
- z: cuántas veces comprime Parquet el manifest; lo guardado pesa \(M ÷ z\)
- k: cuántos snapshots se guardan, uno por mes
- c: lo que cuesta guardar un GB durante un mes, en US$ (los bytes se pasan a GB antes de multiplicar)
- text{costo}_{citar}: lo que cuesta al mes guardar los \(k\) manifests, en US$
- text{costo}_{copiar}: lo que costaría al mes guardar una copia de las fotos por cada snapshot, en US$
:::

La fracción \(M ÷ F = r ÷ f\) dice cuánto cuesta un snapshot comparado con copiar las fotos: no depende de cuántas fotos haya.

:::cuenta El snapshot de septiembre
Filas, \(N\) // la ficha de Alba | 1,840,211 + 92,417 | 1,932,628
Bytes por fila, \(r\) // estimado del equipo de Alba | 10 columnas, la huella de 64 caracteres | ≈ 200 B
Manifest, \(M = N × r\) // ≈ 400 MB redondeado | 1,932,628 × 200 B | ≈ 387 MB
Bytes por foto, \(f\) // la ficha de Alba | la foto que sube la app, ya reducida (el original del celular pesa ≈ 3 MB) | ≈ 200 KB
Fotos citadas, \(F = N × f\) // ≈ 400 GB redondeado | 1,932,628 × 200 KB | ≈ 387 GB
Fracción, \(M ÷ F = r ÷ f\) | 200 B ÷ 200,000 B | 0.001 = 0.1 %
Manifest guardado, \(M ÷ z\) // \(z\) ≈ 4, estimado del equipo de Alba con compresión zstd; la huella no baja de sus 32 B; ≈ 100 MB redondeado | 387 MB ÷ 4 | ≈ 97 MB
Un año de manifests, \(k × M ÷ z\) // \(k\) = 12 | 12 × 97 MB | ≈ 1.16 GB
Costo de citar, \(k × M ÷ z × c\) // \(c\) = US$0.023 por GB al mes, S3 Standard, us-east-1 | 1.16 GB × 0.023 | ≈ US$0.03 al mes
Costo de copiar, \(k × F × c\) // una copia de las fotos por snapshot | 12 × 387 GB × 0.023 | ≈ US$107 al mes
= Un snapshot cuesta ≈ 0.1 % de copiar las fotos. Un año de snapshots cuesta tres centavos al mes; copiar las fotos, ≈ US$107, y crece cada mes.
:::

Hay un precio escondido: un snapshot que cita depende de que las fotos sigan ahí. Si el producto borra una foto, la fila del manifest apunta a nada. Por eso el entrenamiento comprueba cada huella al leer, y por eso, cuando la foto se borra a propósito, el borrado se anota (lo ves en la sección «Borrar sin romper la historia»).

:::calculadora e02-versionado-peso
Empieza con el snapshot de septiembre. Sube \(r\) a 400 B (más columnas): el manifest se duplica, pero sigue siendo una fracción mínima de las fotos. Luego sube los snapshots guardados a 60 (cinco años): citar sigue costando centavos; copiar, cientos de dólares al mes.
:::

### La tarjeta: de dónde salió

El manifest dice **qué** hay. La tarjeta, `snapshot.json`, dice **de dónde salió** y cómo comprobarlo. Es un archivo [[json|JSON]] chico: texto con pares «nombre: valor», fácil de leer para un programa y para una persona. Este es el de septiembre; la huella está recortada y el resto es ilustración de cómo se ve:

```json
{
  "snapshot_id": "ds-2026-09-01",
  "parent": "ds-2026-08-01",
  "created_at": "2026-10-01T03:12:44Z",
  "rows_path": "s3://ml-datos/datasets/ds-2026-09-01/rows.parquet",
  "rows_sha256": "5d1f…e7a2",
  "counts": { "train": 1840211, "val": 92417, "total": 1932628 },
  "label_sources": { "humano": 0.21, "moderador": 0.07, "vendedor_filtrado": 0.72 },
  "split": { "by": "seller_id", "rule": "hash mod 100 < 95 -> train" },
  "code": { "repo": "ml-catalogo", "commit": "4be1d0a" },
  "validation": { "status": "passed",
                  "report": "s3://ml-datos/datasets/ds-2026-09-01/validation.json" }
}
```

Cada campo contesta una pregunta. `parent` dice cuál era el snapshot anterior: contra él se compara el volumen antes de publicar. `label_sources` dice la mezcla que viste arriba: 72 % de quien vende, 7 % de moderación, 21 % a mano. `code` dice qué código armó el snapshot: el commit `4be1d0a` del [[repositorio]] `ml-catalogo` (la carpeta de código que Git versiona). Ojo: ese no es el código que **entrena**. El modelo guarda su propio commit, `c3f2fc2` en el ejemplo. Son dos programas distintos, y cada artefacto apunta al suyo.

Además de la tarjeta, que leen las máquinas, se escribe una [[ficha-dataset|ficha del dataset]] para personas: qué hay, de dónde salió, cómo se etiquetó, cómo se dividió y, sobre todo, **para qué no sirve**. La de Alba dice, por ejemplo, que el 72 % de labels de quien vende no sirve para medir el modelo: quien vende muchas veces acepta la categoría que el modelo le sugirió, así que medir con esos labels es comparar al modelo consigo mismo. Para medir está el golden set. La idea viene de un artículo de 2018 que propuso las *datasheets for datasets*, como las hojas de datos que acompañan a una pieza electrónica.

## Que nadie lo pise {Nobody overwrites it}

### Inmutable por diseño, no por acuerdo

La [[inmutabilidad]] de un snapshot quiere decir que, una vez escrito, nadie puede cambiarlo: ni borrarlo, ni reemplazar un archivo, ni agregarle filas. Sin eso, todo lo anterior es una promesa. El modelo de octubre dice «me entrené con `ds-2026-09-01`», y si alguien reescribió ese prefijo en noviembre, el puntero miente.

Lo peligroso no es un ataque: es un descuido. Un script que corre dos veces. Una persona que «arregla» una etiqueta en el snapshot viejo porque es más rápido que esperar al siguiente. Un job (un programa que corre una tarea y termina) que escribe en `datasets/ds-2026-09-01/` porque alguien copió mal una fecha. En [[object-storage|object storage]] eso no da error. Para guardar un objeto se manda un `PUT`, el [[metodo-http|método de HTTP]] que dice «guarda esto con esta llave»; y un `PUT` a una llave que existe reemplaza el objeto entero, en silencio. Gana el último.

Por eso Alba no confía en que la gente tenga cuidado. Usa tres defensas, cada una para un hueco distinto.

### Defensa 1: la escritura condicional

Una [[escritura-condicional|escritura condicional]] es un `PUT` que solo se cumple si se cumple una condición. Ya la viste en «Object storage, data lakes y warehouses»; aquí la usa un snapshot. Desde agosto de 2024, S3 acepta el [[header]] `If-None-Match: *` (un header es una línea de datos extra que viaja con la petición), que quiere decir «guarda esto solo si no hay nada con esa llave». Si la llave ya existe, S3 responde con el [[codigo-estado|código]] 412 (*Precondition Failed*, «la condición previa no se cumplió») y no toca nada.

Pero un header lo pone quien escribe: un script que no lo pone escribe igual. Para que deje de ser opcional, la regla va en la política del bucket (*bucket policy*): un documento JSON, pegado al bucket, con reglas de quién puede hacer qué, y que S3 aplica a todos sin excepción. La de Alba dice dos cosas sobre el prefijo `datasets/`: niega cualquier `PUT` que no traiga el header, y niega borrar. Con eso, un snapshot nuevo se escribe sin problema, y uno viejo no se puede pisar ni borrar para volverlo a escribir.

Con la **copia** hay que tener cuidado. La guía de AWS todavía avisa que, con una política así, una copia (`CopyObject`) hacia el prefijo falla, aunque desde octubre de 2025 `CopyObject` acepta el mismo header. Como AWS se contradice, Alba no se apoya en la copia: el snapshot se publica subiendo los archivos con `PUT`.

:::profundo Cómo se escribe la regla
Esta es una ilustración de la parte que niega el `PUT` sin header, sin correrla:

```json
{
  "Sid": "SnapshotsSoloNuevos",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::ml-datos/datasets/*",
  "Condition": {
    "Null": { "s3:if-none-match": "true" },
    "Bool": { "s3:ObjectCreationOperation": "true" }
  }
}
```

Se lee así: «niega (`Deny`) a cualquiera (`Principal: *`) guardar objetos (`s3:PutObject`) en `datasets/` si el header `If-None-Match` es nulo, es decir, si no viene». `Resource` es el nombre completo, en el formato de AWS (un ARN), de las llaves a las que aplica: todas las de `datasets/` en el bucket `ml-datos`.

La segunda condición limita la regla a las operaciones que crean el objeto. Un archivo grande se sube en pedazos, y los pedazos no llevan el header; solo el paso final, el que los junta, lo lleva. Sin esa condición, la regla bloquearía cada pedazo.

La otra mitad es otra regla igual, con `Deny` sobre `s3:DeleteObject` en el mismo prefijo (y sobre `s3:DeleteObjectVersion`, si el bucket guarda versiones): sin ella, alguien podría borrar el snapshot y escribirlo de nuevo, porque la llave ya estaría vacía.
:::

### Defensa 2: versiones y Object Lock, y lo que no protegen

Ya las viste en «Object storage, data lakes y warehouses»; aquí, qué protegen y qué no. S3 puede guardar versiones: con el **versionado del bucket** (*S3 Versioning*) prendido, un `PUT` a una llave que existe no destruye el objeto viejo; lo guarda como versión anterior, con su propio id. Y [[object-lock|Object Lock]] va más lejos: cada versión queda bloqueada durante un plazo, y nadie la puede borrar, ni siquiera quien administra la cuenta, si se usa el modo más estricto.

Suena a la solución, pero tiene un hueco: **Object Lock protege cada versión, no la llave**. Un `PUT` a la misma llave sigue funcionando: crea otra versión, y esa pasa a ser la que se lee. La vieja sigue ahí, intacta, pero el entrenamiento que pide `rows.parquet` sin decir qué versión recibe la nueva. La escritura condicional cierra ese hueco; las versiones sirven para recuperar lo que se borró por error.

:::figura e02-versionado-pisar
Tres buckets reciben el mismo `PUT` a una llave que ya existe. Sin protección, se reemplaza en silencio. Con versiones u Object Lock, la vieja sobrevive, pero la que se lee es la nueva. Con la escritura condicional, S3 responde 412 y no cambia nada.
:::

### Defensa 3: la huella

Si las dos defensas fallaran (una política mal escrita, un permiso de más), queda la última: el modelo guarda `rows_sha256`. Antes de usar un snapshot, cualquiera recalcula la huella de `rows.parquet` y la compara con la del modelo. Si no coincide, el snapshot cambió, y se sabe. No impide nada, pero **delata**. Es la misma idea que [[fijar-con-hash|fijar con hash]] una dependencia en «Ataques y cadena de suministro»: anotar la huella exacta de una biblioteca que se descarga, para notar si alguien la cambió.

### Escribir, auditar, publicar

Queda un último riesgo: un snapshot a medias. El job escribe `rows.parquet` y se cae antes de escribir `validation.json`. ¿Existe el snapshot o no? Si el siguiente entrenamiento lo encuentra, entrena con algo que nadie revisó.

La salida es un patrón que se llama [[write-audit-publish|escribir, auditar, publicar]] (*write-audit-publish*):

:::pasos
1. Escribir aparte
El job escribe el manifest en un prefijo temporal, `s3://ml-datos/staging/ds-2026-09-01/`, donde nadie lo busca.
2. Auditar
Corren los chequeos del [[contrato-datos|contrato de datos]], las reglas que los datos cumplen antes de entrenar, sobre el manifest ya armado: ninguna foto en dos splits, ninguna huella del golden set, volumen entre 0.8 y 1.5 veces el del snapshot padre, labels débiles en 80 % o menos. Antes de armar ya pasaron los de los labels del mes (esquema exacto, `label_id` entre 0 y 499, horas en UTC, frescura), y al armar se aplicaron el corte, la regla de 30 días y los duplicados por huella. El resultado va a `validation.json`.
3. Publicar o detenerse
Si todo pasa, se suben con `PUT` el manifest y el reporte a `datasets/ds-2026-09-01/`, y **al final** la tarjeta, todo con escritura condicional (no se copian dentro de S3, por lo que viste en la defensa 1). Si algo falla, no se publica nada: el entrenamiento de ese mes no corre y sigue el modelo actual.
:::

La tarjeta es la última en escribirse a propósito: **un snapshot sin tarjeta no existe**. Quien entrena lee siempre la tarjeta primero; si no está, no hay snapshot, aunque haya un `rows.parquet` huérfano en el prefijo. Así, la escritura completa pasa o no pasa, como en una [[transaccion|transacción]] de base de datos (un grupo de cambios que se aplica completo o no se aplica), aunque S3 no tenga transacciones.

## Labels como eventos y split estable {Labels as events and a stable split}

### Un label no se corrige: se agrega otro

Imagina que el 25 de junio quien vende pone «Calzado › Tenis». Pasan más de 30 días sin que moderación lo corrija, así que el snapshot de julio, que se arma el 1 de agosto, lo trae como label, y el modelo de agosto aprende «Tenis». El 10 de agosto moderación lo corrige a «Calzado › Botas». Si la tabla de labels guarda una fila por foto y la corrección la reescribe, ya no sabes qué label había el 1 de agosto, y no puedes explicar por qué el modelo de agosto aprendió «Tenis».

Alba guarda los [[label-evento|labels como eventos]]: cada label es una fila nueva que nunca se edita, con la foto, el label, quién lo puso (la fuente), con qué versión de la guía y a qué hora. Corregir es agregar otro evento, más nuevo, que reemplaza al anterior. Nada se pierde.

Con eso, un snapshot es una **consulta**: «para cada foto, el label más reciente que ya existía a tal hora». Al armarlo se aplican el corte y la regla de 30 días: una elección de quien vende solo cuenta si ya maduró. Es el [[point-in-time|point-in-time]] de «Tiempo, hashes e identificadores», aplicado a los labels: el snapshot de septiembre, con corte a las 00:00 UTC del 1 de octubre, no puede ver un label que llegó el 4 de octubre.

```python
import hashlib

eventos = [  # (image_sha256, label_id, fuente, guia_version, hora UTC del evento)
    ("3a90", 17,  "vendedor",  "guia-v3", "2026-08-02T10:00Z"),
    ("3a90", 18,  "moderador", "guia-v3", "2026-08-20T16:30Z"),  # corrige: reemplaza al anterior
    ("b7e1", 233, "vendedor",  "guia-v3", "2026-08-27T09:12Z"),
    ("b7e1", 230, "humano",    "guia-v4", "2026-10-04T11:05Z"),  # llega después del corte
    ("f02c", 233, "vendedor",  "guia-v3", "2026-08-28T12:40Z"),
]

def vigentes(eventos, corte):
    ultimo = {}
    for img, label, fuente, guia, hora in sorted(eventos, key=lambda e: e[4]):
        if hora < corte:                      # point-in-time: solo lo que ya existía
            ultimo[img] = (label, fuente, guia)
    return ultimo

print("corte 1 oct:", vigentes(eventos, "2026-10-01T00:00Z"))
print("corte 1 nov, b7e1:", vigentes(eventos, "2026-11-01T00:00Z")["b7e1"])

def split(seller_id, u=95):
    cubeta = int(hashlib.sha256(seller_id.encode()).hexdigest(), 16) % 100
    return cubeta, "train" if cubeta < u else "val"

for s in ["s-104", "s-309", "s-318", "s-441"]:
    print(s, *split(s))
print("s-309 otra vez:", *split("s-309"))
```

```salida
corte 1 oct: {'3a90': (18, 'moderador', 'guia-v3'), 'b7e1': (233, 'vendedor', 'guia-v3'), 'f02c': (233, 'vendedor', 'guia-v3')}
corte 1 nov, b7e1: (230, 'humano', 'guia-v4')
s-104 87 train
s-309 95 val
s-318 46 train
s-441 99 val
s-309 otra vez: 95 val
```

El corte del 1 de octubre, el de `ds-2026-09-01`, ve la corrección de agosto, pero no el label humano del 4 de octubre; el del 1 de noviembre, el de `ds-2026-10-01`, sí. Los dos snapshots son correctos, cada uno para su fecha. El juguete no aplica la regla de 30 días de quien vende: sus elecciones del 27 y 28 de agosto ya la cumplen el 1 de octubre. (Las horas se comparan como texto porque todas van en [[iso-8601|ISO 8601]] y en UTC: del año al minuto, así que el orden del texto es el del tiempo.)

:::nota Eventos de verdad
En el juguete, los eventos son una lista. En Alba son una tabla de solo agregar (*append-only*) en el [[data-lake|data lake]], el bucket donde la empresa guarda sus datos crudos, [[particion-datos|particionada]] por día (una carpeta por fecha). La regla «el más reciente gana» es la misma que un [[upsert]] (insertar la fila o, si ya existe, reemplazarla), pero hecha al leer, no al escribir: por eso la historia sobrevive.
:::

### El split: por vendedor y con hash

En «Datos, ejemplos, features y etiquetas» viste por qué Alba reparte por vendedor y no por foto: si las fotos de un mismo vendedor cayeran en train y en validación, el modelo reconocería «la mesa de este vendedor» y validación saldría mejor de lo que es. Ahora falta que el reparto sea **el mismo cada mes**.

:::formula El split por hash
text{cubeta} = H(text{seller_id}) text{ mod } 100
text{train si cubeta} < u, text{ validación si no}
- H: la función hash SHA-256, leída como un número entero
- text{seller_id}: el id de quien vende, como texto
- text{cubeta}: el residuo de dividir ese número entre 100, de 0 a 99
- u: el umbral de cubeta; en Alba, 95: el 95 % de los vendedores va a train
:::

La función hash da siempre el mismo número para el mismo texto (lo viste como [[asignacion-hash|asignación con hash]]). Por eso el vendedor `s-309` cae en la cubeta 95 hoy, el mes que entra y dentro de diez años: siempre en validación. Un vendedor nuevo cae donde le toque, sin mover a nadie.

### Split estable: que nada de validación se mueva

Un [[split-estable|split estable]] es un reparto en el que cada foto cae en train o en validación **una vez y se queda ahí** en todas las versiones. Las fotos nuevas se reparten sin mover las viejas. La regla de Alba lo dice sin matices: ninguna foto de validación de `ds-2026-09-01` puede estar en train en `ds-2026-10-01`.

¿Qué pasa si no? Imagina que cada mes se sortea el split otra vez, al azar, con 95 % a train. Cada foto de validación de septiembre tiene 95 % de probabilidad de caer en train en el snapshot de octubre.

:::formula Lo que se mueve si se sortea otra vez
Y = V × frac{u}{100}
W = 1 − (frac{u}{100})^T
- V: fotos de validación del snapshot viejo
- u: el umbral de cubeta, 95, que aquí funciona como el porcentaje a train
- Y: fotos de esa validación que el sorteo nuevo manda a train, en promedio
- T: meses en que se sortea otra vez
- W: fracción de todas las fotos que estuvo en validación por lo menos uno de esos meses, de 0 a 1
:::

:::cuenta Sortear el split cada mes
Validación de septiembre, \(V\) // la ficha de Alba | `ds-2026-09-01` | 92,417 fotos
Umbral, \(u\) | hash mod 100 < 95 → train | 95
Se mueven a train en el snapshot de octubre, \(Y = V × u/100\) | 92,417 × 0.95 | ≈ 87,796 fotos
Meses sorteando, \(T\) | un año | 12
Nunca en validación en 12 sorteos, \((u/100)^T\) | 0.95¹² | ≈ 0.540
Alguna vez en validación, \(W = 1 − (u/100)^T\) | 1 − 0.540 | ≈ 0.460 = 46 %
= Con un sorteo nuevo cada mes, el modelo de noviembre entrena con ≈ 87,796 de las fotos con que se validó el de octubre, y en un año casi la mitad de las fotos pasó por validación. Comparar dos modelos así es comparar uno que ya vio el examen contra otro que no.
:::

:::calculadora e02-versionado-split
Empieza con la validación de septiembre y un año de sorteos. Baja \(u\) a 80: se mueven menos fotos por mes, pero en un año casi todas pasaron por validación. Con el split por hash, el número que se mueve es siempre cero.
:::

El golden set tiene su propia regla, más dura: nunca entra al entrenamiento. Con el manifest ya armado, antes de publicarlo, se cruzan sus huellas SHA-256 contra las 50,000 de `golden-v3`; si aparece una, el paso se detiene. Cuando el golden set se refresca, no se edita: se crea `golden-v4`, y se vuelve a medir al modelo actual con él.

## Cuatro formas de versionar {Four ways to version data} [extra]

Lo de las secciones anteriores es una forma de versionar. Hay otras, y conviene saber cuándo cada una es la buena.

### 1. Prefijos inmutables y manifest

Es lo que hace Alba: un prefijo por versión (`datasets/ds-2026-09-01/`), un manifest en Parquet, una tarjeta y una política del bucket que impide pisar. No hay que instalar nada: es S3, un formato de archivo y unas reglas. Funciona muy bien cuando el dataset son **muchos archivos que no cambian** (fotos) y lo que cambia por versión es qué fotos entran y con qué label.

### 2. DVC: Git para los datos

[[dvc|DVC]] (*Data Version Control*) es una herramienta de código abierto que se usa junto con Git. Para cada archivo o carpeta de datos calcula una huella y la guarda en un archivo chiquito, de texto, que sí va a Git; los datos de verdad suben a un almacén aparte, como un bucket de S3. Hacer `git checkout` de un commit viejo (volver el código a como estaba en ese commit) y luego `dvc checkout` devuelve también los datos de ese commit. Es la misma idea que [[git-lfs|Git LFS]], que guarda en Git solo un puntero a cada archivo grande, pero pensada para datasets y con pasos de pipeline.

Es cómodo para equipos chicos y datasets de hasta cientos de miles de archivos. Con millones de archivos chicos, calcular y comparar todas las huellas se vuelve lento.

### 3. lakeFS: ramas sobre el bucket

[[lakefs|lakeFS]] pone encima de un bucket lo que Git pone encima de una carpeta: [[rama|ramas]] (*branches*, líneas de trabajo paralelas), commits y [[merge|merges]] (juntar una rama con otra), sin copiar los datos. Crear una rama de un dataset de 400 GB tarda lo mismo que crear una de 1 KB, porque no se copia nada: la rama nueva apunta al mismo commit, y solo lo que se escriba después en ella es distinto. Su uso estrella es escribir, auditar, publicar: el job escribe en una rama, unos chequeos (*hooks*) corren antes del merge, y el merge a `main` publica todo de golpe. Desde la versión 1.87.0 (22 de septiembre de 2026) su licencia, el documento que dice qué se permite hacer con el programa, es la BSL 1.1, ya no Apache 2.0 (una licencia abierta que deja hacer casi todo): se puede usar sin pagar dentro de la empresa, en producción, siempre que no se modifique, pero no ofrecerlo como servicio a gente de fuera. Antes de adoptarlo, alguien tiene que leer el texto de la licencia.

### 4. Tablas con time travel

Un [[formato-tabla|formato de tabla]], como Delta Lake o Apache Iceberg, convierte un montón de archivos Parquet en una tabla con transacciones: un registro aparte dice qué archivos forman cada versión. Lo viste en «Object storage, data lakes y warehouses» como la pieza del [[lakehouse]]: archivos baratos en un bucket que se consultan como si fueran una base de datos. Con ese registro se puede leer la tabla como estaba en una versión o una fecha: el [[time-travel|time travel]].

Es la buena opción cuando los datos son **tablas que cambian fila por fila**: transacciones, precios, features de clientes. Ahí no hay «fotos que no cambian»: hay filas que se corrigen y se borran todos los días.

| | Prefijos + manifest | DVC | lakeFS | Delta / Iceberg |
|---|---|---|---|---|
| Qué versiona | listas de archivos | archivos y carpetas | todo un bucket | tablas |
| Dónde vive la versión | un prefijo y su tarjeta | un archivo chico en Git | un commit de lakeFS | el registro de la tabla |
| Ramas para probar | no | las de Git | sí, sin copiar | Iceberg sí (ramas y *tags*); Delta no |
| Hay que operar | nada | casi nada | un servidor y su base | un motor de consultas que lo lea (Spark, Trino…) |
| Lo malo | sin la política, convención | lento con millones de archivos | otro sistema que mantener | la retención borra el pasado |
| Le conviene a | fotos que no cambian | equipos chicos | equipos grandes con muchos jobs | datos tabulares que cambian |

¿Y Alba? Su equipo de ML es de 5 personas y su dataset son fotos que no cambian, citadas por huella. Prefijos con manifest le bastan, y no tiene que operar nada nuevo. Si el equipo creciera y varias personas armaran datasets a la vez, lakeFS le daría ramas para que cada quien pruebe sin pisar a los demás. Si sus datos fueran tablas que cambian, como las [[feature|features]] (los datos de entrada del modelo) de un sistema de fraude, usaría Iceberg o Delta.

:::ojo El time travel no es un archivo
Delta e Iceberg dejan leer el pasado, pero no para siempre. Para no pagar archivos viejos, la limpieza de cada tabla borra las versiones que pasan de una edad: en Delta, por omisión, el registro guarda 30 días de historial, pero la limpieza de archivos (`VACUUM`), si corre con su valor por omisión, borra los de las versiones de más de 7, y sin ellos no se puede leer la versión; en Iceberg, la limpieza borra por omisión las de más de 5 días (lo viste en «Object storage, data lakes y warehouses»). Si un modelo se entrenó con «la tabla al 1 de septiembre» y en diciembre alguien quiere repetirlo, lo más probable es que esa versión ya no exista.
:::

:::profundo Cómo se protege una versión que tiene que durar
Una versión de tabla se puede volver reproducible solo si se marca aparte. La regla es una desigualdad:

:::formula ¿Se puede releer una versión?
E ≤ L
- E: la edad de la versión, en días: cuántos días pasaron desde que se escribió
- L: la retención de esa versión, en días: cuánto la guarda la herramienta antes de que la limpieza la borre
:::

Un modelo que se entrenó con la tabla al 1 de septiembre de 2026 y se revisa el 15 de diciembre: \(E\) = 105 días (la cuenta está en el ejercicio de abajo). Con \(L\) = 30 días de Delta (o 7, si corre `VACUUM`), \(E > L\): no se puede.

La salida es un *tag* con su propia retención: un nombre fijo que se le pone a una versión, como un [[tag-git|tag de Git]] (aquí no es la etiqueta de una foto). En Iceberg, con Spark SQL (el lenguaje de consultas de Spark, un motor para datos grandes), se ve así (ilustración):

`ALTER TABLE ventas CREATE TAG septiembre RETAIN 365 DAYS`

y después se lee con `SELECT … FROM ventas VERSION AS OF 'septiembre'`. Ahora \(L\) = 365 para esa versión, y la limpieza no la toca. Lo mismo que el prefijo inmutable de Alba, pero dentro de la tabla. La retención de cada tag se decide pensando en cuánto vive el modelo y cuánto pide legal, no en lo que trae la herramienta por omisión.

Delta no tiene tags. Ahí hay dos salidas: subir la retención de toda la tabla (`delta.logRetentionDuration` y `delta.deletedFileRetentionDuration`), y pagar por guardar todos los archivos viejos de ese plazo, o copiar aparte la versión que usó el modelo.
:::

Para practicar esta sección, con lápiz:

:::ejercicios
? [facil] ¿Qué forma de versionar elegirías en cada caso: (a) 2 personas con 30,000 fotos de un proyecto de la escuela; (b) un equipo de 40 personas con decenas de jobs que escriben al mismo lake; (c) una tabla de transacciones de tarjeta que se corrige todos los días; (d) Alba?
- (a) **DVC**: el dataset cabe y el equipo ya usa Git.
- (b) **lakeFS**: cada job escribe en su rama y se publica con un merge después de los chequeos.
- (c) **Iceberg o Delta**, guardando cada versión que use un modelo: con un tag de retención larga en Iceberg, o con una retención larga en la tabla o una copia en Delta.
- (d) **Prefijos inmutables con manifest**: fotos que no cambian, equipo de 5, nada que operar.
? [medio] Un sistema de fraude guarda sus features en una tabla Delta con la retención por omisión (30 días de historial; 7 para los archivos, si corre `VACUUM`). Su modelo se entrenó con la tabla al 1 de septiembre de 2026, y el 15 de diciembre una auditoría pide repetir el entrenamiento. ¿Se puede? ¿Qué debió hacer el equipo, y hasta qué fecha alcanzaría?
- La regla: se puede releer si \(E ≤ L\). La edad de esa versión el 15 de diciembre es \(E\) = 29 (lo que queda de septiembre después del día 1) + 31 + 30 + 15 = **105 días**. Con \(L\) = 30 (o 7), \(E > L\): **no se puede**; la limpieza ya pudo borrarla.
- Delta no tiene tags. Al entrenar, debió subir la retención de la tabla (`delta.logRetentionDuration` y `delta.deletedFileRetentionDuration`), por ejemplo a 365 días, o copiar aparte esa versión. Con \(L\) = 365, se puede releer hasta el **1 de septiembre de 2027**.
:::

## Linaje y reproducibilidad {Lineage and reproducibility}

### Tres punteros y un poco más

El [[linaje]] (*lineage*) es la cadena de qué salió de qué: este modelo salió de este snapshot, armado por este código, con fotos que tienen estas huellas. Se guarda como punteros, no como copias.

Cada modelo que Alba registra guarda tres punteros:

- **El snapshot**: su id, `ds-2026-09-01`, y su huella, `rows_sha256`.
- **El commit del código de entrenamiento**: `c3f2fc2` en el ejemplo.
- **El [[digest-imagen|digest]] de la imagen de entrenamiento**. Aquí «imagen» no es una foto: es la imagen de un [[contenedor]], el paquete que trae el programa con todo lo que necesita para correr, con las versiones exactas de Python, PyTorch y CUDA. Su digest es su huella SHA-256: dice exactamente qué paquete corrió.

Y además, junto a los pesos: `labels.json`, el archivo que traduce cada `label_id` a su nombre («17 → Calzado › Tenis»), con su huella, y la versión del [[preprocesamiento]] (cómo se achica y se normaliza cada foto antes de entrar al modelo). Si alguien cambiara el orden de las categorías sin cambiar los pesos, el modelo diría «Tenis» cuando quiere decir «Botas»; la huella de `labels.json` lo delata.

Todos viven en el [[registro-modelos|registro de modelos]], que en Alba es MLflow; lo ves a fondo en «Gate de evaluación y registry». Aquí importa qué guarda, no la herramienta.

Ojo con los nombres: el snapshot se llama por el mes que **cubre**, y el modelo, por el día en que se entrena. La corrida del 1 de octubre arma `ds-2026-09-01`, el snapshot de septiembre, y ese mismo día entrena con él `resnet50-2026-10-01`. El modelo pasa el gate (la evaluación que decide si es mejor que el actual), recibe uno o dos días copias del tráfico y luego una parte creciente del real, y en la primera semana de octubre ya atiende todo. Por eso `resnet50-2026-10-01` ← `ds-2026-09-01`, y `resnet50-2026-11-01` ← `ds-2026-10-01`.

:::diagrama e02-versionado-linaje
El linaje de un modelo de Alba, de la respuesta que da en producción hasta cada foto. Recorre las dos preguntas: con qué datos se entrenó y en qué modelos está una foto.
:::

### Contestar las tres preguntas

Con los punteros, las tres preguntas del principio son mecánicas:

- **«¿Con qué datos se entrenó el modelo de octubre?»** El registro dice `ds-2026-09-01` y su huella. Se lee la tarjeta, se comprueba la huella, se abre el manifest: 1,932,628 filas, cada una con su foto y su label.
- **«¿Cambió el código o los datos?»** Se comparan los punteros de los dos modelos. Si el commit es el mismo y el snapshot no, cambiaron los datos; si es al revés, el código. Si cambiaron los dos, se repite uno con el otro fijo.
- **«¿En qué modelos está la foto de Ana?»** Se busca su huella en la columna `image_sha256` de los manifests, y cada snapshot que la tiene apunta a los modelos que lo usaron.

Sin linaje, cada una de esas preguntas es una semana de arqueología: revisar [[notebook|notebooks]], preguntar quién corrió qué, adivinar.

### Reproducibilidad: cinco ingredientes

La [[reproducibilidad]] es poder volver a entrenar un modelo y obtener el mismo resultado. Un entrenamiento tiene cinco ingredientes, y cada uno se fija con su puntero:

| Ingrediente | Qué es | Cómo lo fija Alba |
|---|---|---|
| Código | el programa de entrenamiento | el commit, con el árbol limpio |
| Datos | qué fotos y con qué label | el snapshot y su `rows_sha256` |
| Configuración | la receta: [[learning-rate\|learning rate]] 3e-4 (0.0003), [[batch]] de 64 fotos, 8 [[epoch\|épocas]] (pasadas por todos los datos) | un archivo en el repositorio, en el mismo commit |
| Entorno | Python, PyTorch, [[cuda\|CUDA]] y los [[driver\|drivers]] de la GPU | el digest de la imagen de entrenamiento |
| Aleatoriedad | el orden de las fotos, las variaciones al azar | la [[semilla]], 17: el número con que arranca el azar del programa |

Uno que falla mucho: «el árbol limpio». Un commit dice qué código había **guardado**; si el script tenía cambios sin commit cuando corrió, el puntero apunta a otro código. Por eso Alba no entrena desde la laptop de nadie: entrena desde el pipeline, que descarga una copia limpia del repositorio (lo *clona*) en ese commit y nada más.

### Mismo resultado, ¿qué tan mismo?

Aun con los cinco ingredientes fijos, en una [[gpu|GPU]] dos corridas casi nunca dan los mismos bits: algunas sumas se hacen en paralelo y en otro orden, y en números con decimales el orden cambia el último dígito ([[determinismo]] tiene la historia; «Entrenamiento y experimentos» la cuenta a fondo). Por eso hay tres niveles de «igual»:

1. **Bit a bit**: los mismos pesos (los números que el modelo aprendió), byte por byte. Caro y frágil en GPU.
2. **Dentro de tolerancia**: las métricas se parecen tanto como se parecen dos corridas con distinta semilla. Es el nivel de Alba.
3. **Estadístico**: el mismo comportamiento en promedio, sobre muchas corridas.

¿Cuánto es «tolerancia»? Alba mide la [[accuracy|exactitud]] (*accuracy*) en el golden set: qué porcentaje de las fotos clasifica bien. Las diferencias se cuentan en **puntos**: de 85.2 % a 85.3 % hay 0.1 puntos (porcentuales). Su regla: una repetición del modelo de octubre, que sacó 85.23 %, «se reprodujo» si queda a 0.26 puntos o menos, hacia arriba o hacia abajo. Si se va más lejos, algo de los cinco ingredientes cambió, y se busca cuál. El bloque de abajo dice de dónde sale el 0.26.

:::profundo De dónde sale la tolerancia: cinco semillas
Para saber cuánta tolerancia, Alba entrenó la misma receta con 5 semillas distintas y midió la exactitud de cada una en el golden set. La dispersión se mide con la [[desviacion-estandar|desviación estándar]]:

:::formula Desviación estándar de las semillas
x̄ = frac{1}{s} sum_{i=1}^{s} x_i
σ = sqrt{frac{1}{s − 1} sum_{i=1}^{s} (x_i − x̄)^2}
τ = 3 × σ
- s: cuántas corridas, cada una con otra semilla
- x_i: la exactitud de la corrida \(i\) en el golden set, en %
- x̄: el promedio de las \(s\) corridas, en %
- σ: la desviación estándar de las corridas, en puntos porcentuales
- τ: la tolerancia de Alba para decir «se reprodujo», en puntos: tres desviaciones
:::

:::cuenta Cuánto varían cinco semillas
Corridas, \(s\) // ilustrativo, del equipo de Alba | una por semilla | 5
Suma de las exactitudes, \(sum x_i\) // en % | 85.21 + 85.34 + 85.12 + 85.29 + 85.18 | 426.14
Promedio, \(x̄\) | 426.14 ÷ 5 | 85.228 ≈ 85.23 %
Diferencias, \(x_i − x̄\) // en puntos; siempre suman cero | −0.018, +0.112, −0.108, +0.062, −0.048 | suman 0
Suma de cuadrados // \(sum (x_i − x̄)^2\) | 0.000324 + 0.012544 + 0.011664 + 0.003844 + 0.002304 | 0.03068
Varianza, \(σ^2\) // la suma ÷ \((s − 1)\) | 0.03068 ÷ 4 | 0.00767
Desviación estándar, \(σ\) | \(sqrt{0.00767}\) = 0.0876 | ≈ 0.088 puntos
Tolerancia, \(τ = 3 × σ\) | 3 × 0.088 | ≈ 0.26 puntos
= \(τ\) ≈ 0.26 puntos: la distancia máxima a 85.23 % para decir que el modelo de octubre «se reprodujo».
:::

Compáralo con otra regla. Medir en el golden set también tiene margen de error: 50,000 fotos son una muestra, no todas las fotos. Es el [[intervalo-confianza|intervalo de confianza]] de «Ruido, muestras y pruebas A/B»: \(ε = 1.96 × sqrt{a(1 − a)/G}\), donde \(a\) es la exactitud como fracción (0.85), \(G\) son las fotos del golden set (50,000), \(ε\) es el margen, también como fracción, y 1.96 es el número que deja dentro el 95 % de los casos. Da ε ≈ 0.0031: ± 0.3 puntos. Las dos reglas dicen lo mismo con distinto origen: una diferencia de 0.2 puntos entre dos corridas no dice nada de la receta.

```python
import math, statistics

semillas = [85.21, 85.34, 85.12, 85.29, 85.18]   # exactitud top-1 en el golden, en %
media = statistics.mean(semillas)
sigma = statistics.stdev(semillas)                # desviación estándar de la muestra
tau = 3 * sigma                                   # tolerancia de Alba para repetir
print(f"media {media:.2f} %  ·  sigma {sigma:.3f}  ·  tolerancia {tau:.2f} puntos")

a, G = 0.85, 50_000                                # exactitud y fotos del golden
margen = 1.96 * math.sqrt(a * (1 - a) / G) * 100   # ε, el margen del 95 %, en puntos
print(f"margen del golden ± {margen:.2f} puntos")

for repetida in (85.41, 85.71):                    # dos intentos de repetir la de 85.23
    delta = repetida - 85.23
    print(f"{repetida}: {delta:+.2f} ->", "se reprodujo" if abs(delta) <= tau else "algo cambió")
```

```salida
media 85.23 %  ·  sigma 0.088  ·  tolerancia 0.26 puntos
margen del golden ± 0.31 puntos
85.41: +0.18 -> se reprodujo
85.71: +0.48 -> algo cambió
```
:::


## El pipeline mensual como DAG {The monthly pipeline as a DAG}

### Quién arma el snapshot cada mes

Nadie en Alba arma el snapshot a mano. Lo arma un programa que corre solo el día 1 de cada mes, a las 03:00 UTC, con los datos del mes que acaba de terminar. Ese programa es un [[orquestador-pipelines|orquestador de pipelines]]: decide **cuándo** corre cada paso y **en qué orden**, reintenta el que falla, guarda qué entró y qué salió de cada uno y avisa si algo se rompe. No procesa datos: los procesan los pasos.

Ojo con la palabra: la [[orquestacion|orquestación]] de Kubernetes (lección «Kubernetes») es otra cosa. Kubernetes es el sistema que, en Alba, arranca los [[contenedor|contenedores]] en un grupo de máquinas; su orquestación es mantener vivos los contenedores de un servicio. Un orquestador de pipelines corre tareas que empiezan y terminan.

Alba usa **Argo Workflows**, que corre en su mismo cluster de Kubernetes, ese grupo de máquinas: cada paso es un contenedor que arranca, hace su tarea y termina. Un **CronWorkflow** lo dispara el día 1 a las 03:00 UTC; si un paso falla, avisa a la persona de guardia. Otros orquestadores muy usados son Airflow, Dagster y Kubeflow Pipelines; la idea es la misma.

### El DAG: pasos y flechas

Un pipeline se describe como un [[dag|DAG]] (*directed acyclic graph*, grafo dirigido acíclico): pasos unidos por flechas que dicen «este va después de aquel», sin ciclos, porque un paso no puede esperar a uno que lo espera a él. El de Alba tiene 8 pasos, 4 de ellos con GPU en dos tipos de tarjeta (el fine-tune y evaluar, en una A10G; el engine y la paridad, en una T4):

validar datos → armar snapshot → fine-tune (GPU) → evaluar (GPU) → gate → construir el engine en una T4 (GPU) → paridad (GPU) → registrar

El [[fine-tuning|fine-tune]] ajusta a las 500 categorías de Alba, con el snapshot nuevo, una ResNet-50 que ya viene entrenada con millones de fotos genéricas. El gate decide si el modelo nuevo es mejor que el actual. El engine es el modelo convertido para correr rápido en la GPU de producción, una NVIDIA T4. La [[prueba-paridad|paridad]] comprueba que el engine responda lo mismo que el modelo original. Cada uno tiene su lección; aquí importa el orden.

Cada paso recibe sus entradas de forma **explícita**: el snapshot por su id, el código por su commit, la receta como parámetros. Así el orquestador puede guardar el linaje de cada corrida sin que nadie lo escriba.

En Argo, la corrida del 1 de octubre recibe su fecha como parámetro; el paso que arma el snapshot calcula con ella el mes anterior y arma `ds-2026-09-01`; y el fine-tune recibe ese id como salida del paso anterior. Un paso nunca pregunta «¿cuál es el más nuevo?».

:::profundo Cómo se declara en Argo
Una ilustración de cómo se declara (un pedazo, simplificado; Argo usa [[yaml|YAML]], un formato de texto que marca qué va dentro de qué con la sangría):

```yaml
apiVersion: argoproj.io/v1alpha1
kind: CronWorkflow
metadata: { name: reentreno-mensual }
spec:
  schedules: ["0 3 1 * *"]       # minuto 0, hora 3, día 1, cualquier mes
  timezone: "UTC"
  workflowSpec:
    entrypoint: mensual
    templates:
      - name: mensual
        dag:
          tasks:
            - { name: validar, template: validar }
            - name: snapshot                 # la corrida del 2026-10-01 arma ds-2026-09-01
              template: armar
              dependencies: [validar]
              arguments:
                parameters:
                  - name: corrida
                    value: "{{workflow.creationTimestamp.Y}}-{{workflow.creationTimestamp.m}}-01"
            - name: fine-tune
              template: entrenar
              dependencies: [snapshot]
              arguments:
                parameters:
                  - name: snapshot           # el id que armó el paso anterior
                    value: "{{tasks.snapshot.outputs.parameters.id}}"
            - { name: evaluar, template: evaluar, dependencies: [fine-tune] }
```

Fíjate en `dependencies`: eso son las flechas del DAG. Los parámetros hacen lo que viste arriba: la fecha de la corrida entra, y el id del snapshot pasa de un paso al siguiente.
:::

### La caché y la trampa de latest

Un orquestador puede guardar la salida de cada paso y reusarla si el paso vuelve a correr con las mismas entradas: es la [[cache-pipeline|caché de pasos]]. Si el fine-tune ya corrió con este código, esta receta y este snapshot, ¿para qué gastar otras 3–4 horas de GPU? En Argo se llama *memoization*, se prende por paso y la llave la escribe quien define el paso, casi siempre con sus parámetros; en Kubeflow Pipelines viene prendida y el orquestador arma la llave solo.

:::formula La llave de la caché
text{llave} = H(text{código} + text{parámetros} + text{entradas})
- text{llave}: lo que el orquestador busca entre las salidas guardadas
- H: la función hash, la misma del split
- text{código}: el código del paso, por su commit
- text{parámetros}: la receta y los demás parámetros, escritos como texto
- text{entradas}: las entradas como las recibe el paso: rutas o ids, no lo que hay guardado en ellas
:::

Cuando una entrada llega como una ruta de texto, el orquestador no mira qué hay dentro: hashea **cómo se llama**. Si una entrada se llama `datasets/latest` y el contenido de esa carpeta cambió, el nombre no cambió, la llave es la misma, y el orquestador reusa la salida vieja.

```python
import hashlib, json

cache = {}                                        # llave -> salida guardada del paso

def fine_tune(codigo, params, entrada, corrida):
    llave = hashlib.sha256(json.dumps([codigo, params, entrada]).encode()).hexdigest()[:10]
    if llave in cache:
        return f"{corrida}: llave {llave} -> reusa {cache[llave]}"
    cache[llave] = f"modelo entrenado con lo que había en '{entrada}' el {corrida}"
    return f"{corrida}: llave {llave} -> entrena"

receta = {"lr": 3e-4, "epocas": 8, "batch": 64, "semilla": 17}
print(fine_tune("c3f2fc2", receta, "datasets/latest", "1 oct"))
print(fine_tune("c3f2fc2", receta, "datasets/latest", "1 nov"))   # la carpeta ya cambió
print(fine_tune("c3f2fc2", receta, "ds-2026-09-01", "1 oct"))
print(fine_tune("c3f2fc2", receta, "ds-2026-10-01", "1 nov"))
```

```salida
1 oct: llave 10d32e075f -> entrena
1 nov: llave 10d32e075f -> reusa modelo entrenado con lo que había en 'datasets/latest' el 1 oct
1 oct: llave 4dec1a924f -> entrena
1 nov: llave 7262ec1bc5 -> entrena
```

Con `latest`, la corrida de noviembre «entrena» en cero segundos y registra un modelo nuevo que es el de octubre. Nadie se entera: el pipeline sale verde. Con el id del snapshot como parámetro, cada mes tiene su llave. La regla: **toda entrada que cambia el resultado tiene que ser un parámetro o un artefacto con nombre fijo**, nunca una carpeta que cambia de contenido.

:::figura e02-versionado-cache
La misma receta, dos meses. Con `latest`, la llave de noviembre es igual a la de octubre y se reusa el modelo viejo. Con el id del snapshot, la llave cambia y el paso corre.
:::

### Tres propiedades de un buen paso

Para que el orquestador pueda reintentar y repetir sin miedo, cada paso que procesa datos cumple tres cosas:

- **Particionado**: trabaja sobre un pedazo con nombre, como un día (la carpeta `dt=2026-09-28`, donde `dt` es la fecha) o un snapshot, no sobre «todo».
- **Idempotente**: correrlo dos veces deja lo mismo que correrlo una ([[idempotencia]], de «Timeouts, reintentos e idempotencia»). Reescribe su partición entera; no agrega filas al final.
- **Backfillable**: la fecha llega como parámetro, nunca la lee del reloj con `now()`, la función que devuelve la hora actual. Así se puede correr para el pasado, que es un [[backfill]]: recalcular fechas viejas.

La tercera tiene una trampa doble. Un paso que usa `now()` no se puede repetir para septiembre; y una [[feature]] (un dato de entrada del modelo) calculada con `now()` en vez de con la hora del ejemplo mira el futuro: usa información que en ese momento todavía no existía. Eso es [[leakage]].

:::profundo Cuánto tarda un backfill, y por qué se le pone tope
Un backfill recorre muchas particiones. Si cada una tarda lo mismo, la cuenta es:

:::formula Duración de un backfill
D = ⌈frac{P}{j}⌉ × d
- P: particiones que hay que recalcular, por ejemplo días
- j: cuántas corren a la vez
- d: minutos que tarda cada partición
- D: minutos que tarda todo; ⌈ ⌉ redondea hacia arriba, porque la última tanda cuenta entera
:::

:::cuenta Recalcular 180 días de una feature
Particiones, \(P\) // supuesto: una feature nueva de un sistema de pronóstico de demanda | 180 días | 180
Minutos por partición, \(d\) | supuesto | 20 min
En serie, \(j\) = 1 | ⌈180 ÷ 1⌉ × 20 | 3,600 min = 60 h
Doce a la vez, \(j\) = 12 | ⌈180 ÷ 12⌉ × 20 = 15 × 20 | 300 min = 5 h
= Con 12 a la vez, de dos días y medio a 5 horas. Pero 12 jobs leyendo al mismo tiempo pueden saturar la base o el bucket de donde leen: por eso el orquestador lleva un tope de paralelismo, y no se sube sin medir.
:::
:::

## Borrar sin romper la historia {Deleting without breaking history} [extra]

Inmutable no quiere decir eterno. Una persona tiene derecho a pedir que borren sus datos ([[derecho-borrado|derecho al borrado]], de «Datos personales y la ley»), y un snapshot que nadie puede tocar parece chocar con eso. No choca, si se diseña.

### Ana pide borrar

El 20 de octubre de 2026, Ana, una vendedora de Ciudad de México, pide que borren sus datos. Sus fotos viejas están en `ds-2026-09-01`, el snapshot con que se entrenó el modelo que está en producción.

Los pasos generales los cuenta «Datos personales y la ley» ([[derecho-borrado|derecho al borrado]]): encontrar cada copia, borrarla, decidir qué pasa con el modelo y dejar constancia. Aquí, lo que agrega el linaje:

:::pasos
1. Encontrar con las huellas
Con las huellas SHA-256 de las fotos de Ana se consulta la columna `image_sha256` de todos los manifests, del golden set y de las fotos que salieron a etiquetar (`labeled/`): aparecen en `ds-2026-09-01` y en los snapshots anteriores que las traigan. El de octubre todavía no existe: se arma el 1 de noviembre.
2. Anotar, no reescribir
El producto borra las fotos originales, pero los snapshots viejos no se tocan. Sus huellas entran a un **registro de borrados**, una lista de solo agregar con la huella, la fecha y el motivo. El snapshot siguiente, `ds-2026-10-01`, ya no las incluye.
3. Los modelos
`resnet50-2026-10-01`, en producción, tiene a Ana y sirve hasta que lo reemplaza `resnet50-2026-11-01`, entrenado con `ds-2026-10-01`, que ya no la trae.
:::

No confundas dos registros: el de auditoría, de esa lección, es la constancia de que se borró, qué y cuándo; el de borrados es la lista de huellas que lee el pipeline, para que cada entrenamiento respete el borrado.

### Por qué no reescribir

¿No sería más fácil reescribir `ds-2026-09-01` sin las fotos de Ana? Se rompería todo lo que apunta a él: la huella de `resnet50-2026-10-01` ya no coincidiría, y no habría forma de saber si cambió por un borrado legítimo o por un error. Anotar deja la historia intacta y dice exactamente qué falta y por qué.

Al leer un snapshot para entrenar, el pipeline aplica el registro: se salta cada fila cuya huella esté ahí, y el modelo guarda cuántas filas saltó y hasta qué fecha leyó el registro. Ese número es parte del linaje. Si un día se quiere repetir `resnet50-2026-11-01`, se lee `ds-2026-10-01` con el registro hasta esa fecha.

Una pregunta queda para legal, no para ingeniería: cuánto tiempo puede seguir sirviendo un modelo entrenado con datos borrados. En Alba, como mucho hasta el reemplazo mensual: para Ana, del 20 de octubre a la primera semana de noviembre, unas dos o tres semanas. Si la ley pidiera menos, se adelanta un reentrenamiento: 3–4 horas y US$10–50 en una GPU.

:::analogia El periódico y la fe de erratas
Un periódico no reimprime el número de ayer cuando encuentra un error: publica una fe de erratas en el de hoy, y la biblioteca guarda los dos. Quien lea el de ayer sabe qué decía, y quien lea la fe de erratas sabe qué cambió. El registro de borrados es la fe de erratas de los snapshots.

Donde se rompe: la fe de erratas deja leer el error; el registro de borrados no. Las fotos de Ana sí se borran de verdad del almacenamiento: lo que queda en el manifest viejo es su huella, que no deja reconstruir la foto, y aun así se trata como dato personal.
:::

## Errores comunes {Common mistakes}

**Escribir el snapshot en una carpeta `latest`.** Cada mes la carpeta cambia de contenido y el nombre no. Un modelo que dice «me entrené con `latest`» no dice nada, y la caché del pipeline reusa el resultado viejo. Cómo evitarlo: un id con fecha por snapshot, pasado como parámetro, y `latest`, si existe, solo como un puntero de lectura que ningún paso usa.

**Creer que el versionado del bucket o Object Lock impiden pisar.** Protegen cada versión, pero un `PUT` a la misma llave crea otra versión que pasa a ser la que se lee. Cómo evitarlo: escritura condicional exigida por la política del bucket, y comprobar `rows_sha256` antes de entrenar.

**Confiar en el time travel para reproducir un modelo de hace meses.** La limpieza de Delta o Iceberg borra las versiones viejas: por omisión, en días o semanas. Cómo evitarlo: en Iceberg, un *tag* (un nombre fijo para una versión) con su propia retención por cada versión que use un modelo; en Delta, que no tiene tags, una retención más larga en la tabla o una copia de esa versión; en cualquiera, un snapshot propio con manifest.

**Sortear el split otra vez en cada versión.** En un mes, ≈ 87,796 de las 92,417 fotos de validación de Alba pasarían a train, y las métricas de un modelo y el siguiente dejan de ser comparables. Cómo evitarlo: split por hash del `seller_id`, que pone a cada vendedor siempre del mismo lado.

**Corregir un label reescribiendo la fila.** Se pierde qué label había antes, y un snapshot viejo ya no se puede explicar. Cómo evitarlo: labels como eventos; corregir es agregar uno nuevo.

**Entrenar con cambios sin commit.** El modelo guarda un commit que no es el código que corrió. Cómo evitarlo: entrenar solo desde el pipeline, que clona el commit y revisa que el árbol esté limpio.

**Usar el commit del snapshot como si fuera el del modelo.** `4be1d0a` armó el snapshot; `c3f2fc2` entrenó el modelo. Cómo evitarlo: cada artefacto guarda el commit del código que lo produjo, con un nombre de campo que diga cuál es.

## En la vida real {In real life} [extra]

**Alba.** Una vez al mes, un CronWorkflow de Argo arma el snapshot, lo audita, lo publica con escritura condicional y entrena. Cuando algo sale raro en producción, la respuesta lleva `model_version: resnet50-2026-10-01`, y de ahí se llega en minutos a cada foto con que se entrenó.

**Inspección en una fábrica.** Un sistema de visión revisa piezas en una línea y aparta las defectuosas. Cuando un cliente reclama, la pregunta es «¿qué modelo decidía en la línea 2 el martes a las 14:00, y con qué datos se entrenó?». Con linaje se contesta en minutos. Los veredictos de quien inspecciona se guardan como eventos que no se sobrescriben, igual que los labels de Alba.

**OCR de documentos con revisión humana.** Un sistema que lee el texto de documentos escaneados (OCR) y los manda a revisar cuando duda tiene que poder decir, para cada decisión, qué modelo leyó, con qué dataset se entrenó, qué contenedor corría y quién revisó. Son los punteros de Alba, más el revisor, porque una auditoría externa los pide.

**Recomendación.** Un sistema que ordena productos para cada persona guarda, con cada lista que mostró, qué features vio el modelo en ese momento. Sin eso, no puede entrenar el siguiente modelo con lo que de verdad pasó: las features de hoy no son las de ayer.

**Pronóstico de demanda.** Los datos son tablas de ventas que se corrigen todos los días (devoluciones, ventas que llegan tarde). Ahí la herramienta natural es una tabla Iceberg o Delta, y cada entrenamiento nocturno fija la versión de la tabla al arrancar y la registra con el modelo.

**Fuera de ML.** Un laboratorio clínico guarda la muestra, el reactivo con su lote, el equipo y quién hizo el análisis. Si un lote de reactivo sale malo, sabe qué resultados revisar. Es linaje, con otro nombre: trazabilidad.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los del tamaño del snapshot y del split se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Un equipo quiere agregar al manifest de Alba dos columnas más y calcula que cada fila pasará de ≈ 200 B a ≈ 260 B. Con las 1,932,628 filas de septiembre y fotos de ≈ 200 KB, ¿cuánto pesa el manifest sin comprimir, y qué fracción de las fotos citadas es?
- Con \(M = N × r\): 1,932,628 × 260 B ≈ 502 MB, ≈ **0.5 GB** sin comprimir.
- Fracción \(r ÷ f\) = 260 ÷ 200,000 = 0.0013 = **0.13 %**. Sigue siendo casi nada: no depende de cuántas fotos haya.
? [facil] Con la regla de Alba, cubeta = \(H\)(seller_id) mod 100 y train si la cubeta es menor que \(u\) = 95, cuatro vendedores caen en las cubetas 12, 94, 95 y 99. ¿A dónde va cada uno? En la versión siguiente alguien propone \(u\) = 90 «para tener más validación». ¿Qué pasa con el split estable?
- Cubetas 12 y 94: **train** (menores que 95). Cubetas 95 y 99: **validación**.
- Con \(u\) = 90, los vendedores con cubeta de 90 a 94 pasan de train a validación. El modelo viejo se entrenó con sus fotos, así que si se mide en la validación nueva, lleva ventaja: ya vio parte del examen. El split dejó de ser estable.
- Si de verdad hace falta más validación, se agregan vendedores **nuevos** a validación (por ejemplo, una regla aparte para los que llegaron después de cierta fecha) sin mover a los viejos.
? [facil] Una foto tiene estos eventos de label: el 3 de agosto, «Hogar › Lámparas» de quien vende; el 25 de agosto, «Hogar › Focos» de moderación; el 2 de septiembre, «Hogar › Lámparas» de la cola humana, con `guia-v4`. ¿Qué label trae `ds-2026-08-01`, el snapshot de agosto, con corte el 1 de septiembre? ¿Y `ds-2026-09-01`, con corte el 1 de octubre?
- `ds-2026-08-01` (corte 1 de septiembre): el evento más reciente **antes** del corte es el del 25 de agosto: **«Hogar › Focos»**, de moderación. El del 2 de septiembre todavía no existía.
- `ds-2026-09-01` (corte 1 de octubre): el del 2 de septiembre, **«Hogar › Lámparas»**, de la cola humana con `guia-v4`.
- Ninguno de los dos está mal: cada uno es correcto para su fecha. Y el snapshot de agosto no se corrige: la corrección entra al de septiembre.
? [medio] Un backfill tiene que recalcular 90 días de una feature; cada día tarda 15 minutos y el orquestador permite 10 a la vez. ¿Cuánto tarda en serie y cuánto con 10? Si el día 47 falla, ¿qué se repite y qué tiene que cumplir el paso?
- Con \(D = ⌈P/j⌉ × d\): en serie, 90 × 15 = 1,350 min = **22.5 h**. Con \(j\) = 10: ⌈90 ÷ 10⌉ × 15 = 9 × 15 = **135 min ≈ 2.3 h**.
- Se repite **solo el día 47**. El paso tiene que ser idempotente: reescribe la partición `dt=` de ese día entera, y repetirlo deja lo mismo. Y la fecha llega como parámetro, no con `now()`.
? [medio] Para encontrar las fotos de Ana hay que leer la columna `image_sha256` de los 12 manifests del último año. Cada huella ocupa ≈ 32 B ya guardada en Parquet (sus 64 caracteres hexadecimales comprimidos no bajan de sus 32 B de información). ¿Cuántos bytes se leen, si cada manifest tiene ≈ 1,932,628 filas? ¿Por qué no hay que leer los 12 × 100 MB enteros?
- Bytes leídos = manifests × filas × bytes por huella. Por manifest: 1,932,628 × 32 B ≈ 61.8 MB. Los 12: 12 × 61.8 MB ≈ **742 MB**.
- No se lee todo porque Parquet guarda cada columna junta: se lee solo la de las huellas, como viste en «Archivos y formatos».
- Con las huellas de Ana se sabe en qué snapshots está, y cada snapshot dice qué modelos lo usaron.
? [reto] La ingeniera de guardia repite el entrenamiento de `resnet50-2026-10-01` y obtiene 85.71 % en el golden set, contra 85.23 % del original. La tolerancia de Alba es \(τ = 3 × σ\), con \(σ\) ≈ 0.088 puntos. ¿Se reprodujo? Si no, ¿en qué orden revisarías los cinco ingredientes y qué comparas en cada uno?
- \(τ\) = 3 × 0.088 ≈ 0.26 puntos. La diferencia es 85.71 − 85.23 = **0.48 puntos > 0.26**: no se reprodujo. Algo cambió.
- Primero los **datos**: ¿la tarjeta que leyó tiene el mismo `rows_sha256`? ¿Aplicó el mismo registro de borrados? Un snapshot distinto es la causa más común y la más fácil de ver.
- Luego el **código** y la **configuración**: el mismo commit, y que el árbol estuviera limpio en la corrida original.
- Luego el **entorno**: el mismo digest de la imagen de entrenamiento, y la misma clase de GPU.
- Al final la **aleatoriedad**: la semilla 17. Si todo coincide, corre 5 semillas: si la nueva cae dentro de la nube de las otras, el original fue la rara.
? [reto] El pipeline de Alba sale verde el 1 de noviembre, pero el modelo nuevo da exactamente las mismas métricas que el de octubre, a la centésima. ¿Qué sospechas? ¿Cómo lo confirmas con la tarjeta y la caché, y qué cambias para que no vuelva a pasar?
- Que el fine-tune **no corrió**: la caché reusó la salida de octubre porque su llave no cambió. Pasa si una entrada se llama igual cada mes, como `datasets/latest`.
- Se confirma en el historial del orquestador (el paso aparece como reusado, en segundos y no en horas) y en el registro: el modelo de noviembre apunta a la misma `rows_sha256` que el de octubre.
- Arreglo: el id del snapshot entra como parámetro (`ds-2026-10-01` en la corrida de noviembre), así que la llave cambia cada mes. Y un chequeo antes de registrar: si la huella del snapshot es igual a la del modelo anterior, se detiene.
? [reto] Diseña el versionado de un sistema de búsqueda por foto: cada mes se recalculan los vectores ([[embedding|embeddings]]: listas de números que resumen cada foto) de ≈ 100 millones de publicaciones activas con un modelo nuevo, y el índice, la estructura que encuentra rápido los vectores parecidos, se reconstruye. Los números son un supuesto del ejercicio. Di qué guarda el snapshot, qué punteros guarda cada índice y qué pasa si una persona pide borrar una publicación.
- El snapshot: un manifest con la llave y la huella de cada foto que entró al índice, la versión del modelo que hizo los vectores, y la fecha de corte de qué publicaciones estaban activas. Los vectores mismos sí se guardan (no se pueden «citar»), en un prefijo inmutable por versión.
- Cada índice guarda: el id del snapshot y su huella, el modelo de los vectores, el commit del código que construyó el índice y el digest de su imagen.
- Un borrado: la publicación sale del índice en vivo de inmediato (la búsqueda no puede devolverla). El snapshot viejo no se reescribe: la huella entra al registro de borrados, y el índice del mes siguiente ya no la trae.
:::

## Lo que sigue {What comes next}

- «Entrenamiento y experimentos» toma el snapshot de esta lección como entrada fija: corre el fine-tune, guarda cada corrida con sus parámetros y métricas, y cuenta por qué en una GPU la misma semilla no da los mismos bits.
- «Gate de evaluación y registry» decide si el modelo nuevo es mejor que el actual con el golden set, y registra la versión con los punteros que viste aquí.
- «Empaquetado con Docker» explica la imagen de contenedor y su digest, el tercer puntero.
- «Monitoreo, drift y reentrenamiento» cuenta cuándo se adelanta el reentrenamiento mensual y qué snapshot usa cuando pasa.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
versionado-datos manifest inmutabilidad escritura-condicional object-lock write-audit-publish label-evento split-estable ficha-dataset dvc lakefs formato-tabla time-travel linaje reproducibilidad orquestador-pipelines dag cache-pipeline
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué el snapshot de Alba pesa ≈ 0.1 % de las fotos que usa?
Porque no las copia: el manifest cita cada foto por su llave y su huella, ≈ 200 B por fila contra ≈ 200 KB por foto. La fracción es \(r ÷ f\) y no depende de cuántas fotos haya.
? ¿Qué hueco deja Object Lock que cierra la escritura condicional?
Object Lock protege cada versión, pero un PUT a la misma llave crea otra versión que pasa a ser la leída. Con `If-None-Match: *`, exigido por la política del bucket, ese PUT falla con 412.
? ¿Por qué la tarjeta se escribe al final?
Porque un snapshot sin tarjeta no existe: quien entrena la lee primero. Si el job se cae a la mitad, queda un manifest huérfano que nadie usa, no un snapshot a medias.
? ¿Qué es un split estable y cómo lo logra Alba?
Un reparto donde cada foto se queda siempre en train o siempre en validación, de versión en versión. Alba lo logra con un hash del `seller_id` mod 100: el mismo vendedor cae siempre en la misma cubeta.
? ¿Cuáles son los cinco ingredientes de un entrenamiento y qué puntero fija cada uno?
Código (el commit), datos (el snapshot y su huella), configuración (en el mismo commit), entorno (el digest de la imagen) y aleatoriedad (la semilla).
? ¿Por qué un paso de pipeline no debe recibir `datasets/latest`?
Porque la caché hashea el nombre de la entrada, no su contenido: el mes siguiente la llave es la misma y se reusa la salida vieja. Toda entrada que cambia el resultado va como parámetro con nombre fijo.
? Si Ana pide borrar sus fotos, ¿por qué no se reescribe el snapshot de septiembre?
Porque se rompería la huella que guarda el modelo de octubre y no se sabría si el cambio fue un borrado o un error. Se anota en el registro de borrados y el siguiente snapshot ya no las trae.
:::
