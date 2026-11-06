---
titulo: Bases de datos: tablas, SQL y llave-valor
en: Databases: tables, SQL and key-value stores
subtitulo: Dónde queda guardada una publicación, cómo se encuentra una fila entre millones en milisegundos, por qué un cambio no puede quedar a medias y cuándo basta con pedir las cosas por su llave, en memoria.
pregunta: Cuando Ana publica sus tenis, ¿dónde queda guardada la publicación, cómo la encuentra la app entre millones en milisegundos y qué pasa si dos cosas la cambian a la vez?
requisitos: formatos
---

:::idea
Una base de datos es un programa que guarda datos sin perderlos y deja que muchos programas los lean y los cambien a la vez. Tres herramientas la hacen rápida y segura: el índice encuentra una fila entre millones en unos pocos pasos, la transacción hace que un cambio de varias partes pase completo o no pase, y el caché guarda cerca una copia de lo que se pide mucho.
:::

Ana sube la foto de sus tenis, el modelo sugiere «tenis», ella acepta, pone el precio y toca «Publicar». En ese instante pasan tres cosas que esta lección abre una por una. La publicación tiene que quedar guardada aunque el servidor se apague un segundo después. Tiene que poder encontrarse entre cientos de millones, en milisegundos, cuando alguien abra su página. Y si Ana cambia el precio justo cuando otro programa también lo toca, nada debe quedar a medias.

En la lección de formatos viste cómo se guardan datos en un [[archivo]]: un CSV, un JSON, un Parquet. Un archivo sirve para guardar un dataset y pasarlo de mano en mano. Para los datos vivos de una app, que cambian miles de veces por segundo y que leen muchos programas a la vez, hace falta otra cosa: una base de datos.

El recorrido: qué es una base de datos, cómo se le pregunta (SQL), cómo encuentra una fila rápido (los índices) y cómo cambia varias cosas sin dejarlas a medias (las transacciones). Después, las bases que solo responden por llave, como Redis, y el caché. En una sección extra, qué pasa cuando la base tiene varias copias.

## Qué es una base de datos {What a database is}

Imagina que el backend de C01, el programa del marketplace que recibe las publicaciones, las guardara en un CSV, una línea por publicación. Funcionaría el primer día. Después, tres problemas:

- **Buscar es lento.** Para encontrar la publicación 4,242,424 hay que leer el archivo desde el principio. Con ≈ 2.5 M publicaciones nuevas al día, en un año son ≈ 900 millones de líneas.
- **Cambiar es peligroso.** Para cambiar un precio hay que reescribir el archivo. Si el servidor se apaga a la mitad, queda un archivo roto.
- **Compartir no se puede.** Si dos programas escriben el mismo archivo a la vez, uno pisa lo que escribió el otro.

Una [[base-datos|base de datos]] (*database*) resuelve justo eso. Es un programa que guarda datos de forma **ordenada** (cada dato en su lugar y con su tipo), **durable** (lo que te confirmó como guardado sobrevive a un apagón) y **compartida** (muchos programas leen y escriben a la vez sin pisarse), y que deja **consultarlos**: pides «las publicaciones de Ana que cuestan menos de 1,000 pesos» y recibes solo esas.

Casi siempre corre como un [[servidor]] aparte: un [[proceso]] que se queda escuchando en la red, con sus datos en su propio [[disco]]. El backend se conecta, manda una pregunta y recibe la respuesta. Abrir una conexión cuesta varias idas y vueltas por la red, así que el backend mantiene un [[pool-conexiones|pool de conexiones]] abiertas, como el de la lección de HTTP: cada request toma una, la usa y la devuelve.

### Tablas, filas y columnas

La forma más común de ordenar los datos es la [[tabla]] (*table*): una cuadrícula, como una hoja de cálculo. Cada **fila** (*row*) es una cosa: una publicación. Cada **columna** (*column*) es un dato de todas las cosas: el precio.

A diferencia de una hoja de cálculo, cada columna tiene un tipo fijo, declarado al crear la tabla: `precio` es un entero, `titulo` es texto. Esa lista de columnas con sus tipos es el [[esquema-datos|esquema]] de la tabla, como el de un Parquet. Si alguien quiere guardar «novecientos» en `precio`, PostgreSQL, una de las bases más usadas (la verás en la sección siguiente), lo rechaza. SQLite, la base que vamos a usar en el código, es más tolerante y lo guarda como texto, salvo que la tabla se declare `STRICT` (una opción que existe desde SQLite 3.37, de 2021).

C01 tiene varias tablas: `usuarios`, `publicaciones` y `fotos`. Ojo con la última: guarda **dónde** está cada foto y de qué publicación es, no la foto. Los ≈ 200 KB de cada foto viven en el [[object-storage|object storage]], un almacén de archivos de la nube que es tema de la lección siguiente. Una base de datos guarda bien millones de filas chicas; los archivos grandes, no.

:::figura bases-de-datos-tabla
La tabla `publicaciones`: cada fila es una publicación y cada columna, un dato con su tipo. La columna `id` es la llave primaria: distinta en cada fila y nunca vacía. Si llega otra fila con `id = 1`, la base la rechaza.
:::

### La llave primaria

¿Cómo dice la app «esta publicación y no otra»? Con la [[llave-primaria|llave primaria]] (*primary key*): una columna, o varias juntas, cuyo valor es distinto en cada fila y nunca falta. En la figura es `id`. La base la hace cumplir: si alguien intenta guardar otra fila con `id = 1`, la rechaza con un error.

¿Por qué no usar el título? Porque se repite (hay miles de «Tenis blancos») y porque cambia (Ana lo puede corregir). Una buena llave primaria es **única**, **siempre presente** y **estable**: no cambia en toda la vida de la fila. Por eso casi siempre es un número que asigna la base (1, 2, 3…) o un identificador al azar, como un [[uuid|UUID]]. El correo de un usuario parece buena llave, pero la gente lo cambia.

Otras tablas apuntan a una fila guardando su llave. La tabla `fotos` tiene una columna `publicacion_id` que dice de qué publicación es cada foto. Esa columna es una **llave foránea** (*foreign key*), y la base puede revisar que apunte a una publicación que exista. Gracias a ella se pueden unir tablas, como vas a ver en el JOIN.

## SQL: preguntarle a la base {SQL: asking the database}

Una [[base-relacional|base relacional]] (*relational database*) guarda todo en tablas que se relacionan por sus llaves. La idea la publicó Edgar F. Codd, de IBM, en 1970, y sigue siendo la forma más común de guardar los datos de una app. Las más conocidas:

- **PostgreSQL** (o Postgres): un servidor de código abierto. En las encuestas de Stack Overflow de 2023, 2024 y 2025 fue la base que más programadores dijeron usar. La Ronda lo nombra seguido como la «base operacional»: la que guarda publicaciones, usuarios y pagos.
- **MySQL**: otro servidor de código abierto, muy usado.
- **SQLite**: no es un servidor, sino una biblioteca. La base vive dentro del programa que la usa, en un solo archivo. Viene en los teléfonos, en los navegadores y en Python.

A todas se les habla en el mismo idioma: [[sql|SQL]] (*Structured Query Language*, «lenguaje de consultas estructurado»). SQL es **declarativo**: dices *qué* quieres, no *cómo* buscarlo. No escribes «recorre las filas una por una y quédate con las baratas»: escribes la condición, y la base elige el camino más rápido. Ese «elegir el camino» es la razón de ser de los índices, dos secciones adelante.

### Leer: SELECT

Una consulta (*query*) de lectura tiene esta forma:

```sql
SELECT titulo, precio          -- qué columnas
FROM publicaciones             -- de qué tabla
WHERE categoria = 'tenis'      -- qué filas
ORDER BY precio DESC           -- en qué orden (DESC: de mayor a menor)
LIMIT 10;                      -- cuántas, como máximo
```

Las palabras en mayúsculas son de SQL; lo demás son nombres de tus tablas y columnas. Lo que va después de `--` es un comentario. Se lee casi como español: «selecciona título y precio de publicaciones, donde la categoría sea tenis, de la más cara a la más barata, máximo 10». `SELECT *` pide todas las columnas.

### Filtrar con varias condiciones

El `WHERE` acepta comparaciones: `=` (igual), `<>` (distinto), `<`, `>`, `<=` y `>=`. Se juntan con `AND` (las dos se cumplen) y `OR` (basta una), con paréntesis cuando se mezclan:

```sql
SELECT titulo, precio
FROM publicaciones
WHERE (categoria = 'tenis' OR categoria = 'botas')
  AND precio < 1000;
```

Eso pide los tenis y las botas de menos de 1,000 pesos. Sin los paréntesis, la base leería «tenis de cualquier precio, o botas baratas», porque `AND` se aplica antes que `OR`, como la multiplicación antes que la suma. Dos más que vas a ver seguido: `titulo LIKE 'Tenis%'` busca los títulos que empiezan con «Tenis» (el `%` vale por cualquier texto), y `precio IS NULL` busca las filas sin precio (`NULL` es el valor de SQL para «no hay dato»). Para el `NULL` no sirve `= NULL`: «no hay dato» no es igual a nada, ni siquiera a otro «no hay dato», y esa comparación nunca da cierto.

### Contar: GROUP BY

`GROUP BY` junta las filas que tienen el mismo valor en una columna y calcula algo por grupo: cuántas son (`COUNT(*)`), su promedio (`AVG`), su suma (`SUM`), su mínimo (`MIN`) o su máximo (`MAX`).

```sql
SELECT categoria, COUNT(*), AVG(precio)
FROM publicaciones
GROUP BY categoria;
```

