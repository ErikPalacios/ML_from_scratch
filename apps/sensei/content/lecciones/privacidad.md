---
titulo: Datos personales y la ley
en: Personal data and the law
subtitulo: Qué cuenta como dato personal en un sistema de ML, dónde se copia, por qué un hash no lo vuelve anónimo y qué te piden las leyes de México y de Europa cuando alguien pide borrar lo suyo.
pregunta: La foto que Ana sube a Alba puede traer su cara, su casa y el GPS de su teléfono. ¿Qué de eso es un dato personal, dónde termina copiado, cómo se protege sin dejar de entrenar el modelo y qué pasa si Ana pide que lo borren?
requisitos: almacenamiento, cifrado, identidad
---

:::idea
Un dato personal es cualquier dato que lleva, directa o indirectamente, a una persona: una cara, un GPS, un id que se puede unir con otra tabla. La protección más barata es no guardarlo. Lo que sí guardas debe tener un mapa, un plazo y una forma de borrarse, y un hash sin llave no lo vuelve anónimo.
:::

Alba, la empresa que seguimos en el curso, es un marketplace en línea: cualquiera publica lo que vende, y al publicar, Alba le sugiere la categoría de cada foto entre 500. Recibe ≈ 2.5 millones de publicaciones nuevas al día y su clasificador responde ≈ 10 millones de fotos al día, contando las que le piden otros equipos. Cada predicción deja una línea de **log** (el registro de texto que el sistema escribe de lo que hizo) de ≈ 300 bytes, que se guarda 90 días. Sus máquinas están en AWS, la nube de Amazon, en la [[region|región]] `us-east-1`, en Virginia, Estados Unidos.

Ana, una vendedora de la Ciudad de México, sube la foto de unos tenis. En la foto se ve la orilla de su sala. El archivo trae, escondido, su [[exif|EXIF]]: los metadatos que el teléfono agrega solo, entre ellos el modelo del teléfono y, si tenía la ubicación prendida, el GPS de su casa.

Para el modelo, la foto es una matriz de números que termina en «Calzado › Tenis». Para la ley, es información de una persona. Esta lección trata de lo que eso significa para quien construye el sistema: qué cuenta como dato personal, dónde se copia, cómo se guarda lo mínimo, por qué «lo hasheamos» no basta, cómo se borra algo que ya pasó por logs, datasets y modelos, y qué dicen las leyes de México y de Europa.

:::nota Esto no es asesoría legal
Las leyes cambian y se interpretan. Lo que decide qué ley aplica y qué plazo vale es el equipo legal de la empresa. Lo que pone quien hace ML es el **mecanismo**: saber dónde está cada dato, poder borrarlo y poder demostrar qué se hizo. Las fechas y los artículos de esta lección se revisaron en noviembre de 2026.
:::

## Qué es un dato personal {What counts as personal data}

Las leyes usan una definición amplia. En México y en Europa, un **[[dato-personal|dato personal]]** (*personal data*) es cualquier información de una persona física (un ser humano, no una empresa) **identificada o identificable**. Identificada: el dato dice quién es («Ana López»). Identificable: con ese dato, solo o junto con otros, alguien podría llegar a saber quién es.

La segunda mitad es la que importa en ML. Casi nunca tienes el nombre de alguien en una tabla de entrenamiento. Pero tienes cosas que llevan a la persona:

- **Directos:** nombre, correo, teléfono, CURP (la Clave Única de Registro de Población, el código de 18 caracteres que identifica a cada persona en México), una foto de la cara, una credencial para votar.
- **Indirectos:** el GPS de una foto, una placa de coche, la fachada de una casa, una [[direccion-ip|dirección IP]] (el número que identifica a un aparato en internet), el id de un teléfono.
- **Ids internos que se pueden unir:** el `seller_id` de Ana, el número interno con el que Alba identifica a cada vendedora, no dice su nombre, pero la base de datos de Alba sí lo une con su cuenta (un [[join]]: juntar dos tablas por una columna que comparten). Mientras exista esa unión, es dato personal.

:::ejemplo ¿Es dato personal?
- «Unos tenis blancos talla 26». No: no lleva a nadie.
- «La foto de los tenis de Ana, con su sala al fondo». Sí: la foto está ligada a su publicación y a su cuenta.
- «GPS 19.4326, −99.1332 a las 21:14». Sí: un punto donde alguien estuvo a cierta hora lleva a una casa y a quien vive ahí.
- «El 31 % de las fotos de tenis llegan de noche». No: es un conteo de muchas personas, del que no se puede sacar a nadie.
:::

:::profundo PII no es exactamente lo mismo
En el trabajo vas a oír **[[pii|PII]]** (*personally identifiable information*, información que identifica a una persona). Es un término que viene de Estados Unidos y que muchas veces se usa como lista: nombre, número de seguro social (el número de identificación de cada persona en Estados Unidos), correo, teléfono, dirección. La idea de «dato personal» de las leyes es más amplia: incluye lo que **hace identificable** a alguien al cruzarlo con otra cosa. Un id de dispositivo o un prefijo de [[funcion-hash|hash]] (los primeros caracteres de una huella calculada a partir del dato; lo ves más abajo) pueden no estar en una lista de PII y aun así ser dato personal.

Por eso, cuando un equipo dice «nuestro log no trae PII», la pregunta de vuelta es: ¿trae algo que, unido con otra tabla, lleve a una persona? Si la respuesta es sí, sigue siendo dato personal.
:::

### Datos sensibles: los que más dañan

Algunos datos personales hacen más daño si se escapan o se usan mal, porque pueden llevar a discriminar a alguien o ponerlo en riesgo. Son los **[[dato-sensible|datos sensibles]]** (*sensitive data*; en Europa, «categorías especiales»): el estado de salud, el origen étnico o racial, las creencias religiosas o filosóficas, las opiniones políticas, la preferencia sexual y la información genética.

Las leyes les piden más: un permiso explícito para usarlos (en México, además, por escrito) y medidas de seguridad más fuertes.

:::profundo La lista de cada ley
En Europa la lista suma la vida sexual, la afiliación sindical y los datos biométricos (medidas del cuerpo, como la cara o la huella digital) usados para identificar a una persona. La lista de la ley mexicana es de ejemplos: otro dato cuyo mal uso pueda llevar a discriminar a alguien también cuenta como sensible.
:::

:::profundo Una cara en una foto no es, por sí sola, un dato biométrico
Que en la foto de Ana se vea su cara la vuelve dato personal. En Europa se vuelve dato biométrico sensible cuando se procesa con técnica para **reconocer** a la persona: sacar un [[vector]] de su cara (una lista de números que la resume) y compararlo con otros. Alba no hace reconocimiento facial: clasifica tenis. Si un día un equipo quisiera agrupar fotos por la cara de quien vende, cambiaría de categoría y necesitaría otra revisión legal.
:::

:::profundo También los datos de quien opera el sistema
Los datos personales no son solo de los clientes. Cuando Marta, la ingeniera de guardia de Alba (la que atiende las fallas en su turno), entra a una máquina o lee un [[bucket-objetos|bucket]], el [[registro-auditoria|registro de auditoría]] anota su usuario, su dirección IP y la hora: también son datos personales, de una empleada. Lo mismo los [[commit|commits]] (cada cambio guardado en el código) con nombre y correo, o las grabaciones de una llamada de soporte. Se protegen con la misma lógica: guardar lo necesario (para auditar sí hace falta saber quién fue), con un plazo y con acceso solo para quien lo revisa.
:::

## El mapa: dónde se copia cada dato {The data map: where every copy lives}

Antes de proteger un dato, hay que saber dónde está. Ese inventario se llama **[[mapa-de-datos|mapa de datos]]** (*data map*): una lista de cada lugar donde se guarda o se copia un dato personal, con qué campos, para qué, cuánto tiempo y quién lo puede leer.

En un sistema de ML, los datos personales se copian en lugares que nadie diseñó como «la base de datos de clientes»:

- **Los logs de [[request|requests]] y de predicciones.** Cada request (cada petición que llega al sistema) deja una línea. Si la línea guarda el [[body]], el cuerpo de la request donde viaja la foto, guarda la foto.
- **Los datasets y sus [[snapshot|snapshots]].** Una foto que entra a un dataset queda en cada versión congelada de ese dataset.
- **El proveedor de [[etiquetado]].** Otra empresa cuyas personas le ponen a cada foto su categoría correcta, para entrenar: ven las fotos.
- **Los metadatos del archivo.** El EXIF viaja dentro del [[jpeg|JPEG]] (el formato del archivo de la foto) a donde vaya el JPEG.
- **Los servicios de terceros.** Una [[api|API]] (la puerta por la que un programa le pide algo a otro) de un [[llm|modelo de lenguaje]] o un servicio de notificaciones reciben lo que les mandes.
- **Las copias de «un rato».** Un [[csv|CSV]] (una tabla en un archivo de texto) bajado a una laptop, un [[notebook]] con una muestra, un respaldo en otra región.

Así se ve el mapa de Alba para la foto de Ana. Toca cada caja para ver qué guarda, y sigue el recorrido.

