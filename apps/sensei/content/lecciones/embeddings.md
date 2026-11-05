---
titulo: Embeddings: el significado como coordenadas
en: Embeddings: meaning as coordinates
subtitulo: Cómo un modelo convierte una foto o una frase en una lista de números donde lo parecido queda cerca, y cómo se busca entre 100 millones de esas listas en milisegundos.
pregunta: ¿Cómo encuentra una app «productos parecidos» a una foto, si la computadora solo sabe de números?
minutos: 30
requisitos: redes
---

:::idea
Un embedding es una lista de números que un modelo le asigna a cada cosa, de modo que las cosas parecidas reciben listas parecidas. Así, «buscar algo parecido» se convierte en «buscar el punto más cercano».
:::

## Un vector es una lista de números {A vector is a list of numbers}

Empecemos por la palabra que vas a oír en todo lo que sigue. Un [[vector]] es una lista ordenada de números. Por ejemplo:

- (4, 3) es un vector con 2 números.
- (0.12, −0.80, 0.33) es un vector con 3 números.
- Un vector de 512 números es lo mismo, solo que más largo.

La cantidad de números se llama la **dimensión** del vector. (4, 3) tiene dimensión 2. El orden importa: (4, 3) y (3, 4) son vectores distintos.

¿Por qué llamarle «vector» y no «lista»? Porque un vector se puede **dibujar**. Con 2 números, el primero dice cuántos pasos ir a la derecha y el segundo cuántos hacia arriba. El vector (4, 3) es el punto que queda 4 a la derecha y 3 arriba del origen (el punto (0, 0), donde se cruzan los ejes). También se dibuja como una flecha que sale del origen y llega a ese punto: el punto dice *dónde*, la flecha además dice *hacia dónde apunta*. Las dos ideas nos van a servir.

Con 3 números ya es un punto en el espacio: derecha, arriba y hacia el frente. Con 512 números ya no lo puedes imaginar, pero las cuentas son exactamente las mismas que en 2D. Por eso en esta lección todo se explica en 2D y luego se dice qué cambia al crecer.

:::nota Vector y tensor
En la lección de imágenes viste que una foto, para el modelo, es un [[tensor]]: una tabla de números con varias dimensiones (canales, alto y ancho). Un vector es el tensor más sencillo: una sola fila de números.
:::

### Un mapa de productos

Imagina que tomamos cuatro productos del marketplace de C01 y los colocamos en un plano, de modo que los que se parecen queden juntos. Una forma posible:

| Producto | Vector |
|---|---|
| Tenis | (4, 3) |
| Botas | (3, 4) |
| Playera | (−3, 4) |
| Bolsa | (−4, 3) |

Los dos calzados quedan a la derecha, muy juntos. La playera y la bolsa (ropa y accesorios) quedan a la izquierda, también juntas. Entre los dos grupos hay un buen espacio.

:::figura embeddings-plano
Cuatro productos como flechas desde el origen. Los calzados apuntan casi en la misma dirección; la playera queda a 90° de los tenis. Los números son inventados para el ejemplo.
:::

Fíjate en algo importante: **los ejes no tienen nombre**. No dijimos «el eje x es qué tan deportivo es». Solo pedimos que lo parecido quede cerca, y estas coordenadas lo cumplen. Esa es exactamente la situación de un embedding real.

## Embeddings: que lo parecido quede cerca {Embeddings: similar things land close}

Un [[embedding]] es el vector que un modelo produce para una cosa (una foto, una frase, un producto, un usuario) con una propiedad muy especial: **cosas parecidas producen vectores cercanos**.

¿De dónde sale? De una [[red-neuronal|red neuronal]] ya entrenada. En la lección de redes viste que una red es una pila de [[capa|capas]], y que cada capa transforma los números que recibe. Las primeras capas detectan cosas simples (bordes, colores); las de más adentro, cosas más abstractas (una suela, unas agujetas). La última capa convierte todo eso en la respuesta final, por ejemplo las 500 categorías de C01.

Si cortas la red **justo antes de esa última capa**, lo que sale es un vector que resume la foto. Ese vector es un embedding. En la ResNet-50 de C01, justo antes de la última capa, sale un vector de 2,048 números.

