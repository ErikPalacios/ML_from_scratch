---
titulo: Autenticación y permisos
en: Authentication and permissions
subtitulo: Cómo sabe un sistema quién le habla, una persona o un programa, y qué le deja hacer: contraseñas con sal, segundo factor, llaves de API, tokens JWT, OAuth, roles y el error de autorización más común.
pregunta: Al clasificador de Alba le llegan millones de requests al día de tres programas distintos, y Ana entra a editar sus publicaciones. ¿Cómo sabe cada sistema quién es quién, sin guardar contraseñas, y cómo decide qué le deja hacer a cada uno?
requisitos: http, gestionados, balanceo, cifrado
---

:::idea
Cada pedido (*request*) a un sistema responde dos preguntas: **¿quién eres?** (autenticación) y **¿qué puedes hacer?** (autorización). La primera se resuelve con algo que solo el dueño puede mostrar: una contraseña que el servidor no guarda, un segundo factor o un token firmado que caduca pronto. La segunda se revisa en el servidor, en cada request, contra la identidad verificada y nunca contra lo que el cliente dice de sí mismo.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace en línea: recibe ≈ 2.5 millones de publicaciones nuevas al día y, a quien vende, le sugiere la categoría de cada foto entre 500 posibles. Lo hace un modelo de visión (una ResNet-50) que corre en Triton, un programa hecho para servir modelos, dentro de Kubernetes, el sistema que reparte los programas de Alba entre sus máquinas, en la nube de Amazon (AWS). Ese servicio, el **clasificador**, responde ≈ 10 millones de fotos al día: las de las publicaciones nuevas, que traen varias cada una, más las que piden otros equipos.

Al clasificador lo llaman **3 programas internos** de Alba: el **backend de publicaciones** (el programa del servidor que arma cada publicación nueva), **moderación** (el que revisa que las publicaciones cumplan las reglas) y **búsqueda** (el que ordena el catálogo). A un programa que llama a otro se le dice ***caller***, «el que llama», y cada pedido que le hace, una ***request***. Del otro lado de la pantalla está Ana, una vendedora de Ciudad de México, que entra a Alba con su correo y su contraseña para publicar unos tenis.

Esta lección es sobre cómo cada pieza sabe quién le habla y qué le deja hacer. Usa una idea de «Cifrado, llaves y certificados»: la [[firma-digital|firma digital]], un sello que solo puede poner quien tiene una llave secreta (la **llave privada**) y que cualquiera comprueba con otra llave que se publica (la **llave pública**). Si alguien cambia un solo byte de lo firmado, el sello ya no coincide.

## Dos preguntas: quién eres y qué puedes hacer {Two questions: who are you and what can you do}

Piensa en un concierto. En la entrada te piden tu boleto y una identificación: comprueban que **eres tú** y que el boleto es de verdad. Eso es la **[[autenticacion|autenticación]]** (*authentication*, que en el trabajo se abrevia **AuthN**): comprobar la identidad de quien llega.

Adentro, tu pulsera dice «general» o «VIP». Con «general» no pasas al camerino, aunque nadie dude de quién eres. Eso es la **[[autorizacion|autorización]]** (*authorization*, **AuthZ**): decidir qué puede hacer una identidad que ya se comprobó.

Son dos preguntas distintas, y un sistema puede tener la primera perfecta y la segunda inexistente. Un sitio que pide contraseña y luego deja a cualquier usuario con sesión ver los pedidos de todos autentica muy bien y no autoriza nada. Es uno de los errores más comunes, y lo vas a ver a fondo en la sección de autorización.

:::analogia El concierto
El guardia de la entrada es la autenticación: tu identificación prueba quién eres. La pulsera es la autorización: dice a qué zonas puedes entrar. Las dos se revisan por separado, y la pulsera la revisa cada puerta, no solo la de afuera.

Dónde se rompe: en un concierto, la pulsera no caduca ni se puede copiar fácilmente. En un sistema, la «pulsera» suele ser un texto (un token) que cualquiera que lo copie puede usar. Por eso los tokens caducan pronto y viajan cifrados por cualquier red que no sea de confianza.
:::

### Quién habla: personas y programas

En Alba hablan dos tipos de identidades:

- **Personas.** Ana entra al sitio desde su teléfono. Marta, la persona de guardia del equipo (la que atiende los problemas fuera de horario), entra a la consola de AWS, la página web desde donde se administra la nube, para revisar una falla. Una persona demuestra quién es con algo que sabe (una contraseña), algo que tiene (su teléfono) o algo que es (su huella).
- **Programas.** El backend de publicaciones llama al clasificador; Triton lee los pesos del modelo (los números que aprendió al entrenar) de S3, el almacén de archivos de AWS. Un programa no tiene huella ni teléfono: demuestra quién es con un secreto o con un token que le entrega alguien de confianza.

En la mayoría de los sistemas de ML, lo que más se diseña es lo segundo: **llamadas de servicio a servicio**. El inicio de sesión (*login*) de las personas lo resuelve el producto, casi siempre con piezas ya hechas. Pero conviene entender los dos, porque los errores son parecidos.

### 401 y 403: dos respuestas distintas

[[http|HTTP]] tiene un [[codigo-estado|código de estado]] para cada pregunta, y vale la pena no confundirlos:

| Código | Qué dice | Qué hace el cliente |
|---|---|---|
| **401** *Unauthorized* | «No sé quién eres»: falta la credencial, es falsa o ya caducó | Conseguir una credencial válida y volver a intentar |
| **403** *Forbidden* | «Sé quién eres, pero esto no te toca» | Nada: repetir no sirve; hay que pedir el permiso |

El nombre del 401 confunde: dice *Unauthorized*, pero significa «no autenticado». Es un error histórico del estándar. En el clasificador de Alba, una request sin credencial válida recibe 401 en la puerta de entrada y nunca llega al **gateway**, el programa que prepara la foto para el modelo. Una con credencial válida pero sin el permiso de clasificar recibe 403.

## Personas: contraseña, segundo factor y sesión {People: password, second factor and session}

Ana crea su cuenta con su correo y la contraseña `tenis2026`, y Alba tiene que reconocerla la próxima vez. La pregunta parece fácil: ¿qué guarda Alba en su base de datos?

### Nunca la contraseña

Lo más obvio sería guardar `tenis2026` tal cual y compararla cuando Ana vuelva. Es lo peor. Las bases de datos se roban: por un error de permisos, un respaldo olvidado o un empleado. Si la base guarda las contraseñas en claro (tal cual, legibles), quien la robe tiene la de cada persona. Y como mucha gente repite su contraseña, también tiene la de su correo y su banco.

La salida es guardar una **huella** de la contraseña, no la contraseña. Un [[hash-criptografico|hash criptográfico]], como SHA-256 (a fondo en «Tiempo, hashes e identificadores»), es una función que convierte cualquier texto en un número de tamaño fijo, fácil de calcular y prácticamente imposible de regresar al texto. Alba guarda el hash; cuando Ana vuelve, calcula el hash de lo que escribió y compara. Si coinciden, era la correcta, y Alba nunca tuvo que guardarla.

Pero un hash normal no basta: tiene dos problemas, cada uno con su arreglo.

### Problema 1: el hash rápido

SHA-256 está hecho para ser **rápido**: para que tu computadora calcule la huella de un archivo de varios GB en segundos. Para contraseñas, eso es justo lo malo. Quien robó la base no puede «regresar» el hash, pero sí puede **adivinar**: probar `aaaaaaaa`, `aaaaaaab`… calcular el hash de cada una y ver si coincide. Es un [[fuerza-bruta|ataque de fuerza bruta]], y con un hash rápido una sola tarjeta gráfica ([[gpu|GPU]]), que hace miles de cuentas a la vez, prueba miles de millones por segundo.

El arreglo es un **hash lento a propósito**: una función que repite la cuenta muchas veces, o que además gasta mucha memoria (lo que más le escasea a una GPU que corre miles de intentos a la vez), para que cada intento tarde, por ejemplo, decenas de milisegundos. Para Ana, esperar 50 ms al entrar no se nota. Para quien adivina, multiplicar el costo de cada intento convierte segundos en días, y días en años.

Esos 50 ms son en un solo [[nucleo|núcleo]] de una laptop: ahí saldrían 1 s ÷ 0.05 s = 20 intentos por segundo. Una GPU hace miles de intentos en paralelo, así que en total prueba del orden de 10⁴ por segundo, no 20.

Las funciones que se usan para esto son **bcrypt**, **scrypt**, **Argon2** (la recomendada hoy, en su variante Argon2id) y **PBKDF2**, que repite cientos de miles de veces un [[hmac|HMAC]] (un hash que mezcla el texto con una llave). PBKDF2 y scrypt ya vienen en la biblioteca estándar de Python (`hashlib`); Argon2 y bcrypt se instalan como paquetes aparte.