:::diagrama privacidad-mapa
Las copias que deja una sola foto. El clasificador no guarda la foto: la guarda el marketplace. Lo que queda del lado de ML es una línea de log sin la foto ni el nombre, pero que todavía se puede ligar a Ana (seudónima: lo ves en «Seudonimizar no es anonimizar») y, si la foto sale dudosa, una copia sin EXIF que va a etiquetar.
:::

Fíjate en lo que **no** está. El gateway, el programa que recibe la foto y se la pasa al modelo, no la guarda: la [[decodificar|decodifica]] en memoria (la convierte en números en la RAM, sin escribirla en disco) y la suelta. Triton, el servidor del modelo, tampoco. La foto original la guarda el producto, en su propio bucket (un almacén de archivos en la nube), porque es la publicación de Ana. El clasificador la usa y la deja ir.

### Cuántos registros personales hay vivos a la vez

La [[retencion|retención]] es cuánto tiempo se guarda cada cosa antes de borrarse. Con ella se calcula cuántos registros hay vivos en un momento, que es justo lo que se escaparía si algo saliera mal.

:::formula Registros vivos y retención real
E = r × D
D_{real} = max(D_1, D_2, …, D_n)
- r: registros nuevos al día, en registros por día (o por mes, si \(D\) va en meses: las dos en la misma unidad de tiempo)
- D: cuánto tiempo se guarda cada registro antes de borrarse, su retención, en días (o en meses, si \(r\) va por mes)
- E: registros vivos en cualquier momento, en registros, ya que el almacén se llenó: los que quedarían expuestos en una brecha
- D_1, …, D_n: la retención de cada copia del mismo dato, en días (el log, un respaldo, un CSV bajado)
- n: cuántas copias hay de ese dato
- D_{real}: la retención de verdad, en días: la de la copia que más dura
:::

:::cuenta Las líneas vivas del log de Alba
Líneas nuevas al día, \(r\) // una por foto, ficha de Alba | ≈ 10 M | 10,000,000
Retención, \(D\) // ficha de Alba | 90 días | 90
Líneas vivas, \(E\) | \(E = r × D\) = 10 M × 90 | 900 M líneas
Bytes vivos, \(E\) × bytes por línea // ≈ 300 B por línea, ficha de Alba | 900 M × 300 B | ≈ 270 GB
Líneas vivas, \(E\), si la retención \(D\) fuera de 30 días | \(E = r × D\) = 10 M × 30 | 300 M líneas
Si alguien copia el log a un bucket sin regla de borrado y lo deja un año // supuesto del ejemplo | \(D_{real}\) = max(90, 365) | 365 días
Líneas vivas con esa copia, \(E\) | \(E = r × D_{real}\) = 10 M × 365 | 3,650 M líneas
= Con 90 días hay 900 millones de líneas vivas. Una sola copia olvidada sube la retención real a 365 días y multiplica por ≈ 4 (3,650 ÷ 900) lo que se escaparía en una brecha.
:::

La segunda fórmula es la trampa más común: la retención real no es la que dice la política, sino la de la copia que más dura. Por eso la retención se escribe como regla automática en cada almacén (una regla de [[ciclo-vida|ciclo de vida]] en S3, el almacén de archivos de AWS, que borra cada archivo al cumplir su plazo; o un job, un programa que corre, hace su tarea y termina, que purga una tabla) y no como buena voluntad.

## Minimizar, decir para qué y pedir permiso {Minimize, state the purpose, ask for permission}

### Minimizar: lo que no guardas no se escapa

La **[[minimizacion|minimización]]** (*data minimization*) es juntar y guardar solo lo que necesitas para lo que vas a hacer. Es la medida más barata de todas: no cuesta cifrar, ni vigilar, ni borrar lo que nunca guardaste.

Alba minimiza en tres lugares:

- **El log de predicciones** guarda el [[request-id|`request_id`]] (el número único de cada request), quién llamó, la versión del modelo, las 5 categorías con sus probabilidades, las [[latencia|latencias]] (cuánto tardó cada paso), los bytes y un prefijo del [[hash-criptografico|hash SHA-256]] de la foto: los primeros caracteres de una huella que sale de sus bytes. **No** guarda la foto, ni el EXIF, ni el id de la vendedora en claro (tal cual, sin esconder).
- **Las fotos que van a etiquetar**, ≈ 5,000 al mes (sobre todo las que el modelo clasificó con poca seguridad), se copian **sin EXIF** a un bucket restringido y se borran a los 90 días.
- **El [[golden-set|golden set]]**, el examen fijo de 50,000 fotos con el que se evalúa cada modelo, se guarda congelado y sin EXIF.

La forma práctica de minimizar un log es una lista de campos **permitidos** (*allowlist*), no una lista de campos prohibidos. Con una lista de prohibidos, el día que alguien agrega un campo nuevo, como el id de la vendedora, se cuela al log sin que nadie lo decida. Con una de permitidos, lo nuevo se queda fuera hasta que alguien lo agregue a propósito.

```python
import json

PERMITIDOS = ["request_id", "caller", "model_version", "top_k", "latencia_ms", "bytes", "sha256_prefijo"]

def linea_de_log(evento):
    # allowlist: solo pasan los campos de la lista; lo nuevo o lo inesperado se queda fuera
    return {campo: evento[campo] for campo in PERMITIDOS if campo in evento}

evento = {
    "request_id": "9f2c41d0", "caller": "backend-publicaciones", "model_version": "resnet50-2026-10-01",
    "top_k": [["Calzado > Tenis", 0.94]], "latencia_ms": 21, "bytes": 200000,
    "sha256_prefijo": "3a7bd3e2360a3d29",
    "vendedora_id": "ana-48213",                        # no está en la lista: no pasa
    "exif": {"gps": [19.4326, -99.1332], "modelo": "Teléfono X"},   # tampoco
    "foto": "<200 KB de bytes JPEG>",                   # tampoco
}
linea = linea_de_log(evento)
print(sorted(set(evento) - set(linea)))
print(len(json.dumps(evento)), "->", len(json.dumps(linea)), "caracteres")
```

```salida
['exif', 'foto', 'vendedora_id']
343 -> 213 caracteres
```

Los tres campos que se quedaron fuera son justo los que llevan a Ana. En el evento de verdad, la foto pesaría ≈ 200 KB y no 23 caracteres. La línea de juguete mide 213 caracteres; la real, con las 5 categorías y todas las latencias, mide ≈ 300 bytes: unas 670 veces menos que la foto.

### Finalidad: para qué juntaste el dato

La **[[finalidad]]** (*purpose limitation*) es el «para qué» de un dato. Las leyes piden decirlo antes de juntarlo y no usarlo después para otra cosa que no sea compatible. Ana subió su foto **para publicar sus tenis**. Que Alba use esa foto para sugerirle la categoría encaja con eso.

Entrenar un modelo con esa foto ya es otra pregunta. Puede caber en la finalidad original, si el aviso de privacidad lo dice (el documento que dice para qué se usan los datos; lo ves dos secciones abajo), o puede ser una finalidad nueva. En México, usar un dato para una finalidad que no está en el aviso exige volver a pedir el consentimiento; en Europa depende de si la nueva finalidad es compatible con la original. En ML esto aparece a cada rato: los logs que se juntaron para depurar errores terminan siendo un dataset; las conversaciones de soporte terminan entrenando un asistente. Cada salto de finalidad es una decisión que pasa por legal, y quien hace ML es quien primero lo nota.

### Consentimiento y aviso de privacidad

El **[[consentimiento]]** (*consent*) es el permiso de la persona para que uses sus datos. Para que valga tiene que ser **libre** (sin obligarla), **informado** (sabe qué va a pasar) y **específico** (para una finalidad concreta, no «para lo que sea»). Para datos sensibles, las leyes piden que sea **expreso**: una acción clara, no el silencio.

El consentimiento tiene un costo de diseño: la persona lo puede retirar en cualquier momento, y entonces tienes que dejar de usar el dato y saber dónde está.

:::profundo Expreso, por escrito o tácito
En México, el consentimiento para datos sensibles, además de expreso, va por escrito: con firma autógrafa (a mano), firma electrónica u otro mecanismo de autenticación (una forma de comprobar que de verdad es esa persona). Para los demás datos, la ley mexicana acepta por regla general el consentimiento **tácito**: si la empresa te puso el aviso de privacidad a la vista y no te opusiste.
:::

:::profundo El consentimiento no es la única base
Usar un dato puede apoyarse en otras razones que la ley acepta: cumplir un contrato con la persona (para publicar los tenis de Ana, Alba necesita la foto), una obligación legal o, en Europa, un «interés legítimo»: una razón válida de la empresa, siempre que se haya pesado contra los derechos de la persona y no pese más. En Europa, el consentimiento es una de seis bases legales al mismo nivel; en México es la regla general, y la ley enumera los casos en que no hace falta (entre ellos, cumplir la relación con la persona o una ley).
:::

