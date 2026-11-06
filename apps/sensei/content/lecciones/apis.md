---
titulo: APIs: REST, JSON, gRPC y streaming
en: APIs: REST, JSON, gRPC and streaming
subtitulo: Cómo se ponen de acuerdo dos programas que nunca se han visto: el contrato, el formato de los datos, cuánto pesa y cuánto tarda cada formato, y cómo llega una respuesta que tarda segundos o minutos.
pregunta: ¿Cómo se ponen de acuerdo dos programas que nunca se han visto para pedirse cosas, y por qué C01 contesta en JSON hacia afuera pero le manda los tensores a Triton en binario?
requisitos: http
---

:::idea
Una API funciona porque las dos partes firman el mismo contrato: qué se puede pedir, cómo se escribe, qué regresa y qué pasa si sale mal. Hacia las personas y otros equipos conviene un formato de texto que cualquiera lea, como JSON; entre máquinas que se mandan megabytes cientos de veces por segundo, conviene uno binario. Y cuando la respuesta tarda, se manda por pedazos o se avisa al terminar.
:::

En la lección de [[http|HTTP]] viste cómo viaja una [[request]]: un [[metodo-http|método]], una dirección ([[url]]), unos encabezados ([[header|headers]]), un cuerpo ([[body]]) y, de regreso, un [[codigo-estado|código de estado]]. Eso es el sobre y el cartero. Falta lo que va adentro de la carta: en qué idioma se escribe, qué campos lleva y qué hace el otro programa con ella.

Esta lección abre la carta. Vas a ver qué se acuerda en una [[api]], cómo se escriben los datos para que viajen (JSON, base64, protobuf), cuánto pesa y cuánto tarda cada forma, y qué se hace cuando la respuesta no cabe en un solo viaje: el streaming de un LLM y los trabajos de varios minutos. El hilo es la foto de los tenis de Ana, que entra a C01 como JPEG y sale como cinco categorías.

## Dos programas que nunca se han visto {Two programs that have never met}

El backend del marketplace, el programa que atiende la app de Ana, lo escribió un equipo. El gateway de C01, el programa que recibe la foto y se la pasa al modelo, lo escribió otro. Quizás en lenguajes distintos, en meses distintos. Para que el primero le pida algo al segundo, los dos tienen que estar de acuerdo en cinco cosas:

:::pasos
1. Dónde
A qué máquina y a qué dirección se manda la request.
2. Qué se puede pedir
Las operaciones que existen: clasificar una foto, consultar un trabajo, borrar un archivo.
3. Cómo se escribe
El formato de los datos que van: una foto en bytes, un texto, un número.
4. Qué regresa
La forma exacta de la respuesta: qué campos trae y de qué tipo es cada uno.
5. Qué pasa si sale mal
Qué error regresa si la foto no sirve, si el servidor está saturado o si se acabó el tiempo.
:::

Ese acuerdo escrito es el **contrato** de la API. La [[api]] es la ventanilla; el contrato es el reglamento pegado en el vidrio. La Ronda lo subraya en M02: el contrato no es solo la entrada y la salida, también dice qué pasa cuando no llegas a tiempo.

### El endpoint: una puerta de la API

Cada operación de una API tiene su puerta, el [[endpoint]]: un [[metodo-http|método HTTP]] más una ruta. El de C01 es **`POST /v1/classify`**. La misma ruta con otro método es otro endpoint, con otro contrato: `GET /v1/jobs/8f3a` consulta un trabajo y `DELETE /v1/jobs/8f3a` lo cancela.

Detrás del signo `?` van los parámetros de la consulta (*query parameters*), que afinan la petición sin cambiar de puerta: en `POST /v1/classify?top_k=5`, el `top_k=5` pide las cinco categorías más probables.

:::figura apis-anatomia
La request de C01 y su respuesta, por partes. La foto viaja como bytes crudos en el cuerpo; solo la respuesta está escrita en JSON.
:::

Fíjate en un detalle de la figura: la request de C01 **no lleva JSON**. El cuerpo son los bytes del JPEG, tal cual, y el encabezado `Content-Type: image/jpeg` dice qué son. El JSON aparece solo en la respuesta. En la sección 3 verás por qué.

### REST: cosas con nombre y verbos

Hay muchas maneras de organizar los endpoints. La más común en la web se llama [[rest|REST]] (*Representational State Transfer*), y la describió Roy Fielding en su tesis doctoral del año 2000. Sus ideas, en palabras simples:

- **Las cosas tienen nombre.** Cada cosa que la API maneja (un trabajo, un modelo, un usuario) es un **recurso** con su propia URL: `/v1/jobs/8f3a` es el trabajo 8f3a.
- **Los métodos son los verbos.** `GET` lee, `POST` crea o manda algo para procesar, `PUT` reemplaza, `DELETE` borra. No se inventan rutas como `/v1/borrarTrabajo`.
- **Sin estado** (*stateless*). Cada request trae todo lo que el servidor necesita para responderla. El servidor no recuerda la request anterior de ese cliente.
- **Los [[codigo-estado|códigos de estado]] dicen lo que dicen**: 200 salió bien, 404 no existe, 503 estoy saturado.

| Quiero… | Endpoint REST |
|---|---|
| Crear un trabajo de OCR | `POST /v1/jobs` |
| Saber cómo va | `GET /v1/jobs/8f3a` |
| Cancelarlo | `DELETE /v1/jobs/8f3a` |
| Ver qué modelos hay | `GET /v1/models` |

¿Por qué importa «sin estado»? Porque si ninguna copia del servidor recuerda nada, **cualquier copia puede contestar cualquier request**. C01 corre varias copias del gateway detrás de un [[balanceador]] (el programa que reparte las requests entre las copias; lo verás en «Balanceadores, proxies y gateways»), y puede agregar o quitar copias sin que ningún cliente lo note.

:::nota «REST» en el trabajo
`/v1/classify` no es un recurso: es un verbo («clasifica»). Muchas APIs de ML son así, y está bien. En el trabajo, «una API REST» casi siempre quiere decir «una API por HTTP, con JSON y códigos de estado». Lo que importa es que el contrato sea claro, no la pureza del estilo.
:::

:::profundo Otros dos estilos: JSON-RPC y GraphQL
REST no es la única manera de organizar una API. Vas a encontrar otras dos.

**JSON-RPC** manda todo a una sola dirección, siempre con `POST`, y el nombre de la operación va dentro del JSON: `{"jsonrpc": "2.0", "method": "classify", "params": {"top_k": 5}, "id": 7}`. La respuesta trae el mismo `id`, para saber a qué pregunta contesta. Es el estilo de MCP (*Model Context Protocol*), el estándar con que los agentes de M14 descubren y llaman herramientas.

**GraphQL**, que Facebook publicó en 2015, también usa una sola dirección, pero el cliente escribe una consulta que dice exactamente qué campos quiere, ni uno más. Sirve cuando muchas pantallas distintas piden pedazos distintos de los mismos datos. En el serving de modelos casi no aparece.

Los tres resuelven lo mismo: escribir el contrato para que dos programas que no se conocen se entiendan.
:::

## JSON y serialización: los datos como texto {JSON and serialization: data as text}

Dentro de un programa de Python, un diccionario vive en la memoria en una forma que solo ese programa entiende. Para mandarlo por la red hay que convertirlo en una fila de [[byte|bytes]], y el otro lado tiene que reconstruirlo. Convertir datos en bytes para guardarlos o mandarlos se llama [[serializacion|serializar]] (*serialize*); reconstruirlos del otro lado, **deserializar**.

:::analogia La mudanza de un mueble
Para mudar un librero lo desarmas, lo metes en cajas y mandas un instructivo. Del otro lado alguien lo arma igual. Serializar es desarmar y empacar; el formato es el instructivo, y las dos partes tienen que leer el mismo.

**Dónde se rompe:** el librero se arma una vez. Una API serializa y deserializa en cada request, cientos de veces por segundo, y cada vez cuesta tiempo de CPU. Con datos grandes, empacar puede tardar más que pensar la respuesta.
:::

### JSON: seis tipos y nada más

El formato más usado para serializar en las APIs es [[json|JSON]] (*JavaScript Object Notation*). Lo popularizó Douglas Crockford a principios de los 2000, hoy lo define un estándar del IETF, el grupo que escribe las reglas técnicas de internet (el RFC 8259, de 2017) y lo leen todos los lenguajes. Es texto: lo puedes abrir y leer. Solo tiene seis tipos de valor:

| Tipo | Se escribe | Ejemplo |
|---|---|---|
| Objeto | Pares nombre: valor entre llaves | `{"label": "Tenis", "score": 0.83}` |
| Arreglo | Valores en orden, entre corchetes | `[3, 224, 224]` |
| Texto | Entre comillas dobles | `"2026-09-01-resnet50-fp16"` |
| Número | Con o sin decimales | `5`, `0.83`, `-1.7e-3` |
| Booleano | `true` o `false` | `false` |
| Nulo | `null` | `null` |

