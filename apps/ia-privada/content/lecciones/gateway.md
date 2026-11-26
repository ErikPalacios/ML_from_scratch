---
titulo: Gateway, API compatible con OpenAI, autenticación y varios modelos
en: Gateway, OpenAI-compatible API, authentication and multiple models
subtitulo: Qué se pone delante de los servidores de modelos para que cada persona entre con su cuenta, nadie se coma la GPU de todos, haya varios modelos detrás y quede registro de quién preguntó qué, sin que el registro mismo se vuelva un riesgo.
pregunta: vLLM ya corre en las 3 L40S. ¿Qué se pone delante para que 200 abogados (y las apps que vengan) entren con su cuenta del despacho, no se coma uno la GPU de todos, haya varios modelos detrás y quede registro de quién preguntó qué?
sensei: apis, balanceo, identidad, privacidad, fallas-red
---

:::idea
Un servidor de modelos sabe generar tokens, pero no sabe **quién** pide, **cuánto** le toca ni **a dónde** mandar cada pregunta. Eso lo hace un [[gateway-de-llm|gateway de LLMs]]: una sola puerta que habla la [[api-compatible-openai|API compatible con OpenAI]] por los dos lados, deja entrar a las personas con su cuenta de la organización ([[sso|SSO]]) y a las apps con su [[clave-de-api|clave]], les cobra **tokens** (no peticiones) de una [[cuota-de-tokens|cuota]] calculada con lo que de verdad da el servidor, reparte entre modelos y copias, y anota una fila por pregunta sin guardar el texto.
:::

## Lo que falta delante de vLLM {What is missing in front of vLLM}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus 30,000 expedientes con un LLM sin que un solo documento salga de su red. Lo usarían **200 personas**, cada una ≈ 15 preguntas al día en un horario de 10 horas, con una hora pico de 2.5 veces el promedio. Cada pregunta lleva ≈ 6,000 tokens de entrada (instrucciones, la pregunta y cinco fragmentos de expediente) y la respuesta ≈ 500. El modelo es **Qwen3 32B en INT4 de [[awq|AWQ]]**, servido con [[vllm|vLLM]] en **3 GPUs L40S**, una copia del modelo en cada una. Su equipo de TI son 2 personas que saben de redes y de Windows. Y el despacho ya usa cuentas de Microsoft para el correo.

Supón que vLLM ya arrancó en las tres GPUs. Cada una contesta en su puerto `8000`. ¿Qué pasa si el TI le da a cada abogado la dirección de una de ellas?

- **Nadie sabe quién preguntó.** vLLM acepta una sola llave compartida (`--api-key`) o ninguna. Si un expediente aparece donde no debía, no hay forma de saber quién lo pegó.
- **Uno se come la GPU de todos.** Un asociado con un script que manda la misma pregunta en un ciclo llena las conversaciones de una L40S; a los demás les toca fila.
- **Hay que elegir a mano.** Cada persona apunta a una de las tres. Si esa se reinicia, se queda sin servicio aunque las otras dos estén libres.
- **No hay un solo lugar para cambiar algo.** Si mañana se agrega un modelo chico para tareas rápidas, o uno de embeddings para buscar, hay que avisarle a cada app la dirección nueva.

Lo que falta es una **puerta**. Antes de construirla, tres cosas que Sensei explica a fondo y aquí solo se recuerdan:

- Una API es un contrato entre dos programas: rutas, JSON y códigos de estado. Casi todos los motores de LLMs copian la de OpenAI, y la respuesta puede llegar por pedazos con *server-sent events*. Lo ves en [APIs: REST, JSON, gRPC y streaming](https://sensei.trueml.app/apis/).
- Un proxy inverso recibe las peticiones y las reenvía; un *API gateway* además autentica, limita con un *token bucket* (429 y `Retry-After` cuando se rebasa) y rutea. Lo ves en [Balanceadores, proxies y gateways](https://sensei.trueml.app/balanceo/).
- Autenticar es saber quién eres; autorizar, qué puedes hacer. Las máquinas usan llaves y tokens *Bearer*; las personas, un proveedor de identidad con OIDC. Lo ves en [Autenticación y permisos](https://sensei.trueml.app/identidad/).

Lo nuevo aquí es lo que cambia cuando lo que hay detrás es un LLM: cada petición cuesta distinto, tarda segundos, llega por pedazos y lleva adentro secretos de clientes.

:::diagrama gateway-camino
El camino de una pregunta del despacho. Toca cada caja para ver por qué está ahí, o sigue el recorrido paso a paso: entrar con la cuenta de Microsoft, preguntar, pasar la puerta, elegir una de las tres copias, recibir el stream y dejar la fila del registro.
:::

## La API compatible con OpenAI, de verdad {The OpenAI-compatible API, for real}

Todo en el diagrama habla el mismo idioma: Open WebUI (la página de chat que usan los abogados, la ves a fondo más abajo) le habla al gateway como si el gateway fuera OpenAI, y el gateway le habla a cada [[vllm|vLLM]] igual. Ese idioma es la [[api-compatible-openai|API compatible con OpenAI]]: un conjunto de rutas HTTP con un JSON conocido. Las que importan son cuatro:

| Ruta | Para qué | En el despacho |
|---|---|---|
| `POST /v1/chat/completions` | Mandar una conversación y recibir el siguiente mensaje | Cada pregunta a los expedientes |
| `POST /v1/completions` | Mandar texto suelto y recibir su continuación (la forma vieja, sin roles) | Casi nunca |
| `GET /v1/models` | Listar los modelos que hay | Open WebUI la llama para llenar su menú |
| `POST /v1/embeddings` | Convertir textos en vectores | La búsqueda de fragmentos (la lección de RAG) |

Por qué todos la imitan: hay miles de programas, bibliotecas y SDKs que ya saben hablar con OpenAI. Si tu servidor habla igual, cualquiera de ellos le habla **cambiando una sola cosa**: la dirección base (`base_url`). A noviembre de 2026, vLLM 0.34.0, llama-server (el servidor de [[llama-cpp|llama.cpp]]) y [[ollama|Ollama]] sirven las cuatro rutas; cómo se elige entre esos motores lo ves en [Del laptop al servidor](/stack-serving/).

### El request por dentro

La ruta del chat se llama [[chat-completions|Chat Completions]]. Su request es un JSON con el modelo y la conversación como una lista de mensajes, cada uno con su rol:

```bash
curl http://gateway.despacho.local/v1/chat/completions \
  -H "Authorization: Bearer $CLAVE_DE_LA_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chat-grande",
    "messages": [
      {"role": "system", "content": "Eres el asistente del despacho. Responde solo con lo que digan los fragmentos y cita expediente y página."},
      {"role": "user", "content": "Fragmentos: [...] Pregunta: ¿el contrato del expediente 4127 permite ceder los derechos?"}
    ],
    "max_tokens": 500,
    "temperature": 0.2,
    "stream": false
  }'
```

(Ilustrativo: la dirección, la clave y el texto son del ejemplo.) Campo por campo:

- `model` es un **nombre**, no un archivo. Aquí `chat-grande` es el nombre que el gateway publica; detrás puede haber tres copias de Qwen3 32B o mañana otro modelo. La app no se entera.
- `messages` es toda la conversación hasta ahora. El servidor no recuerda nada entre requests: en la repregunta, la app manda otra vez todo lo anterior. Por eso una repregunta del despacho pesa ≈ 6,500 tokens de entrada antes de escribir una palabra nueva.
- `max_tokens` es el tope de la respuesta. OpenAI lo marca como deprecado a favor de `max_completion_tokens`; los motores abiertos siguen aceptando `max_tokens`. Para el gateway es más que un tope: es lo que usa para **reservar** tokens antes de saber cuántos se gastarán (lo ves en la sección de cuotas).
- `Authorization: Bearer …` es donde viaja la clave. La documentación de OpenAI insiste en que nunca vaya en código de un navegador o de una app instalada: va en el servidor, en una variable de entorno o en un gestor de secretos.

### La respuesta por dentro

```json
{
  "id": "chatcmpl-7",
  "object": "chat.completion",
  "model": "chat-grande",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "Sí, con condiciones: la cláusula 14 (expediente 4127, p. 12) ..."},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 6012, "completion_tokens": 480, "total_tokens": 6492}
}
```

(Ilustrativo.) Dos campos le importan al gateway más que al usuario:

- **`usage`** dice cuántos tokens leyó (`prompt_tokens`) y cuántos escribió (`completion_tokens`). Es **la factura** de la pregunta: con esto se cobra la cuota y se escribe el registro.
- **`finish_reason`** dice por qué paró: `stop` si terminó solo, `length` si se topó con `max_tokens`. Un `length` frecuente avisa que el tope está bajo o que el modelo se enreda.

`/v1/models` (una lista con un `id` por modelo) y `/v1/embeddings` (un vector por texto, también con su `usage`) siguen la misma idea.

## Streaming con SSE: la respuesta por pedazos {Streaming with SSE: the answer in pieces}

Una respuesta del despacho tarda ≈ 27 s: ≈ 2 s hasta el primer token (el [[ttft|TTFT]]) y ≈ 25 s escribiendo 500 tokens a 20 por segundo. Nadie espera 27 s viendo una pantalla en blanco. Con `"stream": true`, el servidor manda cada pedazo en cuanto lo tiene, sobre la misma conexión: eso es el [[streaming-sse|streaming con SSE]]. Sensei ya explica el formato y cómo se lee por pedazos ([APIs](https://sensei.trueml.app/apis/)); aquí va lo que cambia cuando hay un gateway en medio.

:::figura gateway-sse
Lo que viaja por el cable en una respuesta en streaming: ≈ 2.4 s de nada mientras el servidor lee la entrada, después un evento por pedazo, el pedazo con `usage` si se pidió, y `data: [DONE]`. Abajo, lo que pasa si algo en medio junta los pedazos.
:::

Cada pedazo es un objeto `chat.completion.chunk`. Todos traen el mismo `id`; en vez de `message` traen `delta`, con solo el texto nuevo. El último con texto trae el `finish_reason`. Y un detalle que importa para cobrar: **`usage` no viene en el stream a menos que se pida** con `"stream_options": {"include_usage": true}`; entonces llega un pedazo extra al final, con `choices` vacío y los tokens. Al final va la línea `data: [DONE]`: la referencia de OpenAI dice que el pedazo de `usage` llega «antes del mensaje `data: [DONE]`», y [[vllm|vLLM]] 0.34.0 la manda igual.

:::profundo Un stream, leído por un programa
Esto es lo que hace un gateway con cada pedazo: reenviarlo y, al final, quedarse con la factura. (Sensei enseña a leer SSE en general; aquí importa dónde llega la factura.)

```python
import json

# Lo que llega por el cable con "stream": true y "stream_options": {"include_usage": true}
# (forma de la API; los textos y números son de ejemplo)
cable = """data: {"id":"chatcmpl-7","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl-7","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"La cláusula 14"},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl-7","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" prohíbe ceder"},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl-7","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" el contrato."},"finish_reason":"stop"}],"usage":null}

data: {"id":"chatcmpl-7","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":6012,"completion_tokens":9,"total_tokens":6021}}

data: [DONE]

"""

texto, usage, fin = "", None, None
for evento in cable.split("\n\n"):           # una línea en blanco cierra cada evento
    if not evento.startswith("data: "):
        continue
    dato = evento[len("data: "):]
    if dato == "[DONE]":                       # el motor avisa que ya terminó
        break
    chunk = json.loads(dato)
    for c in chunk["choices"]:
        texto += c["delta"].get("content", "")
        fin = c["finish_reason"] or fin
    if chunk["usage"]:                         # solo el último chunk lo trae
        usage = chunk["usage"]

print("texto:", texto)
print("finish_reason:", fin)
print("tokens que cobra el gateway:", usage["total_tokens"],
      f"(entrada {usage['prompt_tokens']}, salida {usage['completion_tokens']})")
```

```salida
texto: La cláusula 14 prohíbe ceder el contrato.
finish_reason: stop
tokens que cobra el gateway: 6021 (entrada 6012, salida 9)
```
:::

Fíjate en el orden: el texto se puede mostrar desde el primer pedazo, pero los tokens se saben **hasta el final**. Si el cliente no pidió `include_usage`, el gateway tiene que pedirlo él por su cuenta o contar los tokens él mismo. Los gateways serios lo hacen; vale la pena comprobarlo con la versión que instales.

### Lo que rompe un stream: los intermediarios

Entre la abogada y la GPU puede haber varios programas: Open WebUI, el gateway, un proxy nginx que pone el candado HTTPS, quizá un balanceador o el proxy del antivirus corporativo. Cualquiera de ellos puede arruinar el stream de dos formas.

**Juntar pedazos (*buffering*).** Muchos proxies guardan la respuesta y la reenvían en bloques grandes, porque para páginas web es más eficiente. Con un LLM, la persona ve 27 s de nada y luego todo de golpe. En nginx, `proxy_buffering` está **prendido** por omisión; la documentación dice que con `off` la respuesta pasa al cliente «en cuanto se recibe». También se puede apagar por respuesta con el encabezado `X-Accel-Buffering: no`.

**Cortar por silencio.** Un proxy cierra una conexión que no manda nada en cierto tiempo. En nginx, `proxy_read_timeout` vale **60 s** por omisión, y se mide entre dos lecturas, no para la respuesta completa. Un stream que manda un token cada 50 ms nunca se corta. El peligro está **antes del primer token**: con la cola de la hora pico, el primer token puede tardar varios segundos, y con preguntas más largas o un servidor saturado, más. Un `timeout` demasiado corto en cualquier pieza mata respuestas legítimas.

```nginx
# Ilustrativo: nginx delante del gateway, solo para SSE
location /v1/ {
    proxy_pass http://litellm:4000;   # el gateway (LiteLLM, más abajo)
    proxy_buffering off;          # cada pedazo sale en cuanto llega
    proxy_read_timeout 300s;      # silencio máximo entre lecturas
}
```

:::ojo
Prueba el stream **de punta a punta**, desde el navegador de una abogada, no desde la consola del servidor. Lo que funciona con `curl` contra vLLM puede llegar juntado al final si en medio hay un proxy que nadie revisó.
:::

## Compatible no es idéntico {Compatible is not identical} [extra]

Que todos hablen la «misma» API no quiere decir que hagan lo mismo. Lo que cambia entre motores, a noviembre de 2026, y que el gateway tiene que conocer:

- **Parámetros extra.** [[vllm|vLLM]] acepta parámetros que OpenAI no tiene, como `top_k`; con el SDK de OpenAI van dentro de `extra_body`. El del despacho es `chat_template_kwargs`: está en el esquema del request de vLLM y se pasa a la plantilla del modelo. Ahí viaja el `enable_thinking: false` que apaga el razonamiento de Qwen3; la documentación de vLLM 0.34.0 lo dice así para la serie Qwen3 (la lección [Elegir un modelo](/elegir-modelo/) explica por qué el despacho lo apaga). Si el gateway o Open WebUI no lo reenvían, el modelo piensa por omisión y gasta tokens y segundos antes de cada respuesta. Más seguro: arrancar vLLM con `--default-chat-template-kwargs '{"enable_thinking": false}'`, que lo apaga para todas las requests que no digan otra cosa.
- **Valores por omisión distintos.** vLLM aplica por omisión el `generation_config.json` que publica quien hizo el modelo (temperatura y otros), y se apaga con `--generation-config vllm`. Dos servidores «iguales» pueden contestar distinto a la misma pregunta.
- **Campos ignorados.** vLLM ignora el campo `user` del chat y no soporta `suffix` en `/v1/completions`. Quien quiera saber qué persona pidió no puede confiar en `user`: lo resuelve el gateway.
- **Una API nueva.** OpenAI dice, en su guía de migración consultada el 26 de noviembre de 2026, que Chat Completions «sigue soportada» pero recomienda su **Responses API** para proyectos nuevos; su stream usa eventos con nombre (`response.output_text.delta`, `response.completed`) en vez de `[DONE]`. vLLM, llama-server y [[ollama|Ollama]] ya sirven una ruta `/v1/responses`. Para el despacho, Chat Completions es el denominador común: todo lo que usa la entiende.
- **La llave de juguete.** Ollama, en tu computadora, pide una `api_key` que **ignora**: su propia documentación la marca como obligatoria pero no revisada. llama-server sí revisa su `--api-key`, pero deja `/health` público. «Compatible con OpenAI» no quiere decir «autenticado».

## Qué es un gateway de LLMs, y por qué la llave de vLLM no basta {What an LLM gateway is, and why vLLM's key is not enough}

Un [[gateway-de-llm|gateway de LLMs]] es un servidor que **no corre ningún modelo**: recibe requests en la API compatible con OpenAI, decide qué hacer con cada una y la reenvía a un servidor de modelos que habla la misma API. Hace cinco trabajos:

:::pasos
1. Saber quién pide
Personas por SSO (a través de la interfaz de chat) y apps por [[clave-de-api|clave]]. Sin esto, todo lo demás es imposible.
2. Decidir qué puede usar
Qué modelos le tocan a cada quien: el grande para todos, uno experimental solo para TI.
3. Repartir la capacidad
[[limite-de-tasa|Límites]] y [[cuota-de-tokens|cuotas]] en tokens, para que nadie se coma la GPU de todos.
4. Mandar cada request a su lugar
El [[enrutamiento-de-modelos|enrutamiento]] entre modelos y entre las copias de cada uno, con reintentos y [[fallback]].
5. Dejar constancia
Una fila del [[registro-de-auditoria|registro]] por request: quién, cuándo, qué modelo, cuántos tokens.
:::

:::analogia La recepción de un edificio
El gateway es la recepción de un edificio de oficinas. Revisa tu gafete (quién eres), te dice a qué piso subir (qué modelo y qué copia), anota en la bitácora la hora y a quién visitaste, y si ya entraste diez veces hoy te pide que esperes. Nadie sube directo por el estacionamiento: todas las puertas laterales están cerradas.

**Dónde se rompe:** la recepción sabe cuánto va a ocupar tu visita antes de dejarte subir. El gateway no: una pregunta puede generar 30 tokens o 1,500, y la factura (`usage`) llega cuando la respuesta termina. Por eso el gateway reserva antes, con el tope de la respuesta, y corrige después. Y otra: la bitácora de una recepción guarda tu nombre, no lo que hablaste. Si la del gateway guarda las preguntas, se vuelve la copia más jugosa de los secretos del despacho.
:::

### El `--api-key` de vLLM: una llave, y puertas laterales

[[vllm|vLLM]] tiene una opción `--api-key`. ¿Por qué no basta? Primero, porque es **una sola** llave para todos: no dice quién pidió ni separa cuotas. Segundo, porque no cubre todo. La documentación de seguridad de vLLM 0.34.0 lo dice en una advertencia explícita: la llave solo protege las rutas que empiezan con `/v1`, `/v2`, `/inference` y `/cohere`, y otras rutas del mismo servidor **no** se autentican, entre ellas `/invocations`, que da la misma inferencia que `/v1`. En la lista de rutas sin llave también están `/metrics`, `/health`, `/tokenize`, `/score`, `/rerank` y las de control (`/pause`, `/abort_requests`…). La propia documentación cierra: no confíes solo en `--api-key` para proteger vLLM.

Lo que recomienda vLLM es exactamente un gateway: ponerlo detrás de un proxy inverso que deje pasar **solo** las rutas que quieres exponer, bloquee todas las demás, y agregue autenticación, límites y registro. Para el despacho, eso son dos reglas de red y una pieza de software:

- **Los puertos de vLLM no se alcanzan desde la red de oficina.** Solo el gateway llega a ellos (con un firewall o una red interna entre las máquinas). Así, aunque alguien conozca la dirección de una L40S, no hay camino.
- **El gateway solo expone las rutas `/v1` que se usan.** Ni `/metrics` ni `/health` del motor quedan al alcance de una laptop cualquiera; el monitoreo los lee por su lado.
- **Una pieza que sepa de personas, tokens y modelos.** nginx solo no basta: pone el candado HTTPS, filtra rutas y limita requests por dirección IP, pero no cuenta tokens ni conoce personas. Hace falta un gateway de LLMs.

Una opción que no pide Kubernetes (el sistema que reparte contenedores en un grupo de máquinas) es **LiteLLM proxy** (a noviembre de 2026, versión 1.111.0, del 25 de noviembre): un programa en Python, de Berri AI, que escucha por omisión en el puerto `4000` y guarda claves, presupuestos y registro en una base de datos PostgreSQL. Es el que usa el despacho en esta lección. Sus alternativas y licencias están en la sección «Las piezas, con su licencia».

## Personas: SSO con Microsoft Entra ID y OIDC {People: SSO with Microsoft Entra ID and OIDC}

Los 200 abogados no deberían tener otra contraseña. Ya tienen una cuenta de Microsoft para el correo. El [[sso|SSO]] (*single sign-on*, inicio de sesión único) es que la interfaz de chat les pregunte a Microsoft quiénes son y les crea. Sensei explica [[oidc|OIDC]] por dentro: el ID token, sus *claims*, la firma y las claves públicas ([Autenticación y permisos](https://sensei.trueml.app/identidad/)). Aquí va lo específico de hacerlo con Microsoft.

### Quién hace qué

- **Microsoft [[entra-id|Entra ID]]** (antes Azure AD) es el directorio de cuentas del despacho en la nube de Microsoft. Cada organización tiene su *tenant*. Entra hace OIDC: comprueba contraseña y segundo factor y entrega ID tokens firmados.
- **Open WebUI** es la interfaz de chat que usan los abogados (versión 0.13.5, del 25 de noviembre de 2026). Es la que recibe el ID token. Se conecta a cualquier servidor con la API compatible con OpenAI: en el despacho, a LiteLLM.
- **LiteLLM** no ve a los abogados directamente: ve a Open WebUI, que entra con su propia clave y le dice qué persona pide (lo ves en la siguiente sección).

:::profundo El SSO de LiteLLM es otro
LiteLLM también ofrece SSO, pero el suyo es para entrar a **su panel de administración**, no para los usuarios del chat. Desde su versión 1.76.0 es gratis hasta 5 personas (y lo sigue siendo a noviembre de 2026); las 2 de TI caben de sobra.
:::

### Registrar la app en Entra

TI registra Open WebUI en el tenant del despacho y obtiene tres cosas: el Id de la app (*client id*), un secreto y el Id del tenant. Además registra la dirección a la que Entra regresa a la persona después de entrar: `<dirección de Open WebUI>/oauth/microsoft/callback`. Usar el Id del tenant, y no los valores genéricos `common` u `organizations` (que aceptan cuentas de cualquier organización), es lo que hace que **solo** las cuentas del despacho puedan entrar. En Open WebUI, todo eso se pone en variables de entorno, con dos trampas en los valores por omisión que se ven abajo.

:::profundo El documento de descubrimiento y las variables de Open WebUI
Todo lo demás que una app necesita saber de Entra (dónde mandar a la persona, dónde canjear el código, dónde están las claves para verificar la firma) está en un documento público, el de descubrimiento:

```
https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration
```

con el Id del tenant del despacho en `{tenant}`. Con el proveedor de Microsoft, Open WebUI no te pide esa dirección (la arma con el tenant); con un proveedor OIDC genérico sí, en `OPENID_PROVIDER_URL`.

Ilustrativo, con los nombres de su documentación a noviembre de 2026:

```bash
MICROSOFT_CLIENT_ID=...            # el Id de la app en Entra
MICROSOFT_CLIENT_SECRET=...        # el secreto (de un gestor de secretos, no del repositorio)
MICROSOFT_CLIENT_TENANT_ID=...     # el tenant del despacho
ENABLE_OAUTH_SIGNUP=true           # que la primera vez se cree la cuenta sola (por omisión, false)
ENABLE_OAUTH_ROLE_MANAGEMENT=true  # los roles vienen del token
OAUTH_ROLES_CLAIM=roles
OAUTH_ALLOWED_ROLES=user,admin
OAUTH_ADMIN_ROLES=admin
ENABLE_PASSWORD_AUTH=false         # cuando ya funcione el SSO: sin contraseñas locales
OPENAI_API_BASE_URL=http://litellm:4000/v1
OPENAI_API_KEY=...                 # la clave de servicio de Open WebUI ante LiteLLM
```

Dos trampas de los valores por omisión: sin `ENABLE_OAUTH_SIGNUP`, nadie puede crear su cuenta con SSO; y una cuenta nueva queda como `pending` (`DEFAULT_USER_ROLE`) hasta que un administrador la apruebe, salvo que los roles vengan del token. Open WebUI tiene además una limitación documentada: con Microsoft, un solo tenant, que es justo el caso del despacho.
:::

### Qué usar del token para saber quién es

El ID token de Entra trae varios campos que parecen identificar a la persona. Solo dos sirven:

| Claim | Qué es | ¿Sirve como identidad? |
|---|---|---|
| `oid` | El identificador de la persona en el tenant; no cambia y es el mismo en todas las apps | **Sí**, con `tid` (el tenant) |
| `sub` | Un identificador de la persona **para esta app** (otra app ve otro) | Sí, dentro de esta app |
| `email` | El correo | **No**: Microsoft dice que puede no ser correcto y cambiar; nunca para autorizar |
| `preferred_username` | El nombre de usuario | No: puede cambiar |
| `roles` | Los [[rol-de-aplicacion\|roles de aplicación]] asignados | Para permisos, sí |

Por eso Open WebUI trae apagada la opción de juntar cuentas por correo (`OAUTH_MERGE_ACCOUNTS_BY_EMAIL`), y su documentación la llama insegura: si un proveedor no verifica los correos, alguien podría tomar la cuenta de otro.

Para los permisos, usa **[[rol-de-aplicacion|roles de aplicación]]** (`user`, `admin`) definidos en el registro de la app, y no los grupos de Entra: el porqué, abajo.

:::profundo Roles, no grupos: por qué no autorizar con los grupos de Entra
Lo natural sería decir «el grupo *Litigio* puede usar el modelo grande». Entra puede mandar los grupos de la persona en el token (`groups`), pero con tres problemas:

1. **Llegan como identificadores largos**, no como nombres: la app tiene que saber que `3f9c…` es *Litigio*.
2. **Hay un límite.** Si la persona está en más de **200 grupos** (en un JWT, el formato del ID token), el token ya no trae `groups`: trae una marca de «excedido» y la app tiene que preguntarle a Microsoft Graph (la API de Microsoft para leer el directorio). Microsoft lo dice claro: la app no debe confiar en el valor de esa marca, solo en que está. Una socia con muchos grupos podría quedarse sin acceso un lunes sin que nadie entienda por qué; y la documentación de Open WebUI no dice que haga esa consulta.
3. **Asignar grupos a una app exige licencia.** El SSO en sí viene en Entra ID Free, la edición incluida con Microsoft 365 (su página de precios, consultada el 26 de noviembre de 2026, le pone «SSO ilimitado»). Lo que no viene es asignar grupos: «Group-based assignment» requiere Entra ID P1 o P2, y un tenant gratis solo puede asignar personas una por una. Microsoft 365 Business Premium incluye P1: TI debe confirmar qué licencia tiene el despacho.

La salida que Microsoft recomienda son los **[[rol-de-aplicacion|roles de aplicación]]**: en el registro de la app se definen `user` y `admin`, se asignan a las personas (o, con P1, a grupos enteros), y el token trae `roles: ["user"]`. Sin límite de 200 y sin traducir identificadores. Open WebUI los lee con las variables de arriba.
:::


:::ojo
SSO no sustituye a la autorización dentro de la app. Que una persona pueda entrar al chat no quiere decir que pueda ver todos los expedientes: los permisos sobre los documentos los hace cumplir la búsqueda (la lección de RAG), no el login.
:::

## Apps: una clave por app, y la identidad que viaja {Apps: one key per app, and the identity that travels}

Las personas entran por Open WebUI. Pero el gateway no recibe el ID token de cada abogada: recibe requests de **Open WebUI**, que entra con su propia clave. Y mañana habrá otras apps sin personas: la que clasifica correos entrantes, un script de TI que resume expedientes por la noche. Cada una necesita su [[clave-de-api|clave de API]].

### Claves virtuales

En LiteLLM, la clave **maestra** (empieza con `sk-` y va en una variable de entorno) es la de administrar: con ella se crean las demás. Cada clave nueva es una **clave virtual**: vive en la base de LiteLLM y lleva sus propias reglas. Se crea con `POST /key/generate` (autenticada con la maestra) y se le ponen campos como estos:

| Campo | Qué limita |
|---|---|
| `models` | Qué nombres de modelo puede usar |
| `tpm_limit` | Tokens por minuto |
| `rpm_limit` | Requests por minuto |
| `max_parallel_requests` | Requests a la vez |
| `max_budget`, `budget_duration` | Gasto acumulado en un periodo |

Las mismas reglas existen por equipo y por usuario interno. Por omisión `max_budget` vale `null` y no se revisa: una clave sin límites puestos no tiene límites.

Para el despacho, tres claves al empezar: una para Open WebUI (solo inferencia, con `chat-grande` y `embeddings`), una para la app de correos (su propio modelo y su propia cuota) y una para pruebas de TI. Si la de pruebas se filtra en un repositorio, se borra esa y las otras dos siguen.

### Saber qué persona pidió, cuando quien llama es Open WebUI

Open WebUI puede reenviar quién es la persona en encabezados: con `ENABLE_FORWARD_USER_INFO_HEADERS=true` agrega `X-OpenWebUI-User-Id`, `-Email`, `-Name` y `-Role` a cada request. Y LiteLLM puede tomar uno de esos encabezados como el usuario de la request (`user_header_mappings` en su configuración); así el registro y el gasto son **por abogada**, aunque la clave sea la de Open WebUI. A noviembre de 2026 (versión 1.111.0) esa opción está en la parte MIT: no aparece en su lista de funciones de pago y su código no pide licencia.

Tres reglas para que eso sea seguro:

- **Mapea el Id, no el nombre ni el correo.** La propia guía de LiteLLM para Open WebUI avisa que en Open WebUI las personas pueden cambiar su nombre de usuario. El Id no cambia.
- **Quien tenga la clave de Open WebUI puede inventar esos encabezados.** El gateway le cree a Open WebUI porque tiene su clave. Si esa clave se usa desde otro lado, cualquiera puede decir «soy la socia directora». Por eso esa clave vive solo en el servidor de Open WebUI y solo sirve para inferencia.
- **Nunca la clave maestra en una app.** La documentación de permisos de Open WebUI lo dice así: usa credenciales limitadas a inferencia y evita poner claves de administración para el tráfico de usuarios.

:::profundo Que la cuota también sea por abogada
Para que también la **cuota** sea por abogada, LiteLLM documenta límites por cliente final (*customer*): un presupuesto con `tpm_limit` y `rpm_limit` que se aplica al usuario de la request, y uno por omisión para todos los que no tengan el suyo (`max_end_user_budget_id`). En la configuración, eso es mapear el Id de Open WebUI con el rol `customer`. Cómo se combinan exactamente el encabezado y los límites no lo detalla su documentación: pruébalo en el piloto con dos cuentas de prueba antes de confiar en él.
:::

## Límites en tokens, no en requests {Limits in tokens, not in requests}

Sensei explica el *token bucket* con requests: cada request cuesta una ficha ([Balanceadores, proxies y gateways](https://sensei.trueml.app/balanceo/)). Con un LLM eso no alcanza, porque **una request no es una unidad de trabajo**. Lo que ocupa la GPU son los tokens: los de entrada en el [[prefill|prefill]] y los de salida en el [[decode|decode]].

:::formula Lo que cuesta una request
k = t_{in} + t_{out}
t_{pre} = frac{2 × P × t_{in}}{η_c × F}
- k: el costo de la request para la cuota, en tokens (lo que LiteLLM cuenta por omisión: entrada más salida)
- t_{in}: los tokens de entrada (todo el prompt, con instrucciones, fragmentos e historia)
- t_{out}: los tokens de salida (la respuesta)
- t_{pre}: el tiempo de prefill en una GPU, en segundos: lo que la ocupa antes del primer token
- P: los parámetros del modelo (32,762 millones en Qwen3 32B)
- η_c: la fracción del pico de cálculo que se logra (0.5, supuesto del despacho)
- F: el pico de cálculo de la GPU en FLOPs por segundo (362.05 TFLOPS densos en FP16 en la L40S, según [el catálogo](/herramientas/catalogo/) a noviembre de 2026)
:::

:::cuenta Tres requests del despacho, todas «una request»
Corta: una pregunta sin fragmentos, \(k\) // supuesto: 300 de entrada y 200 de salida | 300 + 200 | 500 tokens
Típica: la pregunta con 5 fragmentos, \(k\) // la ficha: 6,000 de entrada y 500 de salida | 6,000 + 500 | 6,500 tokens
Al tope: el contexto lleno, \(k\) // el tope del despacho: 8,192 tokens por conversación | 7,692 + 500 | 8,192 tokens
Prefill de la corta, \(t_{pre}\) | 2 × 32.762 × 10⁹ × 300 ÷ (0.5 × 362.05 × 10¹²) | ≈ 0.11 s
Prefill de la típica, \(t_{pre}\) | 2 × 32.762 × 10⁹ × 6,000 ÷ (0.5 × 362.05 × 10¹²) | ≈ 2.17 s
Prefill de la del tope, \(t_{pre}\) | 2 × 32.762 × 10⁹ × 7,692 ÷ (0.5 × 362.05 × 10¹²) | ≈ 2.78 s
La del tope contra la corta, en tokens | 8,192 ÷ 500 | ≈ 16.4 veces
La del tope contra la corta, en prefill // el prefill crece con \(t_{in}\) | 7,692 ÷ 300 | ≈ 25.6 veces
= Con un límite de «4 requests por minuto», las tres pesan lo mismo. En tokens, la del tope cuesta 16 veces la corta y ocupa la GPU ≈ 26 veces más tiempo antes de su primer token.
:::

(La herramienta de sizing, que cuenta más cosas, da 2.38 s para la típica en vez de 2.17; la proporción es la misma.)

:::profundo Los requests mienten sobre la carga
Una segunda razón para contar tokens. Un script que manda 4 requests por minuto al tope pide 4 × 8,192 = 32,768 tokens por minuto. Una abogada que pregunta normal en la hora pico pide ≈ 406. Los dos «respetan» el mismo límite de 4 requests por minuto; uno pide 80 veces más.
:::

### Qué da el servidor, y cuánto pide la hora pico

Para repartir hay que saber cuánto hay. La [herramienta de sizing](/herramientas/sizing/) dice que, con los prefills de 6,000 tokens, cada L40S atiende bien **2 conversaciones** a ≥ 20 tokens por segundo. Esa es la [[capacidad-por-gpu|capacidad]] que se reparte: no lo que cabe en memoria, sino lo que se atiende bien.

:::formula La capacidad que se reparte, y lo que pide el pico
C = n × c × v × 60
D = frac{N × q}{h} × p × frac{t_{out}}{60}
u = frac{D}{C}
- C: la capacidad de salida del servidor, en tokens por minuto
- n: las GPUs, cada una con una copia del modelo (3)
- c: las conversaciones por GPU que van a la velocidad pedida (2, la herramienta de sizing)
- v: la velocidad por persona, en tokens por segundo (20, el objetivo del despacho)
- D: los tokens de salida por minuto que pide la hora pico
- N: las personas (200); q: las preguntas por persona al día (15); h: las horas de uso (10); p: el factor de la hora pico (2.5)
- u: la fracción de la capacidad que usa la hora pico
:::

:::cuenta El despacho: capacidad y hora pico
Capacidad de salida, \(C\) // \(n\) = 3, \(c\) = 2, \(v\) = 20 | 3 × 2 × 20 × 60 | 7,200 tokens/min
Preguntas en la hora pico // \(N × q ÷ h × p\) | 200 × 15 ÷ 10 × 2.5 | 750 por hora = 12.5 por minuto
Salida que pide la hora pico, \(D\) // \(t_{out}\) = 500 | 12.5 × 500 | 6,250 tokens/min
Entrada que pide la hora pico // \(t_{in}\) = 6,000 | 12.5 × 6,000 | 75,000 tokens/min
Uso en la hora pico, \(u\) | 6,250 ÷ 7,200 | ≈ 86.8 %
= En la hora pico, el despacho usa casi 87 % de lo que dan las 3 L40S. No hay sobra para que nadie abuse: por eso la cuota no es opcional.
:::

Las 3 L40S cubren el promedio de la hora pico, pero las 8 conversaciones de diseño a 20 tokens por segundo pedirían 4. La alternativa que el despacho cotiza, 2 RTX PRO 6000 Blackwell Server Edition, cambia \(n\) y \(c\) pero no el método ([Comprar hardware](/comprar-hardware/)).

:::profundo Dos comprobaciones: Little, y por qué la salida
La cuenta coincide con la [ley de Little](/concurrencia/) por otro camino: 0.21 preguntas por segundo × 25 s escribiendo ≈ 5.2 conversaciones a la vez, contra las 6 que sostienen las tres GPUs (la ficha cuenta los 27 s con el primer token y da 5.6: igual caben).

¿Por qué repartir los tokens de **salida** y no los de entrada? Porque el decode es lo que se agota primero aquí: la entrada de la hora pico (75,000 tokens por minuto) usa ≈ 15 % de lo que el prefill de las 3 GPUs podría leer en un minuto (3 × 60 s ÷ 2.17 s × 6,000 ≈ 497,000 tokens, con la cuenta de arriba). El cuello del despacho son las conversaciones que se escriben a 20 tokens por segundo. LiteLLM cuenta por omisión tokens **totales** (entrada + salida); se puede cambiar con `token_rate_limit_type` a `output`. Si dejas el total, convierte la cuota de salida a total con la proporción de tus preguntas, como en la siguiente sección.
:::

## La cuota por persona y el token bucket en tokens {Per-person quota and the token bucket in tokens}

Ya sabes cuánto hay: 7,200 tokens de salida por minuto. ¿Cuánto le toca a cada abogada? Depende de cuántas estén pidiendo **a la vez** en el peor momento, y eso nadie lo sabe exacto. Se decide con un supuesto y se ajusta con lo que registre el piloto.

:::formula Cuota por persona
q_{p} = frac{C}{N × a}
Q_{h} = frac{q_{p}}{t_{out}} × 60
L_{tpm} = frac{q_{p}}{t_{out}} × (t_{in} + t_{out})
- q_{p}: la cuota de salida de cada persona activa, en tokens por minuto
- C: la capacidad de salida del servidor (7,200 tokens/min)
- N: las personas registradas (200)
- a: la fracción de ellas que pide en el peor momento de la hora pico (supuesto: 0.5)
- Q_{h}: las preguntas por hora que le alcanzan a cada persona
- L_{tpm}: la misma cuota en tokens totales por minuto: el número que va en `tpm_limit`
- t_{in}, t_{out}: los tokens de entrada y de salida de una pregunta típica (6,000 y 500)
:::

:::cuenta La cuota de una abogada
Personas activas en el peor momento, \(N × a\) // \(a\) = 0.5, supuesto | 200 × 0.5 | 100
Salida por persona, \(q_{p}\) | 7,200 ÷ 100 | 72 tokens/min
Preguntas por hora, \(Q_{h}\) | 72 ÷ 500 × 60 | 8.64
En tokens totales, \(L_{tpm}\) // \(t_{in} + t_{out}\) = 6,500 | 72 ÷ 500 × 6,500 | 936 tokens/min
Uso típico en la hora pico // 15 preguntas ÷ 10 h × 2.5 | 1.5 × 2.5 | 3.75 preguntas/h
Cuota contra uso típico | 8.64 ÷ 3.75 | ≈ 2.3 veces
= Cada abogada puede hacer ≈ 8.6 preguntas por hora en el pico: más del doble de lo que hace alguien que trabaja normal, y muy poco para un script en un ciclo.
:::

El supuesto de la mitad activa pesa: por eso se escribe, se mide en el piloto y se corrige.

:::profundo Los extremos del supuesto
Si las 200 pidieran a la vez (\(a\) = 1), la cuota bajaría a 36 tokens de salida por minuto: 4.3 preguntas por hora, apenas arriba del uso típico. Si solo 50 (\(a\) = 0.25), subiría a 17.3 preguntas por hora.
:::

:::calculadora gateway-cuota
Empieza con el despacho. Baja la fracción activa a 100 % (el peor caso) y luego súbela a 25 %. Después cambia las GPUs a 4, el número que pediría que las 8 conversaciones de diseño vayan todas a 20 tokens por segundo, y mira cuánto sube cada cuota.
:::

### El token bucket, contado en tokens

Una cuota «por minuto» con contador tiene el hueco que Sensei explica para las ventanas fijas: se puede gastar todo al final de un minuto y todo al principio del siguiente. Además, una pregunta típica (6,500) **no cabe** en un minuto de 936. Lo que hace falta es una cubeta que guarde: el *token bucket*, ahora con tokens del LLM en vez de fichas.

:::formula Token bucket con tokens del LLM
x(t) = min(B, x_{antes} + R × Δt)
text{pasa si } x(t) ≥ k
w = frac{k − x(t)}{R}
- x(t): el nivel de la cubeta de la persona en el momento \(t\), en tokens
- B: el tamaño de la cubeta: la ráfaga más grande que se permite, en tokens
- R: la recarga, en tokens por minuto (la cuota \(L_{tpm}\))
- Δt: los minutos desde la última vez que se actualizó la cubeta
- k: el costo de la request (entrada + salida; antes de saberlo, entrada + `max_tokens`)
- w: si no pasa, los minutos que tiene que esperar: lo que va en `Retry-After`
:::

Dos reglas para elegir \(B\). **Debe caber la request más grande:** si la cubeta es menor que el contexto máximo (8,192), una pregunta al tope nunca pasaría, por más que se espere. **Y debe caber una ráfaga normal:** una abogada que repregunta dos veces seguidas no debería ver un error.

:::cuenta La cubeta del despacho
Recarga, \(R\) // la cuota en tokens totales | 936 | 936 tokens/min
Tamaño, \(B\) // 3 preguntas típicas seguidas | 3 × 6,500 | 19,500 tokens
¿Cabe la request más grande? // contexto de 8,192 | 19,500 ≥ 8,192 | sí
Reponer una pregunta, \(w\) con la cubeta vacía // \(k\) = 6,500 | 6,500 ÷ 936 | ≈ 6.9 min
De vacía a llena | 19,500 ÷ 936 | ≈ 20.8 min
Preguntas sostenidas por hora | 936 × 60 ÷ 6,500 | 8.64
= Tres preguntas seguidas pasan siempre; la cuarta, si llega en ese momento, espera ≈ 7 minutos. Lo sostenido es lo mismo que la cuota: 8.6 por hora.
:::

:::figura gateway-cubeta
La cubeta de una abogada: 19,500 tokens que se rellenan a 936 por minuto. Tres preguntas seguidas la vacían; la cuarta recibe un 429; siete minutos después pasa.
:::

:::profundo ¿Cuánto rechaza la cubeta? Una simulación
¿Rechaza mucho a quien trabaja normal? Se simula: llegadas al azar (de Poisson) durante 10 horas, con la tasa de la hora pico todo el día (un caso pesimista), para una persona típica, una que pregunta 3 veces más y un script.

```python
import random

R = 936          # recarga: tokens por minuto que gana cada persona
B = 19_500       # tamaño de la cubeta: 3 preguntas de 6,500 tokens
COSTO = 6_500    # tokens de una pregunta típica (6,000 de entrada + 500 de salida)

def rechazadas(preguntas_por_hora, horas=10, repeticiones=2000, semilla=7):
    rnd = random.Random(semilla)
    total = fuera = 0
    for _ in range(repeticiones):
        t, nivel, antes = 0.0, B, 0.0
        while True:
            t += rnd.expovariate(preguntas_por_hora / 60)   # minutos hasta la siguiente
            if t > horas * 60:
                break
            nivel = min(B, nivel + (t - antes) * R)          # la cubeta se rellena
            antes = t
            total += 1
            if nivel >= COSTO:
                nivel -= COSTO                                # pasa y se cobra
            else:
                fuera += 1                                    # 429: espera
    return fuera / total

for quien, q in (("típica (3.75/h)", 3.75), ("pesada (11.25/h)", 11.25), ("script (60/h)", 60)):
    print(f"{quien:<18} rechazadas: {rechazadas(q):6.1%}")
```

```salida
típica (3.75/h)    rechazadas:   1.7%
pesada (11.25/h)   rechazadas:  28.9%
script (60/h)      rechazadas:  85.2%
```

El script se frena (85 % fuera) y la persona pesada siente el límite. Pero 1.7 % de rechazos para quien trabaja normal es mucho: una de cada 60 preguntas con error. Con una cubeta de 5 preguntas (32,500 tokens) y la misma recarga, la misma simulación da 0.1 % para la típica, 23.4 % para la pesada y 84.9 % para el script: la ráfaga crece sin cambiar lo sostenido. Es una decisión de diseño, no una verdad: se ajusta con lo que registre el piloto.
:::

:::calculadora gateway-cubeta
Sube la cubeta a 32,500 (5 preguntas) y mira que solo cambia la ráfaga. Baja el costo a 500 (una pregunta corta) y mira cuántas caben. Luego baja la cubeta a 6,000: ni una pregunta típica cabe.
:::

:::profundo Cómo se ve en LiteLLM, y lo que no es exacto
En LiteLLM los límites se escriben así (en la clave de una app, o en el presupuesto de cliente final que se aplica a cada abogada): `tpm_limit: 936`, `rpm_limit: 4` (corta los ciclos de un script antes de que el `tpm` lo note) y `max_parallel_requests: 2` (documentado para claves y equipos; por cliente final, compruébalo). Este último importa con un servidor chico: las 3 L40S sostienen ≈ 6 conversaciones a 20 tokens por segundo, así que con 2 a la vez por persona, **3 personas** las llenan todas; con 1, hacen falta 6.

Dos diferencias con la cubeta de la cuenta, que conviene saber:

- **LiteLLM no promete un token bucket.** Su documentación describe límites por minuto que se aplican «reservando tokens antes de la llamada y conciliando contra el uso real después». La cubeta es el modelo mental para elegir los números; cómo se comporta exactamente la ventana de LiteLLM con ráfagas hay que probarlo en la versión que instales.
- **Sin `max_tokens`, la reserva es una adivinanza.** Si la request no trae tope de salida, LiteLLM tiene que adivinar cuántos tokens reservar y usa una estimación fija; se puede declarar `default_estimated_output_tokens` por clave o por equipo. Más simple: que el gateway o Open WebUI siempre manden `max_tokens`, y que [[vllm|vLLM]] tenga su propio tope de contexto (`--max-model-len 8192`) por si algo se cuela.
:::

Y un recordatorio: la cuota no hace fila. Si en el pico llegan más preguntas de las que caben, la cuota no las ordena: unas reciben 429 y otras esperan en la fila de vLLM. Qué conviene hacer ahí (cola en el gateway, aviso en la interfaz, más GPUs) es una decisión con números, y la [concurrencia](/concurrencia/) los da.

## Varios modelos y tres copias: el enrutamiento {Several models and three copies: routing}

El gateway publica **nombres**. Detrás de cada nombre, uno o varios servidores. Eso es el [[enrutamiento-de-modelos|enrutamiento de modelos]], y resuelve dos preguntas distintas.

### Entre modelos: un nombre por trabajo

El despacho no va a tener un solo modelo para siempre. Al poco tiempo tendrá tres:

- `chat-grande`: Qwen3 32B, para preguntar a los expedientes.
- `chat-chico`: un modelo más chico y rápido, para clasificar correos o sugerir un título (y de respaldo, como verás).
- `embeddings`: un modelo de embeddings para la búsqueda de fragmentos (la lección de RAG lo elige).

Las apps piden `chat-grande`, no «Qwen/Qwen3-32B-AWQ en vllm-2:8000». Si el despacho cambia de modelo después de su examen de 200 preguntas, cambia una línea del gateway y ninguna app.

### Entre copias del mismo modelo

Las 3 L40S tienen cada una su [[replica|copia]] de Qwen3 32B (por qué tres copias y no un modelo partido en tres lo explica [Varias GPUs](/varias-gpus/)). En LiteLLM, eso se escribe repitiendo el mismo `model_name` con tres direcciones distintas, y el respaldo, los reintentos y la pausa van en el mismo archivo (abajo).

:::profundo El config.yaml del despacho
Un `config.yaml` para el despacho (ilustrativo, armado con campos de la documentación de LiteLLM a noviembre de 2026; no probado tal cual):

```yaml
model_list:
  - model_name: chat-grande                 # el nombre que ven las apps
    litellm_params:
      model: hosted_vllm/<nombre-con-que-vLLM-sirve-el-modelo>
      api_base: http://vllm-1:8000/v1
      api_key: os.environ/VLLM_KEY
  - model_name: chat-grande                 # mismo nombre = otra copia
    litellm_params: {model: hosted_vllm/<mismo-nombre>, api_base: http://vllm-2:8000/v1, api_key: os.environ/VLLM_KEY}
  - model_name: chat-grande
    litellm_params: {model: hosted_vllm/<mismo-nombre>, api_base: http://vllm-3:8000/v1, api_key: os.environ/VLLM_KEY}
  - model_name: chat-chico
    litellm_params: {model: hosted_vllm/<modelo-chico>, api_base: http://vllm-chico:8000/v1}
  - model_name: embeddings
    litellm_params: {model: hosted_vllm/<modelo-de-embeddings>, api_base: http://vllm-emb:8001/v1}

router_settings:
  routing_strategy: simple-shuffle          # la recomendada en producción
  num_retries: 2
  allowed_fails: 3                          # 3 fallas...
  cooldown_time: 30                         # ...y esa copia descansa 30 s
  fallbacks: [{"chat-grande": ["chat-chico"]}]

litellm_settings:
  request_timeout: 300
  turn_off_message_logging: true

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL
```

El prefijo `hosted_vllm/` le dice a LiteLLM que del otro lado hay un servidor [[vllm|vLLM]] compatible con OpenAI. El `api_key` hacia cada vLLM sigue sirviendo (protege las rutas `/v1` del motor), pero ya no es la defensa principal: lo son la red y el gateway.
:::

Cada request va a una de las tres; cómo se elige importa más de lo que parece, por el prefix caching de cada copia.

:::profundo Cómo elige la copia, y la afinidad
**Cómo elige la copia.** LiteLLM tiene varias estrategias (`routing_strategy`). La que su documentación recomienda para producción es `simple-shuffle`: al azar, o con pesos si se le dan. `least-busy` manda a la copia con menos llamadas en curso. El reparto al azar es justo el peor caso de la simulación de [De requisitos a hardware](/requisitos-hardware/) (sección «La cola»): con 3 L40S, el p95 del primer token sale ≈ 4.2 s al azar y ≈ 3.3 s contando las peticiones abiertas (lo que hace `least-busy`), contra 2.38 s, el prefill solo, si el reparto va por turno o viendo la fila. Es una simulación y no una medición: el piloto mide el real. La basada en uso (`usage-based-routing`) la propia documentación la desaconseja en producción por su costo.

**Afinidad y prefix caching.** Cada copia de vLLM tiene su propio KV cache y su propio [[prefix-caching|prefix caching]]. La repregunta de una abogada empieza con los ≈ 6,000 tokens de su primera pregunta: si cae en la **misma** copia, esos bloques ya están calculados; si cae en otra, se recalculan (≈ 2.4 s). LiteLLM documenta una afinidad de sesión que manda una conversación a la copia que atendió su primera request. Para el despacho tiene sentido probarla; cuánto ahorra no está medido y lo dirá el piloto.
:::

### Reintentos, pausa y respaldo

:::diagrama gateway-ruta
Lo que decide el gateway con cada request, en orden: la clave, la cuota, la copia y, si algo falla, el reintento, la pausa y el respaldo. Sigue los tres recorridos: una request normal, una sin cuota y una copia que falla.
:::

- **Reintentos.** Si una copia no contesta, se reintenta en otra (`num_retries`). Ojo: a noviembre de 2026 la documentación de LiteLLM no es consistente sobre el valor por omisión (su tabla de configuración dice 2; su página de respaldos dice que, para la mayoría de los errores, el router no reintenta): escríbelo siempre en la configuración. Y los reintentos tienen su costo: la lección [Timeouts, reintentos e idempotencia](https://sensei.trueml.app/fallas-red/) de Sensei explica cómo una tormenta de reintentos tumba a un servidor que apenas se estaba levantando.
- **Pausa (*cooldown*).** Una copia que falla 3 veces (`allowed_fails`) sale de la rotación 30 s (`cooldown_time`). Así una L40S que se reinicia no se come las preguntas de todos.
- **[[fallback|Respaldo]].** Si `chat-grande` falla tras sus reintentos, la pregunta va a `chat-chico`. **Siempre dentro del despacho.** Un respaldo hacia una API pública, por cómodo que sea, manda expedientes fuera de la red justo el día que algo falló: es romper la razón del proyecto sin que nadie lo decida. Si no hay respaldo sano, un 503 con un mensaje claro.

:::profundo Los timeouts de un LLM en el gateway
LiteLLM distingue dos tiempos por modelo: `timeout` es el máximo para la **respuesta completa**, y `stream_timeout`, el máximo para el **primer pedazo** de un stream. El ejemplo de su documentación usa 300 s y 30 s. Para el despacho: una respuesta normal dura ≈ 27 s, y un resumen de expediente de 1,500 tokens (supuesto) tarda 1,500 ÷ 20 = 75 s solo en escribirse. Un `timeout: 30`, que parece generoso para una API web, corta respuestas legítimas cuando a la de 27 s le toca un poco de fila. Regla práctica: el timeout total, varias veces la respuesta más larga que esperas; el del primer pedazo, varias veces el TTFT que se ve en la hora pico.
:::

## El registro, sin que se vuelva un riesgo {The log, without it becoming a risk}

El [[registro-de-auditoria|registro de auditoría]] responde preguntas que el despacho va a tener: ¿quién usó más? ¿Por qué ayer a las 12 estuvo lento? ¿Alguien de un área usó el modelo para un cliente que no le toca? Para eso basta **una fila por request** con metadatos. Para nada de eso hace falta el texto.

:::figura gateway-registro
Una fila del registro del despacho: lo que se guarda, lo que no, y los cinco lugares donde el texto se queda aunque la fila no lo guarde.
:::

### Qué se guarda

Quién (el `oid` de Entra o el Id de Open WebUI, no el correo), cuándo, qué modelo y qué copia, cuántos tokens de entrada y de salida, cuánto tardó (TTFT y total), cómo terminó (código HTTP y `finish_reason`) y un identificador de la request para cruzarla con los logs del motor. Con eso se cobran las cuotas, se encuentra a quien abusa y se investiga una falla.

### Qué no se guarda, y por qué

El texto de la pregunta, los fragmentos de expediente y la respuesta. Dos razones. La primera es el **secreto profesional**: el despacho hizo este proyecto para que los expedientes no salieran de su red; una tabla con un año de preguntas es la copia más completa de lo que sus clientes le confiaron, en un solo lugar. La segunda es la ley. La Ley Federal de Protección de Datos Personales en Posesión de los Particulares vigente (publicada en el DOF el 20 de marzo de 2025, con su última reforma en el DOF del 14 de noviembre de 2025, según el texto vigente consultado el 26 de noviembre de 2026; Sensei la cuenta en [Datos personales y la ley](https://sensei.trueml.app/privacidad/)) pide que el tratamiento sea el **necesario, adecuado y relevante** para la finalidad avisada (art. 12), que no se use para otra finalidad sin nuevo consentimiento (art. 11), que los datos se supriman cuando ya no sirvan (art. 10) y que haya medidas de seguridad contra el acceso no autorizado (art. 18). Un registro hecho «para repartir cuotas» que guarda las preguntas es más de lo necesario; y usarlo después «para evaluar a los abogados» sería otra finalidad.

### Dónde se cuela el texto sin pedirlo

La parte difícil no es la fila: es todo lo demás.

1. **Los *callbacks* de logging del gateway.** LiteLLM puede mandar cada request a herramientas de observabilidad. `turn_off_message_logging: true` evita que los mensajes y las respuestas lleguen a esos destinos; los metadatos (como el gasto) se siguen registrando.
2. **La tabla de gasto.** Los *spend logs* de LiteLLM (en Postgres) son la fila por request. Con `store_prompts_in_spend_logs: true` también guardan prompts y respuestas; por omisión está en `false`. Déjalo así.
3. **Los logs de errores.** Una excepción puede imprimir el request completo. LiteLLM tiene `disable_error_logs` para no guardarlos en su base; también hay que mirar lo que escriben los contenedores.
4. **Los chats de Open WebUI.** Open WebUI guarda las conversaciones completas en su propia base (por omisión SQLite, una base de datos en un solo archivo), y con `ENABLE_ADMIN_CHAT_ACCESS`, que viene en `true`, los administradores pueden abrir los chats de cualquiera. Es un segundo registro del texto, y los abogados pueden suponer que sus chats son privados. Apagarlo esconde esos chats en la interfaz, pero su documentación avisa que un administrador todavía llega a ellos por la base de datos o el servidor (y la exportación de datos, `ENABLE_ADMIN_EXPORT`, también los incluye). Se decide a propósito: quién administra esa base, cuánto viven los chats y qué dice el aviso de privacidad.
5. **Los respaldos.** Si las bases se respaldan, lo que está en ellas vive también en cada respaldo, con su propio plazo.

La guía de producción de LiteLLM lo resume bien: para cargas sensibles, deja apagado el logging de mensajes y el guardado de prompts, manda los metadatos solo a destinos aprobados, revisa por separado los logs de excepciones, los callbacks, las cachés y los respaldos, **fija la retención de cada almacén** y prueba las exportaciones con marcadores sintéticos. Ese último consejo vale oro: manda una pregunta con una palabra inventada («ZORRO-7731») y búscala en cada lugar. Donde aparezca, ahí hay texto.

### Retención: cuánto vive cada fila

La [[retencion-de-registros|retención]] es cuánto se guarda antes de borrar. La ley no da un número de días para bitácoras técnicas: pide suprimir cuando el dato ya no sirve a su finalidad, y el plazo lo decide y lo escribe el despacho. En LiteLLM, el valor por omisión de `maximum_spend_logs_retention_period` está vacío: **la limpieza viene apagada** y la tabla crece para siempre. El despacho elige 90 días (una decisión suya, no un plazo legal): con ≈ 3,000 preguntas al día son, a lo más, 90 × 3,000 = 270,000 filas vivas.

:::profundo «Audit logs» no es la fila por request
Las palabras engañan. En LiteLLM, lo que se llama *audit logs* es una función de pago que registra **cambios de administración** (quién creó o borró una clave, un equipo, un modelo). La fila por request son los *spend logs*, que vienen en la parte gratis. Quien promete «auditoría completa» con la versión gratis tiene que decir de cuál habla. Y el extremo contrario: `disable_spend_logs: true` apaga la fila por request, y con ella el registro de quién usó qué y los presupuestos exactos. Privacidad no es no registrar nada: es registrar lo justo.
:::

## Las piezas, con su licencia y su costo en milisegundos {The pieces, with their license and their cost in milliseconds} [extra]

Para un proyecto de IA privada, la licencia de cada pieza importa tanto como la del modelo (la lección [Licencias](/licencias/) lo explica para modelos). A noviembre de 2026, consultado en sus repositorios el 26 de noviembre:

| Pieza | Versión | Licencia | Lo que hay que saber |
|---|---|---|---|
| LiteLLM proxy | 1.111.0 (25-nov-2026) | MIT, **menos** la carpeta `litellm/enterprise/`, que es propietaria | Gratis: claves virtuales, presupuestos y límites, panel, balanceo, spend logs. De pago: SSO del panel para más de 5 personas, audit logs, administradores por organización y por equipo, gestores de secretos, apagar logging por equipo. Saca varias versiones por semana: fija la versión |
| Open WebUI | 0.13.5 (25-nov-2026) | BSD de 3 cláusulas **más** una cláusula de marca | Gratis de usar y desplegar; con más de 50 usuarios finales en 30 días no se puede quitar ni cambiar la marca «Open WebUI» sin permiso o licencia de pago. El despacho (200) la conserva |
| nginx | 1.30.8, la estable (23-nov-2026) | BSD de 2 cláusulas | Candado HTTPS, filtro de rutas, límite por IP. No cuenta tokens ni conoce personas |
| Envoy AI Gateway, hoy **Agent Router** | 1.3.0 (18-nov-2026) | Apache 2.0 | Sobre Kubernetes, con sus propios recursos; pesado para un TI de 2 sin Kubernetes |
| Kong Gateway | 3.9.5 (19-nov-2026) | Apache 2.0 | Su repositorio abierto trae `ai-proxy`, con [[vllm\|vLLM]] como proveedor; el límite en tokens (*AI Rate Limiting Advanced*) es de su oferta de pago, «AI Gateway Enterprise» |
| Portkey AI Gateway | 1.15.2 (12-ene-2026) | MIT | Ligero; avisa que su versión 2.0 junta lo «enterprise» en lo abierto |

Sobre Open WebUI, un matiz: con esa cláusula de marca, su licencia no es «open source» en el sentido estricto de la Open Source Initiative, aunque se pueda usar gratis; es una lectura, no un dictamen de la OSI.

### Cuánto agrega el gateway a la latencia

Cada pieza en el camino suma tiempo. ¿Cuánto? LiteLLM publica sus propias pruebas (página de benchmarks, actualizada el 25 de noviembre de 2026), con una advertencia que hay que leer primero: usan un **modelo simulado** que contesta sin pensar, no un vLLM real. Con 4 instancias, su sobrecarga fue de **2 ms** en la mediana, **8 ms** en el p95 y 13 ms en el p99. En otra prueba, con un modelo simulado que tarda 200 ms, recomiendan planear ≈ 100 requests por segundo por instancia de 4 *workers* (4 procesos que atienden en paralelo), y ahí el p99 de sobrecarga fue de 47 ms.

:::formula Lo que pesa el gateway
f = frac{t_{gw}}{TTFT}
- t_{gw}: lo que agrega el gateway a cada request, en segundos
- TTFT: el tiempo al primer token sin el gateway, en segundos
- f: la fracción del TTFT que pone el gateway
:::

:::cuenta El gateway en el despacho
TTFT del despacho sin fila // la herramienta de sizing | 2.38 s | 2,380 ms
Sobrecarga p95 publicada, \(t_{gw}\) // la prueba de LiteLLM con 4 instancias | 8 ms | 8 ms
Fracción, \(f\) | 8 ÷ 2,380 | ≈ 0.34 %
Con el p99 a 100 requests/s por instancia // \(t_{gw}\) = 47 ms | 47 ÷ 2,380 | ≈ 2 %
Carga del despacho contra lo que aguanta una instancia // 0.21 preguntas/s en la hora pico | 0.21 ÷ 100 | ≈ 0.2 %
= El gateway agrega milisegundos a un camino que tarda segundos, y una sola instancia sobra por mucho.
:::

Son cifras del proveedor con un modelo simulado, no una medición del despacho. Lo que sí se puede afirmar es el orden de magnitud: milisegundos contra segundos. Si el gateway del despacho agrega cientos de milisegundos, algo está mal configurado (un *callback* lento, una base lejos) y se busca. La capacidad real se confirma con una prueba de carga, que tiene su propia lección («Pruebas de carga y benchmarks honestos»).

## Errores comunes {Common mistakes}

1. **Dar a cada app la dirección de [[vllm|vLLM]] con `--api-key`.** Una llave para todos, sin personas, sin cuotas, y con rutas que no protege (`/invocations`, `/metrics`, `/tokenize`). **Cómo evitarlo:** los puertos de vLLM solo los alcanza el gateway; el gateway expone solo las rutas `/v1` que se usan y da una [[clave-de-api|clave]] por app.
2. **Limitar requests y no tokens.** Con «4 requests por minuto», una pregunta al tope (8,192 tokens) y una corta (500) pesan lo mismo, y la primera ocupa la GPU ≈ 26 veces más antes de su primer token. **Cómo evitarlo:** pon `tpm_limit` calculado con la capacidad (\(q_{p} = C ÷ (N × a)\)) y usa el `rpm` solo como freno de ciclos.
3. **Un proxy que junta el stream o lo corta.** `proxy_buffering` prendido entrega todo al final; un timeout de 30 o 60 s antes del primer token mata respuestas en la hora pico. **Cómo evitarlo:** apaga el buffering para `/v1/`, separa el timeout total del del primer pedazo y prueba desde el navegador de una abogada.
4. **Usar el correo como identidad.** Microsoft dice que el claim `email` puede cambiar y no debe usarse para autorizar; Open WebUI llama inseguro juntar cuentas por correo. **Cómo evitarlo:** identifica por `oid` (con `tid`); en el gateway, mapea el Id que manda Open WebUI, no el nombre.
5. **Autorizar por grupos de Entra sin mirar los límites.** Más de 200 grupos y el token ya no los trae; asignar grupos a la app exige P1. **Cómo evitarlo:** [[rol-de-aplicacion|roles de aplicación]] (`user`, `admin`) y confirmar la licencia del tenant.
6. **Creer que «apagué el logging» apagó todo.** `turn_off_message_logging` cubre los callbacks; el texto puede seguir en los logs de errores, en los chats de Open WebUI y en los respaldos, y la tabla de gasto crece sin fin si no se fija la retención. **Cómo evitarlo:** manda una palabra inventada y búscala en cada almacén; fija el plazo de borrado de cada uno.
7. **Un respaldo hacia una API pública.** El día que se cae el servidor, los expedientes salen de la red sin que nadie lo decida. **Cómo evitarlo:** el [[fallback|respaldo]] es otro modelo local; si no hay, 503 con un mensaje claro.

## En la vida real {In real life} [extra]

**El despacho.** Open WebUI para los 200 abogados, con SSO de Microsoft Entra ID por OIDC y dos roles de aplicación; LiteLLM como gateway, con una clave de servicio para Open WebUI (solo inferencia) que reenvía el Id de cada persona; tres copias de Qwen3 32B detrás del nombre `chat-grande`, un `chat-chico` local de respaldo y un modelo de embeddings. Cuotas por persona de ≈ 936 tokens por minuto con una cubeta de 3 a 5 preguntas, `rpm` de 4 y 2 requests a la vez, calculadas con los 7,200 tokens de salida por minuto que dan las 3 L40S (si el piloto decide por las 2 RTX PRO 6000, se recalculan con el mismo método). Una fila por pregunta sin texto, borrada a los 90 días; los chats de Open WebUI, con una decisión escrita sobre quién puede leerlos. El TI de 2 personas opera tres programas con una base Postgres, sin Kubernetes.

**Una startup con varios clientes.** Supuesto del ejemplo: una empresa que ofrece su propio asistente a 4 clientes, todos sobre el mismo servidor. Aquí el gateway separa **inquilinos** (*multi-tenant*): cada cliente su equipo, sus claves, su cuota y su presupuesto, y ningún cliente ve el uso de otro. Si uno paga el doble, su cuota pesa el doble: con la misma capacidad de 7,200 tokens de salida por minuto y pesos 2, 1, 1 y 1, le tocan 2,880 y a cada uno de los otros, 1,440. El caso a fondo, con contratos y aislamiento, va en una lección posterior.

**Una fábrica con una app sin personas.** Supuesto del ejemplo: un sistema interno que lee los reportes de falla de las líneas de producción y los clasifica, 24 horas al día. No hay SSO ni Open WebUI: solo una clave de API con su cuota. El límite que importa es otro: el trabajo no es urgente, así que se le da una cuota baja de día y alta de noche, o una prioridad menor, para que nunca compita con la gente. Y su registro sí puede guardar más, porque los reportes no son datos personales; la retención se decide igual.

**Fuera de las computadoras: el comedor con vales.** Una empresa da a cada empleado vales de comida que se recargan cada semana (la recarga) y que se pueden juntar hasta un tope (la cubeta). La cajera no pregunta qué vas a comer, solo cobra el vale (la fila sin texto). Dónde se rompe: en el comedor el precio está en el menú antes de pedir; en un LLM, la cuenta llega al final.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Una abogada del despacho repregunta: el request lleva los 6,500 tokens de la primera pregunta y su respuesta, más 150 de la pregunta nueva, y la respuesta trae 500. ¿Cuántos tokens cobra el gateway? ¿Cabe en el contexto de 8,192?
\(k = t_{in} + t_{out}\): entrada = 6,500 + 150 = 6,650; salida = 500. \(k\) = 6,650 + 500 = **7,150 tokens**. Cabe: 7,150 ≤ 8,192, pero quedan solo 8,192 − 7,150 = 1,042 tokens para la conversación. La siguiente repregunta igual (7,150 + 150 de entrada + 500 de salida = 7,800) todavía cabe; la que sigue (7,800 + 150 + 500 = 8,450) ya no. Por eso el tope de contexto es parte del diseño, y por eso la cuota cobra la historia completa en cada repregunta.
? [facil] Un cliente pide `stream: true` y el gateway quiere cobrar los tokens reales. ¿Qué tiene que llevar el request y en qué pedazo llegan los tokens?
Tiene que llevar `"stream_options": {"include_usage": true}`. Los tokens llegan en un pedazo **extra al final**, después del que trae el `finish_reason` y antes de `data: [DONE]`, con `choices` vacío y `usage` con `prompt_tokens`, `completion_tokens` y `total_tokens`. Si el cliente no lo pide, el gateway debe pedirlo por su cuenta o contar él mismo.
? [facil] El ID token de Entra de una abogada trae `oid`, `sub`, `email`, `preferred_username` y `roles`. ¿Con cuál se identifica en el registro y con cuál se decide si es administradora?
Se identifica con **`oid`** (con `tid`, el tenant): no cambia y es el mismo en todas las apps del tenant (`sub` también sirve, pero solo dentro de esta app). Se decide con **`roles`**: si trae `admin`, es administradora. Nunca con `email` ni `preferred_username`, que pueden cambiar.
? [medio] Con la calculadora de cuota o a mano: si solo 25 % de las 200 personas piden a la vez en el peor momento, ¿cuál es la cuota de salida por persona, cuántas preguntas por hora le alcanzan y qué `tpm_limit` (en tokens totales) se pondría?
Activas: 200 × 0.25 = 50. \(q_{p}\) = 7,200 ÷ 50 = **144 tokens/min** de salida. \(Q_{h}\) = 144 ÷ 500 × 60 = **17.28 preguntas/h**. \(L_{tpm}\) = 144 ÷ 500 × 6,500 = **1,872 tokens/min**. Es 4.6 veces el uso típico en el pico (17.28 ÷ 3.75): generoso, y peligroso si el supuesto de 25 % resulta falso.
? [medio] La cubeta de una abogada (recarga 936 tokens/min, tamaño 19,500) está llena a las 10:00. Hace 3 preguntas típicas seguidas a las 10:00. ¿A qué hora puede hacer la cuarta? ¿Y si la cubeta fuera de 32,500?
Tras 3 preguntas: 19,500 − 3 × 6,500 = 0. \(w\) = (6,500 − 0) ÷ 936 ≈ 6.94 min: la cuarta pasa a las **≈ 10:07**. Con 32,500: ⌊32,500 ÷ 6,500⌋ = 5 preguntas seguidas pasan; la cuarta pasa **de inmediato** (quedan 6,500 tras la cuarta y 0 tras la quinta). La sexta esperaría ≈ 6.9 min. Lo sostenido no cambia: 8.64 por hora en los dos casos.
? [medio] La sobrecarga del gateway en la prueba de LiteLLM fue de 13 ms en el p99 con 4 instancias. Si el despacho pone nginx (supón 1 ms) y LiteLLM (13 ms) delante de [[vllm|vLLM]], ¿qué fracción del TTFT de 2.38 s agregan? ¿Vale la pena preocuparse?
\(t_{gw}\) = 1 + 13 = 14 ms. \(f\) = 14 ÷ 2,380 ≈ **0.6 %**. No: el TTFT del despacho lo deciden el prefill (≈ 2.2–2.4 s) y la fila de la hora pico. Si de verdad midieran cientos de milisegundos, sería señal de una mala configuración, no del gateway en sí. Y las cifras de LiteLLM son con un modelo simulado: se confirman con una prueba de carga.
? [reto] El despacho quiere conectar una app que clasifica correos: 30 correos por minuto de 1,500 tokens de entrada y 50 de salida, de 9:00 a 19:00. ¿Qué parte de la capacidad de salida usa? ¿Cabe junto con la hora pico de los abogados? ¿Qué límite le pondrías?
Salida de la app: 30 × 50 = **1,500 tokens/min**, el 1,500 ÷ 7,200 ≈ **20.8 %** de la capacidad. En la hora pico los abogados ya piden 6,250: juntos, 7,750 > 7,200, el **107.6 %**. No cabe. Lo que sobra en el pico es 7,200 − 6,250 = **950 tokens/min** de salida: a la app le alcanzan 950 ÷ 50 = **19 correos/min** sin quitarle a nadie. Opciones: `tpm_limit` de la app con ese tope (en tokens totales, 19 × 1,550 = 29,450), o que procese su fila fuera de la hora pico o de noche, o que use `chat-chico`. Ojo también con la entrada: 30 × 1,500 = 45,000 tokens/min de prefill más, que suben el TTFT de los abogados.
? [reto] La startup del ejemplo tiene 4 clientes sobre un servidor con 7,200 tokens de salida por minuto. El cliente A paga el doble que los otros tres. Sus preguntas son de 2,000 tokens de entrada y 250 de salida; las de los demás, como las del despacho (6,000 y 500). ¿Qué `tpm_limit` en tokens totales le pones a cada cliente?
Pesos 2 + 1 + 1 + 1 = 5. Salida: A = 7,200 × 2 ÷ 5 = **2,880 tokens/min**; B, C y D = 7,200 ÷ 5 = **1,440** cada uno. En tokens totales, cada uno con su proporción: A: 2,880 ÷ 250 × 2,250 = **25,920**; los otros: 1,440 ÷ 500 × 6,500 = **18,720** cada uno. A tiene más tokens totales sin tener «más servidor» de lo que paga: sus preguntas son más cortas de entrada. Si el gateway contara solo salida (`token_rate_limit_type: output`), bastaría poner 2,880 y 1,440.
? [reto] Un auditor pide al despacho «guardar todas las preguntas un año, por si acaso». Con lo que viste de la ley y del registro, ¿qué le contestas y qué propones en su lugar?
Que «por si acaso» no es una finalidad: la ley pide que el tratamiento sea el necesario, adecuado y relevante para la finalidad avisada (art. 12), que no se reutilice para otra sin nuevo consentimiento (art. 11) y que se suprima cuando deje de ser necesario (art. 10). Además, un año de preguntas con fragmentos de expediente sería la copia más completa del secreto profesional del despacho, en un solo lugar. Propuesta: la fila sin texto (quién, cuándo, modelo, tokens, tiempos, cómo terminó, Id de request) durante 90 días, suficiente para cuotas, fallas y abusos; los chats de Open WebUI con su propia regla de acceso y plazo en el aviso de privacidad; y, si alguna finalidad concreta pidiera texto (por ejemplo, investigar una queja), guardarlo solo para esa conversación, con acceso limitado y fecha de borrado.
:::

## Lo que sigue {What comes next} [extra]

- **[Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM](/stack-serving/)** explica los motores que este gateway tiene detrás: qué hace cada uno por dentro, cómo se arranca [[vllm|vLLM]] para el despacho y qué flags mueven lo que viste aquí (el tope de contexto, el razonamiento apagado).
- **[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)** explica por qué el despacho pone tres copias detrás de un nombre en vez de un modelo partido entre tres GPUs, y cuándo cambiaría.
- **[De requisitos a hardware](/requisitos-hardware/)** es de donde sale la capacidad que se reparte en las cuotas, y por qué el TTFT del p95 con fila es mayor que el de una pregunta sola.
- **«RAG privado: embeddings y vector DB locales»** usa el modelo `embeddings` de este gateway y resuelve lo que el SSO no resuelve: que la búsqueda respete qué expedientes puede ver cada persona.
- **«Seguridad: aislamiento, sin internet y actualizaciones»** cierra las puertas de red que aquí solo se mencionan, y **«Observabilidad de GPUs e inferencia»** usa la fila del registro y el `/metrics` de vLLM.
- En Sensei: [Balanceadores, proxies y gateways](https://sensei.trueml.app/balanceo/) tiene el token bucket por dentro; [Autenticación y permisos](https://sensei.trueml.app/identidad/), OIDC y los JWT; [Datos personales y la ley](https://sensei.trueml.app/privacidad/), la ley que pesa sobre el registro; y [Timeouts, reintentos e idempotencia](https://sensei.trueml.app/fallas-red/), por qué un reintento mal puesto tumba un servidor.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
gateway-de-llm api-compatible-openai chat-completions streaming-sse clave-de-api sso oidc entra-id rol-de-aplicacion limite-de-tasa cuota-de-tokens enrutamiento-de-modelos fallback registro-de-auditoria retencion-de-registros
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué el `--api-key` de [[vllm|vLLM]] no basta para proteger el servidor?
Porque es una sola llave para todos (sin personas ni cuotas) y porque, según la documentación de vLLM, solo protege las rutas `/v1`, `/v2`, `/inference` y `/cohere`: `/invocations` da la misma inferencia sin llave, y `/metrics`, `/health` y `/tokenize` tampoco piden llave.
? ¿Por qué un gateway de LLMs limita en tokens y no solo en requests?
Porque una request no es una unidad de trabajo: una de 8,192 tokens pesa 16 veces una de 500 y ocupa la GPU mucho más antes de su primer token. Lo que se agota son los tokens que la GPU lee y escribe.
? ¿De dónde sale la cuota de ≈ 936 tokens por minuto de una abogada?
De la capacidad de salida (3 L40S × 2 conversaciones × 20 tokens/s × 60 = 7,200 tokens/min) entre 100 personas activas (la mitad de 200, supuesto): 72 de salida por minuto, que en tokens totales, con preguntas de 6,000 + 500, son 936.
? ¿Qué claim del ID token de Entra usas para identificar a una persona, y cuál no?
`oid` (con `tid`), que no cambia. No el `email`: Microsoft dice que puede cambiar y no debe usarse para autorizar.
? ¿Qué dos cosas de un proxy pueden arruinar un stream de SSE?
Que junte los pedazos (*buffering*), y la persona vea todo al final; y que corte por silencio antes del primer token (en nginx, `proxy_read_timeout` de 60 s por omisión).
? Si una copia de vLLM falla, ¿qué hace el gateway, y a dónde **no** debe mandar la pregunta nunca?
Reintenta en otra copia, pone a la que falló en pausa (por ejemplo, 30 s tras 3 fallas) y, si todas fallan, usa un modelo de respaldo local o contesta 503. Nunca a una API pública: sacaría expedientes de la red.
? Nombra tres lugares donde el texto de las preguntas se queda aunque la fila del registro no lo guarde.
Los callbacks de logging del gateway, la tabla de gasto si se activa guardar prompts, los logs de errores, los chats que guarda Open WebUI y los respaldos de esas bases (cualesquiera tres).
:::