En México, lo que avisa todo esto es el **[[aviso-privacidad|aviso de privacidad]]** (*privacy notice*): el documento que la empresa pone a disposición de la persona a más tardar en el momento en que junta sus datos. En la práctica es la página «Aviso de privacidad» que aceptas al crear una cuenta.

Para quien hace ML, el aviso es un contrato con el sistema: si el aviso de Alba no dice que las fotos se usan para entrenar modelos, entrenar con ellas no está cubierto, aunque el código funcione. Por eso, antes de armar un dataset con datos de usuarios, se lee el aviso.

:::profundo Qué trae un aviso de privacidad
Dice quién es la empresa y su domicilio, qué datos junta (y cuáles son sensibles), para qué finalidades, cómo puede la persona limitar su uso y ejercer sus derechos, y cómo se le avisarán los cambios. Si la empresa piensa transferir los datos a otra empresa, trae además una cláusula para que la persona diga si lo acepta.
:::

## Seudonimizar no es anonimizar {Pseudonymizing is not anonymizing}

Hay dos operaciones que suenan igual y no lo son.

**[[seudonimizacion|Seudonimizar]]** (*pseudonymization*) es reemplazar el identificador de una persona por otro: en vez de `ana-48213`, guardar `p-7f3a`. Quien tiene la tabla de equivalencias, o la llave con la que se calculó el reemplazo, puede volver a la persona. Por eso un dato seudónimo **sigue siendo dato personal**. Lo que gana es que quien solo ve el log no sabe de quién es cada línea.

**[[anonimizacion|Anonimizar]]** (*anonymization*) es transformar los datos de modo que **nadie**, con medios razonables, pueda volver a la persona. Un dato anónimo de verdad deja de ser dato personal y sale de las leyes de protección. Por eso es tan tentador decir «está anonimizado», y por eso hay que demostrarlo.

:::analogia El ticket del guardarropa
Seudonimizar es como el guardarropa de una fiesta: tu abrigo cuelga con el número 47, sin tu nombre. Quien solo ve los ganchos no sabe de quién es cada abrigo, pero quien tiene la libreta que dice «47 = Ana» sí. Anonimizar sería quitarles el número a todos los abrigos y quemar la libreta, de modo que nadie, ni el encargado, pueda decir cuál es de Ana.

Dónde se rompe: un abrigo sin número todavía se reconoce por su color o su talla, y con los datos pasa igual: aun sin ningún id, la fecha, la ciudad y otros detalles pueden señalar a alguien. Es lo que verás en «Reidentificación y k-anonimato».
:::

El log de predicciones de Alba es **seudónimo**, no anónimo. No trae el nombre de Ana, pero trae el `request_id`, y el backend de publicaciones (el programa del marketplace que guarda cada publicación) guarda ese mismo `request_id` junto a la publicación: con una unión se llega a Ana. Y trae un prefijo del hash de la foto: quien tenga la foto publicada calcula su hash y encuentra la línea.

### Por qué un hash sin llave no esconde nada

Una [[funcion-hash|función hash]] como SHA-256 convierte cualquier texto en una huella de largo fijo (en SHA-256, 64 caracteres), y no se puede «deshacer»: de la huella no se saca el texto. Por eso parece buena idea guardar `sha256(teléfono)` en vez del teléfono. El problema es que no hace falta deshacerla: basta con **probar todos los teléfonos posibles**, calcular su hash y ver cuál coincide. Es un ataque de [[fuerza-bruta|fuerza bruta]], y funciona porque el hash es determinista (el mismo teléfono siempre da la misma huella) y porque los teléfonos posibles son pocos. Es la misma cuenta de fuerza bruta de «Cifrado, llaves y certificados», aplicada a un dato chico en vez de a una llave.

:::formula Tiempo para probar todos los valores
N = 10^d
N = 2^L
t = frac{N}{v}
- d: cuántos dígitos tiene el identificador, en dígitos (un teléfono en México: 10)
- L: cuántos bits tiene una llave secreta, en bits, si lo que se prueba es la llave y no el dato (la de HMAC, que ves en un momento, tiene 256)
- N: cuántos valores posibles hay, en valores: \(10^d\) para un dato de \(d\) dígitos, \(2^L\) para una llave de \(L\) bits
- v: cuántos hashes calcula el atacante por segundo, en hashes por segundo
- t: el tiempo para probarlos todos, en segundos; en promedio encuentra el bueno a la mitad (por eso en «Cifrado, llaves y certificados», que cuenta el promedio, se divide entre 2)
:::

:::cuenta Un teléfono hasheado sin llave
Dígitos, \(d\) // un teléfono de México | 10 | 10
Valores posibles, \(N\) | \(N = 10^d = 10^{10}\) | 10,000,000,000
Velocidad de una [[gpu\|GPU]] de juego, \(v\) // la de «Cifrado, llaves y certificados», que mide ≈ 2.2 × 10¹⁰ SHA-256 por segundo; redondeado | 2 × 10¹⁰ | 20,000,000,000
Tiempo con la GPU, \(t\) | \(t = N ÷ v\) = 10¹⁰ ÷ (2 × 10¹⁰) | 0.5 s
Velocidad de Python en una laptop, \(v\) // el bucle del programa de abajo, un solo núcleo: de 1 a 3 × 10⁶ según la laptop | ≈ 2 × 10⁶ | 2,000,000
Tiempo con la laptop, \(t\) | 10¹⁰ ÷ (2 × 10⁶) = 5,000 s | ≈ 1.4 h
= Todos los teléfonos de México se prueban en medio segundo con una GPU y en una a tres horas con Python en una laptop. Hashear un teléfono sin llave no lo esconde.
:::

El programa de abajo lo hace con un espacio de juguete: un teléfono que empieza con `551234` y del que faltan 4 dígitos, \(N = 10^4\). Después hace lo mismo con [[hmac|HMAC]], un hash que mezcla una **llave secreta** con el dato.

```python
import hashlib, hmac

def h(tel):                                   # hash sin llave: cualquiera lo puede calcular
    return hashlib.sha256(tel.encode()).hexdigest()

# El log «anonimizado» trae el hash de un teléfono de juguete: 55 1234 seguido de 4 dígitos
log = h("5512348907")
print("en el log:", log[:16], "...")

# El atacante no necesita deshacer el hash: prueba todos los teléfonos posibles
intentos = 0
for resto in range(10_000):                   # 10^4 opciones en este juguete
    candidato = f"551234{resto:04d}"
    intentos += 1
    if h(candidato) == log:
        print("encontrado:", candidato, "en", intentos, "intentos")
        break

# Con HMAC, la huella depende de una llave que el atacante no tiene
llave = bytes(range(32))                      # en la vida real, 32 bytes al azar guardados en KMS
seudonimo = hmac.new(llave, b"5512348907", hashlib.sha256).hexdigest()
print("con HMAC:", seudonimo[:16], "...")
aciertos = sum(h(f"551234{r:04d}") == seudonimo for r in range(10_000))
print("aciertos del atacante sin la llave:", aciertos)
```

```salida
en el log: bf7aa9b0df4c3e42 ...
encontrado: 5512348907 en 8908 intentos
con HMAC: 762a31827fc4fe5b ...
aciertos del atacante sin la llave: 0
```

:::figura privacidad-hash
Arriba, el hash sin llave: el atacante calcula la misma cuenta sobre todos los teléfonos y encuentra el que coincide. Abajo, con HMAC: sin la llave, sus cuentas dan otras huellas y no coincide ninguna.
:::

### HMAC: un seudónimo estable que solo tú puedes calcular

Con HMAC, la huella depende del teléfono **y** de la llave. El atacante que no tiene la llave ya no puede probar teléfonos: tendría que adivinar la llave primero. Una llave de 256 [[bit|bits]] (ceros y unos) tiene 2²⁵⁶ ≈ 1.2 × 10⁷⁷ valores; con la misma fórmula, \(t = 2^{256} ÷ (2 × 10^{10})\) ≈ 5.8 × 10⁶⁶ segundos. La edad del universo es ≈ 4.4 × 10¹⁷ segundos (≈ 13,800 millones de años): la llave tardaría ≈ 1.3 × 10⁴⁹ veces eso.

Eso lo vuelve un buen **seudónimo**: el mismo teléfono siempre da el mismo HMAC, así que puedes contar cuántas veces aparece una persona o unir dos tablas tuyas, sin guardar el teléfono. La llave vive en un gestor de llaves ([[kms|KMS]], el servicio de AWS que guarda llaves y no las deja salir, o Secrets Manager), aparte de la llave de los buckets, y la usa solo el servicio que tiene permiso.

Pero sigue siendo seudónimo: quien tiene la llave puede recalcular el HMAC de cualquier teléfono y encontrar a la persona. Por eso el dato sigue siendo personal, se guarda con [[cifrado-en-reposo|cifrado en reposo]] (lo guardado en disco va cifrado: sin la llave, los bytes no se leen) y con acceso restringido, y la llave se protege como lo que es: la tabla de equivalencias.