:::ejemplo Por qué ese vector agrupa lo parecido
Para elegir bien entre 500 categorías, la red tuvo que aprender a dejar las fotos de tenis en una zona de su espacio interno y las de botas en otra cercana (las dos son calzado), y las de bolsas lejos. Si dos fotos de tenis quedaran en zonas muy distintas, la última capa no podría ponerles la misma etiqueta. Nadie le pidió «agrupa lo parecido»: lo aprendió porque le servía para acertar.
:::

También hay modelos entrenados **a propósito** para producir embeddings, con el objetivo explícito de que lo parecido quede cerca. Esos se llaman *encoders* (codificadores): entran datos, sale un vector.

### Tamaños reales

Un embedding real no tiene 2 números, tiene cientos o miles. Algunos que vas a oír:

| Modelo | Qué codifica | Dimensión |
|---|---|---|
| ResNet-50 (antes de su última capa) | Fotos | 2,048 |
| BERT-base | Texto | 768 |
| CLIP ViT-B/32 | Fotos y texto, en el mismo espacio | 512 |

Cada número se guarda normalmente como [[float32]], que ocupa 4 bytes. Un embedding de 512 números ocupa entonces:

512 × 4 bytes = 2,048 bytes ≈ 2 KB

Parece nada. Guarda esa cifra: cuando sean 100 millones de productos, va a decidir la arquitectura.

:::analogia Coordenadas en un mapa
Un embedding funciona como las coordenadas de una ciudad en un mapa: dos ciudades vecinas tienen coordenadas parecidas, y para saber si dos ciudades están cerca no necesitas conocerlas, basta con restar sus coordenadas.

**Dónde se rompe:** un mapa tiene 2 ejes con significado (norte-sur y este-oeste). Un embedding tiene cientos de ejes y ninguno, por separado, significa algo que puedas nombrar. Además, en un mapa la distancia es un hecho físico; en un embedding, «cerca» quiere decir «el modelo los considera parecidos», que puede no ser lo que tú considerarías parecido.
:::

:::ojo
Dos embeddings solo se pueden comparar si los produjo **el mismo modelo, en la misma versión**. Cada modelo inventa su propio «mapa». Comparar el vector de una foto hecho con la versión 1 contra uno hecho con la versión 2 es como comparar coordenadas de dos mapas con distinto origen y distinta escala: la cuenta sale, pero no significa nada. En la Ronda esto aparece como una regla: nunca mezclar versiones de embeddings en un mismo índice.
:::

## Medir qué tan cerca: distancia y coseno {Measuring closeness: distance and cosine}

Si «parecido» significa «cerca», necesitamos una forma de medir qué tan cerca están dos vectores. Hay dos que se usan muchísimo.

### Distancia euclidiana: la de la regla

La [[distancia-euclidiana|distancia euclidiana]] es la distancia en línea recta, la que medirías con una regla. Es el teorema de Pitágoras: restas coordenada por coordenada, elevas al cuadrado, sumas y sacas raíz.

:::ejemplo Distancia entre tenis y botas
Tenis = (4, 3) y botas = (3, 4).

1. Restas: 4 − 3 = 1 y 3 − 4 = −1.
2. Elevas al cuadrado: 1² = 1 y (−1)² = 1.
3. Sumas: 1 + 1 = 2.
4. Raíz: √2 ≈ 1.41.

Entre tenis (4, 3) y playera (−3, 4): diferencias 7 y −1; cuadrados 49 y 1; suma 50; √50 ≈ 7.07. La playera está unas cinco veces más lejos que las botas.
:::

Con 512 números es lo mismo, solo que restas, elevas y sumas 512 veces.

### Similitud coseno: hacia dónde apuntan

La [[similitud-coseno|similitud coseno]] no mide la distancia entre las puntas, sino el **ángulo** entre las dos flechas. Si apuntan en la misma dirección, vale 1. Si son perpendiculares (90°), vale 0. Si apuntan en direcciones opuestas, vale −1.

Se calcula con el **producto punto**: multiplicas coordenada por coordenada y sumas. Luego lo divides entre el largo de cada flecha.

cos = (a · b) ÷ (largo de a × largo de b)

:::ejemplo El coseno entre tenis y botas, con lápiz
Tenis = a = (4, 3) y botas = b = (3, 4).

1. Producto punto: 4 × 3 + 3 × 4 = 12 + 12 = 24.
2. Largo de a: √(4² + 3²) = √(16 + 9) = √25 = 5. El de b también es 5.
3. Coseno: 24 ÷ (5 × 5) = 24 ÷ 25 = **0.96**.