Igual de importante es lo que **no** tiene:

- **Bytes.** No hay manera de meter un JPEG tal cual. Hay que convertirlo en texto (sección 3).
- **Fechas.** Se escriben como texto, por convención en el formato ISO 8601: `"2026-11-05T14:03:00Z"`. Cada lado tiene que saber que ese texto es una fecha.
- **NaN e infinito.** El estándar no los permite. Un modelo que devuelve un `NaN` (lo viste en «Cómo guarda números una computadora») no se puede escribir en JSON válido.
- **Enteros grandes, en la práctica.** El estándar no pone límite a los números, pero casi todos los lectores de JSON, empezando por el de JavaScript, guardan cada número como [[punto-flotante|FP64]], con 53 bits de dígitos: arriba de 2⁵³ = 9,007,199,254,740,992, los enteros ya no son exactos. El propio RFC avisa que solo los enteros por debajo de 2⁵³ viajan seguros entre lenguajes.

```python
import json, datetime

pedido = {"top_k": 5, "fuente": "app", "fotos": ["tenis.jpg"], "urgente": False, "nota": None}
texto = json.dumps(pedido)                     # serializar: del objeto de Python al texto
print(texto, "·", len(texto), "bytes")
print("¿vuelve igual?", json.loads(texto) == pedido)   # deserializar: del texto al objeto

print(json.dumps({"shape": (3, 224, 224)}))    # la tupla regresa como lista
for raro in (b"\xff\xd8\xff", datetime.date(2026, 11, 5)):
    try:
        json.dumps(raro)
    except TypeError as error:
        print("no se puede:", error)

print(json.dumps([0.83, float("nan")]))        # Python lo escribe, pero eso ya no es JSON
try:
    json.dumps(float("nan"), allow_nan=False)
except ValueError as error:
    print("con allow_nan=False:", error)
print(9007199254740993, "como float de 64 bits:", float(9007199254740993))
```

```salida
{"top_k": 5, "fuente": "app", "fotos": ["tenis.jpg"], "urgente": false, "nota": null} · 85 bytes
¿vuelve igual? True
{"shape": [3, 224, 224]}
no se puede: Object of type bytes is not JSON serializable
no se puede: Object of type date is not JSON serializable
[0.83, NaN]
con allow_nan=False: Out of range float values are not JSON compliant: nan
9007199254740993 como float de 64 bits: 9007199254740992.0
```

La trampa está en la sexta línea de la salida: Python escribe `NaN` sin quejarse, y el cliente de otro lenguaje truena al leerlo. Con `allow_nan=False`, el error sale de tu lado, donde lo puedes atender.

### Cuánto pesa un número escrito con letras

En binario, un [[float32]] ocupa 4 bytes, siempre. En JSON se escribe con sus cifras: `-1.7754088640213013` son 19 letras, más la coma y el espacio. El programa de abajo arma el tensor de la foto de Ana con píxeles al azar, normalizados como en C01, y lo mide de las dos maneras:

```python
import json, random, struct, time

random.seed(0)
n = 3 * 224 * 224                                  # el tensor de la foto de Ana
medias, desv = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
valores = []
for c in range(3):                                 # píxeles al azar, normalizados como en C01
    for _ in range(224 * 224):
        v = (random.randint(0, 255) / 255 - medias[c]) / desv[c]
        valores.append(struct.unpack("<f", struct.pack("<f", v))[0])   # redondeado a float32

binario = struct.pack(f"<{n}f", *valores)          # 4 bytes por número, tal cual
texto = json.dumps(valores)                        # cada número escrito con sus cifras
corto = json.dumps([round(v, 4) for v in valores])
print(f"binario:              {len(binario):>9,} B")
print(f"JSON:                 {len(texto):>9,} B · {len(texto) / n:.1f} B por número · {len(texto) / len(binario):.1f} veces")
print(f"JSON con 4 decimales: {len(corto):>9,} B")
print("así empieza el JSON:", texto[:58])

t0 = time.perf_counter(); json.dumps(valores); t_json = time.perf_counter() - t0
t0 = time.perf_counter(); struct.pack(f"<{n}f", *valores); t_bin = time.perf_counter() - t0
print("¿json.dumps tardó más de 10 veces lo que struct.pack?", t_json > 10 * t_bin)
```

```salida
binario:                602,112 B
JSON:                 3,069,263 B · 20.4 B por número · 5.1 veces
JSON con 4 decimales: 1,256,173 B
así empieza el JSON: [1.255672574043274, 1.563918113708496, -1.7754088640213013
¿json.dumps tardó más de 10 veces lo que struct.pack? True
```

:::cuenta El tensor de la foto de Ana, escrito de cada forma
Números del tensor | 3 × 224 × 224 | 150,528
En binario // [[float32]]: 4 bytes cada uno | 150,528 × 4 B | 602,112 B ≈ 602 KB
En JSON // medido arriba: ≈ 20.4 B por número; la Ronda midió ≈ 20.6 | 150,528 × 20.4 B | ≈ 3.07 MB, 5.1 veces más
En JSON con 4 decimales // medido arriba: ≈ 8.35 B por número; y cambiaste la entrada del modelo | 150,528 × 8.35 B | ≈ 1.26 MB
Red a 500 por segundo, binario // × 8: cada byte son 8 bits | 602 KB × 500 × 8 | ≈ 2.4 Gb/s
Red a 500 por segundo, JSON | 3.07 MB × 500 × 8 | ≈ 12.3 Gb/s
= El mismo tensor pesa 5 veces más escrito como texto. En el pico de diseño de C01, eso es pasar de ≈ 2.4 a ≈ 12 Gb/s de red.
:::

En la lección de unidades viste que cada una de las dos máquinas del gateway de C01 sostiene ≈ 1.56 Gb/s de red: los ≈ 2.4 Gb/s del binario ya ocupan buena parte de las dos, y los ≈ 12.3 del JSON no caben ni de lejos.

:::figura apis-tamanos
Los mismos 150,528 números, en cinco formas. La barra más larga, el JSON con todas las cifras, pesa 20 veces la más corta, la de [[uint8]].
:::

El peso no es lo único. **Escribir y leer el texto cuesta CPU.** La Ronda (M07) midió en una laptop (una Apple M4) ≈ 50 ms para serializar ese tensor con `json.dumps` y ≈ 23 ms más para leerlo de vuelta. A 500 requests por segundo, son 500 × 0.05 s = 25 segundos de CPU por cada segundo: solo serializar ocuparía ≈ 25 [[nucleo|núcleos]] todo el tiempo. Los tiempos cambian según la máquina; la proporción contra el binario, de decenas de veces, se mantiene.

:::calculadora apis-tamano
Prueba un tensor en uint8 (1 byte por número), o un [[embedding]] de 768 números a 1,000 requests por segundo.
:::

:::profundo Por qué un número ocupa 20 letras
Cuando Python escribe un float en texto, busca el decimal más corto que, al leerlo de vuelta, dé exactamente el mismo número de 64 bits. Para un número que nació en FP64, como 0.83, basta con «0.83». Pero los números del tensor nacieron en float32 y se pasaron a FP64: en decimal ya no son cortos. El 0.1 en float32 vale 0.100000001490116…, y para que la vuelta sea exacta hacen falta hasta 17 cifras.

Redondear a 4 decimales baja a ≈ 8.35 bytes por número, pero ya no mandas el mismo tensor. La Ronda lo advierte: tendrías que repetir la [[prueba-paridad|prueba de paridad]], porque cambiaste la entrada del modelo.
:::

## Bytes dentro de un texto: base64 o una URL {Bytes inside text: base64 or a URL}

En la lección de HTTP viste las tres formas de mandar la foto en el body y que base64 la hace crecer un tercio. Aquí ves de dónde sale ese tercio y cuándo conviene cada forma.

Un JPEG son bytes, y muchos no son letras. Todo JPEG empieza con los bytes `FF D8 FF` (escritos en hexadecimal, con 0–9 y A–F, como en «Cómo guarda números una computadora»: FF es 255 y D8 es 216), que no corresponden a ningún carácter que se pueda escribir entre comillas. ¿Cómo se mete una foto en un JSON?

### base64: tres bytes en cuatro letras

[[base64]] escribe cualquier serie de bytes con solo 64 letras seguras: de la A a la Z, de la a a la z, del 0 al 9, `+` y `/`. Con 64 letras, cada una lleva 6 bits (2⁶ = 64). El truco es agrupar:

:::pasos
1. Toma 3 bytes
Son 3 × 8 = 24 bits.
2. Córtalos en 4 pedazos de 6 bits
Cada pedazo es un número del 0 al 63.
3. Cambia cada número por su letra
0 es A, 25 es Z, 26 es a, 51 es z, 52 es 0, 61 es 9, 62 es + y 63 es /.
:::

