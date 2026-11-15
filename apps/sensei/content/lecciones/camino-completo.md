---
titulo: El camino completo
en: The full path to production
subtitulo: Qué significa poner un modelo en producción, contado de principio a fin con un solo ejemplo: las seis etapas, los dos caminos y el reloj de cada uno.
pregunta: Cuando una app «usa IA», ¿qué tuvo que pasar para que eso funcione?
---

:::idea
Poner un modelo en producción es convertir algo que funcionó una vez en tu computadora en un servicio que le responde a millones de personas, rápido, todos los días, y que sigue acertando aunque el mundo cambie.
:::

:::nota Cómo leer esto
Las palabras subrayadas, como [[modelo]], abren su definición ahí mismo: tócalas sin miedo, no te sacan de la página. Las secciones marcadas **Extra** y los bloques «Para ir más hondo» son para una segunda pasada: puedes saltarlos y la lección se entiende igual. Esta es la lección del mapa: cada pieza que aparece aquí tiene más adelante su propia lección.
:::

## Una escena de 200 milisegundos {A 200-millisecond scene}

Ana quiere vender unos tenis que ya no usa. Abre la app de un marketplace (una tienda en línea donde cualquiera puede vender), les toma una foto, la sube y, antes de terminar de escribir el título, la app ya le sugiere la categoría: **Calzado › Tenis**.

Para Ana eso no fue nada. Para que pasara, alguien tuvo que juntar millones de fotos, enseñarle a un programa a reconocerlas, ponerlo a responder en computadoras que nunca se apagan, cuidar que conteste en más o menos lo que dura un parpadeo y revisar cada día que siga acertando.

Ese marketplace se llama **Alba**: es la empresa que vamos a seguir en todo el curso. Recibe unos 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de su foto, entre 500 posibles.

:::nota Alba en números
| Dato | Valor | En palabras |
|---|---|---|
| Publicaciones nuevas al día | ≈ 2.5 M | 2.5 millones de cosas nuevas a la venta cada día |
| Fotos por publicación | ≈ 3 | Cada publicación trae unas 3 fotos |
| Requests al día | ≈ 10 M | Fotos que el modelo responde al día, una por pregunta: 7.5 millones de las publicaciones y unos 2.5 millones que piden otros equipos de Alba |
| Pico de diseño | 500 req/s | El sistema se arma para aguantar 500 fotos por segundo en sus peores ratos |
| Categorías | 500 | Las opciones entre las que elige el modelo, como «Calzado › Tenis» |
| Modelo | ResNet-50, 24,532,532 parámetros (≈ 24.5 M) | Un modelo de fotos muy conocido. Por dentro son unos 24.5 millones de números que se ajustan al entrenar |
| Promesa de latencia | p99 ≤ 200 ms | Al menos 99 de cada 100 respuestas salen en 200 milisegundos o menos |
| Promesa de disponibilidad | 99.9 % de requests sin error del servidor y en < 300 ms | De cada 1,000 fotos, a lo más 1 se queda sin sugerencia |
| Reentrenamiento | mensual | Cada mes sale una versión nueva del modelo |

Cada lección te recuerda los números que necesita; no hace falta memorizarlos.
:::

## Un modelo y sus dos momentos {A model and its two moments}

### Qué es un modelo

A un programa normal tú le escribes las reglas: «si la compra pasa de 1,000 pesos, el envío es gratis». A un [[modelo]] no le escribes reglas. Le muestras miles de ejemplos con su respuesta correcta y él solo encuentra la manera de pasar de la entrada a la respuesta.

¿Por qué no escribir las reglas a mano? Intenta escribir la regla para reconocer unos tenis en una foto. ¿Por la forma? ¿Por las agujetas? ¿Y si es una bota? ¿Y si la foto está oscura, o de lado, o el tenis está dentro de su caja? Hay cosas que es mucho más fácil mostrar que explicar.

:::figura modelo-funcion
Un modelo funciona como una función: entra una foto y sale qué tan probable es cada categoría. Los porcentajes son de ejemplo.
:::

Por dentro, un modelo es un montón de números que se llaman [[parametro|parámetros]]. Piensa en ellos como perillas: cada combinación de perillas hace que el modelo responda distinto. El modelo de Alba tiene unos 24.5 millones.

:::analogia Cómo aprende un niño a reconocer perros
Nadie le explica a un niño «un perro tiene cuatro patas, hocico y cola». Le señalan perros: este es un perro, este también, ese de allá es un gato. Después de suficientes ejemplos reconoce un perro que nunca había visto. Un modelo aprende de una forma parecida: de ejemplos, no de reglas.

**Dónde se rompe:** en la cantidad. Al niño le bastan unos cuantos ejemplos, y el modelo necesita miles.
:::

### Entrenar y usar

Todo modelo vive dos momentos muy distintos, y casi todo lo demás en esta app depende de no confundirlos.

:::pasos
1. Entrenar
El [[entrenamiento]] es mostrarle muchos ejemplos de los que ya sabes la respuesta: fotos con su categoría correcta, que se llama su [[etiqueta]]. El modelo adivina, compara su respuesta con la correcta y mueve sus perillas un poquito para equivocarse menos. Eso se repite millones de veces. Es lento y caro, así que se hace de vez en cuando: en Alba, una vez al mes.
2. Usar
La [[inferencia]] es usar el modelo ya entrenado. Recibe una foto nueva, sin respuesta, y da su [[prediccion|predicción]]. Las perillas ya no se mueven: solo calcula. Es rápido y pasa todo el tiempo: en Alba, millones de veces al día.
:::

:::figura dos-momentos
Entrenar se hace pocas veces y tarda horas. Usar se hace millones de veces y tarda milisegundos.
:::

:::ojo
Cuando alguien dice «el modelo aprende de los usuarios», casi nunca es en tiempo real. El modelo que está respondiendo no cambia sus perillas con cada foto. Se juntan datos nuevos, se entrena una versión nueva aparte y, si sale mejor, reemplaza a la anterior.
:::

## ¿Qué significa «producción»? {What production means}

Que un modelo funcione en tu laptop no significa que esté listo. Está en [[produccion|producción]] cuando gente real lo usa todos los días y, si falla, alguien lo nota.

| | En tu laptop | En producción |
|---|---|---|
| Quién lo usa | Tú | Millones de personas que ni saben que existe |
| Cuántas veces | Unas cuantas, cuando tú quieres | Sin parar, de día y de noche, con horas pico |
| Qué tan rápido | Da igual si tarda 5 segundos | Más o menos lo que dura un parpadeo |
| Si se rompe | Lo vuelves a correr | Ana no recibe sugerencia y tiene que buscar la categoría a mano; si pasa seguido, se publica menos y el negocio pierde dinero |
| Los datos | Los que descargaste, siempre los mismos | Nuevos cada día, y van cambiando |
| Dónde corre | En un [[notebook]] (un documento donde corres el código por pedacitos), en tu máquina | En [[servidor\|servidores]] que nunca se apagan |

Por eso existe el trabajo de [[ml-engineer]]. No se trata solo de que el modelo acierte, sino de que todo lo que lo rodea funcione. Un artículo científico famoso de Google («Hidden Technical Debt in Machine Learning Systems», Sculley y otros, 2015) lo dibujó así: el código del modelo es una cajita chica en medio de todo lo demás, que son los datos, la configuración, los servidores y el monitoreo.

