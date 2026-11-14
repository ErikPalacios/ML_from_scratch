---
titulo: Archivos y formatos: JSON, CSV, Parquet y YAML
en: Files and formats: JSON, CSV, Parquet and YAML
subtitulo: Cómo se escriben los datos en bytes para que otro programa, otro día, los lea igual: texto o binario, UTF-8, CSV, JSON Lines, YAML, compresión, Parquet por columnas, esquemas que cambian sin romper a nadie y archivos de pesos que no ejecutan nada al abrirse.
pregunta: La foto de Ana, cada predicción y el modelo entrenado terminan en archivos. ¿Cómo se escriben esos bytes para que otro programa los lea igual, y por qué el log de predicciones de Alba va en Parquet y no en CSV?
requisitos: apis, sistema-operativo
---

:::idea
Un archivo es solo una fila de bytes; el formato es el acuerdo que dice qué significa cada uno. Los formatos de texto (CSV, JSON, YAML) se leen a simple vista, pero ocupan más y adivinan los tipos. Los binarios (Parquet, Avro, safetensors) son compactos y traen su esquema. Para millones de registros que después se consultan por columnas, gana Parquet.
:::

Ana sube la foto de sus tenis a Alba, la empresa que seguimos en todo el curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Su servicio contesta ≈ 10 millones de fotos al día, y en ese camino la foto de Ana deja varios archivos. El JPEG de ≈ 200 KB que mandó la app se guarda. La predicción se escribe como una línea de *log* (el registro de lo que pasó) de unos 300 bytes. Y el modelo que la contestó vive en un archivo de pesos de ≈ 98 MB que alguien entrenó semanas antes.

Cada archivo lo escribe un programa y lo lee otro, a veces meses después y en otro lenguaje. Para que funcione, los dos tienen que estar de acuerdo, byte por byte, en qué significa cada cosa. Ese acuerdo es el formato.

Al final de la lección vas a poder contestar la pregunta del título con números: los ≈ 3 GB diarios de logs de Alba (10 millones de líneas de ≈ 300 bytes) bajan a unos cientos de MB en Parquet, y la revisión diaria de [[drift]] lee apenas una parte de eso.

## Un archivo es una fila de bytes {A file is a row of bytes}

En «El sistema operativo» viste que el [[sistema-archivos|sistema de archivos]] organiza el [[disco]] en carpetas y archivos, y que a cada archivo se llega por su [[ruta]]. Ahora abre uno.

Un [[archivo]] (*file*) es una fila de [[byte|bytes]] con nombre: el primero, el segundo, el tercero… hasta el último. Nada más. El sistema operativo sabe cuántos bytes mide, quién es su dueño y cuándo cambió, pero no sabe qué son.

Un byte es un número del 0 al 255, y nada en él dice si es una letra, un pedazo de un píxel o parte de un peso.

### El formato es un acuerdo

Un [[formato-archivo|formato de archivo]] (*file format*) es un acuerdo entre quien escribe y quien lee: qué va en cada posición, cómo se escribe cada número, dónde empieza y dónde termina cada cosa. El de [[jpeg|JPEG]] dice cómo vienen comprimidos los píxeles; el de [[json|JSON]], que `{` abre un objeto. Con el acuerdo, un programa en otro lenguaje lee lo que escribió tu Python. Sin él, los bytes son ruido.

Prueba con cuatro bytes: `48 6F 6C 61`. Van en hexadecimal, de 0 a 9 y de A a F, como en «Cómo guarda números una computadora»: 48 es 4 × 16 + 8 = 72 y 6F es 6 × 16 + 15 = 111.

- Leídos como letras, dicen **Hola**: en la tabla de letras que verás en la siguiente sección, el 72 es la H.
- Leídos como un [[entero]] de 4 bytes, con el más chico primero (en la siguiente sección verás por qué importa el orden), son **1,634,496,328**.
- Leídos como un [[float32]], son **≈ 2.7 × 10²⁰**.

Los mismos bytes, tres respuestas. Las decide el formato, no los bytes.

### La extensión no es el formato

El `.jpg` del final del nombre es la **extensión**: una pista para que el sistema sepa con qué programa abrir el archivo. Pero es parte del nombre, no del contenido. Si renombras `tenis.jpg` como `tenis.png`, ni un byte cambia: sigue siendo un JPEG, ahora con el nombre equivocado.

Por eso muchos formatos empiezan con unos bytes fijos que funcionan como firma: los **bytes mágicos** (*magic bytes*). Todo JPEG empieza con `FF D8 FF`. Todo [[png|PNG]], con `89 50 4E 47`, donde los últimos tres son las letras «PNG». Un programa cuidadoso mira la firma, no la extensión.

:::figura formatos-magicos
Los primeros cuatro bytes de seis archivos, en hexadecimal. Cada formato tiene su firma. El último archivo se llama `.png`, pero empieza como un JPEG: la extensión mintió.
:::

Python puede hacer lo mismo: leer los primeros bytes y compararlos con las firmas conocidas. Aquí los archivos viven en la memoria, para no escribir nada en tu disco:

```python
import gzip, io, json, zipfile

def adivinar(b):                       # mira los primeros bytes, no el nombre
    if b[:3] == b"\xff\xd8\xff":          return "JPEG"
    if b[:8] == b"\x89PNG\r\n\x1a\n":     return "PNG"
    if b[:2] == b"\x1f\x8b":              return "gzip"
    if b[:4] == b"PK\x03\x04":            return "zip (como un .pt de PyTorch)"
    if b[:4] == b"PAR1":                  return "Parquet"
    if b[:1] in (b"{", b"["):             return "probablemente JSON"
    return "no lo reconozco"

caja = io.BytesIO()
with zipfile.ZipFile(caja, "w") as z:
    z.writestr("modelo/data.pkl", b"...")
archivos = {
    "tenis.jpg": b"\xff\xd8\xff\xe0" + bytes(20),      # el inicio de un JPEG
    "tenis.png": b"\xff\xd8\xff\xe0" + bytes(20),      # ¡también es un JPEG!
    "logo.png": b"\x89PNG\r\n\x1a\n" + bytes(20),
    "logs.gz": gzip.compress(b'{"top1": "Tenis"}\n', mtime=0),
    "modelo.pt": caja.getvalue(),
    "dia.parquet": b"PAR1" + bytes(20),
    "labels.json": json.dumps(["Tenis", "Botas"]).encode(),
}
for nombre, b in archivos.items():
    print(f"{nombre:<12} {b[:4].hex(' '):<12} → {adivinar(b)}")
```

```salida
tenis.jpg    ff d8 ff e0  → JPEG
tenis.png    ff d8 ff e0  → JPEG
logo.png     89 50 4e 47  → PNG
logs.gz      1f 8b 08 00  → gzip
modelo.pt    50 4b 03 04  → zip (como un .pt de PyTorch)
dia.parquet  50 41 52 31  → Parquet
labels.json  5b 22 54 65  → probablemente JSON
```

JSON no tiene firma: un `{` al principio es solo una buena pista. Un `.gz` es un archivo comprimido con gzip, que verás en la sección de compresión. Y el `.pt` de PyTorch resulta ser un zip, varios archivos empacados en uno (un zip puede comprimirlos, pero PyTorch guarda los tensores sin comprimir, para leerlos directo); en la sección de pesos verás qué hay adentro.

Esto se usa en la puerta de Alba. El gateway, el programa que recibe cada foto, acepta JPEG, PNG o WebP (otro formato de imagen, de Google) de hasta 10 MB, y no le cree al nombre del archivo: revisa la firma antes de gastar CPU en decodificar, y si no es de un formato aceptado, contesta 415, el [[codigo-estado|código de estado]] HTTP de «tipo de contenido no soportado». Y llega de todo: PNG con transparencia, fotos de 40 megapíxeles y archivos corruptos.

Un detalle que aprovechan Parquet y safetensors: un programa no tiene que leer un archivo de principio a fin. Puede pedir «los bytes del 4,000,000 al 4,000,100» (en Python, `f.seek(4_000_000)` y `f.read(100)`), y solo esos viajan desde el disco.

## Texto o binario: el mismo número de dos maneras {Text or binary: the same number two ways}

Hay dos familias de formatos. En uno de **texto**, los bytes son letras: abres el archivo con cualquier editor y lo lees. CSV, JSON y YAML son de texto. En un [[formato-binario|formato binario]] (*binary format*), los bytes guardan los números como los guarda la memoria: un entero de 32 bits (un *int32*) son 4 bytes y un float32 son 4 bytes, sin letras de por medio. Parquet, Avro, safetensors, JPEG y [[protobuf]] son binarios.

:::ojo
«Binario» aquí no es el [[binario|sistema binario]] de los ceros y unos: todo archivo está hecho de bits, también uno de texto. Un formato binario es el que no está pensado para leerse como letras.
:::

:::figura formatos-texto-binario
El número 1,234,567 de dos maneras. Como texto, siete letras de un byte. Como int32, cuatro bytes, con el más chico primero. Leídos como float32, esos mismos cuatro bytes dan un número diminuto que no tiene nada que ver.
:::

:::cuenta 1,234,567 en texto y en int32
Como texto // una letra por dígito: «1» es el byte 0x31, «2» el 0x32… | 7 dígitos × 1 B | 7 bytes
Como int32 // el número en base 2, en 4 bytes fijos | 1,234,567 = 0x0012D687 | 4 bytes
El orden en que se escriben // el byte más chico primero | 00 12 D6 87, al revés | 87 D6 12 00
Un 7 como texto // con números chicos, el texto gana | 1 dígito × 1 B | 1 byte contra 4
= El texto crece con los dígitos; el binario mide siempre lo mismo. Un score como 0.8312 son 6 letras en texto y 4 bytes en float32.
:::

Fíjate en el orden: `87 D6 12 00`, el byte más chico primero. Se llama *little-endian* («el extremo chico primero»). Un formato binario tiene que decir en qué orden escribe; si el que lee se equivoca, el 1,234,567 se vuelve −2,016,013,824, sin ningún error.

:::profundo Little-endian y big-endian
Casi todas las CPUs de hoy, las de Intel, AMD y casi todos los ARM, guardan los números en la memoria con el byte más chico primero: little-endian. El orden contrario, *big-endian*, el más grande primero, es como escribimos los números las personas y como los mandan muchos protocolos de red, por eso también se le dice «orden de red». Parquet, safetensors y Avro escriben sus números de tamaño fijo en little-endian, así que en una computadora normal sus números se copian tal cual a la memoria, sin darles la vuelta. Los nombres vienen de *Los viajes de Gulliver*: dos pueblos que se peleaban por cuál extremo del huevo romper primero.
:::

