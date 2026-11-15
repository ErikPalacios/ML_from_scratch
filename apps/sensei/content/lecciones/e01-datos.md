---
titulo: Datos y etiquetas
en: Data and labels
subtitulo: El primer paso del sistema de Alba de principio a fin: unir el log con lo que hizo la gente, decidir qué etiquetas gratis sirven, elegir y pagar las 5,000 del mes, medir si las personas coinciden y no dejar entrar datos rotos.
pregunta: Cada mes, Alba tiene millones de predicciones en su log y millones de categorías que eligió la gente. ¿Cómo salen de ahí las etiquetas con que se entrena y se mide el modelo siguiente, sin que el modelo termine aprendiendo de sí mismo?
requisitos: ejemplos, almacenamiento, privacidad, tiempo-hash, pruebas-ci
---

:::idea
Las etiquetas de un sistema en producción no se compran todas: casi todas salen gratis de lo que hace la gente, y por eso traen la huella del propio modelo. Esta estación une el log con lo que pasó después, se queda solo con las etiquetas gratis que ya maduraron, paga a personas por las pocas que más enseñan, mide si esas personas coinciden y no deja pasar datos rotos al entrenamiento.
:::

Alba es la empresa que seguimos en todo el curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y le sugiere a quien vende la categoría de cada foto entre 500 posibles. Un modelo, una [[resnet|ResNet-50]] (una red neuronal para fotos), hace la sugerencia; responde ≈ 10 millones de fotos al día, contando las que le piden moderación y búsqueda, y se reentrena cada mes. Ana, por ejemplo, sube la foto de unos tenis y recibe «Calzado › Tenis».

Las piezas las viste en la lección «Datos, ejemplos, features y etiquetas». Aquí solo se recuerdan:

- Una [[etiqueta]] es la respuesta correcta de un ejemplo: la categoría real de una foto. [[etiquetado|Etiquetar]] es ponérsela, y cuesta dinero cuando lo hace una persona pagada.
- Alba saca sus etiquetas de tres fuentes: lo que elige quien vende al publicar, lo que corrige **moderación** (el equipo de Alba que revisa publicaciones reportadas o sospechosas) y lo que etiquetan personas pagadas.
- El [[active-learning|active learning]] elige qué fotos pagar por etiquetar, sobre todo las que el modelo tiene dudosas, en vez de sortearlas todas.
- La [[kappa]] mide qué tanto coinciden dos personas al etiquetar, descontando lo que coincidirían por puro azar: 1 es acuerdo perfecto; 0, lo mismo que el azar.
- El [[golden-set|golden set]] es el examen de Alba: 50,000 fotos etiquetadas con cuidado por personas, congeladas, que nunca se usan para entrenar.

En esa lección también apareció, en una línea, lo que aquí se desarrolla: el grupo de ≈ 1 % que no ve sugerencias, el modelo que termina imitándose a sí mismo, la doble anotación del 10 % y la guía con versión. Aquí son ampliaciones, con sus números.

Esta lección pone esas piezas a trabajar juntas como **un paso del sistema**: el primero de los que arman cada modelo nuevo. A cada paso así le decimos **estación**, como en una línea de producción: recibe algo, lo trabaja y se lo pasa a la siguiente. Vas a ver qué entra, qué sale, cada decisión con su número, cómo se comprueba que salió bien y qué se rompe cuando sale mal.

En este curso a la etiqueta también se le dice *label*, como en el trabajo. Las dos palabras significan lo mismo.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

Piensa en la estación como una caja con entradas y salidas. Saber exactamente qué cruza esa caja es la mitad del trabajo, porque cada flecha que entra tiene un dueño distinto y puede romperse por su lado.

### Lo que entra

Cuatro cosas, de cuatro lugares distintos:

- **El log de predicciones.** Cada vez que el modelo de Alba responde, el servicio escribe una línea de ≈ 300 bytes: el [[request-id|request_id]] de esa foto, la versión del modelo (`model_version`), las 5 categorías sugeridas con su [[confianza]], la [[latencia]] y un prefijo de la [[hash-criptografico|huella SHA-256]] de la foto (un número que identifica su contenido exacto). Son ≈ 10 millones de líneas al día, guardadas en [[parquet|Parquet]] y [[particion-datos|particionadas]] por `dt=YYYY-MM-DD/model_version=…`. Se guardan 90 días. No trae la foto ni datos de quien vende.
- **Los eventos del backend de publicaciones.** El programa que arma cada publicación avisa dos cosas: `suggestion_shown` (la pantalla sí pintó las 5 sugerencias) y `category_selected` (qué categoría quedó, en qué posición estaba, y por qué vía: tocando una sugerencia, buscando o recorriendo el árbol de categorías).
- **Las correcciones de moderación.** Cuando alguien de moderación revisa una publicación y cambia su categoría, queda una fila con la publicación, la hora y la categoría nueva.
- **Las fotos originales**, en el almacén del producto. Traen [[exif|EXIF]]: los metadatos que el celular mete en el archivo, que pueden incluir el GPS de donde se tomó.

### Lo que sale

- **Labels débiles filtrados**: los que salen gratis de lo que hizo la gente. Cada uno lleva su fuente: lo que eligió quien vende, si ya pasó un plazo de espera sin que nadie lo corrigiera, o lo que corrigió moderación.
- **Los labels del mes hechos por personas**: las ≈ 5,000 fotos que Alba paga por etiquetar cada mes, la **cola del mes**, adjudicadas (los desacuerdos entre personas, ya decididos).
- **Las fotos de esa cola**, copiadas sin metadatos a un lugar cerrado que las borra solo a los 90 días.
- **Un reporte**: la kappa de cada categoría por separado y qué tan exacta resultó cada fuente de labels.

Lo que sale alimenta el paso siguiente: el [[snapshot]] del mes, una foto fija de qué datos entrenan al modelo. Cómo se arma y se protege lo cuenta «Versionado y linaje».

### Lo que se decide

Cinco decisiones, y cada una tiene su sección:

:::pasos
1. Qué labels gratis sirven
Cuáles entran y con qué señal, y cuánto hay que esperar para confiar en ellos.
2. Qué ≈ 5,000 fotos se pagan
La mezcla de la cola: cuántas al azar, cuántas dudosas, cuántas de desacuerdos, cuántas de categorías nuevas.
3. Si las personas coinciden
Cuántas fotos llevan doble anotación, la kappa por clase y quién decide los desacuerdos.
4. Qué fotos salen y cómo
Solo las de la cola, sin EXIF, a un [[bucket-objetos|bucket]] (un contenedor de archivos en la nube) cerrado, que las borra solo.
5. Qué falla detiene todo
Qué chequeos bloquean el entrenamiento y cuáles solo avisan.
:::

Y dos cosas que la estación **no toca**: el golden set y el holdout (lo verás en un momento). Son los únicos que miden sin la huella del modelo, y por eso nadie los mezcla con nada.

:::diagrama e01-datos-estacion
La estación 1 completa, de los cuatro datos que entran a los labels del mes. Toca cada caja; el recorrido sigue un mes.
:::

## Unir el log con la publicación {Joining the log with the listing}

El log dice qué sugirió el modelo. El evento dice qué eligió la persona. La corrección dice qué decidió moderación. Ninguno sirve solo: el label de una foto sale de **juntarlos**. Esa operación es un [[join]]: unir las filas de dos tablas cuyas llaves coinciden, como en «Bases de datos: tablas, SQL y llave-valor». La llave que los une es el `request_id`.

### La llave: el request_id

Cuando la app de Ana sube la foto de sus tenis, el servicio le pone un identificador único a esa [[request]] (la petición que mandó la app), como `r-001`, lo escribe en su línea de log y lo devuelve en la respuesta. El backend de publicaciones **guarda ese `request_id` junto a la foto, en el borrador de la publicación**. Cuando Ana publica, el evento `category_selected` lleva su `listing_id` (el número de la publicación, 8811), los `request_id` de sus fotos y la categoría elegida.

Esa es la [[log-prediccion|llave de unión]]: un dato que viaja por todas las piezas y deja juntar lo que pasó en cada una. Sin ella habría que adivinar por la hora y el usuario, y eso falla.

:::ojo
El `request_id` es un contrato entre dos equipos. Si el backend un día cambia su formato (por ejemplo, empieza a guardarlo con un prefijo), el join no falla: simplemente encuentra menos filas. Los labels del mes salen con menos fotos y nadie recibe un error. Por eso la estación **cuenta filas** en cada paso y vigila qué fracción de publicaciones encontró su log: si un join da el triple de las fotos del log, algo se multiplicó; si da la mitad, se perdió una llave.
:::

### Cuántas filas salen: la cardinalidad

Aquí está la trampa más común de un join. Una publicación tiene ≈ 3 fotos, y cada foto es una request con su línea de log. Así que unir publicaciones con el log no da una fila por publicación: da **una fila por foto**, ≈ 3 por publicación. Eso está bien, porque el label es de cada foto.

El problema son las correcciones. Una publicación puede tener **dos** correcciones: alguien de moderación la cambió y otra persona la volvió a cambiar. Si unes las fotos con todas las correcciones, cada foto se repite una vez por corrección. Una publicación con 3 fotos y 2 correcciones da 3 × 2 = 6 filas, en vez de 3. Esa cuenta de cuántas filas de un lado tocan a cuántas del otro es la **cardinalidad** del join.

La regla de Alba tiene dos partes:

- **Log con publicación:** `JOIN` por `request_id`. Un `JOIN` a secas solo deja las filas que encuentran pareja en las dos tablas: una foto sin publicación (quien la subió nunca publicó) no da label.
- **Con las correcciones:** `LEFT JOIN`, que conserva las fotos aunque no tengan corrección, y **antes** se queda con la más reciente de cada publicación. La corrección de moderación manda sobre la elección de quien vende.

:::figura e01-datos-union
Arriba, la publicación 8813 con 2 fotos y 2 correcciones: un join directo da 4 filas. Abajo, quedándose primero con la corrección más reciente: 2 filas, una por foto.
:::