Casi 1: apuntan casi en la misma dirección (el ángulo entre ellas es de unos 16°).

Ahora tenis contra playera = (−3, 4): producto punto 4 × (−3) + 3 × 4 = −12 + 12 = 0. Coseno = 0 ÷ 25 = **0**. Son perpendiculares: para este modelo, no tienen nada que ver.

Y tenis contra bolsa = (−4, 3): 4 × (−4) + 3 × 3 = −16 + 9 = −7. Coseno = −7 ÷ 25 = **−0.28**. Apuntan hacia lados algo opuestos.
:::

### ¿Por qué ignorar el largo?

Imagina una publicación de tenis con una descripción larguísima, y que el modelo le da el vector (8, 6) en vez de (4, 3). Es la misma dirección, solo el doble de larga. La distancia euclidiana entre (4, 3) y (8, 6) es 5, más lejos que la playera de su bolsa. El coseno, en cambio, es (32 + 18) ÷ (5 × 10) = 50 ÷ 50 = 1: idénticos en dirección.

Muchas veces lo que importa es la dirección (de qué se trata) y no el largo. Por eso es muy común **normalizar** los embeddings: dividir cada vector entre su largo para que todos midan 1. (4, 3) normalizado es (0.8, 0.6). Con vectores normalizados pasan dos cosas útiles:

- El coseno es simplemente el producto punto, porque los largos valen 1. Es una cuenta más barata.
- La distancia euclidiana y el coseno ordenan a los vecinos exactamente igual. Da lo mismo cuál uses para decidir quién está más cerca.

:::ojo
«Cerca» significa «el modelo cree que se parecen», no «son lo mismo» ni «son lo que el usuario quiere». Si el modelo aprendió que dos productos se parecen porque se fotografiaron sobre la misma mesa, sus vectores van a quedar cerca por una razón que no te sirve. Los embeddings heredan lo que el modelo aprendió, con sus aciertos y sus atajos.
:::

## Buscar el más cercano entre 100 millones {Searching among 100 million}

Con lo anterior ya puedes construir una búsqueda: calculas el embedding de lo que el usuario busca y encuentras los productos cuyo embedding está más cerca. Encontrar los k más cercanos se llama búsqueda de [[vecinos-cercanos|vecinos más cercanos]] (*nearest neighbors*). Si k = 30, quieres los 30 más parecidos.

La forma más obvia es la **búsqueda exacta**, también llamada fuerza bruta (*brute force*): comparas el vector de la búsqueda contra todos los del catálogo, uno por uno, y te quedas con los mejores. Con cuatro productos es instantáneo. Veamos con un catálogo de verdad.

:::ejemplo Las cuentas de C07: 100 millones de productos
En la Ronda, el caso C07 es una búsqueda por texto y por foto sobre el mismo marketplace de C01. Tiene ≈ 100 millones de publicaciones activas, cada una con un embedding de 512 números, y en la hora pico llegan ≈ 1,750 búsquedas por segundo.

**Memoria para guardar los vectores** (en float32, 4 bytes por número):

100,000,000 × 512 × 4 bytes = 204,800,000,000 bytes = **204.8 GB ≈ 205 GB**

Una laptop típica tiene 8 o 16 GB de memoria. Esto no cabe ni en 10 laptops de 16 GB.

**Trabajo por búsqueda:** el producto punto de dos vectores de 512 números son 512 multiplicaciones (y otras tantas sumas). Contra todo el catálogo:

100,000,000 × 512 = **51,200,000,000 multiplicaciones por búsqueda** (51.2 mil millones)

**Trabajo por segundo en el pico:**

51,200,000,000 × 1,750 ≈ **90,000,000,000,000 multiplicaciones por segundo** (unos 90 millones de millones)

Y además, cada búsqueda tiene que leer los 205 GB completos de la memoria. La memoria de un servidor grande entrega del orden de unos cientos de GB por segundo. A 200 GB por segundo, solo leer los vectores tomaría ≈ 1 segundo por búsqueda; aun al doble de velocidad, medio segundo. Y C07 se compromete a que 99 de cada 100 búsquedas de texto respondan en menos de 300 ms.
:::

La búsqueda exacta es perfecta en calidad y imposible en costo. Hace falta otra idea.

### La idea: no mirar todo