El módulo `struct` de Python convierte números en bytes y al revés. `"<i"` es un int32 little-endian y `"<f"`, un float32:

```python
import struct

n = 1_234_567
texto = str(n).encode("ascii")              # cada dígito, una letra de 1 byte
int32 = struct.pack("<i", n)                # 4 bytes, el byte chico primero
print("texto  ", len(texto), "bytes:", texto.hex(" "))
print("int32  ", len(int32), "bytes:", int32.hex(" "))
print("de vuelta:", int(texto), "y", struct.unpack("<i", int32)[0])

score = 0.8312
print("'0.8312' ocupa", len(str(score)), "bytes; en float32,", len(struct.pack("<f", score)))
print("el float32 guardó", struct.unpack("<f", struct.pack("<f", score))[0])

# los mismos 4 bytes, leídos con otro formato
print("los bytes del int32 leídos como float32:", struct.unpack("<f", int32)[0])
print("leídos al revés (byte grande primero):", struct.unpack(">i", int32)[0])
```

```salida
texto   7 bytes: 31 32 33 34 35 36 37
int32   4 bytes: 87 d6 12 00
de vuelta: 1234567 y 1234567
'0.8312' ocupa 6 bytes; en float32, 4
el float32 guardó 0.8312000036239624
los bytes del int32 leídos como float32: 1.7299968412060964e-39
leídos al revés (byte grande primero): -2016013824
```

### Qué gana cada familia

| | Texto | Binario |
|---|---|---|
| Leerlo | Con cualquier editor | Con un programa que conozca el formato |
| Tamaño de un número | Crece con los dígitos | Fijo: 4 u 8 bytes |
| Tipos | Los adivina quien lee | Vienen escritos |
| Rapidez | Hay que convertir letras en números | Se copian los bytes |
| Si se daña un byte | Se ve y a veces se arregla a mano | Puede arruinar el resto |

En la lección de APIs viste el caso grande: el tensor de la foto de Ana ocupa 602,112 bytes en float32 (3 × 224 × 224 números × 4 bytes) y ≈ 3.07 MB como JSON: 3.07 MB ÷ 602 KB ≈ 5 veces más. Texto para lo chico que leen personas; binario para lo grande que solo leen máquinas.

### Las letras también son números: UTF-8

Un archivo de texto también son bytes. ¿Qué byte es cada letra? La tabla clásica es **ASCII** (1963): 128 caracteres, uno por byte. La A es el 65 (0x41) y el dígito «1» es el 49 (0x31), el de la cuenta de arriba. Pero ASCII nació en inglés: no trae ñ ni acentos.

**Unicode** le dio después un número a cada carácter de cada idioma. Se escribe con «U+» y el número en hexadecimal: la ñ es el U+00F1 (241) y el tenis 👟, el U+1F45F (128,095). Para escribir esos números en bytes, el formato que ganó es [[utf-8|UTF-8]] (1992), que usa de 1 a 4 bytes según el carácter:

- **1 byte** para los 128 de ASCII, iguales que antes. Un archivo ASCII ya es UTF-8 válido.
- **2 bytes** para la ñ, los acentos y alfabetos como el griego o el cirílico.
- **3 bytes** para el € y la mayoría de los caracteres chinos y japoneses.
- **4 bytes** para casi todos los emoji. Unos pocos, de los primeros que entraron a Unicode, como el ☕, usan 3.

:::figura formatos-utf8
«Niño 👟» en UTF-8: seis caracteres y diez bytes. Abajo, los mismos bytes leídos como Latin-1: cada byte se vuelve una letra, y la ñ sale como «Ã±».
:::

Ojo con `len()`: en Python cuenta caracteres, y «Niño 👟» da 6. Lo que mide el archivo son sus 10 bytes.

¿Qué pasa si alguien lee esos bytes con la tabla equivocada? Antes de Unicode, cada región usaba su propia tabla de 256 caracteres, uno por byte; la de Europa occidental se llama **Latin-1**. Latin-1 lee el C3 como «Ã» y el B1 como «±», y «Niño» se vuelve **«NiÃ±o»**. Si alguna vez viste «Ã³» donde iba una «ó», ya conoces el problema: es UTF-8 leído como Latin-1. Se le dice *mojibake*, en japonés «caracteres transformados». Al revés, Latin-1 leído como UTF-8 da error o el símbolo �.

```python
for texto in ("A", "ñ", "€", "👟", "niño"):
    b = texto.encode("utf-8")
    print(f"{texto!r:<7} {len(texto)} carácter(es) → {len(b)} bytes: {b.hex(' ')}")

b = "niño".encode("utf-8")
print("con la codificación equivocada (latin-1):", b.decode("latin-1"))
try:
    "niño".encode("latin-1").decode("utf-8")
except UnicodeDecodeError as e:
    print("al revés, Python se queja:", e.reason)
print("¿se arregla?", "niÃ±o".encode("latin-1").decode("utf-8"))
```

```salida
'A'     1 carácter(es) → 1 bytes: 41
'ñ'     1 carácter(es) → 2 bytes: c3 b1
'€'     1 carácter(es) → 3 bytes: e2 82 ac
'👟'     1 carácter(es) → 4 bytes: f0 9f 91 9f
'niño'  4 carácter(es) → 5 bytes: 6e 69 c3 b1 6f
con la codificación equivocada (latin-1): niÃ±o
al revés, Python se queja: invalid continuation byte
¿se arregla? niño
```

La regla práctica: escribe y lee siempre en UTF-8, y dilo explícitamente: `open(ruta, encoding="utf-8")`. Hoy es el formato de casi toda la web (el 99 % de los sitios, según W3Techs en noviembre de 2026), de JSON (su estándar, el RFC 8259, lo exige entre sistemas) y de Linux. Un **RFC** es uno de los documentos numerados donde se publican los estándares de internet.

:::profundo Antes de Unicode, una tabla por país
ASCII usaba 7 bits: quedaban libres los valores del 128 al 255 de cada byte. Cada región los llenó a su manera. **Latin-1** (ISO 8859-1), la de Europa occidental, puso ahí la ñ (0xF1), la é y la ü. Otras tablas usaron esos mismos bytes para el griego, el cirílico o el hebreo, y Windows tuvo las suyas, como la 1252. El mismo archivo se veía distinto según el país de la computadora, y un texto no podía mezclar ruso con español.

Unicode (1991) separó dos preguntas: qué número tiene cada carácter (en Unicode 17, de septiembre de 2025, son 159,801) y cómo se escribe ese número en bytes. UTF-8 es una respuesta a la segunda; hay otras, como UTF-16, que usa Windows por dentro y JavaScript para sus textos. UTF-8 ganó por un detalle: los primeros bits de cada byte dicen si es un carácter de un byte (0…), el inicio de uno largo (110…, 1110… o 11110…) o una continuación (10…). Así, un programa que cae en medio de un texto encuentra dónde empieza el siguiente carácter, y ningún byte de ASCII aparece nunca dentro de un carácter largo. La ñ, 241 en binario 1111 0001, se reparte así: 110**00011** 10**110001** = C3 B1.
:::

:::ojo
En inglés, *encoding* se usa para dos cosas distintas. La de aquí, cómo un texto se vuelve bytes, se traduce como **codificación de caracteres**. La [[codificacion]] de la lección de features (convertir una categoría en números para el modelo) es otra cosa.
:::

## CSV y JSON Lines: tablas y registros en texto {CSV and JSON Lines: tables and records as text}

Los dos formatos de texto con los que más se guardan datos son CSV, para tablas, y JSON Lines, para registros que llegan uno por uno.

### CSV: una tabla en texto, simple y frágil

[[csv|CSV]] (*comma-separated values*, valores separados por comas) guarda una tabla así: una fila por línea, los campos separados por comas y, casi siempre, los nombres de las columnas en la primera línea.

```text
codigo,titulo,precio
130,Sandalias de playa,350
```

Cualquiera lo escribe a mano y cualquier programa lo abre, desde Excel hasta una base de datos. Y se rompe en cuanto el dato trae lo que el formato usa para separar:

1. **Una coma dentro de un campo.** «Tenis naranjas, talla 26» tiene una coma. La regla es encerrar el campo entre comillas dobles.
2. **Comillas dentro del campo.** `Botas "de piel"` se escribe `"Botas ""de piel"""`: la comilla se duplica.
3. **Un salto de línea dentro del campo.** Un título con un *enter* adentro, entre comillas, ocupa dos líneas del archivo. Un programa que lee línea por línea parte la fila en dos.
4. **Ningún tipo.** Todo es texto. Un programa puede leer el código `007` como el número 7, y el cero se pierde. ¿`03/04/2026` es 3 de abril o 4 de marzo? ¿Un campo vacío es nada o un cero? El archivo no lo dice.
5. **Nada dice cómo está escrito.** Ni la codificación de caracteres ni el separador: en los países donde la coma es el punto decimal, Excel suele usar punto y coma.

Las reglas de las comillas se escribieron en 2005 (el RFC 4180), pero no todos los programas las siguen. Nunca partas un CSV con `split(",")`: usa un lector que conozca las comillas, como el módulo `csv` de Python.

```python
import csv, io

filas = [
    ["codigo", "titulo", "precio"],
    ["007", "Tenis naranjas, talla 26", "899.50"],
    ["012", 'Botas "de piel"', "1200"],
    ["130", "Sandalias\nde playa", "350"],
]
caja = io.StringIO()
csv.writer(caja).writerows(filas)        # el módulo csv pone comillas donde hacen falta
texto = caja.getvalue()
print(texto)

print("partiendo en comas a mano:", texto.splitlines()[1].split(","))
leidas = list(csv.reader(io.StringIO(texto)))
print("con el módulo csv:", leidas[1])
print("filas leídas:", len(leidas), "· la sandalia:", repr(leidas[3][1]))
print("todo es texto:", type(leidas[1][2]).__name__, "· y si lo conviertes:", int(leidas[1][0]))
```

```salida
codigo,titulo,precio
007,"Tenis naranjas, talla 26",899.50
012,"Botas ""de piel""",1200
130,"Sandalias
de playa",350

partiendo en comas a mano: ['007', '"Tenis naranjas', ' talla 26"', '899.50']
con el módulo csv: ['007', 'Tenis naranjas, talla 26', '899.50']
filas leídas: 4 · la sandalia: 'Sandalias\nde playa'
todo es texto: str · y si lo conviertes: 7
```

El archivo tiene 5 líneas pero 4 filas, porque la sandalia ocupa dos. Partido a mano, el título de los tenis se vuelve dos campos. Y aun bien leído, todo llega como texto: el 007 sobrevive solo mientras nadie lo convierta.

