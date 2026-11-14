---
titulo: HTTP: requests, respuestas y códigos
en: HTTP: requests, responses and status codes
subtitulo: Qué dice, letra por letra, el mensaje que lleva la foto de Ana hasta el modelo y qué le contestan: la URL, el método, los headers, el body y el código de tres cifras que decide si alguien reintenta, cae a su plan B o se rinde.
pregunta: ¿Qué dice exactamente el mensaje que llega al gateway de Alba con la foto de Ana, qué le contesta el gateway y qué significa cada número de la respuesta?
requisitos: red
---

:::idea
HTTP es un acuerdo para escribir peticiones y respuestas como texto con una forma fija: una primera línea, unos headers, una línea en blanco y el body. Leerlo es leer lo que de verdad pasa entre dos programas. Y el código de tres cifras de cada respuesta dice qué pasó y de quién fue la culpa: de eso depende si quien pidió reintenta, cae a su plan B o se rinde.
:::

Ana toma la foto de sus tenis y toca «Publicar». En la lección anterior viste cómo viaja un mensaje de una máquina a otra: con una [[direccion-ip|dirección IP]], un [[puerto]] y una conexión [[tcp|TCP]] que entrega los bytes completos y en orden. Pero TCP solo mueve bytes. No dice qué significan.

Ana vende en Alba, la empresa que seguimos en todo el curso. Alba es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y, por cada foto, le sugiere a quien vende la categoría, entre 500 posibles. Su clasificador atiende ≈ 10 millones de fotos al día, una por request.

¿Cómo sabe el gateway de Alba (el programa que recibe la foto, la prepara y se la pasa al modelo) que esos 214,836 bytes son una foto, que alguien quiere su categoría y que espera cinco sugerencias? Lo sabe porque los dos programas hablan el mismo idioma: HTTP.

El camino es así. La app de Ana sube la foto al *backend* del marketplace, el programa que recibe las publicaciones. El backend le manda la foto al gateway con una [[request]] de HTTP, y el gateway contesta con una respuesta de HTTP. Las dos son texto que puedes leer.

En esta lección las abres pieza por pieza: la URL, el método, los headers, el body y el código de estado. Vas a levantar un servidor en tu computadora y a hacerle requests de verdad. Y al final vas a poder leer cualquier documento de diseño que diga «POST /v1/classify?top_k=5» o «503 con Retry-After» sabiendo qué dice cada pedazo.

## Un mensaje de texto con forma fija {A text message with a fixed shape}

Un [[protocolo]] es un conjunto de reglas que dos programas acuerdan para entenderse: quién habla primero, qué forma tiene cada mensaje y qué significa cada parte. [[http|HTTP]] (*HyperText Transfer Protocol*, protocolo de transferencia de hipertexto) nació con la web, a principios de los noventa (Tim Berners-Lee lo escribió en el CERN, el laboratorio europeo de física, entre 1989 y 1991), para pedir páginas. Hoy es el idioma por omisión entre programas: apps, [[api|APIs]], servidores de modelos.

HTTP tiene dos papeles. El [[cliente]] pide y el [[servidor]] responde. Siempre empieza el cliente, y cada request recibe exactamente una respuesta. En Alba, el backend es el cliente y el gateway, el servidor. Pero el gateway es cliente a su vez cuando le pide la predicción a Triton, el servidor del modelo. Ser cliente o servidor no depende de la máquina: depende de quién pide en esa conversación.

### La request, letra por letra

Esto es lo que el backend le escribe al gateway por la conexión TCP:

```text
POST /v1/classify?top_k=5 HTTP/1.1
Host: classifier.internal
Authorization: Bearer eyJhbGciOi...
Content-Type: image/jpeg
Content-Length: 214836
X-Request-ID: 9f2c41d0

(aquí siguen los 214,836 bytes de la foto)
```

Tiene cuatro partes, siempre en este orden:

:::pasos
1. La línea de la petición
*Request line*. Tres cosas separadas por espacios: el método (`POST`, qué quieres hacer), la ruta con su query (`/v1/classify?top_k=5`, sobre qué) y la versión del protocolo (`HTTP/1.1`).
2. Los headers
Una línea por dato, con la forma `Nombre: valor`. Dicen a quién va dirigida, quién la manda, qué trae el body y cuánto mide.
3. Una línea en blanco
Marca dónde terminan los headers. Sin ella, el servidor no sabría si viene otro header o ya empezó la foto.
4. El body
El cuerpo: los bytes de la foto, tal cual. Puede no haber body, como en una request que solo pide algo.
:::

Cada línea termina con dos caracteres invisibles, `\r\n`: *carriage return* y *line feed* (retorno de carro y salto de línea), un recuerdo de las máquinas de escribir. La línea en blanco es justo eso: un `\r\n` pegado al de la línea anterior, `\r\n\r\n`. Cuando el servidor lo encuentra, sabe que lo que sigue es el body.

¿Y dónde termina el body? TCP entrega un chorro de bytes sin orillas: detrás de esta request podría venir otra por la misma conexión. Por eso el header `Content-Length` dice cuántos bytes mide: el gateway lee exactamente 214,836 y sabe que la request terminó.

### La respuesta

El gateway contesta con la misma forma:

```text
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 345
X-Request-ID: 9f2c41d0

{
  "model_version": "resnet50-2026-10-01",
  "predictions": [
    {"label": "Calzado > Tenis", "score": 0.94},
    {"label": "Calzado > Zapatos casuales", "score": 0.04},
    {"label": "Calzado > Botas", "score": 0.02},
    {"label": "Deportes > Calzado deportivo", "score": 0.01},
    {"label": "Calzado > Sandalias", "score": 0.01}
  ]
}
```

La primera línea ahora es la **línea de estado** (*status line*): la versión, un [[codigo-estado|código de estado]] de tres cifras (200) y una frase para humanos (OK). Los programas solo leen el número. Después vienen los headers, la línea en blanco y el body: un texto en [[json|JSON]], un formato para escribir datos con llaves, corchetes y comillas, con las cinco categorías y la versión del modelo que contestó. Los scores son de ejemplo; la forma es la del contrato de la API de Alba.

:::figura http-anatomia
Las dos mitades de una conversación de HTTP. Las dos tienen la misma forma: una primera línea, los headers, una línea en blanco y el body. Solo cambia la primera línea: la request dice qué quiere; la respuesta, cómo le fue.
:::

### HTTP no tiene memoria

Cada request es independiente: el servidor no recuerda la anterior. Por eso cada una trae todo lo que hace falta, hasta quién la manda (`Authorization`). Se dice que HTTP es *stateless*, sin estado.

Parece un defecto y es una ventaja. Si ninguna request depende de la anterior, cualquier copia del gateway puede atender cualquier request. En su pico de diseño, 500 requests por segundo, Alba corre 5 copias, o *pods*, del gateway (en un momento promedio, 3), y el reparto entre ellas no tiene que fijarse en quién habló antes con quién.

### Pruébalo: un servidor y una request de verdad

La biblioteca estándar de Python trae `http.server`, un servidor de HTTP pequeño. Sirve para aprender y para pruebas; su propia documentación avisa que no es para producción. El código levanta uno en [[localhost]] (127.0.0.1, tu propia máquina) y le escribe una request **a mano**, con un [[socket]], el objeto con el que un programa manda y recibe bytes por una conexión. Así ves el texto tal cual viaja. Tres detalles para leerlo: `b"..."` es una cadena de bytes, no de texto, porque eso es lo que viaja; `self.rfile` y `self.wfile` son la conexión vista como dos archivos, uno para leer la request y otro para escribir la respuesta; y al final cada `\r\n` se imprime para que lo veas:

```python
import socket, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

class Gateway(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_POST(self):
        foto = self.rfile.read(int(self.headers["Content-Length"]))
        print("el servidor leyó:", self.requestline, "+", len(foto), "bytes de body")
        cuerpo = b'{"label": "Calzado > Tenis", "score": 0.94}'
        self.send_response_only(200)              # sin Date ni Server: así la salida no cambia
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()                        # escribe la línea en blanco
        self.wfile.write(cuerpo)
    def log_message(self, *args): pass           # sin bitácora en la pantalla

servidor = HTTPServer(("127.0.0.1", 0), Gateway)   # puerto 0: el sistema elige uno libre
threading.Thread(target=servidor.serve_forever, daemon=True).start()   # atiende en otro hilo

peticion = (b"POST /v1/classify?top_k=5 HTTP/1.1\r\nHost: localhost\r\n"
            b"Content-Type: image/jpeg\r\nContent-Length: 4\r\nConnection: close\r\n"
            b"\r\n" + bytes([0xFF, 0xD8, 0xFF, 0xE0]))   # los 4 primeros bytes de un JPEG
with socket.create_connection(servidor.server_address) as s:
    s.sendall(peticion)
    respuesta = b"".join(iter(lambda: s.recv(4096), b""))
print(respuesta.decode().replace("\r\n", "\\r\\n\n"))
```

```salida
el servidor leyó: POST /v1/classify?top_k=5 HTTP/1.1 + 4 bytes de body
HTTP/1.1 200 OK\r\n
Content-Type: application/json\r\n
Content-Length: 43\r\n
\r\n
{"label": "Calzado > Tenis", "score": 0.94}
```