¿Cuánto tarda adivinar? Depende de cuántas contraseñas posibles hay y de cuántas prueba el atacante por segundo:

:::formula Tiempo para probar todas las contraseñas
C = a^m
t = frac{C}{v}
- a: cuántos símbolos puede tener cada carácter, en símbolos: 26 si solo son minúsculas, 62 con mayúsculas y dígitos
- m: el largo de la contraseña, en caracteres
- C: cuántas contraseñas posibles hay con ese largo y esos símbolos, en contraseñas
- v: cuántos intentos por segundo hace el atacante, en intentos/s
- t: el tiempo para probarlas todas, en segundos. En promedio atina a la mitad: \(t ÷ 2\)
:::

Los números de \(v\) son de una tarjeta gráfica de juego, una RTX 4090. Con SHA-256 calcula ≈ 2 × 10¹⁰ hashes por segundo: los ≈ 2.2 × 10¹⁰ medidos que usa «Cifrado, llaves y certificados», redondeados. Un hash lento bien configurado la baja a algo del orden de 10⁴ intentos por segundo: con PBKDF2 de 600,000 repeticiones da ≈ 1.5 × 10⁴, y aquí se redondea a 10⁴.

:::cuenta Ocho minúsculas, con hash rápido y con hash lento
Símbolos, \(a\) // solo minúsculas | dato del ejemplo | 26
Largo, \(m\) // 8 caracteres, como `tenisazo` | dato del ejemplo | 8
Contraseñas posibles, \(C\) | \(C = a^m\) = 26⁸ | ≈ 2.09 × 10¹¹
Con hash rápido, \(v\) // una RTX 4090 con SHA-256: ≈ 2.2 × 10¹⁰, redondeado | supuesto | 2 × 10¹⁰ intentos/s
Tiempo con hash rápido, \(t\) | \(C ÷ v\) = 2.09 × 10¹¹ ÷ (2 × 10¹⁰) | ≈ 10.4 s
Con hash lento, \(v\) // la misma GPU con PBKDF2: ≈ 1.5 × 10⁴, redondeado | supuesto | 10⁴ intentos/s
Tiempo con hash lento, \(t\) | \(C ÷ v\) = 2.09 × 10¹¹ ÷ 10⁴ | ≈ 2.09 × 10⁷ s
El mismo \(t\), en días | 2.09 × 10⁷ ÷ 86,400 s por día | ≈ 242 días
= El mismo largo pasa de ≈ 10 segundos a ≈ 242 días, solo por usar un hash lento. Con 12 caracteres de 62 símbolos (\(C\) = 62¹² ≈ 3.2 × 10²¹), el hash lento lo lleva a ≈ 10¹⁰ años.
:::

:::ojo
Esta cuenta supone contraseñas al azar. Las de verdad no lo son: `tenis2026` no se adivina probando letras en orden, sino con listas de las contraseñas más usadas y de las que ya se filtraron, más variaciones («tenis» + un año). Esas listas se prueban en segundos aun con hash lento. El hash lento compra tiempo; no salva una contraseña mala. Por eso la guía de contraseñas de NIST (la agencia de estándares de Estados Unidos) pide que, al crear o cambiar una contraseña, el sitio la rechace si aparece en una lista de contraseñas comunes o filtradas. Y por eso los buenos sitios piden además un segundo factor.
:::

### Problema 2: la misma contraseña, el mismo hash

Si Ana y Beto, otro vendedor de Alba, eligen los dos `tenis2026`, sus hashes son idénticos. Quien robe la base ve que comparten contraseña, y al adivinar una tiene las dos. Peor: el atacante puede calcular **una sola vez** los hashes de millones de contraseñas comunes, guardarlos en una tabla y buscar en ella los de cualquier base robada, sin volver a calcular nada.

El arreglo es la **sal** (*salt*): un número al azar, distinto para cada cuenta, que se mezcla con la contraseña antes del hash. La sal no es secreta: se guarda en claro junto al hash, porque Alba la necesita para repetir la cuenta. Lo que logra es que cada cuenta sea un problema aparte: la misma contraseña con dos sales da dos hashes sin parecido, y una tabla precalculada ya no sirve, porque tendría que calcularse de nuevo para cada sal.

Juntas, las dos ideas son el **[[contrasena-hash|hash de contraseña]]**: lo que se guarda es la sal y el hash lento de sal más contraseña, nunca la contraseña.

:::figura identidad-sal
Arriba, sin sal: Ana y Beto eligen `tenis2026` y la base guarda dos hashes iguales. Abajo, con sal: cada uno tiene la suya, y los hashes no se parecen. La sal se guarda en claro; lo que no se guarda es la contraseña.
:::

:::profundo Cuánto cuesta atacar muchas cuentas
:::formula Atacar muchas cuentas
t_U = U × frac{C}{v}
- U: cuántas cuentas robadas, cada una con su propia sal, en cuentas
- C, v: las mismas de arriba: contraseñas posibles e intentos por segundo
- t_U: el tiempo para probar todas las contraseñas en todas las cuentas, en segundos. Sin sal, \(t_U = C ÷ v\): una sola pasada sirve para todas
:::

Con 1 millón de cuentas robadas (\(U\) = 10⁶, un supuesto del ejemplo) y las ocho minúsculas con hash lento, \(t_U\) = 10⁶ × 242 días: unos 660,000 años. Sin sal, los mismos 242 días bastarían para todas.
:::

El código hace lo que guarda Alba, con PBKDF2 de la biblioteca estándar de Python, 600,000 repeticiones (lo que recomienda hoy OWASP, una organización abierta de seguridad web, para PBKDF2 con SHA-256) y sales fijas para que la salida no cambie:

```python
import hashlib, hmac

def guardar(contrasena, sal):        # lo que guarda Alba: la sal y el hash, nunca la contraseña
    h = hashlib.pbkdf2_hmac("sha256", contrasena.encode(), sal, 600_000)
    return sal, h

ana  = guardar("tenis2026", bytes.fromhex("a1b2c3d4e5f60718"))
beto = guardar("tenis2026", bytes.fromhex("0f1e2d3c4b5a6978"))  # misma contraseña, otra sal
print("Ana: ", ana[0].hex(), ana[1].hex()[:16])                # 16 de los 64 dígitos
print("Beto:", beto[0].hex(), beto[1].hex()[:16])
print("SHA-256 sin sal:", hashlib.sha256(b"tenis2026").hexdigest()[:16])

def revisar(intento, guardado):
    sal, h = guardado
    _, h2 = guardar(intento, sal)    # repite la cuenta con la misma sal
    return hmac.compare_digest(h, h2)

print(revisar("tenis2026", ana), revisar("tenis2025", ana))
```

```salida
Ana:  a1b2c3d4e5f60718 86de24cc80815a5b
Beto: 0f1e2d3c4b5a6978 e605e63099b8c9a5
SHA-256 sin sal: 247214dc7f0901b3
True False
```

La misma contraseña da dos hashes sin parecido. En una laptop, cada `guardar` tarda ≈ 50 ms; un SHA-256 suelto, menos de un microsegundo (una millonésima de segundo). En un sistema real, la sal no es fija: sale de `secrets.token_bytes(16)`, 16 bytes al azar. Y `hmac.compare_digest` es una comparación como `==`, hecha para no dar pistas por el tiempo que tarda.

:::profundo Por qué se compara con `hmac.compare_digest`
`==` se sale en la primera diferencia, y su tiempo, medido muchas veces, le diría a un atacante cuántos bytes del valor esperado atinó; `hmac.compare_digest` tarda lo mismo falle donde falle. Con el hash de una contraseña eso le sirve poco (no sabe la sal), pero con una firma, como la del JWT de más abajo, sí: la idea completa está en «Cifrado, llaves y certificados».
:::

:::calculadora identidad-contrasena
Empieza con las ocho minúsculas y el hash lento de la cuenta, \(v\) = 10,000 intentos por segundo. Cambia \(v\) a 20,000,000,000 (un hash rápido en la GPU) y mira cómo los ≈ 242 días se vuelven ≈ 10 segundos. Luego regresa \(v\) a 10,000 y sube \(m\) de uno en uno: cada carácter más multiplica el tiempo por \(a\).
:::

### Un segundo factor

Aun con el mejor hash, una contraseña se puede robar de otras maneras: Ana la escribe en una página falsa que imita a Alba (*phishing*), o la usa también en otro sitio que guardaba todo en claro. Por eso existe la **[[mfa|autenticación multifactor]]** (*multi-factor authentication*, MFA): pedir, además de algo que sabes, algo que **tienes** o algo que **eres**.

