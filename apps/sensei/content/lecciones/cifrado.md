---
titulo: Cifrado, llaves y certificados
en: Encryption, keys and certificates
subtitulo: Qué es cifrar, por qué una llave de 128 bits no se adivina, cómo dos máquinas que nunca se vieron acuerdan un secreto por una red que todos escuchan, y dónde cifra Alba lo que viaja y lo que guarda.
pregunta: Cuando el backend de Alba manda una foto por internet, o cuando un log se guarda en S3, ¿quién podría leerlo, qué lo impide y quién tiene las llaves?
requisitos: http, red, tiempo-hash, gestionados
---

:::idea
Cifrar es convertir datos legibles en ilegibles con una **llave**, de forma que solo quien tiene la llave los regresa. La seguridad no está en esconder el método, que es público, sino en la llave. Con eso, más firmas y certificados, se protege lo que **viaja** (TLS) y lo que se **guarda** (cifrado en reposo con KMS). Y casi siempre, lo que de verdad protege no es la cuenta matemática: es quién puede usar la llave.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace en línea: una tienda donde cualquiera publica lo que vende. Recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y sugiere la categoría de cada foto entre 500. Contando las que le piden otros equipos, clasifica ≈ 10 millones de fotos al día. Todo corre en AWS, la nube de Amazon, en la región `us-east-1` (en Virginia, Estados Unidos), repartido en dos zonas.

Para seguir esta lección basta conocer las piezas por las que pasa una foto:

- El **backend de publicaciones** es el programa de Alba que recibe cada publicación y le pide la categoría al clasificador. Él y otros dos programas internos, el de moderación y el de búsqueda, son los que llaman al clasificador: sus *callers*.
- El **[[alb|ALB]]** (*Application Load Balancer*) es la puerta de entrada: el balanceador de AWS que recibe las requests y las reparte.
- El **gateway** es un programa en Python que prepara la foto: la convierte en un [[tensor]], la tabla de números que entiende el modelo.
- **Triton** es el programa que corre el modelo, una [[resnet|ResNet-50]].
- Cada programa corre dentro de un **[[pod]]**, la unidad mínima de Kubernetes, el sistema que reparte programas entre un grupo de máquinas (el *cluster*). En AWS, ese Kubernetes administrado se llama EKS.
- **S3** es el almacén de archivos de AWS (un [[object-storage|object storage]]). Ahí se guardan las fotos y los *logs*, el registro de texto donde cada programa anota lo que hace. **Fluent Bit** es el programa que junta los logs y los sube a S3.

Cada una de esas fotos viaja por redes que Alba no controla y termina guardada en discos que Alba no ve. Ana, una vendedora de la Ciudad de México, sube la foto de unos tenis desde el wifi de una cafetería. La foto puede traer su cara, su casa o la placa de su coche. Si alguien en esa red pudiera leerla o cambiarla, o si alguien se llevara un disco del [[centro-de-datos|centro de datos]], tendríamos un problema.

Esta lección es la primera del módulo «Seguridad». No vas a aprender a inventar cifrados: eso no lo hace nadie en su trabajo. Vas a aprender qué pedir, dónde va cada pieza y qué protege cada una.

## Cifrar con una sola llave: el cifrado simétrico y AES {Encrypting with one key: symmetric encryption and AES}

### Texto en claro, texto cifrado y llave

Empecemos por las palabras. Lo que quieres proteger se llama **texto en claro** (*plaintext*), aunque sea una foto y no un texto. Lo que sale después de cifrar es el **[[texto-cifrado|texto cifrado]]** (*ciphertext*): bytes que parecen ruido. **[[cifrado|Cifrar]]** (*encrypt*) es pasar del primero al segundo; **descifrar** (*decrypt*), regresar.

Para las dos cosas hace falta una **llave** (*key*): un número secreto, escrito como una serie de bytes. Una llave de 128 bits son 16 bytes al azar (8 bits hacen 1 byte), como `3f9c2ab0…`. El método, la receta de la cuenta, se llama **algoritmo de cifrado** (*cipher*).

:::nota El método es público
Una regla de hace más de un siglo, el principio de Kerckhoffs, dice que un sistema de cifrado debe seguir seguro aunque el enemigo conozca todo el método, menos la llave. Por eso los algoritmos que se usan son públicos y los han atacado miles de expertos durante décadas. Un algoritmo secreto no es más seguro: solo está menos revisado.
:::

¿Qué te da el cifrado? Tres cosas distintas, que conviene no mezclar:

- **Confidencialidad**: quien no tiene la llave no puede leer.
- **Integridad**: si alguien cambia un byte, te das cuenta.
- **Autenticidad**: sabes quién lo escribió.

Un cifrado básico solo da la primera. Las otras dos necesitan piezas que verás en esta lección: el modo autenticado de AES, las firmas y el HMAC.

### Una llave para cerrar y abrir

En el **[[llave-simetrica|cifrado simétrico]]** (*symmetric encryption*), la misma llave cifra y descifra. Es como un candado con una sola llave: quien la tenga abre y cierra.

El algoritmo simétrico estándar es **[[aes|AES]]** (*Advanced Encryption Standard*). Lo eligió el NIST (*National Institute of Standards and Technology*), la oficina de estándares de Estados Unidos, después de un concurso público entre algoritmos de todo el mundo: anunció al ganador en 2000 y lo publicó como estándar en 2001. Hoy lo usan casi todas las conexiones cifradas, los discos de tu celular y S3.

Cómo es, en tres datos:

- **Trabaja en bloques de 16 bytes** (128 bits). Un archivo más largo se corta en bloques.
- **Acepta llaves de 128, 192 o 256 bits.** Se dice AES-128 o AES-256.
- **Es rapidísimo.** Los procesadores modernos traen instrucciones dedicadas a AES y cifran varios GB por segundo en un solo núcleo. Cifrar una foto de 200 KB toma microsegundos.

No necesitas saber cómo está hecho por dentro para usarlo. Sí necesitas saber dos cosas sobre cómo se usa.

:::profundo AES por dentro, en una frase
Por dentro, AES revuelve los 16 bytes del bloque con la llave en 10 rondas (AES-128) o 14 (AES-256) de sustituir, mover y mezclar bytes. No hace falta conocer esas rondas: lo que importa es que, sin la llave, nadie ha encontrado un atajo mejor que probar llaves.
:::

### El modo: GCM y el número que no se repite

AES solo sabe cifrar un bloque de 16 bytes. Una foto de 200 KB tiene 200,000 ÷ 16 = 12,500 bloques, y la receta para encadenarlos se llama **modo** (*mode of operation*). El que más se usa hoy es **GCM** (*Galois/Counter Mode*). Tiene una virtud y una condición.

La virtud: **detecta cambios**. Además del texto cifrado, GCM produce una **etiqueta** (*tag*) de 16 bytes que depende de cada bit del mensaje y de la llave. Si alguien cambia un solo byte del texto cifrado, la etiqueta ya no cuadra y el descifrado falla. A eso se le llama **cifrado autenticado** (*authenticated encryption*): da confidencialidad e integridad juntas.

La condición: cada mensaje cifrado con la misma llave lleva un **nonce** distinto, un número de 12 bytes que se usa una sola vez (el nombre viene de *number used once*). No es secreto: viaja junto al texto cifrado. Pero si repites un nonce con la misma llave, un atacante puede combinar los dos mensajes, sacar información de ambos y hasta falsificar etiquetas. Si la biblioteca (el código ya hecho que tu programa usa para cifrar) te pide el nonce, se saca al azar para cada mensaje, nunca fijo a mano.

:::ojo
Hay un modo viejo, **ECB** (*Electronic Codebook*), que cifra cada bloque por separado con la misma llave. Dos bloques iguales dan el mismo texto cifrado, y en una imagen se siguen viendo las siluetas. Si una biblioteca te ofrece «AES» sin decir el modo, o con ECB, desconfía.
:::

### El problema de repartir la llave

El cifrado simétrico tiene un problema que no es matemático. Para que el backend de Alba y el ALB se manden algo cifrado con AES, los dos necesitan la **misma** llave. ¿Cómo se la pasa uno al otro? Si la manda por la red sin cifrar, cualquiera que escuche la copia. Si la cifra, necesita otra llave, y vuelve el mismo problema.

Con dos máquinas que ya se conocen se podría instalar la llave a mano. Pero tu celular habla cada día con cientos de servidores que nunca vio. Para eso existe la otra familia de llaves, la de la sección «Dos llaves». Antes, una pregunta que todos se hacen: si la llave es solo un número, ¿por qué no probar todos?

## Fuerza bruta: por qué 128 bits bastan {Brute force: why 128 bits are enough}

La **[[fuerza-bruta|fuerza bruta]]** (*brute force*) es el ataque más tonto y el más general: probar todas las llaves posibles, una por una, hasta que una descifre algo que tenga sentido. Siempre funciona, en teoría. La pregunta es cuánto tarda.

Una llave de \(L\) bits tiene \(2^L\) valores posibles: cada bit agrega un 0 o un 1, y duplica las opciones. Con suerte, el atacante la encuentra al primer intento; con mala suerte, en el último. En promedio, a la mitad.