:::calculadora privacidad-fuerza
Empieza con un teléfono de 10 dígitos y una GPU de juego. Cambia la velocidad a 2,000 (en miles de hashes por segundo: Python en una laptop) y verás los ≈ 83 minutos (≈ 1.4 h) de la cuenta. Prueba con 18 dígitos, como si una CURP fuera solo de números, y mira cuánto crece. Luego baja la llave a 40 bits: con la GPU, una llave corta se adivina en menos de un minuto (mira el tiempo con HMAC en segundos).
:::

:::profundo La sal secreta y el HMAC
Cuando reparte las vendedoras entre entrenamiento y prueba (el [[split]] del dataset) y entre los dos grupos de un experimento ([[ab-test|A/B]]), Alba usa un «hash con sal» del `seller_id`: le pega un texto fijo antes de hashear. Si esa sal es secreta y larga, se comporta como una llave. HMAC es la forma estándar y revisada de hacer lo mismo, sin los errores de armarla a mano; por eso es la que se recomienda.
:::

## Reidentificación y k-anonimato {Re-identification and k-anonymity}

Quitar el nombre y el teléfono no basta. La **[[reidentificacion|reidentificación]]** (*re-identification*) es volver a encontrar a la persona en datos que se publicaron como «anónimos», cruzándolos con otros datos que el atacante ya tiene.

Los datos que lo permiten se llaman **cuasi-identificadores**: ninguno identifica solo, pero juntos sí. El código postal, la fecha de nacimiento y el sexo son el ejemplo clásico: en un estudio publicado en 2000, con datos del censo de 1990, la investigadora Latanya Sweeney estimó que ≈ 87 % de la población de Estados Unidos queda identificada de forma única con solo esos tres datos.

:::profundo El caso del gobernador
En 1997, Sweeney ya había mostrado el riesgo con un caso real: encontró el expediente médico del gobernador de Massachusetts en los datos de visitas al hospital de los empleados del estado, que la aseguradora estatal había entregado «sin nombres», cruzándolos con el padrón electoral (la lista de votantes, que traía nombre, código postal, fecha de nacimiento y sexo).
:::

¿Por qué funciona? Porque las combinaciones posibles son muchas más que las personas.

:::formula Personas por combinación
C = c_1 × c_2 × … × c_j
m = frac{P}{C}
u ≈ e^{−(P − 1)/C}
- c_1, …, c_j: cuántos valores distintos puede tomar cada cuasi-identificador, en valores (códigos postales, fechas, sexos)
- j: cuántos cuasi-identificadores hay (en el ejemplo, 3)
- C: cuántas combinaciones posibles hay, en combinaciones
- P: cuántas personas hay en la tabla, en personas
- m: cuántas personas caen en cada combinación, en promedio
- u: la fracción de personas que quedan **solas** en su combinación, de 0 a 1 (o en %), si se reparten al azar y parejo
- e: el número de Euler, ≈ 2.718, la base de la función exponencial
:::

:::profundo De dónde sale la última fórmula
La última fórmula sale de pensar en una persona: cada una de las otras \(P − 1\) cae en su misma combinación con probabilidad \(1/C\). La probabilidad de que ninguna caiga ahí es \((1 − 1/C)^{P−1}\), que para \(C\) grande vale casi \(e^{−(P−1)/C}\).
:::

:::cuenta Una tabla de 100,000 personas
Personas, \(P\) // supuesto: una ciudad mediana | 100,000 | 100,000
Códigos postales, \(c_1\) // supuesto del ejemplo | 50 | 50
Fechas de nacimiento, \(c_2\) // ≈ 80 años × 365 días | 80 × 365 | 29,200
Sexo, \(c_3\) // hombre o mujer, como en el registro | 2 | 2
Combinaciones, \(C\) | \(C = c_1 × c_2 × c_3\) = 50 × 29,200 × 2 | 2,920,000
Personas por combinación, \(m\) | \(m = P ÷ C\) = 100,000 ÷ 2,920,000 | ≈ 0.034
Solas en su combinación, \(u\) // \(P − 1\) = 99,999 | \(u ≈ e^{−(P−1)/C}\) = \(e^{−99,999/2,920,000}\) = \(e^{−0.0342}\) | ≈ 96.6 %
Con solo el **año** de nacimiento, \(c_2\) | 80 | 80
Combinaciones, \(C\) | \(C = c_1 × c_2 × c_3\) = 50 × 80 × 2 | 8,000
Personas por combinación, \(m\) | \(m = P ÷ C\) = 100,000 ÷ 8,000 | 12.5
Solas, \(u\) | \(u ≈ e^{−(P−1)/C}\) = \(e^{−99,999/8,000}\) = \(e^{−12.5}\) | ≈ 0.0004 %
= Con la fecha completa, ≈ 97 de cada 100 personas son únicas: quitarles el nombre no las esconde. Con solo el año, quedan ≈ 12 por combinación y casi nadie está solo.
:::

:::profundo ¿Cuadra la fórmula con el 87 % de Sweeney?
Con los números de Estados Unidos de 1990 (≈ 249 millones de personas en el censo y del orden de 30,000 a 40,000 códigos postales de 5 dígitos), y con las mismas fechas de 80 años × 365 días y 2 sexos, la misma fórmula da \(u\) ≈ 87 % a 90 %, del mismo tamaño que el 87 % que estimó Sweeney. La fórmula supone que la gente se reparte parejo; en la vida real se amontona (muchas personas en unos códigos postales y unas edades), así que la cuenta es solo una aproximación: un análisis posterior, hecho con cómo se reparte de verdad la gente en el censo de 2000, dio ≈ 63 %, que sigue siendo la mayoría. Y los que quedan en las orillas son todavía más fáciles de encontrar.
:::

### k-anonimato: cada combinación, al menos k personas

El **[[k-anonimato|k-anonimato]]** (*k-anonymity*) es una regla para publicar tablas: cada combinación de cuasi-identificadores debe aparecer en **al menos \(k\) filas**. Así, quien sabe el código postal y la edad de alguien encuentra \(k\) candidatos, no uno. El \(k\) de una tabla es el tamaño de su grupo más chico.

Se consigue **generalizando**: en vez del código postal completo, sus primeros 3 dígitos; en vez de la edad, la década; o quitando una columna. Cada generalización junta filas en grupos más grandes y le quita detalle a la tabla.

:::profundo Medir el k con Python
Este programa toma la tabla de juguete de la figura de abajo, mide su \(k\) con los datos exactos y después de generalizar, y muestra qué padecimientos quedan en cada grupo.

```python
from collections import Counter

# Una tabla «anónima» de juguete: sin nombre, pero con código postal, edad y sexo
filas = [("06700", 23, "M", "asma"),     ("06700", 27, "M", "diabetes"),
         ("06700", 24, "H", "asma"),     ("06720", 31, "H", "gripa"),
         ("06720", 38, "H", "asma"),     ("06720", 35, "M", "gripa"),
         ("03100", 52, "M", "diabetes"), ("03100", 57, "M", "gripa")]

def k_de(tabla, cuasi):
    grupos = Counter(cuasi(f) for f in tabla)   # cuántas filas comparten cada combinación
    return min(grupos.values()), grupos

exacto = lambda f: (f[0], f[1], f[2])                   # código postal, edad y sexo tal cual
general = lambda f: (f[0][:3] + "**", f"{f[1] // 10 * 10}s")   # 3 dígitos, década, sin sexo

for nombre, cuasi in (("exacto", exacto), ("generalizado", general)):
    k, grupos = k_de(filas, cuasi)
    print(nombre, "-> k =", k, "| tamaños de los grupos:", sorted(grupos.values()))

_, grupos = k_de(filas, general)
for clave, n in grupos.items():
    print(clave, n, "padecimientos:", [f[3] for f in filas if general(f) == clave])
```

```salida
exacto -> k = 1 | tamaños de los grupos: [1, 1, 1, 1, 1, 1, 1, 1]
generalizado -> k = 2 | tamaños de los grupos: [2, 3, 3]
('067**', '20s') 3 padecimientos: ['asma', 'diabetes', 'asma']
('067**', '30s') 3 padecimientos: ['gripa', 'asma', 'gripa']
('031**', '50s') 2 padecimientos: ['diabetes', 'gripa']
```
:::

:::figura privacidad-k
La misma tabla dos veces (en la columna del sexo, M = mujer y H = hombre). Con los datos exactos, cada fila está sola (\(k\) = 1). Con el código postal a 3 dígitos, la edad por década y sin sexo, quedan 3 grupos de 3, 3 y 2 filas (\(k\) = 2).
:::

:::calculadora privacidad-k
Empieza con la tabla de la cuenta: 100,000 personas, 50 códigos postales, la fecha completa y el sexo. Cambia la fecha a solo el año (80) y mira cómo se desploma la fracción de personas solas. Luego sube los códigos postales a 2,000: una ciudad grande con mucho detalle vuelve a dejar gente sola.
:::