CSV sirve para tablas chicas, para pasarle datos a una persona con una hoja de cálculo y para exportes de una sola vez. No para millones de filas que un programa lee cada día.

### JSON Lines: un registro por línea

[[json|JSON]] lo conociste en la lección de APIs: texto, seis tipos y el nombre de cada campo en cada objeto. Para guardar millones de registros, un solo arreglo `[{…}, {…}, …]` tiene dos problemas. Agregar un registro obliga a mover el `]` del final. Y para leer cualquiera, el lector casi siempre carga el arreglo completo en la memoria; si quedó cortado, no se lee nada.

[[json-lines|JSON Lines]] (también llamado NDJSON; extensión `.jsonl`) lo arregla con una regla: **un valor JSON completo por línea**, casi siempre un objeto, sin comas entre líneas ni corchetes alrededor. Su especificación (jsonlines.org) pide además UTF-8 y que cada línea termine con `\n`. Cada línea es independiente. Eso da tres cosas:

- **Se añade al final.** Abrir el archivo en modo «agregar» (`"a"`) y escribir una línea. No hay nada que reescribir.
- **Se lee por partes.** Línea por línea, con la memoria de una sola línea. Y un archivo grande se reparte entre varios [[worker|workers]] partiéndolo por líneas.
- **Una línea rota es un registro perdido**, no el archivo entero.

Lo que no da: un esquema. Nada revisa que `score` sea siempre un número.

Así escribe Alba su log de predicciones. El gateway imprime una línea JSON por request a su salida estándar (*stdout*, la salida de texto del programa, la que verías en la terminal), y otro programa, Fluent Bit, la recoge y la manda a S3, el almacén de archivos de AWS, la nube de Amazon (lo verás en «Object storage, data lakes y warehouses»). Son unos 300 bytes; la hora la agrega quien guarda el log. Aquí, partida para que se lea (en el archivo va en una sola línea):

```text
{"request_id": "9f2c41d0", "caller": "app-ios",
 "model_version": "resnet50-2026-10-01",
 "top5": [[17, 0.83], [42, 0.06], [3, 0.04], [88, 0.02], [5, 0.01]],
 "ms": {"pre": 9, "triton": 24, "post": 2, "total": 41},
 "bytes": 201344, "sha256": "8f0be2119c3d", "status": 200}
```

Campo por campo: quién llamó (`caller`), qué versión del modelo contestó, las cinco categorías más probables con su número y su score (`top5`), los milisegundos de cada paso (`ms`), el tamaño de la foto, el principio de su huella digital (`sha256`, un hash que verás en «Tiempo, hashes e identificadores») y el código de estado HTTP de la respuesta.

¿Cuánto ocupa eso? Es una multiplicación por líneas y otra por días:

:::formula Cuánto pesa el log
S_{día} = N × b
S_{ret} = S_{día} × d
- N: líneas de log al día: una por predicción
- b: bytes por línea, en B
- d: días de retención: cuántos días se guarda el log antes de borrarlo
- S_{día}: lo que ocupa el log de un día, en bytes
- S_{ret}: lo que ocupa el log de toda la retención, en bytes
:::

:::cuenta Los logs de Alba en JSON Lines
Predicciones al día \(N\) // una por foto: Alba contesta ≈ 10 M fotos al día | — | ≈ 10,000,000
Bytes por línea \(b\) // lo que mide la línea JSON de arriba | — | ≈ 300 B
Al día, \(S_{día} = N × b\) | 10⁷ × 300 B | ≈ 3 GB
Con \(d\) = 90 días de retención, \(S_{ret} = S_{día} × d\) // lo que se guarda antes de borrar | 3 GB × 90 | ≈ 270 GB
Al segundo, en el pico de diseño // Alba compra máquinas para 500 requests por segundo, y cada request escribe una línea | 500 × 300 B | ≈ 150 KB/s
= Escribir no cuesta: 150 KB por segundo no es nada para un disco. Lo caro es guardar 270 GB y leerlos cada día.
:::

Este programa escribe tres líneas, simula que el proceso murió a la mitad de la cuarta y lee el archivo línea por línea:

```python
import json, os, tempfile

ruta = os.path.join(tempfile.mkdtemp(), "predicciones.jsonl")
def registrar(evento):                       # abrir en modo "a": se añade al final
    with open(ruta, "a", encoding="utf-8") as f:
        f.write(json.dumps(evento, ensure_ascii=False, separators=(",", ":")) + "\n")

registrar({"request_id": "r-001", "top1": "Tenis", "score": 0.83, "ms": 41})
registrar({"request_id": "r-002", "top1": "Botas", "score": 0.61, "ms": 38})
registrar({"request_id": "r-003", "top1": "Sandalias", "score": 0.9, "ms": 44})
with open(ruta, "a", encoding="utf-8") as f:
    f.write('{"request_id": "r-004", "top1": "Ten')   # el proceso murió a la mitad

buenos, rotos = [], 0
with open(ruta, encoding="utf-8") as f:
    for linea in f:                          # se lee una línea a la vez, no todo el archivo
        try:
            buenos.append(json.loads(linea))
        except json.JSONDecodeError:
            rotos += 1
print("registros buenos:", len(buenos), "· rotos:", rotos)
with open(ruta, "rb") as f:
    print("la primera línea mide", len(f.readline()), "bytes")

arreglo = json.dumps(buenos)                 # lo mismo como un solo arreglo JSON
try:
    json.loads(arreglo[:-10])                # cortado al final
except json.JSONDecodeError as e:
    print("el arreglo cortado no se lee:", e.msg)
```

```salida
registros buenos: 3 · rotos: 1
la primera línea mide 59 bytes
el arreglo cortado no se lee: Expecting property name enclosed in double quotes
```

`separators=(",", ":")` quita los espacios después de cada coma y cada dos puntos, bytes que se repetirían millones de veces. `ensure_ascii=False` deja la ñ en sus 2 bytes de UTF-8 en vez de escribirla como `\u00f1`, que son 6.

## YAML: configuración que escriben personas {YAML: configuration people write} [extra]