:::formula Lo que tarda la fuerza bruta, en promedio
K = 2^L
t = frac{K}{2 × v}
- L: el largo de la llave, en bits (128 para AES-128)
- K: cuántas llaves posibles hay, sin unidad
- v: cuántas llaves prueba el atacante por segundo, en llaves/s
- t: el tiempo promedio hasta encontrarla, en segundos (a la mitad de las \(K\))
:::

Primero, con un juguete que sí se rompe. El código de abajo cifra un texto con una llave de **16 bits** y luego hace de atacante: prueba las 65,536 llaves hasta que una dé un texto que empieza como espera. El cifrado es de juguete: saca 32 bytes del SHA-256 de la llave y combina cada byte del texto con uno de esos con XOR, una operación de bits que, aplicada dos veces con el mismo byte, regresa al original. Por eso descifrar es la misma cuenta. No lo uses para nada real.

```python
import hashlib

def cifrar(llave, texto):                 # juguete: XOR con bytes que salen de SHA-256
    flujo = hashlib.sha256(llave.to_bytes(2, "big")).digest()
    return bytes(t ^ f for t, f in zip(texto, flujo))   # descifrar es la misma cuenta

secreto = cifrar(41_337, b"Calzado > Tenis")   # llave de 16 bits que el atacante no conoce
print("texto cifrado:", secreto.hex())

intentos = 0
for llave in range(2**16):                # fuerza bruta: probar todas las llaves
    intentos += 1
    if cifrar(llave, secreto).startswith(b"Calzado"):   # el atacante sabe cómo empieza
        break
print("llave encontrada:", llave, "en", intentos, "intentos de", 2**16)
print("texto en claro:", cifrar(llave, secreto).decode())
```

```salida
texto cifrado: b312e9ccf979760086e1a722089598
llave encontrada: 41337 en 41338 intentos de 65536
texto en claro: Calzado > Tenis
```

Tu laptop hace eso en una fracción de segundo. Fíjate en el truco: el atacante reconoce la llave correcta porque sabe algo del texto en claro («empieza con Calzado»). Casi siempre lo sabe: un JPEG siempre empieza con los mismos bytes, y una request HTTP, con `POST` o `GET`.

Ahora, con AES-128 y un atacante absurdo: mil millones de computadoras, cada una probando mil millones de llaves por segundo. Son \(v\) = 10⁹ × 10⁹ = 10¹⁸ llaves por segundo. Nadie ha construido algo así. Para darte una escala: la red entera de bitcoin calcula del orden de 10²¹ hashes por segundo, mil veces más, pero con chips que solo saben calcular hashes, no probar llaves de AES.

:::cuenta Fuerza bruta contra una llave de 128 bits
Largo de la llave, \(L\) // AES-128 | — | 128 bits
Llaves posibles, \(K\) | \(K = 2^L = 2^{128}\) | ≈ 3.4 × 10³⁸
Velocidad del atacante, \(v\) // supuesto: 10⁹ máquinas × 10⁹ llaves/s | 10⁹ × 10⁹ | 10¹⁸ llaves/s
Tiempo promedio, \(t\) | \(t = K ÷ (2 × v)\) = 3.4 × 10³⁸ ÷ (2 × 10¹⁸) | ≈ 1.7 × 10²⁰ s
Tiempo promedio, \(t\), en años // un año ≈ 3.16 × 10⁷ s | 1.7 × 10²⁰ ÷ 3.16 × 10⁷ | ≈ 5.38 × 10¹² años
Veces la edad del universo // \(t\) en años ÷ la edad del universo, ≈ 13.8 × 10⁹ años | 5.38 × 10¹² ÷ 13.8 × 10⁹ | ≈ 390 veces
= Con un atacante que nadie tiene, la llave de 128 bits aguanta ≈ 390 veces la edad del universo; mil veces más rápido, del tamaño de la red de bitcoin, todavía ≈ 5 × 10⁹ años. Por eso nadie ataca AES probando llaves: se ataca dónde está guardada la llave.
:::

La clave está en el exponente. Cada bit que agregas **duplica** el trabajo. De 16 a 128 bits hay 112 bits más: 2¹¹² ≈ 5 × 10³³ veces más trabajo que el juguete. Por eso la diferencia entre «se rompe en un instante» y «no se rompe nunca» cabe en 14 bytes (112 bits ÷ 8).

:::calculadora cifrado-fuerza-bruta
Empieza con la cuenta: \(L\) = 128 y \(v\) = 10¹⁸. Baja \(L\) a 56, el largo de DES, el estándar anterior a AES, y pon el exponente de \(v\) en 12 (10¹² llaves por segundo, una máquina dedicada): cae en ≈ 10 horas. Luego sube \(L\) de uno en uno y mira cómo cada bit duplica el tiempo.
:::

### Cuando el espacio es chico, la llave no importa

La fuerza bruta sí funciona cuando hay pocas opciones. Un PIN de 4 dígitos tiene \(K\) = 10⁴ = 10,000 valores: si un sistema deja probar \(v\) = 10 por segundo, cae en \(t\) = 10,000 ÷ (2 × 10) = 500 s en promedio, poco más de 8 minutos. Por eso los cajeros bloquean la tarjeta tras unos pocos intentos fallidos (muchos bancos, al tercero).

Lo mismo pasa con un [[hash-criptografico|hash]] sin llave de un dato chico. Un hash como SHA-256 convierte cualquier dato en una huella de tamaño fijo y no se puede revertir, pero cualquiera lo puede calcular. Un teléfono de México tiene 10 dígitos: \(K\) = 10¹⁰ valores. El atacante calcula el hash de cada teléfono posible y busca cuál da la huella guardada. Una sola [[gpu|GPU]] calcula ≈ 2.2 × 10¹⁰ hashes SHA-256 por segundo: los prueba todos en 10¹⁰ ÷ (2.2 × 10¹⁰) ≈ 0.45 s. Hashear el teléfono no lo esconde. La lección «Datos personales y la ley» retoma ese caso; la solución es el HMAC, un hash con llave que ves en la sección de firmas.

:::profundo ¿Y las computadoras cuánticas?
Una computadora cuántica grande, que todavía no existe, podría usar el algoritmo de Grover, que busca entre \(K\) llaves en ≈ \(sqrt{K}\) pasos: en la práctica, divide entre dos los bits efectivos. En papel, AES-128 quedaría como si tuviera 64 bits y AES-256 como 128. En la práctica Grover casi no se puede repartir entre muchas máquinas, y el NIST sigue considerando que AES-128 aguanta décadas; aun así, algunas guías (como la de la NSA, la agencia de inteligencia de Estados Unidos, para sus sistemas de seguridad nacional) piden AES-256 para datos que deben seguir secretos mucho tiempo, por margen. El golpe fuerte de la computación cuántica no es contra AES: es contra las llaves públicas de la sección que sigue.
:::

## Dos llaves: pública, privada y firmas {Two keys: public, private and signatures}

### Lo que una cierra, solo la otra abre

En 1976 y 1977 apareció una idea que parecía imposible: un par de llaves distintas, ligadas por una cuenta, donde **lo que una cierra, solo la otra abre**. Es la **[[llave-asimetrica|criptografía de llave pública]]** (*public-key* o *asymmetric cryptography*).

- La **llave pública** se reparte a todo el mundo, sin cuidado.
- La **llave privada** no sale nunca de su dueño.
- Saber la pública no sirve para calcular la privada.

Con eso se resuelve el problema de repartir la llave. Si quieres mandarme algo, lo cierras con mi llave pública, que está en internet; solo yo, con mi privada, lo abro. Nadie tuvo que pasarle un secreto a nadie.

:::figura cifrado-llaves
Arriba, una llave simétrica: la misma cierra y abre, y hay que llevársela al otro. Abajo, un par: cualquiera cierra con la pública; solo la privada abre.
:::

:::analogia Un buzón con ranura
La llave pública es la ranura de un buzón: cualquiera mete una carta, nadie la saca por ahí. La privada es la llave de la puerta del buzón, y solo la tiene su dueño. Dónde se rompe: con la llave privada también se puede «cerrar» algo que cualquiera abre con la pública, y eso es justo una firma; un buzón no hace eso.
:::

### RSA con números de lápiz

El sistema más conocido es **RSA**, por sus autores (Rivest, Shamir y Adleman, 1977). Se apoya en un hecho: multiplicar dos primos grandes es fácil, pero, dado el producto, encontrar esos primos es dificilísimo. Con números chiquitos se sigue a mano.

:::formula RSA: las llaves, cifrar y descifrar
N = p × q
z = (p − 1) × (q − 1)
e × d text{ mod } z = 1
y = x^e text{ mod } N
x = y^d text{ mod } N
- p, q: dos números primos secretos, sin unidad
- N: el módulo, \(p × q\); es parte de la llave pública
- z: \((p − 1)(q − 1)\); solo lo calcula quien conoce \(p\) y \(q\)
- e: el exponente público; la llave pública es el par \((N, e)\)
- d: el exponente privado, elegido para que \(e × d\) deje residuo 1 al dividir entre \(z\)
- x: el mensaje, escrito como un número menor que \(N\)
- y: el mensaje cifrado, también un número menor que \(N\)
- mod: el residuo de la división; 17 mod 5 = 2
:::