Es la pregunta de todos los días de un equipo de datos: cuántas publicaciones hubo por categoría ayer, cuál es el precio promedio, qué categoría crece. Para un modelo, `GROUP BY` es la forma de ver el desbalance del dataset: cuántas fotos hay de cada una de las 500 categorías.

### Escribir: INSERT, UPDATE y DELETE

- `INSERT INTO publicaciones VALUES (7, 'ana', 'Gorra', 'gorras', 200);` agrega una fila.
- `UPDATE publicaciones SET precio = 850 WHERE id = 1;` cambia las filas que cumplen la condición.
- `DELETE FROM publicaciones WHERE id = 5;` borra las filas que la cumplen.

:::ojo
Un `UPDATE` o un `DELETE` sin `WHERE` cambia o borra **todas** las filas. `UPDATE publicaciones SET precio = 850;` deja todo el marketplace en 850 pesos. Antes de correr uno, corre un `SELECT COUNT(*)` con el mismo `WHERE` y mira cuántas filas va a tocar.
:::

Con Python lo puedes probar sin instalar nada: el módulo `sqlite3` viene incluido, y `":memory:"` crea una base que vive solo en la [[ram|RAM]] y desaparece al terminar el programa.

```python
import sqlite3

db = sqlite3.connect(":memory:")       # una base de datos que vive solo en la RAM
db.execute("""CREATE TABLE publicaciones (
    id INTEGER PRIMARY KEY, vendedor TEXT, titulo TEXT, categoria TEXT, precio INTEGER)""")
db.executemany("INSERT INTO publicaciones VALUES (?, ?, ?, ?, ?)", [
    (1, "ana", "Tenis naranjas", "tenis", 900),
    (2, "beto", "Botas de piel", "botas", 1500),
    (3, "ana", "Bolsa de mano", "bolsas", 650),
    (4, "carla", "Tenis blancos", "tenis", 1200),
    (5, "beto", "Sandalias", "sandalias", 300),
    (6, "carla", "Botas de lluvia", "botas", 450)])

for fila in db.execute("SELECT titulo, precio FROM publicaciones "
                       "WHERE categoria = 'tenis' ORDER BY precio DESC"):
    print(fila)
for fila in db.execute("SELECT categoria, COUNT(*), AVG(precio) FROM publicaciones "
                       "GROUP BY categoria ORDER BY COUNT(*) DESC, categoria"):
    print(fila)

cambio = db.execute("UPDATE publicaciones SET precio = 850 WHERE id = 1")
print("filas cambiadas:", cambio.rowcount)
try:
    db.execute("INSERT INTO publicaciones VALUES (1, 'dani', 'Gorra', 'gorras', 200)")
except sqlite3.IntegrityError as error:
    print("rechazado:", error)
```

```salida
('Tenis blancos', 1200)
('Tenis naranjas', 900)
('botas', 2, 975.0)
('tenis', 2, 1050.0)
('bolsas', 1, 650.0)
('sandalias', 1, 300.0)
filas cambiadas: 1
rechazado: UNIQUE constraint failed: publicaciones.id
```

La última línea es la llave primaria trabajando: ya había una fila con `id = 1`.

Fíjate en los `?` del `INSERT`. Son huecos que la biblioteca llena con cada valor, por separado del texto de la consulta. Nunca se arma el SQL pegando textos que mandó alguien: si un título trajera una comilla seguida de un comando de SQL, la base lo ejecutaría. Ese ataque se llama **inyección de SQL** (*SQL injection*), y los huecos lo evitan.

## JOIN: unir dos tablas por su llave {JOIN: joining two tables on a key}

Las preguntas interesantes casi siempre cruzan dos tablas. C01 quiere saber qué tan seguido acierta el modelo: comparar la categoría que sugirió con la que Ana dejó al final. La sugerencia (la categoría *top-1*, la primera de la lista del modelo) vive en un lugar, el registro de predicciones, y la publicación en otro. Las une el `request_id`: el identificador de cada request que el backend guarda junto con la foto (es el header `X-Request-ID` de la lección de HTTP; su tarjeta es [[request-id]]). En C01 las predicciones viven en un *log*, un archivo al que se le agrega una línea por predicción, y no en una tabla; pero la unión es la misma.

Un [[join|JOIN]] («unir») combina las filas de dos tablas cuyas llaves coinciden:

```sql
SELECT p.titulo, p.categoria, r.top1
FROM publicaciones AS p
JOIN predicciones AS r ON p.request_id = r.request_id;
```

`AS p` le pone un apodo a la tabla, para escribir `p.categoria` en vez de `publicaciones.categoria`. `ON` dice qué columnas tienen que coincidir. Hay dos JOIN que vas a usar casi siempre:

- **INNER JOIN** (o solo `JOIN`): solo las filas que tienen pareja en las dos tablas.
- **LEFT JOIN**: todas las filas de la tabla de la izquierda, la del `FROM`. Si alguna no tiene pareja, las columnas de la otra tabla llegan vacías, con `NULL`, el valor de SQL para «no hay dato».

:::figura bases-de-datos-join
Arriba, dos tablas en distinto orden: la unión va por la llave, no por la posición. Abajo, el resultado: el INNER JOIN se queda con las tres filas que tienen pareja; el LEFT JOIN agrega la cuarta, con `NULL` donde faltó la predicción.
:::

```python
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE publicaciones (id INTEGER PRIMARY KEY, titulo TEXT, categoria TEXT, request_id TEXT)")
db.execute("CREATE TABLE predicciones (request_id TEXT PRIMARY KEY, top1 TEXT, confianza REAL)")   # REAL: con decimales
db.executemany("INSERT INTO publicaciones VALUES (?, ?, ?, ?)", [
    (1, "Tenis naranjas", "tenis", "r-101"), (2, "Botas de piel", "botas", "r-102"),
    (3, "Bolsa de mano", "bolsas", "r-103"), (4, "Tenis blancos", "tenis", "r-104")])
db.executemany("INSERT INTO predicciones VALUES (?, ?, ?)", [
    ("r-101", "tenis", 0.91), ("r-102", "tenis", 0.48), ("r-103", "bolsas", 0.88)])   # r-104 no llegó

unir = """SELECT p.titulo, p.categoria, r.top1 FROM publicaciones AS p
          {} JOIN predicciones AS r ON p.request_id = r.request_id ORDER BY p.id"""
print("INNER JOIN:")
for fila in db.execute(unir.format("INNER")):
    print(" ", fila)
print("LEFT JOIN:")
for fila in db.execute(unir.format("LEFT")):
    print(" ", fila)

aciertos, total = db.execute("""SELECT SUM(p.categoria = r.top1), COUNT(*) FROM publicaciones AS p
                                JOIN predicciones AS r ON p.request_id = r.request_id""").fetchone()
print(f"el top-1 acertó {aciertos} de {total}: {aciertos / total:.0%}")
```

```salida
INNER JOIN:
  ('Tenis naranjas', 'tenis', 'tenis')
  ('Botas de piel', 'botas', 'tenis')
  ('Bolsa de mano', 'bolsas', 'bolsas')
LEFT JOIN:
  ('Tenis naranjas', 'tenis', 'tenis')
  ('Botas de piel', 'botas', 'tenis')
  ('Bolsa de mano', 'bolsas', 'bolsas')
  ('Tenis blancos', 'tenis', None)
el top-1 acertó 2 de 3: 67%
```

En SQLite, `p.categoria = r.top1` vale 1 si es cierto y 0 si no, así que `SUM` cuenta los aciertos. PostgreSQL tiene un tipo aparte para «cierto o falso» y no lo deja sumar; ahí se escribe `COUNT(*) FILTER (WHERE p.categoria = r.top1)`. Python muestra el `NULL` como `None`.

¿Cuál JOIN usar? Depende de la pregunta. Para medir aciertos, INNER: sin predicción no hay qué comparar. Pero para saber cuántas publicaciones se quedaron sin sugerencia (el modelo no respondió a tiempo y la app mostró su [[fallback]]), hace falta el LEFT: las filas con `NULL` son justo esas. Un INNER JOIN las quita en silencio y todo se ve mejor de lo que es.

Para quedarte solo con las que faltan, se agrega un filtro después del LEFT JOIN: `WHERE r.request_id IS NULL`. Esa consulta da las publicaciones que no encontraron pareja; en el ejemplo, solo los tenis blancos. Es la forma de preguntar «¿qué hay aquí que no esté allá?», y sirve igual para buscar fotos sin etiqueta o etiquetas sin foto.

:::ojo Una llave repetida multiplica filas
Si la llave se repite en una tabla, el JOIN repite filas. Una publicación con dos predicciones guardadas (por un reintento, por ejemplo) sale dos veces, y sus aciertos cuentan doble. Antes de unir, revisa que la llave sea única del lado que debe serlo: `SELECT request_id, COUNT(*) FROM predicciones GROUP BY request_id HAVING COUNT(*) > 1` tiene que salir vacío. `HAVING` es el `WHERE` de los grupos: filtra después de contar.
:::

:::profundo Unir con el pasado
La Ronda (M09) agrega una trampa más fina. Unir los eventos de hace meses con la tabla de usuarios **de hoy** mete en el entrenamiento datos que no existían cuando pasó cada evento: un [[leakage]]. Si un usuario verificó su cuenta en octubre, sus compras de marzo aparecerían como «de cuenta verificada». La solución es unir con el valor que cada dato tenía en ese instante, un join [[point-in-time]], de la lección «Tiempo, hashes e identificadores».
:::

## Índices: encontrar una fila entre 10 millones {Indexes: finding one row among 10 million}

Ana abre su publicación y la app pide `SELECT * FROM publicaciones WHERE id = 4242424`. Supón una tabla de 10 millones de filas: cuatro días de C01. ¿Cómo encuentra la base esa fila?

