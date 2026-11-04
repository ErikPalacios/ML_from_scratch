---
titulo: El camino completo
subtitulo: Qué significa poner un modelo en producción, contado de principio a fin con un solo ejemplo.
pregunta: Cuando una app «usa IA», ¿qué tuvo que pasar para que eso funcione?
minutos: 20
---

:::idea
Poner un modelo en producción es convertir algo que funcionó una vez en tu computadora en un servicio que le responde a millones de personas, rápido, todos los días, y que sigue acertando aunque el mundo cambie.
:::

:::nota Cómo leer esto
Las palabras subrayadas, como [[modelo]], abren su definición ahí mismo: tócalas sin miedo, no te sacan de la página. Los bloques «Para ir más hondo» son opcionales: puedes saltarlos y la lección se entiende igual.
:::

## Una escena de 200 milisegundos

Ana quiere vender unos tenis que ya no usa. Abre la app de un marketplace (una tienda en línea donde cualquiera puede vender), les toma una foto, la sube y, antes de terminar de escribir el título, la app ya le sugiere la categoría: **Calzado › Tenis**.

Para Ana eso no fue nada. Para que pasara, alguien tuvo que juntar millones de fotos, enseñarle a un programa a reconocerlas, ponerlo a responder en computadoras que nunca se apagan, cuidar que conteste en más o menos lo que dura un parpadeo y revisar cada día que siga acertando.

Ese es el caso que vamos a seguir en todo Cimientos. Se llama **C01**. Es el mismo caso que el Dojo (la parte de TrueML donde practicas con código) simula en pequeño: un marketplace que recibe unos 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de su foto, entre 500 posibles.

## Primero: ¿qué es un modelo?

A un programa normal tú le escribes las reglas: «si la compra pasa de 1000 pesos, el envío es gratis». A un [[modelo]] no le escribes reglas. Le muestras miles de ejemplos con su respuesta correcta y él solo encuentra la manera de pasar de la entrada a la respuesta.

¿Por qué no escribir las reglas a mano? Intenta escribir la regla para reconocer unos tenis en una foto. ¿Por la forma? ¿Por las agujetas? ¿Y si es una bota? ¿Y si la foto está oscura, o de lado, o el tenis está dentro de su caja? Hay cosas que es mucho más fácil mostrar que explicar.

:::figura modelo-funcion
Un modelo funciona como una función: entra una foto y sale qué tan probable es cada categoría. Los porcentajes son de ejemplo.
:::

Por dentro, un modelo es un montón de números que se llaman [[parametro|parámetros]]. Piensa en ellos como perillas: cada combinación de perillas hace que el modelo responda distinto. El modelo de C01 tiene unos 25 millones.

:::analogia Cómo aprende un niño a reconocer perros
Nadie le explica a un niño «un perro tiene cuatro patas, hocico y cola». Le señalan perros: este es un perro, este también, ese de allá es un gato. Después de suficientes ejemplos reconoce un perro que nunca había visto. Un modelo aprende de una forma parecida: de ejemplos, no de reglas.

La diferencia es la cantidad: al niño le bastan unos cuantos ejemplos, y el modelo necesita miles.
:::

## Los dos momentos de un modelo

Todo modelo vive dos momentos muy distintos, y casi todo lo demás en esta app depende de no confundirlos.

:::pasos
1. Entrenar
El [[entrenamiento]] es mostrarle muchos ejemplos de los que ya sabes la respuesta: fotos con su categoría correcta, que se llama su [[etiqueta]]. El modelo adivina, compara su respuesta con la correcta y mueve sus perillas un poquito para equivocarse menos. Eso se repite millones de veces. Es lento y caro, así que se hace de vez en cuando: en C01, una vez al mes.
2. Usar
La [[inferencia]] es usar el modelo ya entrenado. Recibe una foto nueva, sin respuesta, y da su [[prediccion|predicción]]. Las perillas ya no se mueven: solo calcula. Es rápido y pasa todo el tiempo: en C01, millones de veces al día.
:::

:::figura dos-momentos
Entrenar se hace pocas veces y tarda horas. Usar se hace millones de veces y tarda milisegundos.
:::

:::ojo
Cuando alguien dice «el modelo aprende de los usuarios», casi nunca es en tiempo real. El modelo que está respondiendo no cambia sus perillas con cada foto. Se juntan datos nuevos, se entrena una versión nueva aparte y, si sale mejor, reemplaza a la anterior.
:::

## ¿Qué significa «producción»?

Que un modelo funcione en tu laptop no significa que esté listo. Está en [[produccion|producción]] cuando gente real lo usa todos los días y, si falla, alguien lo nota.

| | En tu laptop | En producción |
|---|---|---|
| Quién lo usa | Tú | Millones de personas que ni saben que existe |
| Cuántas veces | Unas cuantas, cuando tú quieres | Sin parar, de día y de noche, con horas pico |
| Qué tan rápido | Da igual si tarda 5 segundos | Más o menos lo que dura un parpadeo |
| Si se rompe | Lo vuelves a correr | Ana no recibe sugerencia y tiene que buscar la categoría a mano; si pasa seguido, se publica menos y el negocio pierde dinero |
| Los datos | Los que descargaste, siempre los mismos | Nuevos cada día, y van cambiando |
| Dónde corre | En un [[notebook]], en tu máquina | En [[servidor\|servidores]] que nunca se apagan |