El servidor encontró la línea en blanco, leyó los 4 bytes que anunciaba `Content-Length` y contestó. El body de la respuesta mide 43 bytes: cuenta los caracteres de `{"label": "Calzado > Tenis", "score": 0.94}` y salen 43. El header `Connection: close` le pidió al servidor cerrar la conexión al terminar; en la sección de keep-alive vas a ver por qué normalmente no se pide.

## La primera línea: método y URL {The first line: method and URL}

La primera línea dice qué quieres y sobre qué: `POST /v1/classify?top_k=5 HTTP/1.1`. El «sobre qué» es un pedazo de la URL.

### La URL, por partes

Una [[url|URL]] (*Uniform Resource Locator*, localizador uniforme de recursos) es la dirección completa de algo en la red. La del gateway de Alba, vista desde el backend, sería `https://classifier.internal/v1/classify?top_k=5`. Tiene cinco partes:

- **El esquema** (*scheme*), `https`: con qué protocolo se habla. `http` o `https`, casi siempre.
- **El host**, `classifier.internal`: el nombre de la máquina. El [[dns|DNS]] lo convierte en una dirección IP antes de conectarse.
- **El puerto**, que aquí no aparece. Si falta, se usa el de omisión: 80 para `http` y 443 para `https`. Si el servidor escucha en otro, se escribe después de dos puntos: Triton recibe HTTP en `http://triton:8000`.
- **La ruta** (*path*), `/v1/classify`: qué cosa, dentro del servidor. Parece la [[ruta]] de un archivo, pero no tiene por qué haber un archivo: es texto que el servidor interpreta. El `/v1` es la versión del contrato de la API, que se presenta en la lección siguiente como [[versionado-api|versionado]].
- **La query** (*query string*), `top_k=5`: parámetros opcionales, después del `?`, en pares `nombre=valor` separados por `&`.

:::figura http-url
La URL del gateway de Alba, desarmada, con el puerto escrito aunque sea el de omisión. El esquema y el puerto deciden cómo conectarse; el host, a qué máquina; la ruta y la query viajan en la primera línea de la request.
:::

Fíjate en qué viaja dónde. La ruta y la query van en la primera línea. El host va en el header `Host`. El esquema y el puerto ni siquiera se escriben: ya los usaste para abrir la conexión. Y si una URL trae un `#` (un *fragmento*, como `#precio`), esa parte nunca sale del navegador: sirve para saltar a un lugar de la página.

Una URL solo admite ciertos caracteres. Los demás se escriben con `%` y un código: un espacio es `%20`.

:::profundo Los caracteres especiales, y la URL desarmada en Python
Los espacios, la ñ o un `&` dentro de un valor se escriben con `%` y su código en hexadecimal. A eso se le llama *percent-encoding*. La ñ ocupa 2 bytes en UTF-8, la forma en que se guardan las letras como bytes, así que se vuelve `%C3%B1`. Python lo hace por ti:

```python
from urllib.parse import parse_qs, quote, urlencode, urlsplit

for url in ("https://classifier.internal/v1/classify?top_k=5", "http://localhost:8000/v2/health/ready"):
    u = urlsplit(url)
    print(u.scheme, "·", u.hostname, "· puerto:", u.port, "·", u.path, "·", parse_qs(u.query))

print(urlencode({"q": "tenis rojos", "talla": "26.5", "marca": "Niño & Co"}))
print(quote("/buscar/tenis niño"))
```

```salida
https · classifier.internal · puerto: None · /v1/classify · {'top_k': ['5']}
http · localhost · puerto: 8000 · /v2/health/ready · {}
q=tenis+rojos&talla=26.5&marca=Ni%C3%B1o+%26+Co
/buscar/tenis%20ni%C3%B1o
```

El `None` dice que la URL no trae puerto: se usará el 443. En una query, el espacio se puede escribir como `+`; en una ruta, como `%20`.
:::

### Los métodos: el verbo de la request

El [[metodo-http|método]] dice qué quieres hacer con la ruta. Los cinco que vas a ver:

- **GET**: dame esto. No lleva body. Lo usa tu navegador para cada página.
- **POST**: toma esto y procésalo. Lleva body. Puede crear algo nuevo cada vez.
- **PUT**: deja esto exactamente así. Manda la versión completa y reemplaza la que hubiera.
- **PATCH**: cambia solo estas partes.
- **DELETE**: borra esto.

Hay otros dos que aparecen de vez en cuando: **HEAD**, igual que GET pero sin body en la respuesta (solo los headers), y **OPTIONS**, que pregunta qué métodos acepta una ruta.

Los métodos se agrupan por dos propiedades. Un método es **seguro** (*safe*) si no cambia nada en el servidor: pedir no tiene efectos. Y es **idempotente** si hacerlo dos veces deja al servidor igual que hacerlo una. La [[idempotencia]] se presenta a fondo en la lección «Timeouts, reintentos e idempotencia», porque decide qué se puede reintentar sin miedo. Aquí basta la idea.

| Método | ¿Lleva body? | ¿Seguro? | ¿Idempotente? | Ejemplo |
|---|---|---|---|---|
| GET | No | Sí | Sí | `GET /v1/jobs/7f3c`: ¿ya terminó mi trabajo? |
| HEAD | No | Sí | Sí | ¿existe este archivo y cuánto pesa? |
| POST | Sí | No | No | `POST /v1/classify` (Alba) · `POST /v1/chat/completions` (un servicio que sirve su propio LLM) |
| PUT | Sí | No | Sí | `PUT /v1/usuarios/42/foto`: esta es tu foto de perfil |
| PATCH | Sí | No | No | `PATCH /v1/publicaciones/77` con `{"precio": 899}` |
| DELETE | Casi nunca | No | Sí | `DELETE /v1/jobs/7f3c`: cancela el trabajo |

¿Por qué DELETE es idempotente, si la segunda vez contesta distinto? Porque la idempotencia habla del **efecto** en el servidor, no de la respuesta. El primer DELETE borra el trabajo y responde que salió bien; el segundo no encuentra nada y responde «no existe». Pero después de los dos, el trabajo está borrado, igual que después de uno. Con POST no pasa: dos `POST /v1/publicaciones` iguales crean dos publicaciones.

Clasificar una foto no cambia nada en el gateway: en la práctica es seguro y se puede repetir. ¿Por qué entonces Alba usa POST y no GET? Porque la foto tiene que ir en el body, y el estándar de HTTP no le da ningún significado al body de un GET: muchos servidores y [[proxy|proxies]] (los programas intermedios que reenvían requests) lo ignoran o rechazan la request entera. El método describe la forma de la request; que clasificar sea repetible lo dice el contrato de la API, no el verbo.

¿Y si alguien manda `GET /v1/classify`? La ruta existe, pero no con ese método. El gateway responde **405 Method Not Allowed**, con un header `Allow: POST` que dice qué método sí acepta. Alba lo registra como un error del cliente.

## Headers: lo que va escrito en el sobre {Headers: what's written on the envelope}

Los [[header|headers]] son los datos sobre el mensaje: van entre la primera línea y la línea en blanco, uno por línea, con la forma `Nombre: valor`. El nombre no distingue mayúsculas: `Content-Type` y `content-type` son el mismo header. Y el orden casi nunca importa.

:::analogia El sobre y la carta
Una request es como una carta en un sobre. Lo que va escrito por fuera (a quién va, quién la manda, qué contiene, cuánto pesa) son los headers. La carta de adentro es el body. El cartero lee el sobre; casi nunca abre la carta.

**Dónde se rompe:** en HTTP sin cifrar, el «sobre» y la carta viajan igual de legibles: cualquiera en el camino puede leer las dos cosas. Y los intermediarios no solo entregan: leen los headers para decidir. Un [[balanceador]], el programa que reparte las requests entre las copias de un servicio, puede elegir a qué copia mandar cada una mirando un header.
:::

### Los que más vas a ver

| Header | Va en | Qué dice | Ejemplo |
|---|---|---|---|
| `Host` | Request | A qué nombre va dirigida; una misma IP puede atender muchos | `Host: classifier.internal` |
| `Content-Type` | Las dos | Qué hay en el body, como **tipo MIME** | `image/jpeg`, `application/json` |
| `Content-Length` | Las dos | Cuántos bytes mide el body | `Content-Length: 214836` |
| `Authorization` | Request | Quién eres, con una credencial | `Authorization: Bearer eyJhbGciOi...` |
| `Accept` | Request | Qué formatos aceptas en la respuesta | `Accept: application/json` |
| `User-Agent` | Request | Qué programa pide | `curl/8.7.1`, `Python-urllib/3.14` |
| `X-Request-ID` | Las dos | Un id para seguir la request en los logs de cada pieza | `X-Request-ID: 9f2c41d0` |
| `Retry-After` | Respuesta | En un 429 o un 503: cuánto esperar antes de reintentar | `Retry-After: 1` (segundos) |
| `Allow` | Respuesta | En un 405: qué métodos sí acepta la ruta | `Allow: POST` |
| `Location` | Respuesta | Dónde está lo que buscas, o lo que acabas de crear | `Location: /v1/jobs/7f3c` |

Un **tipo MIME** (*media type*) es una etiqueta de dos partes, tipo y subtipo: `image/jpeg` es una foto JPEG; `application/json`, texto en JSON; `text/event-stream`, una respuesta que llega en pedazos, como el texto de un LLM mientras se escribe ([[sse|SSE]], en la lección siguiente). Si el gateway recibe un tipo que no sabe leer, como `application/pdf`, responde **415**.