Casi siempre no necesitas los 30 vecinos **exactos**. Te basta con 30 que sean muy buenos, aunque de vez en cuando se te escape alguno de los verdaderos. Esa renuncia es la que abre la puerta: buscar los vecinos más cercanos **aproximados**, en inglés *approximate nearest neighbors*, o [[ann|ANN]].

Un ANN no compara contra todo el catálogo. Antes de que llegue cualquier búsqueda, organiza los vectores para que, cuando llegue una, solo tenga que revisar una parte pequeña y bien elegida. Esa organización guardada se llama [[indice-vectorial|índice vectorial]].

:::analogia Una biblioteca ordenada por estantes
En una biblioteca sin orden, para encontrar un libro de cocina tendrías que revisar todos los libros. En una biblioteca ordenada por temas vas directo al estante de cocina y revisas solo ese. Ordenar los estantes costó trabajo, pero se hizo una vez; cada búsqueda después es rápida.

Un índice vectorial hace lo mismo: agrupa los vectores en «estantes» de vectores parecidos. Cuando llega una búsqueda, primero ve qué estantes quedan más cerca y revisa solo esos.

**Dónde se rompe (y por qué importa):** un libro de nutrición con muchas recetas pudo quedar en el estante de salud. Si solo revisas el de cocina, no lo ves, aunque era justo el que buscabas. En la biblioteca esto pasa poco; en un espacio de 512 dimensiones, con millones de vectores cerca de las orillas de cada grupo, pasa todo el tiempo. Por eso un ANN se puede equivocar, y por eso se mide cuánto.
:::

:::figura embeddings-estantes
Un índice por grupos. La búsqueda (la estrella) solo revisa el grupo más cercano. El vecino verdadero más cercano quedó del otro lado de la orilla, en otro grupo, y se pierde: eso es lo que mide el recall.
:::

### Velocidad contra recall

¿Qué tanto se pierde? Se mide comparando el ANN contra la búsqueda exacta en una muestra de búsquedas. Si la búsqueda exacta dice que estos son los 100 vecinos verdaderos y el ANN encontró 95 de ellos, su **recall@100** es 95 ÷ 100 = 0.95. Es el mismo [[recall]] de la lección «¿Aprendió de verdad?»: de lo que había que encontrar, cuánto encontraste.

La perilla es cuántos estantes revisar:

| Revisas… | Velocidad | Recall |
|---|---|---|
| 1 estante | Muy rápido | Más bajo: se escapan los vecinos de la orilla |
| Los 10 estantes más cercanos | Más lento | Más alto |
| Todos los estantes | Tan lento como la búsqueda exacta | 1.0 (perfecto) |

No existe el índice rápido y perfecto: existe el punto de la perilla que tu sistema puede pagar. En C07 se pide **recall@100 ≥ 0.95**, y se vigila en producción con un *job* (un programa que corre solo, termina y vuelve a correr) que cada hora lanza un set fijo de búsquedas contra el ANN y contra la búsqueda exacta, y compara.

:::profundo Grupos y grafos: las dos familias de índices
**Por grupos (IVF, *inverted file*).** Es la biblioteca de estantes: los vectores se agrupan alrededor de unos centros, y cada búsqueda revisa los grupos de los centros más cercanos. La perilla es cuántos grupos revisar.

**Por grafo (HNSW, *Hierarchical Navigable Small World*).** Cada vector se conecta con unos cuantos vecinos cercanos, como una red de caminos. Para buscar, empiezas en algún punto y vas saltando al vecino que esté más cerca de tu objetivo, hasta que ninguno te acerca más. Tiene varios niveles: arriba, pocos puntos con caminos largos (como autopistas); abajo, todos los puntos con caminos cortos (como calles). La perilla es cuántos caminos exploras a la vez. Es el que elige C07.

**Ahorrar memoria.** Además de organizar, se puede guardar cada número con menos bytes. Si en vez de 4 bytes (float32) usas 1 byte (int8), los vectores de C07 pasan de 204.8 GB a 100,000,000 × 512 × 1 = 51.2 GB, a cambio de un poco de precisión en las distancias. El grafo de HNSW suma otros ≈ 25.6 GB. Esas cuentas las hace C07 completas. Cómo se guarda un número en 1 byte lo ves en la lección de cómo guarda números una computadora.
:::

## Primero rápido, después fino: retrieval y re-ranking {Retrieval, then re-ranking}