Hay archivos que no escribe un programa, sino una persona: cuántas réplicas del servidor correr, qué imagen usar, cuándo mandar una alerta. Para eso se usa casi siempre [[yaml|YAML]] (las letras quieren decir, en broma, *YAML Ain't Markup Language*, «YAML no es un lenguaje de marcado»). En Alba lo vas a ver en tres lugares:

- Los **manifiestos de Kubernetes**, el [[orquestacion|orquestador]] que corre los contenedores de Alba: en YAML se declara el estado que quieres («2 réplicas de esta imagen, con una GPU cada una») y Kubernetes lo hace realidad.
- El **docker-compose.yml**, que levanta juntos los contenedores en una sola máquina para probar.
- Las **reglas de alertas** de Prometheus, el sistema que guarda las métricas.

Un pedazo de manifiesto se ve así:

```yaml
# Un Deployment de Alba, recortado: cuántas copias del gateway correr y con qué imagen
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: gateway
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/classifier-gateway:3f9c2ab
          env:
            - name: TOP_K
              value: "5"
```

Se lee casi como una lista del súper, y esa es la idea. Las reglas son pocas:

- **La indentación manda.** Lo que está más a la derecha pertenece a lo de arriba. No hay llaves: dos espacios de más o de menos cambian el significado, y los tabuladores no se permiten.
- `nombre: valor` es un campo; una línea que empieza con `- ` es un elemento de una lista.
- `#` empieza un comentario. JSON no tiene comentarios; YAML sí, y en una configuración importan.
- YAML acepta JSON: `{"replicas": 2}` también es YAML válido.
- `---` en su propia línea separa dos documentos dentro del mismo archivo. Así, un solo `.yaml` puede traer el Deployment del gateway de Alba (qué contenedores correr) y su Service (la dirección fija por la que se llega a ellos).
- `|` al final de una línea guarda el texto de abajo tal cual, con sus saltos de línea: sirve para meter un script o un archivo de configuración completo dentro del YAML.

¿Por qué no configurar en JSON? Se puede, y algunas herramientas lo aceptan, pero JSON no admite comentarios, pide comillas y llaves en todo, y una coma de más al final rompe el archivo. Y al revés: ¿por qué no guardar datos en YAML? Porque su lector es lento, adivina los tipos y la indentación se rompe al editar a mano un archivo de un millón de líneas. YAML es para lo que escriben y revisan personas, casi siempre guardado en Git, el programa que lleva la historia del código, junto al código.

### El problema de Noruega

YAML adivina los tipos, como CSV, pero con más ganas. La versión 1.1 del estándar, que muchos lectores todavía siguen (entre ellos PyYAML, el de Python), trata como **verdadero o falso** las palabras `yes`, `no`, `on` y `off`. El código de país de Noruega es `NO`: una lista de países escrita en YAML convierte a Noruega en `false`. Por eso se le dice «el problema de Noruega».

No es el único. `version: 1.10` se lee como el número 1.1, y `hora: 22:30` se lee en PyYAML como 1,350, porque la versión 1.1 entiende los números con dos puntos como de base 60 (22 × 60 + 30). La versión 1.2 (2009) dejó como booleanos solo `true` y `false` y quitó la base 60; el `1.10` sigue siendo el número 1.1. Y no todos los lectores la siguen.

La defensa es sencilla: **pon entre comillas todo texto que pueda parecer otra cosa**. Por eso, en el manifiesto de arriba, `value: "5"` va entre comillas: las variables de entorno (los ajustes que un proceso recibe al arrancar) tienen que ser texto en Kubernetes, y un `5` suelto sería un número.

PyYAML no viene con Python (se instala con `pip install pyyaml`), así que esto es una ilustración, sin salida. Lo que imprime está en los comentarios:

```python
import yaml

print(yaml.safe_load("pais: NO\nversion: 1.10\nhora: 22:30"))
# {'pais': False, 'version': 1.1, 'hora': 1350}
print(yaml.safe_load('pais: "NO"\nversion: "1.10"\nhora: "22:30"'))
# {'pais': 'NO', 'version': '1.10', 'hora': '22:30'}
```

Usa siempre `safe_load`. El `load` completo de PyYAML, con el cargador que no es seguro, puede crear objetos de Python cualquiera a partir del archivo: el mismo riesgo que vas a ver con pickle en la sección de pesos.

## Compresión: lo repetido se escribe una vez {Compression: write the repeated part once}

Los ≈ 3 GB diarios de logs de Alba (10 millones de líneas de ≈ 300 bytes) están llenos de repeticiones. Cada línea dice `"model_version": "resnet50-2026-10-01"`, los mismos 38 bytes diez millones de veces. Cada línea repite los nombres de los campos. La [[compresion|compresión]] (*compression*) aprovecha eso: escribe los datos con menos bytes y, al leerlos, los reconstruye.

La idea más común, la del algoritmo LZ77 (1977) que usan gzip y zlib, es cambiar lo repetido por una referencia: «aquí van otra vez los 38 bytes que aparecieron hace 300 bytes». Una referencia ocupa 2 o 3 bytes en vez de 38. Después, los símbolos que más aparecen se escriben con menos bits.

### Sin pérdida o con pérdida

- **Sin pérdida** (*lossless*): al descomprimir salen exactamente los mismos bytes. gzip, zlib, zstd, snappy y el [[png|PNG]] son así. Es lo único aceptable para un log, un dataset o unos pesos: un byte distinto es un dato equivocado.
- **Con pérdida** (*lossy*): se tira lo que una persona casi no nota. Es el [[jpeg|JPEG]] de la foto de Ana, que descarta detalles finos de los píxeles. Sirve para fotos, audio y video, nunca para datos.

### Por qué lo repetido comprime y lo al azar no

Comprimir tiene un límite: no se puede escribir algo con menos bits que la sorpresa que trae. Es la [[entropia]] de la lección de distribuciones. Si un campo casi siempre vale lo mismo, trae poca sorpresa por valor y cabe en casi nada. Si cada byte es imposible de adivinar, como un hash (una huella del contenido que parece un número al azar), ningún compresor lo achica. Y comprimir algo ya comprimido, como un JPEG, no gana nada: lo que sale de un buen compresor ya parece al azar.

Este programa arma 10,000 líneas de log de mentiras y comprime tres cosas del mismo tamaño con `zlib`, que viene con Python. El nivel va del 1 (rápido) al 9 (más chico):

```python
import json, random, zlib

random.seed(7)
categorias = ["Tenis", "Botas", "Sandalias", "Pantuflas", "Zapatos de vestir"]
lineas = []
for i in range(10_000):                      # 10,000 líneas de log de mentiras
    lineas.append(json.dumps({"request_id": f"r-{i:06d}", "model_version": "resnet50-2026-10-01",
                              "top1": random.choice(categorias), "score": round(random.random(), 4),
                              "ms": random.randint(25, 90)}))
logs = ("\n".join(lineas) + "\n").encode()

pruebas = {
    "una letra repetida": b"a" * len(logs),
    "logs JSON Lines": logs,
    "bytes al azar": random.randbytes(len(logs)),   # como un JPEG: ya no tiene repeticiones
}
for nombre, datos in pruebas.items():
    for nivel in (1, 9):
        c = zlib.compress(datos, level=nivel)
        print(f"{nombre:<19} nivel {nivel}: {len(datos):>9,} → {len(c):>9,} B  ({len(datos) / len(c):6.1f} veces)")
assert zlib.decompress(zlib.compress(logs)) == logs   # sin pérdida: regresan los mismos bytes
print("bytes por línea:", round(len(logs) / len(lineas)))
```

```salida
una letra repetida  nivel 1: 1,149,280 →     5,036 B  ( 228.2 veces)
una letra repetida  nivel 9: 1,149,280 →     1,138 B  (1009.9 veces)
logs JSON Lines     nivel 1: 1,149,280 →   115,433 B  (  10.0 veces)
logs JSON Lines     nivel 9: 1,149,280 →    83,178 B  (  13.8 veces)
bytes al azar       nivel 1: 1,149,280 → 1,149,636 B  (   1.0 veces)
bytes al azar       nivel 9: 1,149,280 → 1,149,641 B  (   1.0 veces)
bytes por línea: 115
```

Tres cosas que notar. Lo repetido desaparece casi por completo. Los bytes al azar **crecen** un poco: el compresor agrega su encabezado y no encuentra nada que quitar. Y estos logs de mentiras comprimen más que los de verdad: aquí los `request_id` van en orden (`r-000001`, `r-000002`…), y en Alba son al azar, igual que el hash de cada imagen. En la sección de Parquet vas a ver un log más realista.

:::nota El precio: tiempo de CPU
Comprimir más cuesta más CPU. El nivel 9 de zlib sale más chico que el 1, pero tarda varias veces más; cuánto, depende de la máquina. Por eso hay varios compresores, cada uno con su punto entre tamaño y velocidad.
:::

:::profundo Los compresores que vas a ver
| Compresor | De dónde | Para qué |
|---|---|---|
| gzip y zlib | Los dos usan DEFLATE (de PKZIP, 1993; publicado como el RFC 1951 en 1996); vienen con Python | Archivos `.gz`, HTTP, lo que debe abrir cualquiera |
| zstd (Zstandard) | Facebook, 2016 | Comprime como gzip o mejor y mucho más rápido; muy usado en Parquet |
| snappy | Google, 2011 | Muy rápido, comprime menos; es el de omisión al escribir Parquet en pyarrow (versión 26), pandas y Spark |
| lz4 | 2011 | Parecido a snappy: velocidad antes que tamaño |

La regla para elegir: si se lee muchas veces y se escribe una, conviene comprimir más (zstd con un nivel alto); si se escribe sin parar y se lee poco, conviene lo rápido (snappy o lz4). Y un JPEG, un MP4 o un zip no se vuelven a comprimir: ya no hay nada que quitar.
:::

¿Cuánto ahorra comprimir los logs de Alba? Su equipo estima que en Parquet comprimido ocupan de 5 a 10 veces menos que el JSON crudo. Llama \(r\) a esas veces que comprime: un día de log pasa de \(S_{día}\) a \(S_{día} ÷ r\), y con \(r\) = 5, de 3 GB a 3 GB ÷ 5 = 600 MB. Juega con la cuenta:

:::calculadora formatos-logs
Prueba con \(r\) = 5 y con 10: el log de 90 días pasa de 270 GB a \(S_{ret} ÷ r\), entre 270 ÷ 5 = 54 y 270 ÷ 10 = 27 GB. Sube la retención a \(d\) = 365 días: en JSON Lines, 3 GB × 365 ≈ 1,095 GB, ya pasa de 1 TB.
:::

## Por filas o por columnas: Parquet {Rows or columns: Parquet}

Piensa en el log de Alba ya convertido en una tabla: una fila por predicción, una columna por campo. Hay dos maneras de poner esa tabla en una fila de bytes.

- **Por filas** (*row-oriented*): todos los campos de la primera predicción, luego todos los de la segunda, y así. Es lo que hacen CSV y JSON Lines.
- **Por columnas**: todos los `request_id`, luego todos los `top1`, luego todos los `score`… Es un [[formato-columnar|formato columnar]] (*columnar format*).

:::figura formatos-columnar
La misma tabla de cuatro predicciones y cuatro columnas, escrita por filas y por columnas. Para sacar `top1` y `score`, por filas hay que leer los 16 valores; por columnas, solo dos tramos seguidos de 4.
:::

¿Por qué importa? Cada día, el job de drift de Alba (el programa que revisa si las predicciones de hoy se parecen a las de antes) cuenta cuántas veces salió cada categoría y cómo se reparte el score. Lee **dos columnas**, `top1` y `score`, de diez millones de filas.

Por filas, para sacar dos campos hay que leer todo, porque están intercalados. Por columnas, cada columna es un tramo seguido del archivo: el programa salta con `seek` a los dos tramos que necesita y no toca lo demás.

Cuánto lee cada uno se calcula así, con las mismas \(N\) y \(r\) de antes:

:::formula Cuánto lee una consulta
L_{filas} = N × C × u
L_{col} = frac{N × k × u}{r}
t = frac{L}{v}
- N: filas de la tabla: las líneas de log de un día
- C: columnas de la tabla
- k: columnas que lee la consulta
- u: bytes por valor, en promedio, sin comprimir
- r: veces que comprime Parquet
- L_{filas}: bytes que lee por filas (todo el archivo)
- L_{col}: bytes que lee por columnas, comprimidas
- v: velocidad de lectura del disco, en MB/s
- L: lo que lee la consulta, \(L_{filas}\) o \(L_{col}\), pasado a MB para dividir entre \(v\)
- t: tiempo que tarda en leerlo, en segundos
:::

:::cuenta Leer 2 de 30 columnas de un día de logs
Filas \(N\) // un día de Alba: una por predicción | — | 10,000,000
Columnas \(C\) // una suposición redonda: el top-5 y las latencias, cada valor en su columna | — | ≈ 30
Bytes por valor \(u\) // en promedio, para que sumen los 300 B de la línea | \(u = b ÷ C\) = 300 B ÷ 30 | ≈ 10 B
Por filas, en JSON Lines, \(L_{filas}\) | \(N × C × u\) = 10⁷ × 30 × 10 B | 3 GB
Por columnas, solo \(k\) = 2 // 2 de 30 es ≈ 6.7 % | \(N × k × u\) = 10⁷ × 2 × 10 B | 200 MB
Y comprimidas, \(L_{col}\) // Alba estima que Parquet comprime de 5 a 10 veces; aquí, \(r\) = 5 | 200 MB ÷ 5 | 40 MB
Veces menos bytes | \(L_{filas} ÷ L_{col}\) = 3,000 MB ÷ 40 MB | 75
Tiempo por filas, \(t = L ÷ v\) // supuesto: el disco lee a \(v\) = 500 MB/s | 3,000 MB ÷ 500 MB/s | 6 s
Tiempo por columnas | 40 MB ÷ 500 MB/s | 0.08 s
= 75 veces menos bytes: 6 segundos contra 0.08 segundos.
:::

### Tres ventajas más de ir por columnas

1. **Comprime mejor.** En una columna van juntos valores del mismo tipo y muy parecidos: diez millones de `model_version` iguales se vuelven casi nada.
2. **Cada columna se escribe en su tipo.** Los `score` van como float32, 4 bytes cada uno, y no como letras.
3. **Se pueden saltar pedazos.** Lo ves en un momento, con los *row groups*.

Este programa lo comprueba con Python puro. Arma 10,000 filas parecidas al log de Alba, con ids al azar, y las mide de tres maneras: como JSON Lines, por filas sin los nombres (como un CSV) y por columnas, cada una comprimida aparte con zlib:

```python
import json, random, zlib

random.seed(7)
n = 10_000
tabla = {                                    # un log de Alba de mentiras, ya como columnas
    "request_id": [random.randbytes(8).hex() for _ in range(n)],
    "caller": [random.choice(["app-ios", "app-android", "web"]) for _ in range(n)],
    "model_version": ["resnet50-2026-10-01"] * n,
    "top1": [random.randint(0, 499) for _ in range(n)],
    "score": [round(random.betavariate(5, 2), 3) for _ in range(n)],
    "ms": [random.randint(25, 90) for _ in range(n)],
    "bytes": [random.randint(80_000, 400_000) for _ in range(n)],
    "status": [random.choice([200] * 99 + [500]) for _ in range(n)],
}
nombres = list(tabla)
kb = lambda b: f"{len(b) / 1000:,.0f} KB"
z = lambda b: zlib.compress(b, 6)

jsonl = "".join(json.dumps({c: tabla[c][i] for c in nombres}) + "\n" for i in range(n)).encode()
filas = "\n".join(",".join(str(tabla[c][i]) for c in nombres) for i in range(n)).encode()
columnas = {c: "\n".join(map(str, tabla[c])).encode() for c in nombres}
print(f"JSON Lines:   {kb(jsonl):>8} → {kb(z(jsonl)):>6} con zlib")
print(f"por filas:    {kb(filas):>8} → {kb(z(filas)):>6} con zlib")
for c, bloque in columnas.items():
    print(f"   {c:<14} {kb(bloque):>7} → {kb(z(bloque)):>6} ({len(bloque) / len(z(bloque)):5.1f} veces)")
total = sum(len(z(b)) for b in columnas.values())
print(f"por columnas: {total / 1000:,.0f} KB con zlib, sumando las 8")
dos = len(z(columnas["top1"])) + len(z(columnas["score"]))
print(f"para leer top1 y score: {dos / 1000:,.0f} KB por columnas, {kb(z(filas))} por filas")
```

```salida
JSON Lines:   1,666 KB → 252 KB con zlib
por filas:      686 KB → 220 KB con zlib
   request_id      170 KB →  99 KB (  1.7 veces)
   caller           80 KB →   4 KB ( 19.2 veces)
   model_version   200 KB →   1 KB (378.1 veces)
   top1             38 KB →  15 KB (  2.4 veces)
   score            59 KB →  18 KB (  3.3 veces)
   ms               30 KB →  11 KB (  2.8 veces)
   bytes            69 KB →  32 KB (  2.1 veces)
   status           40 KB →   0 KB (130.7 veces)
por columnas: 180 KB con zlib, sumando las 8
para leer top1 y score: 33 KB por columnas, 220 KB por filas
```

Del JSON Lines crudo (1,666 KB) a las columnas comprimidas (180 KB) hay \(r\) = 1,666 ÷ 180 ≈ 9 veces: dentro del «de 5 a 10» que estima Alba. El `request_id`, al azar, apenas baja a la mitad. Y lo más grande no es la compresión: para leer `top1` y `score` bastan 33 KB en vez de 220.

### Parquet

[[parquet|Parquet]] es el formato columnar de casi todo el mundo de los datos: lo leen y lo escriben los programas y servicios que analizan datos, como pandas, Spark, DuckDB, BigQuery, Snowflake y Athena. Un archivo Parquet tiene tres partes:

- **Row groups** («grupos de filas»): la tabla partida en bloques de filas seguidas. Dentro de cada uno, cada columna va junta y comprimida aparte.
- **Estadísticas**: para cada columna de cada row group, su mínimo, su máximo y cuántos nulos tiene (un **nulo**, *null*, es un valor que falta).
- **Un pie** (*footer*) al final del archivo, con el esquema (cada columna, su tipo y si admite nulos), dónde empieza cada row group y las estadísticas. El archivo empieza y termina con los bytes `PAR1`.

Quien lee empieza por el final: lee el pie, decide qué row groups y qué columnas necesita, y salta directo a esos bytes.

Las estadísticas sirven para las preguntas que filtran. «¿Qué requests tardaron más de 500 ms?» Si un row group dice que su máximo de `ms` es 210, ahí no hay ninguna: se salta sin leerlo.

:::figura formatos-rowgroups
Un archivo de ocho row groups, con el máximo de la columna `ms` de cada uno. Para la pregunta «ms > 500», el lector mira las estadísticas del pie y solo abre los dos row groups cuyo máximo pasa de 500.
:::

Funciona cuando los valores parecidos quedan juntos: si las latencias altas están regadas por todos los row groups, no se salta nada.

El precio de ir por columnas: **no se puede añadir una fila suelta**. Para escribir un row group hay que juntar antes muchas filas, y cambiar una fila obliga a reescribir el archivo. Por eso Alba no escribe Parquet en cada request: escribe JSON Lines, que se añade al final, y después un proceso junta muchas líneas y las convierte en Parquet.

:::profundo Parquet por dentro: páginas, diccionarios y archivos chicos
Parquet nació en 2013, de Twitter y Cloudera, inspirado en un artículo de Google sobre su sistema Dremel, y hoy es un proyecto de la fundación Apache.

Dentro de cada row group, cada columna (su *column chunk*) se parte en **páginas**: la documentación de Parquet recomienda 8 KB, y pyarrow usa 1 MB por omisión. Los row groups son mucho más grandes: la misma documentación recomienda de 512 MB a 1 GB, y pyarrow corta uno cada 1,048,576 filas (unos diez para un día de Alba: 10,000,000 ÷ 1,048,576 ≈ 9.5). Cada página se codifica antes de comprimirse. Dos codificaciones hacen casi todo el trabajo:

- **Diccionario** (*dictionary encoding*): los valores distintos de la columna se escriben una vez, en una lista, y cada fila guarda solo su posición. Los tres `caller` («app-ios», «app-android», «web») son 0, 1 y 2, y cada fila necesita 2 bits en vez de 3 a 11 letras.
- **Repeticiones** (*run-length encoding*): «el valor 0, 40,000 veces seguidas» se escribe como un par de números. Diez millones de `model_version` iguales quedan en unos cuantos bytes.

Después de eso se comprime cada página con snappy, zstd o gzip. Por eso un Parquet real gana más que el zlib de nuestro programa: primero quita lo repetido con conocimiento del tipo, y después comprime.

Una trampa conocida: **los archivos chicos**. Cada Parquet tiene su pie y cada lectura empieza por pedirlo. Mil archivos de 100 KB son mil pies que leer y mil viajes al almacén; un archivo de 100 MB es uno. Por eso la conversión de Alba junta los logs de muchas horas en pocos archivos grandes: ≈ 4 archivos de ≈ 125 MB por día.
:::

:::diagrama formatos-logs
Toca cada caja para ver qué formato tiene ahí el log de Ana. «Recorrer» sigue una predicción desde el gateway hasta Parquet, y el otro recorrido, la revisión diaria de drift.
:::

Los Parquet de Alba quedan, además, en carpetas por fecha y por versión del modelo: `logs/dt=2026-11-05/model_version=…/`. Así, el job de drift ni siquiera abre los archivos de otros días. Es una [[particion-datos|partición]], y la vas a ver a fondo en «Object storage, data lakes y warehouses».

En Python, Parquet se lee con **pyarrow** (o con pandas, que lo usa por dentro). No viene con Python, así que es una ilustración, sin salida:

```python
import pyarrow.parquet as pq

# solo dos columnas y solo las filas con ms > 500: los row groups que no pueden tenerlas ni se leen
tabla = pq.read_table("logs/dt=2026-11-05/part-0.parquet",
                      columns=["top1", "score"], filters=[("ms", ">", 500)])
print(tabla.num_rows, tabla.schema)
pq.write_table(tabla, "lentas.parquet", compression="zstd")
```

:::calculadora formatos-consulta
La calculadora agrega lo que se salta por las estadísticas: si se salta la fracción \(f\) de los row groups (0.9 = el 90 %), lee \(L_{col} × (1 − f)\). Sube las columnas que lee la consulta a \(k\) = 30, como una consulta que pide todas las columnas: la ventaja de las columnas se reduce a la compresión. Y prueba saltarte el 90 % de los row groups.
:::

## El esquema y cómo cambia {The schema and how it changes}

Un log de Alba escrito hoy lo va a leer un job de entrenamiento dentro de seis meses. Ese job necesita saber qué columnas hay, de qué tipo es cada una y cuáles pueden faltar. Esa descripción es el [[esquema-datos|esquema]] de los datos (*schema*). Aquí va el de un log simplificado, con solo la categoría ganadora y su score en vez del top-5:

| Columna | Tipo | ¿Puede faltar? |
|---|---|---|
| `request_id` | texto | no |
| `model_version` | texto | no |
| `top1` | texto: el nombre de la categoría | no |
| `score` | float32 de 0 a 1 | no |
| `caller` | texto | sí |

Es la misma idea del [[esquema-api|esquema de una API]] de la lección de APIs, el contrato de cada request y cada respuesta. La diferencia es cuánto dura: una respuesta se lee en milisegundos y se olvida; un archivo se queda años, y lo leen programas que todavía no existen.

### ¿Quién trae el esquema?

| Formato | Lo que dice del esquema |
|---|---|
| CSV | Solo los nombres, en la primera línea, si los pusieron. Los tipos los adivina quien lee |
| JSON Lines | Los nombres en cada línea. Tipos a medias: el estándar no distingue entero de decimal ni tiene fechas |
| Parquet | El esquema completo, con tipos exactos, en el pie de cada archivo |
| Avro | El esquema completo, escrito en JSON, en el encabezado del archivo o en un registro aparte |
| protobuf | En el archivo `.proto`, que comparten los dos lados |

Por eso un Parquet que recibes de otro equipo «se explica solo»: abres el pie y sabes que `score` es float32. Un CSV te obliga a preguntar.

### La evolución del esquema

Los datos cambian de forma. Un día Alba quiere guardar también qué GPU contestó; otro, alguien quiere llamar `confianza` al `score`. Cambiar el esquema de algo que ya está guardado y que otros leen es la [[evolucion-esquema|evolución del esquema]] (*schema evolution*), y la pregunta es siempre la misma: ¿quién se rompe? Hay dos direcciones:

- **Compatible hacia atrás** (*backward compatible*): el lector **nuevo** puede leer los datos **viejos**. El job de entrenamiento de hoy lee los logs de hace seis meses.
- **Compatible hacia adelante** (*forward compatible*): el lector **viejo** puede leer los datos **nuevos**. El dashboard (el tablero de gráficas) que nadie ha actualizado sigue funcionando con los logs de hoy.

| Cambio | ¿Lector nuevo, datos viejos? | ¿Lector viejo, datos nuevos? |
|---|---|---|
| Agregar un campo opcional, con valor por omisión | Sí: usa el valor por omisión | Sí: lo ignora |
| Agregar un campo obligatorio | No: en lo viejo falta | Sí: lo ignora |
| Quitar un campo que tenía valor por omisión | Sí | Sí: usa el valor por omisión |
| Renombrar un campo | No | No |
| Cambiar el tipo (de número a texto) | No | No |

La regla que sale de la tabla: **agregar campos opcionales sí; renombrar o cambiar tipos, no.** Si de verdad hace falta un nombre nuevo, se agrega el campo nuevo, se escriben los dos por un tiempo y se quita el viejo cuando nadie lo lee. Es el mismo *expand and contract* de las APIs.

Este lector aplica un esquema versión 2, que agregó `caller` como opcional:

```python
import json

ESQUEMA_V2 = {                               # campo: (tipo, valor si no viene)
    "request_id": (str, None),               # None: obligatorio
    "top1": (str, None),
    "score": (float, None),
    "caller": (str, "desconocido"),          # nuevo en la v2: opcional, con valor por omisión
}

def leer(linea):
    dato, fila = json.loads(linea), {}
    for campo, (tipo, omision) in ESQUEMA_V2.items():
        if campo not in dato:
            if omision is None:
                raise ValueError(f"falta «{campo}»")
            dato[campo] = omision
        if not isinstance(dato[campo], tipo):
            raise ValueError(f"«{campo}» debería ser {tipo.__name__}")
        fila[campo] = dato[campo]
    return fila

lineas = {
    "v1, vieja": '{"request_id": "r-001", "top1": "Tenis", "score": 0.83}',
    "v2": '{"request_id": "r-002", "top1": "Botas", "score": 0.61, "caller": "web"}',
    "v3, con un campo de más": '{"request_id": "r-003", "top1": "Tenis", "score": 0.9, "caller": "web", "gpu": "t4"}',
    "renombró score": '{"request_id": "r-004", "top1": "Tenis", "confianza": 0.9}',
    "score como texto": '{"request_id": "r-005", "top1": "Tenis", "score": "0.9"}',
}
for nombre, linea in lineas.items():
    try:
        print(f"{nombre:<24} ✓ {leer(linea)}")
    except ValueError as e:
        print(f"{nombre:<24} ✗ {e}")
```

```salida
v1, vieja                ✓ {'request_id': 'r-001', 'top1': 'Tenis', 'score': 0.83, 'caller': 'desconocido'}
v2                       ✓ {'request_id': 'r-002', 'top1': 'Botas', 'score': 0.61, 'caller': 'web'}
v3, con un campo de más  ✓ {'request_id': 'r-003', 'top1': 'Tenis', 'score': 0.9, 'caller': 'web'}
renombró score           ✗ falta «score»
score como texto         ✗ «score» debería ser float
```

El lector v2 lee lo viejo (hacia atrás) e ignora el campo de la v3 (hacia adelante). El renombre y el cambio de tipo lo rompen. Mejor que rompa así, con un error claro, que en silencio.

:::ojo
Un esquema revisa la forma, no el significado. Un ejemplo: si un equipo cambia una medida de centímetros a milímetros, la columna sigue siendo un float, sin nulos, con el mismo nombre. Pasa cualquier validación de esquema y el modelo recibe números diez veces más grandes. Las unidades y lo que significa cada campo también son parte del contrato, aunque ningún formato las revise.
:::

### Avro: filas binarias con el esquema aparte

[[avro|Avro]] es uno de los formatos binarios por filas más usados para **eventos**: mensajes que un programa manda uno por uno a otro, como los pagos que entran a un sistema de fraude. Nació en 2009 en el proyecto Apache Hadoop, un sistema para guardar y procesar datos repartidos en muchas máquinas. Tiene dos ideas:

- **El esquema se escribe aparte**, en JSON, con el nombre, el tipo y el valor por omisión de cada campo.
- **Los datos no llevan nombres ni marcas**: solo los valores, uno tras otro, en el orden del esquema. Es más compacto que JSON y que [[protobuf]], que pone un número de campo delante de cada valor.

El precio: sin el esquema con que se escribió, los bytes no se pueden leer. Avro y Parquet se complementan. Avro, por filas, para escribir eventos uno por uno; Parquet, por columnas, para analizarlos después.

:::profundo Avro por dentro: el esquema, el registro y los bytes
El esquema de una predicción, en Avro:

```text
{"type": "record", "name": "Prediccion",
 "fields": [{"name": "request_id", "type": "string"},
            {"name": "score", "type": "float"},
            {"name": "caller", "type": "string", "default": "desconocido"}]}
```

Un archivo Avro lleva su esquema en el encabezado, una vez, y después miles de registros. Los eventos que viajan uno por uno no pueden cargar el esquema cada vez: llevan al principio un número chico que lo identifica, y los esquemas viven en un **registro de esquemas** (*schema registry*), un servicio aparte. En el registro más usado, el de Confluent, cada mensaje empieza con 5 bytes: un byte mágico (0) y 4 bytes con el número del esquema. Quien lee pide el esquema por su número, una vez, y lo guarda. El registro hace algo más valioso: cuando un equipo quiere publicar un esquema nuevo, revisa que sea compatible con el anterior y lo rechaza si no, antes de que salga el primer evento.

Al leer, Avro junta dos esquemas: el del que escribió y el del que lee. Empareja los campos **por nombre**; si al que lee le falta uno, lo salta, y si el que lee espera uno que no viene, usa su `default`. Es la tabla de compatibilidad de arriba, hecha regla.

Y los bytes. Cada texto va como su largo seguido de sus bytes de UTF-8, y cada float como sus 4 bytes little-endian. El largo va en un entero de tamaño variable con un truco para los negativos (*zigzag*): un número que no es negativo se escribe como su doble, así que el 5 va como 2 × 5 = 10 (0x0A), y el 3, como 2 × 3 = 6. La predicción `("r-001", 0.83, "web")` queda así:

| Valor | Bytes | Cuántos |
|---|---|---|
| largo de «r-001» | `0A` | 1 |
| «r-001» | `72 2D 30 30 31` | 5 |
| 0.83 | `E1 7A 54 3F` | 4 |
| largo de «web» | `06` | 1 |
| «web» | `77 65 62` | 3 |

Son 1 + 5 + 4 + 1 + 3 = 14 bytes. La misma predicción en JSON, `{"request_id": "r-001", "score": 0.83, "caller": "web"}`, mide 55: los nombres viajan en cada mensaje.
:::

## Archivos de pesos: pickle y safetensors {Weight files: pickle and safetensors}

El último archivo del viaje de Ana es el modelo. Al entrenar, PyTorch guarda un [[checkpoint]]: los pesos de cada capa y, si quieres seguir entrenando, el estado del optimizador. Lo normal es guardar el *state_dict*, un diccionario con un [[tensor]] por capa: `{"fc.weight": tensor de [500, 2048], "fc.bias": tensor de [500], …}`. `fc` es la última capa de la ResNet-50 (*fully connected*, «totalmente conectada»), la que convierte 2,048 números en los 500 scores, uno por categoría.

`torch.save` escribe un **zip**: por eso el `.pt` empezaba con `PK`. Adentro van los bytes de cada tensor y un archivo `data.pkl` que dice cómo armar el diccionario. Ese archivo es un **pickle**.

### Pickle: un programa disfrazado de datos

[[pickle|Pickle]] es la forma propia de Python de [[serializacion|serializar]]: guarda casi cualquier objeto, desde un diccionario hasta uno hecho con una clase que tú escribiste (una clase es la plantilla de un tipo de objeto). ¿Cómo puede guardar objetos que no conoce? Porque un pickle no es una tabla de datos: es una **lista de instrucciones** para una pequeña máquina que los reconstruye, el *unpickler*. «Pon este texto», «busca la función tal del módulo tal», «llámala con esto».

Y ahí está el problema. Si el archivo dice «busca `os.system` (la función de Python que corre un comando del sistema, como si lo escribieras en la terminal) y llámala con este comando», la máquina lo hace. **Cargar un pickle puede ejecutar cualquier código.** La documentación de Python lo advierte: nunca cargues un pickle que no sea de confianza.

Esta demostración es inofensiva: la «trampa» solo llama a `print`. Pero con la misma receta, un archivo puede llamar a cualquier función:

```python
import pickle, pickletools

pesos = {"fc.weight": [0.12, -0.5], "fc.bias": [0.01]}
datos = pickle.dumps(pesos)
print("un diccionario normal:", pickle.loads(datos))

class Sorpresa:                          # cualquiera puede escribir una clase así
    def __reduce__(self):                # «para reconstruirme, llama a esta función»
        return (print, ("¡esto se ejecutó al cargar el archivo!",))

trampa = pickle.dumps({"fc.weight": [0.12, -0.5], "extra": Sorpresa()})
print("el archivo mide", len(trampa), "bytes y nadie ha corrido nada todavía")
resultado = pickle.loads(trampa)         # solo «cargar los pesos»…
print("lo que se cargó:", resultado)
pickletools.dis(pickletools.optimize(pickle.dumps(Sorpresa(), protocol=2)))
```

```salida
un diccionario normal: {'fc.weight': [0.12, -0.5], 'fc.bias': [0.01]}
el archivo mide 126 bytes y nadie ha corrido nada todavía
¡esto se ejecutó al cargar el archivo!
lo que se cargó: {'fc.weight': [0.12, -0.5], 'extra': None}
    0: \x80 PROTO      2
    2: c    GLOBAL     '__builtin__ print'
   21: X    BINUNICODE '¡esto se ejecutó al cargar el archivo!'
   66: \x85 TUPLE1
   67: R    REDUCE
   68: .    STOP
highest protocol among opcodes = 2
```

Las últimas líneas son las instrucciones del pickle, traducidas por `pickletools`: `GLOBAL` busca la función `print`, `BINUNICODE` pone el texto, `TUPLE1` lo empaca como sus argumentos y `REDUCE` la llama. El que carga el archivo no escribió nada de eso.

No es teoría. En 2024, la empresa de seguridad JFrog encontró en Hugging Face, el repositorio público de modelos más grande, archivos de pesos que, al cargarse, abrían una conexión hacia la máquina de un atacante. Y lo mismo vale para los modelos de scikit-learn guardados con pickle o con joblib.

### Dos defensas

La primera: `torch.load(ruta, weights_only=True)`. Con esa opción, PyTorch usa una máquina restringida que solo sabe armar tensores y tipos básicos, y se niega a llamar cualquier otra función. Desde PyTorch 2.6 es el comportamiento por omisión; el código viejo y muchos tutoriales cargaban todo. Ayuda mucho, pero sigue siendo un pickle: en abril de 2025 se publicó una manera de saltarla en las versiones hasta la 2.5.1 (la CVE-2025-32434, el número con que quedó registrada en la lista pública de fallas de seguridad; se corrigió en la 2.6). PyTorch viejo, protección vieja.

La segunda, mejor: un formato que no tenga nada que ejecutar. [[safetensors|Safetensors]], de Hugging Face, es solo esto:

1. Ocho bytes con el largo del encabezado, un entero little-endian.
2. El encabezado, en JSON: el nombre de cada tensor, su [[dtype]], su [[shape]] y dónde empiezan y terminan sus bytes.
3. Los bytes de todos los tensores, uno tras otro.

Leerlo es `json.loads` y copiar bytes: nada se ejecuta. Además, como el encabezado dice dónde está cada tensor, se puede abrir con [[mmap]] y leer solo los que hacen falta, como viste en «Memoria, caché y disco». Desde fines de 2023, la librería `transformers` de Hugging Face guarda los modelos en safetensors por omisión, y es el formato de casi todos los modelos de su Hub. Este programa escribe uno chiquito y lo lee con lo que viene con Python:

```python
import json, struct

def escribir_safetensors(tensores):          # {nombre: (dtype, shape, lista de floats)}
    encabezado, datos, inicio = {}, b"", 0
    for nombre, (dtype, shape, valores) in tensores.items():
        crudo = struct.pack(f"<{len(valores)}f", *valores)
        encabezado[nombre] = {"dtype": dtype, "shape": shape, "data_offsets": [inicio, inicio + len(crudo)]}
        datos += crudo
        inicio += len(crudo)
    h = json.dumps(encabezado, separators=(",", ":")).encode()
    return struct.pack("<Q", len(h)) + h + datos   # 8 bytes con el largo, el JSON y los números

archivo = escribir_safetensors({"fc.bias": ("F32", [3], [0.01, -0.2, 0.5]),
                                "fc.weight": ("F32", [3, 2], [0.12, -0.5, 0.3, 0.0, 1.5, -1.0])})
largo = struct.unpack("<Q", archivo[:8])[0]
print("primeros 8 bytes:", archivo[:8].hex(" "), "→ el encabezado mide", largo, "bytes")
encabezado = json.loads(archivo[8:8 + largo])   # solo json.loads: nada que ejecutar
print(encabezado["fc.weight"])
a, b = encabezado["fc.weight"]["data_offsets"]
inicio = 8 + largo
pesos = struct.unpack("<6f", archivo[inicio + a:inicio + b])
print("fc.weight:", [round(x, 2) for x in pesos], "· archivo de", len(archivo), "bytes")
```

```salida
primeros 8 bytes: 7e 00 00 00 00 00 00 00 → el encabezado mide 126 bytes
{'dtype': 'F32', 'shape': [3, 2], 'data_offsets': [12, 36]}
fc.weight: [0.12, -0.5, 0.3, 0.0, 1.5, -1.0] · archivo de 170 bytes
```

El 0x7E es 7 × 16 + 14 = 126. La librería real, además, rellena el encabezado con espacios hasta un múltiplo de 8; el formato lo permite y no cambia nada más. Los `data_offsets` cuentan desde donde termina el encabezado: `fc.weight` va después de los 12 bytes de `fc.bias` (3 números × 4 bytes).

:::diagrama formatos-pesos
Dos maneras de cargar unos pesos. Toca cada caja; «Recorrer» sigue un `.pt` con trampa y un safetensors.
:::

Con PyTorch y la librería `safetensors` instalados, el cambio son dos líneas. Es una ilustración, sin salida:

```python
import torch
from safetensors.torch import save_file, load_file

torch.save(modelo.state_dict(), "modelo.pt")                  # un zip con un pickle adentro
estado = torch.load("modelo.pt", map_location="cpu", weights_only=True)
save_file(modelo.state_dict(), "modelo.safetensors")          # encabezado JSON y bytes
modelo.load_state_dict(load_file("modelo.safetensors", device="cpu"))
```

Y una costumbre que vale para cualquier formato: guarda el hash de cada archivo de pesos en el registro de modelos (el catálogo de las versiones del modelo) y compruébalo antes de cargarlo. Un [[hash-criptografico|hash criptográfico]] es una huella del contenido que cambia si cambia un solo byte; lo vas a ver en «Tiempo, hashes e identificadores».

En su primera versión, el sistema de Alba cargaba el `.pt` del notebook al arrancar. La versión final ya no: lo exporta a [[onnx|ONNX]], un formato para correr el modelo fuera de PyTorch, y de ahí arma un [[engine-tensorrt|engine de TensorRT]] compilado para su GPU. Ninguno de los dos usa pickle; los vas a ver en la lección «Export, engine y paridad».

:::profundo Otros archivos de pesos que vas a encontrar
- **`.pth` y `.bin`**: los mismos zip con pickle de PyTorch, con otra extensión. Muchos modelos viejos de Hugging Face vienen como `pytorch_model.bin`.
- **`.pkl` y `.joblib`**: modelos de scikit-learn, XGBoost o LightGBM guardados con pickle. El mismo riesgo.
- **`.h5` y `.keras`**: los de Keras. El `.h5` es HDF5, un formato binario para datos científicos con carpetas por dentro; el `.keras` de Keras 3 es un zip con la configuración en JSON y los pesos en HDF5.
- **GGUF**: el de llama.cpp, para correr LLMs en una laptop: un solo archivo con los pesos, casi siempre [[cuantizacion|cuantizados]] (guardados en menos bits, como 4 u 8 por número), y la información para usarlos.
- **`.onnx`** y **`.plan`**: el ONNX es un mensaje de protobuf con el grafo y los pesos; el `.plan` es el engine de TensorRT, atado a un tipo de GPU y a una versión de TensorRT.

La pregunta para cada uno es la misma: ¿al abrirlo se ejecuta algo? Si sí, solo lo abres si sabes de dónde viene.
:::

## Errores comunes {Common mistakes}

### 1. Creerle a la extensión

Un `.jpg` que en realidad es un HEIC (el formato de fotos del iPhone), un `.csv` separado con punto y coma, un `.json` que es JSON Lines. El programa truena lejos del problema, o no truena y lee basura.

**Cómo evitarlo:** revisar los bytes mágicos en la puerta (como el gateway de Alba) y leer con el lector del formato real. En los datos, declarar el formato y el separador por escrito.

### 2. Leer con la codificación equivocada

«NiÃ±o» en un reporte, «Ã³» en las categorías. Casi siempre es UTF-8 leído como Latin-1 o como la tabla de Windows, muy a menudo al abrir un CSV con doble clic en Excel.

**Cómo evitarlo:** `encoding="utf-8"` en cada `open`, al leer y al escribir. Si ya ves «Ã±», no lo arregles a mano: vuelve a leer el archivo con la codificación correcta.

### 3. Confiar en los tipos de un CSV

El código 007 se vuelve 7, un código postal de la Ciudad de México como el 06600 pierde su cero, una fecha se voltea, un id largo se redondea. Nadie avisa.

**Cómo evitarlo:** leer todo como texto y convertir a propósito, con el tipo que dice el contrato. Para datos que se quedan, Parquet: el tipo va escrito.

### 4. Cargar un pickle ajeno

Bajar un `modelo_final.pt` de un foro y hacer `torch.load(ruta)` en una versión vieja de PyTorch es correr el código de un desconocido en tu máquina, con tus permisos.

**Cómo evitarlo:** pesos en safetensors siempre que se pueda; si no, `weights_only=True` con PyTorch al día. Fuente conocida, versión fijada y hash comprobado antes de cargar.

### 5. Dejar que YAML adivine

`NO` se vuelve `false`, `1.10` se vuelve 1.1, un puerto como `22:22` se vuelve un número de base 60. El manifiesto «se ve bien» y hace otra cosa.

**Cómo evitarlo:** comillas en todo texto que pueda parecer número, fecha o booleano, `safe_load` siempre, y un validador del esquema (en Kubernetes, uno que revise los manifiestos antes de aplicarlos).

### 6. Renombrar una columna «porque se lee mejor»

Cambiar `score` por `confianza` en el log rompe a la vez el job de drift, el dashboard y el entrenamiento del mes que viene, y a veces en silencio.

**Cómo evitarlo:** solo agregar campos opcionales; para renombrar, escribir los dos campos un tiempo y quitar el viejo cuando nadie lo lea. Validar el esquema al escribir y al leer.

## En la vida real {In real life} [extra]

### Alba: un formato para cada cosa

| Qué | Formato | Por qué ese |
|---|---|---|
| La foto de Ana | JPEG (o PNG o WebP), tal como llegó | Ya viene comprimida; volver a comprimirla no gana nada |
| Cada predicción | JSON Lines → Parquet por fecha y `model_version` | Se añade línea por línea; se consulta por columnas |
| Las 500 categorías | `labels.json`, guardado junto al modelo | Chico, lo leen personas, va con la versión del modelo |
| El manifest de cada dataset | Parquet, una fila por imagen | 2 M filas: hash, ruta, etiqueta, fuente y fecha |
| Manifiestos, compose y alertas | YAML | Los escriben y revisan personas |
| Los pesos | `.pt` al entrenar → ONNX → engine de TensorRT | El `.pt` es un pickle: nunca sale del pipeline propio |

El *manifest* de un dataset (nada que ver con los manifiestos de Kubernetes) es su lista de imágenes: una fila por foto, con su hash, dónde está guardada y su etiqueta. Es un buen ejemplo de por qué no se copian las fotos. El equipo de Alba estima que cada fila mide ≈ 200 B sin comprimir: 2 M filas × 200 B ≈ 400 MB, contra 2 M fotos × ≈ 200 KB ≈ 400 GB de las fotos que referencia. Un dataset nuevo cuesta 400 MB ÷ 400 GB = 0.1 % de copiar las imágenes. Y Alba consulta los logs tal como quedan, `logs/dt=AAAA-MM-DD/part-0.parquet`, con DuckDB, un programa que hace consultas en SQL (el lenguaje de las bases de datos) directo sobre archivos Parquet.

### Fraude: los pagos como eventos en Avro

Un sistema de detección de fraude en tiempo real recibe, en este ejemplo, ≈ 10 millones de pagos al día. Cada pago entra como un evento de ≈ 1 KB en Avro a un [[stream-eventos|stream]] de Kafka (el sistema por donde viajan sus eventos) llamado `txn-events`: 10 M × 1 KB ≈ 10 GB al día. Avro tiene sentido ahí: los eventos se escriben uno por uno, ocupan poco y el registro de esquemas impide que un equipo publique un evento con un campo renombrado que rompería al modelo. Lo vas a ver en «Colas y streams».

### Búsqueda: 100 millones de embeddings en Parquet

La búsqueda con embeddings de Alba guarda cada versión de sus [[embedding|embeddings]] en Parquet: uno por cada una de sus ≈ 100 M publicaciones activas, de 512 números en float32. Son 100 M × 512 × 4 B ≈ 205 GB. En JSON, con los ≈ 20.4 bytes por número que mediste en la lección de APIs, serían 100 M × 512 × 20.4 B ≈ 1 TB, cinco veces más. Y comprimirlos ayuda poco: los últimos bits de cada float son casi al azar.

### Los LLMs: safetensors partidos en pedazos

Los modelos de lenguaje abiertos se publican en safetensors, partidos en varios archivos de unos cuantos GB (*shards*) con un JSON índice que dice en cuál va cada tensor. vLLM, un programa con el que se sirve un LLM propio, los abre con mmap. Y conviene que cargue solo safetensors: un `.bin` de PyTorch es un pickle.

### Fuera de ML: genes, hojas de cálculo y ceros

En 2016, un estudio revisó artículos de genética con listas de genes en hojas de Excel y encontró errores en cerca de una quinta parte: Excel convertía nombres como SEPT2 o MARCH1 en fechas. En 2020, el comité que nombra los genes humanos les cambió el nombre (SEPTIN2, MARCHF1) para que Excel los dejara en paz. Es el error 3 a escala mundial: un formato sin tipos y un programa que adivina.

En octubre de 2020, Inglaterra dejó de reportar 15,841 casos positivos de COVID, los de las pruebas del 25 de septiembre al 2 de octubre. Los laboratorios mandaban sus resultados en CSV, y un paso del proceso los pasaba al formato viejo de Excel, `.xls`, que admite 65,536 filas por hoja. Lo que no cabía se cortó sin aviso. 65,536 es 2¹⁶: el tope de un entero de 16 bits sin signo, como viste en «Cómo guarda números una computadora».

Y en México, muchos códigos postales de la Ciudad de México empiezan con 0, del 01000 al 09999, como el 06600 de la colonia Juárez. Una columna de códigos postales leída como número los deja en 6600, un código de cuatro dígitos que no existe. Es el 007 de la sección de CSV, con direcciones reales.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de logs y consultas se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] ¿Cuántos bytes ocupan «año» y «Café ☕» en UTF-8? ¿Qué te da `len()` en Python para cada uno?
- «año»: a (1) + ñ (2) + o (1) = **4 bytes**. `len("año")` da **3**: cuenta caracteres.
- «Café ☕»: C, a, f (1 cada una) + é (2) + espacio (1) + ☕ (3: es el U+2615, de los de 3 bytes) = 3 + 2 + 1 + 3 = **9 bytes**. `len()` da **6**.
- Para saber lo que mide en el archivo: `len(texto.encode("utf-8"))`.
? [facil] Te dan cuatro archivos sin extensión. Empiezan con `89 50 4E 47`, `50 4B 03 04`, `1F 8B` y `50 41 52 31`. ¿Qué es cada uno?
- `89 50 4E 47`: **PNG** (las últimas tres son «PNG»).
- `50 4B 03 04`: **zip** («PK»). Puede ser un `.pt` de PyTorch, pero también un `.docx` o un `.xlsx`: hay que abrirlo para saber.
- `1F 8B`: **gzip**, por ejemplo un `.jsonl.gz` de logs.
- `50 41 52 31`: «PAR1», **Parquet**.
? [facil] La línea de CSV `012,"Botas, negras",1200` ¿cuántos campos tiene? ¿Qué sale si la partes con `split(",")`? ¿Y si un programa convierte la primera columna en número?
- **3 campos**: `012`, `Botas, negras` y `1200`. Las comillas protegen la coma.
- Con `split(",")` salen **4 pedazos**: `012`, `"Botas`, ` negras"` y `1200`.
- Convertida en número, la primera columna vale **12**: el cero se perdió.
? [medio] Alba guarda 10 M líneas de log al día, de ≈ 300 B, durante 90 días. ¿Cuánto ocupa en JSON Lines? Si en Parquet ocupa 6 veces menos, ¿cuánto se ahorra?
- Con \(S_{día} = N × b\) y \(S_{ret} = S_{día} × d\): al día, 10⁷ × 300 B = **3 GB**. En 90 días: 3 GB × 90 = **270 GB**.
- En Parquet, \(S_{día} ÷ r\) con \(r\) = 6: 3 GB ÷ 6 = **0.5 GB al día**, y 0.5 GB × 90 = **45 GB**.
- Ahorro, \(S_{ret} − S_{ret} ÷ r\): 270 − 45 = **225 GB**. Y cada lectura del job de drift también baja, porque lee solo sus columnas.
? [medio] Una tabla de 10 M filas tiene 30 columnas de ≈ 10 bytes cada una. Una consulta lee 3 columnas. ¿Cuántos bytes lee por filas y cuántos en Parquet, si comprime 5 veces? ¿Cuántas veces menos?
- Por filas, todo: \(L_{filas} = N × C × u\) = 10⁷ × 30 × 10 B = **3 GB**.
- En Parquet: \(L_{col} = N × k × u ÷ r\) = 10⁷ × 3 × 10 B ÷ 5 = 300 MB ÷ 5 = **60 MB**.
- \(L_{filas} ÷ L_{col}\) = 3,000 MB ÷ 60 MB = **50 veces menos**.
? [medio] Un Parquet tiene 8 row groups. El máximo de `ms` en cada uno es 180, 210, 950, 190, 205, 230, 175 y 640. Para «ms > 500», ¿cuántos se leen? ¿Y para «ms < 20», si el mínimo de todos es 25 o más?
- «ms > 500»: solo los que tienen máximo arriba de 500, el de 950 y el de 640: **2 de 8**, el 25 %.
- «ms < 20»: si ningún row group tiene mínimo menor que 20, ninguno puede tener una fila así: **0 de 8**. La respuesta sale del pie, sin leer datos.
- Ojo: un row group que se lee no garantiza filas que cumplan. Las estadísticas solo descartan.
? [medio] El log de Alba está en la versión 1: `request_id`, `top1` y `score`. Clasifica estos cambios: (a) agregar `caller` opcional, con «desconocido» por omisión; (b) renombrar `score` a `confianza`; (c) cambiar `top1` del nombre de la categoría a su número; (d) agregar `gpu` obligatorio.
- (a) **Compatible en las dos direcciones**: el lector nuevo usa «desconocido» en lo viejo y el viejo ignora el campo nuevo.
- (b) **Rompe las dos**: el lector viejo no encuentra `score` y el nuevo no encuentra `confianza` en lo viejo.
- (c) **Rompe las dos**: cambió el tipo, y además el significado.
- (d) **Hacia adelante sí, hacia atrás no**: el lector viejo lo ignora, pero el nuevo no lo encuentra en los logs viejos.
? [reto] Un safetensors empieza con `B4 00 00 00 00 00 00 00`. ¿Cuánto mide el encabezado? Si dice que `fc.weight` es F32 de shape [500, 2048] y `fc.bias` es F32 de shape [500], ¿cuántos bytes miden los datos y el archivo completo? ¿En qué byte del archivo empieza `fc.bias`, si va después de `fc.weight`?
- El largo es un entero little-endian: el byte más chico es `B4` y los demás valen 0. 0xB4 = 11 × 16 + 4 = **180 bytes**.
- Un tensor F32 mide \(text{bytes} = text{elementos} × 4\), y los elementos son el producto de su shape. `fc.weight`: 500 × 2048 × 4 B = **4,096,000 bytes**. `fc.bias`: 500 × 4 B = **2,000 bytes**. Datos: 4,096,000 + 2,000 = 4,098,000.
- Archivo: 8 bytes del largo + 180 del encabezado + 4,098,000 de datos = **4,098,188 bytes**.
- `fc.bias` empieza en el offset 4,096,000 de los datos, que en el archivo es 8 + 180 + 4,096,000 = **byte 4,096,188**. Con `seek` se salta directo ahí.
? [reto] Un compañero te pasa `resnet_final.pt`, que bajó de un foro, y te pide que lo cargues en el servidor de Alba «para probar». ¿Qué haces, y en qué orden?
- No lo cargas en el servidor. Un `.pt` es un zip con un pickle: cargarlo puede ejecutar cualquier código con los permisos del servidor.
- Primero, de dónde viene: si existe una versión publicada por una organización conocida, de preferencia en safetensors, se usa esa, en una revisión fijada, y se guarda su hash.
- Si solo existe el `.pt`, se abre en una máquina aislada, sin credenciales ni red, con PyTorch al día y `weights_only=True`. Si la carga se niega, es una alarma: el archivo pide algo más que tensores.
- Si carga bien, se guarda el state_dict como safetensors, se registra su hash y, como cualquier modelo nuevo, pasa la evaluación antes de acercarse a producción.
:::

