"""Arma content/estaciones/rag-indice.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/r5 && bash probar-fallas.sh /ruta/r5     # deja /ruta/r5.log y /ruta/r5-fallas.log
    python3 contenido.py /ruta/r5                                  # escribe el JSON con esas salidas

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
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^cp |^#|\Z)', fuente or PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"no está el paso «{nombre}» en probar.sh")
    c = m.group(1).strip()
    if c.startswith("python -c \""):
        c = c.replace("\\\"", "\"")
    return c


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def py(rel: str, nota: str = "") -> dict:
    return {"lang": "python", "path": rel, "code": code(rel), "nota": nota}


import re as _re
_c = L("p2 cache")
H_TODO = _re.search(r"≈ ([\d,]+) h en una Mac", _c).group(1)
H_DIA = _re.search(r"un día .*?≈ ([\d.]+) h", _c).group(1)
S1 = _re.search(r"primera vez: .*? en ([\d.]+) s", _c).group(1)
S2 = _re.search(r"segunda vez: .*? en ([\d.]+) s", _c).group(1)
_f = L("pc fuerza")
MS_MAC = _re.search(r"en ([\d.]+) ms por pregunta", _f).group(1)
MS_C11 = _re.search(r"≈ (\d+) ms por pregunta", _f).group(1)
_t = L("p7 trafico")
N_TRAF = _re.search(r"^(\d+) peticiones", _t).group(1)
N_TRAF = f"{int(N_TRAF):,}"
V = "python verificar.py"
VIG = "c11-e5-2026-11-22"

e = {
    "id": "indice", "patron": "llm", "rama": "rag", "etapa": "modelo", "num": 5,
    "titulo": "Embeddings e índice híbrido", "nav": "Índice híbrido",
    "pregunta": "¿Cómo conviertes cada chunk en algo que se pueda buscar por palabras y por significado, sin mezclar modelos, sin saltarte los permisos y cambiando de índice sin que el asistente deje de contestar?",
    "version": "2026-11-26",
}

e["mapa"] = {
    "resumen": "Las estaciones 1 a 4 dejaron listo el corpus y el examen: cada documento partido en <b>chunks</b> con su ruta de títulos y su <b>ACL</b> (quién lo puede leer), y un <b>golden set</b> con preguntas, fuentes y quién las hace. Ahora toca el lugar donde el asistente busca: el <b>índice</b>. Se arman dos sobre los mismos chunks. <b>BM25</b> busca por palabras: encuentra «SOP-41» o «Sonora» aunque nadie lo diga con otras palabras. El de <b>vectores</b> busca por significado: cada chunk se convierte en un <b>embedding</b> (una lista de 384 números) con un modelo local chico, y una pregunta con otras palabras cae cerca de su respuesta. Juntos son un índice <b>híbrido</b>. Cada vector guarda <b>qué modelo y qué versión</b> lo hizo, porque vectores de modelos distintos no se comparan. Lo ya embebido no se vuelve a embeber (<b>cache</b>). La ACL va dentro del índice y se filtra <b>antes</b> de elegir el top-8. Cada índice nuevo se construye <b>al lado</b> del que está sirviendo, se mide con el golden set, y la API cambia de índice moviendo un <b>alias</b>, de un jalón y con forma de <b>volver atrás</b>. La estación 6 fusiona las dos listas con <b>RRF</b> (reciprocal rank fusion: cada chunk suma 1/(k + su lugar) en cada lista donde aparece, así no hay que comparar puntajes de BM25 con cosenos) y les pone un reranker.",
    "entra": [
        "lo que dejaron las estaciones 2 a 4: el corpus del 22 (<code>almacen/corpus/vigente.json</code>, 151 chunks de 104 documentos, cada uno con su ruta de títulos y su ACL en grupos), el directorio de la empresa y golden-v2 (65 preguntas, 51 en test)",
        "dos modelos de embeddings de Hugging Face, de un commit fijo y con su sha256: multilingual-e5-small (el del dojo, el mismo tokenizer de la estación 2) y all-MiniLM-L6-v2 (el del piloto)",
        "el índice del piloto, que dejó anoche su job (<code>c11-minilm-2026-11-22</code>), y el alias <code>c11</code> apuntando a él",
    ],
    "sale": [
        f"<code>indices/{VIG}/</code>: BM25 y vectores de los mismos 151 chunks, la ACL de cada uno y un manifiesto con el modelo (repositorio, revisión y sha256), la dimensión, el corpus y el sha256 de cada archivo",
        "<code>cache/embeddings/</code>: cada embedding ya hecho, guardado por modelo, revisión y huella del texto",
        "<code>indices/alias.json</code>: c11 apuntando al índice nuevo, con el anterior guardado para volver y el historial de cambios",
        "<code>indices/&lt;índice&gt;/prueba.json</code>: el recall@8 de BM25 y de vectores por separado con el golden set, la línea base que la estación 6 va a mejorar",
    ],
    "escala": [
        {"que": "Chunks", "ref": "≈ 7.5 M (estación 2)", "taller": "151 de 104 documentos"},
        {"que": "Vectores", "ref": "≈ 11.5 GB con 384 dimensiones en float32; ≈ 30.7 GB con un modelo de 1,024", "taller": "232 KB"},
        {"que": "Embeber todo", "ref": "≈ 2.25 mil millones de tokens: días en una Mac, horas con GPU", "taller": f"≈ 11 mil tokens en ≈ {S1} s"},
        {"que": "Dónde vive", "ref": "un motor de búsqueda (BM25 y vectores con índice aproximado, HNSW) detrás de un alias", "taller": "una carpeta por índice, búsqueda exacta con numpy y <code>indices/alias.json</code>"},
        {"que": "La API de búsqueda", "ref": "un servicio aparte, ≈ 25k preguntas al día", "taller": "<code>mundo/servicio.py</code> en el puerto 8150 y <code>mundo/trafico.py</code>"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de escribir código, las cuentas de servilleta del índice: cuánto pesa el modelo y de dónde sale ese peso, cuánto pesan los vectores, cuánto tarda embeber todo otra vez, cuánto cuesta comparar la pregunta contra todos los vectores y cuánto espacio pide tener dos índices a la vez.",
    "cuentas": [
        {"id": "modelo", "pregunta": "¿Cuánto pesa el modelo de embeddings, y de dónde sale ese peso?",
         "formula": "parámetros ≈ bytes del archivo ÷ 4 (cada número en float32 son 4 bytes); el vocabulario pesa palabras del vocabulario × dimensión",
         "ref": {"cuenta": "el mismo modelo en el job de embeddings y en la API de búsqueda", "valor": "≈ 470 MB cada copia, en cada máquina que embeba"},
         "taller": {"cuenta": "multilingual-e5-small y all-MiniLM-L6-v2", "valor": "e5: ≈ 117.6 M parámetros, 82 % es el vocabulario de 250 mil piezas; MiniLM: ≈ 22.6 M, 52 %"},
         "decide": "e5-small es «chico» por dentro (12 capas de 384) pero pesa por su vocabulario de ≈ 100 idiomas. El modelo pesa más que todo el índice del dojo: se baja una vez, de un commit fijo, y se comprueba su sha256.",
         "conceptos": ["modelo-embeddings", "firma-modelo"],
         "comprueba": cmd(P("pc modelo"), L("pc modelo"))},
        {"id": "reembeber", "pregunta": "¿Cuánto tarda volver a embeber todo el corpus?",
         "formula": "horas = tokens del corpus ÷ tokens por segundo del modelo ÷ 3600",
         "ref": {"cuenta": "7.5 M chunks × ≈ 300 tokens = 2.25 mil millones de tokens, a la velocidad de tu Mac; y lo que cambia en un día (≈ 75 mil chunks, estación 2)", "valor": f"≈ {H_TODO} h todo; ≈ {H_DIA} h lo de un día"},
         "taller": {"cuenta": "151 chunks, ≈ 11 mil tokens con e5-small en tu Mac", "valor": f"≈ {S1} s la primera vez; ≈ {S2} s la segunda (todo sale del cache)"},
         "decide": "Re-embeber todo es un proyecto de días (o de horas con GPU), no algo de cada noche: cada noche solo se embebe lo que cambió, y eso pide un cache cuya llave sea el modelo y el texto. Cambiar de modelo sí es re-embeber todo, en un índice nuevo al lado.",
         "conceptos": ["cache-embeddings", "al-lado"],
         "confirma": "Paso 2: el primer comando mide los tokens por segundo de tu Mac y hace la cuenta de C11 con ellos."},
        {"id": "tamano", "pregunta": "¿Cuánto pesan los vectores del índice?",
         "formula": "bytes = chunks × dimensión × 4 (float32)",
         "ref": {"cuenta": "7.5 M chunks × 384 (si C11 usara e5-small); y con un modelo de 1,024 dimensiones", "valor": "≈ 11.5 GB; ≈ 30.7 GB"},
         "taller": {"cuenta": "151 chunks × 384", "valor": "232 KB (y vectores.npy pesa 232,064 bytes: 128 son su encabezado)"},
         "decide": "En C11 los vectores caben en la RAM de una máquina grande, pero no sobran: el índice aproximado agrega su grafo, y durante un cambio de índice viven dos. Un modelo con más dimensiones no es gratis: casi triplica la memoria.",
         "conceptos": ["dimension", "embedding"],
         "comprueba": cmd(P("pc tamano"), L("pc tamano"))},
        {"id": "fuerza", "pregunta": "¿Cuánto cuesta comparar la pregunta contra todos los vectores?",
         "formula": "tiempo ≈ chunks × dimensión ÷ lo que tu máquina multiplica por segundo (se mide con una matriz grande y se escala)",
         "ref": {"cuenta": "7.5 M chunks × 384, a la velocidad de tu Mac", "valor": f"≈ {MS_C11} ms por pregunta, solo de multiplicar, con los 11.5 GB en RAM"},
         "taller": {"cuenta": "500 mil vectores al azar en tu Mac; el dojo tiene 151", "valor": f"≈ {MS_MAC} ms; con 151, nada"},
         "decide": "Con 151 chunks, comparar contra todos es lo más simple y es exacto. Con millones, cada pregunta leería 11.5 GB de memoria: los motores usan un índice aproximado (HNSW) que revisa una fracción, y a cambio se mide cuánto recall se pierde.",
         "conceptos": ["busqueda-exacta"],
         "comprueba": cmd(P("pc fuerza"), L("pc fuerza"))},
        {"id": "doble", "pregunta": "¿Cuánto espacio pide construir el índice nuevo al lado del vigente?",
         "formula": "espacio durante el cambio ≈ 2 × índice (el que sirve y el nuevo) + el cache de embeddings",
         "ref": {"cuenta": "2 × ≈ 11.5 GB de vectores, más BM25 y el grafo del índice aproximado", "valor": "> 23 GB libres solo para el cambio"},
         "taller": {"cuenta": "el índice del piloto y el tuyo en <code>indices/</code>", "valor": "356 KB cada uno"},
         "decide": "Sin espacio para dos, no hay forma de cambiar sin cortar ni de volver atrás. El índice anterior se borra cuando ya no hace falta volver a él, no antes.",
         "conceptos": ["al-lado", "rollback"],
         "confirma": "Paso 5: <code>du -sh indices/*</code> después de construir."},
    ],
}

C = []
def con(id_, termino, en, def_, analogia, importa, trampa):
    C.append({"id": id_, "termino": termino, "en": en, "def": def_, "analogia": analogia, "importa": importa, "trampa": trampa})

con("embedding", "Embedding", "embedding, dense vector",
    "Una lista de números (aquí, 384) que un modelo saca de un texto. Textos que dicen lo mismo, aunque con otras palabras, quedan cerca; textos de temas distintos, lejos.",
    "Como las coordenadas de un lugar en un mapa de significados: «reembolso a tarjeta» y «me regresan el dinero» quedan en la misma colonia.",
    "Es lo que deja buscar por significado: la pregunta se convierte en un vector y se buscan los chunks con los vectores más cercanos.",
    "Leer el número como una probabilidad. Con e5, una frase de reembolsos y otra del calendario de pagos dan 0.836 de coseno: lo que importa es el orden, no el valor (la tarjeta del modelo explica que e5 se entrenó de forma que sus cosenos caen casi siempre entre 0.7 y 1).")
con("modelo-embeddings", "Modelo de embeddings", "embedding model, encoder",
    "Una red (un transformer) que lee los tokens de un texto y da un vector por token. El del dojo, multilingual-e5-small: 12 capas, vectores de 384, hasta 512 tokens, ≈ 100 idiomas. Corre en tu Mac con onnxruntime.",
    "Como un traductor a un idioma de números: el mismo traductor tiene que traducir las preguntas y los documentos, o no se entienden.",
    "Nada se entrena en un RAG: el modelo viene hecho. Lo que decides es cuál, de qué versión, y que todo el índice y todas las preguntas usen el mismo.",
    "Usar el modelo del tutorial. all-MiniLM-L6-v2 se entrenó con pares de textos en inglés: en el golden set del dojo, sus vectores sacan 85.1 % contra 98.6 % de e5.")
con("mean-pooling", "Promedio de tokens", "mean pooling, attention mask",
    "Juntar los vectores de cada token en uno solo, promediándolos. Solo cuentan los tokens de verdad: el relleno (los ceros que se agregan para que un lote tenga el mismo largo) se excluye con la máscara de atención.",
    "Como sacar el promedio de las tareas entregadas: si cuentas como cero las que nadie tenía que entregar, el promedio baja sin razón.",
    "Es como e5 y MiniLM esperan que se arme el vector de un texto (lo dicen sus tarjetas en Hugging Face). Otro método da otros vectores.",
    "Promediar también el relleno: el vector de un texto cambia según con quién le tocó en el lote.")
con("prefijos", "Prefijos de consulta y pasaje", "query/passage prefixes",
    "e5 se entrenó con «query: » antes de cada pregunta y «passage: » antes de cada documento, y su tarjeta pide usarlos. MiniLM no lleva ninguno.",
    "Como avisarle al traductor si lo que sigue es una pregunta o una respuesta: la misma frase se traduce un poco distinto.",
    "La misma frase como consulta y como pasaje da vectores distintos (coseno 0.939). Los prefijos son parte de usar bien el modelo, igual que su tokenizer.",
    "Pensar que no importan porque en este corpus no se notan (en el dojo, el recall sale igual sin ellos): en otro corpus sí, y se descubre tarde.")
con("normalizar", "Normalizar y coseno", "L2 normalization, cosine similarity",
    "La similitud coseno compara la dirección de dos vectores, no su largo. Si cada vector se divide entre su largo (queda de largo 1), el coseno es simplemente el producto punto: multiplicar número por número y sumar.",
    "Como comparar hacia dónde apuntan dos flechas sin importar qué tan largas son: si las cortas todas al mismo largo, basta con ver cuánto se encima una sobre la otra.",
    "Muchos motores de vectores calculan el coseno con el producto punto, porque es más rápido, o piden vectores de largo 1. Eso solo funciona si cada vector se normalizó al guardarlo.",
    "Guardar vectores sin normalizar con la similitud en «coseno»: los de e5 salen de largo ≈ 4.5 a 5.0, un vector más largo gana puntos sin parecerse más, y el recall baja de 98.6 % a 91.9 %.")
con("dimension", "Dimensión", "embedding dimension",
    "Cuántos números trae cada vector. La dicta el modelo (e5-small y MiniLM: 384; e5-base: 768) y se declara al crear el índice, como el tamaño de una columna.",
    "Como el número de casillas de un formulario: un formulario de 768 casillas no acepta uno de 384.",
    "Decide cuánto pesa el índice (chunks × dimensión × 4 bytes) y es lo primero que revisa la construcción antes de escribir nada.",
    "Creer que la misma dimensión hace compatibles a dos modelos: e5-small y MiniLM tienen 384 y sus vectores no se pueden comparar.")
con("firma-modelo", "Firma del modelo", "model revision pinning, checksum",
    "Qué modelo hizo un vector: su repositorio, la revisión (el commit exacto de Hugging Face) y el sha256 de su archivo. Va en el manifiesto del índice y en cada fila de vectores.",
    "Como el número de lote de una medicina: si algo sale mal, sabes exactamente cuál fue, y nadie confunde dos lotes con el mismo nombre.",
    "Con la firma, la API sabe con qué embeber la pregunta, la construcción sabe si mezcló modelos y el cache sabe qué sirve. Sin ella, nadie se entera de que algo cambió.",
    "Bajar el modelo de «main» sin comprobar nada: «main» puede cambiar mañana y tus vectores nuevos ya no serían comparables con los de ayer.")
con("espacios", "Espacios que no se mezclan", "incompatible embedding spaces",
    "Cada modelo acomoda los textos a su manera: sus números no significan lo mismo que los de otro modelo, aunque tengan la misma dimensión. Un vector de e5 y uno de MiniLM del mismo chunk dan coseno ≈ 0.06.",
    "Como dos mapas de la misma ciudad dibujados con otra escala y otro norte: las coordenadas de uno no sirven para buscar en el otro.",
    "Cambiar de modelo es re-embeber todo en un índice nuevo, y la pregunta se embebe con el modelo del índice: con otro, el recall de los vectores baja de 98.6 % a 21.6 %.",
    "«Ahorrar» copiando vectores viejos al índice nuevo: nada truena (las dimensiones cuadran) y los chunks copiados dejan de aparecer.")
con("cache-embeddings", "Cache de embeddings", "embedding cache, content-addressed",
    "Guardar cada embedding ya calculado con una llave que dice exactamente de qué salió: el modelo, su revisión y la huella (sha) del texto. Si la llave ya está, no se vuelve a calcular.",
    "Como un archivo de fotocopias marcadas con el original y la copiadora: si te piden la misma copia en la misma máquina, la sacas del cajón.",
    "Cada noche cambia una parte chica del corpus: con el cache solo se embebe eso. En el dojo, la segunda vez tarda " + S2 + " s en vez de " + S1 + " s.",
    "Una llave sin el modelo: al cambiar de modelo, el cache te regresa vectores del modelo viejo y los mezclas sin darte cuenta.")
con("bm25", "BM25", "Okapi BM25, lexical search",
    "Un puntaje por palabras: por cada palabra de la pregunta que está en el chunk, suma más si la palabra es rara en el corpus y si aparece varias veces, y castiga un poco a los chunks largos.",
    "Como el índice alfabético al final de un libro: te lleva directo a las páginas donde está «Sonora», pero no a las que dicen «el norte del país».",
    "Encuentra lo que los vectores pierden: códigos, nombres y cifras exactas. No necesita modelo ni GPU, y se explica solo: sabes por qué salió cada chunk.",
    "Esperar que entienda sinónimos: «¿en cuánto tiempo me regresan el dinero?» no tiene «regresan» ni «dinero» en el corpus, así que esas palabras valen 0.")
con("idf", "IDF, saturación y largo", "inverse document frequency, k1, b",
    "IDF = ln(1 + (N − df + 0.5) / (df + 0.5)): N = cuántos chunks hay, df = en cuántos está la palabra, ln = logaritmo natural. k1 (1.2): qué tan rápido deja de premiar repetir. b (0.75): cuánto castiga a un chunk largo.",
    "Como un tablero de búsqueda de personas: «tiene ojos» no sirve de nada (todos), «lunar en la oreja» casi la encuentra sola. Y decir «lunar» diez veces no la hace diez veces más probable.",
    "Explica por qué un chunk gana: en el dojo, «pagué» está en un solo chunk (IDF 4.62) y «tarjeta» en nueve (2.77).",
    "Olvidar que el analizador decide qué es una palabra: palabras() tira lo de menos de tres letras, así que «SEG-5» queda en «seg», que está en 10 chunks.")
con("hibrido", "Búsqueda híbrida", "hybrid search, lexical + dense",
    "Buscar con BM25 y con vectores sobre los mismos chunks y juntar las dos listas. Cada uno gana en preguntas distintas.",
    "Como preguntar en una biblioteca al bibliotecario que se sabe los títulos de memoria y a la que entiende de qué trata cada libro: juntos fallan menos.",
    "En el dojo, BM25 encuentra más en G-043 (25 kg y la guía del marketplace) y los vectores en G-024, G-045, G-047 y G-048. La estación 6 los fusiona con RRF: cada chunk suma 1/(k + su lugar) en cada lista, sin comparar puntajes de BM25 con cosenos.",
    "Que a uno de los dos le falten chunks: el otro los sigue encontrando, el promedio disimula, y la mitad del híbrido ya no ve esos documentos.")
con("prefiltro", "Filtro antes del top-k", "pre-filtering, filtered search",
    "Primero se quitan los chunks que la persona no puede leer (con la ACL de la estación 3) y después se eligen los 8 mejores. La ACL vive dentro del índice, junto a cada chunk.",
    "Como un buscador de una biblioteca con secciones privadas: busca solo en los estantes que tu credencial abre, en vez de buscar en todos y luego tachar lo que no puedes ver.",
    "Así nadie recibe un chunk ajeno y siempre llegan 8 si la persona ve 8 o más. Si se filtra después, alguien que ve poco recibe 1 o 0.",
    "Filtrar después del top-8 «porque es más fácil»: la estación 3 midió que alguien que ve el 2 % del corpus recibiría 0.16 chunks en promedio.")
con("busqueda-exacta", "Búsqueda exacta y aproximada", "brute-force kNN vs ANN (HNSW)",
    "Exacta: comparar la pregunta contra todos los vectores y quedarte con los más cercanos. Aproximada: un índice (como HNSW, un grafo de vecinos) que revisa solo una parte y casi siempre encuentra los mismos.",
    "Como buscar a alguien en un estadio: puedes ver cada asiento (exacto, lento) o preguntar por sección y fila (aproximado, rápido, casi siempre aciertas).",
    "Con 151 chunks, la exacta es lo más simple. Con 7.5 M, cada pregunta leería ≈ 11.5 GB: por eso los motores usan aproximada, y se mide cuánto recall se pierde.",
    "Dar por hecho que la aproximada encuentra lo mismo: se configura (cuántos vecinos revisa) y se mide contra la exacta con el golden set.")
con("manifiesto-indice", "Manifiesto del índice", "index manifest",
    "Un archivo dentro de cada índice que dice qué es: de qué corpus, con qué modelo (su firma), qué dimensión y similitud, cuántos chunks, el sha256 de cada archivo y si está «construyendo» o «listo».",
    "Como la placa de un elevador: capacidad, fecha de revisión y quién lo certificó. Antes de subirte, la lees.",
    "Antes de mover el alias se revisa el índice contra su manifiesto: completo, un solo modelo, vectores de largo 1, cada archivo intacto.",
    "Recalcular el manifiesto «para que cuadre» después de editar un índice a mano: el sha256 cuadra, pero el índice sigue mal, y solo una revisión de fondo lo ve.")
con("al-lado", "Construir al lado", "blue-green reindex",
    "Un índice nuevo se construye completo en su propia carpeta mientras el vigente sigue contestando, y solo cuando está listo y revisado se cambia a él.",
    "Como montar la escenografía de la siguiente obra detrás del telón: el público sigue viendo la obra de hoy hasta que todo está en su lugar.",
    "Cambiar de modelo, de chunking o de corpus nunca deja al asistente sin buscador, y el viejo sigue ahí para volver.",
    "Construir encima del vigente «porque es más rápido»: a la mitad, la API sirve un índice a medias.")
con("alias", "Alias", "index alias, atomic swap",
    "Un nombre fijo (c11) que apunta al índice vigente. La API siempre nombra el alias, nunca el índice. Cambiar de índice es cambiar a dónde apunta, de un jalón: quien lo lea ve el viejo o el nuevo, nunca uno a medias.",
    "Como el letrero «Caja 3 abierta»: la gente se forma donde dice el letrero; cambiarlo de caja es instantáneo y nadie se queda formado en una caja cerrada.",
    "En el dojo, " + N_TRAF + " peticiones en 15 s con un cambio de alias en medio: 0 errores. En OpenSearch y Elasticsearch es una sola llamada a <code>_aliases</code> con «remove» y «add», sin que nadie vea el alias a medias; aquí, un <code>os.replace</code> desde un temporal en la misma carpeta.",
    "Mover el alias en cuanto empieza la construcción: la API abre un índice sin vectores y contesta 503.")
con("rollback", "Volver atrás", "rollback",
    "Regresar el alias al índice anterior, que se guardó sano. Primero se mitiga (volver, en segundos) y después se arregla con calma (construir uno nuevo).",
    "Como el botón de deshacer: solo sirve si lo anterior sigue guardado.",
    "Un índice malo se descubre a veces horas después. Con el anterior a la mano, la API vuelve a contestar bien mientras se construye uno sano.",
    "Borrar el índice anterior en cuanto el nuevo «ya funcionó», o volver a uno que también está mal: el alias revisa a dónde vuelve.")
e["conceptos"] = C

e["mundo"] = {
    "resumen": "El kit trae el marketplace ficticio del caso el <b>22 de noviembre a las 11:00</b>, después de la re-ingesta de la noche: el corpus con <b>151 chunks de 104 documentos</b> (cada uno con su ruta de títulos y su ACL), el directorio de <b>14 personas</b> y el golden set vigente de la estación 4, <b>golden-v2</b> (65 preguntas, 51 de test). Dos modelos de embeddings se bajan de un commit fijo de Hugging Face, con su sha256: <b>multilingual-e5-small</b>, el del dojo, y <b>all-MiniLM-L6-v2</b>, con el que el piloto armó su índice. Ese índice del piloto está detrás del alias <b>c11</b> y la API de búsqueda (<code>mundo/servicio.py</code>) contesta con él. Tú escribes los embeddings, el cache, BM25, el índice de vectores con la ACL, la construcción al lado, la búsqueda de prueba y el alias, y cambias la API a tu índice sin cortarla.",
    "trae": [
        {"que": "mundo/entrada/", "detalle": "El corpus del 22 (la salida de la estación 4 después de reanclar: <code>corpus-2026-11-22.json</code>), el directorio y el registro del golden set (<code>registro-golden/</code>: golden-v2 con su manifiesto)."},
        {"que": "Los modelos", "detalle": "<code>mundo/modelos.json</code> es el catálogo (repositorio, revisión, archivos con su tamaño y sha256, dimensión, tope de tokens, prefijos y licencia) y <code>mundo/modelos.py</code> los baja a <code>modelo/</code>: ≈ 578 MB, una vez."},
        {"que": "El índice del piloto", "detalle": "<code>mundo/crear.py</code> hace lo que hizo anoche el job del piloto: <code>indices/c11-minilm-2026-11-22/</code> con BM25 y vectores de MiniLM, en el mismo formato que el tuyo, y el alias c11 apuntando a él."},
        {"que": "La API, el tráfico y la noche", "detalle": "<code>mundo/servicio.py</code> (la API de búsqueda en el puerto 8150: lee el alias en cada petición y usa tu <code>buscar.py</code>), <code>mundo/trafico.py</code> (las preguntas del golden set contra la API, varias a la vez), <code>mundo/noche.py</code> (el job de cada noche: construir, probar y mover el alias) y <code>mundo/evaluar.py</code> (el monitor de calidad: mide el índice tal como está, sin revisar)."},
        {"que": "verificar.py y romper.py", "detalle": "Los 11 checks de la estación (de <code>mundo</code> a <code>alias</code>) y las 6 fallas: modelos mezclados en el mismo índice, vectores sin normalizar, chunks que faltan en uno de los dos índices, dimensión equivocada, la consulta embebida con otro modelo y el alias apuntando a un índice a medio construir."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/embeber.py", "hace": "Pasos 1 y 2: el Modelo (sha256, tokens, mean pooling, prefijos, largo 1, firma) y el cache por modelo y texto."},
        {"archivo": "pipeline/bm25.py", "hace": "Paso 3: df, tf, el largo de cada chunk, el IDF y el puntaje de BM25."},
        {"archivo": "pipeline/vectores.py", "hace": "Paso 4: la matriz con qué modelo hizo cada fila, y el top-k con el filtro antes de elegir."},
        {"archivo": "pipeline/construir.py", "hace": "Paso 5: un índice nuevo al lado, con su manifiesto, y revisar() para todo lo que tiene que cumplir."},
        {"archivo": "pipeline/buscar.py y pipeline/prueba.py", "hace": "Paso 6: abrir un índice y buscar en BM25 y en vectores con los permisos de quien pregunta, y medir cada uno con el golden set."},
        {"archivo": "pipeline/alias.py", "hace": "Paso 7: apuntar, volver y el historial, y el modelo de la consulta que sale del índice."},
        {"archivo": "config.yaml", "hace": "El modelo de embeddings, la dimensión y la similitud del índice, k1 y b, y lo de la API (alias, modelo de la consulta, puerto)."},
    ],
    "requisitos": [
        "Python 3.12 o más nuevo (numpy 2.5.5 lo pide; se probó con 3.14.3), ≈ 100 MB para el entorno virtual y ≈ 600 MB para los modelos",
        "Internet para el <code>pip install</code> (onnxruntime 1.32.0, numpy 2.5.5, tokenizers 0.23.3 y pyyaml 6.0.4) y para bajar los modelos una vez; después, nada",
        "Las estaciones 1 a 4 ayudan, pero no hacen falta: el kit trae su salida",
    ],
    "sustituciones": [
        {"nube": "Un motor de búsqueda con BM25 y vectores (OpenSearch, Elasticsearch o una base vectorial) detrás de un alias", "local": "una carpeta por índice en <code>indices/</code> y <code>indices/alias.json</code>", "diferencia": "La misma idea: índices que se construyen una vez y un nombre fijo que apunta al vigente. En el motor, cambiar el alias es una sola llamada atómica; aquí, <code>os.replace</code>."},
        {"nube": "Un índice aproximado (HNSW) sobre millones de vectores", "local": "búsqueda exacta con numpy sobre 151", "diferencia": "Con 151 chunks no hace falta aproximar. En C11 sí, y se mide con el golden set cuánto recall se pierde."},
        {"nube": "El job de embeddings con GPU que corre después de la ingestión", "local": "<code>mundo/noche.py</code> con tu <code>construir.py</code>, en el CPU de tu Mac", "diferencia": "Los mismos pasos; en C11 son millones de chunks y la GPU importa."},
        {"nube": "La API de búsqueda, un servicio desplegado aparte", "local": "<code>mundo/servicio.py</code> en el puerto 8150", "diferencia": "Un servidor HTTP chiquito, una búsqueda a la vez. Lo importante es igual: nombra el alias y no un índice."},
    ],
    "arranque": "unzip rag-indice.zip && cd rag-indice\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython mundo/modelos.py\npython mundo/crear.py",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El almacén del 22 a las 11:00, los dos modelos con su sha256 y el índice del piloto detrás del alias c11.",
    conceptos=["firma-modelo"],
    explica="Hacen falta onnxruntime, numpy, tokenizers y pyyaml. <code>mundo/modelos.py</code> baja los dos modelos de un commit fijo de Hugging Face y comprueba el sha256 de cada archivo contra <code>mundo/modelos.json</code>. <code>mundo/crear.py</code> copia el corpus, el directorio y el golden set a <code>almacen/</code>, y hace lo que hizo anoche el job del piloto: un índice con MiniLM detrás del alias c11.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("python mundo/modelos.py", L("p0 modelos"), "Una sola vez, con internet. Si un sha256 no coincide, el archivo no se guarda."),
        cmd("python mundo/modelos.py --listar", L("p0 listar")),
        cmd("python mundo/crear.py", L("p0 crear")),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd(f"{V} embeddings", L("p0 esqueleto"), "Es lo esperado: <code>pipeline/</code> todavía es el esqueleto. Cada check se pone en verde en su paso."),
    ],
    verifica="<code>verificar.py mundo</code> en verde.",
    ojo="<code>modelo/</code>, <code>cache/</code> e <code>indices/</code> no van en el .zip ni en git: el primero se baja y los otros dos los produce tu pipeline. <code>mundo/crear.py</code> borra <code>indices/</code> y <code>cache/</code> (es un mundo nuevo), pero no los modelos."))

G.append(dict(n=1, id="embeddings", titulo="Texto a vector", objetivo="<code>Modelo</code> en <code>embeber.py</code>: cargar e5-small comprobando su sha256, partir el texto en tokens, pasarlo por el modelo, promediar los tokens, normalizar y decir qué modelo lo hizo.",
    conceptos=["embedding", "modelo-embeddings", "mean-pooling", "prefijos", "normalizar", "firma-modelo"],
    explica="Un <b>embedding</b> es una lista de 384 números. Para sacarla: el tokenizer parte el texto en piezas (tokens) y las convierte en números; con <code>enable_truncation</code> se corta en el tope del modelo (512 en e5, 256 en MiniLM) y con <code>enable_padding</code> se rellena cada lote al largo del más largo. <code>onnxruntime</code> corre el modelo y da un vector por token. El <b>promedio de tokens</b> (mean pooling) junta los vectores de los tokens de verdad, sin el relleno, usando la máscara de atención. Al final se <b>normaliza</b> a largo 1. Antes de todo eso va el <b>prefijo</b> del tipo de texto: «query: » para preguntas y «passage: » para chunks en e5, nada en MiniLM. <code>firma()</code> dice exactamente qué modelo lo hizo.",
    codigo=[py("pipeline/embeber.py", "En este paso escribes la clase <code>Modelo</code>. <code>embeber_chunks()</code> es el paso 2.")],
    comandos=[
        cmd(P("p1 frases"), L("p1 frases"), "La pregunta queda más cerca del chunk que la contesta (0.912) que del que habla de otra cosa (0.836). Pero 0.836 no es «poco parecido»: con e5, casi todo da de 0.8 para arriba. Importa el orden."),
        cmd(P("p1 minilm"), L("p1 minilm"), "Con el modelo del piloto, la escala es otra (0.676 y 0.370). Los números de un modelo no se comparan con los del otro."),
        cmd(P("p1 tokens"), L("p1 tokens"), "Los chunks de la estación 2 se cortaron con el tokenizer de e5: ninguno pasa de 512. Con MiniLM, 8 chunks pasan de 256 y el modelo no lee su final."),
        cmd(f"{V} embeddings", L("p1 verificar")),
    ],
    verifica="<code>verificar.py embeddings</code> en verde: la firma de los dos modelos, vectores float32 de 384 y largo 1, iguales a los del modelo con sus prefijos, y un sha256 distinto no se carga.",
    ojo="El tokenizer.json de MiniLM trae guardado un corte en 128 tokens y relleno fijo. <code>enable_truncation(max_tokens)</code> y <code>enable_padding()</code> lo reemplazan por lo que dice el catálogo; si no los llamas, el modelo lee la mitad de cada chunk.",
    en_pagina={"conceptos": ["embedding", "modelo-embeddings", "mean-pooling", "prefijos", "normalizar", "firma-modelo"], "precalculos": ["modelo"]}))

G.append(dict(n=2, id="cache", titulo="No volver a embeber", objetivo="<code>embeber_chunks()</code>: los vectores de pasaje de cada chunk, sacando del cache lo que ya está y guardando lo nuevo, con una llave que dice de qué modelo y de qué texto salió.",
    conceptos=["cache-embeddings"],
    explica="La llave del cache tiene tres partes: el modelo, su revisión (en el nombre de la carpeta: <code>cache/embeddings/e5@614241f622f5/</code>) y la huella del texto (<code>sha_texto</code>, la misma de la estación 4, como nombre del archivo). Si cambia una letra del chunk, cambia la huella y se embebe otra vez; si cambia el modelo, cambia la carpeta y no se reusa nada. Solo se embebe lo que falta, de un jalón, y se guarda con <code>np.save</code>.",
    codigo=[],
    comandos=[
        cmd(P("p2 cache"), L("p2 cache"), "La primera vez embebe los 151; la segunda, nada. Con los tokens por segundo de tu Mac, la cuenta de C11: re-embeber todo son días; lo de un día, un par de horas o menos."),
        cmd(P("p2 carpeta"), L("p2 carpeta"), "Una carpeta por modelo y revisión; un archivo por texto."),
        cmd(f"{V} cache", L("p2 verificar")),
    ],
    verifica="<code>verificar.py cache</code> en verde: sin cambios no se embebe nada, cambia un texto y solo se embebe ese, otro modelo empieza de cero.",
    ojo="El cache guarda vectores, no decisiones: si un día cambias el prefijo o el método de promedio, los vectores viejos ya no son los de tu código. En ese caso la llave tiene que cambiar (otra carpeta) o se borra el cache.",
    en_pagina={"conceptos": ["cache-embeddings"], "precalculos": ["reembeber"]}))

G.append(dict(n=3, id="bm25", titulo="Buscar por palabras", objetivo="<code>bm25.py</code>: el índice BM25 de los chunks (en cuántos chunks está cada palabra, cuántas veces en cada uno, cuánto mide cada uno) y su puntaje.",
    conceptos=["bm25", "idf"],
    explica="Las palabras salen de <code>palabras()</code> de <code>_comun.py</code> (minúsculas, sin acentos, de 3 letras o más, sin las vacías), sobre el texto completo con su ruta de títulos. <code>construir()</code> guarda <b>df</b> (en cuántos chunks está cada palabra), <b>tf</b> (cuántas veces en cada chunk), el largo de cada chunk y el promedio. El <b>IDF</b> es ln(1 + (N − df + 0.5) / (df + 0.5)). El puntaje suma, por cada palabra distinta de la pregunta, IDF × tf × (k1 + 1) / (tf + k1 × (1 − b + b × largo / promedio)), con k1 = 1.2 y b = 0.75 de <code>config.yaml</code>. Es el BM25 clásico con el IDF de Lucene; Lucene (el motor de Elasticsearch y OpenSearch) omite el factor (k1 + 1), que multiplica todos los puntajes por lo mismo: el orden sale igual.",
    codigo=[py("pipeline/bm25.py")],
    comandos=[
        cmd(P("p3 nombre"), L("p3 nombre"), "Palabras exactas y raras: BM25 está en su terreno."),
        cmd(P("p3 parafrasis"), L("p3 parafrasis"), "«regresan» y «dinero» no están en ningún chunk: valen 0. BM25 no sabe que «me regresan el dinero» es un reembolso."),
        cmd(P("p3 codigo"), L("p3 codigo"), "«SEG-5» quedó en «seg» (el 5 tiene menos de 3 letras) y «seg» está en 10 chunks: el ticket SEG-5 ni aparece. Quién decide qué es una palabra importa tanto como la fórmula."),
        cmd(f"{V} bm25", L("p3 verificar")),
    ],
    verifica="<code>verificar.py bm25</code> en verde: df, tf y el largo, el IDF y los puntajes de 12 preguntas iguales a la fórmula.",
    ojo="En C11, el motor de búsqueda trae BM25 hecho y lo que se configura es el analizador (cómo se parten y se normalizan las palabras, sinónimos, raíces). Los identificadores como «SEG-5» o «SOP-41» se guardan enteros en un campo aparte, porque son justo lo que la gente copia y pega.",
    en_pagina={"conceptos": ["bm25", "idf"], "precalculos": []}))

G.append(dict(n=4, id="vectores", titulo="Buscar por significado", objetivo="<code>vectores.py</code>: la matriz de vectores de todos los chunks con qué modelo hizo cada fila, y el top-k más parecido a la pregunta entre los chunks que la persona puede leer.",
    conceptos=["prefiltro", "busqueda-exacta", "espacios"],
    explica="<code>construir()</code> usa <code>embeber_chunks()</code> y anota en cada fila el modelo que la hizo (<code>e5@614241f622f5</code>). <code>top()</code> recibe la pregunta ya embebida y un arreglo de permitidos (uno por fila): como cada vector tiene largo 1, la similitud coseno de todos a la vez es <code>matriz @ vector</code>. A los que la persona no puede leer se les pone −∞ <b>antes</b> de ordenar, y se toman los k mejores. Es una <b>búsqueda exacta</b>: compara contra los 151.",
    codigo=[py("pipeline/vectores.py")],
    comandos=[cmd(f"{V} vectores", L("p4 verificar"))],
    verifica="<code>verificar.py vectores</code> en verde: la matriz y la etiqueta de cada fila; con 10 permitidos de 20, top-8 da los 8 mejores de esos 10.",
    ojo="Cada fila lleva su modelo aunque el índice entero sea de uno solo: es lo que deja ver, después, que alguien mezcló vectores de dos modelos.",
    en_pagina={"conceptos": ["prefiltro", "busqueda-exacta", "espacios"], "precalculos": ["fuerza"]}))

G.append(dict(n=5, id="construir", titulo="Un índice nuevo al lado", objetivo="<code>construir.py</code>: el índice de e5 en su propia carpeta, sin tocar el del piloto que está sirviendo, con BM25, vectores, la ACL de cada chunk y un manifiesto; y <code>revisar()</code>, que dice si un índice está sano.",
    conceptos=["al-lado", "manifiesto-indice", "dimension"],
    explica="Primero se comprueba que la <b>dimensión</b> del modelo sea la de <code>config.yaml</code>, antes de escribir nada. Después se crea <code>indices/c11-e5-2026-11-22/</code> y lo primero que se escribe es el <b>manifiesto</b> con «estado»: «construyendo». Siguen <code>chunks.jsonl</code> (cada chunk con su documento, título, ACL y huella), <code>bm25.json</code>, <code>vectores.npy</code> y <code>vectores.json</code>. Al final, el manifiesto completo (corpus, firma del modelo, dimensión, similitud, cuántos chunks y el sha256 de cada archivo) y «listo». <code>revisar()</code> comprueba todo eso: estado, cada archivo con su sha256, los mismos chunks en las dos mitades, un solo modelo, la forma de la matriz y el largo 1 de cada vector.",
    codigo=[py("pipeline/construir.py")],
    comandos=[
        cmd("python pipeline/construir.py", L("p5 construir"), "Menos de un segundo: los 151 embeddings ya estaban en el cache del paso 2."),
        cmd("ls -l indices/c11-e5-2026-11-22/\ndu -sh indices/*", L("p5 archivos"), "vectores.npy pesa 232,064 bytes: 151 × 384 × 4 = 231,936, más 128 de encabezado. Los dos índices viven al mismo tiempo."),
        cmd(P("p5 manifiesto"), L("p5 manifiesto")),
        cmd("python pipeline/construir.py --revisar c11-e5-2026-11-22", L("p5 revisar")),
        cmd("python pipeline/alias.py listar", L("p5 alias"), "El alias sigue en el piloto: construir no lo mueve."),
        cmd(f"{V} construir completo", L("p5 verificar")),
    ],
    verifica="<code>verificar.py construir</code> y <code>completo</code> en verde: «listo», la firma de e5, 384 dimensiones como el modelo y la config, un solo modelo, los 151 chunks en las dos mitades con la ACL del corpus, y tu <code>revisar()</code> ve un índice a medio construir y uno cambiado.",
    ojo="«estado» va primero en «construyendo» y al final en «listo», y el manifiesto se escribe de un jalón (<code>escribir_json</code>). Si la construcción muere a la mitad, el índice se queda en «construyendo» y nadie lo puede usar por error.",
    en_pagina={"conceptos": ["al-lado", "manifiesto-indice", "dimension"], "precalculos": ["tamano"]}))

G.append(dict(n=6, id="prueba", titulo="La búsqueda de prueba", objetivo="<code>buscar.py</code> y <code>prueba.py</code>: abrir un índice, buscar en BM25 y en vectores por separado con los permisos de quien pregunta, y medir cada mitad con el golden set de la estación 4.",
    conceptos=["hibrido", "prefiltro", "espacios"],
    explica="<code>Buscador</code> abre un índice solo si <code>revisar()</code> no le encuentra nada, y solo si la pregunta se va a embeber con el mismo modelo que hizo el índice (si no, <code>ModeloDistinto</code>). <code>visibles()</code> usa <code>principals()</code> y <code>puede_ver()</code> de la estación 3 con la ACL guardada en <code>chunks.jsonl</code>. <code>bm25()</code> y <code>vectores()</code> dan cada uno su top-8 entre lo que la persona ve. <code>prueba.py</code> corre las preguntas de test del golden set: el <b>recall@8</b> de cada mitad (de las fuentes de cada pregunta directa o con varias fuentes, qué fracción llega al top-8; luego el promedio, con su margen al 95 %) y las fugas en las prohibidas.",
    codigo=[py("pipeline/buscar.py"), py("pipeline/prueba.py")],
    comandos=[
        cmd(P("p6 buscar"), L("p6 buscar"), "La misma pregunta del paso 3: BM25 se va con «tarjeta» y «tiempo» a los tickets; los vectores ponen arriba wiki:1004, la página de reembolsos. Elena ve 88 de los 151 chunks."),
        cmd(P("p6 piloto"), L("p6 piloto"), "El índice que está sirviendo: sus vectores (MiniLM) sacan menos que BM25."),
        cmd(P("p6 nuevo"), L("p6 nuevo"), "Los mismos chunks y el mismo BM25; los vectores de e5 pasan de 85.1 % a 98.6 %. Y BM25 sigue ganando en G-043."),
        cmd(P("p6 otra consulta"), L("p6 otra consulta"), "Lo que pasaría si la API embebiera las preguntas con MiniLM contra el índice de e5: los vectores bajan a 21.6 %. Nada truena: los dos dan 384 números. Por eso <code>Buscador</code> se niega."),
        cmd(P("p6 dev"), L("p6 dev")),
        cmd(f"{V} permisos prueba", L("p6 verificar")),
    ],
    verifica="<code>verificar.py permisos</code> y <code>prueba</code> en verde: las 14 personas reciben solo lo que pueden leer y siempre 8 si ven 8 o más, sin fugas en las prohibidas, y <code>prueba.json</code> de los dos índices con el recall de la verdad.",
    ojo="Con 37 preguntas, el margen de los vectores del piloto es ± 9.9 puntos: la diferencia contra e5 (13.5) sí se distingue, pero una de 2 o 3 no se distinguiría. Y en dev todo da 100 %: 9 preguntas no sirven para decidir.",
    en_pagina={"conceptos": ["hibrido"], "precalculos": []}))

G.append(dict(n=7, id="alias", titulo="Cambiar de índice sin cortar", objetivo="<code>alias.py</code>: mover c11 de un jalón al índice de e5 mientras la API contesta, volver atrás y otra vez adelante; y que la API embeba cada pregunta con el modelo que dice el manifiesto del índice.",
    conceptos=["alias", "rollback", "firma-modelo"],
    explica="<code>apuntar()</code> revisa el índice antes de moverse (a uno «construyendo» no va), guarda el que estaba como «anterior» y anota el cambio en el historial, todo en <code>indices/alias.json</code> escrito de un jalón: <code>escribir_json</code> escribe un temporal en la misma carpeta y lo pone en su lugar con <code>os.replace</code>, que en macOS y Linux es atómico; quien lo lea a la mitad ve el viejo o el nuevo. <code>volver()</code> regresa al anterior. La API (<code>mundo/servicio.py</code>) lee el alias en cada petición; cuando cambia, abre el índice nuevo mientras sigue contestando con el viejo. <code>modelo_de_consulta()</code> saca de <code>config.yaml</code> con qué modelo embeber la pregunta: «del-indice» quiere decir el del manifiesto.",
    codigo=[py("pipeline/alias.py")],
    comandos=[
        cmd("python mundo/servicio.py     # en otra terminal: se queda corriendo\ncurl -s http://localhost:8150/salud", L("p7 salud")),
        cmd("curl -s 'http://localhost:8150/buscar?persona=elena.cruz@marketplace.test&indice=vectores&k=3&q=plazo+para+devolver+electr%C3%B3nica'", L("p7 una"), "Cada respuesta dice qué índice contestó."),
        cmd("python mundo/trafico.py --segundos 15     # en una tercera terminal\npython pipeline/alias.py cambiar c11 c11-e5-2026-11-22   # mientras corre el tráfico",
            L("p7 cambiar") + "\n\n— en la terminal del tráfico, al terminar:\n" + L("p7 trafico") + "\n\n— en la terminal de la API:\n" + L("p7 servicio"),
            "Ninguna petición falló: unas las contestó el piloto y las demás el índice nuevo. La API abrió el nuevo mientras seguía contestando con el viejo."),
        cmd("python mundo/trafico.py --segundos 8     # en la tercera terminal\npython pipeline/alias.py volver c11", L("p7 volver") + "\n\n— en la terminal del tráfico:\n" + L("p7 trafico volver"), "Volver tampoco corta."),
        cmd("python pipeline/alias.py cambiar c11 c11-e5-2026-11-22\ncurl -s http://localhost:8150/salud", L("p7 otra vez") + "\n" + L("p7 salud nueva")),
        cmd(P("p7 a medias"), L("p7 a medias"), "A un índice «construyendo» el alias no se mueve."),
        cmd(f"{V} consulta alias", L("p7 verificar")),
        cmd("python mundo/noche.py", L("p7 noche"), "El job de cada noche hace lo mismo que hiciste a mano: construir al lado, probar con el golden set y mover el alias. Este índice ya no necesitó embeber nada."),
    ],
    verifica="<code>verificar.py consulta</code> y <code>alias</code> en verde: la API embebe con el modelo del índice y Buscador se niega con otro; c11 en un índice sano, el anterior sano para volver, el historial, y a uno a medio construir no se mueve.",
    ojo="Al terminar, para la API (Ctrl+C en su terminal). Y el índice anterior no se borra en cuanto el nuevo «ya funcionó»: es a dónde vuelves si mañana algo sale mal.",
    en_pagina={"conceptos": ["alias", "rollback"], "precalculos": ["doble"]}))
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py</code>: deja el esqueleto, borra <code>indices/</code> y <code>cache/</code> y vuelve al 22 a las 11:00 (los modelos se quedan).",
        "Sin GUION.md ni <code>mundo/referencia.py</code>: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El almacén del 22, los dos modelos con su sha256 y el índice del piloto detrás de c11.", "check": "mundo"},
        {"n": 2, "objetivo": "Un Modelo que solo carga archivos con el sha256 del catálogo y da vectores de largo 1 iguales a los del modelo, con su prefijo, y su firma.", "check": "embeddings", "pista": "¿Qué tokens cuentan en el promedio, y qué hace el tokenizer con un texto más corto que los demás del lote?"},
        {"n": 3, "objetivo": "Un cache que no vuelve a embeber lo que ya está, y nunca da vectores de un modelo a otro.", "check": "cache"},
        {"n": 4, "objetivo": "BM25 con df, tf, el largo de cada chunk, el IDF y el puntaje de la fórmula.", "check": "bm25", "pista": "¿Cada palabra de la pregunta cuenta tantas veces como aparece, o una?"},
        {"n": 5, "objetivo": "La matriz con qué modelo hizo cada fila, y un top-k que filtra antes de elegir.", "check": "vectores"},
        {"n": 6, "objetivo": "Un índice nuevo al lado, «listo» al final, con la firma del modelo, la dimensión de la config y del modelo, y un revisar() que ve uno a medio construir.", "check": "construir"},
        {"n": 7, "objetivo": "Los mismos chunks del corpus en las dos mitades, con su ACL.", "check": "completo"},
        {"n": 8, "objetivo": "Cada persona recibe solo lo que puede leer, y siempre 8 si ve 8 o más.", "check": "permisos", "pista": "¿Qué pasa con alguien que ve 4 chunks si filtras después de elegir el top-8?"},
        {"n": 9, "objetivo": "El recall@8 de BM25 y de vectores, por separado, del piloto y del tuyo, guardado en prueba.json.", "check": "prueba"},
        {"n": 10, "objetivo": "La API embebe cada pregunta con el modelo del índice, y con otro se niega.", "check": "consulta"},
        {"n": 11, "objetivo": "c11 en tu índice, el anterior sano para volver, cada cambio anotado, y a uno a medio construir no se mueve.", "check": "alias", "pista": "¿Qué ve quien lee indices/alias.json justo mientras lo escribes?"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


VOLVER = "Primero se mitiga: <code>python pipeline/alias.py volver c11</code> regresa la API al índice anterior (el del piloto: peor recall, pero sano) en segundos. Después se arregla hacia adelante: <code>python mundo/noche.py</code> construye un índice nuevo al lado, desde el cache (los embeddings buenos siguen ahí), lo prueba y mueve el alias."
e["fallas"] = [
    falla("modelos-mezclados", "El monitor dice que los vectores bajaron 40 puntos y la API no levanta", "infra",
          "Para no esperar a que se re-embebiera todo, alguien copió al índice vigente los vectores de 40 chunks de la wiki «que no cambiaron» desde el índice del piloto, y recalculó el manifiesto para que cuadrara.",
          "<code>verificar.py construir</code> falla: el índice vigente tiene vectores de dos modelos (111 de e5 y 40 de MiniLM). La API contesta 503 porque tu <code>revisar()</code> no lo deja abrir.",
          ["Cambió el corpus.", "El índice tiene vectores de otro modelo.", "La pregunta se embebe con otro modelo."],
          cmd("python mundo/evaluar.py", F("mez monitor"), "BM25 igual; los vectores, de 98.6 % a 58.1 %: casi todas las fuentes del golden son de la wiki."),
          VOLVER + " Un índice tiene un solo modelo: cambiar de modelo es re-embeber todo, en otro índice. Las dimensiones cuadraban (384 y 384): por eso cada fila lleva su modelo y la revisión re-embebe una muestra.",
          "espacios", "construir"),
    falla("sin-normalizar", "Después de migrar a la base vectorial nueva, la API no levanta", "infra",
          "El equipo de plataforma migró el índice vigente a «la base vectorial nueva» con su script de exportación y lo volvió a poner en su lugar, con el manifiesto recalculado.",
          "<code>verificar.py vectores</code> falla: los 151 vectores del índice vigente tienen largo de 4.54 a 4.97, y la similitud es coseno.",
          ["El script cambió el modelo.", "El script no normalizó los vectores.", "Faltan chunks."],
          cmd(P("nor normas", PROBARF), F("nor normas") + "\n\n$ python mundo/evaluar.py\n" + F("nor monitor"), "El producto punto ya no es el coseno: un vector más largo gana puntos sin parecerse más."),
          VOLVER + " Si la similitud es coseno y se calcula con el producto punto, cada vector se normaliza al escribirlo, la pregunta también, y se revisa antes de servir.",
          "normalizar", "vectores"),
    falla("chunks-faltantes", "Los vectores ya no encuentran la política de devoluciones; BM25 sí", "infra",
          "El job de embeddings de anoche se cortó por tiempo a la mitad de un lote y el paso siguiente publicó el índice igual, con el manifiesto al día.",
          "<code>verificar.py completo</code> falla: a <code>vectores.json</code> del índice vigente le faltan 15 chunks que sí están en BM25 y en <code>chunks.jsonl</code>.",
          ["Esos documentos se borraron del corpus.", "El índice de vectores se quedó a medias.", "La ACL cambió."],
          cmd("python pipeline/construir.py --revisar $(python -c \"import json; print(json.load(open('indices/alias.json'))['c11']['actual'])\")\npython mundo/evaluar.py", F("fal revisar") + "\n" + F("fal monitor"), "BM25 sigue en 93.2 %; los vectores bajan a 83.8 %. El híbrido disimula: la mitad del índice ya no ve esos documentos."),
          VOLVER + " Las dos mitades del índice traen exactamente los mismos chunks, y se revisa antes de mover el alias: un job que «terminó» no es un índice completo.",
          "hibrido", "completo"),
    falla("dimension-equivocada", "El índice de anoche no se construyó", "config",
          "Para ir preparando el cambio a un modelo más grande, alguien copió a config.yaml la dimensión del ejemplo de multilingual-e5-base. El job de la noche corrió después.",
          "<code>verificar.py construir</code> falla: <code>config.yaml</code> dice <code>indice.dimension: 768</code> y e5-small da 384. La API sigue bien, con el índice de ayer.",
          ["El modelo cambió.", "La config del índice no es la del modelo.", "Se llenó el disco."],
          cmd("python mundo/noche.py\ngrep -n dimension config.yaml", F("dim noche") + "\n" + F("dim config"), "construir.py se detuvo antes de escribir nada, y el alias no se movió."),
          "<code>indice.dimension</code> vuelve a 384 y <code>python mundo/noche.py</code> construye el índice de esta noche. La dimensión la dicta el modelo: si se cambia de modelo, se cambian los dos juntos y se re-embebe todo en un índice nuevo. Fallar antes de escribir nada es lo que mantuvo a la API sana.",
          "dimension", "construir"),
    falla("consulta-otro-modelo", "La API de búsqueda contesta 503 a todo", "config",
          "Después de una prueba con el índice del piloto, alguien dejó fijo en la configuración de la API el modelo con el que se embeben las preguntas.",
          "<code>verificar.py consulta</code> falla: la API embebería las preguntas con MiniLM y el índice detrás de c11 es de e5.",
          ["El índice se dañó.", "La API usa otro modelo para las preguntas.", "El alias cambió."],
          cmd("curl -s http://localhost:8150/salud\npython mundo/evaluar.py", F("con salud") + "\n" + F("con monitor"), "Si la API no se negara, los vectores contestarían con 21.6 % de recall, sin un solo error."),
          "En <code>config.yaml</code>, <code>servicio.modelo_consulta</code> vuelve a <code>del-indice</code>: el modelo de la pregunta sale del manifiesto del índice, no de una configuración aparte que se queda atrás cuando cambia el índice. Un 503 claro es mejor que resultados de otro espacio.",
          "firma-modelo", "consulta"),
    falla("alias-a-medio", "La API dejó de contestar justo cuando empezó el job de la noche", "infra",
          "Para «ganar tiempo», el job nuevo de la noche mueve el alias al índice nuevo en cuanto empieza a construirlo, no al final.",
          "<code>verificar.py alias</code> falla: c11 apunta a un índice «construyendo», que todavía no tiene <code>vectores.npy</code>.",
          ["El índice nuevo está a medio construir.", "La API se cayó.", "Cambió el modelo."],
          cmd("python pipeline/alias.py listar\ncurl -s http://localhost:8150/salud", F("med listar") + "\n" + F("med salud")),
          "<code>python pipeline/alias.py volver c11</code> (el anterior está sano), se borra el índice a medias (<code>rm -rf indices/c11-e5-2026-11-22-2</code>) y <code>python mundo/noche.py</code> lo construye completo, lo prueba y mueve el alias al final. El alias se mueve después de construir y revisar, nunca antes.",
          "alias", "alias"),
]

e["listo"] = [
    "Cada chunk tiene su embedding de un modelo local fijado por revisión y sha256, con su prefijo, promediado sin el relleno y de largo 1, y la firma del modelo va en el índice y en cada fila.",
    "Lo ya embebido sale del cache, con una llave que incluye el modelo y la huella del texto.",
    "BM25 y vectores sobre exactamente los mismos chunks, con la ACL de cada uno, y el filtro de permisos antes de elegir el top-8.",
    "Cada índice se construye al lado del vigente, con un manifiesto, y se revisa antes de usarse.",
    "La búsqueda de prueba con el golden set dice el recall@8 de cada mitad, del índice viejo y del nuevo.",
    "La API nombra un alias que cambia de un jalón sin cortar, con el anterior sano para volver, y embebe cada pregunta con el modelo del índice.",
]

e["repaso"] = {
    "memo": "<b>Dos índices sobre los mismos chunks: BM25 por palabras y vectores por significado, cada chunk con su ACL y cada vector con la firma del modelo que lo hizo; un cache por modelo y texto; cada índice nuevo se construye al lado, se revisa, se mide con el golden set y se pone detrás de un alias que cambia de un jalón y puede volver.</b> En el dojo: BM25 93.2 %, vectores de MiniLM 85.1 % y de e5 98.6 % de recall@8; cada uno gana en preguntas distintas, y la estación 6 los junta.",
    "trampa": "Vectores que «funcionan» porque nada truena. Dos modelos con 384 dimensiones se mezclan sin un error (58.1 %); una pregunta embebida con otro modelo da 21.6 %; vectores sin normalizar dan 91.9 %; a la mitad de vectores le faltan chunks y el híbrido lo disimula. Lo que los atrapa es la firma del modelo, el manifiesto y una revisión antes de mover el alias.",
    "entrevista": [
        {"q": "¿Por qué BM25 y vectores, y no solo vectores?", "a": "Porque fallan en preguntas distintas. Los vectores encuentran lo que se dice con otras palabras («me regresan el dinero» y la página de reembolsos); BM25 encuentra lo exacto: códigos de ticket, nombres, cifras. En mi caso, con el mismo golden set, BM25 sacó 93.2 % de recall@8 y los vectores de e5 98.6 %, y aun así BM25 ganó en una pregunta que los vectores no. Por eso se buscan los dos sobre los mismos chunks y se fusionan las listas, con RRF por ejemplo."},
        {"q": "¿Cómo eliges el modelo de embeddings?", "a": "Con el golden set de mi corpus, no con un ranking general. El piloto usaba all-MiniLM-L6-v2, el del tutorial, que se entrenó en inglés: con documentos en español sacó 85.1 % contra 98.6 % de multilingual-e5-small, con los mismos chunks. Después miro el tope de tokens contra el tamaño de mis chunks, la dimensión (cuánto pesa el índice), la licencia y la velocidad. Y lo fijo por revisión y sha256."},
        {"q": "Quieres cambiar de modelo de embeddings. ¿Cómo lo haces sin tumbar el asistente?", "a": "Re-embebo todo en un índice nuevo, al lado del que sirve: los vectores de dos modelos no se comparan aunque tengan la misma dimensión. Lo reviso (completo, un solo modelo, largo 1), lo mido con el golden set contra el vigente, y muevo el alias de un jalón. La API embebe la pregunta con el modelo que dice el manifiesto del índice, así que índice y consulta cambian juntos. El viejo se queda para volver atrás hasta que ya no haga falta."},
        {"q": "¿Dónde aplicas los permisos en la búsqueda?", "a": "Dentro del índice: cada chunk guarda su ACL y el filtro va antes de elegir el top-k. Si filtro después, alguien que ve una parte chica del corpus recibe 1 o 0 chunks en vez de 8, y si me olvido de filtrar, recibe chunks ajenos. Lo pruebo con cada persona del golden set y con las preguntas prohibidas."},
        {"q": "¿Qué guardas junto a cada vector?", "a": "El chunk_id, su ACL, la huella del texto y qué modelo lo hizo (repositorio, revisión y sha256). El modelo va en el manifiesto del índice y en cada fila: es lo que deja ver que alguien mezcló vectores de dos modelos, lo que dice con qué embeber la pregunta, y la llave del cache para no re-embeber lo que no cambió."},
        {"q": "Con 7.5 M de chunks, ¿comparas la pregunta contra todos?", "a": "No. Son ≈ 11.5 GB de vectores con 384 dimensiones; en mi Mac, solo la multiplicación tomaría ≈ " + MS_C11 + " ms por pregunta. Uso un índice aproximado, como HNSW, que revisa una parte y casi siempre encuentra lo mismo, y mido con el golden set cuánto recall pierdo contra la búsqueda exacta. Con 151 chunks, como en el dojo, la exacta es lo más simple."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/rag-indice/CLAUDE.md",
    "guiado": "content/estaciones/rag-indice/prompts/guiado.md",
    "solo": "content/estaciones/rag-indice/prompts/solo.md",
    "romper_ayuda": "content/estaciones/rag-indice/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/rag-indice/prompts/romper-solo.md",
}

(APP / "content/estaciones/rag-indice.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