La forma tonta es leerlas todas y quedarse con la que coincide: un **recorrido completo** (*full scan*). Los datos de una tabla viven en el disco en **páginas** (*pages*), bloques de tamaño fijo: 4 [[prefijo-binario|KiB]] (4,096 bytes) por omisión en SQLite (desde su versión 3.12, de 2016) y 8 KiB en PostgreSQL. La base siempre lee páginas completas, nunca una fila suelta.

:::analogia El índice de un libro
Para encontrar «Codd» en un libro de 600 páginas no lo lees completo. Vas al índice del final, que está en orden alfabético, encuentras la C y lees «Codd, 312». Un [[indice-bd|índice]] (*index*) de una base es eso: los valores de una columna, ordenados, cada uno con la dirección de su fila.

**Dónde se rompe:** un libro no cambia, y su índice se hace una vez. Una tabla recibe millones de filas al día, y su índice se tiene que poner al día con cada una, sin dejar de estar en orden. Por eso no es una lista, sino un árbol.
:::

### El árbol B

Con una lista ordenada ya se podría hacer una búsqueda binaria: ver la mitad, descartar la mitad que no sirve y repetir. Para 10 millones son hasta 24 pasos, porque 2²⁴ ≈ 16.8 millones es la primera potencia de 2 que pasa de 10 millones. Pero si cada paso cae en una página distinta del disco, son 24 lecturas al azar.

En computación, un **árbol** es una estructura de cajas, llamadas **nodos**, donde cada una apunta a varias de abajo: la de hasta arriba es la **raíz**, y las de hasta abajo, que ya no apuntan a otros nodos, son las **hojas**. Buscar es bajar de la raíz a una hoja, eligiendo en cada nodo por cuál camino seguir.

El **árbol B** (*B-tree*), que usan casi todas las bases relacionales, hace cada paso mucho más ancho. Cada nodo es una página entera, con cientos de llaves en orden, y entre cada dos llaves sale un camino (una **rama**) a una página de abajo. Cada rama ocupa una llave y la dirección de la página de abajo, unos 10 a 15 bytes, así que en 4,096 bytes caben, en números redondos, ≈ 300. Leer una página no descarta la mitad: descarta todo menos 1 de cada ≈ 300 caminos. Las hojas guardan cada llave con la dirección de su fila.

:::figura bases-de-datos-arbol
Un árbol B de 10 millones de llaves, con 2 llaves por página para que se pueda dibujar (las de verdad traen ≈ 300). Buscar el 4,242,424 lee una página por nivel: la raíz manda al tramo de en medio, ese nodo manda a una hoja, y la hoja dice dónde está la fila.
:::

:::cuenta Encontrar una fila entre 10 millones
Filas por página // un supuesto: filas de ≈ 200 bytes en páginas de 4 KiB | 4,096 ÷ 200 | ≈ 20
Sin índice: páginas que se leen // todas: ≈ 2 GB | 10,000,000 ÷ 20 | 500,000
Llaves que caben en 3 niveles // ≈ 300 ramas por página | 300 × 300 × 300 | 27,000,000
Con índice: páginas que se leen // 3 del árbol y 1 de la tabla | 3 + 1 | 4
= 4 páginas en vez de 500,000: ≈ 125,000 veces menos. Con los números del SSD de la lección de memoria (≈ 0.1 ms por lectura al azar, ≈ 2 GB/s de corrido): ≈ 0.4 ms contra ≈ 1 s. Y las páginas de arriba del árbol casi siempre ya están en la RAM.
:::

Lo mejor es que el árbol crece muy despacio. Cada nivel multiplica por ≈ 300 lo que cabe: con 4 niveles caben 300⁴ = 8,100 millones de llaves. Un año de C01, ≈ 900 millones de publicaciones, cabe en 4 niveles. Pasar de 10 millones a 900 millones de filas cuesta una lectura más.

:::calculadora bases-de-datos-indice
Prueba un año de C01 (900) con filas de 2 KB, 2 por página: el índice lee 5 páginas y el recorrido completo, 450 millones.
:::

### Lo que cuesta un índice

Un índice no es gratis:

- **Hace más lentas las escrituras.** Cada `INSERT` o `DELETE`, y cada `UPDATE` de una columna indexada, tiene que poner al día también cada índice. Una tabla con 5 índices escribe en 6 lugares por cada fila nueva.
- **Ocupa espacio.** Es otra copia de la columna, con sus direcciones. En la medición de abajo, con 1 M de filas chicas, el índice ocupa 11.7 MB, casi lo mismo que la tabla entera (14.7 MB).
- **Solo sirve para lo que indexa.** Un índice por vendedor no ayuda a buscar por precio.

La regla: indexa las columnas por las que de verdad buscas, unes u ordenas seguido (`WHERE`, `JOIN`, `ORDER BY`), no todas. La llave primaria siempre tiene su índice: la base lo crea sola.

### Ver el plan: EXPLAIN QUERY PLAN

¿Cómo sabes si una consulta usa un índice? Se lo preguntas a la base. En SQLite, `EXPLAIN QUERY PLAN` antes de la consulta dice qué camino eligió, sin correrla: `SCAN` es recorrer toda la tabla y `SEARCH … USING INDEX` es bajar por el árbol. Las frases exactas cambian con la versión (antes de SQLite 3.36, de 2021, decía `SCAN TABLE publicaciones`); la salida del bloque de abajo es de SQLite 3.53, la que trae la Python 3.14 donde se corrió. En PostgreSQL el comando es `EXPLAIN`, y `EXPLAIN ANALYZE` además la corre y mide.

:::profundo Medirlo: un millón de filas, con y sin índice
SQLite convierte cada consulta en una lista de instrucciones sencillas («lee esta página», «compara este valor») y las ejecuta una por una. El programa crea 1 M de publicaciones (10 por vendedor) y cuenta esas instrucciones, los pasos internos, en cada búsqueda. `PRAGMA` es como se le preguntan a SQLite datos de sí misma: cuántas páginas tiene y de qué tamaño. Tarda un par de segundos.

```python
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE publicaciones (id INTEGER PRIMARY KEY, vendedor_id INTEGER, precio INTEGER)")
db.executemany("INSERT INTO publicaciones VALUES (?, ?, ?)",
               ((i, i % 100_000, 100 + i % 2_000) for i in range(1_000_000)))   # 10 por vendedor

pasos = 0
def contar():                      # SQLite la llama en cada paso interno (cada instrucción)
    global pasos
    pasos += 1
db.set_progress_handler(contar, 1)

def buscar(sql):
    global pasos
    plan = db.execute("EXPLAIN QUERY PLAN " + sql).fetchone()[3]
    pasos = 0
    filas = len(db.execute(sql).fetchall())
    print(f"encontró {filas:>3} · {pasos:>9,} pasos · {plan}")

def megabytes():
    paginas, tamano = (db.execute(f"PRAGMA {p}").fetchone()[0] for p in ("page_count", "page_size"))
    return paginas * tamano / 1e6

buscar("SELECT * FROM publicaciones WHERE vendedor_id = 4242")
antes = megabytes()
db.execute("CREATE INDEX idx_vendedor ON publicaciones (vendedor_id)")
print(f"la tabla ocupa {antes:.1f} MB y el índice, {megabytes() - antes:.1f} MB")
buscar("SELECT * FROM publicaciones WHERE vendedor_id = 4242")
buscar("SELECT * FROM publicaciones WHERE id = 4242")
buscar("SELECT * FROM publicaciones WHERE precio = 777")
```

```salida
encontró  10 · 3,000,048 pasos · SCAN publicaciones
la tabla ocupa 14.7 MB y el índice, 11.7 MB
encontró  10 ·        79 pasos · SEARCH publicaciones USING INDEX idx_vendedor (vendedor_id=?)
encontró   1 ·        11 pasos · SEARCH publicaciones USING INTEGER PRIMARY KEY (rowid=?)
encontró 500 · 3,002,008 pasos · SCAN publicaciones
```

Sin índice, encontrar las 10 publicaciones de un vendedor costó 3 millones de pasos: tres por cada fila de la tabla. Con el índice, 79. Buscar por `id` costó 11, porque en SQLite la tabla misma es un árbol B ordenado por su llave primaria (que SQLite llama `rowid`). Y buscar por precio, que no tiene índice, volvió a recorrer todo. Los números exactos de pasos cambian un poco con la versión de SQLite (estos son de la 3.53); la diferencia de miles de veces, no.
:::

## Transacciones y upsert: todo o nada, y dos veces es una {Transactions and upserts: all or nothing, and twice is once}

Publicar, en el ejemplo de esta lección, son dos escrituras: la fila de la publicación y la fila de la predicción que se le sugirió, para poder medir después. ¿Qué pasa si el servidor se cae justo entre las dos?

:::cuenta Publicaciones a medias, sin transacción
Publicaciones al día // C01 | — | ≈ 2.5 M
Las que se cortan entre las dos escrituras // un supuesto: 1 de cada 10,000 (un pod que se reinicia, un timeout) | 2,500,000 ÷ 10,000 | 250 al día
En un año | 250 × 365 | ≈ 91,000
= Cada una es una publicación sin su predicción. Ningún error lo avisa: aparecen meses después, cuando una cuenta no cuadra.
:::

### La transacción

Una [[transaccion|transacción]] (*transaction*) es un grupo de lecturas y escrituras que la base trata como una sola operación: o pasan todas, o no pasa ninguna. Empieza con `BEGIN` y termina con `COMMIT` («confírmalo»). Si algo falla antes, `ROLLBACK` («échalo para atrás») deja la base exactamente como estaba.

```sql
BEGIN;
INSERT INTO publicaciones VALUES (2, 'Tenis naranjas', 'r-105');
INSERT INTO predicciones VALUES ('r-105', 'tenis');
COMMIT;
```