El más común es un código de 6 dígitos que cambia cada 30 segundos en una app del teléfono. El más fuerte es una *passkey* (una llave guardada en tu teléfono que firma por ti) o una llave física (un aparatito USB que hace lo mismo): las dos firman solo para el sitio verdadero, así que en una página falsa no sirven.

:::profundo Tres segundos factores, de más débil a más fuerte
- **Un código que cambia cada 30 segundos** en una app del teléfono (TOTP, *time-based one-time password*). La app y el servidor comparten un secreto desde el día en que escaneaste un código QR; cada uno calcula un HMAC del secreto con la hora, y de ahí salen 6 dígitos. Si coinciden, tienes el teléfono.
- **Un código por SMS.** Mejor que nada, pero el más débil: un atacante puede convencer a la compañía de teléfono de pasarle tu número a otra tarjeta SIM (el chip del teléfono).
- **Una llave física o una *passkey*.** El teléfono o la llave guardan una llave privada que nunca se le entrega al sitio, y firman un reto que manda el sitio. (En una llave física, la llave privada no sale nunca del aparato; una *passkey* puede copiarse, cifrada, entre tus dispositivos, por ejemplo con tu cuenta de Apple o de Google.) La firma va ligada al nombre del sitio, así que en una página falsa no sirve: es la única de las tres que resiste el phishing.
:::

En Alba, el segundo factor de las vendedoras es opcional. Para Marta y el resto del equipo, que pueden tocar la infraestructura, conviene que sea obligatorio.

### La sesión: no pedir la contraseña en cada clic

Ana no escribe su contraseña cada vez que abre una página. Después de entrar, el servidor crea una **[[sesion|sesión]]**: un número largo al azar (el id de sesión) que guarda en su base junto con «es Ana, entró a tal hora», y que le entrega al navegador en una [[cookie]]. El navegador la regresa sola en cada request a Alba, y el servidor la busca: «este número es de Ana».

Ese número vale tanto como la contraseña mientras dure: quien lo copie es Ana. Por eso la cookie se marca con tres opciones:

- `Secure`: solo viaja por [[https|HTTPS]], cifrada.
- `HttpOnly`: el código JavaScript de la página (los programas que corren dentro de ella) no la puede leer, así que un script malicioso no la roba.
- `SameSite`: el navegador no la manda cuando la request la provoca otro sitio; así una página ajena no puede hacer que tu navegador le pida algo a Alba a tu nombre. Con `Strict`, nunca la manda; con `Lax`, solo si la persona sigue un enlace hacia Alba.

Y por eso la sesión caduca, y al salir se borra del servidor: ahí sí se puede «apagar», porque el servidor la guarda.

## Máquinas: llaves de API y tokens Bearer {Machines: API keys and bearer tokens}

Un programa no escribe contraseñas ni tiene teléfono. Lo más simple que puede mostrar es un secreto que el otro lado reconoce.

### La llave de API

Una **[[api-key|llave de API]]** (*API key*) es un texto largo al azar, como `ak_live_7Hq2…`, que el servidor genera, le entrega al cliente y reconoce. El cliente la manda en cada request, en un [[header]]. Es lo que te dan muchos servicios de pago cuando te registras para usar su API.

Es fácil de usar y por eso está en todos lados, pero tiene problemas serios:

- **Casi nunca caduca.** Algunos servicios dejan ponerle fecha, pero lo normal es que viva meses o años, hasta que alguien la cambia a mano.
- **Se filtra.** Termina en un repositorio, en un log, en un mensaje de chat o en una captura de pantalla. Quien la encuentre es el cliente, sin límite de tiempo.
- **Rotarla rompe al cliente.** Rotarla es cambiarla por una nueva ([[rotacion-secretos|rotación]]), y eso obliga a actualizar cada programa que la usa al mismo tiempo, o a aceptar dos llaves válidas un rato.
- **No dice nada.** El servidor tiene que buscarla en su base para saber de quién es y qué puede hacer.

Si se usa, se guarda como una contraseña: el servidor guarda solo su hash (aquí basta un hash rápido como SHA-256, porque la llave es larga y al azar: no hay lista de «llaves comunes» que probar), y el cliente la guarda en un [[gestor-secretos|gestor de secretos]], nunca en el código.

### El token de acceso

La mejora es no mandar el secreto de larga vida en cada request. El cliente usa su secreto **una vez**, ante alguien en quien todos confían, y a cambio recibe un **[[token-acceso|token de acceso]]** (*access token*): un permiso que dura poco, por ejemplo 15 minutos, y que es lo que viaja en cada request.

Viaja en el header `Authorization`, con la palabra `Bearer` («portador») antes: una request al clasificador de Alba lleva `Authorization: Bearer eyJhbGciOiJSUzI1NiIs…`, seguido de cientos de caracteres más, junto a los headers de siempre y los bytes de la foto.

«Portador» quiere decir exactamente eso: **quien lo porta, lo usa**. El servidor no pregunta quién lo trae; si el token es bueno, pasa. Es como un billete: no tiene tu nombre, y quien lo tenga lo gasta. El parecido se rompe en que un billete vale para siempre, y un token, minutos. Por eso un token de acceso viaja por HTTPS, no se escribe en los logs y caduca pronto: si se filtra, el daño dura minutos, no meses.

En Alba, el token va cifrado hasta el **ALB** (*Application Load Balancer*), el [[alb|balanceador]] de AWS que recibe todas las requests de fuera: la puerta de entrada. De ahí al gateway sigue sin cifrar, por la red privada del clúster (el grupo de máquinas donde corren los programas de Alba). Es una decisión de Alba, que protege esa red con reglas de quién puede hablarle a quién.

Queda una pregunta: ¿cómo sabe el servidor que un token es bueno sin buscarlo en una base en cada request? Esa es la gracia del JWT.

## JWT por dentro: encabezado, claims y firma {Inside a JWT: header, claims and signature}

Un **[[jwt|JWT]]** (*JSON Web Token*, que se pronuncia «jot» en inglés) no es un mecanismo de autenticación: es un **formato**. Es un texto con tres partes separadas por puntos, `encabezado.claims.firma`:

- El **encabezado** (*header*) es un [[json|JSON]] chiquito que dice cómo se firmó: `{"alg": "RS256", "typ": "JWT", "kid": "2026-11"}`. `alg` es el algoritmo de la firma y `kid`, el nombre de la llave con que se firmó.
- Los **[[claims]]** (las «afirmaciones») son otro JSON con lo que el token dice: quién es, para quién es y hasta cuándo vale.
- La **firma** es una [[firma-digital|firma digital]] de las dos primeras partes, hecha por quien emitió el token.

Cada parte se escribe en **base64url**: una variante de [[base64]] que cambia `+` y `/` por `-` y `_` y quita el relleno `=`, para que el token se pueda poner en una URL o en un header sin problemas. Ojo: base64 no es cifrado. **Cualquiera que tenga el token puede leer sus claims**, solo con decodificarlo. Lo que no puede es cambiarlos sin romper la firma. Por eso en un JWT van ids y permisos, nunca secretos ni datos personales que no hagan falta.

:::figura identidad-jwt
Las tres partes de un JWT, separadas por puntos. Las dos primeras son JSON en base64url y cualquiera las lee. La tercera es la firma de las dos primeras: si alguien cambia un solo carácter de los claims, la firma ya no coincide. Es el token de juguete del código de más abajo, firmado con HS256; el de Alba usa RS256.
:::

### Los claims

Los claims que define el estándar de JWT (el RFC 7519; los RFC son los documentos públicos que fijan los estándares de internet) tienen nombres cortos, de tres letras. Se pueden agregar otros: `scope`, por ejemplo, viene de los estándares de OAuth, que ves más abajo.

| Claim | Nombre | Qué dice | En el token de moderación |
|---|---|---|---|
| `iss` | *issuer*, emisor | Quién emitió el token | `idp.alba.internal` |
| `sub` | *subject*, sujeto | De quién es | `moderacion` |
| `aud` | *audience*, audiencia | Para quién es: qué servicio lo debe aceptar | `classifier` |
| `exp` | *expiration* | Hasta cuándo vale, en segundos desde 1970 | emitido + 900 s |
| `iat` | *issued at* | Cuándo se emitió | — |
| `jti` | *JWT id* | Un id único de este token | `t-5f1c…` |
| `scope` | alcance (no es del RFC 7519) | Qué permite | `classify` |

`exp` y `iat` se escriben en [[tiempo-unix|tiempo Unix]]: los segundos que han pasado desde el 1 de enero de 1970, una forma de escribir un instante con un solo número. Por ejemplo, 1700000000 es el 14 de noviembre de 2023.