:::figura camino-completo-sculley
Inspirada en la figura del artículo de Sculley y otros (2015). Los tamaños no son medidas: dicen dónde está casi todo el trabajo. Las [[feature|features]] son los datos de entrada, ya preparados para el modelo.
:::

### Deploy: cambiar de versión sin que nadie lo sufra

Pasar algo de tu laptop a producción, o cambiar la versión que está respondiendo por una nueva, se llama [[deploy]] (desplegar). Suena a apretar un botón, pero en un sistema que atiende a millones casi nunca se hace de golpe: si la versión nueva trae un error, le pegaría a todos a la vez.

En Alba se hace poco a poco. El modelo nuevo primero responde 5 de cada 100 fotos. Si sigue respondiendo rápido, sin errores y con respuestas sensatas, pasa a 25 de cada 100 y después a todas. Si algo empeora, el sistema regresa solo a la versión anterior. A esa primera prueba chiquita se le llama *canary* (canario), por los canarios que los mineros bajaban a la mina: si había gas, el pájaro lo resentía antes que ellos.

## El camino completo, en seis etapas {The six stages}

Todo lo que rodea al modelo se puede ordenar en seis etapas. En TrueML (el conjunto de herramientas al que pertenece Sensei) cada etapa tiene su color, y juntas forman la T del logo: la verás arriba de cada lección, con las etapas que toca encendidas.

:::diagrama camino
Lo que sale de cada etapa es lo que entra a la siguiente, y el monitoreo cierra el ciclo.
:::

Una cadena de pasos así, donde lo que sale de uno entra al siguiente, se llama [[pipeline]]. Veamos qué pasa en cada etapa.

### 1 · Datos

Todo empieza con ejemplos. Hay que juntar fotos, ponerles su categoría correcta (muchas veces una persona lo hace a mano), revisar que estén bien y guardarlas como una versión fija que ya nadie modifica, para saber después exactamente con cuáles se entrenó. **Sale:** un [[dataset]], la colección de fotos con su categoría.

### 2 · Modelo

Con el dataset se entrena el modelo. Luego se examina con fotos que nunca vio, y solo si pasa el examen se aprueba. Al final se convierte a un formato que hace casi los mismos cálculos con mucho menos trabajo, para que responda más rápido, y se comprueba que sus respuestas no cambien. **Sale:** el modelo aprobado, guardado en un archivo.

### 3 · API

El modelo solo, en un archivo, no le sirve a nadie si nadie le puede preguntar. Se escribe un programa que lo carga y lo pone a responder: recibe una foto por la red (internet, o la red interna de la empresa) y regresa la categoría. La «ventanilla» por donde se le pregunta es su [[api|API]], y a tener el modelo respondiendo así se le llama [[serving]]. **Sale:** el programa que responde.

### 4 · Contenedor

El programa funciona en tu máquina, pero ¿funcionará igual en otra? Se empaqueta con todo lo que necesita (la versión exacta de Python, las librerías, que son código que otros ya escribieron y tu programa usa, y el modelo) en un [[contenedor]], que corre igual en cualquier máquina que sepa correr contenedores. La herramienta más usada para crearlos es Docker. **Sale:** el paquete probado, listo para copiarse a cualquier servidor.

### 5 · Orquestación

Una sola computadora tiene dos problemas: puede no aguantar todas las [[request|peticiones]] de la hora pico y, si se apaga, se apaga todo. En Alba pesa más el segundo: una sola máquina con el modelo aguantaría el tráfico, pero se usan dos para que, si una falla, la otra siga respondiendo. Así que se corren varias copias del contenedor en varias máquinas, y un sistema de [[orquestacion|orquestación]] decide cuántas hacen falta, les reparte el trabajo y reemplaza a las que fallan. También cambia a la versión nueva poco a poco, sin apagar nada. El orquestador más usado es Kubernetes. **Sale:** el servicio funcionando para todo el mundo.

### 6 · Monitoreo

Ya en producción se mide todo: cuánto tarda cada respuesta, cuántas fallan y si el modelo sigue acertando. Eso es el [[monitoreo]]. Y aquí viene lo que más sorprende al principio: aunque nadie toque el modelo, con el tiempo empieza a fallar más, porque el mundo cambia y llegan fotos distintas a las de su entrenamiento. A ese cambio en lo que llega se le llama [[drift]]. Cuando pasa, se juntan datos nuevos y se vuelve a la etapa 1: es el [[reentrenamiento]]. **Sale:** la señal de que hay que reentrenar y las fotos nuevas para etiquetar.

:::analogia Una cadena de restaurantes
- **Datos:** conseguir los ingredientes y revisar que estén buenos.
- **Modelo:** el chef desarrolla la receta en la cocina de pruebas, y un comité la prueba antes de aprobarla.
- **API:** el mostrador donde se toman los pedidos.
- **Contenedor:** una cocina estándar, con la misma estufa, los mismos utensilios y la receta pegada en la pared, que se arma igual en cualquier sucursal.
- **Orquestación:** la gerencia regional, que decide cuántas sucursales abrir según la demanda y reemplaza la que tiene que cerrar.
- **Monitoreo:** medir cuánto tardan los pedidos y leer las quejas. Si los gustos de la gente cambian, toca una receta nueva.

**Dónde se rompe la analogía:** un chef mejora la receta con su criterio, y un modelo solo mejora si le das mejores datos. Además, una receta que deja de gustar se nota en las quejas. Un modelo que empieza a fallar no se queja: si no lo mides, nadie se entera.
:::

:::profundo Las 12 estaciones del sistema de Alba dentro de las seis etapas
El sistema de Alba se divide en 12 estaciones: 12 partes del trabajo, cada una con algo concreto que entregar. Cada una vive dentro de una etapa. No te preocupes por los nombres raros: cada estación tendrá su propia lección aquí.

| Etapa | Estaciones de Alba | Qué sale, en palabras simples |
|---|---|---|
| Datos | 1 · Datos y etiquetas\n2 · Versionado y linaje | Las fotos del mes con su categoría, guardadas con un nombre que no cambia |
| Modelo | 3 · Entrenamiento\n4 · Gate de evaluación y registry\n5 · Export, engine y paridad | Un modelo que pasó su examen, convertido a un formato rápido |
| API | 6 · Código de serving | El programa que recibe la foto y responde |
| Contenedor | 7 · Empaquetado (Docker)\n8 · CI/CD y registro de imágenes | El paquete probado y guardado, listo para copiarse |
| Orquestación | 9 · Kubernetes\n10 · Rollout seguro | El servicio corriendo en muchas copias, ya con la versión nueva |
| Monitoreo | 11 · La request en vivo\n12 · Monitoreo y reentrenamiento | Las mediciones que deja cada request y la señal de reentrenar |
:::

## Lo que pasa cuando Ana sube su foto {The life of a request}

Ahora juntemos todo en la escena del principio. Cuando Ana sube la foto, pasa esto:

:::diagrama request
Todo el recorrido, de ida y vuelta, en una fracción de segundo.
:::

El mensaje que los servidores del marketplace le mandan a la API se llama [[request]], y lo que regresa se llama *response*. El tiempo que pasa entre una request y su response es la [[latencia]]. Alba se compromete a que 99 de cada 100 respuestas tarden menos de 200 [[ms|milisegundos]], más o menos lo que dura un parpadeo, sin contar el viaje por internet hasta el celular de Ana.