El ANN resuelve el problema de mirar 100 millones, pero compara vectores calculados **por separado**: el de la búsqueda y el de cada producto, cada uno sin saber del otro. Eso es rápido, pero se le escapan detalles. «Tenis blancos sin agujetas» y «tenis blancos con agujetas» pueden quedar casi en el mismo punto.

Por eso los sistemas de búsqueda trabajan en dos etapas:

:::pasos
1. Retrieval: traer candidatos
El [[retrieval]] (recuperación) usa el índice vectorial para traer, en pocos milisegundos, unos cientos de candidatos de entre los 100 millones. Su trabajo no es ordenarlos perfecto: es **no dejar fuera** lo bueno. Es barato por candidato porque solo compara vectores ya calculados.
2. Re-ranking: ordenar bien los primeros
El [[re-ranking]] (reordenar) usa un modelo más caro y más preciso que lee la búsqueda y cada candidato **juntos**, palabra por palabra, y les pone una calificación nueva. Como solo mira los primeros (decenas, no millones), se puede dar el lujo de ser lento por candidato.
:::

:::diagrama embeddings-busqueda
Una búsqueda semántica: el catálogo se convierte en vectores antes; cada búsqueda solo calcula un vector, consulta el índice y reordena unos pocos candidatos.
:::

Fíjate en que hay **dos caminos** con presupuestos muy distintos. Convertir todo el catálogo en vectores se hace antes, en lote (todo junto, sin que nadie esté esperando), y puede tardar horas. Cada búsqueda, en cambio, tiene que contestar en milisegundos: solo calcula **un** vector (el de lo que escribió el usuario) y consulta el índice que ya existe.

:::ejemplo Cuántos candidatos reordenar: una decisión de dinero
En C07 de la Ronda, el re-ranker es lo que más cuesta del sistema. Si reordena los 100 primeros candidatos de cada búsqueda de texto, necesita ≈ 24 GPUs; si reordena solo los 30 primeros, ≈ 8. El diseño elige 30, y lo confirma midiendo que reordenar 100 casi no mejora los resultados. Dieciséis GPUs de diferencia por una mejora que nadie nota es una mala compra.
:::

Este patrón, «un paso barato y amplio, luego un paso caro y preciso», aparece en toda la Ronda: en búsqueda, en recomendación (C08) y en moderación de contenido (C06). En la Ronda se llama **cascada**.

## Texto e imágenes en el mismo espacio {Multimodal embeddings}

Hasta aquí comparamos fotos con fotos. ¿Y si el usuario escribe «tenis blancos» y quieres encontrar **fotos**? Un vector de texto y uno de foto viven en mapas distintos… a menos que los hagas vivir en el mismo.

Eso es un embedding [[multimodal]]: uno que pone fotos y textos en el **mismo espacio**, para que se puedan comparar directamente. El más conocido es **CLIP**, que OpenAI publicó en 2021. Tiene dos redes, una para imágenes y otra para texto. Se entrenaron juntas con unos 400 millones de pares (imagen, texto) sacados de internet, con un solo objetivo: que el vector de cada foto quede cerca del vector de su descripción, y lejos de las descripciones de otras fotos.

El resultado: el vector del texto «unos tenis blancos» queda cerca del vector de una foto de unos tenis blancos. Puedes buscar fotos con texto, texto con fotos o fotos con fotos, con la misma búsqueda de vecinos cercanos. CLIP ViT-B/32 produce vectores de 512 números para las dos cosas.

:::nota Por qué la Ronda dice «tipo CLIP»
En C07, el equipo de modelos entrega un encoder «tipo CLIP»: la misma idea de dos redes, una para fotos y otra para texto (en la Ronda les dicen «torres»), que dejan sus vectores en un mismo espacio, pero ajustada con pares (título, foto) del propio marketplace. Para quien diseña el sistema, el modelo es una caja que convierte texto o imagen en un vector de 512 números. Las preguntas de la entrevista van a la memoria, la velocidad y la frescura del índice, no a cómo se entrenó.
:::

### Para qué se usan los embeddings

**Búsqueda de productos parecidos.** Ana sube la foto de sus tenis. Con su embedding, el marketplace puede mostrar «publicaciones parecidas» o dejar que otra persona busque con una foto. Es la búsqueda de vecinos cercanos de esta lección, tal cual.