La `aud` importa más de lo que parece: un token que el emisor le dio a moderación para hablar con **otro** servicio también lleva una firma buena. Si el clasificador no revisa que `aud` diga `classifier`, aceptaría tokens que no eran para él.

### Verificar sin preguntarle a nadie

La gracia del JWT es que el servidor lo **verifica solo**, sin llamar a nadie. Revisa, en este orden:

:::pasos
1. La firma
Con la llave del emisor, comprueba que la firma corresponde al encabezado y los claims. Si alguien cambió algo, no coincide. Si no coincide, 401.
2. El emisor y la audiencia
`iss` tiene que ser el emisor en el que confía, y `aud` tiene que ser él mismo. Si no, 401.
3. Las fechas
`exp` tiene que estar en el futuro, con un margen de unos segundos porque los relojes de dos máquinas nunca marcan exactamente la misma hora ([[desfase-reloj|desfase de reloj]]). Si ya pasó, 401.
4. El permiso
Y ahora sí, con la identidad comprobada, autoriza: ¿el `scope` incluye lo que pide? Si no, 403.
:::

Hay dos maneras de firmar, y el encabezado dice cuál se usó:

- **HS256**: un [[hmac|HMAC]] con SHA-256, es decir, una huella que solo puede calcular quien tiene la llave, que aquí es **compartida**. Quien verifica tiene la misma llave que quien firma, así que también podría fabricar tokens. Sirve si el que emite y el que verifica son el mismo programa.
- **RS256** o **ES256**: una firma con [[llave-asimetrica|llave asimétrica]]. El emisor firma con su llave privada, que nunca sale de él, y cualquiera verifica con la llave pública. Quien verifica no puede fabricar tokens. Es lo normal cuando muchos servicios verifican los tokens de un solo emisor.

El código arma y verifica un JWT a mano, con HS256 y una llave de juguete (con RS256 haría falta una biblioteca de criptografía que no viene con Python). El token dura 900 segundos, 15 minutos; los tiempos son fijos para que la salida no cambie:

```python
import base64, hashlib, hmac, json

def b64(datos):                               # base64url sin el relleno «=»
    return base64.urlsafe_b64encode(datos).rstrip(b"=").decode()
def firmar(texto, llave):
    return b64(hmac.new(llave, texto.encode(), hashlib.sha256).digest())

llave = b"secreto-de-juguete"                 # solo para este ejemplo (HS256)
encabezado = {"alg": "HS256", "typ": "JWT"}
claims = {"iss": "idp.alba.internal", "sub": "moderacion", "aud": "classifier",
          "scope": "classify", "iat": 1700000000, "exp": 1700000900}
cuerpo = b64(json.dumps(encabezado).encode()) + "." + b64(json.dumps(claims).encode())
token = cuerpo + "." + firmar(cuerpo, llave)
print(len(token), token[:40] + "…")

def verificar(token, ahora):
    e, c, f = token.split(".")
    if not hmac.compare_digest(f, firmar(e + "." + c, llave)): return "firma mala"
    datos = json.loads(base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)))
    if datos["iss"] != "idp.alba.internal" or datos["aud"] != "classifier": return "no es para mí"
    if ahora >= datos["exp"]: return "caducó"
    return "ok: " + datos["sub"]

print(verificar(token, 1700000300))           # 5 minutos después de emitido
print(verificar(token, 1700001000))           # a los 16 minutos y 40 s
falso = dict(claims, sub="backend-publicaciones")   # alguien cambia el sub…
c2 = b64(json.dumps(falso).encode())
print(verificar(token.split(".")[0] + "." + c2 + "." + token.split(".")[2], 1700000300))
```

```salida
257 eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9…
ok: moderacion
caducó
firma mala
```

Fíjate en el último: cambiar `sub` para hacerse pasar por el backend de publicaciones es fácil, porque los claims se leen y se escriben con base64. Lo que no se puede es firmarlo sin la llave. Y fíjate en que `verificar` **no lee el `alg` del token**: siempre usa el algoritmo que espera. Hubo bibliotecas que sí lo leían, y bastaba un token con `"alg": "none"` (sin firma) para que lo aceptaran. Quien verifica decide el algoritmo, nunca el token.

### JWKS: dónde están las llaves públicas

Si el emisor firma con su llave privada, los servicios necesitan su llave pública. El emisor la publica en una dirección fija, como un JSON con una lista de llaves: el **[[jwks|JWKS]]** (*JSON Web Key Set*). Cada llave lleva un id, el `kid`, y el encabezado de cada token dice con cuál `kid` se firmó.

Quien verifica guarda el JWKS en memoria y lo vuelve a bajar cada tanto, o cuando ve un `kid` que no conoce. No lo baja en cada request: eso volvería a poner al emisor en el camino de cada llamada.

:::profundo Cambiar las llaves sin cortar el servicio, y el JWKS en el ALB
Con el `kid` se cambian las llaves sin cortar el servicio: el emisor publica la llave nueva junto a la vieja, empieza a firmar con la nueva y, cuando los últimos tokens viejos ya caducaron, quita la vieja.

Un ejemplo concreto: el ALB de AWS, la puerta de entrada de Alba, verifica JWT desde noviembre de 2025. Según su documentación (noviembre de 2026), solo acepta tokens RS256 con llaves de 2,048 bits, y baja el JWKS de una dirección que tiene que ser pública. No hay problema en eso: son llaves públicas. Lo que sí queda en la red interna de Alba es el lugar donde los callers piden sus tokens.
:::

## Vida corta y revocación {Short lifetime and revocation}

Verificar sin preguntarle a nadie tiene un precio: **nadie le puede avisar** al servidor que un token ya no vale. Un JWT no se puede «des-firmar»: hasta su `exp`, la firma sigue siendo buena.

Cancelar una credencial antes de que caduque se llama **[[revocacion-token|revocación]]**. Con una sesión es fácil: se borra de la base del servidor. Con un JWT, hay dos maneras, y las dos le quitan su ventaja:

- **Una lista de tokens revocados**, por su `jti`, que cada servicio consulta. Ya no verifica solo: tiene que leer esa lista.
- **Preguntarle al emisor** si el token sigue vivo (lo que OAuth, el estándar de la sección siguiente, llama *introspección*). Eso es otra llamada en el camino de cada request.

La salida que se usa casi siempre es otra: **que el token dure poco**. Si un token robado vale como mucho 15 minutos, el daño se acaba solo. Lo común es una vida de 5 a 60 minutos, aunque varios servicios que emiten tokens dan más si no se cambia (Microsoft Entra ID, entre 60 y 90 minutos; Auth0, 24 horas): la vida es algo que se configura. Y el cliente no pide un token por request: **lo guarda en memoria y pide otro antes de que caduque**.

:::figura identidad-vida
Arriba, los tokens de un caller: cada uno vale 15 minutos y el siguiente se pide a los 12, para que nunca haya un hueco. En medio, un token robado en el minuto 5: sirve solo hasta el minuto 15. Abajo, una llave de API robada: sirve hasta que alguien se dé cuenta y la cambie.
:::

¿Y cuánto trabajo le da eso al emisor? Poco, si cada caller guarda su token en [[cache|caché]] (en memoria, para reusarlo) en vez de pedir uno por request:

:::formula Tokens que se piden al día
n = I × frac{1,440}{R}
- I: cuántas instancias piden su propio token, en instancias. Una instancia es una copia del programa corriendo; cada una guarda su token. Si hay varios callers, se suman las de todos
- R: cada cuántos minutos se renueva el token, en min. Tiene que ser menor que su vida, \(D\)
- D: la vida del token, en min: lo que vale un token robado, como mucho
- 1,440: los minutos de un día
- n: cuántos tokens pide al emisor, en tokens por día
:::

:::cuenta Los tokens de los tres callers de Alba
Vida del token, \(D\) // la de Alba | ficha de Alba | 15 min
Renovación, \(R\) // supuesto: 3 minutos antes de caducar | \(D\) − 3 = 15 − 3 | 12 min
Instancias, \(I\) // supuesto: 4 copias de cada uno de los 3 callers | 3 × 4 | 12
Tokens al día, \(n\) | \(n = I × 1,440 ÷ R\) = 12 × 1,440 ÷ 12 | 1,440
Pedidos por segundo // 86,400 son los segundos de un día | \(n ÷ 86,400\) = 1,440 ÷ 86,400 | ≈ 0.017 por s
Sin caché, un token por request // las ≈ 10 M fotos al día de Alba, una por request | 10,000,000 ÷ 86,400 | ≈ 116 por s
= Con caché, el emisor entrega ≈ 1,440 tokens al día, uno cada minuto. Sin caché serían ≈ 116 por segundo, y cada request de Ana esperaría una llamada más. Y un token robado vale, como mucho, \(D\) = 15 minutos.
:::