:::cuenta RSA con dos primos chicos
Primos secretos, \(p\) y \(q\) // los elegimos nosotros, chicos para hacerlo a mano | — | 61 y 53
Módulo, \(N\) // público | \(N = p × q\) = 61 × 53 | 3,233
Número auxiliar, \(z\) // secreto | \(z = (p − 1) × (q − 1)\) = 60 × 52 | 3,120
Exponente público, \(e\) // un número sin factores comunes con \(z\) | — | 17
Exponente privado, \(d\) // 17 × 2,753 = 46,801 = 15 × 3,120 + 1 | \(e × d\) mod \(z\) = 1 | 2,753
Mensaje, \(x\) // lo elegimos nosotros; tiene que ser menor que \(N\) | — | 65
Cifrado, \(y\) // con la llave pública | \(y = x^e\) mod \(N\) = 65¹⁷ mod 3,233 | 2,790
Descifrado, \(x\) // con la llave privada; regresa el mensaje | \(y^d\) mod \(N\) = 2,790²⁷⁵³ mod 3,233 | 65
= Quien conoce \((N, e)\) = (3,233, 17) cifra; solo quien conoce \(d\) = 2,753 regresa al 65. Para calcular \(d\) hace falta \(z\), y para \(z\), los primos \(p\) y \(q\).
:::

Con 3,233, cualquiera encuentra los primos probando divisores en un segundo. En la vida real, \(N\) tiene **2,048 bits**, un número de ≈ 617 dígitos, y no se conoce una forma de partirlo en sus primos en un tiempo razonable.

### Lento, así que se usa poco

La llave pública tiene un precio: es **miles de veces más lenta** que AES y solo cifra mensajes más chicos que su módulo. Nadie cifra una foto con RSA. En la práctica se usa para dos cosas cortas: **acordar** una llave de AES (lo ves en TLS) y **firmar**.

:::profundo Curvas elípticas: la misma seguridad con llaves más chicas
Hoy, junto a RSA, se usa mucho la criptografía de **curvas elípticas** (ECC, *elliptic-curve cryptography*), que logra la misma seguridad con llaves mucho más chicas: una llave de curva de 256 bits (P-256 o X25519) protege más o menos como RSA de 3,072 bits, y los dos como AES-128.
:::

### Firmar: la privada cierra, la pública comprueba

Una **[[firma-digital|firma digital]]** (*digital signature*) usa el par al revés. El autor calcula el [[hash-criptografico|hash]] del documento, su huella de 256 bits (lección «Tiempo, hashes e identificadores»), y la «cierra» con su llave **privada**. Cualquiera la «abre» con la llave **pública** y compara con el hash que él mismo calcula. (Así es la cuenta en RSA; las firmas de curvas elípticas hacen otra cuenta, pero con la misma regla: solo la privada firma y la pública comprueba.)

:::formula Firmar y verificar con RSA
f = u^d text{ mod } N
f^e text{ mod } N = u
- u: la huella (el hash) del documento, como número menor que \(N\)
- f: la firma, un número que se manda junto al documento
- d, e, N: las mismas llaves de RSA de arriba; firma la privada \(d\), verifica la pública \((N, e)\)
:::

Con las llaves de la cuenta de arriba, la huella \(u\) = 123 da la firma \(f\) = 123²⁷⁵³ mod 3,233 = 2,746, y 2,746¹⁷ mod 3,233 regresa a 123. Una firma que no salió de \(d\), como 2,747, no regresa a 123.

:::profundo RSA y la firma, en Python
Python hace las mismas cuentas con `pow`, incluida la firma:

```python
p, q = 61, 53                  # dos primos secretos
N = p * q                      # 3233: va en la llave pública
z = (p - 1) * (q - 1)          # 3120: solo lo puede calcular quien sabe p y q
e = 17                         # exponente público
d = pow(e, -1, z)              # exponente privado: e × d deja residuo 1 entre z
print("pública (N, e) =", (N, e), "· privada d =", d)

x = 65                         # el mensaje, como número menor que N
y = pow(x, e, N)               # cifrar con la pública: x^e mod N
print("cifrado y =", y, "· descifrado =", pow(y, d, N))

u = 123                        # la huella (el hash) de un documento
f = pow(u, d, N)               # firmar con la privada: u^d mod N
print("firma f =", f, "· verifica:", pow(f, e, N) == u)
print("firma alterada verifica:", pow(f + 1, e, N) == u)
```

```salida
pública (N, e) = (3233, 17) · privada d = 2753
cifrado y = 2790 · descifrado = 65
firma f = 2746 · verifica: True
firma alterada verifica: False
```
:::

Si la firma cuadra, sabes dos cosas: **quién** firmó (el único que tiene la privada) y que el documento **no cambió** (un byte distinto da otra huella). Eso da integridad y autenticidad; no da confidencialidad, porque el documento viaja legible.

Las firmas están en todas partes: los certificados de la sección que sigue son firmas, y también el **JWT** (*JSON Web Token*), la credencial con la que los programas que llaman a Alba demuestran quiénes son, y la firma de las imágenes que corre el cluster. Los dos los ves en las lecciones de «Lo que sigue».

### HMAC: firmar con una llave compartida

A veces no hace falta un par. Si emisor y receptor ya comparten una llave secreta, basta un **[[hmac|HMAC]]** (*hash-based message authentication code*): un hash calculado sobre el mensaje **mezclado con la llave**. Solo quien tiene la llave produce el HMAC correcto, y cualquier cambio al mensaje lo descuadra.

Es la idea de una [[url-prefirmada|URL prefirmada]] de S3: un enlace que deja bajar o subir un objeto sin más credenciales, y que vale 15 minutos. El servidor calcula un HMAC sobre «qué objeto, qué operación, hasta cuándo»; la hora límite va en un campo `vence`, en [[tiempo-unix|tiempo Unix]] (los segundos desde el 1 de enero de 1970). Si alguien alarga la fecha, el HMAC deja de cuadrar. El atacante sí puede calcular el hash **sin llave** del mensaje alterado, pero ese no le sirve: el que el servidor revisa exige la llave.

:::profundo El HMAC en Python, la comparación y quién puede verificar
Así se calcula y se verifica un HMAC con la biblioteca estándar de Python. El mensaje alterado alarga la fecha de `vence`:

```python
import hashlib, hmac

llave = b"llave-compartida-de-32-bytes!!!!"           # la tienen el emisor y el receptor
mensaje = b'{"objeto": "fotos/8f3a.jpg", "vence": 1793974685}'
etiqueta = hmac.new(llave, mensaje, hashlib.sha256).hexdigest()
print("HMAC:", etiqueta[:16], "...")

def verificar(msj, etq):
    esperada = hmac.new(llave, msj, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperada, etq)        # compara sin filtrar tiempos

print("original:", verificar(mensaje, etiqueta))
alterado = mensaje.replace(b"1793974685", b"1893974685")   # alguien alarga la fecha
print("alterado:", verificar(alterado, etiqueta))
print("hash sin llave del alterado:", hashlib.sha256(alterado).hexdigest()[:16], "...")
```

```salida
HMAC: 1459ece7bfd8cec6 ...
original: True
alterado: False
hash sin llave del alterado: 59825822aa02fcaa ...
```

Se compara con `hmac.compare_digest`, no con `==`, porque `==` se detiene en el primer byte distinto, y midiendo cuánto tarda, un atacante podría ir adivinando la etiqueta byte por byte.

La diferencia con una firma es quién puede verificar. Con HMAC, quien verifica tiene la misma llave y por lo tanto también podría haber firmado; con una firma digital, cualquiera verifica y solo uno firma.
:::

| | Llave | Quién verifica | Da |
|---|---|---|---|
| Hash (SHA-256) | ninguna | cualquiera | detectar daño por accidente |
| HMAC | una, compartida | solo quien tiene la llave | integridad y autor, entre los que comparten la llave |
| Firma digital | par: firma la privada | cualquiera, con la pública | integridad y autor, ante todo el mundo |

## El intermediario, los certificados y TLS {The man in the middle, certificates and TLS}

### El problema que queda: ¿de quién es esa llave pública?

La llave pública resolvió cómo repartir un secreto. Pero abrió otro hueco. Cuando el celular de Ana se conecta a Alba, o el backend de publicaciones al clasificador en `api.alba.example`, el servidor le manda su llave pública. ¿Cómo sabe el [[cliente]] que esa llave es de verdad del servidor y no de un impostor?

Imagina a alguien en medio de la red: el dueño de un wifi falso en la cafetería de Ana, o un router comprometido en la ruta (los routers son las máquinas que van pasando los paquetes de red hasta su destino). Cuando el cliente pide la llave pública, el intruso contesta con **la suya**. El cliente cifra con ella, el intruso descifra, lee todo, lo vuelve a cifrar con la llave verdadera del servidor y lo pasa. Ninguno de los dos nota nada. Es el **[[mitm|ataque del intermediario]]** (*man-in-the-middle*, MITM).

El cifrado solo no lo evita: el intruso tiene una conexión cifrada perfecta con cada lado. Falta **autenticar**: comprobar que la llave pública es de quien dice ser.

### El certificado: un nombre y una llave, firmados

Un **[[certificado]]** (*certificate*, en formato X.509) es un documento corto que dice, en esencia:

- **un nombre**: `api.alba.example`;
- **una llave pública**: la de ese servidor;
- **unas fechas**: válido desde y hasta;
- **una firma** de alguien que lo comprobó, sobre todo lo anterior.

Ese «alguien» es una **[[autoridad-certificadora|autoridad certificadora]]** (*certificate authority*, CA): una organización cuyo trabajo es comprobar que quien pide el certificado de un nombre controla ese nombre (por ejemplo, poniendo un registro en su [[dns|DNS]], el directorio de nombres de internet, o un archivo en su sitio), y firmarlo. Si el intruso de la cafetería presenta su propia llave, no tiene un certificado firmado por una CA para el nombre de Alba, y el cliente lo rechaza.

¿Y cómo confía el cliente en la CA? Porque tu sistema operativo y tu navegador ya traen instaladas las llaves públicas de más de cien CA raíz (*root*), revisadas por los fabricantes. Es el **almacén de confianza** (*trust store*). Las raíces casi nunca firman certificados de servidores directamente: firman a CA **intermedias**, y esas firman los de los servidores. Así la llave privada de la raíz se guarda apagada, fuera de línea.

:::figura cifrado-cadena
La cadena de confianza de un certificado: la raíz, que ya está en tu sistema, firma a una intermedia; la intermedia firma el certificado de `api.alba.example`. El cliente verifica cada firma de abajo hacia arriba.
:::

El cliente revisa la cadena así: la firma del certificado del servidor cuadra con la llave pública de la intermedia; la de la intermedia cuadra con la de una raíz de su almacén; las fechas no han vencido, y el nombre del certificado es el que pidió. Si algo falla, la conexión no se abre. Por eso una computadora con el reloj muy mal no abre páginas seguras: cree que los certificados no han empezado a valer, o que ya vencieron.

:::profundo Un certificado de verdad, por dentro
Así se ve un certificado con la herramienta `openssl`, recortado (es ilustración: el nombre y las fechas son de ejemplo):

```text
$ openssl x509 -in api-alba.pem -noout -subject -issuer -dates -ext subjectAltName
subject=CN = api.alba.example
issuer=C = US, O = Una CA Pública, CN = Intermedia R2
notBefore=Oct  1 00:00:00 2026 GMT
notAfter=Apr 16 23:59:59 2027 GMT
X509v3 Subject Alternative Name:
    DNS:api.alba.example
```

El nombre que cuenta es el de *Subject Alternative Name*. Del 1 de octubre de 2026 al 16 de abril de 2027 son 198 días, lo que duran los que emite ACM, el servicio de certificados de AWS que usa Alba: dos menos que el máximo de 200 que permiten hoy a un certificado público las reglas que siguen las CA y los navegadores (los dos los ves en la sección de rotación).
:::

### TLS: el saludo, paso a paso

**[[tls|TLS]]** (*Transport Layer Security*) es el protocolo que junta todo lo anterior para proteger una conexión. [[https|HTTPS]] es HTTP dentro de TLS: los mensajes de HTTP no cambian, solo viajan cifrados. La versión actual es **TLS 1.3**, de 2018.

TLS tiene dos partes. Primero, un **saludo** (*handshake*) donde las dos puntas se ponen de acuerdo en una llave y el servidor demuestra quién es. Después, todo viaja cifrado con AES (o con ChaCha20, otro cifrado simétrico) usando esa llave.

:::figura cifrado-handshake
El saludo de TLS 1.3 entre el backend de Alba y el ALB: una ida y una vuelta, y en la vuelta ya vienen el certificado y la prueba de que el servidor tiene la llave privada.
:::

:::pasos
1. El cliente saluda (ClientHello)
Dice qué versiones y cifrados acepta y a qué nombre quiere hablar (`api.alba.example`). Ese nombre, el SNI (*Server Name Indication*), viaja sin cifrar. También manda su mitad del acuerdo de llaves: un número público calculado con un secreto que se queda en su memoria (la cuenta está en «Acordar una llave en público», abajo).
2. El servidor contesta (ServerHello)
Elige el cifrado, manda su mitad del acuerdo, y desde ese momento las dos puntas ya pueden calcular la misma llave. Lo que sigue va cifrado.
3. El servidor se presenta
Manda su certificado con la cadena, y **firma** con su llave privada un resumen de todo el saludo (CertificateVerify). Con eso demuestra que la llave privada del certificado es suya, y que nadie cambió los mensajes del saludo.
4. Los dos confirman (Finished)
Cada uno manda un HMAC de todo el saludo con la llave nueva. Si un intruso cambió algo, no cuadra y la conexión se corta.
5. Ya viaja HTTP
La request `POST /v1/classify` y la foto van cifradas con AES-GCM y la llave acordada.
:::

El saludo de TLS 1.3 cuesta **una ida y vuelta** de la red (1 [[rtt|RTT]]), además del [[handshake]] de [[tcp|TCP]], el saludo con el que se abre la conexión. La red le cobra a una request \(k × RTT\), donde \(k\) es el total de idas y vueltas que paga: las de TCP, las de TLS y la de la request misma (la lección «Cómo viaja un mensaje: IP, puertos y DNS» lo cuenta a fondo). Del celular de Ana a Virginia hay un RTT de ≈ 60 ms. Una conexión nueva con TLS paga \(k\) = 3: 3 × 60 = 180 ms. Una ya abierta paga \(k\) = 1: 60 ms. Por eso se reutilizan las conexiones ([[keep-alive]]) y se paga el saludo una vez para cientos de requests.

### Acordar una llave en público: Diffie–Hellman

Los pasos 1 y 2 tienen el truco más bonito de toda la lección. Las dos puntas acuerdan una llave secreta **mandándose solo números públicos**, y quien escucha todo no puede calcularla. Se llama intercambio de **Diffie–Hellman** (1976): cada una inventa un número secreto, manda un número público calculado con él, y con el número público del otro y su propio secreto las dos llegan al mismo resultado. Si quieres ver la cuenta con números de juguete, abre el bloque.

:::profundo La cuenta de Diffie–Hellman, con números chicos
:::formula El acuerdo de Diffie–Hellman
A = g^a text{ mod } P
C = g^c text{ mod } P
S = C^a text{ mod } P = A^c text{ mod } P
- g, P: dos números públicos que todos conocen; \(P\) es primo
- a: el secreto del cliente; nunca viaja
- c: el secreto del servidor; nunca viaja
- A, C: lo que cada uno manda por la red
- S: el secreto compartido; de él sale la llave de AES de la conexión
:::

Funciona porque \((g^c)^a\) y \((g^a)^c\) son lo mismo: \(g^{a×c}\). Con números de juguete:

```python
g, P = 5, 23                    # públicos: los conoce todo el mundo
a = 6                           # secreto del cliente: nunca viaja
c = 15                          # secreto del servidor: nunca viaja
A = pow(g, a, P)                # el cliente manda A por la red
C = pow(g, c, P)                # el servidor manda C por la red
print("viajan por la red: A =", A, "· C =", C)
print("el cliente calcula C^a mod P =", pow(C, a, P))
print("el servidor calcula A^c mod P =", pow(A, c, P))
# quien escucha ve g, P, A y C; para sacar S tendría que adivinar a o c
espia = [prueba for prueba in range(1, P) if pow(g, prueba, P) == A]
print("con P = 23, el espía prueba y encuentra a en", espia)
```

```salida
viajan por la red: A = 8 · C = 19
el cliente calcula C^a mod P = 2
el servidor calcula A^c mod P = 2
con P = 23, el espía prueba y encuentra a en [6]
```

Con \(P\) = 23, el espía prueba los 22 exponentes y encuentra \(a\). En TLS se usa la versión con curvas elípticas (X25519), con números de 256 bits, y esa búsqueda no termina nunca.
:::

:::profundo Un premio extra: el secreto hacia adelante
TLS 1.3 inventa \(a\) y \(c\) nuevos para **cada conexión** y los borra al terminar. Si dentro de un año alguien roba la llave privada del certificado del ALB, no puede descifrar las conexiones viejas que haya grabado: esas llaves ya no existen. Se llama **secreto hacia adelante** (*forward secrecy*). La llave privada del certificado solo sirve para firmar el saludo, no para cifrar.
:::

:::ojo
Diffie–Hellman solo, sin certificado, no evita al intermediario: el intruso hace un acuerdo con cada lado. Lo que lo evita es la firma del paso 3, que solo puede hacer quien tiene la llave privada del certificado de `api.alba.example`.
:::

## Dónde se cifra en Alba: en tránsito, la terminación y mTLS {Where Alba encrypts in transit: termination and mTLS}

El **[[cifrado-en-transito|cifrado en tránsito]]** (*encryption in transit*) es cifrar lo que viaja por una red. En la práctica, casi siempre es TLS. La pregunta de diseño no es «¿cifras?», sino **dónde empieza y dónde termina** el tramo cifrado.

### El ALB termina TLS

Los tres programas que llaman al clasificador de Alba (el backend de publicaciones, moderación y búsqueda) le hablan al ALB por HTTPS. El ALB tiene el certificado público de `api.alba.example`, hace el saludo, descifra la request y la pasa al gateway por la red privada de Alba, en HTTP simple. Eso es la **[[terminacion-tls|terminación de TLS]]** (*TLS termination*): el lugar donde se descifra.