Fíjate en dos detalles de esa promesa. Tiene un número que se puede medir: no dice «rápido», dice «menos de 200 ms, 99 de cada 100 veces». Y dice **dónde** se mide: del lado del servidor, desde que la request completa llega al balanceador hasta que sale la respuesta. Lo que tarda la foto en subir depende de la señal del celular de Ana, y eso nadie en el marketplace lo controla. A una promesa así, con número y con lugar donde se mide, se le llama [[slo|SLO]].

¿Y por qué «99 de cada 100» y no el promedio? Porque el promedio esconde a quienes esperan mucho. Lo ves con números en la sección extra «El presupuesto de 200 milisegundos».

### Cuando la respuesta no llega a tiempo

¿Y si un día el modelo tarda 2 segundos, o no contesta? Ana no debería quedarse viendo una pantalla trabada. Por eso los servidores del marketplace esperan la respuesta un tiempo máximo: 300 ms. A ese tiempo máximo de espera se le llama *timeout*. Si se cumple y no llegó nada, dejan de esperar y le muestran a Ana el selector de categorías de siempre, para que la elija a mano.

Ese plan B es el [[fallback]]. Es peor que la sugerencia, pero Ana puede publicar igual: el sistema se degrada, no se cae. Y no es un detalle para casos rarísimos. Además de la de velocidad, Alba tiene una segunda promesa: que el 99.9 % de las requests respondan sin error y antes de los 300 ms. Suena a casi siempre, pero Alba responde unos 10 millones de fotos al día (cada publicación trae varias fotos, y otros equipos también le preguntan), unos 300 millones en un mes de 30 días: \( 10,000,000 × 30 = 300,000,000 \). El 0.1 % que queda (0.001 como fracción) son hasta 300 mil fotos al mes sin sugerencia: \( 300,000,000 × 0.001 = 300,000 \). Todo lo que está en el camino de una persona que espera necesita su fallback.

¿Por qué 300 ms y no 5 segundos? Porque la sugerencia solo sirve mientras Ana todavía no elige la categoría. Si llega tarde, ya no le ayuda a nadie.

## El presupuesto de 200 milisegundos {The 200 ms latency budget} [extra]

200 ms parecen poquísimo, pero para una computadora es bastante tiempo, si se reparte bien. Repartirlo es de lo primero que hace un ML engineer, antes de elegir herramientas: decidir cuánto le toca a cada paso del viaje de la foto. A eso se le llama **presupuesto de latencia** (*latency budget*).

Dentro del servidor, la foto de Ana pasa por cinco pasos:

- **Red y entrada.** La request entra por el balanceador de carga (*load balancer*), la puerta que reparte las requests entre las copias del servicio, y la API lee la foto que llegó.
- **Preprocesamiento.** La API [[decodificar|decodifica]] la foto (convierte el archivo JPEG, el formato de foto más común, en píxeles), la achica, recorta el centro y la normaliza: la convierte en los números que el modelo espera.
- **Modelo.** La foto ya preparada viaja al servidor que tiene el modelo cargado en una [[gpu|GPU]], la tarjeta que hace miles de cuentas a la vez. Ahí espera su turno como máximo 2 ms, porque el servidor junta varias fotos para calcularlas de un jalón, y el modelo calcula.
- **Respuesta.** De las 500 probabilidades se toman las 5 más altas, se arma el mensaje de respuesta y se deja lista la línea del registro, que se escribe aparte.
- **El propio programa.** El programa de la API también gasta tiempo en organizarse: atiende muchas requests a la vez, espera su turno en el procesador y limpia memoria de vez en cuando. En los casos lentos se nota.

El equipo de Alba estima cuánto tarda cada paso. Son estimaciones para medir después, no mediciones. Estos son sus valores para un caso lento: lo que tarda cada paso en sus peores momentos, cuando solo 1 de cada 100 requests tarda más en ese paso.

La cuenta es una suma y una resta:

:::formula Presupuesto de latencia
T = t_{red} + t_{pre} + t_{mod}
+ t_{resp} + t_{prog}
M = S − T
- t_{red}: lo que tardan la red y la entrada en el caso lento, en ms
- t_{pre}: lo mismo para el preprocesamiento
- t_{mod}: lo mismo para el modelo
- t_{resp}: lo mismo para la respuesta
- t_{prog}: lo mismo para el propio programa
- T: el total del lado del servidor, en ms
- S: el límite contra el que comparas, en ms: 200 para la promesa, 300 para lo que espera el marketplace
- M: el margen, en ms: lo que sobra. Si sale negativo, no cabe
:::

:::cuenta El presupuesto de Alba, en el caso lento
Red y entrada, \(t_{red}\) // 10 del balanceador + 30 de leer la foto | 10 + 30 ms | 40 ms
Preprocesamiento, \(t_{pre}\) // 50 de decodificar, achicar y recortar + 2 de normalizar | 50 + 2 ms | 52 ms
Modelo, \(t_{mod}\) // 10 de viaje + 2 de turno en la cola + 15 de cálculo en la GPU | 10 + 2 + 15 ms | 27 ms
Respuesta, \(t_{resp}\) // top-5, mensaje y registro | 3 ms | 3 ms
El propio programa, \(t_{prog}\) // organizarse y esperar turno | 30 ms | 30 ms
Total, \(T\) | 40 + 52 + 27 + 3 + 30 | 152 ms
Margen, \(M = S − T\) // con \(S\) = 200 ms, la promesa | 200 − 152 | 48 ms
= Aun sumando el caso lento de cada paso, quedan ≈ 50 ms de margen.
:::

De esta cuenta salen dos cosas. La primera: quedan ≈ 50 ms para lo que no se planeó, como fotos web gigantes, pausas raras o una máquina más lenta. La segunda sorprende: **el modelo no es el paso más caro**. Preparar una foto grande en el procesador cuesta más que el cálculo en la GPU. Por eso se mide cada paso antes de optimizar: si solo aceleraras el modelo, ganarías poco.

:::analogia Llegar a tiempo a clase
Si tu clase empieza en 30 minutos, repartes: 5 para salir de tu casa, 20 de camino y 5 de margen por si el camión tarda. Un presupuesto de latencia es lo mismo con 200 ms: cada paso tiene su parte y se deja margen.

**Dónde se rompe:** tu trayecto es uno y lo ves completo. Un servidor atiende cientos de fotos por segundo, y en cada una los pasos tardan distinto. Casi nunca todos tienen su peor momento en la misma foto, así que sumar el caso lento de cada paso suele dar de más. Suele, no siempre: si los pasos se ponen lentos en fotos distintas, la suma también puede quedarse corta (lo ves con números en la lección de percentiles). Sirve para repartir; el número de verdad se mide de punta a punta.
:::

:::calculadora camino-completo-presupuesto
Empieza en los valores de la cuenta. Sube el preprocesamiento a 120 ms, como con una foto web gigante, y mira qué pasa con los dos márgenes.
:::

### ¿Por qué «99 de cada 100» y no el promedio?

Imagina que 98 respuestas tardan 30 ms y 2 tardan 3 segundos:

:::cuenta El promedio que engaña
98 respuestas rápidas | 98 × 30 ms | 2,940 ms
2 respuestas lentas | 2 × 3,000 ms | 6,000 ms
Promedio // suma de los tiempos ÷ cuántas son | (2,940 + 6,000) ÷ 100 | ≈ 89 ms
La número 99, ordenadas // \(0.99 × 100 = 99\); las 2 lentas son la 99 y la 100 | 98 rápidas y luego 2 lentas | 3,000 ms
= El promedio dice 89 ms y se ve muy bien; «99 de cada 100» dice 3 segundos.
:::

El promedio se ve muy bien, pero 2 de cada 100 personas sienten la app trabada, y con millones de fotos al día eso es muchísima gente. Ordenadas de la más rápida a la más lenta, la número 99 tarda 3 segundos: eso es lo que mide «99 de cada 100», y ahí no se cumplen los 200 ms. Por eso se mide qué tan lentas son las respuestas más lentas, y no solo el promedio. Esa promesa se escribe «p99 ≤ 200 ms»: el [[p99]], el percentil 99. Lo vemos a fondo en la lección «Promedios, medianas y percentiles».

### Haz la prueba: el promedio contra «99 de cada 100»

Este programa inventa 10,000 tiempos de respuesta de juguete: casi todos rápidos, entre 20 y 60 ms, y 150 muy lentos, entre 250 ms y 3 segundos. Luego compara el promedio con lo que mide la promesa de Alba (99 de cada 100 en menos de 200 ms) y cuenta cuántas fotos se quedarían sin sugerencia. Solo usa la biblioteca estándar de Python: cópialo y córrelo tal cual.

```python
import random

random.seed(1)

# 10,000 requests de juguete: casi todas rápidas y unas pocas muy lentas
rapidas = [random.uniform(20, 60) for _ in range(9_850)]
lentas = [random.uniform(250, 3_000) for _ in range(150)]
tiempos = sorted(rapidas + lentas)          # de la más rápida a la más lenta

promedio = sum(tiempos) / len(tiempos)
p99 = tiempos[9_899]                        # la número 9,900 de 10,000: «99 de cada 100»
selector = sum(1 for t in tiempos if t > 300)

print(f"promedio:          {promedio:.0f} ms")
print(f"99 de cada 100:    {p99:.0f} ms o menos")
print(f"pasan de 300 ms:   {selector} (ven el selector manual)")
```

```salida
promedio:          61 ms
99 de cada 100:    918 ms o menos
pasan de 300 ms:   145 (ven el selector manual)
```

El promedio, 61 ms, haría pensar que todo va de maravilla. Pero la request número 9,900 tarda 918 ms: la promesa de 200 ms no se cumple y 145 personas vieron el selector manual. Si cambias la semilla (`random.seed`), los números cambian: el promedio apenas se mueve, y el de «99 de cada 100» puede moverse varios cientos de milisegundos, porque depende de unas pocas requests lentas. La conclusión no cambia: siempre pasa de 200 ms.

:::nota Lo que no entra en la cuenta: la subida de la foto
El presupuesto empieza cuando la request completa llega al balanceador; la subida desde el celular de Ana queda fuera. Lo que sí se controla es cuánto pesa lo que sube: la app de Alba reduce la foto a 1024 píxeles de lado largo antes de mandarla, unos 150 a 250 KB.
:::

## Dos caminos: online y offline {Online and offline paths}

Hasta aquí seguiste a una sola foto. Pero un sistema de ML hace dos trabajos muy distintos a la vez, cada uno con su propio reloj.

El [[camino-online|camino online]] es todo lo que pasa **mientras alguien espera** la respuesta: llega la request, se prepara la foto, el modelo calcula y sale la respuesta. Su reloj son los milisegundos.

El [[camino-offline|camino offline]] es todo lo que prepara **la siguiente versión** del modelo sin que nadie esté esperando: juntar fotos nuevas, ponerles su etiqueta, entrenar, examinar y aprobar. Su reloj son las horas, los días y las semanas.

:::diagrama camino-completo-dos-caminos
Arriba, lo que pasa con cada foto; abajo, lo que prepara la versión que viene. Las dos flechas que cruzan de un carril al otro son los puentes. Usa «Recorrer» para seguir una foto, un mes o una falla.
:::

Sus reglas son distintas, y casi todas salen de esa diferencia de relojes:

| | Camino online | Camino offline |
|---|---|---|
| Qué lo pone a correr | Una request: alguien subió una foto | Un calendario (cada mes, en Alba) o una alarma: drift, una categoría nueva |
| Cuánto puede tardar | Milisegundos: 99 de cada 100 fotos en menos de 200 ms | Horas o días: importa terminar bien y a tiempo, no la velocidad de cada paso |
| Si falla | Se nota al instante: hacen falta un timeout y un fallback | Nadie lo nota ese día: el modelo actual sigue respondiendo, solo que envejece |
| Cómo crece | Más requests por segundo → más copias encendidas | Más datos → más máquinas un rato, que luego se apagan |
| Qué se vigila | Latencia, errores y requests por segundo | Que cada paso termine bien, la calidad de los datos y el examen del modelo nuevo |
| En Alba | Foto → API → modelo → 5 sugerencias → Ana | Registro → datos y etiquetas → entrenamiento → examen → deploy |

La pregunta que decide en qué camino vive algo es una sola: **¿alguien está esperando la respuesta?** Sugerir la categoría mientras Ana escribe: sí, así que va online, con su presupuesto de tiempo y su fallback. Clasificar de una vez las ≈ 200 millones de fotos viejas del catálogo, publicadas antes de que existiera el modelo: nadie espera cada respuesta, así que va offline, en tandas y sin tocar el camino de Ana. A ese trabajo se le llama *backfill*.

:::ojo
Inferencia no es lo mismo que online. Usar el modelo puede pasar en los dos caminos. Cuando Ana espera, es inferencia online. Cuando el examen del mes hace que el modelo nuevo responda las ≈ 50 mil fotos del [[golden-set|golden set]] (fotos revisadas por personas, siempre las mismas, que solo se usan para examinar), o cuando se clasifican las fotos viejas del catálogo, también es inferencia, pero offline: nadie espera cada respuesta. Son dos preguntas distintas: «¿se mueven las perillas?» separa entrenar de usar, y «¿alguien está esperando?» separa online de offline.
:::

### Las seis etapas, en los dos caminos

Las seis etapas y los dos caminos son dos formas de cortar el mismo sistema. Las etapas responden «¿qué hay que construir, y en qué orden?». Los caminos responden «¿cuándo corre cada pieza, y con qué reloj?».

- **Datos** y **Modelo** viven en el camino offline: juntar, etiquetar, entrenar y examinar.
- **API**, **Contenedor** y **Orquestación** se construyen una vez por versión, pero lo que construyen trabaja en el camino online, en cada request.
- **Monitoreo** mira a los dos: mide cada request y avisa cuando toca darle otra vuelta al camino offline.

:::nota No los confundas con los carriles del diagrama de las seis etapas
Ese diagrama tiene un carril «Construir» y otro «Publicar y operar»: cuentan el orden en que se arma todo, y por eso la API aparece arriba. Los dos caminos cortan por otra cosa: por si alguien está esperando.
:::

### Los dos puentes

Los dos caminos no viven aislados: se tocan en dos puntos.