:::calculadora identidad-token
Empieza con los callers de Alba. Baja \(D\) a 5 minutos (y \(R\) a 4): la ventana de un token robado se reduce a un tercio y el emisor recibe el triple de pedidos, que siguen siendo pocos. Sube \(I\) a 500, como en un sistema enorme, y mira cuándo empieza a ser una carga.
:::

:::profundo Si de verdad hay que cortar ya
Cuando el riesgo lo pide (un empleado que se va, una cuenta robada), se combinan las dos cosas: tokens cortos y una lista de revocados chiquita, que solo guarda los tokens cancelados que todavía no caducan. Esa lista se vacía sola, porque a los 15 minutos ya no hace falta.
:::

## OAuth y client credentials: el token de los callers de Alba {OAuth and client credentials: how Alba's callers get their token}

Ya tienes las piezas: un token corto, firmado, que se verifica sin preguntar. Falta quién lo emite y cómo se pide.

### El proveedor de identidad

El **[[proveedor-identidad|proveedor de identidad]]** (*identity provider*, IdP) es el servicio que sabe quién es quién y emite los tokens. Guarda la lista de clientes y usuarios, revisa sus credenciales y firma los tokens con su llave privada. Ejemplos: Okta, Auth0, Microsoft Entra ID, Keycloak (que una empresa instala en sus propias máquinas) o Cognito de AWS. Alba tiene uno interno.

Tener un solo emisor es lo que deja que muchos servicios confíen en los mismos tokens: todos verifican con el mismo JWKS.

### OAuth: un permiso sin dar la contraseña

**[[oauth|OAuth 2.0]]** es el marco estándar para que un programa obtenga un token de acceso **sin conocer la contraseña** de nadie. Nació para casos como este: una app de fotos quiere publicar en tu red social. En vez de darle tu contraseña a la app, la red social te pregunta «¿dejas que esta app publique por ti?», y si dices que sí, le entrega a la app un token que **solo** sirve para publicar y que puedes retirar.

OAuth define varios caminos (*flujos*) para pedir un token, según quién lo pide. Para una persona en un navegador hay uno con redirecciones (el navegador te lleva a la página del proveedor y luego te regresa a la app) y una pantalla de permiso. Para un programa que habla por sí mismo, sin ninguna persona de por medio, está el más simple de todos.

### Client credentials: máquina a máquina

En el flujo de **[[client-credentials|client credentials]]** (credenciales de cliente), el programa se presenta ante el proveedor de identidad con su nombre de cliente (`client_id`) y su secreto (o con un [[certificado]]), y recibe un token. No hay persona ni pantalla. Es lo que hacen los 3 callers de Alba: cada uno recibe un token de 15 minutos. El secreto de moderación vive en el gestor de secretos y se usa una vez cada 12 minutos, al renovar el token, no en cada request al clasificador.

:::profundo La request por dentro
Así se ve el pedido de moderación. Es solo una ilustración (el parámetro `audience` no es del estándar base de OAuth: lo agregan varios proveedores para decir para qué servicio es el token):

```http
POST /oauth2/token HTTP/1.1
Host: idp.alba.internal
Content-Type: application/x-www-form-urlencoded
Authorization: Basic bW9kZXJhY2lvbjrigKY=

grant_type=client_credentials&scope=classify&audience=classifier
```

Es un `POST`, el [[metodo-http|método HTTP]] para mandar datos, a la ruta de tokens del proveedor. El cuerpo, la última línea, va en formato de formulario web (eso dice `Content-Type`): pares `nombre=valor` unidos con `&`. Dice qué flujo se usa (`grant_type`), qué permiso se pide (`scope`) y para qué servicio (`audience`). El `Authorization: Basic` lleva el `client_id` y el secreto en base64, que no es cifrado: por eso va por HTTPS.

La respuesta trae el token y su vida: `{"access_token": "eyJ…", "token_type": "Bearer", "expires_in": 900}`. Novecientos segundos son los 15 minutos de Alba.
:::

### El scope: qué permite el token

El **[[scope]]** (alcance) es la lista de permisos que lleva el token. El de los callers de Alba dice `classify`: sirve para pedir una clasificación y nada más. Si el clasificador tuviera una ruta de administración (una ruta es una dirección dentro del servicio, como `/v1/classify`; esta serviría, por ejemplo, para cambiar la versión del modelo), pediría otro scope, digamos `classifier:admin`, que ningún caller tiene. Un token robado de búsqueda clasifica fotos; no cambia el modelo.

El scope es una autorización **gruesa**: dice qué tipo de cosas puede hacer el portador. La fina, «¿esta publicación es tuya?», no cabe en un token: se revisa en el servidor.

### El camino completo en Alba

:::diagrama identidad-callers
Los tres callers piden su token al proveedor de identidad y lo guardan. En cada request, el ALB lo verifica con el JWKS y el gateway decide con el `client_id` verificado. Toca cada caja para ver qué revisa.
:::

El ALB, la puerta de entrada, descifra la conexión HTTPS y verifica el JWT: firma, emisor, audiencia y fecha. (La firma, el emisor y `exp` el ALB los revisa siempre; la audiencia, porque Alba se la configura como un claim extra que tiene que coincidir.) Una request sin token válido recibe 401 ahí mismo y nunca llega al gateway, el programa en Python que prepara la foto para el modelo.

Si el token es bueno, el ALB lo pasa tal cual. El gateway lee el `client_id` de sus claims, que el ALB ya verificó, y con él toma tres decisiones:

- **El permiso.** ¿El scope trae `classify`? Si no, 403.
- **La cuota.** Cada caller tiene su **[[cuota-por-cliente|cuota]]**, y se cuenta por el `client_id` verificado: la de moderación es de 50 requests por segundo. Si se pasa, recibe **429**, *Too Many Requests*, y los otros dos callers ni se enteran. Cómo se cuenta una cuota y qué pasa cuando el gateway corre en varios pods lo explica «Balanceadores, proxies y gateways».
- **La prioridad.** Las fotos que está publicando una persona van antes que las tandas (lotes de muchas fotos que no tienen prisa) de moderación.

:::ojo La identidad que cuenta es la verificada
Sería muy cómodo que cada caller mandara un header `X-Caller: moderacion` y que el gateway decidiera la cuota con eso. Pero ese header lo escribe el caller: un programa con un error, o alguien que quiere más cuota, escribe `X-Caller: backend-publicaciones` y listo. Toda decisión de permisos, cuota o prioridad sale del `client_id` del **token verificado**, nunca de algo que el cliente declara de sí mismo. Lo mismo vale para la dirección IP (el número que identifica a una máquina en la red): detrás de una red compartida hay muchos clientes con la misma IP, y uno solo puede usar muchas.
:::

## Autorización: roles, dueños e IDOR {Authorization: roles, owners and IDOR}

La autenticación terminó: el sistema sabe que es Ana. Ahora la pregunta es otra: ¿qué le deja hacer?

### RBAC: permisos por rol

Darle permisos a cada persona una por una se vuelve imposible con miles de usuarios. Lo normal es agruparlos: el **[[rbac|RBAC]]** (*role-based access control*, control de acceso por roles) define **roles** con un conjunto de permisos, y a cada identidad le asigna uno o varios roles.

| Rol | Ejemplo en Alba | Puede |
|---|---|---|
| vendedora | Ana | crear y editar **sus** publicaciones |
| soporte | Marta, de guardia | leer cualquier publicación para ayudar; no editarlas |
| caller `classify` | moderación, búsqueda, backend | pedir clasificaciones |

Cuando alguien cambia de puesto, se le cambia el rol, no cincuenta permisos sueltos. Las [[politica-permisos|políticas]] de [[iam|IAM]] (el sistema de permisos de AWS) y los roles de Kubernetes son variantes del mismo patrón. Ojo con la tentación de un rol que lo pueda todo «por mientras»: el [[minimo-privilegio|mínimo privilegio]] (cada identidad con solo los permisos que necesita) aplica igual a personas y a programas.

### IDOR: el id en la URL

Ana edita su publicación con una request como `PATCH /publicaciones/8811` (`PATCH` es el método HTTP para cambiar parte de algo; 8811 es el id, el número de su publicación). El servidor revisa la sesión: es Ana, tiene el rol de vendedora, puede editar publicaciones. ¿Y si Ana cambia el número a `8812`, que es la bici de Beto?

Si el servidor solo revisó «¿hay sesión?» y «¿puede editar publicaciones?», edita la de Beto. Este error tiene nombre: **[[idor|IDOR]]** (*insecure direct object reference*, referencia directa insegura a un objeto). La request pide un objeto por su id y el servidor no revisa **de quién es** ese objeto. Es de los fallos más comunes en APIs reales, y es difícil de ver en pruebas: con un solo usuario de prueba, todo funciona.

