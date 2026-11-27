"""Arma content/estaciones/rag-retrieval.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/r6 && bash probar-fallas.sh /ruta/r6     # deja /ruta/r6.log y /ruta/r6-fallas.log
    python3 contenido.py /ruta/r6                                  # escribe el JSON con esas salidas

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

_lat = L("pc latencia")
MS8, MS20, MS30 = (_re.search(rf"{n} pares en +(\d+) ms", _lat).group(1) for n in (8, 20, 30))
MSPAR = _re.search(r"20 pares en +\d+ ms \(\s*([\d.]+) ms por par", _lat).group(1)
H_CPU = _re.search(r"≈ ([\d.]+) h de CPU", _lat).group(1)
PCT = _re.search(r"\((\d+%)\)", _lat.splitlines()[-1]).group(1)
_rep = L("p6 reporte")
def _fila(m):
    x = _re.search(rf"^\s+{m}\s+([\d.]+)% ±\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)\s+(\d+)/(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", _rep, _re.M).groups()
    return dict(zip(("r8", "margen", "directa", "varias", "r3", "mrr", "fugas", "pro", "cortos", "p50", "p95"), x))
R = {m: _fila(m) for m in ("bm25", "vectores", "fusion", "completo")}
V = "python verificar.py"
VIG = "c11-e5-2026-11-22"
Q = "¿En cuánto tiempo me regresan el dinero si pagué con tarjeta?"

e = {
    "id": "retrieval", "patron": "llm", "rama": "rag", "etapa": "modelo", "num": 6,
    "titulo": "Retrieval y reranker", "nav": "Retrieval",
    "pregunta": "¿Cómo juntas lo que encuentran BM25 y los vectores en una sola lista, dejas que un modelo más fino elija los 8 mejores sin saltarte los permisos, y sabes si de verdad mejoró?",
    "version": "2026-11-27",
}

e["mapa"] = {
    "resumen": "La estación 5 dejó dos buscadores sobre los mismos chunks: <b>BM25</b>, que busca por palabras, y el de <b>vectores</b>, que busca por significado, cada uno con el filtro de permisos <b>antes</b> de elegir. Cada uno da su propia lista, y cada uno falla en preguntas distintas. Esta estación hace el <b>retrieval</b>: el paso que decide qué chunks lee el asistente. Pide <b>candidatos</b> a los dos (30 a cada uno), los junta en una sola lista con <b>RRF</b> (Reciprocal Rank Fusion: cada chunk suma 1/(k + su lugar) en cada lista donde aparece, así no hay que comparar puntajes de BM25 con cosenos), y le pasa los 20 primeros a un <b>reranker</b>: un modelo chico (un <b>cross-encoder</b>) que lee la pregunta y cada pasaje <b>juntos</b> y les da un puntaje más fino. Salen los <b>8</b> que la estación 7 le pone al LLM. Después se mide con el golden set de la estación 4: el <b>recall@8</b> por tipo de pregunta en cuatro modos lado a lado, cuánto mejora el orden (<b>recall@3</b> y <b>MRR</b>), y cuánto tarda el reranker. Se afina con las preguntas de <b>dev</b> y el número que se reporta sale de <b>test</b>.",
    "entra": [
        f"lo que dejó la estación 5: el índice <code>{VIG}</code> (BM25 y vectores de multilingual-e5-small sobre los 151 chunks, cada uno con su ACL) detrás del alias <code>c11</code>, y su <code>Buscador</code> con <code>.bm25()</code> y <code>.vectores()</code>",
        "golden-v2 de la estación 4: 65 preguntas, 51 en test (37 con fuentes que buscar: 25 directas y 12 con varias fuentes; 8 sin respuesta y 6 prohibidas) y 14 en dev",
        "un reranker de Hugging Face, de un commit fijo y con su sha256: cross-encoder/mmarco-mMiniLMv2-L12-H384-v1, cuantizado a int8 (119 MB)",
    ],
    "sale": [
        "<code>pipeline/recuperar.py</code>: el top-8 de cada pregunta para cada persona, por fusión RRF y reranker, con el filtro de permisos antes de elegir",
        f"<code>indices/{VIG}/retrieval.json</code>: el reporte con test: recall@8 por tipo, recall@3, MRR, fugas y latencia de BM25 solo, vectores solos, fusión y fusión + reranker, con la configuración y la firma del reranker",
        f"<code>indices/{VIG}/afinado.json</code>: la tabla de rrf_k × rerank_n con dev, la que justifica los valores de <code>config.yaml</code>",
    ],
    "escala": [
        {"que": "Candidatos", "ref": "30 por índice de ≈ 7.5 M chunks", "taller": "30 por índice de 151 chunks"},
        {"que": "El reranker", "ref": "un servicio con GPU, ≈ 25k preguntas al día × 20 pares", "taller": f"el CPU de tu Mac, int8: ≈ {MS20} ms por 20 pares"},
        {"que": "Golden set", "ref": "≈ 600 preguntas (estación 4)", "taller": "37 de test con fuentes, 9 de dev"},
        {"que": "Presupuesto", "ref": "primer token ≤ 2.5 s: buscar + reranker + el LLM", "taller": f"p50 del modo completo: {R['completo']['p50']} ms"},
        {"que": "Dónde vive", "ref": "la fusión en el motor de búsqueda (RRF viene incluido) y el reranker como servicio aparte", "taller": "<code>pipeline/fusion.py</code> y <code>pipeline/reranker.py</code> con onnxruntime"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de escribir código, las cuentas de servilleta del retrieval: cuánto pesa el lugar en RRF según su k, qué fracción del corpus llega a la fusión, cuánto tarda el reranker y cuántas preguntas hacen falta para creerle a una mejora.",
    "cuentas": [
        {"id": "rrf", "pregunta": "¿Cuánto vale cada lugar en RRF, y qué hace la constante k?",
         "formula": "puntaje de un chunk = suma, en cada lista donde aparece, de 1 / (k + lugar)",
         "ref": {"cuenta": "k = 60, el valor del artículo original de RRF y el que traen por defecto los motores de búsqueda", "valor": "el lugar 30 vale 68 % del lugar 1: las listas cuentan casi parejo"},
         "taller": {"cuenta": "k = 1, 10 y 60, lugares 1, 2, 8, 10 y 30", "valor": "con k = 60, un chunk 10.º en las dos listas (0.0286) le gana al 1.º de una sola (0.0164)"},
         "decide": "Con k grande, RRF premia aparecer en las dos listas más que salir primero en una. Con k = 1, el primer lugar manda. Por eso RRF necesita las listas completas de candidatos: un chunk que va 10.º en las dos se pierde si cortas cada lista en 8.",
         "conceptos": ["rrf", "rrf-k"],
         "comprueba": cmd(P("pc rrf"), L("pc rrf"))},
        {"id": "pool", "pregunta": "¿Qué parte del corpus llega a la fusión?",
         "formula": "pool ≤ 2 × candidatos (si las listas no se repiten); fracción = pool ÷ chunks",
         "ref": {"cuenta": "30 por índice de ≈ 7.5 M chunks", "valor": "a lo más 60: 0.0008 % del corpus"},
         "taller": {"cuenta": "30 por índice de 151", "valor": "a lo más 60: 40 % del corpus (en la práctica, ≈ 31, porque las dos listas se repiten)"},
         "decide": "Lo que no llega al pool no lo rescata nadie: ni la fusión ni el reranker. En C11 el pool es una gota del corpus y su recall es el techo de todo lo demás. Pedir 30 en vez de 8 a cada índice cuesta milisegundos: lo caro viene después, en el reranker.",
         "conceptos": ["candidatos", "techo"],
         "comprueba": cmd(P("pc pool"), L("pc pool"))},
        {"id": "latencia", "pregunta": "¿Cuánto tarda el reranker, y cuánto cuesta al día?",
         "formula": "ms por pregunta ≈ pares × ms por par (se mide en tu Mac); CPU al día = preguntas × pares × ms por par",
         "ref": {"cuenta": "≈ 25k preguntas al día × 20 pares, a la velocidad de tu Mac; y contra el presupuesto de 2.5 s hasta el primer token", "valor": f"≈ {H_CPU} h de CPU al día; ≈ {MS20} ms de 2,500 por pregunta ({PCT})"},
         "taller": {"cuenta": "8, 20 y 30 pares de la fusión de una pregunta, en tu Mac", "valor": f"≈ {MS8} ms, ≈ {MS20} ms y ≈ {MS30} ms"},
         "decide": "El reranker es lo más lento del retrieval: buscar en los dos índices toma milisegundos, y el reranker cientos. Su costo crece con cuántos pares lee y con lo largo de cada pasaje. Por eso lee 20 y no 151, y por eso tentaría bajarlo a 8 (que es justo una de las fallas).",
         "conceptos": ["reranker", "latencia", "rerank-n"],
         "comprueba": cmd(P("pc latencia"), L("pc latencia"), "Los milisegundos dependen de tu Mac y de lo largo de los pasajes: cada lote se rellena al largo del más largo.")},
        {"id": "muestra", "pregunta": "¿Cuántas preguntas hacen falta para ver una mejora de recall?",
         "formula": "la mejora más chica que se distingue ≈ (1.96 + 0.84) × √(2 × p × (1 − p) ÷ n); al revés, n ≈ 7.84 × 2 × p × (1 − p) ÷ mejora²",
         "ref": {"cuenta": "≈ 600 preguntas en el golden set de C11, con recall ≈ 90 %", "valor": "≈ 5 puntos; para ver 2 puntos harían falta ≈ 3,500"},
         "taller": {"cuenta": "37 preguntas de test", "valor": "≈ 20 puntos: en el dojo, casi ninguna mejora se distingue del ruido"},
         "decide": "Con 37 preguntas, pasar de 98.6 % a 100 % es una pregunta: no es evidencia de nada. Se ve mejor pregunta por pregunta (en cuáles cambia, y si cambia para bien) y con más preguntas. Es una aproximación: trata cada recall como una proporción de preguntas independientes, y comparar los dos modos con las mismas preguntas pide algo menos.",
         "conceptos": ["margen", "techo"],
         "comprueba": cmd(P("pc muestra"), L("pc muestra"))},
    ],
}

C = []


def con(id_, termino, en, def_, analogia, importa, trampa):
    C.append({"id": id_, "termino": termino, "en": en, "def": def_, "analogia": analogia, "importa": importa, "trampa": trampa})


con("retrieval", "Retrieval", "retrieval, recuperación",
    "El paso que, con una pregunta y una persona, elige qué chunks del corpus va a leer el asistente. Es la R de RAG (retrieval-augmented generation): lo que el LLM no recibe, no lo puede citar.",
    "Como el bibliotecario que, antes de que alguien lea, le trae de los estantes los 8 libros que mejor contestan su pregunta, y solo de los que tiene permiso de ver.",
    "Si el retrieval no trae la fuente, el mejor LLM del mundo contesta de memoria o inventa. Por eso se mide aparte, con el golden set, antes de poner el LLM (estación 7).",
    "Medir el asistente solo por sus respuestas: si una respuesta sale mal, no sabes si falló el retrieval o el LLM. Se mide cada uno por separado.")
con("candidatos", "Candidatos (pool)", "candidates, candidate pool",
    "Los chunks que cada índice propone antes de fusionar: aquí, los 30 mejores de BM25 y los 30 mejores de vectores, ya filtrados por permisos. El pool es el conjunto de todos ellos (sin repetir).",
    "Como la lista larga de un proceso de contratación: de cientos de solicitudes se quedan 30 por cada reclutador, y de ahí sale la lista corta. Quien no entra a la lista larga no llega a la entrevista.",
    "Todo lo que viene después (la fusión, el reranker) solo puede reordenar el pool: su recall es el techo del retrieval.",
    "Pedir a cada índice los mismos 8 que vas a entregar al final: la fusión y el reranker se quedan sin material para trabajar.")
con("escalas", "Puntajes en escalas distintas", "score scales",
    "BM25 da números de 0 a ≈ 20 (depende de cuántas palabras coinciden y qué tan raras son); el coseno de e5 da de ≈ 0.7 a 0.9. No son la misma unidad: un 9 de BM25 no es «más» que un 0.88 de coseno.",
    "Como sumar una calificación sobre 100 con otra sobre 10: el examen sobre 100 decide solo, aunque el otro sea el más importante.",
    "Es por lo que no se suman los puntajes crudos para fusionar. Se normalizan (con cuidado) o se usa solo el lugar, como RRF.",
    "Normalizar con el máximo de cada lista y creer que ya están en la misma escala: un 1.0 de BM25 en una pregunta con una sola palabra rara no significa lo mismo que en otra.")
con("rrf", "RRF (Reciprocal Rank Fusion)", "reciprocal rank fusion",
    "Una forma de juntar varias listas ordenadas en una sola usando solo el lugar de cada chunk: cada chunk suma 1 / (k + su lugar) en cada lista donde aparece, y se ordena por esa suma. El lugar empieza en 1. Lo propusieron Cormack, Clarke y Büttcher en 2009.",
    "Como una votación de jueces donde cada uno entrega su orden: no importa qué tan alto calificó cada juez, solo en qué lugar puso a cada quien. Quien sale bien con todos gana.",
    "No necesita que BM25 y los vectores estén en la misma escala, no tiene nada que entrenar y premia lo que aparece en las dos listas: justo lo que hace el híbrido.",
    "Olvidar que el lugar empieza en 1 (con 0, el primero vale 1/k) o desempatar al azar: el top-8 cambia entre corridas. Aquí los empates van por chunk_id.")
con("rrf-k", "La constante k de RRF", "rank constant",
    "El número que se suma al lugar en 1 / (k + lugar). Con k = 60 (el del artículo original y el que traen por defecto Elasticsearch y OpenSearch), el lugar 1 vale 0.0164 y el 30 vale 0.0111: casi parejo. Con k = 1, el 1 vale 0.5 y el 30, 0.032.",
    "Como el volumen del primer lugar: con k chica, el primero de cada lista grita y los demás susurran; con k grande, todos hablan a un volumen parecido y gana quien suena en las dos listas.",
    "Decide si la fusión confía más en el primer lugar de cada buscador o en el acuerdo entre los dos. Se puede afinar, pero 60 funciona bien en muchos casos.",
    "Afinar k con 9 preguntas de dev y mover el número porque «salió mejor»: con tan pocas, todas las k empatan (aquí empatan) y cualquier diferencia es ruido.")
con("reranker", "Reranker", "reranker",
    "Un segundo modelo que reordena los candidatos de la fusión: lee la pregunta y cada pasaje y les da un puntaje de qué tan bien contesta ese pasaje esa pregunta. Es más fino que los buscadores, y más caro: una pasada del modelo por cada par.",
    "Como la entrevista después de la lista larga: es cara, así que no se le hace a los cientos de solicitudes, solo a los 20 que pasaron el primer filtro, y ahí se decide de verdad.",
    "Mejora el orden: pone la fuente en los primeros lugares. Eso importa porque el LLM lee mejor lo que va arriba y porque el contexto tiene tope.",
    "Pasarle el corpus entero (151 aquí sería tolerable; 7.5 M en C11, imposible) o pasarle tan pocos que no puede rescatar nada.")
con("cross-encoder", "Cross-encoder", "cross-encoder (contra bi-encoder)",
    "Un transformer que recibe la pregunta y el pasaje <b>juntos</b> en una sola entrada (<code>&lt;s&gt; pregunta &lt;/s&gt;&lt;/s&gt; pasaje &lt;/s&gt;</code>) y da un número (un logit: más alto, más relevante). El modelo de embeddings de la estación 5 es un <b>bi-encoder</b>: hace un vector de la pregunta y otro del pasaje por separado, y luego se comparan. El del dojo, mmarco-mMiniLMv2-L12-H384-v1: 12 capas de 384, entrenado con mMARCO (MS MARCO traducido a 14 idiomas, con español).",
    "El bi-encoder es comparar dos fichas resumen hechas por separado; el cross-encoder es leer la pregunta y el pasaje uno junto al otro, palabra por palabra.",
    "Como cada palabra de la pregunta «ve» cada palabra del pasaje, distingue cosas que un vector resumen pierde (quién hace qué, una negación, un plazo). A cambio, no se puede precalcular: cada par es una pasada.",
    "Leer el logit como probabilidad: 5.9 no es «59 %». Sirve para ordenar los candidatos de una misma pregunta, no para comparar entre preguntas.")
con("cuantizado", "Modelo cuantizado (int8)", "quantization, int8",
    "Guardar los pesos del modelo con enteros de 8 bits en vez de números de 32 bits. El reranker del dojo pesa 119 MB en int8 contra 471 MB en float32: casi 4 veces menos, y corre más rápido en CPU.",
    "Como guardar una foto en JPEG en vez de sin comprimir: pesa mucho menos y casi no se nota, pero no es idéntica.",
    "Deja correr el reranker en una Mac sin GPU. El archivo se baja de un commit fijo y se comprueba su sha256, como cualquier modelo.",
    "Suponer que da exactamente los mismos puntajes que el original: cambian un poco. Lo que importa es que el orden y el recall en tu golden set se sostengan, y eso se mide.")
con("rerank-n", "Cuántos lee el reranker (rerank_n)", "rerank depth",
    "Cuántos de los primeros de la fusión pasan al reranker: aquí, 20. De esos 20 salen los 8 que recibe el LLM.",
    "Como cuántos candidatos pasan a la entrevista: si solo entrevistas a los 8 que igual ibas a contratar, la entrevista no cambia a quién contratas.",
    "Con rerank_n = k, el reranker solo reordena los mismos 8 y el recall@8 es por fuerza el de la fusión. Tiene que leer más de los que salen, y cada par de más cuesta milisegundos.",
    "Bajarlo para ganar latencia sin medir qué se pierde. Es una perilla de costo contra calidad, y se decide con dev.")
con("prefiltro", "Filtrar antes de elegir", "pre-filtering",
    "Aplicar los permisos dentro de cada búsqueda, antes de quedarse con los 30 mejores: se eligen los 30 mejores <b>entre los que la persona ve</b>. Lo contrario, el post-filtro, elige 30 entre todos y después quita lo prohibido. Es la regla de la estación 3.",
    "Como buscar en la parte de la biblioteca a la que tienes acceso, en vez de traer 30 libros de todos los estantes y regresar en la puerta los que no puedes sacar.",
    "Con post-filtro nadie recibe algo prohibido, pero a quien ve poco le llegan 2 o 3 chunks en vez de 8: el LLM contesta con menos contexto justo a esas personas.",
    "Que el post-filtro venga por defecto en el ejemplo de la documentación de una base vectorial. Se revisa con las personas que menos ven.")
con("recall-k", "recall@k", "recall at k",
    "De las fuentes de una pregunta (las que anotó el golden set), la fracción que llega al top-k; luego, el promedio sobre las preguntas. Aquí k = 8, los que recibe el LLM. Solo tiene sentido con preguntas que tienen fuentes que buscar: directas y con varias fuentes.",
    "Como revisar si en la bolsa del súper venía todo lo de la lista: no importa en qué orden, importa que esté.",
    "Es la métrica del gate de la rama: si la fuente no llega al top-8, la respuesta no se puede citar.",
    "Meter las preguntas sin respuesta (no tienen fuentes) o las prohibidas (su fuente es justo lo que no debe llegar): cuentan como 0 y el recall baja sin que nada haya empeorado.")
con("orden", "recall@3 y MRR", "recall@3, mean reciprocal rank",
    "Dos medidas del <b>orden</b>, no solo de si llegó. recall@3 es el recall con los 3 primeros. MRR (mean reciprocal rank) es el promedio de 1 / (lugar de la primera fuente): 1 si va primera, 0.5 si va segunda, 0 si no llega.",
    "Si recall@8 dice que en la bolsa venía todo, MRR dice si lo que más necesitabas venía hasta arriba o hasta el fondo.",
    "Es donde se ve el reranker cuando el recall@8 ya está en el techo: en el dojo, fusión y fusión + reranker dan los dos 100 % de recall@8, pero recall@3 pasa de " + R["fusion"]["r3"] + " % a " + R["completo"]["r3"] + " %.",
    "Optimizar solo el MRR: puede subir poniendo una fuente arriba y sacando otra del top-8. Se miran juntos.")
con("techo", "El techo (saturación)", "ceiling effect",
    "Cuando una métrica ya está en 100 % (o cerca), ya no puede mostrar mejoras: todo empata arriba. En el dojo, la fusión ya da 100 % de recall@8 con 37 preguntas.",
    "Como un examen tan fácil que todos sacan 10: no te dice quién sabe más.",
    "Explica por qué en el dojo varias fallas no mueven el recall@8 aunque sí son errores: se detectan con casos armados a mano (en <code>verificar.py</code>) y con recall@3, MRR y la columna «cortos».",
    "Concluir «el reranker no sirve» porque el recall@8 no subió. Con 7.5 M chunks y preguntas difíciles las listas se separan mucho más que con 151.")
con("dev-test", "Afinar con dev, reportar con test", "dev/test split",
    "El golden set se partió en la estación 4: <b>dev</b> (14 preguntas) es para probar y elegir perillas como rrf_k y rerank_n; <b>test</b> (51) es para el número que se reporta, y nadie lo usa para decidir.",
    "Como estudiar con los exámenes de práctica y presentar el examen final: si el final es igual a la práctica, la calificación no dice cuánto sabes.",
    "Si eliges con las mismas preguntas con que mides, eliges justo lo que le fue bien a esas preguntas, y el número sale optimista.",
    "Medir con dev porque «ya estaba corrido», o afinar con test porque dev es chico. Si dev no alcanza para decidir, la respuesta es más preguntas, no usar test.")
con("margen", "Margen y tamaño de muestra", "margin of error, sample size",
    "El margen al 95 % del recall es 1.96 × desviación estándar ÷ √n (estación 4). Para comparar dos modos, la mejora tiene que ser más grande que el ruido de los dos: con n preguntas y un recall de ≈ 90 %, la mejora más chica que se distingue es ≈ 2.8 × √(2 × 0.9 × 0.1 ÷ n).",
    "Como una encuesta de 37 personas: si un candidato saca 2 puntos más, no sabes si de verdad va ganando.",
    "Decide cuánto puedes creerle a «el reranker subió el recall 1.4 puntos»: con 37 preguntas, nada; con 600, todavía no; con miles, sí.",
    "Reportar 100.0 % ± 0.0 % como si fuera certeza: el margen da 0 porque todas dieron 1, no porque se sepa con precisión.")
con("latencia", "Latencia p50 y p95", "latency percentiles",
    "Lo que tarda cada pregunta, en milisegundos. El p50 (la mediana) es lo que tarda la pregunta típica; el p95, la que es más lenta que el 95 % de las demás: lo que sufren los que tienen mala suerte.",
    "El p50 es cuánto tardas en llegar al trabajo un día normal; el p95, el día de lluvia.",
    "El reranker se paga en latencia, y la latencia de C11 tiene presupuesto: el primer token en ≤ 2.5 s, con el LLM incluido.",
    "Medir solo el promedio: unas cuantas preguntas con pasajes largos lo esconden. El costo del reranker crece con lo largo de cada pasaje.")

e["conceptos"] = C

e["mundo"] = {
    "resumen": "El kit trae el marketplace ficticio del caso el <b>23 de noviembre a las 10:00</b>, con lo que dejaron las estaciones 2 a 5: el corpus con <b>151 chunks de 104 documentos</b> (cada uno con su ruta de títulos y su ACL), el directorio de <b>14 personas</b>, el golden set <b>golden-v2</b> (65 preguntas, 51 de test y 14 de dev) y, detrás del alias <b>c11</b>, el índice híbrido de la estación 5 (BM25 y vectores de multilingual-e5-small). Su código viene dado en <code>pipeline/</code>: el <code>Buscador</code> con <code>.bm25()</code> y <code>.vectores()</code>, cada uno con el filtro de permisos antes de elegir. Se bajan dos modelos de un commit fijo de Hugging Face, con su sha256: e5 (el del índice) y el <b>reranker</b>. Tú escribes la fusión, el recuperador, el reranker y la medición.",
    "trae": [
        {"que": "mundo/entrada/", "detalle": "El corpus del 22, el directorio y el registro del golden set (<code>registro-golden/</code>: golden-v2 con su manifiesto). Los mismos de la estación 5."},
        {"que": "Los modelos", "detalle": "<code>mundo/modelos.json</code> es el catálogo (repositorio, revisión, archivos con su tamaño y sha256, tope de tokens y licencia) y <code>mundo/modelos.py</code> los baja a <code>modelo/</code>: ≈ 623 MB, una vez. Del reranker se baja el archivo cuantizado a int8 (<code>onnx/model_qint8_arm64.onnx</code>, 119 MB)."},
        {"que": "El índice de la estación 5", "detalle": f"<code>mundo/crear.py</code> lo construye con el propio código de la estación 5 (<code>pipeline/construir.py</code>, ≈ 4 s) y apunta c11 a él: <code>indices/{VIG}/</code>."},
        {"que": "verificar.py y romper.py", "detalle": "Los 8 checks de la estación (de <code>mundo</code> a <code>reporte</code>) y las 6 fallas: sumar los puntajes crudos, cortar a 8 antes de fusionar, los permisos después del top-k, el reranker con pocos candidatos, medir con las sin respuesta y las prohibidas mezcladas, y reportar con el split de afinar."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/fusion.py", "hace": "Paso 1: RRF con su k, y la suma cruda para comparar."},
        {"archivo": "pipeline/recuperar.py", "hace": "Pasos 2 y 4: los candidatos de cada índice con el filtro antes, la fusión, el reranker sobre los primeros rerank_n y el top-8, con sus milisegundos."},
        {"archivo": "pipeline/reranker.py", "hace": "Paso 3: el cross-encoder (sha256, pares juntos, lotes, un logit por par) y reordenar()."},
        {"archivo": "pipeline/medir.py", "hace": "Pasos 5 y 6: recall@8 por tipo, recall@3, MRR, fugas, cortos y latencia de los cuatro modos; afinar con dev y reportar con test."},
        {"archivo": "config.yaml", "hace": "retrieval (candidatos, filtro, fusión, rrf_k, rerank_n, k), el lote del reranker y medicion (split, tipos y afinado_con)."},
    ],
    "requisitos": [
        "Python 3.12 o más nuevo (numpy 2.5.5 lo pide; se probó con 3.14.3), ≈ 100 MB para el entorno virtual y ≈ 650 MB para los modelos",
        "Internet para el <code>pip install</code> (onnxruntime 1.32.0, numpy 2.5.5, tokenizers 0.23.3 y pyyaml 6.0.4) y para bajar los modelos una vez; después, nada",
        "La estación 5 ayuda, pero no hace falta: el kit trae su código y construye su índice",
    ],
    "sustituciones": [
        {"nube": "La búsqueda híbrida del motor (OpenSearch o Elasticsearch traen RRF incluido)", "local": "<code>pipeline/fusion.py</code> y <code>recuperar.py</code> sobre el Buscador de la estación 5", "diferencia": "La misma fórmula. En el motor se configura (k, cuántos candidatos por lista); aquí la escribes para ver qué hace cada perilla."},
        {"nube": "Un servicio de reranking con GPU (un cross-encoder más grande, o una API de reranking)", "local": "un cross-encoder chico cuantizado a int8, en el CPU de tu Mac con onnxruntime", "diferencia": "La misma idea: leer pregunta y pasaje juntos. Con GPU, 20 pares tardan mucho menos; el presupuesto de latencia es el que manda."},
        {"nube": "Un golden set de ≈ 600 preguntas", "local": "37 preguntas de test con fuentes y 9 de dev", "diferencia": "Con 37, una mejora de menos de ≈ 20 puntos no se distingue del ruido, y la fusión ya llega al 100 %: el dojo enseña a medir, no a creer en 1.4 puntos."},
    ],
    "arranque": "unzip rag-retrieval.zip && cd rag-retrieval\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython mundo/modelos.py\npython mundo/crear.py",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El almacén del 23 a las 10:00, e5 y el reranker con su sha256, y el índice de la estación 5 detrás del alias c11.",
    conceptos=["retrieval"],
    explica="Hacen falta onnxruntime, numpy, tokenizers y pyyaml. <code>mundo/modelos.py</code> baja los dos modelos de un commit fijo de Hugging Face y comprueba el sha256 de cada archivo contra <code>mundo/modelos.json</code>. <code>mundo/crear.py</code> copia el corpus, el directorio y el golden set a <code>almacen/</code> y construye el índice de la estación 5 con su propio código. Al final, la línea base: lo que cada índice encuentra solo, con el <code>prueba.py</code> de la estación 5.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("python mundo/modelos.py", L("p0 modelos"), "Una sola vez, con internet. Si un sha256 no coincide, el archivo no se guarda."),
        cmd("python mundo/modelos.py --listar", L("p0 listar")),
        cmd("python mundo/crear.py", L("p0 crear")),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd(f"{V} fusion", L("p0 esqueleto"), "Es lo esperado: tus cuatro archivos todavía son el esqueleto. Cada check se pone en verde en su paso."),
        cmd("python pipeline/prueba.py", L("p0 linea base"), "La línea base de la estación 5: cada índice solo. BM25 gana en una pregunta y los vectores en cuatro: juntarlos es el trabajo de hoy."),
    ],
    verifica="<code>verificar.py mundo</code> en verde.",
    ojo="<code>modelo/</code> e <code>indices/</code> no van en el .zip ni en git: el primero se baja y el segundo lo construye <code>mundo/crear.py</code>. Lo de la estación 5 en <code>pipeline/</code> no se toca: tú escribes <code>fusion.py</code>, <code>recuperar.py</code>, <code>reranker.py</code> y <code>medir.py</code>."))

G.append(dict(n=1, id="fusion", titulo="Juntar dos listas", objetivo="<code>fusion.py</code>: RRF, que junta dos listas ordenadas usando solo el lugar de cada chunk, y la suma cruda de puntajes, para ver por qué no.",
    conceptos=["escalas", "rrf", "rrf-k"],
    explica="BM25 y los vectores dan cada uno su lista de <code>(chunk_id, puntaje)</code>, de mayor a menor. Los puntajes no están en la misma <b>escala</b>: BM25 de ≈ 3 a ≈ 20, el coseno de ≈ 0.7 a 0.9. <b>RRF</b> los ignora: cada chunk suma <code>1 / (k + lugar)</code> por cada lista donde aparece (el lugar empieza en 1), y se ordena por esa suma, con empates por chunk_id para que el orden no cambie entre corridas. <code>suma()</code> suma los puntajes crudos: es lo que hacía el prototipo, y queda para comparar. <code>fusionar()</code> elige uno de los dos por nombre.",
    codigo=[py("pipeline/fusion.py")],
    comandos=[
        cmd("python pipeline/fusion.py", L("p1 ejemplo"), "La suma deja a BM25 decidir solo: «b» (9.8 en BM25 y nada en vectores) le gana a «c» (7.1 + 0.88). RRF pone arriba a «a» y «c», que están en las dos listas."),
        cmd(f"{V} fusion", L("p1 verificar")),
    ],
    verifica="<code>verificar.py fusion</code> en verde: los puntajes de RRF con k = 60 y k = 1, la suma cruda, el ValueError, y tu Recuperador fusionando por RRF (lo da el paso 2).",
    ojo="El check fusion también llama a tu <code>Recuperador</code>, que escribes en el paso 2: hasta entonces se queda en rojo en esa parte. Si quieres ver solo lo de este paso, corre <code>python pipeline/fusion.py</code>.",
    en_pagina={"conceptos": ["escalas", "rrf", "rrf-k"], "precalculos": ["rrf"]}))

G.append(dict(n=2, id="candidatos", titulo="Candidatos con permisos", objetivo="<code>Recuperador</code> en <code>recuperar.py</code>: pedirle 30 candidatos a cada índice con el filtro de permisos antes de elegir, fusionarlos con RRF y quedarse con los 8 primeros.",
    conceptos=["candidatos", "prefiltro"],
    explica=f"<code>candidatos()</code> pide <code>retrieval.candidatos</code> (30) a <code>Buscador.bm25()</code> y a <code>Buscador.vectores()</code>. Con <code>filtro: antes</code>, cada búsqueda ya elige entre lo que la persona ve (es lo de la estación 3, y viene así en el Buscador). El modo <code>despues</code> existe para comparar: busca entre todos (<code>persona=None</code>) y luego quita lo prohibido. <code>recuperar()</code> tiene cuatro modos: <code>bm25</code> y <code>vectores</code> (cada lista sola), <code>fusion</code> (RRF y los primeros k) y <code>completo</code> (el paso 4). Todo sale de <code>config.yaml</code>, que se lee en cada llamada, y cada llamada dice cuántos milisegundos tardó y cuántos candidatos juntó la fusión (el pool).",
    codigo=[py("pipeline/recuperar.py", "En este paso escribes <code>__init__</code>, <code>candidatos()</code> y <code>recuperar()</code> en los modos bm25, vectores y fusion; el modo completo es el paso 4.")],
    comandos=[
        cmd(P("p2 fusion"), L("p2 fusion"), "La pregunta de la estación 5: BM25 se va a los tickets por «tarjeta» y los vectores a las páginas de reembolsos; la fusión junta las dos. Elena ve 88 de los 151 chunks."),
        cmd(P("p2 poco"), L("p2 poco"), "Carmen ve 4 chunks del corpus: recibe 4, no 8, y ninguno ajeno."),
        cmd(f"{V} fusion candidatos", L("p2 verificar")),
    ],
    verifica="<code>verificar.py fusion candidatos</code> en verde: tu Recuperador fusiona por RRF, le pide 30 a cada índice, y un chunk que va 10.º en las dos listas sale 1.º.",
    ojo="Pedir 30 en vez de 8 a cada índice no cuesta casi nada (los dos índices contestan en milisegundos); lo que cuesta es lo que viene después, el reranker. Cortar en 8 antes de fusionar es una de las fallas.",
    en_pagina={"conceptos": ["candidatos", "prefiltro"], "precalculos": ["pool"]}))

G.append(dict(n=3, id="reranker", titulo="Un modelo que lee los dos juntos", objetivo="<code>reranker.py</code>: cargar el cross-encoder comprobando su sha256, puntuar cada par (pregunta, pasaje) en lotes y reordenar una lista de candidatos.",
    conceptos=["reranker", "cross-encoder", "cuantizado"],
    explica="El <b>reranker</b> es un <b>cross-encoder</b>: el tokenizer arma una sola entrada con la pregunta y el pasaje (<code>tok.encode_batch([(pregunta, texto), ...])</code>), cortada en 512 tokens, y el modelo da <b>un logit por par</b> (forma <code>(lote, 1)</code>): más alto, más relevante. Se pasa en lotes de <code>reranker.lote</code> (8): cada lote se rellena al largo de su pasaje más largo, así que lotes chicos desperdician menos. Igual que en la estación 5, antes de cargarlo se compara el sha256 de cada archivo con el catálogo. El modelo está <b>cuantizado a int8</b>: 119 MB en vez de 471.",
    codigo=[py("pipeline/reranker.py")],
    comandos=[
        cmd(P("p3 pares"), L("p3 pares"), "El pasaje que contesta queda muy arriba; el de devoluciones (otro tema del mismo mundo) y el del calendario, muy abajo. Los números no son probabilidades: sirven para ordenar."),
        cmd(P("p3 tokens"), L("p3 tokens"), "Así ve el modelo un par: la pregunta, dos separadores y el pasaje, en la misma entrada. Por eso cada palabra de la pregunta «ve» cada palabra del pasaje."),
        cmd(f"{V} reranker", L("p3 verificar")),
    ],
    verifica="<code>verificar.py reranker</code> en verde: la firma del catálogo, un float32 por par, los mismos puntajes que el modelo (± 0.001) y reordenar() de mayor a menor.",
    ojo="En el modelo de embeddings, cada texto da un vector por separado y se pueden calcular de noche; en el cross-encoder, cada par es una pasada nueva y no se puede adelantar nada: por eso lee 20 candidatos y no todo el índice.",
    en_pagina={"conceptos": ["reranker", "cross-encoder", "cuantizado"], "precalculos": ["latencia"]}))

G.append(dict(n=4, id="completo", titulo="El top-8", objetivo="El modo <code>completo</code> de <code>recuperar()</code>: de la fusión, los primeros 20 pasan por el reranker y salen sus 8 primeros, con los permisos intactos.",
    conceptos=["rerank-n", "prefiltro"],
    explica="De la lista fusionada, los primeros <code>retrieval.rerank_n</code> (20) van a <code>reordenar()</code> con sus textos (<code>self.textos</code>, del corpus vigente), y salen los primeros <code>retrieval.k</code> (8). El reranker solo reordena: todo lo que lee ya pasó el filtro de permisos, así que no puede meter nada prohibido. <code>ms</code> separa lo que tardó buscar de lo que tardó el reranker. Lee más de los que salen (20 contra 8) para poder subir algo que la fusión dejó del 9.º para abajo.",
    codigo=[],
    comandos=[
        cmd(P("p4 completo"), L("p4 completo"), "Los cuatro modos lado a lado. El reranker sube wiki:1015 (la política de reembolsos) al primer lugar, que la fusión dejaba tercero. Casi todo el tiempo es el reranker; buscar, unos milisegundos."),
        cmd(f"{V} rerank permisos", L("p4 verificar")),
    ],
    verifica="<code>verificar.py rerank permisos</code> en verde: el reranker recibe exactamente 20 y sube al 1.º al que la fusión dejó 16.º; las 14 personas reciben solo lo que ven, siempre 8 si ven 8 o más, y ninguna prohibida recibe su fuente.",
    ojo="El check rerank usa un buscador y un reranker de mentira, armados a mano: en el corpus del dojo casi nunca hace falta subir algo desde el lugar 16, pero en C11 sí. Es la forma de probar una regla que tus datos todavía no ejercitan.",
    en_pagina={"conceptos": ["rerank-n"], "precalculos": []}))

G.append(dict(n=5, id="afinar", titulo="Medir y afinar con dev", objetivo="<code>medir.py</code>: recall@8 por tipo de pregunta, recall@3, MRR, fugas, cortos y latencia de los cuatro modos; y la tabla de rrf_k × rerank_n con las preguntas de dev.",
    conceptos=["recall-k", "orden", "dev-test", "latencia"],
    explica="<code>medir()</code> corre cada pregunta en cada modo. El <b>recall@8</b> solo usa las de <code>medicion.tipos</code> (directa y varias, las que tienen fuentes que buscar), y por tipo; si alguien pide sin_respuesta o prohibida, ValueError. Además: <b>recall@3</b> y <b>MRR</b> (el orden), <b>fugas</b> (prohibidas que recibieron su fuente), <b>cortos</b> (quien recibió menos de 8 viendo 8 o más) y el <b>p50 y p95</b> de los milisegundos. <code>--afinar</code> prueba rrf_k en 10, 30, 60 y 100 y rerank_n en 8, 20 y 30 con el split de <code>medicion.afinado_con</code> (dev), con el reranker de memoria (cada par se puntúa una vez), y guarda la tabla sin tocar <code>config.yaml</code>.",
    codigo=[py("pipeline/medir.py", "<code>revisar_split()</code> es del paso 6; <code>_media()</code> y <code>_tabla()</code> vienen dadas.")],
    comandos=[
        cmd("python pipeline/medir.py --afinar", L("p5 afinar"), "Todo empata: con 9 preguntas de dev, las 12 combinaciones dan 100 % de recall@8 en fusión y con reranker, y el mismo MRR. No hay evidencia para mover rrf_k de 60 ni rerank_n de 20: la decisión honesta es dejar los valores estándar y anotar por qué."),
        cmd(f"{V} medicion", L("p5 verificar")),
    ],
    verifica="<code>verificar.py medicion</code> en verde: tu recall@8 coincide con el del equipo en una muestra de test, solo directa y varias entran al recall, y medir con dev para el reporte se niega.",
    ojo="Que la tabla empate no es un error: es lo que pasa con 9 preguntas que ya están en el techo. En C11, con ≈ 600, se afinaría de verdad; y aun así se afina con dev, nunca con test.",
    en_pagina={"conceptos": ["recall-k", "orden", "latencia"], "precalculos": []}))

G.append(dict(n=6, id="reporte", titulo="El reporte con test", objetivo=f"El número que se reporta: los cuatro modos con las 37 preguntas de test, guardado en <code>indices/{VIG}/retrieval.json</code> con la configuración y la firma del reranker; y que nadie pueda reportar con dev.",
    conceptos=["dev-test", "margen", "techo"],
    explica="<code>revisar_split()</code> se niega a medir el reporte con el split de <code>medicion.afinado_con</code>: con esas preguntas se eligieron las perillas. Sin <code>--afinar</code>, <code>medir.py</code> corre <code>medicion.split</code> (test) y guarda el reporte con todo lo necesario para repetirlo: el índice, la versión del golden set, la configuración de <code>retrieval</code> y la firma del reranker. La estación 7 toma de aquí el top-8 y su recall@8.",
    codigo=[],
    comandos=[
        cmd("python pipeline/medir.py", L("p6 reporte"), f"Fusión y fusión + reranker llegan al 100 % de recall@8 (BM25 solo {R['bm25']['r8']} %, vectores solos {R['vectores']['r8']} %). Lo que gana el reranker se ve en el orden: recall@3 de {R['fusion']['r3']} % a {R['completo']['r3']} % y MRR de {R['fusion']['mrr']} a {R['completo']['mrr']}. Lo paga en latencia: el p50 pasa de {R['fusion']['p50']} a {R['completo']['p50']} ms. Los 5 «cortos» de BM25 no son permisos: son preguntas donde menos de 8 chunks comparten alguna palabra."),
        cmd(P("p6 json"), L("p6 json"), "Con 37 preguntas en el techo, el reranker no cambia el recall@8 de ninguna: su efecto es el orden."),
        cmd("sed -i.bak 's/^  split: test/  split: dev/' config.yaml && python pipeline/medir.py\nmv config.yaml.bak config.yaml", L("p6 dev"), "Así se ve la guarda: con split: dev, medir.py no mide el reporte."),
        cmd(f"{V} medicion reporte", L("p6 verificar")),
    ],
    verifica="<code>verificar.py reporte</code> en verde: el reporte es de test, con la configuración de hoy, con los números del equipo, 37 preguntas, 0 fugas, y fusión + reranker no pierde contra ningún índice solo.",
    ojo="El margen de ± 0.0 % no es precisión: todas dieron 1. Con 37 preguntas, una mejora tendría que ser de ≈ 20 puntos para distinguirse del ruido (el precálculo «muestra»). El reporte dice lo que mide; para decir más, hacen falta más preguntas.",
    en_pagina={"conceptos": ["dev-test", "margen", "techo"], "precalculos": ["muestra"]}))

e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py</code>: deja el esqueleto en tus cuatro archivos, devuelve <code>config.yaml</code> de fábrica y vuelve a crear el mundo (los modelos se quedan).",
        "Sin GUION.md ni <code>mundo/referencia.py</code>: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El almacén del 23, e5 y el reranker con su sha256, y el índice de la estación 5 detrás de c11.", "check": "mundo"},
        {"n": 2, "objetivo": "RRF con su k, la suma cruda para comparar, y un Recuperador que fusiona con lo que dice config.yaml.", "check": "fusion", "pista": "¿En qué lugar empieza a contar una lista, en 0 o en 1? ¿Cómo desempatas?"},
        {"n": 3, "objetivo": "Candidatos suficientes de cada índice: un chunk que va 10.º en las dos listas llega a la fusión.", "check": "candidatos"},
        {"n": 4, "objetivo": "Un cross-encoder que solo carga archivos con el sha256 del catálogo y da los mismos puntajes que el modelo.", "check": "reranker", "pista": "¿La pregunta y el pasaje van en dos codificaciones o en una?"},
        {"n": 5, "objetivo": "El reranker lee más de los que salen, y puede subir al 1.º al que la fusión dejó 16.º.", "check": "rerank"},
        {"n": 6, "objetivo": "Cada persona recibe solo lo que puede leer, siempre 8 si ve 8 o más, y ninguna prohibida recibe su fuente, también con reranker.", "check": "permisos", "pista": "¿Qué le pasa a quien ve 11 chunks si eliges 30 entre todos y luego quitas los prohibidos?"},
        {"n": 7, "objetivo": "El recall@8 por tipo de los cuatro modos, igual al del equipo, solo con las preguntas que tienen fuentes, y una guarda contra medir con el split de afinar.", "check": "medicion"},
        {"n": 8, "objetivo": "El reporte con test, con la configuración de hoy y la firma del reranker, y la tabla de afinado con dev.", "check": "reporte"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


REHACER = "Después, <code>python pipeline/medir.py</code> rehace el reporte con la configuración buena."
_fr = {}
for k_, sec in (("sum", "sum reporte"), ("cand", "cand reporte"), ("fil", "fil reporte"), ("pocos", "pocos reporte"), ("mez", "mez reporte"), ("split", "split reporte")):
    _fr[k_] = F(sec)
e["fallas"] = [
    falla("fusion-suma", "El reporte de la semana dice que la fusión perdió contra los vectores solos", "config",
          "Para «simplificar» la fusión, alguien la cambió a sumar los puntajes de los dos índices: «total, los dos ya son puntajes, de mayor a menor».",
          "En el reporte, la fusión queda debajo de los vectores solos en recall@8, y su recall@3 es el de BM25. <code>verificar.py fusion</code> falla: con listas armadas a mano, tu Recuperador deja arriba a todo BM25.",
          ["El índice de vectores perdió chunks.", "La fusión ya no es RRF.", "Cambió el golden set."],
          cmd("python verificar.py fusion", F("sum verificar"), "BM25 da ≈ 20 y el coseno ≈ 0.9: sumados, BM25 decide solo y los vectores solo desempatan."),
          "<code>retrieval.fusion</code> vuelve a <code>rrf</code>. " + REHACER + " RRF no mira los puntajes, solo el lugar: por eso junta listas que no están en la misma escala. Si algún día se combinan puntajes, se normalizan primero, y se mide con dev.",
          "escalas", "fusion"),
    falla("candidatos-ocho", "Bajó la latencia, y el top-8 cambió sin que nadie tocara el índice", "config",
          "Para bajar la latencia, alguien le pidió 8 candidatos a cada índice en vez de 30: «total, al final solo salen 8».",
          "El recall@8 del reporte no se mueve, pero el p50 del modo completo baja y <code>verificar.py candidatos</code> falla: un chunk que va 10.º en las dos listas ya no llega a la fusión. <code>rerank</code> también falla: al reranker le llegan 16, no 20.",
          ["El reranker se volvió más rápido.", "Cada índice corta antes de fusionar.", "El filtro de permisos cambió."],
          cmd("python verificar.py candidatos rerank", F("cand verificar"), "En el dojo, las fuentes ya estaban en los primeros 8 de alguna lista: el recall no lo nota. Con 7.5 M chunks, sí."),
          "<code>retrieval.candidatos</code> vuelve a 30. " + REHACER + " Se corta después de fusionar, no antes. Buscar 30 en vez de 8 cuesta milisegundos; lo que baja la latencia de verdad era que el reranker leía menos, y eso es otra perilla (rerank_n), que se decide con dev.",
          "candidatos", "candidatos"),
    falla("filtro-despues", "Algunas personas reciben 2 o 3 chunks en vez de 8", "config",
          "Al probar el cambio a «la base vectorial nueva», el filtro de permisos se puso como post-filtro, como venía en el ejemplo de la documentación.",
          "Nadie recibe algo prohibido, pero en el reporte aparecen preguntas «cortas» en vectores y fusión, y el recall@8 de BM25 baja. <code>verificar.py permisos</code> falla: Irene ve 11 chunks y recibe 2.",
          ["A Irene le quitaron permisos.", "Los permisos se aplican después de elegir.", "BM25 no encuentra palabras."],
          cmd('python pipeline/recuperar.py --modo fusion --persona irene.sol@marketplace.test "¿En qué horario atiende soporte por teléfono?"', F("fil ver"), "Cada índice eligió sus 30 entre los 151 y después se quitaron los que Irene no ve: casi nada de lo elegido era suyo."),
          "<code>retrieval.filtro</code> vuelve a <code>antes</code>. " + REHACER + " Primero se filtra y después se elige, como en la estación 3. Al cambiar de motor o de base vectorial, se revisa cómo aplica el filtro y se prueba con las personas que menos ven.",
          "prefiltro", "permisos"),
    falla("rerank-pocos", "El reranker «ya no ayuda»: fusión y fusión + reranker dan lo mismo", "config",
          "El reranker era lo más lento del retrieval, así que alguien le pasó solo los 8 primeros de la fusión: «son los que van a salir de todos modos».",
          "La latencia del modo completo baja casi a la mitad. <code>verificar.py rerank</code> falla: el reranker sabe cuál es el bueno, pero no lo puede subir porque nunca lo lee.",
          ["El modelo del reranker cambió.", "El reranker lee solo los que ya iban a salir.", "La fusión empeoró."],
          cmd("python verificar.py rerank", F("pocos verificar"), "Con rerank_n = k, el recall@8 del modo completo es por fuerza el de la fusión: el reranker solo reordena los mismos 8."),
          "<code>retrieval.rerank_n</code> vuelve a 20. " + REHACER + " El reranker tiene que leer más de los que salen: su trabajo es subir lo que la fusión dejó abajo. Cuántos más, se decide con la tabla de dev y con el presupuesto de latencia.",
          "rerank-n", "rerank"),
    falla("medicion-mezclada", "El recall@8 del reporte cayó a ≈ 73 % en los cuatro modos a la vez", "config",
          "Para que «la muestra sea más grande», alguien puso todos los tipos de pregunta en la medición y corrió el script viejo del reporte.",
          "El reporte cuenta 51 preguntas en vez de 37 y todos los modos bajan juntos, los cuatro por el mismo factor. Tu <code>medir.py</code> se niega a correr con esa configuración.",
          ["El índice se rompió.", "Entraron al recall preguntas que no tienen fuentes que buscar.", "El reranker empeoró."],
          cmd("python pipeline/medir.py", F("mez medir"), "37 de 51 = 72.5 %: las 8 sin respuesta y las 6 prohibidas cuentan como 0. No empeoró nada; se midió mal."),
          "<code>medicion.tipos</code> vuelve a <code>[directa, varias]</code>. " + REHACER + " Las sin respuesta y las prohibidas se miden aparte: las prohibidas como fugas (tienen que ser 0) y las sin respuesta en la estación 7, viendo si el asistente dice que no sabe.",
          "recall-k", "medicion"),
    falla("split-afinado", "El reporte de la semana dice 100 % en todo, con un margen de ± 0", "config",
          "Para tener el número del reporte antes de la junta, alguien lo midió con las preguntas de dev, «que ya estaban corridas».",
          "El reporte dice split dev y cuenta 9 preguntas; todos los modos dan 100 %, también BM25 solo. Tu <code>medir.py</code> se niega a medir el reporte con ese split.",
          ["El retrieval mejoró.", "El reporte se midió con las preguntas de afinar.", "Se borraron preguntas del golden set."],
          cmd("python pipeline/medir.py", F("split medir"), "La guarda del paso 6: el split de afinar no sirve para el reporte."),
          "<code>medicion.split</code> vuelve a <code>test</code>. " + REHACER + " Se afina con dev y se reporta con test, que nadie usó para decidir. Y 9 preguntas en el techo no dicen nada: el ± 0 es porque todas dieron 1.",
          "dev-test", "reporte"),
]

e["listo"] = [
    "Cada pregunta pide 30 candidatos a BM25 y 30 a vectores, con el filtro de permisos antes de elegir, y los junta con RRF (k = 60) sin mirar los puntajes.",
    "Un cross-encoder local, fijado por revisión y sha256, lee los primeros 20 de la fusión y salen sus 8 mejores: el top-8 que recibe el LLM.",
    "Nadie recibe un chunk que no puede leer, y todos reciben 8 si ven 8 o más, también después del reranker.",
    "El recall@8 se mide por tipo de pregunta, solo con las que tienen fuentes, en cuatro modos lado a lado, con recall@3, MRR, fugas y la latencia del reranker.",
    "Las perillas se afinan con dev; el número del reporte sale de test, con la configuración y la firma del reranker guardadas.",
]

e["repaso"] = {
    "memo": f"<b>Candidatos de los dos índices con los permisos antes, RRF para juntarlos por el lugar (no por el puntaje), un cross-encoder que lee los 20 primeros y deja 8, y una medición por tipo y por modo que se afina con dev y se reporta con test.</b> En el dojo, con 37 preguntas: BM25 {R['bm25']['r8']} %, vectores {R['vectores']['r8']} %, fusión {R['fusion']['r8']} % y fusión + reranker {R['completo']['r8']} % de recall@8; el reranker sube el recall@3 de {R['fusion']['r3']} % a {R['completo']['r3']} % y cuesta ≈ {int(R['completo']['p50']) - int(R['fusion']['p50'])} ms por pregunta.",
    "trampa": "Errores que no se ven en el recall@8. Sumar puntajes crudos, cortar a 8 antes de fusionar, filtrar después o pasarle al reranker solo los 8 que ya iban a salir: en un corpus chico y en el techo, el recall@8 apenas se mueve. Y dos errores de medición lo mueven sin que nada cambie: mezclar preguntas sin fuentes (baja a 72.5 %) o medir con dev (sube a 100 % ± 0). Lo que los atrapa son pruebas armadas a mano, recall@3, MRR, la columna «cortos» y la regla de dev y test.",
    "entrevista": [
        {"q": "¿Cómo combinas BM25 y búsqueda por vectores?", "a": "Con RRF: le pido unos 30 candidatos a cada uno, con los permisos ya aplicados, y cada chunk suma 1/(60 + su lugar) en cada lista donde aparece. No sumo los puntajes porque no están en la misma escala: BM25 da hasta ≈ 20 y el coseno ≈ 0.9, y la suma deja que BM25 decida solo (en mi golden set, la fusión por suma quedó debajo de los vectores solos). RRF no se entrena y premia lo que aparece en las dos listas."},
        {"q": "¿Qué es un reranker y por qué no lo usas para buscar en todo el corpus?", "a": "Un cross-encoder: lee la pregunta y el pasaje juntos y da un puntaje. Es más fino que comparar dos vectores, porque cada palabra de la pregunta ve cada palabra del pasaje, pero cada par es una pasada del modelo y no se puede precalcular. Por eso va después de la fusión, sobre unos 20 candidatos: en mi Mac, en CPU y cuantizado, eran ≈ " + MS20 + " ms por pregunta; sobre 7.5 M chunks sería imposible."},
        {"q": "¿Cuántos candidatos le pasas al reranker?", "a": "Más de los que salen, porque si le paso solo los 8 que voy a entregar, el recall@8 es por fuerza el de la fusión: solo los reordena. Yo uso 20 para entregar 8. Es una perilla de costo contra calidad: cada par cuesta milisegundos y el presupuesto hasta el primer token es de 2.5 s con el LLM incluido. La elijo con dev y la reviso contra la latencia p95."},
        {"q": "Tu retrieval pasa de 98.6 % a 100 % de recall@8. ¿Lo reportas como mejora?", "a": "Con 37 preguntas, no: es una pregunta, y la mejora más chica que se distingue del ruido es de ≈ 20 puntos. Lo que sí puedo decir es en qué preguntas cambió y si fue para bien, y miro el orden: recall@3 y MRR, que es donde el reranker se nota cuando el recall@8 está en el techo. Para afirmar una mejora de 2 o 3 puntos harían falta miles de preguntas."},
        {"q": "¿Cómo te aseguras de que el número de tu reporte no está inflado?", "a": "Afino con dev y reporto con test, y el código se niega a medir el reporte con el split de afinar. Solo cuento en el recall las preguntas que tienen fuentes que buscar; las prohibidas se miden como fugas y las sin respuesta en la generación. Guardo con el reporte la configuración y la versión del modelo, para que se pueda repetir."},
        {"q": "¿Dónde van los permisos en el retrieval híbrido?", "a": "Dentro de cada búsqueda, antes de elegir los candidatos, en los dos índices. Si filtro después, nadie ve algo prohibido, pero a quien ve poco le llegan 2 o 3 chunks en vez de 8. El reranker y la fusión solo reordenan lo que ya pasó el filtro, así que no pueden meter nada ajeno. Lo pruebo con cada persona del golden set, con las que menos ven y con las preguntas prohibidas."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/rag-retrieval/CLAUDE.md",
    "guiado": "content/estaciones/rag-retrieval/prompts/guiado.md",
    "solo": "content/estaciones/rag-retrieval/prompts/solo.md",
    "romper_ayuda": "content/estaciones/rag-retrieval/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/rag-retrieval/prompts/romper-solo.md",
}

(APP / "content/estaciones/rag-retrieval.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