:::pasos
1. Del online al offline: el registro
Cada request deja una línea: cuándo llegó, qué respondió el modelo, con qué versión y cuánto tardó. Se escribe aparte, sin hacer esperar a Ana. De esas líneas salen las fotos nuevas, las pistas para etiquetarlas y las alarmas de drift: lo que el camino offline sabe de lo que está pasando en producción, lo sabe por aquí.
2. Del offline al online: el deploy
La versión que pasó el examen se pone a responder poco a poco, como viste en «¿Qué significa producción?». Es la única puerta por la que algo del camino offline le llega a Ana.
:::

Sin el primer puente, el modelo nunca aprende nada nuevo. Sin el segundo, lo que aprende nunca le llega a nadie. En una entrevista de diseño de sistemas de ML, dibujar solo el camino online es uno de los errores más comunes de quien viene de entrenar modelos, y el entrevistador anota «no closed loop»: el ciclo no se cierra.

:::figura camino-completo-relojes
Los dos relojes en una sola regla. Es una regla logarítmica: de 1 ms a 10 ms hay la misma distancia que de 100 ms a 1 s, porque en los dos casos el tiempo se multiplica por 10. Así caben en una figura los milisegundos de una foto y el mes de una versión.
:::

:::analogia Los dos relojes de un restaurante
En la cadena de restaurantes, el camino online es el mostrador: un cliente pidió y espera, y cada minuto cuenta. Si se acabó un platillo, el mesero ofrece otro: ese es el fallback. El camino offline es la cocina de pruebas: una receta nueva tarda semanas y nadie la espera parado en el mostrador. Los puentes también existen: las quejas llegan a la cocina de pruebas, y la receta aprobada llega a todas las sucursales.

**Dónde se rompe:** en un restaurante, quien cocina corrige sobre la marcha si un platillo sale mal. Un modelo en producción no se corrige solo entre versiones: cualquier ajuste espera la siguiente vuelta del camino offline.
:::

### Por qué nunca se termina

De los dos caminos sale una idea que conviene llevarse: un modelo en producción no es un proyecto que se termina, es algo que se cuida.

Aunque nadie toque el modelo, el mundo sí cambia: salen modelos nuevos de tenis, cambian las modas, los celulares toman fotos con otra luz. Las fotos que llegan se van pareciendo menos a las del entrenamiento y el modelo acierta un poco menos cada mes. Nadie rompió nada. El monitoreo lo detecta, se etiquetan fotos nuevas, se reentrena y la versión nueva reemplaza a la anterior. Y el ciclo vuelve a empezar.

En Alba pasa además otra cosa: el 1 de octubre el negocio agrega la categoría «bolsas». El modelo no puede sugerir «bolsas» porque esa opción ni siquiera existe entre sus respuestas, así que elige la más parecida que conoce. Eso no es drift: es un cambio en las categorías, y obliga a reentrenar antes de lo planeado.

## Los dos caminos en números {Both paths in numbers} [extra]

### El camino online: cuántas fotos por segundo

Las máquinas no se planean por día, sino por segundo: lo que importa es cuántas fotos llegan al mismo tiempo. Esta es la cuenta que hace el equipo de Alba:

:::formula De publicaciones al día a requests por segundo
R = P × F + O
λ = frac{R}{86,400}
λ_{pico} = k × λ
λ_{diseño} = c × λ_{pico}
- P: publicaciones nuevas al día (en Alba, ≈ 2.5 millones)
- F: fotos por publicación (≈ 3)
- O: fotos al día que piden otros equipos, como moderación y búsqueda (≈ 2.5 millones)
- R: requests al día, una por foto
- 86,400: los segundos que tiene un día
- λ: (lambda, una letra griega) requests por segundo, en promedio
- k: el factor de pico: cuántas veces más que el promedio llega en la hora más cargada del día
- λ_{pico}: requests por segundo en esa hora más cargada
- c: el margen para picos raros y para crecer: un multiplicador, como 1.4
- λ_{diseño}: requests por segundo para las que se arma el sistema
:::

:::cuenta De publicaciones al día a requests por segundo
Un día, en segundos | 24 × 60 × 60 | 86,400 s
Publicaciones por segundo // \(P\) ÷ 86,400 | 2,500,000 ÷ 86,400 s | ≈ 29
Fotos de publicaciones al día, \(P × F\) // \(F\) ≈ 3 fotos por publicación | 2.5 M × 3 | ≈ 7.5 M
Requests al día, \(R = P × F + O\) // \(O\) ≈ 2.5 M de otros equipos | 7.5 M + 2.5 M | ≈ 10 M
Promedio, \(λ = R ÷ 86,400\) | 10,000,000 ÷ 86,400 s | ≈ 116 por segundo
Pico del día, \(λ_{pico} = k × λ\) // supuesto: \(k\) = 3, porque en la hora pico llega 1/8 de las requests del día, y no 1/24: \(24 ÷ 8 = 3\) | 116 × 3 | ≈ 350 por segundo
Pico de diseño, \(λ_{diseño} = c × λ_{pico}\) // \(c\) ≈ 1.4; 490 se redondea a 500 | 350 × 1.4 ≈ 490 | 500 por segundo
= Alba diseña su sistema para **500 requests por segundo**, aunque el promedio sea 116.
:::

Diseñar para el promedio es un error caro: en la hora pico llegarían 3 veces más fotos de las que el sistema aguanta. Pero el promedio también importa, porque es el que paga la factura: la mayor parte del día las máquinas trabajan muy por debajo de lo que pueden.

### El camino offline: un mes en números

:::cuenta Un mes de Alba, de un camino al otro
Fotos que responde una versión del modelo // 10 M requests al día × un mes de 30 días | 10 M × 30 | 300 M
Fotos que se guardan de muestra // ≈ 1 de cada 100, o sea × 0.01 | 10 M × 0.01 | ≈ 100 mil al día
Fotos que revisan personas a mano | dato de Alba | ≈ 5 mil al mes
Respuestas por cada foto revisada // las 300 M de la primera fila ÷ las 5 mil revisadas | 300 M ÷ 5 mil | 60 mil
= Por cada foto que revisa una persona, el modelo respondió unas **60 mil**.
:::

Las etiquetas buenas son lo escaso del camino offline, y lo escaso cuesta. Según el equipo de Alba, el reentrenamiento mensual son unas horas de una GPU (≈ 3 a 4 horas en una A10G, ≈ US$3 a 4 por corrida): unas decenas de dólares al mes si se cuentan las corridas de prueba (≈ US$10 a 50). Es caro al lado de responder una foto, pero barato al lado de etiquetar con cuidado esas ≈ 5 mil fotos, que cuesta cientos de dólares: a unos 5 o 10 centavos de dólar por foto, \( 5,000 × 0.05 = 250 \) y \( 5,000 × 0.10 = 500 \), así que US$250 a 500 al mes. En el camino offline, el dinero y la calidad están en qué fotos se etiquetan, no en la máquina que entrena.

Compara los relojes: un mes son 30 × 86,400 = 2,592,000 segundos, y una request de 200 ms cabe 2,592,000 ÷ 0.2 ≈ 13 millones de veces. Por eso los dos caminos no pueden tener las mismas reglas: en uno, 50 ms de más rompen la promesa; en el otro, una hora de más ni se nota.

## Errores comunes {Common mistakes}

Las confusiones que más se repiten al empezar, y cómo evitarlas.