Por eso existe el trabajo de [[ml-engineer]]. No se trata solo de que el modelo acierte, sino de que todo lo que lo rodea funcione. Un artículo científico famoso de Google («Hidden Technical Debt in Machine Learning Systems», Sculley y otros, 2015) lo dibujó así: el código del modelo es una cajita chica en medio de todo lo demás, que son los datos, la configuración, los servidores y el monitoreo.

## El camino completo, en seis etapas

Todo lo que rodea al modelo se puede ordenar en seis etapas. En TrueML (el conjunto de herramientas al que pertenece Cimientos) cada etapa tiene su color, y juntas forman la T del logo: la verás arriba de cada lección, con las etapas que toca encendidas.

:::diagrama camino
Lo que sale de cada etapa es lo que entra a la siguiente, y el monitoreo cierra el ciclo.
:::

Una cadena de pasos así, donde lo que sale de uno entra al siguiente, se llama [[pipeline]]. Veamos qué pasa en cada etapa.

### 1 · Datos

Todo empieza con ejemplos. Hay que juntar fotos, ponerles su categoría correcta (muchas veces una persona lo hace a mano), revisar que estén bien y guardarlas como una versión fija que ya nadie modifica, para saber después exactamente con cuáles se entrenó. **Sale:** un [[dataset]], la colección de fotos con su categoría.

### 2 · Modelo

Con el dataset se entrena el modelo. Luego se examina con fotos que nunca vio, y solo si pasa el examen se aprueba. Al final se convierte a un formato que hace los mismos cálculos con menos trabajo, para que responda más rápido. **Sale:** el modelo aprobado, guardado en un archivo.

### 3 · API

El modelo solo, en un archivo, no le sirve a nadie si nadie le puede preguntar. Se escribe un programa que lo carga y lo pone a responder: recibe una foto por la red (internet, o la red interna de la empresa) y regresa la categoría. La «ventanilla» por donde se le pregunta es su [[api|API]], y a tener el modelo respondiendo así se le llama [[serving]]. **Sale:** el programa que responde.

### 4 · Contenedor

El programa funciona en tu máquina, pero ¿funcionará igual en otra? Se empaqueta con todo lo que necesita (la versión exacta de Python, las librerías, que son código que otros ya escribieron y tu programa usa, y el modelo) en un [[contenedor]], que corre igual en cualquier máquina que sepa correr contenedores. **Sale:** el paquete probado, listo para copiarse a cualquier servidor.

### 5 · Orquestación

Una sola computadora no aguanta millones de [[request|peticiones]] y, si se apaga, se apaga todo. Así que se corren muchas copias del contenedor en muchas máquinas, y un sistema de [[orquestacion|orquestación]] decide cuántas hacen falta, les reparte el trabajo y reemplaza a las que fallan. También cambia a la versión nueva poco a poco, sin apagar nada. **Sale:** el servicio funcionando para todo el mundo.

### 6 · Monitoreo

Ya en producción se mide todo: cuánto tarda cada respuesta, cuántas fallan y si el modelo sigue acertando. Eso es el [[monitoreo]]. Y aquí viene lo que más sorprende al principio: aunque nadie toque el modelo, con el tiempo empieza a fallar más, porque el mundo cambia y llegan fotos distintas a las de su entrenamiento. A eso se le llama [[drift]]. Cuando pasa, se juntan datos nuevos y se vuelve a la etapa 1: es el [[reentrenamiento]]. **Sale:** la señal de que hay que reentrenar y las fotos nuevas para etiquetar.

:::analogia Una cadena de restaurantes
- **Datos:** conseguir los ingredientes y revisar que estén buenos.
- **Modelo:** el chef desarrolla la receta en la cocina de pruebas, y un comité la prueba antes de aprobarla.
- **API:** el mostrador donde se toman los pedidos.
- **Contenedor:** una cocina estándar, con la misma estufa, los mismos utensilios y la receta pegada en la pared, que se arma igual en cualquier sucursal.
- **Orquestación:** la gerencia regional, que decide cuántas sucursales abrir según la demanda y reemplaza la que tiene que cerrar.
- **Monitoreo:** medir cuánto tardan los pedidos y leer las quejas. Si los gustos de la gente cambian, toca una receta nueva.

**Dónde se rompe la analogía:** un chef mejora la receta con su criterio, y un modelo solo mejora si le das mejores datos. Además, una receta que deja de gustar se nota en las quejas. Un modelo que empieza a fallar no se queja: si no lo mides, nadie se entera.
:::

## Las 12 estaciones dentro de las 6 etapas

En el Dojo y en la Ronda de Diseño el caso C01 se divide en 12 estaciones. Cada una vive dentro de una etapa. No te preocupes por los nombres raros: cada estación tendrá su propia lección aquí.