`Authorization` merece su propio párrafo. `Bearer` quiere decir «al portador»: quien presente este *token* (la credencial: un texto largo que nadie puede adivinar) es quien dice ser. El token puede ser un [[jwt|JWT]], un sobre firmado con la identidad de quien llama, o una [[api-key|llave de API]], una contraseña larga para programas; los dos tienen su lección en la fase de identidad. Lo importante aquí: viaja en un header, en cada request, porque HTTP no recuerda quién eres.

### Headers inventados

Puedes inventar los tuyos. Por costumbre empezaban con `X-`; desde 2012 el estándar recomienda ya no hacerlo, pero la costumbre sigue por todas partes.

Para seguir los de Alba hace falta conocer a un intermediario que vas a ver mucho: el ALB (*Application Load Balancer*), el [[balanceador]] de AWS (*Amazon Web Services*, la nube de Amazon donde corre el sistema de Alba). Es el programa que recibe el tráfico del clasificador y reparte las requests entre las copias del gateway. Dos headers inventados que usa Alba:

- `X-Request-ID` une los logs del backend y del gateway para una misma request. Lo pone el backend; el gateway lo respeta (o inventa uno si no llega), lo escribe en cada línea de su log y lo devuelve en la respuesta. El ALB no usa ese header; agrega su propio id, `X-Amzn-Trace-Id`.
- `x-client-source` dice si la request viene del celular o de la web. Pero lo escribe quien llama, así que puede mentir: sirve para separar métricas, nunca para decidir permisos. Para eso está el token, que el ALB verifica.

### Cookies, de pasada

Si HTTP no recuerda nada, ¿cómo sabe una página que ya iniciaste sesión? Con una [[cookie]]. El servidor responde con `Set-Cookie: sesion=ab12; HttpOnly; Secure` y el navegador la guarda. Desde entonces, cada request a ese sitio lleva `Cookie: sesion=ab12`, y el servidor busca esa sesión en su base de datos. La memoria no está en HTTP: está en un header que el navegador repite.

Entre servicios, como del backend al gateway, casi no se usan: cada request lleva su `Authorization`.

:::profundo Un header y una cookie para cambiar de modelo
Cuando Alba prueba una versión nueva del modelo, usa los dos mecanismos de esta sección. En una prueba A/B, que compara dos versiones del modelo dándole cada una a una parte de los vendedores, el backend pone el header inventado `X-Model-Arm` con la versión que le toca a ese vendedor, y una regla del ALB manda la request a esa versión mirando el header. Y durante un cambio gradual de versión, el ALB puede usar una cookie suya (`AWSALBTG`) para mandar a la misma persona siempre a la misma versión, lo que se llama una [[sticky-session|sesión pegajosa]].
:::

## El body: dónde viaja la foto {The body: where the photo travels}

El [[body]] es todo lo que va después de la línea en blanco. Su formato lo dice `Content-Type` y su tamaño, `Content-Length`. Puede estar vacío, como en un GET.

### Tres formas de mandar una foto

**1. Los bytes crudos.** El body es el archivo JPEG tal cual, con `Content-Type: image/jpeg`. Es lo que hace Alba. Lo que llega es exactamente lo que se mandó: nada que traducir, nada que crezca. El equipo de Alba lo justifica así: menos trabajo para leerlo y ningún archivo temporal.

**2. JSON con base64.** Un body en JSON es texto, y un texto no puede llevar bytes cualquiera: el byte 0, por ejemplo, no es una letra. La solución es [[base64]], que reescribe cada 3 bytes como 4 letras de un alfabeto de 64 símbolos seguros (A–Z, a–z, 0–9, `+` y `/`). El body queda así:

```text
{"image": "/9j/4AAQSkZJRgABAQ...", "top_k": 5}
```

Ese `/9j/` del principio es como se escriben en base64 los primeros tres bytes de cualquier JPEG, que en hexadecimal son FF D8 FF. El precio es el tamaño:

:::formula Bytes en base64
g = frac{b}{3} text{, redondeado hacia arriba}
b_{64} = 4 × g ≈ frac{4}{3} × b
- b: los bytes en crudo, sin codificar: los de la foto o los de cualquier otro archivo
- g: cuántos grupos de 3 bytes hay; el último, aunque esté incompleto, cuenta como uno
- b_{64}: los bytes que ocupa lo mismo escrito en base64: 4 letras por grupo, y cada letra es 1 byte
:::

Para el tráfico de muchas fotos, multiplica por \( r \), las fotos por segundo, y por los 8 bits que tiene cada byte: \( b × r × 8 \) bits por segundo.

:::cuenta La foto de Ana, en bytes crudos y en base64
Bytes de la foto, \(b\) // la del celular, ya reducida a ≤ 1024 px; la de Ana, 214,836 B, redondeada | — | 200,000 B
Grupos de 3 bytes, \(g\) // el último incompleto también cuenta | \(g = b/3\) = 200,000 ÷ 3, hacia arriba | 66,667
Bytes en base64, \(b_{64}\) // 4 letras por cada grupo | \(b_{64} = 4 × g\) = 4 × 66,667 | 266,668 B
Crecimiento | \(b_{64} ÷ b\) = 266,668 ÷ 200,000 | 1.33: un 33 % más
Fotos por segundo, \(r\) // el pico de diseño de Alba | — | 500
Tráfico en el pico, crudas | \(b × r × 8\) = 200,000 × 500 × 8 bits | 0.8 Gb/s
Tráfico en el pico, en base64 | \(b_{64} × r × 8\) = 266,668 × 500 × 8 bits | ≈ 1.07 Gb/s
= Base64 cuesta un tercio más de bytes en cada request, y además CPU para codificar de un lado y decodificar del otro. Por eso Alba manda los bytes crudos.
:::

Alba hace la misma cuenta con el [[tensor]] que el gateway le manda a Triton, la tabla de números ya lista para el modelo: 3 × 224 × 224 números de 4 bytes son \( b \) = 602,112 bytes en binario; en base64, \( b_{64} ≈ 4/3 × 602,112 \) ≈ 803 KB; y ≈ 3.1 MB si los números van como texto en JSON. JSON sirve para leer y depurar; para mover muchos bytes, no.

**3. multipart/form-data.** Es la forma en que un formulario web sube archivos. El body se parte en secciones separadas por una frontera, una línea larga y única que no aparece en los datos. Cada sección trae sus propios mini-headers: una lleva la foto en bytes crudos y otra, por ejemplo, el título de la publicación. Agrega unos cientos de bytes, no un tercio. Conviene cuando la foto viaja con otros campos.

### El tope: el 413 casi gratis

Un body sin tope es una invitación al abuso. Una foto de 10 GB llenaría la memoria del gateway, y una [[bomba-descompresion|bomba de descompresión]] pesa poco pero ocupa muchísimo al abrirse. Por eso Alba acepta fotos de hasta 10 MB.

El tope se revisa **antes** de leer el body. `Content-Length` llega en los headers, así que el gateway puede responder **413** («demasiado grande») sin haber recibido la foto: le cuesta casi nada. Cada pieza del camino tiene su propio tope, y el más chico manda:

- El gateway de Alba: 10 MB por foto.
- El ALB de Alba: no le pone tope al body. Sí a los headers: 64 KB entre todos; si se pasan, responde 400.
- nginx, un servidor web y [[proxy]] muy usado: 1 MB por omisión (su opción `client_max_body_size`). Si un nginx sin configurar queda en el camino, una foto web de 3 MB recibe un 413 de él, no del gateway.
- Amazon API Gateway, un servicio de AWS: un tope duro de 10 MB por request, que no se puede subir. Fue una de las razones por las que Alba no lo usó.
- Un endpoint en tiempo real de SageMaker AI, la plataforma de ML de AWS: 6 MiB (6,291,456 bytes) por request, y 60 segundos para responder.

Las cifras de AWS son las de su documentación en 2026; los servicios en la nube cambian sus topes de vez en cuando, así que se revisan antes de diseñar. Y fíjate en lo que dice el caso de nginx: el 413 lo responde **la pieza que tiene el tope**. Si una pieza de en medio tiene uno más chico, el gateway nunca ve la request, y buscar ese 413 en sus logs no sirve de nada.

Prueba con la calculadora cuánto pesa la foto en cada forma y cuánto tarda en subir.

:::calculadora http-body
Arranca con la foto del celular: 200 KB en bytes crudos, una subida de 10 Mb/s y el pico de 500 fotos por segundo. Pon 1 en base64 y mira crecer todo un tercio. Luego pon 9,000 KB: en base64 pasa de 10 MB y se vuelve un 413.
:::

## Códigos de estado: qué pasó y de quién es la culpa {Status codes: what happened and whose fault it is}

El [[codigo-estado|código de estado]] es el número de tres cifras de la primera línea de la respuesta. La primera cifra dice la familia, y con ella ya sabes casi todo:

- **1xx, informativo:** «sigue». Casi no los vas a ver. El 101 aparece cuando una conexión se cambia a [[websocket|WebSocket]], una conexión que queda abierta para mandar mensajes en los dos sentidos.
- **2xx, éxito:** salió bien.
- **3xx, redirección:** lo que buscas está en otro lado; el header `Location` dice dónde.
- **4xx, error del cliente:** tu request está mal. Si la repites igual, va a fallar igual.
- **5xx, error del servidor:** yo fallé. Quizá más tarde sí se pueda.