1. **Confundir entrenar con usar.** «El modelo aprende de cada foto que le subes», o «responder tarda horas». Entrenar mueve las perillas y se hace de vez en cuando; usar solo calcula y pasa millones de veces al día. **Cómo evitarlo:** pregúntate «¿se mueven las perillas?». Si sí, es entrenamiento; si no, es inferencia.
2. **Creer que 95 % en tu laptop significa «listo».** Ese número dice que el modelo acierta en tus fotos de prueba. No dice si responde en 200 ms, si aguanta cientos de fotos por segundo en la hora pico, si sigue acertando con las fotos borrosas de celulares reales ni qué pasa cuando falla. **Cómo evitarlo:** recorre las seis etapas y pregunta en cada una «¿esto ya existe?».
3. **Creer que el modelo aprende en vivo.** El modelo que responde tiene sus perillas fijas. Lo que aprende del mundo entra por el camino offline, con datos revisados y un examen, y llega como versión nueva. Aprender en vivo existe, pero es raro y arriesgado: sin examen, un error o un ataque se vuelve parte del modelo al instante. **Cómo evitarlo:** cuando oigas «aprende de los usuarios», pregunta cada cuánto se reentrena y quién aprueba la versión nueva.
4. **Ignorar el drift.** «Nadie lo ha tocado, así que sigue igual de bien». El mundo cambia aunque el modelo no, y el modelo puede equivocarse más sin lanzar ningún error. **Cómo evitarlo:** vigila al modelo y no solo al servidor: mide con etiquetas nuevas y compara las fotos de hoy con las del entrenamiento.
5. **Olvidar el fallback.** Sin plan B, el día que el modelo tarda o se cae, la persona se queda viendo una pantalla trabada. **Cómo evitarlo:** para cada pieza que está en el camino de alguien que espera, decide cuánto se espera como máximo y qué se hace si la respuesta no llega.
6. **Dibujar solo el camino online.** Foto → API → modelo → respuesta, y listo. Falta de dónde salen las etiquetas, cómo se entrena la próxima versión, cómo sabes que es mejor y cómo te enteras de que la actual empeoró. **Cómo evitarlo:** dibuja siempre los dos caminos con sus dos puentes: el registro (de online a offline) y el deploy (de offline a online).

## En la vida real {In real life} [extra]

El camino de Alba no es especial. Toma tres casos que no se parecen en nada: video, pagos y un asistente que contesta preguntas. Las seis etapas y los dos caminos son los mismos; cambian las piezas y, sobre todo, los relojes.

### Video en tiempo real en 25 centros de distribución

Una empresa de logística tiene 25 centros con 40 cámaras cada uno: 1,000 cámaras. Quiere una alerta cuando una persona o un vehículo entra a una zona prohibida.

- **Online:** cada centro tiene su propia caja con GPU, que mira 5 cuadros por segundo de cada cámara y detecta personas y vehículos. Si alguien sigue en la zona ≈ 1.5 segundos, la caja sube el evento a la nube, otro modelo lo confirma y la alerta llega a la pantalla de un operador. Reloj: 5 segundos o menos desde que la persona entra, contando ese segundo y medio, 95 de cada 100 veces.
- **Offline:** cada operador marca la alerta como confirmada o descartada, y esas marcas son las etiquetas. Con ellas se reentrena, y el modelo nuevo se instala por olas: primero en 2 centros durante una semana y luego en 5, en 10 y en los últimos 8.
- **Fallback:** si se cae el internet de un centro, la caja sigue detectando y guarda los eventos en su disco (le caben al menos 72 horas) hasta que vuelve la red.
- **Lo distinto:** la API, el contenedor y la orquestación no viven en un solo lugar, sino repartidos en 25 cajas. Al cómputo que se pone junto a donde nacen los datos se le llama *edge* («la orilla»). Aquí hace falta porque el video de 40 cámaras no cabe en el internet de un centro.

### Fraude en pagos con tarjeta

Una empresa latinoamericana que procesa pagos en línea recibe ≈ 10 millones de pagos al día y quiere frenar los fraudes en el momento en que ocurren.

- **Online:** el chequeo corre dentro del cobro, antes de pedirle la autorización al banco de la tarjeta. Reloj: 100 ms o menos, 99 de cada 100 veces. Una de las pistas más fuertes de un fraude es lo que pasó en los últimos minutos con esa tarjeta (por ejemplo, 30 intentos de pago en un minuto), así que esos conteos se calculan con un flujo continuo de eventos (*streaming*) que se pone al día en segundos: un tercer reloj, entre los otros dos.
- **Offline:** la etiqueta es el contracargo, el reclamo del dueño de la tarjeta que dice «yo no hice esa compra», y tarda semanas o meses en llegar. Con los supuestos del ejemplo, ≈ 60 % llega en 30 días y ≈ 90 % en 60, así que se entrena solo con meses que ya «maduraron».
- **Fallback:** si el modelo no responde a tiempo, deciden reglas fijas y límites. Nunca se bloquean todos los pagos.
- **Lo distinto:** el modelo no es una red neuronal sino uno mucho más ligero, que corre en el procesador, sin GPU. Lo difícil no es el modelo: son los datos frescos y las etiquetas lentas.

### Un asistente que contesta con los documentos de la empresa

Los ≈ 8,000 empleados de Alba hacen ≈ 25 mil preguntas al día a un asistente que responde con los documentos internos y cita de dónde sacó cada cosa. Usa un [[llm|LLM]] (un modelo grande de lenguaje: escribe texto, como el de un chat) con [[rag|RAG]]: antes de contestar, busca los pedazos de documento que vienen al caso y se los da al LLM.

- **Online:** llega la pregunta, se buscan los pedazos que esa persona tiene permiso de ver, se arma la instrucción para el LLM y la respuesta aparece palabra por palabra. Reloj: empieza a aparecer en 2.5 segundos o menos, 95 de cada 100 veces.
- **Offline:** el LLM no se reentrena. El camino offline es tener los documentos al día: ≈ 1.5 millones de documentos partidos en ≈ 12 millones de pedazos, y cada cambio tiene que poder encontrarse en 15 minutos o menos (95 de cada 100 veces).
- **Fallback:** si el LLM no está disponible, el asistente muestra los documentos más relevantes, sin respuesta redactada. Lo que nunca hace: si falla el filtro de permisos, no busca sin filtro.
- **Lo distinto:** aquí «entrenar» casi desaparece, y su lugar lo ocupa mantener al día lo que se busca. El camino offline existe igual: solo cambia lo que prepara.

### Los relojes, lado a lado

| Caso | Reloj online | Reloj offline | Si falla lo online |
|---|---|---|---|
| Alba · Categoría de una foto | 200 ms (99 de 100) | Una versión nueva al mes | Selector manual |
| Video | 5 s hasta el operador (95 de 100) | Semanas: olas de centros | La caja guarda los eventos |
| Fraude | 100 ms dentro del cobro (99 de 100) | Meses: las etiquetas tardan | Reglas fijas y límites |
| Asistente con RAG | 2.5 s hasta que empieza la respuesta (95 de 100) | 15 min para un documento nuevo o editado | Solo resultados de búsqueda |

Fuera de ML pasa lo mismo. Un buscador de internet recorre y ordena páginas web todo el tiempo, sin que nadie espere (offline), y contesta tu búsqueda en una fracción de segundo (online). Tu banco autoriza tu tarjeta en el momento y arma tu estado de cuenta una vez al mes. La pregunta que separa los dos caminos es la misma en todos lados: ¿alguien está esperando?