:::profundo Cuando el grupo entero comparte el secreto
El \(k\)-anonimato protege contra «¿cuál de estas filas es ella?», pero no contra «¿qué tiene?». Si las 2 personas del grupo `031**`, década de los 50, tuvieran diabetes, saber que tu vecina está en ese grupo te diría su diagnóstico sin saber cuál fila es. Para eso existe la **ℓ-diversidad**: cada grupo debe tener al menos ℓ valores distintos del dato sensible. Y aun así hay ataques que cruzan varias tablas publicadas.

La respuesta más fuerte que se conoce es la **privacidad diferencial** (*differential privacy*): en vez de publicar los datos, publicas resultados (conteos, promedios, incluso un modelo) con un ruido calculado, de forma que el resultado casi no cambia si una persona está o no está en los datos. La usó el censo de Estados Unidos de 2020 para publicar sus tablas, y la usan algunas empresas para publicar estadísticas. Tiene un costo: el ruido le quita precisión, sobre todo a los grupos chicos.
:::

Para ML, la lección práctica es esta: **un dataset sin nombres casi nunca es anónimo**. Un dataset de fotos con su fecha, su ciudad y la categoría de lo que se vende puede llevar a una persona. Lo honesto es tratarlo como seudónimo: dato personal, con acceso restringido, plazo y forma de borrarlo.

## Derechos de las personas y el borrado {People's rights and erasure}

Las leyes le dan a cada persona derechos sobre sus datos. En México se resumen en cuatro letras, los **[[derechos-arco|derechos ARCO]]** (*ARCO rights*):

- **Acceso:** saber qué datos suyos tienes y qué haces con ellos.
- **Rectificación:** corregirlos si están mal o incompletos.
- **Cancelación:** que los saques de tus archivos y sistemas. En México pasan primero por un **bloqueo**: se guardan sin usarse solo mientras dura el plazo para reclamar algo de esa relación, y luego se suprimen.
- **Oposición:** que dejes de usarlos para una finalidad, aunque los tengas bien.

En Europa son casi los mismos, más otros como la **portabilidad** (recibir tus datos en un formato que otro servicio pueda leer). El más famoso es el **[[derecho-borrado|derecho al borrado]]** (*right to erasure*), también llamado «derecho al olvido».

### Borrar en un sistema de ML: cuatro pasos

Borrar una fila de una base de datos es un `DELETE`, una orden de [[sql|SQL]]. Borrar a una persona de un sistema de ML es encontrar **cada copia**. Por eso el mapa de datos no es un trámite: sin él, el borrado es una búsqueda a ciegas.

:::pasos
1. Encontrar todo por id
El backend de publicaciones sabe qué publicaciones son de Ana y qué `request_id` tuvo cada foto. Con esos ids y el hash de cada foto se buscan las copias: en el log, en el bucket de fotos a etiquetar, en el golden set y en los manifests de los snapshots: el manifest es la lista de qué fotos forman cada snapshot.
2. Borrar y sacar de los manifests
Las fotos se borran de los buckets. Los manifests dicen en qué snapshots aparece cada una; el siguiente snapshot ya no las incluye. Los snapshots viejos son inmutables (no se pueden cambiar) a propósito: no se reescriben ni caducan. La huella de lo borrado se anota en un registro de borrados, y todo entrenamiento salta esas filas. Lo ves a fondo en [«Versionado y linaje»](/e02-versionado/).
3. Decidir qué pasa con el modelo
El modelo ya entrenado no se «desentrena»: no guarda las fotos, sino millones de [[parametro|parámetros]] (los números que aprendió) que cada foto movió un poco, así que no hay una fila que borrar. Se documenta, y el siguiente [[reentrenamiento]] mensual ya no incluye esas fotos. Qué tan pronto hay que llegar ahí lo decide legal.
4. Dejar constancia, sin repetir los datos
Se anota en el [[registro-auditoria|registro de auditoría]] qué se borró, de dónde y cuándo, con los ids y no con las fotos. Así se puede demostrar sin volver a guardar lo que se borró.
:::

:::diagrama privacidad-borrado
Lo que dispara una solicitud de borrado. Las flechas punteadas son lo que no se borra al instante: el log caduca solo a los 90 días, y el modelo cambia con el siguiente reentrenamiento.
:::

El log de predicciones merece una nota. Sus líneas no traen la foto ni el nombre de Ana, solo el `request_id` y un prefijo de hash, y caducan solas a los 90 días. Hay dos opciones: reescribir las [[particion-datos|particiones]] (los pedazos del log, uno por día) de los días donde aparece, sin esas líneas, o dejar que caduquen y decirlo. Cuál vale la decide legal; lo que pone ML es que las dos sean posibles: un log particionado por día, con una regla de borrado a los 90 días, y la forma de encontrar las líneas de una persona.

:::ojo Inmutable no quiere decir eterno
Los snapshots de los datasets son inmutables para que cada modelo se pueda reproducir: saber con qué fotos exactas se entrenó. Eso es bueno, pero un snapshot que nunca se borra parece guardar para siempre a quien pidió que lo borraran. La salida no es darle fecha de caducidad: las fotos se borran del almacén, la huella de lo borrado se anota en un registro de borrados que todo entrenamiento respeta, y un índice dice qué modelo usó cada snapshot.
:::

### Decisiones que toma solo un modelo

Hay un derecho que toca directo a ML. Una **[[decision-automatizada|decisión automatizada]]** (*automated decision*) es una decisión tomada **solo** por un sistema, sin una persona que la revise, que afecta a alguien de forma legal o igual de seria: negarle un crédito, rechazar su solicitud de empleo o suspender su cuenta. Las dos leyes le dan derechos a la persona frente a ella: en Europa, a no quedar sujeta a una decisión así; en México, a oponerse.

La sugerencia de categoría de Alba no está en ese caso: Ana ve la sugerencia y puede cambiarla a mano. Pero si un modelo de moderación bajara publicaciones sin que nadie las revise, o uno de fraude cerrara cuentas solo, sí. La defensa de diseño es la misma en todos: que exista una persona que revise los casos graves, y que se pueda explicar por qué se decidió.

:::profundo Lo que dice cada ley de las decisiones automatizadas
En Europa, la persona tiene derecho a **no quedar sujeta** a una decisión así. Hay excepciones (que sea necesaria para un contrato con ella, que una ley la permita o que ella lo consienta de forma explícita), y aun entonces puede pedir que una persona la revise y dar su punto de vista. La ley mexicana de 2025 reconoce el derecho a oponerse a un tratamiento automatizado, sin intervención humana, que le produzca efectos jurídicos no deseados o afecte de forma significativa sus intereses, derechos o libertades.
:::

## Desaprender: por qué no se promete {Unlearning: why it is not promised} [extra]

Un modelo no guarda las fotos con las que se entrenó. El de Alba, una [[resnet|ResNet-50]] que elige entre 500 categorías, guarda ≈ 24.5 millones de [[parametro|parámetros]] que cada foto movió un poquito durante el entrenamiento. No hay una fila que borrar.

Lo que piden quienes quieren «borrar a alguien del modelo» se llama **[[machine-unlearning|machine unlearning]]** (desaprendizaje automático): conseguir un modelo que se comporte como si esa persona nunca hubiera estado en los datos. La única forma segura de lograrlo es **reentrenar sin sus datos**. Hay técnicas de investigación que intentan hacerlo más barato, pero en noviembre de 2026 no son una herramienta estándar ni un método con garantía que se pueda prometer.

En Alba, reentrenar ya es rutina: cada mes, una corrida de ≈ 3 a 4 horas de una GPU cuesta ≈ US$3–4 (≈ US$10–50 al mes, con las corridas de prueba). Así que la promesa honesta es la que ya hace: el siguiente modelo mensual no incluye las fotos borradas, y el de antes se retira.

:::figura privacidad-desaprender
La línea del tiempo de un borrado. El modelo de octubre se entrenó con el snapshot de septiembre, que tiene la foto de Ana. Ana pide el borrado el 20 de octubre; el snapshot de octubre ya no la trae, y el modelo de noviembre se entrena sin ella.
:::

¿Importa que el modelo de octubre la «recuerde»? A veces sí. Un modelo grande puede memorizar ejemplos raros, y hay ataques de [[inferencia-pertenencia|inferencia de pertenencia]] que adivinan si un dato estuvo en el entrenamiento, o que sacan texto memorizado de un modelo de lenguaje. Para un clasificador de 500 categorías entrenado con ≈ 1.8 millones de fotos, el riesgo de que deje ver una foto de Ana es bajo. Para un modelo de lenguaje entrenado con conversaciones de soporte, no lo es: ahí conviene no meter datos personales al entrenamiento desde el principio.

### Reentrenar por pedazos

Una de las ideas de investigación más conocidas para abaratarlo (la publicaron en 2021 con el nombre SISA) es fácil de contar con números. En vez de un solo modelo con todas las fotos, entrenas 8 modelos chicos, cada uno con un octavo de los datos, y al predecir los juntas (por ejemplo, promediando sus probabilidades). Si Ana pide borrar una foto, solo reentrenas el pedazo donde estaba: ≈ 1/8 del trabajo. Si además cada pedazo guarda [[checkpoint|checkpoints]] (copias del modelo a mitad del entrenamiento), puedes regresar al checkpoint de antes de que entrara la foto y seguir desde ahí.