:::figura http-familias
Las cinco familias de códigos, del 100 al 599. La primera cifra dice de quién es la culpa: la línea entre el 4xx y el 5xx separa «tu request está mal» de «yo fallé», y de ella depende si tiene sentido reintentar.
:::

### Los códigos que vas a ver

| Código | Qué dice | ¿De quién es la culpa? | ¿Reintentar? | Dónde aparece |
|---|---|---|---|---|
| **200** OK | Salió bien; la respuesta viene en el body | De nadie | No hace falta | Alba, con sus 5 categorías |
| **202** Accepted | Recibí tu pedido; el resultado, después | De nadie | No: pregunta luego por el resultado | Un trabajo largo: un `POST` que devuelve un `job_id`, el número del trabajo |
| **400** Bad Request | Tu request no tiene sentido | Del cliente | No | Alba: bytes que no son una imagen |
| **401** Unauthorized | No sé quién eres | Del cliente: falta o no vale su credencial | No, hasta tener una credencial válida | Un servicio de LLM: sin llave válida |
| **403** Forbidden | Sé quién eres y no puedes | Del cliente | No | Un equipo que pide un modelo que no le toca |
| **404** Not Found | Eso no existe aquí | Del cliente | No | `/v1/clasify`, mal escrito |
| **405** Method Not Allowed | La ruta existe; el método, no | Del cliente | No | Alba: un `GET` a `/v1/classify` |
| **413** Content Too Large | El body pasa el tope | Del cliente | No | Alba: una foto de más de 10 MB |
| **415** Unsupported Media Type | No sé leer ese tipo | Del cliente | No | Alba: un PDF, o un GIF |
| **422** Unprocessable Content | Entiendo la forma, pero el contenido no vale | Del cliente | No | Alba: `top_k=0` |
| **429** Too Many Requests | Te pasaste de tu cuota | Del cliente | Sí, después de `Retry-After` | Una API con cuota por cliente, como un servicio de LLM |
| **500** Internal Server Error | Algo falló adentro y no sé decir qué | Del servidor: casi siempre un bug | Con cuidado | Alba: el modelo devolvió [[logit\|logits]] NaN, «no es un número» |
| **502** Bad Gateway | Soy intermediario y quien está detrás me contestó mal | Del servidor de atrás | Sí, con cuidado | Un servicio de LLM: vLLM, el servidor del modelo, se cayó |
| **503** Service Unavailable | Ahora no puedo: estoy lleno o me falta algo | Del servidor | Sí, después de `Retry-After` | Alba: Triton caído, o un pod que ya atiende 16 requests a la vez, su tope (`MAX_INFLIGHT`) |
| **504** Gateway Timeout | Soy intermediario y quien está detrás no contestó a tiempo | Del servidor de atrás | Con cuidado: el tiempo ya se gastó | Alba: Triton no respondió en 150 ms |

Tres pares se confunden mucho:

- **401 y 403.** Al 401 le pusieron «no autorizado», pero quiere decir «no sé quién eres» (sin credencial, o con una vencida). El 403 es «sé quién eres y no te toca».
- **400 y 422.** Los dos dicen «tu entrada está mal». FastAPI, el framework de Python con que está escrito el gateway de Alba, responde 422 por su cuenta cuando Pydantic, la librería que revisa los tipos de cada parámetro, rechaza uno: `top_k=0`, si el contrato pide de 1 a 20. El 400 lo usa el gateway para lo que revisa él mismo, como una imagen que no se puede [[decodificar]].
- **429 y 503.** Los dos llevan `Retry-After` y los dos invitan a reintentar, pero la culpa es opuesta. El 429 dice «tú te pasaste de tu cuota; yo estoy bien». El 503 dice «yo estoy saturado; no es culpa tuya». Si respondes 503 por una cuota, tu alarma de disponibilidad se dispara por culpa de un cliente que se pasó.

Los dos con «Gateway» en el nombre, el 502 y el 504, los responde un intermediario cuando el de atrás falla: el gateway cuando Triton no contesta a tiempo, o el ALB cuando el gateway le cierra la conexión. Y hay códigos que no están en ningún estándar: el **499** es una convención de nginx para «el cliente se fue antes de la respuesta». Lo ves en la sección extra que sigue.

### Quién responde cada código

El código no siempre lo pone el servidor final. Cada pieza del camino puede contestar por su cuenta, y saber quién lo hizo es la mitad de cualquier diagnóstico.

:::diagrama http-codigos
Toca cada pieza para ver qué códigos responde ella misma. Los recorridos siguen cuatro requests distintas: una que sale bien y tres que se quedan en el camino.
:::

### Para qué sirve saber de quién es la culpa

Quien llama decide con el código. El backend de Alba hace así: con un 4xx no reintenta, porque fallaría igual, y lo anota como un error suyo; con un 503 o un 504, o si no llega nada en 300 ms, muestra el selector de categorías de siempre y Ana elige a mano. Ese plan B es el [[fallback]] de Alba.

Y la culpa decide qué cuenta contra la promesa. En «Promedios, medianas y percentiles» viste el [[sli|SLI]] de disponibilidad de Alba: de las requests que cuentan, la fracción que salió sin error del servidor y en menos de 300 ms; su promesa, el [[slo|SLO]], es 99.9 %. Las que cuentan son solo las **válidas**: las que no fallaron por culpa de quien llama. Una foto de 50 MB que recibe 413 no es una falla del servicio.

:::formula SLI de disponibilidad, contando bien los 4xx
V = N − E
SLI = frac{V − F}{V}
- N: todas las requests del día
- E: las que recibieron un 4xx: culpa de quien llama
- V: las **válidas**, las que cuentan
- F: las malas, o *fallas*: las que recibieron un 5xx más las lentas, de más de 300 ms
:::

:::cuenta El SLI de Alba en un día, contando bien los 4xx
Requests del día, \(N\) // las de un día de Alba | — | 10,000,000
Con 4xx, \(E\) // 413, 415, 422, 429…: culpa de quien llama; supuesto | — | 150,000
Válidas, \(V\) | \(V = N − E\) = 10,000,000 − 150,000 | 9,850,000
Malas, \(F\) // supuesto: 4,000 con 5xx y 3,000 lentas, de más de 300 ms | 4,000 + 3,000 | 7,000
SLI | \(SLI = (V − F)/V\) = (9,850,000 − 7,000) ÷ 9,850,000 | ≈ 99.93 %
Si los 4xx contaran como fallas // \(E + F\) = 150,000 + 7,000 = 157,000 malas, sobre todas | \((N − E − F)/N\) = (10,000,000 − 157,000) ÷ 10,000,000 | ≈ 98.43 %
= Contado bien, el día queda arriba del 99.9 % del SLO. Contando los 4xx, parecería un desastre por errores que no son del servicio.
:::

Los 10 millones de requests son los de un día de Alba; cuántas tienen 4xx, 5xx o llegan lentas es un supuesto para el ejemplo. La regla es la que sigue Alba: los 4xx no se reintentan y no cuentan contra el SLO.

### Los códigos, en tu computadora

Este servidor imita las revisiones del gateway de Alba con un tope de juguete de 1,000 bytes. Revisa en el mismo orden que el gateway: primero lo barato.

```python
import threading, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

class Gateway(BaseHTTPRequestHandler):          # tope de juguete: 1,000 bytes (en Alba, 10 MB)
    def do_GET(self): self.responder(405)      # /v1/classify solo acepta POST
    def do_POST(self):
        largo, top_k = int(self.headers["Content-Length"]), int(self.path.split("top_k=")[1])
        if largo > 1000: codigo = 413           # se decide con el header, sin leer el body
        elif self.headers["Content-Type"] != "image/jpeg": codigo = 415
        elif not 1 <= top_k <= 20: codigo = 422
        else: codigo = 200
        self.rfile.read(largo)                  # la demo lo lee igual, para que corra estable
        self.responder(codigo)
    def responder(self, codigo):
        self.send_response(codigo); self.send_header("Content-Length", "0"); self.end_headers()
    def log_message(self, *args): pass

servidor = HTTPServer(("127.0.0.1", 0), Gateway)
threading.Thread(target=servidor.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{servidor.server_port}/v1/classify?top_k="

def pedir(metodo, top_k, tipo, body):
    req = urllib.request.Request(url + top_k, body, {"Content-Type": tipo}, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=2) as r: return r.status
    except urllib.error.HTTPError as e: return e.code     # urllib lanza un error con 4xx y 5xx

foto = b"\xff\xd8" + b"x" * 498                             # 500 bytes que empiezan como un JPEG
for caso in [("POST", "5", "image/jpeg", foto), ("GET", "5", "image/jpeg", None),
             ("POST", "5", "image/jpeg", foto * 4), ("POST", "5", "application/pdf", b"%PDF"),
             ("POST", "0", "image/jpeg", foto)]:
    print(f"{caso[0]:<4} top_k={caso[1]}  {caso[2]:<15} {len(caso[3] or b''):>5} bytes → {pedir(*caso)}")
```

```salida
POST top_k=5  image/jpeg        500 bytes → 200
GET  top_k=5  image/jpeg          0 bytes → 405
POST top_k=5  image/jpeg       2000 bytes → 413
POST top_k=5  application/pdf     4 bytes → 415
POST top_k=0  image/jpeg        500 bytes → 422
```

Fíjate en `timeout=2`: el cliente espera como máximo 2 segundos. Un cliente sin [[timeout]] puede quedarse esperando para siempre, y en Python, la librería `requests` no trae uno si no se lo pides. Lo ves a fondo en «Timeouts, reintentos e idempotencia».

