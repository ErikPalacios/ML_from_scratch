"""Arma content/estaciones/rag-chunking.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/r2 && bash probar-fallas.sh /ruta/r2     # deja /ruta/r2.log y /ruta/r2-fallas.log
    python3 contenido.py /ruta/r2                                  # escribe el JSON con esas salidas

Ninguna salida se copia a mano: cada `salida` sale de una sección «### nombre» de los logs, y el código de cada
paso sale de los archivos de esta solución.
"""
import json
import re
import sys
from pathlib import Path

CARPETA = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("uso: python3 contenido.py <carpeta de probar.sh>")
SOL = Path(__file__).resolve().parent
APP = SOL.parent.parent
LOG = Path(f"{CARPETA}.log").read_text()
LOGF = Path(f"{CARPETA}-fallas.log").read_text()
PROBAR = (SOL / "probar.sh").read_text()
PROBARF = (SOL / "probar-fallas.sh").read_text()


def L(nombre: str, log: str = None, filtro=None, max_lineas=None, sin=None) -> str:
    log = LOG if log is None else log
    m = re.search(r"^### " + re.escape(nombre) + r"\n(.*?)(?=^### |\Z)", log, re.S | re.M)
    if not m:
        sys.exit(f"no está la sección «{nombre}»")
    lineas = m.group(1).rstrip("\n").splitlines()
    if filtro:
        lineas = [l for l in lineas if re.search(filtro, l)]
    if sin:
        lineas = [l for l in lineas if not re.search(sin, l)]
    if max_lineas:
        lineas = lineas[:max_lineas]
    return "\n".join(lineas).rstrip()


def F(nombre, **kw):
    return L(nombre, LOGF, **kw)


def P(nombre: str, fuente: str = None) -> str:
    """El comando tal como lo corre probar.sh en la sección «nombre» (para no escribirlo dos veces)."""
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^#|\Z)', fuente or PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"no está el paso «{nombre}» en probar.sh")
    c = m.group(1).strip()
    if c.startswith("python -c \""):
        c = c.replace("\\\"", "\"")
    if c.startswith('sh -c "python -c \\"'):
        c = c[len('sh -c "'):-1].replace('\\"', '"')
    return c


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def py(rel: str, nota: str = "") -> dict:
    return {"lang": "python", "path": rel, "code": code(rel), "nota": nota}


V = "python verificar.py"

e = {
    "id": "chunking", "patron": "llm", "rama": "rag", "etapa": "datos", "num": 2,
    "titulo": "Chunking con contexto", "nav": "Chunking con contexto",
    "pregunta": "¿Cómo partes cada documento en pedazos que el buscador pueda encontrar y el LLM pueda entender solos, sin cortar una tabla, sin perder de qué sección vienen y sin volver a partir lo que no cambió?",
    "version": "2026-11-25",
}