El costo está en la calidad: 8 modelos que vieron un octavo de los datos cada uno suelen equivocarse más que uno que vio todo, y predecir con 8 modelos cuesta más cómputo en cada request. Para Alba, que ya reentrena todo cada mes por ≈ US$3–4 la corrida, no vale la pena. Para un modelo que cuesta millones entrenar, la cuenta cambia, y por eso se investiga.

### Lo que sí guarda una fila por foto

Hay piezas de un sistema de ML que sí guardan algo por cada foto, y esas sí se borran fila por fila. Un **índice de búsqueda** con [[embedding|embeddings]] (vectores que resumen cada foto, para encontrar las parecidas) guarda un vector por foto: en Alba, el de recomendaciones guarda vectores de 128 números para ≈ 100 millones de publicaciones. Ese vector salió de la foto de Ana y apunta a su publicación: es dato derivado de ella, y cuando se borra la publicación se borra su vector del índice. Lo mismo pasa con un [[cache]] de predicciones por foto (una copia de cada respuesta, para no recalcularla) o con una [[feature-store|feature store]] (la base de datos de las columnas que un modelo usa como entrada) con columnas por vendedora. El mapa de datos las lista igual que a los buckets.

## La ley: México, Europa y los proveedores {The law: Mexico, Europe and vendors}

### En México: la LFPDPPP de 2025

La **[[lfpdppp|LFPDPPP]]** es la Ley Federal de Protección de Datos Personales en Posesión de los Particulares: la que aplica a las empresas privadas en México. La versión nueva se publicó en el *Diario Oficial de la Federación* (el periódico del gobierno donde se publican las leyes) el 20 de marzo de 2025, entró en vigor al día siguiente y reemplazó a la de 2010.

Sus piezas son las de esta lección: aviso de privacidad, consentimiento (expreso y por escrito para datos sensibles), finalidades, derechos ARCO, medidas de seguridad, el derecho a oponerse a tratamientos automatizados y reglas para transferir datos. Desde la reforma de 2025, la vigila la **Secretaría Anticorrupción y Buen Gobierno**, del gobierno federal.

A Alba le aplica porque trata datos de personas en México, como Ana.

:::profundo Quién la vigilaba antes
Antes de 2025 la vigilaba el INAI (Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales), un órgano autónomo, que no dependía del gobierno, y que desapareció con la reforma.
:::

### En Europa: el GDPR, aunque estés fuera

El **[[gdpr|GDPR]]** (*General Data Protection Regulation*, el Reglamento General de Protección de Datos de la Unión Europea) aplica desde mayo de 2018. Lo importante para una empresa mexicana es su **alcance**: aplica a cualquier empresa del mundo que ofrezca bienes o servicios a personas que están en la Unión Europea, o que vigile su comportamiento, aunque la empresa no tenga oficinas allá. Si Alba deja que vendan personas en España, el GDPR le aplica para esas personas.

Sus multas llegan hasta 20 millones de euros o el 4 % de la facturación mundial anual de la empresa (todo lo que vende en un año, en todos los países), lo que sea mayor.

:::profundo Otras reglas del GDPR que conviene tener a mano
- **Brechas:** aviso a la autoridad en 72 horas desde que la empresa se entera, salvo que sea improbable que cause un riesgo para las personas, y a las personas si el riesgo es alto.
- **Seudónimo y anónimo:** el dato seudónimo sigue cubierto para quien puede volver a la persona, como Alba, que tiene la tabla o la llave; el anónimo de verdad, no.
- **Decisiones automatizadas:** el derecho a no quedar sujeto a una decisión tomada solo por un sistema con efectos serios.
:::

:::profundo Lo que está cambiando en Europa
Desde 2025, el Tribunal de Justicia de la Unión Europea, el que interpreta sus leyes, acepta que, para quien recibe un dato seudónimo sin ningún medio razonable de volver a la persona, puede no ser dato personal. Para Alba, que tiene la tabla y la llave, sigue siéndolo.

En noviembre de 2026, la Unión Europea discute una reforma (el paquete llamado *Digital Omnibus*) que tocaría algunas de estas reglas, entre ellas el dato seudónimo y el aviso de brechas. Todavía no es ley: antes de diseñar con estos números, verifica con legal el texto vigente.
:::

### Quién trata los datos por ti

Casi nadie trata los datos solo. AWS guarda los buckets y corre las máquinas; un proveedor externo etiqueta las fotos. Cada uno es un **[[encargado-tratamiento|encargado]]** (*processor*): alguien que trata datos personales **por cuenta** de la empresa responsable, solo para lo que ella le pide. Alba sigue siendo la **responsable** (*controller*): la que decide para qué y cómo.

Con un encargado se firma un contrato que dice qué datos recibe, para qué, cómo los protege, cuánto los guarda y que los borra al terminar. Y se le manda lo mínimo: al proveedor de etiquetado de Alba le llegan ≈ 5,000 fotos al mes, sin EXIF, sin el nombre de la vendedora y sin su publicación.

:::profundo Responsable, encargado, remisión y transferencia
La ley mexicana y su reglamento distinguen dos formas de mandar datos a otra empresa. Si se los mandas a un **encargado**, que los trata por tu cuenta y solo para lo que le pides, el reglamento lo llama **remisión**: no necesita el consentimiento de la persona ni avisarle, aunque el encargado esté en otro país, porque el dato sigue bajo tu responsabilidad; sí necesita un contrato u otro instrumento que fije la relación. Si se los mandas a otra empresa que los va a usar **para sus propios fines**, la ley lo llama **transferencia**: esa empresa asume las mismas obligaciones que tú, el aviso de privacidad trae una cláusula para que la persona diga si la acepta y, salvo excepciones de la ley, hace falta su consentimiento. (El reglamento es de 2011; en noviembre de 2026 sigue publicado como vigente junto a la ley nueva.)

La diferencia no está en el contrato que firmes, sino en quién decide para qué se usan. Un proveedor de etiquetado que solo etiqueta es encargado. Uno que además usa tus fotos para entrenar sus propios modelos ya está decidiendo una finalidad suya: el reglamento lo trata entonces como responsable, con todas sus obligaciones, y eso tiene que estar prohibido en el contrato o cubierto en el aviso.
:::

### Mandar datos a otro país

Una **[[transferencia-internacional|transferencia internacional]]** (*cross-border transfer*) es mandar datos personales a otro país. Así se le dice en ingeniería y en el GDPR; la ley mexicana reserva la palabra «transferencia» para cuando quien recibe es otra empresa responsable, y al envío a un encargado lo llama remisión. En ML pasa sin que nadie lo note:

- **La región de la nube.** Ana vive en la Ciudad de México y su foto se procesa en `us-east-1`, en Virginia, a ≈ 3,000 km: eso ya es mandar sus datos a Estados Unidos. Como AWS los trata por cuenta de Alba, para la ley mexicana es una remisión a un encargado, no una transferencia.
- **El proveedor de etiquetado,** si sus personas trabajan desde otro país.
- **Una API gestionada o un modelo de lenguaje de un tercero,** que recibe lo que le mandes y lo procesa donde estén sus servidores.

Las leyes no prohíben mandar datos fuera, pero ponen condiciones, y cada una cuenta distinto.

:::profundo Cómo cuenta cada ley un envío a otro país
La ley mexicana no pone condiciones especiales por el país: si quien recibe es un encargado (la nube, el proveedor de etiquetado), es una remisión con su contrato; si es otra empresa para sus propios fines, es una transferencia, con su cláusula en el aviso y, salvo excepciones, el consentimiento.

El GDPR, en cambio, cuenta como transferencia cualquier envío fuera de Europa, también a un encargado. Lo permite a países que la Comisión Europea (el órgano de gobierno de la Unión) declaró con protección «adecuada», o con garantías como las cláusulas tipo: contratos modelo, aprobados por la Comisión, que obligan a quien recibe los datos a protegerlos. Fuera de eso, solo en casos puntuales que el reglamento enumera.
:::

Cuando una ley o un contrato exige que los datos se queden en un país, se habla de [[residencia-datos|residencia de datos]], y eso decide en qué [[region|región]] de la nube se despliega.

### Brechas: cuando los datos se escapan

Una **[[brecha-datos|brecha de datos]]** (*data breach*) es cualquier incidente en que datos personales se pierden, se destruyen, se cambian o los ve alguien que no debía: un bucket que quedó público, una laptop robada con un CSV, una llave filtrada en un [[repositorio]] de código.

Las leyes piden dos cosas. Primero, **avisar**: en Europa, a la autoridad en 72 horas (y a las personas si el riesgo es alto); en México, de inmediato a las personas afectadas cuando la brecha afecte de forma significativa sus derechos patrimoniales o morales (su dinero y sus bienes, o su honor y su vida privada), para que puedan protegerse. La ley mexicana no pide avisar a la autoridad. Segundo, **poder decir qué se escapó**, y aquí vuelve el mapa de datos: si sabes que el bucket público solo tenía el log seudónimo de los últimos 90 días, puedes decir qué campos, de cuántas líneas y de qué fechas. Si no lo sabes, tienes que suponer lo peor.