## Ejercicios {Exercises}

Resuelve cada uno en papel antes de abrir la solución. Los medios te piden razonar con dos ideas a la vez, y los retos, usar todo el camino en un caso nuevo.

:::ejercicios
? [facil] Para cada frase, di si es entrenamiento o inferencia. (a) El modelo de Alba recibe la foto de Ana y responde «Calzado › Tenis, 94 %». (b) Se le muestran 1.8 millones de fotos con su categoría y sus perillas cambian un poquito con cada grupo. (c) Una app de galería ordena tus fotos por tema mientras el celular se carga de noche, con un modelo que ya trae instalado. (d) Un equipo ajusta un modelo de lenguaje con 10 mil conversaciones de su área de soporte.
La pregunta que decide es una: **¿se mueven las perillas?**

- (a) **Inferencia.** El modelo ya entrenado solo calcula.
- (b) **Entrenamiento.** Ver ejemplos con su respuesta y ajustar las perillas es justo eso.
- (c) **Inferencia.** El modelo ya viene entrenado y solo calcula, aunque nadie mire la pantalla.
- (d) **Entrenamiento.** Ajustar con datos propios un modelo que ya existía también mueve perillas: es un *fine-tuning*.
? [facil] ¿En qué etapa del camino vive cada cosa? (a) Docker. (b) Kubernetes. (c) Personas que revisan si una foto es «Tenis» o «Botas». (d) El examen del modelo nuevo con fotos que nunca vio. (e) Medir cuánto tarda cada respuesta. (f) El programa que recibe la foto y regresa la categoría.
- (a) **Contenedor.** Docker es la herramienta más usada para crear contenedores.
- (b) **Orquestación.** Kubernetes decide cuántas copias correr, en qué máquinas y cuáles reemplazar.
- (c) **Datos.** Están poniendo etiquetas.
- (d) **Modelo.** El modelo nuevo se aprueba solo si pasa el examen.
- (e) **Monitoreo.**
- (f) **API.** Es la ventanilla por donde se le pregunta al modelo.
? [facil] Otro marketplace, más chico, recibe 400 mil publicaciones al día, con 5 fotos cada una, y su modelo responde cada foto por separado. (a) ¿Cuántas fotos por segundo le llegan en promedio? (b) Si en la hora pico llega el triple del promedio, ¿para cuántas por segundo tiene que estar listo?
Usa las mismas letras de la cuenta de Alba: \( R = P × F + O \), \( λ = R ÷ 86,400 \) y \( λ_{pico} = k × λ \), con \(P\) = 400,000 y \(F\) = 5.
:::cuenta Fotos por segundo
Fotos al día, \(R = P × F\) // aquí no hay otros equipos: \(O\) = 0 | 400,000 × 5 | 2,000,000
Un día, en segundos | 24 × 60 × 60 | 86,400 s
Promedio, \(λ = R ÷ 86,400\) | 2,000,000 ÷ 86,400 s | ≈ 23 por segundo
Hora pico, \(λ_{pico} = k × λ\) // \(k\) = 3: el triple del promedio | 23 × 3 | ≈ 69 por segundo
= Tiene que aguantar **≈ 70 fotos por segundo**, aunque el promedio sea 23.
:::
? [facil] En un rato llegan 100 fotos: 95 tardan 40 ms y 5 tardan 1 segundo. (a) ¿Cuánto tardan en promedio? (b) Ordenadas de la más rápida a la más lenta, ¿cuánto tarda la número 99? (c) ¿Se cumple la promesa de Alba, que 99 de cada 100 tarden menos de 200 ms?
- (a) Promedio = suma de todos los tiempos ÷ cuántas fotos son: (95 × 40 + 5 × 1,000) ÷ 100 = (3,800 + 5,000) ÷ 100 = **88 ms**. Se ve muy bien.
- (b) «99 de cada 100» de 100 fotos es la número \( 0.99 × 100 = 99 \). Las 95 rápidas ocupan los lugares 1 a 95 y las 5 lentas, del 96 al 100. La número 99 es lenta: **1,000 ms**.
- (c) **No.** La número 99 tarda 1,000 ms, no menos de 200. Además, las 5 lentas pasan de 300 ms: a esas 5 personas el marketplace les mostró el selector manual. El promedio escondía todo eso.
? [medio] Los dos ejes. Para cada caso di dos cosas: si es entrenar o usar, y si es online u offline. (a) Ana sube su foto y recibe la sugerencia. (b) El reentrenamiento del mes. (c) El examen del mes: el modelo nuevo responde las 50 mil fotos del golden set. (d) Clasificar de una vez las ≈ 200 millones de fotos viejas del catálogo. (e) Un modelo que ajusta sus perillas con cada clic de los usuarios, al instante.
Hay que hacer dos preguntas por separado: «¿se mueven las perillas?» y «¿alguien está esperando?».

| Caso | ¿Entrenar o usar? | ¿Online u offline? |
|---|---|---|
| (a) La foto de Ana | Usar | Online: Ana espera |
| (b) El reentrenamiento | Entrenar | Offline |
| (c) El examen del mes | Usar: las perillas no se mueven | Offline: nadie espera cada respuesta |
| (d) Las fotos viejas | Usar | Offline: va en tandas, sin tocar el camino de Ana |
| (e) Ajustar con cada clic | Entrenar | Online: en vivo, dentro del sistema que responde |