:::figura apis-base64
Los tres primeros bytes de cualquier JPEG, FF D8 FF, convertidos a base64. Los 24 bits se cortan de 6 en 6 y salen 63, 61, 35 y 63: las letras /, 9, j y /. Por eso todo JPEG en base64 empieza con «/9j/».
:::

Si los bytes no son múltiplo de 3, el final se rellena con `=`. Siempre salen 4 letras por cada 3 bytes, o sea, **33 % más**:

```python
import base64

inicio_jpeg = b"\xff\xd8\xff"                      # así empieza todo archivo JPEG
letras = base64.b64encode(inicio_jpeg)
print(inicio_jpeg.hex(" "), "→", letras.decode())  # 3 bytes → 4 letras
print("¿regresa igual?", base64.b64decode(letras) == inicio_jpeg)

for k in (1, 2, 3, 4, 300, 200_000, 602_112):
    n = len(base64.b64encode(bytes(k)))
    print(f"{k:>7,} bytes → {n:>7,} letras · {n / k - 1:+.0%}")
print(base64.b64encode(b"T"), base64.b64encode(b"Te"), base64.b64encode(b"Ten"))
```

```salida
ff d8 ff → /9j/
¿regresa igual? True
      1 bytes →       4 letras · +300%
      2 bytes →       4 letras · +100%
      3 bytes →       4 letras · +33%
      4 bytes →       8 letras · +100%
    300 bytes →     400 letras · +33%
200,000 bytes → 266,668 letras · +33%
602,112 bytes → 802,816 letras · +33%
b'VA==' b'VGU=' b'VGVu'
```

:::cuenta La foto de Ana dentro de un JSON
El JPEG del celular // la app lo reduce antes de subirlo | — | ≈ 200 KB
En base64 // 4 letras por cada 3 bytes | 4 × ⌈200,000 ÷ 3⌉ | 266,668 B ≈ 267 KB
Lo que se agregó | 266,668 − 200,000 | ≈ 67 KB, un 33 %
El tensor de C01 en base64 | 4 × 602,112 ÷ 3 | 802,816 B ≈ 803 KB
Red a 500 por segundo | 803 KB × 500 × 8 | ≈ 3.2 Gb/s, contra 2.4 en binario
= base64 cuesta un tercio más de bytes, más el tiempo de convertir de ida y de vuelta. Es mucho menos que los floats como texto, pero no es gratis.
:::

### Las otras dos salidas

Para bytes grandes o frecuentes, hay dos caminos mejores que base64:

- **Mandar los bytes crudos en el cuerpo.** Si la request solo lleva una foto, no hace falta JSON: el [[body]] son los bytes y el [[header]] `Content-Type: image/jpeg` dice qué son. Es lo que hace C01. Los parámetros chicos, como `top_k`, van en la URL.
- **Mandar una referencia.** Se sube el archivo antes a un almacén de archivos en la nube (*object storage*, como S3 de AWS, la nube de Amazon) y la request lleva solo su dirección: una URL o una *key*, como `uploads/8f3a.pdf`. Para subirlo sin darle al cliente las llaves del almacén, se usa una **URL prefirmada** (*presigned URL*): una dirección que permite subir un solo archivo, a una key fija, durante un rato corto que elige el servidor (por ejemplo, 15 minutos). Es el patrón de M02 para los trabajos largos de la sección 8.

La referencia cuesta un viaje más (el servidor tiene que ir por el archivo), así que conviene cuando ese viaje extra cabe en el tiempo que tienes para responder, contando la cola lenta (el [[p99]]). La regla práctica: base64 para lo chico y ocasional (un ícono, una firma de 2 KB); bytes crudos o una URL para lo grande.

:::profundo base64 en otros lugares
Vas a ver base64 en sitios que no son JSON. Una página web puede llevar una imagen chiquita escrita dentro de su propio código, como `data:image/png;base64,iVBORw0…`: es una *data URL*, y se ahorra una request a cambio de un tercio más de bytes. Los correos electrónicos mandan sus archivos adjuntos en base64, porque el correo nació para llevar solo texto.

Hay una variante para URLs, **base64url**, que cambia `+` por `-` y `/` por `_`, porque esos dos caracteres ya significan algo dentro de una dirección. Es la que usan los tokens de identidad que verás más adelante, los [[jwt|JWT]].

Y un aviso: base64 no esconde nada. Cualquiera lo convierte de vuelta en un segundo; no es cifrado.
:::

## El esquema y las versiones {Schemas and versions}

Un contrato que solo vive en la cabeza de alguien se rompe. Por eso se escribe: el [[esquema-api|esquema]] (*schema*) de la API dice qué campos lleva cada request y cada respuesta, de qué tipo es cada uno, cuáles son obligatorios y qué valores se permiten. El de C01, en palabras:

- **Entrada:** el cuerpo es un JPEG, PNG o WebP de hasta 10 MB. `top_k` es un entero entre 1 y 20; si no viene, vale 5.
- **Salida:** `model_version` es texto; `predictions` es una lista de objetos, cada uno con `label` (texto) y `score` (un número entre 0 y 1); `latency_ms` es un número.

### Validar en la puerta

Con el esquema escrito, el servidor revisa cada request **antes** de gastar CPU o GPU en ella. Si `top_k` vale 0, la rechaza al instante con un error **422** (*Unprocessable Content*): «entendí lo que mandaste, pero no cumple el contrato». Es distinto de un **400**, que en C01 significa «la imagen ni siquiera se puede leer», de un **413** («es demasiado grande») y de un **415** («ese tipo de archivo no lo acepto»).

En Python, el esquema se escribe casi siempre con **Pydantic**, una librería en la que describes cada mensaje como una *clase* de Python (una plantilla con el nombre y el tipo de cada campo, como `label: str`, «label es texto») y que revisa que los datos la cumplan. Lo usa **FastAPI**, el *framework* (la librería que arma el servidor web) del gateway de C01. Es una ilustración, sin salida, porque necesita las dos librerías:

```python
from fastapi import FastAPI, Query, Request
from pydantic import BaseModel, Field

class Prediccion(BaseModel):
    label: str                               # el nombre de la categoría, nunca su posición
    score: float = Field(ge=0, le=1)

class Respuesta(BaseModel):
    model_version: str
    predictions: list[Prediccion]
    latency_ms: float

app = FastAPI()

@app.post("/v1/classify", response_model=Respuesta)
async def classify(request: Request, top_k: int = Query(5, ge=1, le=20)):
    ...                                      # top_k=0 ni siquiera llega aquí: FastAPI responde 422
```

`ge` y `le` quieren decir «mayor o igual» y «menor o igual» (*greater/less than or equal*): `score` va de 0 a 1 y `top_k`, de 1 a 20, con 5 si no viene. FastAPI lee esos tipos y hace tres cosas solo: valida cada request (422 con el detalle de qué campo falló), revisa que tu respuesta cumpla `Respuesta` y publica el esquema completo en el formato **OpenAPI**, un estándar para describir APIs HTTP, en `/openapi.json`, con una página para probarla en `/docs`. Con ese archivo, otros equipos pueden generar el código de su cliente sin leer el tuyo.

Por dentro, OpenAPI describe los datos con **JSON Schema**, un lenguaje estándar para escribir esquemas en JSON. Lo vas a volver a ver en M14: un LLM puede recibir un JSON Schema para que su salida salga con esa forma. La Ronda avisa que eso garantiza la forma, no el contenido: una marca inventada es JSON perfecto.

:::profundo Cómo se ve un 422 por dentro
Si alguien llama `POST /v1/classify?top_k=0`, FastAPI responde 422 sin correr tu función, con un cuerpo parecido a este:

```text
{"detail": [{"type": "greater_than_equal",
             "loc": ["query", "top_k"],
             "msg": "Input should be greater than or equal to 1",
             "input": "0",
             "ctx": {"ge": 1}}]}
```

`loc` dice dónde está el problema (en la query, en el campo `top_k`) `msg`, qué regla no se cumplió, y `ctx`, el límite de la regla. Es el formato de FastAPI con Pydantic 2; otras versiones cambian algún campo. El cliente sabe qué arreglar sin preguntarte.

Un detalle que la Ronda encontró en C01: como FastAPI responde el 422 **antes** de llamar a tu función, tu código de registro tampoco corre. Sin un manejador de errores propio, una ola de 422 después de que otro equipo publicó una versión con un bug no dejaría ni una línea en tus logs ni en tus métricas. C01 agrega ese manejador para contarlos como cualquier otro error.
:::

### Versionar sin romper a nadie

En cuanto otro equipo usa tu API, el contrato es una promesa. Cambiarlo sin avisar rompe programas que no son tuyos. El [[versionado-api|versionado]] separa los cambios en dos clases (M11):