:::nota Minimizar también es para el día malo
Una brecha del log de Alba expone ≈ 900 millones de líneas (10 M al día × 90 días) con `request_id`, categorías y prefijos de hash: molesto, pero sin fotos, sin GPS y sin nombres. Una brecha de un log que guardara los bodies expondría las fotos y su EXIF. Lo que se decidió guardar el día del diseño decide qué tan grave es la brecha.
:::

## Errores comunes {Common mistakes}

:::ojo «Hasheamos los correos, así que están anonimizados»
Un hash sin llave se revierte probando la lista de correos o teléfonos que el atacante ya tiene, y aunque no se revirtiera, une tablas igual. **Cómo evitarlo:** llámalo seudónimo, úsalo con HMAC y una llave en KMS si necesitas un id estable, y trátalo como dato personal.
:::

:::ojo Guardar el input completo «para depurar»
Es la forma más rápida de que la foto y su EXIF terminen en un log de 90 días que leen muchas personas. **Cómo evitarlo:** una allowlist de campos, nunca los bodies; si de verdad hace falta una muestra, que sea chica, sin EXIF, con su propio plazo y acceso.
:::

:::ojo La retención que olvida las copias
La política dice 90 días, pero un respaldo en otra región, un snapshot o un CSV en una laptop duran más. La retención real es la de la copia que más dura. **Cómo evitarlo:** el mapa de datos con cada copia y una regla automática de borrado en cada almacén.
:::

:::ojo Prometer que el modelo «olvida»
Decirle a alguien que su dato «ya se borró del modelo» cuando el modelo sigue en producción es falso. **Cómo evitarlo:** promete lo que sí puedes: borrar las copias, sacarlo del siguiente snapshot y reentrenar en el siguiente ciclo, con fecha.
:::

:::ojo Cambiar de finalidad sin decir nada
Usar los logs de soporte para entrenar un asistente, o las fotos de publicaciones para un modelo de caras, puede ser una finalidad nueva. **Cómo evitarlo:** antes de armar un dataset con datos de usuarios, lee el aviso de privacidad y pregúntale a legal si la finalidad está cubierta.
:::

:::ojo Olvidar que la nube está en otro país
«Nuestros datos están en AWS» no responde dónde. **Cómo evitarlo:** anota la región de cada almacén y de cada proveedor en el mapa, y llévale esa lista a legal: decide si cada envío es una remisión o una transferencia, y qué tiene que decir el aviso de privacidad (bajo el GDPR, por ejemplo, hay que informar los envíos fuera de Europa).
:::

## En la vida real {In real life} [extra]

**En Alba**, todo lo de esta lección es un diseño concreto: el gateway no guarda la foto; el log trae `request_id` y un prefijo del hash, sin la foto ni el EXIF, durante 90 días; las ≈ 5,000 fotos al mes que van a etiquetar se copian sin EXIF y se borran a los 90 días; el golden set de 50,000 fotos está congelado y sin EXIF; un borrado se busca por `request_id` y hash, sale de los buckets y del siguiente snapshot, y el modelo cambia en el siguiente reentrenamiento mensual. Le aplican la LFPDPPP y, si atiende personas en Europa, el GDPR.

**Un sistema de [[ocr|OCR]] de documentos de identidad** (un modelo que lee el texto de una imagen). Aquí el dato personal no es un accidente: **es la etiqueta**. El modelo lee nombre, CURP y domicilio de una credencial. Las reglas cambian: los valores de los campos nunca van a los logs ni a las métricas (solo «el campo CURP salió con confianza 0.97», nunca la CURP), las copias de entrenamiento viven en una cuenta aparte con acceso mínimo, y las fotos que el sistema rechaza no se guardan.

**Un modelo de lenguaje y un asistente con [[rag|RAG]].** Las preguntas de la gente traen teléfonos, correos y direcciones sin que nadie lo pida. La práctica es detectarlos y taparlos antes de escribir el log, no guardar los [[prompt|prompts]] (lo que la persona le escribe al modelo) ni las respuestas por omisión y, si se usa un modelo de un tercero, revisar en qué país procesa y si guarda lo que recibe.

**Cámaras de video en una fábrica.** Los clips muestran a trabajadores: son dato personal aunque nadie haga reconocimiento facial. Se avisa a quienes aparecen, se guardan pocos días, se registra quién vio qué, y las imágenes que se conservan como evidencia se guardan con las caras difuminadas.

**Un agente de soporte.** Un agente (un programa con un modelo de lenguaje que da pasos por su cuenta: consulta, decide y actúa) que lee el historial de pedidos de una persona y propone un reembolso trata datos personales en cada paso: lo que la persona escribe, lo que el agente consulta y lo que propone. En Alba, los reembolsos de más de US$50 los aprueba una persona; eso, además de proteger el dinero, evita que una decisión con efecto real sobre alguien quede tomada solo por un sistema.