## Lo que sigue {What comes next}

Las siguientes lecciones de esta fase usan estos archivos. «Bases de datos» guarda filas que se cambian una por una, lo que Parquet no hace bien. «Object storage, data lakes y warehouses» pone los Parquet en S3 y los particiona. «Colas y streams» lleva los eventos Avro por Kafka. Y «Tiempo, hashes e identificadores» explica la hora que el log no trae y el hash que identifica cada foto. Más adelante, «Datos y etiquetas» consulta estos Parquet con DuckDB, y «Export, engine y paridad» convierte los pesos a ONNX y a un engine.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
archivo formato-archivo formato-binario utf-8 csv json-lines yaml parquet formato-columnar compresion esquema-datos evolucion-esquema avro pickle safetensors
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Si renombras `tenis.jpg` como `tenis.png`, ¿qué cambia en el archivo?
Nada: la extensión es parte del nombre. Los bytes siguen empezando con `FF D8 FF`, la firma de JPEG. Un programa cuidadoso mira esa firma.
? ¿Cuántos bytes ocupa la ñ en UTF-8, y qué sale si alguien la lee como Latin-1?
Dos: C3 B1. Latin-1 lee cada byte como una letra y sale «Ã±»: «niño» se vuelve «niÃ±o».
? Da tres maneras en que un CSV cambia datos sin avisar.
Un campo con coma o salto de línea partido a mano; un 007 que se vuelve 7; una fecha que se voltea.
? ¿Por qué Alba escribe sus logs en JSON Lines y no directamente en Parquet?
JSON Lines se añade línea por línea, y una línea rota pierde solo un registro. Parquet necesita juntar muchas filas para cada row group. Se escribe en JSON Lines y se convierte a Parquet en lotes.
? ¿Por qué el job de drift lee mucho menos en Parquet que en JSON Lines?
Lee solo sus columnas (2 de 30), comprimidas y en su tipo, y se salta row groups y particiones. En un día de Alba, ≈ 40 MB en vez de 3 GB.
? ¿Qué cambios de esquema no rompen a nadie?
Agregar un campo opcional con valor por omisión: el lector nuevo lo rellena en lo viejo y el viejo lo ignora. Renombrar o cambiar el tipo rompe a los dos lados.
? ¿Por qué safetensors es más seguro que un `.pt`?
Un `.pt` trae un pickle: instrucciones que pueden llamar cualquier función al cargarse. Safetensors es un largo, un encabezado JSON y bytes; leerlo no ejecuta nada.
:::