| No rompe a nadie | Rompe a alguien |
|---|---|
| Agregar un campo opcional a la respuesta | Renombrar o quitar un campo |
| Agregar un endpoint nuevo | Cambiar el tipo de un campo |
| Aceptar un parámetro nuevo opcional | Cambiar el valor por omisión de `top_k` |
| | Cambiar lo que significa `score` sin avisar, por ejemplo al calibrarlo (ajustarlo para que 0.8 quiera decir «acierta 8 de cada 10 veces») |

El `/v1/` de la ruta es para eso. Un cambio que rompe se publica como `/v2/classify`, que convive con `/v1` mientras los clientes se cambian; al final se apaga el viejo. La Ronda llama a la receta *expand and contract*: primero todos aprenden a aceptar lo nuevo, después se empieza a producir lo nuevo y al final se deja de soportar lo viejo.

C01 tiene una regla que conviene memorizar: **se versiona el contrato, no el modelo.** El modelo cambia cada mes y no estrena `/v2` por eso. A cambio, cada respuesta lleva su `model_version`. Sin ella, dice la Ronda, no puedes depurar ni unir la predicción con sus etiquetas.

## gRPC, protobuf y los protocolos de inferencia {gRPC, protobuf and inference protocols}

Del gateway hacia Triton, el servidor del modelo, cambia todo. Ahí no hay personas leyendo ni otros equipos integrándose: hay un solo cliente, el gateway, que manda el tensor de 602 KB hasta 500 veces por segundo. Lo que importa es que pese poco, que se lea rápido y que nadie se equivoque de tipos.

### gRPC y protobuf: el contrato compilado

[[grpc|gRPC]] es una forma de llamar funciones de otro programa por la red como si estuvieran en el tuyo (*remote procedure call*, RPC). Google lo publicó como código abierto en 2015. Su contrato se escribe en un archivo `.proto`, con el lenguaje de [[protobuf]] (*Protocol Buffers*):

```proto
syntax = "proto3";

message ClassifyRequest {
  bytes image = 1;              // los bytes del JPEG, sin base64
  int32 top_k = 2;
}
message Prediccion {
  string label = 1;
  float score = 2;
}
message ClassifyResponse {
  string model_version = 1;
  repeated Prediccion predictions = 2;   // repeated: una lista
  float latency_ms = 3;
}
service Clasificador {
  rpc Classify (ClassifyRequest) returns (ClassifyResponse);
}
```

Un compilador, `protoc`, lee ese archivo y genera el código del cliente y del servidor en Python, Go, Java o el lenguaje que quieras. El cliente llama `stub.Classify(request)` como una función cualquiera (el *stub* es el objeto que generó `protoc` y que hace la llamada por la red); nunca escribe ni lee JSON. Si mandas un texto donde va un número, el código generado se queja antes de mandar nada.

Lo que viaja es **binario**: cada float ocupa sus 4 bytes, y en vez del nombre de cada campo va su número. Una predicción con `"Tenis"` y 0.83 ocupa 12 bytes en protobuf y 33 en JSON; el tensor de C01, 602,116 bytes contra ≈ 3.07 MB. Los detalles están en la sección extra «Protobuf por dentro».

gRPC viaja sobre [[http2|HTTP/2]]: abre una sola conexión larga y la usa para muchas llamadas a la vez (hasta el tope que ponga el servidor; las que pasan de ahí esperan su turno), y permite *streams* en los dos sentidos (mandar la respuesta, o la petición, por pedazos: lo verás en la sección 7). Lo que cuesta:

- **No se lee a simple vista.** `curl` no sirve; se usa `grpcurl` o un cliente generado.
- **Los navegadores no lo hablan directo.** Hace falta gRPC-Web o un proxy.
- **El balanceo.** Como todo viaja por una sola conexión larga, un balanceador que reparte conexiones (y no requests) deja a cada gateway pegado a un solo Triton. Lo verás en la lección de [[balanceador|balanceadores]].

### Un contrato común para servidores de modelos

Cada servidor de modelos podría inventar su propia API. Para no atarte a uno, existe un [[protocolo-inferencia|protocolo estándar de inferencia]]: el **KServe v2** (KServe es un proyecto para servir modelos en Kubernetes), también llamado *Open Inference Protocol*. Define los mismos endpoints para Triton, los servidores de KServe, MLServer de Seldon y OpenVINO Model Server, entre otros. Si tu gateway habla v2, cambiar de servidor no cambia el cliente.

| Endpoint | Para qué |
|---|---|
| `GET /v2/health/ready` | ¿El servidor puede atender? |
| `GET /v2/models/classifier` | Nombres, tipos y shapes de las entradas y salidas del modelo |
| `POST /v2/models/classifier/infer` | Inferencia |

El cuerpo de `infer`, en su forma JSON, describe cada tensor con nombre, [[shape]], [[dtype]] y datos: `{"inputs": [{"name": "input", "shape": [1, 3, 224, 224], "datatype": "FP32", "data": [1.2557, …]}]}`. Los mismos endpoints existen por HTTP y por gRPC: Triton, por omisión, escucha HTTP en el [[puerto]] 8000 y gRPC en el 8001.

¿Y los 150,528 números como texto? Triton agrega una **extensión binaria** que no es parte del protocolo base: un JSON corto con el nombre, el shape y el tipo, y detrás los 602,112 bytes crudos. Un header, `Inference-Header-Content-Length`, dice dónde termina el JSON y empiezan los bytes.

:::profundo Preguntarle a Triton por su contrato
`GET /v2/models/classifier` contesta con el esquema del modelo, en JSON:

```text
{"name": "classifier", "versions": ["1"], "platform": "tensorrt_plan",
 "inputs":  [{"name": "input",  "datatype": "FP32", "shape": [-1, 3, 224, 224]}],
 "outputs": [{"name": "logits", "datatype": "FP32", "shape": [-1, 500]}]}
```

El `-1` es el eje del [[batch]]: Triton acepta de 1 a 32 fotos juntas, así que el primer número queda libre. Esto sale de la configuración del modelo en Triton, y el gateway de C01 tiene que usar los mismos nombres, tipos y shapes. Una prueba que compare esta respuesta con lo que el gateway espera atrapa, antes de publicar, un modelo exportado con otro nombre de entrada o con otro dtype.
:::

### Lo que eligió C01

C01 manda el tensor a Triton **por HTTP, con la extensión binaria**, usando el cliente asíncrono de Triton (`tritonclient.http.aio`). El tensor viaja en bruto, igual de chico que con gRPC; la parte JSON se puede revisar con `curl`, y el balanceo es más sencillo. gRPC queda como alternativa si una medición muestra que su menor costo por request importa. La Ronda marca como respuesta débil «gRPC siempre es más rápido que REST»: con la extensión binaria, la diferencia suele ser chica frente a los 150 ms que el gateway le da a Triton.

:::diagrama apis-c01
Toca cada caja para ver qué formato habla. «Recorrer» sigue una foto de ida y vuelta, y el otro recorrido muestra qué pasaría si el tensor viajara como JSON.
:::

Ya tienes la respuesta a la pregunta de la lección. **Hacia afuera, JSON**: muchos clientes distintos, de otros equipos, que necesitan leer y depurar, y una respuesta de unos cientos de bytes. **Hacia adentro, binario**: un solo cliente, un tensor de 602 KB, 500 veces por segundo.

## Protobuf por dentro: los bytes de un mensaje {Inside protobuf: the bytes of a message} [extra]

¿Cómo sabe el otro lado dónde empieza y termina cada campo, si no viajan los nombres? Cada campo viaja como una **etiqueta** seguida de su valor. La etiqueta junta dos cosas en un solo número: el número del campo (el `= 1` o `= 2` del `.proto`) y el **tipo de cable** (*wire type*), que dice cómo leer lo que sigue:

| Tipo de cable | Qué sigue | Para |
|---|---|---|
| 0 | Un varint | Enteros y booleanos |
| 1 | 8 bytes fijos | `double`, `fixed64` |
| 2 | Una longitud y esos bytes | Textos, bytes, mensajes adentro, listas de números |
| 5 | 4 bytes fijos | `float`, `fixed32` |

La etiqueta es **número de campo × 8 + tipo de cable** (en bits: el número corrido 3 lugares a la izquierda, con el tipo en los 3 de abajo).

### Varint: enteros que ocupan lo que necesitan

Un **varint** escribe un entero con los bytes que haga falta: cada byte lleva 7 bits del número, y su bit de arriba dice «viene otro byte». Un 5 cabe en un byte; un 300, en dos:

:::cuenta El 300 como varint
En binario // 9 bits | 300 = 256 + 32 + 8 + 4 | 1 0010 1100
Los 7 bits de abajo // van primero | 010 1100 | 44
Primer byte // con el bit de «sigue otro» prendido | 44 + 128 | 172 = 0xAC
Lo que sobra // lo que queda arriba de esos 7 bits | 300 ÷ 128 = 2.3 → 2 | 2
Segundo byte // ya no sigue nada | 2 | 0x02
= 300 viaja como AC 02: dos bytes, en vez de los 4 fijos de un int32.
:::