¿Por qué ahí? Porque el ALB necesita leer la request para hacer su trabajo: revisar el token de quien llama, mirar la ruta de la URL (`/v1/classify`), repartir entre los pods del gateway y mandar una parte al modelo nuevo durante un [[canary]] (una prueba en la que una parte chica de las requests va a la versión nueva). Si la request le llegara cifrada hasta el gateway, el ALB no podría leer nada de eso. Y el certificado vive en un solo lugar, el balanceador, en vez de en cada pod.

:::diagrama cifrado-camino
El camino de una foto de Alba, tramo por tramo: qué va cifrado, quién tiene cada llave y qué protege lo que no va cifrado. Toca cada caja y sigue los dos recorridos.
:::

### Lo que no va cifrado, y por qué no es un descuido

Del ALB al gateway, la request va por HTTP dentro de la [[vpc|VPC]] de Alba. Del gateway a Triton, el tensor viaja **sin cifrar** dentro del cluster. ¿Es un error?

Es una decisión. Esos tramos van por la red privada de Alba, que nadie de fuera alcanza. Triton no tiene entrada desde fuera: un [[service-k8s|Service]] interno de Kubernetes (una dirección fija que solo se alcanza desde dentro del cluster), y una *NetworkPolicy* (una regla de red de Kubernetes por pod) que deja que **solo** los pods del gateway le hablen al [[puerto]] 8000 y solo el monitoreo lea sus métricas en el 8002. Para leer ese tráfico, un atacante ya tendría que estar dentro de un pod de Alba, y en ese caso tiene problemas más grandes que el tensor de una foto.

En cambio, **todo lo que sale de un pod hacia otro lado** (a S3, a un proveedor externo) va por TLS. Ahí sí se cruza territorio que Alba no controla.

### mTLS: que los dos lados se presenten

En el TLS normal solo el servidor muestra certificado; el cliente se queda anónimo. En el **[[mtls|TLS mutuo]]** (*mutual TLS*, mTLS), los **dos** presentan certificado y firman el saludo. El servidor sabe con qué programa habla sin pedirle ningún token.

Es la manera natural de cifrar y autenticar el tráfico **interno** entre servicios. El problema es operarlo: alguien tiene que ser la CA interna, emitir un certificado para cada pod y renovarlos antes de que venzan, cada pocas horas o días. Hacerlo a mano es una pesadilla. Por eso casi siempre lo hace una [[service-mesh|malla de servicios]] (*service mesh*; por ejemplo, Istio o Linkerd), que pone un [[proxy]] (un programa intermediario que recibe y reenvía el tráfico) junto a cada pod y le reparte y rota los certificados sin tocar el código.

Alba no tiene malla de servicios, así que dentro del cluster no hay mTLS. Agregarla es la mejora que se discute: cifraría el tramo gateway → Triton y haría que Triton reconozca al gateway por su certificado, no solo por la regla de red. A cambio, un programa más que operar, un proxy más en cada salto y algo más de latencia. Con un equipo de 5 personas, Alba decidió que hoy la red privada y la NetworkPolicy bastan.

:::profundo Cifrado hasta el pod
Si una regla o un cliente exigiera que nada viaje descifrado ni dentro de la VPC (pasa con datos de salud o de pagos), el ALB puede volver a cifrar hacia el gateway con un segundo certificado, o el gateway puede terminar TLS él mismo detrás de un balanceador de capa 4, que pasa los bytes de la conexión sin leerlos. Los dos cuestan certificados que rotar y CPU de más.
:::

## Cifrado en reposo, KMS y el cifrado de sobre {Encryption at rest, KMS and envelope encryption}

### Lo guardado también se cifra

El **[[cifrado-en-reposo|cifrado en reposo]]** (*encryption at rest*) es cifrar lo que está guardado: los objetos de S3, los discos de las máquinas, las bases de datos, los respaldos. En la nube casi siempre está prendido: desde enero de 2023, S3 cifra todo objeto nuevo aunque no lo pidas.

¿Contra qué protege? Contra quien se lleva el disco físico, contra un respaldo que se pierde, contra un técnico del centro de datos. Son riesgos reales pero raros. Contra lo que **no** protege: contra alguien que entra con los permisos de tu programa (por ejemplo, con sus credenciales robadas). Para él, S3 descifra solito y le da los bytes en claro, porque el servicio cree que es tu programa.

Entonces, ¿para qué sirve de verdad? Para separar **dos permisos**: el de leer los bytes y el de usar la llave. Para entender eso hay que ver dónde vive la llave.

### KMS: el lugar donde viven las llaves

Un **[[kms|KMS]]** (*Key Management Service*, servicio de gestión de llaves) es un servicio de la nube que guarda llaves en un hardware especial y **nunca te las da**. Le mandas datos y te los regresa cifrados o descifrados; la llave no sale de ahí. Cada uso queda registrado en un [[registro-auditoria|registro de auditoría]] (una bitácora de quién hizo qué y cuándo; en AWS se llama CloudTrail), y cada llave tiene su propia lista de quién puede usarla.

La llave que vive en KMS se llama **[[llave-maestra|llave maestra]]** (*KMS key*; antes se llamaba CMK, *customer master key*).

KMS tiene un límite: su operación `Encrypt` acepta **como máximo 4,096 bytes**. Está hecho para cifrar cosas chicas, como otras llaves, no archivos.

### El cifrado de sobre

La solución es una idea en tres pasos, el **[[cifrado-de-sobre|cifrado de sobre]]** (*envelope encryption*). Cada archivo se cifra con su propia **[[llave-de-datos|llave de datos]]** (*data key*), y la que se protege con KMS es esa llave chiquita, no el archivo.

:::pasos
1. Pide una llave de datos
El programa le pide a KMS `GenerateDataKey`. KMS le regresa la misma llave de AES de 256 bits dos veces: **en claro** y **cifrada con la llave maestra**.
2. Cifra en tu máquina
El programa cifra el archivo con AES-GCM y la llave en claro, en su propia memoria, a varios GB por segundo. Luego **borra la llave en claro** y guarda junto al archivo la llave cifrada.
3. Para leer, desenvuelve
Quien quiera leer manda a KMS la llave cifrada (unos cientos de bytes) con `Decrypt`. Si la política de la llave se lo permite, KMS le regresa la llave en claro, el programa descifra el archivo y la vuelve a borrar. Ese `Decrypt` queda en el registro de auditoría.
:::

:::diagrama cifrado-sobre
El cifrado de sobre con KMS: al guardar, la llave de datos sale de KMS y se queda, cifrada, junto al objeto; al leer, solo esa llave chica regresa a KMS. Toca las cajas y sigue los tres recorridos.
:::

Con el sobre, guardar un archivo cuesta una llamada a KMS y leerlo, otra, sin importar su tamaño: el cifrado pesado lo hace AES en la máquina.

:::profundo ¿Y si mandara el archivo a KMS en pedazos?
Mandarle a KMS el archivo en pedazos de 4,096 bytes se mide en llamadas:

:::formula Llamadas a KMS para cifrar un archivo directo, sin sobre
n_{llamadas} = ⌈D ÷ 4,096⌉
- D: el tamaño del archivo, en bytes; cada llamada a `Encrypt` lleva como máximo 4,096 bytes
- n_{llamadas}: cuántas llamadas a `Encrypt` hacen falta; ⌈ ⌉ es redondear hacia arriba, porque el último pedazo, aunque sea chico, es otra llamada
:::

El archivo de pesos del modelo de Alba (los números que aprendió la ResNet-50) mide \(D\) = 98.4 MB = 98,400,000 bytes. Son 98,400,000 ÷ 4,096 ≈ 24,023.4, que redondeado hacia arriba da \(n_{llamadas}\) = 24,024 llamadas por la red para cifrar un solo archivo, cada una de algunos milisegundos y cobrada aparte. Con el sobre son una llamada para guardarlo y una para leerlo, y el cifrado pesado lo hace AES en la máquina.
:::

:::analogia Una caja fuerte para llaves
La llave maestra es una caja fuerte de un banco que nunca se abre para sacar nada: solo envuelve y desenvuelve sobres por una ventanilla. Cada archivo va cerrado con su propio candado; la llave del candado viaja dentro de un sobre que solo la ventanilla abre, y la ventanilla anota a quién se lo abrió. Dónde se rompe: un banco te deja llevarte lo que guardas; KMS nunca te da la llave maestra, ni siquiera a su dueño.
:::

### SSE-KMS: que S3 haga el sobre por ti

Nadie programa esos tres pasos para cada objeto de S3. Con **[[sse-kms|SSE-KMS]]** (*server-side encryption with KMS*), S3 los hace solo: al recibir un `PUT`, pide una llave de datos, cifra el objeto y guarda la llave cifrada en sus metadatos; al recibir un `GET`, pide el `Decrypt` **con los permisos de quien hizo el GET** y le devuelve los bytes en claro.

Alba cifra todo bucket de S3 con SSE-KMS, con una llave de KMS administrada por Alba para los datos con fotos o logs.

Cada `GenerateDataKey` y cada `Decrypt` es una request a KMS, y KMS cobra cada una. Con millones de objetos al día eso suma; cuánto, y el interruptor que lo baja casi a cero, están en la sección «Lo que cuesta KMS» (segunda pasada).