El arreglo es una línea, y va **en el servidor**, en cada request: además de quién eres y qué rol tienes, ¿este objeto es tuyo? Esconder el botón de «editar» en la pantalla no sirve: la request se puede escribir a mano.

```python
publicaciones = {8811: {"dueña": "ana", "titulo": "Tenis blancos"},
                 8812: {"dueña": "beto", "titulo": "Bici de ruta"}}
roles = {"ana": "vendedora", "beto": "vendedora", "marta": "soporte"}
permisos = {"vendedora": {"editar_propia"}, "soporte": {"leer_cualquiera"}}

def editar_mal(usuario, pub_id):              # solo revisa que haya sesión
    return "editada" if usuario else "401"

def editar_bien(usuario, pub_id):
    if not usuario: return "401"                          # ¿quién eres?
    pub = publicaciones.get(pub_id)
    if pub is None: return "404"
    if "editar_propia" in permisos[roles[usuario]] and pub["dueña"] == usuario:
        return "editada"                                  # ¿es tuya?
    return "403"

for quien, pid in [("ana", 8811), ("ana", 8812), ("marta", 8812), (None, 8811)]:
    print(quien, pid, editar_mal(quien, pid), editar_bien(quien, pid))
```

```salida
ana 8811 editada editada
ana 8812 editada 403
marta 8812 editada 403
None 8811 401 401
```

La versión mala deja a Ana editar la bici de Beto y a Marta, que solo debía leer, editar cualquier cosa. La buena revisa las tres cosas: sesión (401), rol y dueño (403).

:::diagrama identidad-ana
Ana entra con contraseña y segundo factor, y recibe una sesión. Cada edición pasa por dos revisiones en el servidor: quién es (la sesión) y si la publicación es suya. Recorre el caso en que cambia el id en la URL.
:::

### ¿Y si los ids no se pueden adivinar?

Una defensa que se oye mucho es usar ids al azar en vez de números seguidos (con ids seguidos, quien vea el 8811 sabe que el 8812 existe). Ayuda, pero no protege: los ids viajan en los enlaces que la gente comparte. Lo que de verdad protege es la revisión del dueño.

:::profundo Cuánto frenan los ids al azar
:::formula Atinar a un id que existe
p = frac{E}{K}
t_{id} = frac{K}{E × v}
- E: cuántos ids existen de verdad, en ids
- K: cuántos ids posibles hay, en ids
- p: la probabilidad de que un intento al azar atine a uno que existe, entre 0 y 1
- v: intentos por segundo del atacante, en intentos/s (la misma letra de las contraseñas)
- t_{id}: el tiempo esperado para atinar al primer id que existe, en segundos: se necesitan, en promedio, \(1 ÷ p = K ÷ E\) intentos
:::

:::cuenta Ids seguidos contra ids al azar, con las publicaciones de Alba
Ids que existen, \(E\) // publicaciones activas de Alba | ficha de Alba: ≈ 100 M | 10⁸
Ids seguidos, \(p\) // del 1 al último: \(K\) ≈ \(E\) | \(E ÷ K\) ≈ 10⁸ ÷ 10⁸ | ≈ 1
Ids al azar de 64 [[bit\|bits]], \(K\) // cada bit duplica las opciones | 2⁶⁴ | ≈ 1.84 × 10¹⁹
Probabilidad por intento, \(p\) | \(E ÷ K\) = 10⁸ ÷ 1.84 × 10¹⁹ | ≈ 5.4 × 10⁻¹²
Intentos esperados, \(1 ÷ p\) | \(K ÷ E\) = 1.84 × 10¹⁹ ÷ 10⁸ | ≈ 1.84 × 10¹¹
Ritmo del atacante, \(v\) // frenado por una cuota | supuesto | 1,000 intentos/s
Tiempo esperado, \(t_{id}\) | \(K ÷ (E × v)\) = 1.84 × 10¹¹ ÷ 1,000 | ≈ 1.84 × 10⁸ s
El mismo \(t_{id}\), en años // un año ≈ 3.16 × 10⁷ s | 1.84 × 10⁸ ÷ 3.16 × 10⁷ | ≈ 5.8 años
= Con ids seguidos, adivinar es trivial. Con 64 bits al azar y una cuota, el primer acierto tarda años; con un [[uuid|UUID]] al azar, de 122 bits, \(p\) baja a ≈ 1.9 × 10⁻²⁹. Pero el id sigue siendo público: viaja en enlaces que la gente comparte. Los ids al azar frenan la búsqueda a ciegas; la revisión del dueño es lo que de verdad protege.
:::
:::

:::profundo ¿403 o 404?
Si Ana pide una publicación ajena **privada** (un borrador de Beto), responder 403 le confirma que existe. Por eso muchos sistemas responden **404**, «no existe», tanto si no existe como si no es suya: no filtran ni siquiera la existencia. En el código de arriba la bici de Beto es pública, así que 403 no revela nada. Lo que no cambia: la revisión se hace siempre, y en el servidor.
:::

## Máquinas en la nube, OIDC y auditoría {Machines in the cloud, OIDC and audit} [extra]

Hasta aquí, los programas se identificaban ante el clasificador. Pero los pods de Alba (cada pod es una copia de un programa corriendo en Kubernetes) también le hablan a AWS: Fluent Bit (el programa que junta logs) escribe en S3, Triton lee los pesos del modelo. ¿Con qué se identifican?

### Sin llaves guardadas

Lo peor sería una llave de AWS de larga vida dentro de la imagen del [[contenedor]] (el paquete con el programa y todo lo que necesita para correr) o en una [[variable-entorno|variable de entorno]]: es una llave de API con poder sobre la nube, y se filtra igual que cualquier otra. La salida, que «Servicios gestionados, serverless y permisos» cuenta a fondo, es la [[identidad-workload|identidad del workload]] (*workload* es el programa que corre). Cada pod corre con su [[cuenta-servicio|cuenta de servicio]] de Kubernetes, y esa cuenta se liga a un [[rol-iam|rol de IAM]]. El pod recibe [[credenciales-temporales|credenciales temporales]] que caducan solas, sin que nadie guarde una llave.

En Alba, cada rol tiene solo lo que su pod necesita. En S3, los archivos (objetos) viven en un [[bucket-objetos|bucket]], y un **prefijo** es el principio de su nombre, como una carpeta: `logs/`. Fluent Bit solo escribe en el prefijo de logs; el job de etiquetado (la tarea que manda fotos a que personas les pongan la categoría correcta) solo lee el prefijo de fotos a etiquetar; Triton solo lee el prefijo del modelo. La política de Fluent Bit se ve más o menos así (ilustración; el nombre del bucket es inventado):

```json
{ "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow",
                  "Action": "s3:PutObject",
                  "Resource": "arn:aws:s3:::alba-ml-datos/logs/*" }] }
```

`Action` dice qué puede hacer (`s3:PutObject`, escribir un objeto) y `Resource`, sobre qué: un ARN, el nombre único de un recurso en AWS, aquí todo lo que empieza con `logs/` en ese bucket. Puede **escribir** objetos, y solo bajo `logs/`. No puede leer, ni borrar, ni tocar las fotos. Si alguien toma el pod de Fluent Bit, lo más que logra es escribir logs. Y como el bucket va cifrado con SSE-KMS, el rol también aparece en la política de la llave, con permiso para pedir llaves de datos y no para descifrar (lo ves en «Cifrado, llaves y certificados»). Ojo: escribir incluye **sobrescribir** un objeto que ya existe con el mismo nombre. Si eso importa, se activa el versionado del bucket, que guarda la versión anterior.

### OIDC: identidad encima de OAuth

OAuth da permisos; no dice quién es la persona. **[[oidc|OIDC]]** (*OpenID Connect*) es una capa encima de OAuth que agrega eso: además del token de acceso, el proveedor entrega un **ID token**, un JWT con quién es el usuario (`sub`, su correo, su nombre), para la app que lo pidió. Es lo que pasa detrás de un botón de «Iniciar sesión con Google»: la app nunca ve tu contraseña, solo un token firmado por Google que dice quién eres.

OIDC también sirve para máquinas, y eso explica dos cosas que ya usas:

- **La identidad de los pods en EKS** (el Kubernetes gestionado de AWS). Con IRSA (*IAM Roles for Service Accounts*, roles de IAM para cuentas de servicio), el clúster actúa como un proveedor OIDC: firma un JWT que dice «soy el pod con la cuenta de servicio `classifier/triton`», y AWS lo cambia por credenciales temporales del rol ligado.
- **Los tokens del pipeline de [[ci|CI]]** (el proceso que prueba y publica el código en cada cambio). Un job de [[github-actions|GitHub Actions]] puede pedir un JWT firmado por GitHub que dice de qué repositorio y rama viene, y cambiarlo por credenciales de AWS. Así el pipeline publica una imagen sin una llave de AWS guardada en sus secretos.