El código de abajo lo hace con 6 fotos de 3 publicaciones. La 8811 es la de Ana, con 3 fotos; la 8812, la bicicleta de Beto; la 8813, una lámpara de Caro que moderación corrigió dos veces. Toma el 5 de noviembre de 2026 como el día de hoy, y la regla de los 30 días que verás en la sección siguiente. `top1` es la [[top-k|primera sugerencia]] del modelo, la de más confianza.

```python
from datetime import date
log = [("r-001", "Tenis"), ("r-002", "Tenis"), ("r-003", "Zapatos de vestir"),   # request_id, top-1
       ("r-004", "Bicicletas"), ("r-005", "Lámparas"), ("r-006", "Lámparas")]
pub = {"r-001": 8811, "r-002": 8811, "r-003": 8811, "r-004": 8812, "r-005": 8813, "r-006": 8813}
elegida = {8811: ("Tenis", "sugerencia", date(2026, 10, 2)),       # listing_id → categoría, vía, fecha
           8812: ("Bicicletas", "sugerencia", date(2026, 10, 20)),
           8813: ("Muebles", "busqueda", date(2026, 10, 3))}
correcciones = [(8813, "2026-10-05T10:00:00Z", "Lámparas"), (8813, "2026-10-09T16:30:00Z", "Iluminación")]

ingenuo = [(r, c) for r, _ in log for c in correcciones if c[0] == pub[r]]
ultima = {}
for lid, ts, cat in sorted(correcciones, key=lambda c: c[1]):   # en UTC, el texto ordena bien
    ultima[lid] = cat                                              # se queda la más reciente
print("filas del log:", len(log), "· join ingenuo con correcciones:", len(ingenuo), "filas para 2 fotos")

hoy = date(2026, 11, 5)
for r, top1 in log:
    lid = pub[r]; cat, via, dia = elegida[lid]
    if lid in ultima:
        print(r, lid, "→", ultima[lid], "· moderador")
    elif (hoy - dia).days >= 30:
        print(r, lid, "→", cat, "· vendedor_filtrado · vía", via, "· top-1 fue", top1)
    else:
        print(r, lid, "→ sin label: lleva", (hoy - dia).days, "días, madura a los 30")
```

```salida
filas del log: 6 · join ingenuo con correcciones: 4 filas para 2 fotos
r-001 8811 → Tenis · vendedor_filtrado · vía sugerencia · top-1 fue Tenis
r-002 8811 → Tenis · vendedor_filtrado · vía sugerencia · top-1 fue Tenis
r-003 8811 → Tenis · vendedor_filtrado · vía sugerencia · top-1 fue Zapatos de vestir
r-004 8812 → sin label: lleva 16 días, madura a los 30
r-005 8813 → Iluminación · moderador
r-006 8813 → Iluminación · moderador
```

Tres cosas que mirar. La lámpara de Caro tenía 2 fotos y el join directo dio 4 filas: el doble. La bicicleta de Beto todavía no tiene label, aunque Beto eligió su categoría hace 16 días. Y la tercera foto de Ana: el modelo dijo «Zapatos de vestir», pero la publicación quedó en «Tenis». Esa foto es un **desacuerdo**, y va a importar cuando se arme la cola del mes.

Las horas de las correcciones están en [[utc|UTC]] y en formato [[iso-8601|ISO 8601]]. Ese formato va de lo grande a lo chico (año, mes, día, hora) y todas las horas están en la misma zona; por eso ordenarlas como texto da el orden en el tiempo. Con horas locales sin zona, eso deja de ser cierto.

:::profundo La misma unión en SQL
En el sistema de verdad, esto no se hace en Python sobre 6 filas: se hace en [[sql|SQL]] sobre un mes de log. Esta consulta es una **ilustración**; los nombres de tablas son de ejemplo. `ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY corrected_at DESC)` numera las correcciones de cada publicación, de la más reciente (1) a la más vieja; a eso se le llama una función de ventana. `QUALIFY` es una cláusula que tienen algunos motores de SQL, como DuckDB o BigQuery, para filtrar por ese número: aquí, quedarse con la fila 1 de cada publicación.

```sql
WITH ultima AS (                -- una sola corrección por publicación: la más reciente
  SELECT listing_id, categoria AS corregida
  FROM correcciones
  QUALIFY ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY corrected_at DESC) = 1
)
SELECT l.request_id, l.model_version, p.listing_id, p.categoria AS elegida, p.via, u.corregida
FROM log_predicciones AS l
JOIN publicaciones AS p ON p.request_id = l.request_id   -- una fila por foto
LEFT JOIN ultima AS u ON u.listing_id = p.listing_id     -- no multiplica: ya hay una por publicación
WHERE l.dt BETWEEN '2026-07-01' AND '2026-07-31';
```
:::

## Labels gratis y cuándo maduran {Free labels and when they mature}

Un [[label-debil|label débil]] (*weak label*) es el que sale gratis de lo que la gente hace por su cuenta: elegir una categoría, buscar, corregir. Es débil porque nadie lo hizo con cuidado para entrenar un modelo; la persona solo quería publicar. Es abundante: en Alba hay uno por cada publicación, ≈ 2.5 millones al día. Y es [[ruido-etiquetas|ruidoso]]: una parte está mal.

No todos valen igual. La **vía** por la que llegó dice mucho:

| Lo que hizo la persona | Qué tan buena es la señal | Por qué |
|---|---|---|
| Tocó una de las 5 sugerencias | La más débil | Pudo aceptarla sin mirar: la sugerencia la empujó |
| Buscó o recorrió el árbol | Fuerte | Ignoró las sugerencias y fue a buscar otra cosa: lo eligió de verdad |
| Moderación la corrigió | Muy fuerte | Alguien con criterio la revisó; pero solo existe donde alguien revisó |

### La regla de maduración

La elección de quien vende llega en minutos. ¿Por qué no usarla al día siguiente? Porque **todavía puede cambiar**. Moderación revisa publicaciones durante días, a veces porque otra persona reportó que estaba mal. Si entrenas con la elección del día uno, metes etiquetas que una semana después alguien corrigió.

La salida de Alba es una [[regla-maduracion|regla de maduración]]: la elección de quien vende cuenta como label **solo después de 30 días sin corrección de moderación**. Mientras tanto, la fila existe, pero no tiene label. Así quedó la bicicleta de Beto en el código: 16 días, todavía no.

¿Por qué 30 y no 7? Es un equilibrio. Con menos días, entran labels que todavía se iban a corregir. Con más, los labels que entrenan cada mes son más viejos, y el modelo aprende tarde lo que cambió en el catálogo.

Alba se reentrena el día 1 de cada mes, con el snapshot del mes que acaba de terminar. El de septiembre (`ds-2026-09-01`) lo arma la corrida del 1 de octubre de 2026 (la ejecución automática del [[pipeline]], la cadena de pasos que va de los datos al modelo), con los labels vigentes al corte de ese día a las 00:00 UTC. Cuenta hacia atrás: del 1 de septiembre al 1 de octubre hay justo 30 días. Así que toma las elecciones de quien vende hechas hasta el 1 de septiembre; las que se hicieron después todavía no cumplen 30 días, y entran en el de octubre (`ds-2026-10-01`, que se arma el 1 de noviembre).

### Cuándo llega cada label

Cada fuente tarda distinto. Eso tiene nombre: un [[label-demorado|label demorado]] (*delayed label*) es el que llega mucho después de la predicción. Mientras no llega, no sabes si el modelo acertó.

:::figura e01-datos-llegada
Cuánto tarda cada fuente en dar un label confiable, desde que empieza su camino: quien vende elige en minutos, pero cuenta hasta el día 30; moderación corrige en días; la cola humana tarda ≈ 5 días hábiles más la adjudicación; el golden set se hizo una sola vez.
:::

Por eso el monitoreo del modelo en producción no puede esperar a los labels: mientras llegan, vigila señales de minutos, como cuántas sugerencias se aceptan. Lo ves en «Monitoreo, drift y reentrenamiento».

:::nota Los labels se guardan como eventos
Una corrección no borra la elección de quien vende: se agrega como una fila nueva, con su hora. Así puedes preguntar «¿qué label tenía esta foto al corte del 1 de octubre?» y obtener la respuesta de ese momento. Esa idea, los [[label-evento|labels como eventos]], es la base del versionado de datos de «Versionado y linaje».
:::

## El feedback loop y el holdout {The feedback loop and the holdout}

Esta es la trampa central de la estación, y conviene verla con números.

### El modelo que se mide a sí mismo

Quien vende ve 5 sugerencias y, muchas veces, toca la primera sin pensarlo mucho. Si el modelo acertó, perfecto. Si se equivocó, a veces la persona lo nota y corrige, y a veces no. Esa elección se vuelve label. Y el mes siguiente, con esos labels, se entrena y se **mide** el modelo nuevo.

Ese circuito es un [[feedback-loop|bucle de retroalimentación]] (*feedback loop*): las predicciones del modelo influyen en los datos con que se entrena y se evalúa. Cuando se mide con labels que el propio modelo empujó, el número sale mejor que la realidad.

¿Cuánto mejor? Depende de dos cosas: qué tan bueno es el modelo de verdad y qué parte de sus errores corrige la gente.

:::formula Lo que mide el modelo contra las elecciones de quien vende
e_{sug} = (1 − q) × (1 − c)
q_{med} = q + e_{sug}
- q: la exactitud real del modelo, como fracción: la parte de las fotos en que su top-1 es la categoría correcta
- c: la fracción de los errores del modelo que la persona corrige al publicar; el resto los acepta
- e_{sug}: la fracción de las elecciones de quien vende, sin filtrar, que quedan mal: un error del modelo que nadie corrigió
- q_{med}: la exactitud que mides si usas esas elecciones como respuesta correcta
:::

La idea detrás: si el modelo acierta, la persona deja la sugerencia y el label es correcto. Si se equivoca y la persona corrige, el label es correcto y el modelo cuenta como error. Si se equivoca y la persona acepta, el label queda **igual a la predicción equivocada**, y el examen le da el punto al modelo. Es una cuenta simplificada: supone que nadie cambia una sugerencia correcta por otra mal, y que quien corrige elige bien.

Para Alba, la exactitud top-1 del modelo ronda 0.85, y las elecciones de quien vende sin filtrar aciertan ≈ 90 % (un supuesto del curso). Con la fórmula se despeja cuántos errores corrige la gente:

:::cuenta El feedback loop con los números de Alba
Exactitud real, \(q\) // la de Alba, medida con el golden set | dato | 0.85
Errores del modelo, \(1 − q\) | 1 − 0.85 | 0.15
Elecciones mal, \(e_{sug}\) // supuesto del curso: aciertan ≈ 90 % | 1 − 0.90 | 0.10
Errores que la gente acepta, \(1 − c\) // de \(e_{sug} = (1 − q) × (1 − c)\) | 0.10 ÷ 0.15 | ≈ 0.67
Errores que la gente corrige, \(c\) | 1 − 0.67 | ≈ 0.33
Exactitud medida, \(q_{med}\) | \(q_{med} = q + e_{sug}\) = 0.85 + 0.10 | 0.95
Optimismo, \(q_{med} − q\) | 0.95 − 0.85 | 10 puntos
= Medido contra lo que eligió la gente, el modelo parece de 95 %; de verdad es de 85 %. La gente corrige solo 1 de cada 3 errores, y los otros 2 se vuelven «aciertos» en el examen.
:::

:::figura e01-datos-bucle
El circuito: el modelo sugiere, quien vende acepta, la elección se vuelve label y entrena al modelo siguiente. Medido contra esas elecciones, el modelo parece de 95 %; con la muestra al azar de la cola y el golden set, que etiquetaron personas sin ver sugerencias, es de 85 %.
:::

El daño no es solo el número inflado. Al **entrenar** con esas elecciones, el modelo siguiente aprende que sus errores aceptados eran correctos: los repite con más seguridad. Y un cambio que de verdad empeora al modelo puede verse como mejora, si empuja a la gente a aceptar más.

### El holdout: un grupo que no ve sugerencias

¿Cómo se mide sin la huella del modelo? Con gente que **nunca vio** una sugerencia. Alba aparta ≈ 1 % de las cuentas de vendedor, elegidas por un [[funcion-hash|hash]] de su `seller_id` (una función que convierte el id en un número, siempre el mismo para el mismo id), para que siempre elijan la categoría a mano. Es el [[holdout-sin-sugerencias|holdout sin sugerencias]].

Elegirlas por hash, y no al azar en cada publicación, hace que una cuenta esté siempre del mismo lado: quien está en el holdout nunca ve sugerencias, así que sus costumbres no se contaminan entre una publicación y otra. Es la misma [[asignacion-hash|asignación por hash]] que se usa en una [[ab-test|prueba A/B]] (un experimento que compara dos versiones con dos grupos de gente).

Cuánto da: 1 % de ≈ 2.5 millones de publicaciones al día son 2,500,000 × 0.01 = 25,000 publicaciones al día, y × 30 días = 750,000 al mes. Sirve para dos cosas:

- **Medir cuánto empuja la sugerencia.** Se comparan las elecciones del holdout, hechas a mano, con las del resto, hechas con sugerencias: la diferencia es lo que empuja la sugerencia. La exactitud de cada fuente no la mide el holdout: la mide la muestra al azar de la cola, que verás abajo.
- **Medir lo que vale la sugerencia.** Comparas al holdout contra los demás: cuánto tardan en publicar y qué tan seguido moderación corrige. Si la sugerencia no ayuda, se nota aquí.

Tiene un costo: el 1 % de las cuentas pierde la ayuda. Por eso es chico. Y tiene una regla: **la estación no lo toca**. Sus elecciones no se mezclan con los labels débiles del resto ni se usan para elegir la cola.

### El sesgo de selección: labels solo donde alguien miró

Las correcciones de moderación son muy buenas. Pero existen **solo para las publicaciones que alguien revisó**, y eso casi nunca es al azar: se revisa lo reportado, lo sospechoso o lo de cierta categoría. Si calculas la exactitud del modelo solo con las correcciones, mides el modelo en las publicaciones problemáticas.

Eso es el [[sesgo-seleccion|sesgo de selección]] (*selection bias*): tus datos existen solo donde el sistema decidió mirar, y no representan el resto. Pasa también dentro de la cola: las fotos dudosas que eligió el active learning son, a propósito, más difíciles que el tráfico real.

La regla que sale de aquí es la frase que conviene poder decir de cada fuente: **qué sesgo tiene y qué fuente independiente la mide**. Las elecciones de quien vende están empujadas por la sugerencia: el holdout mide cuánto las empuja, y la muestra al azar de la cola, cuánto aciertan. Las correcciones solo existen donde se revisó, y las mide la muestra al azar de la cola. La cola dudosa es más difícil que el tráfico real, y la miden el golden set y esa misma muestra al azar.

## La cola del mes y las fotos que salen {The monthly queue and the photos that leave}

Cada mes, Alba paga para que personas etiqueten ≈ 5,000 fotos. Esa lista es la [[cola-etiquetado|cola de etiquetado]]: la unidad de trabajo del mes, con su tamaño, su mezcla y su presupuesto. Ya viste en «Datos, ejemplos, features y etiquetas» lo que cuesta. Con 10 % de doble anotación (dos personas etiquetan la misma foto) son 5,000 + 500 = 5,500 anotaciones; a 5–10 centavos de dólar y 20–30 segundos cada una, ≈ US$275–550 y ≈ 31–46 horas de trabajo al mes. Las preguntas de control que verás abajo se pagan aparte. Aquí se decide **cuáles** son.

### La mezcla

La cola de Alba se reparte así (el reparto exacto es un supuesto del curso, dentro de las reglas de su active learning):

| Parte | Cuántas | Qué entra |
|---|---|---|
| Al azar | 25 % = 1,250 | Fotos sorteadas de todo el tráfico del mes |
| Incertidumbre | 40 % = 2,000 | Top-1 con confianza menor que 0.3, o una diferencia de confianza entre el top-1 y el top-2 menor que 0.1 |
| Desacuerdos | 25 % = 1,250 | Quien vende eligió algo fuera de las 5 sugerencias, o moderación corrigió |
| Categorías nuevas | 10 % = 500 | Fotos de una [[categoria-nueva\|categoría nueva]], como «bolsas» |

El umbral de 0.3 es el mismo que ya usa Alba para marcar una foto como dudosa; la diferencia de 0.1 atrapa los casi empates, como 0.45 contra 0.40.

### La muestra al azar se sortea primero

La parte al azar es la [[muestra-aleatoria|muestra aleatoria]] de la cola. Parece desperdicio, porque casi todas son fotos que el modelo ya acierta. Es lo más valioso del mes: **es la única parte con la que se puede estimar el error real** del modelo y de cada fuente de labels en el tráfico de verdad. Lo demás está elegido a propósito.

Y tiene una regla de orden: **se sortea primero, de todas las fotos del mes**, antes de llenar los otros cupos. Si llenas primero las dudosas, los desacuerdos y lo nuevo, y sorteas al final de lo que sobró, la urna (el conjunto del que sorteas, como en una rifa) ya no tiene las fotos difíciles. La muestra sale optimista.

El código lo muestra con 40 fotos. En el juguete sabemos dónde se equivocó el modelo (lo dirá la persona que etiquete); en la vida real no se sabe, y por eso se etiqueta. El juguete solo trae la confianza del top-1, sin el top-2, así que marca las dudas solo con el umbral de 0.3, sin la diferencia con el top-2. El 17 de `random.Random(17)` es la [[semilla]]: con la misma semilla sale el mismo sorteo, y así se puede repetir.

```python
import random
conf = [0.98, 0.95, 0.91, 0.22, 0.97, 0.88, 0.93, 0.61, 0.99, 0.85,   # confianza del top-1 de 40 fotos
        0.94, 0.27, 0.96, 0.79, 0.92, 0.90, 0.18, 0.97, 0.83, 0.55,
        0.95, 0.89, 0.29, 0.98, 0.93, 0.47, 0.96, 0.87, 0.91, 0.25,
        0.99, 0.94, 0.86, 0.92, 0.97, 0.90, 0.95, 0.88, 0.41, 0.93]
mal = {3, 11, 14, 16, 22, 29}                 # el modelo se equivocó (lo dirá la persona)
desacuerdo, nueva = {7, 19, 25, 2}, {38, 39}  # vendedor fuera del top-5 · «bolsas»
duda = sorted((i for i in range(40) if conf[i] < 0.3), key=lambda i: conf[i])

def urna(fotos):
    return f"{len(fotos)} fotos, el modelo acierta {sum(i not in mal for i in fotos) / len(fotos):.1%}"

print("Azar primero, de las 40:", urna(range(40)))
azar = random.Random(17).sample(range(40), 4)
print("  azar:", sorted(azar))
dificiles = set(duda) | desacuerdo | nueva
print("Azar al final, de lo que sobró:", urna([i for i in range(40) if i not in dificiles]))
print("  dudas:", duda, "· desacuerdos:", sorted(desacuerdo), "· nuevas:", sorted(nueva))
```

```salida
Azar primero, de las 40: 40 fotos, el modelo acierta 85.0%
  azar: [19, 23, 26, 33]
Azar al final, de lo que sobró: 29 fotos, el modelo acierta 96.6%
  dudas: [16, 3, 29, 11, 22] · desacuerdos: [2, 7, 19, 25] · nuevas: [38, 39]
```

De la urna completa, el modelo acierta 85 %, lo real. De lo que sobró, 96.6 %: la única foto mal que quedó es la 14, un error con confianza de 0.92 que ninguna regla atrapó. Una muestra sorteada de ahí diría que el modelo es casi perfecto.

### Cuánto mide la muestra al azar

Con 1,250 fotos al mes, la muestra al azar mide la exactitud con un margen de ≈ ± 2 puntos. Alcanza para ver si una fuente de labels se echó a perder, pero no para comparar dos modelos parecidos: para eso está el golden set, con 50,000 fotos. De dónde salen esos números está en el bloque de abajo.

:::profundo ¿Alcanzan 1,250 fotos? El margen de una muestra
¿1,250 fotos al mes alcanzan para medir? Para saberlo se usa el margen de un [[intervalo-confianza|intervalo de confianza]] del 95 %, el de «Ruido, muestras y pruebas A/B»: un rango alrededor de lo que mediste que dice cuánto podría moverse por el puro azar de qué fotos tocaron en la muestra.