El programa de abajo hace lo mismo con operaciones sobre bits: `v & 0x7F` se queda con los 7 bits de abajo, `v >> 7` recorre el número 7 lugares a la derecha (lo que sobra para el siguiente byte) y `| 0x80` prende el bit de arriba. En `etiqueta`, `numero << 3 | tipo` es justo número × 8 + tipo.

```python
import struct

def varint(v):                     # 7 bits por byte; el bit de arriba dice «sigue otro»
    salida = bytearray()
    while True:
        siete, v = v & 0x7F, v >> 7
        salida.append(siete | 0x80 if v else siete)
        if not v:
            return bytes(salida)

def etiqueta(numero, tipo):        # número de campo y tipo de cable, en un solo varint
    return varint(numero << 3 | tipo)

print("5 en varint:", varint(5).hex(" "), "· 300 en varint:", varint(300).hex(" "))
label = "Tenis".encode()
msg = etiqueta(1, 2) + varint(len(label)) + label + etiqueta(2, 5) + struct.pack("<f", 0.83)
print("Prediccion en protobuf:", msg.hex(" "), "·", len(msg), "bytes")
print("lo mismo en JSON:", len('{"label": "Tenis", "score": 0.83}'), "bytes")

tensor = 150_528 * 4                # los floats del tensor, empacados uno tras otro
print(f"tensor de C01: {len(etiqueta(1, 2) + varint(tensor)) + tensor:,} bytes")
```

```salida
5 en varint: 05 · 300 en varint: ac 02
Prediccion en protobuf: 0a 05 54 65 6e 69 73 15 e1 7a 54 3f · 12 bytes
lo mismo en JSON: 33 bytes
tensor de C01: 602,116 bytes
```

:::cuenta Los 12 bytes de una predicción
Etiqueta de label // campo 1, tipo 2 (con longitud) | 1 × 8 + 2 = 10 | 0A
Longitud | «Tenis» tiene 5 letras | 05
El texto | T e n i s | 54 65 6E 69 73
Etiqueta de score // campo 2, tipo 5 (4 bytes) | 2 × 8 + 5 = 21 | 15
El float32 | 0.83 en 4 bytes | E1 7A 54 3F
= 1 + 1 + 5 + 1 + 4 = 12 bytes. En JSON, 33: los nombres «label» y «score» viajan en cada mensaje, y 0.83 se escribe con letras.
:::

La lista de 150,528 floats va **empacada** (*packed*): una sola etiqueta, la longitud (602,112, que como varint ocupa 3 bytes) y los floats seguidos. Son 602,112 + 4 = 602,116 bytes.

:::figura apis-protobuf
La misma predicción en JSON (33 bytes) y en protobuf (12). En JSON viajan los nombres de los campos y el número escrito con letras; en protobuf, una etiqueta de un byte por campo y el float en sus 4 bytes.
:::

¿Cuánto se gana de verdad? Depende de qué lleve el mensaje. Con números, mucho: el tensor baja 5 veces. Con texto, poco, porque el texto viaja igual en los dos formatos. Una respuesta completa de C01, con cinco categorías de ejemplo (Tenis, Botas, Sandalias, Pantuflas y Zapatos de vestir), el `model_version` y la latencia, pesa 277 bytes en JSON y 121 en protobuf: 2.3 veces menos, y más de la mitad de esos 121 son texto, los nombres de las categorías y el `model_version`. A 500 respuestas por segundo, la diferencia es de (277 − 121) × 500 × 8 ≈ 0.6 megabits por segundo: no vale la pena cambiar de formato por ella.

Este diseño explica las reglas de cambiar un `.proto`:

- **Renombrar un campo no rompe nada en lo que viaja**, porque el nombre no viaja. Cambiar su número sí rompe todo. (Ojo: protobuf también se puede escribir como JSON, y ahí sí viajan los nombres; si algún cliente lo usa así, renombrar lo rompe.)
- **Nunca reuses el número de un campo borrado.** Un cliente viejo lo leería con el significado anterior. Se marca como `reserved`.
- **Agregar campos es compatible.** Quien no conoce un número de campo se salta su valor, porque el tipo de cable le dice cuántos bytes brincar.
- **Un campo que no viene vale su valor por omisión**: 0, texto vacío, `false`. Para distinguir «vale 0» de «no vino», el campo se declara `optional`.

## Streaming: la respuesta por pedazos {Streaming: the answer in pieces}

Hasta aquí, cada request esperaba una respuesta completa. Para C01 está bien: en ≈ 50 ms llegan las cinco categorías. Para un [[llm|LLM]] no. En la lección de LLMs viste la request típica de C10: tarda 0.6 s en dar el primer [[token]] ([[ttft|TTFT]]) y después 40 ms por token ([[tpot|TPOT]]).

:::cuenta Lo que espera la persona, con y sin streaming
Primer token // TTFT, de la lección de LLMs | — | 0.6 s
Los otros 249 tokens // a 40 ms cada uno | 249 × 0.04 s | 9.96 s
Respuesta completa | 0.6 + 9.96 | ≈ 10.6 s
Sin streaming // la pantalla en blanco hasta el final | — | 10.6 s para ver la primera letra
Con streaming // cada token sale en cuanto existe | — | 0.6 s, y luego 25 tokens por segundo
= La respuesta tarda lo mismo. Lo que cambia es cuándo empieza a leer la persona: a los 0.6 s en vez de a los 10.6.
:::

Mandar la respuesta en pedazos, conforme se produce, se llama [[streaming]].

:::figura apis-stream
La misma respuesta de C10, dos veces. Arriba, sin streaming: nada en la pantalla durante 10.6 s. Abajo, con streaming: el primer token a los 0.6 s y después 25 por segundo.
:::

### SSE: una respuesta que no se acaba

La forma más común de mandar tokens es [[sse|SSE]] (*Server-Sent Events*, eventos que manda el servidor). Es HTTP normal: el cliente hace una request y el servidor contesta con `Content-Type: text/event-stream`, pero en vez de mandar todo y cerrar, va escribiendo **eventos** conforme los tiene. Cada evento lleva una o más líneas que empiezan con `data:` (puede llevar otras, como `id:`), y una línea en blanco lo cierra.

La API de OpenAI usa SSE en su endpoint de chat (*Chat Completions*), y casi todos los servidores de LLMs (los *motores* que corren el modelo) la copian: vLLM (el que usa C10), SGLang, TensorRT-LLM y el frontend de OpenAI de Triton exponen una **API compatible con OpenAI**. Es el otro protocolo estándar de inferencia de esta lección. Con `"stream": true` en el JSON de la request a `POST /v1/chat/completions`, la respuesta se ve así:

```text
Content-Type: text/event-stream

data: {"choices": [{"delta": {"content": "Te"}}], ...}

data: {"choices": [{"delta": {"content": "nis"}}], ...}

data: [DONE]
```

Cada `delta` trae el pedazo nuevo, y `[DONE]` cierra el stream. Como el contrato es el mismo, puedes cambiar de motor sin tocar a los clientes, y las librerías oficiales de OpenAI funcionan apuntándolas a tu URL. La Ronda pone una advertencia: compatible no es idéntico, porque cada motor acepta o ignora parámetros distintos. Prueba tu cliente contra el motor que vas a usar.

Leer SSE tiene una trampa. La red entrega los bytes en pedazos que no respetan los eventos: un pedazo puede traer evento y medio. El cliente junta lo que llega y solo procesa cuando ve la línea en blanco:

```python
import json

def eventos_sse(pedazos):
    """Junta lo que llega de la red y entrega cada evento completo."""
    pendiente = ""
    for pedazo in pedazos:
        pendiente += pedazo
        while "\n\n" in pendiente:                 # una línea en blanco cierra el evento
            evento, pendiente = pendiente.split("\n\n", 1)
            datos = [l.removeprefix("data:").removeprefix(" ")
                     for l in evento.split("\n") if l.startswith("data:")]
            yield "\n".join(datos)

# Los cortes caen donde le toca a la red, no donde termina un evento
llegada = ['data: {"choices": [{"delta": {"content": "Te"}}]}\n\nda',
           'ta: {"choices": [{"delta": {"content": "nis"}}]}\n',
           '\ndata: {"choices": [{"delta": {"content": " rojos"}}]}\n\ndata: [DONE]\n\n']
pantalla = ""
for datos in eventos_sse(llegada):
    if datos == "[DONE]":
        print("[DONE]: se acabó el stream")
        break
    nuevo = json.loads(datos)["choices"][0]["delta"]["content"]
    pantalla += nuevo
    print(f"llegó {nuevo!r:<9} → la pantalla dice {pantalla!r}")
```