### La política de la llave: lo que de verdad protege

Aquí está el punto de la sección. Cada llave de KMS tiene su **[[politica-llave|política de la llave]]** (*key policy*): un documento que dice qué identidades pueden cifrar, descifrar o administrarla. Para leer un objeto con SSE-KMS hacen falta **dos** permisos: `s3:GetObject` en el bucket (de la [[politica-permisos|política de permisos]] de [[iam|IAM]], *Identity and Access Management*, el sistema de AWS que decide quién puede hacer qué) y `kms:Decrypt` en la llave. Si falta cualquiera, S3 responde *Access Denied* (acceso denegado).

:::profundo Una política de la llave, por dentro
Así se ve, recortada, una política de la llave de Alba. Cada bloque dice quién (`Principal`: el rol, nombrado con su ARN, el nombre completo de un recurso en AWS), qué puede hacer (`Action`) y sobre qué (`Resource`; dentro de una política de llave, `*` quiere decir «esta llave»). Es ilustración: los números de cuenta y los nombres de los roles son de ejemplo.

```json
{
  "Statement": [
    { "Sid": "FluentBitEscribeLogs",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/fluent-bit" },
      "Action": "kms:GenerateDataKey",
      "Resource": "*" },
    { "Sid": "EtiquetadoLeeFotos",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/job-etiquetado" },
      "Action": "kms:Decrypt",
      "Resource": "*" }
  ]
}
```

La política está recortada: falta, por ejemplo, el rol de Triton, que también descifra porque baja los pesos del modelo de un bucket con SSE-KMS.

Un detalle real: que Fluent Bit escriba sin poder descifrar funciona porque sube cada archivo de una vez, con `PutObject`. Una subida en partes (*multipart*, lo que Fluent Bit hace si no se le dice otra cosa) también exige `kms:Decrypt`, porque S3 descifra las partes para unirlas.
:::

En Alba, cada pod que llama a AWS tiene su propio [[rol-iam|rol de IAM]] (una identidad con permisos, sin contraseña) con lo mínimo, sin llaves guardadas: es la [[identidad-workload|identidad del workload]] de la lección «Servicios gestionados, serverless y permisos». Fluent Bit solo escribe en el prefijo de logs (la «carpeta» `logs/` dentro del bucket). El job de etiquetado, el programa que lee las fotos que se van a etiquetar, solo lee el prefijo de esas fotos.

La política de la llave repite esa lista del lado de la llave: Fluent Bit puede pedir llaves de datos para escribir, pero no descifrar; el job de etiquetado puede descifrar.

Por eso la frase importante es: **la política de la llave, no solo la del bucket, decide quién lee un dato**. Si alguien se equivoca y deja el bucket legible para un rol de más, ese rol todavía necesita permiso sobre la llave.

Ojo con un detalle: la política que KMS pone por omisión deja que las políticas de IAM de la cuenta también den permisos sobre la llave. Para que la llave sea de verdad una segunda puerta, su política nombra a los roles que descifran y no le delega eso a IAM. Y cada `Decrypt` deja rastro de quién, cuándo y qué llave.

## Lo que cuesta KMS: el Bucket Key {What KMS costs: the S3 Bucket Key} [extra]

KMS cobra por llave y por uso. En noviembre de 2026, en AWS cuesta US$1 al mes por llave (cada una de sus dos primeras rotaciones suma US$1 al mes más; las siguientes, nada) y US$0.03 por cada 10,000 requests, con 20,000 requests gratis al mes por cuenta.

Con SSE-KMS, cada `GenerateDataKey` y cada `Decrypt` es una request a KMS, y KMS cobra cada una. Con millones de objetos, eso suma. Por eso existe el **Bucket Key** de S3: S3 pide a KMS una llave para el bucket que reutiliza por un rato para muchos objetos, y las requests a KMS bajan hasta en un 99 %.

:::formula Lo que cuesta KMS al mes
Q = W × 30.4 × (1 − F)
costo = n_{llaves} × 1 + frac{0.03 × Q}{10,000}
- W: los objetos que se escriben o se leen al día con SSE-KMS; sin Bucket Key, cada uno es una request a KMS
- F: la fracción de requests que se ahorra con Bucket Key (0 sin él; hasta 0.99 con él)
- Q: las requests a KMS al mes (un mes de 30.4 días)
- n_{llaves}: cuántas llaves maestras hay; cada una cuesta US$1 al mes antes de rotar (US$2 tras la primera rotación, US$3 desde la segunda)
- costo: en US$ al mes, con US$0.03 por cada 10,000 requests (precios de noviembre de 2026; sin restar las 20,000 gratis al mes, que valen US$0.06)
:::

El bucket de fotos del marketplace recibe las ≈ 7.5 millones de fotos nuevas que llegan cada día (2.5 M publicaciones × 3 fotos). Cuenta solo las escrituras, como supuesto: las lecturas sumarían más.

:::cuenta KMS para las fotos nuevas de Alba
Objetos escritos al día, \(W\) // 2.5 M publicaciones × 3 fotos | 2.5 M × 3 | 7.5 M
Sin Bucket Key, \(F\) | — | 0
Requests al mes, \(Q\) | \(Q = W × 30.4 × (1 − F)\) = 7.5 M × 30.4 | 228 M
Llaves maestras, \(n_{llaves}\) // la de Alba para fotos y logs; US$1 al mes en su primer año, antes de rotar | — | 1
Costo sin Bucket Key // costo = \(n_{llaves}\) × 1 + 0.03 × \(Q\) ÷ 10,000 | 1 × 1 + 0.03 × 228 M ÷ 10,000 | ≈ US$685 al mes
Con Bucket Key, \(F\) // el ahorro máximo que anuncia AWS | — | 0.99
Requests al mes, \(Q\) | 7.5 M × 30.4 × (1 − 0.99) | 2.28 M
Costo con Bucket Key // la misma fórmula | 1 × 1 + 0.03 × 2.28 M ÷ 10,000 | ≈ US$7.84 al mes
= Un interruptor en el bucket baja de ≈ US$685 a ≈ US$8 al mes. El cifrado es el mismo; lo que cambia es cuántas veces S3 le pregunta a KMS.
:::

:::calculadora cifrado-kms
Empieza con las fotos nuevas de Alba: \(W\) = 7.5 millones al día y \(F\) = 0. Sube \(F\) a 0.99 y mira el costo. Luego cambia el tamaño \(D\) de un objeto para ver cuántas llamadas haría falta si lo cifraras directo con `Encrypt`, sin sobre: una foto de 200 KB serían 49.
:::

## Rotación de llaves, vida de los certificados y lo que no se inventa {Key rotation, certificate lifetimes and what not to invent} [extra]

### Rotar una llave sin cortar el servicio

**[[rotacion-llaves|Rotar una llave]]** (*key rotation*) es empezar a usar una llave nueva en lugar de la vieja. ¿Para qué, si AES-128 no se rompe? Por si la llave se filtró sin que lo sepas, y para limitar cuántos datos dependen de una sola llave.

En KMS, la rotación automática no cambia el nombre de la llave maestra: le agrega por dentro una versión nueva del material de la llave. Lo nuevo se cifra con la versión nueva; las versiones viejas **se conservan** para descifrar lo viejo. Ningún archivo se vuelve a cifrar y nadie cambia su configuración. Alba la tiene prendida, con rotación automática cada año.

Rotar una llave no es lo mismo que [[rotacion-secretos|rotar un secreto]], como la contraseña de un proveedor. Un secreto viejo se **anula**, y para no cortar el servicio se pasa un rato con dos válidos a la vez: se crea el nuevo, se migran los clientes y se revoca el viejo. Una llave de cifrado vieja no se puede anular mientras haya datos cifrados con ella: se retira de cifrar, pero se guarda para descifrar.

| | Rotar un secreto | Rotar una llave maestra de KMS |
|---|---|---|
| Lo viejo | se revoca al final | se queda para descifrar lo viejo |
| Durante el cambio | dos credenciales válidas a la vez | KMS elige la versión sola |
| Quién lo hace | el dueño del secreto, con un plan | KMS, automático |

### Los certificados duran cada vez menos

Un certificado también se rota: vence, y antes hay que poner uno nuevo. Las reglas que siguen las CA públicas y los navegadores (las del *CA/Browser Forum*) acortaron su vida máxima: 398 días hasta marzo de 2026; **200 días desde el 15 de marzo de 2026**; 100 días desde marzo de 2027, y 47 días desde marzo de 2029.

¿Por qué acortarla? Porque revocar un certificado robado funciona mal: muchos clientes no revisan las listas de revocados. Un certificado que vence pronto limita el daño de uno robado. El efecto práctico: **nadie puede renovar a mano**. Si renuevas cuando pasaron dos tercios de la vida, con 200 días renuevas cada ⅔ × 200 ≈ 133 días: 365 ÷ 133 ≈ 2.7 veces al año. Con 47 días, cada ⅔ × 47 ≈ 31 días: 365 ÷ 31 ≈ 12 veces al año, por cada certificado.