:::formula Qué tan fino mide una muestra
δ = 1.96 × sqrt{frac{q × (1 − q)}{n}}
- q: la exactitud del modelo, como fracción, medida con una muestra confiable (no contra las elecciones de quien vende)
- n: las fotos de la muestra con un label confiable
- δ: el margen: si repitieras la muestra muchas veces, 95 de cada 100 intervalos de \(q − δ\) a \(q + δ\) atraparían la exactitud real. Se lee en puntos porcentuales al multiplicar por 100
- 1.96: el número de [[error-estandar|errores estándar]] (cuánto se movería lo medido de una muestra a otra) que abarca el 95 % de una [[distribucion-normal|distribución normal]]
:::

:::cuenta Qué tan fino mide cada muestra de Alba
Exactitud, \(q\) // la de Alba | dato | 0.85
Muestra al azar de un mes, \(n\) // 25 % de 5,000 | 5,000 × 0.25 | 1,250
Su margen, \(δ\) | 1.96 × √(0.85 × 0.15 ÷ 1,250) | ≈ ± 2.0 puntos
Seis meses acumulados, \(n\) | 1,250 × 6 | 7,500
Su margen, \(δ\) | 1.96 × √(0.85 × 0.15 ÷ 7,500) | ≈ ± 0.8 puntos
Golden set, \(n\) // dato de Alba | 50,000 fotos | 50,000
Su margen, \(δ\) | 1.96 × √(0.85 × 0.15 ÷ 50,000) | ≈ ± 0.3 puntos
Una categoría del golden con su piso, \(n\) // golden-v3 trae ≥ 50 fotos por categoría | ≈ 50 fotos | 50
Su margen, \(δ\) | 1.96 × √(0.85 × 0.15 ÷ 50) | ≈ ± 10 puntos
= La muestra al azar de un mes mide con ± 2 puntos: sirve para ver si una fuente de labels se echó a perder, no para comparar dos modelos que difieren en 0.3 puntos. Para eso está el golden set. Y una categoría sola, con 50 fotos, se mide con ± 10 puntos: muy grueso, y con tan pocas fotos la fórmula ya es solo aproximada.
:::

:::calculadora e01-datos-margen
Empieza con la muestra al azar de un mes. Pon 6 meses: el margen baja a ≈ ± 0.8 puntos. Pon 50 fotos y 1 mes, como una categoría del golden set: ± 10 puntos.
:::
:::

Un caso aparte es la [[categoria-nueva|categoría nueva]], como «bolsas»: tiene su cupo propio en la cola porque casi no hay labels gratis buenos para ella.

:::profundo La categoría nueva: el caso de «bolsas»
El 1 de octubre de 2026, el negocio de Alba agregó la categoría «bolsas», la número 501. El modelo de ese momento no la puede sugerir: su última [[capa]] tiene 500 salidas, una por categoría. No hay fotos etiquetadas como bolsas, y quien vende bolsas las metía antes en otra categoría parecida.

Eso es una categoría nueva, y es un caso aparte por tres razones:

- **No hay labels gratis buenos.** Las sugerencias nunca dicen «bolsas»; quien vende tiene que buscarla en el árbol, y al principio muchos ni saben que existe.
- **Se siembra a mano.** Se buscan publicaciones con «bolsa» en el título y se mandan a la cola. Su cupo, el 10 % (500 fotos), es para llegar a ≈ 200–500 fotos etiquetadas como bolsas por personas: no todo lo que dice «bolsa» en el título es una bolsa.
- **Obliga a reentrenar antes de lo planeado.** Para sugerir una categoría más hay que cambiar la última capa y entrenar con ejemplos de ella. Más ejemplos de bolsas, no un modelo más grande, es lo que la hace reconocible.

Y toca la validación: el `label_id`, el número de la categoría en los datos, desde «bolsas» va de 0 a 500, ya no de 0 a 499.
:::

### Las fotos que salen a etiquetar

Las personas que etiquetan no trabajan en Alba: es un proveedor gestionado, una empresa externa que pone a las personas y su propia herramienta. Para la ley de datos personales, es un [[encargado-tratamiento|encargado]]: trata los datos por cuenta de Alba. Las fotos de la cola salen hacia él, y una foto puede traer una cara, una casa, una placa o el GPS de donde se tomó. Por eso no salen de cualquier manera. Siguen la [[minimizacion|minimización]] de la lección «Datos personales y la ley»: solo lo necesario, solo el tiempo necesario.

:::pasos
1. Solo las de la cola
Salen las ≈ 5,000 fotos del mes, no el catálogo. El resto de las fotos nunca deja el almacén del producto.
2. Sin EXIF
Al copiarlas se quitan los metadatos: el GPS, el modelo del teléfono, la hora. Ojo con la orientación: el EXIF también dice si la foto va girada, así que antes de quitarlo se gira la imagen como debe verse, o la persona etiqueta una foto de lado.
3. A un bucket restringido
Van a `s3://ml-datos/labeled/`, un prefijo (una carpeta) de un [[bucket-restringido|bucket restringido]]: acceso público bloqueado, [[cifrado-en-reposo|cifrado]], y solo el job de etiquetado (el programa que prepara la cola y la entrega) tiene permiso de leer ese prefijo.
4. Con fecha de caducidad
Una regla de [[ciclo-vida|ciclo de vida]] borra cada copia a los 90 días. S3, el almacén de archivos de la nube de Amazon, la quita poco después de vencer, no al minuto exacto.
5. El proveedor las ve por una URL que vence
Cada foto se le da con una [[url-prefirmada|URL prefirmada]] de 15 minutos, sin el nombre de quien vende ni su publicación. La URL se firma cuando la persona abre la foto, no al mandar la cola: firmada de antemano, vencería mucho antes de que alguien la abriera.
:::

:::profundo Cuántas fotos tiene el proveedor, y a qué apunta el label
Con 5,000 fotos al mes y 90 días de vida, que son 3 meses de cola, el proveedor tiene a la vez ≈ 5,000 × 3 = 15,000 fotos de Alba. Si ese número creciera, sería una pregunta para el equipo de privacidad.

Esa copia es solo de trabajo, para el proveedor. El label que regresa apunta a la foto original, que sigue en el almacén del producto, por su llave y su SHA-256. Así, cuando la copia se borra a los 90 días, el label no se queda sin foto.
:::

Una última revisión antes de guardar los labels del mes: se cruzan los SHA-256 de las fotos de la cola con el [[manifest]] del golden set, `golden-v3`: la lista de sus fotos, cada una con su SHA-256. Si aparece una, el paso se detiene: una foto del examen no puede terminar en el entrenamiento.

## Guía, doble anotación y kappa por clase {Guidelines, double annotation and per-class kappa}

Pagar 5,000 etiquetas no sirve si cada persona entiende distinto qué es cada categoría. Esta sección es el control de calidad del etiquetado humano: con qué reglas se etiqueta, cómo se mide si las personas coinciden y quién decide cuando no.

### La guía, con versión

La [[guia-etiquetado|guía de etiquetado]] es el documento que dice qué es cada categoría: una definición que se pueda aplicar, ejemplos y contraejemplos, los casos límite decididos por escrito y una salida «no sé / otro», para que nadie invente cuando no puede decidir. Algunos casos límite de la guía de Alba:

- **Una foto con varios productos:** manda el principal, el que ocupa la foto.
- **Un producto en su caja:** se etiqueta el producto, no la caja.
- **Tenis contra zapatos de vestir:** la guía da ejemplos de cada uno y de los que están en medio.

Y tiene versión. En noviembre de 2026 la vigente es `guia-v4`, y **cada label guarda la versión de la guía con que se hizo**, en la columna `guia_version`. Así, si `guia-v5` cambia una regla (por ejemplo, dónde van los tenis de vestir), sabes qué labels se hicieron con la regla vieja y puedes revisarlos o pesarlos distinto.

### Doble anotación y adjudicación

El 10 % de la cola, 500 fotos, lo etiquetan dos personas distintas, sin que ninguna sepa que la otra etiqueta la misma foto. Es la [[doble-anotacion|doble anotación]]. Sin ella no hay forma de saber si la guía se entiende igual: con una sola persona por foto, un desacuerdo nunca se ve.

Cuando las dos personas no coinciden, alguien decide. Es la [[adjudicacion|adjudicación]]: en Alba, 2 personas expertas del equipo de moderación resuelven cada desacuerdo en hasta 3 días hábiles. Lo que deciden hace dos cosas: fija el label de esa foto y, si el caso era confuso, **se vuelve un ejemplo de la guía siguiente**. Así la guía aprende de sus propios huecos.

:::profundo Preguntas de control: medir a cada persona
Además, el proveedor recibe ≈ 250 [[preguntas-control|preguntas de control]] (*gold questions*) al mes, ≈ 5 % de lo que etiqueta: fotos del golden set, con respuesta conocida, mezcladas sin aviso. Van **encima** de las ≈ 5,000 de la cola, y su costo, 250 × 5–10 ¢ ≈ US$13–25, se paga aparte. Miden a **cada persona** que etiqueta, no a la guía: si alguien falla muchas, se revisa su trabajo del mes. Esas fotos no se vuelven labels nuevos: ya tienen el suyo, y si entraran al entrenamiento, el golden set dejaría de ser un examen limpio. Por eso se marcan y se sacan antes del cruce de SHA-256 contra el golden.
:::

### Por qué el acuerdo bruto no basta

La primera medida que se le ocurre a uno es el **acuerdo bruto**: en qué fracción de las fotos dobles coinciden las dos personas. Con 500 categorías tiene dos problemas.

El primero: coincidir en lo fácil no cuesta nada. Por eso se usa la [[kappa]], que descuenta el azar.

El segundo es nuevo: **un solo número esconde la categoría que falla**. Si dos personas coinciden en 83 % de las fotos, puede ser que coincidan casi siempre en tenis y botas, y casi nunca en zapatos de vestir. El número global se ve bien, y la guía de zapatos de vestir está rota.

### La kappa por clase

La salida es la [[kappa-por-clase|kappa por clase]]: una kappa para cada categoría, convirtiendo el problema en «esta categoría contra todas las demás». Para la categoría \(k\), cada foto doble se vuelve un sí o no: ¿esta persona dijo \(k\)? Con eso aplica la misma fórmula de Cohen de dos opciones:

:::formula Kappa de una categoría contra el resto
p_A = frac{N_A}{N}
p_B = frac{N_B}{N}
p_o = frac{N_{ambas} + N_{ninguna}}{N}
p_e = p_A × p_B
+ (1 − p_A) × (1 − p_B)
κ_k = frac{p_o − p_e}{1 − p_e}
- k: la categoría que mides, como «zapatos de vestir»
- N: las fotos con doble anotación
- N_A, N_B: las fotos en que la persona A, o la persona B, dice \(k\)
- N_{ambas}: las fotos en que **las dos** personas dicen \(k\)
- N_{ninguna}: las fotos en que **ninguna** dice \(k\); son \(N − (N_A + N_B − N_{ambas})\)
- p_A, p_B: la fracción de las \(N\) fotos en que la persona A, o la B, dice \(k\)
- p_o: el acuerdo observado sobre «\(k\) o no \(k\)»
- p_e: el acuerdo que tendrían por puro azar, cada una con su propia fracción: que las dos digan \(k\) por casualidad (\(p_A × p_B\)) o que ninguna lo diga (\((1 − p_A) × (1 − p_B)\))
- κ_k: la kappa de la categoría \(k\): 1 es acuerdo perfecto; 0, lo mismo que el azar
:::

Toma 30 fotos dobles de calzado. En 25 coinciden: 12 tenis, 6 botas, 5 sandalias y 2 zapatos de vestir. En las otras 5 no: 2 veces A dijo tenis y B zapatos, 2 veces al revés, y 1 vez A dijo botas y B zapatos. El acuerdo bruto es 25 ÷ 30 ≈ 83 %. Ahora, la kappa de zapatos de vestir:

:::cuenta La kappa de «zapatos de vestir» en 30 fotos dobles
Fotos dobles, \(N\) | 25 en que coinciden + 5 en que no | 30
Las dos dicen zapatos, \(N_{ambas}\) | las 2 en que coinciden en zapatos | 2
A dice zapatos, \(N_A\) | 2 en que coinciden + 2 en que B dijo tenis | 4
B dice zapatos, \(N_B\) | 2 en que coinciden + 2 en que A dijo tenis + 1 en que A dijo botas | 5
Alguna dice zapatos, \(N_A + N_B − N_{ambas}\) // las 2 en que coinciden están en \(N_A\) y en \(N_B\) | 4 + 5 − 2 | 7
Ninguna dice zapatos, \(N_{ninguna}\) | 30 − 7 | 23
Acuerdo observado, \(p_o\) | \(p_o = (N_{ambas} + N_{ninguna})/N\) = (2 + 23) ÷ 30 | ≈ 0.833
Fracciones, \(p_A\) y \(p_B\) | \(N_A/N\) y \(N_B/N\) = 4 ÷ 30 y 5 ÷ 30 | ≈ 0.133 y ≈ 0.167
Acuerdo por azar, \(p_e\) | 0.133 × 0.167 + 0.867 × 0.833 | ≈ 0.744
Kappa, \(κ_k\) | \(κ_k = (p_o − p_e)/(1 − p_e)\) = (0.833 − 0.744) ÷ (1 − 0.744) | ≈ 0.35
= Con 83 % de acuerdo, la kappa de zapatos de vestir es ≈ 0.35: de las 7 veces que alguna dijo «zapatos», coincidieron en 2. La guía de esa categoría no funciona.
:::

El código calcula la kappa de cada clase con las mismas 30 fotos, y la kappa **global**, la de todas las categorías juntas. La global usa la misma \(κ = (p_o − p_e)/(1 − p_e)\), pero con \(p_o\) = el acuerdo bruto (25 ÷ 30) y el azar sumado sobre las categorías: \(p_e = Σ_k p_A × p_B\), con \(p_A\) y \(p_B\) de cada categoría \(k\). Es la probabilidad de que las dos digan la misma categoría por casualidad.

```python
from collections import Counter
pares = ([("Tenis", "Tenis")] * 12 + [("Botas", "Botas")] * 6 + [("Sandalias", "Sandalias")] * 5
         + [("Zapatos", "Zapatos")] * 2 + [("Tenis", "Zapatos")] * 2 + [("Zapatos", "Tenis")] * 2
         + [("Botas", "Zapatos")] * 1)            # (persona A, persona B) en 30 fotos dobles
N = len(pares)
print(f"acuerdo bruto: {sum(x == y for x, y in pares) / N:.1%} en {N} fotos")

def kappa_clase(k):                               # «k contra el resto»: un problema de sí o no
    ambas = sum(x == k and y == k for x, y in pares)    # N_ambas
    ninguna = sum(x != k and y != k for x, y in pares)  # N_ninguna
    pA = sum(x == k for x, _ in pares) / N
    pB = sum(y == k for _, y in pares) / N
    po, pe = (ambas + ninguna) / N, pA * pB + (1 - pA) * (1 - pB)
    return (po - pe) / (1 - pe)

for k in ["Tenis", "Botas", "Sandalias", "Zapatos"]:
    print(f"{k:10} kappa = {kappa_clase(k):.2f}")
cA, cB = Counter(x for x, _ in pares), Counter(y for _, y in pares)
pe = sum(cA[k] * cB[k] for k in cA) / N**2        # azar: las dos dicen la misma clase
po = sum(x == y for x, y in pares) / N
print(f"kappa global = {(po - pe) / (1 - pe):.2f}")
```

```salida
acuerdo bruto: 83.3% en 30 fotos
Tenis      kappa = 0.73
Botas      kappa = 0.90
Sandalias  kappa = 1.00
Zapatos    kappa = 0.35
kappa global = 0.76
```

La kappa global, 0.76, no se ve alarmante, aunque queda abajo del 0.8 que pide Alba. La de zapatos, 0.35, dice dónde arreglar la guía.

### Las reglas de Alba, y el problema de los pocos casos

Alba pide dos cosas (umbrales que fijó su equipo; la escala con que se leen las kappas es una convención, no una ley):

- **Global:** kappa ≥ 0.8 cada mes.
- **Por clase:** una alerta si la kappa de una categoría baja de 0.6, **pero solo cuando esa categoría ya junta al menos 30 casos dobles**.

¿Por qué ese «al menos 30»? Haz la cuenta: 500 fotos dobles al mes entre 500 categorías son 500 ÷ 500 ≈ 1 foto doble por categoría al mes. Con una foto no hay kappa. Una categoría promedio tardaría ≈ 30 meses en juntar 30. Así que la kappa por clase se mide de dos maneras: **acumulando meses** en las categorías grandes, que reciben más fotos dobles porque tienen más tráfico, y **en los pares que se confunden**, como tenis contra zapatos de vestir, juntando a propósito fotos de los dos lados.

:::profundo La herramienta no calcula el acuerdo por ti
Muchas herramientas de etiquetado, sobre todo en sus versiones gratis, no asignan la misma foto a dos personas ni calculan la kappa. El camino común es exportar las etiquetas a un archivo y calcularla con un programa propio, como el de arriba, o con una biblioteca de Python para ML como scikit-learn (`cohen_kappa_score`). Lo que no se automatiza, no se mide cada mes.
:::

## El contrato de datos: bloquear o avisar {Data contracts: block or warn}

Todo lo anterior supone que los datos llegan bien. A veces no: un equipo cambia una columna, un job corre dos veces, un archivo exportado sale con la hora local. Si eso llega al entrenamiento, el modelo nuevo aprende de datos rotos, y quizás nadie lo note hasta que falla con la gente.

### El contrato

Un [[contrato-datos|contrato de datos]] (*data contract*) es el acuerdo, escrito y ejecutable, de cómo deben venir unos datos: qué columnas, de qué tipo, en qué rango, con qué frescura (qué tan nuevos deben ser), y quién es su dueño. «Ejecutable» quiere decir que no vive solo en un documento: es código que corre sobre cada [[particion-datos|partición]] (cada día del log, cada snapshot) y dice si la cumple.

Las [[prueba-datos|pruebas de datos]] de «Pruebas y CI/CD», revisiones automáticas de un lote de datos antes de usarlo, son sus ladrillos. El contrato agrega dos cosas: **quién responde** cuando falla y **qué pasa** cuando falla.

En Alba, el backend de publicaciones es el dueño de los eventos `suggestion_shown` y `category_selected`. Su [[esquema-datos|esquema]] (la lista de columnas con su tipo) tiene versión, y un cambio que rompe se avisa con 2 semanas. Lo ideal es que el mismo chequeo corra también **del lado de quien produce**, en sus pruebas automáticas: así el cambio que rompe se detiene antes de salir.

### Los chequeos de Alba

| Chequeo | Qué revisa |
|---|---|
| Esquema | Exactamente las columnas esperadas, con su tipo; las horas, en UTC |
| Rango | `label_id` entre 0 y 499 (0 y 500 desde «bolsas») |
| Tamaño | Ancho y alto de cada foto, ≥ 64 px (píxeles) |
| Unicidad | Ningún `image_sha256` (la huella de la foto) repetido, y ninguno en dos [[split\|splits]] (train y validación) |
| Golden | Ninguna huella de `golden-v3` (también se cruza al guardar los labels de la cola) |
| Volumen | Entre 0.8 y 1.5 veces las filas del snapshot anterior |
| Frescura | El dato más nuevo, de hace menos de 48 h |
| Mezcla | Labels débiles, ≤ 80 % del total; aquí «débiles» son los de quien vende (`vendedor_filtrado`): el 72 % |

Esquema, rango, volumen y frescura ya los viste en «Pruebas y CI/CD»; aquí se juntan en un contrato con dueño. El de volumen merece su ecuación, porque es el que atrapa lo que ningún otro ve: que se perdieron o se duplicaron filas en un join.

:::formula El chequeo de volumen
v = frac{R_{nuevo}}{R_{antes}}
- R_{nuevo}: las filas del snapshot que se está armando
- R_{antes}: las filas del snapshot del mes anterior
- v: la razón entre los dos, sin unidad. Alba bloquea si \(v\) < 0.8 o \(v\) > 1.5
:::