e["mapa"] = {
    "resumen": "La estación 1 dejó el texto limpio de cada documento, guardado por su hash y con su ACL. Pero un buscador no compara preguntas contra documentos enteros: compara contra <b>chunks</b>, pedazos de ≈ 400 <b>tokens</b> (los pedacitos de palabra con los que cuenta un modelo). Esta estación los hace bien: cuenta con el <b>tokenizador del modelo de embeddings</b> de verdad, parte por la <b>estructura</b> (títulos, párrafos, listas, tablas) en vez de cada N caracteres, mete en cada chunk su <b>ruta de títulos</b> para que se entienda solo, repite un poco de texto (<b>traslape</b>) solo donde el corte cae a media sección, y nunca deja un chunk sin la ACL de su documento. Si el texto no cambió, no se vuelve a partir: cada chunk partido de nuevo es un embedding que se vuelve a pagar. La estación 3 usa esa ACL para filtrar y la 5 convierte cada chunk en un vector.",
    "entra": [
        "el almacén de la estación 1: <code>almacen/texto/&lt;hash&gt;.json</code> con el texto limpio de cada documento y su <code>sha256_texto</code>",
        "el catálogo: por documento, su título, su URL, su versión, su hash y su ACL como cláusulas; las lápidas de lo borrado",
        "el modelo de embeddings elegido, multilingual-e5-small: su tokenizador, su límite de 512 tokens y su prefijo «passage: »",
    ],
    "sale": [
        "por documento, <code>chunks/docs/&lt;doc&gt;.json</code>: sus chunks de ≤ 400 tokens, cada uno con su ruta de títulos dentro del texto",
        "en cada chunk, la ACL, el título, la URL y la versión de su documento (un chunk nunca mezcla dos documentos)",
        "la huella de cómo se partió (versión del chunker + configuración) y el sha256 del texto, para saber qué no hace falta volver a partir",
        "un registro por corrida en <code>chunks/corridas/</code>: qué se partió, qué solo cambió de metadatos, qué se borró y qué se quedó fuera por no tener ACL",
    ],
    "escala": [
        {"que": "Documentos", "ref": "≈ 1.5 M, cada uno con su ACL", "taller": "104 el día 1 (los 101 de la estación 1 más 3 largos); 106 vivos el día 2"},
        {"que": "Tokens", "ref": "≈ 2.25 mil millones (supuesto: ≈ 1,500 tokens por documento en promedio)", "taller": "8,779 tokens de texto en 103 documentos con texto"},
        {"que": "Chunks", "ref": "≈ 7.5 M (supuesto: ≈ 300 tokens por chunk en promedio)", "taller": "154 chunks, mediana de 60 tokens y el mayor de 396"},
        {"que": "Tamaño", "ref": "≤ 400 tokens por chunk, contados con el tokenizador del modelo de embeddings", "taller": "lo mismo: ≤ 400, con el tokenizador de multilingual-e5-small"},
        {"que": "Cambios al día", "ref": "≈ 1 % de los documentos: ≈ 15,000 que volver a partir", "taller": "el día 2, 12 documentos partidos de nuevo, 4 solo con metadatos nuevos y 2 lápidas"},
        {"que": "Dónde corre", "ref": "un job después de cada ingestión, en la plataforma de datos", "taller": "<code>python pipeline/chunkear.py</code> en tu Mac, ≈ 1 segundo"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de partir nada, las cuentas de servilleta del chunking: cuántos tokens hay, cuántos chunks salen, cuánto se pierde si un chunk pasa del límite del modelo, cuánto cuesta el traslape y cuánto hay que volver a partir cada día. Cada cuenta va en las dos escalas: «En C11» (el caso real, con supuestos dichos en voz alta) y «En el dojo» (medido en tu Mac con un comando).",
    "cuentas": [
        {"id": "tokens", "pregunta": "¿Cuántos tokens hay que partir?",
         "formula": "tokens = documentos × tokens promedio por documento; tokens ≈ caracteres ÷ caracteres por token del tokenizador",
         "ref": {"cuenta": "1.5 M documentos × ≈ 1,500 tokens (supuesto)", "valor": "≈ 2.25 mil millones de tokens"},
         "taller": {"cuenta": "medido con el tokenizador de e5 en los 103 documentos con texto", "valor": "8,779 tokens · 3.88 caracteres por token en español"},
         "decide": "Los tokens, no las palabras ni los caracteres, son la unidad de todo lo que sigue: el límite del modelo, el tamaño del chunk y el costo de los embeddings. En español este tokenizador gasta más tokens por palabra que en inglés (la misma pregunta: 13 tokens en español y 10 en inglés).",
         "conceptos": ["token", "tokenizador"],
         "comprueba": cmd(P("pc tokens"), L("pc tokens"))},
        {"id": "chunks", "pregunta": "¿Cuántos chunks salen?",
         "formula": "chunks ≈ tokens ÷ tokens promedio por chunk (que queda abajo de 400, porque cada sección empieza un chunk nuevo)",
         "ref": {"cuenta": "2.25 mil millones ÷ ≈ 300 (supuesto)", "valor": "≈ 7.5 M chunks"},
         "taller": {"cuenta": "si todo se llenara a 400 saldrían 110; con la regla de partir en cada sección salen más", "valor": "154 chunks (mediana 60 tokens: los documentos del dojo son cortos)"},
         "decide": "El número de chunks es el número de vectores del índice (estación 5) y de candidatos del retrieval. Partir en cada sección da chunks más chicos que el máximo, y está bien: cada uno habla de una sola cosa.",
         "conceptos": ["chunk", "chunking-estructura"],
         "comprueba": cmd(P("pc c11"), L("pc c11"), "La misma cuenta para C11, con los supuestos escritos en el comando.")},
        {"id": "corte", "pregunta": "¿Qué pasa con un chunk más grande que el límite del modelo?",
         "formula": "fracción que el modelo lee = 512 ÷ tokens del chunk (si pasa de 512); el resto no existe para la búsqueda",
         "ref": {"cuenta": "un chunk de 1,500 tokens con un límite de 512", "valor": "el modelo lee el 34 %"},
         "taller": {"cuenta": "el manual entero, 1,730 tokens el día 2", "valor": "e5 leería el 30 %: las preguntas frecuentes y las sanciones, nunca"},
         "decide": "El modelo no avisa cuando corta: el embedding sale igual de bonito. Por eso el máximo (400) queda debajo del límite (512) con aire para el prefijo y los tokens especiales, y se cuenta con el tokenizador del modelo, no con una regla de «4 caracteres por token».",
         "conceptos": ["limite-modelo", "prefijo"],
         "comprueba": cmd(P("pc corte"), L("pc corte"))},
        {"id": "traslape", "pregunta": "¿Cuánto cuesta el traslape?",
         "formula": "tokens extra = tokens repetidos en cada corte × cortes; un traslape fijo de X % en todo cuesta X % más de embeddings e índice",
         "ref": {"cuenta": "15 % de traslape en todos los chunks de 2.25 mil millones de tokens", "valor": "≈ 338 M tokens más que embeber y guardar"},
         "taller": {"cuenta": "traslape solo donde el corte cae a media sección: un corte en todo el corpus", "valor": "47 tokens repetidos"},
         "decide": "El traslape sirve donde un corte parte una idea a la mitad. En un título no hace falta (la ruta ya da el contexto) y en una tabla estorba (se repite el encabezado). Ponerlo solo donde sirve lo vuelve casi gratis.",
         "conceptos": ["traslape"],
         "confirma": "Paso 5: <code>verificar.py traslape</code> lo mide."},
        {"id": "diario", "pregunta": "¿Cuánto hay que volver a partir cada día?",
         "formula": "documentos a partir = los de texto o título nuevo; los de solo ACL o versión nueva se actualizan sin partir; los demás, nada",
         "ref": {"cuenta": "≈ 1 % de 1.5 M documentos al día", "valor": "≈ 15,000 documentos, ≈ 75 mil chunks (contra 7.5 M si se parte todo)"},
         "taller": {"cuenta": "el día 2 del mundo", "valor": "12 partidos, 4 solo con metadatos nuevos, 2 lápidas y 89 sin tocar"},
         "decide": "Partir de nuevo es barato; lo caro es lo que viene detrás: cada chunk nuevo es un embedding y una escritura en el índice. El incremental por hash del texto convierte «todo, cada hora» en «lo que cambió».",
         "conceptos": ["huella", "incremental"],
         "confirma": "Paso 7, con la corrida del día 2."},
    ],
}

e["conceptos"] = [
    {"id": "token", "termino": "Token", "en": "token", "def": "El pedacito de texto con el que cuenta un modelo: una palabra corta, un pedazo de palabra o un signo. «devolver» son dos tokens: «devolv» y «er».",
     "analogia": "Como las piezas de un juego de bloques: el modelo no ve frases, ve piezas, y cada pieza cuenta para el límite de lo que cabe en la caja.",
     "importa": "El límite del modelo, el tamaño del chunk y el costo se miden en tokens, no en palabras ni en caracteres.",
     "trampa": "Contar caracteres y dividir entre 4. Es una regla del inglés; en español, en tablas con números o en código, el número de tokens por carácter cambia."},
    {"id": "tokenizador", "termino": "Tokenizador", "en": "tokenizer", "def": "El programa que convierte texto en tokens con el vocabulario de un modelo. Cada modelo trae el suyo, en un archivo como tokenizer.json.",
     "analogia": "Como el diccionario de un traductor: dos traductores parten la misma frase distinto, y cuenta el del modelo que la va a leer.",
     "importa": "Para saber si un chunk cabe en el modelo de embeddings, se cuenta con el tokenizador de ese modelo. En el kit se carga con la librería tokenizers de Hugging Face.",
     "trampa": "Contar con el tokenizador de otro modelo (el de un LLM, el de OpenAI) y suponer que da lo mismo: cada vocabulario parte distinto."},
    {"id": "limite-modelo", "termino": "Límite del modelo", "en": "max sequence length", "def": "Cuántos tokens lee como máximo el modelo de una sola vez. multilingual-e5-small lee 512; lo que pase de ahí lo corta.",
     "analogia": "Como una foto con un lente fijo: lo que queda fuera del encuadre no sale en la foto, aunque estuviera ahí.",
     "importa": "Un chunk de más de 512 tokens se embebe solo hasta el token 512: lo de después no se encuentra nunca. Y no hay error: el vector sale igual.",
     "trampa": "Creer que «más contexto por chunk» siempre ayuda. Pasado el límite, el contexto extra no existe para el buscador."},
    {"id": "embedding", "termino": "Embedding", "en": "embedding", "def": "Una lista de números (un vector) que resume el significado de un texto. Textos que dicen cosas parecidas quedan con vectores cercanos.",
     "analogia": "Como las coordenadas de un lugar en un mapa del significado: «reembolso» y «devolución del dinero» quedan en el mismo barrio.",
     "importa": "El buscador de un RAG compara el vector de la pregunta con el de cada chunk. Un chunk que mezcla cinco temas tiene un vector que es el promedio de los cinco y no queda cerca de ninguno.",
     "trampa": "Pensar que el embedding «lee» el chunk entero como una persona: resume, y lo que mezcla lo diluye. Lo construyes en la estación 5."},
    {"id": "prefijo", "termino": "Prefijo de e5", "en": "passage / query prefix", "def": "multilingual-e5 espera «passage: » antes de cada pedazo de documento y «query: » antes de cada pregunta. El prefijo también cuenta tokens.",
     "analogia": "Como la etiqueta en una caja de mudanza: le dice al modelo qué es lo que viene, y ocupa un poco de lugar en la caja.",
     "importa": "Así lo entrenaron sus autores, y sin prefijo la búsqueda empeora. contar() lo incluye, igual que los tokens especiales &lt;s&gt; y &lt;/s&gt;: 5 tokens antes de escribir nada.",
     "trampa": "Contar el chunk sin prefijo ni especiales y quedarse justo en 512: el modelo ve 517 y corta."},
    {"id": "chunk", "termino": "Chunk", "en": "chunk", "def": "Un pedazo de un documento, del tamaño adecuado para buscarlo y para dárselo al LLM como fuente. Es la unidad que se busca, se cita y se filtra por permisos.",
     "analogia": "Como las fichas de un fichero de biblioteca: no buscas en el libro entero, buscas en fichas, y cada ficha dice de qué libro y de qué capítulo viene.",
     "importa": "Un chunk muy grande diluye su embedding y gasta el contexto del LLM; uno muy chico no se entiende solo. ≈ 400 tokens es el punto que eligió el equipo de C11, y el golden set lo confirma o lo corrige.",
     "trampa": "Elegir el tamaño por intuición y no volver a medirlo. El tamaño del chunk es una decisión que se evalúa como cualquier otra (estación 9)."},
    {"id": "chunking-estructura", "termino": "Chunking por estructura", "en": "structure-aware chunking", "def": "Partir siguiendo la forma del documento: cada sección empieza un chunk, los bloques entran enteros y solo se parte lo que no cabe.",
     "analogia": "Como cortar un pastel por las marcas de las rebanadas y no con una regla cada 5 cm: cada rebanada sale entera, con su decoración.",
     "importa": "Una ventana fija de caracteres corta a media fila y a media frase. Por estructura, cada chunk habla de una sola cosa y una tabla que cabe nunca se parte.",
     "trampa": "Ventanas fijas «como en el tutorial»: todos los chunks miden lo mismo y por eso parece que funciona."},
    {"id": "ruta-titulos", "termino": "Ruta de títulos", "en": "heading path / breadcrumb", "def": "El título del documento y los títulos de sección donde empieza el chunk, en su primera línea: «Manual del vendedor › Pagos».",
     "analogia": "Como el letrero de cada pasillo de un supermercado: aunque tomes un solo producto, sabes en qué pasillo estabas.",
     "importa": "«Se retiene el pago hasta que se cierre» no dice de qué pago ni de qué documento. Con la ruta dentro del texto, el embedding y el LLM lo saben, y la cita también.",
     "trampa": "Guardar la ruta solo como metadato aparte: el embedding no la ve. Y olvidar que si el documento cambia de nombre, la ruta de todos sus chunks cambia."},
    {"id": "traslape", "termino": "Traslape", "en": "overlap", "def": "Repetir al inicio de un chunk las últimas oraciones del anterior, cuando el corte cae a media sección, para que una idea partida no quede sin principio.",
     "analogia": "Como el «en el capítulo anterior» de una serie: unos segundos de lo que pasó, para que el capítulo nuevo se entienda solo.",
     "importa": "Donde un párrafo largo se parte, el traslape evita que la respuesta quede justo en la orilla. Con 60 tokens como máximo, cuesta poco.",
     "trampa": "Un traslape fijo en todos los chunks: repite texto en los títulos (donde la ruta ya da el contexto) y en las tablas (donde estorba), y paga ese texto en cada embedding."},
    {"id": "encabezado-tabla", "termino": "Encabezado de tabla", "en": "table header", "def": "La fila que dice qué es cada columna. Si una tabla no cabe en un chunk, se parte por filas y cada pedazo lleva su encabezado.",
     "analogia": "Como las columnas de una hoja de cálculo impresa en varias páginas: si la página 2 no repite los títulos, «119 | 165 | 269» no dice nada.",
     "importa": "La tabla de tarifas tiene 32 filas y casi 1,000 tokens: no cabe. Partida sin encabezado, el LLM lee números sueltos y contesta con la columna equivocada.",
     "trampa": "Cortar a media fila o media tabla porque «el pedazo ya iba lleno»: una tabla que cabe entera en un chunk vacío empieza su propio chunk."},
    {"id": "acl-heredada", "termino": "ACL heredada y fail-closed", "en": "inherited ACL, fail-closed", "def": "Cada chunk lleva la ACL de su documento, tal cual. Un documento sin ACL no se chunkea: si no se sabe quién lo puede leer, no lo lee nadie.",
     "analogia": "Como las fotocopias de un expediente confidencial: cada copia lleva el sello de «confidencial» del original; una copia sin sello no sale del archivo.",
     "importa": "El buscador filtra chunks, no documentos (estación 3). Un chunk sin ACL, en el índice, lo vería cualquiera. Por eso un chunk nunca cruza dos documentos: no tendría una sola ACL.",
     "trampa": "Tratar acl: [] como «sin restricciones». Vacío no es público: es un dato que falta."},
    {"id": "huella", "termino": "Huella del chunker", "en": "fingerprint", "def": "Un hash de cómo se parte: la versión del código del chunker y la configuración (modelo, objetivo, traslape, estrategia). Si cambia, todo se vuelve a partir.",
     "analogia": "Como el número de edición de una receta: si cambias la receta, todo lo que hiciste con la edición vieja se vuelve a cocinar.",
     "importa": "El texto de un documento puede no cambiar y sus chunks sí (otro objetivo, otro traslape). Sin huella, el incremental guardaría chunks hechos con reglas viejas.",
     "trampa": "Cambiar el chunker sin subir CHUNKER: el incremental cree que no hay nada que hacer."},
    {"id": "incremental", "termino": "Chunking incremental", "en": "incremental chunking", "def": "Volver a partir solo los documentos cuyo texto, título o huella cambió; a los que solo cambiaron de ACL se les actualiza la ACL sin partir.",
     "analogia": "Como reimprimir solo las páginas corregidas de un manual, y a las demás solo cambiarles el sello si cambió quién las puede ver.",
     "importa": "Cada chunk partido de nuevo es un embedding que se paga y una escritura en el índice. Y un cambio de ACL sin cambio de texto tiene que llegar igual a cada chunk.",
     "trampa": "Saltar por hash y ya: si el permiso cambió con el mismo texto, los chunks se quedan con la ACL vieja, y eso es una fuga."},
]

e["mundo"] = {
    "resumen": "El kit trae lo que dejó la estación 1 del marketplace del caso: el almacén con el <b>texto limpio de 101 documentos ficticios</b> (páginas de una wiki, PDFs y markdown de un Drive, tickets de un Jira y políticas), cada uno con su hash y su ACL, más <b>tres documentos largos</b> que operaciones subió esa semana: un manual del vendedor, una tabla de tarifas de envío con 32 filas y una página de niveles de servicio. Tú escribes el chunking: contar tokens con el tokenizador del modelo de embeddings, encontrar los bloques, partir por estructura con la ruta de títulos y el traslape, llevar la ACL a cada chunk y no volver a partir lo que no cambió. Después pasa un día y ves qué vuelve a partir tu chunking. Sin Docker, sin GPU y sin internet después de bajar el tokenizador.",
    "trae": [
        {"que": "mundo/entrada/", "detalle": "El almacén de la estación 1, como salió de correr su ingestión de verdad: el catálogo del día 1 (20 de noviembre) y del día 2 (21 de noviembre), y el texto de cada documento por su hash. <code>mundo/crear.py</code> lo copia a <code>almacen/</code> y <code>mundo/avanzar.py</code> pasa al día 2."},
        {"que": "Tres documentos largos", "detalle": "El «Manual del vendedor» (1,724 tokens, con secciones, subsecciones, una tabla de comisiones y unas preguntas frecuentes que no caben en un chunk), las «Tarifas de envío por estado 2026» (una tabla de barras de 32 filas, ≈ 1,000 tokens) y los «Niveles de servicio con paqueterías» (una página de la wiki con una tabla de filas). Sin ellos, el documento más largo tendría ≈ 280 tokens y no habría nada que partir."},
        {"que": "mundo/tokenizador.py", "detalle": "Baja el tokenizer de <code>intfloat/multilingual-e5-small</code> de un commit fijo de Hugging Face (17 MB, una vez) y comprueba su sha256 antes de guardarlo. Es el modelo de embeddings del dojo: 384 dimensiones, 512 tokens de límite, multilingüe, licencia MIT."},
        {"que": "mundo/referencia.py", "detalle": "La verdad del mundo: qué documentos están vivos hoy con qué texto y qué ACL, dónde están sus tablas y qué ruta de títulos tiene cada línea. La usa <code>verificar.py</code>; no la leas para resolver un paso."},
        {"que": "verificar.py y romper.py", "detalle": "Los 10 checks de la estación (de <code>mundo</code> a <code>incremental</code>) y las 4 fallas: chunks gigantes, tabla cortada, ACL perdida y hash ignorado."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/tokens.py", "hace": "Paso 1: contar tokens como el modelo (prefijo y especiales incluidos)."},
        {"archivo": "pipeline/bloques.py", "hace": "Paso 2: el texto en bloques: títulos, párrafos, listas y tablas de dos formas."},
        {"archivo": "pipeline/chunker.py", "hace": "Pasos 3 a 5: la ruta de títulos, el llenado por bloques, partir lo que no cabe (tablas con encabezado) y el traslape. También la ventana fija, para comparar."},
        {"archivo": "pipeline/chunkear.py", "hace": "Pasos 6 y 7: un archivo por documento con su ACL en cada chunk, fail-closed, lápidas, el incremental y la corrida."},
        {"archivo": "pipeline/_comun.py", "hace": "Viene dado: las rutas, config() y escribir de un jalón."},
        {"archivo": "config.yaml", "hace": "El modelo (tokenizer, prefijo, límite), el chunking (estrategia, objetivo, traslape) y el incremental."},
    ],
    "requisitos": [
        "Python 3.10 o más nuevo (se probó con 3.14.3) y ≈ 60 MB para el entorno virtual y el tokenizer",
        "Internet para el <code>pip install</code> (tokenizers 0.23.3 y pyyaml) y para bajar el tokenizer una vez",
        "La estación 1 ayuda, pero no hace falta: el kit trae su salida",
    ],
    "sustituciones": [
        {"nube": "El almacén de la ingestión en S3", "local": "<code>almacen/</code>, una carpeta", "diferencia": "La misma forma: un JSON de texto por hash y un catálogo. En C11 son ≈ 1.5 M de registros y el job lee solo los que cambiaron desde la última corrida; aquí lee el catálogo entero, que es chico."},
        {"nube": "El modelo de embeddings que sirve la plataforma", "local": "Solo su tokenizer, en <code>modelo/tokenizer.json</code>", "diferencia": "Para partir no hace falta el modelo, solo su forma de contar. El modelo entero (≈ 470 MB) llega en la estación 5. En C11 el equipo fija la revisión del modelo igual que aquí."},
        {"nube": "Un job programado después de cada ingestión", "local": "<code>python pipeline/chunkear.py</code> a mano (y el «job» de romper.py)", "diferencia": "En C11 corre en la plataforma de datos y deja sus cuentas en métricas y alertas; aquí deja un JSON por corrida en <code>chunks/corridas/</code>."},
        {"nube": "Chunks en una tabla o en la cola hacia el índice", "local": "<code>chunks/docs/&lt;doc&gt;.json</code>", "diferencia": "Un archivo por documento hace fácil reemplazar todos sus chunks de un jalón cuando el documento cambia, que es lo que el índice de la estación 5 necesita: borrar los viejos y escribir los nuevos."},
    ],
    "arranque": "unzip rag-chunking.zip && cd rag-chunking\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython mundo/tokenizador.py\npython mundo/crear.py",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El tokenizer bajado y comprobado, y el almacén de la estación 1 del día 1 en <code>almacen/</code>.",
    conceptos=["tokenizador"],
    explica="Dos cosas antes de escribir código. El <b>tokenizer</b> del modelo de embeddings: <code>mundo/tokenizador.py</code> lo baja de un commit fijo de Hugging Face (no de «main», que puede cambiar mañana) y compara su sha256 con el anotado; si no coincide, no lo guarda. Y el <b>almacén</b> que dejó la estación 1: <code>mundo/crear.py</code> lo copia de <code>mundo/entrada/</code> a <code>almacen/</code>. Tu chunking solo lee <code>almacen/</code> y escribe en <code>chunks/</code>.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("python mundo/tokenizador.py", L("p0 tokenizer"), "Una vez, con internet. Si lo corres otra vez, ve que ya está y que su sha256 coincide."),
        cmd("python mundo/crear.py", L("p0 crear")),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd(f"{V} tokens", L("p0 esqueleto"), "Es lo esperado: <code>pipeline/</code> todavía es el esqueleto. Cada check se pone en verde en su paso."),
    ],
    verifica="<code>verificar.py mundo</code> en verde.",
    ojo="Si <code>pip install tokenizers</code> tarda, es que está compilando: con Python 3.10 a 3.14 en una Mac hay rueda lista (la 0.23.3 trae cp310-abi3 para arm64 e Intel)."))
G.append(dict(n=1, id="tokens", titulo="Contar como cuenta el modelo", objetivo="<code>contar()</code>: los tokens que ve multilingual-e5-small, con el prefijo «passage: » y los tokens especiales.",
    conceptos=["token", "tokenizador", "limite-modelo", "prefijo"],
    explica="El modelo no lee caracteres: lee <b>tokens</b>, pedazos de palabra de su vocabulario de 250 mil. <code>Tokenizer.from_file()</code> carga ese vocabulario y <code>encode(texto).ids</code> da la lista de tokens. Al pasarle un pedazo de documento, e5 espera «passage: » delante, y el tokenizer agrega <code>&lt;s&gt;</code> al principio y <code>&lt;/s&gt;</code> al final: eso es lo que hay que contar, porque es lo que entra en los 512. <code>tokens_texto()</code> mide un pedazo solo (sin esos 5 fijos), para el traslape.",
    codigo=[py("pipeline/tokens.py")],
    comandos=[
        cmd(P("p1 contar"), L("p1 contar"), "Mira cómo parte: «devolver» son dos tokens y «licuadora» tres. La misma pregunta en inglés gasta menos."),
        cmd(f"{V} tokens", L("p1 verificar")),
    ],
    verifica="<code>verificar.py tokens</code> en verde: tu cuenta es la del modelo en cinco textos, del vacío al manual entero.",
    ojo="<code>encode()</code> no trunca si no se lo pides (este tokenizer.json no trae truncation): contar() dice 1,724 aunque el modelo solo lea 512. Eso es justo lo que quieres para medir.",
    en_pagina={"precalculos": ["tokens", "corte"]}))
G.append(dict(n=2, id="bloques", titulo="Ver la estructura", objetivo="<code>bloques()</code>: el texto en títulos, párrafos, listas y tablas, sin perder ni cambiar una línea.",
    conceptos=["chunking-estructura", "encabezado-tabla"],
    explica="La estación 1 dejó el texto con su estructura a la vista: «# », «## » y «### » para los títulos, una línea por párrafo, «- » para cada ítem y las tablas en dos formas. Las de la wiki, fila por fila: «Categoría: Moda; Plazo: 30 días». Las de los markdown, con barras: «| Estado | Zona |», con una fila separadora «|---|». Un <b>bloque</b> es la unidad que no conviene partir: un título, un párrafo, una lista entera o una tabla entera. La tabla trae además su <b>encabezado</b>, las líneas que se repiten si hay que partirla (en una de filas no hace falta: cada fila ya dice qué es cada valor).",
    codigo=[py("pipeline/bloques.py")],
    comandos=[
        cmd(P("p2 bloques"), L("p2 bloques"), "«Devoluciones», de la wiki: su tabla de 4 filas sale como un solo bloque."),
        cmd(f"{V} bloques", L("p2 verificar")),
    ],
    verifica="<code>verificar.py bloques</code> en verde: todas las líneas, en orden, y las tablas enteras con su encabezado.",
    ojo="Una línea de ticket como «Resolución: se reembolsó» parece una fila de tabla. Por eso una tabla de filas son dos o más líneas seguidas con el mismo primer encabezado y al menos un «; Encabezado: »."))
G.append(dict(n=3, id="estructura", titulo="Partir por estructura, con su ruta", objetivo="<code>chunks_estructura()</code>: cada sección empieza un chunk, los bloques entran enteros y cada chunk lleva su ruta de títulos. Y la ventana fija, para comparar.",
    conceptos=["chunk", "chunking-estructura", "ruta-titulos", "embedding"],
    explica="Primero la versión que tienen muchos tutoriales: <code>chunks_fijos()</code>, ventanas de 1,200 caracteres que se traslapan 150. Córrela sobre las tarifas y mira dónde corta. Después la buena. Recorres los bloques llevando una <b>pila de títulos</b> (un «## » nuevo reemplaza al anterior y borra los «### » de abajo). Cada «#» o «##» cierra el chunk y empieza otro; un «###» no, para que las subsecciones de una sección viajen juntas. Un título va siempre pegado al bloque que le sigue, así ningún chunk termina en un título. Cada bloque entra entero si cabe; si no, se cierra el chunk. El texto del chunk empieza con su <b>ruta</b>, «Manual del vendedor › Pagos», y cuentas con <code>contar()</code> ese texto completo. El código de abajo trae los pasos 3, 4 y 5 juntos; en este paso escribe la ruta y el llenado, y para un bloque que no cabe, por ahora, una excepción.",
    codigo=[py("pipeline/chunker.py", "Los pasos 3 a 5 en un archivo: el 4 es <code>_partir()</code> y el 5 es la cola que devuelve <code>cerrar()</code>."), py("pipeline/chunkear.py", "En este paso basta la parte de abajo de <code>correr()</code>: partir cada documento vivo y escribir su archivo. El incremental es del paso 7.")],
    comandos=[
        cmd(P("p3 fija"), L("p3 fija"), "La ventana fija sobre las tarifas: corta «Jalisco | Occidente | 10» a media fila, el segundo pedazo no dice qué es cada columna y pasa de 400 tokens (una tabla gasta más tokens por carácter que la prosa)."),
        cmd(P("p3 estructura"), L("p3 estructura"), "Tokens, tokens de traslape y ruta de cada chunk. Aquí ya se ven los pasos 4 y 5: las tarifas en tres pedazos y un traslape de 47."),
        cmd("python pipeline/chunkear.py", L("p3 chunkear")),
        cmd(P("p3 un chunk"), L("p3 un chunk"), "La ruta va dentro del texto: es lo que va a embeber el modelo en la estación 5."),
        cmd(f"{V} ruta docs", L("p3 verificar")),
    ],
    verifica="<code>verificar.py ruta docs</code> en verde: cada chunk empieza con la ruta de donde empieza su contenido, y entre todos traen cada oración de su documento.",
    ojo="La ruta es la de donde empieza el <b>contenido</b> del chunk, no la de su última línea: si un chunk junta «### Retenciones» y «### Facturación», su ruta es «Manual del vendedor › Pagos».",
    en_pagina={"precalculos": ["chunks"]}))
G.append(dict(n=4, id="partir", titulo="Partir lo que no cabe, sin romper tablas", objetivo="Un bloque más grande que un chunk se parte en pedazos: oraciones, ítems o filas. Cada pedazo de tabla lleva su encabezado.",
    conceptos=["encabezado-tabla", "limite-modelo"],
    explica="La tabla de tarifas tiene ≈ 1,000 tokens: no cabe ni en un chunk vacío. Se parte en sus unidades naturales: una <b>tabla por filas</b> (nunca a media fila), una lista por ítems, un párrafo por oraciones. Cada chunk que recibe filas de una tabla de barras empieza con sus dos líneas de <b>encabezado</b>. Y la regla que evita la mayoría de los cortes feos: una tabla que sí cabe en un chunk vacío nunca se parte; si no cabe en lo que queda del chunk actual, empieza uno nuevo.",
    codigo=[],
    comandos=[
        cmd(P("p4 tabla"), L("p4 tabla"), "Las tarifas: cada pedazo con la ruta, el encabezado y su separadora, y filas enteras hasta el final."),
        cmd(f"{V} tamano tablas", L("p4 verificar")),
    ],
    verifica="<code>verificar.py tamano tablas</code> en verde: ningún chunk pasa de 400 tokens, ninguna sección se partió sin necesidad, las tablas que caben van enteras y las que no, con su encabezado en cada pedazo.",
    ojo="El encabezado y la ruta también gastan tokens. Por eso se cuenta el chunk completo (ruta + encabezado + filas) antes de agregar cada fila, no las filas solas.",
    en_pagina={"precalculos": ["corte"]}))
G.append(dict(n=5, id="traslape", titulo="Traslape solo donde sirve", objetivo="Cuando un corte cae a media sección, el chunk siguiente empieza con las últimas oraciones del anterior, hasta 60 tokens.",
    conceptos=["traslape"],
    explica="Las «Preguntas frecuentes» del manual son una sola sección de ≈ 540 tokens: el corte cae entre dos preguntas, sin título que dé contexto. Ahí sirve el <b>traslape</b>: al cerrar el chunk, tomas sus últimas oraciones mientras sumen ≤ 60 tokens (<code>tokens_texto</code>) y las pones como primera línea del siguiente, que anota cuántos tokens repite. En un título no va (la ruta ya da el contexto) y en una tabla tampoco (se repite el encabezado).",
    codigo=[],
    comandos=[
        cmd(P("p5 traslape"), L("p5 traslape"), "El final del primer chunk de las preguntas frecuentes y el principio del segundo: la respuesta sobre devoluciones con otro producto se repite entera."),
        cmd(f"{V} traslape", L("p5 verificar")),
    ],
    verifica="<code>verificar.py traslape</code> en verde: el traslape es el final del chunk anterior, de la misma sección, ≤ 60 tokens y nunca en títulos ni tablas.",
    ojo="Si el traslape más el siguiente pedazo no caben, gana el pedazo: el chunk empieza sin traslape. Un traslape nunca puede hacer que un chunk pase de 400.",
    en_pagina={"precalculos": ["traslape"]}))
G.append(dict(n=6, id="acl", titulo="Cada chunk con la ACL de su documento", objetivo="Un archivo por documento vivo, cada chunk con la ACL, el título, la URL y la versión de su documento; sin ACL o sin texto, no se chunkea.",
    conceptos=["acl-heredada"],
    explica="Un chunk es de <b>un solo documento</b> y lleva su ACL tal cual: las cláusulas que dejó la estación 1 (todas tienen que cumplirse; en cada una, basta un principal). En la estación 3 el buscador filtra por esa ACL antes de que un chunk llegue al prompt. Tres reglas más: una <b>lápida</b> (un documento borrado) pierde su archivo; un documento con la ACL vacía <b>no se chunkea</b> (fail-closed: vacío no es público, es un dato que falta) y la corrida lo lista en <code>sin_acl</code>; y un documento sin texto, como el acta escaneada que espera OCR, tampoco.",
    codigo=[],
    comandos=[
        cmd(P("p6 acl"), L("p6 acl"), "«Sueldos 2026» solo lo lee su dueña, y su chunk también."),
        cmd(P("p6 sin texto"), L("p6 sin texto"), "103 archivos para 104 documentos: el acta escaneada (drive:d06) no tiene texto todavía."),
        cmd(f"{V} docs acl", L("p6 verificar")),
    ],
    verifica="<code>verificar.py docs acl</code> en verde: ningún chunk cruza documentos ni pierde texto, y cada uno tiene la ACL de su documento.",
    ojo="Copia la ACL, no la reconstruyas: si la «simplificas» (por ejemplo, juntando las cláusulas en una sola lista), un permiso que era AND se vuelve OR."))
G.append(dict(n=7, id="incremental", titulo="No volver a partir lo que no cambió", objetivo="El incremental: mismo texto, mismo título y misma huella, no se parte; si solo cambió la ACL o la versión, se actualizan sin partir. Y el día 2.",
    conceptos=["huella", "incremental"],
    explica="Cada archivo guarda el <code>sha256_texto</code> de su documento y la <b>huella</b> del chunker (un hash de <code>CHUNKER</code> y de las secciones modelo y chunking de config.yaml). En la corrida siguiente comparas: mismo texto, mismo título y misma huella, no se parte. ¿Por qué el título? Porque va en la ruta, dentro del texto de cada chunk. Si además cambió la ACL, la URL o la versión, reescribes esos campos en cada chunk sin partir (<code>solo_meta</code>). Después pasas al día 2 con <code>mundo/avanzar.py</code> y comparas lo que hizo tu corrida con lo que cambió (está en el docstring de avanzar.py).",
    codigo=[],
    comandos=[
        cmd("python pipeline/chunkear.py", L("p7 segunda"), "La segunda corrida del día 1: nada que partir."),
        cmd("python mundo/avanzar.py", L("p7 avanzar")),
        cmd("python pipeline/chunkear.py", L("p7 dia2")),
        cmd(P("p7 corrida"), L("p7 corrida"), "12 con texto o título nuevo, 4 con el mismo texto y otra ACL o versión, y las 2 lápidas."),
        cmd(P("p7 ruta"), L("p7 ruta"), "«Lineamientos de fotos» solo cambió de nombre y se volvió a partir: su ruta ya dice el nombre nuevo."),
        cmd(P("p7 acl nueva"), L("p7 acl nueva"), "«Política de viajes» dejó de ser de todo el dominio el día 2, sin cambiar de texto: sus chunks ya traen la ACL nueva."),
        cmd("python pipeline/chunkear.py\n" + V, L("p7 tercera") + "\n" + L("p7 verificar")),
    ],
    verifica="<code>verificar.py</code> completo en verde, con <code>incremental</code>: el día 2 partió solo lo que cambió y la última corrida no partió nada.",
    ojo="Saltar por hash y ya es una fuga: «Alta de vendedores» quedó solo para líderes el día 2 con el mismo texto. Si tu incremental compara solo el texto, sus chunks siguen abiertos a todo operaciones.",
    en_pagina={"precalculos": ["diario"]}))
# en qué paso se abre cada concepto y cada precálculo (uno por paso; ninguno repetido)
EN_PAGINA = {1: (["token", "tokenizador", "limite-modelo", "prefijo"], ["tokens", "corte"]), 2: (["chunking-estructura"], []),
             3: (["chunk", "ruta-titulos", "embedding"], ["chunks"]), 4: (["encabezado-tabla"], []), 5: (["traslape"], ["traslape"]),
             6: (["acl-heredada"], []), 7: (["huella", "incremental"], ["diario"])}
for g in G:
    g.pop("en_pagina", None)
    if g["n"] in EN_PAGINA:
        g["en_pagina"] = {"conceptos": EN_PAGINA[g["n"]][0], "precalculos": EN_PAGINA[g["n"]][1]}
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py</code>: deja el esqueleto, borra <code>chunks/</code> y vuelve al día 1 (el tokenizer se queda).",
        "Sin GUION.md ni <code>mundo/referencia.py</code>: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El tokenizer bajado con su sha256 y el almacén de la estación 1 en su lugar.", "check": "mundo"},
        {"n": 2, "objetivo": "<code>contar()</code> da lo mismo que el modelo: prefijo y tokens especiales incluidos.", "check": "tokens", "pista": "¿Cuántos tokens tiene el texto vacío para e5?"},
        {"n": 3, "objetivo": "Los bloques: títulos con su nivel, párrafos, listas y las tablas de las dos formas, enteras.", "check": "bloques"},
        {"n": 4, "objetivo": "Cada chunk empieza con la ruta de títulos de donde empieza su contenido.", "check": "ruta", "pista": "¿Qué pasa con la pila cuando llega un «##» después de un «###»?"},
        {"n": 5, "objetivo": "Ningún chunk pasa de 400 tokens y ninguna sección se parte si cabe.", "check": "tamano"},
        {"n": 6, "objetivo": "Las tablas que caben van enteras; las que no, por filas y con su encabezado.", "check": "tablas"},
        {"n": 7, "objetivo": "Traslape de hasta 60 tokens solo en los cortes a media sección.", "check": "traslape"},
        {"n": 8, "objetivo": "Un archivo por documento vivo, ningún chunk cruza documentos y no se pierde ni una oración.", "check": "docs"},
        {"n": 9, "objetivo": "Cada chunk con la ACL de su documento, también cuando la ACL cambia sin cambiar el texto.", "check": "acl"},
        {"n": 10, "objetivo": "El día 2 se parte solo lo que cambió de texto o de título, y una corrida sin cambios no parte nada.", "check": "incremental", "pista": "Un documento cambió solo de nombre: ¿cambian sus chunks?"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


e["fallas"] = [
    falla("chunks-gigantes", "«¿Cuánto cuesta mandar a Zacatecas?» ya no encuentra la tabla de tarifas", "config",
          "Alguien leyó que «más contexto por chunk da mejores respuestas» y subió el tamaño en un PR chiquito. Los chunks se ven bien en el log; las preguntas por los estados del final de la tabla de tarifas dejaron de encontrar nada.",
          "<code>verificar.py</code> marca <code>tamano</code> (un chunk de 871 tokens, más que los 512 del modelo) y <code>traslape</code> (las preguntas frecuentes ya no tienen corte).",
          ["El manual cambió y perdió esa sección.", "Los chunks pasan del límite del modelo y lo de después no se embebe.", "El tokenizer está contando mal."],
          cmd(f"{V} tamano traslape", F("gig verificar")),
          "En config.yaml, <code>chunking.objetivo</code> quedó en 1500. Vuelve a 400 y corre <code>python pipeline/chunkear.py</code>: la huella cambia y se vuelve a partir todo, que es lo correcto. El tamaño lo ponen el límite del modelo y el golden set, no la intuición.",
          "limite-modelo", "tamano"),
    falla("tabla-cortada", "«¿Cuánto cuesta mandar 3 kg a Sonora?» contesta con la tarifa de otro estado", "config",
          "Para simplificar, alguien cambió el chunking a «ventanas fijas de 1,200 caracteres, como en el tutorial». Todos los chunks miden casi lo mismo y el cambio parecía inofensivo.",
          "<code>verificar.py</code> marca <code>ruta</code> (chunks sin ruta de títulos), <code>tablas</code> (tablas partidas) y <code>tamano</code>.",
          ["La tabla de tarifas llegó mal de la ingestión.", "El chunker ya no mira la estructura.", "El LLM confunde columnas."],
          cmd(P("tab ver", PROBARF), F("tab ver"), "Los primeros chunks de las tarifas: empiezan y terminan a media fila."),
          "<code>chunking.estrategia</code> quedó en <code>fija</code>. Vuelve a <code>estructura</code> y <code>python pipeline/chunkear.py</code>. Una tabla partida sin encabezado es un montón de números sueltos: el LLM los va a leer igual, y mal.",
          "encabezado-tabla", "tablas"),
    falla("acl-perdida", "Tres documentos del Drive desaparecieron del asistente", "infra",
          "La ingestión estrenó un cambio en el conector del Drive para los archivos markdown. Desde entonces, operaciones dice que el asistente ya no conoce el manual del vendedor ni las tarifas.",
          "<code>verificar.py acl</code>: tres documentos vivos llegan con la ACL vacía en el catálogo y no tienen chunks. <code>docs</code> pasa.",
          ["Los documentos se borraron del Drive.", "El catálogo llegó sin sus permisos y el chunking los dejó fuera.", "El chunking tiene un bug con los markdown."],
          cmd(P("acl corrida", PROBARF), F("acl corrida"), "La corrida lo dice: no los chunkeó porque no tenían ACL."),
          "Tu chunking hizo lo correcto (fail-closed): con <code>acl: []</code> en el índice, serían de todos. No se arregla en <code>chunks/</code> ni editando el catálogo: se arregla la ingestión. Vuelve a correrla ya corregida (<code>python mundo/crear.py --reingestar</code> hace de ella) y <code>python pipeline/chunkear.py</code>.",
          "acl-heredada", "acl"),
    falla("hash-ignorado", "El job de chunking tarda lo mismo aunque nada cambie", "config",
          "Alguien apagó el incremental para depurar un documento y el cambio se fue a producción. Nada se ve roto: los chunks salen iguales que antes.",
          "<code>verificar.py incremental</code>: la última corrida volvió a partir los 105 documentos y ninguno había cambiado. Todos los demás checks pasan.",
          ["Cambió la huella del chunker.", "El chunking ya no compara el hash del texto.", "La ingestión reescribió todo el almacén."],
          cmd(P("hash corrida", PROBARF), F("hash corrida")),
          "<code>incremental</code> quedó en <code>false</code>. Vuelve a <code>true</code> y <code>python pipeline/chunkear.py</code>. En C11 serían 1.5 M de documentos re-embebidos cada corrida. Para depurar un documento está <code>--doc</code>, que no apaga nada.",
          "incremental", "incremental"),
    falla("prefijo-perdido", "Las búsquedas empeoraron sin que nadie tocara el chunker", "config",
          "En una limpieza de config.yaml alguien quitó el «passage: » porque «ensucia el texto de los chunks». El job volvió a partir todo y terminó bien.",
          "<code>verificar.py</code> marca <code>tokens</code> (contar() ya no da lo que ve el modelo) y <code>tamano</code> («tokens» no es lo que cuenta el modelo).",
          ["Cambió el tokenizer.", "Cambió cómo se le presenta el texto al modelo.", "El chunker cambió de versión."],
          cmd(f"{V} tokens tamano", F("pre verificar")),
          "<code>modelo.prefijo</code> quedó vacío. Vuelve a <code>\"passage: \"</code> y <code>python pipeline/chunkear.py</code> (la huella incluye el modelo, así que vuelve a partir todo). e5 se entrenó con «passage: » y «query: »: sin el prefijo, la búsqueda empeora, y cada chunk cuenta menos tokens de los que verá el modelo.",
          "prefijo", "tokens"),
    falla("texto-truncado", "El asistente dice que el manual no habla de pagos", "infra",
          "La ingestión estrenó un parser nuevo (v2) y volvió a parsear el «Manual del vendedor». Desde ayer, «¿cuándo me pagan?» no encuentra nada en el manual.",
          "<code>verificar.py docs</code>: se perdió texto de drive:d20 al partir. Los demás checks pasan.",
          ["El chunker perdió bloques al partir.", "El texto llegó incompleto de la ingestión.", "El manual se editó y quitaron secciones."],
          cmd(P("tru corrida", PROBARF), F("tru corrida"), "Tu chunking vio texto nuevo y volvió a partir el manual: ahora son 5 chunks y terminan en «Envíos»."),
          "El parser v2 de la estación 1 se quedó a la mitad del manual. No se arregla en <code>chunks/</code>: se arregla la ingestión (<code>python mundo/crear.py --reingestar</code> hace de ella, con el parser bueno) y <code>python pipeline/chunkear.py</code>. En C11, una buena alarma: un documento cuyo texto se encoge a la mitad de un día para otro.",
          "chunking-estructura", "docs"),
]

e["listo"] = [
    "Los tokens se cuentan con el tokenizador del modelo de embeddings, con su prefijo y sus tokens especiales.",
    "Ningún chunk pasa de 400 tokens y cada uno empieza con su ruta de títulos.",
    "Cada sección empieza un chunk; una tabla que cabe va entera y una que no, por filas con su encabezado.",
    "El traslape va solo en los cortes a media sección, y cuesta poco.",
    "Un chunk es de un solo documento y lleva su ACL; sin ACL, no se chunkea.",
    "Lo que no cambió de texto, título ni huella no se vuelve a partir, y un cambio de ACL llega igual a cada chunk.",
]

e["repaso"] = {
    "memo": "<b>Cuenta con el tokenizador del modelo, parte por la estructura, mete la ruta en el texto y no vuelvas a partir lo que no cambió.</b> El límite del modelo (512) manda sobre el tamaño (400), y el modelo no avisa cuando corta. Cada sección empieza un chunk; las tablas no se parten si caben y, si no, llevan su encabezado; el traslape va solo donde el corte parte una idea. Cada chunk hereda la ACL de su documento, y sin ACL no hay chunk.",
    "trampa": "Un chunking que «funciona» porque todos los chunks miden lo mismo. Las ventanas fijas cortan tablas a media fila y dejan chunks sin contexto; los chunks gigantes se embeben a medias sin ningún error; y un incremental que solo mira el texto deja la ACL vieja cuando el permiso cambia. Nada de eso truena: se ve en las respuestas, días después. Por eso cada regla tiene su check.",
    "entrevista": [
        {"q": "¿Cómo eliges el tamaño de los chunks?", "a": "Empiezo por el límite del modelo de embeddings (multilingual-e5-small lee 512 tokens) y dejo aire: ≈ 400, contados con su tokenizador y con su prefijo. Después lo decide el golden set: pruebo 256, 400 y 512 y me quedo con el que da mejor recall@8 sin perder faithfulness. Más grande no es más contexto: pasado el límite se corta, y antes de eso el vector promedia temas."},
        {"q": "¿Chunks de tamaño fijo o por estructura?", "a": "Por estructura: cada sección empieza un chunk, los bloques entran enteros y solo se parte lo que no cabe, por oraciones, ítems o filas. La ventana fija es más simple, pero corta tablas a media fila y frases a la mitad, y sus chunks no dicen de qué sección vienen."},
        {"q": "¿Qué haces con una tabla de 1,000 tokens?", "a": "La parto por filas, nunca a media fila, y cada pedazo repite el encabezado y lleva la ruta de títulos. Si la tabla cabe en un chunk vacío, no la parto: empieza su propio chunk."},
        {"q": "¿Pones traslape?", "a": "Solo donde sirve: cuando un corte cae a media sección, el chunk siguiente empieza con las últimas oraciones del anterior, hasta 60 tokens. En un título no hace falta, porque la ruta da el contexto, y en una tabla estorba. Un traslape fijo del 15 % en todo es 15 % más de embeddings para casi nada."},
        {"q": "Un documento cambia de permisos pero no de texto. ¿Qué pasa con sus chunks?", "a": "Tienen que tomar la ACL nueva aunque no se vuelvan a partir. Mi incremental salta solo si el texto, el título y la huella son los mismos, y aun así compara la ACL: si cambió, la reescribe en cada chunk. Si solo mirara el hash del texto, el chunk seguiría abierto a quien ya no debería verlo."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/rag-chunking/CLAUDE.md",
    "guiado": "content/estaciones/rag-chunking/prompts/guiado.md",
    "solo": "content/estaciones/rag-chunking/prompts/solo.md",
    "romper_ayuda": "content/estaciones/rag-chunking/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/rag-chunking/prompts/romper-solo.md",
}

(APP / "content/estaciones/rag-chunking.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