**Encontrar duplicados.** Un vendedor sube la misma foto en tres publicaciones, recortada o recomprimida. Byte por byte los archivos son distintos, pero sus embeddings quedan casi en el mismo punto. Si dos fotos tienen coseno muy alto (cuál es «muy alto» se decide con un [[umbral]] medido con ejemplos), se marcan como posibles duplicados. En la Ronda (M09) esto importa para que la misma foto no termine en el entrenamiento y en el examen a la vez.

**Vigilar el drift.** En la primera lección viste que el [[drift]] es cuando las fotos que llegan se van pareciendo menos a las del entrenamiento. ¿Cómo se mide «parecerse» entre miles de fotos? Con embeddings: calculas el vector de una muestra de fotos de hoy y lo comparas con los de una muestra de referencia. Lo más sencillo es comparar el **vector promedio** de cada grupo: si se separan, algo cambió. Hay formas más finas, que verás en la lección sobre comparar distribuciones y en M12 de la Ronda. Lo valioso es que los embeddings detectan cambios de **contenido** (aparecen bolsas donde antes no había) que las estadísticas de color o brillo no ven.

**Darle memoria a un LLM.** En la siguiente lección verás RAG: antes de que un modelo de lenguaje conteste, se buscan los documentos relevantes con… una búsqueda de vecinos cercanos sobre embeddings de texto. Es la misma maquinaria de esta lección.

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M02 · Patrones de inferencia** usa la búsqueda por embeddings como ejemplo del patrón híbrido: los embeddings del catálogo se calculan en lote, el de la consulta en cada request, y el patrón de cascada (barato y amplio, luego caro y preciso).
- **M07 · Servidores de modelos** sirve los encoders y los re-rankers (en Triton o en vLLM, dos programas que ponen modelos a responder) y menciona `/v1/embeddings`, la dirección de la API a la que se le piden embeddings.
- **M09 · Datos y features** usa la similitud de embeddings (o huellas de la imagen) para encontrar casi duplicados antes de repartir las fotos en entrenamiento y prueba.
- **M12 · Monitoreo** detecta drift en imágenes comparando embeddings de hoy contra una referencia.
- El caso **C07 · Búsqueda semántica** hace todas las cuentas de esta lección en grande: 205 GB en float32, 51.2 GB en int8, recall@100 ≥ 0.95 y el re-ranker de 30 contra 100 candidatos.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
vector embedding similitud-coseno distancia-euclidiana vecinos-cercanos ann indice-vectorial retrieval re-ranking multimodal
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué es un embedding y por qué sirve para buscar cosas parecidas?
Es el vector que un modelo produce para una cosa, de forma que cosas parecidas reciben vectores cercanos. Así, «buscar algo parecido» se vuelve «buscar el vector más cercano», que es una cuenta.
? Calcula la similitud coseno entre (1, 0) y (0, 2). ¿Qué significa?
Producto punto: 1 × 0 + 0 × 2 = 0. El coseno es 0 ÷ (1 × 2) = 0. Son perpendiculares: para el modelo, no tienen nada que ver. (El largo distinto no importa: el coseno solo mira la dirección.)
? ¿Cuánta memoria ocupan 10 millones de embeddings de 768 números en float32?
10,000,000 × 768 × 4 bytes = 30,720,000,000 bytes ≈ 30.7 GB.
? ¿Por qué no se hace la búsqueda exacta sobre 100 millones de vectores?
Porque cada búsqueda tendría que comparar contra todos: 100 M × 512 = 51.2 mil millones de multiplicaciones, y leer ≈ 205 GB de memoria. Con cientos o miles de búsquedas por segundo no hay forma de pagarlo. Un ANN revisa solo una parte bien elegida, a cambio de perder de vez en cuando algún vecino verdadero.
? Un índice ANN tiene recall@100 = 0.90 y te piden 0.95. ¿Qué perilla mueves y qué pagas?
Revisar más de la colección (más grupos en un índice por grupos, más caminos en un grafo). Sube el recall, pero cada búsqueda tarda más y necesitas más máquinas para la misma cantidad de búsquedas por segundo.
? ¿Por qué el re-ranker solo mira los primeros candidatos y no todo el catálogo?
Porque es caro por candidato: lee la búsqueda y cada candidato juntos. Sobre decenas de candidatos es pagable; sobre millones, imposible. El retrieval barato trae los candidatos y el re-ranker caro ordena bien los primeros.
:::