Si el servidor se apaga después del primer `INSERT`, al volver la base no encuentra el `COMMIT` y deshace lo que quedó a medias. Nadie, nunca, ve la publicación sin su predicción. Las bases relacionales prometen cuatro cosas, que se recuerdan con la sigla **ACID**:

- **Atomicidad** (*atomicity*): todo o nada. Es lo de arriba.
- **Consistencia** (*consistency*): al terminar, se cumplen todas las reglas de la base: llaves primarias sin repetir, columnas marcadas `NOT NULL` (que no aceptan quedar vacías) con dato, llaves foráneas que apuntan a algo. Si una regla no se cumple, la transacción entera se rechaza.
- **Aislamiento** (*isolation*): dos transacciones al mismo tiempo no ven lo que la otra dejó a medias. El ideal es que el resultado sea como si hubieran corrido una tras otra; cuánto se acerca cada base a ese ideal está en el bloque de abajo.
- **Durabilidad** (*durability*): lo que recibió `COMMIT` sobrevive a un apagón, porque la base lo escribió en el disco antes de confirmar.

En Python, el módulo `sqlite3` abre la transacción solo, justo antes de la primera escritura, y `with db:` la cierra (`with` es la forma de Python de decir «al terminar este bloque, pase lo que pase, haz el cierre»): al salir del bloque hace `COMMIT`, y si hubo un error, `ROLLBACK`. El programa publica una vez bien y luego dos veces con la predicción vacía, que la columna `NOT NULL` rechaza: una con transacción y otra sin ella.

```python
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE publicaciones (id INTEGER PRIMARY KEY, titulo TEXT, request_id TEXT)")
db.execute("CREATE TABLE predicciones (request_id TEXT PRIMARY KEY, top1 TEXT NOT NULL)")

def publicar(id_, titulo, request_id, top1):
    with db:                       # cierra la transacción: al salir, COMMIT; con un error, ROLLBACK
        db.execute("INSERT INTO publicaciones VALUES (?, ?, ?)", (id_, titulo, request_id))
        db.execute("INSERT INTO predicciones VALUES (?, ?)", (request_id, top1))

def a_medias(id_, titulo, request_id, top1):
    db.execute("INSERT INTO publicaciones VALUES (?, ?, ?)", (id_, titulo, request_id))
    db.commit()                    # sin transacción: cada escritura se guarda sola
    db.execute("INSERT INTO predicciones VALUES (?, ?)", (request_id, top1))
    db.commit()

def contar():
    p = db.execute("SELECT COUNT(*) FROM publicaciones").fetchone()[0]
    r = db.execute("SELECT COUNT(*) FROM predicciones").fetchone()[0]
    return f"{p} publicaciones, {r} predicciones"

publicar(1, "Tenis blancos", "r-104", "tenis")
print("bien:", contar())
for funcion, id_ in ((publicar, 2), (a_medias, 3)):
    try:
        funcion(id_, "Tenis naranjas", f"r-10{id_ + 3}", None)   # la segunda escritura falla
    except sqlite3.IntegrityError as error:
        print(f"{funcion.__name__} falló ({error}):", contar())
```

```salida
bien: 1 publicaciones, 1 predicciones
publicar falló (NOT NULL constraint failed: predicciones.top1): 1 publicaciones, 1 predicciones
a_medias falló (NOT NULL constraint failed: predicciones.top1): 2 publicaciones, 1 predicciones
```

Con transacción, el error deshizo también la publicación: la base quedó igual que antes. Sin ella, quedó una publicación huérfana.

:::profundo Dos cambios a la vez: el aislamiento
El precio de los tenis es 900. Ana le baja 100 desde su teléfono y, al mismo tiempo, un programa de ofertas le aplica 10 % de descuento. Cada uno lee el precio, hace su cuenta y escribe:

- Ana lee 900 y escribe 900 − 100 = 800.
- El programa lee 900, antes de que Ana escriba, y escribe 900 × 0.9 = 810.

Queda 810: el cambio de Ana se perdió. Si hubieran ido uno tras otro, el resultado sería 720 o 710. Es la **actualización perdida** (*lost update*), y hay tres formas comunes de evitarla:

- **Hacer la cuenta dentro de la base:** `UPDATE publicaciones SET precio = precio - 100 WHERE id = 1`. La base lee y escribe en un solo paso.
- **Apartar la fila:** en PostgreSQL, `SELECT … FOR UPDATE` bloquea la fila hasta que termina la transacción (con `COMMIT` o `ROLLBACK`); el otro espera su turno.
- **Escribir con condición** (*compare-and-set*): cada fila lleva un número de versión, y se escribe `UPDATE … SET precio = 800, version = 8 WHERE id = 1 AND version = 7`. Si cambió 0 filas, alguien se adelantó: se vuelve a leer y se intenta otra vez. La Ronda lo usa en M02 para el estado de cada trabajo («solo pasa a *running* si sigue en *queued*»).

Las bases dejan elegir cuánto aislamiento pagar. PostgreSQL, por omisión, usa *read committed*: cada consulta ve lo ya confirmado, pero dos lecturas en la misma transacción pueden ver cosas distintas. El nivel más estricto, *serializable*, garantiza el «como si fueran una tras otra», a cambio de rechazar a veces una transacción que hay que reintentar.
:::

:::profundo Cómo cumple la D: el registro de escritura
Antes de tocar las páginas de la tabla, la base (así lo hace PostgreSQL; SQLite, si se le activa su modo WAL) anota cada cambio al final de un archivo aparte, el **registro de escritura adelantada** (*write-ahead log*, WAL), y le pide al sistema operativo que lo baje de verdad al disco, que no se quede solo en la [[page-cache|page cache]]. Hasta entonces no responde «COMMIT listo». Si se apaga, al arrancar relee el registro: rehace lo confirmado y descarta lo demás. Por eso cada `COMMIT` espera a que el disco confirme una escritura, y escribir mil filas en mil transacciones es mucho más lento que en una sola. Ese mismo registro es el que se manda a las copias de la base, como verás en la sección extra.
:::

### Upsert: escribir dos veces deja lo mismo

En la lección de fallas de red viste que un [[reintento]] puede repetir una escritura, y que lo que se repite sin daño es [[idempotencia|idempotente]]. Un `INSERT` no lo es: la segunda vez, o falla porque la llave ya existe, o (si la tabla no tiene llave) mete una fila repetida.

Lo que se quiere casi siempre es «si la fila ya existe, ponle este valor; si no, créala con él». Eso es un [[upsert]] (de *update* + *insert*). Con una tabla `ventas` que guarda, por vendedor (su llave primaria), cuántas ventas lleva en los últimos 7 días (`ventas_7d`):

```sql
INSERT INTO ventas VALUES ('ana', 12)
ON CONFLICT (vendedor) DO UPDATE SET ventas_7d = excluded.ventas_7d;
```

`excluded` es la fila que se quiso insertar. El «conflicto» lo detecta la llave primaria (o una columna `UNIQUE`): sin llave no hay upsert. PostgreSQL (desde la versión 9.5, de 2016) y SQLite (desde la 3.24, de 2018) lo escriben así; MySQL usa `ON DUPLICATE KEY UPDATE`.

Hay dos detalles que deciden si de verdad es idempotente:

- **Escribir el valor, no el cambio.** «Ana lleva 12 ventas» se puede escribir diez veces. «Súmale 3 a Ana» no: cada repetición suma otra vez. La Ronda (C08) lo dice así: si escribes con `INCR` (el comando de Redis que suma 1, dos secciones adelante), un reproceso, volver a procesar los mismos datos, cuenta dos veces.
- **`DO NOTHING` para lo que solo debe pasar una vez.** `ON CONFLICT DO NOTHING` guarda la primera y descarta las demás. Así se guarda una [[llave-idempotencia|llave de idempotencia]]: la base no acepta la misma llave dos veces, y el segundo intento se entera de que ya se hizo.

```python
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE ventas (vendedor TEXT PRIMARY KEY, ventas_7d INTEGER)")

def upsert(vendedor, ventas):      # deja el valor así: si la fila ya existe, la sobrescribe
    db.execute("""INSERT INTO ventas VALUES (?, ?)
                  ON CONFLICT (vendedor) DO UPDATE SET ventas_7d = excluded.ventas_7d""",
               (vendedor, ventas))

def sumar(vendedor, ventas):       # suma lo que llega: como un INCR
    db.execute("""INSERT INTO ventas VALUES (?, ?)
                  ON CONFLICT (vendedor) DO UPDATE SET ventas_7d = ventas_7d + excluded.ventas_7d""",
               (vendedor, ventas))

for intento in (1, 2):             # el mismo mensaje llega dos veces: un reintento
    upsert("ana", 12)
    sumar("beto", 3)
print(db.execute("SELECT * FROM ventas ORDER BY vendedor").fetchall())

db.execute("INSERT INTO ventas VALUES ('carla', 5) ON CONFLICT DO NOTHING")
db.execute("INSERT INTO ventas VALUES ('carla', 9) ON CONFLICT DO NOTHING")   # ya existe: no hace nada
print(db.execute("SELECT ventas_7d FROM ventas WHERE vendedor = 'carla'").fetchone())
```

```salida
[('ana', 12), ('beto', 6)]
(5,)
```

Ana quedó en 12 aunque el mensaje llegó dos veces. Beto quedó en 6, cuando solo vendió 3.

## NoSQL, llave-valor y Redis {NoSQL, key-value stores and Redis}

Las bases relacionales responden casi cualquier pregunta: filtran, cuentan y unen como quieras. Esa libertad cuesta. Una consulta nueva puede recorrer millones de filas, y repartir una base relacional entre muchas máquinas es difícil: un JOIN o una transacción pueden tocar filas que quedaron en máquinas distintas, y entonces las máquinas tienen que coordinarse por la red.