## Leer una request sin confiar en ella {Reading a request without trusting it} [extra]

Quien manda la request puede equivocarse o mentir. El gateway de Alba la lee como quien revisa un paquete sospechoso: primero lo que cuesta poco, y sin creerle a la etiqueta.

### No le creas a la etiqueta

`Content-Type` y `Content-Length` los escribe quien llama, y quien llama puede equivocarse. Por eso el gateway de Alba no se queda con la etiqueta: también cuentan los primeros bytes del body, que en cada formato de imagen son fijos. Un JPEG empieza con FF D8 FF; un PNG, con 89 50 4E 47 (los tres últimos son las letras «PNG»); un WebP, con las letras «RIFF» y, cuatro bytes después, «WEBP». Pillow, la librería con que el gateway abre las fotos, reconoce el formato por esos bytes, no por la etiqueta, y solo acepta los tres permitidos. Si la etiqueta dice `image/jpeg` pero los bytes dicen otra cosa, Pillow no la abre y la request recibe un 400. La etiqueta sirve para rechazar rápido (415); los bytes, para confirmar.

### Cuando no hay Content-Length

A veces el cliente no sabe de antemano cuánto va a mandar: por ejemplo, si va leyendo el archivo mientras lo sube. Entonces usa `Transfer-Encoding: chunked`: manda el body en pedazos, cada uno precedido por su tamaño en hexadecimal, y un pedazo de tamaño 0 marca el final.

Así se ve un body de 20 bytes mandado en dos pedazos. El `a` es 10 en hexadecimal y el `0` final dice «ya no hay más»:

```text
POST /v1/classify?top_k=5 HTTP/1.1
Host: classifier.internal
Content-Type: image/jpeg
Transfer-Encoding: chunked

a
(10 bytes de la foto)
a
(otros 10 bytes)
0

```

Sin `Content-Length`, el truco del 413 gratis no sirve. El gateway tiene que contar mientras lee y cortar en cuanto pasa del tope. Así lo hace el gateway de Alba: lee el body en pedazos, suma sus tamaños y responde 413 al pasar de 10 MB, sin haber guardado nada más. La misma cuenta protege de un cliente que **miente** en `Content-Length` y anuncia menos de lo que manda.

:::ojo Dos lectores que no se ponen de acuerdo
Si una request trae `Content-Length` y `Transfer-Encoding` a la vez, o un `Content-Length` raro, el proxy de adelante y el servidor de atrás pueden decidir distinto dónde termina el body. Lo que para uno es el final de la foto, para el otro es el principio de una segunda request, escondida dentro de la primera. Ese ataque se llama *request smuggling* (contrabando de requests). La defensa es que cada pieza rechace con un 400 lo ambiguo, en vez de adivinar.
:::

### El cliente que se va

El backend le está pasando al gateway una foto de 100,000 bytes y, cuando lleva 1,000, la conexión se cierra: el backend se reinició, o se cansó de esperar. ¿Qué código registra el gateway? No hay a quién responderle. La convención de nginx es anotarlo como **499**, «el cliente cerró la conexión», y el gateway de Alba la copia. No es un 5xx, porque no falló el servidor; se cuenta con los 4xx, fuera de la tasa de errores del servicio. Si se contara como 500, cada reinicio del backend le quitaría un poco al SLO. Cada pieza tiene sus propios números para esto: el ALB de AWS, por ejemplo, anota un **460** si el cliente se va mientras espera la respuesta, y un 400 si se va a media subida.

### El cliente que va muy despacio

Otro abuso: abrir una conexión y mandar un byte por segundo. Cada conexión así ocupa memoria y un lugar en el servidor, sin costarle casi nada al atacante. Por eso los servidores ponen un tiempo máximo para recibir los headers y el body, y cierran lo que va demasiado lento. Los headers también tienen tope de tamaño: cada servidor pone el suyo, de unos KB a unas decenas de KB (nginx, 8 KB por header; el ALB, 64 KB entre todos). Si se pasa, el estándar tiene un código, el **431** (*Request Header Fields Too Large*), pero muchos servidores, nginx y el ALB entre ellos, responden un 400 a secas.

### El orden de las revisiones

:::pasos
1. Método y ruta
¿Existe la ruta? ¿Con ese método? Si no, 404 o 405. Cuesta microsegundos.
2. Identidad
¿Trae una credencial válida? ¿Le toca esta ruta? Si no, 401 o 403. En Alba lo revisa el ALB, así que en la práctica pasa incluso antes del paso 1, cuando la request ni ha llegado al gateway.
3. Cuota
¿Le queda cuota a este cliente? Si no, 429 con `Retry-After`.
4. Headers del body
¿`Content-Length` pasa del tope? 413. ¿El tipo es JPEG, PNG o WebP? Si no, 415. ¿Los parámetros valen? Si no, 422.
5. El body, contando
Se lee en pedazos y se corta al pasar de 10 MB: 413. Si el cliente se va, 499.
6. La foto
Se revisan sus primeros bytes y sus megapíxeles, y se decodifica: 400 si no es una imagen. Aquí ya se gasta CPU de verdad.
7. El modelo
Si Triton no contesta, 503; si tarda más de su tiempo, 504. Aquí se gasta GPU.
:::

Cada paso es más caro que el anterior. Rechazar en el paso 1 cuesta casi nada; rechazar en el 7 ya gastó CPU, memoria y GPU. Por eso lo barato va primero: es la misma idea de las guardas de la lección de imágenes.

## HTTPS, keep-alive y pools: no pagues dos veces la conexión {HTTPS, keep-alive and pools: don't pay for the connection twice}

### HTTPS: el mismo HTTP, en un sobre cerrado

El HTTP que viste viaja legible. Cualquiera en el camino (el wifi de una cafetería, un router de la ruta) puede leer el token de `Authorization` y la foto, y hasta cambiarlos. [[https|HTTPS]] es el mismo HTTP metido dentro de [[tls|TLS]], una capa que cifra todo lo que pasa por la conexión y comprueba que el servidor es quien dice ser, con un *certificado*: un documento digital que dice «este nombre es de este servidor», firmado por una organización en la que tu sistema ya confía. Cómo lo logra es tema de la lección de cifrado, en la fase 9.

Los mensajes de HTTP no cambian en nada: la misma primera línea, los mismos headers, el mismo body. Solo viajan cifrados. Por omisión, HTTPS usa el puerto 443. Por fuera se sigue viendo a qué IP y puerto vas, cuánto pesan los mensajes y, casi siempre, el nombre del host, porque el cliente lo manda sin cifrar al saludar, para que el servidor sepa qué certificado mostrar. Hay una extensión nueva que también lo esconde, pero todavía se usa poco. La ruta, los headers y el body quedan ocultos.

En Alba, el ALB **termina** TLS: descifra la request y la manda al gateway por la red privada del sistema. Alba pide además TLS en todo lo que sale de un pod y, si hubiera una [[service-mesh|malla de servicios]] (proxies junto a cada pod, en la lección de balanceadores; Alba no la tiene todavía), [[mtls|mTLS]] dentro del cluster (el grupo de máquinas donde corren los pods): TLS en los dos sentidos, donde también el cliente muestra su certificado.

### Lo que cuesta abrir una conexión

Antes del primer byte de HTTP hay que abrir la conexión. Como viste en la lección anterior, TCP abre con un [[handshake]], un saludo de tres mensajes que cuesta un [[rtt|RTT]] (*round-trip time*: lo que tarda un mensaje en ir y volver). Encima va el saludo de TLS: 1 RTT más con TLS 1.3, la versión actual (de 2018), y 2 con TLS 1.2, la anterior. Solo entonces viajan la request y la respuesta: otro RTT, más lo que tarde el servidor.

:::formula Tiempo de una request, con conexión nueva o abierta
t_{nueva} = (1 + k + 1) × RTT + w
t_{abierta} = RTT + w
- RTT: lo que tarda un mensaje en ir y volver, en ms
- k: cuántos RTT cuesta el saludo de TLS: 1 con TLS 1.3, 2 con TLS 1.2, 0 sin TLS
- w: lo que tarda el servidor en trabajar, en ms
- t_{nueva}: el tiempo hasta la respuesta con una conexión nueva, en ms. El primer 1 es el saludo de TCP; el último, la request con su respuesta
- t_{abierta}: el mismo tiempo por una conexión que ya estaba abierta, en ms
:::

:::cuenta La primera request desde el celular de Ana
RTT del celular a Virginia // dato de Alba: Ana está en Ciudad de México y las máquinas, en us-east-1 (Virginia) | — | 60 ms
Handshake de TCP // 1 RTT | 1 × 60 ms | 60 ms
Handshake de TLS 1.3, \(k\) = 1 | \(k × RTT\) = 1 × 60 ms | 60 ms
Request y respuesta // 1 RTT | 1 × 60 ms | 60 ms
El servidor trabaja, \(w\) // supuesto | — | 40 ms
Con una conexión nueva, \(t_{nueva}\) | \(t_{nueva} = (1 + k + 1) × RTT + w\) = 3 × 60 + 40 | 220 ms
Con la conexión ya abierta, \(t_{abierta}\) | \(t_{abierta} = RTT + w\) = 60 + 40 | 100 ms
Con una nueva y TLS 1.2, \(k\) = 2 | \(t_{nueva}\) = (1 + 2 + 1) × 60 + 40 | 280 ms
= Abrir la conexión cuesta más que la request misma: 120 ms de saludos (\(t_{nueva} − t_{abierta}\) = 220 − 100) contra 100 de trabajo útil. Reusarla los ahorra todos.
:::