Por eso se automatiza: el protocolo **ACME** (*Automatic Certificate Management Environment*), que creó el equipo de Let's Encrypt, una CA gratuita, y hoy es un estándar de internet (el RFC 8555), deja que un programa pida, compruebe y renueve certificados solo. En AWS, los certificados públicos de ACM (*AWS Certificate Manager*), el servicio de certificados que usa el ALB de Alba, duran 198 días desde febrero de 2026, y ACM los renueva solo 45 días antes de que venzan, mientras el certificado esté en uso (en el ALB) y el registro de DNS que comprueba el nombre siga en su lugar.

### Lo que no se inventa

Lo más peligroso en criptografía no es un atacante genial: es un error de uso. Una lista corta de lo que no se hace:

- **No inventes tu algoritmo**, ni combines piezas a mano (como el juguete de la sección de fuerza bruta). Usa la biblioteca estándar de tu lenguaje o del proveedor, con sus valores por omisión.
- **No uses algoritmos retirados**: DES (56 bits), MD5 y SHA-1 para firmar, RSA de 1,024 bits, TLS 1.0 y 1.1.
- **No repitas un nonce** con la misma llave en AES-GCM, ni uses ECB. Algunas bibliotecas generan el nonce por ti; otras, como la de AES-GCM del paquete `cryptography` de Python, te lo piden: sácalo al azar para cada mensaje (12 bytes de `os.urandom`, la función de Python que da bytes al azar).
- **No compares etiquetas con `==`**: usa la comparación de tiempo constante.
- **Prepárate para cambiar de algoritmo.** La computación cuántica rompería RSA y las curvas elípticas. Ya hay reemplazos: en agosto de 2024, el NIST publicó ML-KEM, un acuerdo de llaves pensado para resistirla, y los navegadores grandes ya lo usan en TLS mezclado con X25519. Lo valioso es que el sistema deje cambiar de algoritmo con configuración, no reescribiendo código.

## Errores comunes {Common mistakes}

### 1. Creer que «está cifrado» quiere decir «está protegido»

El cifrado en reposo de S3 está prendido, así que el bucket está seguro. Pero S3 descifra para cualquiera que tenga permiso de leer el bucket y de usar la llave: si un rol tiene los dos de más, el cifrado no detiene nada.

**Cómo evitarlo:** preguntar siempre **quién puede usar la llave**. Escribir la política de la llave con la lista corta de roles que descifran, y revisar en el registro de auditoría quién la usa.

### 2. Confundir hash, HMAC y cifrado

Guardar un teléfono «cifrado» con SHA-256. Un hash no tiene llave y no se descifra: con 10¹⁰ teléfonos posibles, una GPU los prueba todos en menos de un segundo.

**Cómo evitarlo:** si necesitas recuperar el dato, cifra (AES-GCM, con la llave en KMS). Si necesitas un seudónimo estable (un sustituto que siempre sale igual para el mismo dato) que nadie pueda revertir sin permiso, HMAC con una llave secreta. Un hash sin llave, solo para detectar cambios o nombrar contenido.

### 3. Apagar la verificación del certificado «para que funcione»

Un programa no conecta porque el certificado es de otro nombre o venció, y alguien pone `verify=False`, la opción que en muchas bibliotecas de Python apaga la revisión del certificado. La conexión sigue cifrada, pero ya no sabes con quién: es la puerta abierta al intermediario.

**Cómo evitarlo:** arreglar la causa: el nombre, la cadena incompleta o el reloj de la máquina. Si es una CA interna, agregar su raíz al almacén de confianza del programa, no apagar la revisión.

### 4. Pensar que TLS en el ALB cifra todo el camino

«Usamos HTTPS» y suponer que nada viaja en claro. En Alba, del ALB al gateway y del gateway a Triton, viaja sin cifrar dentro de la red privada.

**Cómo evitarlo:** dibujar el camino tramo por tramo y decir, para cada uno, si va cifrado y, si no, qué lo protege (red privada, NetworkPolicy). Si un requisito pide cifrado hasta el pod, volver a cifrar o usar mTLS.

### 5. Llaves y certificados que nadie rota

Un certificado que vence un domingo y tumba el servicio, o una llave de datos fija en la configuración desde hace cinco años.

**Cómo evitarlo:** renovación automática (ACM o ACME) con una alerta si un certificado está a menos de 30 días de vencer, y rotación automática de las llaves de KMS. Lo que se rota a mano, se olvida.

## En la vida real {In real life} [extra]

**Alba, el marketplace.** Los tres programas internos que llaman al clasificador llegan al ALB por HTTPS a `api.alba.example`, con un certificado público de ACM que se renueva solo. El ALB termina TLS, verifica el token de cada uno (un JWT firmado, que dura 15 minutos) y pasa la request al gateway por la red privada. Del gateway a Triton, sin cifrar, con la NetworkPolicy como protección; mTLS con una malla de servicios es la mejora pendiente. Todo bucket va con SSE-KMS y una llave de Alba para fotos y logs, con rotación automática cada año; la política de la llave dice qué roles descifran. Los secretos de terceros viven en Secrets Manager, el [[gestor-secretos|gestor de secretos]] de AWS, que también los cifra con KMS.

**Un sistema de cámaras en sitios remotos.** Cada caja de cómputo de un sitio sube clips a la nube por TLS y se autentica con un token propio. El endurecimiento natural es mTLS, con un certificado por caja: si roban una caja, se revoca su certificado y las demás siguen.

**Documentos escaneados con datos personales (OCR, *optical character recognition*: leer el texto de una imagen).** Los documentos se cifran con KMS antes de entrar al flujo. El programa que extrae el texto tiene permiso de descifrar con la llave; la API que recibe los documentos, no. Si alguien compromete la API, ve objetos cifrados que no puede abrir.

**Fuera de ML.** WhatsApp y Signal cifran de punta a punta (*end-to-end*): las llaves solo existen en los dispositivos de quienes conversan, y el servidor que pasa los mensajes no puede leerlos. Tu laptop probablemente cifra su disco con AES y una llave protegida por un chip. Y en 2011 unos atacantes entraron a los sistemas de DigiNotar, una CA holandesa, y emitieron con ella cientos de certificados falsos, entre ellos uno para google.com que se usó para espiar conexiones en Irán; los navegadores la quitaron de su almacén de confianza y la empresa quebró: la cadena de confianza es tan fuerte como su eslabón más débil.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de fuerza bruta y KMS se comprueban con las calculadoras; los de RSA y Diffie–Hellman, con `pow` en Python.