[[nosql|NoSQL]] es el nombre de las bases que no se organizan en tablas relacionadas. Se suele leer *not only SQL*, «no solo SQL». Hay varias familias:

- **De documentos** (MongoDB): cada registro es un documento tipo [[json|JSON]], con campos que pueden cambiar de uno a otro.
- **De columnas anchas** (Cassandra, Bigtable): enormes, repartidas en cientos de máquinas, buenas para escribir muchísimo.
- **Llave-valor** (Redis, DynamoDB): las más simples. Vienen a continuación.
- **Vectoriales:** guardan [[embedding|embeddings]] y buscan los más parecidos. Por dentro son un [[indice-vectorial|índice vectorial]], el de la lección de embeddings.

Lo que casi todas cambian es lo mismo: renuncian a las consultas libres y a los JOIN a cambio de repartirse fácil entre muchas máquinas y de responder siempre igual de rápido.

### Llave-valor: pedir por la llave

Una base [[llave-valor]] (*key-value store*) guarda cada valor bajo una llave, como un diccionario de Python, pero compartido entre programas. Casi todo se reduce a dos operaciones: `SET llave valor` guarda y `GET llave` lee.

:::analogia El guardarropa
En un guardarropa entregas tu chamarra y te dan una ficha con un número. Al salir das la ficha y te regresan tu chamarra, en segundos, haya 10 o 1,000 colgadas. Una base llave-valor es eso: con la llave, la respuesta es inmediata.

**Dónde se rompe:** al encargado le puedes preguntar «¿cuántas chamarras azules hay?», y aunque tarde, las cuenta. A una base llave-valor, no: no sabe nada de lo que hay dentro de los valores, y esa pregunta obliga a leerlo todo. Si no tienes la llave, no tienes nada.
:::

Por eso, en una base llave-valor, **la llave es la consulta**, y se diseña antes de escribir el primer dato. Se arman con un prefijo que dice qué es y el id: `user:123` para las recomendaciones de un usuario en M02, o `f:card:<token>` para las features de una tarjeta en C09.

¿Para qué sirve algo tan limitado? Para el camino online del modelo. Cuando llega una request, el modelo necesita las [[feature|features]] de **una** entidad: las de la tarjeta 42, las del vendedor de Ana. Siempre por su llave, siempre en milisegundos. Esa es la parte online de un [[feature-store|feature store]], el sistema que guarda las features para entrenar y para servir, de la lección siguiente: Redis, DynamoDB o Bigtable con el valor más reciente de cada entidad.

**DynamoDB** es la base llave-valor administrada de AWS: no manejas servidores, en su modo por demanda pagas por cada lectura y escritura, y AWS promete respuestas de unos pocos milisegundos (de un solo dígito), con los datos en SSD repartidos entre muchas máquinas y copiados en varias [[zona-disponibilidad|zonas]] (una zona es un grupo de centros de datos de la nube con su propia luz y su propia red, para que una falla no tumbe a las demás).

### Redis: llave-valor en la memoria

[[redis|Redis]] (de *Remote Dictionary Server*) es una base llave-valor que guarda todo en la RAM. Leer de la RAM toma ≈ 100 ns; de un SSD, ≈ 0.1 ms. Por eso lo que tarda una lectura de Redis es casi pura red: dentro de la misma zona, un `GET` toma ≈ 0.3 ms contando la ida y la vuelta, según la Ronda (C08).

Sus valores no son solo texto: también pueden ser un diccionario de campos (Redis lo llama *hash*, aunque no tiene que ver con la [[funcion-hash|función hash]] de la lección «Tiempo, hashes e identificadores»), una lista, un conjunto o un conjunto ordenado, cada uno con sus comandos.

:::profundo Las estructuras de Redis, con su uso en la Ronda
| Estructura | Qué guarda | Comandos | En la Ronda |
|---|---|---|---|
| String | un texto o un número | `GET`, `SET`, `INCR` | la predicción guardada de C01; la cuota de un rate limit |
| Hash | campos dentro de una llave, como un diccionario | `HSET`, `HGETALL` | las features de una tarjeta en C09 |
| List | una lista en orden | `LPUSH`, `RPOP` | una cola de trabajos sencilla |
| Set | un conjunto sin repetidos | `SADD`, `SISMEMBER` | los ids que ya se vieron |
| Sorted set | un conjunto ordenado por un puntaje | `ZADD`, `ZRANGE … BYSCORE` | los eventos de una tarjeta ordenados por su hora (M02) |
:::

Tres cosas más hacen a Redis tan común:

- **Vencimiento.** Cada llave puede llevar un [[ttl|TTL]]: `SET llave valor EX 3600` la borra sola en una hora. Es la misma idea del TTL del DNS: cuánto tiempo vale una copia.
- **Un comando a la vez.** Redis ejecuta los comandos de uno en uno, en un solo hilo (desde Redis 6 puede usar otros hilos para leer y escribir en la red, pero los comandos siguen en uno), así que dos `INCR` al mismo tiempo nunca pierden una cuenta. Por eso guarda el balde del [[rate-limit|rate limit]] que comparten las 4 copias del [[api-gateway|gateway]] de C10, como viste en la lección de balanceo.
- **Persistencia opcional.** Si Redis se reinicia, la RAM se borra. Puede guardar copias en el disco, pero aun así puede perder desde un segundo hasta varios minutos de escrituras (el bloque de abajo dice cuánto). Por eso suele guardar cosas que se pueden reconstruir, no el único registro de un pago.

:::profundo Cuánto puede perder Redis al reiniciarse
Hay dos formas de guardar en el disco. La primera es una foto de todo cada cierto tiempo (RDB, de *Redis Database*; es lo que trae encendido por omisión): si se reinicia, pierde los minutos desde la última foto. La segunda, que se suma a la primera, anota cada escritura al final de un archivo (AOF, *append-only file*, «archivo al que solo se le agrega»); con su ajuste por omisión (`appendfsync everysec`, bajarlo al disco cada segundo) puede perder hasta ≈ 1 segundo.
:::

La lección de su velocidad es que lo caro es el viaje, no la lectura. C07, el buscador de un marketplace, junta en cada búsqueda ≈ 400 publicaciones candidatas y revisa en Redis si alguna ya se vendió. C08, la página de inicio (*home*) de una app de recomendaciones, lee 800 llaves:

:::cuenta 400 llaves: una por una o de un jalón
Un GET por llave // cada uno es una ida y vuelta | 400 × 0.3 ms | 120 ms
MGET // las 400 llaves en un solo viaje (C07) | 1 ida y vuelta + 400 lecturas en RAM | ≈ 1–2 ms
C08, con 800 llaves de una en una | 800 × 0.3 ms | 240 ms
= El home de C08 tiene 200 ms para todo: de una en una, las lecturas solas ya se lo comen. Juntar llaves en un solo viaje, con `MGET` o con *pipelining* (mandar muchos comandos sin esperar cada respuesta), es lo primero que se hace.
:::

:::profundo Redis desde Python
Así se ve con `redis`, la biblioteca de Python. Es una ilustración: necesita instalarla y tener un servidor de Redis corriendo, y por eso no lleva su salida.

```python
import redis                                  # no viene con Python: pip install redis

r = redis.Redis(host="localhost", port=6379)  # el servidor de Redis
r.set("pred:3f9a:v12", "tenis", ex=86_400)    # la predicción de una foto, que vence en 1 día
r.get("pred:3f9a:v12")                        # b'tenis'
r.incr("cuota:equipo-7")                      # suma 1 y devuelve la cuenta nueva
r.hset("f:card:42", mapping={"compras_1h": 3, "monto_24h": 1850})   # un hash con features
r.mget(["tomb:101", "tomb:102", "tomb:103"])  # tres llaves en un solo viaje (las lápidas de la sección extra)
```
:::

¿Relacional o llave-valor? No compiten: casi todos los sistemas usan las dos. La relacional guarda la verdad del negocio y responde preguntas que nadie previó. La llave-valor sirve lo que el camino online pide por llave, rápido y a gran escala.

## Caché: guardar una copia cerca {Caching: keeping a copy close}

Un [[cache|caché]] (*cache*) es una copia de un resultado guardada en un lugar rápido y cercano, para no repetir el trabajo de calcularlo o de traerlo. Ya conoces tres: la [[cache-cpu|caché de la CPU]], que guarda en el chip lo que se leyó de la RAM; la [[page-cache|page cache]], que guarda en la RAM lo que se leyó del disco; y el caché del DNS, que guarda direcciones durante su [[ttl|TTL]]. En una app es lo mismo, un piso más arriba: una copia de lo que costó una consulta a la base o una inferencia, casi siempre en Redis.

Cada vez que pides algo, pasa una de dos:

- **Acierto** (*hit*): la copia está y se usa. Rápido.
- **Fallo** (*miss*): no está. Se hace el trabajo completo y, de paso, se guarda la copia para la próxima.

La **tasa de aciertos** (*hit rate*) es la fracción de pedidos que fueron aciertos. Con ella se calcula lo que el caché ahorra.

:::cuenta Lo que ahorra un caché de predicciones en C01
Tasa de aciertos // un supuesto de la Ronda (M02): hay que medirla en los logs | — | 20 %
Acierto // leer de Redis | — | ≈ 1 ms
Fallo // revisar Redis y luego ir a la GPU | 1 ms + 30 ms | 31 ms
Latencia promedio // contra 30 ms sin caché | 0.2 × 1 + 0.8 × 31 | 25 ms
Inferencias que se evitan al día // de las ≈ 10 M fotos diarias | 10 M × 0.2 | 2 M
Fotos por segundo a la GPU, en el pico | 500 × 0.8 | 400
= Ahorra 5 ms en promedio y una de cada cinco inferencias. El fallo sale 1 ms más caro que no tener caché: con una tasa baja, el caché puede costar más de lo que ahorra.
:::