```salida
llegó 'Te'      → la pantalla dice 'Te'
llegó 'nis'     → la pantalla dice 'Tenis'
llegó ' rojos'  → la pantalla dice 'Tenis rojos'
[DONE]: se acabó el stream
```

`yield` entrega un evento a quien recorre la función con el `for` y, cuando le piden el siguiente, la función sigue justo donde se quedó. El primer pedazo trae un evento completo y el principio de otro, `da`. El lector guarda ese principio y lo completa con el siguiente pedazo. Si procesara cada pedazo por separado, intentaría leer `da` como JSON y tronaría.

### WebSocket: hablar en los dos sentidos

SSE va en un solo sentido: del servidor al cliente. En una transcripción de voz en vivo, el cliente **también** manda datos sin parar: fragmentos de audio mientras la persona habla, y el servidor regresa texto parcial mientras escucha. Para eso está [[websocket|WebSocket]]. Empieza como una request HTTP que pide cambiar de protocolo (el header `Upgrade: websocket`); el servidor acepta con el código **101** (*Switching Protocols*, «cambio de protocolo») y, desde ahí, la conexión es un canal de mensajes en los dos sentidos, abierto todo el tiempo que haga falta.

| | SSE | WebSocket | Stream de gRPC |
|---|---|---|---|
| Sentido | Servidor → cliente | Los dos | Cualquiera, incluso los dos |
| Viaja sobre | HTTP normal | Una conexión HTTP que cambió de protocolo | HTTP/2 |
| Para | Tokens de un LLM | Voz y tiempo real | Servicio a servicio |

:::profundo Streaming a fondo: proxies, cortes y cancelaciones
**Nada en el camino puede guardar la respuesta.** Muchos [[proxy-inverso|proxies inversos]] guardan por omisión la respuesta antes de pasarla (*buffering*): NGINX, por ejemplo, la junta en bloques de algunos KB, y otros esperan a tenerla completa. Con un stream, eso convierte un TTFT de 0.6 s en uno de varios segundos, o de 10 s si el proxy espera el final, y nadie ve un error: solo una espera. En NGINX se apaga con `proxy_buffering off` o con el header `X-Accel-Buffering: no` en la respuesta. La Ronda (M14) pide revisar cada salto entre vLLM y la app.

**Las conexiones calladas se cortan.** Los balanceadores cierran una conexión que pasa cierto tiempo sin mandar nada (*idle timeout*): 60 s por omisión en el balanceador de aplicaciones de AWS (ALB), según su documentación de 2026, y se puede subir hasta 4,000 s. Una respuesta que tarda 90 s en mandar su primer pedazo pierde la conexión. El arreglo es mandar algo cada tantos segundos: en SSE, una línea que empieza con `:` es un comentario que el cliente ignora, y sirve de latido.

**Reconectar sin perder el hilo.** Un evento SSE puede traer un `id:`. Si se corta la conexión, el cliente se reconecta mandando el último que recibió en el header `Last-Event-ID`, y el servidor puede seguir desde ahí. En el navegador, `EventSource` se reconecta solo.

**Cancelar libera la GPU.** Si la persona cierra el chat, el gateway cierra la conexión con vLLM y vLLM aborta la generación, liberando su [[kv-cache|KV cache]]. Sin eso, la GPU seguiría escribiendo una respuesta que nadie va a leer.

**Contar los tokens.** Con `"stream_options": {"include_usage": true}`, el último evento trae cuántos tokens se usaron. Es lo que el gateway necesita para cobrarle a cada equipo.
:::

## Trabajos largos: polling o webhook {Long jobs: polling or webhook}

Leer un PDF de 200 páginas con [[ocr|OCR]] tarda minutos. Ninguna request espera tanto: quien llama, los proxies y los balanceadores tienen [[timeout|timeouts]] (tiempos máximos de espera) de segundos. La salida es separar **aceptar** el trabajo de **hacerlo** (M02):

:::pasos
1. Aceptar, en milisegundos
El cliente sube el PDF al almacén con una URL prefirmada y hace `POST /v1/jobs` con la referencia. La API valida, anota el trabajo como `queued` («en fila»), lo mete en una **cola** (una fila de mensajes donde los trabajos esperan su turno; la verás en la lección de [[cola-mensajes|colas]]) y responde **202 Accepted** («lo recibí, todavía no está») con un `job_id` y la dirección donde consultar su estado.
2. Hacer, en segundo plano
Un [[worker]] toma el trabajo de la cola, corre el modelo y guarda el resultado en el almacén.
3. Avisar
El cliente se entera de que terminó, de una de dos maneras.
:::

### Polling: preguntar cada tanto

Con [[polling]], el cliente pregunta: `GET /v1/jobs/8f3a` cada cierto tiempo, hasta que el estado diga `succeeded` o `failed`. Es simple y sirve para cualquier cliente, incluso un script en una laptop sin dirección pública (una laptop en casa tiene una [[ip-privada|IP privada]]: nadie de afuera le puede escribir). El servidor puede sugerir cada cuánto preguntar con el header [[retry-after|Retry-After]].

El cliente se entera tarde: el trabajo termina en algún momento entre dos preguntas, en promedio a la mitad, así que preguntando cada 2 s se entera ≈ 1 s después.

Y el problema mayor es la cuenta. Con la [[ley-little|ley de Little]] de la lección de async (cuántos hay a la vez = cuántos llegan por segundo × cuánto dura cada uno) sale cuántos trabajos están vivos, y cada uno pregunta:

:::cuenta Lo que cuesta el polling (M02)
Trabajos que llegan | dato | 50 por segundo
Vida promedio de un trabajo // cola + proceso; un supuesto | — | ≈ 200 s
Trabajos vivos a la vez // Little: llegada × duración | 50 × 200 | 10,000
Polling cada 2 s | 10,000 ÷ 2 | 5,000 GET/s
Polling cada 10 s | 10,000 ÷ 10 | 1,000 GET/s
Consultas que encuentran el trabajo terminado // cada trabajo termina una sola vez | 50 ÷ 5,000 | 1 %
= Con polling cada 2 s, la API de estado recibe 100 veces más requests que la de crear trabajos, y 99 de cada 100 consultas contestan «todavía no».
:::

### Webhook: que te avisen

Con un [[webhook]], el cliente registra una URL suya y tu servicio le hace un `POST` cuando el trabajo termina: 50 avisos por segundo, uno por trabajo. Es lo justo, pero trae sus cuidados:

- **El cliente necesita una dirección pública** que tu servicio pueda alcanzar.
- **Su endpoint puede estar caído.** Hay que reintentar, esperando cada vez más: el [[backoff-exponencial|backoff]] de la lección de fallas de red.
- **Puede llegar dos veces.** Si el aviso llegó pero la confirmación se perdió, se vuelve a mandar: la entrega es «al menos una vez» ([[at-least-once]]). El receptor descarta los repetidos por `job_id`.
- **Hay que firmarlo.** Cualquiera podría mandarle un `POST` falso al cliente. Se firma con **HMAC**: una huella del mensaje calculada con un secreto que solo comparten las dos partes. El receptor recalcula la huella; si no coincide, lo tira.

Lo común es combinar: webhook para quien lo puede recibir y polling como respaldo, con un intervalo sugerido. Si una persona espera en la app, el aviso puede llegar por SSE, WebSocket o una notificación al celular.

:::profundo El estado de un trabajo, de cerca
Un trabajo pasa por pocos estados: `queued` (en fila), `running` (corriendo), y al final `succeeded` o `failed`. La API de estado solo lee una tabla indexada por `job_id`, así que cada consulta cuesta poco aunque lleguen miles.

Tres detalles que la Ronda (M02) no deja pasar:

- **El reintento del cliente.** Si el `POST /v1/jobs` se cortó, el cliente no sabe si el trabajo se creó, y lo vuelve a mandar. Para no crear dos, manda un header `Idempotency-Key` con un valor suyo; si la API ya vio esa llave, devuelve el mismo `job_id`. Lo verás a fondo en la lección de fallas de red, con la [[llave-idempotencia|llave de idempotencia]].
- **El trabajo huérfano.** Si la API anota `queued` y después falla al encolar, queda un trabajo que nadie va a hacer. Se arregla encolando antes de responder el 202, o con un barrido que reencola los `queued` viejos.
- **No guardar para siempre.** El estado vive unos días (por ejemplo, 7) y el resultado se lee con una URL prefirmada que caduca.
:::

:::diagrama apis-jobs
Toca cada caja para ver qué guarda o qué hace. Hay dos recorridos: uno con webhook y otro con polling.
:::

:::calculadora apis-polling
Sube el intervalo y mira el precio: menos consultas, pero el cliente se entera más tarde. Luego alarga la duración: con la misma llegada, más trabajos vivos y más consultas.
:::

## Errores comunes {Common mistakes}

### 1. Mandar tensores en JSON

