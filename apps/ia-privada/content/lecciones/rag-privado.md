---
titulo: RAG privado: embeddings y vector DB locales
en: Private RAG: local embeddings and vector databases
subtitulo: Todas las piezas que hay entre 30,000 expedientes y una respuesta con la página exacta, cuáles corren en el servidor del despacho, qué modelo de embeddings, qué base de vectores y qué reranker elegir, y cuánta memoria, cuántas noches y cuántos milisegundos piden.
pregunta: Un abogado pregunta «¿qué plazo de penalización firmamos con el proveedor X?» y quiere la respuesta con la página exacta, sin que un solo expediente salga de la red. ¿Qué piezas hay entre los expedientes y esa respuesta, dónde corre cada una y cuánto hardware y tiempo piden?
sensei: embeddings, bases-de-datos, identidad
dojo: rag
---

:::idea
Un [[rag|RAG]] privado son dos máquinas de trabajo distinto. **De noche**, la [[ingesta]] convierte los expedientes en texto limpio, los parte en [[chunk|chunks]] que recuerdan su página y sus permisos, los vuelve vectores con un [[modelo-de-embeddings|modelo de embeddings]] local y los guarda en una [[vector-db|base de vectores]] local. **En vivo**, cada pregunta busca por palabras y por significado al mismo tiempo, **solo entre lo que esa persona puede ver**, reordena los mejores candidatos y se los da al LLM, que contesta citando la página que viajó en el chunk. En el despacho lo caro no es lo que se cree. El índice cabe 67 veces en la RAM y los embeddings se hacen en una noche. Lo que se come las noches es leer los PDFs; lo que se come los milisegundos es el [[reranker]].
:::

## De la pregunta a la página: el mapa {From the question to the page: the map}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México con **30,000 expedientes** (≈ 1.5 millones de páginas, ≈ 50 por expediente) que quiere preguntarles con un LLM sin que un solo documento salga de su red. Lo usarían 200 personas, ≈ 3,000 preguntas al día, 750 en la hora pico (≈ 0.21 por segundo). El LLM ya está decidido: **Qwen3 32B en INT4 de [[awq|AWQ]]**, servido con [[vllm|vLLM]] en **3 GPUs L40S** dentro de un servidor con 384 GB de RAM. Cada pregunta le llega al modelo con ≈ 6,000 tokens: ≈ 400 de instrucciones, ≈ 100 de la pregunta y **5 fragmentos de expediente de ≈ 1,000 tokens**. De dónde salen esos 5 fragmentos es esta lección.

Una abogada escribe: «¿Qué plazo de penalización firmamos con el proveedor X?». Entre esa frase y la respuesta «30 días naturales, cláusula 14.3, expediente 4127, página 12» hay nueve piezas:

:::pasos
1. Ingesta
Leer los archivos del servidor de archivos o del gestor documental (DMS), sacar su texto (con [[ocr|OCR]] si son escaneos) y limpiarlo.
2. Chunking
Partir cada documento en pedazos de ≈ 1,000 tokens que recuerdan su expediente, su cliente y su página.
3. Permisos
Pegarle a cada chunk la lista de quién lo puede ver: su [[acl-por-chunk|ACL]].
4. Embeddings
Convertir cada chunk en un vector con un modelo que corre en el servidor.
5. Base de vectores
Guardar los vectores, el texto y los metadatos en un índice que encuentra los parecidos en milisegundos.
6. Búsqueda
Buscar por palabras ([[bm25|BM25]]) y por significado (vectores), filtrando por permisos **durante** la búsqueda, y juntar las dos listas.
7. Reranker
Releer los mejores candidatos junto con la pregunta y ordenarlos mejor.
8. Prompt con cita
Darle al LLM los 5 mejores con su expediente y su página, e instrucciones de contestar solo con ellos.
9. Respuesta
El LLM ya servido escribe la respuesta, y la aplicación revisa que la [[cita]] exista.
:::