:::ejercicios
? [facil] Un mensaje se cifra con AES-256-GCM. Di qué es el texto en claro, qué el texto cifrado, qué la llave y qué el nonce, y cuáles de esas cosas tienen que ser secretas.
- Texto en claro: el mensaje original, por ejemplo la foto. Texto cifrado: los bytes que salen de AES. Llave: los 32 bytes secretos (256 bits). Nonce: los 12 bytes que cambian en cada mensaje.
- Secreta: **solo la llave** (y, claro, el texto en claro). El algoritmo es público (principio de Kerckhoffs), el texto cifrado puede viajar por cualquier red y el nonce viaja junto a él.
- Lo que sí tiene una condición es el nonce: no puede repetirse con la misma llave.
? [facil] Un candado de bicicleta tiene 4 ruedas de 10 dígitos. Un ladrón prueba una combinación cada 2 segundos. ¿Cuánto tarda en promedio? ¿Y con 6 ruedas?
- La fórmula de la fuerza bruta con \(K\) combinaciones: \(t = K ÷ (2 × v)\), con \(v\) = 0.5 combinaciones por segundo (una cada 2 s).
- 4 ruedas: \(K\) = 10⁴ = 10,000; \(t\) = 10,000 ÷ (2 × 0.5) = **10,000 s ≈ 2.8 horas**.
- 6 ruedas: \(K\) = 10⁶; \(t\) = 10⁶ ÷ 1 = 10⁶ s ≈ **11.6 días**. Dos ruedas más, 100 veces más tiempo.
? [facil] Con la llave pública de RSA \((N, e)\) = (55, 3), cifra el mensaje \(x\) = 7. Comprueba con Python que la llave privada es \(d\) = 27, sabiendo que \(p\) = 5 y \(q\) = 11.
- Cifrar: \(y = x^e\) mod \(N\) = 7³ mod 55 = 343 mod 55. 343 = 6 × 55 + 13, así que \(y\) = **13**.
- \(z = (p − 1) × (q − 1)\) = 4 × 10 = 40. \(e × d\) = 3 × 27 = 81 = 2 × 40 + 1: residuo 1. Sí es la privada.
- En Python: `pow(3, -1, 40)` da 27, y `pow(13, 27, 55)` da **7**, el mensaje original.
? [facil] Para cada tramo del camino de una foto de Alba, di si va cifrado y qué lo protege: (a) backend de publicaciones → ALB; (b) ALB → gateway; (c) gateway → Triton; (d) Fluent Bit → S3. (El ALB es la puerta de entrada; el gateway prepara la foto; Triton corre el modelo; Fluent Bit sube los logs a S3.)
- (a) **Cifrado con TLS**: el ALB presenta el certificado público de `api.alba.example`.
- (b) **Sin cifrar**: HTTP por la red privada de Alba (la VPC), después de que el ALB termina TLS.
- (c) **Sin cifrar**: dentro del cluster. Lo protegen la red privada, que Triton no tenga entrada desde fuera y la NetworkPolicy que solo deja hablar al gateway al puerto 8000.
- (d) **Cifrado con TLS** en el viaje (todo lo que sale de un pod va por TLS) y **en reposo** con SSE-KMS al guardarse.
? [medio] DES, el estándar anterior a AES, tiene llaves de 56 bits. Un atacante con hardware dedicado prueba 10¹² llaves por segundo. ¿Cuánto tarda en promedio? ¿Y contra AES-128 con la misma máquina?
- Con \(K = 2^L\), \(t = K ÷ (2 × v)\) y \(v\) = 10¹² llaves/s.
- DES: \(K = 2^{56}\) ≈ 7.2 × 10¹⁶. \(t\) = 7.2 × 10¹⁶ ÷ (2 × 10¹²) ≈ 3.6 × 10⁴ s ≈ **10 horas**.
- AES-128: \(K = 2^{128}\) ≈ 3.4 × 10³⁸; \(t\) ≈ 3.4 × 10³⁸ ÷ (2 × 10¹²) ≈ 1.7 × 10²⁶ s ≈ **5.4 × 10¹⁸ años**.
- Son 72 bits más: 2⁷² ≈ 4.7 × 10²¹ veces más trabajo.
? [medio] El archivo de pesos del modelo de Alba pesa 98.4 MB. ¿Cuántas llamadas a `Encrypt` de KMS harían falta para cifrarlo directo, en pedazos de 4,096 bytes? ¿Y con cifrado de sobre? Triton baja el archivo de S3 (cifrado con SSE-KMS) cada vez que carga el modelo: ¿qué llamada a KMS se hace entonces?
- Con \(n_{llamadas}\) = ⌈\(D\) ÷ 4,096⌉ y \(D\) = 98,400,000 bytes.
- Directo: 98,400,000 ÷ 4,096 ≈ 24,023.4, que redondeado hacia arriba son **24,024 llamadas**.
- Con sobre: **una** `GenerateDataKey` al guardarlo; el archivo se cifra con AES en la máquina.
- Al cargar: **una** `Decrypt` de la llave de datos cifrada (cientos de bytes), si la política de la llave deja descifrar al rol de Triton. Con SSE-KMS, la hace S3 en el `GET`, con los permisos de Triton.
? [medio] El celular de Ana tiene ≈ 60 ms de RTT (ida y vuelta) a Virginia. TCP necesita 1 ida y vuelta para abrir la conexión; el saludo de TLS 1.3, otra, y el de TLS 1.2, dos. ¿Cuánto le cobra la red a una request por una conexión nueva con TLS 1.3, por una nueva con TLS 1.2 y por una ya abierta? ¿Qué parte de la diferencia es el saludo de TLS?
- La red cobra \(k × RTT\), con \(k\) = las idas y vueltas de TCP + TLS + la request.
- Nueva con TLS 1.3, \(k\) = 3 (TCP + TLS + request): 3 × 60 = **180 ms**.
- Nueva con TLS 1.2, que cobra 2 RTT de saludo: \(k\) = 4: 4 × 60 = **240 ms**.
- Ya abierta: \(k\) = 1: **60 ms**.
- El saludo de TLS es 60 ms con 1.3 y 120 ms con 1.2. Por eso se reutilizan las conexiones con keep-alive.
? [medio] Una URL prefirmada trae `vence=1793974685` y un HMAC de la URL. Un atacante cambia la fecha a `1893974685` y recalcula el SHA-256 de la URL nueva. ¿Por qué S3 la rechaza? ¿Por qué S3 compara la etiqueta con una función de tiempo constante?
- S3 recalcula el HMAC de la URL recibida **con la llave secreta** del firmante. El atacante no tiene esa llave: su SHA-256 sin llave no es un HMAC, y el que S3 calcula no coincide con el que trae la URL. S3 responde 403 (prohibido).
- Una comparación normal se detiene en el primer byte distinto: midiendo cuánto tarda, el atacante podría adivinar la etiqueta byte por byte. La de tiempo constante tarda lo mismo siempre.
? [reto] Diffie–Hellman con \(g\) = 5 y \(P\) = 23. El cliente elige \(a\) = 6 y el servidor \(c\) = 15. Calcula \(A\), \(C\) y el secreto \(S\) de cada lado. Luego explica qué tendría que hacer un intermediario para leer la conversación y qué parte de TLS se lo impide.
- \(A = g^a\) mod \(P\) = 5⁶ mod 23 = 15,625 mod 23 = **8** (23 × 679 = 15,617; sobran 8).
- \(C = g^c\) mod \(P\) = 5¹⁵ mod 23 = **19** (compruébalo con `pow(5, 15, 23)`).
- Cliente: \(S = C^a\) mod \(P\) = 19⁶ mod 23 = **2**. Servidor: \(S = A^c\) mod \(P\) = 8¹⁵ mod 23 = **2**. Iguales.
- Un intermediario tendría que hacer un acuerdo distinto con cada lado: mandarle al cliente su propio número en lugar de \(C\). Lo impide el **certificado**: el servidor firma el saludo con su llave privada, y el intermediario no puede producir esa firma para `api.alba.example`.
? [reto] Si Alba no tuviera Bucket Key en ningún bucket, y además de las 7.5 millones de fotos nuevas al día S3 leyera 10 millones de fotos al día con SSE-KMS, ¿cuánto pagaría de KMS al mes? ¿Y con Bucket Key al 99 %? Usa sus precios: US$1 al mes por su llave de fotos y logs y US$0.03 por cada 10,000 requests, con meses de 30.4 días; cada objeto escrito o leído sin Bucket Key es una request.
- Con \(Q = W × 30.4 × (1 − F)\) y costo = \(n_{llaves}\) × 1 + 0.03 × \(Q\) ÷ 10,000, con \(n_{llaves}\) = 1.
- \(W\) = 7.5 M + 10 M = 17.5 M objetos al día. Sin Bucket Key, \(F\) = 0: \(Q\) = 17.5 M × 30.4 = **532 M** requests al mes.
- Costo = 1 + 0.03 × 532 M ÷ 10,000 = 1 + 1,596 = **≈ US$1,597 al mes**: casi 9 de cada 10 dólares de lo que cuesta toda la infraestructura del clasificador (≈ US$1,800 al mes).
- Con \(F\) = 0.99: \(Q\) = 5.32 M; costo = 1 + 15.96 ≈ **US$17 al mes**.
:::

## Lo que sigue {What comes next}

- «Autenticación y permisos» abre el JWT que el ALB verifica: un JSON firmado, sus campos y por qué dura 15 minutos. Ahí verás a mano cómo se valida su firma con HMAC, y cómo se guardan las contraseñas con un hash lento con sal.
- «Datos personales y la ley» usa el HMAC para seudonimizar identificadores, y el cifrado en reposo y la política de la llave como parte de cómo se protegen los datos de las personas.
- «Ataques y cadena de suministro» usa las firmas digitales para firmar las imágenes del gateway y para que el cluster rechace lo que no firmó el CI de Alba.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
cifrado texto-cifrado llave-simetrica aes fuerza-bruta llave-asimetrica firma-digital hmac mitm certificado autoridad-certificadora tls mtls terminacion-tls cifrado-en-transito cifrado-en-reposo kms llave-maestra llave-de-datos cifrado-de-sobre sse-kms politica-llave rotacion-llaves
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué el algoritmo de cifrado puede ser público y la llave no?
Porque la seguridad está solo en la llave (principio de Kerckhoffs). Un algoritmo público lo han revisado miles de expertos; uno secreto, casi nadie.
? ¿Por qué nadie ataca AES-128 probando llaves?
Porque son 2¹²⁸ ≈ 3.4 × 10³⁸: aun a 10¹⁸ llaves por segundo, se tardaría ≈ 390 veces la edad del universo. Se ataca dónde está guardada la llave.
? ¿Qué problema del cifrado simétrico resuelve la llave pública, y cuál deja abierto?
Resuelve cómo acordar un secreto sin habérselo pasado antes. Deja abierto saber de quién es la llave pública: lo resuelve el certificado firmado por una CA.
? ¿Qué diferencia hay entre un HMAC y una firma digital?
El HMAC usa una llave compartida: solo verifica quien la tiene, y ese también podría firmar. La firma usa un par: firma la privada y cualquiera verifica con la pública.
? En Alba, ¿dónde termina TLS y qué protege el tramo gateway → Triton?
En el ALB. El tramo gateway → Triton va sin cifrar por la red privada; lo protegen que Triton no tenga entrada desde fuera y la NetworkPolicy que solo deja entrar al gateway.
? ¿Por qué S3 usa cifrado de sobre en vez de mandar cada objeto a KMS?
Porque `Encrypt` de KMS acepta 4,096 bytes como máximo y cada llamada cuesta red y dinero. Se cifra cada objeto con una llave de datos local, y a KMS solo va esa llave chica.
? Si un rol tiene `s3:GetObject` sobre un bucket con SSE-KMS, ¿puede leer los objetos?
Solo si además tiene permiso de `kms:Decrypt` en la llave, que da su política (o IAM, si la política se lo delega). Sin eso, Access Denied: la llave es un segundo candado.
:::