Los 30 ms son la parte del presupuesto que la Ronda (M03) le da a la GPU.

### Cómo se usa: primero el caché

La forma más común se llama *cache-aside* («el caché a un lado»), porque la app lo maneja por su cuenta:

:::pasos
1. Busca en el caché
La app arma la llave y hace un `GET` a Redis.
2. Si está, úsala
Es un acierto: responde con la copia.
3. Si no está, haz el trabajo
Consulta la base o corre el modelo.
4. Guarda la copia con un TTL
Un `SET` con vencimiento, para que el siguiente pedido sea un acierto.
:::

La llave tiene que incluir **todo lo que cambia la respuesta**. La Ronda (M02) propone que C01 guarde cada predicción bajo el [[funcion-hash|hash]] de los bytes de la foto (un resumen corto que cambia si cambia un solo byte) más la versión del modelo. Si solo usara el hash, al salir un modelo nuevo el caché seguiría dando las respuestas del viejo.

:::diagrama bases-de-datos-cache
Toca cada caja para ver por qué está ahí, o usa «Recorrer» para seguir un acierto, un fallo y un cambio de precio.
:::

### Invalidar: cuando la copia queda vieja

El problema de toda copia es que el original cambia. Si Ana baja el precio y el caché sigue con el viejo, la página muestra 900 cuando ya cuesta 850. Hay dos herramientas, y casi siempre se usan las dos:

- **El [[ttl|TTL]]:** la copia caduca sola, como la respuesta del DNS de la lección de red. Un TTL de 5 minutos promete que nadie ve algo más viejo que 5 minutos. Es lo que hace el caché de consultas de C07.
- **Borrar al escribir** (*invalidar*): quien cambia el dato borra su llave del caché, y el siguiente pedido trae el valor nuevo.

:::profundo ¿Por qué borrar la copia y no actualizarla?
Si dos escrituras compiten, cada una actualiza la base y luego el caché, y el orden puede invertirse: la base queda en 850 y el caché en 900, el valor que perdió, hasta que venza el TTL. Si en vez de actualizar se borra la llave, el siguiente pedido la vuelve a llenar leyendo la base, que tiene el valor correcto. Aun así queda una carrera rara (un fallo que lee el valor viejo justo antes del cambio y lo guarda justo después del borrado), y por eso el TTL sigue haciendo falta como red de seguridad.
:::

:::profundo Cuando se llena: LRU
El caché vive en memoria, que es cara, así que tiene un tope. Cuando se llena, algo tiene que salir. La regla más común es **LRU** (*least recently used*): sale lo que lleva más tiempo sin usarse. Python la trae lista en `functools.lru_cache`, que guarda los resultados de una función y lleva la cuenta de aciertos y fallos.

El programa simula 20,000 pedidos sobre 5,000 fotos distintas: unas pocas se piden muchísimo y casi todas, poco, como en un marketplace de verdad.

```python
import random
from functools import lru_cache

random.seed(7)
fotos = range(5_000)                               # 5,000 fotos distintas
peso = [1 / (k + 1) for k in fotos]                # unas pocas se piden muchísimo; casi todas, poco
pedidos = random.choices(fotos, weights=peso, k=20_000)

for tamano in (50, 500, None):                     # None: un caché sin límite
    @lru_cache(maxsize=tamano)
    def clasificar(foto):                          # el trabajo caro: aquí sería el modelo
        return foto % 500                          # una «categoría» de mentira
    for foto in pedidos:
        clasificar(foto)
    info = clasificar.cache_info()
    tasa = info.hits / (info.hits + info.misses)
    print(f"caché de {str(tamano):>4}: {info.hits:>6,} aciertos, {info.misses:>5,} fallos, tasa {tasa:.0%}")
```

```salida
caché de   50:  7,000 aciertos, 13,000 fallos, tasa 35%
caché de  500: 13,011 aciertos, 6,989 fallos, tasa 65%
caché de None: 16,804 aciertos, 3,196 fallos, tasa 84%
```

Guardar solo 50 fotos, el 1 % de las distintas, ya da 35 % de aciertos, porque las más pedidas casi nunca salen. Diez veces más espacio llega a 65 %. Y ni un caché infinito pasa de 84 %: la primera vez que se pide cada foto siempre es un fallo.
:::

:::calculadora bases-de-datos-cache
Pon la tasa en 90 % y el trabajo en 5 ms, como un caché frente a una consulta de la base: el promedio baja de 5 a 1.5 ms. Luego baja la tasa a 3 % con el trabajo en 30: el caché ya cuesta más de lo que ahorra.
:::

Para C01, la Ronda (M02) concluye algo que vale para cualquier caché: lo que importa no es la tasa de aciertos, sino **cuánta capacidad te deja quitar**. Las dos GPUs T4 de C01 (una en cada zona) están ahí por si se cae una zona, y en promedio trabajan al ≈ 5 %; con 20 % de aciertos, al ≈ 4 %. No se puede quitar ninguna, y el caché agrega una pieza más que puede fallar.

## Copias de la base: réplicas, consistencia eventual y tombstones {Copies of the database: replicas, eventual consistency and tombstones} [extra]

Una publicación se escribe una vez y se lee miles: cada visita a su página, cada búsqueda que la muestra. Un solo servidor de base de datos se llena de lecturas mucho antes que de escrituras. La salida es tener copias.

### Primaria y réplicas de lectura

En el arreglo más común, una sola copia recibe todas las escrituras: la **primaria** (*primary*). Las demás son [[replica-lectura|réplicas de lectura]] (*read replicas*): reciben el registro de cambios de la primaria (en PostgreSQL es el WAL, *write-ahead log*: el archivo donde la base anota cada cambio antes de confirmarlo, el del bloque de la D de ACID; MySQL usa otro registro, el *binlog*), lo aplican en el mismo orden y atienden lecturas. Con una primaria y tres réplicas, las lecturas se reparten entre cuatro. Y si la primaria se cae, una réplica puede ascender a primaria.

El problema es que aplicar los cambios toma tiempo. El **retraso de replicación** (*replication lag*) es cuánto va atrás una réplica: normalmente de milisegundos (en Aurora, la base relacional administrada de AWS, sus réplicas en la misma región, el mismo grupo de zonas en una ciudad, suelen ir menos de 100 ms atrás), pero puede llegar a segundos o minutos si la primaria escribe mucho o la réplica está muy ocupada.

:::figura bases-de-datos-retraso
Ana baja el precio a 850 y, 100 ms después, recarga su página, que lee de una réplica. La réplica va 300 ms atrás y todavía dice 900. A partir de los 300 ms, las dos copias coinciden.
:::

### Leer lo que acabas de escribir

Para un comprador, ver el precio viejo unos milisegundos no importa. Para Ana, sí: cambió el precio, recargó y no cambió. Pensará que la app falló y lo cambiará otra vez. Garantizar que cada quien vea lo que él mismo escribió se llama *read your writes* («lee lo que escribiste»), y hay tres maneras comunes:

- Durante unos segundos después de que alguien escribe, sus lecturas van a la primaria.
- La app le muestra a Ana el valor que ella acaba de mandar, sin volver a leerlo.
- La app recuerda hasta qué punto del registro llegó la escritura y lee de una réplica que ya pasó de ahí.

La Ronda lo aplica en C09: las features que escribe el motor de streaming se leen de una réplica en la misma zona, porque toleran milisegundos de atraso; los contadores de los que depende la siguiente decisión van siempre a la primaria.

### Consistencia eventual

Lo que garantizan las réplicas tiene nombre: [[consistencia-eventual|consistencia eventual]] (*eventual consistency*). Si dejan de llegar cambios, todas las copias terminan con lo mismo; pero en un momento dado, dos copias pueden decir cosas distintas. Lo contrario es la **consistencia fuerte** (*strong consistency*): cualquier lectura ve la última escritura confirmada, venga de donde venga.

La fuerte es más cómoda y más cara: hay que esperar a que las copias se pongan de acuerdo antes de responder. Por eso muchas bases NoSQL leen con consistencia eventual por omisión. DynamoDB, por ejemplo, permite pedir una lectura fuerte por el doble del costo. Y todo caché con TTL es eventualmente consistente: su copia se pone al día cuando caduca.

:::ojo Dos «consistencias» distintas
La C de ACID quiere decir que se cumplen las reglas de la base (llaves únicas, `NOT NULL`). La consistencia de las réplicas quiere decir que todas las copias dicen lo mismo. Es la misma palabra para dos ideas, y en una entrevista conviene decir cuál.
:::

:::diagrama bases-de-datos-copias
Toca cada caja, o usa «Recorrer» para seguir un cambio de precio hasta las réplicas, a Ana leyendo su propio cambio y a un comprador que lee al mismo tiempo.
:::

### Tombstones: borrar dejando una marca

Con copias, borrar es más difícil de lo que parece. Si una copia borra una fila sin dejar rastro, cuando se compare con otra copia que todavía la tiene no hay forma de saber si la fila es nueva o si se borró: la falta de algo no viaja. En los sistemas que comparan sus copias para ponerse al día, la fila borrada **resucita**.

La solución es no borrar, sino escribir una marca: un [[tombstone]] (lápida), una versión nueva de la fila que dice «ya no existe». La lápida sí viaja a las copias, como cualquier cambio, y quien la lee trata la fila como borrada. Pasado un tiempo, cuando ya todas las copias la vieron, la lápida se puede quitar.