Tres ideas que Sensei explica a fondo y aquí solo se recuerdan. Un **embedding** es una lista de números (un vector) que pone cerca a los textos que significan algo parecido; se comparan con el coseno, y con vectores normalizados el coseno es un producto punto. Buscar el más cercano entre millones se hace con un índice aproximado, y el más usado es **HNSW**, un grafo con atajos. Y la **búsqueda híbrida** corre BM25 (por palabras) y la búsqueda por vectores (por significado) en paralelo y junta sus listas. Todo eso está en [Embeddings: el significado como coordenadas](https://sensei.trueml.app/embeddings/). Cómo funcionan una base de datos y sus índices está en [Bases de datos](https://sensei.trueml.app/bases-de-datos/), y la diferencia entre saber quién eres y qué puedes ver, en [Autenticación y permisos](https://sensei.trueml.app/identidad/).

Lo nuevo aquí es lo que cambia por ser **privado**: cada pieza corre dentro de la red (nada de APIs de embeddings, de OCR o de reranking externas), cada pieza tiene una licencia que permite usarla en un negocio, y todo comparte el mismo servidor con un LLM que en la hora pico ya usa el ≈ 86.8 % de su capacidad de salida.

:::analogia El archivista y el fichero
Piensa en el archivo de un despacho antiguo. De noche, un archivista lee cada expediente, escribe una ficha por cada pedazo importante («penalización por retraso, exp. 4127, p. 12, solo el equipo del cliente A») y las ordena en un fichero. De día, cuando alguien pregunta, el archivista no relee 1.5 millones de páginas: va al fichero, saca las fichas que le tocan a esa persona, lee las 20 mejores con calma, y le entrega 5 con la página marcada. El LLM es el abogado que redacta la respuesta con esas 5.

Dónde se rompe: el archivista entiende lo que lee. El sistema no: si la ficha quedó mal cortada (la cláusula partida en dos) o sin página, nadie lo nota hasta que la respuesta sale sin cita o con la cita equivocada.
:::

## La ingesta: de los archivos al texto limpio {Ingestion: from files to clean text}

La [[ingesta]] es todo lo que pasa antes de que exista un solo vector. Es la pieza menos vistosa y la que más se rompe.

**Conectores.** Un conector por cada lugar donde viven los expedientes (el servidor de archivos de Windows, el DMS, el correo). Cada uno entra con una **cuenta de servicio de solo lectura**: la ingesta nunca debe poder borrar ni cambiar un expediente. El conector trae el archivo **y sus permisos**, porque sin permisos el chunk no se puede indexar (lo ves dos secciones abajo).

**Parsing.** Sacar el texto con su estructura: títulos, listas, cláusulas numeradas y tablas. Un PDF hecho en Word ya trae su texto adentro: solo hay que leerlo. Un PDF **escaneado** es una foto de cada página: ahí hace falta [[ocr|OCR]] (*optical character recognition*, reconocer letras en una imagen). Las tablas se guardan **fila por fila con su encabezado**, para que «Penalización · 2 % mensual» no quede como dos palabras sueltas.

**Texto guardado por su huella.** El texto limpio de cada documento se guarda con el sha256 de su contenido (una huella de 64 caracteres que cambia si cambia una letra). Si mañana se vuelve a correr la ingesta, lo que no cambió no se vuelve a leer, y si se cambia el modelo de embeddings, no hay que repetir el OCR.

**El número de página viaja siempre.** Todo lo de arriba conserva en qué página estaba cada línea. Es lo que después permite citar «p. 12» sin pedirle al LLM que lo adivine.

:::diagrama rag-privado-ingesta
La ingesta de noche, máquina por máquina: de dónde sale cada archivo, qué corre en la CPU del servidor y qué en la GPU. Toca cada caja, o sigue el recorrido de un expediente nuevo.
:::

### Las herramientas, con su licencia

A noviembre de 2026 (repositorios consultados el 26), estas son las herramientas abiertas de parsing y OCR que tiene sentido mirar:

| Herramienta | Versión (fecha) | Licencia | Para qué |
|---|---|---|---|
| Docling | 2.154.0 (26-nov-2026) | MIT (el código; cada modelo trae la suya) | PDF, Word, PowerPoint y HTML a texto con estructura y tablas; varios motores de OCR adentro |
| Unstructured | 0.27.38 (24-nov-2026) | Apache 2.0 | Partir PDFs, Word y correos; para PDF usa Tesseract y Poppler |
| Tesseract | 5.5.5 (26-nov-2026) | Apache 2.0 | OCR clásico, con modelo de español (`spa`); sin tablas ni diseño de página |
| OCRmyPDF | 17.14.2 (16-nov-2026) | MPL 2.0 | Le agrega a un PDF escaneado su capa de texto (con Tesseract), página por página |
| PaddleOCR | 3.7.0 (11-jun-2026) | Apache 2.0 | OCR de 50 idiomas con un modelo; sin dato verificado de su calidad en español |
| Marker | 2.2.0 (12-nov-2026) | Código Apache 2.0; **pesos con licencia OpenRAIL-M modificada** | Parsing rápido con modos con y sin OCR |

:::ojo
Marker es la trampa de la tabla. Su código es Apache 2.0, pero los pesos de los modelos que usa tienen otra licencia: gratis para investigación, uso personal y startups con menos de US$5 millones de ingresos o fondeo; arriba de eso, licencia de pago. Revisa las dos licencias de cada herramienta, como harías con un modelo ([Licencias](/licencias/)).
:::

### Cuánto tarda leer 1.5 millones de páginas

Nadie publica cuánto tarda cada herramienta con escaneos de contratos mexicanos. Lo que hay son cifras de un proveedor (Datalab, el que hace Marker, con su propio benchmark, en un solo equipo que no describe: Docling y los modos de Marker con modelo, en una GPU; Tesseract y el modo sin OCR, en CPU) y un informe técnico de IBM de 2024 sobre Docling. Úsalas para el orden de magnitud, no como veredicto.

:::formula Noches de parsing
h_p = frac{P}{v × 3,600}
n_p = frac{h_p}{H}
- P: páginas a leer
- v: páginas por segundo que procesa la herramienta
- h_p: horas de parsing
- H: horas libres por noche (de 19:00 a 9:00 son 14)
- n_p: noches de parsing
:::

:::cuenta El parsing del despacho, con Tesseract
Páginas, \(P\) // la ficha del despacho | 1.5 M | 1,500,000
Velocidad, \(v\) // Tesseract 5 en la medición de Datalab | 2.9 pág/s | 2.9
Horas, \(h_p\) | 1,500,000 ÷ (2.9 × 3,600) | ≈ 144 h
Noches, \(n_p\) // \(H\) = 14 | 144 ÷ 14 | ≈ 10.3 noches
Con Docling a 2.1 pág/s (misma medición, en una GPU) | 1,500,000 ÷ (2.1 × 3,600) ÷ 14 | ≈ 14 noches
Con Marker sin OCR a 57 pág/s (benchmark del proveedor; en otra parte de su README dice 24–33) | 1,500,000 ÷ (57 × 3,600) | ≈ 7.3 h
= Leer los PDFs cuesta de media noche a dos semanas de noches, según la herramienta y cuántos sean escaneos.
:::

Dos lecciones salen de ahí. La primera: nadie sabe cuántas de las páginas del despacho son escaneos, y es el dato que más mueve la cuenta (si fueran el 20 %, supuesto, serían 300,000 páginas de OCR, ≈ 29 horas con Tesseract). La segunda: **antes de elegir herramienta, se miden 200 páginas reales del despacho**, con contratos escaneados, tablas y anexos, y se revisa a mano si el texto y las páginas salieron bien.

## Chunks: cortar sin perder la página {Chunks: cutting without losing the page}

Un [[chunk]] es un pedazo de documento con su propio vector. Es la unidad que se busca, se reordena y se le da al LLM. Su tamaño no es una preferencia: lo fijan tres cosas.

- **El prompt.** El despacho le da al modelo 5 fragmentos de ≈ 1,000 tokens (los ≈ 6,000 de entrada de la ficha). Si el chunk que se busca es el mismo que se entrega, mide ≈ 1,000.
- **El modelo de embeddings.** Cada modelo lee un máximo de tokens; lo que pasa de ahí se corta en silencio. Un modelo de 512 tokens no puede embeber un chunk de 1,000. Por eso un sistema con un modelo chico usa chunks de ≈ 400, y uno con un modelo de contexto largo puede usar 1,000. El tamaño depende del modelo y del documento.
- **El documento.** Un contrato tiene cláusulas, y una cláusula partida a la mitad pierde su sentido. Se parte **por estructura**: cada sección empieza un chunk, los bloques van enteros, y cada chunk lleva en su primera línea la **ruta de títulos** («Contrato de suministro › Cláusula 14 › 14.3 Penas convencionales»). El **traslape** (repetir los últimos ≈ 100 tokens al principio del siguiente) solo se usa cuando el corte cae a media sección.

Y una regla de oficio: los tokens se cuentan **con el tokenizador del modelo de embeddings**, no dividiendo caracteres entre 4. Cada tokenizador parte distinto, y el español gasta más tokens por palabra que el inglés.

:::formula Cuántos chunks salen
N = frac{T}{c - s}
- T: tokens de todos los documentos
- c: tamaño máximo del chunk, en tokens
- s: traslape entre chunks seguidos, en tokens
- N: número de chunks
:::

:::cuenta Los chunks del despacho
Tokens por expediente // caso pesado: 50 páginas × ≈ 500 palabras × 1.61 tokens por palabra | 40,250 | 40,250
Tokens totales, \(T\) // 30,000 expedientes | 30,000 × 40,250 | 1,207.5 M
Tamaño del chunk, \(c\) // el de los fragmentos del prompt | 1,000 tokens | 1,000
Traslape, \(s\) // en todos los cortes: la cota alta | 100 tokens | 100
Chunks, \(N\) | 1,207.5 M ÷ (1,000 − 100) | ≈ 1.34 M
Tokens a embeber // el traslape se embebe dos veces | 1.34 M × 1,000 | ≈ 1,342 M
= Alrededor de 1.34 millones de chunks; sin traslape, 1.21 M; con chunks de 400, de 3 a 4 millones.
:::

Los 1.61 tokens por palabra son una estimación de otra lección, no una medición con el tokenizador del modelo que se elija: se miden con expedientes reales en el piloto.

### La página dentro del chunk

Un chunk de 1,000 tokens no cabe en una página de ≈ 805: casi siempre cruza de una a otra. Míralo con un expediente del caso pesado:

```python
tokens_pagina = 805                     # caso pesado del despacho
paginas = 50                            # un expediente
tam, traslape = 1000, 100               # tamaño del chunk y traslape, en tokens

inicio, chunks, dos_paginas = 0, [], 0
total = tokens_pagina * paginas
while inicio < total:
    fin = min(inicio + tam, total)
    p1, p2 = inicio // tokens_pagina + 1, (fin - 1) // tokens_pagina + 1
    chunks.append((p1, p2))
    dos_paginas += p1 != p2
    if fin == total:
        break
    inicio = fin - traslape

print("chunks del expediente:", len(chunks))
print("primeros tres (página inicial, página final):", chunks[:3])
print(f"chunks que cruzan de página: {dos_paginas} de {len(chunks)}")
```

```salida
chunks del expediente: 45
primeros tres (página inicial, página final): [(1, 2), (2, 3), (3, 4)]
chunks que cruzan de página: 44 de 45
```

Si el chunk solo guardara «páginas 12–13», la respuesta citaría dos páginas y la abogada tendría que buscar. La solución es dejar **marcas de página dentro del texto** del chunk (`[p. 12]` … `[p. 13]`) y pedirle al modelo que cite la marca que precede a la frase que usa. El número sale del documento, nunca de la memoria del modelo.

:::figura rag-privado-chunk
Un chunk del despacho por dentro: la ruta de títulos, el texto con sus marcas de página, y los metadatos que viajan con él (expediente, cliente, páginas, permisos, huella del texto y versión del modelo).
:::

## Permisos dentro de cada chunk {Permissions inside each chunk}

En un despacho no todos pueden ver todo. La [[muralla-etica|muralla ética]] es la regla que separa a los equipos: quien trabaja un asunto no puede ver los expedientes de un cliente con el que el despacho tiene un conflicto de interés en ese asunto. Si la búsqueda la ignora, el sistema le entrega a una asociada un fragmento que no debía ver, y lo hace con cita y número de página. Es la falla más grave que puede tener este sistema.

### La ACL va en el chunk, en grupos

Cada chunk lleva la [[acl-por-chunk|ACL]] (*access control list*, lista de control de acceso) de su documento, copiada tal cual. Tres reglas:

- **En grupos, no en personas.** «equipo-cliente-A, socios» en vez de 40 nombres. Las personas entran y salen de los grupos todos los días; los grupos de un expediente casi no cambian. Los grupos de cada persona se resuelven **al preguntar**, con su identidad del [[sso|SSO]] de [[entra-id|Entra ID]].
- **Sin ACL, no se indexa.** Si un documento llega sin permisos o con permisos rotos, nadie lo ve (*fail-closed*, cerrado por omisión). Un documento que nadie encuentra es una molestia; uno que todos encuentran es un incidente.
- **El permiso nunca está en el prompt.** Escribirle al LLM «no uses los fragmentos del cliente B» no sirve: el fragmento ya llegó y el modelo lo puede repetir. El filtro va **dentro de la búsqueda**, y se revisa otra vez justo antes de armar el prompt.

### Filtrar antes o después de buscar

El filtro puede ir en dos lugares, y la diferencia es enorme. Con **[[prefiltro]]**, el índice solo considera los chunks que la persona puede ver mientras recorre el grafo. Con **post-filtro**, el índice trae sus mejores candidatos de entre todos, y después se tiran los prohibidos.

:::formula Lo que sobrevive a un post-filtro
k_{post} ≈ e × p
- e: candidatos que junta el recorrido del grafo antes del filtro (en pgvector, `hnsw.ef_search`, 40 por omisión)
- p: fracción de los chunks que la persona puede ver
- k_{post}: chunks que quedan, en promedio, si el filtro no tiene que ver con la pregunta
:::

:::cuenta Una asociada que ve solo los expedientes de su equipo
Candidatos del índice, \(e\) // el valor por omisión de pgvector | 40 | 40
Lo que ve, \(p\) // supuesto: su equipo es el 3 % del despacho | 3 % | 0.03
Sobreviven, \(k_{post}\) | 40 × 0.03 | ≈ 1.2 chunks
Lo que pide el prompt | 5 fragmentos | 5
Una socia que ve el 90 % | 40 × 0.9 | ≈ 36
= Con post-filtro, a quien ve poco le llega casi nada; a quien ve casi todo, no le pasa nada. La falla se esconde en las pruebas con usuarios de TI que lo ven todo.
:::

:::figura rag-privado-filtro
Los mismos 40 candidatos, con post-filtro y con prefiltro, para alguien que puede ver el 3 % de los chunks.
:::

:::profundo La misma cuenta, simulada
Una simulación con 100,000 chunks al azar, de los que la persona ve ≈ 3 %:

```python
import random
random.seed(7)

N, ve, ef, k = 100_000, 0.03, 40, 5        # chunks, fracción que la persona puede ver, candidatos, top-k
chunks = [(random.random(), random.random() < ve) for _ in range(N)]   # (parecido, ¿puede verlo?)

# Post-filtro: el índice devuelve los ef más parecidos y DESPUÉS se tiran los prohibidos
candidatos = sorted(chunks, key=lambda c: -c[0])[:ef]
post = [c for c in candidatos if c[1]][:k]

# Pre-filtro: el índice solo recorre los permitidos
pre = sorted((c for c in chunks if c[1]), key=lambda c: -c[0])[:k]

print(f"permitidos: {sum(c[1] for c in chunks):,} de {N:,}")
print(f"post-filtro: {len(post)} chunks llegan al prompt (se esperaban {k})")
print(f"pre-filtro:  {len(pre)} chunks llegan al prompt")
```

```salida
permitidos: 3,022 de 100,000
post-filtro: 2 chunks llegan al prompt (se esperaban 5)
pre-filtro:  5 chunks llegan al prompt
```

(Sale 2 y no 1.2 porque es una sola corrida: el 1.2 es el promedio.)
:::

Peor que «llegan menos»: los que llegan no son los mejores que esa persona podía ver, sino los que sobrevivieron por suerte. La respuesta sale sin la página correcta, y el sistema no avisa.

:::profundo Quitar un permiso sin reindexar
Cuando alguien sale de un equipo, su acceso tiene que caer en minutos, no en la próxima ingesta. Como la ACL del chunk está en grupos, quitar a una persona de un grupo **no toca el índice**: cambia la lista de grupos que se resuelve al preguntar. Solo cuando cambian los permisos **del documento** hay que actualizar los chunks, y eso es actualizar metadatos, no volver a calcular vectores. Conviene un carril rápido: el cambio llega como evento, se aplica en minutos y queda en una bitácora; la reindexación periódica no debe pisarlo (gana la ACL con la hora más reciente).
:::

:::ojo
Los vectores no son anónimos. Morris y su equipo (2023, *Text Embeddings Reveal (Almost) As Much As Text*) recuperaron exactamente el 92 % de textos de 32 tokens a partir de sus embeddings, y nombres de personas en notas clínicas. Un índice vectorial se protege como los expedientes mismos: mismo cuarto, mismos permisos, mismos respaldos cifrados.
:::

## El modelo de embeddings: cuál y por qué {The embedding model: which one and why}

El [[modelo-de-embeddings|modelo de embeddings]] es el que convierte cada chunk y cada pregunta en un vector. No es el LLM: es un modelo mucho más chico (de cientos de millones a unos miles de millones de parámetros) que no escribe nada, solo lee. Para el despacho tiene que cumplir cuatro cosas: licencia que permita usarlo en un negocio, buen español, contexto de al menos ≈ 1,100 tokens (un chunk y su ruta de títulos) y correr en el servidor.

### Los candidatos

Model cards de Hugging Face consultadas el 26 de noviembre de 2026; los pesos son parámetros × 2 bytes (bf16). Los puntajes son del [[leaderboard]] público MTEB, consultado el mismo día: «MMTEB» es su benchmark multilingüe v2 (131 tareas) y «Legal» la media de recuperación de su benchmark legal (8 tareas, en chino, inglés y alemán).

| Modelo | Licencia | Parámetros | Dimensiones | Contexto | Pesos | MMTEB media · recuperación | Legal |
|---|---|---|---|---|---|---|---|
| Qwen3-Embedding-0.6B | [[apache-2\|Apache 2.0]] | 596 M | 1,024 (recortable de 32 a 1,024) | 32 K | 1.19 GB | 64.34 · 64.65 | 64.20 |
| Qwen3-Embedding-4B | Apache 2.0 | 4,022 M | 2,560 | 32 K | 8.04 GB | 69.45 · 69.60 | 69.55 |
| Qwen3-Embedding-8B | Apache 2.0 | 7,567 M | 4,096 | 32 K | 15.13 GB | 70.58 · 70.88 | 71.73 |
| harrier-oss-v1-0.6b (Microsoft) | [[licencia-mit\|MIT]] | 596 M | 1,024 | 32,768 | 1.19 GB | 69.01 · 70.75 | 60.93 |
| granite-embedding-311m-multilingual-r2 (IBM) | Apache 2.0 | 312 M | 768 (recortable) | 32,768 | 0.62 GB | 55.96 · 65.21 | — |
| EmbeddingGemma 2 (Google) | Apache 2.0 | 270 M de texto | 768 (recortable) | 8,192 | ≈ 0.54 GB (texto) | 60.52 · 60.60 | — |
| BAAI/bge-m3 | MIT | ≈ 568 M | 1,024 | 8,192 | 1.14 GB | sin media · 54.59 | — |
| multilingual-e5-large-instruct | MIT | 560 M | 1,024 | **514** | 1.12 GB | 63.22 · 57.11 | 54.87 |
| jina-embeddings-v5-text-small | **CC-BY-NC-4.0** | 596 M | 1,024 | 32 K | — | sin media · 64.88 | 64.28 |

Cómo se lee, sin engañarse:

- **Licencia primero.** Jina v5 es la mejor de su tamaño en varias tablas, pero es [[licencia-no-comercial|no comercial]]: un despacho no la puede usar. Igual su reranker.
- **El contexto descarta.** multilingual-e5 lee 512 tokens: un chunk de 1,000 se cortaría a la mitad sin aviso.
- **El primer lugar general no es el primer lugar legal.** harrier-0.6b le gana a Qwen3-0.6B en la media multilingüe, pero declaró haber entrenado con datos de varias tareas del benchmark (solo el 78 % de sus tareas son nuevas para él, contra el 99 % de Qwen3). No es trampa, pero infla la media, igual que la [[contaminacion|contaminación]] infla un benchmark de LLMs. En las tareas legales, nuevas para todos, Qwen3-0.6B saca 64.20 contra 60.93.
- **No hay benchmark legal en español.** El benchmark legal de MTEB es en chino, inglés y alemán, y el benchmark de español de MTEB tiene huecos: a varios modelos les faltan tareas y no tienen media. Ningún puntaje público dice cómo le va a un modelo con un contrato mexicano. Eso solo lo dice el examen del despacho.

### La decisión del despacho

**Qwen3-Embedding-0.6B para el piloto.** Razones: Apache 2.0; 1,024 dimensiones; 32 K de contexto (sobra para chunks de 1,000); 1.19 GB de pesos, que deberían caber en la memoria que le sobra a una L40S (se comprueba en el piloto); el mejor puntaje legal de su tamaño entre los de licencia permisiva; y soporte de primera en vLLM, el motor que el TI ya está aprendiendo. **Se compara en el piloto con Qwen3-Embedding-4B**: +5 puntos en las tareas legales, pero ≈ 8 veces el cómputo por token y 2.5 veces el índice. Se sube solo si el examen lo pide.

Un detalle de uso que cambia los resultados: Qwen3-Embedding pide una **instrucción solo en la pregunta** (`Instruct: <la tarea>\nQuery: <la pregunta>`), escrita en inglés aun si la pregunta es en español; los chunks van sin nada. Su model card dice que sin instrucción se pierde entre 1 % y 5 %. Y como el modelo fija el tokenizador, el contexto, las dimensiones y el índice, **cambiarlo después obliga a reindexar todo** (tiene su sección más abajo).

## Servirlo dentro: vLLM en modo pooling {Serving it inside: vLLM in pooling mode} [extra]

El modelo de embeddings necesita un servidor, igual que el LLM. En vLLM eso se llama **modo pooling**: *pooling* es juntar lo que el modelo calculó para cada token en un solo vector por texto. Como el despacho ya opera [[vllm|vLLM]], lo natural es otro proceso de vLLM en el puerto 8001, que es justo lo que el [[gateway-de-llm|gateway]] ya tiene apuntado con el nombre `embeddings`.

```bash
# Ilustrativo, vLLM 0.34.0 (16-nov-2026): el modelo de embeddings del despacho
vllm serve Qwen/Qwen3-Embedding-0.6B --runner pooling --max-model-len 8192 \
  --served-model-name embeddings --api-key "$VLLM_CLAVE" --port 8001
```

- `--runner pooling` le dice a vLLM que este modelo no genera: lee y devuelve un vector por texto (el del último token, normalizado). La documentación dice que casi siempre vLLM lo detecta solo, pero Qwen3-Embedding tiene la arquitectura de un modelo que genera, así que conviene escribirla y no depender de esa detección. En versiones viejas se escribía `--task embed`; **en la 0.34.0 esa bandera ya no existe**. Si un tutorial la usa, es de otra época.
- `--max-model-len 8192`: el modelo admite 32 K, pero ningún chunk del despacho pasa de ≈ 1,100 tokens; no hace falta más.
- Las rutas: `/v1/embeddings` (la de OpenAI, la que usa el gateway). Existen también `/score` y `/rerank`, pero con un modelo de embeddings solo calculan el coseno entre dos vectores. El reranker es **otro proceso** de vLLM con su propio modelo; su documentación da el arranque de Qwen3-Reranker-0.6B, con un `--hf_overrides` que le dice cómo leer sus respuestas «sí» y «no».

En el gateway (la lección [Gateway](/gateway/)) solo se llena el hueco que quedó:

```yaml
  - model_name: embeddings
    litellm_params: {model: hosted_vllm/embeddings, api_base: http://vllm-emb:8001/v1, api_key: os.environ/VLLM_KEY}
```

La documentación de vLLM avisa algo honesto: los modelos de este tipo se soportan «por conveniencia», sin garantía de ser más rápidos que otras bibliotecas. La alternativa es **TEI** (*Text Embeddings Inference*, de Hugging Face, 1.10.0 del 25 de noviembre de 2026, Apache 2.0), un servidor solo para embeddings que lista Qwen3-Embedding entre sus modelos y también habla `/v1/embeddings`. El despacho se queda con vLLM por tener una sola herramienta que aprender; si el piloto mide que TEI es mucho más rápido, se cambia sin tocar el gateway.

### ¿En qué GPU vive?

Cada L40S tiene 43.2 GB útiles y el LLM usa 38.50 (19.32 de pesos + 17.18 de [[kv-cache|KV cache]] + 2 del programa): sobran ≈ 4.7 GB. Si cada proceso de vLLM pide ≈ 2 GB de programa, como el del LLM (supuesto), el de embeddings 0.6B ocupa ≈ 1.19 + 2 ≈ 3.2 GB: cabe en ese hueco. El 4B (8.04 GB de pesos) no. El reranker 0.6B pide otro tanto, y los dos juntos (≈ 6.4 GB) ya no caben en la misma tarjeta: lo natural es uno en el hueco de una L40S y el otro en el de otra. Lo que no está probado es cómo convive un segundo proceso con el KV cache del LLM, que en la 0.34.0 se dimensiona con la memoria libre: se prueba en el piloto, en la GPU rentada. Si no conviven bien, la salida es una GPU chica en la cuarta ranura del servidor para embeddings y reranker (las opciones están en el [catálogo](/herramientas/catalogo/)).

## La base de vectores {The vector database}

Una [[vector-db|base de vectores]] guarda los vectores con su texto y sus metadatos, y responde «dame los 20 más parecidos a este vector, solo entre los que cumplen este filtro» en milisegundos, con un [[indice-hnsw|índice HNSW]]. Para el despacho importan cinco cosas: que el filtro de permisos vaya **dentro** de la búsqueda, que tenga BM25 para la parte por palabras, su licencia, su memoria y que un TI de 2 personas que nunca operó una base vectorial la pueda mantener.

Versiones y documentación consultadas el 26 de noviembre de 2026:

| Motor | Versión | Licencia | Filtro de permisos | BM25 | Para operar |
|---|---|---|---|---|---|
| **Qdrant** | 1.20.2 (16-nov-2026) | Apache 2.0 | Dentro de la búsqueda: el HNSW agrega aristas por cada campo indexado | Sí, desde la 1.20.0, y fusión en la misma consulta | Un solo programa; **sin autenticación por omisión** |
| **pgvector** | 0.8.7 sobre PostgreSQL 19 | Licencia de PostgreSQL | Post-filtro; desde la 0.8.0, escaneo iterativo que sigue buscando hasta juntar k | No: texto completo de Postgres (no es BM25), o la extensión ParadeDB, que es AGPL | El más fácil si ya hay Postgres |
| Milvus | 3.0.6 (11-nov-2026) | Apache 2.0 | Antes de la búsqueda o iterativo | Sí | El más pesado: aun en un solo nodo, etcd y MinIO a un lado |
| Weaviate | 1.41.0 (23-nov-2026) | BSD-3 **más** una carpeta con licencia empresarial | Prefiltro (ACORN por omisión) | Sí | Un programa; revisar qué funciones son de pago |
| OpenSearch | 3.10.1 (24-nov-2026) | Apache 2.0 | Filtros eficientes en k-NN | Es lo suyo | Java, nodos, ajustes de memoria |
| Elasticsearch | 9.5.7 (23-nov-2026) | AGPLv3 / SSPL / ELv2 | Filtro dentro de `knn` | Es lo suyo | Igual que OpenSearch |
| Chroma | 1.5.9 (5-may-2026) | Apache 2.0 | Filtro sobre metadatos (sin verificar si antes o después) | Como vector disperso | Pensado para prototipos |
| LanceDB | 0.41.0 (29-oct-2026) | Apache 2.0 | SQL sobre metadatos (sin verificar) | Sí | Una biblioteca dentro de tu programa, sin servidor |

### La decisión del despacho

**Qdrant 1.20.2, en un contenedor, en el mismo servidor.** Razones:

1. El filtro de la muralla ética se aplica **durante** la búsqueda, con documentación propia de cómo hacerlo: campos `acl` y `cliente_id` indexados como `keyword` (valores exactos, sin partir en palabras), creados **antes** de ingestar.
2. BM25, vectores y la fusión de las dos listas en **una sola consulta**.
3. Tiene una fórmula de memoria publicada (la usas en la sección siguiente).
4. Un solo proceso: sin Java, sin etcd ni almacenamiento de objetos que cuidar.
5. Apache 2.0, sin carpetas de pago.

**La alternativa honesta es pgvector.** El TI ya va a operar un PostgreSQL para el gateway; con pgvector los permisos viven junto a los expedientes, con los respaldos, réplicas y permisos de SQL que ya conoce, y a 1.34 M de chunks cualquier motor alcanza. Su precio: hay que activar el escaneo iterativo (`hnsw.iterative_scan`) para no caer en el post-filtro de la cuenta de arriba, y no tiene BM25 de verdad. Si TI prefiere una sola base, es una elección defendible; lo que no es defendible es pgvector con el post-filtro por omisión.

Así se ve el filtro de una asociada en Qdrant (ilustrativo; la forma de las condiciones es la de su documentación de filtros, 1.20):

```json
{
  "must":     [ { "key": "acl",        "match": { "any": ["equipo-cliente-a", "litigio-civil"] } } ],
  "must_not": [ { "key": "cliente_id", "match": { "any": ["cl-0442"] } } ]
}
```

`must` con `any`: el chunk tiene al menos uno de los grupos de la persona. `must_not`: nunca un chunk del cliente en conflicto, aunque un grupo lo deje pasar. Los grupos salen del directorio en el momento de preguntar; el servicio de búsqueda los arma, nunca la persona.

:::ojo
Qdrant abierto **no trae autenticación activada**: contesta a cualquiera que lo alcance en la red. Desde el primer día: llave de API (Qdrant tiene llaves de solo lectura para el servicio de búsqueda), TLS (la conexión cifrada, el mismo candado de un sitio `https`), y su puerto alcanzable solo desde el servicio de búsqueda y la ingesta. Una base de vectores abierta en la red interna es una copia de los expedientes al alcance de cualquier laptop infectada.
:::

## Cuánta memoria y disco pide el índice {How much memory and disk the index needs}

Sensei cuenta la memoria de un índice como vectores más grafo. Qdrant publica su propia versión en su guía de *capacity planning*, con un 20 % extra para las capas del grafo y la contabilidad interna:

:::formula Memoria del índice en Qdrant
M = N × d × b + N × m × 2 × 4 × 1.2
- N: número de chunks (vectores)
- d: dimensiones de cada vector
- b: bytes por número (float32 = 4, float16 = 2, int8 = 1)
- m: conexiones por nodo del HNSW (16 por omisión); cada conexión es un número de 4 bytes y hay 2m en la capa de abajo
- M: memoria del índice, en bytes
:::

:::cuenta El índice del despacho
Chunks, \(N\) // la cuenta de la sección de chunks | 1.34 M | 1,341,667
Dimensiones, \(d\) // Qwen3-Embedding-0.6B | 1,024 | 1,024
Bytes por número, \(b\) // float32, sin cuantizar | 4 | 4
Vectores, \(N × d × b\) | 1,341,667 × 1,024 × 4 | ≈ 5.50 GB
Grafo // \(m\) = 16 | 1,341,667 × 16 × 2 × 4 × 1.2 | ≈ 0.21 GB
Índice, \(M\) | 5.50 + 0.21 | ≈ 5.70 GB
RAM del servidor // el catálogo de equipos: Exxact TensorEX 4U | 384 GB | 384 GB
Veces que cabe | 384 ÷ 5.70 | ≈ 67
= El índice del despacho cabe 67 veces en la RAM del servidor: aquí la memoria no es el problema.
:::

Las fórmulas de cada motor no coinciden en el grafo (de ≈ 64 a ≈ 160 bytes por vector con m = 16), pero todas dicen lo mismo a esta escala: el grafo es ≈ 4 % de un vector float32 de 1,024 dimensiones. Encima del índice va lo demás, con supuestos: el texto de cada chunk (≈ 4 KB por 1,000 tokens) y sus metadatos (≈ 0.5 KB) suman ≈ 6 GB en disco, ≈ 9 GB con el 50 % extra que Qdrant calcula para su almacenamiento; el índice de BM25 no tiene fórmula publicada. Del orden de **10 a 20 GB de NVMe** y **6 a 10 GB de RAM**: menos que un solo modelo.

Dónde vive, entonces: **en el mismo servidor**, en la CPU, la RAM y el disco NVMe que ya están, con un snapshot diario (una copia completa del índice en un momento dado) a otro disco o al NAS del cuarto. No hace falta otra máquina.

:::calculadora rag-privado-indice
Empieza con el despacho (caso pesado). Cambia el modelo a Qwen3-Embedding-8B: el índice se cuadruplica y todavía cabe de sobra. Prueba el caso de la clínica y el de la fábrica.
:::

## Cuánto tarda indexar todo, y a qué hora {How long indexing everything takes, and when}

Embeber es como el [[prefill|prefill]] de un LLM: el modelo lee todos los tokens de una vez, sin escribir. Lo limita el cómputo, así que se cuenta con la misma regla de ≈ 2 operaciones por parámetro y por token. Un detalle: la tabla de embeddings del modelo (una fila de números por cada palabra del vocabulario) no hace multiplicaciones, así que no cuenta; de los 596 M de Qwen3-Embedding-0.6B quedan ≈ 440.5 M que sí calculan.

:::formula Tokens por segundo y horas de embeddings
t = frac{η_c × F}{2 × P_a}
h_e = frac{T_e}{t × G × 3,600}
- F: cómputo pico de la GPU en FP16 denso, en FLOPs por segundo
- η_c: fracción de ese pico que se aprovecha (el despacho usa 0.5)
- P_a: parámetros que calculan (sin la tabla de embeddings)
- t: tokens por segundo en una GPU
- T_e: tokens a embeber
- G: GPUs dedicadas a la ingesta
- h_e: horas de embeddings
:::

:::cuenta Los embeddings del despacho en una L40S
Cómputo pico, \(F\) // L40S, gpus.json | 362.05 TFLOPS | 362.05 × 10¹²
Eficiencia, \(η_c\) // la de la ficha | 0.5 | 0.5
Parámetros que calculan, \(P_a\) // Qwen3-Embedding-0.6B | 440.5 M | 440.5 × 10⁶
Tokens por segundo, \(t\) | 0.5 × 362.05 × 10¹² ÷ (2 × 440.5 × 10⁶) | ≈ 205 mil
Tokens a embeber, \(T_e\) // la cuenta de chunks | 1,342 M | 1,342 × 10⁶
Horas, \(h_e\) // \(G\) = 1 | 1,342 × 10⁶ ÷ (205,477 × 3,600) | ≈ 1.8 h
Con \(η_c\) = 0.21 // la eficiencia que sale de la medición de IBM en H100 | 1.8 × 0.5 ÷ 0.21 | ≈ 4.3 h
Con Qwen3-Embedding-4B // \(P_a\) ≈ 3,633.5 M; 36 h con 0.21 | 1,342 × 10⁶ ÷ (24,911 × 3,600) | ≈ 15 h
= Con el modelo 0.6B, todo el despacho se embebe en una sola noche de una sola GPU; con el 4B, una noche con las tres o un fin de semana con una.
:::

:::profundo De dónde sale el 0.21
Nadie publica cuántos tokens por segundo da un modelo de embeddings en una L40S, ni Qwen, ni NVIDIA, ni vLLM. La única medición con condiciones claras es de IBM: su modelo granite-311m procesa 1,828 documentos de 512 tokens por segundo en una H100. Pasado por la misma fórmula, eso es aprovechar ≈ 21 % del pico. La verdad está entre 0.2 y 0.6 (una gráfica de Hugging Face en una A10G, leída a ojo y con un dato de cómputo de segunda mano, da ≈ 0.57) y se mide en el piloto.
:::

### Por qué de noche

En la hora pico las 3 L40S ya entregan ≈ 86.8 % de su capacidad de salida a los abogados. Una ingesta de día les robaría cómputo justo cuando el [[ttft|TTFT]] ya está por encima del objetivo. De 19:00 a 9:00 las GPUs están casi libres: 14 horas, y la ingesta inicial pide de 2 a 4. **La ingesta corre de noche** y no le quita nada a nadie.

Lo diario es casi nada. Supón (no está en la ficha) 40 expedientes nuevos o con documentos nuevos al día: 40 × 40,250 ≈ 1.6 M tokens, **de 8 a 19 segundos** de GPU. Una ingesta cada hora, también de día, es viable si se limita a lo nuevo.

### La tensión que nadie anuncia

Compara las dos cuentas de esta lección. Embeber: de 2 a 4 horas. Leer los PDFs: de media noche a 14 noches, según la herramienta y los escaneos. **El cuello de botella de la ingesta inicial es el parsing, no el embedding.** Corre sobre todo en la CPU (Tesseract, o Marker sin OCR); una herramienta con modelos de diseño de página, como Docling, también puede usar de noche una GPU libre. Por eso la ingesta inicial se reparte por prioridad: primero los expedientes activos (lo que la gente va a preguntar mañana), después los históricos. El piloto con 20 abogados no necesita los 30,000 expedientes el primer día.

:::calculadora rag-privado-ingesta
Empieza con Qwen3-Embedding-0.6B en una L40S y Tesseract para leer. Cambia la herramienta de parsing y mira cómo las noches de lectura dominan; después cambia a Qwen3-Embedding-8B y mira cuándo el embedding empieza a pesar.
:::

## Una pregunta en vivo: híbrida, RRF y reranker {A live question: hybrid search, RRF and the reranker}

De día, la ingesta duerme y trabaja la otra máquina. La abogada pregunta, y la pregunta recorre el camino del diagrama.

:::diagrama rag-privado-pregunta
El camino de una pregunta en vivo, con lo que corre en cada máquina y lo que tarda cada paso. Sigue el recorrido: identidad, embedding de la pregunta, búsqueda con filtro, fusión, reranker, segunda revisión de permisos y el prompt con cita.
:::

### La búsqueda híbrida, y por qué en contratos

En contratos la [[busqueda-hibrida|búsqueda híbrida]] no es opcional. Números de cláusula («14.3»), nombres de las partes, RFCs, siglas y montos se encuentran **por palabras**: [[bm25|BM25]] los encuentra, un vector los confunde. El significado («penalización por retraso» ≈ «pena convencional por mora») lo encuentra el vector, y BM25 no. Las dos búsquedas corren en paralelo, cada una con el mismo filtro de permisos, y cada una devuelve su lista ordenada.

### Juntar las dos listas: RRF, y una constante que cambia de motor a motor

Las dos listas no se pueden sumar: BM25 da puntajes como 13.8 y el coseno como 0.82. [[rrf|RRF]] (*Reciprocal Rank Fusion*) solo mira las posiciones: cada lista le da a cada chunk \( 1 ÷ (k + \text{posición}) \) y se suman.

:::formula RRF
RRF(x) = sum_{i} frac{1}{k + r_i(x)}
- r_i(x): la posición del chunk x en la lista i (1 = el primero); si no aparece en esa lista, no suma
- k: una constante que decide cuánto pesa estar arriba
- RRF(x): el puntaje final; gana el más alto
:::

:::ojo
**La k de Qdrant no es la de Sensei.** En [Embeddings](https://sensei.trueml.app/embeddings/) aprendiste RRF con **k = 60**, el valor del artículo original y el que usan por omisión Elasticsearch y OpenSearch (`rank_constant` = 60). **Qdrant usa k = 2 por omisión.** No es un error de ninguno de los dos: es otra elección, y cambia qué gana.
:::

```python
def peso(k, posicion):                 # lo que una lista le da a un chunk en RRF
    return 1 / (k + posicion)

for k in (60, 2):
    pesos = [peso(k, r) for r in (1, 2, 5, 10, 20)]
    print(f"k = {k:>2}: posiciones 1, 2, 5, 10, 20 ->",
          " ".join(f"{p:.4f}" for p in pesos),
          f"| el 1.º vale {pesos[0] / pesos[-1]:.1f} veces el 20.º")

# A: 1.º en BM25 (la cláusula exacta), no aparece en la lista de vectores.
# B: 5.º en las dos listas.
for k in (60, 2):
    a, b = peso(k, 1), peso(k, 5) + peso(k, 5)
    print(f"k = {k:>2}: A = {a:.4f}, B = {b:.4f} -> gana", "A" if a > b else "B")
```

```salida
k = 60: posiciones 1, 2, 5, 10, 20 -> 0.0164 0.0161 0.0154 0.0143 0.0125 | el 1.º vale 1.3 veces el 20.º
k =  2: posiciones 1, 2, 5, 10, 20 -> 0.3333 0.2500 0.1429 0.0833 0.0455 | el 1.º vale 7.3 veces el 20.º
k = 60: A = 0.0164, B = 0.0308 -> gana B
k =  2: A = 0.3333, B = 0.2857 -> gana A
```

Con k = 60 casi todas las posiciones valen lo mismo, y gana el chunk en el que **las dos listas están de acuerdo**. Con k = 2 el primer lugar de una lista vale mucho, y gana **el que una de las dos encontró primero**. Para un abogado que escribe «cláusula 14.3 del contrato con el proveedor X», el primero de BM25 suele ser exactamente lo que busca, y k = 2 lo protege. Para una pregunta vaga, k = 60 es más prudente. Qdrant deja cambiar k y dar pesos a cada lista: el despacho empieza con el valor por omisión y lo compara contra k = 60 con su examen.

### El reranker, y el presupuesto que rompe

Un [[reranker]] es un modelo que lee la pregunta **y** cada candidato juntos y les pone una calificación nueva. Es más preciso que comparar vectores (lee las dos cosas a la vez), y más caro: cada candidato es otra lectura completa. El candidato natural para el despacho es **Qwen3-Reranker-0.6B** (Apache 2.0, 596 M de parámetros, 32 K de contexto). En la tabla de su model card (corridas de Qwen), reordenando los 100 primeros que trae Qwen3-Embedding-0.6B, sube la recuperación multilingüe de 64.64 a 66.36; el clásico bge-reranker-v2-m3, en la misma tabla, la **baja** a 58.36: un reranker no siempre mejora lo que recibe. Los rerankers de Jina, otra vez, son no comerciales.

¿Cuánto cuesta? El despacho reordena los 20 primeros de la fusión para quedarse con los 5 del prompt ([[top-k]] = 5).

:::formula Tiempo del reranker
t_r = frac{2 × P_a × n × L}{η_c × F}
- P_a: parámetros que calculan del reranker
- n: candidatos que se reordenan
- L: tokens de cada candidato (el chunk y la pregunta)
- η_c, F: como en la cuenta de los embeddings
- t_r: segundos que tarda, sin fila
:::

:::cuenta El reranker contra el presupuesto de búsqueda
Parámetros, \(P_a\) // Qwen3-Reranker-0.6B, misma arquitectura que el de embeddings | 440.5 M | 440.5 × 10⁶
Candidatos, \(n\) | 20 | 20
Tokens por candidato, \(L\) | ≈ 1,000 | 1,000
Cómputo | 2 × 440.5 × 10⁶ × 20 × 1,000 | ≈ 17.6 TFLOP
Tiempo, \(t_r\) // \(η_c\) = 0.5, L40S | 17.6 × 10¹² ÷ (0.5 × 362.05 × 10¹²) | ≈ 97 ms
Con \(η_c\) = 0.21 | 17.6 × 10¹² ÷ (0.21 × 362.05 × 10¹²) | ≈ 232 ms
Presupuesto de búsqueda // un supuesto de la lección «De requisitos a hardware» | ≈ 150 ms | 150 ms
= El reranker solo, de 100 a 230 ms, puede comerse todo el presupuesto de búsqueda. Y con el modelo 4B serían de 0.8 a 1.9 s: no cabe.
:::

Esa es la tensión, dicha completa. El presupuesto del despacho reparte 2,000 ms en ≈ 20 de red y gateway, ≈ 150 de búsqueda, y el resto para la fila y el prefill. Embeber la pregunta cuesta ≈ 2 ms (leer 1.19 GB de pesos a 0.7 × 864 GB/s), y la búsqueda en un índice de este tamaño se espera en milisegundos (no hay cifra publicada para Qdrant con 1.3 M de vectores y filtro: se mide). El reranker no cabe en los 150 ms. Pero puede **pagarse solo**: si ordena tan bien que el prompt baja de 5 a 3 fragmentos, son 2,000 tokens menos de prefill.

:::figura rag-privado-presupuesto
El TTFT de una pregunta sin fila, en dos versiones: 5 fragmentos sin reranker, y 3 fragmentos con reranker. La raya marca los 2 s del objetivo.
:::

Con la fórmula del prefill (2 × 32.76 mil millones de parámetros × tokens ÷ (0.5 × 362 TFLOPS)), 6,000 tokens son ≈ 2.17 s y 4,000 son ≈ 1.45 s: **≈ 0.72 s menos**, más que los 0.1–0.23 s del reranker. Sin fila, la pregunta pasaría de ≈ 2.34 s a ≈ 1.72–1.85 s (con los 2.38 s de la herramienta de sizing en vez de la fórmula: de ≈ 2.55 s a ≈ 1.85–1.99 s, la misma conclusión sin margen). Tres honestidades. Con la fila de la hora pico y el reparto al azar que usa el gateway, el p95 de las L40S sigue arriba de 2 s también con 3 fragmentos: la misma simulación de «De requisitos a hardware», con el prefill más corto, da ≈ 2.5 s de fila y prefill antes de sumar búsqueda y reranker. Solo con un reparto por turno, que en esa simulación deja la fila casi en cero, quedaría en ≈ 1.85–1.99 s: en la raya. Y nada de esto vale si con 3 fragmentos la calidad baja. Se decide con el examen: si con reranker y 3 fragmentos se sigue contestando bien y con cita correcta al menos el 85 % de las 200 preguntas, se queda; si no, no.

### El examen empieza aquí

Si la búsqueda no trae la página correcta, el mejor modelo del mundo no la puede citar. Por eso el primer número que se mide es de la búsqueda, no del LLM: el **recall@k**, de las preguntas del examen, en cuántas llegó el chunk con la página correcta entre los k que se le dan al modelo. Se mide por separado del LLM, y después de cada cambio (modelo de embeddings, tamaño de chunk, k de RRF, reranker). Cómo se construye y se califica, en [Demostrar que el modelo abierto sirve](/evals/).

## Reindexar sin apagar nada {Reindexing without switching anything off} [extra]

Los vectores de dos modelos distintos (o de dos versiones del mismo) viven en espacios distintos: compararlos es comparar coordenadas de dos mapas con distinto origen. Sensei lo pone entre los errores comunes: no se mezclan. Así que [[reindexar]] (volver a calcular todos los vectores) es obligatorio cada vez que cambia el modelo de embeddings, su versión, su instrucción o sus dimensiones.

Lo que cuesta, en el despacho:

- **No se repite el parsing ni el OCR**, porque el texto limpio quedó guardado por su huella. Es la razón de guardarlo.
- **No se repiten los chunks** si el tamaño y el tokenizador no cambian. Si cambian (otro modelo, otro límite), hay que volver a partir, y es barato: es texto.
- **Se repiten los embeddings**: de 1.8 a 4.3 h con el 0.6B, de 15 a 36 h con el 4B en una L40S.

Y se hace **al lado**, no encima (el cambio «azul-verde»): se construye una colección nueva (en Qdrant, una colección es lo que en SQL sería una tabla) junto a la vieja (con el doble de índice, ≈ 11 GB en RAM, nada para 384 GB), se corre el examen de 200 preguntas contra la nueva, y solo si pasa se cambia el nombre al que apunta el servicio de búsqueda. Si algo sale mal, se regresa al nombre viejo en un segundo. Cambiar el modelo de embeddings es un cambio como cualquier otro del sistema: no entra sin pasar el examen.

:::ojo
La huella del índice. Cada chunk guarda con qué modelo, qué versión, qué instrucción y qué dimensiones se calculó su vector. Así, un día que alguien actualice «solo la imagen de vLLM» y el modelo cambie por debajo, una consulta de prueba lo detecta antes de que las respuestas empeoren sin explicación.
:::

## Cuantizar vectores y recortar dimensiones {Quantizing vectors and trimming dimensions} [extra]

Igual que los pesos de un LLM se guardan en menos bits ([Formatos de cuantización](/formatos-cuantizacion/)), los vectores también: es otro tema con la misma idea.

- **int8** (un byte por número): 4 veces menos memoria. Qdrant dice que el error es «normalmente menor al 1 %».
- **Binaria** (un bit por número): 32 veces menos. Funciona con vectores de muchas dimensiones y se usa con sobremuestreo (traer de 2 a 4 veces más candidatos) y reordenar con los vectores completos. Qdrant la prueba con modelos de OpenAI y Cohere de 512 a 4,096 dimensiones, y pierde más mientras menos dimensiones tiene el vector; para Qwen3-Embedding no hay dato publicado, y su documentación avisa que un modelo con otra distribución de sus números pide experimentos propios.
- **Recortar dimensiones (Matryoshka).** Qwen3-Embedding se entrenó para que los primeros números del vector ya sirvan solos: se puede guardar de 32 a 1,024. Se recorta, se **vuelve a normalizar**, y preguntas y chunks deben usar la misma dimensión.

En el despacho, **nada de esto hace falta**. El índice float32 pesa ≈ 5.7 GB; en int8 serían ≈ 1.58 GB, y ahí el grafo ya pesaría 13 % del total. Cuantizar ahorra 4 GB en un servidor de 384 y agrega un riesgo de calidad que hay que medir. Importa a otra escala: 12 millones de chunks en float32 ya son ≈ 49 GB, y 100 millones no caben sin cuantizar.

## Errores comunes {Common mistakes}

1. **Filtrar permisos después de buscar, o en el prompt.** Quien ve el 3 % recibe ≈ 1.2 chunks de 40 y respuestas sin cita; y un permiso escrito en el prompt no detiene nada. **Cómo evitarlo:** [[prefiltro]] dentro de la búsqueda (en pgvector, escaneo iterativo), segunda revisión antes de armar el prompt, y una prueba que pregunte como cada tipo de persona y compare con lo que debería ver.
2. **Probar con la cuenta de TI.** Quien lo ve todo nunca nota el post-filtro ni la muralla rota. **Cómo evitarlo:** el examen incluye preguntas hechas como una asociada de un solo equipo, y preguntas cuya respuesta está en un expediente que esa persona **no** puede ver: la respuesta correcta es «no lo encontré».
3. **Pedirle la página al LLM.** El modelo inventa números de página con toda seguridad. **Cómo evitarlo:** marcas de página dentro del chunk, la página como metadato, y una revisión con código de que la [[cita]] existe y contiene el texto.
4. **Elegir el modelo de embeddings por el primer lugar del leaderboard.** El primero general puede ser el no comercial, el que entrenó con el benchmark o el que lee 512 tokens. **Cómo evitarlo:** licencia, contexto y recall@k con las preguntas del despacho, en ese orden.
5. **Mezclar vectores de dos modelos.** Actualizar el modelo y reindexar «poco a poco» deja la mitad del índice en otro espacio: la búsqueda empeora sin un solo error. **Cómo evitarlo:** [[reindexar]] completo en una colección nueva, huella del modelo en cada chunk y cambio azul-verde.
6. **Dejar la base de vectores sin llave.** Qdrant abierto contesta a cualquiera en la red. **Cómo evitarlo:** llave de API, TLS y puerto cerrado salvo para el servicio de búsqueda y la ingesta.
7. **Planear la ingesta por los embeddings.** «Se indexa en una noche» es verdad para los vectores y falso para el OCR. **Cómo evitarlo:** medir 200 páginas reales con la herramienta elegida y planear por prioridad, expedientes activos primero.

## En la vida real {In real life} [extra]

**El despacho.** De noche, en la CPU del servidor: conectores de solo lectura, parsing con la herramienta que gane la prueba de 200 páginas, OCR solo en escaneos, texto guardado por su huella, chunks de ≈ 1,000 tokens partidos por estructura, con ruta de títulos, marcas de página y la ACL del documento en grupos. En una L40S libre: Qwen3-Embedding-0.6B con vLLM en modo pooling, ≈ 2 a 4 horas para los ≈ 1.34 M de chunks. En el mismo servidor: Qdrant 1.20.2 con llave y TLS, ≈ 5.7 GB de índice. De día: cada pregunta busca por BM25 y por vectores con el filtro de la muralla, junta con RRF y, si el examen lo justifica, reordena 20 con Qwen3-Reranker-0.6B para dar 3 fragmentos en vez de 5. Nada sale de la red: ni un vector, ni un fragmento, ni una pregunta.

**Una clínica.** Supuesto del ejemplo: 40,000 pacientes con ≈ 60 páginas de expediente clínico de ≈ 600 tokens cada una, ≈ 1,440 M de tokens. Con chunks de 400 y traslape de 60 salen ≈ 4.2 M de chunks, ≈ 17 GB en float32 con 1,024 dimensiones: tampoco hace falta cuantizar. Lo difícil es el permiso: es **por paciente y médico a cargo**, miles de valores distintos que cambian cada día. Aquí la ACL en grupos y el carril rápido de revocación mandan, y en pgvector no se particiona por paciente (serían miles de particiones). Y los vectores de notas médicas son datos personales sensibles: el mismo cuidado que el expediente.

**Una fábrica.** Supuesto del ejemplo: 3,000 manuales técnicos de ≈ 200 páginas de ≈ 900 tokens, ≈ 540 M de tokens, ≈ 1.6 M de chunks de 400 con traslape de 60, ≈ 6.5 GB. La RAM sobra; el problema es leer: tablas de torques, diagramas eléctricos, manuales escaneados de los años noventa. Ahí un modelo de visión que entiende el diseño de la página (Docling trae GraniteDocling, de 258 M de parámetros y Apache 2.0) o un modelo de embeddings que lee imágenes puede valer más que cualquier ajuste del índice. El permiso es por planta o línea: pocos valores, y en pgvector un índice parcial o una partición por planta funcionan bien.

**Fuera de las computadoras: el índice de un libro de derecho.** Un tratado de mil páginas trae al final un índice analítico: «pena convencional, 214, 388-390». Alguien lo hizo leyendo el libro entero una vez (la ingesta), y gracias a él nadie lo relee. Dónde se rompe: el índice del libro solo tiene las palabras que eligió su autor; la búsqueda por vectores encuentra «penalización por mora» aunque nadie haya escrito esa entrada.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Con el caso ligero del despacho (33,250 tokens por expediente), ¿cuántos chunks de 1,000 tokens con traslape de 100 salen?
\(T\) = 30,000 × 33,250 = 997.5 M de tokens. \(N = T ÷ (c − s)\) = 997.5 M ÷ 900 ≈ **1.11 M chunks**. Entre los dos casos, de 1.11 a 1.34 millones.
? [facil] ¿Cuánto pesan los vectores de 1.34 M de chunks con Qwen3-Embedding-4B (2,560 dimensiones) en float32, y cuántas veces cabe el índice en 384 GB?
Vectores: 1,341,667 × 2,560 × 4 ≈ **13.74 GB**. Grafo con \(m\) = 16: ≈ 0.21 GB (no depende de las dimensiones). \(M\) ≈ 13.94 GB. Cabe 384 ÷ 13.94 ≈ **27 veces**. Cambiar al 4B no es un problema de memoria; es de cómputo (embeber y reindexar ≈ 8 veces más lento).
? [facil] Una socia del despacho puede ver el 50 % de los chunks. Con post-filtro y 40 candidatos, ¿cuántos le llegan en promedio? ¿Y a un asistente que ve el 1 %?
\(k_{post} = e × p\): 40 × 0.5 = **20**, de sobra para 5. 40 × 0.01 = **0.4**: la mayoría de sus preguntas no recibe ni un fragmento. El post-filtro castiga justo a quien ve menos.
? [facil] ¿Por qué el despacho no puede usar multilingual-e5-large-instruct con sus chunks, aunque su licencia sea MIT?
Porque lee como máximo 514 tokens (su model card dice que trunca a 512). Un chunk de ≈ 1,000 tokens perdería su segunda mitad sin aviso: la cláusula que está al final del chunk nunca se encontraría por significado. Con ese modelo habría que usar chunks de ≈ 400 y cambiar cuántos fragmentos se dan al LLM.
? [medio] Con la fórmula de tokens por segundo y \(η_c\) = 0.5, ¿cuántas horas tarda Qwen3-Embedding-8B (≈ 6,946 M parámetros que calculan) en embeber los 1,342 M de tokens en las 3 L40S? ¿Cabe en una noche?
\(t\) = 0.5 × 362.05 × 10¹² ÷ (2 × 6,946 × 10⁶) ≈ **13,031 tokens/s** por GPU. \(h_e\) = 1,342 × 10⁶ ÷ (13,031 × 3 × 3,600) ≈ **9.5 h**. Cabe en una noche de 14 h con las tres GPUs, pero sin margen si \(η_c\) real es 0.21: entonces serían ≈ 22.7 h, dos noches. Y cada reindexación costaría lo mismo.
? [medio] Junta con RRF, con k = 60 y con k = 2, dos chunks: X está 2.º en BM25 y 3.º en vectores; Y está 1.º en vectores y no aparece en BM25. ¿Cuál gana con cada k?
k = 60: X = 1/62 + 1/63 ≈ 0.01613 + 0.01587 = **0.0320**; Y = 1/61 ≈ **0.0164**. Gana X. k = 2: X = 1/4 + 1/5 = **0.45**; Y = 1/3 ≈ **0.333**. Gana X también: estar arriba en las dos listas gana con cualquier k. La k decide los casos de en medio, como el 1.º de una lista contra el 5.º de las dos.
? [medio] Una asistente sale del equipo del cliente A a las 11:00. ¿Qué hay que cambiar en el índice para que deje de ver sus expedientes, y qué no?
Nada en los chunks: su ACL dice «equipo-cliente-a», no nombres. Lo que cambia es su pertenencia al grupo en el directorio, y el servicio de búsqueda resuelve sus grupos al preguntar (con un caché corto o el carril rápido, para que el cambio caiga en minutos). No se recalcula ningún vector ni se reindexa nada. Si la ACL guardara nombres de personas, habría que actualizar los metadatos de miles de chunks.
? [reto] Con el presupuesto del despacho (2,000 ms = 20 de red + 150 de búsqueda + el resto), el prefill de la fórmula (2.17 s con 6,000 tokens) y el reranker de 20 candidatos, compara sin fila: (a) 5 fragmentos sin reranker; (b) 3 fragmentos con reranker con \(η_c\) = 0.5; (c) igual con 0.21. ¿Cuál cumple?
Prefill con 4,000 tokens: 2.17 × 4,000 ÷ 6,000 ≈ 1.45 s. (a) 20 + 150 + 2,170 = **2,340 ms**: no cumple. (b) 20 + 150 + 97 + 1,448 ≈ **1,715 ms**: cumple. (c) 20 + 150 + 232 + 1,448 ≈ **1,850 ms**: cumple, con 150 ms de margen. Pero esto es **sin fila**: en la hora pico, con el reparto al azar del gateway, la fila suma ≈ 1.8 s al p95 con 5 fragmentos y ≈ 0.9 s con 3 (la simulación de «De requisitos a hardware»), y ninguna de las tres cumple. El reranker mejora el caso, no lo resuelve; y todo depende de que el examen acepte 3 fragmentos.
? [reto] El TI propone pgvector «porque ya tenemos Postgres». Escribe la condición mínima para aceptarlo y lo que se pierde frente a Qdrant.
Condición: activar el escaneo iterativo (`hnsw.iterative_scan`) para que el filtro de permisos no se vuelva post-filtro, poner la ACL en una columna con índice, y probar con preguntas de una persona que ve ≈ 1–3 % que siguen llegando 5 fragmentos y la página correcta. Lo que se pierde: BM25 de verdad (el texto completo de Postgres ordena distinto, y la extensión con BM25 es AGPL), la fusión en una sola consulta (hay que hacer RRF a mano), y la fórmula de memoria publicada del índice HNSW. Lo que se gana: un solo motor de base de datos con respaldos, réplicas y permisos que el TI ya opera. A 1.34 M de chunks, es una decisión de operación, no de capacidad.
:::

## Lo que sigue {What comes next} [extra]

- **[Demostrar que el modelo abierto sirve](/evals/)** mide lo que aquí solo se nombra: el recall@k de la búsqueda, si la respuesta dice solo lo que dicen los fragmentos, y si la cita es correcta. Cada cambio de esta lección (modelo de embeddings, chunks, k de RRF, reranker) pasa por ese examen.
- **[Agentes, tools y guardrails](/agentes/)** usa esta búsqueda como herramienta de un agente, con los permisos de quien pregunta, y explica por qué un fragmento recuperado es una entrada en la que no se puede confiar.
- **[Pruebas de carga y benchmarks honestos](/pruebas-carga/)** mide el TTFT con la búsqueda y el reranker incluidos, que es lo que siente la abogada.
- **[De requisitos a hardware](/requisitos-hardware/)** es de donde salen el presupuesto de 150 ms y la fila de la hora pico; **[Gateway](/gateway/)**, el nombre `embeddings` que esta lección llena.
- **«Seguridad: aislamiento, sin internet y actualizaciones»** cierra las puertas de red de Qdrant y de los servidores de modelos, y **«Observabilidad de GPUs e inferencia»** vigila cuánto tarda cada pieza en producción.
- En Sensei: [Embeddings](https://sensei.trueml.app/embeddings/) tiene el coseno, HNSW, BM25 y RRF por dentro; [Bases de datos](https://sensei.trueml.app/bases-de-datos/), los índices y el upsert que usa la ingesta; [Autenticación y permisos](https://sensei.trueml.app/identidad/), roles, grupos y por qué un permiso se revisa del lado del servidor.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
rag ingesta ocr chunk acl-por-chunk muralla-etica prefiltro modelo-de-embeddings vector-db indice-hnsw busqueda-hibrida bm25 rrf reranker top-k cita reindexar
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué el filtro de permisos va dentro de la búsqueda y no en el prompt ni después de buscar?
En el prompt no detiene nada: el fragmento ya llegó y el modelo lo puede repetir. Después de buscar (post-filtro), a quien ve poco le sobreviven casi ningún candidato (40 × 3 % ≈ 1.2) y le llegan fragmentos peores. Dentro de la búsqueda (prefiltro), el índice solo recorre lo permitido.
? ¿Qué cuesta más en la ingesta inicial del despacho, embeber o leer los PDFs?
Leer: el parsing y el OCR van de media noche a ≈ 14 noches según la herramienta, contra 2 a 4 horas de embeddings con Qwen3-Embedding-0.6B en una L40S.
? ¿Cuánto pesa el índice del despacho y dónde vive?
≈ 5.7 GB (1.34 M × 1,024 × 4 bytes + ≈ 0.21 GB de grafo): cabe 67 veces en los 384 GB de RAM del mismo servidor. No hace falta cuantizar ni otra máquina.
? ¿Qué k usa RRF en Qdrant por omisión, y en qué se diferencia de la k = 60 de Sensei?
k = 2. Con k = 2 el primer lugar de una lista pesa mucho (7.3 veces el 20.º) y gana lo que una búsqueda encontró primero; con k = 60 casi todas las posiciones valen igual y gana el acuerdo entre las dos listas.
? ¿Por qué el reranker puede valer la pena aunque se coma el presupuesto de búsqueda?
Porque si ordena tan bien que el prompt baja de 5 a 3 fragmentos, el prefill baja ≈ 0.72 s, más que sus ≈ 0.1–0.23 s. Solo vale si el examen demuestra que 3 fragmentos bastan.
? ¿Qué se repite y qué no al cambiar de modelo de embeddings?
Se repiten todos los embeddings (y los chunks si cambia el tokenizador o el límite). No se repite el parsing ni el OCR, porque el texto limpio está guardado por su huella. Se hace en una colección nueva y se cambia solo si pasa el examen.
? ¿Por qué un abogado no debe confiar en una página que el LLM «recuerda»?
Porque el modelo inventa números de página con seguridad. La página viaja en el chunk como marca y metadato, y la aplicación revisa con código que la cita existe.
:::