El snapshot de septiembre trajo 1,932,628 filas. Para que el de octubre pase, tiene que traer entre 1,932,628 × 0.8 ≈ 1,546,102 y 1,932,628 × 1.5 = 2,898,942. Si el `request_id` cambió de formato y el join perdió la mitad, \(v\) ≈ 0.5 y se detiene.

### Bloquea o avisa

Un [[chequeo-bloqueante|chequeo que bloquea]] detiene el pipeline: no se entrena y sigue el modelo actual. Uno que avisa deja seguir y manda una alerta a una persona. La pregunta para decidir es: **¿este error invalida el modelo, o solo es raro?**

- **Bloquean:** esquema roto, labels fuera de rango, una foto en dos splits, volumen fuera de 0.8–1.5, datos viejos y labels débiles por encima de 80 %. Cualquiera de esos hace que el modelo aprenda o se mida mal.
- **Avisan:** una categoría que creció más de 30 % (puede ser una campaña real), o un [[slice]] (un pedazo de los datos que se mide aparte, como una categoría) que quedó con menos fotos que su piso. Hay que mirarlo, pero no es seguro que esté mal. Y, como supuesto de esta lección, una foto de menos de 64 px: se saca esa fila y se avisa.

Y una regla de oficio, como viste en «Pruebas y CI/CD»: **todo chequeo nuevo empieza avisando**. Un umbral que nunca has visto correr con datos reales puede estar mal puesto; si bloquea desde el día uno, detienes el entrenamiento por un [[falso-positivo|falso positivo]]: una alarma sin nada roto. Lo dejas avisar unas semanas, ves cuántas veces salta y luego lo vuelves bloqueante.

El código corre el contrato sobre una partición de juguete del snapshot de septiembre, con 6 filas y unas columnas de su manifest, la lista de fotos del snapshot. El snapshot anterior traía 7 filas. Necesita Python 3.11 o más nuevo, por cómo lee las horas con «Z».

```python
import csv, io
from datetime import datetime, timezone
datos = """image_sha256,seller_id,label_id,label_source,split,width,height,created_at
a1f3,ana-48213,17,vendedor_filtrado,train,1080,1080,2026-09-29T21:04:11Z
b7c2,beto-30117,233,moderador,train,800,600,2026-09-29T22:15:40Z
c9d0,caro-55120,512,humano,train,1200,900,2026-09-30T09:02:03Z
d4e8,dani-71002,233,vendedor_filtrado,val,48,48,2026-09-30T10:30:00Z
a1f3,eli-11873,17,vendedor_filtrado,val,1080,1080,2026-09-30 04:30:00
e2b6,fer-90421,88,vendedor_filtrado,train,640,640,2026-09-30T12:00:00Z"""
filas = list(csv.DictReader(io.StringIO(datos)))
esperadas = "image_sha256,seller_id,label_id,label_source,split,width,height,created_at".split(",")
ahora, bloquea = datetime(2026, 10, 1, 3, 0, tzinfo=timezone.utc), []
if list(filas[0]) != esperadas: bloquea.append("esquema distinto")
bloquea += [f"label_id {f['label_id']} fuera de 0–499" for f in filas if not 0 <= int(f["label_id"]) <= 499]
bloquea += [f"{f['image_sha256']} en dos splits" for f in filas if f["split"] == "val"
            and any(g["image_sha256"] == f["image_sha256"] and g["split"] == "train" for g in filas)]
bloquea += [f"esquema: hora sin zona {f['created_at']}" for f in filas if not f["created_at"].endswith("Z")]
v = len(filas) / 7                                  # el snapshot anterior traía 7 filas
if not 0.8 <= v <= 1.5: bloquea.append(f"volumen {v:.2f} veces el anterior")
debiles = sum(f["label_source"] == "vendedor_filtrado" for f in filas) / len(filas)
ultima = max(datetime.fromisoformat(f["created_at"]) for f in filas if f["created_at"].endswith("Z"))
if (ahora - ultima).total_seconds() > 48 * 3600: bloquea.append("datos de hace más de 48 h")
if debiles > 0.8: bloquea.append(f"labels débiles {debiles:.0%}")
avisa = [f"{f['image_sha256']} mide {f['width']} px: fila fuera"
         for f in filas if min(int(f["width"]), int(f["height"])) < 64]
print("BLOQUEA:", bloquea); print("AVISA:", avisa)
print(f"v = {v:.2f} · débiles {debiles:.0%} · último dato hace {(ahora - ultima).total_seconds() / 3600:.0f} h")
```

```salida
BLOQUEA: ['label_id 512 fuera de 0–499', 'a1f3 en dos splits', 'esquema: hora sin zona 2026-09-30 04:30:00']
AVISA: ['d4e8 mide 48 px: fila fuera']
v = 0.86 · débiles 67% · último dato hace 15 h
```

Tres fallas bloquean. Un `label_id` de 512 no existe. La foto `a1f3` está en train (publicada por Ana) y en validación (otra cuenta la volvió a subir): el modelo vería en el examen una foto que ya estudió, un [[leakage]]. Y una hora sin la «Z» de UTC: no se sabe si es de la Ciudad de México o de un servidor en Virginia, en Estados Unidos. La foto de 48 px solo se saca y avisa: es una fila mala, no un lote malo (esa decisión es un supuesto de esta lección). Volumen, frescura y mezcla pasan.

### Dónde se revisa

No hay un solo lugar: hay cuatro, y cada uno atrapa algo distinto.

:::diagrama e01-datos-validacion
De la llegada de cada partición al modelo nuevo: dónde se atrapa cada dato roto. Toca cada punto; el recorrido sigue una partición rota.
:::

- **Al entrar:** cada partición nueva (un día de log, un lote de correcciones) se revisa al llegar. Si falla, va a [[cuarentena-datos|cuarentena]]: se aparta en un lugar donde nada la lee, y se avisa a su dueño. Las demás particiones siguen.
- **El día 1, al armar el snapshot**, en tres momentos. Antes de armar, sobre los labels del mes: esquema, rango, UTC y frescura. Al armar: el corte, la regla de 30 días y los duplicados por huella. Ya armado, antes de entrenar: los dos splits, el golden, el volumen y los débiles. Aquí sí se **bloquea**: si falla, no se entrena y sigue el modelo actual.
- **En [[serving]]** (cuando el modelo ya atiende a la gente): el servicio rechaza en la puerta lo que no es una foto válida. Responde 415 si no dice ser JPEG, PNG ni WebP, 413 si pasa de 10 MB y 400 si la request está mal o la foto no se puede leer ([[codigo-estado|códigos de estado]] de HTTP).
- **Después de entrenar:** el examen del modelo nuevo contra el actual (el *gate*), que cuenta «Gate de evaluación y registry». Si los datos se colaron rotos, aquí se nota en el modelo.

La cuarentena es mejor que borrar: la partición sigue ahí para investigar, y si el dueño la corrige, se vuelve a revisar y entra. Y es mejor que dejarla pasar, porque nadie entrena con un día roto sin saberlo.

## El reporte del mes y las fallas con historia {The monthly report and failures with a story} [extra]

La estación cierra con un reporte. No es un trámite: es lo que deja ver, mes a mes, si las fuentes de labels se están echando a perder.

### La exactitud de cada fuente

Con la muestra al azar de la cola, ya etiquetada por personas y adjudicada, se mide qué tan seguido acierta cada fuente de labels en esas mismas fotos. Para Alba (un supuesto del curso, porque nadie publica estos números):

| Fuente | Aciertan | Se equivocan |
|---|---|---|
| Elección de quien vende, sin filtrar | ≈ 90 % | ≈ 10 % |
| Quien vende, filtrada (madura, 30 días) | ≈ 95 % | ≈ 5 % |
| Moderación | ≈ 97 % | ≈ 3 % |
| Cola humana, adjudicada | ≈ 98 % | ≈ 2 % |

El filtro de maduración, por sí solo, parte a la mitad el error de la fuente más grande: de ≈ 10 % a ≈ 5 %.

¿Cuántos labels malos trae entonces el snapshot? Depende de cuánto pesa cada fuente:

:::formula El error de una mezcla de fuentes
E = sum_{i} w_i × e_i
F = E × R
- i: cada fuente de labels: \(vende\) (quien vende, filtrada), \(mod\) (moderación) y \(cola\) (la cola humana)
- w_i: la fracción del snapshot que viene de la fuente \(i\); todas suman 1
- e_i: la fracción de los labels de la fuente \(i\) que están mal. Es la misma idea que \(e_{sug}\) del feedback loop: \(e_{sug}\) es el error de la elección sin filtrar; \(e_{vende}\), el de la filtrada
- E: la fracción de labels mal en todo el snapshot
- R: las filas del snapshot (la misma \(R\) del chequeo de volumen)
- F: cuántos labels mal trae el snapshot
:::

:::cuenta Labels mal en el snapshot de septiembre
Quien vende, filtrada, \(w_{vende} × e_{vende}\) // 72 % del snapshot, 5 % mal | 0.72 × 0.05 | 0.036
Moderación, \(w_{mod} × e_{mod}\) // 7 %, 3 % mal | 0.07 × 0.03 | 0.0021
Cola humana, \(w_{cola} × e_{cola}\) // 21 %, 2 % mal | 0.21 × 0.02 | 0.0042
Error de la mezcla, \(E\) | 0.036 + 0.0021 + 0.0042 | 0.0423, ≈ 4.2 %
Filas del snapshot, \(R\) // ds-2026-09-01 | 1,840,211 de train + 92,417 de validación | 1,932,628
Labels mal, \(F\) | \(F = E × R\) = 0.0423 × 1,932,628 | ≈ 81,750
= Uno de cada ≈ 24 labels del snapshot está mal, y casi todo ese error (0.036 de 0.0423) viene de quien vende. Sin el filtro de maduración, con 10 % de error en esa fuente, serían ≈ 7.8 %: casi el doble.
:::

:::calculadora e01-datos-mezcla
Empieza con el snapshot de septiembre. Sube el error de quien vende a 10 %, como si no hubiera filtro: el error total casi se duplica. Luego baja la parte de quien vende a 50 %: la cola humana sube sola, como lo que falta para 100 %. Es más limpio, pero cada punto de cola humana cuesta dinero.
:::