En los dos casos el truco es el mismo de esta lección: un emisor de confianza firma un token corto, y el otro lado lo verifica con su llave pública.

### El registro de auditoría

Autenticar y autorizar decide qué pasa. Falta poder contestar, después, **qué pasó**: quién hizo qué, cuándo y desde dónde. Eso es el **[[registro-auditoria|registro de auditoría]]** (*audit log*): una lista de eventos que solo crece, con la identidad verificada de cada uno.

En AWS lo lleva **CloudTrail**, un servicio que guarda las llamadas a la API de AWS (las que administran recursos, los *eventos de administración*, siempre; las que leen o escriben cada objeto de S3, los *eventos de datos*, solo si se activan), con qué rol, desde qué IP y si se permitió. Los eventos de administración se ven 90 días sin configurar nada; para guardarlos más tiempo se crea un *trail*, que los escribe en S3. Si un día alguien borra un bucket, el registro dice qué identidad fue; si borra objetos sueltos, solo queda escrito si se activaron los eventos de datos.

En Alba, el log de las acciones de soporte diría: «Marta, rol soporte, leyó la publicación 8812 a las 10:42». Para que sirva, se guarda donde ni quien lo genera lo pueda editar ni borrar: por ejemplo, en S3 con Object Lock, una opción que impide borrar o cambiar un objeto durante un plazo. Un registro que el atacante puede borrar no prueba nada.

:::ojo
El registro de auditoría no es el log de predicciones. El log de predicciones del clasificador sirve para medir y reentrenar el modelo; el de auditoría sirve para responder quién accedió a qué. Pueden vivir en lugares distintos, con permisos y tiempos de guardado distintos.
:::

## Errores comunes {Common mistakes}

:::pasos
1. «Uso JWT, así que está autenticado»
Un JWT es un formato, no una garantía. Si nadie revisa la firma, el emisor, la audiencia y `exp`, cualquiera fabrica uno: los claims son solo JSON en base64. Revisa las cuatro cosas, con el algoritmo que tú esperas, nunca el que dice el token.
2. Decidir con lo que el cliente declara
Un header `X-Caller`, un campo `es_admin` en el body o el `user_id` de la URL los escribe el cliente. La cuota, los permisos y la prioridad salen de la identidad verificada: el `client_id` del token o la sesión.
3. Revisar la sesión y olvidar al dueño
Es el IDOR: comprobar que hay alguien con sesión, pero no que el objeto es suyo. Cada request que trae un id revisa, en el servidor, que ese objeto le toca a esa identidad.
4. Guardar contraseñas con un hash rápido o sin sal
SHA-256 de la contraseña es casi tan malo como guardarla. Usa una función hecha para contraseñas (Argon2id, scrypt, bcrypt o PBKDF2 con muchas repeticiones), con sal por cuenta. Nunca inventes la tuya.
5. Tokens que duran días, o llaves que duran años
Un token largo no se puede cancelar a tiempo, y una llave de API filtrada sirve hasta que alguien la cambie. Tokens de minutos, renovados desde un caché, y credenciales temporales para las máquinas.
6. Un rol para todo
Un solo rol con `s3:*` sobre `*` (todas las acciones de S3 sobre todos los recursos), compartido por todos los pods «para que funcione», convierte cualquier pod tomado en dueño de todos los datos. Un rol por componente, con el prefijo exacto que necesita.
7. Tokens y secretos en los logs
Loguear los headers completos de una request guarda el `Authorization: Bearer …` de cada caller, y quien lea los logs puede usarlos. Quita esos headers antes de escribir.
:::

## En la vida real {In real life} [extra]

**En Alba.** Ana entra con correo y contraseña, que Alba guarda con hash lento y sal, más un segundo factor opcional. Los 3 callers internos piden un JWT de 15 minutos con client credentials y scope `classify`, y lo renuevan desde su caché. El ALB verifica firma, emisor, audiencia y fecha; el gateway decide permiso, cuota y prioridad con el `client_id` verificado. Ningún pod guarda llaves de AWS: cada uno tiene su rol mínimo.

**Un [[llm|LLM]] propio que sirven a varios equipos de una empresa** (un modelo de lenguaje, como los que están detrás de un chat). Cada equipo tiene su llave o su `client_id`, y la cuota se cuenta por esa identidad verificada, aunque en [[token|tokens del modelo]] por minuto y no en requests (aquí «token» es un pedazo de texto que el modelo lee o escribe, no un token de acceso). Un equipo que se pasa recibe 429 solo él.

**Un asistente con [[rag|RAG]] para los empleados.** RAG quiere decir que, antes de responder, el sistema busca los documentos que vienen al caso y se los pasa al LLM. Alba tiene uno: sus ≈ 8,000 empleados le preguntan y responde con los documentos de la empresa. Si un documento es solo de finanzas, la búsqueda tiene que filtrar por los permisos de quien pregunta **antes** de pasarle los pedazos al LLM. Filtrar después, en la respuesta, ya es tarde: el modelo leyó lo que no debía y puede repetirlo.

**Un agente que hace acciones.** Un agente es un programa en el que el LLM decide qué hacer y lo hace llamando a otras APIs. Alba tiene uno de soporte que, entre otras cosas, hace reembolsos; los de más de US$50 los aprueba una persona. El id del cliente sale del token de la sesión, nunca de lo que escribe el LLM: si el modelo dice «reembolsa al cliente 5521», el sistema revisa que 5521 sea quien está hablando. Los permisos se revisan en código, entre el modelo y las APIs.