```python
BORRADA = None                         # el tombstone: una versión nueva que dice «ya no existe»

def sincronizar(a, b):                 # dos copias se ponen al día: gana la versión más nueva
    for llave in a.keys() | b.keys():
        mas_nueva = max(a.get(llave, (0, BORRADA)), b.get(llave, (0, BORRADA)))
        a[llave] = b[llave] = mas_nueva

def leer(copia):
    version, valor = copia.get("pub:7", (0, BORRADA))
    return "no existe" if valor is BORRADA else valor

for con_tombstone in (False, True):
    a = {"pub:7": (1, "Tenis naranjas")}           # (versión, valor) en cada copia
    b = dict(a)
    if con_tombstone:
        a["pub:7"] = (2, BORRADA)                  # borrar es escribir una versión nueva
    else:
        del a["pub:7"]                             # borrar de verdad: no queda rastro
    print("con tombstone" if con_tombstone else "sin tombstone")
    print(f"  antes de sincronizar: A = {leer(a)} · B = {leer(b)}")
    sincronizar(a, b)
    print(f"  después:              A = {leer(a)} · B = {leer(b)}")
```

```salida
sin tombstone
  antes de sincronizar: A = no existe · B = Tenis naranjas
  después:              A = Tenis naranjas · B = Tenis naranjas
con tombstone
  antes de sincronizar: A = no existe · B = Tenis naranjas
  después:              A = no existe · B = no existe
```

Los tombstones también sirven cuando borrar de verdad es lento. C07, la búsqueda de un marketplace, tiene sus publicaciones en un índice vectorial donde borrar es caro, y promete que una publicación vendida desaparece de los resultados en menos de un minuto. El índice se rehace cada cierto tiempo, y una copia de hace unos días puede seguir sirviendo. Su solución: al venderse, escribe en Redis una llave `tomb:{id}` que vence en 7 días, más que la edad máxima de una copia del índice. En cada búsqueda revisa sus ≈ 400 candidatos con un solo `MGET` de ≈ 1–2 ms y oculta los que tienen lápida. Son ≈ 17.5 M llaves por semana, ≈ 2 GB. C08 hace lo mismo para su home.

## Errores comunes {Common mistakes}

### 1. Filtrar por una columna sin índice

La consulta vuela en la computadora de quien la escribió, con 1,000 filas, y en producción, con 100 millones, tarda segundos y satura la base.

**Cómo evitarlo:** correr `EXPLAIN` antes de mandarla y buscar `SCAN` (o `Seq Scan` en PostgreSQL) sobre una tabla grande. Probar con datos del tamaño real.

### 2. Un índice para cada columna

«Si los índices aceleran, pongamos uno en todo.» Cada escritura se vuelve más lenta y el espacio se dispara, para índices que nadie usa.

**Cómo evitarlo:** indexar lo que de verdad aparece en `WHERE`, `JOIN` y `ORDER BY` de las consultas frecuentes, y revisar de vez en cuando qué índices no se usan.

### 3. Escribir varias cosas sin transacción

La publicación se guarda y su predicción no; el pago se registra y la orden no. Ningún error lo avisa.

**Cómo evitarlo:** todo lo que debe pasar junto va en una transacción. Y si una parte vive fuera de la base (mandar un mensaje, llamar a otro servicio), se escribe la intención en la misma transacción y otro proceso la ejecuta después: es el patrón *outbox* de la Ronda (M02).

### 4. Reintentar escrituras que no son idempotentes

Un `INSERT` sin llave o un `INCR` dentro de un job que se reintenta: cada reintento duplica filas o infla contadores.

**Cómo evitarlo:** una llave primaria en cada tabla, upsert con el valor absoluto («lleva 12», no «suma 3») y `ON CONFLICT DO NOTHING` para lo que solo debe pasar una vez.

### 5. Leer de una réplica lo que acabas de escribir

Ana cambia el precio, la página lee de una réplica atrasada y le muestra el viejo. Un job escribe y, enseguida, otro paso del mismo job lee de la réplica y no encuentra nada.

**Cómo evitarlo:** lo recién escrito por el mismo usuario o el mismo proceso se lee de la primaria; las réplicas, para lo que tolera unos segundos de atraso.

### 6. Un caché sin TTL o con la llave incompleta

El caché sigue dando el precio viejo o, peor, las predicciones del modelo anterior, porque la llave no incluía la versión del modelo.

**Cómo evitarlo:** que la llave incluya todo lo que cambia la respuesta, borrar la llave al escribir, ponerle siempre un TTL y medir la tasa de aciertos antes de decidir que el caché vale la pena.

## En la vida real {In real life} [extra]

### C01: el viaje de la publicación de Ana

Ana toca «Publicar». El backend abre una transacción en PostgreSQL, la base operacional: inserta la publicación con su `request_id`, la fila de cada foto con la dirección donde quedó en el object storage, y hace `COMMIT`. Si algo falla a la mitad, no queda nada y la app puede reintentar con la misma [[llave-idempotencia|llave de idempotencia]].

Cuando un comprador abre la publicación, la app la busca por su llave primaria: 4 páginas en un árbol B, casi siempre ya en la RAM. Las búsquedas por categoría o por vendedor usan sus propios índices. Y la Ronda deja como candidato un caché de predicciones en Redis, con llave hash de la foto más versión del modelo, que solo se pone si los logs muestran que la tasa de aciertos lo justifica.

Para medir el modelo, un job une cada día las publicaciones con las predicciones por `request_id` y cuenta en cuántas el top-1 fue la categoría final. No lo hace contra la base operacional: la Ronda (M09) advierte que «180 jobs a la vez contra la misma base operacional es un incidente para otro equipo». Los datos se copian cada día a un almacén para análisis, que es la diferencia entre [[oltp-olap|OLTP y OLAP]] (*online transaction processing*, muchas operaciones chicas, contra *online analytical processing*, pocas preguntas que leen muchísimo): la base que atiende la app contra la que responde preguntas grandes. Es tema de la lección siguiente.

### M02: predicciones de noche, servidas por llave

Un patrón de M02: en vez de llamar al modelo en cada visita, un job nocturno calcula las recomendaciones de los 50 M de usuarios y las deja en un llave-valor; el camino online solo hace `GET user:123`.

:::cuenta Lo que cuesta escribir 50 M de filas cada noche
Escrituras al mes | 50,000,000 × 30 noches | 1,500 millones
En DynamoDB por demanda // ≈ US$0.625 por millón de escrituras de hasta 1 KB (us-east-1, desde noviembre de 2024; la Ronda, M02) | 1,500 × 0.625 | ≈ US$940 al mes
La GPU del job, en cambio // 2.8 h × ≈ US$0.526 por hora (una g4dn.xlarge, la máquina de AWS con una T4, en us-east-1) × 30 noches, según la Ronda | — | ≈ US$45 al mes
Usuarios que entran cada día // de los 50 M | — | ≈ 5 M
= Escribir las predicciones cuesta ≈ 20 veces más que calcularlas, y el 90 % de esas filas nadie las lee ese día. La base no se elige solo por su velocidad: también por lo que cuesta cada escritura.
:::

### C09: el online store de un sistema de fraude

C09 decide en milisegundos si un pago es fraude. Sus features (cuántas compras hizo la tarjeta en la última hora, cuánto gastó en 24 horas) viven en Redis, una llave por entidad (`f:card:<token>`, `f:ip:<hash>`) con un hash de sus features. Son ≈ 80 M de llaves de tarjetas, dispositivos, IPs, correos y comercios, con ≈ 40 features de 4 bytes cada una más ≈ 100 bytes de llave y estructura: 80 M × 260 B ≈ 21 GB. Con las features diarias (≈ 10 GB), los contadores y un caché de decisiones, ≈ 35 GB; con ≈ 30 % extra que la propia estructura de Redis ocupa, ≈ 46 GB, repartidos en 4 pedazos ([[sharding|shards]]), cada uno con su primaria y una réplica en otra zona: 8 máquinas. Las escrituras van a la primaria; las lecturas de features, a la réplica de la misma zona.

### C12 y C15: Postgres, lejos de cada request

C12, un agente de atención a clientes, guarda en Postgres una bitácora de cada conversación: los mensajes, las herramientas que llamó y lo que decidió, ≈ 20 KB por conversación. Con ≈ 150,000 conversaciones al día son ≈ 3 GB diarios y ≈ 90 GB en 30 días, y la Ronda lo resume así: «90 GB caliente es un Postgres normal» (*caliente*: los datos que se consultan seguido). C15, un sistema de anuncios, guarda campañas, presupuestos y pausas en Postgres, pero no lo consulta en cada request: cada pod rehace cada minuto una copia en su memoria. Es un caché que se renueva cada minuto, y por eso pausar una campaña tarda hasta un minuto en notarse.

### Fuera de ML: el banco y el carrito

Una transferencia es el ejemplo de libro de una transacción: restar de una cuenta y sumar a la otra pasan juntas o no pasan. Ningún banco acepta «se restó, pero no se sumó».