:::figura http-conexion
La misma request, con una conexión nueva y con una que ya estaba abierta. A la izquierda, tres viajes de ida y vuelta antes de tener la respuesta; a la derecha, uno solo.
:::

### Keep-alive: dejar la conexión abierta

[[keep-alive|Keep-alive]] es no cerrar la conexión después de la respuesta, para mandar por ella la siguiente request. En HTTP/1.1 es lo normal: la conexión queda abierta salvo que alguien mande `Connection: close`. El servidor la cierra cuando pasa un rato sin uso, su *idle timeout* (tiempo máximo de inactividad).

Dentro de un centro de datos el RTT es de una fracción de milisegundo, y los saludos cuestan poco en tiempo. Pero cada conexión nueva también cuesta CPU, sobre todo con TLS, y deja rastro en el sistema operativo. El gateway de Alba crea **un solo** cliente de Triton por [[proceso]] y lo reusa en todas las requests: reusa sus conexiones y no hace un handshake por foto.

### El pool de conexiones

En HTTP/1.1, una conexión lleva una request a la vez: la segunda espera a que llegue la respuesta de la primera. Si el gateway quiere 16 llamadas a Triton al mismo tiempo, necesita 16 conexiones.

Un [[pool-conexiones|pool de conexiones]] es un grupo de conexiones abiertas que el cliente guarda y presta. Cada request toma una libre, la usa y la devuelve. Si no hay libre y el pool no ha llegado a su tamaño máximo, abre otra; si ya llegó, la request espera su turno. Así el pool también es un tope: limita cuántas llamadas van a la vez hacia un servidor.

En Python, `urllib.request.urlopen` abre y cierra una conexión cada vez. `http.client.HTTPConnection` la deja abierta. El servidor de abajo cuenta cuántas conexiones recibe:

```python
import http.client, threading, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Gateway(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"               # permite dejar la conexión abierta
    conexiones = 0
    def setup(self):                            # corre una vez por cada conexión nueva
        Gateway.conexiones += 1
        super().setup()
    def do_GET(self):
        self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *args): pass

servidor = ThreadingHTTPServer(("127.0.0.1", 0), Gateway)   # atiende cada conexión en su hilo
threading.Thread(target=servidor.serve_forever, daemon=True).start()
host, puerto = servidor.server_address

for _ in range(10):                             # urllib abre y cierra una conexión cada vez
    urllib.request.urlopen(f"http://{host}:{puerto}/v2/health/ready").read()
print("10 requests con urllib:          ", Gateway.conexiones, "conexiones")

Gateway.conexiones = 0
con = http.client.HTTPConnection(host, puerto)  # una conexión que se reusa (keep-alive)
for _ in range(10):
    con.request("GET", "/v2/health/ready"); con.getresponse().read()
print("10 requests con una HTTPConnection:", Gateway.conexiones, "conexión")
```

```salida
10 requests con urllib:           10 conexiones
10 requests con una HTTPConnection: 1 conexión
```

Fuera de la biblioteca estándar, lo mismo hacen `requests.Session` y `httpx.Client`: crea uno y reúsalo, en vez de un cliente nuevo por request. Con la calculadora, juega con el RTT y con cuántas requests van por cada conexión.

:::calculadora http-conexion
Arranca con el celular de la cuenta: RTT de 60 ms, TLS 1.3 (\(k\) = 1), 40 ms del servidor y 10 requests por conexión. Pon 1 request por conexión para ver el caso sin keep-alive. Luego baja el RTT a 0.5 ms, como dentro de un centro de datos: los saludos casi desaparecen.
:::

### Los dos lados tienen que estar de acuerdo

Una conexión abierta tiene dos dueños, y cada uno tiene su idle timeout. El ALB cierra las que pasan 60 segundos sin uso; uvicorn, el servidor que corre el gateway, a los 5 si nadie le dice otra cosa (los dos son sus valores por omisión en 2026). Si el de atrás cierra primero, el ALB a veces manda una request por una conexión que acaba de morir, y responde **502**. Por eso Alba corre uvicorn con `--timeout-keep-alive 75`: así siempre cierra primero el ALB. Lo desarmas en el último reto.

:::profundo Los puertos que deja cada conexión cerrada
Lo viste en la lección anterior: el lado que cierra primero una conexión TCP deja su [[puerto]] de origen apartado 60 segundos (el estado `TIME_WAIT`), y Linux solo tiene 28,232 puertos de origen. Ahora ponle HTTP encima.

Un cliente que abre una conexión por request hacia un mismo servidor, y la cierra él, en el pico de diseño de Alba: 500 conexiones nuevas por segundo × 60 s = 30,000 puertos apartados. No caben en 28,232, y las conexiones nuevas fallan con un error que no parece de HTTP: «no se puede asignar la dirección pedida». El límite es por destino: si las mismas 500 se reparten entre los 5 pods del gateway, cada uno con su IP, son 100 por segundo × 60 s = 6,000 por pod, y caben. Pero una sola máquina de pruebas de carga que manda 1,000 por segundo a un solo destino sin keep-alive aparta 60,000 y se queda sin puertos. Con keep-alive se abren unas cuantas conexiones y el problema desaparece.
:::

## HTTP/2 y HTTP/3 {HTTP/2 and HTTP/3} [extra]

HTTP/1.1 tiene dos límites que ya viste: una request a la vez por conexión, y headers en texto que se repiten enteros en cada request. [[http2|HTTP/2]], de 2015, los resuelve sin cambiar el significado: los mismos métodos, los mismos headers, los mismos códigos. Cambia el cableado.

- **Binario.** Ya no son líneas de texto, sino **frames**: pedacitos con un encabezado de tamaño fijo que dice qué son y a qué request pertenecen. La primera línea desaparece: el método, la ruta y el código viajan como headers especiales (`:method`, `:path`, `:status`), y los nombres de los headers van en minúsculas.
- **Varias requests a la vez en una conexión.** Cada request es un *stream* con su número, y los frames de distintos streams se intercalan. Es la **multiplexación**: decenas de requests en vuelo por una sola conexión, y una respuesta lenta no detiene a las demás.
- **Headers comprimidos.** Los dos lados recuerdan los headers ya enviados (la compresión se llama HPACK). Un header que se repite igual en cada request, como `User-Agent` o `Content-Type`, viaja como un número de uno o dos bytes. (Los secretos, como `Authorization`, se pueden marcar para que nunca entren a esa memoria: compartirla abre la puerta a adivinarlos.)

Una sola conexión para todo: un solo saludo. [[grpc|gRPC]], un sistema creado por Google para que un programa llame funciones de otro por la red, que verás en la lección siguiente, viaja sobre HTTP/2. Triton lo atiende en su puerto 8001; HTTP/1.1 en el 8000.

gRPC usa HTTP/2 a su manera. La respuesta HTTP casi siempre es un 200, aunque la llamada falle: el resultado real viaja en un header que llega **al final** del stream (un *trailer*), `grpc-status`, con códigos propios de gRPC, como `UNAVAILABLE` (el parecido al 503) o `DEADLINE_EXCEEDED` (el parecido al 504). Y el tiempo máximo de la llamada viaja en otro header, `grpc-timeout`, para que el servidor sepa cuánto le queda a quien espera. Si mides errores mirando solo el código HTTP, un servicio de gRPC siempre se ve sano.

### La trampa: se balancean conexiones, no requests

Un [[service-k8s|Service de Kubernetes]], el nombre fijo con el que los pods del gateway encuentran a los de Triton, reparte **conexiones** nuevas entre los pods de atrás; no mira las requests que van adentro. Con HTTP/2, cada gateway abre una conexión, le toca un Triton y le manda todo por ahí durante horas.

:::diagrama http-conexiones
Los mismos gateways y los mismos Triton, con un pool de HTTP/1.1 y con una conexión de HTTP/2. Recorre el tercer camino: el Triton que acaba de llegar no recibe nada.
:::

La consecuencia: llega un Triton nuevo porque subió el tráfico y se queda casi sin trabajo, mientras los viejos siguen saturados. Con HTTP/1.1 y keep-alive el efecto existe, pero es menor, porque el pool abre varias conexiones y las va renovando. Las salidas: un intermediario que reparta por request, como un [[service-mesh|service mesh]] (una red de proxies, uno junto a cada pod); un tiempo de vida máximo para cada conexión, que obliga a reconectar; o que el cliente conozca todos los pods y reparta él mismo. La lección de balanceadores las abre.

### HTTP/2 todavía depende de TCP

En la lección anterior viste el **bloqueo por cabeza de fila** (*head-of-line blocking*): TCP entrega en orden, así que si se pierde un paquete, todo lo que venía detrás espera su reenvío. Con HTTP/2 duele más, porque lo que espera detrás es de otros streams: con 30 streams en una conexión, un paquete perdido frena a los 30. En una red con pérdidas, como un celular en movimiento, se nota.