Un detalle de la tabla: el 21 % de la cola humana del snapshot de septiembre son 0.21 × 1,932,628 ≈ 405,852 fotos. A ≈ 5,000 al mes serían casi 7 años de cola. No salen solo de la cola: ≈ 345 mil vienen de un proyecto inicial de etiquetado con el proveedor, en 2025, y ≈ 60 mil de 12 meses de cola (un supuesto del curso). Y el golden set no entra: es solo examen.

Y un riesgo que conviene nombrar: el 72 % de los labels lo pone quien vende. Alguien que quisiera dañar el modelo podría publicar muchas fotos con la categoría equivocada a propósito. Eso es [[envenenamiento-datos|envenenar los datos]]. La maduración, el tope de 80 % de labels débiles y el examen contra el golden set, adjudicado por moderación, son parte de la defensa.

Para practicar esta sección, con lápiz:

:::ejercicios
? [medio] El error de un snapshot que mezcla fuentes es \(E = Σ w_i × e_i\): cada fuente \(i\) aporta su parte del snapshot, \(w_i\), por la fracción de sus labels que están mal, \(e_i\). Los labels mal son \(F = E × R\), con \(R\) las filas. Si Alba no aplicara la regla de maduración, la fuente de quien vende tendría ≈ 10 % de error en vez de 5 %. Con las partes del snapshot de septiembre (72 % de quien vende, 7 % de moderación y 21 % de la cola humana), el error de las otras dos (3 % y 2 %) y \(R\) = 1,932,628 filas, ¿cuánto sería \(E\) y cuántos labels mal traería el snapshot?
- \(E = Σ w_i × e_i\) = 0.72 × 0.10 + 0.07 × 0.03 + 0.21 × 0.02 = 0.072 + 0.0021 + 0.0042 = **0.0783**, o ≈ 7.8 %.
- \(F = E × R\) = 0.0783 × 1,932,628 ≈ **151,325 labels mal**.
- Con el filtro eran ≈ 81,750: la regla de 30 días quita ≈ 69,575 labels malos, casi la mitad.
:::

### Fallas con historia

Las fallas de esta estación casi nunca dan un error. Cuatro que vale la pena reconocer:

- **El formulario nuevo.** El equipo de producto rediseña la pantalla y deja la primera sugerencia ya marcada. La gente acepta más, \(c\) baja, y la exactitud medida contra quien vende sube sola. Nada mejoró. Lo delata el holdout, que sigue igual, y la muestra al azar.
- **El `request_id` con otro formato.** El backend empieza a guardarlo distinto. El join encuentra menos filas, los labels del mes salen con menos fotos y no hay error. Lo detienen el conteo de filas y el chequeo de volumen.
- **El export con hora local.** Un lote de correcciones llega con la hora de la Ciudad de México y sin zona. La regla de 30 días se calcula 6 horas corrida, y una corrección puede quedar del lado equivocado de la fecha de corte. Lo detiene el chequeo de esquema, que exige UTC.
- **Fotos de prueba en el golden.** Alguien de calidad (QA, *quality assurance*) sube fotos de prueba que ya estaban en el golden set, y terminan como publicaciones. El cruce de SHA-256 contra `golden-v3` las atrapa antes de que entren al entrenamiento.

## Errores comunes {Common mistakes}

:::ojo
**Medir el modelo con las elecciones de quien vende.** Salen optimistas por el feedback loop: con los números de Alba, 95 % en vez de 85 %. Evítalo: mide con el golden set y con la muestra al azar, y usa el holdout para saber cuánto empuja la sugerencia.
:::

:::ojo
**Sortear la muestra al azar al final.** Si primero llenas los cupos de dudas y desacuerdos, la urna ya no tiene lo difícil y la muestra sale optimista. Evítalo: sortea primero, de todas las fotos del mes, y fija la [[semilla]] para poder repetirlo.
:::

:::ojo
**Unir sin contar filas.** Un join con varias correcciones por publicación multiplica las fotos; una llave que cambió de formato las pierde. Ninguna da error. Evítalo: quédate con la corrección más reciente antes de unir, y guarda cuántas filas entran y salen de cada paso, con el chequeo de volumen al final.
:::

:::ojo
**Entrenar con labels que todavía no maduran.** La elección de ayer todavía puede corregirse. Evítalo: aplica la regla de los 30 días, y cuenta los días en UTC.
:::

:::ojo
**Mirar solo la kappa global.** Un 0.76 global puede esconder una categoría en 0.35. Evítalo: kappa por clase, acumulando meses en las grandes y juntando a propósito los pares que se confunden.
:::

:::ojo
**Mandar las fotos al proveedor tal cual.** Con EXIF viajan el GPS y la hora; sin fecha de caducidad se quedan para siempre. Evítalo: solo la cola, sin EXIF (girando antes la imagen), a un bucket restringido con ciclo de vida de 90 días y URLs que vencen.
:::

:::ojo
**Hacer bloqueante un chequeo recién inventado.** Un umbral sin probar detiene el entrenamiento por un falso positivo. Evítalo: que avise unas semanas y después que bloquee.
:::

## En la vida real {In real life} [extra]

### En Alba

Cada mes, el día 1 a las 03:00 UTC, un programa que ordena los pasos del pipeline arranca la estación, que arma los labels del mes que acaba de terminar: el 1 de octubre, los del snapshot de septiembre. Une un mes de log con las publicaciones y las correcciones, aplica la regla de 30 días, revisa el contrato y entrega los labels a la estación siguiente. De ≈ 75 millones de publicaciones al mes no se entrena con todas: el snapshot es el conjunto acumulado, con todos los labels humanos (≈ 406 mil, 21 %), todas las correcciones de moderación (≈ 135 mil, 7 %) y una muestra de ≈ 1.39 millones de labels maduros de quien vende (72 %), con tope por categoría y por vendedor. Los labels del mes son lo que se agrega o se renueva ese mes. La cola del mes corre en paralelo: se sortea, se manda al proveedor, vuelve en ≈ 5 días hábiles, se adjudica en hasta 3 y se cruza con el golden. El reporte de cada mes dice la kappa por clase y cuánto acierta cada fuente.

Nada de esto es glamoroso. Pero cada pieza evita algo concreto: el join correcto evita fotos duplicadas, la maduración evita labels que iban a cambiar, la muestra al azar evita medir solo lo difícil, el holdout evita que el modelo se califique a sí mismo y el contrato evita entrenar con un día roto.

### Otros sistemas, otros labels gratis

- **Recomendación.** El label gratis es el clic. Pero la gente le da clic a lo que está arriba, y lo de arriba lo puso el modelo: el mismo feedback loop, con el nombre de sesgo de posición. Solo existen clics de lo que se mostró, así que el sistema tiene que guardar también qué se mostró y en qué lugar, como el `suggestion_shown` de Alba. Y el label tarda: una compra puede llegar un día después del clic.
- **Fraude en pagos.** El label es el contracargo, cuando el dueño de la tarjeta desconoce un cargo y el banco lo revierte: llega semanas o meses después. Y solo se conoce para los pagos que se aprobaron: los que el modelo bloqueó nunca sabrán si eran fraude. Es sesgo de selección puro. Por eso algunos sistemas dejan pasar, a propósito, una fracción muy chica de pagos dudosos para medir.
- **Lectura de documentos (OCR).** Las personas corrigen el resultado solo cuando la confianza del modelo está por debajo de un umbral. Las correcciones existen solo ahí. La única medición sin sesgo es una revisión ciega de una muestra al azar de todo, adjudicada.
- **Inspección visual en una fábrica.** El inspector marca cada pieza con un toque en una tablet. Si la tablet le muestra antes lo que dijo el modelo, el inspector tiende a coincidir: anclaje, otra forma del feedback loop. Una solución es ocultar la sugerencia en una parte de las piezas, que funciona como el holdout de Alba.

### Fuera de ML

Un maestro que califica exámenes con la respuesta del alumno a la vista tiende a ver lo que el alumno escribió. Por eso en muchos exámenes importantes se califica a ciegas, con dos correctores y un tercero para los desacuerdos: doble anotación y adjudicación, con otro nombre. Y las encuestas de satisfacción que solo contestan los clientes muy enojados o muy contentos son sesgo de selección: existen solo donde alguien quiso responder.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(q\), \(c\), \(e_{sug}\), \(q_{med}\) (feedback loop); \(δ\), \(n\) (margen); \(R\) (filas del snapshot); las \(N\), \(p_A\), \(p_B\), \(p_o\), \(p_e\), \(κ_k\) (kappa); \(v\) (volumen). Son conteos \(n\) (fotos de una muestra), las \(N\) (fotos con doble anotación) y \(R\); las demás son fracciones, y \(v\), una razón.