El carrito de compras de Amazon es el ejemplo contrario. En 2007, Amazon publicó cómo funcionaba Dynamo, el sistema que lo guardaba (no es DynamoDB: el servicio de 2012 tomó su nombre y algunas ideas, pero es otro sistema): preferían que el carrito siempre aceptara cosas, aunque las copias no estuvieran de acuerdo, y juntarlas después. El precio de esa decisión: a veces un artículo que habías quitado reaparecía en el carrito. Para un carrito, aceptable; para un saldo, no.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de índices y caché se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] La tabla `usuarios` tiene las columnas `correo`, `nombre`, `ciudad` y `fecha_alta`. ¿Cuál sirve como llave primaria? Si ninguna, ¿qué agregarías?
- `nombre` y `ciudad` se repiten. `fecha_alta` también: miles de usuarios se dan de alta el mismo día.
- `correo` es único y siempre está, pero **no es estable**: la gente lo cambia, y cada tabla que apunta al usuario tendría que cambiar también.
- Agregaría una columna `id`, un número que asigna la base o un UUID, que nunca cambia. El correo puede llevar su propia regla `UNIQUE` para que no se repita, sin ser la llave.
? [facil] Escribe la consulta que da el título y el precio de las botas que cuestan menos de 1,000 pesos, de la más barata a la más cara. Con la tabla de la sección de SQL, ¿qué filas salen?
- `SELECT titulo, precio FROM publicaciones WHERE categoria = 'botas' AND precio < 1000 ORDER BY precio;`
- `ORDER BY` va de menor a mayor si no dices `DESC`.
- Sale una sola fila: **('Botas de lluvia', 450)**. Las de piel cuestan 1,500.
? [facil] Un caché recibió 1,000 pedidos y acertó 850. Un acierto tarda 1 ms; un fallo, 1 ms de revisar más 20 ms de ir a la base. ¿Cuál es la tasa de aciertos y la latencia promedio?
- Tasa: 850 ÷ 1,000 = **85 %**.
- Promedio: 0.85 × 1 + 0.15 × 21 = 0.85 + 3.15 = **4 ms**, contra 20 ms sin caché.
- La base recibe solo 150 de cada 1,000 pedidos.
? [facil] ¿Cuáles de estas preguntas puede responder bien una base llave-valor, con llaves `f:card:<token>`? (a) Las features de la tarjeta 42. (b) Todas las tarjetas con más de 3 compras en la última hora. (c) Las features de 300 tarjetas a la vez.
- (a) **Sí**: es un `GET` (o un `HGETALL`) de la llave `f:card:42`.
- (b) **No**: no hay índice por valor. Habría que leer las millones de llaves. Esa pregunta es para una base relacional o un almacén de análisis.
- (c) **Sí**, con un solo viaje: `MGET` o *pipelining* de las 300 llaves.
? [medio] Con la tabla de la sección de SQL, ya con los tenis de Ana en 850, calcula a mano qué devuelve `SELECT vendedor, COUNT(*), SUM(precio) FROM publicaciones GROUP BY vendedor`.
- ana: tenis (850) y bolsa (650): **2 publicaciones, 1,500**.
- beto: botas de piel (1,500) y sandalias (300): **2, 1,800**.
- carla: tenis blancos (1,200) y botas de lluvia (450): **2, 1,650**.
- Comprueba: 1,500 + 1,800 + 1,650 = 4,950, la suma de los seis precios.
? [medio] Ayer hubo 1,000 publicaciones; 950 tienen su predicción y en 760 el top-1 fue la categoría final. ¿Cuántas filas da el INNER JOIN y cuántas el LEFT JOIN? ¿Qué tasa de aciertos reportas, y qué más reportas?
- INNER: **950** filas. LEFT: **1,000**; las 50 de más traen `NULL` en la predicción.
- Aciertos: 760 ÷ 950 = **80 %** de las que tuvieron sugerencia.
- Reporta también el 5 % sin sugerencia (50 ÷ 1,000): son las veces que se usó el fallback. Si solo miras el INNER JOIN, esas 50 desaparecen.
? [medio] Una tabla de 1,000 millones de filas tiene un árbol B con ≈ 400 ramas por página. ¿Cuántos niveles necesita? ¿Cuántas páginas lee una búsqueda por llave, contando la de la tabla?
- 400² = 160,000; 400³ = 64 millones; 400⁴ = 25,600 millones. 1,000 millones no caben en 3 niveles, sí en **4**.
- Con logaritmos: log(10⁹) ÷ log(400) ≈ 3.46, y se redondea hacia arriba.
- Páginas: 4 del árbol + 1 de la tabla = **5**. Compruébalo en la calculadora: 1,000 millones de filas y 400 ramas por página.
? [medio] Un job escribe cada noche las ventas de la semana de cada vendedor con `UPDATE ventas SET ventas_7d = ventas_7d + :hoy`. Un día falla a la mitad y Airflow (el programa que agenda los jobs) lo reintenta completo. ¿Qué pasa? ¿Cómo lo arreglas?
- Los vendedores que ya se habían procesado antes de la falla reciben la suma **dos veces**: sus ventas quedan infladas, sin ningún error.
- Arreglo: calcular el valor absoluto de la ventana (las ventas de los últimos 7 días, contadas desde los datos) y escribirlo con upsert: `ON CONFLICT (vendedor) DO UPDATE SET ventas_7d = excluded.ventas_7d`. Repetirlo deja lo mismo.
- Mejor aún: todo en una transacción, o escribir una versión nueva de la tabla y, al final, hacer que la app lea esa (M02 lo llama mover el «puntero»).
? [reto] Ana cambia el precio a las 12:00:00.000. Su página lee de una réplica con 500 ms de retraso, y la app recarga a los 200 ms. ¿Qué ve? Propón dos arreglos y di qué cuesta cada uno.
- La réplica aplica el cambio a las 12:00:00.500. A los 200 ms todavía dice **el precio viejo**.
- Arreglo 1: durante unos segundos después de que Ana escribe, sus lecturas van a la primaria. Cuesta carga extra en la primaria, aunque es poca: solo las de quien acaba de escribir.
- Arreglo 2: la app muestra el precio que Ana mandó, sin volver a leerlo. No cuesta nada en la base, pero si la escritura falló, Ana ve algo que no se guardó: hay que avisarle del error.
- Lo que no arregla nada: esperar 200 ms más. El retraso cambia con la carga.
? [reto] El sistema de búsqueda de C07 escribe una llave `tomb:{id}` por cada publicación vendida o retirada, con TTL de 7 días. Si se venden o retiran ≈ 2.5 M al día, ¿cuántas llaves vivas hay? Si ocupan ≈ 2 GB, ¿cuánto pesa cada una? ¿Por qué no un TTL de 1 día, y por qué no sin TTL?
- Llaves vivas: 2.5 M × 7 días = **17.5 M**.
- Cada una: 2,000,000,000 B ÷ 17,500,000 ≈ **114 bytes**, contando la llave, el valor y lo que Redis ocupa por cada una.
- 1 día no alcanza: el TTL tiene que durar más que la copia más vieja del índice que pueda estar sirviendo. Si una copia de hace 3 días trae la publicación vendida y la lápida ya venció, la publicación reaparece.
- Sin TTL, la lista crece para siempre (≈ 900 M llaves al año, ≈ 100 GB) y casi todas ya no sirven, porque el índice ya se rehízo sin esas publicaciones.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M02 · Patrones de inferencia** usa todo esto: el llave-valor donde un job deja las predicciones nocturnas, el caché de predicciones con hash más versión, la tabla de deduplicación con `ON CONFLICT DO NOTHING`, el estado de cada trabajo con escritura condicional y el patrón *outbox*.
- **M09 · Datos** separa la base operacional del lago de datos, explica por qué no se entrena leyendo la base directo, pide que cada job sea idempotente (upsert o sobrescribir la partición, nunca agregar a ciegas) y arma el feature store con su parte online en un llave-valor.
- **Los casos.** C07 y C08 (tombstones en Redis y `MGET`), C09 (online store en Redis con réplicas por zona) y C01 (el join por `request_id`).

**En el Dojo:** la estación 1, «Datos y etiquetas», ya está abierta y usa SQL en casi cada paso: con DuckDB, una base para análisis que lee archivos Parquet directamente, juntas los logs del gateway con las publicaciones por `request_id`, cuentas con `GROUP BY` y cazas duplicados.

**En Sensei:** la siguiente lección, «Object storage, data lakes y warehouses», guarda lo que no cabe en una base: las fotos, los logs y los datasets, y separa la base de la app de la de análisis. Después, «Colas y streams» lleva los cambios de una base a otros sistemas, y «Tiempo, hashes e identificadores» explica los hashes, los UUID y el join *point-in-time*.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
base-datos tabla llave-primaria sql base-relacional join indice-bd transaccion upsert nosql llave-valor redis cache replica-lectura consistencia-eventual tombstone
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué tiene una base de datos que no tiene un archivo CSV?
Guarda los datos ordenados y con tipo, no pierde lo confirmado aunque se apague, deja que muchos programas escriban a la vez sin pisarse y responde consultas sin que tú recorras los datos.
? ¿Por qué un índice encuentra una fila entre 10 millones en unas 4 lecturas?
Porque es un árbol B: cada página trae ≈ 300 llaves en orden, y leer una descarta todo menos 1 de cada 300 caminos. Tres niveles alcanzan para 27 millones de llaves, y una lectura más trae la fila.
? ¿Qué cuesta un índice?
Cada escritura tiene que ponerlo al día, ocupa espacio (casi como la tabla, si las filas son chicas) y solo ayuda a las consultas sobre su columna.
? ¿Qué diferencia hay entre INNER JOIN y LEFT JOIN?
El INNER deja solo las filas con pareja en las dos tablas. El LEFT deja todas las de la izquierda y pone NULL donde no hubo pareja: así se ven, por ejemplo, las publicaciones sin predicción.
? ¿Qué es una transacción y qué pasa si el servidor se cae a la mitad?
Un grupo de escrituras que pasa completo o no pasa. Si se cae antes del COMMIT, al volver la base deshace lo que quedó a medias: nadie ve la publicación sin su predicción.
? ¿Por qué un upsert es idempotente y un INCR no?
El upsert deja la fila con un valor («lleva 12»): repetirlo deja lo mismo. El INCR suma: cada repetición suma otra vez.
? Si Ana cambia el precio y una réplica todavía muestra el viejo, ¿qué está pasando?
Retraso de replicación: la réplica aplica los cambios de la primaria un poco después, y eso es consistencia eventual. Arreglo: por unos segundos, las lecturas de Ana van a la primaria.
:::