Funciona en la laptop y revienta en producción: el tensor de C01 pesa 5 veces más y serializarlo quema decenas de núcleos.

**Cómo evitarlo:** JSON para lo que leen las personas y para depurar; binario (la extensión binaria de Triton o gRPC) para tensores. Y si puedes, mándalos en uint8: cuatro veces menos que en float32.

### 2. Dejar que se cuele un NaN

El modelo devuelve un NaN, Python lo escribe como `NaN` y el cliente, en otro lenguaje, no puede leer la respuesta. El error aparece lejos de donde nació.

**Cómo evitarlo:** `allow_nan=False` al serializar, un esquema de respuesta que valide los números y una regla explícita: si sale NaN, el gateway responde un error (C01 responde 500), no un JSON roto.

### 3. Meter fotos grandes en base64

Cada foto cuesta un tercio más de bytes, más el tiempo de convertir de ida y de vuelta, y el lector de JSON tiene que recorrer un texto de megabytes.

**Cómo evitarlo:** bytes crudos en el cuerpo si la request es solo la foto; una URL o una key de object storage si es grande o va a una cola.

### 4. Cambiar el contrato sin cambiar la versión

Renombrar `score` a `confidence`, cambiar el valor por omisión de `top_k` o calibrar el score sin avisar. Tu prueba pasa; el programa de otro equipo deja de funcionar.

**Cómo evitarlo:** revisar cada cambio contra la tabla de lo que rompe; si rompe, `/v2` conviviendo con `/v1`. Y devolver nombres de categoría, nunca su posición en el vector.

### 5. Creer que gRPC siempre es más rápido

Cambiar a gRPC «por velocidad» sin medir, y descubrir que el Triton nuevo no recibe tráfico porque el balanceo reparte conexiones, no requests.

**Cómo evitarlo:** medir con tu tensor y tu tráfico; si ya mandas binario por HTTP, la diferencia suele ser chica. Si eliges gRPC, resuelve el balanceo por request.

### 6. Un proxy que guarda el stream, o un polling sin freno

El stream de tokens llega todo junto al final porque un proxy lo juntó. O mil clientes preguntan cada segundo por trabajos que tardan minutos.

**Cómo evitarlo:** probar el streaming de punta a punta, midiendo el TTFT del lado del cliente. Para el polling, `Retry-After`, un intervalo que crece y webhook para quien pueda recibirlo.

## En la vida real {In real life} [extra]

### C01: tres contratos

C01 tiene más de un contrato, y la Ronda (M11) los cuenta por separado:

- **La API:** `POST /v1/classify?top_k=5` con la foto en el cuerpo, y de regreso `model_version`, `predictions[{label, score}]` y `latency_ms`. Una respuesta así pesa unos cientos de bytes; la Ronda la redondea a ≈ 1 KB.
- **La entrada del modelo:** un tensor FP32 de shape [3, 224, 224], más la versión del preprocesamiento que lo produjo.
- **La salida del modelo:** 500 logits FP32, más el archivo `labels.json` con su huella. Si C01 pasa de 500 a 501 categorías, la salida del modelo cambia, y la API no tiene por qué romperse: devuelve nombres, no posiciones.

Hacia afuera, JSON y `/v1`. Hacia Triton, KServe v2 por HTTP con la extensión binaria. Y cada request deja en el log una línea JSON con su `request_id` y su `model_version`: JSON otra vez, porque ese texto lo van a leer personas y herramientas.

La Ronda deja anotada una mejora: mandar el tensor en uint8 y normalizar dentro del modelo. El tráfico hacia Triton bajaría de ≈ 2.4 a ≈ 0.6 Gb/s en el pico de diseño. El contrato con Triton cambiaría (otro dtype), y por eso iría con su propia prueba de paridad.

### C10: un LLM detrás de un contrato prestado

C10 sirve un LLM propio a varios equipos de una empresa. Delante de todo pone un gateway con una **API compatible con OpenAI**: los equipos usan las librerías que ya conocen, y el modelo de atrás puede cambiar sin que ellos toquen nada. El streaming va por SSE, evento por evento, sin buffering en ningún salto. El último evento trae el conteo de tokens, y con él el gateway mide lo que gasta cada equipo. Si alguien cierra la conversación, el gateway corta la conexión y vLLM libera la memoria de esa secuencia.

C10 también pide salidas estructuradas: atributos de un producto en JSON, validados contra un esquema. El motor restringe la generación al JSON Schema, y el JSON sale válido por construcción.

### C05: documentos que tardan minutos

En el caso de OCR, extraer los datos de un documento tarda minutos, así que solo el chequeo de calidad de la foto es síncrono: si la foto no sirve, el cliente recibe al instante un 422 con el motivo; si sirve, el documento recibe un 202 y sigue en segundo plano (M02). Y M02 agrega un detalle para cualquier trabajo así: el resultado se guarda en una dirección que se arma igual siempre, como `results/{job_id}.json`. Si el trabajo se corre dos veces, escribe en el mismo lugar y no deja dos resultados distintos.

### C13: la voz no cabe en una request

En la transcripción de reuniones en vivo, el audio de cada persona llega al servicio de transcripción en fragmentos, por gRPC, y el texto parcial vuelve a cada participante por la conexión WebSocket que la app ya tenía abierta para la reunión: no se abre otra por cliente. Las conexiones duran lo que dura la reunión, y eso complica cada [[deploy]]: un servidor que se apaga corta llamadas en curso.

### C12: herramientas con contrato

Un agente es un LLM que, en vez de solo contestar, decide llamar herramientas: buscar un pedido, consultar un precio. Cada herramienta se le describe con un esquema: su nombre, para qué sirve y sus parámetros en JSON Schema. El modelo escribe la llamada como JSON, y la Ronda (M14) pide que el servidor la valide contra el esquema **antes** de ejecutarla, con parámetros tipados y listas cerradas de valores donde se pueda. Es la misma idea del 422, aplicada a un cliente que a veces se equivoca: el LLM. Y las herramientas que cambian algo, como cobrar o reembolsar, reciben una llave de idempotencia, para que un reintento no cobre dos veces.

### Las apps viejas no se van

Un servidor se actualiza en minutos; una app de celular, no. Mucha gente tarda semanas o meses en actualizar, y algunas versiones viejas siguen vivas durante años. Si el marketplace de C01 cambiara el contrato de su API para la app sin versión, las apps viejas se romperían en los celulares de personas que ni saben qué es una API. Por eso una API pública vive con varias versiones a la vez y anuncia con meses de anticipación cuándo apaga una.

### Fuera de ML: pagos, repositorios y un número que no cabía

Las plataformas de pagos avisan por webhook cuando un cobro se confirma, y piden verificar la firma antes de creerle. GitHub hace lo mismo con los avisos de cada `push`: los firma con HMAC-SHA256 en el header `X-Hub-Signature-256`. Y en 2010 Twitter empezó a generar ids de 64 bits; como en JavaScript los enteros arriba de 2⁵³ pierden exactitud, su API agregó un campo `id_str` con el mismo número escrito como texto.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de tamaños y de polling se comprueban con las calculadoras.