**Fuera de ML.** Tu banco te pide la contraseña y un código del teléfono (dos factores), te cierra la sesión a los pocos minutos sin uso (vida corta) y te deja ver solo tus cuentas aunque cambies el número en la URL (revisión del dueño). Las mismas ideas, con más en juego.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución; los números se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Para cada caso, di si es un problema de autenticación o de autorización, y qué código responde el servidor: (a) un caller manda un JWT que caducó hace 2 minutos; (b) Ana, con sesión, pide borrar la publicación de Beto; (c) búsqueda, con un token válido de scope `classify`, llama a una ruta de administración; (d) una request sin header `Authorization`.
- (a) **Autenticación**: el token ya no prueba nada. **401**; el caller pide otro.
- (b) **Autorización**: se sabe que es Ana, pero no es su publicación. **403** (o 404, si no se quiere revelar que existe).
- (c) **Autorización**: es búsqueda, verificado, pero su scope no incluye administración. **403**.
- (d) **Autenticación**: no hay credencial. **401**.
? [facil] Un sitio guarda el SHA-256 de cada contraseña, sin sal. ¿Qué dos cosas puede hacer quien roba la base, que no podría si el sitio usara un hash lento con sal?
- **Adivinar rápido**: con un hash rápido, una GPU prueba ≈ 2 × 10¹⁰ contraseñas por segundo; con uno lento, del orden de 10⁴.
- **Atacar a todos de una vez**: sin sal, dos personas con la misma contraseña tienen el mismo hash, y una tabla de hashes precalculados de contraseñas comunes sirve para cualquier base. Con sal, cada cuenta es un problema aparte.
? [facil] Decodificas los claims de un token y ves `"aud": "busqueda"`, `"exp": 1700000900`. El clasificador lo recibe en el instante 1700000500. ¿Lo acepta?
- No. La firma puede estar bien y `exp` estar en el futuro (faltan 400 s), pero `aud` dice que el token es para **búsqueda**, no para `classifier`. El clasificador responde **401**: ese token no prueba que el portador pueda hablar con él.
? [medio] Con la fórmula \(C = a^m\), \(t = C ÷ v\): una contraseña de 10 caracteres con minúsculas, mayúsculas y dígitos (\(a\) = 62), contra un hash lento (\(v\) = 10⁴ intentos por segundo). ¿Cuánto tarda en el peor caso, y en promedio? ¿Y si es de 8?
- \(C = a^m\) = 62¹⁰ ≈ 8.39 × 10¹⁷ contraseñas.
- \(t = C ÷ v\) = 8.39 × 10¹⁷ ÷ 10⁴ ≈ 8.39 × 10¹³ s. Un año son ≈ 3.16 × 10⁷ s, así que 8.39 × 10¹³ ÷ 3.16 × 10⁷ ≈ **2.7 millones de años** en el peor caso; en promedio, la mitad, ≈ 1.3 millones.
- Con \(m\) = 8: \(C\) = 62⁸ ≈ 2.18 × 10¹⁴, \(t\) = 2.18 × 10¹⁴ ÷ 10⁴ ≈ 2.18 × 10¹⁰ s ≈ **692 años** (346 en promedio).
- Los dos caracteres extra multiplican por 62² = 3,844. Pero solo si la contraseña es al azar; una palabra con un año cae con una lista en segundos.
? [medio] Los 3 callers de Alba renuevan su token de 15 minutos cada 12. Moderación decide subir a 40 instancias, cada una con su token, y los otros dos siguen con 4 cada uno. ¿Cuántos tokens pide al día cada uno y en total? ¿Es una carga para el proveedor de identidad?
- \(n = I × 1,440 ÷ R\), con \(R\) = 12, así que cada instancia pide 1,440 ÷ 12 = 120 al día.
- Moderación: 40 × 120 = **4,800**. Cada uno de los otros dos: 4 × 120 = **480**.
- Total: \(I\) = 48, 48 × 120 = **5,760** al día, 5,760 ÷ 86,400 ≈ **0.067 por segundo**. No es carga: es menos de un pedido cada diez segundos. La carga de verdad sería no cachear: un token por cada una de las ≈ 10 M requests al día.
? [medio] Supón que las publicaciones de Alba (≈ 100 millones activas) usaran ids seguidos. Un atacante con una cuenta normal pide `GET /publicaciones/{id}/borrador` (el borrador es la versión que su dueño todavía no publica) con ids del 1 al 1,000,000, a 1,000 por segundo. ¿Cuánto tarda? ¿Qué gana si el servidor solo revisa la sesión? ¿Qué cambia si los ids fueran de 64 bits al azar?
- Tiempo = intentos ÷ \(v\) = 1,000,000 ÷ 1,000 por s = **1,000 s**, ≈ 17 minutos.
- Si solo se revisa la sesión, es un IDOR: se lleva los borradores de todos los que caigan en ese rango (con ids seguidos, casi todos existen).
- Con ids al azar, la probabilidad de que un intento atine a un id que existe es \(p = E ÷ K\): los ids que existen (\(E\) = 10⁸) entre los posibles (\(K\) = 2⁶⁴ ≈ 1.84 × 10¹⁹). \(p\) = 10⁸ ÷ 1.84 × 10¹⁹ ≈ 5.4 × 10⁻¹², así que en un millón de intentos espera 10⁶ × 5.4 × 10⁻¹² ≈ 5.4 × 10⁻⁶ aciertos: ninguno.
- Lo que de verdad lo arregla: revisar que el borrador sea de quien lo pide; así, aun con ids seguidos, solo ve los suyos. Y una cuota por usuario hace que 1,000 por segundo ni siquiera sea posible.
? [medio] Moderación manda sus requests con su token válido (scope `classify`) y, además, el header `X-Caller: backend-publicaciones`. (a) ¿Con qué cuota la cuenta el gateway? (b) Si el gateway usara ese header, ¿qué les pasaría a las fotos que publica Ana? (c) ¿Qué recibe moderación si pasa de sus 50 requests por segundo?
- (a) Con la de **moderación**: el gateway lee el `client_id` del token que el ALB verificó y no hace caso del header, que lo escribe el caller.
- (b) Las tandas de moderación gastarían la cuota del backend de publicaciones y pasarían con su prioridad, delante de las fotos que una persona está publicando: Ana esperaría más, o su backend recibiría 429 por culpa de otro.
- (c) **429**, solo ella: los otros dos callers ni se enteran. Un 401 sería si su token no valiera; un 403, si su scope no alcanzara.
? [reto] Alba tiene un asistente para sus ≈ 8,000 empleados que responde con los documentos de la empresa; algunos documentos solo los puede ver un área, como finanzas. Diseña su revocación. Supuesto del ejercicio: cuando alguien sale de la empresa, su acceso tiene que morir en 5 minutos o menos, y sus sesiones usan JWT. ¿Qué vida le das al token? ¿Qué agregas si 5 minutos es demasiado poco para renovar? ¿Qué pasa con los permisos sobre documentos?
- La ventana de un token robado o de una persona que ya salió es la vida del token, \(D\). Si \(D\) ≤ 5 min, el token muere solo a tiempo: por ejemplo \(D\) = 5 y \(R\) = 4 (se renueva un minuto antes).
- Carga, con \(n = I × 1,440 ÷ R\): si las 8,000 personas estuvieran conectadas a la vez, cada una con su token, \(I\) = 8,000 y \(n\) = 8,000 × 1,440 ÷ 4 = **2.88 M al día**; entre 86,400 s, ≈ 33 por segundo. Se puede, pero es carga real.
- Alternativa: \(D\) = 15 min y una lista de revocados chiquita (por `sub` o `jti`) que el asistente consulta: solo trae a quienes salieron en los últimos 15 minutos, y se vacía sola.
- Los permisos sobre documentos no pueden vivir solo en el token: si a alguien le quitan acceso a finanzas, la búsqueda tiene que filtrar con los permisos de **ahora**, antes de pasarle nada al LLM.
? [reto] Un equipo propone: «El ALB ya verifica el JWT, así que el gateway solo decodifica los claims del token que le llega y saca de ahí el `client_id`, sin volver a revisar la firma». ¿Qué tiene que ser cierto para que eso sea seguro? Da dos maneras en que se rompe y cómo lo evitas.
- Tiene que ser cierto que **toda** request que llega al gateway pasó antes por la verificación del ALB: que nadie más puede llegarle, y que ninguna ruta del ALB se salta la verificación.
- Se rompe si (1) otro pod del clúster puede llamar al gateway directo: le manda un JWT armado a mano, con `sub: backend-publicaciones` y una firma cualquiera, y como el gateway no revisa la firma, elige su cuota. Se evita con reglas de red que solo dejan entrar al ALB, o haciendo que el gateway vuelva a verificar la firma del JWT (es barato: no llama a nadie).
- Se rompe si (2) alguien agrega al ALB una regla nueva (otra ruta, por ejemplo) y se le olvida ponerle la verificación del JWT: las requests de esa ruta llegan al gateway sin verificar. Se evita con la verificación en todas las reglas que llevan al gateway, y probándolo con una request que traiga un token falso: tiene que recibir 401.
:::

## Lo que sigue {What comes next}

- «Datos personales y la ley» usa el registro de auditoría y la seudonimización (cambiar el id de una persona por otro que no la nombra): qué guarda el log de Alba sin el id de la vendedora en claro, y qué pasa cuando Ana pide borrar sus datos.
- «Ataques y cadena de suministro» parte de aquí: autenticar y limitar a quien consulta es lo que frena la extracción del modelo (copiarlo a base de hacerle millones de preguntas), y la firma de imágenes usa la misma idea de un emisor de confianza que firma.
- «Kubernetes» y «CI/CD y registro de imágenes» ponen esto en práctica: cuentas de servicio con IRSA, permisos por rol dentro del clúster, reglas de red que solo dejan al gateway hablarle a Triton, y el token OIDC con el que el pipeline publica sin llaves guardadas.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
autenticacion autorizacion contrasena-hash mfa sesion api-key token-acceso jwt claims jwks revocacion-token proveedor-identidad oauth client-credentials scope oidc rbac idor cuota-por-cliente registro-auditoria
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué diferencia hay entre autenticar y autorizar, y qué código responde cada falla?
Autenticar es comprobar quién eres; si falla, 401. Autorizar es decidir qué puede hacer una identidad ya comprobada; si falla, 403.
? ¿Por qué una contraseña se guarda con un hash lento y con sal, y no con SHA-256?
El hash lento hace que cada intento de adivinar tarde: con ocho minúsculas, de ≈ 10 segundos a ≈ 242 días. La sal hace que cada cuenta sea un problema aparte, así que una tabla precalculada no sirve.
? Si cualquiera puede leer los claims de un JWT, ¿qué impide cambiarlos?
La firma: cubre el encabezado y los claims, y sin la llave del emisor no se puede rehacer. Quien verifica revisa firma, emisor, audiencia y `exp`, con el algoritmo que él espera.
? ¿Por qué los tokens duran 15 minutos y no un mes?
Porque un JWT no se puede «des-firmar»: vale hasta su `exp`. Una vida corta limita el daño de uno robado, y como el caller lo renueva desde su caché, el emisor apenas recibe ≈ 1,440 pedidos al día (12 instancias que renuevan cada 12 minutos).
? ¿De dónde saca el gateway de Alba la identidad para decidir la cuota?
Del `client_id` del JWT que verificó el ALB, nunca de un header que escribe el caller ni de la IP.
? ¿Qué es un IDOR y dónde se arregla?
Pedir un objeto por su id sin que el servidor revise si es tuyo. Se arregla en el servidor, en cada request, revisando el dueño; los ids al azar solo frenan la búsqueda a ciegas.
:::