**HTTP/3**, estandarizado en 2022, es HTTP sobre **QUIC**, el protocolo que también viste allá: va sobre [[udp|UDP]] (paquetes sueltos, sin orden ni reenvíos) y hace él mismo el trabajo de TCP, pero por stream, así que un paquete perdido solo frena a su stream. Junta el saludo de la conexión y el de TLS 1.3 en un solo RTT, y al reconectarse con un servidor conocido puede mandar la request desde el primer mensaje. Lo usan sobre todo los navegadores y las [[cdn|CDN]], las redes de servidores cerca de los usuarios. Entre servicios de un mismo centro de datos, donde casi no se pierden paquetes, siguen mandando HTTP/1.1 y HTTP/2.

| Versión | Año | Formato | Requests por conexión | Va sobre |
|---|---|---|---|---|
| HTTP/1.1 | 1997 | Texto | Una a la vez | TCP |
| HTTP/2 | 2015 | Binario, en frames | Muchas, intercaladas | TCP |
| HTTP/3 | 2022 | Binario, en frames | Muchas, independientes | QUIC, sobre UDP |

## Errores comunes {Common mistakes}

### 1. Reintentar un 4xx

Un 400, un 413 o un 415 van a fallar igual la segunda vez: la foto sigue siendo un PDF. Reintentarlos solo agrega carga.

**Cómo evitarlo:** reintentar solo lo que puede cambiar: 503 y 429 (respetando `Retry-After`) y, con cuidado, 502 y 504. Nunca un 400, 413 o 415.

### 2. Un código que miente

Responder 503 cuando el cliente se pasó de su cuota esconde de quién es la culpa y dispara tu alarma de disponibilidad. Peor aún es un 200 que miente: un plan B que responde 200 sin que nadie lo cuente, o un servidor de modelo roto que devuelve basura con código 200. Los tableros se ven verdes y el modelo no está contestando.

**Cómo evitarlo:** 429 para la cuota, 503 para la saturación. Si respondes con un plan B, márcalo (un header o un campo del body) y cuéntalo en una métrica aparte.

### 3. Un cliente sin timeout

Si el servidor se cuelga, un cliente sin [[timeout]] se cuelga con él, con su conexión y su memoria. `requests` de Python no trae timeout por omisión.

**Cómo evitarlo:** pon siempre un timeout, y que sea menor que el de quien te llama: en Alba, el backend espera 300 ms, el gateway se da 250 y a Triton le da 150.

### 4. Leer el body sin tope

Un gateway que lee el body completo antes de revisarlo puede llenarse de memoria con una sola request de varios GB.

**Cómo evitarlo:** revisar `Content-Length` antes de leer (413 casi gratis) y, además, contar mientras se lee, porque un cliente puede mandar el body en pedazos o mentir en el header.

### 5. Un GET que cambia cosas

`GET /v1/borrar?id=7` es una mala idea: los navegadores, los proxies y los reintentos automáticos asumen que un GET no tiene efectos y lo repiten sin preguntar. Al revés, un POST que crea algo y se reintenta por un timeout puede crearlo dos veces.

**Cómo evitarlo:** GET solo para leer. Para un POST que se reintenta, una [[llave-idempotencia|llave de idempotencia]]: un header (`Idempotency-Key`) con el que el servidor reconoce una request repetida. Lo ves en «Timeouts, reintentos e idempotencia».

### 6. El de atrás cierra antes que el de adelante

Si el gateway cierra sus conexiones inactivas a los 5 segundos y el ALB las sigue usando hasta los 60, aparecen 502 sueltos que nadie entiende.

**Cómo evitarlo:** el idle timeout de cada pieza, mayor que el de la pieza que tiene enfrente: uvicorn con `--timeout-keep-alive 75` detrás de un ALB de 60 s.

## En la vida real {In real life} [extra]

### Alba: el contrato completo

El gateway de Alba tiene una sola ruta de trabajo, `POST /v1/classify?top_k=5`, que recibe los bytes de la foto y devuelve el top-k de categorías con su score y la `model_version`. Acepta JPEG, PNG y WebP de hasta 10 MB y 40 MP. Sus errores están escritos en los requisitos: 400 si no es una imagen, 413 si pesa demasiado, 415 si el tipo no está permitido, 503 con `Retry-After` si Triton no está disponible y 504 si se vence el tiempo de la inferencia. FastAPI pone el 422.

Cada código tiene un camino claro del otro lado. Los 4xx no se reintentan ni cuentan contra el SLO. Con un 503, un 504 o nada en 300 ms, el backend muestra el selector manual. Y la `model_version` de cada respuesta se guarda con la publicación: así se puede preguntar después qué modelo sugirió cada categoría.

Detrás, el gateway habla HTTP con Triton en el puerto 8000, con el protocolo de inferencia KServe v2 (una forma estándar de pedirle predicciones a un servidor de modelos, que verás en la lección siguiente). Triton también responde a `GET /v2/health/ready`: 200 si ya puede atender, para que Kubernetes le mande tráfico solo cuando está listo.

### Un LLM detrás de una API

Piensa en un servicio que sirve su propio LLM a varios equipos de una empresa: su gateway habla con los códigos de esta lección. Sin llave válida, 401. Un prompt que pasa el tope del equipo, 400, con un mensaje claro y nunca recortado en silencio. Sin cuota de tokens, 429 con `Retry-After`. Con las GPUs llenas, 503 con `Retry-After`: mejor eso que hacer esperar 8 segundos por la primera palabra. Si vLLM, el servidor del modelo, se cae o se traba, 502 o 504.

La respuesta llega en pedazos, con `Content-Type: text/event-stream`: un `data:` por cada fragmento de texto y un `data: [DONE]` al final. Sigue siendo HTTP; solo que el body se escribe poco a poco. Y su alerta de errores cuenta los 5xx y los streams cortados, pero no los 429 por cuota ni los 499 de quien se fue: no son fallas de la plataforma.

### Los servidores de modelos administrados

SageMaker AI, la plataforma de ML de AWS, te pide un contenedor que escuche en el puerto 8080 y atienda dos rutas: `POST /invocations` para la inferencia y `GET /ping` para la salud. Cada request puede traer hasta 6 MiB, y el contenedor tiene 60 s para responder (los topes de su documentación en 2026). Las fotos web de Alba, de hasta 10 MB, no entran tal cual: o el gateway las reduce antes, o el patrón cambia a uno asíncrono, con la foto en S3, el almacén de archivos de AWS, y un 202 que dice «ya la recibí».

### Cámaras que mandan eventos

En un sistema de video en tiempo real con varias cámaras, la computadora pequeña de cada centro de distribución, conectada a las cámaras (la «caja»), detecta un evento en una cámara y se lo manda a una API de la nube por HTTPS. La API revisa el token del sitio, lo anota y responde **202** sin esperar a que nadie lo verifique: «lo recibí». Si la caja no recibe respuesta y reintenta, el evento no se duplica, porque la API lo registra con su `event_id` y reconoce el repetido.

Las fotos y el clip del evento, en cambio, no pasan por esa API. Antes de mandar el evento, la caja le pide a la API, con un `POST` chiquito que responde 200, una **[[url-prefirmada|URL firmada]]** de S3 para cada archivo: una URL que trae escrito en su query un permiso para subir ese archivo, y nada más, durante 15 minutos. Después sube el archivo con un `PUT` directo a esa URL. Como el permiso ya viaja en la URL, esa request no lleva header `Authorization`. Al final manda el evento, con los nombres de los archivos ya subidos. Así los megabytes de video no cruzan la API ni su balanceador.

### Fuera de ML