:::ejercicios
? [facil] Diseña los endpoints REST de una API de trabajos de OCR para estas tres acciones: crear un trabajo, consultar cómo va el trabajo 51c2 y cancelarlo. ¿Qué código de estado responde cada una si sale bien?
- Crear: **`POST /v1/jobs`**, con la referencia del documento en el cuerpo. Responde **202 Accepted** con el `job_id`, porque el trabajo todavía no está hecho.
- Consultar: **`GET /v1/jobs/51c2`**. Responde **200** con el estado (`queued`, `running`, `succeeded` o `failed`).
- Cancelar: **`DELETE /v1/jobs/51c2`**. Responde 200 o 204 (sin cuerpo).
- La ruta es la misma en las dos últimas; el método decide qué endpoint es.
? [facil] Este texto pretende ser JSON: `{'label': 'Tenis', "score": NaN, "creado": 2026-11-05}`. Encuentra los tres errores y corrígelos.
- Las comillas simples: JSON solo acepta comillas dobles. **`"label": "Tenis"`**.
- `NaN` no existe en JSON. Si el score no se pudo calcular, **`null`**, o mejor, responder un error.
- La fecha no es un tipo de JSON: va como texto, **`"2026-11-05"`**.
? [facil] Una app manda 3 fotos de 200 KB cada una, en base64, dentro de un JSON. ¿Cuánto pesa la request, sin contar el resto del JSON? ¿Cuánto pesaría con los bytes crudos?
- Cada foto: 4 × ⌈200,000 ÷ 3⌉ = 4 × 66,667 = **266,668 B**.
- Las tres: 3 × 266,668 = **800,004 B ≈ 800 KB**.
- Crudas: 3 × 200,000 = **600 KB**. base64 agrega ≈ 200 KB, el 33 %.
? [facil] ¿Cuáles de estos cambios a la respuesta de `/v1/classify` rompen a un cliente? (a) Agregar un campo `request_id`. (b) Renombrar `score` a `confidence`. (c) Cambiar el valor por omisión de `top_k` de 5 a 3. (d) Calibrar los scores sin avisar.
- (a) **No rompe**: un campo opcional nuevo; quien no lo conoce, lo ignora.
- (b) **Rompe**: el cliente busca `score` y no lo encuentra.
- (c) **Rompe**: quien no mandaba `top_k` y mostraba 5 sugerencias ahora recibe 3.
- (d) **Rompe**, aunque el JSON se vea igual: cambió lo que significa el número, y cualquier umbral del cliente (como «muéstralo si pasa de 0.3») cambia de efecto.
? [medio] Un servicio de búsqueda manda [[embedding|embeddings]] de 768 floats, 1,000 veces por segundo. ¿Cuánto pesa cada uno en binario y en JSON (≈ 20.4 B por número)? ¿Cuánta red ocupa cada forma?
- Binario: 768 × 4 = **3,072 B**.
- JSON: 768 × 20.4 ≈ **15.7 KB**, unas 5 veces más.
- Red, binario: 3,072 × 1,000 × 8 ≈ **24.6 Mb/s**.
- Red, JSON: 15,667 × 1,000 × 8 ≈ **125 Mb/s**. No es grave para una red de 10 Gb/s, pero el costo de CPU de serializar se repite en cada request.
? [medio] Del extra «Protobuf por dentro»: escribe 150 y 1,000 como varint.
- 150 = 128 + 16 + 4 + 2. Los 7 bits de abajo: 150 − 128 = 22 = 0x16; con el bit de «sigue» prendido, 22 + 128 = 150 = **0x96**. Lo que sobra: 150 ÷ 128 = 1 → **0x01**. Resultado: **96 01**.
- 1,000: 1,000 ÷ 128 = 7, y sobran 1,000 − 7 × 128 = 104 = 0x68. Primer byte: 104 + 128 = 232 = **0xE8**. Segundo: **0x07**. Resultado: **E8 07**.
- Los dos ocupan 2 bytes; un int32 fijo ocuparía 4.
? [medio] Llegan 1,200 trabajos por minuto, cada uno dura en promedio 90 s y los clientes preguntan cada 3 s. ¿Cuántas consultas por segundo recibe la API de estado? ¿Y si el servidor responde `Retry-After: 15`?
- Llegan 1,200 ÷ 60 = **20 por segundo**.
- Vivos a la vez, por Little: 20 × 90 = **1,800**.
- Cada 3 s: 1,800 ÷ 3 = **600 GET/s**, 30 veces la tasa de creación.
- Cada 15 s: 1,800 ÷ 15 = **120 GET/s**. A cambio, el cliente se entera en promedio 7.5 s después de que terminó, en vez de 1.5 s.
? [medio] Un LLM tiene un TTFT de 0.8 s y un TPOT de 50 ms. La respuesta tiene 400 tokens. ¿Cuánto tarda completa? ¿Cuándo ve la persona la primera palabra con streaming, y cuándo si un proxy junta la respuesta?
- Completa: 0.8 + 399 × 0.05 = 0.8 + 19.95 = **20.75 s**.
- Con streaming: el primer token a los **0.8 s**, y después 1 ÷ 0.05 = 20 tokens por segundo.
- Con un proxy que junta todo: la primera palabra llega a los **20.75 s**. El servidor cumple su TTFT y la persona espera 26 veces más.
? [reto] Alguien propone que el gateway de C01 mande el tensor a Triton en base64 dentro del JSON de KServe v2, «para no depender de la extensión binaria». ¿Cuánta red cuesta a 500 requests por segundo, comparado con la extensión binaria, con los floats como texto y con uint8? ¿Qué le respondes?
- Extensión binaria: 602,112 × 500 × 8 ≈ **2.4 Gb/s**.
- base64: 802,816 × 500 × 8 ≈ **3.2 Gb/s**: 33 % más, y además convertir 803 KB de ida y de vuelta en cada request.
- Floats como texto: ≈ 3.07 MB × 500 × 8 ≈ **12.3 Gb/s**, cinco veces más, y decenas de núcleos solo para serializar.
- uint8 en binario: 150,528 × 500 × 8 ≈ **0.6 Gb/s**.
- Respuesta: si el miedo es depender de una extensión de Triton, la salida estándar es **gRPC**, que lleva bytes crudos dentro del protocolo base, no base64. Y la mejora grande no es el protocolo sino el dtype: uint8 baja la red 4 veces.
? [reto] Diseña el contrato de una API de OCR que recibe documentos de 1 a 200 páginas. Una página tarda ≈ 2 s y quien llama espera, como mucho, 10 s. ¿Qué documentos se responden en la misma request y cuáles con 202? ¿Cómo viaja el PDF? ¿Cómo se entera el cliente?
- Con 10 s de espera y ≈ 2 s por página, caben unas 5 páginas, sin margen. Con margen para la cola y el p99, se responden en la request los de **1 o 2 páginas** (≈ 4 s), con **200** y el resultado.
- El resto recibe **202** con `job_id`. La regla se decide **antes** de procesar, por número de páginas, nunca después de que venció el tiempo.
- El PDF no viaja en base64: el cliente lo sube con una **URL prefirmada** y manda la key.
- Aviso: **webhook firmado con HMAC**, con reintentos y descarte de repetidos por `job_id`, y **polling** con `Retry-After` como respaldo. El resultado queda en `results/{job_id}.json`.
- El contrato lleva `/v1/` y escribe los dos casos: 200 con el resultado, o 202 con la dirección del estado.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M02 · Patrones de inferencia** separa lo síncrono (200 con la respuesta) de lo asíncrono (202 con un `job_id`), hace la cuenta del polling contra el webhook y explica la firma HMAC y la URL prefirmada.
- **M07 · Servidores de modelos** compara JSON, la extensión binaria y gRPC con el tensor de C01, presenta KServe v2 y la API compatible con OpenAI, y pone en una tabla SSE, WebSocket y los streams de gRPC.
- **M14 · Sistemas con LLMs** sigue un token desde vLLM hasta la app por SSE, explica el buffering, la cancelación y las salidas con JSON Schema.
- **M11** cuenta los tres contratos de un modelo y qué cambios los rompen. **C01** decide HTTP o gRPC hacia Triton; **C10** pone una API compatible con OpenAI delante de su LLM.

**En el Dojo:** la estación 6, «Código de serving», escribe el gateway de C01: el endpoint `/v1/classify`, su esquema, el 422 y la llamada a Triton con la extensión binaria. Cuando abra, ahí la vas a practicar.

**En Sensei:** «Balanceadores, proxies y gateways» explica por qué gRPC se pega a un solo servidor y qué proxy guarda un stream. «Timeouts, reintentos e idempotencia» retoma el webhook que llega dos veces y el `Retry-After`, y «Qué tan rápido y cuánto» mide lo que cuesta cada request.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
endpoint rest json serializacion base64 esquema-api versionado-api grpc protobuf protocolo-inferencia streaming sse websocket polling webhook
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué es un endpoint? Da el de C01.
Una puerta concreta de una API: un método HTTP más una ruta, con su propio contrato. El de C01 es POST /v1/classify, con top_k en la URL.
? ¿Qué le falta a JSON que un modelo suele necesitar?
Bytes (hay que usar base64 o mandarlos aparte), fechas (van como texto), NaN e infinito (no existen en el estándar) y enteros exactos arriba de 2⁵³ si el cliente los lee como FP64, como JavaScript.
? ¿Cuánto crece algo al pasarlo a base64, y por qué?
Un 33 %: cada 3 bytes (24 bits) se escriben como 4 letras de 6 bits.
? ¿Por qué C01 contesta en JSON pero le manda el tensor a Triton en binario?
Hacia afuera hay muchos clientes de otros equipos y una respuesta chica: conviene que sea legible. Hacia adentro hay un solo cliente y un tensor de 602 KB, 500 veces por segundo: en JSON pesaría 5 veces más y serializarlo quemaría decenas de núcleos.
? ¿Qué quiere decir «se versiona el contrato, no el modelo»?
El modelo cambia seguido sin cambiar la API; cada respuesta dice qué model_version contestó. Solo un cambio que rompe el contrato estrena /v2.
? ¿Para qué sirve SSE y qué arruina su efecto?
Para mandar la respuesta en pedazos, como los tokens de un LLM, y que la persona empiece a leer con el primero. Lo arruina un proxy que junta la respuesta antes de pasarla (buffering).
? ¿Polling o webhook para 10,000 trabajos vivos?
El polling cada 2 s serían 5,000 consultas por segundo, casi todas inútiles. El webhook manda un aviso por trabajo, pero el cliente necesita una dirección pública, firmas y descartar repetidos. Lo común: webhook, con polling como respaldo.
:::