:::ejercicios
? [facil] El holdout de Alba es ≈ 1 % de las cuentas de vendedor. Con ≈ 2.5 millones de publicaciones al día, ¿cuántas publicaciones trae al día y en un mes de 30 días? ¿Por qué se elige por un hash del `seller_id` y no sorteando cada publicación?
- Publicaciones del holdout = publicaciones al día × fracción de cuentas en el holdout.
- Al día: 2,500,000 × 0.01 = **25,000 publicaciones**.
- Al mes: 25,000 × 30 = **750,000**.
- Por hash, una cuenta está siempre del mismo lado. Si se sorteara cada publicación, la misma persona vería sugerencias en unas y no en otras, y su forma de elegir a mano se contaminaría con lo que vio antes. El holdout dejaría de ser «gente que nunca vio una sugerencia».
? [facil] La publicación 9001 tiene 3 fotos y 2 correcciones de moderación; la 9002 tiene 2 fotos y ninguna corrección. ¿Cuántas filas da un LEFT JOIN directo de las fotos con las correcciones? ¿Y quedándose antes con la corrección más reciente? ¿Qué label tienen las fotos de la 9002?
- Filas de una publicación en el join directo = fotos × correcciones (o sus fotos, si no tiene correcciones y el join es LEFT).
- Directo: la 9001 da 3 × 2 = 6 filas; la 9002 conserva sus 2 fotos con la corrección vacía, porque es LEFT JOIN. Total: **8 filas** para 5 fotos.
- Con la más reciente: 3 + 2 = **5 filas**, una por foto.
- La 9002 no tiene corrección: su label es la elección de quien vende, **si ya pasaron 30 días** sin corrección. Si no, todavía no tiene label.
? [facil] Con la regla de 30 días, ¿cuáles de estas elecciones de quien vende, todas sin corrección, entran al snapshot de septiembre, `ds-2026-09-01`, que arma la corrida del 1 de octubre de 2026? (a) Publicada el 20 de agosto. (b) El 5 de septiembre. (c) El 1 de septiembre.
- Cuenta los días, por fecha y en UTC, hasta el 1 de octubre.
- (a) Del 20 de agosto al 1 de octubre son 42 días: **entra**, como `vendedor_filtrado`.
- (b) Del 5 de septiembre son 26 días: **no entra**; madura el 5 de octubre y entra en el snapshot de octubre, `ds-2026-10-01`, que se arma el 1 de noviembre.
- (c) Del 1 de septiembre son justo 30 días: **entra**. Por eso las elecciones que entran al snapshot de septiembre llegan hasta el 1 de septiembre.
? [facil] Reparte la cola de Alba de ≈ 5,000 fotos con su mezcla (25 % azar, 40 % incertidumbre, 25 % desacuerdos, 10 % categorías nuevas). ¿Cuántas fotos dobles hay al mes, y cuántas tocan a cada categoría en promedio?
- Fotos de cada parte = 5,000 × su porcentaje.
- Azar: 5,000 × 0.25 = **1,250**. Incertidumbre: 5,000 × 0.40 = **2,000**. Desacuerdos: **1,250**. Nuevas: 5,000 × 0.10 = **500**. Suman 5,000.
- Dobles: 10 % de 5,000 = **500**.
- Por categoría: 500 ÷ 500 ≈ **1 al mes**. Con eso no hay kappa por clase de un solo mes.
? [medio] Otro modelo tiene exactitud real \(q\) = 0.80, y la gente corrige \(c\) = 25 % de sus errores. ¿Qué fracción de las elecciones queda mal, y qué exactitud mides contra ellas? Compara con el modelo de Alba (\(q\) = 0.85, \(c\) ≈ 0.33). ¿Qué te dice?
- \(e_{sug} = (1 − q) × (1 − c)\) = 0.20 × 0.75 = **0.15**.
- \(q_{med} = q + e_{sug}\) = 0.80 + 0.15 = **0.95**.
- El de Alba también mide 0.95: 0.85 + 0.10. Dos modelos que difieren 5 puntos de verdad dan el **mismo** número medido contra las elecciones de quien vende. Ese número no sirve para compararlos: hace falta una fuente que el modelo no influyó, como el holdout, o el golden set.
? [medio] El margen de una muestra de \(n\) fotos, con exactitud \(q\), es \(δ = 1.96 × √(q(1 − q)/n)\). La muestra al azar de la cola mide con ± 2 puntos en un mes. ¿Cuántas fotos hacen falta para medir con ± 1 punto, si \(q\) ≈ 0.85? ¿Cuántos meses de muestra al azar son?
- Despeja \(n\) de \(δ = 1.96 × √(q(1 − q)/n)\): \(n = 1.96^2 × q × (1 − q) ÷ δ^2\).
- \(n\) = 3.8416 × 0.85 × 0.15 ÷ 0.01² = 0.4898 ÷ 0.0001 ≈ **4,898 fotos**.
- A 1,250 por mes: 4,898 ÷ 1,250 ≈ 3.9, así que **4 meses**. Con 4 meses, \(n\) = 5,000 y \(δ\) ≈ ± 0.99 puntos.
- Para bajar el margen a la mitad hace falta 4 veces la muestra: \(δ\) va con 1 entre la raíz de \(n\).
? [medio] El snapshot de octubre sale con 1,016,000 filas; el de septiembre tenía 1,932,628. ¿Pasa el chequeo de volumen? ¿Qué buscarías primero, y qué modelo atiende a la gente mientras tanto?
- \(v = R_{nuevo} ÷ R_{antes}\) = 1,016,000 ÷ 1,932,628 ≈ **0.53**, menor que 0.8: **bloquea**.
- Primero, los conteos de filas de cada paso: en qué join se perdió casi la mitad. Una llave como el `request_id` que cambió de formato da justo eso: el join encuentra menos filas y no da error.
- Mientras tanto no se entrena, y **sigue el modelo actual**. Bloquear no apaga nada: solo detiene el modelo nuevo.
? [reto] Una categoría nueva, «bolsas», junta 40 fotos dobles en su cuarto mes. La persona A dijo «bolsas» en 8; la B, en 9; las dos coincidieron en 6. Calcula \(κ_k\) de «bolsas contra el resto». ¿Salta la alerta de Alba? ¿Ya cuenta para la alerta?
- La ecuación: \(κ_k = (p_o − p_e)/(1 − p_e)\), con \(p_o = (N_{ambas} + N_{ninguna})/N\) y \(p_e = p_A × p_B + (1 − p_A) × (1 − p_B)\).
- \(N\) = 40, \(N_A\) = 8, \(N_B\) = 9, \(N_{ambas}\) = 6. Las que tocan «bolsas» son 8 + 9 − 6 = 11, así que \(N_{ninguna}\) = 40 − 11 = 29.
- \(p_o\) = (6 + 29) ÷ 40 = **0.875**.
- \(p_A = N_A/N\) = 8 ÷ 40 = 0.2; \(p_B = N_B/N\) = 9 ÷ 40 = 0.225.
- \(p_e\) = 0.2 × 0.225 + 0.8 × 0.775 = 0.045 + 0.62 = **0.665**.
- \(κ_k\) = (0.875 − 0.665) ÷ (1 − 0.665) = 0.21 ÷ 0.335 ≈ **0.63**.
- Ya cuenta: tiene al menos 30 casos dobles acumulados (40). Y no salta: 0.63 es mayor que 0.6, apenas. Conviene revisar los 5 desacuerdos: si la guía no dice qué hacer con una mochila o una cartera, ahí está el hueco.
? [reto] Producto rediseña el formulario: ahora la primera sugerencia viene ya marcada, y la gente corrige solo 10 % de los errores del modelo, en vez de ≈ 33 %. El modelo es el mismo, con \(q\) = 0.85. (a) ¿Cuánto cambian \(e_{sug}\) y \(q_{med}\)? (b) ¿Qué número de la estación lo delata? (c) ¿Qué le pasa al modelo del mes siguiente si nadie lo nota?
- (a) Con \(e_{sug} = (1 − q) × (1 − c)\) y \(q_{med} = q + e_{sug}\). Antes: \(e_{sug}\) = 0.15 × 0.67 ≈ 0.10 y \(q_{med}\) = 0.95. Ahora: \(e_{sug}\) = 0.15 × 0.90 = **0.135** y \(q_{med}\) = 0.85 + 0.135 = **0.985**. El modelo «sube» 3.5 puntos sin cambiar nada.
- (b) Lo delatan las fuentes que el modelo no influyó: la exactitud medida con la muestra al azar y con el golden set sigue en ≈ 0.85, y el holdout no cambió. También el reporte por fuente: la elección de quien vende, sin filtrar, baja de ≈ 90 % a ≈ 86.5 % de aciertos.
- (c) Entra más ruido a la fuente más grande: con la parte de quien vende en el snapshot, más errores aceptados se vuelven labels. El modelo siguiente aprende a repetir esos errores con más seguridad. Es el feedback loop haciendo daño de verdad, no solo inflando un número.
:::

## Lo que sigue {What comes next}

- «Versionado y linaje» toma los labels de esta estación y arma el snapshot del mes: un manifest que no se puede pisar, atado al modelo que entrena con él. El contrato de datos de aquí corre antes, durante y después de armarlo.
- «Entrenamiento y experimentos» entrena con ese snapshot, y «Gate de evaluación y registry» compara el modelo nuevo contra el actual con el golden set que esta estación cuida.
- «Monitoreo, drift y reentrenamiento» vigila el modelo en producción con señales rápidas mientras llegan los labels demorados, y reusa el holdout para saber cuánto vale la sugerencia.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
label-debil feedback-loop holdout-sin-sugerencias log-prediccion regla-maduracion sesgo-seleccion guia-etiquetado doble-anotacion adjudicacion kappa-por-clase preguntas-control muestra-aleatoria categoria-nueva cola-etiquetado bucket-restringido label-demorado contrato-datos chequeo-bloqueante cuarentena-datos
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué une el log de predicciones con la publicación, y por qué un join directo con las correcciones puede dar más filas que fotos?
El `request_id`, que el backend guarda con cada foto del borrador. Si una publicación tiene dos correcciones, cada foto se repite dos veces; por eso primero se queda la corrección más reciente.
? ¿Por qué la elección de quien vende espera 30 días para contar como label?
Porque moderación todavía puede corregirla durante días. Con la regla de maduración, el error de esa fuente baja de ≈ 10 % a ≈ 5 %.
? ¿Por qué medir el modelo con las elecciones de quien vende da un número optimista?
Por el feedback loop: cuando el modelo se equivoca y la persona acepta, el label queda igual a la predicción equivocada y el examen la cuenta como acierto. Con los números de Alba, 95 % medido contra 85 % real.
? ¿Qué es el holdout de Alba y para qué sirve?
≈ 1 % de las cuentas, elegidas por hash, que nunca ve sugerencias. Sus elecciones no las influyó el modelo: miden cuánto empuja la sugerencia a las de los demás y cuánto vale. La exactitud de cada fuente la mide la muestra al azar de la cola.
? ¿Por qué la muestra al azar de la cola se sortea primero?
Porque si se sortea de lo que sobró después de las dudas y los desacuerdos, ya no tiene las fotos difíciles y mide al modelo mejor de lo que es.
? ¿Por qué la kappa por clase de Alba se mide acumulando meses?
Porque 500 fotos dobles entre 500 categorías son ≈ 1 por categoría al mes. La alerta solo cuenta cuando una categoría junta al menos 30 casos dobles.
? ¿Qué diferencia hay entre un chequeo que bloquea y uno que avisa?
El que bloquea detiene el entrenamiento y deja el modelo actual, porque el error invalidaría al nuevo. El que avisa deja seguir y alerta a una persona. Todo chequeo nuevo empieza avisando.
:::