| Etapa | Estaciones de C01 | Qué sale, en palabras simples |
|---|---|---|
| Datos | 1 · Datos y etiquetas\n2 · Versionado y linaje | Las fotos del mes con su categoría, guardadas con un nombre que no cambia |
| Modelo | 3 · Entrenamiento\n4 · Gate de evaluación y registry\n5 · Export, engine y paridad | Un modelo que pasó su examen, convertido a un formato rápido |
| API | 6 · Código de serving | El programa que recibe la foto y responde |
| Contenedor | 7 · Empaquetado (Docker)\n8 · CI/CD y registro de imágenes | El paquete probado y guardado, listo para copiarse |
| Orquestación | 9 · Kubernetes\n10 · Rollout seguro | El servicio corriendo en muchas copias, ya con la versión nueva |
| Monitoreo | 11 · La request en vivo\n12 · Monitoreo y reentrenamiento | Las mediciones que deja cada request y la señal de reentrenar |

## Lo que pasa cuando Ana sube su foto

Ahora juntemos todo en la escena del principio. Cuando Ana sube la foto, pasa esto:

:::diagrama request
Todo el recorrido, de ida y vuelta, en una fracción de segundo.
:::

El mensaje que los servidores del marketplace le mandan a la API se llama [[request]], y lo que regresa se llama *response*. El tiempo que tarda la API desde que recibe la request hasta que manda la response es la [[latencia]]. C01 se compromete a que 99 de cada 100 respuestas tarden menos de 200 [[ms|milisegundos]], más o menos lo que dura un parpadeo, sin contar el viaje por internet hasta el celular de Ana.

:::profundo ¿Por qué «99 de cada 100» y no el promedio?
Imagina que 98 respuestas tardan 30 ms y 2 tardan 3 segundos. El promedio sale en unos 89 ms y se ve muy bien, pero 2 de cada 100 personas sienten la app trabada. Con millones de fotos al día, eso es muchísima gente. Si ordenas las 100 de la más rápida a la más lenta, la número 99 tarda 3 segundos: eso es lo que mide «99 de cada 100», y ahí no se cumplen los 200 ms aunque el promedio se vea bien. Por eso se mide qué tan lentas son las respuestas más lentas, y no solo el promedio. Lo vemos a fondo en la lección de latencia.
:::

## Por qué nunca se termina

Lo último que hay que llevarse de esta lección: un modelo en producción no es un proyecto que se termina, es algo que se cuida.

Aunque nadie toque el modelo, el mundo sí cambia: salen modelos nuevos de tenis, cambian las modas, los celulares toman fotos con otra luz. Las fotos que llegan se van pareciendo menos a las del entrenamiento y el modelo acierta un poco menos cada mes. Nadie rompió nada. El monitoreo lo detecta, se etiquetan fotos nuevas, se reentrena y la versión nueva reemplaza a la anterior. Y el ciclo vuelve a empezar.

En el Dojo pasa además otra cosa: el 1 de octubre el negocio agrega la categoría «bolsas». El modelo no puede sugerir «bolsas» porque esa opción ni siquiera existe entre sus respuestas, así que elige la más parecida que conoce. Eso no es drift: es un cambio en las categorías, y obliga a reentrenar antes de lo planeado.

## Palabras que vas a oír

Estos son los conceptos que presentó esta lección. Cada uno tiene una lección donde se ve a fondo, más adelante.

:::conceptos
modelo parametro entrenamiento etiqueta inferencia prediccion produccion notebook ml-engineer pipeline dataset api serving servidor contenedor orquestacion monitoreo drift reentrenamiento request latencia ms
:::

## Chequeo

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuál es la diferencia entre entrenar un modelo y usarlo?
Al entrenar, el modelo ve ejemplos con su respuesta correcta y ajusta sus parámetros. Es lento y se hace de vez en cuando. Al usarlo (inferencia), recibe un caso nuevo sin respuesta y solo calcula, con los parámetros fijos. Es rápido y pasa millones de veces.
? Un modelo acierta 95 % en tu laptop. ¿Ya está en producción?
No. Le falta todo lo demás: que alguien le pueda preguntar (API), que corra igual en otras máquinas (contenedor), que aguante a millones de personas sin caerse (orquestación) y que alguien vigile que siga acertando (monitoreo).
? Nadie ha tocado el modelo en seis meses y ahora se equivoca más. ¿Cómo puede ser?
Porque el mundo cambió: llegan fotos distintas a las del entrenamiento. Eso es drift. La solución es juntar y etiquetar datos nuevos y reentrenar. (Si además aparece una categoría nueva, el modelo ni siquiera puede elegirla: también toca reentrenar.)
? ¿Por qué el camino es un ciclo y no una línea recta?
Porque el monitoreo detecta cuándo el modelo se quedó atrás, y eso dispara volver a la etapa de Datos para reentrenar con datos nuevos.
? En la escena de Ana, ¿qué parte es la API?
La ventanilla por la que los servidores del marketplace le mandan la foto al modelo y reciben la categoría de vuelta.
:::