**Fuera de México y Europa** hay otras leyes con la misma lógica. En Estados Unidos no hay una ley federal general (en noviembre de 2026 hay proyectos en el Congreso, ninguno aprobado): HIPAA (*Health Insurance Portability and Accountability Act*, la ley de datos de salud) cubre los datos de salud que manejan hospitales y médicos, seguros médicos y quienes trabajan para ellos, y pide, entre otras cosas, acceso mínimo y registrado. La CCPA (*California Consumer Privacy Act*) de California cubre a los residentes de ese estado frente a empresas que pasan ciertos umbrales y les da derechos parecidos a los ARCO. Tiene reglas nuevas vigentes desde enero de 2026 que entran por etapas: las de decisiones automatizadas se cumplen desde enero de 2027. Cuando un sistema atiende a gente de varios países, la pregunta de diseño es la misma: dónde están las personas, qué datos se juntan y a dónde viajan.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de fuerza bruta y combinaciones se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Di si cada dato es personal, y si es sensible: (a) la foto de unos tenis sobre un fondo blanco, sin EXIF; (b) la foto de un medicamento con la receta a nombre de la vendedora; (c) el `request_id` `9f2c41d0` en el log de Alba; (d) «el 4 % de las fotos de hoy fueron de bicicletas».
- (a) Si está ligada a una publicación y a una cuenta, sí es dato personal, aunque la foto en sí no muestre a nadie: lleva a quien la subió. Sola y sin liga, no.
- (b) Personal **y sensible**: la receta trae el nombre y deja ver un dato de salud.
- (c) Personal, **seudónimo**: no trae el nombre, pero el backend une ese `request_id` con la publicación y la cuenta.
- (d) No: es un conteo de millones de fotos del que no se saca a nadie.
? [facil] El log de Alba guarda ≈ 10 millones de líneas al día durante 90 días. ¿Cuántas hay vivas? Si la retención bajara a 30 días, ¿cuántas dejarían de estar expuestas en una brecha?
- Con \(E = r × D\): \(r\) = 10 M al día, \(D\) = 90 días, \(E\) = 10 M × 90 = **900 millones** de líneas.
- A 30 días: \(E\) = 10 M × 30 = 300 millones.
- Dejarían de estar expuestas 900 M − 300 M = **600 millones** de líneas, dos tercios. El costo: los análisis que necesitan más de 30 días tendrían que usar los agregados.
? [facil] Un equipo propone guardar `sha256(correo)` en el dataset «para que esté anonimizado». Explica en dos frases por qué no lo está.
- El hash es determinista: quien tenga una lista de correos calcula sus hashes y los compara, así que el dato se puede volver a ligar a la persona.
- Además, el mismo correo da el mismo hash en todas las tablas, así que sirve para unirlas. Es un seudónimo, y por eso sigue siendo dato personal.
? [facil] La foto de Ana se procesa en `us-east-1`. ¿Qué tipo de operación es esa para la ley mexicana, y qué necesita?
- Los datos de una persona en México salen a Estados Unidos, donde está la región (en Virginia, a ≈ 3,000 km): en ingeniería se le dice transferencia internacional.
- Pero AWS trata los datos por cuenta de Alba: es un **encargado**. Para la ley mexicana y su reglamento eso es una **remisión** internacional, no una transferencia: no necesita el consentimiento de Ana ni avisarle, pero sí un contrato que diga cómo protege los datos y que solo los usa para lo que Alba le pide. Si Ana estuviera en la Unión Europea, el GDPR sí lo contaría como transferencia y Alba tendría que cumplir sus condiciones e informarlo.
? [medio] Una tabla de 1,000,000 de personas trae código postal (200 valores), año de nacimiento (80) y sexo (2). ¿Cuántas combinaciones hay, cuántas personas por combinación y qué fracción queda sola? ¿Y si se cambia el año por la fecha completa (80 × 365)?
- Con \(C = c_1 × c_2 × c_3\), \(m = P ÷ C\) y \(u ≈ e^{−(P−1)/C}\), con \(P\) = 1,000,000:
- Con el año: \(C\) = 200 × 80 × 2 = 32,000. \(m = P ÷ C\) = 1,000,000 ÷ 32,000 = **31.25**. \(u ≈ e^{−999,999/32,000} = e^{−31.25}\) ≈ 2.7 × 10⁻¹⁴: prácticamente **nadie** queda solo.
- Con la fecha: \(c_2\) = 29,200, \(C\) = 200 × 29,200 × 2 = 11,680,000. \(m\) = 1,000,000 ÷ 11,680,000 ≈ **0.086**. \(u ≈ e^{−0.0856}\) ≈ **91.8 %** solos.
- Cambiar el año por la fecha multiplica \(C\) por 365 y pasa de casi nadie a más de 9 de cada 10.
? [medio] Un atacante tiene una GPU que calcula 2 × 10¹⁰ hashes por segundo. ¿Cuánto tarda en probar (a) todos los teléfonos de 10 dígitos, (b) todas las CURP posibles si fueran 18 dígitos del 0 al 9, (c) una llave de HMAC de 128 bits?
- Con \(t = N ÷ v\) y \(v\) = 2 × 10¹⁰:
- (a) \(N\) = 10¹⁰: \(t\) = 0.5 **segundos**.
- (b) \(N\) = 10¹⁸: \(t\) = 10¹⁸ ÷ (2 × 10¹⁰) = 5 × 10⁷ s; 5 × 10⁷ ÷ 31,557,600 s por año ≈ **1.6 años**. Y una CURP de verdad tiene letras y una estructura fija (iniciales, fecha de nacimiento, sexo, estado), así que el espacio real es mucho más chico que «18 caracteres cualesquiera»: no la protejas con un hash sin llave.
- (c) \(N\) = 2¹²⁸ ≈ 3.4 × 10³⁸: \(t\) ≈ 1.7 × 10²⁸ s ≈ **5.4 × 10²⁰ años**.
? [medio] Ana pide a Alba borrar sus datos. Haz la lista de dónde hay que buscar y qué pasa en cada lugar, en el orden de los cuatro pasos.
- **Encontrar:** con sus publicaciones, el backend saca sus `request_id` y el hash de cada foto. Con eso se busca en el log de predicciones, en el bucket de fotos a etiquetar, en el golden set y en los manifests de los snapshots.
- **Borrar:** el producto borra las fotos de sus publicaciones; se borran sus copias en el bucket de etiquetado y en el golden set, si estaban; el siguiente snapshot ya no las incluye. El log: se reescriben sus días o se deja caducar a los 90 días, lo que decida legal.
- **El modelo:** no se desentrena; el siguiente reentrenamiento mensual se hace sin esas fotos, y el modelo anterior se retira.
- **Constancia:** en el registro de auditoría, qué se borró, de dónde y cuándo, con ids y sin las fotos.
? [medio] El proveedor de etiquetado de Alba recibe ≈ 5,000 fotos al mes y las guarda 90 días. ¿Cuántas fotos tiene en su poder en cualquier momento? Nombra tres cosas que debe decir su contrato.
- Con \(E = r × D\), las dos en meses: \(r\) = 5,000 al mes y \(D\) = 90 días ≈ 3 meses: \(E\) ≈ 5,000 × 3 = **≈ 15,000 fotos**. (En días da lo mismo: 5,000 ÷ 30.4 ≈ 164 al día × 90 ≈ 14,800.)
- El contrato de un **encargado** dice: qué datos recibe y para qué (solo etiquetar), cómo los protege (cifrado, acceso por persona, registro), cuánto los guarda y que los borra al terminar; también que no los usa para nada propio y desde qué país trabaja.
? [reto] Un equipo de Alba quiere publicar un dataset «abierto» para investigación con 100,000 fotos de productos, cada una con la fecha y hora de subida, la ciudad de la vendedora y la categoría. (a) ¿Es anónimo? (b) Propón tres cambios para acercarlo y di qué se pierde con cada uno.
- (a) No. La fecha y hora exacta, la ciudad y la categoría son cuasi-identificadores: cualquiera puede buscar en el marketplace una publicación de esa categoría, en esa ciudad, a esa hora, y encontrar a la vendedora. Y las fotos pueden traer caras, casas o placas.
- (b) Cambios posibles:
- Quitar la hora y dejar solo el mes: se pierde estudiar patrones por hora.
- Cambiar la ciudad por la región del país: se pierde el detalle geográfico.
- Revisar las fotos para quitar las que muestran personas, placas o documentos, y quitar todo el EXIF: se pierden ejemplos.
- Luego medir el \(k\) de la tabla con los cuasi-identificadores que queden, y quitar los grupos chicos. Aun así, con fotos públicas que se pueden buscar por imagen, la anonimización es muy difícil: lo prudente es no publicarlo, o publicar solo estadísticas.
? [reto] Alba recibe una solicitud de borrado el 20 de octubre. El modelo en producción, `resnet50-2026-10-01`, se entrenó con el snapshot de septiembre. Se reentrena una vez al mes, en ≈ 3–4 horas, y la versión anterior se queda viva 24–48 horas por si hay que regresar. (a) ¿Cuándo deja de haber en producción un modelo entrenado con la foto? (b) ¿Qué harías si legal pide que pase en menos de 7 días? (c) ¿Por qué no basta con reentrenar solo la última capa?
- (a) El snapshot de octubre ya no trae la foto, y el modelo `resnet50-2026-11-01` se entrena con él a principios de noviembre. Antes de quedarse con todo el tráfico pasa 1–2 días en *shadow* (recibe copias de las requests sin contestar) y su *canary* (atiende una parte del tráfico que va creciendo: 5 % → 25 % → 100 %), y el de octubre sigue vivo 24–48 horas más por si hay que regresar. Hacia la **primera semana de noviembre** ya no hay ninguno con la foto: ≈ 2 semanas después de la solicitud.
- (b) Adelantar un reentrenamiento: cuesta ≈ 3–4 horas de una GPU y ≈ US$3–4 por corrida, más pasar el *gate* de evaluación (el examen que el modelo nuevo debe pasar antes de salir) y el despliegue gradual. Si las solicitudes son frecuentes, se juntan por semana y se reentrena con ese ritmo.
- (c) Porque la foto movió todos los parámetros, no solo los de la última capa: las capas de antes también aprendieron de ella. Reentrenar solo la [[cabeza]] (la última capa, la que elige la categoría) deja esa huella en el resto. La garantía está solo en reentrenar todo sin el dato.
:::

## Lo que sigue {What comes next}

- La siguiente lección, «Ataques y cadena de suministro», explica la [[inferencia-pertenencia|inferencia de pertenencia]], el envenenamiento de datos y cómo se defiende el modelo; ahí vuelve la idea de que un modelo puede dejar ver algo de sus datos.
- «Cifrado, llaves y certificados» explica a fondo el [[hmac|HMAC]], KMS y el cifrado en reposo que protegen los seudónimos de esta lección, y «Autenticación y permisos» explica el registro de auditoría donde queda la constancia de cada borrado.
- «Versionado y linaje» arma los snapshots con manifest que hacen que un borrado sea una consulta y un job, y no una búsqueda a ciegas.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
dato-personal pii dato-sensible mapa-de-datos minimizacion finalidad consentimiento aviso-privacidad seudonimizacion anonimizacion reidentificacion k-anonimato derechos-arco derecho-borrado decision-automatizada machine-unlearning lfpdppp gdpr encargado-tratamiento transferencia-internacional brecha-datos
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué el `request_id` en el log de Alba es dato personal si no trae el nombre de nadie?
Porque el backend guarda ese mismo `request_id` junto a la publicación y la cuenta: con una unión se llega a Ana. Es un seudónimo, y un seudónimo sigue siendo dato personal.
? ¿Qué diferencia hay entre seudonimizar y anonimizar?
Seudonimizar cambia el identificador por otro, y quien tiene la llave o la tabla puede volver a la persona. Anonimizar hace que nadie pueda volver con medios razonables, y solo entonces el dato deja de ser personal.
? ¿Por qué se revierte en medio segundo un teléfono hasheado con SHA-256, y qué lo evita?
Porque hay solo 10¹⁰ teléfonos y una GPU calcula ≈ 2 × 10¹⁰ hashes por segundo: se prueban todos. Lo evita HMAC con una llave secreta: sin la llave, no hay qué probar.
? ¿Qué dice el \(k\) de una tabla con \(k\)-anonimato?
Que cada combinación de cuasi-identificadores aparece en al menos \(k\) filas: quien conoce esos datos de alguien encuentra \(k\) candidatos, no uno.
? ¿Por qué no se promete borrar a alguien de un modelo ya entrenado?
Porque el modelo no guarda filas, guarda parámetros que todos los datos movieron. Lo que se promete es borrar las copias, sacar el dato del siguiente snapshot y reentrenar sin él.
? ¿Por qué el GDPR le puede aplicar a una empresa mexicana?
Porque aplica a quien ofrezca bienes o servicios a personas que están en la Unión Europea, aunque la empresa no tenga oficinas allá.
:::