- **Tu navegador.** Abrir una página de noticias son decenas de requests: el HTML, las imágenes, los estilos, los scripts. Con HTTP/2, casi todas van por una sola conexión.
- **El 404 que conoces.** Es este mismo código, con una página bonita en el body.
- **Un sitio que se mudó.** Si escribes `http://` y el sitio solo atiende `https://`, te contesta un 301 (algunos usan el 308, que es lo mismo pero obliga a repetir el mismo método) con `Location: https://…`, y el navegador te lleva solo.
- **`curl -v`.** El comando `curl` hace requests desde la terminal, y con `-v` imprime los headers que manda (con `>`) y los que recibe (con `<`). Es la forma más rápida de ver esta lección en vivo con cualquier API.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de body y conexiones se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Desarma esta URL: `https://api.tienda.mx/v2/buscar?q=tenis%20rojos&page=2`. ¿Qué viaja en la primera línea de la request y qué en el header `Host`? ¿A qué puerto se conecta?
- Esquema: `https`. Host: `api.tienda.mx`. Ruta: `/v2/buscar`. Query: `q=tenis%20rojos&page=2`, es decir, `q` = «tenis rojos» y `page` = 2.
- No trae puerto, así que se usa el de omisión de HTTPS: **443**.
- Primera línea: `GET /v2/buscar?q=tenis%20rojos&page=2 HTTP/1.1`. Header: `Host: api.tienda.mx`. El esquema y el puerto no se escriben: ya se usaron para abrir la conexión.
? [facil] Para cada acción, elige método y di si es seguro e idempotente: (a) ver el estado de un trabajo, (b) subir una foto para clasificarla, (c) reemplazar la configuración completa de un modelo, (d) cambiar solo el precio de una publicación, (e) borrar un trabajo.
- (a) **GET**: seguro e idempotente.
- (b) **POST**: ni seguro ni idempotente por definición del método, aunque clasificar no cambie nada en el servidor.
- (c) **PUT**: no es seguro, pero sí idempotente: mandar la misma configuración dos veces deja lo mismo.
- (d) **PATCH**: no es seguro y no se garantiza que sea idempotente.
- (e) **DELETE**: no es seguro, pero sí idempotente: después de uno o de dos, el trabajo está borrado.
? [facil] ¿Qué código responde el sistema de Alba, y de quién es la culpa? (a) Una foto de 14 MB. (b) Un GIF. (c) `top_k=50`. (d) Triton está caído. (e) Triton tarda 400 ms. (f) Un token vencido.
- (a) **413**, del cliente: pasa de 10 MB.
- (b) **415**, del cliente: solo JPEG, PNG y WebP.
- (c) **422**, del cliente: FastAPI rechaza el parámetro fuera de 1 a 20.
- (d) **503** con `Retry-After`, del servidor.
- (e) **504**, del servidor: el gateway corta a los 150 ms.
- (f) **401**, del cliente: lo responde el ALB, que verifica el token antes de que la request llegue al gateway.
- Los tres primeros y el último no se reintentan; los del medio sí, y el backend cae al selector manual.
? [facil] Una foto de 150,000 bytes va en base64 dentro de un JSON. ¿Cuántos bytes ocupa? ¿Y una de 9 MB, con el tope de 10 MB de Alba?
- Con la fórmula de base64: \( g = b/3 \) grupos y \( b_{64} = 4 × g \).
- \( b \) = 150,000: \( g \) = 150,000 ÷ 3 = 50,000 grupos; \( b_{64} \) = 4 × 50,000 = **200,000 bytes**, un tercio más.
- \( b \) = 9,000,000: \( b_{64} \) = 4 × 9,000,000 ÷ 3 = **12,000,000 bytes**: 12 MB. Pasa el tope: **413**. En bytes crudos, 9 MB sí entraban.
- La foto más grande que cabe en 10 MB como base64 sale de despejar \( b \): \( b = b_{64} × 3/4 \) = 10,000,000 × 3 ÷ 4 = **7.5 MB**.
? [medio] Escribe la request completa (primera línea, headers y body) para preguntar por el trabajo `7f3c` con el token `abc123`, y una respuesta de «todavía no termina». ¿Qué cambia si el trabajo no existe?
```text
GET /v1/jobs/7f3c HTTP/1.1
Host: ocr.internal
Authorization: Bearer abc123
Accept: application/json

```
- Sin body: un GET no lleva. Después de los headers va la línea en blanco, y ahí termina.
- La respuesta: `HTTP/1.1 200 OK`, `Content-Type: application/json`, su `Content-Length`, la línea en blanco y un body como `{"status": "running"}`. La request salió bien aunque el trabajo no haya terminado: el estado va en el body.
- Si el trabajo no existe: **404 Not Found**. Si existe pero es de otro cliente, también conviene un 404 y no un 403, para no confirmarle a nadie que ese trabajo existe.
? [medio] Un cliente hace 20 requests seguidas a un servidor con un RTT de 80 ms. Sin contar el tiempo del servidor, ¿cuánto tarda en total sin keep-alive y con keep-alive, con TLS 1.3 y con TLS 1.2?
- Con las fórmulas de la conexión y \( w \) = 0: \( t_{nueva} = (1 + k + 1) × RTT \) y \( t_{abierta} = RTT \). Con \( m \) = 20 requests, sin keep-alive el total es \( m × t_{nueva} \); con keep-alive, \( t_{nueva} + (m − 1) × t_{abierta} \).
- Sin keep-alive, cada request paga todo. Con TLS 1.3 (\( k \) = 1): \( t_{nueva} \) = (1 + 1 + 1) × 80 = 240 ms; × 20 = **4,800 ms**. Con TLS 1.2 (\( k \) = 2): (1 + 2 + 1) × 80 = 320 ms; × 20 = **6,400 ms**.
- Con keep-alive, solo la primera paga los saludos. TLS 1.3: 240 + 19 × 80 = **1,760 ms**. TLS 1.2: 320 + 19 × 80 = **1,840 ms**.
- Se ahorra ≈ 63 % con TLS 1.3 y ≈ 71 % con TLS 1.2. Con keep-alive, la versión de TLS casi deja de importar.
? [medio] En un día más tranquilo de lo normal, el gateway de Alba recibe 8,000,000 requests: 120,000 con 4xx, 9,000 con 5xx y 2,000 lentas (de más de 300 ms, sin error). ¿Cuál es el SLI? ¿Cumple el SLO de 99.9 %? ¿Y si alguien contara los 4xx como fallas?
- Con la fórmula del SLI: \( V = N − E \) y \( SLI = (V − F)/V \).
- Válidas: \( V \) = 8,000,000 − 120,000 = 7,880,000.
- Malas: \( F \) = 9,000 + 2,000 = 11,000.
- SLI: (7,880,000 − 11,000) ÷ 7,880,000 ≈ **99.86 %**. **No cumple**: el presupuesto del día era 0.1 % de 7,880,000 = 7,880 requests, y se gastaron 11,000.
- Con los 4xx como fallas: \( (N − E − F)/N \) = (8,000,000 − 131,000) ÷ 8,000,000 ≈ **98.36 %**. Se vería peor de lo que es, y se perdería la pista de que el problema son los 5xx.
? [reto] Un equipo quiere llamar directo a un endpoint de SageMaker AI, que acepta hasta 6 MiB por request, con las fotos web de Alba en JSON con base64. (a) ¿Cuál es la foto más grande que cabe? (b) ¿Y en bytes crudos? (c) ¿Qué propones para las fotos de hasta 10 MB?
- (a) Con \( b = b_{64} × 3/4 \) y \( b_{64} \) = 6 MiB = 6,291,456 bytes, caben \( b \) = 6,291,456 × 3 ÷ 4 = **4,718,592 bytes**, ≈ 4.7 MB, y un poco menos por el resto del JSON.
- (b) En bytes crudos, casi los 6,291,456: ≈ **6.3 MB**. Cualquier foto entre 6.3 y 10 MB no entra de ninguna forma.
- (c) Dos salidas: que el gateway reduzca la foto antes de llamar (a 1024 px, como el celular, pesa ≈ 200 KB), o cambiar al patrón asíncrono: la foto se sube a S3, la request solo lleva su dirección y la respuesta es un **202** con un `job_id`.
? [reto] Los 502 aparecen de a poquito: 1 o 2 por cada 100,000 requests, sin relación con el tráfico. Los logs del gateway no muestran ningún error. El ALB cierra conexiones inactivas a los 60 s y uvicorn corre con su valor por omisión, 5 s. Explica qué pasa, por qué el gateway no lo ve y cómo lo arreglas.
- El ALB guarda conexiones abiertas hacia cada pod del gateway. Uvicorn cierra las que llevan 5 s sin uso; el ALB las seguiría usando hasta los 60 s.
- A veces el ALB elige una conexión justo cuando uvicorn la está cerrando. La request llega a una conexión muerta; el ALB no recibe respuesta y contesta **502**.
- El gateway no lo ve porque, para él, esa request nunca llegó: no hay línea de log ni métrica. Solo el ALB la cuenta. Por eso es raro y no depende del tráfico: depende de cuándo coincide una request con un cierre.
- Arreglo: que el de atrás espere más que el de adelante. `--timeout-keep-alive 75` en uvicorn, mayor que los 60 s del ALB: así siempre cierra primero el ALB, que sabe que cerró y no reusa esa conexión.
:::

## Lo que sigue {What comes next}

«APIs: REST, JSON, gRPC y streaming» diseña la API que va encima de HTTP. «Balanceadores, proxies y gateways» abre las piezas que responden 502, 503 y 429 por su cuenta. «Timeouts, reintentos e idempotencia» decide qué hacer con cada código. Y «Qué tan rápido y cuánto: latencia y throughput» mide lo que cuesta cada viaje.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
http url metodo-http header body codigo-estado https keep-alive pool-conexiones http2 cookie
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuáles son las cuatro partes de una request de HTTP, en orden?
La línea de la petición (método, ruta con query y versión), los headers, una línea en blanco y el body. La respuesta tiene la misma forma, con la línea de estado en vez de la de la petición.
? ¿Cómo sabe el servidor dónde terminan los headers y dónde termina el body?
Los headers terminan en la línea en blanco, `\r\n\r\n`. El body termina cuando se leyeron los bytes que dice `Content-Length` (o, con `chunked`, cuando llega un pedazo de tamaño 0).
? ¿Qué significa que un método sea idempotente? ¿DELETE lo es?
Que hacerlo dos veces deja al servidor igual que hacerlo una. DELETE sí: el segundo puede responder 404, pero el resultado es el mismo, el recurso borrado. POST no.
? ¿Qué familia de códigos se reintenta y cuál no? ¿Por qué?
Los 4xx no: la request está mal y fallaría igual. Algunos 5xx sí (503, 502, 504, con cuidado), y también el 429 aunque sea un 4xx, siempre después de `Retry-After`.
? ¿En qué se diferencian un 429 y un 503?
El 429 dice «te pasaste de tu cuota»: la culpa es del cliente. El 503 dice «estoy saturado o me falta algo»: la culpa es del servidor. Mezclarlos ensucia la alarma de disponibilidad.
? ¿Qué ahorra keep-alive y por qué hace falta un pool?
Ahorra el handshake de TCP y el de TLS en cada request: 2 o 3 RTT. En HTTP/1.1 cada conexión lleva una request a la vez, así que para varias al mismo tiempo hace falta un pool de conexiones abiertas.
:::