El (e) existe y se llama aprendizaje en línea (*online learning*). Ahí «en línea» quiere decir que se ajusta en vivo, en el mismo sistema que responde: nadie espera el ajuste, pero le pega al instante a la siguiente respuesta. Es raro: necesita la respuesta correcta en segundos o minutos (en fraude tarda meses) y, sin examen de por medio, un error o un ataque se vuelve parte del modelo al instante. Alba no lo hace.
? [medio] Esta vez Ana publica desde la web, no desde la app, y sube la foto original de su cámara, de muchos megapíxeles. En el caso lento, el preprocesamiento tarda 120 ms en lugar de 52. Los demás pasos quedan como en el presupuesto de Alba: red y entrada 40 ms, modelo 27 ms, respuesta 3 ms y el propio programa 30 ms. (a) ¿Cuánto suma? (b) ¿Se cumple la promesa? (c) ¿Ana recibe sugerencia? (d) ¿Qué cambiarías?
Es el presupuesto de latencia: \( T = t_{red} + t_{pre} + t_{mod} + t_{resp} + t_{prog} \) y \( M = S − T \), ahora con \( t_{pre} \) = 120 ms.
:::cuenta Con una foto gigante
Los otros pasos // \(t_{red} + t_{mod} + t_{resp} + t_{prog}\) | 40 + 27 + 3 + 30 | 100 ms
Total, \(T\) // los otros pasos + \(t_{pre}\) = 120 | 100 + 120 | 220 ms
Margen contra la promesa, \(M\) // \(S\) = 200 ms | 200 − 220 | −20 ms: 20 ms de más
Margen contra el marketplace, \(M\) // \(S\) = 300 ms | 300 − 220 | 80 ms de sobra
= En ese caso lento la promesa de 200 ms no se cumple, pero Ana sí recibe su sugerencia.
:::
(d) El problema está en lo que entra, así que se ataca ahí: achicar la foto antes de subirla (la app de Alba ya la reduce a 1024 píxeles de lado largo) y ponerle un límite de tamaño a lo que llega de la web. Compruébalo en la calculadora: con el preprocesamiento en 120 ms, el margen sale en −20 ms.
? [medio] ¿Es drift? Para cada situación di si es drift y, si no, qué es. (a) Llega diciembre y suben las fotos de adornos, suéteres y juguetes. (b) El negocio agrega la categoría «bolsas». (c) Sale un celular muy popular que toma fotos más brillantes y con más contraste. (d) Alguien cambia el código de la API y ahora la foto le llega al modelo con los colores en otro orden. (e) Las respuestas tardan más en la hora de más tráfico.
- (a) **Drift.** Las fotos que llegan cambiaron con la temporada. Más adelante verás que tiene un nombre más exacto: cuando cambia sobre todo cuánto llega de cada categoría, se llama [[label-shift|*label shift*]].
- (b) **No es drift: es un cambio en las categorías.** El modelo ni siquiera tiene «bolsas» entre sus respuestas. Toca reentrenar con la categoría nueva.
- (c) **Drift.** Las fotos se parecen menos a las del entrenamiento, aunque los productos sean los mismos.
- (d) **No es drift: es un bug.** El mundo no cambió; cambió cómo el programa prepara la foto, que ya no es igual que en el entrenamiento. Tiene nombre: [[training-serving-skew]]. Se arregla el código, no se reentrena.
- (e) **No es drift: es carga.** El modelo acierta igual; lo que faltan son copias. Es trabajo de la orquestación.
? [reto] Una app de comida a domicilio muestra «Llega en 35 min» cuando confirmas tu pedido. (a) ¿Qué parte es el camino online y qué tan rápido tendría que ser? (b) ¿De dónde salen las etiquetas del camino offline? (c) ¿Qué fallback pondrías? (d) ¿Cuáles son los dos puentes?
- (a) **Online:** al confirmar, la app manda el restaurante, tu dirección y la hora, y el modelo predice el tiempo. Tú estás esperando esa pantalla, así que tiene que ser rápido: del orden de cientos de milisegundos, como en Alba (es un supuesto razonable, no un dato).
- (b) **Etiquetas:** el tiempo real de entrega, que se sabe cuando el pedido llega a tu puerta. Hay que guardar cada predicción y, cuando llegue el tiempo real, juntar las dos.
- (c) **Fallback:** un tiempo fijo por zona o el promedio de ese restaurante, como «30–45 min». Es peor que el modelo, pero nunca deja la pantalla vacía.
- (d) **Puentes:** el registro de cada predicción con su tiempo real (de online a offline) y el deploy del modelo reentrenado (de offline a online).
? [reto] Moderación quiere revisar con otro modelo si cada foto trae un producto prohibido. En el caso lento, ese modelo tarda 60 ms. (a) Si va en el camino de Ana, después del clasificador, ¿cuánto suma el caso lento de Alba, que era de 152 ms, y qué margen queda contra los 200 ms? (b) ¿Ana está esperando esa respuesta? ¿Dónde lo pondrías y qué ganas?
Es el presupuesto de latencia con un sexto paso, la moderación: \(T\) es la suma de los seis pasos y \( M = S − T \), con \(S\) = 200 ms.
:::cuenta Un modelo más en el camino de Ana
Presupuesto de Alba, caso lento // los cinco pasos de «El presupuesto de Alba» | 40 + 52 + 27 + 3 + 30 | 152 ms
Total con moderación, \(T\) // los cinco pasos + 60 ms de moderación | 152 + 60 | 212 ms
Margen, \(M = S − T\) // \(S\) = 200 ms | 200 − 212 | −12 ms
= En el caso lento ya no cabe en los 200 ms, y todo por un modelo que Ana ni siquiera necesita.
:::
(b) **No.** Para sugerirle «Tenis» no hace falta saber si el producto está prohibido, así que ese modelo va aparte, sin que nadie espere cada respuesta: otro servicio revisa la foto segundos o minutos después (y si hubiera que frenar la publicación, al publicar, con su propio reloj).

Ganas tres cosas: Ana conserva sus 48 ms de margen, si moderación falla ella ni se entera, y moderación puede usar un modelo más lento y más preciso. Alba lo hace así: su moderación es otro sistema, fuera de la API de categorías.
:::

## Lo que sigue {What comes next}

- **En Sensei.** La siguiente lección, «Qué es un modelo», abre la caja: qué hace el modelo por dentro y qué significa de verdad el «94 %». Después vienen cómo ve una foto, con qué aprende, cómo aprende y cómo saber si aprendió. Las cuentas de esta lección (percentiles, requests por segundo, qué tan seguido falla algo) se hacen a fondo en el módulo «Números y estadística para producción».

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene una lección donde se ve a fondo, más adelante.

:::conceptos
modelo parametro entrenamiento etiqueta inferencia prediccion produccion deploy notebook ml-engineer pipeline dataset api serving servidor contenedor orquestacion monitoreo drift reentrenamiento request latencia ms camino-online camino-offline fallback
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuál es la diferencia entre entrenar un modelo y usarlo?
Al entrenar, el modelo ve ejemplos con su respuesta correcta y ajusta sus parámetros. Es lento y se hace de vez en cuando. Al usarlo (inferencia), recibe un caso nuevo sin respuesta y solo calcula, con los parámetros fijos. Es rápido y pasa millones de veces.
? Un modelo acierta 95 % en tu laptop. ¿Ya está en producción?
No. Le falta todo lo demás: que alguien le pueda preguntar (API), que corra igual en otras máquinas (contenedor), que aguante a millones de personas sin caerse (orquestación) y que alguien vigile que siga acertando (monitoreo).
? ¿Qué es el camino online, qué es el offline y cuál es el reloj de cada uno?
El online es lo que pasa mientras alguien espera la respuesta: milisegundos (en Alba, 99 de cada 100 fotos en menos de 200 ms). El offline prepara la siguiente versión sin que nadie espere, con datos, etiquetas, entrenamiento y examen: horas, días o semanas (en Alba, una vuelta al mes).
? ¿Cuáles son los dos puentes entre los dos caminos?
El registro de cada request, que lleva lo que pasó en el online hacia el offline, y el deploy, que lleva la versión aprobada del offline al online. Sin el primero el modelo no aprende nada nuevo; sin el segundo, lo que aprende no le llega a nadie.
? ¿Qué pasa si la API de Alba no contesta en 300 ms, y por qué existe ese plan?
El marketplace deja de esperar y le muestra a Ana el selector de categorías: es el fallback. Existe porque todo falla alguna vez: aun cumpliendo su promesa del 99.9 %, hasta 300 mil fotos al mes se quedan sin sugerencia.
? ¿Por qué un deploy se hace poco a poco y no de golpe?
Para que, si la versión nueva trae un problema, solo le pegue a unos pocos. En Alba responde primero 5 de cada 100 fotos, luego 25 y luego todas; si algo empeora, se regresa sola a la anterior.
? Nadie ha tocado el modelo en seis meses y ahora se equivoca más. ¿Cómo puede ser?
Porque el mundo cambió: llegan fotos distintas a las del entrenamiento. Eso es drift. La solución es juntar y etiquetar datos nuevos y reentrenar. (Si además aparece una categoría nueva, el modelo ni siquiera puede elegirla: también toca reentrenar.)
:::
